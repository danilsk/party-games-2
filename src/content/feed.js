// Content feed: built-in word banks first, then OpenRouter once a bank runs dry or does not cover the setup.

import { idbGet, idbPut } from '../core/storage.js'
import { historyKey, recentHistory, addToHistory, seenIds, forgetIds, slug, pairKey, pairId, SEND_CAP } from './history.js'
import { generatePairs, generateWords, GenerationError } from './openrouter.js'
import { loadBank, bankLanguage, bankPool } from './bank.js'

const LOW_WATER = 14
const TARGET = 34
const BATCH_WORDS = 30
const BATCH_PAIRS = 14

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

export function normLevels(levels) {
  const out = [...new Set((levels || []).map(Number))].filter((l) => l >= 1 && l <= 3).sort()
  return out.length ? out : [2]
}

export class ContentFeed {
  constructor(mode, { load = loadBank } = {}) {
    this.mode = mode // 'words' | 'mime' | 'pairs'
    this.load = load
    this.cfg = null
    this.key = ''
    this.hkey = ''
    this.loaded = false
    this.pool = null // every bank item for this setup; null when there is no bank for it
    this.bankIds = new Set() // every bank item of the topic at any level, so generated words never duplicate one
    this.fresh = [] // bank items not seen yet, in random order
    this.buffer = [] // generated items
    this.seen = new Set()
    this.filling = null
    this.writes = Promise.resolve()
    this.status = { state: 'idle', error: null }
    this.subs = new Set()
  }

  subscribe(fn) {
    this.subs.add(fn)
    fn(this.status, this.size)
    return () => this.subs.delete(fn)
  }

  _emit() {
    for (const fn of this.subs) fn(this.status, this.size)
  }

  _setStatus(patch) {
    this.status = { ...this.status, ...patch }
    this._emit()
  }

  _id(item) {
    return this._histId(this.mode === 'pairs' ? pairKey(item) : item)
  }

  _histId(entry) {
    return this.mode === 'pairs' ? pairId(entry) : String(entry).toLowerCase()
  }

  _entry(item) {
    return this.mode === 'pairs' ? pairKey(item) : item
  }

  get hasKey() {
    return !!this.cfg?.apiKey
  }

  get size() {
    return this.fresh.length + this.buffer.length
  }

  /** True when nothing can be played without an OpenRouter key. */
  get needsKey() {
    return this.loaded && !this.pool && !this.hasKey
  }

  async configure(raw) {
    const language = bankLanguage(raw.language) || raw.language
    const topic = this.mode === 'words' ? raw.topic || 'mixed' : 'mixed'
    const levels = this.mode === 'pairs' ? [] : normLevels(raw.levels)
    const cfg = { ...raw, language, topic, levels }
    const key = ['v3', this.mode, slug(language), slug(topic), levels.join('')].join('|')
    this.cfg = cfg
    if (key !== this.key) {
      this.key = key
      this.loaded = false
      this.hkey = historyKey({ mode: this.mode, language, topic })
      await this.writes
      if (key !== this.key) return
      const [bank, seen, saved] = await Promise.all([
        this.load(this.mode, language),
        seenIds(this.mode, language, (e) => this._histId(e)),
        idbGet('queue', key),
      ])
      if (key !== this.key) return
      const pool = bankPool(this.mode, bank, cfg)
      this.pool = pool?.length ? pool : null
      this.bankIds = new Set((bankPool(this.mode, bank, { ...cfg, levels: [1, 2, 3] }) || []).map((i) => this._id(i)))
      this.seen = seen
      const unseen = new Map()
      for (const i of this.pool || []) if (!seen.has(this._id(i))) unseen.set(this._id(i), i)
      this.fresh = shuffle([...unseen.values()])
      this.buffer = saved?.items || []
      for (const i of this.buffer) this.seen.add(this._id(i))
      this.loaded = true
    }
    if (!this.filling) this._settle()
    this._emit()
  }

  /** Status for when no request is running. */
  _settle() {
    if (this.size) return this._setStatus({ state: 'ready', error: null })
    if (this.hasKey) return this._setStatus({ state: 'idle', error: null })
    if (!this.pool) return this._setStatus({ state: 'no-key', error: null })
    this._setStatus({
      state: 'exhausted',
      error: { kind: 'exhausted', message: 'You have played every word here. Add an OpenRouter key for fresh ones.' },
    })
  }

  async _persist() {
    if (!this.key) return
    await idbPut('queue', { key: this.key, items: this.buffer.slice(0, 120), updated: Date.now() })
  }

  _remember(items) {
    const hkey = this.hkey
    const entries = items.map((i) => this._entry(i))
    this.writes = this.writes.then(() => addToHistory(hkey, entries)).catch(() => {})
    return this.writes
  }

  take() {
    let item = null
    if (this.fresh.length) {
      item = this.fresh.pop()
      this.seen.add(this._id(item))
      this._remember([item])
      if (this.mode === 'pairs' && Math.random() < 0.5) item = [item[1], item[0]]
    } else {
      item = this.buffer.shift() ?? null
      if (item) this._persist()
    }
    if (this.size < LOW_WATER) {
      if (this.hasKey) this.fill()
      else this._settle()
    }
    this._emit()
    return item
  }

  /** Take an item, waiting for a batch if nothing is ready. */
  async takeAsync() {
    const item = this.take()
    if (item) return item
    await this.fill()
    return this.take()
  }

  peekAll() {
    return [...this.fresh].reverse().concat(this.buffer)
  }

  /** Resolves once there is something playable, or with the reason there is not. */
  async prime() {
    if (this.size >= LOW_WATER) {
      this.fill()
      return this.status
    }
    await this.fill()
    return this.status
  }

  /** Puts every bank word of this setup back in play. */
  async replay() {
    await this.writes
    const ids = new Set((this.pool || []).map((i) => this._id(i)))
    await forgetIds(this.mode, this.cfg.language, ids, (e) => this._histId(e))
    this.key = ''
    await this.configure(this.cfg)
  }

  fill() {
    if (this.filling) return this.filling
    this.filling = this._fill(this.key).finally(() => {
      this.filling = null
    })
    return this.filling
  }

  async _fill(key) {
    if (!this.cfg || !this.loaded) return
    if (this.fresh.length >= LOW_WATER || this.size >= TARGET) return
    if (!this.hasKey) return this._settle()
    this._setStatus({ state: 'loading', error: null })
    try {
      const history = await this._avoid()
      const opts = {
        apiKey: this.cfg.apiKey,
        model: this.cfg.model,
        effort: this.cfg.effort,
        language: this.cfg.language,
        topic: this.cfg.topic,
        levels: this.cfg.levels,
        history,
      }
      const fresh =
        this.mode === 'pairs'
          ? await generatePairs({ ...opts, count: BATCH_PAIRS })
          : await generateWords({ ...opts, count: BATCH_WORDS, style: this.mode === 'mime' ? 'charades' : 'headsup' })
      const added = await this._append(shuffle(fresh), key)
      // Config changed mid-flight: this batch belongs to nobody, and 'loading' would stick.
      if (added < 0) return this._fill(this.key)
      if (!added && !this.size) {
        this._setStatus({
          state: 'error',
          error: {
            kind: 'exhausted',
            message: 'Everything that came back was a repeat. Try another topic or level.',
          },
        })
        return
      }
      this._setStatus({ state: 'ready', error: null })
    } catch (e) {
      if (e.name === 'AbortError') return
      this._setStatus({
        state: 'error',
        error: {
          kind: e.kind || 'unknown',
          message: e.message || 'Could not reach OpenRouter',
        },
      })
    }
  }

  /** What the model is told to avoid: this setup's bank words when they fit, then recent history. */
  async _avoid() {
    const recent = await recentHistory(this.hkey)
    const bank = this.pool && this.pool.length <= SEND_CAP ? this.pool.map((i) => this._entry(i)) : []
    return [...new Set([...bank, ...recent])].slice(-SEND_CAP)
  }

  /** Returns the number appended, or -1 if the config changed while the request was in flight. */
  async _append(items, key = this.key) {
    if (key !== this.key) return -1
    if (!items?.length) return 0
    const fresh = []
    for (const item of items) {
      const k = this._id(item)
      if (this.seen.has(k) || this.bankIds.has(k)) continue
      this.seen.add(k)
      fresh.push(item)
    }
    if (!fresh.length) return 0
    this.buffer.push(...fresh)
    await this._remember(fresh)
    if (key !== this.key) return -1
    await this._persist()
    this._emit()
    return fresh.length
  }
}

export const wordFeed = new ContentFeed('words')
export const mimeFeed = new ContentFeed('mime')
export const pairFeed = new ContentFeed('pairs')

export function feedConfigFromSettings(s, language, topic) {
  return {
    apiKey: s.apiKey,
    model: s.model,
    effort: s.effort,
    language,
    topic: topic || 'mixed',
    levels: s.levels,
  }
}

export { GenerationError }

// Buffered, self-refilling content feed. Gameplay reads synchronously; refills happen in the background.

import { idbGet, idbPut } from '../core/storage.js'
import { historyKey, recentHistory, addToHistory, loadHistory, slug, pairKey } from './history.js'
import { generateWords, generatePairs, GenerationError } from './openrouter.js'
import { WORD_PACKS } from './packs/words.js'
import { PAIR_PACKS } from './packs/pairs.js'

const LOW_WATER = 14
const TARGET = 34
const BATCH_WORDS = 30
const BATCH_PAIRS = 14

function shuffle(arr, rnd = Math.random) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function packLanguage(language) {
  return language === 'ru' ? 'ru' : 'en'
}

function fallbackWords(language, topic) {
  const lang = WORD_PACKS[packLanguage(language)]
  return lang[slug(topic)] || lang[topic] || lang.mixed
}

function fallbackPairs(language) {
  return PAIR_PACKS[packLanguage(language)] || PAIR_PACKS.en
}

export class ContentFeed {
  constructor(mode) {
    this.mode = mode // 'words' | 'pairs'
    this.cfg = null
    this.key = ''
    this.hkey = ''
    this.buffer = []
    this.pool = null
    this.seen = new Set()
    this.filling = null
    this.status = { state: 'idle', error: null, source: 'pack' }
    this.subs = new Set()
  }

  subscribe(fn) {
    this.subs.add(fn)
    return () => this.subs.delete(fn)
  }

  _emit() {
    for (const fn of this.subs) fn(this.status, this.buffer.length)
  }

  _setStatus(patch) {
    this.status = { ...this.status, ...patch }
    this._emit()
  }

  async configure(cfg) {
    const key = [
      this.mode,
      slug(cfg.language),
      slug(cfg.topic),
      cfg.difficulty,
      this.mode === 'pairs' ? 'p' : cfg.format,
    ].join('|')
    this.cfg = cfg
    const hkey = historyKey({ mode: this.mode, language: cfg.language, topic: cfg.topic })
    if (hkey !== this.hkey) {
      this.hkey = hkey
      this.seen = new Set((await loadHistory(hkey)).map((i) => String(i).toLowerCase()))
    }
    if (key === this.key) return
    this.key = key
    this.buffer = []
    this.pool = null
    const saved = await idbGet('queue', key)
    if (saved?.items?.length) this.buffer = saved.items
    for (const i of this.buffer) this.seen.add(this._id(i))
    this._emit()
  }

  _id(item) {
    return (this.mode === 'pairs' ? pairKey(item) : item).toLowerCase()
  }

  get size() {
    return this.buffer.length
  }

  async _persist() {
    if (!this.key) return
    await idbPut('queue', { key: this.key, items: this.buffer.slice(0, 120), updated: Date.now() })
  }

  take() {
    let item = this.buffer.shift() ?? null
    // A refill in flight must never leave the game with nothing on screen.
    if (item == null) item = this._emergency()
    if (this.buffer.length < LOW_WATER) this.fill()
    this._persist()
    this._emit()
    return item
  }

  _emergency() {
    if (!this.cfg) return null
    if (!this.pool?.length) {
      this.pool = shuffle(
        this.mode === 'pairs'
          ? fallbackPairs(this.cfg.language)
          : fallbackWords(this.cfg.language, this.cfg.topic)
      )
    }
    let item = null
    while (this.pool.length) {
      const candidate = this.pool.pop()
      if (this.seen.has(this._id(candidate))) continue
      item = candidate
      break
    }
    // Everything in the pack has been played: repeat rather than show nothing.
    if (!item) item = shuffle(this.pool.length ? this.pool : [])[0] ?? this._anyFromPack()
    if (item) {
      this.seen.add(this._id(item))
      addToHistory(this.hkey, [this.mode === 'pairs' ? pairKey(item) : item]).catch(() => {})
    }
    return item
  }

  peekAll() {
    return this.buffer.slice()
  }

  /** Block only if we have literally nothing playable. */
  async prime() {
    if (this.buffer.length >= LOW_WATER) {
      this.fill()
      return
    }
    await this.fill()
    if (!this.buffer.length) await this._fillFromPack()
  }

  fill() {
    if (this.filling) return this.filling
    this.filling = this._fill(this.key).finally(() => {
      this.filling = null
    })
    return this.filling
  }

  async _fill(key) {
    if (!this.cfg) return
    if (this.buffer.length >= TARGET) return
    const { apiKey, model } = this.cfg
    if (!apiKey) {
      this._setStatus({ state: 'no-key', error: null })
      await this._fillFromPack(key)
      return
    }
    this._setStatus({ state: 'loading', error: null })
    try {
      const history = await recentHistory(this.hkey)
      const opts = {
        apiKey,
        model,
        language: this.cfg.language,
        topic: this.cfg.topic,
        difficulty: this.cfg.difficulty,
        format: this.cfg.format,
        history,
      }
      const fresh =
        this.mode === 'pairs'
          ? await generatePairs({ ...opts, count: BATCH_PAIRS })
          : await generateWords({ ...opts, count: BATCH_WORDS })
      const added = await this._append(fresh, key)
      if (!added) throw new GenerationError('Model returned nothing new', { kind: 'empty' })
      this._setStatus({ state: 'ready', error: null, source: 'ai' })
    } catch (e) {
      if (e.name === 'AbortError') return
      this._setStatus({
        state: 'error',
        error: { message: e.message || 'Generation failed', kind: e.kind || 'unknown' },
      })
      await this._fillFromPack(key)
    }
  }

  _anyFromPack() {
    const pool =
      this.mode === 'pairs'
        ? fallbackPairs(this.cfg.language)
        : fallbackWords(this.cfg.language, this.cfg.topic)
    return pool[Math.floor(Math.random() * pool.length)] ?? null
  }

  async _append(items, key = this.key) {
    if (!items?.length || key !== this.key) return 0
    const hist = new Set((await recentHistory(this.hkey, 2000)).map((i) => i.toLowerCase()))
    const fresh = []
    for (const item of items) {
      const k = this._id(item)
      if (this.seen.has(k) || hist.has(k)) continue
      this.seen.add(k)
      fresh.push(item)
    }
    if (!fresh.length || key !== this.key) return 0
    this.buffer.push(...fresh)
    await addToHistory(this.hkey, fresh.map((i) => (this.mode === 'pairs' ? pairKey(i) : i)))
    await this._persist()
    this._emit()
    return fresh.length
  }

  async _fillFromPack(key = this.key) {
    const pool =
      this.mode === 'pairs'
        ? fallbackPairs(this.cfg.language)
        : fallbackWords(this.cfg.language, this.cfg.topic)
    const added = await this._append(shuffle(pool).slice(0, TARGET), key)
    if (added) {
      this._setStatus({ source: 'pack' })
      return
    }
    // Pool exhausted against history: replay it rather than leaving the game with nothing.
    if (key !== this.key) return
    const inBuffer = new Set(this.buffer.map((i) => this._id(i)))
    for (const item of shuffle(pool)) {
      const k = this._id(item)
      if (inBuffer.has(k)) continue
      inBuffer.add(k)
      this.seen.add(k)
      this.buffer.push(item)
      if (this.buffer.length >= TARGET) break
    }
    this._setStatus({ source: 'pack' })
    await this._persist()
  }
}

export const wordFeed = new ContentFeed('words')
export const pairFeed = new ContentFeed('pairs')

export function feedConfigFromSettings(s, language, topic) {
  return {
    apiKey: s.apiKey,
    model: s.model,
    language,
    topic: topic || 'mixed',
    difficulty: s.difficulty,
    format: s.format,
  }
}

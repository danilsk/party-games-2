// Buffered content feed. Everything comes from OpenRouter; batches are fetched ahead of demand.

import { idbGet, idbPut } from '../core/storage.js'
import { historyKey, recentHistory, addToHistory, slug, pairKey, SEND_CAP } from './history.js'
import { generatePairs, generateWords, GenerationError } from './openrouter.js'

const LOW_WATER = 14
const TARGET = 34
const BATCH_WORDS = 30
const BATCH_PAIRS = 14

export class ContentFeed {
  constructor(mode) {
    this.mode = mode // 'words' | 'pairs'
    this.cfg = null
    this.key = ''
    this.hkey = ''
    this.buffer = []
    this.seen = new Set()
    this.filling = null
    this.status = { state: 'idle', error: null }
    this.subs = new Set()
  }

  subscribe(fn) {
    this.subs.add(fn)
    fn(this.status, this.buffer.length)
    return () => this.subs.delete(fn)
  }

  _emit() {
    for (const fn of this.subs) fn(this.status, this.buffer.length)
  }

  _setStatus(patch) {
    this.status = { ...this.status, ...patch }
    this._emit()
  }

  _id(item) {
    return (this.mode === 'pairs' ? pairKey(item) : item).toLowerCase()
  }

  get hasKey() {
    return !!this.cfg?.apiKey
  }

  get size() {
    return this.buffer.length
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
      this.seen = new Set((await recentHistory(hkey, SEND_CAP)).map((i) => String(i).toLowerCase()))
    }
    if (!this.cfg.apiKey) this._setStatus({ state: 'no-key', error: null })
    else if (this.status.state === 'no-key') this._setStatus({ state: 'idle', error: null })
    if (key === this.key) return
    this.key = key
    this.buffer = []
    const saved = await idbGet('queue', key)
    if (saved?.items?.length) this.buffer = saved.items
    for (const i of this.buffer) this.seen.add(this._id(i))
    this._emit()
  }

  async _persist() {
    if (!this.key) return
    await idbPut('queue', { key: this.key, items: this.buffer.slice(0, 120), updated: Date.now() })
  }

  take() {
    const item = this.buffer.shift() ?? null
    if (this.buffer.length < LOW_WATER) this.fill()
    this._persist()
    this._emit()
    return item
  }

  /** Take an item, waiting for a batch if the buffer happens to be empty. */
  async takeAsync() {
    const item = this.take()
    if (item) return item
    await this.fill()
    return this.take()
  }

  peekAll() {
    return this.buffer.slice()
  }

  /** Resolves once there is something playable, or with the failure that stopped us. */
  async prime() {
    if (!this.hasKey) {
      this._setStatus({ state: 'no-key', error: null })
      return this.status
    }
    if (this.buffer.length >= LOW_WATER) {
      this.fill()
      return this.status
    }
    await this.fill()
    return this.status
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
    if (!this.cfg.apiKey) {
      this._setStatus({ state: 'no-key', error: null })
      return
    }
    this._setStatus({ state: 'loading', error: null })
    try {
      const history = await recentHistory(this.hkey)
      const opts = {
        apiKey: this.cfg.apiKey,
        model: this.cfg.model,
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
      // Config changed mid-flight: this batch belongs to nobody, and 'loading' would stick.
      if (added < 0) return this._fill(this.key)
      if (!added) {
        this._setStatus({
          state: 'error',
          error: {
            kind: 'exhausted',
            message: 'Everything that came back was a repeat for this topic. Try another topic.',
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

  /** Returns the number appended, or -1 if the config changed while the request was in flight. */
  async _append(items, key = this.key) {
    if (key !== this.key) return -1
    if (!items?.length) return 0
    // Must match the window sent in the prompt: rejecting more than the model was told to
    // avoid drops legitimate items and looks like the model returned nothing.
    const hist = new Set((await recentHistory(this.hkey, SEND_CAP)).map((i) => i.toLowerCase()))
    const fresh = []
    for (const item of items) {
      const k = this._id(item)
      if (this.seen.has(k) || hist.has(k)) continue
      this.seen.add(k)
      fresh.push(item)
    }
    if (key !== this.key) return -1
    if (!fresh.length) return 0
    this.buffer.push(...fresh)
    await addToHistory(this.hkey, fresh.map((i) => (this.mode === 'pairs' ? pairKey(i) : i)))
    await this._persist()
    this._emit()
    return fresh.length
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

export { GenerationError }

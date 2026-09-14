import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ContentFeed } from '../src/content/feed.js'
import {
  historyKey, slug, addToHistory, recentHistory, loadHistory, clearHistory, SEND_CAP,
} from '../src/content/history.js'
import { normalizeItems, normalizePairs } from '../src/content/openrouter.js'
import { buildWordPrompt, buildPairPrompt } from '../src/content/prompts.js'

// Each test gets its own topic: background refills from a previous test must not be able
// to write into the history key the next one reads.
let seq = 0
const freshBase = () => ({
  language: 'en', topic: `t${++seq}`, difficulty: 3, format: 'word', model: 'm', apiKey: 'k',
})
const settle = () => new Promise((r) => setTimeout(r, 0))

/** Stub OpenRouter. `plan` decides what each successive call returns. */
function stubApi(plan) {
  const calls = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    const res = plan(calls.length, body)
    if (res instanceof Error) throw res
    if (res?.httpStatus)
      return { ok: false, status: res.httpStatus, text: async () => JSON.stringify({ error: { message: res.message } }) }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(res) } }] }),
    }
  }
  return calls
}

const words = (n, prefix = 'w') => ({ items: Array.from({ length: n }, (_, i) => `${prefix}${i}`) })

beforeEach(async () => {
  await settle()
  await clearHistory()
})

test('history keys isolate topics, languages and modes', () => {
  const k = (o) => historyKey({ mode: 'words', language: 'en', topic: 'animals', ...o })
  assert.notEqual(k(), k({ topic: 'food' }))
  assert.notEqual(k(), k({ language: 'ru' }))
  assert.notEqual(k(), historyKey({ mode: 'pairs', language: 'en', topic: 'animals' }))
  assert.equal(k(), k())
})

test('prompt-like custom topics get their own isolated history', () => {
  const a = historyKey({ mode: 'words', language: 'en', topic: 'things a 40 year old would know' })
  const b = historyKey({ mode: 'words', language: 'en', topic: 'things a 20 year old would know' })
  assert.notEqual(a, b)
  assert.ok(a.length < 120)
})

test('slug normalizes punctuation and case but keeps unicode', () => {
  assert.equal(slug('  Animals!! '), 'animals')
  assert.equal(slug('Еда и Напитки'), 'еда-и-напитки')
  assert.ok(slug('a'.repeat(300)).length <= 90)
})

test('history accumulates, dedupes and returns the most recent window', async () => {
  const key = 'test|en|hist'
  await addToHistory(key, ['Dog', 'Cat'])
  await addToHistory(key, ['Cat', 'Fox'])
  assert.deepEqual(await loadHistory(key), ['Dog', 'Cat', 'Fox'])
  await addToHistory(key, Array.from({ length: 700 }, (_, i) => `w${i}`))
  const recent = await recentHistory(key)
  assert.equal(recent.length, SEND_CAP)
  assert.equal(recent.at(-1), 'w699')
})

test('without a key the feed reports no-key and generates nothing', async () => {
  const calls = stubApi(() => words(30))
  const feed = new ContentFeed('words')
  await feed.configure({ ...freshBase(), apiKey: '' })
  const status = await feed.prime()
  assert.equal(status.state, 'no-key')
  assert.equal(feed.size, 0)
  assert.equal(feed.take(), null)
  assert.equal(calls.length, 0, 'must not call the API without a key')
})

test('with a key the feed fills and serves items', async () => {
  stubApi(() => words(30))
  const feed = new ContentFeed('words')
  await feed.configure({ ...freshBase() })
  await feed.prime()
  assert.equal(feed.status.state, 'ready')
  assert.equal(feed.size, 30)
  assert.equal(feed.take(), 'w0')
})

test('the prompt carries the recent history so the model can avoid it', async () => {
  const calls = stubApi((n) => words(30, `batch${n}-`))
  const feed = new ContentFeed('words')
  await feed.configure({ ...freshBase() })
  await feed.prime()
  while (feed.size > 12) feed.take()
  await feed.fill()
  assert.ok(calls.length >= 2, 'refilled')
  const second = calls[1].messages[1].content
  assert.match(second, /do NOT repeat/)
  assert.match(second, /batch1-0/, 'first batch was sent as history')
})

test('dedup window matches the window sent to the model', async () => {
  // History older than SEND_CAP is not sent, so items matching it must not be dropped.
  const cfg = freshBase()
  const key = historyKey({ mode: 'words', language: 'en', topic: cfg.topic })
  await addToHistory(key, ['ancient', ...Array.from({ length: SEND_CAP }, (_, i) => `recent${i}`)])
  stubApi(() => ({ items: ['ancient', 'brandnew'] }))
  const feed = new ContentFeed('words')
  await feed.configure(cfg)
  await feed.prime()
  assert.deepEqual(feed.peekAll(), ['ancient', 'brandnew'], 'items outside the sent window are kept')
  assert.notEqual(feed.status.state, 'error')
})

test('items the model was told to avoid are still filtered out', async () => {
  const cfg = freshBase()
  const key = historyKey({ mode: 'words', language: 'en', topic: cfg.topic })
  await addToHistory(key, ['Dog'])
  stubApi(() => ({ items: ['Dog', 'dog', 'Fox'] }))
  const feed = new ContentFeed('words')
  await feed.configure(cfg)
  await feed.prime()
  assert.deepEqual(feed.peekAll(), ['Fox'])
})

test('a wholly repeated batch reports exhaustion, never blames the model wrongly', async () => {
  const cfg = freshBase()
  const key = historyKey({ mode: 'words', language: 'en', topic: cfg.topic })
  await addToHistory(key, ['Dog', 'Cat'])
  stubApi(() => ({ items: ['Dog', 'Cat'] }))
  const feed = new ContentFeed('words')
  await feed.configure(cfg)
  const status = await feed.prime()
  assert.equal(status.state, 'error')
  assert.equal(status.error.kind, 'exhausted')
  assert.match(status.error.message, /repeat/i)
})

test('a config change mid-request discards the stale batch without an error', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  globalThis.fetch = async () => {
    await gate
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(words(30, 'stale')) } }] }) }
  }
  const feed = new ContentFeed('words')
  await feed.configure({ ...freshBase() })
  const inflight = feed.fill()
  await feed.configure({ ...freshBase() })
  release()
  await inflight
  assert.equal(feed.size, 0, 'stale batch must not land in the new topic')
  assert.notEqual(feed.status.state, 'error', 'a stale bail is not a failure')
})

test('network and auth failures surface a useful message', async () => {
  stubApi(() => ({ httpStatus: 401, message: 'No auth credentials found' }))
  const feed = new ContentFeed('words')
  await feed.configure({ ...freshBase() })
  const status = await feed.prime()
  assert.equal(status.state, 'error')
  assert.equal(status.error.kind, 'auth')
  assert.match(status.error.message, /auth/i)
})

test('takeAsync waits for a batch instead of returning nothing', async () => {
  stubApi(() => words(30))
  const feed = new ContentFeed('words')
  await feed.configure({ ...freshBase() })
  assert.equal(feed.size, 0)
  assert.equal(await feed.takeAsync(), 'w0')
})

test('switching topic swaps the buffer and does not leak items across topics', async () => {
  stubApi((n) => words(20, `t${n}-`))
  const feed = new ContentFeed('words')
  await feed.configure({ ...freshBase() })
  await feed.prime()
  const space = new Set(feed.peekAll())
  await feed.configure({ ...freshBase() })
  await feed.prime()
  assert.deepEqual(feed.peekAll().filter((i) => space.has(i)), [])
})

test('pair feed yields distinct related pairs', async () => {
  stubApi(() => ({ pairs: [['Sea', 'Lake'], ['Tea', 'Coffee']] }))
  const feed = new ContentFeed('pairs')
  await feed.configure({ ...freshBase() })
  await feed.prime()
  const p = feed.take()
  assert.ok(Array.isArray(p) && p.length === 2)
  assert.notEqual(p[0].toLowerCase(), p[1].toLowerCase())
})

test('served items are recorded in history for future requests', async () => {
  stubApi(() => words(10, 'rec'))
  const cfg = freshBase()
  const key = historyKey({ mode: 'words', language: 'en', topic: cfg.topic })
  const feed = new ContentFeed('words')
  await feed.configure(cfg)
  await feed.prime()
  assert.deepEqual(await loadHistory(key), feed.peekAll())
})

test('normalizeItems strips fences, numbering, quotes and duplicates', () => {
  const out = normalizeItems({ items: ['1. Dog', '"Cat"', 'cat', '  Fox  ', '', 'x'.repeat(90)] })
  assert.deepEqual(out, ['Dog', 'Cat', 'Fox'])
})

test('normalizePairs accepts arrays and objects, drops degenerate pairs', () => {
  const out = normalizePairs({
    pairs: [['Sea', 'Lake'], { civilian: 'Tea', spy: 'Coffee' }, ['Same', 'same'], ['Only']],
  })
  assert.deepEqual(out, [['Sea', 'Lake'], ['Tea', 'Coffee']])
})

test('prompts embed history, language, difficulty and format rules', () => {
  const { user } = buildWordPrompt({
    count: 20, language: 'ru', topic: 'animals', difficulty: 5, format: 'phrase', history: ['Dog', 'Cat'],
  })
  assert.match(user, /exactly 20/)
  assert.match(user, /Russian/)
  assert.match(user, /Difficulty 5\/5/)
  assert.match(user, /short phrase of 2-4 words/)
  assert.match(user, /do NOT repeat[\s\S]*Dog, Cat/)
  assert.match(user, /\{"items":/)
})

test('pair prompt explains the spy-detectability balance', () => {
  const { user } = buildPairPrompt({ count: 10, language: 'en', topic: 'food', difficulty: 2 })
  assert.match(user, /NOT synonyms/)
  assert.match(user, /\{"pairs":/)
})

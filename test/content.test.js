import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ContentFeed, normLevels } from '../src/content/feed.js'
import { bankLanguage, bankPool } from '../src/content/bank.js'
import {
  historyKey, slug, addToHistory, recentHistory, loadHistory, clearHistory, SEND_CAP,
} from '../src/content/history.js'
import { normalizeItems, normalizePairs } from '../src/content/openrouter.js'
import { buildWordPrompt, buildPairPrompt } from '../src/content/prompts.js'

// Each test gets its own topic: background refills from a previous test must not be able
// to write into the history key the next one reads.
let seq = 0
const freshBase = () => ({
  language: `l${++seq}`, topic: `t${seq}`, levels: [2], model: 'm', apiKey: 'k',
})
const lang = (cfg) => cfg.language

/** A feed whose built-in bank is `bank` (null: no bank), recording which languages were asked for. */
function newFeed(mode, bank = null, asked = []) {
  return new ContentFeed(mode, { load: async (_mode, language) => { asked.push(language); return bank } })
}
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
  const feed = newFeed('words')
  await feed.configure({ ...freshBase(), apiKey: '' })
  const status = await feed.prime()
  assert.equal(status.state, 'no-key')
  assert.equal(feed.size, 0)
  assert.equal(feed.take(), null)
  assert.equal(calls.length, 0, 'must not call the API without a key')
})

test('with a key the feed fills and serves items', async () => {
  stubApi(() => words(30))
  const feed = newFeed('words')
  await feed.configure({ ...freshBase() })
  await feed.prime()
  assert.equal(feed.status.state, 'ready')
  assert.equal(feed.size, 30)
  assert.match(feed.take(), /^w\d+$/)
})

test('the prompt carries the recent history so the model can avoid it', async () => {
  const calls = stubApi((n) => words(30, `batch${n}-`))
  const feed = newFeed('words')
  await feed.configure({ ...freshBase() })
  await feed.prime()
  while (feed.size > 12) feed.take()
  await feed.fill()
  assert.ok(calls.length >= 2, 'refilled')
  const second = calls[1].messages[1].content
  assert.match(second, /do NOT repeat/)
  assert.match(second, /batch1-0/, 'first batch was sent as history')
})

test('generated items seen long ago still count as repeats', async () => {
  const cfg = freshBase()
  const key = historyKey({ mode: 'words', language: lang(cfg), topic: cfg.topic })
  await addToHistory(key, ['ancient', ...Array.from({ length: SEND_CAP }, (_, i) => `recent${i}`)])
  stubApi(() => ({ items: ['ancient', 'brandnew'] }))
  const feed = newFeed('words')
  await feed.configure(cfg)
  await feed.prime()
  assert.deepEqual(feed.peekAll(), ['brandnew'])
  assert.notEqual(feed.status.state, 'error')
})

test('items the model was told to avoid are still filtered out', async () => {
  const cfg = freshBase()
  const key = historyKey({ mode: 'words', language: lang(cfg), topic: cfg.topic })
  await addToHistory(key, ['Dog'])
  stubApi(() => ({ items: ['Dog', 'dog', 'Fox'] }))
  const feed = newFeed('words')
  await feed.configure(cfg)
  await feed.prime()
  assert.deepEqual(feed.peekAll(), ['Fox'])
})

test('a wholly repeated batch reports exhaustion, never blames the model wrongly', async () => {
  const cfg = freshBase()
  const key = historyKey({ mode: 'words', language: lang(cfg), topic: cfg.topic })
  await addToHistory(key, ['Dog', 'Cat'])
  stubApi(() => ({ items: ['Dog', 'Cat'] }))
  const feed = newFeed('words')
  await feed.configure(cfg)
  const status = await feed.prime()
  assert.equal(status.state, 'error')
  assert.equal(status.error.kind, 'exhausted')
  assert.match(status.error.message, /repeat/i)
})

test('a config change mid-request drops the stale batch and refills for the new one', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  let call = 0
  globalThis.fetch = async () => {
    const n = ++call
    if (n === 1) await gate
    const body = JSON.stringify(words(30, n === 1 ? 'stale' : 'fresh'))
    return { ok: true, json: async () => ({ choices: [{ message: { content: body } }] }) }
  }
  const feed = newFeed('words')
  await feed.configure({ ...freshBase() })
  const inflight = feed.fill()
  await feed.configure({ ...freshBase() })
  release()
  await inflight
  assert.ok(feed.peekAll().every((w) => w.startsWith('fresh')), `stale batch landed: ${feed.peekAll()[0]}`)
  assert.equal(feed.size, 30, 'the new config was left with nothing')
  assert.notEqual(feed.status.state, 'error', 'a stale bail is not a failure')
})

test('network and auth failures surface a useful message', async () => {
  stubApi(() => ({ httpStatus: 401, message: 'No auth credentials found' }))
  const feed = newFeed('words')
  await feed.configure({ ...freshBase() })
  const status = await feed.prime()
  assert.equal(status.state, 'error')
  assert.equal(status.error.kind, 'auth')
  assert.match(status.error.message, /auth/i)
})

test('takeAsync waits for a batch instead of returning nothing', async () => {
  stubApi(() => words(30))
  const feed = newFeed('words')
  await feed.configure({ ...freshBase() })
  assert.equal(feed.size, 0)
  assert.match(await feed.takeAsync(), /^w\d+$/)
})

test('switching topic swaps the buffer and does not leak items across topics', async () => {
  stubApi((n) => words(20, `t${n}-`))
  const feed = newFeed('words')
  await feed.configure({ ...freshBase() })
  await feed.prime()
  const space = new Set(feed.peekAll())
  await feed.configure({ ...freshBase() })
  await feed.prime()
  assert.deepEqual(feed.peekAll().filter((i) => space.has(i)), [])
})

test('pair feed yields distinct related pairs', async () => {
  stubApi(() => ({ pairs: [['Sea', 'Lake'], ['Tea', 'Coffee']] }))
  const feed = newFeed('pairs')
  await feed.configure({ ...freshBase() })
  await feed.prime()
  const p = feed.take()
  assert.ok(Array.isArray(p) && p.length === 2)
  assert.notEqual(p[0].toLowerCase(), p[1].toLowerCase())
})

test('served items are recorded in history for future requests', async () => {
  stubApi(() => words(10, 'rec'))
  const cfg = freshBase()
  const key = historyKey({ mode: 'words', language: lang(cfg), topic: cfg.topic })
  const feed = newFeed('words')
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

test('prompts embed history, language and the chosen levels', () => {
  const { user } = buildWordPrompt({ count: 20, language: 'ru', topic: 'animals', levels: [3], history: ['Dog', 'Cat'] })
  assert.match(user, /exactly 20/)
  assert.match(user, /Russian/)
  assert.match(user, /Difficulty: Hard/)
  assert.match(user, /do NOT repeat[\s\S]*Dog, Cat/)
  assert.match(user, /\{"items":/)
  const mixed = buildWordPrompt({ count: 20, language: 'es', topic: 'mixed', levels: [1, 3] }).user
  assert.match(mixed, /Mexico/)
  assert.match(mixed, /mix these levels[\s\S]*- Easy[\s\S]*- Hard/)
  assert.doesNotMatch(mixed, /- Medium/)
})

test('charades prompts have no topic', () => {
  const { user } = buildWordPrompt({ count: 20, language: 'en', topic: 'animals', levels: [2], style: 'charades' })
  assert.doesNotMatch(user, /Topic:/)
  assert.match(user, /act out silently/)
})

test('pair prompt explains the spy-detectability balance and asks for variety', () => {
  const { user } = buildPairPrompt({ count: 10, language: 'en' })
  assert.match(user, /NOT synonyms/)
  assert.match(user, /NOT predictable/)
  assert.match(user, /specific kind of the other/)
  assert.doesNotMatch(user, /Topic:/)
  assert.match(user, /\{"pairs":/)
})

test('charades gets its own prompt and its own memory', async () => {
  const calls = stubApi(() => words(30, 'mime'))
  const cfg = freshBase()
  const feed = newFeed('mime')
  await feed.configure(cfg)
  await feed.prime()
  assert.match(calls[0].messages[0].content, /Charades/)
  assert.match(calls[0].messages[1].content, /act out silently/)
  assert.equal((await loadHistory(historyKey({ mode: 'mime', language: lang(cfg), topic: 'mixed' }))).length, 30)
  assert.equal((await loadHistory(historyKey({ mode: 'words', language: lang(cfg), topic: cfg.topic }))).length, 0)
})

test('a pair seen in either order counts as a repeat', async () => {
  const cfg = freshBase()
  await addToHistory(historyKey({ mode: 'pairs', language: lang(cfg), topic: 'mixed' }), ['Hill|Mountain'])
  stubApi(() => ({ pairs: [['mountain', 'hill'], ['Tea', 'Coffee'], ['coffee', 'tea']] }))
  const feed = newFeed('pairs')
  await feed.configure(cfg)
  await feed.prime()
  const left = feed.peekAll()
  assert.equal(left.length, 1)
  assert.deepEqual(left[0].map((w) => w.toLowerCase()).sort(), ['coffee', 'tea'])
})

test('thinking effort is sent only when set', async () => {
  const calls = stubApi(() => words(30))
  const feed = newFeed('words')
  await feed.configure({ ...freshBase(), effort: 'low' })
  await feed.prime()
  assert.deepEqual(calls[0].reasoning, { effort: 'low' })
  await feed.configure({ ...freshBase() })
  await feed.prime()
  assert.equal(calls[1].reasoning, undefined)
})

/* ------------------------------ built-in banks ----------------------------- */

const wordBank = {
  topics: {
    animals: [['Cat', 'Dog', 'Axolotl'], ['Giraffe'], ['Platypus']],
    food: [['Bread'], ['Sushi', 'Kvass'], []],
  },
  general: { animals: [2, 1, 1], food: [1, 1, 0] },
}

test('bank words are served without a key, never repeat, and are remembered', async () => {
  const calls = stubApi(() => words(30))
  const cfg = { ...freshBase(), apiKey: '', topic: 'animals', levels: [1] }
  const feed = newFeed('words', wordBank)
  await feed.configure(cfg)
  assert.equal(feed.needsKey, false)
  const got = [feed.take(), feed.take(), feed.take()]
  assert.deepEqual([...got].sort(), ['Axolotl', 'Cat', 'Dog'])
  assert.equal(feed.take(), null)
  assert.equal(feed.status.state, 'exhausted')
  assert.equal(calls.length, 0)
  await feed.writes
  assert.deepEqual((await loadHistory(historyKey({ mode: 'words', language: lang(cfg), topic: 'animals' }))).sort(), got.sort())
})

test('mixed draws only common-knowledge words from every topic, for the chosen levels', () => {
  const pool = bankPool('words', wordBank, { topic: 'mixed', levels: [1, 2] })
  assert.deepEqual(pool.sort(), ['Bread', 'Cat', 'Dog', 'Giraffe', 'Sushi'])
  assert.deepEqual(bankPool('words', wordBank, { topic: 'food', levels: [2] }), ['Sushi', 'Kvass'])
  assert.equal(bankPool('words', wordBank, { topic: 'my own topic', levels: [2] }), null)
  assert.deepEqual(bankPool('mime', [['a'], ['b'], ['c']], { levels: [1, 3] }), ['a', 'c'])
})

test('a level with no built-in words is treated like no bank at all', async () => {
  const feed = newFeed('words', wordBank)
  await feed.configure({ ...freshBase(), apiKey: '', topic: 'food', levels: [3] })
  assert.equal(feed.needsKey, true)
  assert.equal(feed.status.state, 'no-key')
})

test('a word seen under one topic is not dealt again under another', async () => {
  const cfg = { ...freshBase(), apiKey: '', levels: [1] }
  await addToHistory(historyKey({ mode: 'words', language: lang(cfg), topic: 'animals' }), ['cat'])
  const feed = newFeed('words', wordBank)
  await feed.configure({ ...cfg, topic: 'mixed' })
  assert.deepEqual(feed.peekAll().sort(), ['Bread', 'Dog'])
})

test('levels are combined, and an empty choice falls back to medium', async () => {
  assert.deepEqual(normLevels([3, 1, 3]), [1, 3])
  assert.deepEqual(normLevels([]), [2])
  const feed = newFeed('mime', [['e1', 'e2'], ['m1'], ['h1', 'h2']])
  await feed.configure({ ...freshBase(), apiKey: '', levels: [3, 2] })
  assert.deepEqual(feed.peekAll().sort(), ['h1', 'h2', 'm1'])
})

test('when the bank runs dry, a key switches to generated words that avoid the bank', async () => {
  const calls = stubApi(() => ({ items: ['Giraffe', 'Cat', 'Zebra'] }))
  const feed = newFeed('words', wordBank)
  await feed.configure({ ...freshBase(), topic: 'animals', levels: [2] })
  assert.equal(await feed.takeAsync(), 'Giraffe')
  assert.equal(await feed.takeAsync(), 'Zebra')
  assert.match(calls[0].messages[1].content, /do NOT repeat[\s\S]*Giraffe/)
})

test('a used-up bank can be played again', async () => {
  stubApi(() => words(30))
  const feed = newFeed('mime', [['a', 'b'], [], []])
  await feed.configure({ ...freshBase(), apiKey: '', levels: [1] })
  feed.take(); feed.take()
  assert.equal((await feed.prime()).state, 'exhausted')
  await feed.replay()
  assert.equal(feed.size, 2)
  assert.equal(feed.status.state, 'ready')
})

test('a setup the bank does not cover needs a key; typed language names find the bank', async () => {
  const asked = []
  const feed = newFeed('words', wordBank, asked)
  await feed.configure({ ...freshBase(), apiKey: '', language: 'Spanish', topic: 'something of my own' })
  assert.equal(feed.needsKey, true)
  assert.equal(feed.status.state, 'no-key')
  assert.deepEqual(asked, ['es'])
  await feed.configure({ ...freshBase(), language: 'Spanish', topic: 'something of my own' })
  assert.equal(feed.needsKey, false)
  assert.equal(bankLanguage(' Español '), 'es')
  assert.equal(bankLanguage('Polish'), null)
})

test('bank pairs are dealt in either order', async () => {
  const bank = Array.from({ length: 40 }, (_, i) => [`a${i}`, `b${i}`])
  const feed = newFeed('pairs', bank)
  await feed.configure({ ...freshBase(), apiKey: '' })
  const flipped = Array.from({ length: 40 }, () => feed.take()).filter((p) => p[0].startsWith('b')).length
  assert.ok(flipped > 0 && flipped < 40, `flipped ${flipped} of 40`)
})

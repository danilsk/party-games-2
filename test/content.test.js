import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContentFeed } from '../src/content/feed.js'
import { historyKey, slug, addToHistory, recentHistory, loadHistory, clearHistory, SEND_CAP } from '../src/content/history.js'
import { normalizeItems, normalizePairs } from '../src/content/openrouter.js'
import { buildWordPrompt, buildPairPrompt } from '../src/content/prompts.js'
import { WORD_PACKS } from '../src/content/packs/words.js'

const base = { language: 'en', topic: 'animals', difficulty: 3, format: 'word', model: 'm', apiKey: '' }

test('history keys isolate topics, languages and modes', () => {
  const k = (o) => historyKey({ mode: 'words', language: 'en', topic: 'animals', ...o })
  assert.notEqual(k(), k({ topic: 'food' }))
  assert.notEqual(k(), k({ language: 'ru' }))
  assert.notEqual(k(), historyKey({ mode: 'pairs', language: 'en', topic: 'animals' }))
  assert.equal(k(), k())
})

test('history key ignores difficulty and format so they never resurrect old words', () => {
  const a = historyKey({ mode: 'words', language: 'en', topic: 'animals' })
  const b = historyKey({ mode: 'words', language: 'en', topic: 'animals' })
  assert.equal(a, b)
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
  assert.equal(slug('a'.repeat(300)).length <= 90, true)
})

test('history accumulates, dedupes and returns the most recent window', async () => {
  const key = 'test|en|hist'
  await clearHistory(key)
  await addToHistory(key, ['Dog', 'Cat'])
  await addToHistory(key, ['Cat', 'Fox'])
  assert.deepEqual(await loadHistory(key), ['Dog', 'Cat', 'Fox'])
  await addToHistory(key, Array.from({ length: 700 }, (_, i) => `w${i}`))
  const recent = await recentHistory(key)
  assert.equal(recent.length, SEND_CAP)
  assert.equal(recent.at(-1), 'w699')
})

test('feed serves items and never repeats within a session', async () => {
  const feed = new ContentFeed('words')
  await clearHistory(historyKey({ mode: 'words', language: 'en', topic: 'animals' }))
  await feed.configure({ ...base })
  await feed.prime()
  assert.ok(feed.size > 0, 'primes from the bundled pack without a key')
  const seen = new Set()
  for (let i = 0; i < 40; i++) {
    const item = feed.take()
    if (!item) break
    assert.ok(!seen.has(item.toLowerCase()), `repeat: ${item}`)
    seen.add(item.toLowerCase())
    await new Promise((r) => setTimeout(r, 0))
  }
  assert.ok(seen.size >= 40, `served ${seen.size}`)
})

test('feed refills automatically before running dry', async () => {
  const feed = new ContentFeed('words')
  await feed.configure({ ...base, topic: 'space' })
  await feed.prime()
  const start = feed.size
  for (let i = 0; i < start - 2; i++) feed.take()
  await new Promise((r) => setTimeout(r, 30))
  assert.ok(feed.size > 5, `refilled to ${feed.size}`)
})

test('items served are recorded in history for future requests', async () => {
  const key = historyKey({ mode: 'words', language: 'en', topic: 'sports' })
  await clearHistory(key)
  const feed = new ContentFeed('words')
  await feed.configure({ ...base, topic: 'sports' })
  await feed.prime()
  const hist = await loadHistory(key)
  assert.ok(hist.length >= feed.size, `history ${hist.length} covers buffer ${feed.size}`)
})

test('switching topic swaps the buffer and does not leak items across topics', async () => {
  const feed = new ContentFeed('words')
  await feed.configure({ ...base, topic: 'space' })
  await feed.prime()
  const space = new Set(feed.peekAll())
  await feed.configure({ ...base, topic: 'food-drink' })
  await feed.prime()
  const food = feed.peekAll()
  const leaked = food.filter((i) => space.has(i))
  assert.deepEqual(leaked, [], `leaked ${leaked}`)
  assert.ok(food.every((i) => WORD_PACKS.en['food-drink'].includes(i)))
})

test('exhausting a pack replays it rather than leaving the game empty', async () => {
  const key = historyKey({ mode: 'words', language: 'en', topic: 'space' })
  await clearHistory(key)
  await addToHistory(key, WORD_PACKS.en.space)
  const feed = new ContentFeed('words')
  await feed.configure({ ...base, topic: 'space' })
  await feed.prime()
  assert.ok(feed.size > 0, 'still playable when the pack is used up')
})

test('pair feed yields distinct related pairs', async () => {
  const feed = new ContentFeed('pairs')
  await feed.configure({ ...base, topic: 'mixed' })
  await feed.prime()
  const p = feed.take()
  assert.ok(Array.isArray(p) && p.length === 2)
  assert.notEqual(p[0].toLowerCase(), p[1].toLowerCase())
})

test('russian feed serves russian content', async () => {
  const feed = new ContentFeed('words')
  await feed.configure({ ...base, language: 'ru', topic: 'animals' })
  await feed.prime()
  assert.ok(feed.peekAll().every((i) => /[а-яё]/i.test(i)), 'all cyrillic')
})

test('unknown topic falls back to the mixed pack', async () => {
  const feed = new ContentFeed('words')
  await feed.configure({ ...base, topic: 'a completely made up prompt topic' })
  await feed.prime()
  assert.ok(feed.size > 0)
  assert.ok(feed.peekAll().every((i) => WORD_PACKS.en.mixed.includes(i)))
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

test('take() never returns null while a refill is in flight', async () => {
  const feed = new ContentFeed('words')
  await feed.configure({ ...base, topic: 'space' })
  await feed.prime()
  feed.fill = () => Promise.resolve() // simulate a slow/blocked network refill
  const out = []
  for (let i = 0; i < 200; i++) out.push(feed.take())
  assert.ok(out.every((x) => typeof x === 'string' && x.length), `${out.filter((x) => !x).length} empty draws`)
})

test('pair feed also survives a drained buffer', async () => {
  const feed = new ContentFeed('pairs')
  await feed.configure({ ...base, topic: 'mixed' })
  await feed.prime()
  feed.fill = () => Promise.resolve()
  for (let i = 0; i < 120; i++) {
    const p = feed.take()
    assert.ok(Array.isArray(p) && p.length === 2, `bad pair at ${i}: ${JSON.stringify(p)}`)
  }
})

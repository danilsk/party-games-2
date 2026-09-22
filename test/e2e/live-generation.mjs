// Opt-in live check against OpenRouter. Needs OPENROUTER_API_KEY_GENERAL in the environment.
import { chromium } from 'playwright'
import { serve } from './server.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXE =
  process.env.PW_CHROME ||
  '/Users/dan/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const KEY = process.env.OPENROUTER_API_KEY_GENERAL
if (!KEY) {
  console.log('OPENROUTER_API_KEY_GENERAL not set — skipping live generation check')
  process.exit(0)
}

const BASE = '/party-games-2/'
const { server, port } = await serve(join(HERE, '..', '..', 'dist'), BASE)
const URL_ = `http://localhost:${port}${BASE}`
const browser = await chromium.launch({ executablePath: EXE })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).split('\n')[0]))

let fail = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? '✔' : '✖'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!ok) fail++
}

await page.addInitScript((key) => {
  localStorage.setItem(
    'pg2:settings',
    JSON.stringify({ apiKey: key, model: 'openai/gpt-6-luna', language: 'en', difficulty: 2, format: 'word', topic: 'space', sound: false, haptics: false })
  )
}, KEY)
await page.goto(URL_, { waitUntil: 'networkidle' })
// Start from a clean slate so the run is reproducible.
await page.evaluate(async () => {
  await new Promise((res) => {
    const r = indexedDB.deleteDatabase('party-games')
    r.onsuccess = r.onerror = r.onblocked = () => res()
  })
})
await page.reload({ waitUntil: 'networkidle' })

const run = (fn, arg) => page.evaluate(fn, arg)

console.log('\nLive OpenRouter generation\n')

// Drive the real UI rather than poking at internals.
await page.goto(`${URL_}#/g/charades`, { waitUntil: 'networkidle' })
await page.waitForSelector('.feed-status', { timeout: 5000 })
await page.waitForFunction(
  () => /\d+ ready/.test(document.querySelector('.feed-status')?.textContent || ''),
  { timeout: 45000 }
).catch(() => {})

const statusText = await page.textContent('.feed-status')
check('feed reports generated content ready', /\d+ ready/.test(statusText), statusText.trim())

await page.click('text=Start')
await page.waitForSelector('.ch-word', { timeout: 15000 })

const words = []
for (let i = 0; i < 12; i++) {
  await page.waitForSelector('.ch-word', { timeout: 15000 })
  words.push((await page.textContent('.ch-word')).trim())
  await page.click('.ch-next')
  await new Promise((r) => setTimeout(r, 250))
}
check('served a full round of words', words.length === 12 && words.every(Boolean))
check('no repeats within the session', new Set(words.map((w) => w.toLowerCase())).size === words.length, words.join(', '))
check('single-word format respected', words.every((w) => !w.includes(' ')), words.filter((w) => w.includes(' ')).join(', '))

const history = await run(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('party-games', 1)
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
  const all = await new Promise((res) => {
    const t = db.transaction('history', 'readonly').objectStore('history').getAll()
    t.onsuccess = () => res(t.result)
  })
  return all.map((r) => ({ key: r.key, n: r.items.length, sample: r.items.slice(0, 3) }))
})
check('history is persisted per topic in IndexedDB', history.length > 0, JSON.stringify(history))
const spaceRow = history.find((r) => r.key.includes('space'))
check('the played topic accumulated history', !!spaceRow && spaceRow.n >= 12, spaceRow ? `${spaceRow.n} items` : 'missing')

// Sustained play must cross batch boundaries without ever stalling.
for (let i = 0; i < 20; i++) {
  const prev = words.at(-1)
  await page.waitForFunction(
    (p) => {
      const el = document.querySelector('.ch-word')
      return el && el.textContent.trim() && el.textContent.trim() !== p
    },
    prev,
    { timeout: 30000 }
  )
  words.push((await page.textContent('.ch-word')).trim())
  await page.click('.ch-next')
}
const dupes = words
  .map((w, i) => ({ w, i, first: words.findIndex((x) => x.toLowerCase() === w.toLowerCase()) }))
  .filter((d) => d.first !== d.i)
check(
  'still no repeats after a refill crosses a batch boundary',
  dupes.length === 0,
  dupes.map((d) => `"${d.w}" at #${d.i} (first seen #${d.first}); total=${words.length}`).join(', ')
)

// Isolation: a different topic must not inherit the first topic's history.
const keys = await run(async () => {
  const db = await new Promise((res) => {
    const r = indexedDB.open('party-games', 1)
    r.onsuccess = () => res(r.result)
  })
  return new Promise((res) => {
    const t = db.transaction('history', 'readonly').objectStore('history').getAllKeys()
    t.onsuccess = () => res(t.result)
  })
})
check('history keys are namespaced by mode/language/topic', keys.every((k) => k.split('|').length === 3), keys.join(' '))

console.log(`\n${fail ? `${fail} failed` : 'all live checks passed'}\n`)
await browser.close()
server.close()
process.exit(fail ? 1 : 0)

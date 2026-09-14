import { chromium, webkit } from 'playwright'
import { serve } from './server.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENGINE = process.env.PW_BROWSER === 'webkit' ? 'webkit' : 'chromium'
const EXE =
  ENGINE === 'webkit'
    ? process.env.PW_WEBKIT || '/Users/dan/Library/Caches/ms-playwright/webkit-2359/pw_run.sh'
    : process.env.PW_CHROME ||
      '/Users/dan/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
const BASE = '/party-games-2/'
const DRIVER = readFileSync(join(HERE, 'tilt-driver.js'), 'utf8')

let pass = 0
let fail = 0
const results = []
async function section(name, fn) {
  try {
    await fn()
  } catch (e) {
    fail++
    results.push(`  ✖ [${name} setup] ${String(e.message).split('\n')[0]}`)
  }
}
let skipped = 0
async function skip(name) {
  skipped++
  results.push(`  – ${name} (not supported on ${ENGINE})`)
}
async function check(name, fn) {
  try {
    await fn()
    pass++
    results.push(`  ✔ ${name}`)
  } catch (e) {
    fail++
    results.push(`  ✖ ${name}\n      ${String(e.message).split('\n')[0]}`)
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const score = async (page) => Number((await page.textContent('.hu-score')).replace(/\D/g, ''))

const { server, port } = await serve(join(HERE, '..', '..', 'dist'), BASE)
const ORIGIN = `http://localhost:${port}`
const URL_ = `${ORIGIN}${BASE}`
const browser = await (ENGINE === 'webkit' ? webkit : chromium).launch({ executablePath: EXE })

async function newPage({ motion = false, offline = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  const requests = []
  page.on('requestfailed', (r) => requests.push(`${r.url()} ${r.failure()?.errorText}`))
  if (motion) await page.addInitScript(DRIVER)
  if (offline) await ctx.setOffline(true)
  page.__errors = errors
  page.__failed = requests
  page.__ctx = ctx
  return page
}

console.log(`\nServing dist at ${URL_}  [${ENGINE}]\n`)

/* ------------------------------- app shell -------------------------------- */
await section('app shell', async () => {
  const page = await newPage()
  const urls = []
  page.on('request', (r) => urls.push(r.url()))
  await page.goto(URL_, { waitUntil: 'networkidle' })

  await check('home renders all three games', async () => {
    const names = await page.$$eval('.game-card .name', (els) => els.map((e) => e.textContent))
    assert(names.join(',') === 'Heads Up,Charades,Undercover', `got ${names}`)
  })
  await check('no page errors or failed requests on load', async () => {
    assert(page.__errors.length === 0, page.__errors.join('; '))
    assert(page.__failed.length === 0, page.__failed.join('; '))
  })
  await check('every asset resolves under the GitHub Pages base path', async () => {
    const offBase = urls.filter((u) => u.startsWith(ORIGIN) && !u.startsWith(URL_))
    assert(offBase.length === 0, `off-base: ${offBase.join(', ')}`)
  })
  await check('built HTML references no path that skips the base', async () => {
    const html = await page.content()
    const bad = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)]
      .map((m) => m[1])
      .filter((p) => !p.startsWith(BASE))
    assert(bad.length === 0, `missing base: ${bad.join(', ')}`)
  })
  await check('manifest and all icons are reachable', async () => {
    const man = await page.evaluate(async (b) => {
      const r = await fetch(b + 'manifest.webmanifest')
      return { ok: r.ok, json: await r.json() }
    }, URL_)
    assert(man.ok, 'manifest 404')
    assert(man.json.display === 'standalone', 'not standalone')
    assert(man.json.start_url === './', 'start_url should be relative')
    for (const icon of man.json.icons) {
      const st = await page.evaluate(
        async ([b, s]) => (await fetch(new URL(s, b + 'manifest.webmanifest'))).status,
        [URL_, icon.src]
      )
      assert(st === 200, `${icon.src} -> ${st}`)
    }
    assert(man.json.icons.some((i) => i.purpose === 'maskable'), 'no maskable icon')
  })
  await check('deep links into a game work on a cold load', async () => {
    const p2 = await newPage()
    await p2.goto(`${URL_}#/g/undercover`, { waitUntil: 'networkidle' })
    await p2.waitForSelector('.uc-count', { timeout: 5000 })
    assert((await p2.textContent('.topbar h2')).includes('Undercover'))
    await p2.__ctx.close()
  })
  await check('an unknown route falls back to home', async () => {
    await page.goto(`${URL_}#/nope/nope`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.game-card', { timeout: 5000 })
  })
  await page.__ctx.close()
})

/* -------------------------------- charades -------------------------------- */
await section('charades', async () => {
  const page = await newPage()
  await page.goto(`${URL_}#/g/charades`, { waitUntil: 'networkidle' })
  await page.click('text=Start')
  await page.waitForSelector('.ch-word', { timeout: 5000 })

  let firstWord = ''
  await check('charades shows the word immediately on Next', async () => {
    firstWord = (await page.textContent('.ch-word')).trim()
    assert(firstWord.length > 0, 'no word')
  })
  await check('the word auto-hides after about two seconds', async () => {
    await sleep(900)
    assert(await page.$('.ch-word'), 'hidden too early (before 0.9s)')
    await page.waitForSelector('.ch-hidden', { timeout: 2500 })
    assert(!(await page.$('.ch-word')), 'word still visible')
  })
  await check('press-and-hold reveals it again and release hides it', async () => {
    const box = await (await page.$('.ch-card')).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForSelector('.ch-word', { timeout: 2000 })
    assert((await page.textContent('.ch-word')).trim() === firstWord, 'different word on peek')
    await sleep(600)
    assert(await page.$('.ch-word'), 'word vanished while still held')
    await page.mouse.up()
    await page.waitForSelector('.ch-hidden', { timeout: 2000 })
  })
  await check('Next advances to a different word', async () => {
    await page.click('.ch-next')
    await page.waitForSelector('.ch-word', { timeout: 3000 })
    const second = (await page.textContent('.ch-word')).trim()
    assert(second !== firstWord, `repeated "${second}"`)
    assert((await page.textContent('.ch-count')).startsWith('2'), 'counter did not advance')
  })
  await check('charades produced no errors', async () => {
    assert(page.__errors.length === 0, page.__errors.join('; '))
  })
  await page.__ctx.close()
})

/* ------------------------------- undercover ------------------------------- */
await section('undercover', async () => {
  const page = await newPage()
  await page.goto(`${URL_}#/g/undercover`, { waitUntil: 'networkidle' })

  await check('defaults to four players and can change the count', async () => {
    assert((await page.textContent('.uc-count .n')) === '4', 'default not 4')
    await page.click('button[aria-label="Fewer players"]')
    assert((await page.textContent('.uc-count .n')) === '4', 'went below the minimum')
    await page.click('button[aria-label="More players"]')
    assert((await page.textContent('.uc-count .n')) === '5')
    assert((await page.$$('.uc-names input')).length === 5)
  })
  await check('player names are editable', async () => {
    await page.fill('.uc-names input >> nth=0', 'Dan')
    assert((await page.inputValue('.uc-names input >> nth=0')) === 'Dan')
  })

  await page.click('text=Deal words')
  await page.waitForSelector('.uc-player', { timeout: 5000 })

  const holdReveal = async (i) => {
    const el = await page.$(`.uc-player >> nth=${i}`)
    const box = await el.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForSelector('.uc-secret', { timeout: 4000 })
    const word = (await page.textContent('.uc-secret .word')).trim()
    await page.mouse.up()
    await page.waitForSelector('.uc-secret', { state: 'detached', timeout: 3000 })
    return word
  }

  let words = []
  await check('a quick tap does not leak the secret word', async () => {
    await page.click('.uc-player >> nth=0', { delay: 120 })
    await sleep(250)
    assert(!(await page.$('.uc-secret')), 'word revealed by a tap')
  })
  await check('holding a card reveals that player word, hidden again on release', async () => {
    for (let i = 0; i < 5; i++) words.push(await holdReveal(i))
    assert(words.every(Boolean), 'a word failed to show')
    assert(!(await page.$('.uc-secret')), 'secret overlay stuck open')
  })
  await check('exactly one player holds the odd word', async () => {
    const counts = {}
    for (const w of words) counts[w] = (counts[w] || 0) + 1
    const vals = Object.values(counts).sort((a, b) => b - a)
    assert(vals.length === 2 && vals[0] === 4 && vals[1] === 1, `distribution ${JSON.stringify(counts)}`)
  })
  await check('the discussion phase unlocks after everyone has looked', async () => {
    await page.waitForSelector('text=Spy comes forward', { timeout: 3000 })
    assert((await page.textContent('.tiny.dim.center')).includes('5 still in'))
  })
  await check('eliminating a player runs the confirm flow', async () => {
    await page.click('.uc-player >> nth=0')
    await page.waitForSelector('.sheet', { timeout: 3000 })
    await page.click('.sheet .btn-danger')
    await sleep(400)
    const outOrEnded = (await page.$('.uc-player.out')) || (await page.$('.uc-verdict')) || (await page.$('input[aria-label="Spy guess"]'))
    assert(outOrEnded, 'nothing happened on elimination')
  })
  await check('the spy can come forward and the game reaches a verdict', async () => {
    const p2 = await newPage()
    await p2.goto(`${URL_}#/g/undercover`, { waitUntil: 'networkidle' })
    await p2.click('text=Deal words')
    await p2.waitForSelector('.uc-player', { timeout: 5000 })
    const n = (await p2.$$('.uc-player')).length
    for (let i = 0; i < n; i++) {
      const box = await (await p2.$(`.uc-player >> nth=${i}`)).boundingBox()
      await p2.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await p2.mouse.down()
      await p2.waitForSelector('.uc-secret', { timeout: 4000 })
      await p2.mouse.up()
      await p2.waitForSelector('.uc-secret', { state: 'detached', timeout: 3000 })
    }
    await p2.click('text=Spy comes forward')
    await p2.click('text=I am the spy')
    await p2.waitForSelector('input[aria-label="Spy guess"]', { timeout: 4000 })
    await p2.fill('input[aria-label="Spy guess"]', 'definitely not the word')
    await p2.click('text=Lock in guess')
    await p2.waitForSelector('.uc-verdict', { timeout: 4000 })
    const verdict = await p2.textContent('.uc-verdict .big')
    assert(verdict.includes('Civilians win'), `got "${verdict}"`)
    assert((await p2.$$('.uc-words .w')).length === 2, 'both words not shown')
    await p2.__ctx.close()
  })
  await check('undercover produced no errors', async () => {
    assert(page.__errors.length === 0, page.__errors.join('; '))
  })
  await page.__ctx.close()
})

/* --------------------------- heads up: fallback --------------------------- */
await section('headsup fallback', async () => {
  const page = await newPage()
  await page.goto(`${URL_}#/g/headsup`, { waitUntil: 'networkidle' })
  await page.click('text=Start round')
  await page.waitForSelector('.hu-stage', { timeout: 8000 })

  await check('falls back to on-screen buttons with no motion sensors', async () => {
    await page.waitForSelector('.hu-fallback', { timeout: 4000 })
    assert((await page.textContent('.hu-overlay h2')).match(/No motion sensors|denied/), 'no explanation shown')
  })
  await check('the fallback buttons score and advance words', async () => {
    await page.click('.hu-overlay button')
    await page.waitForSelector('.hu-word span', { timeout: 8000 })
    const w1 = await page.textContent('.hu-word span')
    await page.click('.hu-fallback .ok')
    await sleep(250)
    assert((await score(page)) === 1, 'score did not go up')
    const w2 = await page.textContent('.hu-word span')
    assert(w1 !== w2, 'word did not change')
    await page.click('.hu-fallback .no')
    await sleep(250)
    assert((await score(page)) === 1, 'skip should not score')
  })
  await check('ending the round shows results', async () => {
    await page.click('button[aria-label="End round"]')
    await page.waitForSelector('.big-score', { timeout: 4000 })
    assert((await page.textContent('.big-score')) === '1')
    assert((await page.$$('.result-row')).length === 2, 'both words should be listed')
  })
  await page.__ctx.close()
})

/* ------------------------ heads up: real motion path ---------------------- */
await section('headsup motion', async () => {
  const page = await newPage({ motion: true })
  await page.goto(`${URL_}#/g/headsup`, { waitUntil: 'networkidle' })
  await check('the injected sensor stream is actually reaching the page', async () => {
    await sleep(300)
    assert((await page.evaluate(() => window.__tilt.count)) > 5, 'no motion events dispatched')
  })

  await page.click('text=Start round')
  await page.waitForSelector('.hu-stage', { timeout: 8000 })

  const setPitch = (p) => page.evaluate((v) => { window.__tilt.pitch = v }, p)
  const ramp = async (from, to, ms = 220) => {
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      await setPitch(from + ((to - from) * i) / steps)
      await sleep(ms / steps)
    }
  }

  await check('prompts for a horizontal hold and calibrates', async () => {
    await page.waitForFunction(
      () => document.querySelector('.hu-overlay h2')?.textContent?.includes('Tilt forward'),
      { timeout: 6000 }
    )
  })
  await check('a sustained forward tilt arms and starts the round', async () => {
    await ramp(-8, -60, 260)
    await sleep(550)
    await page.waitForSelector('.hu-countdown', { timeout: 4000 })
    await ramp(-60, -8, 200)
    await page.waitForSelector('.hu-word span', { timeout: 8000 })
  })
  await check('tilting forward scores and tilting back skips', async () => {
    await sleep(400)
    const w1 = await page.textContent('.hu-word span')
    await ramp(-8, -62, 200)
    await sleep(220)
    await ramp(-62, -8, 200)
    await sleep(300)
    assert((await score(page)) === 1, `score ${await page.textContent('.hu-score')}`)
    assert((await page.textContent('.hu-word span')) !== w1, 'word did not advance')

    await ramp(-8, 46, 200)
    await sleep(220)
    await ramp(46, -8, 200)
    await sleep(300)
    assert((await score(page)) === 1, 'skip must not score')
  })
  await check('shaking the phone does not score anything', async () => {
    const before = await score(page)
    for (let i = 0; i < 24; i++) {
      await setPitch(-8 + (i % 2 ? 22 : -22))
      await sleep(60)
    }
    await setPitch(-8)
    await sleep(400)
    assert((await score(page)) === before, 'shaking scored')
  })
  await check('turning the phone upright warns the player', async () => {
    await page.evaluate(() => { window.__tilt.roll = 88 })
    await page.waitForFunction(
      () => document.querySelector('.hu-overlay h2')?.textContent?.includes('horizontal'),
      { timeout: 5000 }
    )
    await page.evaluate(() => { window.__tilt.roll = 0 })
  })
  await check('heads up produced no errors', async () => {
    assert(page.__errors.length === 0, page.__errors.join('; '))
  })
  await page.__ctx.close()
})

/* ------------------------------ pwa / offline ----------------------------- */
await section('pwa offline', async () => {
  const page = await newPage()
  await page.goto(URL_, { waitUntil: 'networkidle' })
  await check('the service worker registers and takes control', async () => {
    const ok = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      return !!reg.active
    })
    assert(ok, 'no active service worker')
  })
  // Playwright's WebKit intercepts navigations ahead of the service worker, so SW offline
  // behaviour cannot be observed there. Chromium emulates it correctly.
  const offlineCheck = ENGINE === 'webkit' ? skip : check
  await offlineCheck('the app shell still loads with the network cut', async () => {
    await sleep(900)
    await page.__ctx.setOffline(true)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.game-card', { timeout: 8000 })
    const names = await page.$$eval('.game-card .name', (e) => e.map((x) => x.textContent))
    assert(names.length === 3, `offline home showed ${names.length} cards`)
  })
  await offlineCheck('a game still plays fully offline', async () => {
    await page.goto(`${URL_}#/g/charades`, { waitUntil: 'domcontentloaded' })
    await page.click('text=Start')
    await page.waitForSelector('.ch-word', { timeout: 8000 })
    const w = (await page.textContent('.ch-word')).trim()
    assert(w.length > 0, 'no offline word')
  })
  await page.__ctx.close()
})

/* -------------------------------- settings -------------------------------- */
await section('settings', async () => {
  const page = await newPage()
  await page.goto(URL_, { waitUntil: 'networkidle' })
  await check('settings persist across a reload', async () => {
    await page.click('button[aria-label="Settings"]')
    await page.waitForSelector('.sheet', { timeout: 3000 })
    await page.fill('input[aria-label="OpenRouter API key"]', 'sk-or-v1-testkey')
    await page.fill('input[aria-label="Model ID"]', 'some/other-model')
    await page.click('.sheet-backdrop')
    await page.reload({ waitUntil: 'networkidle' })
    await page.click('button[aria-label="Settings"]')
    await page.waitForSelector('.sheet', { timeout: 3000 })
    assert((await page.inputValue('input[aria-label="OpenRouter API key"]')) === 'sk-or-v1-testkey')
    assert((await page.inputValue('input[aria-label="Model ID"]')) === 'some/other-model')
  })
  await check('the BYOK warning is shown next to the key field', async () => {
    const txt = await page.textContent('.sheet')
    assert(/readable by anyone/i.test(txt), 'no key-exposure warning')
  })
  await check('topic picker offers presets and a freeform topic', async () => {
    await page.click('.sheet-backdrop')
    await page.goto(`${URL_}#/g/charades`, { waitUntil: 'networkidle' })
    await page.click('.topic-btn')
    await page.waitForSelector('.topic-grid', { timeout: 3000 })
    assert((await page.$$('.topic-tile')).length > 20, 'too few presets')
    await page.fill('input[aria-label="Custom topic"]', 'things only a plumber would know')
    await page.click('text=Use this topic')
    await sleep(300)
    assert((await page.textContent('.topic-btn')).includes('plumber'), 'custom topic not applied')
  })
  await page.__ctx.close()
})

console.log(results.join('\n'))
console.log(`\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''}\n`)
await browser.close()
server.close()
process.exit(fail ? 1 : 0)

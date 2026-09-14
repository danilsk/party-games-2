import { h, clear, toast } from '../../ui/dom.js'
import { back, navigate, interceptBack } from '../../core/router.js'
import { settings, activeTopic, activeLanguage } from '../../core/settings.js'
import { sfx, unlockAudio } from '../../core/audio.js'
import { haptic } from '../../core/haptics.js'
import { keepAwake } from '../../core/wakelock.js'
import { wordFeed, feedConfigFromSettings } from '../../content/feed.js'
import { contentSetup, feedStatusLine, muteButton, startButton, noKeyBanner, onCredentialsChange } from '../../ui/content-setup.js'
import { TiltSensor, motionSupport, sensorHints } from './tilt-sensor.js'
import { fitWord } from './fit.js'
import './headsup.css'

const SENSITIVITY = {
  easy: { triggerDeg: 24, dwellMs: 90, armTriggerDeg: 22, maxLinearG: 0.62 },
  normal: {},
  strict: { triggerDeg: 38, dwellMs: 140, armTriggerDeg: 34, maxLinearG: 0.35, cooldownMs: 450 },
}

export function mount(root, ctx) {
  let teardown = () => {}
  const show = (fn) => {
    teardown()
    teardown = fn(root, show, ctx) || (() => {})
  }
  show(setupScreen)
  return () => teardown()
}

/* ---------------------------------- setup --------------------------------- */

function setupScreen(root, show, ctx) {
  clear(root)
  let live = true
  const screen = h('div', { class: 'screen' })
  const status = h('div', {})

  const sync = async () => {
    await wordFeed.configure(feedConfigFromSettings(settings.all, activeLanguage(), activeTopic()))
    if (!live) return
    status.firstChild?.dispose?.()
    clear(status).append(feedStatusLine(wordFeed))
    wordFeed.prime()
  }

  const banner = noKeyBanner()
  const startBtn = startButton('▶︎  Start round', async (btn) => {
    unlockAudio()
    btn.disabled = true
    btn.textContent = 'Getting ready…'
    const sensor = new TiltSensor({ config: SENSITIVITY[settings.get('headsUpSensitivity')] })
    sensor.setInvert(settings.get('invertTilt'))
    const [res] = await Promise.all([sensor.start(), wordFeed.prime()])
    if (!live) return sensor.stop()
    btn.disabled = false
    btn.textContent = '▶︎  Start round'
    if (!wordFeed.size) {
      sensor.stop()
      return toast(wordFeed.status.error?.message || 'Could not get any words', { bad: true })
    }
    show((r, s, c) => roundScreen(r, s, c, { sensor, motion: res }))
  })

  const goBack = () => back()
  screen.append(
    h('div', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: goBack }, '‹'),
      h('h2', {}, '🙈 Heads Up'),
      muteButton(),
      h('button', { class: 'icon-btn', 'aria-label': 'How to play', onclick: howToPlay }, '?')
    ),
    h('div', { class: 'setup' },
      contentSetup({ onChange: sync }),
      h('div', { class: 'stack' }, banner, status, startBtn)
    )
  )
  root.append(screen)
  sync()
  const offCreds = onCredentialsChange(sync)
  const offBack = interceptBack(goBack)
  return () => {
    live = false
    offBack()
    offCreds()
    status.firstChild?.dispose?.()
    startBtn.dispose?.()
    banner.dispose?.()
  }
}

function howToPlay() {
  import('../../ui/dom.js').then(({ sheet, h: hh }) =>
    sheet('How to play', () =>
      hh('div', { class: 'stack tiny' },
        hh('p', {}, hh('strong', {}, '1. '), 'Hold the phone flat against your forehead, screen facing everyone else. Keep it horizontal.'),
        hh('p', {}, hh('strong', {}, '2. '), 'Tilt the phone forward and hold to start the round.'),
        hh('p', {}, hh('strong', {}, '3. '), 'Your friends describe the word without saying it.'),
        hh('p', {}, hh('strong', {}, '4. '), 'Guessed it? Tilt forward. Stuck? Tilt back to skip. Return the phone level between each one.'),
        hh('p', { class: 'dim' }, 'No motion sensors? On-screen buttons appear automatically.')
      )
    )
  )
}

/* ---------------------------------- round --------------------------------- */

function roundScreen(root, show, ctx, { sensor, motion }) {
  clear(root)
  let live = true
  const timers = new Set()
  // A deferred step that outlives the screen resurrects the round over whatever replaced it.
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id)
      if (live) fn()
    }, ms)
    timers.add(id)
    return id
  }
  const useMotion = motion.ok
  const total = settings.get('roundSeconds')

  const word = h('span', {})
  const clock = h('div', { class: 'hu-clock' }, String(total))
  const scoreEl = h('div', { class: 'hu-score' }, '✓ 0')
  const fill = h('div', { class: 'hu-timer-fill' })
  const flash = h('div', { class: 'hu-flash' }, h('div', { class: 'mark' }))
  const hint = h('div', { class: 'hu-hint' })
  const wordBox = h('div', { class: 'hu-word' }, word)

  const goBack = () => (state.phase === 'playing' ? finish() : show(setupScreen))
  const closeBtn = h('button', { class: 'hu-close', 'aria-label': 'End round', onclick: goBack }, '✕')
  const surface = h('div', { class: 'hu-surface' },
    h('div', { class: 'hu-top' }, closeBtn, scoreEl, h('div', { class: 'hu-timer-bar' }, fill), clock),
    wordBox,
    hint
  )
  const stage = h('div', { class: 'hu-stage' }, surface, flash)

  let overlay = null
  const setOverlay = (node) => {
    overlay?.remove()
    overlay = node
    if (node) stage.append(node)
  }

  const state = {
    phase: 'prep', // prep -> countdown -> playing -> done
    score: 0,
    results: [],
    current: null,
    remaining: total,
    landscape: true,
    calibrated: false,
  }

  /* ---- landscape handling: sensors are the source of truth, not the viewport ---- */
  let rotClass = ''
  const applyRotation = (gx) => {
    const viewportLandscape = window.innerWidth > window.innerHeight
    let next = ''
    if (!viewportLandscape && gx != null) next = gx > 0 ? 'rot-cw' : 'rot-ccw'
    if (next === rotClass) return
    rotClass = next
    surface.classList.remove('rot-cw', 'rot-ccw')
    if (next) {
      surface.classList.add(next)
      surface.style.width = `${window.innerHeight}px`
      surface.style.height = `${window.innerWidth}px`
    } else {
      surface.style.width = '100%'
      surface.style.height = '100%'
    }
    requestAnimationFrame(() => fitWord(wordBox, word, { fill: 0.84 }))
  }
  const onResize = () => {
    rotClass = 'stale'
    applyRotation(lastGx)
    fitWord(wordBox, word, { fill: 0.84 })
  }
  window.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', onResize)
  if (window.screen.orientation?.lock) window.screen.orientation.lock('landscape').catch(() => {})

  let lastGx = null

  /* --------------------------------- rounds -------------------------------- */

  const nextWord = async () => {
    let w = wordFeed.take()
    if (!w) {
      state.current = null
      word.textContent = '…'
      w = await wordFeed.takeAsync()
      if (!live || state.phase !== 'playing') return
      if (!w) {
        toast(wordFeed.status.error?.message || 'Ran out of words', { bad: true })
        return finish()
      }
    }
    state.current = w
    word.textContent = w
    word.style.animation = 'none'
    void word.offsetWidth
    word.style.animation = ''
    fitWord(wordBox, word, { fill: 0.84 })
  }

  const showFlash = (kind, mark) => {
    flash.className = `hu-flash ${kind}`
    flash.firstChild.textContent = mark
    void flash.offsetWidth
    flash.classList.add('show')
  }

  const score = (correct) => {
    if (state.phase !== 'playing' || !state.current) return
    state.results.push({ word: state.current, correct })
    if (correct) {
      state.score++
      scoreEl.textContent = `✓ ${state.score}`
      sfx('correct')
      haptic('correct')
      showFlash('correct', '✓')
    } else {
      sfx('skip')
      haptic('skip')
      showFlash('skip', '↷')
    }
    nextWord()
  }

  /* --------------------------------- timer --------------------------------- */

  let tick = 0
  let endsAt = 0
  const startTimer = () => {
    state.phase = 'playing'
    endsAt = performance.now() + total * 1000
    keepAwake(true)
    hint.textContent = useMotion ? 'Tilt down = got it · Tilt up = skip' : ''
    nextWord()
    let lastWhole = total
    tick = setInterval(() => {
      const left = Math.max(0, (endsAt - performance.now()) / 1000)
      state.remaining = left
      fill.style.transform = `scaleX(${left / total})`
      const whole = Math.ceil(left)
      if (whole !== lastWhole) {
        lastWhole = whole
        clock.textContent = String(whole)
        if (whole <= 5 && whole > 0) {
          fill.classList.add('low')
          sfx('countdown')
          haptic('tap')
        }
      }
      if (left <= 0) finish()
    }, 100)
  }

  const finish = () => {
    if (state.phase === 'done') return
    state.phase = 'done'
    clearInterval(tick)
    sensor.setMode('idle')
    keepAwake(false)
    sfx('end')
    haptic('end')
    later(() => show((r, s, c) => resultsScreen(r, s, c, state)), 420)
  }

  /* ------------------------------ arm + prep ------------------------------- */

  const prepOverlay = () => {
    const ring = h('div', {
      class: 'arm-ring',
      html: `<svg viewBox="0 0 100 100" aria-hidden="true">
          <defs><linearGradient id="armgrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="var(--accent-1)"/><stop offset="100%" stop-color="var(--accent-2)"/>
          </linearGradient></defs>
          <circle class="track" cx="50" cy="50" r="44"/>
          <circle class="prog" cx="50" cy="50" r="44" stroke-dasharray="276.5" stroke-dashoffset="276.5"/>
        </svg><div class="face">🙈</div>`,
    })
    const title = h('h2', {}, 'Phone on your forehead')
    const body = h('p', {}, 'Hold it horizontally, screen facing your friends.')
    const node = h('div', { class: 'hu-overlay' }, ring, title, body)
    // Plain names like `title` collide with built-in HTMLElement string properties.
    node.els = { ring: ring.querySelector('.prog'), title, body, face: ring.querySelector('.face') }
    return node
  }

  const prep = prepOverlay()
  setOverlay(prep)

  const paintPrep = (snap) => {
    if (state.phase !== 'prep') return
    if (!snap.landscape) {
      prep.els.face.textContent = '📱'
      prep.els.face.classList.add('rotate-hint')
      prep.els.title.textContent = 'Turn the phone sideways'
      prep.els.body.textContent = 'Heads Up only works with the phone held horizontally.'
      prep.els.ring.style.strokeDashoffset = '276.5'
      return
    }
    prep.els.face.classList.remove('rotate-hint')
    if (!snap.calibrated) {
      prep.els.face.textContent = '🤚'
      prep.els.title.textContent = 'Hold still for a second'
      prep.els.body.textContent = 'Getting a reading on how you are holding it.'
      prep.els.ring.style.strokeDashoffset = '276.5'
      return
    }
    prep.els.face.textContent = '🙈'
    prep.els.title.textContent = 'Tilt forward to start'
    prep.els.body.textContent = 'Tip the top of the phone down and hold until the ring fills.'
    prep.els.ring.style.strokeDashoffset = String(276.5 * (1 - snap.armProgress))
  }

  const beginCountdown = () => {
    if (state.phase !== 'prep') return
    state.phase = 'countdown'
    sensor.setMode('idle')
    sfx('arm')
    haptic('start')
    let n = 3
    const node = h('div', { class: 'hu-overlay' }, h('div', { class: 'hu-countdown' }, String(n)))
    setOverlay(node)
    const step = () => {
      n--
      if (n > 0) {
        sfx('countdown')
        haptic('tap')
        const el = h('div', { class: 'hu-countdown' }, String(n))
        clear(node).append(el)
        later(step, 800)
      } else {
        sfx('go')
        haptic('start')
        clear(node).append(h('div', { class: 'hu-countdown' }, 'GO'))
        later(() => {
          setOverlay(null)
          sensor.setMode('playing')
          startTimer()
        }, 620)
      }
    }
    later(step, 800)
  }

  /* ------------------------------ sensor wiring ---------------------------- */

  if (useMotion) {
    sensor.onEvent = (e) => {
      if (e.type === 'tilt') {
        if (state.phase === 'playing') score(e.dir === 'down')
      } else if (e.type === 'armed') {
        beginCountdown()
      } else if (e.type === 'orientation' && !e.landscape && state.phase === 'playing') {
        badOrientation()
      } else if (e.type === 'orientation' && e.landscape && state.phase === 'playing') {
        setOverlay(null)
      }
    }
    sensor.onFrame = (snap) => {
      state.landscape = snap.landscape
      state.calibrated = snap.calibrated
      if (snap.gx != null) { lastGx = snap.gx; applyRotation(snap.gx) }
      paintPrep(snap)
    }
    sensor.setMode('arming')
  } else {
    const hints = motion.hints?.length ? motion.hints : sensorHints()
    prep.els.face.textContent = '📴'
    prep.els.title.textContent =
      motion.reason === 'denied' ? 'Motion access denied' : 'No motion detected'
    prep.els.body.textContent = hints.length
      ? hints[0]
      : 'This phone is not reporting motion. Use the buttons on screen instead.'

    const retry = h('button', { class: 'btn btn-lg' }, '↻ Try motion again')
    retry.onclick = async () => {
      retry.disabled = true
      retry.textContent = 'Checking…'
      const res = await sensor.start()
      if (!live) return
      if (res.ok) {
        show((r, s2, c) => roundScreen(r, s2, c, { sensor, motion: res }))
        return
      }
      retry.disabled = false
      retry.textContent = '↻ Try motion again'
      toast('Still no motion from this device', { bad: true })
    }
    // The shield or permission can be changed without reloading, so listen for a late start.
    sensor.onLate = () => {
      toast('Motion sensors are working now')
      show((r, s2, c) => roundScreen(r, s2, c, { sensor, motion: { ok: true } }))
    }
    prep.append(
      h('button', { class: 'btn btn-primary btn-lg', onclick: beginCountdown }, 'Play with buttons'),
      retry
    )
    surface.append(
      h('div', { class: 'hu-fallback' },
        h('button', { class: 'no', onclick: () => score(false) }, '↷ Skip'),
        h('button', { class: 'ok', onclick: () => score(true) }, '✓ Got it')
      )
    )
  }

  const badOrientation = () => {
    setOverlay(h('div', { class: 'hu-overlay' },
      h('div', { class: 'big-emoji rotate-hint' }, '📱'),
      h('h2', {}, 'Keep it horizontal'),
      h('p', {}, 'Turn the phone back sideways to carry on. The clock is still running!')
    ))
  }

  /* --------------------------------- chrome -------------------------------- */

  document.body.append(stage)
  applyRotation(null)
  const offBack = interceptBack(goBack)

  return () => {
    live = false
    offBack()
    for (const id of timers) clearTimeout(id)
    timers.clear()
    clearInterval(tick)
    sensor.stop()
    keepAwake(false)
    window.removeEventListener('resize', onResize)
    window.removeEventListener('orientationchange', onResize)
    try { window.screen.orientation?.unlock?.() } catch (e) { /* not supported */ }
    stage.remove()
  }
}

/* -------------------------------- results --------------------------------- */

function resultsScreen(root, show, ctx, state) {
  clear(root)
  const got = state.results.filter((r) => r.correct).length
  const goBack = () => show(setupScreen)
  const screen = h('div', { class: 'screen' },
    h('div', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back to setup', onclick: goBack }, '‹'),
      h('h2', {}, 'Round over')
    ),
    h('div', { class: 'center stack', style: { padding: 'var(--sp-5) 0' } },
      h('div', { class: 'big-score' }, String(got)),
      h('p', { class: 'dim' }, got === 1 ? 'word guessed' : 'words guessed')
    ),
    h('div', { class: 'hu-results grow', style: { overflowY: 'auto' } },
      ...state.results.map((r, i) =>
        h('div', { class: `result-row${r.correct ? ' correct' : ''}`, style: { '--i': i, animationDelay: `${i * 40}ms` } },
          h('span', {}, r.correct ? '✅' : '⤼'),
          h('span', { class: 'w' }, r.word)
        )),
      !state.results.length && h('p', { class: 'tiny dim center' }, 'No words this round.')
    ),
    h('div', { class: 'stack', style: { marginTop: 'var(--sp-4)' } },
      h('button', { class: 'btn btn-primary btn-lg btn-block', onclick: () => show(setupScreen) }, '↻  Play again'),
      h('button', { class: 'btn btn-ghost btn-block', onclick: () => navigate('/') }, 'Back to games')
    )
  )
  root.append(screen)
  sfx('tap')
  return interceptBack(goBack)
}

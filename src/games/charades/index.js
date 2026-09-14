import { h, clear, toast, holdable, sheet } from '../../ui/dom.js'
import { back, navigate } from '../../core/router.js'
import { settings, activeTopic, activeLanguage } from '../../core/settings.js'
import { sfx, unlockAudio } from '../../core/audio.js'
import { haptic } from '../../core/haptics.js'
import { keepAwake } from '../../core/wakelock.js'
import { wordFeed, feedConfigFromSettings } from '../../content/feed.js'
import { contentSetup, feedStatusLine, muteButton, startButton, noKeyBanner } from '../../ui/content-setup.js'
import { fitWord } from '../headsup/fit.js'
import './charades.css'

const PEEK_MS = 2000

export function mount(root, ctx) {
  let teardown = () => {}
  const show = (fn) => {
    teardown()
    teardown = fn(root, show) || (() => {})
  }
  show(setupScreen)
  return () => teardown()
}

function setupScreen(root, show) {
  clear(root)
  const status = h('div', {})
  const sync = async () => {
    await wordFeed.configure(feedConfigFromSettings(settings.all, activeLanguage(), activeTopic()))
    clear(status).append(feedStatusLine(wordFeed))
    wordFeed.prime()
  }

  const banner = noKeyBanner()
  const startBtn = startButton('▶︎  Start', async (btn) => {
    unlockAudio()
    btn.disabled = true
    btn.textContent = 'Getting words…'
    await wordFeed.prime()
    btn.disabled = false
    btn.textContent = '▶︎  Start'
    if (!wordFeed.size) return toast(wordFeed.status.error?.message || 'Could not get any words', { bad: true })
    show(playScreen)
  })

  const screen = h('div', { class: 'screen' },
    h('div', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back() }, '‹'),
      h('h2', {}, '🎭 Charades'),
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
  return () => {
    status.firstChild?.dispose?.()
    startBtn.dispose?.()
    banner.dispose?.()
  }
}

function howToPlay() {
  sheet('How to play', () =>
    h('div', { class: 'stack tiny' },
      h('p', {}, h('strong', {}, 'Next '), 'shows your word for two seconds, then hides it.'),
      h('p', {}, h('strong', {}, 'Press and hold '), 'the card any time to peek at it again. Let go to hide it.'),
      h('p', {}, 'Act it out, then pass the phone to the next player and tap Next.'),
      h('p', { class: 'dim' }, 'The screen stays awake while you play.')
    )
  )
}

function playScreen(root, show) {
  clear(root)
  keepAwake(true)

  const state = { word: null, shown: 0, revealed: false }
  let hideTimer = 0

  const wordEl = h('div', { class: 'ch-word' })
  const peekBar = h('div', { class: 'ch-peek-bar' })
  const hiddenView = h('div', { class: 'ch-hidden' },
    h('div', { class: 'eye' }, '🫣'),
    h('strong', {}, 'Hold to peek'),
    h('span', { class: 'tiny' }, 'Press and hold anywhere on this card')
  )
  const loadingView = h('div', { class: 'ch-hidden' },
    h('div', { class: 'spinner' }),
    h('strong', {}, 'Writing more words…')
  )
  const card = h('div', {
    class: 'ch-card', role: 'button', tabindex: '0',
    'aria-label': 'Hold to reveal the word',
  }, hiddenView, peekBar)

  const count = h('span', { class: 'ch-count' }, '0 words')

  const reveal = (temporary) => {
    if (!state.word) return
    state.revealed = true
    card.classList.add('held')
    clear(card).append(wordEl, peekBar)
    wordEl.textContent = state.word
    wordEl.style.animation = 'none'
    void wordEl.offsetWidth
    wordEl.style.animation = ''
    fitWord(card, wordEl, { max: 120 })
    if (!temporary) sfx('reveal')
  }

  const hide = () => {
    state.revealed = false
    card.classList.remove('held')
    clearTimeout(hideTimer)
    peekBar.classList.remove('running')
    peekBar.style.transform = 'scaleX(0)'
    clear(card).append(hiddenView, peekBar)
  }

  const next = async () => {
    let w = wordFeed.take()
    if (!w) {
      // Clear the old word first: it must never stay on screen while the next one loads.
      state.word = null
      hide()
      clear(card).append(loadingView, peekBar)
      nextBtn.disabled = true
      w = await wordFeed.takeAsync()
      nextBtn.disabled = false
      clear(card).append(hiddenView, peekBar)
      if (!w) return toast(wordFeed.status.error?.message || 'No words left', { bad: true })
    }
    state.word = w
    state.shown++
    count.textContent = `${state.shown} ${state.shown === 1 ? 'word' : 'words'}`
    sfx('select')
    haptic('select')
    reveal(false)
    clearTimeout(hideTimer)
    peekBar.classList.remove('running')
    peekBar.style.transform = 'scaleX(0)'
    void peekBar.offsetWidth
    peekBar.classList.add('running')
    hideTimer = setTimeout(() => {
      hide()
      sfx('hide')
      haptic('tap')
    }, PEEK_MS)
  }

  // Hold-to-peek only owns the card once the word has auto-hidden, so a press never cuts the initial 2s short.
  let holdOwns = false
  const peekStart = () => {
    if (!state.word || state.revealed) return
    holdOwns = true
    haptic('reveal')
    sfx('reveal')
    reveal(true)
  }
  const peekEnd = () => {
    if (!holdOwns) return
    holdOwns = false
    hide()
    sfx('hide')
  }
  holdable(card, { holdMs: 60000, onStart: peekStart, onCancel: peekEnd })
  card.addEventListener('keydown', (e) => {
    if (e.repeat) return
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); peekStart() }
  })
  card.addEventListener('keyup', peekEnd)

  const nextBtn = h('button', { class: 'btn btn-primary btn-lg btn-block ch-next', onclick: next }, 'Next word  →')

  const screen = h('div', { class: 'screen' },
    h('div', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back to setup', onclick: () => show(setupScreen) }, '‹'),
      h('h2', {}, '🎭 Charades'),
      muteButton(),
      h('button', { class: 'icon-btn', 'aria-label': 'How to play', onclick: howToPlay }, '?')
    ),
    h('div', { class: 'ch-stage' },
      card,
      h('div', { class: 'ch-meta' }, count, h('span', { class: 'tiny dim' }, 'Hold the card to peek')),
      nextBtn
    )
  )
  root.append(screen)
  next()
  window.addEventListener('resize', onResize)
  function onResize() { if (state.revealed) fitWord(card, wordEl, { max: 120 }) }

  return () => {
    clearTimeout(hideTimer)
    keepAwake(false)
    window.removeEventListener('resize', onResize)
  }
}

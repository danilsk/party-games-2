import './styles/tokens.css'
import './styles/base.css'
import './styles/ui.css'
import { route, startRouter, navigate } from './core/router.js'
import { renderHome } from './ui/home.js'
import { gameById } from './games/registry.js'
import { applyTheme } from './core/theme.js'
import { unlockAudio } from './core/audio.js'
import { h, clear, toast } from './ui/dom.js'
import { installPrompt } from './core/install.js'
import { installFullscreenGate } from './ui/fullscreen-gate.js'

const root = document.getElementById('app')

applyTheme()
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)

// Long-press callouts and pinch/double-tap zoom fire pointercancel, which kills hold-to-reveal.
const isTextField = (t) => t instanceof Element && t.closest('input, textarea, [contenteditable]')
for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
  document.addEventListener(type, (e) => { if (!isTextField(e.target)) e.preventDefault() })
}
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
}

const unlock = () => unlockAudio()
document.addEventListener('pointerdown', unlock, { once: true, passive: true })
document.addEventListener('touchstart', unlock, { once: true, passive: true })

route('/', () => {
  renderHome(root)
  return installPrompt.onChange(() => {
    if (location.hash === '' || location.hash === '#/') renderHome(root)
  })
})

route('/g/:id', ({ id }) => {
  const game = gameById(id)
  if (!game) {
    navigate('/', { replace: true })
    return
  }
  document.documentElement.dataset.game = id
  clear(root).append(
    h('div', { class: 'screen center' }, h('div', { class: 'spinner', 'aria-label': 'Loading' }))
  )
  let teardown = null
  let cancelled = false
  game
    .load()
    .then((mod) => {
      if (cancelled) return
      teardown = mod.mount(root, { game })
    })
    .catch((err) => {
      if (cancelled) return
      console.error(err)
      clear(root).append(
        h('div', { class: 'screen center stack' },
          h('p', { style: { fontSize: '48px' } }, '😵'),
          h('h2', {}, 'Could not load that game'),
          h('p', { class: 'tiny dim' }, 'Check your connection and try again.'),
          h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, 'Reload'))
      )
    })
  return () => {
    cancelled = true
    teardown?.()
    document.documentElement.removeAttribute('data-game')
  }
})

installFullscreenGate()
startRouter()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('Update ready — reopen the app to apply')
            }
          })
        })
      })
      .catch(() => {})
  })
}

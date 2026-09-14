import { h } from './dom.js'
import { isFullscreen, onFullscreenChange, requestFullscreen } from '../core/fullscreen.js'
import './fullscreen-gate.css'

/** Covers the app whenever the document is not fullscreen, and takes a tap to get back in. */
export function installFullscreenGate() {
  let gate = null
  let hint = null

  const tap = () => {
    requestFullscreen().then(sync, () => {
      hint.textContent = 'Your browser blocked that — tap again.'
    })
  }

  const show = () => {
    if (gate) return
    hint = h('p', { class: 'fs-gate-hint' }, 'Tap anywhere to go fullscreen')
    gate = h('div', { class: 'fs-gate', role: 'button', tabindex: '0', onclick: tap },
      h('div', { class: 'fs-gate-mark' }, '🎉'),
      h('h1', {}, 'Party Games'),
      hint)
    document.body.append(gate)
  }

  const hide = () => {
    gate?.remove()
    gate = null
    hint = null
  }

  const sync = () => (isFullscreen() ? hide() : show())

  onFullscreenChange(sync)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync() })
  sync()
}

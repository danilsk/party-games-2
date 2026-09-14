// Fullscreen is enforced app-wide: on Android only the Fullscreen API hides the status bar
// for good, and it needs a real tap, so the gate in ui/fullscreen-gate.js takes that tap.
const root = () => document.documentElement

export const fullscreenSupported = () => typeof root().requestFullscreen === 'function'

export const isFullscreen = () => !fullscreenSupported() || !!document.fullscreenElement

export function requestFullscreen() {
  if (isFullscreen()) return Promise.resolve()
  return root().requestFullscreen({ navigationUI: 'hide' })
}

export function onFullscreenChange(fn) {
  document.addEventListener('fullscreenchange', fn)
  document.addEventListener('webkitfullscreenchange', fn)
  return () => {
    document.removeEventListener('fullscreenchange', fn)
    document.removeEventListener('webkitfullscreenchange', fn)
  }
}

// Installed, the manifest already owns the system UI — calling the Fullscreen API on top of it
// only re-runs the OS bar transitions and swallows the first back press. So it is used in a
// browser tab only, and there it is held for as long as a game is open rather than per screen.
const ownWindow = () =>
  window.matchMedia('(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui)')
    .matches || navigator.standalone === true

export function enterFullscreen(retry = true) {
  const el = document.documentElement
  if (ownWindow() || document.fullscreenElement || !el.requestFullscreen) return
  el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
    // No transient activation (deep link, reload, restored tab): take the next tap instead.
    if (retry) document.addEventListener('pointerdown', () => enterFullscreen(false), { once: true })
  })
}

export function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
}

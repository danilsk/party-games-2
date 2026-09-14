// Fullscreen is held for as long as a game is open, never per screen: entering or leaving it
// resizes the viewport, and doing that mid-round is what made the chrome and margins jump.

export function enterFullscreen(retry = true) {
  const el = document.documentElement
  if (document.fullscreenElement || !el.requestFullscreen) return
  el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
    // No transient activation (deep link, reload, restored tab): take the next tap instead.
    if (retry) document.addEventListener('pointerdown', () => enterFullscreen(false), { once: true })
  })
}

export function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
}

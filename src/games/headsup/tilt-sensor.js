// Browser adapter: DeviceMotion/DeviceOrientation -> TiltProcessor. Handles iOS permission gating.

import { TiltProcessor } from './tilt-core.js'

const START_WAIT = 2600

const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/** Why motion might be silently unavailable, for actionable messaging. */
export function sensorHints() {
  const hints = []
  if (!window.isSecureContext)
    hints.push('This page is not on HTTPS — browsers block motion sensors outside a secure context.')
  if (navigator.brave)
    hints.push('Brave blocks motion sensors as part of Shields. Tap the Shields icon and turn off “Block fingerprinting” for this site, then try again.')
  return hints
}

export function motionSupport() {
  const hasMotion = typeof window !== 'undefined' && 'DeviceMotionEvent' in window
  const needsPermission =
    hasMotion && typeof window.DeviceMotionEvent.requestPermission === 'function'
  return { hasMotion, needsPermission, ios: isIOS() }
}

export class TiltSensor {
  constructor({ onEvent, onFrame, onLate, config } = {}) {
    this.proc = new TiltProcessor(config)
    this.onEvent = onEvent || (() => {})
    this.onFrame = onFrame || (() => {})
    this.onLate = onLate || (() => {})
    this.running = false
    this.gotSample = false
    this.gaveUp = false
    this.samples = 0
    this.lastSampleAt = 0
    this.hasGyro = false
    this.proc.setAccelSignPrior(isIOS() ? -1 : 1)
    this._motion = this._motion.bind(this)
    this._orient = this._orient.bind(this)
  }

  setInvert(invert) {
    this.proc.setInvert(invert)
  }

  setMode(mode) {
    this.proc.setMode(mode)
  }

  recalibrate() {
    this.proc.requestRecalibration()
  }

  async start() {
    const { hasMotion, needsPermission } = motionSupport()
    if (!hasMotion) return { ok: false, reason: 'unsupported' }
    if (needsPermission) {
      // Both prompts must be issued inside the user gesture, so fire them together.
      const motion = window.DeviceMotionEvent.requestPermission()
      const orient =
        typeof window.DeviceOrientationEvent?.requestPermission === 'function'
          ? window.DeviceOrientationEvent.requestPermission().catch(() => 'denied')
          : Promise.resolve('denied')
      try {
        const [res] = await Promise.all([motion, orient])
        if (res !== 'granted') return { ok: false, reason: 'denied' }
      } catch (e) {
        return { ok: false, reason: 'denied' }
      }
    }
    window.addEventListener('devicemotion', this._motion, { passive: true })
    window.addEventListener('deviceorientation', this._orient, { passive: true })
    this.running = true
    this.gotSample = false
    const alive = await new Promise((r) => {
      const started = performance.now()
      const tick = () => {
        if (this.gotSample) return r(true)
        if (performance.now() - started > START_WAIT) return r(false)
        setTimeout(tick, 60)
      }
      tick()
    })
    if (!alive) {
      // Stay subscribed: some devices deliver the first sample late, and Brave's
      // fingerprint shield can be switched off without reloading the page.
      this.gaveUp = true
      return { ok: false, reason: 'no-data', hints: sensorHints() }
    }
    this.gaveUp = false
    return { ok: true }
  }

  stop() {
    window.removeEventListener('devicemotion', this._motion)
    window.removeEventListener('deviceorientation', this._orient)
    this.running = false
  }

  _orient(e) {
    if (e.beta == null || e.gamma == null) return
    this.proc.updateOrientation(e.beta, e.gamma, performance.now())
  }

  stats() {
    return {
      samples: this.samples,
      hasGyro: this.hasGyro,
      live: this.samples > 0 && performance.now() - this.lastSampleAt < 1000,
    }
  }

  _motion(e) {
    const a = e.accelerationIncludingGravity
    if (!a || a.x == null || (a.x === 0 && a.y === 0 && a.z === 0)) return
    const first = !this.gotSample
    this.gotSample = true
    this.samples++
    this.lastSampleAt = performance.now()
    if (e.rotationRate && e.rotationRate.beta != null) this.hasGyro = true
    if (first && this.gaveUp) {
      this.gaveUp = false
      this.onLate()
    }
    const r = e.rotationRate
    const events = this.proc.update({
      t: performance.now(),
      ax: a.x,
      ay: a.y,
      az: a.z,
      rx: r ? r.beta : undefined,
      ry: r ? r.gamma : undefined,
      rz: r ? r.alpha : undefined,
    })
    for (const ev of events) this.onEvent(ev)
    this.onFrame(this.proc.snapshot())
  }
}

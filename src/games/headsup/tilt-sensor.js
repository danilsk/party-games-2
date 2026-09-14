// Browser adapter: DeviceMotion/DeviceOrientation -> TiltProcessor. Handles iOS permission gating.

import { TiltProcessor } from './tilt-core.js'

const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function motionSupport() {
  const hasMotion = typeof window !== 'undefined' && 'DeviceMotionEvent' in window
  const needsPermission =
    hasMotion && typeof window.DeviceMotionEvent.requestPermission === 'function'
  return { hasMotion, needsPermission, ios: isIOS() }
}

export class TiltSensor {
  constructor({ onEvent, onFrame, config } = {}) {
    this.proc = new TiltProcessor(config)
    this.onEvent = onEvent || (() => {})
    this.onFrame = onFrame || (() => {})
    this.running = false
    this.gotSample = false
    this.invert = 0
    this.proc.setAccelSignPrior(isIOS() ? -1 : 1)
    this._motion = this._motion.bind(this)
    this._orient = this._orient.bind(this)
  }

  setInvert(invert) {
    this.invert = invert ? 1 : 0
    this.proc.requestRecalibration()
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
      try {
        const res = await window.DeviceMotionEvent.requestPermission()
        if (res !== 'granted') return { ok: false, reason: 'denied' }
      } catch (e) {
        return { ok: false, reason: 'denied' }
      }
      if (typeof window.DeviceOrientationEvent?.requestPermission === 'function') {
        try {
          await window.DeviceOrientationEvent.requestPermission()
        } catch (e) {
          /* orientation is only a sign cross-check; motion alone is enough */
        }
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
        if (performance.now() - started > 1400) return r(false)
        requestAnimationFrame(tick)
      }
      tick()
    })
    if (!alive) {
      this.stop()
      return { ok: false, reason: 'no-data' }
    }
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

  _motion(e) {
    const a = e.accelerationIncludingGravity
    if (!a || a.x == null) return
    this.gotSample = true
    const r = e.rotationRate
    const s = this.invert ? -1 : 1
    const events = this.proc.update({
      t: performance.now(),
      ax: a.x * s,
      ay: a.y * s,
      az: a.z * s,
      rx: r ? r.beta : undefined,
      ry: r ? r.gamma : undefined,
      rz: r ? r.alpha : undefined,
    })
    for (const ev of events) this.onEvent(ev)
    this.onFrame(this.proc.snapshot())
  }
}

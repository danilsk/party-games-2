// Pure, framework-free tilt detection. Samples in, events out — no DOM, fully testable.

const RAD = 180 / Math.PI
const DEG = Math.PI / 180
const G = 9.80665

export const DEFAULT_CONFIG = {
  triggerDeg: 30,
  releaseDeg: 13,
  dwellMs: 100,
  returnDwellMs: 70,
  cooldownMs: 360,
  armTriggerDeg: 27,
  armDwellMs: 340,
  landscapeEnterDeg: 30,
  landscapeExitDeg: 46,
  landscapeGraceMs: 420,
  minInPlane: 0.3,
  neutralMaxDeg: 46,
  stillLinearG: 0.12,
  stillRotDps: 25,
  calibrateMs: 380,
  driftRate: 0.0035,
  driftBandDeg: 12,
  maxLinearG: 0.5,
  linearTau: 0.12,
  stuckMs: 2600,
  stuckStillMs: 600,
  baseAlpha: 0.09,
  noGyroAlpha: 0.16,
  accelTrustK: 6,
  invert: false,
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

function norm(v) {
  const m = Math.hypot(v.x, v.y, v.z)
  return m < 1e-6 ? { x: 0, y: 0, z: 1 } : { x: v.x / m, y: v.y / m, z: v.z / m }
}

// Gravity direction implied by deviceorientation Euler angles (world "up" in device frame).
export function gravityFromOrientation(beta, gamma) {
  const b = beta * DEG
  const c = gamma * DEG
  return { x: -Math.cos(b) * Math.sin(c), y: Math.sin(b), z: Math.cos(b) * Math.cos(c) }
}

export class TiltProcessor {
  constructor(config = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config }
    this.reset()
  }

  reset() {
    this.g = null
    this.lastT = null
    this.mode = 'idle'
    this.phase = 'calibrating'

    // iOS reports accelerationIncludingGravity inverted vs Android; resolved from deviceorientation.
    this.accelSign = 0
    this.accelSignPrior = 1
    this.signScore = 0
    this.signSamples = 0
    this.orientUp = null
    this.orientAt = -1e9

    this.gyroGain = 1
    this.gyroScore = 0
    this.gyroSamples = 0
    this.sawRotation = false

    this.neutral = null
    this.calSum = 0
    this.calCount = 0
    this.calSince = null

    this.landscape = true
    this.badSince = null
    this.okSince = null

    this.candidate = null
    this.lockDir = null
    this.lockSince = null
    this.returnSince = null
    this.cooldownUntil = -1e9
    this.armProgress = 0
    this.armedAt = -1e9

    this.stillSince = null
    this.pitch = 0
    this.rel = 0
    this.rollDev = null
    this.still = false
    this.linear = 0
    this.linearAvg = 0
    this.rotMag = 0
    this.samples = 0
  }

  setMode(mode) {
    if (mode === this.mode) return
    this.mode = mode
    this.candidate = null
    this.armProgress = 0
    const t = this.lastT ?? 0
    if (mode !== 'idle') this.cooldownUntil = Math.max(this.cooldownUntil, t + 150)
    if (this.lockDir) {
      if (Math.abs(this.rel) <= this.cfg.releaseDeg) this.lockDir = null
      else this.lockSince = t
      this.returnSince = null
    }
  }

  setInvert(invert) {
    invert = !!invert
    if (invert === this.cfg.invert) return
    this.cfg.invert = invert
    this.requestRecalibration()
  }

  setAccelSignPrior(sign) {
    if (!this.accelSign) this.accelSignPrior = sign >= 0 ? 1 : -1
  }

  requestRecalibration() {
    this.neutral = null
    this.phase = 'calibrating'
    this.calSum = 0
    this.calCount = 0
    this.calSince = null
    this.candidate = null
    this.lockDir = null
    this.armProgress = 0
  }

  // Cross-check feed: deviceorientation is sign-consistent across platforms, accelerometer is not.
  updateOrientation(beta, gamma, t) {
    if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return
    this.orientUp = norm(gravityFromOrientation(beta, gamma))
    this.orientAt = Number.isFinite(t) ? t : this.lastT ?? 0
  }

  update(s) {
    const cfg = this.cfg
    const events = []
    const t = s.t
    if (!Number.isFinite(t)) return events

    const rawMag = Math.hypot(s.ax, s.ay, s.az)
    if (!Number.isFinite(rawMag) || rawMag < 0.5) return events

    const dt = this.lastT == null ? 0.016 : clamp((t - this.lastT) / 1000, 0.001, 0.1)
    const first = this.lastT == null
    this.lastT = t
    this.samples++

    this._resolveAccelSign(s, rawMag, t)
    const sign = this.accelSign || this.accelSignPrior
    const a = { x: s.ax * sign, y: s.ay * sign, z: s.az * sign }
    const aHat = { x: a.x / rawMag, y: a.y / rawMag, z: a.z / rawMag }

    if (!this.g || first) this.g = aHat

    const hasRot = Number.isFinite(s.rx) && Number.isFinite(s.ry) && Number.isFinite(s.rz)
    this.rotMag = hasRot ? Math.hypot(s.rx, s.ry, s.rz) : 0
    if (this.rotMag > 1) this.sawRotation = true

    const prev = this.g
    let pred = prev
    if (hasRot && this.sawRotation) {
      const gain = this.gyroGain || 1
      const wx = s.rx * DEG * gain
      const wy = s.ry * DEG * gain
      const wz = s.rz * DEG * gain
      const cx = wy * prev.z - wz * prev.y
      const cy = wz * prev.x - wx * prev.z
      const cz = wx * prev.y - wy * prev.x
      const probe = norm({ x: prev.x - cx * dt, y: prev.y - cy * dt, z: prev.z - cz * dt })
      if (this.linearAvg < cfg.maxLinearG) this._scoreGyro(prev, probe, aHat)
      if (this.gyroGain !== 0) pred = probe
    }

    const accelErr = Math.abs(rawMag - G) / G
    const trust = Math.exp(-accelErr * cfg.accelTrustK)
    const base = this.sawRotation ? cfg.baseAlpha : cfg.noGyroAlpha
    const alpha = clamp(base * trust, 0.002, 0.35)
    this.g = norm({
      x: pred.x * (1 - alpha) + aHat.x * alpha,
      y: pred.y * (1 - alpha) + aHat.y * alpha,
      z: pred.z * (1 - alpha) + aHat.z * alpha,
    })

    const lin = {
      x: a.x - G * this.g.x,
      y: a.y - G * this.g.y,
      z: a.z - G * this.g.z,
    }
    this.linear = Math.hypot(lin.x, lin.y, lin.z) / G
    this.linearAvg += (this.linear - this.linearAvg) * (1 - Math.exp(-dt / cfg.linearTau))

    this.pitch = Math.asin(clamp(this.g.z, -1, 1)) * RAD * (cfg.invert ? -1 : 1)
    const inPlane = Math.hypot(this.g.x, this.g.y)
    this.rollDev =
      inPlane < cfg.minInPlane ? null : Math.atan2(Math.abs(this.g.y), Math.abs(this.g.x)) * RAD

    this.still = this.linear < cfg.stillLinearG && this.rotMag < cfg.stillRotDps
    if (this.still) {
      if (this.stillSince == null) this.stillSince = t
    } else this.stillSince = null

    this._updateOrientationGate(t, events)
    if (!this.landscape) {
      this.candidate = null
      this.armProgress = 0
      return events
    }

    if (this.neutral == null) {
      this._calibrate(t, events)
      return events
    }

    this.rel = this.pitch - this.neutral
    this._drift()
    this._gestures(t, events)
    return events
  }

  _resolveAccelSign(s, mag, t) {
    if (this.accelSign) return
    if (!this.orientUp || t - this.orientAt > 500) return
    if (Math.abs(mag - G) > 1.6) return
    const d =
      (s.ax * this.orientUp.x + s.ay * this.orientUp.y + s.az * this.orientUp.z) / mag
    if (Math.abs(d) < 0.75) return
    this.signScore += d > 0 ? 1 : -1
    this.signSamples++
    if (this.signSamples >= 12 && Math.abs(this.signScore) >= 8) {
      this.accelSign = this.signScore > 0 ? 1 : -1
      if (this.accelSign !== this.accelSignPrior) {
        this.g = null
        this.requestRecalibration()
      }
    }
  }

  _scoreGyro(prev, pred, aHat) {
    const px = pred.x - prev.x
    const py = pred.y - prev.y
    const pz = pred.z - prev.z
    const pm = Math.hypot(px, py, pz)
    if (pm < 0.004) return
    const ox = aHat.x - prev.x
    const oy = aHat.y - prev.y
    const oz = aHat.z - prev.z
    const om = Math.hypot(ox, oy, oz)
    if (om < 0.004) return
    this.gyroScore += (px * ox + py * oy + pz * oz) / (pm * om)
    this.gyroSamples++
    if (this.gyroSamples >= 40) {
      const c = this.gyroScore / this.gyroSamples
      const gain = this.gyroGain || 1
      if (c < -0.35) this.gyroGain = -gain
      else if (c > 0.35) this.gyroGain = gain
      else if (c < 0.05) this.gyroGain = 0
      this.gyroScore = 0
      this.gyroSamples = 0
    }
  }

  _updateOrientationGate(t, events) {
    const cfg = this.cfg
    if (this.rollDev == null) return
    const bad = this.rollDev > (this.landscape ? cfg.landscapeExitDeg : cfg.landscapeEnterDeg)
    if (bad) {
      this.okSince = null
      if (this.badSince == null) this.badSince = t
      if (this.landscape && t - this.badSince >= cfg.landscapeGraceMs) {
        this.landscape = false
        this.requestRecalibration()
        events.push({ type: 'orientation', landscape: false })
      }
    } else {
      this.badSince = null
      if (this.okSince == null) this.okSince = t
      if (!this.landscape && t - this.okSince >= 250) {
        this.landscape = true
        events.push({ type: 'orientation', landscape: true })
      }
    }
  }

  _calibrate(t, events) {
    const cfg = this.cfg
    this.phase = 'calibrating'
    if (!this.still || Math.abs(this.pitch) > cfg.neutralMaxDeg) {
      this.calSince = null
      this.calSum = 0
      this.calCount = 0
      return
    }
    if (this.calSince == null) this.calSince = t
    this.calSum += this.pitch
    this.calCount++
    if (t - this.calSince >= cfg.calibrateMs && this.calCount >= 6) {
      this.neutral = this.calSum / this.calCount
      this.phase = 'ready'
      this.rel = 0
      this.cooldownUntil = t + 200
      events.push({ type: 'calibrated', neutral: this.neutral })
    }
  }

  _drift() {
    const cfg = this.cfg
    if (this.lockDir || this.candidate) return
    if (!this.still) return
    if (Math.abs(this.rel) > cfg.driftBandDeg) return
    this.neutral += this.rel * cfg.driftRate
    this.rel = this.pitch - this.neutral
  }

  _gestures(t, events) {
    const cfg = this.cfg
    if (this.mode === 'idle') {
      this.phase = 'ready'
      this.candidate = null
      this.armProgress = 0
      return
    }

    if (this.lockDir) {
      this._handleLocked(t, events)
      return
    }

    this.phase = t < this.cooldownUntil ? 'cooldown' : 'ready'
    if (t < this.cooldownUntil) {
      this.candidate = null
      this.armProgress = 0
      return
    }

    const arming = this.mode === 'arming'
    const trigger = arming ? cfg.armTriggerDeg : cfg.triggerDeg
    const dwell = arming ? cfg.armDwellMs : cfg.dwellMs
    const dir = this.rel <= -trigger ? 'down' : this.rel >= trigger ? 'up' : null
    const allowed = arming ? dir === 'down' : !!dir

    if (!allowed || this.linearAvg > cfg.maxLinearG) {
      if (this.candidate && arming) this.armProgress = 0
      this.candidate = null
      if (arming) this.armProgress = 0
      return
    }

    if (!this.candidate || this.candidate.dir !== dir) this.candidate = { dir, since: t }
    const held = t - this.candidate.since
    if (arming) this.armProgress = clamp(held / dwell, 0, 1)

    if (held >= dwell) {
      this.candidate = null
      this.lockDir = dir
      this.lockSince = t
      this.returnSince = null
      this.phase = 'locked'
      if (arming) {
        this.armProgress = 1
        this.armedAt = t
        events.push({ type: 'armed', at: t })
      } else {
        events.push({ type: 'tilt', dir, at: t, angle: this.rel })
      }
    }
  }

  _handleLocked(t, events) {
    const cfg = this.cfg
    this.phase = 'locked'
    if (Math.abs(this.rel) <= cfg.releaseDeg) {
      if (this.returnSince == null) this.returnSince = t
      if (t - this.returnSince >= cfg.returnDwellMs) {
        this.lockDir = null
        this.returnSince = null
        this.cooldownUntil = t + cfg.cooldownMs
        this.phase = 'cooldown'
        this.armProgress = 0
      }
      return
    }
    this.returnSince = null
    // Player re-seated the phone at a new angle: adopt it rather than deadlocking.
    if (
      t - this.lockSince >= cfg.stuckMs &&
      this.stillSince != null &&
      t - this.stillSince >= cfg.stuckStillMs &&
      Math.abs(this.pitch) <= cfg.neutralMaxDeg
    ) {
      this.neutral = this.pitch
      this.rel = 0
      this.lockDir = null
      this.returnSince = null
      this.cooldownUntil = t + cfg.cooldownMs
      this.armProgress = 0
      events.push({ type: 'recalibrated', neutral: this.neutral })
    }
  }

  snapshot() {
    return {
      phase: this.phase,
      mode: this.mode,
      pitch: this.pitch,
      gx: this.g ? this.g.x : null,
      rel: this.rel,
      neutral: this.neutral,
      calibrated: this.neutral != null,
      landscape: this.landscape,
      rollDev: this.rollDev,
      still: this.still,
      linear: this.linear,
      linearAvg: this.linearAvg,
      armProgress: this.armProgress,
      accelSign: this.accelSign || this.accelSignPrior,
      gyroGain: this.gyroGain,
    }
  }
}

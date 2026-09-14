// Synthetic DeviceMotion traces: pose -> gravity -> accel + consistent gyro.

const RAD = 180 / Math.PI
const G = 9.80665

export function mulberry(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))

// pitch = screen-normal elevation (deg), roll = in-plane rotation (0 = landscape, 90 = portrait)
export function poseGravity(pitchDeg, rollDeg) {
  const p = pitchDeg / RAD
  const r = rollDeg / RAD
  return { x: Math.cos(p) * Math.cos(r), y: Math.cos(p) * Math.sin(r), z: Math.sin(p) }
}

export function eulerFromGravity(g) {
  const beta = Math.asin(Math.max(-1, Math.min(1, g.y))) * RAD
  const gamma = Math.atan2(-g.x, g.z) * RAD
  return { beta, gamma }
}

const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})

/**
 * Build a trace. `pitchAt(t)` / `rollAt(t)` take ms and return degrees.
 * `sign: -1` emulates iOS's inverted accelerationIncludingGravity.
 */
export function simulate(opts) {
  const {
    duration,
    hz = 60,
    pitchAt = () => 0,
    rollAt = () => 0,
    sign = 1,
    gyro = true,
    noiseG = 0.012,
    shakeG = 0,
    shakeHz = 5,
    tiltJitterDeg = 0,
    seed = 7,
    t0 = 0,
  } = opts
  const rnd = mulberry(seed)
  const dt = 1000 / hz
  const out = []
  const pose = (t) => {
    const j = tiltJitterDeg
      ? tiltJitterDeg * Math.sin((t / 1000) * 2 * Math.PI * shakeHz)
      : 0
    return poseGravity(pitchAt(t) + j, rollAt(t))
  }
  for (let i = 0; i * dt <= duration; i++) {
    const t = t0 + i * dt
    const g = pose(t)
    const gPrev = pose(t - dt)
    const gNext = pose(t + dt)
    const gdot = {
      x: ((gNext.x - gPrev.x) / (2 * dt)) * 1000,
      y: ((gNext.y - gPrev.y) / (2 * dt)) * 1000,
      z: ((gNext.z - gPrev.z) / (2 * dt)) * 1000,
    }
    const w = cross(gdot, g)
    const shake = shakeG
      ? shakeG * G * Math.sin((t / 1000) * 2 * Math.PI * shakeHz)
      : 0
    const n = () => (rnd() - 0.5) * 2 * noiseG * G
    const ax = (G * g.x + n() + shake * 0.7) * sign
    const ay = (G * g.y + n() + shake * 0.5) * sign
    const az = (G * g.z + n() + shake) * sign
    const e = eulerFromGravity(g)
    const sample = { t, ax, ay, az, beta: e.beta, gamma: e.gamma }
    if (gyro) {
      sample.rx = w.x * RAD + (rnd() - 0.5) * 1.5
      sample.ry = w.y * RAD + (rnd() - 0.5) * 1.5
      sample.rz = w.z * RAD + (rnd() - 0.5) * 1.5
    }
    out.push(sample)
  }
  return out
}

export function feed(proc, trace, { orientation = true } = {}) {
  const events = []
  for (const s of trace) {
    if (orientation) proc.updateOrientation(s.beta, s.gamma, s.t)
    for (const e of proc.update(s)) events.push({ ...e, t: s.t })
  }
  return events
}

// hold at `base`, then ramp to `peak` over `rampMs`, hold `holdMs`, ramp back.
export function tiltProfile({ base = -6, peak = -55, startMs, rampMs = 180, holdMs = 220 }) {
  return (t) => {
    if (t < startMs) return base
    const a = t - startMs
    if (a < rampMs) return base + (peak - base) * smoothstep(a / rampMs)
    if (a < rampMs + holdMs) return peak
    const b = a - rampMs - holdMs
    if (b < rampMs) return peak + (base - peak) * smoothstep(b / rampMs)
    return base
  }
}

export function sequence(segments) {
  return (t) => {
    for (const [until, fn] of segments) if (t < until) return typeof fn === 'function' ? fn(t) : fn
    const last = segments[segments.length - 1][1]
    return typeof last === 'function' ? last(t) : last
  }
}

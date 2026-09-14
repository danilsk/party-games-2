// Injected into the page: drives real DeviceMotion/DeviceOrientation events from a pose.
window.__tilt = { pitch: -8, roll: 0, sign: 1, running: true, count: 0 }
;(() => {
  // WebKit forbids constructing these events from script, so fall back to a plain Event.
  const make = (type, Ctor, props) => {
    try {
      return new Ctor(type, props)
    } catch (e) {
      const ev = new Event(type)
      Object.assign(ev, props)
      return ev
    }
  }
  const G = 9.80665
  const RAD = 180 / Math.PI
  let prev = null
  let last = performance.now()
  setInterval(() => {
    if (!window.__tilt.running) return
    const t = performance.now()
    const dt = Math.max(0.001, (t - last) / 1000)
    last = t
    const p = window.__tilt.pitch / RAD
    const r = window.__tilt.roll / RAD
    const g = { x: Math.cos(p) * Math.cos(r), y: Math.cos(p) * Math.sin(r), z: Math.sin(p) }
    let rot = { alpha: 0, beta: 0, gamma: 0 }
    if (prev) {
      const d = { x: (g.x - prev.x) / dt, y: (g.y - prev.y) / dt, z: (g.z - prev.z) / dt }
      const w = { x: d.y * g.z - d.z * g.y, y: d.z * g.x - d.x * g.z, z: d.x * g.y - d.y * g.x }
      rot = { beta: w.x * RAD, gamma: w.y * RAD, alpha: w.z * RAD }
    }
    prev = g
    const s = window.__tilt.sign
    window.dispatchEvent(
      make('deviceorientation', window.DeviceOrientationEvent, {
        beta: Math.asin(Math.max(-1, Math.min(1, g.y))) * RAD,
        gamma: Math.atan2(-g.x, g.z) * RAD,
        alpha: 0,
      })
    )
    window.dispatchEvent(
      make('devicemotion', window.DeviceMotionEvent, {
        accelerationIncludingGravity: { x: G * g.x * s, y: G * g.y * s, z: G * g.z * s },
        rotationRate: rot,
        interval: 16,
      })
    )
    window.__tilt.count++
  }, 16)
})()

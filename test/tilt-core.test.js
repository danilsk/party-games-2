import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TiltProcessor, gravityFromOrientation } from '../src/games/headsup/tilt-core.js'
import { simulate, feed, tiltProfile, sequence, poseGravity, smoothstep } from './helpers/simulate.js'

const NEUTRAL = -8
const tilts = (evs) => evs.filter((e) => e.type === 'tilt')
const calibrate = (proc, opts = {}) =>
  feed(proc, simulate({ duration: 1200, pitchAt: () => NEUTRAL, ...opts }), opts)

function ready(opts = {}) {
  const proc = new TiltProcessor()
  const evs = calibrate(proc, opts)
  assert.ok(evs.some((e) => e.type === 'calibrated'), 'should calibrate')
  proc.setMode('playing')
  return proc
}

test('calibrates to the actual hold angle while still', () => {
  const proc = new TiltProcessor()
  const evs = calibrate(proc)
  const cal = evs.find((e) => e.type === 'calibrated')
  assert.ok(cal)
  assert.ok(Math.abs(cal.neutral - NEUTRAL) < 3, `neutral ${cal.neutral}`)
})

test('does not calibrate while the phone is in motion', () => {
  const proc = new TiltProcessor()
  const evs = feed(
    proc,
    simulate({ duration: 1500, pitchAt: (t) => NEUTRAL + 30 * Math.sin(t / 120), shakeG: 0.5 })
  )
  assert.equal(evs.filter((e) => e.type === 'calibrated').length, 0)
})

test('forward tilt fires exactly one down event', () => {
  const proc = ready()
  const evs = feed(
    proc,
    simulate({
      duration: 2000,
      t0: 2000,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: -60, startMs: 2300 }),
    })
  )
  const d = tilts(evs)
  assert.equal(d.length, 1, JSON.stringify(d))
  assert.equal(d[0].dir, 'down')
})

test('backward tilt fires exactly one up event', () => {
  const proc = ready()
  const evs = feed(
    proc,
    simulate({
      duration: 2000,
      t0: 2000,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: 42, startMs: 2300 }),
    })
  )
  const d = tilts(evs)
  assert.equal(d.length, 1, JSON.stringify(d))
  assert.equal(d[0].dir, 'up')
})

test('holding the tilt down for 3s still fires only once', () => {
  const proc = ready()
  const evs = feed(
    proc,
    simulate({
      duration: 4000,
      t0: 2000,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: -65, startMs: 2200, holdMs: 3000 }),
    })
  )
  assert.equal(tilts(evs).length, 1)
})

test('five deliberate tilts fire five events in order', () => {
  const proc = ready()
  const segs = []
  let pitch = sequence([])
  const profiles = []
  for (let i = 0; i < 5; i++) {
    profiles.push({
      start: 2200 + i * 900,
      peak: i % 2 === 0 ? -58 : 46,
    })
  }
  const pitchAt = (t) => {
    for (const p of profiles) {
      const f = tiltProfile({ base: NEUTRAL, peak: p.peak, startMs: p.start, rampMs: 170, holdMs: 200 })
      const v = f(t)
      if (v !== NEUTRAL) return v
    }
    return NEUTRAL
  }
  const evs = feed(proc, simulate({ duration: 6000, t0: 2000, pitchAt }))
  const d = tilts(evs)
  assert.equal(d.length, 5, JSON.stringify(d.map((e) => e.dir)))
  assert.deepEqual(
    d.map((e) => e.dir),
    ['down', 'up', 'down', 'up', 'down']
  )
})

test('violent shaking produces no false triggers', () => {
  const proc = ready()
  const evs = feed(
    proc,
    simulate({
      duration: 6000,
      t0: 2000,
      pitchAt: () => NEUTRAL,
      tiltJitterDeg: 30,
      shakeHz: 6,
      shakeG: 1.4,
    })
  )
  assert.equal(tilts(evs).length, 0, JSON.stringify(tilts(evs)))
})

test('walking bounce produces no false triggers', () => {
  const proc = ready()
  const evs = feed(
    proc,
    simulate({
      duration: 8000,
      t0: 2000,
      pitchAt: (t) => NEUTRAL + 9 * Math.sin(t / 300) + 4 * Math.sin(t / 97),
      shakeG: 0.35,
      shakeHz: 2.2,
      noiseG: 0.05,
    })
  )
  assert.equal(tilts(evs).length, 0)
})

test('a shallow tilt below threshold does not trigger', () => {
  const proc = ready()
  const evs = feed(
    proc,
    simulate({
      duration: 2500,
      t0: 2000,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: NEUTRAL - 22, startMs: 2300, holdMs: 600 }),
    })
  )
  assert.equal(tilts(evs).length, 0)
})

test('a second tilt inside the cooldown window is suppressed', () => {
  const proc = ready()
  const pitchAt = (t) => {
    const a = tiltProfile({ base: NEUTRAL, peak: -60, startMs: 2300, rampMs: 120, holdMs: 120 })(t)
    if (a !== NEUTRAL) return a
    return tiltProfile({ base: NEUTRAL, peak: -60, startMs: 2700, rampMs: 120, holdMs: 120 })(t)
  }
  const evs = feed(proc, simulate({ duration: 2000, t0: 2000, pitchAt }))
  assert.equal(tilts(evs).length, 1)
})

test('trigger latency stays under 300ms from crossing the threshold', () => {
  const proc = ready()
  const start = 2300
  const evs = feed(
    proc,
    simulate({
      duration: 2000,
      t0: 2000,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: -70, startMs: start, rampMs: 150 }),
    })
  )
  const d = tilts(evs)[0]
  assert.ok(d, 'fired')
  assert.ok(d.t - start < 300, `latency ${d.t - start}ms`)
})

test('portrait hold is reported and blocks gestures', () => {
  const proc = ready()
  const evs = feed(
    proc,
    simulate({
      duration: 3000,
      t0: 2000,
      pitchAt: sequence([[3200, NEUTRAL], [1e9, tiltProfile({ base: NEUTRAL, peak: -60, startMs: 3600, holdMs: 800 })]]),
      rollAt: (t) => (t < 3000 ? 0 : 85),
    })
  )
  const orient = evs.filter((e) => e.type === 'orientation')
  assert.ok(orient.length >= 1 && orient[0].landscape === false, 'reports bad orientation')
  assert.equal(tilts(evs).length, 0, 'no gestures while portrait')
})

test('returning to landscape recalibrates and gestures work again', () => {
  const proc = ready()
  feed(proc, simulate({ duration: 2000, t0: 2000, pitchAt: () => NEUTRAL, rollAt: () => 88 }))
  assert.equal(proc.landscape, false)
  const back = feed(
    proc,
    simulate({
      duration: 3000,
      t0: 4000,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: -60, startMs: 5800 }),
      rollAt: () => 0,
    })
  )
  assert.ok(back.some((e) => e.type === 'orientation' && e.landscape === true))
  assert.ok(back.some((e) => e.type === 'calibrated'))
  assert.equal(tilts(back).length, 1)
})

test('works identically in both landscape orientations (roll 0 and 180)', () => {
  for (const roll of [0, 180]) {
    const proc = new TiltProcessor()
    feed(proc, simulate({ duration: 1200, pitchAt: () => NEUTRAL, rollAt: () => roll }))
    proc.setMode('playing')
    const evs = feed(
      proc,
      simulate({
        duration: 2000,
        t0: 2000,
        pitchAt: tiltProfile({ base: NEUTRAL, peak: -60, startMs: 2300 }),
        rollAt: () => roll,
      })
    )
    const d = tilts(evs)
    assert.equal(d.length, 1, `roll ${roll}`)
    assert.equal(d[0].dir, 'down', `roll ${roll} direction must not flip`)
  }
})

test('auto-detects inverted (iOS-style) accelerometer sign', () => {
  const proc = new TiltProcessor()
  proc.setAccelSignPrior(1)
  feed(proc, simulate({ duration: 2500, pitchAt: () => NEUTRAL, sign: -1 }))
  assert.equal(proc.accelSign, -1, 'sign detected')
  proc.setMode('playing')
  const evs = feed(
    proc,
    simulate({
      duration: 2000,
      t0: 2500,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: -60, startMs: 2800 }),
      sign: -1,
    })
  )
  const d = tilts(evs)
  assert.equal(d.length, 1)
  assert.equal(d[0].dir, 'down', 'direction must be correct after sign flip')
})

test('works on devices with no gyroscope', () => {
  const proc = new TiltProcessor()
  feed(proc, simulate({ duration: 1500, pitchAt: () => NEUTRAL, gyro: false }))
  proc.setMode('playing')
  const evs = feed(
    proc,
    simulate({
      duration: 2000,
      t0: 1500,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: -60, startMs: 1900 }),
      gyro: false,
    })
  )
  assert.equal(tilts(evs).length, 1)
})

test('tolerates a reversed gyro sign convention', () => {
  const proc = new TiltProcessor()
  const flip = (tr) => tr.map((s) => ({ ...s, rx: -s.rx, ry: -s.ry, rz: -s.rz }))
  feed(proc, flip(simulate({ duration: 1500, pitchAt: (t) => NEUTRAL + 6 * Math.sin(t / 200) })))
  proc.setMode('playing')
  const evs = feed(
    proc,
    flip(
      simulate({
        duration: 3000,
        t0: 1500,
        pitchAt: tiltProfile({ base: NEUTRAL, peak: -60, startMs: 2200 }),
      })
    )
  )
  assert.equal(tilts(evs).length, 1)
})

test('low sample-rate devices (20Hz) still detect tilts once', () => {
  const proc = new TiltProcessor()
  feed(proc, simulate({ duration: 1500, hz: 20, pitchAt: () => NEUTRAL }))
  proc.setMode('playing')
  const evs = feed(
    proc,
    simulate({
      duration: 2500,
      hz: 20,
      t0: 1500,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: -62, startMs: 1900, holdMs: 400 }),
    })
  )
  assert.equal(tilts(evs).length, 1)
})

test('arming requires a sustained forward tilt, not a flick', () => {
  const proc = new TiltProcessor()
  feed(proc, simulate({ duration: 1200, pitchAt: () => NEUTRAL }))
  proc.setMode('arming')
  const flick = feed(
    proc,
    simulate({
      duration: 1500,
      t0: 1200,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: -55, startMs: 1500, rampMs: 90, holdMs: 90 }),
    })
  )
  assert.equal(flick.filter((e) => e.type === 'armed').length, 0, 'flick must not arm')

  const hold = feed(
    proc,
    simulate({
      duration: 2500,
      t0: 2700,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: -55, startMs: 3000, rampMs: 150, holdMs: 900 }),
    })
  )
  assert.equal(hold.filter((e) => e.type === 'armed').length, 1, 'sustained hold arms once')
})

test('arming ignores backward tilts', () => {
  const proc = new TiltProcessor()
  feed(proc, simulate({ duration: 1200, pitchAt: () => NEUTRAL }))
  proc.setMode('arming')
  const evs = feed(
    proc,
    simulate({
      duration: 2500,
      t0: 1200,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: 55, startMs: 1500, holdMs: 1200 }),
    })
  )
  assert.equal(evs.filter((e) => e.type === 'armed').length, 0)
})

test('slow head-angle drift does not cause false triggers', () => {
  const proc = ready()
  const evs = feed(
    proc,
    simulate({
      duration: 20000,
      t0: 2000,
      pitchAt: (t) => NEUTRAL + 16 * smoothstep((t - 2000) / 18000),
      noiseG: 0.02,
    })
  )
  assert.equal(tilts(evs).length, 0)
  assert.ok(Math.abs(proc.rel) < 12, `rel drifted to ${proc.rel}`)
})

test('recovers when the player re-seats the phone at a new angle', () => {
  const proc = ready()
  const evs = feed(
    proc,
    simulate({
      duration: 8000,
      t0: 2000,
      pitchAt: sequence([
        [2300, NEUTRAL],
        [2500, (t) => NEUTRAL + (-45 - NEUTRAL) * smoothstep((t - 2300) / 200)],
        [1e9, -45],
      ]),
    })
  )
  assert.equal(tilts(evs).length, 1, 'one tilt from the move')
  assert.ok(evs.some((e) => e.type === 'recalibrated'), 'adopts the new resting angle')
  assert.ok(Math.abs(proc.rel) < 5)
})

test('gravityFromOrientation matches known poses', () => {
  const flat = gravityFromOrientation(0, 0)
  assert.ok(Math.abs(flat.z - 1) < 1e-9)
  const upright = gravityFromOrientation(90, 0)
  assert.ok(Math.abs(upright.y - 1) < 1e-9)
  const land = gravityFromOrientation(0, 90)
  assert.ok(Math.abs(land.x + 1) < 1e-9)
})

test('ignores garbage samples without crashing or desyncing', () => {
  const proc = ready()
  const junk = [
    { t: 2000, ax: NaN, ay: 0, az: 0 },
    { t: 2016, ax: 0, ay: 0, az: 0 },
    { t: NaN, ax: 1, ay: 1, az: 1 },
    { t: 2032, ax: undefined, ay: 1, az: 1 },
  ]
  for (const s of junk) assert.doesNotThrow(() => proc.update(s))
  const evs = feed(
    proc,
    simulate({
      duration: 2000,
      t0: 2100,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: -60, startMs: 2500 }),
    })
  )
  assert.equal(tilts(evs).length, 1)
})

test('idle mode reports state but never fires gestures', () => {
  const proc = new TiltProcessor()
  feed(proc, simulate({ duration: 1200, pitchAt: () => NEUTRAL }))
  const evs = feed(
    proc,
    simulate({
      duration: 2500,
      t0: 1200,
      pitchAt: tiltProfile({ base: NEUTRAL, peak: -70, startMs: 1500, holdMs: 900 }),
    })
  )
  assert.equal(tilts(evs).length, 0)
  assert.ok(proc.snapshot().calibrated)
})

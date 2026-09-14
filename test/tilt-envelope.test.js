import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TiltProcessor } from '../src/games/headsup/tilt-core.js'
import { simulate, feed, tiltProfile } from './helpers/simulate.js'

const N = -8
const tilts = (e) => e.filter((x) => x.type === 'tilt')
function ready(seed = 1) {
  const p = new TiltProcessor()
  feed(p, simulate({ duration: 1200, pitchAt: () => N, seed }))
  p.setMode('playing')
  return p
}

test('no false triggers across a shake sweep (amplitude x frequency)', () => {
  const bad = []
  for (const amp of [10, 15, 20, 25, 30, 40]) {
    for (const hz of [1, 1.5, 2, 3, 4, 6, 8]) {
      for (let seed = 1; seed <= 4; seed++) {
        const p = ready(seed)
        const e = feed(
          p,
          simulate({
            duration: 10000,
            t0: 2000,
            pitchAt: () => N,
            tiltJitterDeg: amp,
            shakeHz: hz,
            shakeG: 0.9,
            noiseG: 0.04,
            seed,
          })
        )
        if (tilts(e).length) bad.push(`${amp}deg@${hz}Hz seed${seed}: ${tilts(e).length}`)
      }
    }
  }
  assert.deepEqual(bad, [], `false triggers: ${bad.join(', ')}`)
})

test('detection floor: <=30deg never fires, >=34deg always fires exactly once', () => {
  for (const ramp of [80, 120, 180, 250, 350, 500]) {
    for (const off of [-20, -26, -30]) {
      const p = ready()
      const e = feed(
        p,
        simulate({
          duration: 3000,
          t0: 2000,
          pitchAt: tiltProfile({ base: N, peak: N + off, startMs: 2300, rampMs: ramp, holdMs: 250 }),
          noiseG: 0.03,
        })
      )
      assert.equal(tilts(e).length, 0, `${off}deg/${ramp}ms must not fire`)
    }
    for (const off of [-34, -40, -50, -65]) {
      for (let seed = 1; seed <= 3; seed++) {
        const p = ready(seed)
        const e = feed(
          p,
          simulate({
            duration: 3000,
            t0: 2000,
            pitchAt: tiltProfile({ base: N, peak: N + off, startMs: 2300, rampMs: ramp, holdMs: 250 }),
            noiseG: 0.03,
            seed,
          })
        )
        assert.equal(tilts(e).length, 1, `${off}deg/${ramp}ms seed${seed} must fire once`)
      }
    }
  }
})

test('sustains fast alternating play at 650ms per word', () => {
  const period = 650
  const prof = (t) => {
    for (let i = 0; i < 10; i++) {
      const v = tiltProfile({
        base: N,
        peak: i % 2 ? N + 50 : N - 55,
        startMs: 2200 + i * period,
        rampMs: 160,
        holdMs: 130,
      })(t)
      if (v !== N) return v
    }
    return N
  }
  const p = ready(3)
  const e = feed(p, simulate({ duration: 2200 + period * 11, t0: 2000, pitchAt: prof, noiseG: 0.03 }))
  const d = tilts(e)
  assert.equal(d.length, 10, d.map((x) => x.dir).join(','))
  assert.deepEqual(
    d.map((x) => x.dir),
    ['down', 'up', 'down', 'up', 'down', 'up', 'down', 'up', 'down', 'up']
  )
})

test('fires within 300ms of the threshold crossing', () => {
  for (const ramp of [100, 180, 300]) {
    const p = ready()
    const e = feed(
      p,
      simulate({
        duration: 2000,
        t0: 2000,
        pitchAt: tiltProfile({ base: N, peak: -65, startMs: 2300, rampMs: ramp }),
      })
    )
    const d = tilts(e)[0]
    assert.ok(d, `ramp ${ramp} fired`)
    assert.ok(d.t - 2300 < 300, `ramp ${ramp} latency ${d.t - 2300}ms`)
  }
})

test('a single jolt does not cancel an otherwise valid tilt', () => {
  const p = ready()
  const trace = simulate({
    duration: 2000,
    t0: 2000,
    pitchAt: tiltProfile({ base: N, peak: -60, startMs: 2300, rampMs: 150, holdMs: 400 }),
  })
  for (const s of trace) if (s.t > 2430 && s.t < 2460) s.az += 14
  assert.equal(tilts(feed(p, trace)).length, 1)
})

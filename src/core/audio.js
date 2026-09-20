// Synthesized SFX: no audio assets to download, tiny bundle.
import { settings } from './settings.js'

let ctx = null
let master = null

function ensure() {
  if (ctx) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = 0.5
  master.connect(ctx.destination)
  return ctx
}

export function unlockAudio() {
  const c = ensure()
  if (!c) return
  if (c.state === 'suspended') c.resume().catch(() => {})
}

function blip({ freq = 440, to = null, dur = 0.12, type = 'triangle', gain = 0.3, delay = 0, sweep = 'exp' }) {
  const c = ensure()
  if (!c) return
  const t0 = c.currentTime + delay
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (to) {
    if (sweep === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur)
    else osc.frequency.linearRampToValueAtTime(to, t0 + dur)
  }
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g)
  g.connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function noise({ dur = 0.25, gain = 0.18, delay = 0, hp = 400, lp = 5000 }) {
  const c = ensure()
  if (!c) return
  const t0 = c.currentTime + delay
  const len = Math.max(1, Math.floor(c.sampleRate * dur))
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = c.createBufferSource()
  src.buffer = buf
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = (hp + lp) / 2
  bp.Q.value = 0.7
  const g = c.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(bp)
  bp.connect(g)
  g.connect(master)
  src.start(t0)
}

const SOUNDS = {
  tap: () => blip({ freq: 660, dur: 0.045, gain: 0.12, type: 'sine' }),
  select: () => blip({ freq: 880, to: 1180, dur: 0.08, gain: 0.16, type: 'sine' }),
  correct: () => {
    blip({ freq: 784, dur: 0.1, gain: 0.32, type: 'triangle' })
    blip({ freq: 1046.5, dur: 0.16, gain: 0.3, type: 'triangle', delay: 0.07 })
    blip({ freq: 1568, dur: 0.2, gain: 0.16, type: 'sine', delay: 0.13 })
  },
  skip: () => {
    blip({ freq: 300, to: 150, dur: 0.2, gain: 0.26, type: 'square' })
    noise({ dur: 0.12, gain: 0.06, hp: 200, lp: 900 })
  },
  countdown: () => blip({ freq: 700, dur: 0.09, gain: 0.26, type: 'square' }),
  go: () => {
    blip({ freq: 523.25, dur: 0.12, gain: 0.3, type: 'triangle' })
    blip({ freq: 659.25, dur: 0.12, gain: 0.3, type: 'triangle', delay: 0.1 })
    blip({ freq: 1046.5, dur: 0.3, gain: 0.34, type: 'triangle', delay: 0.2 })
  },
  arm: () => blip({ freq: 420, to: 900, dur: 0.35, gain: 0.2, type: 'sine' }),
  warn: () => blip({ freq: 520, to: 380, dur: 0.3, gain: 0.24, type: 'sawtooth' }),
  end: () => {
    const notes = [1046.5, 830.6, 659.25, 523.25]
    notes.forEach((f, i) => blip({ freq: f, dur: 0.34, gain: 0.28, type: 'triangle', delay: i * 0.13 }))
    noise({ dur: 0.6, gain: 0.05, delay: 0.05, hp: 300, lp: 3000 })
  },
  reveal: () => blip({ freq: 520, to: 780, dur: 0.16, gain: 0.2, type: 'sine' }),
  hide: () => blip({ freq: 620, to: 330, dur: 0.14, gain: 0.16, type: 'sine' }),
  spy: () => {
    blip({ freq: 220, to: 110, dur: 0.5, gain: 0.26, type: 'sawtooth' })
    blip({ freq: 330, dur: 0.3, gain: 0.14, type: 'triangle', delay: 0.18 })
  },
}

let sayTimer = 0

/** Speak a short cue; a new cue replaces any pending or in-progress one. */
export function say(text, { delay = 0 } = {}) {
  clearTimeout(sayTimer)
  const synth = window.speechSynthesis
  if (!synth) return
  const run = () => {
    if (!settings.get('sound')) return
    try {
      synth.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'en-US'
      u.rate = 1.05
      synth.speak(u)
    } catch (e) {
      /* speech is decorative; never break gameplay */
    }
  }
  if (delay) sayTimer = setTimeout(run, delay)
  else run()
}

export function hush() {
  clearTimeout(sayTimer)
  try {
    window.speechSynthesis?.cancel()
  } catch (e) {
    /* nothing to stop */
  }
}

export function sfx(name) {
  if (!settings.get('sound')) return
  const fn = SOUNDS[name]
  if (!fn) return
  try {
    ensure()
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
    fn()
  } catch (e) {
    /* audio is decorative; never break gameplay */
  }
}

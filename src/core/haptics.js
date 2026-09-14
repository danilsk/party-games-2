import { settings } from './settings.js'

const PATTERNS = {
  tap: [8],
  select: [14],
  correct: [18, 40, 26],
  skip: [30],
  start: [12, 60, 12, 60, 40],
  warn: [40, 60, 40],
  end: [60, 80, 60, 80, 120],
  reveal: [10, 30, 10],
}

export function haptic(kind = 'tap') {
  if (!settings.get('haptics')) return
  if (!('vibrate' in navigator)) return
  try {
    navigator.vibrate(PATTERNS[kind] || PATTERNS.tap)
  } catch (e) {
    /* some browsers throw when the document is not focused */
  }
}

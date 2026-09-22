import { lsGet, lsSet } from './storage.js'

export const DEFAULTS = {
  apiKey: '',
  model: 'openai/gpt-6-luna',
  language: 'en',
  customLanguage: '',
  difficulty: 3,
  format: 'word',
  topic: 'mixed',
  customTopic: '',
  sound: true,
  haptics: true,
  theme: 'auto',
  roundSeconds: 60,
  invertTilt: false,
  headsUpSensitivity: 'normal',
}

const state = { ...DEFAULTS, ...lsGet('settings', {}) }
const subs = new Set()

export const settings = {
  get all() {
    return { ...state }
  },
  get(key) {
    return state[key]
  },
  set(patch) {
    let changed = false
    for (const [k, v] of Object.entries(patch)) {
      if (state[k] !== v) {
        state[k] = v
        changed = true
      }
    }
    if (!changed) return
    lsSet('settings', state)
    for (const fn of subs) fn(state)
  },
  subscribe(fn) {
    subs.add(fn)
    return () => subs.delete(fn)
  },
  reset() {
    settings.set({ ...DEFAULTS, apiKey: state.apiKey })
  },
}

export function activeLanguage() {
  return state.language === 'custom' ? state.customLanguage.trim() || 'English' : state.language
}

export function languageLabel() {
  const l = activeLanguage()
  return l === 'en' ? 'English' : l === 'ru' ? 'Русский' : l
}

export function activeTopic() {
  return state.topic === 'custom' ? state.customTopic.trim() : state.topic
}

// Built-in word banks, one module per game and language, loaded only when played.

const LOADERS = {
  'words|en': () => import('./bank/headsup.en.js'),
  'words|ru': () => import('./bank/headsup.ru.js'),
  'words|es': () => import('./bank/headsup.es.js'),
  'mime|en': () => import('./bank/charades.en.js'),
  'mime|ru': () => import('./bank/charades.ru.js'),
  'mime|es': () => import('./bank/charades.es.js'),
  'pairs|en': () => import('./bank/undercover.en.js'),
  'pairs|ru': () => import('./bank/undercover.ru.js'),
  'pairs|es': () => import('./bank/undercover.es.js'),
}

const ALIASES = {
  en: 'en', english: 'en', inglés: 'en', ingles: 'en', английский: 'en',
  ru: 'ru', russian: 'ru', русский: 'ru', ruso: 'ru',
  es: 'es', spanish: 'es', español: 'es', espanol: 'es', castellano: 'es', испанский: 'es',
}

/** The bank language for a language setting (also typed names like "Spanish"), or null. */
export function bankLanguage(language) {
  return ALIASES[String(language || '').trim().toLowerCase()] || null
}

const cache = new Map()

export function loadBank(mode, language) {
  const k = `${mode}|${bankLanguage(language)}`
  if (!LOADERS[k]) return Promise.resolve(null)
  if (!cache.has(k)) {
    cache.set(k, LOADERS[k]().then((m) => m.default, () => {
      cache.delete(k)
      return null
    }))
  }
  return cache.get(k)
}

/**
 * Every bank item for a setup, or null when the bank does not cover it.
 * Heads Up banks are { topics: { id: [easy, medium, hard] }, general: { id: [n, n, n] } }, where
 * the first n items of each level are common knowledge and make up the mixed topic.
 */
export function bankPool(mode, bank, { topic, levels }) {
  if (!bank) return null
  if (mode === 'pairs') return bank
  if (mode === 'mime') return levels.flatMap((l) => bank[l - 1] || [])
  if (topic === 'mixed') {
    return Object.entries(bank.topics).flatMap(([id, byLevel]) =>
      levels.flatMap((l) => (byLevel[l - 1] || []).slice(0, bank.general?.[id]?.[l - 1] || 0)))
  }
  const t = bank.topics[topic]
  return t ? levels.flatMap((l) => t[l - 1] || []) : null
}

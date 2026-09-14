// Per-topic memory of everything generated, so batches never repeat across sessions.

import { idbGet, idbPut, idbAll, idbDelete } from '../core/storage.js'

const STORE_CAP = 2000
export const SEND_CAP = 500

export function slug(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} -]+/gu, '')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 90)
    .replace(/ /g, '-')
}

// Deliberately excludes difficulty and format: switching those should not resurrect old words.
export function historyKey({ mode, language, topic }) {
  return `${mode}|${slug(language) || 'en'}|${slug(topic) || 'mixed'}`
}

export async function loadHistory(key) {
  const rec = await idbGet('history', key)
  return rec?.items || []
}

export async function recentHistory(key, limit = SEND_CAP) {
  const items = await loadHistory(key)
  return items.slice(-limit)
}

export async function addToHistory(key, newItems) {
  if (!newItems?.length) return
  const rec = (await idbGet('history', key)) || { key, items: [] }
  const seen = new Set(rec.items.map((i) => i.toLowerCase()))
  for (const item of newItems) {
    const k = String(item).toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    rec.items.push(item)
  }
  if (rec.items.length > STORE_CAP) rec.items = rec.items.slice(-STORE_CAP)
  rec.updated = Date.now()
  await idbPut('history', rec)
}

export async function historySummary() {
  const all = await idbAll('history')
  return all
    .map((r) => {
      const [mode, language, topic] = r.key.split('|')
      return { key: r.key, mode, language, topic, count: r.items.length, updated: r.updated || 0 }
    })
    .sort((a, b) => b.updated - a.updated)
}

export async function clearHistory(key) {
  if (key) await idbDelete('history', key)
  else for (const r of await idbAll('history')) await idbDelete('history', r.key)
}

export const pairKey = (pair) => `${pair[0]}|${pair[1]}`

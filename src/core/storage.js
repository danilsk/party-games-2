// IndexedDB for content history (bulk, per-topic), localStorage for settings (small, sync).

const DB_NAME = 'party-games'
const DB_VERSION = 1
let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no-idb'))
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).catch((e) => {
    dbPromise = null
    throw e
  })
  return dbPromise
}

async function tx(store, mode, fn) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
    if (req) req.onsuccess = () => resolve(req.result)
    else t.oncomplete = () => resolve()
  })
}

const memFallback = new Map()

export async function idbGet(store, key) {
  try {
    return await tx(store, 'readonly', (s) => s.get(key))
  } catch (e) {
    return memFallback.get(`${store}:${key}`)
  }
}

export async function idbPut(store, value) {
  try {
    return await tx(store, 'readwrite', (s) => s.put(value))
  } catch (e) {
    memFallback.set(`${store}:${value.key}`, value)
  }
}

export async function idbAll(store) {
  try {
    return (await tx(store, 'readonly', (s) => s.getAll())) || []
  } catch (e) {
    return [...memFallback.entries()]
      .filter(([k]) => k.startsWith(`${store}:`))
      .map(([, v]) => v)
  }
}

export async function idbDelete(store, key) {
  try {
    await tx(store, 'readwrite', (s) => s.delete(key))
  } catch (e) {
    memFallback.delete(`${store}:${key}`)
  }
}

const LS = 'pg2:'
export function lsGet(key, fallback) {
  try {
    if (typeof localStorage === 'undefined') return fallback
    const raw = localStorage.getItem(LS + key)
    return raw == null ? fallback : JSON.parse(raw)
  } catch (e) {
    return fallback
  }
}
export function lsSet(key, value) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(LS + key, JSON.stringify(value))
  } catch (e) {
    /* private mode / quota: settings simply do not persist */
  }
}

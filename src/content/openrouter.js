import { buildWordPrompt, buildPairPrompt } from './prompts.js'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export class GenerationError extends Error {
  constructor(message, { kind = 'unknown', status = 0 } = {}) {
    super(message)
    this.kind = kind
    this.status = status
  }
}

function parseJsonLoose(text) {
  if (!text) throw new GenerationError('Empty response from the model', { kind: 'parse' })
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  try {
    return JSON.parse(t)
  } catch (e) {
    const start = t.search(/[{[]/)
    const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1))
      } catch (e2) {
        /* fall through */
      }
    }
    throw new GenerationError('Model did not return valid JSON', { kind: 'parse' })
  }
}

const clean = (s) =>
  String(s ?? '')
    .replace(/^\s*[\d]+[.)]\s*/, '')
    .replace(/["“”„]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export function normalizeItems(payload) {
  const raw = Array.isArray(payload) ? payload : payload?.items || payload?.words || []
  const seen = new Set()
  const out = []
  for (const entry of raw) {
    const v = clean(typeof entry === 'string' ? entry : entry?.item || entry?.word)
    if (!v || v.length > 60) continue
    const k = v.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(v)
  }
  return out
}

export function normalizePairs(payload) {
  const raw = Array.isArray(payload) ? payload : payload?.pairs || payload?.items || []
  const seen = new Set()
  const out = []
  for (const entry of raw) {
    let a, b
    if (Array.isArray(entry)) [a, b] = entry
    else if (entry && typeof entry === 'object') {
      a = entry.civilian ?? entry.a ?? entry.word ?? entry.civilians
      b = entry.spy ?? entry.b ?? entry.undercover
    }
    a = clean(a)
    b = clean(b)
    if (!a || !b || a.length > 60 || b.length > 60) continue
    if (a.toLowerCase() === b.toLowerCase()) continue
    const k = `${a.toLowerCase()}|${b.toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push([a, b])
  }
  return out
}

export async function callOpenRouter({ apiKey, model, system, user, signal, maxTokens = 2000 }) {
  if (!apiKey) throw new GenerationError('No API key', { kind: 'no-key' })
  let res
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(typeof location === 'undefined' ? {} : { 'HTTP-Referer': location.origin }),
        'X-Title': 'Party Games',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
      }),
    })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new GenerationError('Network unavailable', { kind: 'network' })
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const kind =
      res.status === 401 || res.status === 403
        ? 'auth'
        : res.status === 429
          ? 'rate-limit'
          : res.status === 402
            ? 'credits'
            : 'http'
    let msg = `Request failed (${res.status})`
    try {
      const j = JSON.parse(body)
      if (j?.error?.message) msg = j.error.message
    } catch (e) {
      /* keep the generic message */
    }
    throw new GenerationError(msg, { kind, status: res.status })
  }
  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content
  return parseJsonLoose(content)
}

export async function generateWords(opts) {
  const { system, user } = buildWordPrompt(opts)
  const payload = await callOpenRouter({ ...opts, system, user })
  return normalizeItems(payload)
}

export async function generatePairs(opts) {
  const { system, user } = buildPairPrompt(opts)
  const payload = await callOpenRouter({ ...opts, system, user })
  return normalizePairs(payload)
}

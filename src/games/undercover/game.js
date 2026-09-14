// Pure Undercover rules. No DOM, so the secrecy and win conditions are unit-testable.

export const MIN_PLAYERS = 4
export const MAX_PLAYERS = 12

export function defaultNames(n) {
  return Array.from({ length: n }, (_, i) => `Player ${i + 1}`)
}

export function normalizeGuess(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim()
}

export function guessMatches(guess, target) {
  const a = normalizeGuess(guess)
  const b = normalizeGuess(target)
  if (!a || !b) return false
  return a === b || (a.length > 3 && (a.includes(b) || b.includes(a)))
}

export function createGame({ names, pair, rng = Math.random }) {
  if (!Array.isArray(names) || names.length < MIN_PLAYERS)
    throw new Error(`Undercover needs at least ${MIN_PLAYERS} players`)
  if (!pair || pair.length !== 2) throw new Error('A word pair is required')
  const spy = Math.floor(rng() * names.length)
  return {
    players: names.map((name, i) => ({
      id: i,
      name: name.trim() || `Player ${i + 1}`,
      spy: i === spy,
      seen: false,
      out: false,
    })),
    civilianWord: pair[0],
    spyWord: pair[1],
    phase: 'reveal', // reveal -> discuss -> guess -> over
    outcome: null,
    accused: null,
  }
}

export const wordFor = (g, id) => (g.players[id].spy ? g.spyWord : g.civilianWord)
export const alive = (g) => g.players.filter((p) => !p.out)
export const spyOf = (g) => g.players.find((p) => p.spy)
export const allSeen = (g) => g.players.every((p) => p.seen)

export function markSeen(g, id) {
  g.players[id].seen = true
  if (allSeen(g) && g.phase === 'reveal') g.phase = 'discuss'
  return g
}

/** Eliminate a player. Returns the transition so the UI knows what to show next. */
export function eliminate(g, id) {
  const p = g.players[id]
  if (g.phase !== 'discuss' || p.out) return { kind: 'noop' }
  p.out = true
  if (p.spy) {
    g.phase = 'guess'
    g.accused = id
    return { kind: 'caught-spy' }
  }
  if (alive(g).length <= 2) {
    g.phase = 'over'
    g.outcome = { winner: 'spy', reason: 'outnumbered' }
    return { kind: 'spy-wins' }
  }
  return { kind: 'civilian-out' }
}

export function spyComesForward(g) {
  if (g.phase !== 'discuss') return { kind: 'noop' }
  const spy = spyOf(g)
  spy.out = true
  g.phase = 'guess'
  g.accused = spy.id
  g.surrendered = true
  return { kind: 'caught-spy' }
}

export function submitGuess(g, guess) {
  if (g.phase !== 'guess') return g.outcome
  const correct = guessMatches(guess, g.civilianWord)
  g.phase = 'over'
  g.outcome = correct
    ? { winner: 'spy', reason: 'guessed', guess }
    : { winner: 'civilians', reason: g.surrendered ? 'surrendered' : 'caught', guess }
  return g.outcome
}

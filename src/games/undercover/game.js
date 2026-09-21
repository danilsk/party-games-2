// Pure Undercover rules. No DOM, so the secrecy rules are unit-testable.

export const MIN_PLAYERS = 4
export const MAX_PLAYERS = 12

export function defaultNames(n) {
  return Array.from({ length: n }, (_, i) => `Player ${i + 1}`)
}

export function createGame({ names, pair, rng = Math.random, blindSpy = false }) {
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
    blindSpy: !!blindSpy,
    phase: 'reveal', // reveal -> play -> over
    revealed: false,
    caught: false,
  }
}

export const wordFor = (g, id) => (g.players[id].spy ? g.spyWord : g.civilianWord)

/** Everything a peek screen is allowed to show. With a blind spy, `spy` is never true. */
export const secretFor = (g, id) => ({
  word: wordFor(g, id),
  spy: g.players[id].spy && !g.blindSpy,
})

export const alive = (g) => g.players.filter((p) => !p.out)
export const spyOf = (g) => g.players.find((p) => p.spy)
export const allSeen = (g) => g.players.every((p) => p.seen)

export function markSeen(g, id) {
  g.players[id].seen = true
  if (g.phase === 'reveal' && allSeen(g)) g.phase = 'play'
  return g
}

/** Knock a player out. Nobody may be knocked out before they have read their word. */
export function eliminate(g, id) {
  const p = g.players[id]
  if (!p || !p.seen || p.out) return { kind: 'noop' }
  p.out = true
  if (p.spy) {
    g.caught = true
    g.revealed = true
    g.phase = 'over'
    return { kind: 'spy' }
  }
  return { kind: 'out' }
}

export function revive(g, id) {
  const p = g.players[id]
  if (!p || !p.out) return { kind: 'noop' }
  p.out = false
  if (p.spy) {
    g.caught = false
    g.revealed = false
    g.phase = 'play'
  }
  return { kind: 'back' }
}

export function revealWords(g) {
  g.revealed = true
  g.phase = 'over'
  return g
}

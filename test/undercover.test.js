import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createGame, wordFor, alive, spyOf, markSeen, eliminate, spyComesForward,
  submitGuess, guessMatches, defaultNames, MIN_PLAYERS,
} from '../src/games/undercover/game.js'

const PAIR = ['Sea', 'Lake']
const mk = (n = 5, spyIndex = 2) =>
  createGame({ names: defaultNames(n), pair: PAIR, rng: () => spyIndex / n })

test('requires at least four players', () => {
  assert.throws(() => createGame({ names: defaultNames(3), pair: PAIR }), /at least 4/)
  assert.doesNotThrow(() => createGame({ names: defaultNames(MIN_PLAYERS), pair: PAIR }))
})

test('exactly one spy is assigned', () => {
  for (let i = 0; i < 200; i++) {
    const g = createGame({ names: defaultNames(6), pair: PAIR })
    assert.equal(g.players.filter((p) => p.spy).length, 1)
  }
})

test('the spy assignment is spread across all seats', () => {
  const seats = new Set()
  for (let i = 0; i < 400; i++) seats.add(spyOf(createGame({ names: defaultNames(5), pair: PAIR })).id)
  assert.equal(seats.size, 5, 'every seat can be the spy')
})

test('civilians share a word and the spy gets the other one', () => {
  const g = mk(5, 2)
  const words = g.players.map((p) => wordFor(g, p.id))
  assert.equal(words.filter((w) => w === 'Sea').length, 4)
  assert.equal(words.filter((w) => w === 'Lake').length, 1)
  assert.equal(wordFor(g, spyOf(g).id), 'Lake')
})

test('the reveal phase only ends once every player has looked', () => {
  const g = mk(4)
  for (let i = 0; i < 3; i++) {
    markSeen(g, i)
    assert.equal(g.phase, 'reveal')
  }
  markSeen(g, 3)
  assert.equal(g.phase, 'discuss')
})

test('eliminations are blocked before the discussion phase', () => {
  const g = mk(5)
  assert.equal(eliminate(g, 0).kind, 'noop')
  assert.equal(g.players[0].out, false)
})

test('eliminating a civilian keeps the game going', () => {
  const g = mk(6, 5)
  g.players.forEach((p) => markSeen(g, p.id))
  const res = eliminate(g, 0)
  assert.equal(res.kind, 'civilian-out')
  assert.equal(g.phase, 'discuss')
  assert.equal(alive(g).length, 5)
})

test('eliminating the spy moves to the guess phase', () => {
  const g = mk(5, 2)
  g.players.forEach((p) => markSeen(g, p.id))
  const res = eliminate(g, spyOf(g).id)
  assert.equal(res.kind, 'caught-spy')
  assert.equal(g.phase, 'guess')
})

test('the spy wins by outlasting the group down to two players', () => {
  const g = mk(4, 3)
  g.players.forEach((p) => markSeen(g, p.id))
  assert.equal(eliminate(g, 0).kind, 'civilian-out')
  const res = eliminate(g, 1)
  assert.equal(res.kind, 'spy-wins')
  assert.equal(g.phase, 'over')
  assert.equal(g.outcome.winner, 'spy')
})

test('a caught spy who guesses the civilian word steals the win', () => {
  const g = mk(5, 1)
  g.players.forEach((p) => markSeen(g, p.id))
  eliminate(g, spyOf(g).id)
  const out = submitGuess(g, 'sea')
  assert.equal(out.winner, 'spy')
  assert.equal(out.reason, 'guessed')
  assert.equal(g.phase, 'over')
})

test('a caught spy who guesses wrong loses', () => {
  const g = mk(5, 1)
  g.players.forEach((p) => markSeen(g, p.id))
  eliminate(g, spyOf(g).id)
  const out = submitGuess(g, 'mountain')
  assert.equal(out.winner, 'civilians')
  assert.equal(out.reason, 'caught')
})

test('the spy can come forward voluntarily and still gets a guess', () => {
  const g = mk(6, 4)
  g.players.forEach((p) => markSeen(g, p.id))
  const res = spyComesForward(g)
  assert.equal(res.kind, 'caught-spy')
  assert.equal(g.phase, 'guess')
  assert.equal(spyOf(g).out, true)
  assert.equal(submitGuess(g, 'Sea').winner, 'spy')
})

test('coming forward and failing the guess is a civilian win', () => {
  const g = mk(6, 4)
  g.players.forEach((p) => markSeen(g, p.id))
  spyComesForward(g)
  const out = submitGuess(g, 'river')
  assert.equal(out.winner, 'civilians')
  assert.equal(out.reason, 'surrendered')
})

test('guesses are matched forgivingly but not loosely', () => {
  assert.ok(guessMatches('Sea', 'sea'))
  assert.ok(guessMatches('  SEA! ', 'Sea'))
  assert.ok(guessMatches('Кофе', 'кофе'))
  assert.ok(guessMatches('ice cream', 'Ice-cream'))
  assert.ok(!guessMatches('lake', 'sea'))
  assert.ok(!guessMatches('', 'sea'))
  assert.ok(!guessMatches('sea', ''))
})

test('a blank guess loses rather than crashing', () => {
  const g = mk(5, 0)
  g.players.forEach((p) => markSeen(g, p.id))
  eliminate(g, spyOf(g).id)
  assert.equal(submitGuess(g, '').winner, 'civilians')
})

test('the game cannot be mutated once it is over', () => {
  const g = mk(5, 0)
  g.players.forEach((p) => markSeen(g, p.id))
  eliminate(g, spyOf(g).id)
  submitGuess(g, 'sea')
  const snapshot = JSON.stringify(g.outcome)
  submitGuess(g, 'something else')
  assert.equal(JSON.stringify(g.outcome), snapshot)
  assert.equal(eliminate(g, 1).kind, 'noop')
  assert.equal(spyComesForward(g).kind, 'noop')
})

test('player names are trimmed and blanks fall back to a seat number', () => {
  const g = createGame({ names: ['  Ann ', '', 'Bo', 'Cy'], pair: PAIR })
  assert.equal(g.players[0].name, 'Ann')
  assert.equal(g.players[1].name, 'Player 2')
})

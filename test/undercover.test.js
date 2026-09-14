import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createGame, wordFor, alive, spyOf, markSeen, allSeen, eliminate, revive, revealWords,
  defaultNames, MIN_PLAYERS,
} from '../src/games/undercover/game.js'

const PAIR = ['Sea', 'Lake']
const mk = (n = 5, spyIndex = 2) =>
  createGame({ names: defaultNames(n), pair: PAIR, rng: () => spyIndex / n })
const seeAll = (g) => g.players.forEach((p) => markSeen(g, p.id))

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
    assert.equal(allSeen(g), false)
  }
  markSeen(g, 3)
  assert.equal(g.phase, 'play')
  assert.equal(allSeen(g), true)
})

test('re-reading a word is always allowed and changes nothing', () => {
  const g = mk(5)
  seeAll(g)
  markSeen(g, 0)
  assert.equal(g.phase, 'play')
  assert.equal(wordFor(g, spyOf(g).id), 'Lake')
})

test('a player cannot be knocked out before they have read their word', () => {
  const g = mk(5)
  assert.equal(eliminate(g, 0).kind, 'noop')
  assert.equal(g.players[0].out, false)
  markSeen(g, 0)
  assert.equal(eliminate(g, 0).kind, 'out')
  assert.equal(g.players[0].out, true)
})

test('knocking out the spy ends the round; knocking out a civilian does not', () => {
  const g = mk(5, 2)
  seeAll(g)
  const civilian = g.players.find((p) => !p.spy)
  assert.equal(eliminate(g, civilian.id).kind, 'out')
  assert.equal(g.phase, 'play')
  assert.equal(g.revealed, false)
  assert.equal(g.caught, false)

  assert.equal(eliminate(g, spyOf(g).id).kind, 'spy')
  assert.equal(g.phase, 'over')
  assert.equal(g.revealed, true)
  assert.equal(g.caught, true)
})

test('bringing the spy back resumes the round', () => {
  const g = mk(5, 2)
  seeAll(g)
  eliminate(g, spyOf(g).id)
  assert.equal(revive(g, spyOf(g).id).kind, 'back')
  assert.equal(g.phase, 'play')
  assert.equal(g.revealed, false)
  assert.equal(g.caught, false)
})

test('knocking out is idempotent and reversible', () => {
  const g = mk(5)
  seeAll(g)
  eliminate(g, 1)
  assert.equal(eliminate(g, 1).kind, 'noop')
  assert.equal(alive(g).length, 4)
  assert.equal(revive(g, 1).kind, 'back')
  assert.equal(alive(g).length, 5)
  assert.equal(revive(g, 1).kind, 'noop')
})

test('revealing the words ends the round without a catch', () => {
  const g = mk(5)
  seeAll(g)
  revealWords(g)
  assert.equal(g.revealed, true)
  assert.equal(g.phase, 'over')
  assert.equal(g.caught, false)
  assert.equal(g.civilianWord, 'Sea')
  assert.equal(g.spyWord, 'Lake')
})

test('player names are trimmed and blanks fall back to a seat number', () => {
  const g = createGame({ names: ['  Ann ', '', 'Bo', 'Cy'], pair: PAIR })
  assert.equal(g.players[0].name, 'Ann')
  assert.equal(g.players[1].name, 'Player 2')
})

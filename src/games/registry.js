// Adding a game = adding one entry here plus a module exporting mount(root, ctx) -> teardown.

export const GAMES = [
  {
    id: 'headsup',
    name: 'Heads Up',
    emoji: '🙈',
    tagline: 'Phone on forehead. Tilt to score.',
    blurb: 'Hold the phone horizontally on your forehead and tilt it to mark guesses.',
    players: '3+ players',
    load: () => import('./headsup/index.js'),
  },
  {
    id: 'charades',
    name: 'Charades',
    emoji: '🎭',
    tagline: 'Peek, act it out, pass along.',
    blurb: 'A word flashes for two seconds. Hold to peek again, then act it out.',
    players: '3+ players',
    load: () => import('./charades/index.js'),
  },
  {
    id: 'undercover',
    name: 'Undercover',
    emoji: '🕵️',
    tagline: 'One of you has a different word.',
    blurb: 'Everyone gets a secret word — except the spy, who gets something suspiciously similar.',
    players: '4+ players',
    load: () => import('./undercover/index.js'),
  },
]

export const gameById = (id) => GAMES.find((g) => g.id === id)

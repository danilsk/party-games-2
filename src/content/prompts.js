// Prompt construction, shared by the app and the prompt-validation harness.

const STYLE = {
  headsup: {
    game: 'a fast, fun party guessing game (Heads Up style): one player guesses the item while the others describe it',
    levels: {
      1: 'Easy — everyday things everyone knows; one or two obvious clues get it.',
      2: 'Medium — everyone knows it, but it takes a few good clues.',
      3: 'Hard — everyone knows it, but there is no single obvious clue: subtle ideas and feelings, specific situations, things easily mixed up with something close. Up to a third can be abstract ideas or feelings; the rest are tricky concrete things, situations and actions.',
    },
    playable: 'Each item must be guessable from spoken clues within a minute.',
    shape: 'Mostly single words or names; a short phrase of 2-4 words only when that is the natural name.',
    mix: 'Mix many kinds of items in every batch: objects, animals, food, places, jobs, well-known characters, activities, actions, events, situations, feelings and ideas. Harder items lean toward the trickier kinds, but keep the mix — no single kind should fill the list.',
  },
  charades: {
    game: 'Charades: one player acts each item out silently while the others guess',
    levels: {
      1: 'Easy — one obvious gesture gives it away; a child could act it out.',
      2: 'Medium — needs a short scene or a few gestures.',
      3: 'Hard — needs a clever multi-step performance and is easy to mistake for something close, but is still possible to act out.',
    },
    playable: 'Every item must be possible to act out silently — body, hands and face only, no words, sounds or props — and be guessed within a minute. No pure abstractions, and no objects unless using them is a clear action.',
    shape: 'Single words or short phrases of up to four words.',
    mix: 'Mix many kinds of items in every batch: actions, activities, sports, jobs, animals, well-known characters, scenes and everyday situations, and feelings the face and body can clearly show. No single kind should fill the list.',
  },
}

const LANGUAGE_NAMES = {
  en: 'English',
  ru: 'Russian (Русский)',
  es: 'Latin American Spanish as spoken in Mexico (Español)',
}

function languageLine(language) {
  const named = LANGUAGE_NAMES[language] || language
  return `Write every item in ${named}. Use natural, idiomatic words that a native speaker would actually say — never transliterations or translated English idioms.`
}

function topicLine(topic) {
  if (!topic || topic === 'mixed')
    return 'Topic: anything at all — draw from a wide, surprising spread of categories.'
  return `Topic: ${topic}\nInterpret this topic intelligently and literally, even if it is an unusual instruction or an open-ended description rather than a category. Every item must genuinely fit it.`
}

function levelLine(s, levels) {
  const list = [...new Set(levels || [])].filter((l) => s.levels[l]).sort()
  if (list.length === 0) return `Difficulty: ${s.levels[2]}`
  if (list.length === 1) return `Difficulty: ${s.levels[list[0]]}`
  return `Difficulty — mix these levels in roughly equal shares:\n${list.map((l) => `- ${s.levels[l]}`).join('\n')}`
}

function avoidBlock(history) {
  if (!history.length) return ''
  return `\n\nAlready used — do NOT repeat any of these, and avoid close variants:\n${history.join(', ')}`
}

export function buildWordPrompt({ count, language, topic, levels, style = 'headsup', history = [] }) {
  const s = STYLE[style] || STYLE.headsup
  return {
    system: `You generate content for ${s.game}. You reply with JSON only — no prose, no markdown fences.`,
    user: `Generate exactly ${count} items for the game.

${languageLine(language)}
${style === 'charades' ? '' : `${topicLine(topic)}\n`}${levelLine(s, levels)}
${s.shape}

Difficulty is how hard the item is to get across, not how rare the word is. Every adult at the party must know every item — never rare, technical or dictionary-only words.
${s.mix}

Rules:
- ${s.playable}
- No sentences, no explanations, no numbering, no emoji.
- All items distinct from each other.${avoidBlock(history)}

Respond with JSON in exactly this shape:
{"items": ["item one", "item two"]}`,
  }
}

export function buildPairPrompt({ count, language, history = [] }) {
  return {
    system:
      'You generate content for the social deduction party game Undercover. You reply with JSON only — no prose, no markdown fences.',
    user: `Generate exactly ${count} word PAIRS for the party game Undercover.

In Undercover, the civilians all get the first word and one secret spy gets the second word. Nobody knows which word they have. Everyone describes their own word without saying it, and the group tries to work out who has the odd word.

${languageLine(language)}

Use a real mix of kinds of pairs: two things of the same kind; one a specific kind of the other; two different things that do the same job; two things found in the same place but playing different parts; two things that look alike. About one pair in ten can be two everyday experiences everyone has lived through.

What makes a GOOD pair:
- Two different things that share enough traits that vague clues fit both.
- NOT predictable. If a player hears one word, they should NOT be able to name its partner on the first try. Avoid "textbook twins" that everyone pairs automatically — pick a partner that is one of many plausible matches.
- NOT synonyms or near-synonyms — careful clues must eventually expose the spy.
- Both are things people know from their own life.
- Spread the pairs across very different areas of life; no two pairs from the same small category.

Rules:
- Single words or very short phrases. No explanations, no numbering, no emoji.
- All pairs distinct from each other.${avoidBlock(history)}

Respond with JSON in exactly this shape:
{"pairs": [["civilian word", "spy word"], ["civilian word", "spy word"]]}`,
  }
}

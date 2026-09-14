// Prompt construction, shared by the app and the prompt-validation harness.

const FORMAT_RULE = {
  word: 'Every item MUST be a single word. Do not merge several words into one to satisfy this — choose a genuinely single-word item instead.',
  phrase: 'Every item MUST be a short phrase of 2-4 words. Never a single word.',
  both: 'Mix single words and short phrases of 2-4 words, roughly half and half.',
}

const DIFFICULTY_RULE = {
  1: 'Difficulty 1/5: extremely obvious and common. A young child would know it instantly (e.g. "dog", "sun").',
  2: 'Difficulty 2/5: easy and everyday. Almost everyone knows it.',
  3: 'Difficulty 3/5: moderate. Widely known but takes a moment to describe well.',
  4: 'Difficulty 4/5: hard. Specific, abstract or niche, tricky to explain without saying the word.',
  5: 'Difficulty 5/5: extremely hard to explain or guess. Abstract, obscure, or highly specific.',
}

function languageLine(language) {
  const named = { en: 'English', ru: 'Russian (Русский)' }[language] || language
  return `Write every item in ${named}. Use natural, idiomatic ${named} that a native speaker would actually say — never transliterations or translated English idioms.`
}

function topicLine(topic) {
  if (!topic || topic === 'mixed')
    return 'Topic: anything at all — draw from a wide, surprising spread of categories.'
  return `Topic: ${topic}\nInterpret this topic intelligently and literally, even if it is an unusual instruction or an open-ended description rather than a category. Every item must genuinely fit it.`
}

function avoidBlock(history) {
  if (!history.length) return ''
  return `\n\nAlready used — do NOT repeat any of these, and avoid close variants:\n${history.join(', ')}`
}

export function buildWordPrompt({ count, language, topic, difficulty, format, history = [] }) {
  return {
    system:
      'You generate content for a fast, fun party guessing game (Heads Up / Charades style). You reply with JSON only — no prose, no markdown fences.',
    user: `Generate exactly ${count} items for a party guessing game.

${languageLine(language)}
${topicLine(topic)}
${DIFFICULTY_RULE[difficulty] || DIFFICULTY_RULE[3]}
${FORMAT_RULE[format] || FORMAT_RULE.word}

Rules:
- Each item must be guessable by describing, acting out or miming it in under a minute.
- Concrete and playable. No sentences, no explanations, no numbering, no emoji.
- All items distinct from each other.${avoidBlock(history)}

Respond with JSON in exactly this shape:
{"items": ["item one", "item two"]}`,
  }
}

export function buildPairPrompt({ count, language, topic, difficulty, history = [] }) {
  return {
    system:
      'You generate content for the social deduction party game Undercover. You reply with JSON only — no prose, no markdown fences.',
    user: `Generate exactly ${count} word PAIRS for the party game Undercover.

In Undercover, the civilians all get the first word and one secret spy gets the second word. Everyone describes their own word without saying it, and the group tries to work out who has the odd word.

${languageLine(language)}
${topicLine(topic)}
${DIFFICULTY_RULE[difficulty] || DIFFICULTY_RULE[3]}

What makes a GOOD pair:
- The two words are closely related and easy to confuse when described vaguely — like "sea" and "lake", "guitar" and "ukulele", "wedding" and "funeral".
- Clearly different things, so a careful description can eventually expose the spy.
- NOT synonyms ("sofa"/"couch") — the spy must not be undetectable.
- NOT distant ("sea"/"laptop") — the spy must not be obvious on the first clue.
- Both words must be things people can describe from personal experience.

Rules:
- Single words or very short phrases. No explanations, no numbering, no emoji.
- All pairs distinct from each other.${avoidBlock(history)}

Respond with JSON in exactly this shape:
{"pairs": [["civilian word", "spy word"], ["civilian word", "spy word"]]}`,
  }
}

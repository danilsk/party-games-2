import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TOPIC_PRESETS } from '../src/content/packs/topics.js'
import { bankPool } from '../src/content/bank.js'

// Failure messages carry counts and ids only: the decks are not meant to be read before playing.
const LANGS = ['en', 'ru', 'es']
const load = async (game, lang) => (await import(`../src/content/bank/${game}.${lang}.js`)).default
const dupes = (items) => items.length - new Set(items.map((w) => w.toLowerCase())).size
const tidy = (w) => typeof w === 'string' && w.length > 0 && w.length <= 40 && w === w.trim()

for (const lang of LANGS) {
  test(`heads up ${lang}: every topic has words at every level, no duplicates`, async () => {
    const bank = await load('headsup', lang)
    // Narrow topics (dinosaurs, instruments) and some levels are small by nature, so these are floors, not targets.
    const perTopic = 30
    for (const t of TOPIC_PRESETS.filter((x) => x.id !== 'mixed')) {
      const levels = bank.topics[t.id]
      assert.ok(levels, `${t.id} missing`)
      assert.ok(levels.flat().length >= perTopic, `${t.id} has ${levels.flat().length}`)
      levels.forEach((words, i) => {
        assert.ok(words.length >= 3, `${t.id} level ${i + 1} has ${words.length}`)
        assert.ok(words.every(tidy), `${t.id} level ${i + 1} has a malformed item`)
        assert.ok(bank.general[t.id][i] <= words.length, `${t.id} level ${i + 1} general count`)
      })
      assert.equal(dupes(levels.flat()), 0, `${t.id} has duplicates`)
    }
    for (const l of [1, 2, 3]) {
      assert.ok(bankPool('words', bank, { topic: 'mixed', levels: [l] }).length >= (lang === 'es' ? 300 : 600), `mixed level ${l} too small`)
    }
  })

  test(`charades ${lang}: three levels, no duplicates`, async () => {
    const bank = await load('charades', lang)
    assert.equal(bank.length, 3)
    bank.forEach((words, i) => {
      assert.ok(words.length >= (lang === 'es' ? 100 : 200), `level ${i + 1} has ${words.length}`)
      assert.ok(words.every(tidy), `level ${i + 1} has a malformed item`)
    })
    assert.equal(dupes(bank.flat()), 0)
  })

  test(`undercover ${lang}: distinct pairs, no word in two pairs`, async () => {
    const bank = await load('undercover', lang)
    assert.ok(bank.length >= (lang === 'es' ? 300 : 600), `${bank.length} pairs`)
    assert.ok(bank.every((p) => p.length === 2 && p.every(tidy) && p[0].toLowerCase() !== p[1].toLowerCase()), 'malformed pair')
    assert.equal(dupes(bank.flat()), 0, 'a word appears in two pairs')
  })
}

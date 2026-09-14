import { h, sheet, segmented, clear } from './dom.js'
import { settings, activeTopic, activeLanguage } from '../core/settings.js'
import { TOPIC_PRESETS, TOPIC_BY_ID } from '../content/packs/topics.js'
import { sfx } from '../core/audio.js'
import { haptic } from '../core/haptics.js'
import './content-setup.css'

/** Quick mute toggle for game topbars, so sound is reachable without opening settings. */
export function muteButton() {
  const btn = h('button', { class: 'icon-btn', 'aria-label': 'Toggle sound' })
  const paint = () => {
    btn.textContent = settings.get('sound') ? '🔊' : '🔇'
    btn.setAttribute('aria-pressed', String(settings.get('sound')))
  }
  btn.onclick = () => {
    settings.set({ sound: !settings.get('sound') })
    paint()
    haptic()
    sfx('tap')
  }
  paint()
  return btn
}

export function topicLabel() {
  const s = settings.all
  if (s.topic === 'custom') return { emoji: '✨', name: s.customTopic.trim() || 'Custom topic' }
  if (s.topic === 'mixed') return { emoji: '🎲', name: 'Anything goes' }
  const t = TOPIC_BY_ID[s.topic]
  if (!t) return { emoji: '🎲', name: 'Anything goes' }
  return { emoji: t.emoji, name: s.language === 'ru' ? t.ru : t.en }
}

function openTopicPicker(onPick) {
  sheet('Pick a topic', (close) => {
    const body = h('div', { class: 'stack' })
    const lang = settings.get('language')
    const custom = h('input', {
      class: 'field', type: 'text', value: settings.get('customTopic'),
      placeholder: 'e.g. things a 40 and a 20 year old picture differently',
      'aria-label': 'Custom topic',
    })
    const useCustom = h('button', { class: 'btn btn-primary btn-block' }, 'Use this topic')
    useCustom.onclick = () => {
      const v = custom.value.trim()
      if (!v) return
      settings.set({ topic: 'custom', customTopic: v })
      sfx('select'); haptic('select')
      onPick(); close()
    }

    const grid = h('div', { class: 'topic-grid' })
    const tiles = [
      { id: 'mixed', emoji: '🎲', en: 'Anything goes', ru: 'Всё подряд' },
      ...TOPIC_PRESETS.filter((t) => t.id !== 'mixed'),
    ]
    const search = h('input', { class: 'field', type: 'search', placeholder: 'Search topics…', 'aria-label': 'Search topics' })
    const draw = (q = '') => {
      const needle = q.trim().toLowerCase()
      clear(grid)
      for (const t of tiles) {
        const name = lang === 'ru' ? t.ru : t.en
        if (needle && !name.toLowerCase().includes(needle) && !t.en.toLowerCase().includes(needle)) continue
        grid.append(
          h('button', {
            class: 'topic-tile', 'aria-pressed': String(settings.get('topic') === t.id),
            onclick: () => {
              settings.set({ topic: t.id })
              sfx('select'); haptic('select')
              onPick(); close()
            },
          }, h('span', { class: 'e' }, t.emoji), h('span', {}, name))
        )
      }
      if (!grid.children.length) grid.append(h('p', { class: 'tiny dim' }, 'No preset matches — use a custom topic above.'))
    }
    search.oninput = () => draw(search.value)
    draw()

    body.append(
      h('div', { class: 'stack', style: { gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' } },
        h('div', { class: 'label' }, 'Your own topic'),
        custom, useCustom,
        h('p', { class: 'tiny dim' }, 'Anything goes — a category, a vibe, or a whole instruction.')),
      h('div', { class: 'label' }, 'Presets'),
      search, grid
    )
    return body
  })
}

/**
 * Shared pre-game content controls. `onChange` fires whenever the content config changes.
 */
export function contentSetup({ onChange, showFormat = true } = {}) {
  const wrap = h('div', { class: 'setup-body' })
  const notify = () => onChange?.({ topic: activeTopic(), language: activeLanguage() })

  const topicBtn = h('button', { class: 'topic-btn' })
  const paintTopic = () => {
    const { emoji, name } = topicLabel()
    clear(topicBtn).append(
      h('span', { class: 't-emoji' }, emoji),
      h('span', { class: 'grow stack', style: { gap: '2px' } },
        h('span', { class: 'label' }, 'Topic'),
        h('span', { class: 't-name' }, name)),
      h('span', { class: 'dim' }, '›')
    )
  }
  topicBtn.onclick = () => { sfx('tap'); haptic(); openTopicPicker(() => { paintTopic(); notify() }) }
  paintTopic()

  const LEVELS = ['Dead easy', 'Easy', 'Normal', 'Hard', 'Brutal']
  const diffLabel = h('span', { class: 'tiny dim' }, LEVELS[settings.get('difficulty') - 1])
  const diff = h('div', { class: 'diff-dots', role: 'group', 'aria-label': 'Difficulty' })
  const paintDiff = () => {
    clear(diff)
    for (let i = 1; i <= 5; i++) {
      diff.append(h('button', {
        'aria-pressed': String(settings.get('difficulty') === i),
        'aria-label': `Difficulty ${i} of 5`,
        onclick: () => {
          settings.set({ difficulty: i })
          diffLabel.textContent = LEVELS[i - 1]
          sfx('tap'); haptic(); paintDiff(); notify()
        },
      }, String(i)))
    }
  }
  paintDiff()

  const langRow = h('div', { class: 'stack', style: { gap: 'var(--sp-2)' } },
    h('div', { class: 'label' }, 'Language'),
    segmented(
      [{ value: 'en', label: 'English' }, { value: 'ru', label: 'Русский' }, { value: 'custom', label: 'Other…' }],
      settings.get('language'),
      (v) => {
        settings.set({ language: v })
        customLang.hidden = v !== 'custom'
        paintTopic()
        notify()
      },
      { label: 'Language' }
    ))
  const customLang = h('input', {
    class: 'field', type: 'text', value: settings.get('customLanguage'),
    placeholder: 'e.g. Spanish, Polish, Japanese…', 'aria-label': 'Custom language',
    hidden: settings.get('language') !== 'custom',
    oninput: (e) => { settings.set({ customLanguage: e.target.value }); notify() },
  })
  langRow.append(customLang)

  wrap.append(
    topicBtn,
    h('div', { class: 'stack', style: { gap: 'var(--sp-2)' } },
      h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Difficulty'), diffLabel),
      diff)
  )
  if (showFormat) {
    wrap.append(h('div', { class: 'stack', style: { gap: 'var(--sp-2)' } },
      h('div', { class: 'label' }, 'Format'),
      segmented(
        [{ value: 'word', label: 'Single word' }, { value: 'phrase', label: 'Phrase' }, { value: 'both', label: 'Both' }],
        settings.get('format'),
        (v) => { settings.set({ format: v }); notify() },
        { label: 'Format' }
      )))
  }
  wrap.append(langRow)

  return wrap
}

export function feedStatusLine(feed) {
  const el = h('div', { class: 'feed-status', role: 'status' })
  const paint = (status, size) => {
    clear(el)
    if (status.state === 'no-key') {
      el.append(h('span', { class: 'dot warn' }), 'Needs an OpenRouter key')
    } else if (status.state === 'loading' && size < 5) {
      el.append(h('span', { class: 'spinner' }), 'Writing fresh words…')
    } else if (status.state === 'error' && size < 5) {
      el.append(h('span', { class: 'dot bad' }), status.error?.message || 'Generation failed')
    } else if (size) {
      el.append(h('span', { class: 'dot' }), `${size} ready`)
    } else {
      el.append(h('span', { class: 'dot warn' }), 'No words yet')
    }
  }
  const off = feed.subscribe(paint)
  el.dispose = off
  return el
}

/**
 * Start button that turns into a key prompt when there is no API key, and stays
 * in sync if the key is added from the settings sheet without leaving the screen.
 */
export function startButton(label, onStart) {
  const btn = h('button', { class: 'btn btn-primary btn-lg btn-block' })
  const hasKey = () => !!String(settings.get('apiKey') || '').trim()
  const paint = () => {
    btn.textContent = hasKey() ? label : '🔑  Add your OpenRouter key'
  }
  btn.onclick = async () => {
    sfx('tap')
    haptic('select')
    if (!hasKey()) {
      const { openSettings } = await import('./settings.js')
      openSettings()
      return
    }
    onStart(btn)
  }
  const off = settings.subscribe(paint)
  paint()
  btn.dispose = off
  return btn
}

export function noKeyBanner() {
  const el = h('div', {})
  const paint = () => {
    clear(el)
    if (String(settings.get('apiKey') || '').trim()) return
    el.append(
      h('div', { class: 'banner' }, '🔑',
        h('span', {},
          'Words are written on demand by a model, so this app needs your own ',
          h('strong', {}, 'OpenRouter key'),
          '. Add one in settings — it is stored only on this device.'))
    )
  }
  const off = settings.subscribe(paint)
  paint()
  el.dispose = off
  return el
}

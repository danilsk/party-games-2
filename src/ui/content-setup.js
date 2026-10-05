import { h, sheet, segmented, clear, toast } from './dom.js'
import { settings, activeTopic, activeLanguage } from '../core/settings.js'
import { TOPIC_PRESETS, TOPIC_BY_ID, topicName } from '../content/packs/topics.js'
import { bankLanguage } from '../content/bank.js'
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

const uiLanguage = () => bankLanguage(activeLanguage()) || 'en'

export function topicLabel() {
  const s = settings.all
  const lang = uiLanguage()
  if (s.topic === 'custom') return { emoji: '✨', name: s.customTopic.trim() || 'Custom topic' }
  const t = TOPIC_BY_ID[s.topic]
  if (s.topic === 'mixed' || !t) return { emoji: '🎲', name: ANYTHING[lang] }
  return { emoji: t.emoji, name: topicName(t, lang) }
}

const ANYTHING = { en: 'Anything goes', ru: 'Всё подряд', es: 'De todo' }

function openTopicPicker(onPick) {
  sheet('Pick a topic', (close) => {
    const body = h('div', { class: 'stack' })
    const lang = uiLanguage()
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
      { id: 'mixed', emoji: '🎲', ...ANYTHING },
      ...TOPIC_PRESETS.filter((t) => t.id !== 'mixed'),
    ]
    const search = h('input', { class: 'field', type: 'search', placeholder: 'Search topics…', 'aria-label': 'Search topics' })
    const draw = (q = '') => {
      const needle = q.trim().toLowerCase()
      clear(grid)
      for (const t of tiles) {
        const name = topicName(t, lang)
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

const LEVELS = [{ value: 1, label: 'Easy' }, { value: 2, label: 'Medium' }, { value: 3, label: 'Hard' }]

/** Multi-select level toggles; the last selected level cannot be switched off. */
function levelToggles(onChange) {
  const wrap = h('div', { class: 'level-toggles', role: 'group', 'aria-label': 'Levels' })
  const paint = () => {
    const on = settings.get('levels')
    clear(wrap)
    for (const { value, label } of LEVELS) {
      const pressed = on.includes(value)
      wrap.append(h('button', {
        'aria-pressed': String(pressed),
        onclick: () => {
          if (pressed && on.length === 1) {
            sfx('skip'); haptic('skip')
            return toast('Keep at least one level')
          }
          settings.set({ levels: pressed ? on.filter((l) => l !== value) : [...on, value].sort() })
          sfx('tap'); haptic(); paint(); onChange()
        },
      }, label))
    }
  }
  paint()
  return wrap
}

/**
 * Shared pre-game content controls. `onChange` fires whenever the content config changes.
 */
export function contentSetup({ onChange, topic = false, levels = false } = {}) {
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

  const langSeg = segmented(
    [{ value: 'en', label: 'English' }, { value: 'ru', label: 'Русский' }, { value: 'es', label: 'Español' }, { value: 'custom', label: 'Other…' }],
    settings.get('language'),
    (v) => {
      settings.set({ language: v })
      customLang.hidden = v !== 'custom'
      paintTopic()
      notify()
    },
    { label: 'Language' }
  )
  langSeg.classList.add('compact')
  const langRow = h('div', { class: 'stack', style: { gap: 'var(--sp-2)' } }, h('div', { class: 'label' }, 'Language'), langSeg)
  const customLang = h('input', {
    class: 'field', type: 'text', value: settings.get('customLanguage'),
    placeholder: 'e.g. Polish, Japanese, Ukrainian…', 'aria-label': 'Custom language',
    hidden: settings.get('language') !== 'custom',
    oninput: (e) => { settings.set({ customLanguage: e.target.value }); paintTopic(); notify() },
  })
  langRow.append(customLang)

  if (topic) wrap.append(topicBtn)
  if (levels) {
    wrap.append(h('div', { class: 'stack', style: { gap: 'var(--sp-2)' } },
      h('div', { class: 'row' }, h('span', { class: 'label grow' }, 'Levels'), h('span', { class: 'tiny dim' }, 'Pick one or more')),
      levelToggles(notify)))
  }
  wrap.append(langRow)

  return wrap
}

/** Re-runs `fn` when the key or model changes, so a key added mid-screen takes effect. */
export function onCredentialsChange(fn) {
  let { apiKey, model, effort } = settings.all
  return settings.subscribe((s) => {
    if (s.apiKey === apiKey && s.model === model && s.effort === effort) return
    apiKey = s.apiKey
    model = s.model
    effort = s.effort
    fn()
  })
}

export function feedStatusLine(feed) {
  const el = h('div', { class: 'feed-status', role: 'status' })
  const paint = (status, size) => {
    clear(el)
    if (status.state === 'no-key') {
      el.append(h('span', { class: 'dot warn' }), 'Needs an OpenRouter key')
    } else if (status.state === 'exhausted') {
      el.append(h('span', { class: 'dot warn' }), h('span', { class: 'grow' }, 'You have played every word here'),
        h('button', {
          class: 'link-btn',
          onclick: async () => {
            sfx('tap'); haptic()
            await feed.replay()
            toast('Old words are back in the deck')
          },
        }, 'Play them again'))
    } else if (status.state === 'loading' && size < 5) {
      el.append(h('span', { class: 'spinner' }), 'Writing fresh words…')
    } else if (status.state === 'error' && size < 5) {
      el.append(h('span', { class: 'dot bad' }), status.error?.message || 'Generation failed')
    } else if (size) {
      el.append(h('span', { class: 'dot' }), `${size.toLocaleString()} ready`)
    } else if (!feed.loaded) {
      el.append(h('span', { class: 'spinner' }), 'Loading words…')
    } else {
      el.append(h('span', { class: 'dot warn' }), 'No words yet')
    }
  }
  const off = feed.subscribe(paint)
  el.dispose = off
  return el
}

/**
 * Start button that turns into a key prompt when the setup has no built-in words and no key,
 * and stays in sync if the key is added from the settings sheet without leaving the screen.
 */
export function startButton(label, onStart, feed) {
  const btn = h('button', { class: 'btn btn-primary btn-lg btn-block' })
  const paint = () => {
    btn.textContent = feed.needsKey ? '🔑  Add your OpenRouter key' : label
  }
  btn.onclick = async () => {
    sfx('tap')
    haptic('select')
    if (feed.needsKey) {
      const { openSettings } = await import('./settings.js')
      openSettings()
      return
    }
    onStart(btn)
  }
  const offFeed = feed.subscribe(paint)
  const offSettings = settings.subscribe(paint)
  btn.dispose = () => { offFeed(); offSettings() }
  return btn
}

export function noKeyBanner(feed) {
  const el = h('div', {})
  const paint = () => {
    clear(el)
    if (!feed.needsKey) return
    el.append(
      h('div', { class: 'banner' }, '🔑',
        h('span', {},
          'There are no built-in words for this setup, so a model writes them on demand. Add your own ',
          h('strong', {}, 'OpenRouter key'),
          ' in settings — it is stored only on this device.'))
    )
  }
  const off = feed.subscribe(paint)
  el.dispose = off
  return el
}

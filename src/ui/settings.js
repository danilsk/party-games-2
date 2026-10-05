import { h, sheet, switchRow, segmented, toast } from './dom.js'
import { settings, DEFAULTS } from '../core/settings.js'
import { sfx } from '../core/audio.js'
import { haptic } from '../core/haptics.js'
import { historySummary, clearHistory } from '../content/history.js'
import { applyTheme } from '../core/theme.js'
import { motionSupport } from '../games/headsup/tilt-sensor.js'
import { installPrompt } from '../core/install.js'

const section = (title, ...children) =>
  h('section', { class: 'stack', style: { marginBottom: 'var(--sp-6)' } },
    h('div', { class: 'label' }, title),
    ...children
  )

export function openSettings() {
  sheet('Settings', () => {
    const body = h('div', { class: 'stack' })

    const keyField = h('input', {
      class: 'field', type: 'password', value: settings.get('apiKey'),
      placeholder: 'sk-or-v1-…', autocomplete: 'off', autocapitalize: 'off',
      spellcheck: 'false', 'aria-label': 'OpenRouter API key',
      oninput: (e) => settings.set({ apiKey: e.target.value.trim() }),
    })
    const modelField = h('input', {
      class: 'field', type: 'text', value: settings.get('model'),
      placeholder: DEFAULTS.model, autocapitalize: 'off', spellcheck: 'false',
      'aria-label': 'Model ID', style: { minWidth: '0' },
      oninput: (e) => { settings.set({ model: e.target.value.trim() || DEFAULTS.model }); paintReset() },
    })
    const effortSlot = h('div', {})
    const paintEffort = () => effortSlot.replaceChildren(segmented(
      [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }],
      settings.get('effort'),
      (v) => { settings.set({ effort: v }); paintReset() },
      { label: 'Thinking effort' }
    ))
    const resetModel = h('button', {
      class: 'btn', style: { flex: 'none' },
      onclick: () => {
        settings.set({ model: DEFAULTS.model, effort: DEFAULTS.effort })
        modelField.value = DEFAULTS.model
        paintEffort()
        paintReset()
        toast('Back to the default model')
      },
    }, 'Reset')
    const paintReset = () => {
      resetModel.disabled = settings.get('model') === DEFAULTS.model && settings.get('effort') === DEFAULTS.effort
    }
    paintEffort()
    paintReset()

    const testBtn = h('button', { class: 'btn' }, 'Test key')
    testBtn.onclick = async () => {
      const key = settings.get('apiKey')
      if (!key) return toast('Add a key first', { bad: true })
      testBtn.disabled = true
      testBtn.textContent = 'Testing…'
      try {
        const { generateWords } = await import('../content/openrouter.js')
        const items = await generateWords({
          apiKey: key, model: settings.get('model'), effort: settings.get('effort'), count: 3,
          language: 'en', topic: 'animals', levels: [1], history: [],
        })
        toast(items.length ? `Works — e.g. “${items[0]}”` : 'Connected, but no items came back', { bad: !items.length })
      } catch (e) {
        toast(e.message || 'Request failed', { bad: true })
      } finally {
        testBtn.disabled = false
        testBtn.textContent = 'Test key'
      }
    }

    body.append(
      section('Word generation',
        h('p', { class: 'tiny dim' },
          'Built-in words cover English, Russian and Spanish, so a key is optional. With your own OpenRouter key, a model writes fresh words once the built-in ones run out, for other languages and for your own topics. The key is stored only on this device and sent straight to OpenRouter.'),
        h('div', { class: 'banner' }, '🔐',
          h('span', {},
            h('strong', {}, 'Why your own key? '),
            'This app is a static site on GitHub Pages. Any key shipped in its source would be readable by anyone who opens it, so there is no built-in key.')),
        keyField,
        h('div', { class: 'row' }, modelField, resetModel),
        h('div', { class: 'stack', style: { gap: 'var(--sp-2)' } },
          h('span', { class: 'tiny dim' }, 'Thinking effort'),
          effortSlot,
          h('span', { class: 'tiny dim' }, 'Low is fast and plenty for word games. Ignored by models that do not think.')),
        h('div', { class: 'row' }, testBtn,
          h('a', { class: 'btn btn-ghost grow', href: 'https://openrouter.ai/keys', target: '_blank', rel: 'noopener noreferrer' }, 'Get a key ↗'))
      ),

      section('Feel',
        switchRow('Sound effects', settings.get('sound'), (v) => { settings.set({ sound: v }); if (v) sfx('select') }),
        switchRow('Vibration', settings.get('haptics'), (v) => { settings.set({ haptics: v }); if (v) haptic('select') },
          'vibrate' in navigator ? null : 'Not supported on this device'),
        h('div', { class: 'stack', style: { gap: 'var(--sp-2)' } },
          h('span', { class: 'tiny dim' }, 'Theme'),
          segmented(
            [{ value: 'auto', label: 'Auto' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }],
            settings.get('theme'),
            (v) => { settings.set({ theme: v }); applyTheme() },
            { label: 'Theme' }
          ))
      ),

      headsUpSection(),
      historySection()
    )

    if (installPrompt.available) {
      body.append(section('App',
        h('button', { class: 'btn btn-primary btn-block', onclick: () => installPrompt.show() }, '📲 Install app')))
    }

    body.append(
      h('p', { class: 'tiny dim center', style: { marginTop: 'var(--sp-4)' } },
        `Party Games v${__APP_VERSION__} · build ${__BUILD__} · ${installPrompt.displayMode} · Back: ${'CloseWatcher' in window ? 'CloseWatcher' : 'fallback'}`)
    )
    return body
  })
}

function headsUpSection() {
  const { hasMotion, needsPermission } = motionSupport()
  const secs = h('output', { class: 'tiny dim' }, `${settings.get('roundSeconds')}s`)
  return section('Heads Up',
    h('div', { class: 'stack', style: { gap: 'var(--sp-2)' } },
      h('div', { class: 'row' }, h('span', { class: 'tiny dim grow' }, 'Round length'), secs),
      h('input', {
        class: 'range', type: 'range', min: '30', max: '120', step: '15',
        value: String(settings.get('roundSeconds')), 'aria-label': 'Round length in seconds',
        oninput: (e) => { secs.textContent = `${e.target.value}s`; settings.set({ roundSeconds: +e.target.value }) },
      })),
    h('div', { class: 'stack', style: { gap: 'var(--sp-2)' } },
      h('span', { class: 'tiny dim' }, 'Tilt sensitivity'),
      segmented(
        [{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'strict', label: 'Strict' }],
        settings.get('headsUpSensitivity'),
        (v) => settings.set({ headsUpSensitivity: v }),
        { label: 'Tilt sensitivity' }
      ),
      h('span', { class: 'tiny dim' }, 'Easy needs a smaller tilt. Strict ignores more accidental movement.')),
    switchRow('Invert tilt direction', settings.get('invertTilt'), (v) => settings.set({ invertTilt: v }),
      'Only if forward and backward come out swapped on your phone'),
    !hasMotion && h('div', { class: 'banner' }, '⚠️', 'This device reports no motion sensors — Heads Up will use on-screen buttons.'),
    hasMotion && needsPermission && h('p', { class: 'tiny dim' }, 'iOS asks for motion access when a round starts.')
  )
}

function historySection() {
  const list = h('div', { class: 'stack', style: { gap: 'var(--sp-2)' } }, h('span', { class: 'tiny dim' }, 'Loading…'))
  const refresh = async () => {
    const rows = await historySummary()
    list.replaceChildren(
      ...(rows.length
        ? rows.slice(0, 12).map((r) =>
            h('div', { class: 'row tiny' },
              h('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                `${{ pairs: '🕵️', mime: '🎭' }[r.mode] || '💬'} ${r.topic} · ${r.language}`),
              h('span', { class: 'dim' }, `${r.count}`)))
        : [h('span', { class: 'tiny dim' }, 'Nothing played yet.')])
    )
  }
  refresh()
  return section('Word memory',
    h('p', { class: 'tiny dim' }, 'Every word you have seen is remembered, so it does not come back. Clear this to play old words again.'),
    list,
    h('button', {
      class: 'btn btn-danger btn-block',
      onclick: async () => {
        await clearHistory()
        await refresh()
        toast('Word memory cleared')
      },
    }, 'Clear word memory')
  )
}

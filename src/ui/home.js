import { h, clear } from './dom.js'
import { GAMES } from '../games/registry.js'
import { navigate } from '../core/router.js'
import { sfx } from '../core/audio.js'
import { haptic } from '../core/haptics.js'
import { openSettings } from './settings.js'
import { installPrompt } from '../core/install.js'
import './home.css'

export function renderHome(root) {
  document.documentElement.removeAttribute('data-game')
  clear(root)
  const screen = h('div', { class: 'screen' })

  screen.append(
    h('div', { class: 'topbar' },
      h('span', { class: 'spacer' }),
      h('button', {
        class: 'icon-btn', 'aria-label': 'Settings',
        onclick: () => { sfx('tap'); haptic(); openSettings() },
      }, '⚙️')
    ),
    h('header', { class: 'home-hero' },
      h('div', { class: 'kicker' }, 'Pass the phone'),
      h('h1', {}, 'Party', h('br'), 'Games')
    )
  )

  const list = h('div', { class: 'game-list' })
  GAMES.forEach((g, i) => {
    list.append(
      h('button', {
        class: 'game-card', dataset: { game: g.id }, style: { '--i': i },
        onclick: () => { sfx('select'); haptic('select'); navigate(`/g/${g.id}`) },
      },
        h('span', { class: 'emoji', 'aria-hidden': 'true' }, g.emoji),
        h('span', { class: 'meta' },
          h('span', { class: 'name', style: { display: 'block' } }, g.name),
          h('span', { class: 'tag', style: { display: 'block' } }, g.tagline),
          h('span', { class: 'players' }, g.players)
        )
      )
    )
  })
  screen.append(list)

  const foot = h('div', { class: 'home-foot' })
  if (installPrompt.available) {
    foot.append(
      h('button', {
        class: 'install-pill',
        onclick: async () => { haptic(); await installPrompt.show() },
      }, '📲', h('span', { class: 'grow' }, 'Install to your home screen'), '›')
    )
  }
  foot.append(h('p', { class: 'tiny dim center' }, 'Every word is written fresh · add your OpenRouter key in settings to play'))
  screen.append(foot)
  root.append(screen)
}

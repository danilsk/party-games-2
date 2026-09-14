import { h, clear, toast, sheet, holdable } from '../../ui/dom.js'
import { back, navigate } from '../../core/router.js'
import { settings, activeTopic, activeLanguage } from '../../core/settings.js'
import { sfx, unlockAudio } from '../../core/audio.js'
import { haptic } from '../../core/haptics.js'
import { keepAwake } from '../../core/wakelock.js'
import { pairFeed, feedConfigFromSettings } from '../../content/feed.js'
import { contentSetup, feedStatusLine, muteButton, startButton, noKeyBanner } from '../../ui/content-setup.js'
import { lsGet, lsSet } from '../../core/storage.js'
import {
  createGame, wordFor, alive, spyOf, markSeen, eliminate, spyComesForward,
  submitGuess, defaultNames, MIN_PLAYERS, MAX_PLAYERS,
} from './game.js'
import './undercover.css'

const HOLD_MS = 1200

export function mount(root) {
  let teardown = () => {}
  const show = (fn, arg) => {
    teardown()
    teardown = fn(root, show, arg) || (() => {})
  }
  show(setupScreen)
  return () => {
    teardown()
    keepAwake(false)
  }
}

/* ---------------------------------- setup --------------------------------- */

function setupScreen(root, show) {
  clear(root)
  let names = lsGet('uc:names', defaultNames(4))
  if (!Array.isArray(names) || names.length < MIN_PLAYERS) names = defaultNames(4)

  const status = h('div', {})
  const sync = async () => {
    await pairFeed.configure(feedConfigFromSettings(settings.all, activeLanguage(), activeTopic()))
    clear(status).append(feedStatusLine(pairFeed))
    pairFeed.prime()
  }

  const nameList = h('div', { class: 'uc-names' })
  const countEl = h('div', { class: 'n' }, String(names.length))

  const drawNames = () => {
    clear(nameList)
    names.forEach((n, i) => {
      nameList.append(
        h('div', { class: 'row' },
          h('span', { class: 'idx' }, String(i + 1)),
          h('input', {
            class: 'field', type: 'text', value: n, maxlength: '18',
            'aria-label': `Player ${i + 1} name`,
            oninput: (e) => { names[i] = e.target.value; lsSet('uc:names', names) },
          })
        )
      )
    })
    countEl.textContent = String(names.length)
  }

  const setCount = (n) => {
    n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n))
    if (n === names.length) return
    if (n > names.length) while (names.length < n) names.push(`Player ${names.length + 1}`)
    else names = names.slice(0, n)
    lsSet('uc:names', names)
    sfx('tap'); haptic()
    drawNames()
  }
  drawNames()

  const banner = noKeyBanner()
  const startBtn = startButton('▶︎  Deal words', async (btn) => {
    unlockAudio()
    btn.disabled = true
    btn.textContent = 'Getting a pair…'
    await pairFeed.prime()
    const pair = await pairFeed.takeAsync()
    btn.disabled = false
    btn.textContent = '▶︎  Deal words'
    if (!pair) return toast(pairFeed.status.error?.message || 'Could not get a word pair', { bad: true })
    try {
      show(playScreen, createGame({ names, pair }))
    } catch (e) {
      toast(e.message, { bad: true })
    }
  })

  const screen = h('div', { class: 'screen' },
    h('div', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back', onclick: () => back() }, '‹'),
      h('h2', {}, '🕵️ Undercover'),
      muteButton(),
      h('button', { class: 'icon-btn', 'aria-label': 'How to play', onclick: howToPlay }, '?')
    ),
    h('div', { class: 'setup' },
      h('div', { class: 'setup-body' },
        h('div', { class: 'stack', style: { gap: 'var(--sp-2)' } },
          h('div', { class: 'label' }, 'Players'),
          h('div', { class: 'uc-count' },
            h('button', { 'aria-label': 'Fewer players', onclick: () => setCount(names.length - 1) }, '−'),
            countEl,
            h('button', { 'aria-label': 'More players', onclick: () => setCount(names.length + 1) }, '+')
          )),
        nameList,
        contentSetup({ onChange: sync, showFormat: false })
      ),
      h('div', { class: 'stack' }, banner, status, startBtn)
    )
  )
  root.append(screen)
  sync()
  return () => {
    status.firstChild?.dispose?.()
    startBtn.dispose?.()
    banner.dispose?.()
  }
}

function howToPlay() {
  sheet('How to play', () =>
    h('div', { class: 'stack tiny' },
      h('p', {}, 'Everyone gets the same secret word — except one ', h('strong', {}, 'spy'), ', who gets a different but similar word.'),
      h('p', {}, h('strong', {}, '1. '), 'Pass the phone around. Each player holds their own row to read their word privately.'),
      h('p', {}, h('strong', {}, '2. '), 'Take turns describing your word with a single clue. Never say the word itself.'),
      h('p', {}, h('strong', {}, '3. '), 'Talk it over, then eliminate whoever seems off.'),
      h('p', {}, h('strong', {}, '4. '), 'Catch the spy and they get one chance to guess your word. Guess right and the spy steals the win.'),
      h('p', { class: 'dim' }, 'The spy can also own up early by tapping “Spy comes forward”.')
    )
  )
}

/* ---------------------------------- play ---------------------------------- */

function playScreen(root, show, game) {
  clear(root)
  keepAwake(true)

  const list = h('div', { class: 'uc-players' })
  const hint = h('p', { class: 'tiny dim center' })
  const actions = h('div', { class: 'stack' })

  const revealSecret = (p) => {
    const overlay = h('div', { class: 'uc-secret' },
      h('div', { class: 'who' }, p.name),
      h('div', { class: 'word' }, wordFor(game, p.id)),
      h('div', { class: 'keep' }, 'Let go to hide')
    )
    document.body.append(overlay)
    sfx('reveal'); haptic('reveal')
    return () => overlay.remove()
  }

  let holds = []
  const draw = () => {
    holds.forEach((d) => d())
    holds = []
    clear(list)
    for (const p of game.players) {
      const charge = h('div', { class: 'charge' })
      const row = h('button', {
        class: `uc-player${p.seen ? ' seen' : ''}${p.out ? ' out' : ''}`,
        'aria-label': game.phase === 'reveal' ? `Hold to see ${p.name}'s word` : p.name,
      },
        charge,
        h('span', { class: 'avatar' }, (p.name.trim()[0] || '?').toUpperCase()),
        h('span', { class: 'nm' }, p.name),
        h('span', { class: 'tag' }, p.out ? 'out' : p.seen ? '✓' : 'hold')
      )

      if (game.phase === 'reveal' && !p.seen) {
        let hideFn = null
        holds.push(holdable(row, {
          holdMs: HOLD_MS,
          onProgress: (v) => { charge.style.transform = `scaleX(${v})` },
          onComplete: () => {
            hideFn = revealSecret(p)
            const release = () => {
              hideFn?.(); hideFn = null
              markSeen(game, p.id)
              sfx('hide')
              draw()
              window.removeEventListener('pointerup', release)
              window.removeEventListener('pointercancel', release)
            }
            window.addEventListener('pointerup', release)
            window.addEventListener('pointercancel', release)
          },
          onCancel: () => { charge.style.transform = 'scaleX(0)' },
        }))
      } else if (game.phase === 'discuss' && !p.out) {
        row.onclick = () => confirmEliminate(p)
      }
      list.append(row)
    }

    clear(actions)
    if (game.phase === 'reveal') {
      const left = game.players.filter((x) => !x.seen).length
      hint.textContent = `Pass the phone around · ${left} still to look`
    } else if (game.phase === 'discuss') {
      hint.textContent = `${alive(game).length} still in · tap a player to eliminate them`
      actions.append(
        h('button', {
          class: 'btn btn-lg btn-block',
          onclick: () => {
            sheet('Spy comes forward', (close) =>
              h('div', { class: 'stack' },
                h('p', { class: 'tiny dim' }, 'Only tap this if you are the spy and want to own up. You still get one guess at the civilians’ word.'),
                h('button', {
                  class: 'btn btn-primary btn-block',
                  onclick: () => { close(); sfx('spy'); haptic('warn'); spyComesForward(game); draw() },
                }, 'I am the spy'),
                h('button', { class: 'btn btn-ghost btn-block', onclick: close }, 'Cancel')
              ))
          },
        }, '🕵️  Spy comes forward')
      )
    }
    if (game.phase === 'guess') return show(guessScreen, game)
    if (game.phase === 'over') return show(verdictScreen, game)
  }

  const confirmEliminate = (p) => {
    sheet(`Eliminate ${p.name}?`, (close) =>
      h('div', { class: 'stack' },
        h('p', { class: 'tiny dim' }, 'Everyone should agree before you do this.'),
        h('button', {
          class: 'btn btn-danger btn-block',
          onclick: () => {
            close()
            const res = eliminate(game, p.id)
            if (res.kind === 'caught-spy') { sfx('spy'); haptic('warn') }
            else if (res.kind === 'spy-wins') { sfx('end'); haptic('end') }
            else { sfx('skip'); haptic('skip'); toast(`${p.name} was not the spy`) }
            draw()
          },
        }, `Eliminate ${p.name}`),
        h('button', { class: 'btn btn-ghost btn-block', onclick: close }, 'Cancel')
      ))
  }

  const screen = h('div', { class: 'screen' },
    h('div', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back to setup', onclick: () => show(setupScreen) }, '‹'),
      h('h2', {}, '🕵️ Undercover'),
      muteButton(),
      h('button', { class: 'icon-btn', 'aria-label': 'How to play', onclick: howToPlay }, '?')
    ),
    h('div', { class: 'setup' },
      h('div', { class: 'setup-body' }, list, hint),
      actions
    )
  )
  root.append(screen)
  draw()
  return () => {
    holds.forEach((d) => d())
    keepAwake(false)
  }
}

/* ---------------------------------- guess --------------------------------- */

function guessScreen(root, show, game) {
  clear(root)
  const spy = spyOf(game)
  const input = h('input', {
    class: 'field', type: 'text', placeholder: 'The civilians’ word…',
    'aria-label': 'Spy guess', autocapitalize: 'off', autocomplete: 'off',
  })
  const submit = () => {
    submitGuess(game, input.value)
    show(verdictScreen, game)
  }
  const screen = h('div', { class: 'screen' },
    h('div', { class: 'topbar' }, h('h2', {}, 'Spy caught!')),
    h('div', { class: 'setup' },
      h('div', { class: 'setup-body center stack' },
        h('div', { style: { fontSize: '76px' } }, '🕵️'),
        h('h2', { style: { fontSize: '28px', fontWeight: '900', letterSpacing: '-0.03em' } }, `${spy.name} was the spy`),
        h('p', { class: 'dim' }, game.surrendered
          ? 'They came forward. One guess at the civilians’ word and they still steal the win.'
          : 'One last chance — guess the civilians’ word and the spy wins anyway.'),
        h('div', { class: 'card stack', style: { width: '100%' } },
          h('div', { class: 'label' }, `${spy.name}’s guess`),
          input)
      ),
      h('div', { class: 'stack' },
        h('button', { class: 'btn btn-primary btn-lg btn-block', onclick: submit }, 'Lock in guess'),
        h('button', { class: 'btn btn-ghost btn-block', onclick: submit }, 'No idea — give up')
      )
    )
  )
  root.append(screen)
  sfx('spy')
  return () => {}
}

/* --------------------------------- verdict -------------------------------- */

function verdictScreen(root, show, game) {
  clear(root)
  keepAwake(false)
  const spy = spyOf(game)
  const o = game.outcome || { winner: 'spy', reason: 'outnumbered' }
  const spyWon = o.winner === 'spy'
  const copy = {
    guessed: 'The spy guessed your word.',
    outnumbered: 'The spy outlasted everyone.',
    caught: 'You caught the spy and they blew the guess.',
    surrendered: 'The spy owned up and could not guess your word.',
  }[o.reason]

  setTimeout(() => { sfx('end'); haptic('end') }, 120)

  const screen = h('div', { class: 'screen' },
    h('div', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Home', onclick: () => navigate('/') }, '‹'),
      h('h2', {}, 'Result')
    ),
    h('div', { class: 'setup' },
      h('div', { class: 'setup-body uc-verdict', style: { justifyContent: 'center' } },
        h('div', { class: 'emoji' }, spyWon ? '🕵️' : '🎉'),
        h('div', { class: 'big' }, spyWon ? 'Spy wins' : 'Civilians win'),
        h('p', { class: 'dim' }, copy),
        h('p', {}, h('strong', {}, spy.name), ' was the spy'),
        o.guess ? h('p', { class: 'tiny dim' }, `Guessed: “${o.guess.trim() || '—'}”`) : null,
        h('div', { class: 'uc-words' },
          h('div', {}, h('div', { class: 'label' }, 'Civilians'), h('div', { class: 'w' }, game.civilianWord)),
          h('div', {}, h('div', { class: 'label' }, 'Spy'), h('div', { class: 'w' }, game.spyWord))
        )
      ),
      h('div', { class: 'stack' },
        h('button', { class: 'btn btn-primary btn-lg btn-block', onclick: () => show(setupScreen) }, '↻  Play again'),
        h('button', { class: 'btn btn-ghost btn-block', onclick: () => navigate('/') }, 'Back to games')
      )
    )
  )
  root.append(screen)
  return () => {}
}

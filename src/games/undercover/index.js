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
  createGame, wordFor, alive, spyOf, markSeen, eliminate, revive, revealWords,
  defaultNames, MIN_PLAYERS, MAX_PLAYERS,
} from './game.js'
import './undercover.css'

const HOLD_MS = 1000

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
            onfocus: (e) => { // iOS ignores select() during the focus event itself
              if (/^Player \d+$/.test(e.target.value)) setTimeout(() => e.target.select(), 0)
            },
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
      h('p', {}, h('strong', {}, '1. '), 'Pass the phone around. Hold your own name to read your word privately — you can do this again any time you forget it.'),
      h('p', {}, h('strong', {}, '2. '), 'Take turns describing your word with a single clue. Never say the word itself.'),
      h('p', {}, h('strong', {}, '3. '), 'Talk it over, then use the 🔫 button to knock out whoever seems off — the app says whether you got the spy, and the round ends if you did.'),
      h('p', {}, h('strong', {}, '4. '), 'If the spy owns up and guesses instead, tap ', h('strong', {}, 'Spy comes forward'), ' to see both words.')
    )
  )
}

/* ---------------------------------- play ---------------------------------- */

function playScreen(root, show, game) {
  clear(root)
  keepAwake(true)

  const list = h('div', { class: 'uc-players' })
  const hint = h('p', { class: 'tiny dim center' })

  const peekWord = (p) => {
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
  let endPeek = null
  const draw = () => {
    holds.forEach((d) => d())
    holds = []
    clear(list)
    for (const p of game.players) {
      const charge = h('div', { class: 'charge' })
      const hold = h('button', {
        class: 'hold',
        'aria-label': `Hold to see ${p.name}'s word`,
      },
        charge,
        h('span', { class: 'avatar' }, (p.name.trim()[0] || '?').toUpperCase()),
        h('span', { class: 'nm' }, p.name),
        h('span', { class: 'tag' }, p.out ? 'out' : p.seen ? '✓' : 'hold')
      )

      holds.push(holdable(hold, {
        holdMs: HOLD_MS,
        onProgress: (v) => { charge.style.transform = `scaleX(${v})` },
        onComplete: () => {
          const hide = peekWord(p)
          endPeek = () => {
            endPeek = null
            hide()
            charge.style.transform = 'scaleX(0)'
            markSeen(game, p.id)
            draw()
            window.removeEventListener('pointerup', release)
            window.removeEventListener('pointercancel', release)
          }
          const release = () => endPeek?.()
          window.addEventListener('pointerup', release)
          window.addEventListener('pointercancel', release)
        },
        onCancel: () => { charge.style.transform = 'scaleX(0)' },
      }))

      const kill = p.out
        ? h('button', { class: 'kill back', 'aria-label': `Bring ${p.name} back`, onclick: () => { revive(game, p.id); sfx('tap'); haptic(); draw() } }, '↩︎')
        : h('button', {
            class: 'kill', 'aria-label': `Knock out ${p.name}`,
            disabled: !p.seen,
            onclick: () => confirmEliminate(p),
          }, '🔫')

      list.append(h('div', { class: `uc-player${p.seen ? ' seen' : ''}${p.out ? ' out' : ''}` }, hold, kill))
    }

    const left = game.players.filter((x) => !x.seen).length
    hint.textContent = left
      ? `Pass the phone around · ${left} still to look`
      : `${alive(game).length} still in · hold a name to see that word again`
  }

  const confirmEliminate = (p) => {
    sheet(`Knock out ${p.name}?`, (close) =>
      h('div', { class: 'stack' },
        h('p', { class: 'tiny dim' }, 'Everyone should agree before you do this.'),
        h('button', {
          class: 'btn btn-danger btn-block',
          onclick: () => {
            close()
            const res = eliminate(game, p.id)
            if (res.kind === 'spy') return show(revealScreen, game)  // announces the catch
            sfx('skip'); haptic('skip')
            draw()
            toast(`${p.name} was not the spy`)
          },
        }, `Knock out ${p.name}`),
        h('button', { class: 'btn btn-ghost btn-block', onclick: close }, 'Cancel')
      ))
  }

  const revealBtn = h('button', {
    class: 'btn btn-primary btn-lg btn-block',
    onclick: () => {
      sheet('Spy comes forward?', (close) =>
        h('div', { class: 'stack' },
          h('p', { class: 'tiny dim' }, 'Use this when the spy owns up. It ends the round and shows everyone both words.'),
          h('button', {
            class: 'btn btn-primary btn-block',
            onclick: () => { close(); revealWords(game); show(revealScreen, game) },
          }, 'Show them'),
          h('button', { class: 'btn btn-ghost btn-block', onclick: close }, 'Cancel')
        ))
    },
  }, '🙋  Spy comes forward')

  const screen = h('div', { class: 'screen' },
    h('div', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Back to setup', onclick: () => show(setupScreen) }, '‹'),
      h('h2', {}, '🕵️ Undercover'),
      muteButton(),
      h('button', { class: 'icon-btn', 'aria-label': 'How to play', onclick: howToPlay }, '?')
    ),
    h('div', { class: 'setup' },
      h('div', { class: 'setup-body' }, list, hint),
      h('div', { class: 'stack' }, revealBtn)
    )
  )
  root.append(screen)
  draw()
  return () => {
    endPeek?.()
    holds.forEach((d) => d())
    keepAwake(false)
  }
}

/* --------------------------------- reveal --------------------------------- */

function revealScreen(root, show, game) {
  clear(root)
  keepAwake(false)
  setTimeout(() => { sfx('end'); haptic('end') }, 120)

  const screen = h('div', { class: 'screen' },
    h('div', { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'Home', onclick: () => navigate('/') }, '‹'),
      h('h2', {}, 'The words')
    ),
    h('div', { class: 'setup' },
      h('div', { class: 'setup-body uc-reveal', style: { justifyContent: 'center' } },
        h('div', { class: 'emoji' }, game.caught ? '🎯' : '🕵️'),
        h('p', {}, h('strong', {}, spyOf(game).name), game.caught ? ' was the spy — caught!' : ' was the spy'),
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

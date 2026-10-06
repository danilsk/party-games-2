# Party Games

An installable PWA with three pass-the-phone party games. Built for smartphones, no
framework, no backend.

**Live:** https://danilsk.github.io/party-games-2/

| | |
|---|---|
| 🙈 **Heads Up** | Phone on your forehead, held horizontally. Tilt forward to score, back to skip. 2+ players. |
| 🎭 **Charades** | The word flashes for two seconds, then hides. Press and hold to peek again. 2+ players. |
| 🕵️ **Undercover** | Everyone gets the same word — except one spy, who gets a suspiciously similar one. Optionally the spy is never told either. 4+ players. |

The games come with large built-in decks in English, Russian and Spanish, written and
reviewed by models ahead of time, so they work without a key and offline. An OpenRouter key
is optional: with one, a model writes fresh words once a deck runs out, for any other
language and for topics you describe yourself.

## Quick start

```bash
npm install
npm run dev               # http://localhost:5173/party-games-2/
npm test                  # unit tests: tilt engine, content feed, undercover rules
npm run test:e2e          # builds, then drives the real bundle in Chromium
npm run test:e2e:webkit   # same suite against WebKit (Safari's engine)
```

## Deployment

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. Enable it once under **Settings → Pages → Source →
GitHub Actions**.

The site is served from `/party-games-2/`, set as `base` in `vite.config.js`. Change that
one constant if you rename the repo. Routing is hash-based (`#/g/headsup`), so deep links
and refreshes work on Pages without any server rewrites or `404.html` tricks.

## Words

**Controls.** Heads Up has a **topic** (75 presets, or anything you type) and
**levels**; Charades has **levels** only; Undercover has neither. Levels are Easy, Medium
and Hard, and are toggles — any mix works, e.g. Medium + Hard. Every game has a
**language**: English, Русский, Español, or any language you type.

**Built-in decks** live in `src/content/bank/`, one module per game and language, loaded
only when that game is played:

| | English | Russian | Spanish |
|---|---|---|---|
| Heads Up words | 15,469 | 15,113 | 8,824 |
| Charades words | 1,260 | 1,225 | 687 |
| Undercover pairs | 996 | 946 | 495 |

Each Heads Up topic has its own deck per level. *Anything goes* draws from every topic, but
only words that everyone knows regardless of topic. In the Mexico, Ukraine and Georgia
decks the level means how far into the country you have to be: famous worldwide, known to
visitors, known to people who live there. Spanish decks use Mexican Spanish. Undercover
pairs are dealt in a random order, so either word can go to the spy.

The decks were written by GPT-6.1 Sol, with extra words for the six topics at the top of the
list written by Claude Opus 5.5. Items were kept only when two judges both approved:
Claude Sonnet 5.5 plus Gemini 3.8 Flash or Claude Opus 5.5 (for
Undercover pairs, both scored it 6/10 or higher). The judges checked that everyone knows the item, that it
plays well, that the language is natural, and its level. A last pass removed near-duplicates,
and no word appears in more than one Undercover pair.

**Your own key.** Open **Settings → Word generation** and paste an
[OpenRouter](https://openrouter.ai/keys) key. Default model is `openai/gpt-6.1-sol` at low
thinking effort; any OpenRouter model ID works, and **Reset** puts the default back. The key
is used when a deck runs out, for a language without a deck, and for custom topics. Without
a key those setups show a prompt to add one; a deck that has run out says so and offers to
play its words again.

> **There is no built-in API key, by design.** This is a static site: anything shipped in
> its source is readable by anyone who opens the page. Your key is stored in this
> browser's `localStorage` and sent only to OpenRouter. Never commit a key to this repo.

Custom topics are not restricted to categories; the model is told to interpret them
literally, so prompts like *"something a 40 and a 20 year old would picture differently"*
work as topics.

### Non-repetition

Every word shown is stored in IndexedDB, keyed by `mode|language|topic`. A deck skips
anything already seen in that game and language under *any* topic, so switching from
*Anything goes* to *Animals* does not bring words back, and changing levels never
resurrects old ones. Generated words are checked the same way, and the most recent 500 for
the topic are sent with each request so the model avoids them. Heads Up and Charades keep
separate memories, and an Undercover pair counts as a repeat in either order. Manage or
clear it under **Settings → Word memory**.

Generated batches are fetched ahead of demand (refill starts while ~14 items remain, which
includes the last words of a deck) and persisted across sessions, so a round does not
normally wait on the network. If it does, the game shows a brief "getting more" state and
resumes rather than dead-ending.

## Heads Up tilt detection

The tilt engine is the most carefully built part of this app and lives in two pieces:

- `src/games/headsup/tilt-core.js` — a pure processor. Samples in, events out, no DOM.
- `src/games/headsup/tilt-sensor.js` — a thin browser adapter for `devicemotion`.

How it works:

- **Gravity via a complementary filter.** The gyroscope predicts how the gravity vector
  moves; the accelerometer corrects it, weighted by how close `|a|` is to 1 g. Shaking
  makes the accelerometer untrustworthy and the gyro carries the estimate through it.
- **Orientation-independent pitch.** The tilt measure is `asin(gravity.z)` — the elevation
  of the screen normal. It is unchanged by in-plane rotation, so landscape-left and
  landscape-right behave identically.
- **Cross-platform sign detection.** iOS reports `accelerationIncludingGravity` inverted
  relative to Android. `deviceorientation` is consistent across both, so it is used as a
  cross-check to detect and correct the accelerometer's sign at runtime. The gyroscope's
  sign is validated the same way by correlation, falling back to a pure low-pass filter if
  the gyro looks unreliable.
- **Calibration.** Neutral is measured from how you are actually holding the phone, while
  still, and then drifts slowly to follow your head. It re-calibrates when the phone leaves
  and returns to horizontal, and adopts a new resting angle if you re-seat the phone.
- **Anti-false-positive.** A tilt must exceed 30° from neutral *and* hold for 100 ms,
  with smoothed linear acceleration under 0.5 g. Measured: a real tilt produces 0.05–0.14 g
  of linear acceleration, shaking produces ~1.4 g. After firing, the phone must return
  within 13° of neutral before anything else can trigger, plus a 360 ms cooldown.
- **Horizontal only.** The round refuses to run in portrait and says so. Because iOS
  rotation lock leaves the viewport portrait even when the phone is physically sideways,
  the round surface detects the real orientation from gravity and rotates itself with CSS.
- **Graceful degradation.** iOS motion permission is requested from the start tap; if it is
  denied or the device has no sensors, on-screen buttons appear instead.

Measured envelope (`test/tilt-envelope.test.js`): fires within 150–270 ms, no false
triggers across a 10 s × amplitude(10–40°) × frequency(1–8 Hz) shake sweep, sustains
alternating play at 650 ms per word.

## Testing

```
test/tilt-core.test.js      25 tests — state machine, calibration, sign detection, recovery
test/tilt-envelope.test.js   5 tests — shake sweep, detection floor, latency, rapid play
test/content.test.js        20 tests — history isolation, refills, dedup, errors, prompts
test/undercover.test.js     16 tests — spy assignment, phases, win conditions, blind spy
test/e2e/run.mjs            48 checks — the built bundle under /party-games-2/, API mocked
test/e2e/live-generation.mjs         — opt-in, hits OpenRouter for real
```

The E2E suite runs against both Chromium and WebKit. WebKit skips the two service-worker
offline checks: Playwright intercepts navigations ahead of the service worker there, so its
offline behaviour cannot be observed (Chromium emulates it correctly). Everything else,
including the full tilt path, passes on both.

Unit tests run the tilt engine against synthetic device traces generated by
`test/helpers/simulate.js`, which builds a gravity vector from a phone pose and derives a
physically consistent gyroscope signal from it. The E2E suite injects the same synthetic
motion into a real browser as motion events, so the whole sensor → UI path — arming,
scoring, skipping, shake rejection, the portrait warning — is exercised without a phone.

The live generation check is skipped unless `OPENROUTER_API_KEY_GENERAL` is set:

```bash
OPENROUTER_API_KEY_GENERAL=sk-or-... node test/e2e/live-generation.mjs
```

## Adding a game

1. Create `src/games/<id>/index.js` exporting `mount(root, ctx)` that returns a teardown.
2. Add an entry to `GAMES` in `src/games/registry.js` with a lazy `load()`.

That is the whole contract. The home screen, router (`#/g/<id>`), per-game theming
(`[data-game="<id>"]` accent tokens) and code-splitting follow automatically. Shared
pieces worth reusing: `contentSetup({ topic, levels })` for the topic, level and language
controls, `startButton()`/`noKeyBanner()` for the API-key gate, `wordFeed`/`mimeFeed`/`pairFeed`
for content,
and `keepAwake`, `sfx`, `haptic`, `holdable`, `sheet`.

## Notes

- Icons are generated from source, not committed as opaque binaries: `npm run icons`.
- Sound is synthesized with the Web Audio API — no audio files to download.
- The service worker precaches the app shell and hashed assets, serves assets cache-first
  and navigations network-first, and never touches cross-origin requests. The built-in decks
  are part of that cache, so the games play offline; only generated words need a connection.
- Fullscreen is enforced everywhere: the manifest asks for `display: fullscreen`, and on top
  of that a gate overlay covers the app whenever `document.fullscreenElement` is empty and
  takes a tap to call `requestFullscreen()` — the only way to keep Android's status bar
  hidden after a system gesture reveals it. The gate returns on every exit and leaves the
  current screen intact. Where the Fullscreen API is missing (iOS Safari) it never appears.
- Screens and sheets use `CloseWatcher` (Chrome 126+) to handle Android Back and desktop
  Escape before history navigation. They share the visible Back action, dispose their
  watchers on exit, and never add dummy history entries. Direct game shortcuts return to
  home even without earlier app history. At home, Back is left to the browser/OS.
  Browsers without CloseWatcher support retain visible Back controls and an Escape fallback;
  their system Back navigates between routes rather than dismissing internal game screens.
- The manifest is fetched network-first and its contents contribute to the service-worker
  cache version. Chrome's installed WebAPK metadata still updates separately: after deploying,
  reinstall for a clean display-mode test. Settings reports the actual display mode and Back
  API. Desktop tests emulate fullscreen state and exercise Escape; physical Android
  testing is still needed for system bars, gestures, rotation, and background/resume.
- Brave blocks motion sensors under Shields' fingerprinting protection. When no motion
  arrives, Heads Up says so, offers a retry, and switches over automatically if the sensors
  start working without a reload.
- Screen sleep is held off with the Wake Lock API during Heads Up and Charades.
- Verified on Chromium and WebKit (Safari's engine) at phone viewport sizes, driven by
  synthetic sensor input. It has not been run on physical handsets — the device-specific
  behaviour most worth checking there is iOS motion permission and the accelerometer sign
  detection, both of which have an escape hatch (**Settings → Invert tilt direction**).
- Requires a browser with ES2020 modules.

## License

MIT

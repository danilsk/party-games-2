# Party Games

An installable PWA with three pass-the-phone party games. Built for smartphones, no
framework, no backend.

**Live:** https://danilsk.github.io/party-games-2/

| | |
|---|---|
| 🙈 **Heads Up** | Phone on your forehead, held horizontally. Tilt forward to score, back to skip. 2+ players. |
| 🎭 **Charades** | The word flashes for two seconds, then hides. Press and hold to peek again. 2+ players. |
| 🕵️ **Undercover** | Everyone gets the same word — except one spy, who gets a suspiciously similar one. 4+ players. |

Every word is written on demand by a model, so the app needs your own OpenRouter key. There
is no bundled word list: nothing repeats, and any topic you can describe in a sentence
works. The app shell is cached for fast loads and installability, but playing needs a
connection.

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

## Word generation (bring your own key)

Open **Settings → Word generation** and paste an [OpenRouter](https://openrouter.ai/keys)
key. Default model is `openai/gpt-5.6-luna`; any OpenRouter model ID works. Without a key
the games show a prompt to add one instead of a Start button.

> **There is no built-in API key, by design.** This is a static site: anything shipped in
> its source is readable by anyone who opens the page. Your key is stored in this
> browser's `localStorage` and sent only to OpenRouter. Never commit a key to this repo.

You control **language** (English, Russian, or any language you type), **difficulty** 1–5,
**format** (single word / phrase / both) and **topic** — 59 presets plus freeform input.
Custom topics are not restricted to categories; the model is told to interpret them
literally, so prompts like *"something a 40 and a 20 year old would picture differently"*
work as topics.

### Non-repetition

Every item ever generated is stored in IndexedDB, keyed by `mode|language|topic`, and the
most recent 500 for that topic are sent with each request so the model actively avoids
them. Topics never contaminate each other, and difficulty/format changes deliberately do
*not* reset the memory — switching to "hard" should not resurrect words you already saw.
Manage or clear it under **Settings → Word memory**.

Batches are fetched ahead of demand (refill starts while ~14 items remain) and the queue is
persisted across sessions, so a round does not normally wait on the network. If the buffer
does drain, the game shows a brief "getting more" state and resumes rather than dead-ending.

The dedup window deliberately matches the window sent to the model. Filtering against more
history than the model was told to avoid would silently discard legitimate items and look
like the model returned nothing.

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
test/undercover.test.js     12 tests — spy assignment, phases, win conditions
test/e2e/run.mjs            43 checks — the built bundle under /party-games-2/, API mocked
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
pieces worth reusing: `contentSetup()` for topic/difficulty/language controls,
`startButton()`/`noKeyBanner()` for the API-key gate, `wordFeed`/`pairFeed` for content,
and `keepAwake`, `sfx`, `haptic`, `holdable`, `sheet`.

## Notes

- Icons are generated from source, not committed as opaque binaries: `npm run icons`.
- Sound is synthesized with the Web Audio API — no audio files to download.
- The service worker precaches the app shell and hashed assets, serves assets cache-first
  and navigations network-first, and never touches cross-origin requests. It makes the app
  load instantly and stay installable; it does not make the games playable offline.
- No fullscreen juggling: the browser/OS chrome stays put and the layout is sized in `svh`,
  so a collapsing toolbar never reflows a round mid-play.
- The hardware back button does exactly what the screen's own `‹` does: screens register
  their back action with `interceptBack()` (so does `sheet()`), so back unwinds sheet →
  screen → game → home instead of jumping straight out of the game.
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

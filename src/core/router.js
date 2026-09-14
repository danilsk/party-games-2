// Hash routing: keeps GitHub Pages deep links working with no server rewrites.

const routes = []
let current = null
let routeHash = ''
let programmatic = false
let swallow = 0

// Screens inside a game are not routes. Rather than pushing history entries of their own —
// Chrome on Android is free to skip script-pushed entries, which walks straight out of the
// game — a screen consumes the back press that would leave the route and puts the route back.
// Overlays (sheets) do carry an entry, pushed inside the tap that opened them.
const backStack = []

export function route(pattern, handler) {
  const keys = []
  const rx = new RegExp(
    '^' +
      pattern.replace(/:(\w+)/g, (_, k) => {
        keys.push(k)
        return '([^/]+)'
      }) +
      '$'
  )
  routes.push({ rx, keys, handler })
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`
  programmatic = true
  if (location.hash === target) return resolve()
  if (!replace) return void (location.hash = path)
  // replaceState fires no hashchange, so the new route has to be resolved by hand.
  history.replaceState(null, '', target)
  resolve()
}

export function back() {
  if (history.length > 1) history.back()
  else navigate('/')
}

/**
 * Register what the back button should do here; returns a disposer.
 * `entry: true` for an overlay that has no route to fall back on.
 */
export function interceptBack(fn, { entry = false } = {}) {
  const item = { fn, entry, live: true }
  backStack.push(item)
  if (entry) history.pushState({ pgBack: true }, '')
  return () => {
    if (!item.live) return
    item.live = false
    const i = backStack.indexOf(item)
    if (i >= 0) backStack.splice(i, 1)
    // Closed some other way: drop its entry too, or it eats the next back press.
    if (entry && i === backStack.length) {
      swallow++
      history.back()
    }
  }
}

function run(item) {
  item.live = false
  backStack.pop()
  item.fn()
}

function onPopState() {
  if (swallow > 0) return void swallow--
  if (location.hash !== routeHash) return // leaving the route: hashchange resolves it
  const top = backStack[backStack.length - 1]
  if (top?.entry) run(top)
}

export function resolve() {
  const viaHistory = !programmatic
  programmatic = false
  const path = location.hash.slice(1) || '/'
  const top = backStack[backStack.length - 1]
  if (viaHistory && top && path !== (routeHash.slice(1) || '/')) {
    history.pushState(null, '', routeHash || location.pathname)
    run(top)
    return
  }
  routeHash = location.hash
  backStack.length = 0
  for (const r of routes) {
    const m = path.match(r.rx)
    if (!m) continue
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
    current?.teardown?.()
    const entry = { path }
    current = entry
    const teardown = r.handler(params)
    // A handler may redirect, resolving a new route re-entrantly; that route keeps its own.
    if (typeof teardown === 'function') {
      if (current === entry) entry.teardown = teardown
      else teardown()
    }
    return
  }
  navigate('/', { replace: true })
}

export function startRouter() {
  window.addEventListener('hashchange', resolve)
  window.addEventListener('popstate', onPopState)
  resolve()
}

export const currentPath = () => location.hash.slice(1) || '/'

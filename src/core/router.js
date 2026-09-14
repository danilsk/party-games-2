// Hash routing: keeps GitHub Pages deep links working with no server rewrites.

const routes = []
let current = null
let routeHash = ''
// Screens inside a game are not routes, but the hardware back button must still reach them.
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

/** Register what the hardware back button should do on this screen; returns a disposer. */
export function interceptBack(fn) {
  const entry = { fn }
  backStack.push(entry)
  history.pushState({ pgBack: backStack.length }, '')
  return () => {
    const i = backStack.indexOf(entry)
    if (i >= 0) backStack.splice(i, 1)
  }
}

function onPopState() {
  if (location.hash !== routeHash) return // a route change; hashchange resolves it
  const entry = backStack.pop()
  if (entry) entry.fn()
  else back()
}

export function resolve() {
  const path = location.hash.slice(1) || '/'
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

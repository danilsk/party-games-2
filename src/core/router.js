// Hash routing: keeps GitHub Pages deep links working with no server rewrites.

const routes = []
let current = null
// Only actual destinations belong in history. CloseWatcher handles dismissible UI before
// Android traverses history, including when a game was launched directly from a shortcut.
const backStack = []
const routeIndex = () => history.state?.pgRouteIndex ?? 0

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
  if (location.hash === target) return
  const state = { pgRouteIndex: routeIndex() + (replace ? 0 : 1) }
  if (replace) history.replaceState(state, '', target)
  else history.pushState(state, '', target)
  // Neither History API method fires hashchange.
  resolve()
}

export function back() {
  if (routeIndex() > 0) history.back()
  else navigate('/', { replace: true })
}

/**
 * Register a dismissible screen or sheet; returns an idempotent disposer.
 * Browsers without CloseWatcher retain visible Back controls and Escape support.
 * Never manufacture history entries or attempt to trap Back at the app's root.
 */
export function interceptBack(fn) {
  const watcher = typeof window.CloseWatcher === 'function' ? new window.CloseWatcher() : null
  const item = { fn, watcher, dispose: null }
  const dispose = () => {
    watcher?.destroy()
    const i = backStack.indexOf(item)
    if (i >= 0) backStack.splice(i, 1)
  }
  item.dispose = dispose
  backStack.push(item)
  watcher?.addEventListener('close', () => run(item), { once: true })
  return dispose
}

function run(item) {
  if (!backStack.includes(item)) return
  item.dispose()
  item.fn()
}

export function resolve() {
  const path = location.hash.slice(1) || '/'
  for (const item of [...backStack]) item.dispose()
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
  history.replaceState({ pgRouteIndex: routeIndex() }, '', location.href)
  window.addEventListener('hashchange', resolve)
  document.addEventListener('keydown', (event) => {
    const top = backStack[backStack.length - 1]
    if (event.key === 'Escape' && !event.defaultPrevented && top && !top.watcher) {
      event.preventDefault()
      run(top)
    }
  })
  resolve()
}

export const currentPath = () => location.hash.slice(1) || '/'

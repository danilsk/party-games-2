// Hash routing: keeps GitHub Pages deep links working with no server rewrites.

const routes = []
let current = null

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
  if (replace) history.replaceState(null, '', target)
  else location.hash = path
}

export function back() {
  if (history.length > 1) history.back()
  else navigate('/')
}

export function resolve() {
  const path = location.hash.slice(1) || '/'
  for (const r of routes) {
    const m = path.match(r.rx)
    if (!m) continue
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
    current?.teardown?.()
    current = { path }
    const teardown = r.handler(params)
    if (typeof teardown === 'function') current.teardown = teardown
    return
  }
  navigate('/', { replace: true })
}

export function startRouter() {
  window.addEventListener('hashchange', resolve)
  resolve()
}

export const currentPath = () => location.hash.slice(1) || '/'

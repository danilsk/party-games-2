import { settings } from './settings.js'

export function applyTheme() {
  const t = settings.get('theme')
  const root = document.documentElement
  if (t === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
  const dark =
    t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.append(meta)
  }
  meta.content = dark ? '#0a0912' : '#f6f3ff'
}

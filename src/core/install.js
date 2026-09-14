let deferred = null
const listeners = new Set()

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e
  listeners.forEach((fn) => fn())
})
window.addEventListener('appinstalled', () => {
  deferred = null
  listeners.forEach((fn) => fn())
})

export const installPrompt = {
  get available() {
    return !!deferred
  },
  get standalone() {
    return this.displayMode !== 'browser'
  },
  get displayMode() {
    return ['fullscreen', 'standalone', 'minimal-ui'].find(
      (mode) => window.matchMedia(`(display-mode: ${mode})`).matches
    ) || (navigator.standalone === true ? 'standalone' : 'browser')
  },
  onChange(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  async show() {
    if (!deferred) return false
    deferred.prompt()
    const { outcome } = await deferred.userChoice
    deferred = null
    listeners.forEach((fn) => fn())
    return outcome === 'accepted'
  },
}

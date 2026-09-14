let sentinel = null
let want = false

async function acquire() {
  if (!want || sentinel || !('wakeLock' in navigator)) return
  try {
    sentinel = await navigator.wakeLock.request('screen')
    sentinel.addEventListener('release', () => { sentinel = null })
  } catch (e) {
    sentinel = null
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') acquire()
})

export function keepAwake(on) {
  want = on
  if (on) acquire()
  else if (sentinel) {
    sentinel.release().catch(() => {})
    sentinel = null
  }
}

export const wakeLockSupported = () => 'wakeLock' in navigator

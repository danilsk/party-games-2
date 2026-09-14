// Shrink-to-fit display text: binary search on font size against the available box.

export function fitWord(box, el, { min = 18, max = 200 } = {}) {
  if (!box || !el || !el.textContent) return
  const w = box.clientWidth
  const h = box.clientHeight
  if (!w || !h) return
  let lo = min
  let hi = Math.min(max, h * 0.92)
  el.style.fontSize = `${hi}px`
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2
    el.style.fontSize = `${mid}px`
    if (el.scrollWidth <= w && el.scrollHeight <= h) lo = mid
    else hi = mid
  }
  el.style.fontSize = `${Math.floor(lo)}px`
}

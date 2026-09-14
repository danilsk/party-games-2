// Shrink-to-fit display text: binary search on font size against the available box.

export function fitWord(box, el, { min = 18, max = 200, fill = 1 } = {}) {
  if (!box || !el || !el.textContent) return
  const cs = getComputedStyle(box)
  const w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  const h = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
  if (w <= 0 || h <= 0) return
  // Words must not break mid-word while measuring, or overflow is never detected.
  el.classList.remove('fit-break')
  let lo = min
  let hi = Math.max(min, Math.min(max, h))
  const fits = (size) => {
    el.style.fontSize = `${size}px`
    return el.scrollWidth <= w + 1 && el.scrollHeight <= h + 1
  }
  if (!fits(hi)) {
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) lo = mid
      else hi = mid
    }
  } else lo = hi
  const size = Math.max(min, Math.floor(lo * fill))
  if (!fits(size) && size <= min) el.classList.add('fit-break')
  el.style.fontSize = `${size}px`
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const SVG_TAGS = new Set([
  'svg', 'g', 'defs', 'circle', 'ellipse', 'rect', 'line', 'path', 'polyline', 'polygon',
  'text', 'tspan', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'use',
])

export function h(tag, props = {}, ...children) {
  // SVG needs createElementNS, and its properties are read-only objects, so attributes only.
  const svg = SVG_TAGS.has(tag)
  const el = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.setAttribute('class', v)
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else if (k === 'html') el.innerHTML = v
    else if (k.startsWith('on') && typeof v === 'function')
      el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'dataset') Object.assign(el.dataset, v)
    else if (!svg && k in el && k !== 'list' && typeof v !== 'boolean') el[k] = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue
    el.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return el
}

export const clear = (el) => {
  while (el.firstChild) el.removeChild(el.firstChild)
  return el
}

export function toast(message, { bad = false, ms = 2600 } = {}) {
  document.querySelectorAll('.toast').forEach((t) => t.remove())
  const el = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status' }, message)
  document.body.append(el)
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s'
    el.style.opacity = '0'
    el.style.transform = 'translate(-50%, 10px)'
    setTimeout(() => el.remove(), 320)
  }, ms)
  return el
}

export function sheet(title, buildBody, { onClose } = {}) {
  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    document.removeEventListener('keydown', onKey)
    backdrop.style.animation = 'fade-out .26s var(--ease) forwards'
    panel.style.animation = 'sheet-down .28s var(--ease) forwards'
    const done = () => {
      panel.remove()
      backdrop.remove()
    }
    panel.addEventListener('animationend', done, { once: true })
    setTimeout(done, 400)
    onClose?.()
  }
  const onKey = (e) => {
    if (e.key === 'Escape') close()
  }
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: close })
  const panel = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-grab' }),
    h('h3', {}, title)
  )
  panel.append(buildBody(close))
  document.body.append(backdrop, panel)
  document.addEventListener('keydown', onKey)
  return close
}

export function switchRow(label, checked, onChange, hint) {
  const btn = h(
    'button',
    {
      class: 'switch',
      role: 'switch',
      'aria-checked': String(checked),
      style: { width: '100%', textAlign: 'left' },
      onclick: () => {
        const next = btn.getAttribute('aria-checked') !== 'true'
        btn.setAttribute('aria-checked', String(next))
        onChange(next)
      },
    },
    h('span', { class: 'stack', style: { gap: '2px' } },
      h('span', { style: { fontWeight: '700' } }, label),
      hint && h('span', { class: 'tiny dim' }, hint)
    ),
    h('span', { class: 'switch-track' })
  )
  return btn
}

export function segmented(options, value, onChange, { label } = {}) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label || '' })
  for (const opt of options) {
    const b = h(
      'button',
      {
        'aria-pressed': String(opt.value === value),
        onclick: () => {
          value = opt.value
          wrap.querySelectorAll('button').forEach((x, i) =>
            x.setAttribute('aria-pressed', String(options[i].value === value))
          )
          onChange(opt.value)
        },
      },
      opt.label
    )
    wrap.append(b)
  }
  return wrap
}

/** Press-and-hold with a progress callback; cancels cleanly on release, cancel or blur. */
export function holdable(el, { holdMs = 2000, onStart, onProgress, onComplete, onCancel } = {}) {
  const ac = new AbortController()
  const opts = { signal: ac.signal }
  let raf = 0
  let startedAt = 0
  let pointer = null
  const stop = (completed) => {
    if (pointer === null) return
    if (el.hasPointerCapture?.(pointer)) el.releasePointerCapture(pointer)
    pointer = null
    cancelAnimationFrame(raf)
    if (!completed) onCancel?.()
  }
  const frame = () => {
    if (pointer === null) return
    const p = Math.min(1, (performance.now() - startedAt) / holdMs)
    onProgress?.(p)
    if (p >= 1) {
      stop(true)
      onComplete?.()
      return
    }
    raf = requestAnimationFrame(frame)
  }
  const begin = (e) => {
    if (pointer !== null) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault() // suppress the iOS selection callout, which cancels the gesture
    el.focus?.({ preventScroll: true })
    pointer = e.pointerId
    startedAt = performance.now()
    el.setPointerCapture?.(e.pointerId)
    onStart?.()
    raf = requestAnimationFrame(frame)
  }
  // Pointer capture keeps the gesture alive as the finger drifts, so only a real
  // release, an OS cancel or a backgrounded window ends it.
  const end = (e) => { if (e.pointerId === pointer) stop(false) }
  el.addEventListener('pointerdown', begin, opts)
  el.addEventListener('pointerup', end, opts)
  el.addEventListener('pointercancel', end, opts)
  el.addEventListener('contextmenu', (e) => e.preventDefault(), opts)
  window.addEventListener('blur', () => stop(false), opts)
  return () => {
    stop(false)
    ac.abort()
  }
}

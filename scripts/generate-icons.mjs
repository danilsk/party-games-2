// Pure-node PNG output: no image deps, icons are reproducible from source.
import zlib from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(OUT, { recursive: true })

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const BG = [14, 11, 26]
const BLOBS = [
  { c: [217, 255, 67], a: 0.86, r: 0.235 },
  { c: [255, 77, 157], a: 0.86, r: 0.235 },
  { c: [61, 224, 216], a: 0.86, r: 0.235 },
]

function render(size, { rounded = true, scale = 1 }) {
  const SS = 3
  const px = Buffer.alloc(size * size * 4)
  const cx = size / 2
  const cy = size / 2
  const ring = size * 0.13 * scale
  const centers = BLOBS.map((b, i) => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 3
    return { ...b, x: cx + Math.cos(ang) * ring, y: cy + Math.sin(ang) * ring, rr: size * b.r * scale }
  })
  const radius = size * 0.22

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px0 = x + (sx + 0.5) / SS
          const py0 = y + (sy + 0.5) / SS
          let inside = true
          if (rounded) {
            const qx = Math.abs(px0 - cx) - (size / 2 - radius)
            const qy = Math.abs(py0 - cy) - (size / 2 - radius)
            const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)
            inside = d <= radius
          }
          if (!inside) continue
          let cr = BG[0], cg = BG[1], cb = BG[2]
          for (const c of centers) {
            if (Math.hypot(px0 - c.x, py0 - c.y) > c.rr) continue
            cr = Math.min(255, cr + c.c[0] * c.a)
            cg = Math.min(255, cg + c.c[1] * c.a)
            cb = Math.min(255, cb + c.c[2] * c.a)
          }
          r += cr; g += cg; b += cb; a += 255
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 4
      px[i] = Math.round(r / n)
      px[i + 1] = Math.round(g / n)
      px[i + 2] = Math.round(b / n)
      px[i + 3] = Math.round(a / n)
    }
  }
  return png(size, size, px)
}

const files = [
  ['icon-192.png', render(192, { rounded: true, scale: 1 })],
  ['icon-512.png', render(512, { rounded: true, scale: 1 })],
  ['icon-maskable-512.png', render(512, { rounded: false, scale: 0.72 })],
  ['apple-touch-icon.png', render(180, { rounded: false, scale: 1 })],
]
for (const [name, buf] of files) {
  writeFileSync(join(OUT, name), buf)
  console.log(name, `${(buf.length / 1024).toFixed(1)}kB`)
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0e0b1a"/>
  <g style="mix-blend-mode:screen">
    <circle cx="32" cy="23.7" r="15" fill="#d9ff43" opacity=".86"/>
    <circle cx="24.8" cy="36.2" r="15" fill="#ff4d9d" opacity=".86"/>
    <circle cx="39.2" cy="36.2" r="15" fill="#3de0d8" opacity=".86"/>
  </g>
</svg>
`
writeFileSync(join(OUT, 'favicon.svg'), svg)
console.log('favicon.svg')

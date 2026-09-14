import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import pkg from './package.json' with { type: 'json' }

const BASE = '/party-games-2/'

function serviceWorker() {
  return {
    name: 'party-games-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .map((f) => `./${f}`)
      const precache = [
        './',
        './index.html',
        './manifest.webmanifest',
        './icons/icon-192.png',
        './icons/icon-512.png',
        './icons/icon-maskable-512.png',
        './icons/apple-touch-icon.png',
        './icons/favicon.svg',
        ...assets.filter((f) => f !== './index.html'),
      ]
      const version = createHash('sha256')
        .update(JSON.stringify(precache) + pkg.version)
        .digest('hex')
        .slice(0, 12)
      const source = readFileSync('scripts/sw-template.js', 'utf8')
        .replace('__PRECACHE__', JSON.stringify([...new Set(precache)], null, 2))
        .replace('__VERSION__', version)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export default defineConfig({
  base: BASE,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [serviceWorker()],
  build: {
    target: ['es2020', 'safari14'],
    cssCodeSplit: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: { topics: ['./src/content/packs/topics.js'] },
      },
    },
  },
  server: { host: true },
})

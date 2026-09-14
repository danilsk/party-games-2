import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
}

/** Mimics GitHub Pages: repo contents served under /<repo>/, hard 404 elsewhere. */
export function serve(root, base = '/party-games-2/', port = 0) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (!url.pathname.startsWith(base)) {
      res.writeHead(404, { 'content-type': 'text/html' })
      return res.end('<h1>404</h1>')
    }
    let rel = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html'
    if (rel.endsWith('/')) rel += 'index.html'
    const file = join(root, normalize(rel).replace(/^(\.\.[/\\])+/, ''))
    try {
      const s = await stat(file)
      if (s.isDirectory()) throw new Error('dir')
      const body = await readFile(file)
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] || 'application/octet-stream',
        'cache-control': 'no-cache',
      })
      res.end(body)
    } catch {
      res.writeHead(404, { 'content-type': 'text/html' })
      res.end('<h1>404 - GitHub Pages would not serve this</h1>')
    }
  })
  return new Promise((r) => server.listen(port, () => r({ server, port: server.address().port })))
}

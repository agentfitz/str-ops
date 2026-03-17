// server.js — local dev server
// Serves static files from /public and API routes from /api
// Usage: node server.js

import 'dotenv/config'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3000

const MIME_TYPES = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
}

// Dynamically load API route handlers
async function getApiHandler(urlPath) {
  // /api/metrics/summary → api/metrics/summary.js
  const relative = urlPath.replace(/^\//, '') // strip leading slash
  const candidates = [
    path.join(__dirname, `${relative}.js`),
    path.join(__dirname, relative, 'index.js'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const mod = await import(`${candidate}?t=${Date.now()}`) // bust cache
      return mod.default
    }
  }
  return null
}

function parseQuery(urlStr) {
  const u = new URL(urlStr, 'http://localhost')
  const query = {}
  u.searchParams.forEach((v, k) => { query[k] = v })
  return { pathname: u.pathname, query }
}

async function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })
}

const server = http.createServer(async (req, res) => {
  const { pathname, query } = parseQuery(req.url)

  // ── API routes ──────────────────────────────────────────────
  if (pathname.startsWith('/api/')) {
    const handler = await getApiHandler(pathname)
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ error: `No handler for ${pathname}` }))
    }

    // Build a minimal req/res compatible with our Vercel-style handlers
    req.query = query
    if (req.method === 'POST') {
      req.body = await readBody(req)
    }

    const mockRes = {
      statusCode: 200,
      headers: {},
      status(code) { this.statusCode = code; return this },
      setHeader(k, v) { this.headers[k] = v; return this },
      end(body) {
        res.writeHead(this.statusCode, {
          'Content-Type': 'application/json',
          ...this.headers,
        })
        res.end(body)
      },
      json(data) { this.end(JSON.stringify(data)) },
    }

    try {
      await handler(req, mockRes)
    } catch (err) {
      console.error(`API error [${pathname}]:`, err)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
    return
  }

  // ── Static files ────────────────────────────────────────────
  let filePath = pathname === '/'
    ? path.join(__dirname, 'public', 'index.html')
    : path.join(__dirname, 'public', pathname)

  // If no extension, try .html
  if (!path.extname(filePath)) filePath += '.html'

  if (!fs.existsSync(filePath)) {
    res.writeHead(404)
    return res.end('Not found')
  }

  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' })
  fs.createReadStream(filePath).pipe(res)
})

server.listen(PORT, () => {
  console.log(`\n  STR Ops running at http://localhost:${PORT}\n`)
  console.log(`  Dashboard → http://localhost:${PORT}/`)
  console.log(`  Admin     → http://localhost:${PORT}/views/admin.html\n`)
})
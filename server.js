// server.js — local dev server
// Usage: node server.js

import 'dotenv/config'
import express    from 'express'
import fs         from 'fs'
import path       from 'path'
import { fileURLToPath } from 'url'
import { requireAuth }   from './lib/requireAuth.js'
import { verifyToken }  from './lib/jwt.js'

function getCookie(header, name) {
  const match = (header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3000
const app = express()

// ── Body parsing ─────────────────────────────────────────────
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

// ── Login page (public) ───────────────────────────────────────
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'))
})

// ── Owner report viewer (public — shareable links) ────────────
app.get('/views/owner-report', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'views', 'owner-report.html'))
})
app.get('/owner-reports/*path', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'views', 'owner-report.html'))
})

// ── All API routes — public paths bypass auth, protected paths require JWT ──
// Mirrors Vercel middleware PUBLIC_PATHS list
const PUBLIC_API_PREFIXES = ['/api/auth/', '/api/reports/', '/api/webhooks/', '/api/me']

app.all('/api/*path', async (req, res) => {
  const isPublic = PUBLIC_API_PREFIXES.some(p => req.path.startsWith(p))
  if (!isPublic) {
    const token = getCookie(req.headers.cookie, 'bmf-auth')
    const user  = token ? await verifyToken(token) : null
    if (!user) return res.status(401).json({ error: 'Unauthorized' })
    req.user = user
  }
  const handler = await getApiHandler(req.path)
  if (!handler) return res.status(404).json({ error: `No handler for ${req.path}` })
  try {
    await handler(req, res)
  } catch (err) {
    console.error(`API error [${req.path}]:`, err)
    res.status(500).json({ error: err.message })
  }
})

// ── Public static files (CSS, JS, images) — before auth wall ─
app.use(express.static(path.join(__dirname, 'public')))

// ── Auth wall — protected HTML pages below this line ─────────
app.use(requireAuth)

// ── Protected HTML pages — served from views/ with email injection ────────
app.use(async (req, res, next) => {
  if (path.extname(req.path)) return next() // skip asset requests

  // Map request path to views/ file
  const pageName = req.path === '/' ? 'index' : req.path.replace(/^\/views\//, '').replace(/^\//, '')
  const viewFile = path.join(__dirname, 'views', `${pageName}.html`)

  if (!fs.existsSync(viewFile)) return next()

  const token = getCookie(req.headers.cookie, 'bmf-auth')
  const user = token ? await verifyToken(token) : null
  const html = fs.readFileSync(viewFile, 'utf8').replace('{{USER_EMAIL}}', user?.email ?? '')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  return res.send(html)
})


app.use((req, res) => res.status(404).send('Not found'))

// ── Dynamic API handler loader ────────────────────────────────
async function getApiHandler(urlPath) {
  const relative = urlPath.replace(/^\//, '')
  const candidates = [
    path.join(__dirname, `${relative}.js`),
    path.join(__dirname, relative, 'index.js'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const mod = await import(`${candidate}?t=${Date.now()}`)
      return mod.default
    }
  }
  return null
}

app.listen(PORT, () => {
  console.log(`\n  STR Ops running at http://localhost:${PORT}\n`)
  console.log(`  Dashboard → http://localhost:${PORT}/`)
  console.log(`  Admin     → http://localhost:${PORT}/views/admin\n`)
})

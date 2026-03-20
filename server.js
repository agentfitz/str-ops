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

// ── Auth routes (public — handlers include their own cookie-session + passport) ──
app.all('/api/auth/*path', async (req, res) => {
  const handler = await getApiHandler(req.path)
  if (handler) return await handler(req, res)
  res.status(404).json({ error: 'Not found' })
})

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

// ── Auth wall — everything below requires a valid JWT cookie ──
app.use(requireAuth)

// ── API routes (dynamic, cache-busted) ───────────────────────
app.all('/api/*path', async (req, res) => {
  const handler = await getApiHandler(req.path)
  if (!handler) return res.status(404).json({ error: `No handler for ${req.path}` })
  try {
    await handler(req, res)
  } catch (err) {
    console.error(`API error [${req.path}]:`, err)
    res.status(500).json({ error: err.message })
  }
})

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

// ── Other static files (CSS, JS, images) ─────────────────────
app.use((req, res, next) => {
  const filePath = path.join(__dirname, 'public', req.path)
  if (fs.existsSync(filePath)) return res.sendFile(filePath)
  next()
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

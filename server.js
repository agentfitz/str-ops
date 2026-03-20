// server.js — local dev server
// Usage: node server.js

import 'dotenv/config'
import express      from 'express'
import session      from 'express-session'
import fs           from 'fs'
import path         from 'path'
import { fileURLToPath } from 'url'
import passport          from './lib/auth.js'
import { requireAuth }   from './lib/requireAuth.js'
import { getSessionStore } from './lib/sessionStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3000
const app = express()

// ── Body parsing ─────────────────────────────────────────────
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

// ── Session + Passport ────────────────────────────────────────
app.use(session({
  store:             getSessionStore(),
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 },
}))
app.use(passport.initialize())
app.use(passport.session())

// ── Auth routes (public) ──────────────────────────────────────
app.get('/api/auth/google',
  passport.authenticate('google', { scope: ['email', 'profile'] })
)

app.get('/api/auth/callback/google',
  passport.authenticate('google', {
    successRedirect: '/',
    failureRedirect: '/login?error=unauthorized',
  })
)

app.get('/api/auth/logout', (req, res) => {
  req.logout(() => {})
  req.session.destroy()
  res.redirect('/login')
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

// ── Auth wall — everything below requires login ───────────────
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

// ── Static files (cleanUrls — no .html extension needed) ─────
app.use((req, res, next) => {
  let filePath = req.path === '/'
    ? path.join(__dirname, 'public', 'index.html')
    : path.join(__dirname, 'public', req.path)

  if (!path.extname(filePath)) filePath += '.html'

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

// api/page.js — serves protected HTML pages with server-side email injection
// Reads from views/ at project root (outside public/ so Vercel doesn't serve them as static files).
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { verifyToken } from '../lib/jwt.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function getCookie(header, name) {
  const match = (header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export default async function handler(req, res) {
  // path comes from vercel.json rewrite: /views/admin → path=views/admin, / → path=index
  const rawPath = (req.query.path || 'index').toString()
  // Strip leading 'views/' — files live flat in views/ (e.g. views/admin.html → admin.html)
  const pageName = rawPath.replace(/^views\//, '')

  // Prevent path traversal
  if (!pageName || pageName.includes('..') || pageName.includes('/')) {
    return res.status(404).send('Not found')
  }

  const filePath = join(__dirname, '../views', `${pageName}.html`)

  let html
  try {
    html = readFileSync(filePath, 'utf8')
  } catch {
    return res.status(404).send('Not found')
  }

  const token = getCookie(req.headers.cookie, 'bmf-auth')
  const user = token ? await verifyToken(token) : null
  const email = user?.email ?? ''

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(html.replace('{{USER_EMAIL}}', email))
}

// api/me.js — GET /api/me
// Returns the logged-in user's email, or null if unauthenticated.
// Public route — safe to call from public pages to detect login state.
import { verifyToken } from '../lib/jwt.js'

function getCookie(header, name) {
  const match = (header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export default async function handler(req, res) {
  const token = getCookie(req.headers.cookie, 'bmf-auth')
  const user  = token ? await verifyToken(token) : null
  return res.status(200).json({ email: user?.email || null })
}

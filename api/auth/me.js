// api/auth/me.js — returns logged-in user info from JWT cookie
import { verifyToken } from '../../lib/jwt.js'

function getCookie(header, name) {
  const match = (header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export default async function handler(req, res) {
  const token = getCookie(req.headers.cookie, 'bmf-auth')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  const user = await verifyToken(token)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  res.json({ email: user.email })
}

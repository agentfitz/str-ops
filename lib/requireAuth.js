// lib/requireAuth.js — JWT-based auth check for local Express server
import { verifyToken } from './jwt.js'

function getCookie(header, name) {
  const match = (header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export async function requireAuth(req, res, next) {
  const token = getCookie(req.headers.cookie, 'bmf-auth')
  if (!token) {
    return req.path.startsWith('/api/')
      ? res.status(401).json({ error: 'Unauthorized' })
      : res.redirect('/login')
  }
  const user = await verifyToken(token)
  if (!user) {
    return req.path.startsWith('/api/')
      ? res.status(401).json({ error: 'Unauthorized' })
      : res.redirect('/login')
  }
  req.user = user
  next()
}

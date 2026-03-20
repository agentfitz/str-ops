// lib/withAuth.js — wraps OAuth handlers with cookie-session + passport
// Only used by api/auth/* routes. JWT handles all other auth.
import cookieSession from 'cookie-session'
import passport from './auth.js'

// Module-level singletons — initialized once per cold start
let _sessionMiddleware = null
const passportInit    = passport.initialize()
const passportSession = passport.session()

function getSessionMiddleware() {
  if (!_sessionMiddleware) {
    _sessionMiddleware = cookieSession({
      name:     'bmf-oauth',
      secret:   process.env.SESSION_SECRET,
      maxAge:   10 * 60 * 1000, // 10 min — OAuth handshake only
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      httpOnly: true,
    })
  }
  return _sessionMiddleware
}

function run(middleware, req, res) {
  return new Promise((resolve, reject) => {
    middleware(req, res, err => (err ? reject(err) : resolve()))
  })
}

export function withAuth(handler) {
  return async (req, res) => {
    await run(getSessionMiddleware(), req, res)
    await run(passportInit,           req, res)
    await run(passportSession,        req, res)
    return handler(req, res, (err) => {
      if (err) res.status(500).json({ error: err.message })
    })
  }
}

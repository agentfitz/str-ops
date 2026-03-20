// lib/withAuth.js — wraps a Vercel handler with session + passport middleware
// Required for auth to work in Vercel serverless functions (stateless by default)
import session from 'express-session'
import passport from './auth.js'
import { getSessionStore } from './sessionStore.js'

// Module-level singletons — initialized once per cold start
let _sessionMiddleware = null
const passportInit    = passport.initialize()
const passportSession = passport.session()

function getSessionMiddleware() {
  if (!_sessionMiddleware) {
    _sessionMiddleware = session({
      store:             getSessionStore(),
      secret:            process.env.SESSION_SECRET,
      resave:            false,
      saveUninitialized: false,
      cookie: {
        secure:   process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge:   30 * 24 * 60 * 60 * 1000, // 30 days
      },
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
    return handler(req, res)
  }
}

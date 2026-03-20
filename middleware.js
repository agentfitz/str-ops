// middleware.js — Vercel Edge Middleware
// Intercepts every request at the CDN level before any file is served.
// Returning undefined = pass through. Returning Response.redirect() = intercept.
import { verifyToken } from './lib/jwt.js'

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/',
  '/owner-reports/',
  '/views/owner-report',
  '/api/reports/',          // owner report data — public for shareable links
  '/book-direct/',          // stay.bmf.llc guest pages
  '/css/',
  '/js/',
  '/img/',
  '/favicon',
]

function getCookie(header, name) {
  const match = (header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export default async function middleware(request) {
  const { pathname } = new URL(request.url)

  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p))) {
    return // pass through
  }

  const token = getCookie(request.headers.get('cookie'), 'bmf-auth')
  if (!token) {
    return Response.redirect(new URL('/login', request.url))
  }

  const user = await verifyToken(token)
  if (!user) {
    return Response.redirect(new URL('/login', request.url))
  }

  // authenticated — pass through
}

export const config = { matcher: '/:path*' }

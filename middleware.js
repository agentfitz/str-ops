// middleware.js — Vercel Edge Middleware
// Self-contained (no local imports) so Vercel bundles it correctly for non-Next.js projects.
// Intercepts every request at CDN level before any file is served.
// NextResponse.next() = pass through (continues rewrite pipeline). Response.redirect() = intercept.
import { NextResponse } from 'next/server'

const PUBLIC_PATHS = [
  '/login',
  '/api/auth/',
  '/owner-reports/',
  '/views/owner-report',
  '/api/reports/',
  '/book-direct/',
  '/css/',
  '/js/',
  '/img/',
  '/favicon',
]

function getCookie(header, name) {
  const match = (header || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

function fromBase64url(str) {
  const padded = str + '==='.slice((str.length + 3) % 4)
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
}

async function verifyToken(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [header, payload, signature] = parts
    const data = `${header}.${payload}`
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(process.env.SESSION_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    const sigBytes = Uint8Array.from(fromBase64url(signature), c => c.charCodeAt(0))
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data))
    if (!valid) return null
    const { email, exp } = JSON.parse(fromBase64url(payload))
    if (Math.floor(Date.now() / 1000) > exp) return null
    return { email }
  } catch {
    return null
  }
}

export default async function middleware(request) {
  const host = request.headers.get('host') ?? ''

  // stay.bmf.llc is fully public — no auth check
  if (host.includes('stay.bmf.llc')) {
    return NextResponse.next()
  }

  const { pathname } = new URL(request.url)

  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next()
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
  return NextResponse.next()
}

export const config = { matcher: '/:path*' }

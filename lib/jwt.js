// lib/jwt.js — JWT create/verify using Web Crypto
// Works in both Node.js 18+ and Vercel Edge Runtime

function toBase64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromBase64url(str) {
  const padded = str + '==='.slice((str.length + 3) % 4)
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
}

export async function createToken(email) {
  const header  = toBase64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = toBase64url(JSON.stringify({
    email,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
  }))
  const data = `${header}.${payload}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(process.env.SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  const signature = toBase64url(String.fromCharCode(...new Uint8Array(sigBytes)))
  return `${data}.${signature}`
}

export async function verifyToken(token) {
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

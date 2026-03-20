// auth-guard.js — include in every protected page
// Calls /api/me; redirects to /login if unauthenticated
;(async () => {
  try {
    const res = await fetch('/api/me')
    if (res.status === 401) window.location.replace('/login')
  } catch {
    window.location.replace('/login')
  }
})()

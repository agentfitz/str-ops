// lib/requireAuth.js — middleware to protect ops routes
export function requireAuth(req, res, next) {
  if (req.isAuthenticated?.()) return next()
  // API calls → 401 JSON rather than redirect
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  res.redirect('/login')
}

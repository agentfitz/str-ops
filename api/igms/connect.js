// api/igms/connect.js
// GET /api/igms/connect
// Redirects to IGMS OAuth authorization page

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { IGMS_CLIENT_ID, IGMS_REDIRECT_URI } = process.env

  if (!IGMS_CLIENT_ID || !IGMS_REDIRECT_URI) {
    return res.status(500).json({ error: 'IGMS_CLIENT_ID and IGMS_REDIRECT_URI must be set in environment' })
  }

  const params = new URLSearchParams({
    client_id:    IGMS_CLIENT_ID,
    redirect_uri: IGMS_REDIRECT_URI,
    scope:        'messaging',
  })

  return res.redirect(`https://igms.com/app/auth.html?${params}`)
}

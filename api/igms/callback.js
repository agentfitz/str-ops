// api/igms/callback.js
// GET /api/igms/callback?code=AUTH_CODE
// Exchanges auth code for access token and displays it

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { code, error } = req.query

  if (error) {
    return res.status(400).send(`<pre>IGMS authorization denied: ${error}</pre>`)
  }

  if (!code) {
    return res.status(400).send('<pre>No authorization code received.</pre>')
  }

  const { IGMS_CLIENT_ID, IGMS_CLIENT_SECRET, IGMS_REDIRECT_URI } = process.env

  const params = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  IGMS_REDIRECT_URI,
    client_id:     IGMS_CLIENT_ID,
    client_secret: IGMS_CLIENT_SECRET,
  })

  const tokenRes = await fetch(`https://igms.com/auth/token?${params}`)
  const data     = await tokenRes.json()

  if (data.error) {
    return res.status(400).send(`<pre>Token exchange failed: ${data.error}</pre>`)
  }

  const token = data.access_token

  return res.status(200).send(`<!DOCTYPE html>
<html>
<head><title>IGMS Connected</title>
<style>
  body { font-family: monospace; max-width: 600px; margin: 60px auto; padding: 0 20px; background: #F7F5F0; }
  h2 { color: #1D4A35; }
  .token { background: #1A1A1A; color: #F7F5F0; padding: 16px; border-radius: 4px; word-break: break-all; }
  .note { color: #666; font-size: 13px; margin-top: 16px; }
</style>
</head>
<body>
  <h2>IGMS Connected ✓</h2>
  <p>Add this to your <code>.env</code> file:</p>
  <div class="token">IGMS_ACCESS_TOKEN=${token}</div>
  <p class="note">Then restart your local server. This token gives access to your IGMS bookings and listings.</p>
</body>
</html>`)
}

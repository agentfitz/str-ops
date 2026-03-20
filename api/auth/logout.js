// api/auth/logout.js
export default function handler(req, res) {
  res.setHeader('Set-Cookie',
    'bmf-auth=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'
  )
  res.redirect('/login')
}

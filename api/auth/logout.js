// api/auth/logout.js
export default function handler(req, res) {
  res.setHeader('Set-Cookie',
    'bmf-auth=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
  )
  res.redirect('/login')
}

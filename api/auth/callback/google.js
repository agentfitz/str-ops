// api/auth/callback/google.js — handles Google OAuth callback
import passport from '../../../lib/auth.js'
import { withAuth } from '../../../lib/withAuth.js'
import { createToken } from '../../../lib/jwt.js'

export default withAuth(function handler(req, res, next) {
  passport.authenticate('google', async (err, user) => {
    if (err || !user) return res.redirect('/login?error=unauthorized')

    const token = await createToken(user.email)
    const secure = process.env.NODE_ENV === 'production'
    res.setHeader('Set-Cookie',
      `bmf-auth=${token}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`
    )
    res.redirect('/')
  })(req, res, next)
})

// api/auth/callback/google.js — handles Google OAuth callback
import passport from '../../../lib/auth.js'
import { withAuth } from '../../../lib/withAuth.js'

export default withAuth(function handler(req, res, next) {
  passport.authenticate('google', {
    successRedirect: '/',
    failureRedirect: '/login?error=unauthorized',
  })(req, res, next)
})

// api/auth/google.js — initiates Google OAuth flow
import passport from '../../lib/auth.js'
import { withAuth } from '../../lib/withAuth.js'

export default withAuth(function handler(req, res, next) {
  passport.authenticate('google', { scope: ['email', 'profile'] })(req, res, next)
})

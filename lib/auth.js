// lib/auth.js — Passport.js Google OAuth 2.0 setup
import passport from 'passport'
import { Strategy as GoogleStrategy } from 'passport-google-oauth20'

const ALLOWED_EMAILS = process.env.ALLOWED_EMAILS?.split(',').map(e => e.trim()) ?? []

passport.use(new GoogleStrategy({
  clientID:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL:  '/api/auth/callback/google',
}, (accessToken, refreshToken, profile, done) => {
  const email = profile.emails?.[0]?.value
  if (ALLOWED_EMAILS.includes(email)) {
    return done(null, { email, name: profile.displayName })
  }
  return done(null, false, { message: 'Unauthorized' })
}))

passport.serializeUser((user, done) => done(null, user))
passport.deserializeUser((user, done) => done(null, user))

export default passport

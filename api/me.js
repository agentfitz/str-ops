// api/me.js — auth check endpoint used by client-side auth guard
import { withAuthRequired } from '../lib/withAuth.js'

export default withAuthRequired(function handler(req, res) {
  res.json({ ok: true, user: req.user })
})

// api/auth/logout.js
import { withAuth } from '../../lib/withAuth.js'

export default withAuth(function handler(req, res) {
  req.logout?.(() => {})
  req.session?.destroy()
  res.redirect('/login')
})

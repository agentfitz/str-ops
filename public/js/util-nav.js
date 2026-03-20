// util-nav.js — Alpine component for utility nav bar
// No redirect logic here — Edge Middleware handles auth before HTML is ever served.
function utilNav() {
  return {
    email: '',
    async init() {
      try {
        const r = await fetch('/api/auth/me')
        if (r.ok) this.email = (await r.json()).email
      } catch {
        // middleware handles unauth; silently ignore fetch errors
      }
    }
  }
}

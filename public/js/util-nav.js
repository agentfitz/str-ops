// util-nav.js — Alpine component for utility nav bar
function utilNav() {
  return {
    email: '',
    async init() {
      try {
        const r = await fetch('/api/auth/me')
        if (!r.ok) { window.location.replace('/login'); return }
        const d = await r.json()
        this.email = d.email
      } catch {
        window.location.replace('/login')
      }
    }
  }
}

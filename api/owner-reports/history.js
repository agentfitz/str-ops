// api/owner-reports/history.js
// GET /api/owner-reports/history?owner=<slug>&property=<id>
// Authenticated users see all reports; unauthenticated see published only.
import { supabase }   from '../../lib/supabase.js'
import { verifyToken } from '../../lib/jwt.js'

function getCookie(header, name) {
  if (!header) return null
  const match = header.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='))
  return match ? match.slice(name.length + 1) : null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { owner: ownerSlug, property: propertyId } = req.query

  if (!ownerSlug || !propertyId) {
    return res.status(400).json({ error: 'owner and property are required' })
  }

  const token        = getCookie(req.headers.cookie, 'bmf-auth')
  const user         = token ? await verifyToken(token) : null
  const isAuthed     = !!user

  const { data: ownerRow, error: ownerErr } = await supabase
    .from('owners')
    .select('id')
    .eq('slug', ownerSlug)
    .single()

  if (ownerErr || !ownerRow) {
    return res.status(404).json({ error: `Owner not found: ${ownerSlug}` })
  }

  let query = supabase
    .from('owner_reports')
    .select('id, month, year, status')
    .eq('owner_id', ownerRow.id)
    .eq('property_id', propertyId)
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(6)

  if (!isAuthed) query = query.eq('status', 'published')

  const { data, error } = await query

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json(data || [])
}

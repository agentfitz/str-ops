// api/owners.js — GET /api/owners?property=hidden-hollow (optional)
import { supabase } from '../lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { property } = req.query

  if (property) {
    // Return owners for a specific property (via property_owners junction)
    const { data, error } = await supabase
      .from('property_owners')
      .select('ownership_pct, owners(id, name, slug, email)')
      .eq('property_id', property)
      .order('ownership_pct', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })

    const owners = (data || []).map(row => ({
      ...row.owners,
      ownership_pct: row.ownership_pct,
    }))

    return res.status(200).json(owners)
  }

  // Return all owners
  const { data, error } = await supabase
    .from('owners')
    .select('id, name, slug, email')
    .order('name')

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json(data)
}

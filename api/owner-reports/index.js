// api/owner-reports/index.js — GET /api/owner-reports
// List all reports with property/owner info and status
import { supabase } from '../../lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { data, error } = await supabase
    .from('owner_reports')
    .select(`
      id, property_id, owner_id, month, year, status,
      generated_at, published_at, created_at,
      properties(display_name),
      owners(name, slug)
    `)
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .order('property_id')

  if (error) return res.status(500).json({ error: error.message })

  const reports = (data || []).map(r => ({
    id:             r.id,
    property_id:    r.property_id,
    property_name:  r.properties?.display_name,
    owner_id:       r.owner_id,
    owner_name:     r.owners?.name,
    owner_slug:     r.owners?.slug,
    month:          r.month,
    year:           r.year,
    status:         r.status,
    generated_at:   r.generated_at,
    published_at:   r.published_at,
    created_at:     r.created_at,
  }))

  return res.status(200).json(reports)
}

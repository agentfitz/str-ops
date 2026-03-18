// api/reports/summary.js
// GET /api/reports/summary?property=walker&owner=moriah-angott&month=2&year=2026
// Consolidated report data endpoint — replaces /api/owner-reports/data
import { supabase } from '../../lib/supabase.js'
import { generateReportData } from '../../lib/services/reportGenerator.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { property, owner: ownerSlug, month, year } = req.query

  if (!property || !ownerSlug || !month || !year) {
    return res.status(400).json({ error: 'property, owner, month, and year are required' })
  }

  // Resolve owner slug → owner ID
  const { data: ownerRow, error: ownerErr } = await supabase
    .from('owners')
    .select('id, name, slug, email')
    .eq('slug', ownerSlug)
    .single()

  if (ownerErr || !ownerRow) {
    return res.status(404).json({ error: `Owner not found: ${ownerSlug}` })
  }

  let reportData
  try {
    reportData = await generateReportData(supabase, {
      propertyId: property,
      ownerId:    ownerRow.id,
      month:      parseInt(month),
      year:       parseInt(year),
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }

  // Fetch saved report row (ai_summary, status, published_at, etc.)
  const { data: savedReport } = await supabase
    .from('owner_reports')
    .select('id, status, ai_summary, manual_notes, generated_at, published_at')
    .eq('property_id', property)
    .eq('owner_id', ownerRow.id)
    .eq('month', parseInt(month))
    .eq('year', parseInt(year))
    .maybeSingle()

  return res.status(200).json({
    ...reportData,
    report: savedReport || null,
  })
}

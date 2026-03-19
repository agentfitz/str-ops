// api/owner-reports/generate.js
// POST /api/owner-reports/generate
// Body: { property_id, owner_id, month, year, overwrite? }
// Creates or overwrites a draft report with AI-generated summary
import { supabase }         from '../../lib/supabase.js'
import { generateReportData } from '../../lib/services/reportGenerator.js'
import { generateSummary }    from '../../lib/services/aiSummary.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { property_id, owner_id, month, year, overwrite, host_context, regenerate_summary } = req.body

  if (!property_id || !owner_id || !month || !year) {
    return res.status(400).json({ error: 'property_id, owner_id, month, and year are required' })
  }

  const m = parseInt(month)
  const y = parseInt(year)

  // Check for existing report
  const { data: existing } = await supabase
    .from('owner_reports')
    .select('id, status, generated_at, ai_summary')
    .eq('property_id', property_id)
    .eq('owner_id', owner_id)
    .eq('month', m)
    .eq('year', y)
    .maybeSingle()

  if (existing && !overwrite) {
    return res.status(409).json({ exists: true, report: existing })
  }

  // Generate report data + AI summary
  let reportData
  try {
    reportData = await generateReportData(supabase, {
      propertyId: property_id,
      ownerId:    owner_id,
      month:      m,
      year:       y,
    })
  } catch (err) {
    return res.status(500).json({ error: `Data generation failed: ${err.message}` })
  }

  // If overwriting and user didn't request a new summary, preserve the existing one
  let preservedSummary = null
  if (overwrite && !regenerate_summary && existing) {
    preservedSummary = existing.ai_summary || null
  }

  let aiSummary = preservedSummary || ''
  let aiWarning = null
  if (!preservedSummary) {
    try {
      aiSummary = await generateSummary(reportData, host_context || '')
    } catch (err) {
      aiWarning = err.message
      console.error('AI summary generation failed:', err.message)
    }
  }

  // Pick a random review for this property and stamp it on the report
  // Fetch all IDs and pick randomly in JS — Supabase doesn't support ORDER BY random() via the JS client
  const { data: reviewIds } = await supabase
    .from('reviews')
    .select('id')
    .eq('property_id', property_id)

  const featuredReviewId = reviewIds?.length > 0
    ? reviewIds[Math.floor(Math.random() * reviewIds.length)].id
    : null

  const now = new Date().toISOString()

  const upsertRow = {
    property_id,
    owner_id,
    month:              m,
    year:               y,
    status:             'draft',
    ai_summary:         aiSummary,
    manual_notes:       null,
    generated_at:       now,
    published_at:       null,
    featured_review_id: featuredReviewId,
  }

  const { data: saved, error: saveErr } = await supabase
    .from('owner_reports')
    .upsert(upsertRow, { onConflict: 'property_id,owner_id,month,year' })
    .select()
    .single()

  if (saveErr) return res.status(500).json({ error: saveErr.message })

  return res.status(200).json({ report: saved, reportData, aiWarning })
}

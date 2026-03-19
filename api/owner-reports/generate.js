// api/owner-reports/generate.js
// POST /api/owner-reports/generate
// Body: { property_id, owner_id, month, year, overwrite? }
// Creates or overwrites a draft report with AI-generated summary
import { supabase } from '../../lib/supabase.js'
import { generateReportData } from '../../lib/services/reportGenerator.js'
import { generateSummary } from '../../lib/services/aiSummary.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { property_id, owner_id, month, year, overwrite, host_context } = req.body

  if (!property_id || !owner_id || !month || !year) {
    return res.status(400).json({ error: 'property_id, owner_id, month, and year are required' })
  }

  const m = parseInt(month)
  const y = parseInt(year)

  // Check for existing report
  const { data: existing } = await supabase
    .from('owner_reports')
    .select('id, status, generated_at')
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

  let aiSummary = ''
  let aiWarning = null
  try {
    aiSummary = await generateSummary(reportData, host_context || '')
  } catch (err) {
    aiWarning = err.message
    console.error('AI summary generation failed:', err.message)
  }

  const now = new Date().toISOString()

  const upsertRow = {
    property_id,
    owner_id,
    month:        m,
    year:         y,
    status:       'draft',
    ai_summary:   aiSummary,
    manual_notes: null,
    generated_at: now,
    published_at: null,
  }

  const { data: saved, error: saveErr } = await supabase
    .from('owner_reports')
    .upsert(upsertRow, { onConflict: 'property_id,owner_id,month,year' })
    .select()
    .single()

  if (saveErr) return res.status(500).json({ error: saveErr.message })

  return res.status(200).json({ report: saved, reportData, aiWarning })
}

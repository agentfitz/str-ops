// api/owner-reports/save.js
// PUT /api/owner-reports/save
// Body: { id, ai_summary?, manual_notes? }
// Saves edits to a draft report
import { supabase } from '../../lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).end()

  const { id, ai_summary, manual_notes } = req.body

  if (!id) return res.status(400).json({ error: 'id is required' })

  const updates = {}
  if (ai_summary   !== undefined) updates.ai_summary   = ai_summary
  if (manual_notes !== undefined) updates.manual_notes = manual_notes

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' })
  }

  const { data, error } = await supabase
    .from('owner_reports')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ report: data })
}

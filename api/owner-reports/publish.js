// api/owner-reports/publish.js
// POST /api/owner-reports/publish
// Body: { id }
// Sets report status to 'published'
import { supabase } from '../../lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { id } = req.body

  if (!id) return res.status(400).json({ error: 'id is required' })

  const { data, error } = await supabase
    .from('owner_reports')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ report: data })
}

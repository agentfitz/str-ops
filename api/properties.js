// api/properties.js — GET /api/properties
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .order('display_name')

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json(data)
}

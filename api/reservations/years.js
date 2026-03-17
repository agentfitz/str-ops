// api/reservations/years.js — GET /api/reservations/years
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { data, error } = await supabase
    .from('reservations')
    .select('checkin_date')
    .not('checkin_date', 'is', null)

  if (error) return res.status(500).json({ error: error.message })

  const years = [...new Set(
    data.map(r => new Date(r.checkin_date).getFullYear())
  )].sort((a, b) => b - a)

  return res.status(200).json(years)
}

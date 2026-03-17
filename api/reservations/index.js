// api/reservations/index.js — GET /api/reservations?year=2024&property=all
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const year           = parseInt(req.query.year) || new Date().getFullYear()
  const propertyFilter = req.query.property || 'all'

  const startDate = `${year}-01-01`
  const endDate   = `${year}-12-31`

  let query = supabase
    .from('reservations')
    .select('reservation_code, property_id, platform, checkin_date, checkout_date, nights, guests, stay_type, expected_total_payout, pm_commission, net_payout, invoice_status, guest_name')
    .gte('checkin_date', startDate)
    .lte('checkin_date', endDate)
    .order('checkin_date', { ascending: false })

  if (propertyFilter !== 'all') {
    query = query.eq('property_id', propertyFilter)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json(data)
}
// api/metrics/forward.js — GET /api/metrics/forward?property=all
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function toISO(date) {
  return date.toISOString().split('T')[0]
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const propertyFilter = req.query.property || 'all'
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const windows = [
    { label: '7 Days',  days: 7 },
    { label: '14 Days', days: 14 },
    { label: '30 Days', days: 30 },
    { label: '60 Days', days: 60 },
    { label: '90 Days', days: 90 },
  ]

    // Fetch all active properties
    const { data: props, error: propsError } = await supabase
      .from('properties')
      .select('id, display_name')
      .eq('active', true)
    if (propsError) return res.status(500).json({ error: propsError.message })

    // Fetch all future revenue reservations for all properties
    const { data: reservations, error: resError } = await supabase
      .from('reservations')
      .select('checkin_date, checkout_date, nights, property_id')
      .eq('stay_type', 'Revenue')
      .gte('checkin_date', toISO(today))
      .lte('checkin_date', toISO(addDays(today, 90)))
    if (resError) return res.status(500).json({ error: resError.message })

    // Group reservations by property
    const propMap = Object.fromEntries(props.map(p => [p.id, p.display_name]))
    const result = props.map(prop => {
      const propRes = reservations.filter(r => r.property_id === prop.id)
      const row = { property_id: prop.id, display_name: prop.display_name }
      windows.forEach(w => {
        const windowEnd = addDays(today, w.days)
        const inWindow = propRes.filter(r => new Date(r.checkin_date) < windowEnd)
        const nights = inWindow.reduce((s, r) => s + (r.nights || 0), 0)
        const availableNights = w.days
        row[`occ_${w.days}`] = availableNights > 0 ? nights / availableNights : 0
        row[`nights_${w.days}`] = nights
      })
      // Nights booked in next 90 days
      const nights90 = row['nights_90'] || 0
      row.nights_booked = nights90
      return row
    })

    return res.status(200).json(result)
}

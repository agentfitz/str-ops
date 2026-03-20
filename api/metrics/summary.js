// api/metrics/summary.js — GET /api/metrics/summary?year=2024&month=3&property=all
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function calcMetrics(reservations, availableNights) {
  const revenue = reservations.filter(r => r.stay_type === 'Revenue')
  const grossRevenue  = revenue.reduce((s, r) => s + (r.expected_total_payout || 0), 0)
  const revenueNights = revenue.reduce((s, r) => s + (r.nights || 0), 0)
  const bookedNights  = reservations
    .filter(r => r.stay_type !== 'Flag for Review')
    .reduce((s, r) => s + (r.nights || 0), 0)
  const ownerNights   = reservations
    .filter(r => r.stay_type === 'Owner Stay')
    .reduce((s, r) => s + (r.nights || 0), 0)

  const occupancy = availableNights > 0 ? revenueNights / availableNights : 0
  const adr       = revenueNights > 0   ? grossRevenue / revenueNights   : 0
  const revpar    = availableNights > 0  ? grossRevenue / availableNights  : 0

  return {
    grossRevenue,
    revenueNights,
    bookedNights,
    ownerNights,
    availableNights,
    occupancy,
    adr,
    revpar,
    totalBookings: reservations.length,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const year     = parseInt(req.query.year)  || new Date().getFullYear()
  const monthRaw = req.query.month
  const month    = monthRaw && monthRaw !== 'all' ? parseInt(monthRaw) : null
  const propertyFilter = req.query.property || 'all'

  // Build date range
  let startDate, endDate
  if (month) {
    const days = daysInMonth(year, month)
    startDate = `${year}-${String(month).padStart(2,'0')}-01`
    endDate   = `${year}-${String(month).padStart(2,'0')}-${days}`
  } else {
    startDate = `${year}-01-01`
    endDate   = `${year}-12-31`
  }

  let query = supabase
    .from('reservations')
    .select('*')
    .gte('checkin_date', startDate)
    .lte('checkin_date', endDate)
    .neq('stay_type', 'Flag for Review')

  if (propertyFilter !== 'all') {
    query = query.eq('property_id', propertyFilter)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  const { data: propertiesData } = await supabase
    .from('properties')
    .select('id, display_name, available_nights')
    .eq('active', true)

  const propertiesMap = Object.fromEntries(
    (propertiesData || []).map(p => [p.id, p])
  )

  // Available nights: if month selected, use days in that month; else full year
  const baseNights = month ? daysInMonth(year, month) : 365

  // Group by property
  const byPropertyMap = {}
  for (const r of data) {
    if (!r.property_id) continue
    if (!byPropertyMap[r.property_id]) {
      byPropertyMap[r.property_id] = {
        id: r.property_id,
        display_name: propertiesMap[r.property_id]?.display_name || r.property_id,
        available_nights: baseNights,
        reservations: [],
      }
    }
    byPropertyMap[r.property_id].reservations.push(r)
  }

  const byProperty = Object.values(byPropertyMap).map(p => ({
    id: p.id,
    display_name: p.display_name,
    ...calcMetrics(p.reservations, p.available_nights),
  })).sort((a, b) => b.grossRevenue - a.grossRevenue)

  // Portfolio totals
  // propertiesData is already filtered to active=true by the query above (kenview excluded)
  const activePropertyCount = propertyFilter === 'all'
    ? (propertiesData?.length || 1)
    : 1
  const totalAvailableNights = baseNights * activePropertyCount

  const portfolio = calcMetrics(data, totalAvailableNights)

  return res.status(200).json({ portfolio, byProperty })
}
// api/metrics/bookings.js — GET /api/metrics/bookings?year=2024&property=all
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const PROPERTIES = ['village-lane', 'walker', 'hidden-hollow', 'lee-ct']

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const year           = parseInt(req.query.year) || new Date().getFullYear()
  const propertyFilter = req.query.property || 'all'

  const startDate = `${year}-01-01`
  const endDate   = `${year}-12-31`

  let query = supabase
    .from('reservations')
    .select('property_id, checkin_date, nights, expected_total_payout, pm_commission, platform, stay_type, properties(id, display_name, available_nights)')
    .gte('checkin_date', startDate)
    .lte('checkin_date', endDate)
    .eq('stay_type', 'Revenue')

  if (propertyFilter !== 'all') {
    query = query.eq('property_id', propertyFilter)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  // Fetch active properties
  const { data: propsData } = await supabase
    .from('properties')
    .select('id, display_name, available_nights')
    .eq('active', true)
    .in('id', PROPERTIES)

  const propsMap = Object.fromEntries((propsData || []).map(p => [p.id, p]))
  const activePropIds = propertyFilter === 'all'
    ? PROPERTIES.filter(id => propsMap[id])
    : [propertyFilter]

  // ── Portfolio KPIs ────────────────────────────────────────
  const grossRevenue  = data.reduce((s, r) => s + (r.expected_total_payout || 0), 0)
  const ownerRevenue  = data.reduce((s, r) => s + ((r.expected_total_payout || 0) - (r.pm_commission || 0)), 0)
  const revenueNights = data.reduce((s, r) => s + (r.nights || 0), 0)
  const totalAvail    = activePropIds.reduce((s, id) => s + (propsMap[id]?.available_nights || 365), 0)
  const occupancy     = totalAvail > 0 ? revenueNights / totalAvail : 0
  const adr           = revenueNights > 0 ? grossRevenue / revenueNights : 0
  const revpar        = totalAvail > 0 ? grossRevenue / totalAvail : 0

  const kpis = { grossRevenue, ownerRevenue, revenueNights, occupancy, adr, revpar }

  // ── Monthly Occupancy (per property per month) ────────────
  const monthlyOccMap = {} // { propId: { 1: nights, 2: nights, ... } }
  for (const r of data) {
    const pid   = r.property_id
    const month = new Date(r.checkin_date).getMonth() + 1
    if (!monthlyOccMap[pid]) monthlyOccMap[pid] = {}
    monthlyOccMap[pid][month] = (monthlyOccMap[pid][month] || 0) + (r.nights || 0)
  }

  const monthlyOccupancy = activePropIds.map(pid => {
    const avail = propsMap[pid]?.available_nights || 365
    const monthlyAvail = avail / 12
    return {
      property_id:   pid,
      display_name:  propsMap[pid]?.display_name || pid,
      data: Array.from({ length: 12 }, (_, i) => {
        const nights = monthlyOccMap[pid]?.[i + 1] || 0
        return parseFloat((nights / monthlyAvail * 100).toFixed(1))
      }),
    }
  })

  // ── Monthly Revenue (per property per month) ──────────────
  const monthlyRevMap = {}
  for (const r of data) {
    const pid   = r.property_id
    const month = new Date(r.checkin_date).getMonth() + 1
    if (!monthlyRevMap[pid]) monthlyRevMap[pid] = {}
    monthlyRevMap[pid][month] = (monthlyRevMap[pid][month] || 0) + (r.expected_total_payout || 0)
  }

  const monthlyRevenue = activePropIds.map(pid => ({
    property_id:  pid,
    display_name: propsMap[pid]?.display_name || pid,
    data: Array.from({ length: 12 }, (_, i) => parseFloat((monthlyRevMap[pid]?.[i + 1] || 0).toFixed(2))),
  }))

  // ── Booking Sources (per property) ───────────────────────
  const sourcesMap = {}
  for (const r of data) {
    const pid      = r.property_id
    const platform = r.platform?.toLowerCase() || 'other'
    if (!sourcesMap[pid]) sourcesMap[pid] = { airbnb: 0, vrbo: 0, direct: 0, other: 0 }
    if (platform.includes('airbnb'))      sourcesMap[pid].airbnb  += r.nights || 0
    else if (platform.includes('vrbo') || platform.includes('homeaway')) sourcesMap[pid].vrbo += r.nights || 0
    else if (platform.includes('direct')) sourcesMap[pid].direct  += r.nights || 0
    else                                  sourcesMap[pid].other   += r.nights || 0
  }

  const bookingSources = activePropIds.map(pid => ({
    property_id:  pid,
    display_name: propsMap[pid]?.display_name || pid,
    ...( sourcesMap[pid] || { airbnb: 0, vrbo: 0, direct: 0, other: 0 }),
  }))

  return res.status(200).json({ kpis, monthlyOccupancy, monthlyRevenue, bookingSources })
}
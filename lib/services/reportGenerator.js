// lib/services/reportGenerator.js
// Core report data aggregation — no HTTP, receives supabase client + params

/**
 * Generate structured report data for a given property/owner/month/year.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ propertyId: string, ownerId: string, month: number, year: number }} params
 */
export async function generateReportData(supabase, { propertyId, ownerId, month, year }) {
  // ── 1. Property ──────────────────────────────────────────────────────────
  const { data: property, error: propErr } = await supabase
    .from('properties')
    .select('id, display_name, pm_commission_rate, available_nights')
    .eq('id', propertyId)
    .single()

  if (propErr) throw new Error(`Property lookup failed: ${propErr.message}`)

  // ── 2. Owner + ownership % ───────────────────────────────────────────────
  const { data: owner, error: ownerErr } = await supabase
    .from('owners')
    .select('id, name, slug, email')
    .eq('id', ownerId)
    .single()

  if (ownerErr) throw new Error(`Owner lookup failed: ${ownerErr.message}`)

  const { data: ownershipRow, error: ownershipErr } = await supabase
    .from('property_owners')
    .select('ownership_pct')
    .eq('property_id', propertyId)
    .eq('owner_id', ownerId)
    .single()

  if (ownershipErr) throw new Error(`Ownership lookup failed: ${ownershipErr.message}`)

  const ownerPct = parseFloat(ownershipRow.ownership_pct) || 0

  // ── 3. Date ranges ───────────────────────────────────────────────────────
  const monthNights = new Date(year, month, 0).getDate()
  const startDate   = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate     = `${year}-${String(month).padStart(2, '0')}-${String(monthNights).padStart(2, '0')}`

  const nextMonth       = month === 12 ? 1 : month + 1
  const nextYear        = month === 12 ? year + 1 : year
  const nextMonthNights = new Date(nextYear, nextMonth, 0).getDate()
  const nextStart       = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
  const nextEnd         = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nextMonthNights).padStart(2, '0')}`

  // ── 4. Current month reservations ────────────────────────────────────────
  const { data: currentBookings, error: resErr } = await supabase
    .from('reservations')
    .select('checkin_date, checkout_date, platform, nights, expected_total_payout, stay_type')
    .eq('property_id', propertyId)
    .gte('checkin_date', startDate)
    .lte('checkin_date', endDate)
    .neq('stay_type', 'Flag for Review')
    .order('checkin_date')

  if (resErr) throw new Error(`Reservations lookup failed: ${resErr.message}`)

  // ── 5. Upcoming (next month) bookings ────────────────────────────────────
  const { data: upcomingBookings, error: upErr } = await supabase
    .from('reservations')
    .select('checkin_date, checkout_date, platform, nights, expected_total_payout, stay_type')
    .eq('property_id', propertyId)
    .gte('checkin_date', nextStart)
    .lte('checkin_date', nextEnd)
    .in('stay_type', ['Revenue', 'Comp Stay'])
    .order('checkin_date')

  if (upErr) throw new Error(`Upcoming reservations lookup failed: ${upErr.message}`)

  // ── 6. YTD gross revenue (Jan 1 → end of report month, this property) ────
  const ytdStart = `${year}-01-01`
  const { data: ytdRows, error: ytdErr } = await supabase
    .from('reservations')
    .select('expected_total_payout')
    .eq('property_id', propertyId)
    .eq('stay_type', 'Revenue')
    .gte('checkin_date', ytdStart)
    .lte('checkin_date', endDate)

  if (ytdErr) throw new Error(`YTD lookup failed: ${ytdErr.message}`)

  const ytdGrossRevenue = (ytdRows || []).reduce((s, r) => s + (parseFloat(r.expected_total_payout) || 0), 0)

  // ── 7. Metrics ────────────────────────────────────────────────────────────
  const pmCommissionRate  = parseFloat(property.pm_commission_rate) || 0
  const revenueBookings   = (currentBookings || []).filter(r => r.stay_type === 'Revenue')
  const ownerStayBookings = (currentBookings || []).filter(r => r.stay_type === 'Owner Stay')

  const grossRevenue      = revenueBookings.reduce((s, r) => s + (parseFloat(r.expected_total_payout) || 0), 0)
  const pmFee             = grossRevenue * (pmCommissionRate / 100)
  const netPropertyPayout = grossRevenue - pmFee
  const ownerShare        = netPropertyPayout * (ownerPct / 100)

  const revenueNights   = revenueBookings.reduce((s, r) => s + (r.nights || 0), 0)
  const ownerStayNights = ownerStayBookings.reduce((s, r) => s + (r.nights || 0), 0)
  const ownerStayDates  = ownerStayBookings.map(r => ({
    checkin:  r.checkin_date,
    checkout: r.checkout_date,
  }))

  return {
    property: {
      id:                 property.id,
      display_name:       property.display_name,
      pm_commission_rate: pmCommissionRate,
      available_nights:   property.available_nights || 365,
    },
    owner: {
      id:            owner.id,
      name:          owner.name,
      slug:          owner.slug,
      email:         owner.email,
      ownership_pct: ownerPct,
    },
    month,
    year,
    monthNights,
    currentBookings:  currentBookings  || [],
    upcomingBookings: upcomingBookings || [],
    metrics: {
      grossRevenue,
      pmFee,
      pmCommissionRate,
      netPropertyPayout,
      ownerShare,
      ytdGrossRevenue,
      revenueNights,
      ownerStayNights,
      ownerStayDates,
      occupancyNights: revenueNights,
      availableNights: monthNights,
    },
  }
}

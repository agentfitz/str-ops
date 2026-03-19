// lib/services/reportGenerator.js
// Core report data aggregation — no HTTP, receives supabase client + params

/**
 * Generate full report data for a given property/owner/month/year.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ propertyId: string, ownerId: string, month: number, year: number }} params
 */
export async function generateReportData(supabase, { propertyId, ownerId, month, year }) {
  // ── 1. Property ──────────────────────────────────────────────────────────
  const { data: property, error: propErr } = await supabase
    .from('properties')
    .select('id, display_name, pm_commission_rate, operating_minimum_balance, available_nights')
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

  const ownerPct          = parseFloat(ownershipRow.ownership_pct) || 0
  const pmCommissionRate  = parseFloat(property.pm_commission_rate) || 0
  const operatingMinimum  = parseFloat(property.operating_minimum_balance) || 0

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

  // ── 6. All Baselane rows for the month (revenue + expenses) ─────────────
  // Source of truth for dollar amounts — captures Stripe, Airbnb, VRBO, and
  // any off-platform payments that bypass IGMS.
  const { data: expenseRows, error: expErr } = await supabase
    .from('expenses')
    .select('category, amount, type')
    .eq('property_id', propertyId)
    .gte('date', startDate)
    .lte('date', endDate)

  if (expErr) throw new Error(`Expenses lookup failed: ${expErr.message}`)

  // ── 7. YTD gross revenue from Baselane (Jan 1 → end of report month) ────
  const { data: ytdRows, error: ytdErr } = await supabase
    .from('expenses')
    .select('amount')
    .eq('property_id', propertyId)
    .eq('type', 'Revenue')
    .eq('category', 'Rents')
    .gte('date', `${year}-01-01`)
    .lte('date', endDate)

  if (ytdErr) throw new Error(`YTD lookup failed: ${ytdErr.message}`)

  // ── 8. Historical comparisons for AI context ────────────────────────────
  // Last month and same month last year — revenue + occupancy nights
  const prevMonth      = month === 1 ? 12 : month - 1
  const prevYear       = month === 1 ? year - 1 : year
  const prevMonthDays  = new Date(prevYear, prevMonth, 0).getDate()
  const prevStart      = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`
  const prevEnd        = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(prevMonthDays).padStart(2, '0')}`
  const lyStart        = `${year - 1}-${String(month).padStart(2, '0')}-01`
  const lyEnd          = `${year - 1}-${String(month).padStart(2, '0')}-${String(monthNights).padStart(2, '0')}`

  const [
    { data: prevRevRows },
    { data: lyRevRows },
    { data: prevResRows },
    { data: lyResRows },
  ] = await Promise.all([
    supabase.from('expenses').select('amount')
      .eq('property_id', propertyId).eq('type', 'Revenue').eq('category', 'Rents')
      .gte('date', prevStart).lte('date', prevEnd),
    supabase.from('expenses').select('amount')
      .eq('property_id', propertyId).eq('type', 'Revenue').eq('category', 'Rents')
      .gte('date', lyStart).lte('date', lyEnd),
    supabase.from('reservations').select('nights')
      .eq('property_id', propertyId).eq('stay_type', 'Revenue')
      .gte('checkin_date', prevStart).lte('checkin_date', prevEnd),
    supabase.from('reservations').select('nights')
      .eq('property_id', propertyId).eq('stay_type', 'Revenue')
      .gte('checkin_date', lyStart).lte('checkin_date', lyEnd),
  ])

  const { data: balanceRow } = await supabase
    .from('account_balances')
    .select('closing_balance, notes')
    .eq('property_id', propertyId)
    .eq('month', month)
    .eq('year', year)
    .maybeSingle()

  // ── 9. Revenue from Baselane (source of truth for dollar amounts) ────────
  // Gross revenue = all Baselane rows with type='Revenue', category='Rents'.
  // This captures Airbnb/VRBO payouts, direct Stripe payments, and off-platform
  // extensions that never appeared in IGMS or appeared with understated payouts.
  const grossRevenue    = (expenseRows || [])
    .filter(e => e.type === 'Revenue' && e.category === 'Rents')
    .reduce((s, e) => s + (parseFloat(e.amount) || 0), 0)
  const ytdGrossRevenue = (ytdRows || []).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)

  // ── 9b. Occupancy metrics from IGMS reservations (nights are accurate) ───
  const revenueBookings   = (currentBookings || []).filter(r => r.stay_type === 'Revenue')
  const ownerStayBookings = (currentBookings || []).filter(r => r.stay_type === 'Owner Stay')
  const revenueNights   = revenueBookings.reduce((s, r) => s + (r.nights || 0), 0)
  const ownerStayNights = ownerStayBookings.reduce((s, r) => s + (r.nights || 0), 0)
  const ownerStayDates  = ownerStayBookings.map(r => ({ checkin: r.checkin_date, checkout: r.checkout_date }))

  // ── 10. Management fee ───────────────────────────────────────────────────
  // Check for actual management fee line item in Baselane expenses
  const mgmtFeeRow = (expenseRows || []).find(e =>
    e.category?.toLowerCase().includes('management fee')
  )

  let managementFee, mgmtFeeEstimated
  if (mgmtFeeRow && pmCommissionRate === 0) {
    // Actual from Baselane
    managementFee    = parseFloat(mgmtFeeRow.amount) || 0
    mgmtFeeEstimated = false
  } else if (pmCommissionRate > 0) {
    // Estimated from rate
    managementFee    = -(grossRevenue * (pmCommissionRate / 100))
    mgmtFeeEstimated = true
  } else {
    managementFee    = 0
    mgmtFeeEstimated = false
  }

  // ── 11. Expense breakdown (grouped by category, excluding revenue + mgmt fee)
  const expenseCategoryMap = {}
  for (const row of (expenseRows || [])) {
    if (row.type === 'Revenue') continue                                  // revenue handled separately
    if (row.category?.toLowerCase().includes('management fee')) continue  // handled separately
    const cat = row.category || 'Other'
    expenseCategoryMap[cat] = (expenseCategoryMap[cat] || 0) + (parseFloat(row.amount) || 0)
  }
  const expenses = Object.entries(expenseCategoryMap)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => a.amount - b.amount) // most negative first

  // ── 12. Net cash flow ────────────────────────────────────────────────────
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const netCashFlow   = grossRevenue + managementFee + totalExpenses

  // ── 13. Owner payout from account balance ────────────────────────────────
  const closingBalance  = parseFloat(balanceRow?.closing_balance) || 0
  const propertyPayout  = closingBalance > operatingMinimum ? closingBalance - operatingMinimum : 0
  const ownerPayout     = propertyPayout * (ownerPct / 100)

  return {
    property: {
      id:                        property.id,
      display_name:              property.display_name,
      pm_commission_rate:        pmCommissionRate,
      operating_minimum_balance: operatingMinimum,
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
    gross_revenue:    grossRevenue,
    ytd_gross_revenue: ytdGrossRevenue,
    occupancy: {
      revenue_nights:   revenueNights,
      available_nights: monthNights,
      pct:              monthNights > 0 ? revenueNights / monthNights : 0,
      owner_stay_nights: ownerStayNights,
      owner_stay_dates:  ownerStayDates,
    },
    expenses,
    management_fee: {
      amount:    managementFee,
      estimated: mgmtFeeEstimated,
      rate:      pmCommissionRate,
    },
    net_cash_flow: netCashFlow,
    history: {
      last_month: {
        month:          prevMonth,
        year:           prevYear,
        gross_revenue:  (prevRevRows  || []).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0),
        revenue_nights: (prevResRows  || []).reduce((s, r) => s + (r.nights || 0), 0),
      },
      same_month_last_year: {
        month:          month,
        year:           year - 1,
        gross_revenue:  (lyRevRows    || []).reduce((s, r) => s + (parseFloat(r.amount) || 0), 0),
        revenue_nights: (lyResRows    || []).reduce((s, r) => s + (r.nights || 0), 0),
      },
    },
    account_balance: {
      closing_balance:   closingBalance,
      operating_minimum: operatingMinimum,
      property_payout:   propertyPayout,
      owner_payout:      ownerPayout,
      has_balance:       !!balanceRow,
    },
  }
}

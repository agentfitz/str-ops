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
    .select('id, name, slug, email, nickname')
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

  // ── 6. YTD gross revenue from IGMS (Jan 1 → end of report month) ────────
  // Accrual-correct: revenue tied to stay dates, not deposit dates.
  const { data: ytdRows, error: ytdErr } = await supabase
    .from('reservations')
    .select('expected_total_payout')
    .eq('property_id', propertyId)
    .eq('stay_type', 'Revenue')
    .gte('checkin_date', `${year}-01-01`)
    .lte('checkin_date', endDate)

  if (ytdErr) throw new Error(`YTD lookup failed: ${ytdErr.message}`)

  // ── 7. Expenses for the month (Baselane — non-revenue rows only) ─────────
  const { data: expenseRows, error: expErr } = await supabase
    .from('expenses')
    .select('category, amount, type')
    .eq('property_id', propertyId)
    .gte('date', startDate)
    .lte('date', endDate)
    .neq('type', 'Revenue')

  if (expErr) throw new Error(`Expenses lookup failed: ${expErr.message}`)

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
    supabase.from('reservations').select('expected_total_payout')
      .eq('property_id', propertyId).eq('stay_type', 'Revenue')
      .gte('checkin_date', prevStart).lte('checkin_date', prevEnd),
    supabase.from('reservations').select('expected_total_payout')
      .eq('property_id', propertyId).eq('stay_type', 'Revenue')
      .gte('checkin_date', lyStart).lte('checkin_date', lyEnd),
    supabase.from('reservations').select('nights')
      .eq('property_id', propertyId).eq('stay_type', 'Revenue')
      .gte('checkin_date', prevStart).lte('checkin_date', prevEnd),
    supabase.from('reservations').select('nights')
      .eq('property_id', propertyId).eq('stay_type', 'Revenue')
      .gte('checkin_date', lyStart).lte('checkin_date', lyEnd),
  ])

  const { data: balanceRow } = await supabase
    .from('account_balances')
    .select('operating_account_balance, reserves_account_balance, notes')
    .eq('property_id', propertyId)
    .eq('month', month)
    .eq('year', year)
    .maybeSingle()


  // ── 9. Revenue + occupancy metrics from IGMS reservations ───────────────
  // Accrual-correct: revenue tied to stay dates. Direct booking Stripe deposits
  // hit Baselane at booking time, not stay time — IGMS is the right source.
  const revenueBookings   = (currentBookings || []).filter(r => r.stay_type === 'Revenue')
  const ownerStayBookings = (currentBookings || []).filter(r => r.stay_type === 'Owner Stay')

  const grossRevenue    = revenueBookings.reduce((s, r) => s + (parseFloat(r.expected_total_payout) || 0), 0)
  const ytdGrossRevenue = (ytdRows || []).reduce((s, r) => s + (parseFloat(r.expected_total_payout) || 0), 0)
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

  // ── 11. Expense breakdown (grouped by category, excluding mgmt fee) ──────
  const expenseCategoryMap = {}
  for (const row of (expenseRows || [])) {
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

  // ── 13. Payout calculation ───────────────────────────────────────────────
  const operatingBalance    = parseFloat(balanceRow?.operating_account_balance) || 0
  const reservesBalance     = parseFloat(balanceRow?.reserves_account_balance)  || 0
  const combinedBalance     = operatingBalance + reservesBalance
  const mgmtFeeDeduction    = grossRevenue * (pmCommissionRate / 100)
  // calculated_payout: always the formula result regardless of payout_mode
  // on_demand owners use manual_payout_amount instead — resolved in summary.js
  const distributable       = combinedBalance - mgmtFeeDeduction - operatingMinimum
  const propertyPayout      = Math.max(0, distributable)
  const calculatedPayout    = propertyPayout * (ownerPct / 100)

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
      nickname:      owner.nickname || null,
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
        gross_revenue:  (prevRevRows  || []).reduce((s, r) => s + (parseFloat(r.expected_total_payout) || 0), 0),
        revenue_nights: (prevResRows  || []).reduce((s, r) => s + (r.nights || 0), 0),
      },
      same_month_last_year: {
        month:          month,
        year:           year - 1,
        gross_revenue:  (lyRevRows    || []).reduce((s, r) => s + (parseFloat(r.expected_total_payout) || 0), 0),
        revenue_nights: (lyResRows    || []).reduce((s, r) => s + (r.nights || 0), 0),
      },
    },
    account_balance: {
      operating_balance:  operatingBalance,
      reserves_balance:   reservesBalance,
      combined_balance:   combinedBalance,
      mgmt_fee_deduction: mgmtFeeDeduction,
      operating_minimum:  operatingMinimum,
      property_payout:    propertyPayout,
      calculated_payout:  calculatedPayout,
      has_balance:        !!balanceRow,
    },
  }
}

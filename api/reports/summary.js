// api/reports/summary.js
// GET /api/reports/summary?property=walker&owner=moriah-angott&month=2&year=2026
// Consolidated report data endpoint — replaces /api/owner-reports/data
import { supabase } from '../../lib/supabase.js'
import { generateReportData } from '../../lib/services/reportGenerator.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { property, owner: ownerSlug, month, year } = req.query

  if (!property || !ownerSlug || !month || !year) {
    return res.status(400).json({ error: 'property, owner, month, and year are required' })
  }

  // Resolve owner slug → owner ID
  const { data: ownerRow, error: ownerErr } = await supabase
    .from('owners')
    .select('id, name, slug, email')
    .eq('slug', ownerSlug)
    .single()

  if (ownerErr || !ownerRow) {
    return res.status(404).json({ error: `Owner not found: ${ownerSlug}` })
  }

  let reportData
  try {
    reportData = await generateReportData(supabase, {
      propertyId: property,
      ownerId:    ownerRow.id,
      month:      parseInt(month),
      year:       parseInt(year),
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }

  // Fetch saved report row (ai_summary, status, featured_review_id, manual_payout_amount, etc.)
  const { data: savedReport } = await supabase
    .from('owner_reports')
    .select('id, status, ai_summary, manual_notes, generated_at, published_at, featured_review_id, manual_payout_amount')
    .eq('property_id', property)
    .eq('owner_id', ownerRow.id)
    .eq('month', parseInt(month))
    .eq('year', parseInt(year))
    .maybeSingle()

  // Fetch the stamped review if one is stored
  let featuredReview = null
  if (savedReport?.featured_review_id) {
    const { data: reviewRow } = await supabase
      .from('reviews')
      .select('id, guest_name, guest_location, review_text, platform, review_date')
      .eq('id', savedReport.featured_review_id)
      .maybeSingle()
    featuredReview = reviewRow || null
  }

  // Resolve payout fields
  // manual_payout_amount overrides in both directions (force higher or suppress lower)
  // null = use calculated value
  const calculatedPayout   = reportData.account_balance.calculated_payout
  const manualPayoutAmount = savedReport?.manual_payout_amount != null
    ? parseFloat(savedReport.manual_payout_amount) : null
  const effectivePayout    = manualPayoutAmount ?? calculatedPayout
  const totalHoldings      = reportData.account_balance.combined_balance

  return res.status(200).json({
    ...reportData,
    owner:                { ...reportData.owner, email: ownerRow.email },
    report:               savedReport || null,
    featured_review:      featuredReview,
    manual_payout_amount: manualPayoutAmount,
    calculated_payout:    calculatedPayout,
    effective_payout:     effectivePayout,
    total_holdings:       totalHoldings,
  })
}

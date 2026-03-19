// lib/services/aiSummary.js
// One-shot Claude API call to generate an owner report executive summary

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Generate a 3–4 sentence executive summary for an owner report.
 * @param {object} reportData - output of generateReportData()
 * @param {string} [hostContext] - optional free-text context from Brian
 * @returns {Promise<string>} summary text
 */
export async function generateSummary(reportData, hostContext = '') {
  const {
    property, owner, month, year,
    occupancy, expenses, management_fee, net_cash_flow,
    gross_revenue, ytd_gross_revenue, account_balance,
    upcomingBookings, history,
  } = reportData

  const monthName = MONTH_NAMES[month]
  const fmt = n => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const fmtRound = n => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`
  const pct = (a, b) => b > 0 ? Math.round(((a - b) / b) * 100) : null

  // ── Historical context ───────────────────────────────────────────────────
  const lm   = history?.last_month
  const smly = history?.same_month_last_year

  const revVsLastMonth = lm?.gross_revenue > 0
    ? pct(gross_revenue, lm.gross_revenue)
    : null
  const revVsLastYear = smly?.gross_revenue > 0
    ? pct(gross_revenue, smly.gross_revenue)
    : null
  const nightsVsLastYear = smly?.revenue_nights > 0
    ? pct(occupancy.revenue_nights, smly.revenue_nights)
    : null

  const historicalLines = []
  if (lm?.gross_revenue > 0) {
    historicalLines.push(`Last month (${MONTH_NAMES[lm.month]} ${lm.year}): ${fmtRound(lm.gross_revenue)} gross revenue, ${lm.revenue_nights} revenue nights${revVsLastMonth !== null ? ` (${revVsLastMonth >= 0 ? '+' : ''}${revVsLastMonth}% vs this month)` : ''}`)
  }
  if (smly?.gross_revenue > 0) {
    historicalLines.push(`${MONTH_NAMES[smly.month]} ${smly.year} (same month last year): ${fmtRound(smly.gross_revenue)} gross revenue, ${smly.revenue_nights} revenue nights${revVsLastYear !== null ? ` (${revVsLastYear >= 0 ? '+' : ''}${revVsLastYear}% year-over-year)` : ''}`)
  } else {
    historicalLines.push(`${MONTH_NAMES[smly?.month || month]} ${smly?.year || year - 1}: no data (property may not have been operating)`)
  }

  const expenseSummary = expenses.length > 0
    ? expenses.map(e => `${e.category}: ${fmt(e.amount)}`).join(', ')
    : 'no expenses recorded'

  const payoutLine = account_balance.has_balance
    ? `Owner payout this month: ${fmt(account_balance.owner_payout)} (closing balance ${fmt(account_balance.closing_balance)} minus ${fmt(account_balance.operating_minimum)} operating reserve)`
    : 'Account balance not yet entered — payout not yet calculated'

  const prompt = `You are writing an executive summary for a monthly property report from BMF Enterprises, a short-term rental management company. Your job is to find the most honest, favorable framing of this month's performance — not spin, but smart context. Use comparisons to prior months or prior years when they help tell a good story. You may reference relevant macroeconomic factors, travel trends, seasonal patterns, or short-term rental market dynamics at your discretion if they add meaningful context.

--- REPORT DATA ---
Property: ${property.display_name}
Owner: ${owner.name} (${owner.ownership_pct}% ownership)
Month: ${monthName} ${year}
Gross Revenue: ${fmt(gross_revenue)}
YTD Gross Revenue (Jan–${monthName} ${year}): ${fmtRound(ytd_gross_revenue)}
${management_fee.rate > 0 ? `Management Fee (${management_fee.rate}%): ${fmt(management_fee.amount)}` : ''}
Expenses: ${expenseSummary}
Net Cash Flow: ${fmt(net_cash_flow)}
${payoutLine}
Occupancy: ${occupancy.revenue_nights} of ${occupancy.available_nights} nights (${Math.round(occupancy.pct * 100)}%)
${occupancy.owner_stay_nights > 0 ? `Owner stay: ${occupancy.owner_stay_nights} nights` : ''}
Upcoming bookings next month: ${upcomingBookings.length}

--- HISTORICAL CONTEXT ---
${historicalLines.join('\n')}

${hostContext ? `--- ADDITIONAL CONTEXT FROM HOST ---\n${hostContext}\n` : ''}--- INSTRUCTIONS ---
Write 3–4 sentences addressed to ${owner.name}. Tone: warm, professional, direct — not corporate, not sycophantic. Lead with how the month performed. Use the historical data above to find the most meaningful and favorable honest comparison (year-over-year, month-over-month, or seasonal). If the numbers are genuinely strong, say so clearly. If they're soft, acknowledge it briefly and pivot to forward-looking context or a silver lining. Mention net cash flow or owner payout if meaningful. If there are upcoming bookings, close with a forward-looking note. Do not use marketing superlatives. Do not invent facts not present in the data above.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-opus-4-6',
      max_tokens: 500,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error: ${err}`)
  }

  const data = await res.json()
  return data.content?.[0]?.text?.trim() || ''
}

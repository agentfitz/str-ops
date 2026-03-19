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

  const prompt = `You are writing the executive summary section of a monthly owner report for BMF Enterprises.

--- WHO WE ARE ---
BMF Enterprises is a short-term rental (STR) management company run by Brian FitzGerald. Brian manages a small portfolio of properties across several markets (Greensboro NC, Snowshoe WV, and the Outer Banks of NC) on behalf of property owners. Some properties are 100% owner-operated; others have outside investors (e.g. 51/49 splits). Brian handles everything: listings, guest communication, pricing, maintenance coordination, and financial reporting.

--- WHO THIS IS FOR ---
This report goes to the property owner — a real person with money invested in this property. They trust Brian to manage it well and communicate honestly. They are not operators themselves; they rely on this report to understand how their investment is performing. They may be a family member, a longtime friend, or a private investor. The summary should make them feel informed, respected, and confident in BMF's stewardship — even in a slow month.

--- PURPOSE OF THIS SUMMARY ---
The executive summary is the first thing the owner reads. It sets the tone for the entire report. Its job is to:
1. Give an honest, clear read on how the month went
2. Frame the performance in the most favorable honest light — using comparisons, context, or forward-looking notes where appropriate
3. Build trust through transparency, not cheerleading
4. Leave the owner feeling good about the partnership with BMF

--- YOUR JOB ---
Find the most honest, favorable framing of this month's performance. Use comparisons to prior months or prior years when they help tell a good story. You may reference relevant macroeconomic factors, travel trends, seasonal patterns, or STR market dynamics at your discretion if they add meaningful context. If the numbers are strong, say so clearly. If they're soft, acknowledge it briefly and pivot — don't paper over it, but don't dwell on it either. Always close on a constructive or forward-looking note when possible.

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
Write 2–3 sentences. Max 400 characters total. Address ${owner.name} by first name once, naturally.

Tone: professional, clean, and warm — like a brief from a trusted property manager. Avoid corporate stiffness, but do not be casual. A single light touch of personality or humor is welcome only if the context genuinely invites it — do not force it.

Include one or two key metrics (gross revenue and/or owner payout are the most meaningful). Do not try to summarize every number in the report — the owner will see the full breakdown below.

Use the historical data to find the most favorable honest framing — seasonal patterns, year-over-year, month-over-month, or macro context. If the month was soft, acknowledge it briefly and pivot to a forward-looking note. If strong, say so without overselling.

Do not invent facts not present in the data above.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-opus-4-6',
      max_tokens: 200,
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

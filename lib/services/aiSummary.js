// lib/services/aiSummary.js
// One-shot Claude API call to generate an owner report executive summary

const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Generate a 3–4 sentence executive summary for an owner report.
 * @param {object} reportData - output of generateReportData()
 * @returns {Promise<string>} summary text
 */
export async function generateSummary(reportData) {
  const { property, owner, month, year, occupancy, expenses, management_fee, net_cash_flow, account_balance, upcomingBookings } = reportData
  const monthName = MONTH_NAMES[month]

  const fmt = n => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const expenseSummary = expenses.length > 0
    ? expenses.map(e => `${e.category}: ${fmt(e.amount)}`).join(', ')
    : 'no expenses recorded'

  const payoutLine = account_balance.has_balance
    ? `Owner payout this month: ${fmt(account_balance.owner_payout)} (from closing balance of ${fmt(account_balance.closing_balance)} minus ${fmt(account_balance.operating_minimum)} operating reserve)`
    : 'Account balance not yet entered — payout not yet calculated'

  const prompt = `You are writing a short, warm executive summary for a monthly property report from BMF Enterprises, a short-term rental management company.

Property: ${property.display_name}
Owner: ${owner.name}
Month: ${monthName} ${year}
Gross Revenue: ${fmt(reportData.gross_revenue)}
${management_fee.rate > 0 ? `Management Fee (${management_fee.rate}%): ${fmt(management_fee.amount)}` : ''}
Expenses: ${expenseSummary}
Net Cash Flow: ${fmt(net_cash_flow)}
${payoutLine}
Occupancy: ${occupancy.revenue_nights} of ${occupancy.available_nights} nights (${Math.round(occupancy.pct * 100)}%)
Upcoming bookings next month: ${upcomingBookings.length}

Write 3–4 sentences addressed to ${owner.name}. Tone: warm, professional, direct. Lead with how the month performed. Mention net cash flow or payout if meaningful. If there are upcoming bookings, close with a forward-looking note. Do not use marketing superlatives. Do not invent facts. Do not use bullet points.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-opus-4-6',
      max_tokens: 400,
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

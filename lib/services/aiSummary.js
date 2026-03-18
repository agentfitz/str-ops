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
  const { property, owner, month, year, metrics, upcomingBookings } = reportData
  const monthName = MONTH_NAMES[month]

  const fmt = n => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const pct = metrics.pmCommissionRate > 0 ? ` (after ${metrics.pmCommissionRate}% management fee)` : ''

  const prompt = `You are writing a short, warm executive summary for an owner monthly report from BMF Enterprises, a short-term rental management company.

Property: ${property.display_name}
Owner: ${owner.name}
Month: ${monthName} ${year}
Gross Revenue: ${fmt(metrics.grossRevenue)}
Management Fee: ${fmt(metrics.pmFee)}${pct ? ` (${metrics.pmCommissionRate}%)` : ''}
Net Payout to ${owner.name}: ${fmt(metrics.ownerShare)}
Revenue Nights: ${metrics.revenueNights} of ${metrics.availableNights} nights
Upcoming bookings next month: ${upcomingBookings.length}

Write 3–4 sentences addressed to ${owner.name}. Tone: warm, professional, direct. Lead with a brief summary of how the month went. Mention net payout. If there are upcoming bookings, close with a forward-looking note. Do not use marketing superlatives. Do not invent facts. Do not use bullet points.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       process.env.ANTHROPIC_API_KEY,
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

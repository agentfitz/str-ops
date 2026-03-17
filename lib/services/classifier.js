// Stay type classification logic
// Mirrors the rules established in planning

const TODAY = new Date()
TODAY.setHours(0, 0, 0, 0)

// Manual overrides: { 'RESERVATION_CODE': 'Owner Stay' | 'Comp Stay' | 'Revenue' | 'Flag for Review' }
// Add edge cases here as needed
const MANUAL_OVERRIDES = {}

/**
 * Classify a reservation row from IGMS
 * @param {object} row - parsed reservation row
 * @returns {string} stay type
 */
export function classifyStay(row) {
  const resCode = row.reservation_code?.trim()
  const status  = row.invoice_status?.trim().toLowerCase()
  const payout  = parseFloat(row.expected_total_payout) || 0
  const checkin = row.checkin_date ? new Date(row.checkin_date) : null

  // Manual override always wins
  if (resCode && MANUAL_OVERRIDES[resCode]) {
    return MANUAL_OVERRIDES[resCode]
  }

  const isHistorical = checkin && checkin < TODAY

  if (isHistorical) {
    // Overdue historical = owner/comp regardless of amount
    if (status === 'overdue') return 'Owner Stay'
    // Low payout historical = owner/comp
    if (payout < 25) return 'Owner Stay'
    // Everything else = revenue
    return 'Revenue'
  } else {
    // Future bookings
    if (status === 'overdue')  return 'Flag for Review'
    if (payout === 0)          return 'Owner Stay'
    if (payout <= 99)          return 'Comp Stay'
    return 'Revenue'
  }
}

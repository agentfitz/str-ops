// scripts/importers/igms.js
// Usage: node scripts/importers/igms.js path/to/reservations.csv

import 'dotenv/config'
import fs from 'fs'
import { parse } from 'csv-parse/sync'
import { supabase } from '../../lib/supabase.js'
import { propertyIdFromIgms } from '../../lib/propertyMap.js'
import { classifyStay } from '../../lib/services/classifier.js'

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: node scripts/importers/igms.js <path-to-csv>')
  process.exit(1)
}

const raw = fs.readFileSync(filePath, 'utf8')
const records = parse(raw, {
  columns: true,
  skip_empty_lines: true,
  trim: true,
  bom: true,
})

// Clean soft hyphens from column names
const cleaned = records.map(r => {
  const out = {}
  for (const [k, v] of Object.entries(r)) {
    out[k.replace(/\u00ad/g, '').trim()] = v
  }
  return out
})

// Filter out Void (canceled, no payout)
const active = cleaned.filter(r => r['Invoice Status'] !== 'Void')

let inserted = 0
let skipped  = 0
let errors   = 0

for (const r of active) {
  const propertyId = propertyIdFromIgms(r['Property name'])
  if (!propertyId) { skipped++; continue }

  const payout      = parseFloat(r['Expected Total Payout']) || 0
  const pmComm      = parseFloat(r['PM Commi\u00adsion'] || r['PM Commission']) || 0
  const netPayout   = payout - pmComm

  const row = {
    reservation_code:       r['Reservation code'],
    property_id:            propertyId,
    platform:               r['Platform']?.toLowerCase(),
    checkin_date:           r['Check-in date'] || null,
    checkout_date:          r['Checkout date'] || null,
    booking_date:           r['Booking date']  || null,
    guest_name:             r['Guest name'],
    phone:                  r['Phone Number'],
    invoice_status:         r['Invoice Status'],
    nights:                 parseInt(r['Nights'])  || 0,
    guests:                 parseInt(r['Guests'])  || 0,
    base_price:             parseFloat(r['Base Price']) || 0,
    total_guest_fees:       parseFloat(r['Total Guest Fees']) || 0,
    channel_host_fee:       parseFloat(r['Channel Host Fee']) || 0,
    pass_through_taxes:     parseFloat(r['Pass Through Taxes']) || 0,
    expected_total_payout:  payout,
    pm_commission:          pmComm,
    net_payout:             netPayout,
    stay_type:              classifyStay({
                              reservation_code:       r['Reservation code'],
                              invoice_status:         r['Invoice Status'],
                              expected_total_payout:  payout,
                              checkin_date:           r['Check-in date'],
                            }),
  }

  const { error } = await supabase
    .from('reservations')
    .upsert(row, { onConflict: 'reservation_code' })

  if (error) {
    console.error(`Error on ${r['Reservation code']}:`, error.message)
    errors++
  } else {
    inserted++
  }
}

console.log(`Done. Inserted/updated: ${inserted} | Skipped (no property): ${skipped} | Errors: ${errors}`)

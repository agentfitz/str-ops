// api/igms/sync.js
// POST /api/igms/sync
// Fetches all bookings from IGMS API and upserts to reservations table

import { supabase }            from '../../lib/supabase.js'
import { propertyIdFromIgms }  from '../../lib/propertyMap.js'
import { classifyStay }        from '../../lib/services/classifier.js'

const IGMS_API  = 'https://www.igms.com/api/v1'
const BATCH_SIZE = 100

// booking_status → invoice_status mapping
const STATUS_MAP = {
  accepted:  'Paid',
  request:   'Pending',
  inquiry:   'Pending',
}

function dateOnly(dttm) {
  return dttm ? dttm.split(' ')[0] : null
}

function calcNights(checkin, checkout) {
  if (!checkin || !checkout) return 0
  return Math.round((new Date(checkout) - new Date(checkin)) / (1000 * 60 * 60 * 24))
}

async function igmsFetch(path, accessToken) {
  const res = await fetch(`${IGMS_API}${path}${path.includes('?') ? '&' : '?'}access_token=${accessToken}`)
  if (!res.ok) throw new Error(`IGMS API error ${res.status}: ${await res.text()}`)
  return res.json()
}

// Build listing_uid → property_id map from IGMS listings
async function buildListingMap(accessToken) {
  const map  = {}
  let page   = 1
  while (true) {
    const data = await igmsFetch(`/listings?page=${page}`, accessToken)
    for (const listing of (data.data || [])) {
      const propertyId = propertyIdFromIgms(listing.listing_name)
      if (propertyId) map[listing.listing_uid] = propertyId
    }
    if (!data.meta?.has_next_page) break
    page++
  }
  return map
}

// Fetch all bookings from a given from_date, with pagination
async function fetchAllBookings(accessToken, fromDate) {
  const bookings = []
  let page = 1
  while (true) {
    const params = `from_date=${fromDate}&page=${page}`
    const data   = await igmsFetch(`/bookings?${params}`, accessToken)
    bookings.push(...(data.data || []))
    if (!data.meta?.has_next_page) break
    page++
  }
  return bookings
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const accessToken = process.env.IGMS_ACCESS_TOKEN
  if (!accessToken) {
    return res.status(500).json({ error: 'IGMS_ACCESS_TOKEN not set — visit /api/igms/connect to authorize' })
  }

  // Fetch from 3 years back to capture full history
  const fromDate = new Date()
  fromDate.setFullYear(fromDate.getFullYear() - 3)
  const fromDateStr = fromDate.toISOString().split('T')[0]

  let listingMap, rawBookings
  try {
    listingMap   = await buildListingMap(accessToken)
    rawBookings  = await fetchAllBookings(accessToken, fromDateStr)
  } catch (err) {
    return res.status(500).json({ error: `IGMS fetch failed: ${err.message}` })
  }

  let inserted = 0, skipped = 0, errors = 0
  const rows = []

  for (const b of rawBookings) {
    // Skip cancelled bookings (consistent with CSV importer skipping Void)
    if (b.booking_status === 'cancelled') { skipped++; continue }

    const propertyId = listingMap[b.listing_uid]
    if (!propertyId) { skipped++; continue }

    const checkinDate  = dateOnly(b.local_checkin_dttm)
    const checkoutDate = dateOnly(b.local_checkout_dttm)
    const bookingDate  = dateOnly(b.booked_dttm)
    const payout       = parseFloat(b.price?.price_total) || 0
    const invoiceStatus = STATUS_MAP[b.booking_status] || 'Paid'

    rows.push({
      reservation_code:      b.reservation_code,
      property_id:           propertyId,
      platform:              b.platform_type?.toLowerCase(),
      checkin_date:          checkinDate,
      checkout_date:         checkoutDate,
      booking_date:          bookingDate,
      invoice_status:        invoiceStatus,
      nights:                calcNights(checkinDate, checkoutDate),
      guests:                b.number_of_guests || 0,
      base_price:            parseFloat(b.price?.price_base)    || 0,
      total_guest_fees:      parseFloat(b.price?.price_extras)  || 0,
      channel_host_fee:      parseFloat(b.price?.price_fee)     || 0,
      pass_through_taxes:    parseFloat(b.price?.price_tax)     || 0,
      expected_total_payout: payout,
      pm_commission:         0,
      net_payout:            payout,
      stay_type:             classifyStay({
                               reservation_code:      b.reservation_code,
                               invoice_status:        invoiceStatus,
                               expected_total_payout: payout,
                               checkin_date:          checkinDate,
                             }),
    })
  }

  // Deduplicate by reservation_code
  const seen    = new Map()
  for (const row of rows) seen.set(row.reservation_code, row)
  const deduped = [...seen.values()]

  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('reservations')
      .upsert(batch, { onConflict: 'reservation_code' })

    if (error) {
      console.error('Batch upsert error:', error.message)
      errors += batch.length
    } else {
      inserted += batch.length
    }
  }

  return res.status(200).json({
    inserted,
    skipped,
    errors,
    total_fetched: rawBookings.length,
    listings_mapped: Object.keys(listingMap).length,
  })
}

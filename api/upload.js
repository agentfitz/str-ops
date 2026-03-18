// api/upload.js — POST /api/upload
// Accepts multipart form with file + type ('igms' | 'baselane')

import { createClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse/sync'
import crypto from 'crypto'
import { propertyIdFromIgms, propertyIdFromBaselane } from '../lib/propertyMap.js'
import { classifyStay } from '../lib/services/classifier.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Vercel doesn't parse multipart by default — use raw body parsing
export const config = { api: { bodyParser: false } }

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function parseMultipart(buffer, boundary) {
  const parts = {}
  const boundaryStr = `--${boundary}`
  const sections = buffer.toString('binary').split(boundaryStr)

  for (const section of sections) {
    if (!section.includes('Content-Disposition')) continue
    const [header, ...bodyParts] = section.split('\r\n\r\n')
    const body = bodyParts.join('\r\n\r\n').replace(/\r\n$/, '')

    const nameMatch = header.match(/name="([^"]+)"/)
    if (!nameMatch) continue
    const name = nameMatch[1]

    if (header.includes('filename=')) {
      parts[name] = Buffer.from(body, 'binary')
    } else {
      parts[name] = body.trim()
    }
  }
  return parts
}

function makeHash(...parts) {
  return crypto
    .createHash('sha256')
    .update(parts.map(p => String(p ?? '')).join('|'))
    .digest('hex')
    .slice(0, 32)
}

async function importIgms(csvBuffer) {
  const raw = csvBuffer.toString('utf8')
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
  })

  const active = records.filter(r => r['Invoice Status'] !== 'Void')
  let inserted = 0, skipped = 0, errors = 0

  for (const r of active) {
    const propertyId = propertyIdFromIgms(r['Property name'])
    if (!propertyId) { skipped++; continue }

    const payout  = parseFloat(r['Expected Total Payout']) || 0
    const pmComm  = parseFloat(r['PM Commission'] || r['PM Commi\u00adsion']) || 0

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
      net_payout:             payout - pmComm,
      stay_type:              classifyStay({
                                reservation_code:      r['Reservation code'],
                                invoice_status:        r['Invoice Status'],
                                expected_total_payout: payout,
                                checkin_date:          r['Check-in date'],
                              }),
    }

    const { error } = await supabase
      .from('reservations')
      .upsert(row, { onConflict: 'reservation_code' })

    if (error) errors++
    else inserted++
  }

  return { inserted, skipped, errors }
}

async function importBaselane(csvBuffer) {
  const raw = csvBuffer.toString('utf8')
  const result = (await import('papaparse')).default.parse(raw, {
    header: true,
    skipEmptyLines: true,
    relaxQuotes: true,
  })

  const SKIP_TYPES = ['Transfers & Other']
  const BATCH_SIZE = 100
  let inserted = 0, skipped = 0, errors = 0
  const rows = []

  for (const r of result.data) {
    if (SKIP_TYPES.includes(r['Type'])) { skipped++; continue }

    const propertyId = propertyIdFromBaselane(r['Property'])
    const rawDate    = r['Date']
    const parsedDate = rawDate ? new Date(rawDate) : null
    const dateStr    = parsedDate && !isNaN(parsedDate)
      ? parsedDate.toISOString().split('T')[0]
      : null
    const amount     = parseFloat(r['Amount']) || 0
    const source_hash = makeHash(dateStr, r['Account'], r['Merchant'], amount, r['Description'])

    rows.push({
      source_hash,
      property_id:  propertyId,
      date:         dateStr,
      merchant:     r['Merchant'],
      description:  r['Description'],
      amount,
      type:         r['Type'],
      category:     r['Category'],
      subcategory:  r['Sub-category'],
      account:      r['Account'],
      notes:        r['Notes'] || null,
    })
  }

  const seen = new Map()
  for (const row of rows) seen.set(row.source_hash, row)
  const dedupedRows = [...seen.values()]

  for (let i = 0; i < dedupedRows.length; i += BATCH_SIZE) {
    const batch = dedupedRows.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from('expenses')
      .upsert(batch, { onConflict: 'source_hash' })

    if (error) errors += batch.length
    else inserted += batch.length
  }

  return { inserted, skipped, errors }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const contentType = req.headers['content-type'] || ''
  const boundaryMatch = contentType.match(/boundary=(.+)/)
  if (!boundaryMatch) return res.status(400).json({ error: 'Invalid content type' })

  const buffer = await readBody(req)
  const parts  = parseMultipart(buffer, boundaryMatch[1])

  const type = parts['type']
  const file = parts['file']

  if (!file) return res.status(400).json({ error: 'No file provided' })
  if (!['igms', 'baselane'].includes(type)) {
    return res.status(400).json({ error: 'Invalid type — must be igms or baselane' })
  }

  try {
    const result = type === 'igms'
      ? await importIgms(file)
      : await importBaselane(file)

    return res.status(200).json(result)
  } catch (err) {
    console.error('Upload error:', err)
    return res.status(500).json({ error: err.message })
  }
}

// scripts/importers/baselane.js
// Usage: node scripts/importers/baselane.js path/to/transactions.csv
// Safe to re-run — uses deterministic hash for upsert, no duplicates

import 'dotenv/config'
import fs from 'fs'
import crypto from 'crypto'
import Papa from 'papaparse'
import { supabase } from '../../lib/supabase.js'
import { propertyIdFromBaselane } from '../../lib/propertyMap.js'

function makeHash(...parts) {
  return crypto
    .createHash('sha256')
    .update(parts.map(p => String(p ?? '')).join('|'))
    .digest('hex')
    .slice(0, 32) // 32 chars is plenty for uniqueness
}

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: node scripts/importers/baselane.js <path-to-csv>')
  process.exit(1)
}

const raw = fs.readFileSync(filePath, 'utf8')

const result = Papa.parse(raw, {
  header: true,
  skipEmptyLines: true,
  relaxQuotes: true,
})

const records = result.data

// Skip transfers — not meaningful for P&L
const SKIP_TYPES = ['Transfers & Other']

let inserted = 0
let skipped  = 0
let errors   = 0

for (const r of records) {
  if (SKIP_TYPES.includes(r['Type'])) { skipped++; continue }

  const propertyId = propertyIdFromBaselane(r['Property'])
  // null property = BMF Enterprises portfolio-level, still import with null property_id

  // Parse date — Baselane uses "December 31, 2024" format
  const rawDate = r['Date']
  const parsedDate = rawDate ? new Date(rawDate) : null
  const dateStr = parsedDate && !isNaN(parsedDate)
    ? parsedDate.toISOString().split('T')[0]
    : null

  const amount = parseFloat(r['Amount']) || 0
  const source_hash = makeHash(
    dateStr,
    r['Account'],
    r['Merchant'],
    amount,
    r['Description']
  )

  const row = {
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
  }

  const { error } = await supabase
    .from('expenses')
    .upsert(row, { onConflict: 'source_hash' })

  if (error) {
    console.error(`Error on ${r['Description']}:`, error.message)
    errors++
  } else {
    inserted++
  }
}

console.log(`Done. Inserted/updated: ${inserted} | Skipped (transfers): ${skipped} | Errors: ${errors}`)

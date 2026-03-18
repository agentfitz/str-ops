// api/account-balances.js
// POST /api/account-balances
// Body: { property_id, month, year, closing_balance, notes? }
// Upserts a closing balance for a given property/month/year
import { supabase } from '../lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { property_id, month, year, closing_balance, notes } = req.body

  if (!property_id || !month || !year || closing_balance == null) {
    return res.status(400).json({ error: 'property_id, month, year, and closing_balance are required' })
  }

  const { data, error } = await supabase
    .from('account_balances')
    .upsert({
      property_id,
      month:           parseInt(month),
      year:            parseInt(year),
      closing_balance: parseFloat(closing_balance),
      notes:           notes || null,
    }, { onConflict: 'property_id,month,year' })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ balance: data })
}

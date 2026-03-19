// api/account-balances.js
// POST /api/account-balances
// Body: { property_id, month, year, operating_account_balance, reserves_account_balance?, notes? }
// Upserts account balances for a given property/month/year
import { supabase } from '../lib/supabase.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { property_id, month, year, operating_account_balance, reserves_account_balance, notes } = req.body

  if (!property_id || !month || !year || operating_account_balance == null) {
    return res.status(400).json({ error: 'property_id, month, year, and operating_account_balance are required' })
  }

  const { data, error } = await supabase
    .from('account_balances')
    .upsert({
      property_id,
      month:                    parseInt(month),
      year:                     parseInt(year),
      operating_account_balance: parseFloat(operating_account_balance),
      reserves_account_balance:  parseFloat(reserves_account_balance) || 0,
      notes:                    notes || null,
    }, { onConflict: 'property_id,month,year' })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ balance: data })
}

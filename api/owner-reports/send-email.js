// api/owner-reports/send-email.js
// POST /api/owner-reports/send-email
// Body: { id: report_uuid, to_email?: string }
// Sends the published report link to the owner via Resend.
import { supabase } from '../../lib/supabase.js'

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { id, to_email } = req.body
  if (!id) return res.status(400).json({ error: 'id is required' })

  // Fetch report with owner + property info
  const { data: report, error: reportErr } = await supabase
    .from('owner_reports')
    .select('id, month, year, status, ai_summary, owners(id, name, slug, nickname, email), properties(id, display_name)')
    .eq('id', id)
    .single()

  if (reportErr || !report) return res.status(404).json({ error: 'Report not found' })

  const owner    = report.owners
  const property = report.properties

  const recipientEmail = to_email || owner?.email
  if (!recipientEmail) {
    return res.status(400).json({ error: 'No email address for this owner — provide to_email' })
  }

  const mm        = String(report.month).padStart(2, '0')
  const reportUrl = `https://ops.bmf.llc/owner-reports/${mm}-${report.year}/${owner.slug}/${property.id}`
  const monthYear = `${MONTH_NAMES[report.month]} ${report.year}`
  const firstName = owner.nickname || owner.name.split(' ')[0]

  const summaryParagraphs = (report.ai_summary || '')
    .split('\n')
    .filter(l => l.trim())
    .map(l => `    <p style="margin: 0 0 16px 0; font-size: 16px; font-style: italic;">${l}</p>`)
    .join('\n')

  const html = `<!DOCTYPE html>
<html><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
    p { font-size: 16px !important; line-height: 1.7 !important; }
  </style>
</head>
<body style="margin: 0; padding: 0; background: #ffffff; -webkit-text-size-adjust: 100%; text-size-adjust: 100%;">
<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td align="left" valign="top" style="padding: 40px 24px; font-family: Georgia, serif; font-size: 16px; line-height: 1.7; color: #1A1A1A;">
      <p style="margin: 0 0 24px 0; font-size: 16px;">Hi ${firstName},</p>
      <p style="margin: 0 0 24px 0; font-size: 16px;">Here's how <strong>${property.display_name}</strong> performed in ${monthYear}:</p>
      <div style="margin: 0 0 32px 0; padding: 20px 24px; background: #f5f5f5; border-left: 3px solid #aaa; max-width: 650px;">
${summaryParagraphs}
      </div>
      <p style="margin: 0 0 32px 0; font-size: 16px;">
        <a href="${reportUrl}" style="display: inline-block; background: #1D4A35; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 4px; font-family: sans-serif; font-size: 15px;">
          View Full Report →
        </a>
      </p>
      <p style="margin: 0 0 8px 0; font-size: 16px;">Thank you for your continued trust,</p>
      <p style="margin: 16px 0 4px 0; font-size: 16px;">Brian FitzGerald</p>
      <p style="margin: 0; font-size: 16px; color: #555;">Protecting your Asset</p>
      <p style="margin: 0; font-size: 16px; color: #555;">BMF Enterprises, LLC</p>
    </td>
  </tr>
</table>
</body></html>`

  const resendRes = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from:     'Brian FitzGerald <brian@bmf.llc>',
      reply_to: 'brian@bmf.llc',
      to:       [recipientEmail],
      subject:  `${property.display_name} Owner Report — ${monthYear}`,
      html,
    }),
  })

  if (!resendRes.ok) {
    const errBody = await resendRes.json().catch(() => ({}))
    return res.status(502).json({ error: 'Email send failed', detail: errBody })
  }

  await supabase
    .from('owner_reports')
    .update({ emailed_at: new Date().toISOString() })
    .eq('id', id)

  return res.status(200).json({ success: true, sent_to: recipientEmail })
}

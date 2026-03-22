// api/owner-reports/pdf.js
// GET /api/owner-reports/pdf?token=<report-uuid>
// Returns a PDF of the owner report — serves cached version or generates fresh.
import { supabase }  from '../../lib/supabase.js'
import chromium      from '@sparticuz/chromium'
import puppeteer     from 'puppeteer-core'

const BUCKET = 'reports'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()

  const { token } = req.query
  if (!token) return res.status(400).json({ error: 'token is required' })

  const { data: report, error: reportErr } = await supabase
    .from('owner_reports')
    .select('id, month, year, status, pdf_path, owners(slug), properties(id, display_name)')
    .eq('id', token)
    .single()

  if (reportErr || !report) return res.status(404).json({ error: 'Report not found' })

  // Serve cached PDF only for published reports
  if (report.status === 'published' && report.pdf_path) {
    const { data: signed, error: signErr } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUrl(report.pdf_path, 3600)
    if (!signErr && signed?.signedUrl) {
      return res.redirect(302, signed.signedUrl)
    }
    // Fall through and regenerate if signed URL fails
  }

  // Construct the public report URL
  const mm        = String(report.month).padStart(2, '0')
  const host      = req.headers.host || 'ops.bmf.llc'
  const protocol  = host.includes('localhost') ? 'http' : 'https'
  const reportUrl = `${protocol}://${host}/owner-reports/${mm}-${report.year}/${report.owners.slug}/${report.properties.id}`

  const isVercel       = !!process.env.VERCEL
  const executablePath = isVercel
    ? await chromium.executablePath()
    : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

  let browser
  try {
    browser = await puppeteer.launch({
      args:            isVercel ? chromium.args : ['--no-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless:        true,
    })

    const page = await browser.newPage()
    await page.goto(reportUrl, { waitUntil: 'networkidle0', timeout: 30000 })
    await page.waitForSelector('.report-container', { timeout: 15000 })

    const pdfBuffer = await page.pdf({
      format:          'A4',
      printBackground: true,
      margin:          { top: '0.75in', right: '0.75in', bottom: '0.75in', left: '0.75in' },
    })

    await browser.close()
    browser = null

    // Upload to Supabase Storage
    const fileName = `${report.id}.pdf`
    const { error: uploadErr } = await supabase
      .storage
      .from(BUCKET)
      .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })

    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`)

    // Only stamp pdf_path on published reports — drafts always regenerate
    if (report.status === 'published') {
      await supabase
        .from('owner_reports')
        .update({ pdf_path: fileName })
        .eq('id', report.id)
    }

    const { data: signed } = await supabase
      .storage
      .from(BUCKET)
      .createSignedUrl(fileName, 3600)

    return res.redirect(302, signed.signedUrl)
  } catch (err) {
    if (browser) { try { await browser.close() } catch (_) {} }
    return res.status(500).json({ error: err.message })
  }
}

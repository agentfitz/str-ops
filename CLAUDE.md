# STR Ops — Project Brief for Claude

## What This Is
**STR Ops** is an internal operations dashboard for **BMF Enterprises**, a short-term rental (STR) property management business owned by Brian FitzGerald. It is a custom back-office tool — not a SaaS product — built to track revenue, expenses, occupancy, and generate owner-facing monthly reports.

## Working Style
This project is built using a **Directed Build** approach — Brian drives product and architecture decisions, Claude Code (CC) handles implementation, and Claude (chat) serves as product manager and business analyst. Specs are written in chat and handed to CC for implementation. CC should never make product decisions unilaterally — if something is ambiguous, ask.

---

## The Business
- BMF Enterprises manages a portfolio of STR properties across 3 markets
- Some properties are 100% owner-operated; others have split ownership
- Key data flows: bookings come from **IGMS** (property management system), expenses come from **Baselane** (landlord banking)
- Booking platforms used: Airbnb, VRBO, and direct bookings via stay.bmf.llc

## Property Portfolio
| ID | Display Name | Public Name | Market | Notes |
|----|-------------|-------------|--------|-------|
| `village-lane` | Village Lane | Village Lane | Greensboro, NC | Active — Brian FitzGerald 100% |
| `walker` | Walker | Lindley Park Cottage | Greensboro, NC | Active — Moriah Angott 100% (IGMS name: "Lindley Park Cottage") |
| `kenview` | Kenview | Kenview | Greensboro, NC | Not yet live — exclude from all revenue metrics and filters |
| `hidden-hollow` | Hidden Hollow | Hidden Hollow | Snowshoe, WV | Active — 49% Brian / 51% Michael FitzGerald (Brian's father) |
| `lee-ct` | Lee Ct | Canal Front Cottage | OBX (Kill Devil Hills, NC) | Active — 100% Michael FitzGerald (Brian's father) |

**Important:** IGMS and Baselane use different property names than the internal IDs. The `properties` table maps between them via `igms_name` and `baselane_name` columns. A `public_name` column exists in the DB for guest-facing URLs and marketing. Internal UI uses `display_name`.

## Ownership
- **Brian FitzGerald** — primary operator, owns Village Lane, Kenview (100% each), and 49% of Hidden Hollow
- **Moriah Angott** — owns Walker 100%
- **Michael FitzGerald** (Brian's father) — owns 51% of Hidden Hollow and 100% of Lee Ct
- Ownership is stored in the `property_owners` junction table with `ownership_pct`
- There is NO `payout_mode` column on `property_owners`. High `operating_minimum_balance` is the correct mechanism for reserve-building owners (e.g. $1,000,000 effectively holds all funds).

## Key Concepts
- **Stay Type** — every reservation is classified as: `Revenue`, `Owner Stay`, `Comp Stay`, or `Flag for Review`. Only `Revenue` stays count toward financial metrics.
- **Stay type classification** is done automatically in `lib/services/classifier.js` based on payout amount, invoice status, and check-in date (historical vs future). Manual overrides are supported via `MANUAL_OVERRIDES` dict in classifier.js.
- **Metrics** tracked: Gross Revenue, Occupancy %, ADR (avg daily rate), RevPAR (revenue per available night), total bookings, owner nights
- **Owner Reports** — monthly reports per property/owner with an AI-generated summary (Claude API) and optional manual notes from the host

## Revenue Source of Truth (Owner Reports)

Two data sources serve different purposes — never mix them for the same calculation:

| Purpose | Source | Table |
|---|---|---|
| Gross revenue, YTD revenue, historical comparisons | IGMS | `reservations` |
| Expenses, management fee | Baselane | `expenses` |
| Account balance, owner payout | Manual entry | `account_balances` |
| Bookings, nights, occupancy, guest details | IGMS | `reservations` |

**Gross Revenue** = `SUM(expected_total_payout)` from `reservations` where `stay_type = 'Revenue'` and `checkin_date` falls within the report month. This is accrual-correct — revenue tied to stay dates, not deposit dates.

**Why IGMS, not Baselane?** All legitimate bookings — Airbnb, VRBO, and direct bookings through stay.bmf.llc — appear in IGMS with correct stay dates and expected payout amounts. Baselane deposits are cash-basis: a 50% deposit for an August stay hits the bank in March, which would distort monthly revenue. IGMS is accrual-correct. Use it for all revenue figures.

**Known gap:** Manual off-platform Stripe invoices (a guest extended their stay via a direct Stripe invoice before the direct booking site was live) will appear in Baselane but not IGMS. This was a one-off pre-launch workaround. If it ever recurs, the correct fix is to manually add the reservation in IGMS — not to change the revenue source logic.

## Business Rules
- Occupancy = revenue nights / available nights (365 per property, hardcoded for now — `available_nights` column exists in schema for future use)
- Owner Revenue = Gross Revenue minus PM commission. Rates are per-property — see PM Commission rates in the Owner Reports section.
- Kenview is inactive — exclude from all revenue metrics, charts, and property filters
- Stay type `Void` is excluded from all imports entirely
- Baselane `Transfers & Other` type rows are skipped on import
- `source_hash` on expenses = SHA-256 of `date + account + merchant + amount + description` (upsert key — safe to re-run). `account` (not `property`) is used because `property` is user-editable in Baselane and would orphan rows on reassignment.
- `reservation_code` on reservations is the upsert key — safe to re-run imports
- BMF Enterprises portfolio-level transactions import with null `property_id`

## Schema Notes
`supabase/schema.sql` is the canonical schema and seed state. The following were added via live migrations and are reflected in schema.sql:

- `properties.public_name` (text) — guest-facing name for book-direct pages
- `properties.pm_commission_rate` (numeric 5,2) — PM commission rate per property (e.g. 16.00 = 16%)
- `properties.operating_minimum_balance` (numeric 10,2) — reserve kept in Baselane account; payout = closing_balance − mgmt_fee − this. Setting this very high (e.g. $1,000,000) is the correct way to configure a reserve-building owner.
- `expenses.source_hash` (text, unique) — SHA-256 upsert key for Baselane imports
- `owners.slug` (text) — URL-safe identifier used in report URLs
- `owners.nickname` (text) — informal name used in AI-generated summaries (e.g. 'Pops', 'Goose'); falls back to first name if null
- `account_balances` table — month-end balances per property/month/year; unique on (property_id, month, year). Columns: `operating_account_balance` (required), `reserves_account_balance` (default 0, optional — for properties with interest-earning reserves accounts)
- `reviews` table — manually seeded guest reviews per property; includes `guest_location` field (e.g. 'Elk Grove, CA', nullable)
- `owner_reports.featured_review_id` (uuid) — randomly selected at generation time and permanently stamped on the report; re-rolled on every regeneration
- `owner_reports.manual_payout_amount` (numeric 10,2) — optional payout override: null = use formula (default), 0 = suppress distribution, any amount = override in either direction
- `owner_reports.emailed_at` (timestamptz) — stamped when report link is sent via Resend; null = never sent
- `owner_reports.pdf_path` (text) — Supabase Storage path in `reports` bucket (e.g. `{uuid}.pdf`); null = not yet generated; cached on first generate

Seed data (correct state):
- Brian FitzGerald (`00000000-...0001`, slug `brian-fitzgerald`)
- Michael FitzGerald (`00000000-...0002`, slug `michael-fitzgerald`) — was "Brian Sr." in early seed, now corrected
- Moriah Angott (`00000000-...0003`, slug `moriah-angott`)
- Walker ownership: Moriah 100% (not Brian)
- Hidden Hollow: Brian 49%, Michael 51%

## Tech Stack
- **Backend**: Node.js (ESM) — `server.js` uses **Express** for local dev, serving static files and API routes
- **Auth**: Passport.js + Google OAuth 2.0 + JWT cookie. `lib/auth.js` (strategy), `lib/jwt.js` (sign/verify), `middleware.js` (Vercel Edge Middleware — intercepts at CDN before any file is served). Cookie: `bmf-auth`, 7-day, HttpOnly/Secure/SameSite=Lax, HMAC-SHA256 signed with `SESSION_SECRET`. OAuth handshake uses `cookie-session` (stateless — stored in signed `bmf-oauth` cookie, works across serverless invocations). Local dev: `lib/requireAuth.js` does same JWT check in Express. Public routes: `/login`, `/api/auth/`, `/api/webhooks/igms`, `/owner-reports/`, `/views/owner-report`, `/api/reports/`, `/book-direct/`, `/css/`, `/js/`, `/img/`.
- **API style**: Vercel serverless handler pattern (`export default async function handler(req, res)`) — works both locally and deployed to Vercel
- **Database**: Supabase (Postgres) — `lib/supabase.js` for the client
- **Frontend**: Vanilla HTML + Alpine.js for reactivity, custom CSS design system (tokens, base, nav, card, table)
- **Charts**: Chart.js 4.4.1
- **Data import**: CSV importers in `scripts/importers/` for IGMS and Baselane exports (uses PapaParse)
- **AI**: Claude API used for generating owner report summaries (`lib/services/aiSummary.js`)
- **Email**: Resend — for owner report delivery notifications. Domain: bmf.llc. API key in `RESEND_API_KEY`. DNS verification pending in Squarespace.
- **PDF**: `puppeteer-core` + `@sparticuz/chromium` — renders report page headlessly, uploads to Supabase Storage `reports/` bucket, serves via signed URL. `maxDuration: 60` set in vercel.json.

## Design System
- **Fonts**: Playfair Display (headings/serif), DM Sans (body), IBM Plex Mono (numbers/data/labels)
- **Colors**: `#F7F5F0` bg (warm off-white), `#1A1A1A` ink, `#1D4A35` accent green, `#FFFFFF` surface/card bg
- **Property chart colors**: Hidden Hollow `#4A90A4`, Village Lane `#9B7EC8`, Lee Ct `#E8A838`, Walker `#5FAD78`
- **Metric cards**: 5-column pastel grid using nth-child colors (sage/periwinkle/sand/lavender/sky)
- **Aesthetic**: Editorial/utilitarian — Bloomberg Terminal meets Field Notes. No generic AI aesthetics, no Inter/Roboto, no purple gradients.
- All design tokens live in `public/css/tokens.css` — always reference tokens, never hardcode colors or fonts

## Project Structure
```
middleware.js               # Vercel Edge Middleware — JWT auth check at CDN level
server.js                   # Local dev Express server
vercel.json                 # Vercel deployment config
api/                        # API route handlers (Vercel serverless pattern)
  auth/
    google.js               # GET /api/auth/google — initiates Google OAuth
    logout.js               # GET /api/auth/logout — clears bmf-auth cookie
    callback/
      google.js             # GET /api/auth/callback/google — sets JWT cookie on success
  igms/
    connect.js              # GET /api/igms/connect — redirects to IGMS OAuth page
    callback.js             # GET /api/igms/callback?code= — exchanges auth code for token
    sync.js                 # POST /api/igms/sync — fetches bookings from IGMS API, upserts to DB
  webhooks/
    igms.js                 # POST /api/webhooks/igms — IGMS event handler (PUBLIC, no auth required)
  metrics/
    summary.js              # GET /api/metrics/summary?year&month&property
    forward.js              # GET /api/metrics/forward?property
    bookings.js             # GET /api/metrics/bookings?year&property
  reservations/
    index.js                # GET /api/reservations?year&property
    years.js                # GET /api/reservations/years
  reports/
    summary.js              # GET /api/reports/summary?property=&owner=&month=&year= — PUBLIC
  owner-reports/
    index.js                # GET /api/owner-reports — list all reports with status
    data.js                 # GET /api/owner-reports/data?property=&owner=&month=&year=
    generate.js             # POST /api/owner-reports/generate
    save.js                 # PUT /api/owner-reports/save
    publish.js              # POST /api/owner-reports/publish
    send-email.js           # POST /api/owner-reports/send-email — send report link via Resend
    history.js              # GET /api/owner-reports/history?owner=&property= — up to 6 published reports
    pdf.js                  # GET /api/owner-reports/pdf?token=<uuid> — generate or serve cached PDF
  properties.js             # GET /api/properties
  owners.js                 # GET /api/owners?property= (optional filter)
  upload.js                 # POST /api/upload (CSV import)
  account-balances.js       # POST /api/account-balances (upsert month-end closing balance)
lib/
  auth.js                   # Passport Google OAuth 2.0 strategy + serialize/deserialize
  jwt.js                    # createToken / verifyToken using Web Crypto (Edge + Node compatible)
  requireAuth.js            # JWT cookie check middleware for local Express server
  withAuth.js               # Wraps api/auth/* handlers with cookie-session + passport
  supabase.js               # Supabase client
  propertyMap.js            # IGMS/Baselane name → canonical property ID mapping
  services/
    classifier.js           # Stay type classification logic
    reportGenerator.js      # Owner report data aggregation
    aiSummary.js            # Claude API-powered report summaries
public/
  index.html                # Dashboard — served at / on ops.bmf.llc
                            # Lives at public/index.html (not public/views/) to satisfy
                            # Vercel static file serving for root route.
  dashboard.html            # LEGACY/STALE — do not link to or build on this file.
  login.html                # Sign-in page — public, Google OAuth CTA
  views/                    # Internal app pages (all auth-protected)
    bookings.html           # Functional
    reports.html            # Functional — owner report generation + admin
    owner-report.html       # Owner report viewer — PUBLIC (token-based, no auth required)
    admin.html              # Functional — CSV upload + account balance entry
    financials.html         # Planned — not yet created
  book-direct/              # Guest-facing direct booking pages (stay.bmf.llc)
    index.html              # Property selector
    canal-front-cottage.html
    hidden-hollow.html
    village-lane.html
    lindley-park-cottage.html
    img/                    # Property photos (.avif) + brian-moriah.jpg
    book-direct.css
  js/
    dashboard.js
    reports.js
    upload.js
  css/
    tokens.css
    base.css
    nav.css
    card.css
    table.css
    form.css
    report.css              # Owner report viewer styles
scripts/
  importers/
    igms.js                 # CLI: npm run import:igms path/to/file.csv
    baselane.js             # CLI: npm run import:baselane path/to/file.csv
supabase/
  schema.sql                # DB schema — canonical, kept in sync with live DB
```

## Deployment
- Hosted on **Vercel Pro** at `str-ops.vercel.app`
- `ops.bmf.llc` → internal dashboard (auth-protected)
- `stay.bmf.llc` → guest-facing book-direct pages (public)
- Subdomain routing handled via host-based rewrites in `vercel.json`
- `cleanUrls: true` — no `.html` extensions in URLs
- Environment variables set in Vercel dashboard (not committed to repo)

## Environment Variables
```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
ANTHROPIC_API_KEY=
SESSION_SECRET=        ← long random hex string, used for JWT HMAC-SHA256 signing
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ALLOWED_EMAILS=        ← comma-separated list of authorized Google accounts
RESEND_API_KEY=        ← Resend email API key (setup in progress)
```

Note: `DATABASE_URL` was added during a session store experiment but may no longer be needed now that auth uses stateless JWT cookies. Confirm with CC whether it can be removed from `.env` and Vercel.

## Views / Pages
- `/` → Dashboard (portfolio KPIs + per-property table + 90-day occupancy forecast)
- `/views/bookings` → Reservations table with filtering + charts — **functional**
- `/views/financials` → Expense tracking — **planned, not yet created**
- `/views/reports` → Owner report generation admin — **functional**
- `/owner-reports/[token]` → Published owner report viewer — **PUBLIC, token-based** *(spec written, implementation pending)*
- `/views/admin` → CSV upload UI for IGMS and Baselane data — **functional**

## Running Locally
```bash
node server.js               # Starts at http://localhost:3000
npm run import:igms          # Import reservations from IGMS CSV
npm run import:baselane      # Import expenses from Baselane CSV
```

### When a server restart is required
**Restart required after changes to:** `lib/`, `server.js`, `.env`
**No restart needed after changes to:** `api/`, `public/`, `vercel.json`

Claude should always tell Brian whether a restart is required after making changes.

## Standing Preferences
- Keep the stack simple — no unnecessary frameworks or dependencies
- Vercel-compatible handler pattern for all API routes
- Alpine.js for frontend reactivity (already established, keep consistent)
- No TypeScript — plain JavaScript ESM throughout
- No React, no Next.js, no build step
- Internal modules (services, helpers) live in `lib/` — never in `api/`
- Only true serverless function entry points live in `api/`

---

## Keeping This File Up To Date

This file is the source of truth for Claude's understanding of the project. It will go stale if not maintained.

### Claude's responsibilities
At the end of any session where a meaningful change was made, Claude should proactively suggest specific updates to this file. Claude should not wait to be asked.

**Always update this file when:**
- A new property is added or its status changes
- A new page or API route is added
- A new environment variable is introduced
- The deployment setup changes
- A new dependency is added to the stack
- A business rule is clarified or changed
- A live DB migration is applied — document it in Schema Notes immediately
- An open question gets resolved

**No need to update for:**
- Routine bug fixes or styling tweaks
- Changes within existing files that don't affect architecture or business rules
- Temporary or experimental code

### How to update
1. Quote the specific section that needs changing
2. Propose the exact new text
3. By default, ask Brian to confirm before writing
4. If Brian says "just update it directly" — do so without confirmation for the rest of that session

### Brian's responsibilities
- Flag resolved open questions so they can be closed out
- Skim this file at the start of a new session after a significant gap
- Tell Claude when a live DB migration is applied

---

## Owner Reports

### Purpose
Monthly per-property, per-owner reports showing performance and payout. Delivered as a clean responsive HTML page at a static token-based URL. Designed for savvy but non-technical owners — no acronyms, no BI dashboard feel. Think "Medium article" — clean typography, generous whitespace.

### URL structure
`/owner-reports/[token]` — public, no login required, token-based access
*(Token generated at report creation time, stored on `owner_reports` row)*

### Report layout (v1)
1. **Header** — property name, owner name, month/year + YTD gross revenue
2. **Two hero cards** — Gross Revenue (left) + Total Holdings (right). Total Holdings = combined operating + reserves balance. Shows "Pending" if no balance entered yet. **Hero 2 is ALWAYS Total Holdings — never swaps based on distribution status.**
3. **Distribution banner** — appears directly below heroes when `effective_payout > 0`. Shows: 💰 Distribution Issued — [Month Year] / $amount. Hidden when no distribution.
4. **Executive Summary** — AI-generated (Claude API). Editable before publishing. Uses owner nickname if set (e.g. "Pops").
5. **Occupancy Snapshot** — Two-column layout on desktop: text metrics left, 7-column calendar grid right. Grid: revenue nights = dark green (`#2C5F4A`), owner/comp = muted green, vacant = warm off-white (`#F0EDE8`), today = dot. Stacks on mobile.
6. **Financials waterfall** — Gross Revenue → Management Fee (est. badge if estimated) → dynamic expense categories from Baselane → Net Cash Flow total (negative shown in amber/muted red)
7. **Owner Payout section** — account balance(s) → Operating Minimum deduction → Owner Distribution. Two-level wash system: Level 1 (dotted border, normal text) for subtotals like Total Holdings; Level 2 (solid border, Playfair Display, larger) for final Owner Distribution. "No distribution this month." shown as plain italic when payout = 0.
8. **Bookings This Month** — table: dates, platform, nights, payout
9. **Featured Guest Review** — randomly selected at generation time, permanently stamped. Collapses at 280 chars with inline expand toggle. Byline: guest name · location · month year. Placed between Bookings This Month and Coming Up.
10. **Coming Up** — next month's bookings: dates, nights, platform, expected payout
11. **Footer** — "Questions about this report? Contact Brian at brian@bmf.llc" + BMF Enterprises branding

### Hero cards
- **Hero 1 — Gross Revenue**: always shows property revenue for the month
- **Hero 2 — Total Holdings**: always shows combined account balance. "Pending" if no balance entered. Never swaps based on distribution status.

### Distribution banner
Appears directly below heroes when `effective_payout > 0`:
```
💰  Distribution Issued — [Month Year]
    $X,XXX.XX transferred to owner
```

### Payout calculation
```javascript
combined_balance = operating_account_balance + (reserves_account_balance ?? 0)
mgmt_fee = gross_revenue × (pm_commission_rate / 100)
distributable = combined_balance − mgmt_fee − operating_minimum_balance
calculated_payout = MAX(0, distributable) × (ownership_pct / 100)
effective_payout = manual_payout_amount ?? calculated_payout
```

- `manual_payout_amount = null` → use formula (default for all owners)
- `manual_payout_amount = 0` → suppress distribution
- `manual_payout_amount = any amount` → override in either direction

Setting `operating_minimum_balance` very high (e.g. $1,000,000) is the correct way to configure a reserve-building owner — no special flag needed.

### Payout display — single vs. dual account
- `reserves_account_balance = 0`: one "Operating Account Balance" line
- `reserves_account_balance > 0`: Operating + Reserves lines, then Total Holdings subtotal, then deductions

### Net Cash Flow
Net Cash Flow = Gross Revenue + Management Fee + sum of all expense amounts (expenses stored as negative numbers)

### PM Commission rates
- Village Lane: 0% (Brian owns)
- Walker: 0% (Moriah — not charging yet)
- Hidden Hollow: 16%
- Lee Ct: 16%
- Kenview: N/A

### Report scope
| Property | Owner(s) | Reports? |
|---|---|---|
| Village Lane | Brian (100%) | Yes |
| Walker | Moriah (100%) | Yes |
| Hidden Hollow | Brian (49%) + Michael (51%) | Yes — two reports, prorated |
| Lee Ct | Michael (100%) | Yes |
| Kenview | N/A | No — skip until active |

### Generation workflow
1. Admin selects property + owner + month/year → Generate
2. New report: created in `draft`, AI summary generated, review randomly stamped
3. Existing report: prompt to View or Overwrite
4. Brian reviews, edits AI summary if needed → Publish
5. Published report accessible at `/owner-reports/[token]`

### Planned but not yet implemented
- Static token-based owner report URLs (`/owner-reports/[token]`)
- PDF generation caching invalidation (currently cached indefinitely; re-generate will produce stale PDF until manually cleared)

### Implemented
- Email delivery via Resend (`api/owner-reports/send-email.js`) — ✉ Send button on report viewer (published only), opens modal with pre-filled owner email and editable To field
- Report history dropdown on viewer — shows up to 6 prior published months, navigates between them
- PDF generation via Puppeteer + `@sparticuz/chromium` (`api/owner-reports/pdf.js`) — draft reports always regenerate; published reports cached in Supabase Storage `reports/` bucket

---

## Open Questions / Things Claude Doesn't Know Yet
- [ ] Resend domain verification for bmf.llc — DNS records needed in Squarespace (in progress)
- [ ] IGMS webhook handler `/api/webhooks/igms` — route is public and in auth config but handler implementation status unknown
- [ ] IGMS API sync — OAuth flow implemented, full sync implementation status unknown
- [ ] PDF/print generation — server-side Puppeteer preferred, not yet implemented
- [x] `DATABASE_URL` — removed. Was only used by `connect-pg-simple` (now deleted). Auth is stateless JWT; Supabase uses `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`.
- [ ] Whether there are plans to expand the property portfolio
- [ ] Seasonal pricing strategy or yield management goals
- [ ] Brian's ownership % on Kenview (relevant when it goes active)
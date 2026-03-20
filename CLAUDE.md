# STR Ops — Project Brief for Claude

## What This Is
**STR Ops** is an internal operations dashboard for **BMF Enterprises**, a short-term rental (STR) property management business owned by Brian FitzGerald. It is a custom back-office tool — not a SaaS product — built to track revenue, expenses, occupancy, and generate owner-facing monthly reports.

## The Business
- BMF Enterprises manages a portfolio of STR properties across 3 markets
- Some properties are 100% owner-operated; others have split ownership
- Key data flows: bookings come from **IGMS** (property management system), expenses come from **Baselane** (landlord banking)
- Booking platforms used: Airbnb, VRBO, and direct bookings

## Property Portfolio
| ID | Display Name | Public Name | Market | Notes |
|----|-------------|-------------|--------|-------|
| `village-lane` | Village Lane | Village Lane | Greensboro, NC | Active |
| `walker` | Walker | Lindley Park Cottage | Greensboro, NC | Active (IGMS name: "Lindley Park Cottage") |
| `kenview` | Kenview | Kenview | Greensboro, NC | Not yet live — exclude from all revenue metrics and filters |
| `hidden-hollow` | Hidden Hollow | Hidden Hollow | Snowshoe, WV | Active — 49% Brian / 51% Michael FitzGerald (Brian's father) |
| `lee-ct` | Lee Ct | Canal Front Cottage | OBX (Kill Devil Hills, NC) | Active — 100% Michael FitzGerald (Brian's father) |

**Important:** IGMS and Baselane use different property names than the internal IDs. The `properties` table maps between them via `igms_name` and `baselane_name` columns. A `public_name` column exists in the DB (added via migration — see Schema Notes) for guest-facing URLs and marketing. Internal UI uses `display_name`.

## Ownership
- **Brian FitzGerald** — primary operator, owns Village Lane, Kenview (100% each), and 49% of Hidden Hollow
- **Moriah Angott** — owns Walker (100%)
- **Michael FitzGerald** (Brian's father) — owns 51% of Hidden Hollow and 100% of Lee Ct
- Ownership is stored in the `property_owners` junction table with `ownership_pct`

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

**YTD Gross Revenue** — same logic, Jan 1 through end of report month, from `reservations`.

**Occupancy** — `reservations` table. Revenue nights and stay dates are accurate in IGMS.

**Known gap:** Manual off-platform Stripe invoices (a guest extended their stay via a direct Stripe invoice before the direct booking site was live) will appear in Baselane but not IGMS. This was a one-off pre-launch workaround. If it ever recurs, the correct fix is to manually add the reservation in IGMS — not to change the revenue source logic.

## Business Rules
- Occupancy = revenue nights / available nights (365 per property, hardcoded for now — `available_nights` column exists in schema for future use)
- Owner Revenue = Gross Revenue minus PM commission (no standard rate currently defined)
- Kenview is inactive — exclude from all revenue metrics, charts, and property filters
- Stay type `Void` is excluded from all imports entirely
- Baselane `Transfers & Other` type rows are skipped on import
- `source_hash` on expenses = SHA-256 of date+account+merchant+amount+description (upsert key — safe to re-run). `account` (not `property`) is used because `property` is user-editable in Baselane and would orphan rows on reassignment.
- `reservation_code` on reservations is the upsert key — safe to re-run imports
- BMF Enterprises portfolio-level transactions import with null `property_id`

## Schema Notes
`supabase/schema.sql` is the canonical schema and seed state. The following were added via live migrations and are now reflected in schema.sql:

- `properties.public_name` (text) — guest-facing name for book-direct pages
- `properties.pm_commission_rate` (numeric 5,2) — PM commission rate per property (e.g. 16.00 = 16%)
- `properties.operating_minimum_balance` (numeric 10,2) — reserve kept in Baselane account; payout = closing_balance − this
- `expenses.source_hash` (text, unique) — SHA-256 upsert key for Baselane imports
- `owners.slug` (text) — URL-safe identifier used in report URLs
- `owners.nickname` (text) — informal name used in AI-generated summaries (e.g. 'Pops', 'Goose'); falls back to first name if null
- `account_balances` table — month-end balances per property/month/year; unique on (property_id, month, year). Columns: `operating_account_balance` (required), `reserves_account_balance` (default 0, optional — for properties with interest-earning reserves)
- `reviews` table — manually seeded guest reviews per property; includes `guest_location` field (e.g. 'Elk Grove, CA')
- `owner_reports.featured_review_id` (uuid) — randomly selected at generation time and permanently stamped on the report; re-rolled on every regeneration

Seed data (correct state):
- Brian FitzGerald (`00000000-...0001`, slug `brian-fitzgerald`)
- Michael FitzGerald (`00000000-...0002`, slug `michael-fitzgerald`) — was "Brian Sr." in early seed
- Moriah Angott (`00000000-...0003`, slug `moriah-angott`)
- Walker ownership: Moriah 100% (not Brian)
- Hidden Hollow: Brian 49%, Michael 51%

## Tech Stack
- **Backend**: Node.js (ESM) — `server.js` uses **Express** for local dev, serving static files and API routes
- **Auth**: Passport.js + Google OAuth 2.0 + JWT cookie. `lib/auth.js` (strategy), `lib/jwt.js` (sign/verify), `middleware.js` (Vercel Edge Middleware — intercepts at CDN before any file is served). Cookie: `bmf-auth`, 7-day, HttpOnly/Secure/SameSite=Strict, HMAC-SHA256 signed with `SESSION_SECRET`. OAuth handshake uses `cookie-session` (stateless — stored in signed `bmf-oauth` cookie, works across serverless invocations). Local dev: `lib/requireAuth.js` does same JWT check in Express. Public routes: `/login`, `/api/auth/`, `/owner-reports/`, `/views/owner-report`, `/api/reports/`, `/book-direct/`, `/css/`, `/js/`, `/img/`.
- **API style**: Vercel serverless handler pattern (`export default async function handler(req, res)`) — works both locally and deployed to Vercel
- **Database**: Supabase (Postgres) — `lib/supabase.js` for the client
- **Frontend**: Vanilla HTML + Alpine.js for reactivity, custom CSS design system (tokens, base, nav, card, table)
- **Charts**: Chart.js 4.4.1
- **Data import**: CSV importers in `scripts/importers/` for IGMS and Baselane exports (uses PapaParse)
- **AI**: Claude API used for generating owner report summaries (`lib/services/aiSummary.js`)

## Design System
- **Fonts**: Playfair Display (headings/serif), DM Sans (body), IBM Plex Mono (numbers/data/labels)
- **Colors**: `#F7F5F0` bg (warm off-white), `#1A1A1A` ink, `#1D4A35` accent green, `#FFFFFF` surface/card bg
- **Property chart colors**: Hidden Hollow `#4A90A4`, Village Lane `#9B7EC8`, Lee Ct `#E8A838`, Walker `#5FAD78`
- **Metric cards**: 5-column pastel grid using nth-child colors (sage/periwinkle/sand/lavender/sky)
- **Aesthetic**: Editorial/utilitarian — Bloomberg Terminal meets Field Notes. No generic AI aesthetics, no Inter/Roboto, no purple gradients.
- All design tokens live in `public/css/tokens.css` — always reference tokens, never hardcode colors or fonts

## Project Structure
```
api/                        # API route handlers (Vercel serverless pattern)
  metrics/
    summary.js              # GET /api/metrics/summary?year&month&property
    forward.js              # GET /api/metrics/forward?property
    bookings.js             # GET /api/metrics/bookings?year&property
  reservations/
    index.js                # GET /api/reservations?year&property
    years.js                # GET /api/reservations/years
  properties.js             # GET /api/properties
  owners.js                 # GET /api/owners?property= (optional filter)
  upload.js                 # POST /api/upload (CSV import)
  account-balances.js       # POST /api/account-balances (upsert month-end closing balance)
  reports/
    summary.js              # GET /api/reports/summary?property=&owner=&month=&year= (consolidated report data)
  owner-reports/
    index.js                # GET /api/owner-reports (list all with status)
    generate.js             # POST /api/owner-reports/generate
    save.js                 # PUT /api/owner-reports/save
    publish.js              # POST /api/owner-reports/publish
lib/
  supabase.js               # Supabase client
  propertyMap.js            # IGMS/Baselane name → canonical property ID mapping
  services/
    classifier.js           # Stay type classification logic
    reportGenerator.js      # Owner report generation
    aiSummary.js            # Claude API-powered report summaries
public/
  index.html                # Dashboard — this IS the dashboard, served at / on ops.bmf.llc
                            # It lives at public/index.html (not public/views/) specifically
                            # to satisfy Vercel's static file serving for the root route.
                            # There is no separate dashboard.html — do not create one.
  views/                    # Internal app pages
    bookings.html           # Functional
    financials.html         # Stub — not yet functional
    reports.html            # Functional — owner report generation + admin
    owner-report.html       # Owner report viewer (single template, parses URL path)
    admin.html              # Functional — CSV upload + account balance entry
  book-direct/              # Guest-facing direct booking landing pages
    index.html              # Property selector (stay.bmf.llc root)
    canal-front-cottage.html
    hidden-hollow.html
    village-lane.html
    lindley-park-cottage.html
    img/                    # Property photos (.avif) + brian-moriah.jpg
    book-direct.css         # Shared styles for book-direct pages
  js/                       # Client-side JS
  css/                      # Design tokens and component styles
    tokens.css
    base.css
    nav.css
    card.css
    table.css
    form.css
    report.css                # Owner report viewer styles (separate from dashboard)
scripts/
  importers/
    igms.js                 # CLI: npm run import:igms path/to/file.csv
    baselane.js             # CLI: npm run import:baselane path/to/file.csv
supabase/
  schema.sql                # DB schema — canonical, kept in sync with live DB
server.js                   # Local dev server
vercel.json                 # Vercel deployment config
```

## Deployment
- Hosted on **Vercel Pro** at `str-ops.vercel.app`
- `ops.bmf.llc` → internal dashboard (`/views/` pages)
- `stay.bmf.llc` → guest-facing book-direct pages (`/book-direct/`)
- Subdomain routing handled via host-based rewrites in `vercel.json`
- `cleanUrls: true` — no `.html` extensions in URLs
- Environment variables set in Vercel dashboard (not committed to repo)

## Environment Variables
```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
ANTHROPIC_API_KEY=
SESSION_SECRET=        ← long random hex string (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ALLOWED_EMAILS=        ← comma-separated list of authorized Google accounts
```

## Views / Pages
- `/` → Dashboard (portfolio KPIs + per-property table + 90-day occupancy forecast)
- `/views/bookings` → Reservations table with filtering + charts — **functional**
- `/views/financials` → Expense tracking — **stub, not yet functional**
- `/views/reports` → Owner report generation admin — **functional**
- `/owner-reports/[mm-yyyy]/[owner-slug]/[property-slug]` → Published owner report viewer
- `/views/admin` → CSV upload UI for IGMS and Baselane data — **functional**

## Running Locally
```bash
node server.js               # Starts at http://localhost:3000
npm run import:igms          # Import reservations from IGMS CSV
npm run import:baselane      # Import expenses from Baselane CSV
```

### When a server restart is required
`server.js` cache-busts API handlers in `api/` on every request (via `?t=Date.now()` import trick), but `lib/` modules are cached by Node's ESM module registry after first import. This means:

**Restart required after changes to:**
- Anything in `lib/` — `lib/supabase.js`, `lib/services/`, `lib/propertyMap.js`, etc.
- `server.js` itself
- `.env` — new or changed environment variables

**No restart needed after changes to:**
- Anything in `api/` — handlers are re-imported on every request
- Anything in `public/` — HTML, CSS, JS are served as static files
- `vercel.json` — not used by the local server

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

This file is the source of truth for Claude's understanding of the project. It will go stale if not maintained. Here's how to keep it honest:

### Claude's responsibilities
At the end of any session where a meaningful change was made, Claude should proactively suggest specific updates to this file. Claude should not wait to be asked.

**Always update this file when:**
- A new property is added or its status changes (active/inactive, ownership changes)
- A new page or API route is added
- A new environment variable is introduced
- The deployment setup changes (new subdomain, new domain, new config)
- A new dependency is added to the stack
- A business rule is clarified or changed (commission rates, classification logic, etc.)
- A live DB migration is applied — document it in Schema Notes immediately
- An open question gets resolved — move it out of the open questions list

**No need to update for:**
- Routine bug fixes or styling tweaks
- Changes within existing files that don't affect architecture or business rules
- Temporary or experimental code

### How to update
When suggesting updates, Claude should:
1. Quote the specific section that needs changing
2. Propose the exact new text
3. By default, ask Brian to confirm before writing
4. If Brian says "just update it directly" — do so without confirmation for the rest of that session

### Brian's responsibilities
- When resolving an open question (e.g. IGMS API access granted, commission rate decided), flag it to Claude so it can be moved out of the open questions list
- When starting a new Claude Code session after a significant gap, skim this file and flag anything that looks stale
- When applying a live DB migration, tell Claude so Schema Notes can be updated immediately

---

## Owner Reports

### Purpose
Monthly per-property, per-owner reports showing performance and payout. Delivered as a clean responsive HTML page at a static URL. Designed for savvy but non-technical owners — no acronyms, no BI dashboard feel. Think "Medium article" — clean typography, generous whitespace.

### URL structure
`ops.bmf.llc/owner-reports/[mm-yyyy]/[owner-slug]/[property-slug]`
e.g. `ops.bmf.llc/owner-reports/03-2026/michael-fitzgerald/hidden-hollow`

### Report layout (v1)
1. **Header** — property name, owner name, month/year + YTD gross revenue
2. **Two hero cards** — Gross Revenue (left) + Owner Payout (right, "Pending" if no balance entered yet)
3. **Executive Summary** — AI-generated (Claude API), only shown if `ai_summary` exists. Editable before publishing.
4. **Occupancy Snapshot** — Two-column layout: text metrics (X of Y nights, occupancy %, owner stay) on the left; a 7-column calendar grid on the right. Grid cells: revenue nights = dark green (#2C5F4A), owner/comp stays = muted green, vacant = warm off-white (#F0EDE8), today = dot indicator. Derived from existing `currentBookings` data, no extra API call. Stacks vertically on mobile.
5. **Financials waterfall** — Gross Revenue → Management Fee (est. badge if estimated) → dynamic expense categories → Net Cash Flow total
6. **Owner Payout section** — Closing Balance − Operating Minimum → Owner Payout. Shows proration row for split ownership. Warning if payout = 0.
7. **Bookings This Month** — table: dates, platform, nights, payout. Comp stays show "Comp".
8. **Featured Guest Review** — randomly selected at generation time, permanently stamped. Collapses at 280 chars with inline expand toggle. Byline: guest name · location · month year.
9. **Coming Up** — next month's bookings: dates, nights, platform, expected payout.
9. **Footer** — contact Brian / BMF branding

### Hero cards (report viewer)
- **Hero 1 — Gross Revenue**: always shows property revenue for the month
- **Hero 2 — Total Holdings**: always shows combined account balance (`operating + reserves`). "Pending" if no balance entered yet. Never swaps based on distribution status.

### Distribution banner
Appears directly below the two heroes when `effective_payout > 0`. Shows: 💰 Distribution Issued — [Month Year] / $amount. Not shown when no distribution this month.

### Payout display — single vs. dual account
- If `reserves_balance = 0`: show one "Operating Account Balance" line.
- If `reserves_balance > 0`: show Operating + Reserves lines, then a "Total Holdings" subtotal, then deductions.
- No distribution case shows "No distribution this month." as the total row (no warning box).

### Payout calculation
- `combined_balance` = `operating_account_balance` + `reserves_account_balance`
- `mgmt_fee` = `gross_revenue` × (`pm_commission_rate` / 100)
- `distributable` = `combined_balance` − `mgmt_fee` − `operating_minimum_balance`
- `calculated_payout` = `MAX(0, distributable)` × (`ownership_pct` / 100) — prorated by ownership %
- `effective_payout` = `manual_payout_amount ?? calculated_payout`
  - `null` = use calculated (default for all owners)
  - `0` = suppress distribution regardless of balance
  - Any amount = override in either direction
- Balances entered manually in Admin → Account Balance
- `operating_minimum_balance` stored on `properties` table — **setting this very high is the correct way to configure a reserve-building owner** (e.g. $1,000,000 effectively holds all funds in the account)
- For split-ownership: payout is prorated by `ownership_pct`

### Net Cash Flow calculation
- Net Cash Flow = Gross Revenue + Management Fee amount + sum of all expenses
- Management Fee: actual Baselane line item if present; else estimated as `grossRevenue × (pmCommissionRate / 100)` (shown with "est." badge)
- Expense amounts from Baselane are negative numbers; Management Fee stored as negative

### PM Commission rates (per property)
Stored in `properties.pm_commission_rate` (numeric, e.g. 16.00 = 16%).
- Village Lane: 0% (Brian owns, no commission)
- Walker / Lindley Park: 0% (Moriah — not charging yet)
- Hidden Hollow: 16%
- Lee Ct: 16%
- Kenview: N/A (not renting)

### Report scope — which properties get reports
| Property | Owner(s) | Reports? |
|---|---|---|
| Village Lane | Brian (100%) | Yes — Brian uses as his own test case |
| Walker | Moriah Angott (100%) | Yes |
| Hidden Hollow | Brian (49%) + Michael (51%) | Yes — two reports per month, one per owner, prorated |
| Lee Ct | Michael (100%) | Yes |
| Kenview | Brian + Moriah (live-in, not renting) | No — skip until active |

### Generation workflow
1. Admin selects property + owner + month/year → clicks Generate
2. If report doesn't exist: created in `draft` state, AI summary generated
3. If report already exists: prompt "This report already exists" → View or Overwrite
4. Brian reviews, edits AI summary if needed → Publishes
5. Published report accessible at static URL

### Data model
- `properties.pm_commission_rate` — PM commission rate, e.g. 16.00 = 16%
- `properties.operating_minimum_balance` — reserve kept in account; payout = closing_balance − mgmt_fee − this
- `account_balances` table — month-end closing balance per property (entered via Admin page)
- `owner_reports.manual_payout_amount` — optional override: null = use formula, 0 = suppress, any amount = override
- `owner_reports` table — draft/published state, ai_summary, manual_notes, manual_payout_amount, featured_review_id
- `expenses` table — Baselane import; used for financials waterfall
- `reviews` table — guest reviews seeded manually; one randomly stamped per report at generation time (`featured_review_id`)

---

## Open Questions / Things Claude Doesn't Know Yet
- [ ] How reports are delivered to owners (email link? they log in? Brian just sends the URL?)
- [ ] Whether there are plans to expand the property portfolio
- [ ] Seasonal pricing strategy or yield management goals
- [ ] IGMS API access status (applied for, pending response) — critical path for live data sync
- [x] Expenses in owner reports — implemented via Baselane CSV import + expenses table
- [ ] Brian's ownership % on Kenview (he and Moriah live there — relevant when it goes active)
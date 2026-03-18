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

## Business Rules
- Occupancy = revenue nights / available nights (365 per property, hardcoded for now — `available_nights` column exists in schema for future use)
- Owner Revenue = Gross Revenue minus PM commission (no standard rate currently defined)
- Kenview is inactive — exclude from all revenue metrics, charts, and property filters
- Stay type `Void` is excluded from all imports entirely
- Baselane `Transfers & Other` type rows are skipped on import
- `source_hash` on expenses = SHA-256 of date+merchant+amount+property+description (upsert key — safe to re-run). **Added via live migration, not in original schema.sql — see Schema Notes.**
- `reservation_code` on reservations is the upsert key — safe to re-run imports
- BMF Enterprises portfolio-level transactions import with null `property_id`

## Schema Notes
The following columns were added via live migrations and are now reflected in `supabase/schema.sql`:

- `properties.public_name` (text) — guest-facing name for book-direct pages
- `properties.pm_commission_rate` (numeric 5,2) — PM commission rate per property (e.g. 16.00 = 16%)
- `expenses.source_hash` (text, unique) — SHA-256 upsert key for Baselane imports
- `owners.slug` (text) — URL-safe identifier used in report URLs

Seed data corrections applied:
- Owner `00000000-0000-0000-0000-000000000002` corrected from "Brian Sr. FitzGerald" → **Michael FitzGerald** with slug `michael-fitzgerald`
- Brian FitzGerald slug: `brian-fitzgerald`
- Added Moriah Angott (`00000000-0000-0000-0000-000000000003`, slug `moriah-angott`)
- Walker ownership corrected: Brian → **Moriah Angott** (100%)

These are all reflected in `supabase/schema.sql` — it is now the canonical seed state. Run the Phase 1 SQL from the owner reports plan in Supabase if the live DB hasn't been migrated yet.

## Tech Stack
- **Backend**: Node.js (ESM), no framework — `server.js` serves static files and API routes locally
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
  owner-reports/
    index.js                # GET /api/owner-reports (list all with status)
    data.js                 # GET /api/owner-reports/data?property=&owner=&month=&year=
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
    admin.html              # Functional — CSV upload UI
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
  schema.sql                # DB schema — NOTE: out of sync with live DB, see Schema Notes
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
1. **Header** — property name, owner name, month/year, BMF branding
2. **Net Payout hero** — big prominent number, `gross revenue − PM commission fee`
3. **Executive Summary** — AI-generated (Claude API), positive tone, optional light "opportunities" note at end. Editable before publishing.
4. **Occupancy Snapshot** — "X of Y nights occupied · Z revenue nights · N owner stay nights (dates)"
5. **Financials** — 3-line: Gross Revenue → Management Fee (X%) → Net Owner Payout
6. **Bookings This Month** — table: dates, platform, nights, payout. No guest names.
7. **Coming Up** — next month's confirmed bookings: dates, nights, platform. No $ amounts.
8. **Footer** — contact Brian / BMF branding

**Expenses: excluded from v1.** No Baselane API yet; adds manual friction. Revisit when API available.

### Payout calculation
- Net Owner Payout = Gross Revenue − PM Commission Fee
- For split-ownership properties, payout is prorated by `ownership_pct`
- e.g. Hidden Hollow: Brian gets 49% of net, Michael gets 51% of net

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

### Data model additions needed
- `properties.pm_commission_rate` (numeric) — add via migration
- `owners` table: add Moriah Angott (sole owner of Walker, 0% commission)
- Fix Walker ownership: currently seeded as 100% Brian — should be 100% Moriah
- `owner_reports` table already exists with correct structure

---

## Open Questions / Things Claude Doesn't Know Yet
- [ ] How reports are delivered to owners (email link? they log in? Brian just sends the URL?)
- [ ] Whether there are plans to expand the property portfolio
- [ ] Seasonal pricing strategy or yield management goals
- [ ] IGMS API access status (applied for, pending response) — critical path for live data sync
- [ ] Expenses in owner reports — revisit when Baselane API is available
- [ ] Brian's ownership % on Kenview (he and Moriah live there — relevant when it goes active)
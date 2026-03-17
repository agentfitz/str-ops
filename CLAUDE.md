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
- **Brian FitzGerald** — primary operator, owns Village Lane, Walker, Kenview (100% each), and 49% of Hidden Hollow
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
The live Supabase schema has drifted from `supabase/schema.sql` due to migrations applied directly. The following columns exist in the live DB but may be missing from `schema.sql`:

- `properties.public_name` (text) — added via `ALTER TABLE properties ADD COLUMN public_name text`
- `expenses.source_hash` (text, unique) — added via `ALTER TABLE expenses ADD COLUMN source_hash text unique`

Also note: the `owners` seed data in `schema.sql` may still reference "Brian Sr. FitzGerald" — the correct name is **Michael FitzGerald**. Do not re-run seed data without correcting this first.

**TODO:** Backfill these changes into `schema.sql` so a fresh install works correctly.

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
- **Colors**: `#F9F6F0` bg (warm off-white), `#1C1917` ink, `#2C5F4A` accent green, `#F7F5F0` card bg
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
  upload.js                 # POST /api/upload (CSV import)
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
    reports.html            # Stub — not yet functional
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
- `/views/reports` → Owner report generation — **stub, not yet functional**
- `/views/admin` → CSV upload UI for IGMS and Baselane data — **functional**

## Running Locally
```bash
node server.js               # Starts at http://localhost:3000
npm run import:igms          # Import reservations from IGMS CSV
npm run import:baselane      # Import expenses from Baselane CSV
```

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

## Open Questions / Things Claude Doesn't Know Yet
- [ ] How owner reports are currently distributed to owners (email? PDF? portal?)
- [ ] Whether there are plans to expand the property portfolio
- [ ] PM commission rates (not yet standardized)
- [ ] Seasonal pricing strategy or yield management goals
- [ ] IGMS API access status (applied for, pending response) — critical path for live data sync
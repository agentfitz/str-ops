-- ============================================================
-- STR OPS — Supabase Schema
-- ============================================================

-- ── Properties ────────────────────────────────────────────────
create table properties (
  id                   text primary key,       -- 'lee-ct', 'hidden-hollow', etc.
  display_name         text not null,          -- 'Lee Ct', 'Hidden Hollow', etc.
  public_name          text,                   -- guest-facing name (book-direct, marketing)
  market               text,                   -- 'OBX', 'Snowshoe', 'Greensboro'
  address              text,
  igms_name            text,                   -- exact string from IGMS export
  baselane_name        text,                   -- exact string from Baselane export
  available_nights              int default 365,
  active                        boolean default true,   -- false until property goes live
  pm_commission_rate            numeric(5,2) default 0.00, -- e.g. 16.00 = 16%
  operating_minimum_balance     numeric(10,2) default 0.00, -- reserve kept in account; payout = combined_balance - mgmt_fee - this
  created_at           timestamptz default now()
);

-- ── Owners ────────────────────────────────────────────────────
create table owners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text,                   -- url-safe identifier, e.g. 'michael-fitzgerald'
  nickname    text,                   -- informal name for AI summaries, e.g. 'Pops', 'Goose'
  email       text,
  phone       text,
  notes       text,
  created_at  timestamptz default now()
);

-- ── Property Owners (junction — supports split ownership) ─────
create table property_owners (
  id             uuid primary key default gen_random_uuid(),
  property_id    text references properties(id) on delete cascade,
  owner_id       uuid references owners(id) on delete cascade,
  ownership_pct  numeric(5,2) not null default 100.00, -- e.g. 51.00, 49.00
  created_at     timestamptz default now(),
  unique(property_id, owner_id)
);

-- ── Reservations (from IGMS export) ───────────────────────────
create table reservations (
  id                    uuid primary key default gen_random_uuid(),
  reservation_code      text unique not null,
  property_id           text references properties(id),
  platform              text,                -- 'airbnb', 'vrbo', 'direct'
  checkin_date          date,
  checkout_date         date,
  booking_date          date,
  guest_name            text,
  phone                 text,
  invoice_status        text,               -- 'Paid', 'Overdue', 'Void'
  nights                int,
  guests                int,
  base_price            numeric(10,2),
  total_guest_fees      numeric(10,2),
  channel_host_fee      numeric(10,2),
  pass_through_taxes    numeric(10,2),
  expected_total_payout numeric(10,2),
  pm_commission         numeric(10,2),
  net_payout            numeric(10,2),
  stay_type             text default 'Revenue', -- 'Revenue','Owner Stay','Comp Stay','Flag for Review'
  stay_type_override    text,               -- manually set via admin UI
  notes                 text,              -- free text per reservation
  imported_at           timestamptz default now()
);

-- ── Expenses (from Baselane export) ───────────────────────────
create table expenses (
  id            uuid primary key default gen_random_uuid(),
  property_id   text references properties(id),
  date          date,
  merchant      text,
  description   text,
  amount        numeric(10,2),             -- negative = expense, positive = revenue
  type          text,                      -- 'Operating Expenses', 'Revenue', etc.
  category      text,
  subcategory   text,
  account       text,                      -- raw Baselane account string
  notes         text,
  source_hash   text unique,               -- SHA-256 of date+merchant+amount+property+description (upsert key)
  imported_at   timestamptz default now()
);

-- ── Account Balances ──────────────────────────────────────────
create table account_balances (
  id                uuid primary key default gen_random_uuid(),
  property_id       text references properties(id),
  month             int not null,                    -- 1–12
  year              int not null,
  operating_account_balance  numeric(10,2) not null,  -- month-end Baselane operating account
  reserves_account_balance   numeric(10,2) default 0, -- month-end Baselane reserves account (interest-earning, optional)
  notes             text,
  created_at        timestamptz default now(),
  unique(property_id, month, year)
);

-- ── Reviews ────────────────────────────────────────────────────
create table reviews (
  id             uuid primary key default gen_random_uuid(),
  property_id    text references properties(id),
  guest_name     text,
  guest_location text,              -- e.g. 'Elk Grove, CA'
  review_text    text not null,
  platform       text,              -- 'Airbnb', 'VRBO', 'Direct', etc.
  review_date    date,
  created_at     timestamptz default now()
);

-- ── Owner Reports ─────────────────────────────────────────────
create table owner_reports (
  id              uuid primary key default gen_random_uuid(),
  property_id     text references properties(id),
  owner_id        uuid references owners(id),
  month           int not null,             -- 1–12
  year            int not null,
  status          text default 'draft',     -- 'draft', 'published'
  ai_summary            text,                     -- Claude-generated, editable
  manual_notes          text,                     -- host's own notes
  manual_payout_amount  numeric(10,2),            -- on_demand: amount distributed this month (null = no distribution)
  generated_at          timestamptz,
  published_at          timestamptz,
  created_at            timestamptz default now(),
  unique(property_id, owner_id, month, year),
  featured_review_id    uuid references reviews(id)
);

-- ── Indexes ───────────────────────────────────────────────────
create index idx_reservations_property    on reservations(property_id);
create index idx_reservations_checkin     on reservations(checkin_date);
create index idx_reservations_stay_type   on reservations(stay_type);
create index idx_expenses_property        on expenses(property_id);
create index idx_expenses_date            on expenses(date);
create index idx_owner_reports_property   on owner_reports(property_id, year, month);
create index idx_account_balances_property on account_balances(property_id, year, month);

-- ── Seed: Properties ──────────────────────────────────────────
insert into properties (id, display_name, public_name, market, address, igms_name, baselane_name, available_nights, active, pm_commission_rate) values
  ('village-lane',  'Village Lane',  'Village Lane',        'Greensboro', '306 Village Lane, Greensboro, NC 27409',    'Village Lane',         'Village Lane',  365, true,   0.00),
  ('walker',        'Walker',        'Lindley Park Cottage','Greensboro', '3914 Walker Ave, Greensboro, NC 27403',      'Lindley Park Cottage', 'Walker Ave',    365, true,   0.00),
  ('kenview',       'Kenview',       'Kenview',             'Greensboro', null,                                          null,                   'Kenview',       365, false,  0.00),
  ('hidden-hollow', 'Hidden Hollow', 'Hidden Hollow',       'Snowshoe',   '96 Hidden Hollow Lane, Slatyfork, WV 26291', 'Snowshoe Chalet',      'Hidden Hollow', 365, true,  16.00),
  ('lee-ct',        'Lee Ct',        'Canal Front Cottage', 'OBX',        '138 Lee Ct, Kill Devil Hills, NC',            'Canal Keep',           'Lee Court',     365, true,  16.00);

-- ── Seed: Owners ──────────────────────────────────────────────
insert into owners (id, name, slug, nickname, email) values
  ('00000000-0000-0000-0000-000000000001', 'Brian FitzGerald',   'brian-fitzgerald',   null,    null),
  ('00000000-0000-0000-0000-000000000002', 'Michael FitzGerald', 'michael-fitzgerald', 'Pops',  null),
  ('00000000-0000-0000-0000-000000000003', 'Moriah Angott',      'moriah-angott',      'Goose', null);

-- ── Seed: Property Owners ─────────────────────────────────────
insert into property_owners (property_id, owner_id, ownership_pct) values
  ('village-lane',  '00000000-0000-0000-0000-000000000001', 100.00),
  ('walker',        '00000000-0000-0000-0000-000000000003', 100.00),  -- Moriah owns Walker
  ('kenview',       '00000000-0000-0000-0000-000000000001', 100.00),
  ('hidden-hollow', '00000000-0000-0000-0000-000000000001',  49.00),
  ('hidden-hollow', '00000000-0000-0000-0000-000000000002',  51.00),
  ('lee-ct',        '00000000-0000-0000-0000-000000000002', 100.00);

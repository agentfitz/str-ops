-- ============================================================
-- STR OPS — Supabase Schema
-- ============================================================

-- ── Properties ────────────────────────────────────────────────
create table properties (
  id                text primary key,       -- 'lee-ct', 'hidden-hollow', etc.
  display_name      text not null,          -- 'Lee Ct', 'Hidden Hollow', etc.
  market            text,                   -- 'OBX', 'Snowshoe', 'Greensboro'
  address           text,
  igms_name         text,                   -- exact string from IGMS export
  baselane_name     text,                   -- exact string from Baselane export
  available_nights  int default 365,
  active            boolean default true,   -- false until property goes live
  created_at        timestamptz default now()
);

-- ── Owners ────────────────────────────────────────────────────
create table owners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
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
  imported_at   timestamptz default now()
);

-- ── Owner Reports ─────────────────────────────────────────────
create table owner_reports (
  id              uuid primary key default gen_random_uuid(),
  property_id     text references properties(id),
  owner_id        uuid references owners(id),
  month           int not null,             -- 1–12
  year            int not null,
  status          text default 'draft',     -- 'draft', 'published'
  ai_summary      text,                     -- Claude-generated, editable
  manual_notes    text,                     -- host's own notes
  generated_at    timestamptz,
  published_at    timestamptz,
  created_at      timestamptz default now(),
  unique(property_id, owner_id, month, year)
);

-- ── Indexes ───────────────────────────────────────────────────
create index idx_reservations_property    on reservations(property_id);
create index idx_reservations_checkin     on reservations(checkin_date);
create index idx_reservations_stay_type   on reservations(stay_type);
create index idx_expenses_property        on expenses(property_id);
create index idx_expenses_date            on expenses(date);
create index idx_owner_reports_property   on owner_reports(property_id, year, month);

-- ── Seed: Properties ──────────────────────────────────────────
insert into properties (id, display_name, market, address, igms_name, baselane_name, available_nights, active) values
  ('village-lane',  'Village Lane',  'Greensboro', '306 Village Lane, Greensboro, NC 27409',   'Village Lane',      'Village Lane',  365, true),
  ('walker',        'Walker',        'Greensboro', '3914 Walker Ave, Greensboro, NC 27403',     'Lindley Park Cottage', 'Walker Ave', 365, true),
  ('kenview',       'Kenview',       'Greensboro', null,                                         null,                'Kenview',       365, false),
  ('hidden-hollow', 'Hidden Hollow', 'Snowshoe',   '96 Hidden Hollow Lane, Slatyfork, WV 26291','Snowshoe Chalet',  'Hidden Hollow', 365, true),
  ('lee-ct',        'Lee Ct',        'OBX',        '138 Lee Ct, Kill Devil Hills, NC',           'Canal Keep',       'Lee Court',     365, true);

-- ── Seed: Owners ──────────────────────────────────────────────
insert into owners (id, name, email) values
  ('00000000-0000-0000-0000-000000000001', 'Brian FitzGerald', null),
  ('00000000-0000-0000-0000-000000000002', 'Brian Sr. FitzGerald', null);

-- ── Seed: Property Owners ─────────────────────────────────────
insert into property_owners (property_id, owner_id, ownership_pct) values
  ('village-lane',  '00000000-0000-0000-0000-000000000001', 100.00),
  ('walker',        '00000000-0000-0000-0000-000000000001', 100.00),
  ('kenview',       '00000000-0000-0000-0000-000000000001', 100.00),
  ('hidden-hollow', '00000000-0000-0000-0000-000000000001',  49.00),
  ('hidden-hollow', '00000000-0000-0000-0000-000000000002',  51.00),
  ('lee-ct',        '00000000-0000-0000-0000-000000000002', 100.00);

-- ============================================================================
-- VALMONT DATA — Supabase schema (tenant #3 on Valmont-Pay)
-- Run this in the Supabase SQL editor (or `psql`). Idempotent.
--
-- Conventions: same as the other Valmont sites — RLS on, anon gets the
-- minimum (read active networks + bundles via view, insert pending orders,
-- read own order by reference). Everything else is server-side only.
-- ============================================================================

-- ---------- NETWORKS ----------
create table if not exists public.networks (
  id        bigint generated always as identity primary key,
  code      text not null unique check (code in ('mtn','telecel','airteltigo')),
  name      text not null,
  logo_url  text,
  is_active boolean not null default true
);

-- ---------- BUNDLES (cost_price is INTERNAL — never expose to client) ----------
create table if not exists public.bundles (
  id           bigint generated always as identity primary key,
  network_id   bigint not null references public.networks(id) on delete cascade,
  size_mb      integer not null,
  validity_days integer,                  -- null = no expiry
  cost_price   numeric(12,2) not null,    -- supplier cost at last sync
  sell_price   numeric(12,2) not null,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  unique (network_id, size_mb)
);

-- Public view — safe columns only, no cost_price.
create or replace view public.v_bundles as
  select b.id, n.code as network, b.size_mb, b.validity_days, b.sell_price, b.sort_order
  from public.bundles b
  join public.networks n on n.id = b.network_id
  where b.is_active and n.is_active;

-- ---------- CUSTOMERS ----------
create table if not exists public.customers (
  id          bigint generated always as identity primary key,
  phone       text unique check (phone is null or phone ~ '^0[0-9]{9}$'),
  email       text unique,
  name        text,
  pin_hash    text not null,
  created_at  timestamptz not null default now()
);
create index if not exists customers_phone_idx on public.customers(phone);
create index if not exists customers_email_idx on public.customers(email);

-- ---------- SAVED NUMBERS (data lines + momo numbers per customer) ----------
create table if not exists public.saved_numbers (
  id          bigint generated always as identity primary key,
  customer_id bigint not null references public.customers(id) on delete cascade,
  kind        text not null check (kind in ('data','momo')),
  phone       text not null check (phone ~ '^0[0-9]{9}$'),
  label       text,
  created_at  timestamptz not null default now(),
  unique (customer_id, kind, phone)
);
create index if not exists saved_numbers_customer_idx on public.saved_numbers(customer_id, kind);

-- ---------- SMS LEADS (marketing opt-ins collected by the storefront popup) ----------
-- Phone numbers of visitors who opted in to SMS promos. Unique phone so a
-- repeat opt-in never duplicates the list (exported 1-click from /admin.html).
create table if not exists public.sms_leads (
  id          bigint generated always as identity primary key,
  phone       text not null unique check (phone ~ '^0[0-9]{9}$'),
  source      text not null default 'storefront-popup',
  created_at  timestamptz not null default now()
);
create index if not exists sms_leads_created_idx on public.sms_leads(created_at desc);

-- ---------- ORDERS ----------
create table if not exists public.orders (
  id                  bigint generated always as identity primary key,
  reference           text not null unique,             -- e.g. VD-260806-4831 (customer-facing)
  phone               text not null check (phone ~ '^0[0-9]{9}$'),
  bundle_id           bigint not null references public.bundles(id),
  network_id          bigint not null references public.networks(id),
  amount              numeric(12,2) not null,           -- sell price at purchase time
  cost_price          numeric(12,2) not null,           -- cost at purchase time (margin history stays accurate)
  status              text not null default 'pending'
                      check (status in ('pending','paid','delivering','delivered','failed','refunded')),
  provider_reference  text unique,                      -- Valmont-Pay payment ref — IDEMPOTENCY KEY
  supplier_ref        text,
  supplier_response   jsonb,                            -- full supplier reply for dispute settling
  attempts            integer not null default 0,
  customer_id         bigint references public.customers(id),
  created_at          timestamptz not null default now(),
  delivered_at        timestamptz
);
create index if not exists orders_status_idx      on public.orders(status);
create index if not exists orders_created_idx    on public.orders(created_at desc);
create index if not exists orders_provider_ref_idx on public.orders(provider_reference);
create index if not exists orders_customer_idx   on public.orders(customer_id);

-- ---------- FLOAT LEDGER (every cedi of prepaid float, per network) ----------
create table if not exists public.float_ledger (
  id            bigint generated always as identity primary key,
  network_id    bigint not null references public.networks(id),
  direction     text not null check (direction in ('topup','debit','refund')),
  amount        numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  order_id      bigint references public.orders(id),
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists float_ledger_net_idx on public.float_ledger(network_id, id desc);

-- ---------- WEBHOOK LOG (audit trail for every Valmont-Pay callback) ----------
create table if not exists public.webhook_log (
  id              bigint generated always as identity primary key,
  signature_valid boolean not null,
  payload         jsonb,
  handled         boolean,
  error           text,
  created_at      timestamptz not null default now()
);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Current float for a network (last ledger balance, or 0).
create or replace function public.current_float(p_network_id bigint)
returns numeric language sql stable as $$
  select coalesce((select balance_after from public.float_ledger
                   where network_id = p_network_id order by id desc limit 1), 0);
$$;

-- Atomically add a float entry (topup/debit/refund) and return the new balance.
-- Advisory lock per network closes the race between two concurrent debits.
create or replace function public.add_float_entry(
  p_network_id bigint,
  p_direction  text,
  p_amount     numeric,
  p_order_id   bigint default null,
  p_note       text default null
) returns numeric language plpgsql as $$
declare v_bal numeric;
begin
  perform pg_advisory_xact_lock(hashtext('vd_float_' || p_network_id));
  select coalesce((select balance_after from public.float_ledger
                   where network_id = p_network_id order by id desc limit 1), 0) into v_bal;
  v_bal := v_bal + case when p_direction = 'debit' then -abs(p_amount) else abs(p_amount) end;
  insert into public.float_ledger (network_id, direction, amount, balance_after, order_id, note)
  values (p_network_id, p_direction, p_amount, v_bal, p_order_id, p_note);
  return v_bal;
end $$;

-- Daily P&L per network (revenue, cost, margin).
create or replace function public.daily_pnl(p_days integer default 30)
returns table (day date, network text, orders bigint, revenue numeric, cost numeric, margin numeric)
language sql stable as $$
  select o.created_at::date as day, n.code as network,
         count(*)::bigint as orders,
         coalesce(sum(o.amount), 0) as revenue,
         coalesce(sum(o.cost_price), 0) as cost,
         coalesce(sum(o.amount - o.cost_price), 0) as margin
  from public.orders o
  join public.networks n on n.id = o.network_id
  where o.status in ('paid','delivering','delivered')
    and o.created_at >= now() - make_interval(days => p_days)
  group by 1, 2
  order by 1 desc, 2;
$$;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.networks      enable row level security;
alter table public.bundles       enable row level security;
alter table public.customers     enable row level security;
alter table public.saved_numbers enable row level security;
alter table public.sms_leads     enable row level security;
alter table public.orders        enable row level security;
alter table public.float_ledger  enable row level security;
alter table public.webhook_log   enable row level security;

-- anon: read active networks only
drop policy if exists networks_anon_read on public.networks;
create policy networks_anon_read on public.networks for select to anon using (is_active);

-- anon: NO direct access to bundles (cost_price lives there) — v_bundles only
revoke all on public.bundles from anon;

-- anon: no access to customer accounts or saved numbers
revoke all on public.customers from anon;
revoke all on public.saved_numbers from anon;

-- anon: no direct access to SMS leads — opt-ins are written by the
-- serverless function (service role) and exported from the admin console
revoke all on public.sms_leads from anon;

-- anon: may insert a pending order; may read only their own by reference
-- (the reference IS the secret — same model as order tracking on the other sites)
drop policy if exists orders_anon_insert on public.orders;
create policy orders_anon_insert on public.orders for insert to anon
  with check (status = 'pending');
drop policy if exists orders_anon_select on public.orders;
create policy orders_anon_select on public.orders for select to anon
  using (reference = coalesce(nullif(current_setting('app.order_ref', true), ''), ''));

-- anon: no access to float or webhook logs
revoke all on public.float_ledger from anon;
revoke all on public.webhook_log  from anon;

grant select on public.v_bundles to anon;

-- ============================================================================
-- SEEDS
-- ============================================================================
insert into public.networks (code, name, is_active) values
  ('mtn',       'MTN',        true),
  ('telecel',   'Telecel',    true),
  ('airteltigo','AirtelTigo', true)
on conflict (code) do nothing;

-- cost_price = current wholesale; sell_price = our retail. Update cost_price
-- when the supplier changes prices (historical orders keep their own copy).
insert into public.bundles (network_id, size_mb, validity_days, cost_price, sell_price, sort_order)
select n.id, v.size_mb, v.validity_days, v.cost_price, v.sell_price, v.sort_order
from (values
  -- MTN — no expiry
  ('mtn', 1024,  null, 3.90,  4.20,   1),
  ('mtn', 2048,  null, 8.10,  9.00,   2),
  ('mtn', 3072,  null, 11.90, 13.50,  3),
  ('mtn', 5120,  null, 18.90, 20.50,  4),
  ('mtn', 10240, null, 38.50, 43.00,  5),
  ('mtn', 20480, null, 73.00, 82.00,  6),
  ('mtn', 30720, null, 111.00,125.00, 7),
  ('mtn', 51200, null, 185.00,201.00, 8),
  ('mtn', 102400,null, 377.00,407.00, 9),
  -- Telecel — 60-day rollover
  ('telecel', 10240, 60, 35.50, 39.50, 1),
  ('telecel', 20480, 60, 67.80, 75.00, 2),
  ('telecel', 30720, 60, 98.70, 110.00,3),
  ('telecel', 51200, 60, 162.50,180.00,4),
  ('telecel', 102400,60, 367.00,405.00,5),
  -- AirtelTigo — 60-day rollover
  ('airteltigo', 1024, 60, 3.65,  4.00,  1),
  ('airteltigo', 5120, 60, 18.00, 19.90, 2),
  ('airteltigo', 10240,60, 35.50, 39.00, 3),
  ('airteltigo', 30720,60, 106.00,117.00,4),
  ('airteltigo', 51200,60, 175.00,193.00,5)
) as v(code, size_mb, validity_days, cost_price, sell_price, sort_order)
join public.networks n on n.code = v.code
on conflict (network_id, size_mb) do nothing;

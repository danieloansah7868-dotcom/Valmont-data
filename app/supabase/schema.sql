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

-- ---------- AUTO-RELOAD (the user's opt-in — "auto top-up") ----------
-- One rule per customer per data line. When the line's current bundle drops
-- below trigger_percent (or expires), the cron re-buys `bundle_id` from the
-- pre-authorized `momo_number` and delivers it to `phone`.
--
-- `relation` says who the phone belongs to:
--   'self'  → the line is the customer's own number (phone = customers.phone)
--   'other' → a line they buy data FOR (gift / favour / family line)
-- The web NEVER auto-suggests auto-reload for 'other' lines, and creating a
-- rule for one requires an explicit recipient confirmation (confirm_recipient)
-- so a favour can't silently drain the customer's MoMo onto someone else's line.
create table if not exists public.auto_reload (
  id                bigint generated always as identity primary key,
  customer_id       bigint not null references public.customers(id) on delete cascade,
  phone             text not null check (phone ~ '^0[0-9]{9}$'),
  relation          text not null default 'self' check (relation in ('self','other')),
  network_id        bigint not null references public.networks(id),
  bundle_id         bigint not null references public.bundles(id),
  trigger_percent   integer not null default 10 check (trigger_percent between 1 and 50),
  momo_number       text check (momo_number is null or momo_number ~ '^0[0-9]{9}$'),
  active            boolean not null default true,
  reload_count      integer not null default 0,
  last_reload_at    timestamptz,                        -- last successful reload delivered
  last_triggered_at timestamptz,                        -- last time the engine fired
  cooldown_until    timestamptz,                        -- no new reload before this
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (customer_id, phone)
);
create index if not exists auto_reload_active_idx on public.auto_reload(active, id);

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
  auto_reload_id      bigint references public.auto_reload(id),  -- set when this order was created by the auto-reload engine
  created_at          timestamptz not null default now(),
  delivered_at        timestamptz
);
create index if not exists orders_status_idx      on public.orders(status);
create index if not exists orders_created_idx    on public.orders(created_at desc);
create index if not exists orders_provider_ref_idx on public.orders(provider_reference);
create index if not exists orders_customer_idx   on public.orders(customer_id);

-- ---------- BUNDLE USAGE (tracks each delivered bundle's data consumption) ----------
-- One row per delivered order. `used_mb` is updated by usage reports (telco /
-- supplier API in production, the sim-usage script in dev). The auto-reload
-- engine watches the newest row per phone and fires when the bundle runs low.
create table if not exists public.bundle_usage (
  id             bigint generated always as identity primary key,
  order_id       bigint not null references public.orders(id) on delete cascade,
  phone          text not null check (phone ~ '^0[0-9]{9}$'),
  network_id     bigint not null references public.networks(id),
  size_mb        integer not null,
  used_mb        numeric(12,2) not null default 0,
  status         text not null default 'active' check (status in ('active','exhausted','expired')),
  started_at     timestamptz not null default now(),
  expires_at     timestamptz,                           -- null = no expiry (MTN)
  last_report_at timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists bundle_usage_phone_idx on public.bundle_usage(phone, id desc);
create index if not exists bundle_usage_order_idx on public.bundle_usage(order_id);

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
alter table public.bundle_usage  enable row level security;
alter table public.auto_reload   enable row level security;
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

-- anon: no access to bundle usage or auto-reload opt-ins — both are managed
-- server-side (usage reports come from the supplier integration, opt-ins from
-- the authenticated customer API)
revoke all on public.bundle_usage from anon;
revoke all on public.auto_reload  from anon;

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
-- WHATSAPP SESSIONS (conversation state for the WhatsApp ordering bot)
-- ============================================================================
-- Each WhatsApp number gets one row. `state` drives the conversation flow;
-- `context` holds the current selections (network, bundle, phone, etc.).
-- `updated_at` is bumped on every message so stale sessions can be pruned.
create table if not exists public.whatsapp_sessions (
  id            bigint generated always as identity primary key,
  phone         text not null unique check (phone ~ '^[0-9]{7,15}$'),  -- WhatsApp wa_id (international, no +)
  state         text not null default 'idle',
  context       jsonb not null default '{}',
  customer_id   bigint references public.customers(id),
  last_message  text,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists whatsapp_sessions_updated_idx on public.whatsapp_sessions(updated_at desc);

-- ============================================================================
-- REFERRALS (referral program — earn credit when friends buy)
-- ============================================================================
-- Each customer has a unique referral_code (set on the customers table).
-- When a new customer signs up with that code, a row is created here.
-- When the referred customer completes their first purchase, both parties
-- get credit (stored in referral_credits).

-- Referral tracking: who referred whom
create table if not exists public.referrals (
  id                bigint generated always as identity primary key,
  referrer_id       bigint not null references public.customers(id),
  referred_id       bigint not null references public.customers(id) unique,  -- one referrer per customer
  first_order_id    bigint references public.orders(id),                      -- set when the first purchase completes
  status            text not null default 'pending'
                    check (status in ('pending','rewarded','expired')),
  created_at        timestamptz not null default now(),
  rewarded_at       timestamptz
);
create index if not exists referrals_referrer_idx on public.referrals(referrer_id);

-- Referral credits: a small ledger of earned credits per customer.
-- `balance` is the sum of all credit entries minus debits (applied to orders).
create table if not exists public.referral_credits (
  id            bigint generated always as identity primary key,
  customer_id   bigint not null references public.customers(id),
  direction     text not null check (direction in ('earn','spend')),
  amount        numeric(12,2) not null,
  balance_after numeric(12,2) not null,
  referral_id   bigint references public.referrals(id),
  order_id      bigint references public.orders(id),   -- set when spent on an order
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists referral_credits_customer_idx on public.referral_credits(customer_id, id desc);

-- Current credit balance for a customer.
create or replace function public.current_referral_credit(p_customer_id bigint)
returns numeric language sql stable as $$
  select coalesce((select balance_after from public.referral_credits
                   where customer_id = p_customer_id order by id desc limit 1), 0);
$$;

-- Add referral columns to customers table (idempotent).
alter table public.customers add column if not exists referral_code text unique;
alter table public.customers add column if not exists referred_by   text;  -- the referral_code used at signup

-- ============================================================================
-- WHATSAPP LOG (audit trail for outgoing WhatsApp messages)
-- ============================================================================
create table if not exists public.whatsapp_log (
  id              bigint generated always as identity primary key,
  direction       text not null check (direction in ('inbound','outbound')),
  phone           text not null,
  message_type    text,
  message_body    text,
  status          text,
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists whatsapp_log_phone_idx on public.whatsapp_log(phone, id desc);

-- ============================================================================
-- RLS (additional tables)
-- ============================================================================
alter table public.whatsapp_sessions enable row level security;
alter table public.whatsapp_log      enable row level security;
alter table public.referrals         enable row level security;
alter table public.referral_credits  enable row level security;

-- anon: no access to WhatsApp sessions or logs (server-side only)
revoke all on public.whatsapp_sessions from anon;
revoke all on public.whatsapp_log      from anon;
revoke all on public.referrals         from anon;
revoke all on public.referral_credits  from anon;

-- ============================================================================
-- RESELLERS (agent/reseller program — earn margin on every bundle sold)
-- ============================================================================
-- Each reseller is a customer who has opened a storefront. They set a markup %
-- on top of the base sell_price, and earn the difference on every order placed
-- through their store link. The store slug is the URL path: /s/{slug}.
create table if not exists public.resellers (
  id              bigint generated always as identity primary key,
  customer_id     bigint not null references public.customers(id) unique,  -- one store per customer
  store_name      text not null,
  slug            text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' and length(slug) between 3 and 40),
  tagline         text,
  markup_percent  numeric(5,2) not null default 10 check (markup_percent between 0 and 100),
  status          text not null default 'active' check (status in ('active','suspended','closed')),
  total_orders    integer not null default 0,
  total_revenue   numeric(12,2) not null default 0,
  total_earnings  numeric(12,2) not null default 0,
  momo_number     text check (momo_number is null or momo_number ~ '^0[0-9]{9}$'),  -- payout MoMo
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists resellers_slug_idx on public.resellers(slug);
create index if not exists resellers_customer_idx on public.resellers(customer_id);

-- Reseller earnings ledger: every cedi earned, paid out, or pending.
create table if not exists public.reseller_earnings (
  id              bigint generated always as identity primary key,
  reseller_id     bigint not null references public.resellers(id),
  order_id        bigint references public.orders(id),
  direction       text not null check (direction in ('earn','payout','adjustment')),
  amount          numeric(12,2) not null,
  balance_after   numeric(12,2) not null,
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists reseller_earnings_idx on public.reseller_earnings(reseller_id, id desc);

-- Current reseller balance (earnings minus payouts).
create or replace function public.current_reseller_balance(p_reseller_id bigint)
returns numeric language sql stable as $$
  select coalesce((select balance_after from public.reseller_earnings
                   where reseller_id = p_reseller_id order by id desc limit 1), 0);
$$;

-- ============================================================================
-- ORDER EXTENSIONS (channel tracking + referral credits + reseller attribution)
-- ============================================================================
-- channel: which surface the order was placed from (web, whatsapp, api, store)
-- whatsapp_from: the wa_id if the order came from WhatsApp (for delivery confirmations)
-- credit_applied: how much referral credit was deducted from the checkout amount
-- reseller_id: which reseller store the customer came through (null = direct)
alter table public.orders add column if not exists channel         text not null default 'web';
alter table public.orders add column if not exists whatsapp_from   text;
alter table public.orders add column if not exists credit_applied  numeric(12,2) not null default 0;
alter table public.orders add column if not exists reseller_id     bigint references public.resellers(id);

-- RLS for reseller tables
alter table public.resellers         enable row level security;
alter table public.reseller_earnings enable row level security;
revoke all on public.resellers         from anon;
revoke all on public.reseller_earnings from anon;

-- anon: read public store pages (active stores only, safe columns)
drop policy if exists resellers_anon_select on public.resellers;
create policy resellers_anon_select on public.resellers for select to anon
  using (status = 'active');

-- ============================================================================
-- PRODUCT REVIEWS (verified purchases only — 2026-09-04)
-- ============================================================================
-- A review here is always tied to a delivered order for that exact bundle, so
-- "Verified buyer" on the page is a fact and the AggregateRating schema the
-- landing pages emit can only describe reviews that exist and are visible.
-- Written only by the API (service role); public read of published rows only.
-- See migrations/2026-09-04_product_reviews.sql for the standalone version.
create table if not exists public.product_reviews (
  id              bigint generated always as identity primary key,
  bundle_id       bigint not null references public.bundles(id),
  network_id      bigint not null references public.networks(id),
  size_mb         integer not null check (size_mb > 0),   -- denormalised: retiring a bundle must not orphan a review
  customer_id     bigint not null references public.customers(id),
  order_id        bigint references public.orders(id),     -- the delivered order that verified this review
  order_reference text,
  rating          integer not null check (rating between 1 and 5),
  title           text check (title is null or length(btrim(title)) between 1 and 80),
  body            text check (body is null or length(btrim(body)) between 1 and 600),
  status          text not null default 'published' check (status in ('published','removed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (bundle_id, customer_id)                          -- one review per customer per bundle
);
create index if not exists product_reviews_bundle_idx   on public.product_reviews(bundle_id, created_at desc);
create index if not exists product_reviews_status_idx   on public.product_reviews(status);
create index if not exists product_reviews_customer_idx on public.product_reviews(customer_id);

-- Aggregate for one bundle: PUBLISHED rows only, so no number can be quoted
-- that the page is not also showing.
create or replace function public.bundle_review_summary(p_bundle_id bigint)
returns table(review_count bigint, rating_average numeric(3,2))
language sql stable as $$
  select count(*),
         coalesce(round(avg(rating)::numeric, 2), 0)
  from   public.product_reviews
  where  bundle_id = p_bundle_id
    and  status = 'published';
$$;

alter table public.product_reviews enable row level security;

-- anon/authenticated: read published reviews (the API adds the author's first name)
drop policy if exists product_reviews_public_read on public.product_reviews;
create policy product_reviews_public_read on public.product_reviews
  for select to anon, authenticated
  using (status = 'published');
-- No write policies for anon/authenticated: every insert/update goes through the
-- API with the service role key, which is what keeps "verified purchase" true.

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
  -- MTN — no expiry. Retail (sell_price) aligned 2026-08-11; lineup mirrors the
  -- RemaData catalogue (1–50GB; 100GB dropped — supplier no longer lists it).
  -- cost_price for newly added sizes = RemaData public wholesale; sync exact
  -- API costs from the admin console once REMADATA_API_KEY is live.
  ('mtn', 1024,  null, 3.90,  6.00,   1),
  ('mtn', 2048,  null, 8.10,  12.00,  2),
  ('mtn', 3072,  null, 11.90, 17.00,  3),
  ('mtn', 4096,  null, 16.60, 23.00,  4),
  ('mtn', 5120,  null, 18.90, 28.00,  5),
  ('mtn', 6144,  null, 24.50, 35.00,  6),
  ('mtn', 8192,  null, 32.60, 43.00,  7),
  ('mtn', 10240, null, 38.50, 52.00,  8),
  ('mtn', 15360, null, 58.00, 75.00,  9),
  ('mtn', 20480, null, 73.00, 93.00,  10),
  ('mtn', 25600, null, 98.00, 115.00, 11),
  ('mtn', 30720, null, 111.00,140.00, 12),
  ('mtn', 40960, null, 159.00,180.00, 13),
  ('mtn', 51200, null, 185.00,220.00, 14),
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

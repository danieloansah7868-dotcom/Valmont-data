-- ============================================================================
-- Delivery/review/auth safety follow-up (2026-09-09)
--
-- Idempotent: safe to run after schema.sql and safe to re-run in the Supabase
-- SQL editor. It adds persistent OTP state, truthful manual-refund state, and
-- moderator provenance without deleting historical rows.
-- ============================================================================
begin;

-- A failed live payment cannot be described as refunded until a gateway
-- operator has actually completed it. Add that intermediate terminal state.
alter table public.orders add column if not exists refund_requested_at timestamptz;
alter table public.orders add column if not exists refund_completed_at timestamptz;
alter table public.orders add column if not exists refund_completed_by text;
alter table public.orders add column if not exists refund_note text;

do $$
declare c record;
begin
  -- The original schema used PostgreSQL's default orders_status_check name.
  -- Find any older status-only check defensively so the replacement is safe on
  -- a database created by an earlier revision of this project.
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
      and pg_get_constraintdef(oid) like '%refunded%'
  loop
    execute format('alter table public.orders drop constraint if exists %I', c.conname);
  end loop;
end $$;

alter table public.orders
  add constraint orders_status_check
  check (status in ('pending','paid','delivering','delivered','failed','refund_pending','refunded'));

-- Persistent, single-use passwordless-login codes. The hash is an HMAC created
-- by the API; no plaintext OTP is written to the database.
create table if not exists public.customer_otps (
  id            bigint generated always as identity primary key,
  phone         text not null unique check (phone ~ '^0[0-9]{9}$'),
  code_hash     text not null,
  expires_at    timestamptz not null,
  attempts      integer not null default 0 check (attempts between 0 and 3),
  send_count    integer not null default 1 check (send_count between 1 and 5),
  first_sent_at timestamptz not null default now(),
  consumed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists customer_otps_expires_idx on public.customer_otps(expires_at);
alter table public.customer_otps enable row level security;
revoke all on public.customer_otps from anon, authenticated;

-- A moderator-hidden review must never be republished by an author's normal
-- update path. Keep timestamps so hide/unhide provenance survives the current
-- state changing back to visible.
alter table if exists public.product_reviews add column if not exists hidden_by_admin boolean;
alter table if exists public.product_reviews add column if not exists admin_hidden_at timestamptz;
alter table if exists public.product_reviews add column if not exists admin_unhidden_at timestamptz;
alter table if exists public.product_reviews add column if not exists moderated_at timestamptz;
alter table if exists public.product_reviews add column if not exists moderated_by text;
alter table if exists public.product_reviews add column if not exists moderation_history jsonb;
update public.product_reviews set moderation_history = '[]'::jsonb where moderation_history is null;
alter table if exists public.product_reviews alter column moderation_history set default '[]'::jsonb;
alter table if exists public.product_reviews alter column moderation_history set not null;
update public.product_reviews set hidden_by_admin = false where hidden_by_admin is null;
alter table if exists public.product_reviews alter column hidden_by_admin set default false;
alter table if exists public.product_reviews alter column hidden_by_admin set not null;
create index if not exists product_reviews_admin_hidden_idx on public.product_reviews(hidden_by_admin, status);

-- Make the direct Supabase public-read policy and aggregate helper enforce the
-- same admin-hidden boundary as lib/reviews.js. The service-role API also
-- filters this way; this protects against accidental out-of-band row edits.
create or replace function public.bundle_review_summary(p_bundle_id bigint)
returns table(review_count bigint, rating_average numeric(3,2))
language sql stable as $$
  select count(*),
         coalesce(round(avg(rating)::numeric, 2), 0)
  from   public.product_reviews
  where  bundle_id = p_bundle_id
    and  status = 'published'
    and  hidden_by_admin = false;
$$;

drop policy if exists product_reviews_public_read on public.product_reviews;
create policy product_reviews_public_read on public.product_reviews
  for select to anon, authenticated
  using (status = 'published' and hidden_by_admin = false);

commit;

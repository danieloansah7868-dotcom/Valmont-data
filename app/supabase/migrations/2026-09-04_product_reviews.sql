-- ============================================================================
-- Verified-purchase product reviews (2026-09-04) — for the LIVE/staging Supabase.
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- What this is for: the SEO landing pages (/bundles/mtn/10gb.html and friends)
-- can only carry AggregateRating/Review schema once there are REAL reviews to
-- describe. Google's review-snippet policy and our own rule are the same here —
-- no ratings we cannot show on the page — so the schema is emitted by
-- assets/js/reviews.js from this table, and only when a bundle has at least one
-- published review.
--
-- The rules the table enforces:
--   • one review per customer per bundle            (unique index)
--   • rating 1..5, short title, short body           (check constraints)
--   • the order that verified it is recorded, so "Verified buyer" is a fact and
--     not a label anyone can claim                   (order_id / order_reference)
--   • size_mb and network_id are denormalised: retiring a bundle from the lineup
--     must not orphan or re-point somebody's review
--   • removal is a status change, never a DELETE, so the audit trail survives
--
-- Who may write: only the API (service role). Anon/authenticated get read access
-- to published rows only — see the policies at the bottom.
-- ============================================================================
begin;

create table if not exists public.product_reviews (
  id              bigint generated always as identity primary key,
  bundle_id       bigint not null references public.bundles(id),
  network_id      bigint not null references public.networks(id),
  size_mb         integer not null check (size_mb > 0),
  customer_id     bigint not null references public.customers(id),
  order_id        bigint references public.orders(id),        -- the delivered order that verified this review
  order_reference text,                                       -- copied so it survives order-table changes
  rating          integer not null check (rating between 1 and 5),
  title           text check (title is null or length(btrim(title)) between 1 and 80),
  body            text check (body is null or length(btrim(body)) between 1 and 600),
  status          text not null default 'published'
                  check (status in ('published','removed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (bundle_id, customer_id)                             -- one review per customer per bundle
);

create index if not exists product_reviews_bundle_idx on public.product_reviews(bundle_id, created_at desc);
create index if not exists product_reviews_status_idx on public.product_reviews(status);
create index if not exists product_reviews_customer_idx on public.product_reviews(customer_id);

-- Aggregate for a bundle: count + average of PUBLISHED reviews only, so nothing
-- can quote a number the page is not also showing.
create or replace function public.bundle_review_summary(p_bundle_id bigint)
returns table(review_count bigint, rating_average numeric(3,2))
language sql stable as $$
  select count(*),
         coalesce(round(avg(rating)::numeric, 2), 0)
  from   public.product_reviews
  where  bundle_id = p_bundle_id
    and  status = 'published';
$$;

comment on table public.product_reviews is
  'Verified-purchase reviews for data bundles. Written only by the API after it confirms a delivered order for that exact bundle; read publicly (published rows only) by /api/reviews and rendered on the generated landing pages.';

-- ---------------------------------------------------------------------------
-- RLS: anon/authenticated may read published reviews; every write goes through
-- the service role (the API), which bypasses RLS by design.
-- ---------------------------------------------------------------------------
alter table public.product_reviews enable row level security;

drop policy if exists product_reviews_public_read on public.product_reviews;
create policy product_reviews_public_read on public.product_reviews
  for select to anon, authenticated
  using (status = 'published');

-- No insert/update/delete policies for anon or authenticated: the API is the
-- only writer, and it connects with the service role key.

commit;

-- ============================================================================
-- Verify (optional):
--   select count(*) from public.product_reviews;
--   select * from public.bundle_review_summary(1);
--
-- Rollback:
--   drop function if exists public.bundle_review_summary(bigint);
--   drop table if exists public.product_reviews;
-- ============================================================================

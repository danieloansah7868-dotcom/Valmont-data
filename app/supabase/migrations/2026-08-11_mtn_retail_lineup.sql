-- ============================================================================
-- MTN retail update + new lineup (2026-08-11) — for the LIVE/staging Supabase.
-- Run in the Supabase SQL editor. Idempotent (safe to re-run).
--
-- Retail: 1GB ₵6 … 50GB ₵220 (aligned to market). Lineup mirrors the RemaData
-- catalogue: adds 4/6/8/15/25/40GB and retires 100GB (is_active = false;
-- historical orders keep their own amount/cost copies).
--
-- cost_price on EXISTING rows is left untouched (live costs may already have
-- been synced from the admin console). Newly added sizes are seeded at
-- RemaData's public wholesale — run admin price-sync afterwards to pull your
-- exact API costs for them.
-- ============================================================================
begin;

-- 1) New retail prices + sort order for every size in the lineup
--    (updates whichever of them already exist; never touches cost_price).
update public.bundles b
set    sell_price = v.sell_price,
       sort_order = v.sort_order,
       is_active  = true
from  (values
  ( 1024,   6.00,  1),
  ( 2048,  12.00,  2),
  ( 3072,  17.00,  3),
  ( 4096,  23.00,  4),
  ( 5120,  28.00,  5),
  ( 6144,  35.00,  6),
  ( 8192,  43.00,  7),
  (10240,  52.00,  8),
  (15360,  75.00,  9),
  (20480,  93.00, 10),
  (25600, 115.00, 11),
  (30720, 140.00, 12),
  (40960, 180.00, 13),
  (51200, 220.00, 14)
) as v(size_mb, sell_price, sort_order)
join  public.networks n on n.code = 'mtn' and n.id = b.network_id
where b.size_mb = v.size_mb;

-- 2) Insert the sizes the live DB doesn't have yet
--    (cost = RemaData public wholesale estimate).
insert into public.bundles (network_id, size_mb, validity_days, cost_price, sell_price, sort_order)
select n.id, v.size_mb, null, v.cost_price, v.sell_price, v.sort_order
from (values
  ( 4096,  16.60,  23.00,  4),
  ( 6144,  24.50,  35.00,  6),
  ( 8192,  32.60,  43.00,  7),
  (15360,  58.00,  75.00,  9),
  (25600,  98.00, 115.00, 11),
  (40960, 159.00, 180.00, 13)
) as v(size_mb, cost_price, sell_price, sort_order)
join public.networks n on n.code = 'mtn'
on conflict (network_id, size_mb) do nothing;

-- 3) Retire MTN 100GB — row stays for order history, hidden from storefront.
update public.bundles b
set    is_active = false
from   public.networks n
where  n.id = b.network_id and n.code = 'mtn' and b.size_mb = 102400;

commit;

-- Sanity check: the storefront catalogue after the migration.
select network, size_mb, sell_price, sort_order
from   public.v_bundles
where  network = 'mtn'
order  by sort_order;

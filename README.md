# Valmont Data

> **Ghana's data bundle marketplace — MTN · Telecel · AirtelTigo.**
> A subsidiary of **Valmont Group of Companies** (Accra).
> Payments powered by **Valmont-Pay** — Valmont Data is **tenant #3** on the
> group's multi-tenant gateway.

```
Customer → bundle + number → Valmont-Pay checkout (MoMo/card)
   → payment confirmed → signed webhook → /api/valmontpay/webhook
   → verify HMAC-SHA512 → idempotency claim → float check
   → supplier delivers → float ledger debit → receipt → audit log
```

## Repository layout

| Path | What it is | Status |
|---|---|---|
| [`app/`](app/) | **Production build** — static storefront + Vercel serverless functions + Supabase. No build step. | ✅ Deploy this |
| [`prototype/`](prototype/) | 27-page interactive design reference (simulated payments/auth, localStorage) | 📐 Reference only |
| [`starter-nextjs/`](starter-nextjs/) | First-attempt Next.js + Paystack starter | ⚠️ **Superseded** — reference only (esp. `src/lib/providers/remadata.ts`) |
| [`GET-STARTED.md`](GET-STARTED.md) | **Launch runbook** — Supabase → Valmont-Pay → Vercel → supplier → live smoke test | Follow this to go live |

## Quick start (production app, 2 minutes, no database needed)

```bash
cd app
cp .env.example .env.local      # defaults are fine for local
npm run dev                     # → http://localhost:8787 (in-memory DB)
npm test                        # 99-check end-to-end suite (start dev server first)
Want a pre-populated storefront instead of an empty one?
`cd app && SEED_DEMO=1 npm run dev` — loads ~50 realistic demo orders, 5 demo
customer accounts (PINs in `app/README.md`), a consistent float ledger and the
webhook audit log. `node scripts/seed-demo.js --sql` regenerates the demo seed
for a DEMO/staging Supabase (`app/supabase/seed-demo.sql`).

## The five non-negotiables

1. **Idempotency** — `orders.provider_reference` is UNIQUE and claimed with a
   conditional `UPDATE ... WHERE provider_reference IS NULL`. Payment webhooks
   retry; delivering twice burns real money.
2. **Signature verification** — `x-valmontpay-signature` (HMAC-SHA512 of the
   raw body with the tenant secret) must verify before anything happens.
   Never trust a browser-side "payment succeeded".
3. **Float guard** — checked before checkout (UI auto-disables bundles) and
   again before delivery; the race case auto-refunds. Never oversell float.
4. **Server-side delivery only** — only the verified webhook calls
   `supplier.submit()`.
5. **Audit trail** — every callback lands in `webhook_log`; every order keeps
   `provider_reference`, `supplier_ref`, full `supplier_response`, attempts and
   timestamps. Disputes settle in seconds.

Also: secrets never touch client code (`.env.example` only), and **no fake
discounts** (no fake "was" prices).

## Stack & conventions

- **Frontend:** plain HTML/CSS/JS (`app/index.html`, `status.html`,
  `admin.html`). Mobile-first; house style navy `#0b1a38`, orange `#ff8c00`,
  white `#f8fafc`; big tap targets.
- **PWA:** installable + offline-capable app shell — `app/manifest.json`,
  `app/sw.js` (precached shell, offline fallback, cache versioning),
  `app/offline.html`, `app/assets/js/pwa.js` (install card, update-to-refresh,
  offline pill). Details in `app/README.md` → PWA.
- **API:** zero-dependency Node serverless functions under `app/api/` (Vercel).
- **Data:** Supabase (PostgREST) via `app/lib/supabase.js` — service-role key
  server-side only. `SUPABASE_MOCK=1` gives an in-memory DB for local dev.
- **Schema:** `app/supabase/schema.sql` — networks, bundles (`cost_price` is
  internal), orders, float ledger (advisory-locked `add_float_entry`),
  webhook log, RLS, `daily_pnl()`.
- **Supplier:** `app/lib/supplier.js` adapter (mock + RemaData drivers).
  Swapping suppliers = adding a driver there, nothing else changes.

**Keep the zero-build-step static pattern** (Vercel + Supabase, like the other
Valmont sites). A build step needs a written justification.

## Docs

| Doc | Purpose |
|---|---|
| [`GET-STARTED.md`](GET-STARTED.md) | Go-live runbook: Supabase → Valmont-Pay → Vercel → supplier → smoke test |
| [`app/README.md`](app/README.md) | Production app: architecture, run/test, deploy |
| [`prototype/README.md`](prototype/README.md) | Design blueprint: page map, pricing, UX decisions |
| [`starter-nextjs/README.md`](starter-nextjs/README.md) | Superseded starter (kept for the provider/ driver ideas) |

---

© 2026 Valmont Group of Companies · Accra, Ghana · Payments powered by Valmont-Pay

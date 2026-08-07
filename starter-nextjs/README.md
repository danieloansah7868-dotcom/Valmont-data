> ## ⚠️ SUPERSEDED
> This Next.js + Paystack starter was the first attempt. The **canonical build**
> is now the static storefront + Supabase + Valmont-Pay architecture in
> [`../app/`](../app/) (per the Valmont Data build brief).
> Kept for reference — especially `src/lib/providers/remadata.ts` and the
> pricing/pipeline ideas, which were ported into `app/lib/`.

# Valmont Data — Production App Starter (Next.js 15 + PostgreSQL + Paystack)

This is the **working backend + UI starter** for Valmont Data, scaffolded from the
interactive prototype (`../app/`). Copy this folder into your new GitHub
repo and build the real thing on top of it.

```
┌────────────────────────────────────────────────────────────┐
│  Prototype (`prototype/`)    = design spec + UI library    │
│  This app (valmont-data-app/) = runnable product skeleton  │
└────────────────────────────────────────────────────────────┘
```

## What's inside

| Area | Files |
|---|---|
| Database schema + seeds | `schema.sql`, `scripts/migrate.js` |
| DB client | `src/lib/db.ts` (pg pool) |
| Auth (JWT cookie, bcrypt) | `src/lib/auth.ts` + `src/app/api/auth/*` |
| Pricing tiers (guest/member/reseller/dealer/wholesaler) | `src/lib/pricing.ts` |
| MoMo payments (Paystack) | `src/lib/paystack.ts`, `src/app/api/deposits`, `src/app/api/webhooks/paystack` |
| Orders + delivery pipeline | `src/lib/orders.ts`, `src/lib/providers/`, `src/app/api/orders/*` |
| Wallet ledger | `src/app/api/wallet` |
| UI (ported design system) | `src/app/*`, `src/components/*` |

## 1. Run it locally

### Option A — zero-config (recommended first run)

```bash
npm install
npm run dev:mem          # in-memory Postgres, schema auto-applied, no setup
# → http://localhost:3000
```

### Option B — real Postgres (Supabase / Neon)

```bash
npm install
cp .env.example .env.local        # fill in DATABASE_URL
npm run db:migrate                # creates tables + seeds bundles/providers
npm run dev
```

Without Paystack keys the app runs in **dev mode**: MoMo payments and deposits
are auto-approved so you can test the whole flow. Set `PAYSTACK_SECRET_KEY` in
`.env.local` to make real charges.

**End-to-end test:** sign up → deposit GH₵50 → buy a 10GB MTN bundle with wallet
→ watch the order go paid → processing → delivered (~20s, mock provider) on
`/track`. Deliveries can be made to fail with `MOCK_FAIL_RATE="0.2"` to see
auto-refunds in action.

## Automated smoke test (31 checks)

```bash
MEMORY_DB=1 npm run dev   # in one terminal
npm run smoke             # in another — exercises the full API + pages
```

Covers: guest & member pricing, signup/signin/session, duplicate rejection,
idempotency keys, wallet deposit/debit/ledger, MoMo & wallet orders,
processing → delivered pipeline, validation errors, and every page route.

## 2. Deploy (Vercel + Supabase/Neon)

1. Create a Supabase (or Neon) project → copy the Postgres connection string.
2. `npm run db:migrate` against it (or run `schema.sql` in Supabase's SQL editor).
3. Import this repo into Vercel → add env vars from `.env.example` → deploy.
4. Configure the Paystack webhook → `https://your-domain.com/api/webhooks/paystack`.

## 3. Going live — the checklist

- [ ] **Sign wholesale provider contracts** (MTN/Telecel/AirtelTigo bulk data).
      Implement `ProviderDriver` in `src/lib/providers/` and set `PROVIDER_DRIVER`.
- [ ] Move `runOrderPipeline` from `setTimeout` into a **BullMQ/Redis worker**
      (Vercel serverless functions can't keep long timers alive).
- [ ] Add **Google OAuth** (Auth.js) and **phone OTP** (Termii/Twilio).
- [ ] Guest MoMo **auto-refund** via Paystack Refund API when delivery fails.
- [ ] Reseller **stores** (`stores` table + `/store/[slug]` page + markup pricing).
- [ ] Public **developer API** (api keys table + rate limiting + HMAC webhooks).
- [ ] Admin console (order search, provider health, manual refunds).
- [ ] SMS/WhatsApp notifications on order events.

## Dev-mode behaviour (no keys needed)

- `/api/auth/*` — full signup/signin with bcrypt + httpOnly JWT cookie
- `/api/orders` — wallet payment debits instantly; MoMo auto-approves
- `/api/deposits` — credits instantly
- Delivery — mock provider delivers after `MOCK_DELIVER_MS` (default 20s),
  fails `MOCK_FAIL_RATE`% of the time, auto-refunds failed orders

## Roadmap mapping

The detailed architecture, schema rationale and "hard-won rules" are in
`../prototype/README.md` (the blueprint). Keep that doc in sync with this app.

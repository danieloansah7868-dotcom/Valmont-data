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
npm run dev                     # fresh, unseeded in-memory DB → http://localhost:8787
npm test                        # six-suite validation runner; API pipeline must finish 158 passed / 0 failed
```

> **Test-server rule:** Run `npm test` only against a newly started, **unseeded**
> `npm run dev` server. Do not use `npm run dev:demo` or a server that an earlier
> test already used: `scripts/test.sh` deliberately begins at zero float and funds
> itself. A seeded server produces 152 passed / 6 failed and the runner correctly
> treats that as a failed API run.

Storefront at `/`, order tracking at `/status.html`, admin console at
`/admin.html` (dev password `admin123`), **Auto-reload opt-in at
`/autoreload.html`**. See [`app/README.md`](app/README.md)
for the full tour, including how to simulate payments
(`node scripts/sim-webhook.js --ref VD-260806-XXXX`), simulate bundle usage
(`node scripts/sim-usage.js --ref VD-... --percent 92`) and exercise every
failure path (duplicate webhook, bad signature, wrong amount, retry).

**Auto-reload** — the web tracks each delivered bundle (`bundle_usage`),
prompts the user when a line runs low, and when they opt in at
`autoreload.html`, a cron re-buys the bundle from their pre-authorized MoMo
through the same idempotent webhook pipeline. Each top-up **sends a MoMo
prompt to the customer's phone — they approve with their PIN** and only then
does the data deliver (no silent wallet debits; if they don't approve,
nothing is charged). Sweep manually in dev: `curl localhost:8787/api/cron/autoreload`.

**WhatsApp ordering** — customers buy data bundles by chatting on WhatsApp
(no browser needed). Send "hi" → tap Buy Data → pick network/bundle → confirm
→ pay via MoMo. Quick orders work too: type "2gb mtn 0241234567" and the bot
parses it. Built on Meta's WhatsApp Cloud API with the same order pipeline
(float guard, payment webhook, delivery, idempotency). Dev mode logs messages
to console; `WHATSAPP_MODE=live` sends real messages.

**Referral program** — every customer gets a unique referral code (e.g.
`KOFI-A3X2`). Share it, and when a friend signs up with it and makes their
first purchase, both earn GH₵2 credit for future orders. Self-referral
blocked, credit capped at GH₵50.

**SMS notifications** — transactional SMS (delivery confirmations, refunds)
sent automatically via Ghana-based providers (Arkesel, mNotify, or Hubtel).
Fires in parallel with webhooks, never blocks the pipeline. A completed-delivery
SMS may include a direct review link only for the verified buyer/recipient relationship
and only when the entire plain-text message fits one GSM-7 segment; there are no review
incentives. Deployed endpoints refuse to report mock/unconfigured SMS as sent.

**Payments are live-first**: set `VALMONTPAY_MODE=live` plus the
Valmont-Pay keys (`VALMONTPAY_API_URL/API_KEY/WEBHOOK_SECRET`) and every
checkout *and* auto-reload charge goes through the real gateway — there is no
silent dev fallback (missing keys → 503). Simulation exists only for local
development (`npm run dev` sets dev mode explicitly).

**Others (topping up for someone else)**: buy a bundle for your girlfriend or
family and the buy flow offers *"Auto top-up 055… (others)"* — a checkbox that
tops THEM up from your MoMo when their data runs low, with the recipient named
in the label. Every line you top up is tracked with live usage on the
Auto-reload page (with a "track & auto top-up others" prompt when one runs
low), and opting in for someone else's line always requires the explicit
"the data goes to them, not to me" confirmation — so it can never silently
drain your MoMo onto their line.

Want a pre-populated storefront instead of an empty one?
`cd app && SEED_DEMO=1 npm run dev` — loads ~50 realistic demo orders, 5 demo
customer accounts (PINs in `app/README.md`), a consistent float ledger and the
webhook audit log. It is for manual click-through only; stop it and restart plain
`npm run dev` before running `npm test`. `node scripts/seed-demo.js --sql`
regenerates the demo seed for a DEMO/staging Supabase (`app/supabase/seed-demo.sql`).

## The five non-negotiables

1. **Idempotency** — `orders.provider_reference` is UNIQUE and claimed with a
   conditional `UPDATE ... WHERE provider_reference IS NULL`. Payment webhooks
   retry; delivering twice burns real money.
2. **Signature verification** — `x-valmontpay-signature` (HMAC-SHA512 of the
   raw body with the tenant secret) must verify before anything happens.
   Never trust a browser-side "payment succeeded".
3. **Float guard** — checked before checkout (UI auto-disables bundles) and
   again before delivery; a paid race/failure case enters **Refund being arranged**
until an admin completes and records the real gateway refund. Never oversell float.
4. **Server-side delivery only** — only the verified webhook calls
   `supplier.submit()`.
5. **Audit trail** — every callback lands in `webhook_log`; every order keeps
   `provider_reference`, `supplier_ref`, full `supplier_response`, attempts and
   timestamps. Disputes settle in seconds.

Also: secrets never touch client code (`.env.example` only), and **no fake
discounts** (no fake "was" prices).

## Payment, refund and deployment safety

A live Valmont-Pay delivery failure or amount mismatch is **not** called refunded
until a real gateway refund has happened. It becomes `refund_pending` (shown to the
customer as “Refund being arranged”), then an authenticated administrator uses the
Orders completion control after reconciling the actual gateway action. Providers can
take additional time to show the completed credit.

Vercel deployments reject local mock/no-database behavior: configure real Supabase,
a live non-mock supplier, Valmont-Pay credentials, `SITE_URL`, a strong `AUTH_SECRET`,
`USAGE_REPORT_KEY`, and `CRON_SECRET`. Vercel invokes scheduled jobs with
`Authorization: Bearer $CRON_SECRET`; local development may run the cron without a
secret only when no local secret is configured.

## Stack & conventions

- **Frontend:** plain HTML/CSS/JS (`app/index.html`, `status.html`,
  `admin.html`). Mobile-first; house style navy `#0b1a38`, orange `#ff8c00`,
  white `#f8fafc`; big tap targets.
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

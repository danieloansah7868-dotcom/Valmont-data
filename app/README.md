# Valmont Data — production build

> Ghana's data bundle marketplace (MTN · Telecel · AirtelTigo).
> **Tenant #3 on Valmont-Pay.** Static HTML/JS storefront + Vercel serverless functions + Supabase — no build step, same pattern as the other Valmont sites.

```
Customer → bundle + number → Valmont-Pay checkout (MoMo/card)
   → payment confirmed → signed webhook → /api/valmontpay/webhook
   → verify HMAC-SHA512 → idempotency claim → float check
   → supplier delivers → ledger debit → receipt → audit log
```

The **webhook handler is the heart of the system** (`api/valmontpay/webhook.js`). It was built and tested first, before any UI.

---

## What's here

| Path | Purpose |
|---|---|
| `index.html` | Storefront — network tabs, bundle grid, phone validation, confirm-before-pay |
| `status.html` | Public order tracking by reference (no login) |
| `admin.html` | Admin console — float, orders + retry, P&L, webhook audit |
| `api/valmontpay/webhook.js` | ⚠️ Payment webhook: signature verify → idempotent claim → float guard → delivery |
| `api/orders.js` | Create order (float guard #1, Valmont-Pay checkout) + public status |
| `api/bundles.js` | Public catalogue with server-side availability (never cost_price) |
| `api/admin/*` | Login, float (+top-up), orders (+retry), P&L, webhook log |
| `api/cron/retry.js` | Every 15 min: retry failed deliveries (max 3), low-float alert |
| `lib/` | `supabase.js` (data layer + mock), `valmontpay.js` (client + HMAC-SHA512), `supplier.js` (adapter), `orders.js` (engine), `phones.js`, `notify.js`, `auth.js` |
| `supabase/schema.sql` | Tables, RLS, functions, seeds — run once in Supabase |
| `scripts/dev-server.js` | Zero-dependency local server (mock DB) |
| `scripts/sim-webhook.js` | Sign + send a fake payment webhook to test delivery |

## Non-negotiable requirements — how each is enforced

1. **Idempotency** — `orders.provider_reference` has a `UNIQUE` constraint **and** the webhook claims it via `UPDATE ... WHERE provider_reference IS NULL`. Duplicate or concurrent webhooks can never deliver twice. (Test: `sim-webhook.js --duplicate`.)
2. **Signature verification** — `x-valmontpay-signature` = HMAC-SHA512 of the raw body with the tenant secret; invalid → 401 + logged. Delivery never happens on a browser callback.
3. **Float guard** — checked in `api/orders` *before* the checkout is created (bundle auto-disabled in UI when float is short) **and** re-checked in the webhook before delivery; the race case auto-refunds.
4. **Server-side only** — only the verified webhook triggers `supplier.submit()`.
5. **Audit trail** — every callback lands in `webhook_log` (signature_valid, payload, handled, error); every order stores `provider_reference`, `supplier_ref`, `supplier_response` (full supplier reply), `attempts`, timestamps.

---

## Run locally (2 minutes, no database needed)

```bash
cp .env.example .env.local     # defaults are fine for local testing
npm run dev                    # → http://localhost:8787
```

Then click through the whole business:

1. Storefront → pick a bundle → enter number → confirm → order created (dev mode: no Valmont-Pay, so no redirect).
2. Simulate the payment:
   ```bash
   node scripts/sim-webhook.js --ref VD-260806-XXXX
   ```
   (the order reference is shown on screen in dev mode)
3. Watch `status.html?reference=VD-...` flip to **Delivered**.
4. Admin (`admin.html`, password `admin123`): top up float → see balances/ledger/P&L/orders.

Also try the failure paths:
```bash
node scripts/sim-webhook.js --ref VD-... --bad-signature   # 401, logged
node scripts/sim-webhook.js --ref VD-... --wrong-amount    # auto-refund
node scripts/sim-webhook.js --ref VD-... --duplicate       # idempotency no-op
MOCK_FAIL_FIRST=1 npm run dev                              # delivery fails → retry via admin/cron
```

---

## Deploy (Vercel + Supabase)

1. **Supabase**: create project → SQL editor → paste `supabase/schema.sql` → run. (Tables + RLS + functions + seeds.)
2. **Vercel**: import this repo, set **Root Directory = `app`** → add env vars from `.env.example` → deploy. (`vercel.json` wires the 15-minute cron + security headers.)
3. **Valmont-Pay**: request tenant #3 onboarding → set `VALMONTPAY_API_URL/API_KEY/WEBHOOK_SECRET` → register webhook URL `https://<your-domain>/api/valmontpay/webhook` in the gateway dashboard.
4. **Supplier**: see `GET-STARTED.md` at repo root — create a RemaData account, set `SUPPLIER_DRIVER=remadata`, `REMADATA_API_KEY`, `REMADATA_PLANS`.

---

## Tested

`scripts/test.sh` runs the full pipeline against the dev server (mock DB):
float guard (reject when 0 float) → top-up → order → webhook → delivered →
ledger debit → duplicate webhook no-op → bad signature 401 → wrong amount
refund → fail-first retry → admin login/float/orders/retry/P&L.

Run it with `npm test` (after starting `npm run dev`).

© 2026 Valmont Group of Companies.

## Roadmap (in priority order)

1. **Customer accounts** — saved numbers, order history, one-tap repeat buying
   (the margin comes from repeats). Schema already has `orders.customer_id`.
2. **Auto-refund via Valmont-Pay refund API** — wire `lib/valmontpay.js → refund()`
   when the gateway exposes tenant refunds.
3. **WhatsApp receipts** — point `NOTIFY_WEBHOOK_URL` at a WhatsApp Cloud API
   worker (or a Valmont Web Services flow).
4. **Supplier failover** — add a second driver (e.g. Bundles Ghana) and route
   by network health, mirroring the delivery-queue honesty in the UI.
5. **Reseller tier** — dealer/wholesaler accounts with per-tier prices.

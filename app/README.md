# Valmont Data — production build

> Ghana's data bundle marketplace (MTN · Telecel · AirtelTigo).
> **Tenant #3 on Valmont-Pay.** Static HTML/JS storefront + Vercel serverless functions + Supabase — no build step, same pattern as the other Valmont sites.

```
Customer → create free account / sign in (email & password)
   → bundle + number (or pick from saved numbers) → Valmont-Pay checkout (MoMo/card)
   → payment confirmed → signed webhook → /api/valmontpay/webhook
   → verify HMAC-SHA512 → idempotency claim → float check
   → supplier delivers → ledger debit → receipt → audit log
```

The **webhook handler is the heart of the system** (`api/valmontpay/webhook.js`). It was built and tested first, before any UI.

---

## What's here

| Path | Purpose |
|---|---|
| `index.html` | Storefront — network tabs, bundle grid, customer accounts, saved numbers, time-based greeting, confirm-before-pay |
| `status.html` | Public order tracking by reference (no login) |
| `admin.html` | Admin console — float, orders + retry, P&L, webhook audit |
| `api/valmontpay/webhook.js` | ⚠️ Payment webhook: signature verify → idempotent claim → float guard → delivery |
| `api/orders.js` | Create order (compulsory customer token, float guard #1, Valmont-Pay checkout) + public status |
| `api/auth/customer.js` | Customer signup & login (scrypt password/PIN hash, 30-day HMAC token) |
| `api/account.js` | Customer profile, time greeting ("Good morning, Kofi"), saved data/MoMo numbers (10/kind cap), order history |
| `api/bundles.js` | Public catalogue with server-side availability (never cost_price) |
| `api/admin/*` | Login, float (+top-up), orders (+retry), P&L, webhook log |
| `api/cron/retry.js` | Daily cron (07:00 UTC) on Vercel Hobby + optional 15-min GitHub Actions pinger: retry failed deliveries (max 3), low-float alert |
| `lib/` | `supabase.js` (data layer + mock), `valmontpay.js` (client + HMAC-SHA512), `supplier.js` (adapter), `orders.js` (engine), `phones.js`, `notify.js`, `auth.js` |
| `supabase/schema.sql` | Tables (`customers`, `saved_numbers`, `orders`, `float_ledger`, etc.), RLS, functions, seeds — run once in Supabase |
| `supabase/seed-demo.sql` | **Demo seed** for DEMO/STAGING Supabase — customers, orders, float, webhook log (generated, self-skipping) |
| `scripts/dev-server.js` | Zero-dependency local server (mock DB) |
| `scripts/seed-demo.js` | Demo data: seed the mock DB (`SEED_DEMO=1`), verify consistency, or regenerate `supabase/seed-demo.sql` |
| `scripts/sim-webhook.js` | Sign + send a fake payment webhook to test delivery |
| `scripts/build-icons.js` | Zero-dependency icon builder — regenerates the globe favicon/logo set (PNG/ICO) from `assets/img/favicon.svg` |
| `assets/img/brand-logo.png`/`.svg` | **Brand banner** (gold constellation hexagon + VALMONT DATA wordmark) — header/footer logo, transparent |
| `assets/img/favicon.svg` | Gold constellation mark — browser/PWA favicon; transparent PNG/ICO raster set alongside |

## Non-negotiable requirements — how each is enforced

1. **Idempotency** — `orders.provider_reference` has a `UNIQUE` constraint **and** the webhook claims it via `UPDATE ... WHERE provider_reference IS NULL`. Duplicate or concurrent webhooks can never deliver twice. (Test: `sim-webhook.js --duplicate`.)
2. **Signature verification** — `x-valmontpay-signature` = HMAC-SHA512 of the raw body with the tenant secret; invalid → 401 + logged. Delivery never happens on a browser callback.
3. **Float guard** — checked in `api/orders` *before* the checkout is created (bundle auto-disabled in UI when float is short) **and** re-checked in the webhook before delivery; the race case auto-refunds.
4. **Server-side only** — only the verified webhook triggers `supplier.submit()`.
5. **Customer accounts & saved numbers** — customer token required to place orders; passwords/PINs scrypt-hashed; server-side ownership enforcement; personalized time greetings attached to first name.
6. **Audit trail** — every callback lands in `webhook_log` (signature_valid, payload, handled, error); every order stores `provider_reference`, `supplier_ref`, `supplier_response` (full supplier reply), `attempts`, timestamps.

---

## Run locally (2 minutes, no database needed)

```bash
cp .env.example .env.local     # defaults are fine for local testing
npm run dev                    # → http://localhost:8787
```

Then click through the whole business:

1. Storefront → create account or sign in with email/password → pick bundle → enter number → confirm → order created (dev mode: no Valmont-Pay, so no redirect).
2. Simulate the payment:
   ```bash
   node scripts/sim-webhook.js --ref VD-260806-XXXX
   ```
   (the order reference is shown on screen in dev mode)
3. Watch `status.html?reference=VD-...` flip to **Delivered**.
4. View customer profile and personalized greeting ("Good morning, Kofi" / "Good afternoon, Kofi"), saved numbers & order history in the account panel.
5. Admin (`admin.html`, password `admin123`): top up float → see balances/ledger/P&L/orders.

Also try the failure paths:
```bash
node scripts/sim-webhook.js --ref VD-... --bad-signature   # 401, logged
node scripts/sim-webhook.js --ref VD-... --wrong-amount    # auto-refund
node scripts/sim-webhook.js --ref VD-... --duplicate       # idempotency no-op
MOCK_FAIL_FIRST=1 npm run dev                              # delivery fails → retry via admin/cron
```

---

## Demo data (one command, no database)

The default dev server starts with an empty (bundle-only) store, exactly like
a fresh production DB. To instead start with **~50 realistic orders across
MTN/Telecel/AirtelTigo, demo customers, a consistent float ledger and the
webhook audit log**:

```bash
npm run dev:demo        # = SEED_DEMO=1 node scripts/dev-server.js
```

What you get (see `lib/demo-data.js` — deterministic, one source of truth):

- **5 demo customer accounts** — log in at the storefront with these PINs:
  | Phone | Name | PIN |
  |---|---|---|
  | `0241234567` | Ama Serwaa | `1234` |
  | `0209876543` | Kofi Mensah | `1234` |
  | `0551112233` | Abena Owusu | `9876` |
  | `0502345678` | Yaw Boateng | `2468` |
  | `0273344556` | Esi Asante | `1357` |
  Each with saved data lines + MoMo numbers and linked order history.
- **Orders in every status**: `delivered` (most, with `supplier_ref` +
  full `supplier_response` + `delivered_at`), a few `failed` (some retryable,
  some at max attempts), `refunded` (amount-mismatch path), `delivering`,
  and `pending` (never paid).
- **Float ledger** that chains correctly: initial top-ups → debits per
  delivered order → mid-period restocks, with `balance_after` consistent per
  network (so P&L, float and order numbers all agree).
- **Webhook audit log** including deliberate edge cases: forged
  (invalid-signature) callbacks, an unknown-order callback, and a
  `payment.failed` event.

Useful commands:

```bash
node scripts/seed-demo.js --verify     # consistency checks on the dataset
node scripts/seed-demo.js              # seed the in-memory DB + print summary/logins
node scripts/seed-demo.js --sql        # regenerate supabase/seed-demo.sql
node scripts/seed-demo.js --as-of 2026-08-07T00:00:00Z --count 60   # tweak the anchor/count
```

For a **DEMO/STAGING Supabase**, run `supabase/schema.sql` then
`supabase/seed-demo.sql` (generated, self-skips if `orders` already has rows —
never run it against production). Demo logins are printed in the file header.

---

## Deploy (Vercel + Supabase)

1. **Supabase**: create project → SQL editor → paste `supabase/schema.sql` → run. (Tables + RLS + functions + seeds. Idempotent; safely adds `customers` and `saved_numbers` tables.)
2. **Vercel**: import this repo, set **Root Directory = `app`** → add env vars from `.env.example` → deploy. (`vercel.json` wires daily `0 7 * * *` cron for Hobby accounts; `.github/workflows/cron-retry.yml` provides 15-minute retry pings when `SITE_URL` repository variable is set.)
3. **Valmont-Pay**: request tenant #3 onboarding → set `VALMONTPAY_API_URL/API_KEY/WEBHOOK_SECRET` → register webhook URL `https://<your-domain>/api/valmontpay/webhook` in the gateway dashboard.
4. **Supplier**: see `GET-STARTED.md` at repo root — create a RemaData account, set `SUPPLIER_DRIVER=remadata`, `REMADATA_API_KEY`, `REMADATA_PLANS`.

---

## Tested

`scripts/test.sh` runs the full 40-check pipeline against the dev server (mock DB):
float guard (reject when 0 float, guest 401) → admin login/float top-up →
customer signup (scrypt hash, 30-day token) → duplicate 409 → wrong credentials 401 →
customer login → account gating 401 → authed 0-float 422 → order creation →
webhook delivery → delivered → ledger debit → duplicate webhook no-op →
bad signature 401 → wrong amount refund → phone validation → fail-first retry →
recent numbers → save/delete numbers → order history → personalized time greeting →
admin float/orders/retry/P&L → static pages.

Run it with `npm test` (after starting `npm run dev`).

© 2026 Valmont Group of Companies.

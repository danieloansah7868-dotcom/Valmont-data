# GET STARTED — Valmont Data launch runbook

> From fresh clone to a live store taking real orders. Four systems, in order:
> **Supabase → Valmont-Pay → Vercel → RemaData (supplier)**, then one live
> smoke test. Estimated time: ~90 minutes (plus waiting on the Valmont-Pay
> onboarding pack).

The production app lives in [`app/`](app/). Everything below refers to it
unless stated otherwise.

---

## 0 · Prerequisites

- [ ] Node 20+ installed locally (the app runs on Node 18+, zero npm dependencies).
- [ ] GitHub repo access (this repo).
- [ ] A [Supabase](https://supabase.com) account (free tier is fine).
- [ ] A [Vercel](https://vercel.com) account connected to GitHub.
- [ ] The **Valmont-Pay tenant #3 onboarding pack** from the Valmont-Pay team
      (API key + webhook secret). Request this early — it has a human in the loop.
- [ ] A [RemaData](https://remadata.com) account (free, no upfront capital).

---

## 1 · Verify the app runs locally (10 minutes)

```bash
cd app
cp .env.example .env.local      # defaults are fine for local testing
npm run dev                     # → http://localhost:8787 (in-memory DB, SUPABASE_MOCK=1)
```

In a second terminal (with the dev server still running):

```bash
npm test                        # 26-check end-to-end suite — must be 26/26
```

Then click through the business manually:

1. Storefront → pick a bundle → enter a number (e.g. `0241112222`) → confirm →
   order created. Dev mode prints the order reference (`VD-YYMMDD-NNNN`).
2. Simulate the payment:
   ```bash
   node scripts/sim-webhook.js --ref VD-260806-XXXX
   ```
3. Watch `status.html?reference=VD-...` flip to **Delivered**.
4. Admin console at `/admin.html` (dev password `admin123`): top up float,
   watch the ledger, P&L and webhook audit.

Exercise the failure paths — each is a non-negotiable guarantee:

```bash
node scripts/sim-webhook.js --ref VD-... --duplicate       # idempotency no-op
node scripts/sim-webhook.js --ref VD-... --bad-signature   # 401, logged
node scripts/sim-webhook.js --ref VD-... --wrong-amount    # auto-refund
MOCK_FAIL_FIRST=1 npm run dev                              # delivery fails → retry via admin/cron
```

**Do not proceed until `npm test` is green and you have seen all four failure
paths behave as documented.**

---

## 2 · Supabase — the database (15 minutes)

1. Create a new project at [supabase.com](https://supabase.com) →
   **New project** (any region close to Ghana; note the DB password).
2. Open **SQL Editor** → paste the whole of
   [`app/supabase/schema.sql`](app/supabase/schema.sql) → **Run**.
   It is idempotent: tables (`networks`, `bundles`, `orders`, `float_ledger`,
   `webhook_log`), the advisory-locked `add_float_entry()` function,
   `current_float()`, `daily_pnl()`, the public `v_bundles` view, RLS policies
   and seed bundles (cost + sell prices) are all created in one go.
3. Sanity-check RLS: the **anon** role may only read `networks` + `v_bundles`,
   insert a `pending` order and read its own order by reference. There is **no
   anon path to `cost_price`, float or webhooks**. The app talks to PostgREST
   with the **service-role key, server-side only**.
4. Capture two values (**Project Settings → API**):
   - `SUPABASE_URL` — `https://<project-ref>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` — the `service_role` secret key (**never** the
     anon key, and never in client code).

Bundle prices live in the database. To change a price, update `bundles`
(`sell_price` public, `cost_price` internal) — orders snapshot both at
purchase time so historical P&L stays accurate.

---

## 3 · Valmont-Pay — tenant #3 (payments)

1. Get the **tenant onboarding pack** from the Valmont-Pay team:
   - tenant API key → `VALMONTPAY_API_KEY`
   - webhook signing secret → `VALMONTPAY_WEBHOOK_SECRET`
   - gateway base URL → `VALMONTPAY_API_URL`
2. Register the webhook URL in the gateway dashboard:
   ```
   https://<your-domain>/api/valmontpay/webhook
   ```
3. Confirm the contract matches [`app/lib/valmontpay.js`](app/lib/valmontpay.js):

   | Item | Expected |
   |---|---|
   | Checkout creation | `POST /checkouts` with `reference, amount, currency=GHS, customer_phone, return_url, webhook_url` → `{ checkout_url }` |
   | Webhook event | `payment.succeeded` with `{ provider_reference, reference, amount }` |
   | Signature | `x-valmontpay-signature` = hex HMAC-SHA512 of the **raw** body with the tenant webhook secret |
   | Refunds | `POST /refunds` with `{ provider_reference }` |

   If the live gateway differs, adjust `createCheckout()` / `refund()` there —
   nothing else in the app knows gateway paths.
4. Test the signature locally before going live:
   ```bash
   VALMONTPAY_WEBHOOK_SECRET=<secret> node scripts/sim-webhook.js --ref VD-... --base https://<your-domain>
   ```

---

## 4 · Vercel — deploy

1. **Import** this repo into Vercel.
2. **Root Directory = `app`** ← the one setting everyone gets wrong.
3. No framework preset / build command needed — static files + `/api` functions.
   (`app/vercel.json` wires the every-15-minutes `/api/cron/retry` cron and the
   security headers.)
4. Add **all** environment variables from [`app/.env.example`](app/.env.example):

   | Var | Value |
   |---|---|
   | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | from step 2 |
   | `VALMONTPAY_API_URL` / `VALMONTPAY_API_KEY` / `VALMONTPAY_WEBHOOK_SECRET` | from step 3 |
   | `SITE_URL` | `https://<your-domain>` |
   | `ADMIN_PASSWORD` | strong password for `/admin.html` |
   | `AUTH_SECRET` | long random string (admin session tokens) |
   | `SUPPLIER_DRIVER` | `mock` until step 5, then `remadata` |
   | `REMADATA_API_KEY` / `REMADATA_PLANS` | from step 5 |
   | `LOW_FLOAT_THRESHOLD` | e.g. `50` |
   | `NOTIFY_WEBHOOK_URL` | optional — WhatsApp/SMS alerts worker |

   Leave `SUPABASE_MOCK` **unset** in production (any value other than `1` is
   fine — `SUPABASE_MOCK=1` forces the in-memory DB and must never be deployed).
5. Deploy → connect the custom domain → update `SITE_URL` if the domain
   differs from the Vercel-assigned one.

---

## 5 · RemaData — the supplier (float!)

1. Create a free account at [remadata.com](https://remadata.com) → copy your
   API key → set `REMADATA_API_KEY`.
2. Map every bundle you sell to a RemaData **plan_id** and export
   `REMADATA_PLANS`, keyed by network → size in MB:

   ```json
   REMADATA_PLANS={"mtn":{"1024":1001,"2048":1002,"10240":1003},"telecel":{"10240":2001},"airteltigo":{"1024":3001}}
   ```

   (`starter-nextjs/scripts/sync-prices.js` prints this line from a
   `plans.json` export if you prefer a helper.)
3. Fund your RemaData wallet — this **is your float**. Each successful delivery
   debits it at `cost_price`; the app tracks the same float in `float_ledger`
   so the storefront can refuse sales it cannot fulfil.
4. Set `SUPPLIER_DRIVER=remadata` (from `mock`) in Vercel and redeploy.
5. **Record the same top-up in the admin console** (`/admin.html` → Float →
   Top-up, per network). The admin float must mirror the supplier wallet, or
   the float guard cannot protect you.
6. Set `LOW_FLOAT_THRESHOLD` — the cron job alerts you (via
   `NOTIFY_WEBHOOK_URL`) when float drops below it. **Never run float dry.**

> Buying and confirming wholesale price changes is a business task: when the
> supplier price moves, update `bundles.cost_price` (and `sell_price` to hold
> margin). `cost_price` is snapshotted per order, so old P&L rows never shift.

---

## 6 · Live smoke test (one real order)

Do this with a small bundle (1 GB) and your own number, before announcing:

1. Buy a bundle on the live site → you are redirected to the Valmont-Pay
   checkout.
2. Pay with real MoMo/card.
3. Confirm in `/admin.html`:
   - order flips **pending → delivering → delivered** (else check the webhook
     audit — signature failures land there),
   - float ledger shows the debit,
   - **P&L** has a row with revenue − cost = margin,
   - receipt notification fired (if `NOTIFY_WEBHOOK_URL` is set).
4. Confirm the data actually arrived on the phone.
5. Reconcile: supplier wallet balance − admin float balance = expected
   difference (only orders since the last top-up).

One more drill: temporarily disconnect (or exhaust) supplier float and place
an order — the race-condition path must **auto-refund** and mark the webhook
`insufficient_float → refunded` in the audit log. Then restore float.

---

## 7 · Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| All bundles show "unavailable" | Float is zero (or `float_ledger` empty) — top up in admin |
| Order stuck `pending` | No webhook arrived — check gateway dashboard + `webhook_log` in admin |
| Order `pending` + webhook shows 401 | Wrong `VALMONTPAY_WEBHOOK_SECRET` — signature mismatch |
| Order delivered but no supplier credit | `REMADATA_PLANS` missing that size, or wrong API key — see order's `supplier_response` |
| `delivery failed`, then delivered after admin retry | Supplier hiccup; cron would have retried within 15 min anyway (max 3 attempts) |
| Webhook logged "unknown order" | `reference` mismatch between checkout and order — log a reconciliation ticket with the supplier payload |
| P&L empty | `daily_pnl()` reads **completed** deliveries only — finish the smoke test first |

---

## 8 · Go-live checklist

- [ ] `npm test` green locally (26/26)
- [ ] `schema.sql` run in Supabase; RLS sanity-checked
- [ ] All env vars set in Vercel; `SUPABASE_MOCK` **not** set
- [ ] Valmont-Pay webhook registered + signature verified end-to-end
- [ ] `SUPPLIER_DRIVER=remadata` + `REMADATA_PLANS` covers every active bundle
- [ ] Supplier float funded **and** mirrored in admin (per network)
- [ ] `LOW_FLOAT_THRESHOLD` + `NOTIFY_WEBHOOK_URL` set
- [ ] Live smoke test order delivered; P&L row present; data arrived
- [ ] `ADMIN_PASSWORD` + `AUTH_SECRET` are strong and unique
- [ ] No secrets anywhere in git history

---

© 2026 Valmont Group of Companies · Payments powered by Valmont-Pay

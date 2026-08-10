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
npm test                        # 37-check end-to-end suite — must be 37/37
```

Then click through the business manually:

1. Storefront → create a free customer account (or sign in with email/password) →
   pick a bundle → pick or enter a number (e.g. `0241112222`) → confirm →
   order created. Dev mode prints the order reference (`VD-YYMMDD-NNNN`).
2. Simulate the payment:
   ```bash
   node scripts/sim-webhook.js --ref VD-260806-XXXX
   ```
3. Watch `status.html?reference=VD-...` flip to **Delivered**.
4. Admin console at `/admin.html` (dev password `admin123`): top up float,
   watch the ledger, P&L and webhook audit.
5. Customer account: view saved data lines, saved MoMo numbers, recent delivery numbers,
   personalized time greeting ("Good morning, Kofi" / "Good afternoon, Kofi"),
   and order history.

Exercise the failure paths — each is a non-negotiable guarantee:

```bash
node scripts/sim-webhook.js --ref VD-... --duplicate       # idempotency no-op
node scripts/sim-webhook.js --ref VD-... --bad-signature   # 401, logged
node scripts/sim-webhook.js --ref VD-... --wrong-amount    # auto-refund
MOCK_FAIL_FIRST=1 npm run dev                              # delivery fails → retry via admin/cron
```

**Do not proceed until `npm test` is green (37/37) and you have seen all failure
paths behave as documented.**

---

## 2 · Supabase — the database (15 minutes)

1. Create a new project at [supabase.com](https://supabase.com) →
   **New project** (any region close to Ghana; note the DB password).
2. Open **SQL Editor** → paste the whole of
   [`app/supabase/schema.sql`](app/supabase/schema.sql) → **Run**.
   It is idempotent: tables (`networks`, `bundles`, `customers`, `saved_numbers`,
   `orders`, `float_ledger`, `webhook_log`), the advisory-locked `add_float_entry()`
   function, `current_float()`, `daily_pnl()`, the public `v_bundles` view, RLS policies
   and seed bundles (cost + sell prices) are all created in one go. If upgrading an existing
   database, running the script safely adds the new `customers` and `saved_numbers` tables.
3. Sanity-check RLS: the **anon** role may only read `networks` + `v_bundles`,
   insert a `pending` order and read its own order by reference. There is **no
   anon path to `cost_price`, float, customer data or webhooks**. The app talks to PostgREST
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
   - tenant API key → `VALMONTPAY_API_KEY` (`sk_valmontdata_...`)
   - webhook signing secret → `VALMONTPAY_WEBHOOK_SECRET`
   - gateway base URL → `VALMONTPAY_API_URL` (`https://valmontpay.app/api`)
2. Register the webhook URL in the gateway dashboard:
   ```
   https://<your-domain>/api/valmontpay/webhook
   ```
3. Confirm the contract matches [`app/lib/valmontpay.js`](app/lib/valmontpay.js):

   | Item | Expected |
   |---|---|
   | Checkout creation | `POST /api/transaction/initialize` with `Authorization: Bearer <VALMONTPAY_API_KEY>` and JSON body `{ amount, reference, email, phone, callback_url, currency: "GHS" }` (amount in GHS major units) → `{ data: { pay_url, checkout_url, access_code } }` |
   | Webhook event | `charge.success` with `{ event: "charge.success", data: { reference, status: "success", amount, currency, channel, gateway_reference, merchant } }` |
   | Signature | `x-valmontpay-signature` = hex HMAC-SHA512 of the **raw** body with `VALMONTPAY_WEBHOOK_SECRET` |
   | Refunds | Manual refund (automated refund endpoint not exposed on live gateway) |

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
   - `app/vercel.json` sets the cron schedule to daily `0 7 * * *` (07:00 UTC = 07:00 Ghana) for compatibility with Vercel Hobby accounts.
   - The optional GitHub Actions workflow (`.github/workflows/cron-retry.yml`) restores the 15-minute retry cadence for free: ping `$SITE_URL/api/cron/retry` automatically once `SITE_URL` is configured under GitHub **Settings → Secrets and variables → Actions → Variables**.
   - Pro Vercel accounts can instead change `0 7 * * *` back to `*/15 * * * *` in `vercel.json` if preferred.
4. Add **all** environment variables from [`app/.env.example`](app/.env.example):

   | Var | Value |
   |---|---|
   | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | from step 2 |
   | `VALMONTPAY_API_URL` / `VALMONTPAY_API_KEY` / `VALMONTPAY_WEBHOOK_SECRET` | from step 3 |
   | `SITE_URL` | `https://<your-domain>` |
   | `ADMIN_PASSWORD` | strong password for `/admin.html` |
   | `AUTH_SECRET` | long random string (session & customer auth tokens) |
   | `SUPPLIER_DRIVER` | `mock` until step 5, then `remadata` |
   | `REMADATA_API_KEY` | from step 5 |
   | `LOW_FLOAT_THRESHOLD` | e.g. `50` |
   | `NOTIFY_WEBHOOK_URL` | optional — WhatsApp/SMS alerts worker |

   Leave `SUPABASE_MOCK` **unset** in production (any value other than `1` is
   fine — `SUPABASE_MOCK=1` forces the in-memory DB and must never be deployed).
5. Deploy → connect the custom domain → update `SITE_URL` if the domain
   differs from the Vercel-assigned one.

---

## 5 · RemaData — the supplier (float!)

1. Create a free account at [remadata.com](https://remadata.com) → copy your
   API key → set `REMADATA_API_KEY` in Vercel environment variables.
2. Direct API integration: RemaData purchases are placed directly with
   `volumeInMB`, `networkType`, `phone`, and `ref` (no `plan_id` mapping required).
3. Fund your RemaData wallet — this **is your float**. Each successful delivery
   debits it at `cost_price`; the app tracks the same float in `float_ledger`
   so the storefront can refuse sales it cannot fulfil.
4. Set `SUPPLIER_DRIVER=remadata` (from `mock`) in Vercel and redeploy.
5. **Record the same top-up in the admin console** (`/admin.html` → Float →
   Top-up, per network). The admin float must mirror the supplier wallet, or
   the float guard cannot protect you.
6. **Sync Wholesale Prices in Admin**: In `/admin.html` → **Prices & Sync**,
   click **Sync prices from RemaData** to fetch live wholesale costs, review
   gross margins with auto-calculated recommendations (1.15× cost), and apply
   updates in one click.
7. Set `LOW_FLOAT_THRESHOLD` — the cron job alerts you (via
   `NOTIFY_WEBHOOK_URL`) when float drops below it. **Never run float dry.**

> **Fresh deploy showing everything "RESTOCKING"?** That's the float guard, not
> an empty shop. In the admin console (Float → **Seed initial float**) one
> click tops up every network that has GH₵0 balance (GH₵500 each by default,
> set `INITIAL_FLOAT` to change) — the whole storefront lights up. Safe to
> re-run; it never overwrites existing float.

> Buying and confirming wholesale price changes is a business task: when the
> supplier price moves, update `bundles.cost_price` (and `sell_price` to hold
> margin). `cost_price` is snapshotted per order, so old P&L rows never shift.

---

## 6 · Live smoke test (one real order)

Do this with a small bundle (1 GB) and your own number, before announcing:

1. Sign in or create a customer account on the live site → buy a bundle →
   you are redirected to the Valmont-Pay checkout.
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
| Order delivered but no supplier credit | Wrong API key or supplier wallet empty — see order's `supplier_response` |
| `delivery failed`, then delivered after admin retry | Supplier hiccup; cron would have retried within 15 min anyway (max 3 attempts) |
| Webhook logged "unknown order" | `reference` mismatch between checkout and order — log a reconciliation ticket with the supplier payload |
| P&L empty | `daily_pnl()` reads **completed** deliveries only — finish the smoke test first |

---

## 8 · Go-live checklist

- [ ] `npm test` green locally (40/40)
- [ ] `schema.sql` run in Supabase; RLS sanity-checked (customers & saved_numbers tables added)
- [ ] All env vars set in Vercel; `SUPABASE_MOCK` **not** set
- [ ] Valmont-Pay webhook registered + signature verified end-to-end
- [ ] `SUPPLIER_DRIVER=remadata` + `REMADATA_API_KEY` set
- [ ] Supplier float funded **and** mirrored in admin (per network)
- [ ] `LOW_FLOAT_THRESHOLD` + `NOTIFY_WEBHOOK_URL` set
- [ ] Live smoke test order delivered; P&L row present; data arrived
- [ ] `ADMIN_PASSWORD` + `AUTH_SECRET` are strong and unique
- [ ] No secrets anywhere in git history

---

© 2026 Valmont Group of Companies · Payments powered by Valmont-Pay

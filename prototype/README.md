# Valmont Data — Design Prototype

> **This folder is the interactive design prototype** (simulated payments/auth,
> localStorage). The **production build** (static + Supabase + Valmont-Pay)
> lives in [`../app/`](../app/). Prices and flows here are
> the design reference; the live app reads prices from the database.

# Valmont Data — Prototype & Full-Stack Blueprint

> **Ghana's cheapest data bundles — MTN · Telecel · AirtelTigo. Where resellers meet.**
> A subsidiary of Valmont Group of Companies, Accra, Ghana.

This folder contains a **fully interactive front-end prototype** of the Valmont Data
platform (inspired by platforms like DataMartGH) plus the **engineering blueprint**
for the production full-stack build.

**The prototype simulates everything the real app will do** — no backend required.
Open `index.html` in a browser (or `npx serve .`) and try:

1. **Buy as guest** — `buy.html`: pick a network tab, tap a bundle, enter a phone
   number, approve the simulated MoMo prompt → you get an order ID with a live
   tracking timeline that completes in ~90 seconds (demo fast-forward).
2. **Create an account** — `signup.html` (or Google / OTP). Members unlock
   *member prices* (~7% cheaper), the wallet and the dashboard.
3. **Deposit** — `deposit.html`: simulated MoMo prompt credits your wallet.
   Pay for bundles from wallet balance — no prompt per order.
4. **Dashboard** — `dashboard.html`: wallet balance, order history, transactions.
5. **Reseller store** — `store.html`: name your store, set a markup, watch the
   live storefront preview. In production each store gets `valmontdata.com/store/{slug}`.
6. **Airtime top-up** — `topup.html`: login-gated, paid from wallet.
7. **API docs** — `api-doc.html`: the exact REST contract planned for production.
8. **Track orders** — `track.html` with an order ID.
9. **Blog, tutorials, FAQ, about, contact, terms, privacy** — full page set.

Everything persists in `localStorage` (`vd_user`, `vd_orders`, `vd_stores`, `vd_txs`)
so a full session — sign up → deposit → buy → track → open store — can be replayed.

---

## 1 · Page Map

| Page | File | Production route |
|---|---|---|
| Landing | `index.html` | `/` |
| Buy bundles (guest, network tabs) | `buy.html` | `/buy` |
| MTN non-expiry bundles | `mtn.html` | `/mtn` |
| Telecel bundles | `telecel.html` | `/telecel` |
| AirtelTigo iShare | `airteltigo.html` | `/at-ishare` |
| Airtime top-up (login-gated) | `topup.html` | `/topup` |
| Wallet deposit | `deposit.html` | `/deposit` |
| Order tracking | `track.html` | `/order-status` |
| Sign in / Sign up / OTP | `signin.html` `signup.html` `otp-login.html` | `/signin` `/signup` `/otp-login` |
| User dashboard | `dashboard.html` | `/dashboard` |
| Reseller store builder | `store.html` | `/store/create` |
| Developer API docs | `api-doc.html` | `/api-doc` |
| Blog (+ 6 posts) | `blog.html`, `blog/*.html` | `/blog`, `/blog/[slug]` |
| Tutorials | `tutorials.html` | `/tutorials/...` |
| About / Contact / FAQ / Terms / Privacy | `about.html` `contact.html` `faq.html` `terms.html` `privacy.html` | same |

Design system: `assets/css/style.css` (Valmont navy + electric-green accent,
network brand colours for MTN / Telecel / AirtelTigo). Engine: `assets/js/data.js`
(prices) + `assets/js/app.js` (simulated auth, wallet, MoMo, orders, stores).

---

## 2 · Production Architecture (the repo you'll build)

### 2.1 Recommended stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | SSR pages, API routes, easy Vercel deploy |
| UI | Tailwind CSS v4 (or port this design system) | Fast iteration, dark theme first |
| Database | **PostgreSQL** (Supabase or Neon) | Relational integrity for wallets/ledgers |
| ORM / migrations | **Drizzle** or Prisma | Type-safe schema |
| Auth | NextAuth (Google) + phone OTP (**Termii** or **Twilio Verify**) | Mirrors prototype flows |
| Payments (MoMo) | **Paystack** (MTN MoMo, Telecel Cash, AT Money), fallback **Hubtel / ExpressPay** | Regulated, webhook-based |
| Queue | **Redis / Upstash + BullMQ** | Provider routing, retries, webhooks |
| SMS / WhatsApp | Termii or Twilio for SMS; WhatsApp Business Cloud API | Order confirmations & status |
| Hosting | Vercel (web) + **api.valmontdata.com** (same app, /api routes) | Zero-ops edge |

### 2.2 Database schema (core tables)

```sql
users        (id, name, email, phone, password_hash, tier[member|reseller|dealer|wholesaler],
              wallet_balance NUMERIC(12,2), store_id FK, created_at)
wallets      (id, user_id, balance, ledger_version — optimistic locking)
transactions (id, user_id, type[deposit|purchase|refund|withdrawal], amount, ref, meta, created_at)
orders       (id, user_id NULL, network, bundle_gb, price, recipient_phone,
              payment_method[momo|wallet], momo_ref, provider_id FK, status,
              idempotency_key UNIQUE, created_at, delivered_at)
order_events (id, order_id, status, ts)          -- feeds the tracker timeline
bundles      (id, network, gb, price_tiers JSONB {member, reseller, dealer, wholesaler}, expiry_policy, active)
providers    (id, network, priority, current_health JSONB)   -- speed/success/price scoring
api_keys     (id, user_id, key_hash, tier, scopes[], rate_limit, webhook_url, webhook_secret)
stores       (id, user_id, slug UNIQUE, name, tagline, markup_pct, created_at)
```

### 2.3 Order pipeline (the important part)

```
POST /api/orders (idempotency_key)
   → validate bundle + number + tier price
   → debit wallet or create MoMo charge (Paystack charge API)
   → on webhook payment.success → enqueue job {order, tier}
Worker:
   1. score providers (rolling speed + success rate + price)
   2. submit to winning provider's API
   3. on failure → retry next provider (max 3)
   4. verify via result checker; on total failure → status=failed
   5. auto-refund to wallet + emit order.refunded
Webhooks out (HMAC-signed): order.placed / order.delivered / order.failed
```

### 2.4 Key API endpoints (see `api-doc.html` for the full contract)

`POST /api/developer/verify` · `POST /api/developer/purchase` · `POST /api/developer/bulk`
· `GET /api/developer/order/:id` · `GET /api/developer/tracker/:id`
· `GET /api/developer/packages` · `GET /api/developer/balance`
· `POST /api/developer/withdraw` · `GET /api/developer/transactions`
· `POST /api/developer/webhooks` (register) · rate-limited per API key.

### 2.5 Hard-won rules to bake in (from real marketplaces)

- **Verify numbers before ordering**; never auto-retry the same number back-to-back.
- **Wrong numbers are not refundable** — say so before payment, show it in checkout.
- **Reject duplicate orders** for the same number in the same window.
- **Show delivery estimates before payment** (fast lane vs standard queue) — honesty sells.
- **Auto-refund failed orders** to the wallet; never make users chase refunds.
- **Private distribution policy** for resellers (no social-media advertising of the platform).
- Ledger every wallet change (never mutate balance without a `transactions` row) + idempotency keys on all payments.

### 2.6 Deployment

- Web + API on Vercel (one Next.js app), Postgres via Supabase/Neon, Redis via Upstash.
- Domain: `valmontdata.com` (+ `api.` subdomain), WhatsApp Business account for the channel.
- Phases: **(1)** guest MoMo checkout → **(2)** accounts + wallet → **(3)** reseller stores →
  **(4)** API + webhooks → **(5)** admin console + analytics.

---

## 3 · Local preview

```bash
npx serve .          # or: python3 -m http.server 8000
# open http://localhost:8000/prototype/ (or repo root → prototype/)
```

## 4 · Production starter code

The **runnable Next.js starter** implementing this blueprint lives in
[`../starter-nextjs/`](../valmont-data-app/) — schema, auth, Paystack MoMo,
orders pipeline, provider adapter, UI pages and an automated smoke test.
Copy it into your new repo and follow its README.

© 2026 Valmont Group of Companies. Prototype — all payments, auth and delivery are simulated.

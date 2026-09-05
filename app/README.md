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

**Auto-reload** (opt-in at `autoreload.html`): every delivered bundle is tracked in
`bundle_usage`; a cron (`/api/cron/autoreload`) watches each opted-in line and,
when the bundle drops below the user's chosen threshold (or expires), creates a
normal order and charges the pre-authorized MoMo via Valmont-Pay's *direct
charge* — the resulting `charge.success` webhook flows through the exact same
pipeline above (claim → float check → delivery), so idempotency and audit
guarantees hold for automatic top-ups too.

The **webhook handler is the heart of the system** (`api/valmontpay/webhook.js`). It was built and tested first, before any UI.

---

## What's here

| Path | Purpose |
|---|---|
| `index.html` | Storefront — network tabs, bundle grid, customer accounts, saved numbers, time-based greeting, confirm-before-pay, auto-reload opt-in checkbox, SMS opt-in popup (10s) |
| `sitemap.xml` | Search engine sitemap — **43 canonical URLs** (every generated landing page plus the public pages). Rebuilt by `npm run seo:generate`; each `<loc>` is byte-identical to that page's own canonical, and `noindex` pages are excluded |
| `robots.txt` | Crawler rules — allows all public pages, blocks only `/api/` and `/r/` (referral campaign URLs). Pages we don't want indexed stay **crawlable** so Google can read their `noindex` (blocking them is what produces "Indexed, though blocked by robots.txt") |
| `bundles/` | **Generated SEO landing pages** — `/bundles/` hub, `/bundles/{mtn,telecel,airteltigo}.html`, 24 product pages (`/bundles/mtn/10gb.html`), `/bundles/{cheap,big,rollover}.html`. Do not edit; run `npm run seo:generate` |
| `auto-top-up.html` · `buy-data-on-whatsapp.html` · `network-prefixes.html` | Generated service/utility landing pages (same generator, same guarantees) |
| `lib/keywords.js` | **The vocabulary module** — isomorphic (Node + browser `window.ValmontKeywords`): `SITE`, `LOCATIONS`, `SITE_TERMS`, 17 `CATEGORIES` with 382 terms/phrases each mapped to a real page, `WEIGHTS`, `expandQuery`, `matchCategories`, `detectNetwork`, `sizeFromText`, `scoreItem`, `searchCatalogue`, `metaKeywords`, `alsoSearchedAs`. One source of truth for keywords meta, visible copy, on-site search, ValmontAI and the WhatsApp bot |
| `assets/js/catalogue-search.js` | On-site catalogue search — synonym expansion as a **graded score boost** (exact matches still win), never a hard filter; unmatched queries fall back to the full catalogue plus page hints instead of an empty state |
| `assets/css/seo.css` | Styles for the generated pages' SEO blocks (`.seo-aka` synonym rows, `.seo-faq`, `.seo-links`, `.seo-table`, `.seo-picked` deep-link highlight) and the reviews block (`.rv-*`: summary, histogram, review cards, verified-buyer mark, review form) |
| `scripts/generate-seo-pages.js` | **Static SEO generator** (zero dependencies): builds the 34 pages from `lib/demo-data.js` or `GET /api/bundles`, injects the homepage price list + `<head>`, generates `faq.html`/`store.html` FAQPage schema from their visible Q&A, rebuilds `sitemap.xml`. `--api[=url]`, `--check`, `--list`, `--quiet` |
| `scripts/test-seo.js` | SEO verification suite (96 file checks + optional live HTTP checks): sitemap↔canonical parity, one H1, title/description lengths, JSON-LD parses and matches visible copy, no fabricated ratings/stock, links resolve, every vocabulary term has a destination, prices present in raw HTML, robots.txt consistency |
| `status.html` | Public order tracking by reference (no login) |
| `dashboard.html` | Signed-in dashboard — quick actions + **"My bundles & auto-reload"** summary card (live usage bars per line) |
| `autoreload.html` | **The opt-in place** — per-line usage tracking, active rules (pause/resume/remove), and the consent form (line, bundle, threshold, pre-authorized MoMo) |
| `admin.html` | Admin console — float, orders + retry, P&L, SMS leads export (1-click copy), webhook audit |
| `api/valmontpay/webhook.js` | ⚠️ Payment webhook: signature verify → idempotent claim → float guard → delivery |
| `api/whatsapp/webhook.js` | 📱 WhatsApp ordering bot: Meta Cloud API webhook → conversation engine → orders |
| `api/orders.js` | Create order (compulsory customer token, float guard #1, Valmont-Pay checkout) + public status |
| `api/auth/customer.js` | Customer signup, login (scrypt password/PIN hash, 30-day HMAC token) **and OTP send/verify** (merged to stay under Vercel Hobby's 12-function cap) |
| `api/account.js` | Customer profile, time greeting ("Good morning, Kofi"), saved data/MoMo numbers (10/kind cap), order history, `POST /optin` (public SMS marketing opt-in), **plus referrals, reseller store and product reviews** (same public URLs, one function) |
| `api/autoreload.js` | Auto-reload API (customer token): `GET` (lines + usage + rules + catalogue), `POST` (opt-in / update / pause-resume toggle), `DELETE` (opt-out) — explicit consent required |
| `api/usage.js` | **Usage reports** — how the web "tracks" the bundle: `POST` `{action:"report", reference|phone, used_mb}` updates a delivered bundle's `used_mb`; returns `low` + `should_ask` flags; `GET ?phone=&reference=` reads state. Auth: admin token or `x-usage-key: USAGE_REPORT_KEY` (supplier/telco pipeline) |
| `api/bundles.js` | Public catalogue with server-side availability (never cost_price) |
| `lib/reviews.js` | **Verified-purchase review engine** — resolves `(network, size_mb)` to a bundle, confirms a *delivered* order for that bundle by that customer before any write, upserts one review per customer per bundle, scrubs phone numbers, computes the aggregate (count / average / histogram) from published rows only, hides on moderation instead of deleting |
| `assets/js/reviews.js` | Reviews widget for the 24 product pages — renders the live list + summary, shows the write/edit/retract form only to a customer the API confirms can review (and says why not, to everyone else), and injects `aggregateRating`/`review[]` into the page's existing `Product` JSON-LD **only when real reviews exist**, from the same response it rendered |
| `scripts/test-reviews.js` | Reviews suite (162 checks) — boots its own clean dev server on `:8799`, walks guest → signed-in → pending order → delivered order → review → edit → retract → moderate, then checks the static honesty contract on all 24 product pages and runs the widget in a DOM stub. `npm run test:reviews` |
| `api/sitemap.js` | **Dynamic sitemap** for reseller storefronts — served as `/sitemap-stores.xml` (rewrite in `vercel.json`). Stores are created by customers at runtime, so no build step can list them; publishes only slugs + `lastmod`, never names/owners/earnings. 11th function of Vercel Hobby's 12 |
| `api/admin/*` | Login, float (+top-up), orders (+retry), P&L, SMS leads (`GET /sms-leads`), webhook log |
| `api/cron.js` | Unified cron (one function): `GET /api/cron/retry` retries failed deliveries (max 3) + low-float alert; `GET /api/cron/autoreload` sweeps opted-in lines and re-buys low/expired bundles via the normal webhook pipeline. Daily Vercel crons (07:00 / 07:30 UTC). Dev/demo: `curl /api/cron/autoreload` |
| `lib/` | `supabase.js` (data layer + mock), `valmontpay.js` (client + HMAC-SHA512, incl. `initiateCharge` direct MoMo charge), `supplier.js` (adapter), `orders.js` (engine — creates `bundle_usage` on delivery), `autoreload.js` (engine — thresholds, cooldown, in-flight guard, dev webhook simulation), `whatsapp.js` (WhatsApp Cloud API client), `whatsapp-bot.js` (conversation engine), `referrals.js` (referral codes + credits), `sms.js` (SMS providers: Arkesel/mNotify/Hubtel), `phones.js`, `notify.js` (+ SMS on delivery), `auth.js` |
| `supabase/schema.sql` | Tables (`customers`, `saved_numbers`, `sms_leads`, `orders`, `bundle_usage`, `auto_reload`, `float_ledger`, etc.), RLS, functions, seeds — run once in Supabase |
| `supabase/seed-demo.sql` | **Demo seed** for DEMO/STAGING Supabase — customers, orders, bundle usage, auto-reload rules, float, webhook log (generated, self-skipping) |
| `supabase/migrations/` | **Live-DB changes** (price/lineup updates, `2026-09-04_product_reviews.sql`, etc.) — idempotent SQL, run in the Supabase SQL editor in date order; the base seed's `on conflict do nothing` never updates existing rows |
| `scripts/dev-server.js` | Zero-dependency local server (mock DB) |
| `scripts/seed-demo.js` | Demo data: seed the mock DB (`SEED_DEMO=1`), verify consistency, or regenerate `supabase/seed-demo.sql` |
| `scripts/sim-webhook.js` | Sign + send a fake payment webhook to test delivery |
| `scripts/sim-usage.js` | Simulate usage reports (`--ref VD-... --used-mb N` or `--percent N`, or `--phone ...`) — dev stand-in for the telco/supplier usage feed |
| `scripts/test-valmontai.js` | ValmontAI brain tests (27 checks — every prompt rule + live-stock branches); `node scripts/test-valmontai.js` |
| `assets/js/valmontai.js` | **ValmontAI assistant** — self-injecting chat widget + rule-based brain (greeting, how-to-buy, delivery, wrong-number, track order, install, payments, support). Stock answers read live from `GET /api/bundles` (60s cache); the config notice is only a fallback. Loaded on every customer page; excluded from `admin.html` |
| `assets/css/valmontai.css` | ValmontAI widget styles (`.vai-*`, house navy/orange palette, mobile full-screen panel) |
| `valmontai-data-config.json` | ValmontAI business info (WhatsApp, products, delivery promise, stock notice, wrong-number warning) — fetched at runtime with hardcoded fallbacks |
| `assets/img/valmont-data-logo.png` | **Official brand banner** — dot-matrix globe badge (orange-gold gradient ring and dots on navy) + "VALMONT DATA" wordmark (VALMONT white · DATA orange); header/nav logo |
| `assets/img/valmont-data-favicon.png` | **Official brand icon** — orange-gold dot-matrix globe; used for all favicon/apple-touch-icon links and manifest.json icons |

## Non-negotiable requirements — how each is enforced

1. **Idempotency** — `orders.provider_reference` has a `UNIQUE` constraint **and** the webhook claims it via `UPDATE ... WHERE provider_reference IS NULL`. Duplicate or concurrent webhooks can never deliver twice. (Test: `sim-webhook.js --duplicate`.)
2. **Signature verification** — `x-valmontpay-signature` = HMAC-SHA512 of the raw body with the tenant secret; invalid → 401 + logged. Delivery never happens on a browser callback.
3. **Float guard** — checked in `api/orders` *before* the checkout is created (bundle auto-disabled in UI when float is short) **and** re-checked in the webhook before delivery; the race case auto-refunds.
4. **Server-side only** — only the verified webhook triggers `supplier.submit()`.
5. **Customer accounts & saved numbers** — customer token required to place orders; passwords/PINs scrypt-hashed; server-side ownership enforcement; personalized time greetings attached to first name.
6. **Audit trail** — every callback lands in `webhook_log` (signature_valid, payload, handled, error); every order stores `provider_reference`, `supplier_ref`, `supplier_response` (full supplier reply), `attempts`, timestamps.

---

## Multi-supplier routing and outage protection

Production can route through Typhonic and RemaData in priority order:

```env
SUPPLIER_ORDER=typhonic,remadata
```

`lib/supplier.js` provides one normalized contract for both suppliers. The
router checks configuration, observes a per-instance circuit breaker, records
every routing decision in `orders.supplier_response`, and automatically tries
the next supplier only after a **definitive rejection** (for example, an
explicit failed/refunded response or a 4xx validation error).

A timeout, connection reset, HTTP 5xx, or accepted/pending response is treated
as **unresolved**. Failover is paused and the order remains `delivering`, because
the first supplier may still complete it; submitting to a backup at that point
could send the customer two bundles. Cron/admin retries also respect this
duplicate guard. The admin wallet view shows every configured supplier and
`GET /api/admin/suppliers` exposes priority/configuration/circuit state.

Typhonic's endpoint contract is available only after agent approval, so its URL,
paths, auth header and request field names are environment-configurable. Copy
them exactly from the agent documentation into the `TYPHONIC_*` variables in
`.env.example`; the driver remains disabled until the purchase path is set.
Never paste an API key or webhook secret into source control or screenshots.

---

## Auto-reload — how it works

**The opt-in place** is `autoreload.html` (linked from the dashboard and the
account panel, and offered as a checkbox in the buy flow). There the customer:

1. sees each of their data lines with **live usage** (progress bar, % used,
   remaining MB, expiry) tracked from `bundle_usage`;
2. if a line is low with no rule, sees the **ask prompt** ("your bundle is 92%
   used — turn on Auto-reload?"), the same `should_ask` flag the usage API
   returns for an SMS/WhatsApp automation;
3. opts in with an explicit consent tick: which line, which bundle to re-buy,
   how much data must be *left* before reloading (`trigger_percent` 1–50),
   and which **MoMo number is pre-authorized to be charged**;
4. can pause / resume / remove the rule anytime.

**The others rule** — topping up someone else's line (your girlfriend, family,
a shop line) is a first-class feature, and it is always explicit so it can
never be confused with topping yourself up:

- Every rule stores `relation`: `self` (the line is the customer's own number)
  or `other` (a line they top up for someone else). Such lines are labelled
  **"📤 others"** in the UI.
- The **buy-flow checkbox offers auto-reload for your own line AND auto top-up
  for the other person's number** — the label always names the recipient:
  *"Auto top-up 055… (others) — when their data runs low, we top them up from
  your MoMo. The data goes to 055…, not to you."* The checkbox itself carries
  the recipient confirmation (`confirm_recipient` is sent with the opt-in).
- **Others lines are tracked too** — the Auto-reload page shows live usage for
  every line you top up, and when one is low with no rule it shows the
  *"track & auto top-up others"* prompt, so you never miss when their data
  runs out. (The `should_ask` flag on the usage API stays own-line only.)
- Opting in for an `other` line on the Auto-reload page requires an extra
  **recipient confirmation** ("I understand the data goes to 055…, not to me")
  — enforced server-side (`confirm_recipient`), and rule cards / dashboards
  label such lines "📤 others".

**How charging works (MoMo PIN)** — an automatic top-up *initiates* a
Valmont-Pay direct charge against the saved MoMo number; it does **not**
silently debit the wallet. Ghana's mobile-money wallets require the wallet
owner to approve every debit with their PIN (USSD/app prompt), so the
customer's phone gets a **MoMo prompt** and the data only delivers after they
approve — the gateway's signed `charge.success` webhook then flows through the
normal idempotent pipeline. Ignore or reject the prompt → nothing is charged,
nothing is delivered. (If the Valmont-Pay tenant enables an operator
merchant-initiated/standing-mandate product — e.g. MTN's auto-renewal — debits
can become fully automatic after the first approval; that is a gateway/operator
setup decision. The site's contract never assumes it: `initiateCharge`
returns `status: "authorization_pending"` + `awaiting_pin` until the webhook
confirms.)

**The engine** (`lib/autoreload.js`, swept by `api/cron.js` every
15 minutes) is conservative by design:

- **Cooldown** — after a reload fires, no new reload for `AUTORELOAD_COOLDOWN_MINUTES` (default 720 = 12h), so a stale usage report can never drain the customer's MoMo.
- **No stacking** — if the line already has a pending/paid/delivering order, the sweep skips it.
- **Float guard** — an order is only created if we can deliver it (the webhook re-checks float and auto-refunds the race case, same as manual orders).
- **Full payment pipeline** — the reload is a *normal* order; Valmont-Pay's direct-charge endpoint (`initiateCharge`) charges the saved MoMo, and the signed `charge.success` webhook flows through the same idempotent claim → delivery path. In dev (no gateway configured) the engine simulates that webhook locally — same code path, so tests cover it exactly.
- **Audited** — opt-ins emit `autoreload.optin` notify events; reload orders carry `auto_reload_id`; `reload_count` / `last_reload_at` are bumped only when the reload actually delivers.

**Tracking the bundle** — real usage would come from the telco/supplier
integration posting to `POST /api/usage` (admin token or `USAGE_REPORT_KEY`).
For dev/demo, `scripts/sim-usage.js` does it:

```bash
node scripts/sim-usage.js --ref VD-260806-4831 --percent 92   # line is now 92% used
curl http://localhost:8787/api/cron/autoreload                # sweep → auto top-up fires
```

Watch `status.html?reference=<new ref>` flip to **Delivered** and the rule's
`reload_count` increment. The fresh bundle is then tracked from 0% again.

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
5. **Try Auto-reload**: open `autoreload.html` → order a bundle for a line, drain it with `scripts/sim-usage.js --ref VD-... --percent 92`, opt in (line, bundle, 10% left, your saved MoMo, consent tick), then `curl /api/cron/autoreload` → watch the engine re-buy the bundle and deliver it.
6. Admin (`admin.html`, password `admin123`): top up float → see balances/ledger/P&L/orders.

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
- **Bundle usage rows** for every delivered order (some delivered to the demo
  customers' own lines) + **3 auto-reload rules**: Ama's rule is live on her
  **own line** with a bundle at 97% and cooldown already over → hitting
  `/api/cron/autoreload` fires it instantly; Kofi's rule (his **shop line**,
  relation `other`) is inside its cooldown (sweep skips it); Yaw's rule is
  paused.
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

1. **Supabase**: create project → SQL editor → paste `supabase/schema.sql` → run. (Tables + RLS + functions + seeds. Idempotent; adds `customers`, `saved_numbers`, `bundle_usage`, `auto_reload` and the rest.) An **existing** project only needs the newer files in `supabase/migrations/` — run them in date order; every one is idempotent. The most recent is `2026-09-04_product_reviews.sql` (verified-purchase reviews).
2. **Vercel**: import this repo, set **Root Directory = `app`** → add env vars from `.env.example` → deploy. (`vercel.json` wires two **daily** crons — `0 7 * * *` retry and `30 7 * * *` auto-reload — Vercel Hobby allows only one run per day.) For a more responsive auto-reload sweep (e.g. every 15 min), upgrade to Pro, or add a GitHub Actions workflow that pings `$SITE_URL/api/cron/autoreload` on a schedule (set `SITE_URL` under Settings → Secrets and variables → Actions → Variables).
3. **Valmont-Pay**: request tenant #3 onboarding → set `VALMONTPAY_API_URL/API_KEY/WEBHOOK_SECRET` → register webhook URL `https://<your-domain>/api/valmontpay/webhook` in the gateway dashboard. For auto-reload to charge saved MoMos live, ask the gateway team to enable the **direct charge** (`POST /transaction/charge`, method `momo`, type `direct`) permission for tenant #3.
4. **Go live**: set `VALMONTPAY_MODE=live` (see `.env.example`). In live mode there is **no dev fallback**: missing gateway credentials fail loudly (503) on checkout and auto-reload charges — payments are never simulated in production. (Local dev uses `VALMONTPAY_MODE=dev` + `AUTORELOAD_SIMULATE=1`, set by `scripts/dev-server.js`.)
4. **Supplier**: see `GET-STARTED.md` at repo root — create a RemaData account, set `SUPPLIER_DRIVER=remadata` and `REMADATA_API_KEY`. Wholesale costs can be synced directly via `/admin.html` → Prices & Sync.

---

## WhatsApp Ordering

Customers can buy data bundles by chatting on WhatsApp — no browser needed.

**Setup:**
1. Create a WhatsApp Business app at [developers.facebook.com](https://developers.facebook.com)
2. Get a permanent System User token (never expires)
3. Set `WHATSAPP_MODE=live`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`
4. Set the webhook URL to `https://<your-domain>/api/whatsapp/webhook`
5. Set `WHATSAPP_VERIFY_TOKEN` (must match both sides)

**Conversation flows:**
- **Menu**: Customer sends "hi" → bot shows Buy Data / Track Order / Help buttons
- **Guided**: Tap Buy Data → pick network → pick bundle → enter phone → confirm → pay
- **Quick order**: Type "2gb mtn 0241234567" → bot parses it → confirm → pay
- **Tracking**: Type "track VD-260812-1234" → bot shows order status

**Integration:** WhatsApp orders create real orders through the same pipeline — same float guard, same payment webhook, same delivery, same idempotency. In dev mode (`WHATSAPP_MODE=mock`), messages log to console.

**Test it locally:**
```bash
curl -X POST http://localhost:8787/api/whatsapp/webhook \
  -H "Content-Type: application/json" \
  -d '{"entry":[{"changes":[{"field":"messages","value":{"messages":[{"from":"233241112222","type":"text","text":{"body":"hi"}}]}}]}]}'
```

---

## Referral Program

Customers earn GH₵2 credit when their friends make their first purchase.

**Flow:**
1. Each customer gets a unique referral code (e.g., `KOFI-A3X2`) — auto-generated on first access
2. Share link: `valmontdata.com/r/KOFI-A3X2`
3. New customer signs up with the code → referral tracked
4. First purchase by referred customer → both parties earn GH₵2 credit
5. Credits auto-apply to future orders (discount at checkout)

**API endpoints:**
- `GET /api/referrals` — customer's referral stats (code, credits, referral count)
- `GET /api/referrals/credits` — credit balance + history
- `POST /api/referrals/claim` — claim a referral code
- `GET /api/referrals/verify?code=XXX` — public: verify a code exists

**Configuration:**
- `REFERRAL_CREDIT_AMOUNT` — GHS per successful referral (default 2.00)
- `REFERRAL_MAX_CREDIT` — max GHS a customer can hold (default 50.00)

**Safeguards:** Self-referral blocked, one referrer per customer, credit cap prevents abuse.

---

## SMS Notifications

Transactional SMS (delivery confirmations, refunds) sent automatically to customers.

**Providers (Ghana-based):**
- **Arkesel** — `sms.arkesel.com` (cheapest)
- **mNotify** — `mnotify.com`
- **Hubtel** — `hubtel.com`
- **Mock** — log to console (default in dev)

**Configuration:**
```bash
SMS_PROVIDER=arkesel      # or mnotify | hubtel | mock
SMS_API_KEY=your-key
SMS_SENDER_ID=ValmontData  # max 11 chars
```

**Automatic triggers:**
- Order delivered → "✅ Your 5GB MTN bundle has been delivered to 0241234567. Ref: VD-..."
- Order refunded → "↩️ Order VD-... refunded. Your MoMo has been credited back."

SMS is wired into the existing `notify.js` system — fires in parallel with webhooks, never blocks the order pipeline. In mock mode (default), messages log to console.

---

## Reviews — verified purchases only

The 24 product pages (`/bundles/<network>/<size>.html`) carry a reviews block. It is deliberately
the one part of those pages that needs JavaScript: a rating is a claim about the present, and a
static file cannot make one honestly.

**The rule:** a review can only be written by a signed-in customer with a **delivered order for that
exact bundle** (network *and* size). No delivered order, no form — the page says why instead.
Everything else follows from that:

| Rule | Where it is enforced |
| --- | --- |
| Verified purchase required (delivered order for that bundle) | `lib/reviews.js` → `findVerifiedOrder`; `product_reviews.order_id` records which one |
| One review per customer per bundle — posting again edits it | `unique (bundle_id, customer_id)` + upsert in `upsertReview` |
| Rating is a whole number 1–5; title ≤80 chars; body ≤600 | `check` constraints in SQL and the same limits in `lib/reviews.js` |
| "Verified buyer" next to every review, first name only | `listForBundle` returns `author` (first name) and `verified: true`; no phone/email leaves the API |
| A phone number typed into a review is not published | scrubbed at write time (`[number removed]`) — reviews are public and indexed |
| Moderation hides, it never deletes | `status = 'removed'`; the row and the order behind it stay for audit |
| Aggregates are computed, not stored | `summary` (count / average / histogram) is derived from the published rows in the same response as the list |

**API** — folded into `api/account.js` as `?section=reviews` (11 serverless functions of Vercel
Hobby's 12; `vercel.json` rewrites the public paths):

```
GET    /api/reviews?network=mtn&size_mb=10240   public list + summary (+ a `you` block with a customer token)
POST   /api/reviews                             customer token — create or edit your review of a delivered bundle
DELETE /api/reviews?id=123                       admin (any review) or the author (their own)
```

**Ratings in structured data:** `assets/js/reviews.js` renders the list *and* adds `aggregateRating`
+ `review[]` to the `Product` node already in the page — from that same response, only when
`summary.count > 0`, and it removes them again if the count drops to zero. So the schema can never
claim a star, a count or a review the reader cannot see, and a bundle nobody has reviewed shows no
stars at all. `scripts/test-seo.js` fails the build if a rating is ever baked into static HTML.

**Database:** run `supabase/migrations/2026-09-04_product_reviews.sql` in the Supabase SQL editor
(idempotent). A brand-new project gets the table from `supabase/schema.sql` instead. Until the
migration has run, `GET /api/reviews` returns an error and the pages simply show no reviews — they
never fall back to invented ones.

**Demo data contains no reviews on purpose.** `npm run seed:demo` writes `supabase/seed-demo.sql`,
which is meant to be runnable against a real project; seeding it with fake reviews would put fake
reviews in production. To see the widget populated locally: `npm run dev:demo`, sign in as a demo
customer (the seed prints their phones and PINs), and open a product page for a bundle that customer
has had delivered — `/api/account/history` shows which those are. Customers who have not received
that bundle see the reason, which is the feature working.

```bash
npm run test:reviews   # 162 checks — boots its own clean server on :8799 (REVIEWS_TEST_PORT to move it)
```

**Moderation today is an API call, not a screen:** `admin.html` has no reviews tab yet, so hiding a
review means `curl -X DELETE "$SITE/api/reviews?id=<id>" -H "Authorization: Bearer <admin token>"`
(the id is in the `GET /api/reviews` response). The row is only ever marked `removed` — never
deleted — so the review, its author and the order that verified it stay on file. A reviews tab in
the admin console is the obvious next step; it needs one more read (`?section=reviews&sub=all`,
admin-only) and nothing else.

## SEO — what a crawler can see

The catalogue used to exist only as JavaScript state behind `/?net=…&size=…` filters: 9 indexable
URLs, no page for "mtn data", "10gb" or "non expiry", no structured data, no Open Graph.
`SEO-AUDIT.md` (repo root) has the full before/after; the short version:

- **34 generated landing pages** (`/bundles/…` + 3 service pages), each with one `<h1>`, a
  self-canonical, an intent-led title ≤62 chars, a description built from live counts and prices,
  a visible "Also searched as:" synonym row, 600–1200 words of copy, a real price table, a visible
  FAQ mirrored as `FAQPage`, `BreadcrumbList` + `CollectionPage`/`ItemList`/`Product`, and cross-links.
- **`sitemap.xml` 9 → 43 URLs**, byte-identical to the canonicals, `noindex` pages excluded.
- **`lib/keywords.js`** is the single vocabulary: keywords meta, visible copy, on-site search,
  ValmontAI and the WhatsApp bot all read the same 17 categories / 382 terms.
- **Honesty rules the generator enforces:** no fabricated prices, stock, ratings, reviews or FAQ
  answers; no `availability` in `Product` schema (float is operational, not a catalogue fact); no
  city pages and no separate "non-expiry" page (both would be duplicates/doorways); no fake "was" prices.
  Ratings are the exception that proves the rule: they exist, but only as **live verified-purchase
  reviews** injected at runtime — see *Reviews* above. The generator emits the mount point and the
  policy sentence, never a number.

```bash
npm run seo:generate        # rebuild pages + sitemap from lib/demo-data.js
npm run seo:generate:live   # …or from GET /api/bundles (add --api=http://host:port)
npm run seo:check           # fail if a published price/page no longer matches the catalogue
npm run test:seo            # 96 checks; add -- --base=http://localhost:8787 for live HTTP checks
```

**Why a script and not a build step:** the project's zero-build rule stands. The generator has no
dependencies and writes committed static HTML, so Vercel still deploys plain files — nothing runs at
request time and no toolchain is introduced.

**When the catalogue changes:** see **`CHANGE-A-PRICE.md`** (repo root) — and you don't need to
remember it. The `pages-in-sync` workflow (committed at `ci/seo.yml`; activate it with the `git mv` in
`ci/README.md`) regenerates the pages on every PR and **fails the build** if
the committed HTML is stale; a weekly job compares the *published* pages with the *live* catalogue and
opens an issue if they disagree (that catches a price edited straight into Supabase with no commit).

Do **not** add `seo:generate:live` to the Vercel build command — no API runs at build time, `--api`
defaults to `http://localhost:8787`, and an unreachable `--api` fails hard by design, so it would
break every deploy. The generator also honours `SEO_DATE=YYYY-MM-DD`, which is how CI regenerates
deterministically (otherwise the stamped date would differ every day and every diff would be noise).

## Tested

`scripts/test.sh` runs the full 104-check pipeline against the dev server (mock DB):
float guard (reject when 0 float, guest 401) → admin login/float top-up →
customer signup (scrypt hash, 30-day token) → duplicate 409 → wrong credentials 401 →
customer login → account gating 401 → authed 0-float 422 → order creation →
webhook delivery → delivered → ledger debit → duplicate webhook no-op →
bad signature 401 → wrong amount refund → phone validation → fail-first retry →
recent numbers → save/delete numbers → order history → personalized time greeting →
admin float/orders/retry/P&L → static pages →
**auto-reload**: delivered bundle tracked (0%) → usage report 88% → `low`/`should_ask`
flags → opt-in guards (no consent 400, wrong-network bundle 400, re-opt-in updates) →
cron triggers → auto-reload delivered via the real webhook pipeline → `reload_count`
bumped → line usage reset → cooldown blocks a second sweep → pause stops sweeps →
opt-out removes the rule → auth guards 401 →
**others lines**: relation `other`, never auto-asked, watch prompt when low, `confirm_recipient` required (400 without) →
**live mode**: checkout + direct charge fail loudly (503) with no gateway keys →
**WhatsApp**: webhook verification (GET challenge) → wrong verify token 403 → inbound text/button messages accepted → quick orders → track orders → help/cancel commands →
**Referrals**: code generation → verification → signup with referral code → self-referral blocked → credit balance → auth guards →
**SMS**: mock mode → template rendering → provider config.

Run it with `npm test` (after starting `npm run dev`).

`npm test` runs **all five** suites through `scripts/run-tests.js` and prints a summary:
`test.sh` (end-to-end API pipeline), `test-supplier-router.js` (multi-supplier failover),
`test-valmontai.js` (27 assistant checks), `test-seo.js` (96 SEO checks) and `test-reviews.js`
(162 checks: the review API end to end against a clean server it boots itself on `:8799`, plus the
static honesty contract — every product page has a mount for its own bundle, no page bakes a rating
into its schema, and the widget only injects one when the API returns reviews). It used to chain them
with `&&`, so the API suite's pre-existing float failures stopped the other three from ever running —
the runner fixes that, and judges `test.sh` against a pass-count baseline (152) instead of zero
failures. `npm run test:api` runs the API pipeline on its own.

`test.sh` needs **`SEED_DEMO=1`** (`npm run dev:demo`) — without the demo seed, orders/history/float
state is missing and ~84 checks fail. Six checks still fail on a seeded database by design: five
assume an *unseeded* float of GH₵200 (the seed starts around GH₵3,300) and one is
`paused rule not swept`. All six fail identically on the pristine `eb0bc71` tree, so they are
environmental, not regressions. `scripts/sim-webhook.js` defaults to `:8787`, so run the suite
against a server on that port (and start it fresh — a second run inherits the first run's orders
and float).

© 2026 Valmont Group of Companies.

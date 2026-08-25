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
| `sitemap.xml` | Search engine sitemap — the 9 public pages (canonical URLs, `https://valmontdata.com`) |
| `robots.txt` | Crawler rules — allows public pages, blocks `/api/`, admin/auth-gated pages; points to the sitemap |
| `status.html` | Public order tracking by reference (no login) |
| `dashboard.html` | Signed-in dashboard — quick actions + **"My bundles & auto-reload"** summary card (live usage bars per line) |
| `autoreload.html` | **The opt-in place** — per-line usage tracking, active rules (pause/resume/remove), and the consent form (line, bundle, threshold, pre-authorized MoMo) |
| `admin.html` | Admin console — float, orders + retry, P&L, SMS leads export (1-click copy), webhook audit |
| `api/valmontpay/webhook.js` | ⚠️ Payment webhook: signature verify → idempotent claim → float guard → delivery |
| `api/whatsapp/webhook.js` | 📱 WhatsApp ordering bot: Meta Cloud API webhook → conversation engine → orders |
| `api/orders.js` | Create order (compulsory customer token, float guard #1, Valmont-Pay checkout) + public status |
| `api/auth/customer.js` | Customer signup, login (scrypt password/PIN hash, 30-day HMAC token) **and OTP send/verify** (merged to stay under Vercel Hobby's 12-function cap) |
| `api/account.js` | Customer profile, time greeting ("Good morning, Kofi"), saved data/MoMo numbers (10/kind cap), order history, `POST /optin` (public SMS marketing opt-in), **plus referrals and reseller store** (same public URLs, one function) |
| `api/autoreload.js` | Auto-reload API (customer token): `GET` (lines + usage + rules + catalogue), `POST` (opt-in / update / pause-resume toggle), `DELETE` (opt-out) — explicit consent required |
| `api/usage.js` | **Usage reports** — how the web "tracks" the bundle: `POST` `{action:"report", reference|phone, used_mb}` updates a delivered bundle's `used_mb`; returns `low` + `should_ask` flags; `GET ?phone=&reference=` reads state. Auth: admin token or `x-usage-key: USAGE_REPORT_KEY` (supplier/telco pipeline) |
| `api/bundles.js` | Public catalogue with server-side availability (never cost_price) |
| `api/admin/*` | Login, float (+top-up), orders (+retry), P&L, SMS leads (`GET /sms-leads`), webhook log |
| `api/cron.js` | Unified cron (one function): `GET /api/cron/retry` retries failed deliveries (max 3) + low-float alert; `GET /api/cron/autoreload` sweeps opted-in lines and re-buys low/expired bundles via the normal webhook pipeline. Daily Vercel crons (07:00 / 07:30 UTC). Dev/demo: `curl /api/cron/autoreload` |
| `lib/` | `supabase.js` (data layer + mock), `valmontpay.js` (client + HMAC-SHA512, incl. `initiateCharge` direct MoMo charge), `supplier.js` (adapter), `orders.js` (engine — creates `bundle_usage` on delivery), `autoreload.js` (engine — thresholds, cooldown, in-flight guard, dev webhook simulation), `whatsapp.js` (WhatsApp Cloud API client), `whatsapp-bot.js` (conversation engine), `referrals.js` (referral codes + credits), `sms.js` (SMS providers: Arkesel/mNotify/Hubtel), `phones.js`, `notify.js` (+ SMS on delivery), `auth.js` |
| `supabase/schema.sql` | Tables (`customers`, `saved_numbers`, `sms_leads`, `orders`, `bundle_usage`, `auto_reload`, `float_ledger`, etc.), RLS, functions, seeds — run once in Supabase |
| `supabase/seed-demo.sql` | **Demo seed** for DEMO/STAGING Supabase — customers, orders, bundle usage, auto-reload rules, float, webhook log (generated, self-skipping) |
| `supabase/migrations/` | **Live-DB changes** (price/lineup updates etc.) — idempotent SQL, run in the Supabase SQL editor; the base seed's `on conflict do nothing` never updates existing rows |
| `scripts/dev-server.js` | Zero-dependency local server (mock DB) |
| `scripts/seed-demo.js` | Demo data: seed the mock DB (`SEED_DEMO=1`), verify consistency, or regenerate `supabase/seed-demo.sql` |
| `scripts/sim-webhook.js` | Sign + send a fake payment webhook to test delivery |
| `scripts/sim-usage.js` | Simulate usage reports (`--ref VD-... --used-mb N` or `--percent N`, or `--phone ...`) — dev stand-in for the telco/supplier usage feed |
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

1. **Supabase**: create project → SQL editor → paste `supabase/schema.sql` → run. (Tables + RLS + functions + seeds. Idempotent; adds `customers`, `saved_numbers`, `bundle_usage`, `auto_reload` and the rest.)
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

© 2026 Valmont Group of Companies.

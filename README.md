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
| [`ads/`](ads/) | **Valmont Ads** — Ghana classifieds marketplace (Next.js 16 + Tailwind v4 + REST API). Separate product from the data store. | 🆕 Standalone app |
| [`prototype/`](prototype/) | 27-page interactive design reference (simulated payments/auth, localStorage) | 📐 Reference only |
| [`starter-nextjs/`](starter-nextjs/) | First-attempt Next.js + Paystack starter | ⚠️ **Superseded** — reference only (esp. `src/lib/providers/remadata.ts`) |
| [`GET-STARTED.md`](GET-STARTED.md) | **Launch runbook** — Supabase → Valmont-Pay → Vercel → supplier → live smoke test | Follow this to go live |
| [`valmont-everything.zip`](valmont-everything.zip) | The **whole repository** as one downloadable file — `ads/`, `app/`, `prototype/`, docs, plus a `START-HERE.txt` | 📦 Download |
| [`val-ads.zip`](val-ads.zip) | **Valmont Ads only** — the classifieds app as one downloadable file | 📦 Download |

## Quick start (production app, 2 minutes, no database needed)

```bash
cd app
cp .env.example .env.local      # defaults are fine for local
npm run dev                     # → http://localhost:8787 (in-memory DB)
npm test                        # 104-check end-to-end suite (start dev server first)
```

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
Fires in parallel with webhooks, never blocks the pipeline. Dev mode logs
to console.

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
| [`ads/README.md`](ads/README.md) | Valmont Ads classifieds: page map, API, moderation rules |
| [`ads/CONTEXT-FOR-AGENT.md`](ads/CONTEXT-FOR-AGENT.md) | Brief for an AI agent: what Valmont Ads is, what exists, the real backlog |
| [`ads/PROMPT-FOR-AGENT.md`](ads/PROMPT-FOR-AGENT.md) | Copy-paste prompt for continuing the classifieds work |
| [`prototype/README.md`](prototype/README.md) | Design blueprint: page map, pricing, UX decisions |
| [`starter-nextjs/README.md`](starter-nextjs/README.md) | Superseded starter (kept for the provider/ driver ideas) |

## Downloads (zips, kept in the repo)

Two archives are committed to the repo so they can be fetched straight from
GitHub — no clone needed. Both are built from tracked files only, so they
never contain `node_modules`, `.next` or `.data`. Each has a `START-HERE.txt`
at the root.

| File | What is inside | Direct link (branch `arena/01a00ce7-valmont-data`) |
|---|---|---|
| `valmont-everything.zip` | The whole repo: `ads/` + `app/` + `prototype/` + `starter-nextjs/` + docs | [download](https://github.com/danieloansah7868-dotcom/Valmont-data/raw/arena/01a00ce7-valmont-data/valmont-everything.zip) |
| `val-ads.zip` | Valmont Ads classifieds app only | [download](https://github.com/danieloansah7868-dotcom/Valmont-data/raw/arena/01a00ce7-valmont-data/val-ads.zip) |

Rebuild them any time with:

```bash
git archive HEAD ads | tar -x -C /tmp/ads --strip-components=1   # then zip /tmp/ads
git archive HEAD -- . ':(exclude)val-ads.zip'                    # then zip that tree
```

---

© 2026 Valmont Group of Companies · Accra, Ghana · Payments powered by Valmont-Pay

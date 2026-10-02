# Valmont Ads — context for an AI agent

Paste this into any agent before asking it to plan or build. Without it, agents
guess from the name "ads" and describe an ad-slot network — CPM, media buying,
escrow, seller payouts, fill rate. **None of that applies here.**

---

## What this actually is

**A classifieds marketplace for Ghana.** Kofi posts his fridge, a buyer calls
Kofi. Closest comparisons: Tonaton, Jiji, Facebook Marketplace.

It is **not** an advertising network. Nobody buys banner space, there is no
inventory calendar, no CPM, no media buyer. The word "ads" here means "small
ads" in the newspaper sense.

Part of Valmont Group, alongside valmontweb.com, valmontpay.app,
valmontelectricals.com, nanahemaamarket.com.

---

## Non-negotiables

These come from valmontweb.com's public promises and must not be broken:

1. **No middleman on money.** The site says *"Money comes direct to you… no
   waiting for anybody to 'release' your money."* Buyer and seller settle
   between themselves — cash, MoMo, whatever they agree. **Never build escrow,
   held funds, platform fee splits, or a checkout that touches their money.**
   That would contradict the company's own homepage.
2. **Free listings stay free.** The free tier is the audience. Revenue comes
   from Valmont Web clients buying promotion on top.
3. **Trust badges are earned, never sold.** Paying for placement must never
   grant a trust badge. There is a test asserting this.
4. **Nothing is hidden from buyers.** Warning badges and "new seller" badges
   are public. No suppressing unflattering signals.
5. **Paid ads are labelled and rationed.** Max ~1 paid card in 6, never the
   first card, one bonus slot per campaign ever — never a repeating carousel.

---

## House style

- Navy `#0b1a38`, orange `#ff8c00`, off-white `#f8fafc` — Tailwind v4 `@theme`
  tokens in `src/app/globals.css`.
- Mobile-first, tap targets ≥ 44px. Most users are on a phone on mobile data.
- Ghana context: GH₵ prices, MTN / Telecel / AirtelTigo, MoMo, 10 regions.
- Plain English in the UI. No jargon.

---

## Stack

Next.js 16.3 (App Router, Turbopack) · React 19.2 · Tailwind 4.3 · TypeScript.
Port 3000. Data layer is `src/lib/store.ts`, a JSON file store at `.data/ads.json`.

```
npm install && npm run dev     # http://localhost:3000, seeds itself
npm run check                  # typecheck + 207 tests (server must be running)
```

`npm run lint` cannot work — `next lint` was removed in Next 16 and ESLint is
not a dependency. Use `npm run check`.

---

## What already exists — do not "add" these

| Area | Status |
|---|---|
| Browse, search, 10 categories, 10 regions, filters, sort, paging | Done |
| Ad detail pages, photo gallery, related ads | Done |
| Post-an-ad form, 4 steps, photo previews | Done |
| Moderation queue with device fingerprint on each poster | Done |
| Automatic scam/junk screening, risk score, auto-reject | Done |
| Seller reputation: 7 earned badges + 0–100 score | Done |
| ID Verified — manual **and** automatic from a clean record | Done |
| Paid promotion: 2 tiers, click-through, impressions, CTR report | Done |
| Seller dashboard: views, leads, buyer messages | Done |
| Share to WhatsApp / native share sheet | Done |
| WhatsApp quick-chat, message pre-filled with ad title + `VA-` reference | Done — `ContactSeller.tsx:37` |
| Sub-locality data (Osu, East Legon, Spintex, Adum…) used on `/post` | Done — but **not searchable**, see backlog #5 |
| **Seller login by SMS code** | Done |
| **Edit / mark sold / re-list / delete your own ad** | Done |
| **Ads expire after 30 days** | Done |

---

## Genuinely missing — the real backlog

In order of how much it hurts. The first two are launch blockers, not features.

### 1. SMS delivery is not wired up — nobody can log in

Login codes are written to the server log, not sent. `src/lib/session.ts` →
`sendCode()` is the single function to change; everything above it is already
provider-agnostic. Ghana-capable gateways: Hubtel, Arkesel, mNotify.

**`LOGIN_DEBUG` must be off in production** or the code comes back in the API
response and the login is decorative. Already verified off under
`NODE_ENV=production`.

The same gateway then unlocks **lead alerts** — texting a seller when a buyer
messages them. Do both together; it is one integration.

### 2. Photos are base64 strings inside the database

`PostForm.tsx` reads each file with `FileReader.readAsDataURL()` and posts the
data URL as a string. `store.ts` writes it straight into `.data/ads.json`.
Measured consequence:

| | |
|---|---|
| One 4 MB photo as base64 | 5.3 MB |
| One ad with 6 photos | **32 MB** |
| 100 such ads | **3.1 GB in one JSON file** |

`persist()` rewrites the *entire* file on every single write, so one buyer
message on a 100-ad site rewrites ~3 GB. The site becomes unusable at roughly
50 real ads.

Fix: real object storage (Supabase Storage, S3, Cloudinary) plus browser-side
compression before upload — most sellers are on mobile data. Store a URL in the
ad, never the bytes.

### 3. Storage will not survive Vercel

The JSON store needs a writable disk. On serverless the filesystem is
read-only, `persist()` silently falls back to memory, and cold starts wipe real
listings. Either deploy to a VPS with a disk, or port `store.ts` to Supabase
first. Port anyway at ~2,000 live ads. See the "Do we need Supabase?" section
in `README.md` for the measured numbers.

### 4. No report / flag button

Buyers spot scams faster than any moderator. Needs `POST /api/ads/:id/report`
and a small control on the ad page, feeding the existing admin queue.

### 5. Town is captured but cannot be searched

`TOWNS` in `taxonomy.ts` has real sub-localities (Osu, East Legon, Spintex,
Adum…) and `/post` uses them, but `ListQuery` has no `town` field and
`Filters.tsx` never mentions it. Sellers pick a suburb no buyer can filter on.
Small, cheap fix.

### 6. No saved searches or alerts

"Tell me when a Corolla under GH₵80k is posted" is the single biggest retention
feature a classifieds site has. `DB.savedSearches` already exists in `store.ts`
and is never written to.

### 7. No blacklist for repeat offenders

Sixteen screening rules exist, but a banned seller simply posts again from the
same number. Needs a blocked-number list checked at `createAd`.

### 8. Smaller gaps

- Admin has no audit log — no record of who approved what, when.
- No rate limiting on posting beyond the 10-minute duplicate guard.
- 57 fictional seed listings ship with the app; clear before launch.
- Self-serve promotion requests from the seller dashboard. Low value for now —
  at current client volume this is a WhatsApp conversation.

---

## Do NOT build these

- **A promotion-expiry cron.** `isPromoted()` (`store.ts:292`) compares against
  the clock on every read, and `AdCard.tsx:12` checks independently. An expired
  promotion already behaves as a free ad the instant it lapses. A scheduled job
  would add a moving part that changes nothing.
- **Anything touching money.** See non-negotiable #1.

---

## Things that look missing but are deliberate

- **No user accounts with passwords.** Sellers sign in by SMS code. Adding
  email/password signup would cut posting volume for no gain.
- **No payments.** See non-negotiable #1.
- **No ratings/reviews.** Badges are computed from real behaviour instead —
  star ratings on a free classifieds site get gamed immediately.
- **Category, region and phone are not editable after posting.** Buyers filtered
  on those to find the ad; letting a seller swap categories after approval is a
  known classifieds scam.

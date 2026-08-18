# Valmont Ads — Ghana classifieds marketplace

> **Buy and sell anything in Ghana.** A free classifieds site: post an ad in two
> minutes, browse by category and region, and contact sellers directly by phone
> or WhatsApp. A **Valmont Group of Companies** platform.

```
Seller posts ad → automated screening → moderation queue
   → moderator approves → ad goes live → buyer searches/filters
   → buyer reveals contact or sends a lead → seller calls back → marked sold
```

Unlike [`app/`](../app/) (the zero-build-step data-bundle store), this is a
**Next.js 16 + Tailwind v4 application** with a build step, as requested.

---

## Quick start

```bash
cd ads
npm install
npm run dev          # → http://localhost:3000
```

The catalogue self-seeds with **57 realistic Ghanaian listings** (36 live, the
rest sold/pending so seller track records are real) on first boot,
so nothing is ever empty. In a second terminal:

```bash
npm test             # 207-check end-to-end suite (dev server must be running)
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on `0.0.0.0:3000` |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | 207-check API + page smoke suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | typecheck + full suite, the one to run before pushing |

---

## Page map

| Page | Route | What it does |
|---|---|---|
| Landing | `/` | Hero, live stats, trending panel, categories, featured + fresh ads |
| Browse | `/ads` | Search, filter (category/subcategory/region/condition/price), sort, paginate |
| Ad detail | `/ads/[slug]` | Gallery, specs, description, contact reveal, lead form, similar ads |
| Post an ad | `/post` | 4-step form with live photo previews and validation |
| Categories | `/categories` | All 10 categories with live counts and subcategory chips |
| My ads | `/my-ads` | Seller dashboard — sign in by SMS code, then edit / mark sold / re-list / delete your ads and read buyer messages |
| Safety | `/safety` | Buyer/seller safety tips and the banned-items list |
| Seller profile | `/seller/[phone]` | Public track record — reputation score, earned badges, all live ads |
| Admin | `/admin` | Moderation console — approve, reject, feature, mark sold, verify sellers |

**Admin password:** `admin123` (dev default — override with `ADMIN_PASSWORD`).
**Demo seller number** for `/my-ads`: `0244118822`. In development the login
code is shown on screen and printed to the server log, so you never need an SMS
account to try the flow.

---

## API

All endpoints return JSON `{ ok: true, ... }` or `{ ok: false, error }`.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/ads` | List/search. Query: `q, category, subcategory, region, condition, min, max, sort, status, page, perPage`. Returns `{items, total, page, pages, perPage, bonusSlots}` — `bonusSlots` is how many paid placements this page was given, so the cap is auditable from outside. |
| `POST` | `/api/ads` | Create an ad → enters the moderation queue |
| `GET` | `/api/ads/:id` | Fetch one ad (by id, slug or `VA-` reference) |
| `POST` | `/api/ads/:id` | Increment the view counter |
| `GET` | `/api/ads/:id/leads` | Leads for one ad |
| `POST` | `/api/ads/:id/leads` | Buyer sends a message |
| `POST` | `/api/auth` | `{action:"request",phone}` sends a code · `{action:"verify",phone,code}` returns a session token · `{action:"logout"}` ends it |
| `GET` | `/api/auth` | Who am I — needs `x-session-token` |
| `GET` | `/api/my-ads` | A seller's own ads + leads — **needs `x-session-token`** |
| `PATCH` | `/api/my-ads/:id` | Edit your own ad: `title, description, price, negotiable, condition, images, town` |
| `POST` | `/api/my-ads/:id` | `{action:"sold"}` or `{action:"relist"}` on your own ad |
| `DELETE` | `/api/my-ads/:id` | Delete your own ad and its leads |
| `GET` | `/api/sellers/:phone` | Public reputation — badges, score, stats + that seller's live ads |
| `GET` | `/api/admin?status=` | Queue + stats — needs `x-admin-password` |
| `POST` | `/api/admin` | `{ id, action }` where action is `active \| rejected \| sold \| pending \| expired \| feature \| promote \| unpromote`, or `{ phone, action }` for `verify \| unverify` |
| `GET` | `/api/go/:id` | Promoted-ad click-through — counts the click, 302s to the client's own site |

```bash
# post an ad
curl -X POST localhost:3000/api/ads -H 'Content-Type: application/json' -d '{
  "title":"iPhone 12 64GB clean","category":"phones-tablets","price":3200,
  "region":"Greater Accra","town":"Osu","sellerName":"Ama","sellerPhone":"0241234567",
  "description":"Clean iPhone 12, battery 88 percent, no faults, box included."
}'

# approve it
curl -X POST localhost:3000/api/admin -H 'Content-Type: application/json' \
  -H 'x-admin-password: admin123' -d '{"id":"<ad-id>","action":"active"}'

# grant the one badge money cannot buy, after checking the seller's ID
curl -X POST localhost:3000/api/admin -H 'Content-Type: application/json' \
  -H 'x-admin-password: admin123' -d '{"phone":"0248001122","action":"verify"}'

# sell a promotion against a Valmont Web package
curl -X POST localhost:3000/api/admin -H 'Content-Type: application/json' \
  -H 'x-admin-password: admin123' -d '{
    "id":"<ad-id>","action":"promote","tier":"spotlight",
    "clientName":"Akosua Styles","websiteUrl":"https://akosuastyles.com",
    "packageRef":"VW-2026-0142"
  }'
```

---

## How it makes money (and why posting stays free)

Free listings are the **inventory**. No free ads → no listings → no visitors →
nothing worth paying to advertise in front of. So posting is free forever, and
the revenue comes from the other side of the marketplace.

**Promotions are sold as a Valmont Web package add-on.** A client who buys a
website can pay to have their products featured here, and every promoted ad
links **out to their own site** via `/api/go/:id`.

That placement is deliberate. valmontweb.com promises *"nobody sits between you
and the people you serve"* — so a promotion is a **billboard pointing at the
shop we built them**, never a checkout we own. The pitch becomes "we build your
site *and* bring people to it", which reinforces the Web offer instead of
competing with it.

| Tier | Default run | What the client gets |
|---|---|---|
| Spotlight | 30 days | Top of the default view, Sponsored badge, click-through to their site |
| Boost | 14 days | Same placement, shorter run |

Two rules protect the marketplace's credibility, both enforced in code and
covered by tests:

1. **Paid placement only reorders the default view.** The moment a buyer states
   an intent — *cheapest first*, *most viewed* — money stops affecting the
   order. Rankings a buyer can't trust are worth nothing to advertisers either.
2. **Every promotion is labelled.** A `Sponsored` badge and a "Paid promotion by
   {client}" line, plus a note on the ad that Valmont takes no commission and
   handles no payment. Undisclosed paid placement is how classifieds sites lose
   their audience.

Promotions expire on their own and decay back to ordinary free ads. Clicks and
impressions are tracked per campaign so there's a real number to show at
renewal — see the **Paid promotions** table in `/admin`.

## Seller reputation (earned, never sold)

A buyer meeting a stranger with cash needs a reason to trust them. Every seller
carries a public track record at `/seller/[phone]`, and the badge they've earned
follows their ads around the site.

| Badge | How it is earned |
|---|---|
| 🛡️ **ID Verified** | Granted by hand in `/admin` after checking ID or visiting the shop. |
| 🛡️ **Verified by record** | Automatic: 5+ sales over 60+ days, 5+ ads, nothing ever removed. The badge says plainly that nobody met them. |
| ✅ **Trusted Seller** | 3+ completed sales, zero rejected ads, active 14+ days |
| 🏆 **Top Seller** | 10+ completed sales |
| 📅 **Long-standing** | 90+ days, 5+ ads, clean record |
| 💬 **Responsive** | 10+ buyer messages received and at least one sale |
| ⚠️ **Take care** | 2+ ads rejected by moderation — shown to buyers, not hidden |
| 🌱 **New seller** | No history yet. Not an accusation, just a fact — and shown on ad cards too, not hidden. |

Four rules hold this together, and they are the reason the badges are worth
anything:

1. **Money can never buy a badge.** A Valmont Web client buying a promotion gets
   placement and a "Sponsored" label — never a trust signal. The two systems are
   deliberately separate in the code, and a test asserts it.
2. **Badges are automatic**, computed from real activity. Verification has two
   routes — a hand check, or a long clean trading record — and the badge always
   states which one, because "we met this person" and "the numbers add up" are
   different claims and buyers deserve to know the difference.
3. **Badges are losable.** Get ads rejected and Trusted disappears while
   *Take care* appears. A reputation you can't lose isn't a reputation.
4. **Every badge states its reason** in plain English on hover, so nobody has to
   guess what "trusted" means here.

Nothing is hidden. The ⚠️ warning and 🌱 new-seller badges show on ad cards and
profiles alike. Most marketplaces only surface good news, which is why their
badges get ignored — showing the bad is what makes the good believable.

## How paid ads differ from free ones

A promotion buys **placement and a label — nothing else.** Concretely:

| | Free ad | Paid ad |
|---|---|---|
| Appears in search/filters | yes | yes, identically |
| Ranked by price/popular sorts | on merit | on merit — money is ignored |
| Extra slot on the default view | no | yes, rationed (see below) |
| Visual treatment | plain white card | orange frame + **Ad · Paid** label + payer named |
| Links to | the ad page | the client's own website |
| Trust badges | earned | **cannot be bought** |

Placement is deliberately rationed, because a buyer who scrolls three pages and
meets the same shop five times stops trusting the listings and leaves — which
destroys the free audience the paid layer is sold against:

- **Nothing is ever removed from the listing.** Every ad, paid or free, keeps its
  honest position and stays reachable by paging. A promotion only ever *adds* a
  bonus slot; it never displaces or hides another seller's ad.
- **One bonus slot per campaign, ever.** A promotion buys ONE earlier showing
  across the whole result set, not a recurring one — a campaign never reappears
  as a buyer scrolls. Tests assert no ad is shown twice while paging.
- **At most 2 bonus slots per page** (1 on a 6-card page) — roughly 1 paid card
  in 6. The API returns `bonusSlots` so this is measurable, not a guess.
- **Never the first card.** A paid ad can only lead if it earned that spot
  organically — newest, or a free editorial *Featured* pick.
- **No double-dipping.** A campaign already visible on the page cannot also win a
  bonus slot there, and the page's budget is reduced by any paid ads that ranked
  organically — so exposure can't be stacked.
- **Most pages carry no bonus slot at all.** Campaigns are dealt across pages, so
  with a handful of clients the great majority of the listing is untouched.
- **Default view only.** Sort by price or popularity and `bonusSlots` is `0`.
  Tests enforce this.

> **Why "never remove, only add":** the first version lifted paid ads out of the
> normal run so a bonus slot replaced their natural position. That looked tidier
> and was badly wrong — the paging cursor drifted and silently dropped honest
> listings, and any campaign that lost the rotation vanished from the site
> entirely. A seller's ad disappearing is far worse than a slightly busy page,
> so the engine now guarantees reachability first and rations exposure second.

## Sharing

Word of mouth is how a classifieds site actually grows here, so sharing is a
first-class feature rather than an afterthought:

- **Every ad card** has a share button — no need to open the ad first.
- **Ad pages and seller profiles** have a full share block.
- Order of preference: the phone's **native share sheet** (one tap to WhatsApp,
  Telegram, SMS), then **WhatsApp explicitly** for desktop, then **copy link**
  which works everywhere including the in-app browsers in Facebook/Instagram.
- The shared message leads with item, price and town, because the person
  receiving it has no context yet.
- **Shared links need no account.** Anyone can open them. That is the point.
- `metadataBase` + Open Graph tags mean a link pasted into WhatsApp renders with
  a real title and photo instead of a bare URL — set `NEXT_PUBLIC_SITE_URL`.

## Rules baked into the code

1. **Nothing goes live unreviewed** — every new ad starts `pending`; only a
   moderator (or the admin API) flips it to `active`.
2. **Automated screening first** — banned phrases (`advance fee`,
   `western union only`, …) auto-reject on submission with a stated reason.
3. **No fake discounts** — there is no "was" price field anywhere, matching the
   house rule in the root README.
4. **Duplicate guard** — the same seller can't repost an identical title within
   10 minutes.
5. **Ghana phone validation** — `0241234567`, `+233241234567` and
   `233241234567` all normalise to one canonical form, so `/my-ads` finds a
   seller however they type their number.
6. **Contact is never scraped in bulk** — numbers render masked (`024 *** 8822`)
   until the buyer taps *Show contact*.
7. **Inactive ads can't take leads** — sold/rejected/pending ads reject lead
   submissions server-side, not just in the UI.

---

## Architecture

```
ads/
├── src/app/
│   ├── page.tsx              landing
│   ├── ads/                  browse + [slug] detail
│   ├── seller/[phone]/       public seller profile + reputation
│   ├── post/ categories/ my-ads/ safety/ admin/
│   └── api/                  ads · ads/[id] · ads/[id]/leads · auth ·
│                             my-ads · my-ads/[id] · sellers/[phone] ·
│                             admin · go/[id]
├── src/components/           SiteHeader, SiteFooter, AdCard, Filters, SortSelect,
│                             PostForm, ContactSeller, Gallery, MyAdsClient,
│                             AdminConsole, SellerBadges, ShareAd,
│                             ShareButton, ViewPing
├── src/lib/
│   ├── store.ts              data layer (validation, screening, CRUD, queries)
│   ├── reputation.ts         badge + score engine (earned, never buyable)
│   ├── session.ts            SMS-code login: codes, tokens, expiry windows
│   ├── screening.ts          scam/junk filters, device fingerprint for admin
│   ├── seed.ts               57-listing catalogue (36 live + sales history)
│   ├── taxonomy.ts           categories, regions, towns, conditions
│   ├── types.ts  format.ts   shared types and GH₵ / time / phone formatting
└── scripts/test.mjs          207-check smoke suite
```

### Sellers own their listings

Three things a classifieds site cannot ship without, added after the first round:

**1. Sellers can sign in.** `/api/my-ads` used to take `?phone=` from the query
string and return that seller's ads *and every buyer message sent to them* —
names, numbers, message text. The phone number is printed on every ad, so this
was copy-and-paste, not a guess. Now a 6-digit code goes to the number and is
exchanged for a session token; the token is the only thing that opens the
dashboard. No password, no signup — the same flow everyone already uses for
MoMo. Codes expire in 10 minutes, die after 5 wrong guesses, and can only be
requested once a minute and only for a number that has actually posted, so the
endpoint cannot be turned into a free SMS cannon.

`src/lib/session.ts` → `sendCode()` is the single function to change when an SMS
gateway exists. Until then it logs, and `LOGIN_DEBUG` returns the code in the
response **in development only** — see the environment table.

**2. Edit, mark sold, re-list, delete.** Previously a seller could do none of
these: sold the fridge, could not take it down. Two deliberate limits:

- *Category, region and phone cannot be edited.* Those are what buyers filtered
  on to find the ad. Swapping an approved phone listing into a car listing is
  the oldest trick in classifieds. Post again instead.
- *Editing the title or description sends the ad back to review*, and re-runs
  the scam screen. Otherwise editing is a hole straight through moderation:
  post something clean, get approved, rewrite it as a scam. Price and photo
  edits do not re-queue.

Delete is a real delete, leads included — someone who wants their personal
number off the internet should get exactly that. The one exception is a
**rejected** ad, which cannot be deleted: otherwise the caution badge is one tap
away from being erased and means nothing.

**3. Ads actually expire.** `expiresAt` was stamped at creation and then never
read, so nothing ever expired — a listing posted in January still showed as Live
in December, with a number that stopped answering months ago. A sweep now runs
on read, throttled to once a minute, and flips overdue `active` ads to
`expired`. It is lazy rather than a cron because there is no scheduler here and
serverless deploys freeze between requests: a page load is the only reliable
clock. A paid campaign that is still running keeps its ad alive — the client
bought a window of exposure and the free 30-day clock must not cut it short.
Sellers see "expires in N days" from a week out and can re-list in one tap.

**Persistence.** `src/lib/store.ts` writes to `.data/ads.json` (gitignored) so
data survives restarts and is shared across every browser hitting the server —
the file is the dev/demo database. Set `ADS_STORE=memory` for a pure in-memory
store (ephemeral or read-only deploys). The module exposes a single narrow
interface (`listAds`, `getAd`, `createAd`, `setStatus`, `createLead`, `getSellerStats`, …), so
swapping in Supabase means rewriting that one file and nothing else — the same
adapter pattern `app/lib/supplier.js` uses.

**Design system.** House navy `#0b1a38` + orange `#ff8c00` on `#f8fafc`, defined
as Tailwind v4 `@theme` tokens in `globals.css`. Mobile-first, big tap targets,
matching the rest of the Valmont estate.

---

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | `admin123` | Moderation console password |
| `LOGIN_DEBUG` | off in production | `1` returns the SMS code in the API response. Development convenience — **never set this in production**, it hands every account to anyone who asks. |
| `ADS_STORE` | `file` | `memory` for an ephemeral in-memory store |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | Public origin. **Set this before go-live** — without it, shared listings have no WhatsApp/Facebook preview image. |

No secrets ship to the client; the store module is server-only.

---

## Do we need Supabase?

**Not to launch. Yes, before you take real listings on Vercel.** The deciding
factor is not how many ads you have — it is *where you host*.

### The honest constraint

`src/lib/store.ts` keeps everything in one JSON file (`.data/ads.json`) and
rewrites that whole file on every write. Measured on the seed catalogue:
~1.2 KB per ad, a search in 4–8 ms, and 20 simultaneous posts with **zero lost
writes and no corruption** (Node's single thread serialises them).

That is genuinely fine for a small site. The problem is serverless.

| Host | What happens | Verdict |
|---|---|---|
| **VPS / droplet / any always-on server with a disk** | File is written and re-read normally. Works. | ✅ Ship it |
| **Vercel, Netlify, Cloudflare (serverless)** | Filesystem is read-only, so `persist()` silently falls back to memory. Every cold start resets to the seed catalogue, and each instance has its own copy. **Sellers' ads vanish.** | ❌ Supabase first |

That silent fallback is deliberate — better than crashing — but it means on
Vercel the site *looks* fine while quietly losing data. Do not skip this.

### When to switch, by hosting choice

1. **Launching on a VPS?** No Supabase needed. Take a nightly copy of
   `.data/ads.json` (it is just a file) and revisit at a few thousand ads.
2. **Launching on Vercel?** Port the store first. Non-negotiable.
3. **Either way, port when** you pass roughly **2,000 live ads** (the file hits
   ~2 MB and every single post rewrites all of it), or you want full-text search,
   or you need more than one server.

### What porting actually costs

`store.ts` is the only file that touches storage — 29 exported functions behind
a narrow interface (`listAds`, `getAd`, `createAd`, `setStatus`, `createLead`,
`getSellerStats`, …). The 12 files that import it never see the storage layer, so
they do not change. Reuse the schema pattern in `app/supabase/schema.sql`.

Search is currently a linear scan in memory, which is why it is fast now and
why Postgres indexes are the real win later.

## Deploy

Vercel picks this up as a standard Next.js app (root directory `ads/`). Set
`ADMIN_PASSWORD` and `NEXT_PUBLIC_SITE_URL`. **Read the Supabase section above
before deploying to Vercel** — set `ADS_STORE=memory` there only if you accept a
demo that resets, never for real listings.

---

© 2026 Valmont Group of Companies · Accra, Ghana

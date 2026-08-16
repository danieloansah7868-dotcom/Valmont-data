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

The catalogue self-seeds with **36 realistic Ghanaian listings** on first boot,
so nothing is ever empty. In a second terminal:

```bash
npm test             # 69-check end-to-end suite (dev server must be running)
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on `0.0.0.0:3000` |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | 69-check API + page smoke suite |
| `npm run typecheck` | `tsc --noEmit` |

---

## Page map

| Page | Route | What it does |
|---|---|---|
| Landing | `/` | Hero, live stats, trending panel, categories, featured + fresh ads |
| Browse | `/ads` | Search, filter (category/subcategory/region/condition/price), sort, paginate |
| Ad detail | `/ads/[slug]` | Gallery, specs, description, contact reveal, lead form, similar ads |
| Post an ad | `/post` | 4-step form with live photo previews and validation |
| Categories | `/categories` | All 10 categories with live counts and subcategory chips |
| My ads | `/my-ads` | Seller dashboard by phone number — stats, statuses, buyer messages |
| Safety | `/safety` | Buyer/seller safety tips and the banned-items list |
| Admin | `/admin` | Moderation console — approve, reject, feature, mark sold |

**Admin password:** `admin123` (dev default — override with `ADMIN_PASSWORD`).
**Demo seller number** for `/my-ads`: `0244118822`.

---

## API

All endpoints return JSON `{ ok: true, ... }` or `{ ok: false, error }`.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/ads` | List/search. Query: `q, category, subcategory, region, condition, min, max, sort, status, page, perPage` |
| `POST` | `/api/ads` | Create an ad → enters the moderation queue |
| `GET` | `/api/ads/:id` | Fetch one ad (by id, slug or `VA-` reference) |
| `POST` | `/api/ads/:id` | Increment the view counter |
| `GET` | `/api/ads/:id/leads` | Leads for one ad |
| `POST` | `/api/ads/:id/leads` | Buyer sends a message |
| `GET` | `/api/my-ads?phone=` | A seller's ads + leads (phone normalised) |
| `GET` | `/api/admin?status=` | Queue + stats — needs `x-admin-password` |
| `POST` | `/api/admin` | `{ id, action }` where action is `active \| rejected \| sold \| pending \| expired \| feature` |

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
```

---

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
│   ├── post/ categories/ my-ads/ safety/ admin/
│   └── api/                  ads · ads/[id] · ads/[id]/leads · my-ads · admin
├── src/components/           SiteHeader, SiteFooter, AdCard, Filters, SortSelect,
│                             PostForm, ContactSeller, Gallery, MyAdsClient,
│                             AdminConsole, ViewPing
├── src/lib/
│   ├── store.ts              data layer (validation, screening, CRUD, queries)
│   ├── seed.ts               36-listing demo catalogue
│   ├── taxonomy.ts           categories, regions, towns, conditions
│   ├── types.ts  format.ts   shared types and GH₵ / time / phone formatting
└── scripts/test.mjs          69-check smoke suite
```

**Persistence.** `src/lib/store.ts` writes to `.data/ads.json` (gitignored) so
data survives restarts and is shared across every browser hitting the server —
the file is the dev/demo database. Set `ADS_STORE=memory` for a pure in-memory
store (ephemeral or read-only deploys). The module exposes a single narrow
interface (`listAds`, `getAd`, `createAd`, `setStatus`, `createLead`, …), so
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
| `ADS_STORE` | `file` | `memory` for an ephemeral in-memory store |

No secrets ship to the client; the store module is server-only.

---

## Deploy

Vercel picks this up as a standard Next.js app (root directory `ads/`). Set
`ADMIN_PASSWORD`, and set `ADS_STORE=memory` unless you have attached writable
storage — serverless filesystems are read-only, in which case the seed catalogue
loads fresh per instance. For real production, port `src/lib/store.ts` onto
Supabase and reuse the schema pattern in `app/supabase/schema.sql`.

---

© 2026 Valmont Group of Companies · Accra, Ghana

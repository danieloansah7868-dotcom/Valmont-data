# SEO audit & fix — Valmont Data

**Date:** 2026-09-04 · **Branch:** `arena/01a06c9c-valmont-data` · **Base:** `eb0bc71`
**Scope:** `app/` (the deployed static site + its API). `prototype/` is design reference only and is **not** deployed — nothing from it was copied into production pages.

Short version: the site had **nine** indexable URLs and **zero** pages for the things people actually search for ("data", "bundle", "mtn", "10gb", "non expiry"). The catalogue existed only as client-side JavaScript state behind query-string filters, so a crawler saw an empty homepage and no way in. There is now a generated, self-canonical landing page for every network, every bundle, every useful slice of the catalogue, plus a shared keyword vocabulary that also powers on-site search, the ValmontAI assistant and the WhatsApp bot.

- Indexable URLs: **9 → 43** (+34 generated pages)
- JSON-LD: **0 → 123 blocks across 39 files** (21 distinct `@type` values: Organization, WebSite, WebPage, CollectionPage, ItemList, Product, Offer, Service, FAQPage, Question, Answer, BreadcrumbList, ListItem, AboutPage, ContactPage, Brand, Thing, Country, PostalAddress, ContactPoint, OpeningHoursSpecification)
- Open Graph tags: **0 → 40 files** · keywords meta: **0 → 39 files** · pages with >1 `<h1>`: **2 on the homepage → 0 anywhere**
- `robots.txt` contradictions (noindexed *and* Disallowed): **5 → 0**
- Tests: `npm run test:seo` → **94 file checks + 20 live routes, all green**; `npm test` → **152 passed / 6 failed, byte-identical to the baseline** (the 6 are pre-existing float-state assumptions in `scripts/test.sh`, listed in §5)

---

## 1. Diagnosis (before any code was changed)

### (a) Indexable page count vs query-string filters

`app/sitemap.xml` listed 9 URLs: `/`, `store.html`, `about.html`, `faq.html`, `contact.html`, `signup.html`, `signin.html`, `privacy.html`, `terms.html`. **Not one of them is a catalogue page.**

The whole product — 24 bundles across 3 networks — lived in JavaScript:

| What a crawler requested | What it got |
| --- | --- |
| `/` | 200, but **zero prices in the raw HTML** (the grid is rendered by `assets/js/storefront.js` after `fetch('/api/bundles')`) |
| `/?net=mtn` | 200 — the *same* homepage, same canonical, no MTN-specific content. A filter, not a page |
| `/?net=mtn&size=10240#buy` | 200 — same document again. Every "buy" link on the site pointed at one of these |
| `/bundles/mtn.html` | **404** — the directory did not exist |

Consequences: no URL to rank for any product query, no crawl path into the catalogue, and ~24 × N duplicate-parameter URLs all canonicalising to `/` (crawl budget spent on nothing). The homepage also had **two `<h1>` tags**.

### (b) Where the keywords lived

Nowhere that mattered. Baseline counts across all 51 HTML files:

- `meta name="keywords"`: **0 files** (and Google has ignored it since 2009 anyway)
- The vocabulary that did exist was buried in code: `NETWORK_ALIASES` inside `assets/js/valmontai.js` and a hand-rolled detector in `lib/whatsapp-bot.js`. Nothing was shared, nothing was visible on a page, and no two surfaces agreed.

### (c) Vocabulary gap

The catalogue speaks database; customers speak street. There was no bridge:

| Catalogue / code says | People type |
| --- | --- |
| `size_mb = 10240`, `validity_days = null` | "10gb", "10 gigs", "10240mb", "non expiry", "no expiry", "never expires" |
| `network_code = 'airteltigo'`, product "iShare" | "at", "tigo", "airtel", "at data", "ishare" |
| `network_code = 'telecel'` | "vodafone", "voda", "voda data" |
| `network_code = 'mtn'`, product "UP2U" | "mtn", "up2u", "mtn megs", "mtn internet" |
| `sell`, `cost`, price in GHS | "cheap data", "cheapest bundle", "data price", "how much is 5gb" |
| "reseller store", `markup_pct` | "data business", "resell data", "data agent", "side hustle" |
| Mobile Money / Valmont-Pay | "momo", "momo data", "pay with momo" |

Two live bugs came straight out of this gap:

1. `lib/whatsapp-bot.js` detected the network with `text.includes('tigo') && … || …` — operator precedence sent **"tigo 2gb" to Telecel**. Wrong network, wrong price, order fails.
2. The assistant had no honest answer for a size a network does not sell: **"telecel 1gb"** produced a nonsense reply instead of "Telecel has no 1GB bundle — we have 1GB on MTN and AirtelTigo".

### (d) Sitemap / robots / canonical consistency

- `sitemap.xml`: 9 `<loc>`s, internally consistent — but missing everything worth indexing.
- `robots.txt` **contradicted** the pages: `/admin.html`, `/dashboard.html`, `/otp.html`, `/autoreload.html`, `/offline.html` were `Disallow`ed *and* carried `noindex`. Google cannot read a `noindex` it is not allowed to fetch, so it indexes the bare URL as "Indexed, though blocked by robots.txt" — the exact Search Console warning this produces. It also blocked `/sw.js` and `/manifest.json` for no reason.
- `storefront.html` (served as `/s/<slug>` by a Vercel rewrite) had no canonical at all.
- The homepage's own copy claimed **"No account needed"** while `signup.html` is mandatory, and the FAQ said bundles run **"1GB to 50GB"** while Telecel sells 100GB. Both are the kind of statement that costs a snippet and a customer.

### (e) Structured data

**Zero.** No JSON-LD anywhere, no Open Graph, no Twitter cards, no breadcrumbs, no `Product`, no `FAQPage` — on a site whose FAQ page has ten real answers and whose catalogue has 24 priced products.

---

## 2. What was built

### 2.1 Page architecture — 34 generated URLs

| Type | Count | Example URL | Title pattern |
| --- | --- | --- | --- |
| Catalogue hub | 1 | `/bundles/` | *Data Bundles in Ghana — from GH₵4.00 \| Valmont Data* |
| Network / brand | 3 | `/bundles/mtn.html` | *MTN Non-Expiry Data Bundles — from GH₵6.00 \| Valmont Data* |
| Product (one per bundle) | 24 | `/bundles/mtn/10gb.html` | *MTN 10GB Data Bundle — GH₵52.00, no expiry \| Valmont Data* |
| Price tier | 2 | `/bundles/cheap.html`, `/bundles/big.html` | *Cheap Data Bundles in Ghana — from GH₵4.00…* |
| Validity slice | 1 | `/bundles/rollover.html` | *60-Day Rollover Data — Telecel & AirtelTigo…* |
| Service / utility | 3 | `/auto-top-up.html`, `/buy-data-on-whatsapp.html`, `/network-prefixes.html` | intent-led, one page each |

Every page has: one `<h1>`; a self-referencing absolute canonical; `index, follow`; a title ≤62 chars; a description 70–160 chars built from live numbers; a visible "Also searched as:" synonym row; 600–1200 words of body copy; a real price table; a visible FAQ (3–7 questions) mirrored as `FAQPage`; `BreadcrumbList` + `CollectionPage`/`ItemList` (or `Product`); and cross-links to siblings, parents and related services.

**Deliberately not generated** (documented in the generator's header comment):

- **City pages** ("data bundles in Kumasi"). A bundle is credited to a Ghanaian MSISDN seconds after payment — coverage, price and turnaround are identical nationwide, so a city page could only duplicate the national one. That is the doorway-page pattern. Cities live in `lib/keywords.js → LOCATIONS` and are used **only** for copy and `areaServed`, never as URLs.
- **A separate "non-expiry" page.** Every non-expiry bundle we stock is MTN, so it would be a byte-for-byte twin of `/bundles/mtn.html`. The MTN page *is* the non-expiry page and owns that vocabulary.
- **Reviews, ratings, stock levels, delivery-time promises, customer counts.** We have no such data, so there is no such schema and no such copy.

### 2.2 The generator — `app/scripts/generate-seo-pages.js`

```bash
npm run seo:generate          # from lib/demo-data.js (the mirror of supabase/schema.sql)
npm run seo:generate:live     # from GET /api/bundles  (add --api=http://host:port)
npm run seo:check             # fail if published prices/pages no longer match the catalogue
```

Zero dependencies, zero build step — it writes static HTML, so the Vercel + Supabase architecture is unchanged. It also:

- injects a **static price list** into the homepage between `<!--SEO:CATALOGUE:START/END-->` markers (so a JS-less crawler sees all 24 prices),
- regenerates the **homepage `<head>`** between `<!--SEO:HOME_HEAD:START/END-->` (title/description/OG with live counts and the live minimum price — the old hand-written "24 bundles from GH₵4.00" would have drifted),
- generates `faq.html`'s **`FAQPage` schema by reading the visible Q&A back out of the page**, and rewrites its size-range sentence from the catalogue, between `<!--SEO:FAQ_JSONLD-->` / `<!--SEO:SIZE_RANGE-->` markers,
- generates `store.html`'s `FAQPage` from its visible `<details>` FAQ (`<!--SEO:STORE_FAQ_JSONLD-->`),
- rebuilds `sitemap.xml` from the files it just wrote (so `<loc>` is byte-identical to each canonical), excluding every `noindex` page,
- stamps each page with the catalogue source it was built from, and **throws** if a marker region is damaged rather than silently leaving yesterday's schema in place (that exact failure mode froze the FAQ schema mid-audit — see §5).

### 2.3 Vocabulary module — `app/lib/keywords.js`

One isomorphic UMD file (Node `require` + browser `window.ValmontKeywords`) holding: `SITE` facts, `LOCATIONS` (country/HQ/21 cities — copy and `areaServed` only), `SITE_TERMS` (27 global terms), **17 categories** (`mtn`, `telecel`, `airteltigo`, `non-expiry`, `rollover`, `cheap`, `big`, `auto-top-up`, `whatsapp`, `reseller`, `referral`, `tracking`, `prefixes`, `payment`, `support`, `brand`, `catalogue`) with **382 distinct terms and phrases**, each mapped to a real page, plus `WEIGHTS`, `expandQuery`, `matchCategories`, `detectNetwork`, `sizeFromText`, `scoreItem`, `searchCatalogue`, `metaKeywords`, `alsoSearchedAs`, `itemKeywords`, `sizeLabel`, `sizeSlug`.

It feeds four surfaces from one source of truth: the `keywords` meta on 39 pages, the **visible** "Also searched as:" rows and body copy, on-site search, and both bots.

### 2.4 Search, assistant and WhatsApp

- `assets/js/catalogue-search.js` — synonym expansion as a **graded score boost**, never a hard filter. Exact beats synonym by construction (`EXACT_SIZE 140` + `EXACT_SIZE_PLUS_NET 60`, `NETWORK_EXACT 80` vs `NETWORK_SYNONYM 55`, `CATEGORY_TERM 45`, `NEAREST_SIZE_MAX 30`, `SIZE_WORD 12`); an unmatched query falls back to the whole catalogue instead of an empty state; page hints link the matched category pages.
- `assets/js/valmontai.js` — loads the vocabulary, delegates network detection, and gained a page router (after the dispute/tracking rules, guarded so anyone asking for a human still gets a human). New honest branches: *"Telecel has no 1GB bundle — we have 1GB on MTN and AirtelTigo instead"*, and an unstocked-size answer that gives the real range plus `/bundles/`. 27/27 assistant tests pass.
- `lib/whatsapp-bot.js` — `detectNetworkFromText` / `parseSizeFromText` now delegate to `lib/keywords.js`, killing the `tigo → Telecel` precedence bug. Export names unchanged, so `scripts/test.sh` §18 still passes.
- `assets/js/storefront.js` — `applyDeepLink()` honours `?net=&size=#buy` from a product page: selects the network tab, highlights the matching card (`.seo-picked`, "You came for this"), scrolls to it and posts a notice. It deliberately does **not** auto-open the buy modal, because `openBuy()` redirects to signup when there is no session — that would bounce organic traffic.

### 2.5 Internal links rewired

Nav, footer, homepage tiles, breadcrumbs and cross-link grids now point at canonical pages, not filters:

- `status.html`, `dashboard.html` footers: `/#buy` and `/` → `/bundles/mtn.html`, `/bundles/telecel.html`, `/bundles/airteltigo.html`
- `faq.html`, `about.html`: new cross-link grids to the catalogue
- Generated pages link parent → siblings → products → services both ways
- The only `?net=&size=` links left are the homepage's own buy buttons and product-page CTAs, which are **deep links into the buy form**, not navigation, and are handled by `applyDeepLink()`
- `npm run test:seo` asserts zero broken internal links and zero filter-URL navigation links site-wide

### 2.6 Sitemap, robots, head

- `sitemap.xml`: **9 → 43** `<loc>`s, priorities by page type, `lastmod` from the catalogue, every `<loc>` byte-identical to the page's own canonical, all 7 `noindex` pages excluded.
- `robots.txt`: now `Allow: /`, `Disallow: /api/`, `Disallow: /r/` (referral campaign URLs, which all canonicalise to `/`). The five noindex-but-blocked contradictions are gone — those pages are crawlable so Google can read their `noindex`, and the file says so in comments.
- `storefront.html`: bare shell self-noindexes; `/s/<slug>` sets its own canonical, title, description and OG tags from the store's real record. Its asset URLs were relative and broke under `/s/<slug>` — now root-absolute.
- `vercel.json`: added 200-rewrites for extension-less catalogue URLs (`/bundles/mtn`, `/bundles/mtn/10gb`, `/auto-top-up`, …) so production matches the dev server. They are rewrites, **not** `cleanUrls` — a `cleanUrls: true` would 308 every `.html` URL and orphan the canonicals.

---

## 3. Rules held to

1. **Nothing fabricated.** No prices, stock counts, reviews, ratings, delivery-time promises or FAQ answers that are not derived from the catalogue, the schema, or copy already in the repo. `Product` schema carries `offers.price` + `priceCurrency` and **no** `availability`, `aggregateRating`, `review` or `image` — because we cannot prove any of them. The test suite fails the build if any of those words appear in schema.
2. **Schema matches visible content.** Every `FAQPage` question and answer is extracted from the rendered page; every `Product` price is asserted to appear in the visible copy; every breadcrumb item has a name and URL.
3. **Live numbers only.** Counts, min/max prices, size ranges and per-GB figures come from the catalogue at generation time. `npm run seo:check` fails if a published price drifts from the live one.
4. **No doorway pages, no thin duplicates, no stuffing.** See §2.1 for what was refused and why. Synonyms appear once as a visible "Also searched as:" row and in body prose, never as a keyword wall.
5. **No fake discounts** — no "was" prices anywhere (house rule from `README.md`), and the suite asserts it.

---

## 4. Verification

```bash
cd app
npm run dev                                     # or: SEED_DEMO=1 node scripts/dev-server.js
npm run seo:generate && npm run seo:check
npm run test:seo -- --base=http://localhost:8787
npm test
```

**`npm run test:seo` → 94 file checks + 20 live routes, all passing.** It verifies: pages are current vs the catalogue; sitemap↔canonical byte parity; title/description/canonical/H1/word-count/synonym-row on all 41 indexable pages; every JSON-LD block parses and only describes visible content; no ratings/reviews/availability claims; internal links resolve and no filter URLs survive; all 382 vocabulary terms expand and all 17 categories point at a page (and anchor) that exists; search never dead-ends; honesty guards; all 24 prices present in raw HTML; robots.txt does not contradict the pages. With `--base` it fetches 20 routes and asserts 200 + their own title/description/canonical, including clean URLs.

Live route sample (dev server, `SEED_DEMO=1`):

```
200  /                        Buy Data Bundles in Ghana — from GH₵4.00 | Valmont Data
200  /bundles/                Data Bundles in Ghana — from GH₵4.00 | Valmont Data
200  /bundles/mtn             MTN Non-Expiry Data Bundles — from GH₵6.00 | Valmont Data
200  /bundles/mtn/10gb        MTN 10GB Data Bundle — GH₵52.00, no expiry | Valmont Data
200  /bundles/telecel.html    Telecel 60-Day Rollover Data — from GH₵39.50 | Valmont Data
200  /bundles/cheap.html      Cheap Data Bundles in Ghana — from GH₵4.00 | Valmont Data
200  /bundles/rollover.html   60-Day Rollover Data — Telecel & AirtelTigo | Valmont Data
200  /store.html              Start a Data Reselling Business in Ghana | Valmont Data
200  /sitemap.xml (43 locs)   200  /robots.txt
```

**Seed ↔ live parity.** `node scripts/generate-seo-pages.js --api=http://localhost:8787` produces pages **byte-identical** to the seed run except the source-stamp comment — the published catalogue and `lib/demo-data.js` agree on all 24 rows and prices.

**No regressions.** Ran `scripts/test.sh` against a pristine `eb0bc71` checkout and against this branch, both on a fresh `SEED_DEMO=1` server on :8787: **152 passed / 6 failed in both**, same six test names. `test-supplier-router.js` and `test-valmontai.js` (27/27) pass.

**Synonym map** (printed by the suite; page hint + top bundle):

```
data          → /bundles/                 megs     → /bundles/          internet → /bundles/
mtn           → /bundles/mtn.html         at/tigo  → /bundles/airteltigo.html
voda/vodafone → /bundles/telecel.html     non expiry → /bundles/mtn.html  rollover → /bundles/rollover.html
cheap data    → /bundles/cheap.html       unlimited → /bundles/big.html  100gb → telecel 100GB @148
mtn 10gb      → /bundles/mtn.html + mtn 10GB @288    3072mb → mtn 3GB @140    1.5gb → nearest 1GB/2GB
reseller/markup → /store.html   whatsapp → /buy-data-on-whatsapp.html   momo → /faq.html#payment
status/tracking → /status.html  support → /contact.html  prefix → /network-prefixes.html  valmont → /
```

---

## 5. Bugs found on the way (fixed)

| Bug | Where | Fix |
| --- | --- | --- |
| "tigo 2gb" routed to **Telecel** | `lib/whatsapp-bot.js` (`&&` before `\|\|`) | delegates to `keywords.detectNetwork` |
| FAQ said bundles run **1GB to 50GB** (Telecel sells 100GB) | `faq.html` | sentence now generated from the catalogue between `SIZE_RANGE` markers |
| Homepage claimed **"No account needed"** | `index.html` | removed; signup is required and the copy says so |
| FAQ schema froze on **"1GB to 50GB"** after the first run | generator dropped its `END` marker while rewriting, so later runs could not find the region | `regionBounds()` re-emits both markers and **throws** instead of skipping |
| Two `<h1>`s on the homepage | `index.html` | one |
| `/s/<slug>` loaded **no CSS/JS** (relative asset paths) | `storefront.html` | root-absolute paths |
| Store/dashboard/status footers linked every product to `/#buy` or `/` | 3 files | rewired to the canonical network pages |
| "telecel 1gb" produced a nonsense assistant reply | `valmontai.js` | honest "that network has no such size, here is where we do" branch |

Pre-existing `scripts/test.sh` failures, unchanged by this work (all six also fail on `eb0bc71`): `bundle unavailable with 0 float`, `mtn float top-up 200`, `authed order rejected when float is 0 (422)`, `float debited (200-38.5=161.5)`, `float NOT debited twice` — these five assume an **unseeded** float of GH₵200 while `SEED_DEMO=1` starts with ~GH₵3,300; and `paused rule not swept`. Note `test.sh` needs `SEED_DEMO=1` (unseeded: 74/84) and its `sim-webhook.js` helper defaults to `:8787`, so run it against a server on that port.

---

## 6. Manual follow-ups (things code cannot do)

1. **Google Search Console** — verify the property, submit `https://valmontdata.com/sitemap.xml`, request indexing for `/`, `/bundles/` and the three network pages, then watch the "Indexed, though blocked by robots.txt" warning clear (it should, now that those pages are crawlable).
2. **Regenerate on every catalogue change.** Cheapest reliable wiring: add `npm run seo:generate:live && npm run seo:check` to the Vercel **build command** (or a pre-deploy step) so prices in the SERP can never drift from checkout. Until then, run it by hand after any price/size edit and commit the HTML — generated pages are intentionally committed (`.gitignore` does not exclude them).
3. **`about.html` contradicts the footer.** About says Valmont Data does not advertise on social media, while the homepage footer links Facebook and TikTok. The copy was left as written and those profiles were **excluded** from `Organization.sameAs`; decide which is true and align both.
4. **Reseller storefronts (`/s/<slug>`)** are indexable but get their canonical/title from JavaScript, and they are not in `sitemap.xml` (they cannot be enumerated statically). If store traffic matters, add a small dynamic sitemap endpoint that lists live stores, and consider server-rendering the canonical (an edge function or an API route that returns the shell with the slug baked in).
5. **Product images.** `Product` schema has no `image` because the catalogue has none. Adding one real screenshot/illustration per bundle would unlock richer results; do not use stock art of phones.
6. **Ratings/reviews** — only if they become real (post-delivery review flow). The suite will fail if schema claims them without visible copy.
7. **Ranking note, not a bug:** for a query naming a network *and* a size that network does not sell ("tigo 2gb"), site search ranks the exact size on another network above the named network's nearest sizes; the assistant answers the question explicitly instead. Deliberate — nearest-size boosts are capped so they can never outrank an exact match.

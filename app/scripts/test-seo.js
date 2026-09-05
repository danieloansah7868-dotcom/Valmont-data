#!/usr/bin/env node
/* test-seo.js — the verification suite for the SEO layer.
 *
 * There is no build step in this project, so "does it compile" is answered by
 * `node --check` on every touched script (done in the generator's own run) and
 * by this suite, which checks the thing that actually matters: that the pages on
 * disk are real, indexable, self-consistent and honest.
 *
 *   node scripts/test-seo.js                 # file-level checks
 *   node scripts/test-seo.js --base=http://localhost:8787   # + live HTTP checks
 *
 * Exit code 1 on any failure, so `npm test` catches regressions.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const K = require('../lib/keywords.js');

const ROOT = path.join(__dirname, '..');
const SITE = K.SITE.origin.replace(/\/$/, '');
const CUR = K.SITE.currencySymbol;

let checks = 0, fails = 0;
const section = (t) => console.log('\n── ' + t + ' '.repeat(Math.max(0, 58 - t.length)));
function ok(cond, msg) {
  checks++;
  if (!cond) { fails++; console.log('  ✘ FAIL  ' + msg); }
  else console.log('  ✔ ' + msg);
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/* ---- HTML helpers (regex, because this repo has no build step / no parser) -- */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', middot: '·' };
const decodeEntities = (t) => String(t)
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, name) => (ENTITIES[name.toLowerCase()] !== undefined ? ENTITIES[name.toLowerCase()] : m));
const stripHtml = (h) =>
  decodeEntities(
    h.replace(/<script[\s\S]*?<\/script>/gi, ' ')
     .replace(/<style[\s\S]*?<\/style>/gi, ' ')
     .replace(/<!--[\s\S]*?-->/g, ' ')
     .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
/** Text as a reader sees it — used to prove schema copy is really on the page. */
const norm = (t) => stripHtml(String(t)).replace(/\s+([,.:;!?])/g, '$1').replace(/\s+/g, ' ').trim();
const meta = (h, name) => {
  const m = h.match(new RegExp('<meta[^>]+name=["\']' + name + '["\'][^>]*>', 'i'));
  if (!m) return null;
  const c = m[0].match(/content=["\']([^"\']*)["\']/i);
  return c ? c[1] : '';
};
const canonicalOf = (h) => {
  const m = h.match(/<link[^>]+rel=["\']canonical["\'][^>]*>/i);
  if (!m) return null;
  const href = m[0].match(/href=["\']([^"\']+)["\']/i);
  return href ? href[1] : null;
};
const h1s = (h) => [...h.matchAll(/<h1[\s\S]*?<\/h1>/gi)].map((m) => stripHtml(m[0]));
const titleOf = (h) => (h.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
const jsonld = (h) =>
  [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return { __parseError: String(m[1]).slice(0, 120) }; } });
const flatten = (nodes) => {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n['@type']) out.push(n);
    for (const v of Object.values(n)) walk(v);
  };
  walk(nodes);
  return out;
};
const localLinks = (h) =>
  [...h.matchAll(/href="([^"#]+)(#[^"]*)?"/g)]
    .map((m) => m[1])
    .filter((u) => u.startsWith('/') && !u.startsWith('//'))
    .filter((u) => !/^(\/api\/|\/r\/)/.test(u));
const urlToFile = (u) => {
  const p = u.split('?')[0];
  if (p.endsWith('/')) return p + 'index.html';
  return p;
};
const wordCount = (h) => stripHtml(h).split(' ').filter(Boolean).length;

/* Generated, indexable pages (from the generator's own inventory logic) */
const bundleFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
    const rel = path.join(d, e.name).split(path.sep).join('/');
    if (e.isDirectory()) walk(rel); else if (e.name.endsWith('.html')) bundleFiles.push(rel);
  }
})('bundles');

const generated = bundleFiles.concat(['auto-top-up.html', 'buy-data-on-whatsapp.html', 'network-prefixes.html']);
const handPages = ['index.html', 'faq.html', 'about.html', 'contact.html', 'store.html', 'privacy.html', 'terms.html'];
const noindexPages = ['admin.html', 'dashboard.html', 'history.html', 'status.html', 'otp.html', 'autoreload.html', 'offline.html'];

/* ========================================================================= */
section('1. pages are generated from the catalogue, and still current');
try {
  const apiArg = (process.argv.find((a) => a.startsWith('--api')) || '');
  const args = [path.join(__dirname, 'generate-seo-pages.js'), '--check', '--quiet'];
  if (apiArg) args.push(apiArg);            // check against the same source you generated from
  execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'pipe' });
  ok(true, '`generate-seo-pages.js --check`: every page matches the live catalogue (no drift)');
} catch (e) {
  ok(false, 'pages are stale — re-run `npm run seo:generate`. ' + String(e.stderr || e.message).split('\n').slice(0, 3).join(' | '));
}
ok(generated.length >= 30, `generated page inventory: ${generated.length} pages under /bundles/ and service pages`);
ok(exists('bundles/index.html') && exists('bundles/mtn.html') && exists('bundles/mtn/10gb.html'),
   'hub, network and product URLs all exist on disk');

/* ========================================================================= */
section('2. sitemap ↔ canonical parity (byte for byte)');
const sm = read('sitemap.xml');
const locs = [...sm.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((m) => m[1].trim());
ok(locs.length === new Set(locs).size, `sitemap has ${locs.length} unique <loc> entries`);
let mismatched = 0, noindexInSitemap = 0, missingFile = 0;
for (const loc of locs) {
  const rel = urlToFile(loc.replace(SITE, ''));
  if (rel === '/s/' || rel.startsWith('/s/')) continue;           // reseller storefronts
  if (!exists(rel)) { missingFile++; console.log('    ! sitemap entry has no file: ' + loc); continue; }
  const html = read(rel);
  if (canonicalOf(html) !== loc) { mismatched++; console.log(`    ! ${rel}: canonical ${canonicalOf(html)} ≠ sitemap ${loc}`); }
  const rob = (meta(html, 'robots') || '').toLowerCase();
  if (rob.includes('noindex')) noindexInSitemap++;
}
ok(mismatched === 0, 'every sitemap URL is byte-identical to that page\'s own canonical');
ok(missingFile === 0, 'every sitemap URL resolves to a file that exists');
ok(noindexInSitemap === 0, 'no noindexed page is listed in the sitemap');
for (const p of noindexPages) ok(!locs.includes(SITE + '/' + p), `${p} (noindex) excluded from sitemap`);
for (const p of generated) ok(locs.includes(canonicalOf(read(p))), `${p} is in the sitemap`);

/* ========================================================================= */
section('3. per-page head hygiene');
let titleFails = 0, descFails = 0, h1Fails = 0, canonFails = 0, wordFails = 0, akaFails = 0;
const longTitles = [];
for (const rel of [...generated, ...handPages]) {
  const html = read(rel);
  const t = titleOf(html), d = meta(html, 'description') || '', c = canonicalOf(html), hs = h1s(html);
  if (!(t.length >= 15 && t.length <= 62)) { titleFails++; longTitles.push(`${rel} (${t.length}ch)`); }
  if (!(d.length >= 70 && d.length <= 165)) descFails++;
  const expected = SITE + '/' + rel.replace(/(^|\/)index\.html$/, '$1');   // directory index → trailing-slash URL
  if (c !== expected) { canonFails++; console.log(`    ! ${rel}: canonical ${c} ≠ ${expected}`); }
  if (hs.length !== 1) { h1Fails++; console.log(`    ! ${rel}: ${hs.length} H1 tags`); }
  if (rel.startsWith('bundles/') && wordCount(html) < 150) { wordFails++; console.log(`    ! ${rel}: only ${wordCount(html)} visible words`); }
  if (rel.startsWith('bundles/') && !/also (known|searched) as/i.test(html)) akaFails++;
}
ok(titleFails === 0, `all ${generated.length + handPages.length} titles are 15–62 chars` + (longTitles.length ? ' — ' + longTitles.join(', ') : ''));
ok(descFails === 0, 'all meta descriptions are 70–165 chars');
ok(canonFails === 0, 'every page has a self-referencing absolute canonical');
ok(h1Fails === 0, 'every page has exactly one H1');
ok(wordFails === 0, 'every generated page has ≥150 words of visible copy');
ok(akaFails === 0, 'every generated page shows its "also known as" synonyms');
ok(/<meta name="robots" content="index, follow/.test(read('index.html')), 'homepage is explicitly indexable');
ok(read('bundles/mtn.html').includes('application/ld+json'), 'network page carries JSON-LD');

/* ========================================================================= */
section('4. structured data parses and describes only what is visible');
let ldTotal = 0, typesSeen = new Set(), parseFails = 0, priceFails = 0, fabrications = 0, faqFails = 0, crumbFails = 0;
for (const rel of [...generated, ...handPages]) {
  const html = read(rel);
  const blocks = jsonld(html);
  ldTotal += blocks.length;
  const visible = stripHtml(html);
  const nvisible = norm(html.replace(/<script[\s\S]*?<\/script>/gi, ' '));
  for (const b of blocks) {
    if (b.__parseError) { parseFails++; console.log(`    ! ${rel}: unparseable JSON-LD: ${b.__parseError}`); continue; }
    const nodes = flatten(b);
    nodes.forEach((n) => [].concat(n['@type']).forEach((t) => typesSeen.add(t)));
    // prices in schema must be the real catalogue price AND visible on the page
    nodes.filter((n) => n['@type'] === 'Product').forEach((n) => {
      const price = n.offers && n.offers.price;
      if (price === undefined) return;
      const label = CUR + Number(price).toFixed(2);
      if (!visible.includes(label)) { priceFails++; console.log(`    ! ${rel}: Product price ${label} not visible on the page`); }
      if ((n.offers.priceCurrency || '') !== K.SITE.currency) priceFails++;
    });
    // Nothing invented in a *static* file: no ratings, no reviews, no stock
    // claims. Ratings do exist now, but they are live — assets/js/reviews.js
    // adds aggregateRating/review to the Product node at runtime, from the same
    // /api/reviews response that renders the visible list, and only when at
    // least one verified review is published. A count baked in here would be
    // wrong the moment somebody reviews (or retracts), and wrong schema is
    // worse than none. See scripts/test-reviews.js sections 10-13.
    if (JSON.stringify(b).match(/aggregateRating|"review"|availability|InStock|OutOfStock/i)) {
      fabrications++; console.log(`    ! ${rel}: static schema claims ratings/reviews/availability it cannot prove`);
    }
    // FAQ schema must mirror the visible questions word for word
    nodes.filter((n) => n['@type'] === 'FAQPage').forEach((n) => {
      (n.mainEntity || []).forEach((q) => {
        if (!nvisible.includes(norm(q.name))) { faqFails++; console.log(`    ! ${rel}: FAQ schema question not visible: "${q.name}"`); }
        const a = q.acceptedAnswer && q.acceptedAnswer.text;
        if (!a || !nvisible.includes(norm(a))) { faqFails++; console.log(`    ! ${rel}: FAQ schema answer not visible: "${q.name}"`); }
      });
    });
    if (b['@type'] === 'BreadcrumbList') {
      const items = b.itemListElement || [];
      if (items.length < 2) { crumbFails++; console.log(`    ! ${rel}: breadcrumb with ${items.length} items`); }
      items.forEach((it) => { if (!it.name || !it.item) crumbFails++; });
    }
  }
}
ok(parseFails === 0, `all ${ldTotal} JSON-LD blocks parse`);
ok(priceFails === 0, 'every Product price in schema is visible on the page and in GHS');
ok(fabrications === 0, 'no ratings, reviews or stock availability baked into static schema (live reviews are injected at runtime)');
ok(faqFails === 0, 'every FAQPage question/answer appears verbatim in the visible copy');
ok(crumbFails === 0, 'every BreadcrumbList has named items with URLs');
['CollectionPage', 'ItemList', 'Product', 'BreadcrumbList', 'FAQPage', 'Service', 'Organization', 'ContactPage', 'AboutPage']
  .forEach((t) => ok(typesSeen.has(t), `schema type present somewhere on the site: ${t}`));

/* ========================================================================= */
section('5. internal links resolve, and no filter URLs survive');
let deadLinks = 0, filterLinks = 0;
for (const rel of [...generated, ...handPages, ...noindexPages.filter(exists)]) {
  const html = read(rel);
  for (const u of new Set(localLinks(html))) {
    const target = urlToFile(u);
    if (target === '/sw.js' || target === '/manifest.json') continue;
    if (!exists(target)) {
      // storefront and /s/ are served dynamically — not files
      if (!target.startsWith('/s/')) { deadLinks++; console.log(`    ! ${rel} → ${u} (${target}) does not exist`); }
    }
    if (/[?&](net|size|q)=/.test(u) && !rel.startsWith('bundles/')) {
      // the homepage's own buy deep-links are allowed (they pre-select the form)
      if (rel !== 'index.html') { filterLinks++; console.log(`    ! ${rel} links to filter URL ${u}`); }
    }
  }
}
ok(deadLinks === 0, 'no broken internal links on any page');
ok(filterLinks === 0, 'navigation and cross-links point at canonical pages, not ?net= filters');
ok(/href="\/bundles\/mtn\.html"/.test(read('index.html')), 'homepage nav links to the MTN landing page');
ok(/href="\/bundles\/"/.test(read('faq.html')), 'FAQ cross-links to the catalogue hub');

/* ========================================================================= */
section('6. the vocabulary: every short term has a destination');
const CATS = Object.entries(K.CATEGORIES);            // id → {kind,label,page,terms,phrases}
const demoBundles = require('../lib/demo-data.js').BUNDLES;
const items = demoBundles.map((b) => ({
  network: b.network, size_mb: b.size_mb, price: b.sell,
  validity_days: b.validity_days, label: K.sizeLabel(b.size_mb),
}));
ok(items.length === 24, `catalogue loaded for search tests: ${items.length} bundles`);

/* Every word a human might type that we claim to understand. Category *ids* are
   internal keys, not queries, so they are left out of the expansion test — but
   SITE_TERMS are real queries (including the bare brand name) and must land
   somewhere. */
const allTerms = new Set();
for (const [, c] of CATS) { (c.terms || []).forEach((t) => allTerms.add(t)); (c.phrases || []).forEach((t) => allTerms.add(t)); }
K.SITE_TERMS.forEach((t) => allTerms.add(t));

let dead = [];
for (const t of allTerms) {
  const q = K.expandQuery(t);
  if (!q.categories.length && !q.networks.length && !q.sizes.length) dead.push(t);
}
ok(dead.length === 0, `all ${allTerms.size} vocabulary terms expand to a category, network or size` + (dead.length ? ' — dead: ' + dead.join(', ') : ''));

/* every category a term can reach must be a page that exists on disk */
let ghostPages = [];
for (const [id, c] of CATS) {
  const [pagePath, frag] = String(c.page || '').split('#');
  const rel = urlToFile(pagePath);
  if (!rel || !exists(rel)) { ghostPages.push(`${id} → ${c.page} (no such file)`); continue; }
  if (frag && !new RegExp(`id=["\']${frag}["\']`).test(read(rel))) ghostPages.push(`${id} → ${c.page} (no #${frag} anchor in ${rel})`);
}
ok(ghostPages.length === 0, `all ${CATS.length} vocabulary categories point at a page (and anchor) that exists` + (ghostPages.length ? ' — ' + ghostPages.join(', ') : ''));

/* catalogue-ish terms must return scored bundles; nothing may dead-end */
let emptySearch = [];
for (const t of allTerms) {
  const q = K.expandQuery(t);
  const catalogueish = q.categories.includes('catalogue') || q.networks.length || q.sizes.length ||
    q.categories.some((c) => ['non-expiry', 'rollover', 'cheap', 'big', 'mtn', 'telecel', 'airteltigo'].includes(c));
  if (!catalogueish) continue;
  const r = K.searchCatalogue(t, items, { limit: 3 });
  if (!r.matched || !r.results.length || r.results[0].score <= 0) emptySearch.push(t);
}
ok(emptySearch.length === 0, 'on-site search returns scored results for every catalogue-ish term' + (emptySearch.length ? ' — empty: ' + emptySearch.join(', ') : ''));

/* synonym expansion is a boost, never a hard filter, and exact still wins */
const exact = K.searchCatalogue('mtn 10gb', items).results[0];
ok(exact && exact.item.network === 'mtn' && exact.item.size_mb === 10240, 'exact "mtn 10gb" ranks the MTN 10GB bundle first');
ok(K.searchCatalogue('data', items).matched, 'vague "data" still returns the catalogue');
ok(K.searchCatalogue('zzzqqq', items).results.length === items.length && !K.searchCatalogue('zzzqqq', items).matched,
   'an unmatched query falls back to the full catalogue instead of an empty state');
ok(K.detectNetwork('tigo 2gb') === 'airteltigo', 'detectNetwork: "tigo" is AirtelTigo, not Telecel');
ok(K.detectNetwork('voda') === 'telecel' && K.detectNetwork('vodafone') === 'telecel', 'detectNetwork: voda/vodafone → Telecel');
ok(K.sizeFromText('1.5gb') === 1536 && K.sizeFromText('3072mb') === 3072 && K.sizeFromText('5g data') === null,
   'sizeFromText handles decimals and MB, and refuses to read "5g" as a size');

section('6b. short colloquial queries → destination (the synonym map, printed)');
const spot = ['data', 'bundle', 'megs', 'gb', 'internet', 'data plan', 'mtn', 'at', 'tigo', 'voda', 'vodafone',
              'telecel', 'airteltigo', 'non expiry', 'rollover', 'cheap data', 'big bundle', 'unlimited',
              '1gb', '10gb', '100gb', '3072mb', '1.5gb', '7gb', 'mtn 10gb', 'tigo 2gb', 'voda 20gb', '25gb mtn',
              'reseller', 'markup', 'auto top up', 'whatsapp', 'momo', 'status', 'tracking', 'support', 'prefix'];
let spotFails = 0;
for (const q of spot) {
  const ex = K.expandQuery(q);
  const r = K.searchCatalogue(q, items, { limit: 1 });
  const top = r.results[0];
  const pages = ex.categories.map((c) => K.CATEGORIES[c] && K.CATEGORIES[c].page).filter(Boolean).slice(0, 2).join(' ');
  const bundle = (top && top.score > 0 && top.item) ? `${top.item.network} ${top.item.label} @${top.score}` : '';
  const dest = [pages, bundle].filter(Boolean).join('  +  ') || '— none —';
  if (dest === '— none —') spotFails++;
  console.log(`    ${q.padEnd(13)} → ${dest}${ex.networks.length ? `   [net:${ex.networks.join(',')}]` : ''}${ex.sizes.length ? `   [size:${ex.sizes.join(',')}]` : ''}`);
}
ok(spotFails === 0, 'every spot-checked colloquial query resolves to a real page and/or bundle');

/* ========================================================================= */
section('7. honesty guards (no fabricated claims)');
const homepage = read('index.html');
ok(!/No account needed/i.test(homepage), 'the old "No account needed" claim is gone (accounts are required)');
ok(/<meta name="robots" content="index, follow/.test(read('bundles/mtn.html')), 'landing pages are index,follow');
let stockClaims = 0;
for (const rel of generated) if (/\bin stock\b/i.test(stripHtml(read(rel)))) { stockClaims++; console.log('    ! ' + rel + ' claims stock we cannot prove'); }
ok(stockClaims === 0, 'no page claims stock levels we cannot verify');
ok(!/was\s*GH₵|originalPrice|strike/i.test(read('bundles/mtn.html')), 'no fake "was" prices on landing pages');

section('7b. prices are in the raw HTML (a crawler with no JS can see them)');
const stamp = (read('bundles/mtn.html').match(/catalogue source: ([^\n]*)-->/) || [, ''])[1].trim();
console.log('    pages were generated from: ' + (stamp || 'unknown'));
if (/live API/.test(stamp)) {
  // Prices came from the database, not the seed mirror, so section 4's
  // schema-price == visible-price check is the authority here.
  ok(true, 'pages built from the live API — price parity covered by section 4');
} else {
  const demo = require('../lib/demo-data.js').BUNDLES;
  let priceVisible = 0;
  for (const b of demo) {
    const rel = `bundles/${b.network.toLowerCase()}/${K.sizeSlug(b.size_mb)}.html`;
    if (exists(rel) && read(rel).includes(CUR + Number(b.sell).toFixed(2))) priceVisible++;
    else console.log(`    ! price not found in raw HTML: ${rel} (${CUR}${Number(b.sell).toFixed(2)})`);
  }
  ok(priceVisible === demo.length, `all ${demo.length} seed catalogue prices appear in the raw HTML of their own page`);
}
ok(homepage.includes('Every bundle and price') || /<table/.test(homepage), 'homepage ships a raw HTML price list');

/* ========================================================================= */
section('8. robots.txt does not contradict the pages');
const robots = read('robots.txt');
const disallowed = [...robots.matchAll(/^\s*Disallow:\s*(\S+)/gim)].map((m) => m[1]);
let contradictions = 0;
for (const p of noindexPages) {
  if (disallowed.some((d) => ('/' + p).startsWith(d) && d !== '/')) {
    contradictions++; console.log(`    ! robots.txt blocks /${p} but it relies on a noindex tag Google can't read`);
  }
}
ok(contradictions === 0, 'no noindexed page is also Disallowed in robots.txt');
ok(robots.includes('/api/'), 'robots.txt still blocks /api/');
ok(robots.includes('Sitemap: ' + SITE + '/sitemap.xml'), 'robots.txt advertises the static sitemap');
ok(robots.includes('Sitemap: ' + SITE + '/sitemap-stores.xml'), 'robots.txt advertises the reseller-store sitemap');

/* ========================================================================= */
const baseArg = (process.argv.find((a) => a.startsWith('--base=')) || '').split('=')[1] || process.env.SEO_BASE;

(async () => {
  if (baseArg) {
    section('9. live HTTP checks against ' + baseArg.replace(/\/$/, ''));
    const base = baseArg.replace(/\/$/, '');
    const routes = ['/', '/bundles/', '/bundles/mtn', '/bundles/mtn.html', '/bundles/mtn/10gb', '/bundles/mtn/10gb.html',
                    '/bundles/telecel.html', '/bundles/airteltigo.html', '/bundles/cheap.html', '/bundles/big.html',
                    '/bundles/rollover.html', '/auto-top-up.html', '/buy-data-on-whatsapp.html', '/network-prefixes.html',
                    '/faq.html', '/about.html', '/contact.html', '/store.html', '/sitemap.xml',
                    '/sitemap-stores.xml', '/robots.txt'];
    let bad = 0;
    for (const r of routes) {
      let res, body = '';
      try {
        res = await fetch(base + r, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        body = await res.text();
      } catch (e) { bad++; console.log(`    ! ${r}: request failed — ${e.message}`); continue; }
      if (res.status !== 200) { bad++; console.log(`    ! ${r}: HTTP ${res.status}`); continue; }
      const isDoc = !/\.(xml|txt)$/.test(r);
      if (isDoc) {
        const t = titleOf(body), d = meta(body, 'description') || '';
        const c = canonicalOf(body);
        if (!t) { bad++; console.log(`    ! ${r}: served with no <title>`); }
        if (!d) { bad++; console.log(`    ! ${r}: served with no meta description`); }
        // a clean URL must still canonicalise to the .html form (no duplicate indexing)
        if (c && !r.endsWith('.html') && r !== '/' && !r.endsWith('/') && !c.endsWith(r.split('/').pop() + '.html')) {
          bad++; console.log(`    ! ${r}: clean URL canonicalises to ${c}`);
        }
        console.log(`    ${res.status}  ${r.padEnd(31)} ${t.slice(0, 56).padEnd(57)} ${d.slice(0, 46)}…`);
      } else if (r === '/sitemap-stores.xml') {
        // reseller storefronts are created at runtime, so the list may be empty —
        // but it must be a valid urlset and every <loc> must be a /s/<slug> URL.
        const locs = [...body.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((m) => m[1].trim());
        const bad = locs.filter((u) => !/^https?:\/\/[^/]+\/s\/[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(u));
        if (!/<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/.test(body)) {
          bad++; console.log('    ! /sitemap-stores.xml is not a valid urlset');
        }
        if (bad.length) { bad++; console.log(`    ! /sitemap-stores.xml has ${bad} bad <loc> entries`); }
        console.log(`    ${res.status}  ${r.padEnd(31)} ${locs.length} storefront URL(s), ${body.length} bytes`);
      } else {
        console.log(`    ${res.status}  ${r.padEnd(31)} ${body.length} bytes`);
      }
    }
    ok(bad === 0, `all ${routes.length} routes serve HTTP 200 with their own title, description and canonical`);
  } else {
    section('9. live HTTP checks — skipped');
    console.log('    (start the dev server, then: npm run test:seo -- --base=http://localhost:8787)');
  }

  console.log('\n' + '─'.repeat(64));
  console.log(fails ? `SEO SUITE: ${fails} of ${checks} checks FAILED` : `SEO SUITE: all ${checks} checks passed`);
  console.log('─'.repeat(64));
  process.exit(fails ? 1 : 0);
})();

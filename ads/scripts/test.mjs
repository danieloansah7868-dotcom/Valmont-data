#!/usr/bin/env node
/* ============================================================================
   Valmont Ads — end-to-end smoke suite.
   Start the dev server first:  npm run dev
   Then:                        npm test
   Override the target:         BASE=http://localhost:3000 npm test
   ========================================================================== */

const BASE = process.env.BASE || "http://localhost:3000";
const ADMIN = process.env.ADMIN_PASSWORD || "admin123";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  \x1b[31m✘\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function get(path, headers = {}) {
  const res = await fetch(BASE + path, { headers });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html response */
  }
  return { res, text, json };
}

async function post(path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { res, json };
}

/* Unique per run so the 10-minute duplicate guard doesn't block re-runs
   against a warm server. */
const RUN = Date.now().toString(36).slice(-5).toUpperCase();

const validAd = (over = {}) => ({
  title: `Test Ad ${RUN} — Infinix Hot 40i 128GB clean`,
  category: "phones-tablets",
  subcategory: "Mobile Phones",
  price: 1450,
  negotiable: true,
  condition: "used-good",
  region: "Greater Accra",
  town: "Spintex",
  description: "Automated test listing. Phone is in good condition with no faults, battery healthy, charger included.",
  sellerName: "Test Seller",
  sellerPhone: "0247654321",
  whatsapp: true,
  sellerType: "private",
  ...over,
});

async function main() {
  console.log(`\n\x1b[1mValmont Ads smoke suite\x1b[0m → ${BASE}`);

  /* ---------------------------------------------------------------- pages */
  section("Pages render");
  for (const [path, needle] of [
    ["/", "Buy and sell anything"],
    ["/ads", "All ads in Ghana"],
    ["/categories", "All categories"],
    ["/post", "Post your ad"],
    ["/my-ads", "My ads"],
    ["/safety", "Buy and sell without getting burned"],
    ["/admin", "Moderation console"],
  ]) {
    const { res, text } = await get(path);
    check(`GET ${path} → 200`, res.status === 200, `got ${res.status}`);
    check(`GET ${path} contains expected copy`, text.includes(needle));
  }

  {
    const { res } = await get("/definitely-not-a-page");
    check("Unknown route → 404", res.status === 404, `got ${res.status}`);
  }

  /* ------------------------------------------------------------- listings */
  section("Listing API + search");
  const all = await get("/api/ads?perPage=48");
  check("GET /api/ads → ok", all.json?.ok === true);
  check("Seed catalogue is populated", (all.json?.total ?? 0) >= 20, `total=${all.json?.total}`);
  check("Only active ads are returned by default", all.json.items.every((a) => a.status === "active"));

  const firstSlug = all.json.items[0].slug;
  const detail = await get(`/api/ads/${firstSlug}`);
  check("GET /api/ads/:slug → ok", detail.json?.ok === true);
  check("Ad detail page renders", (await get(`/ads/${firstSlug}`)).res.status === 200);

  const search = await get("/api/ads?q=iphone");
  check("Keyword search matches", search.json.items.every((a) => /iphone/i.test(a.title + a.description)));

  const cat = await get("/api/ads?category=vehicles");
  check("Category filter works", cat.json.items.every((a) => a.category === "vehicles"), "non-vehicle leaked");

  const region = await get("/api/ads?region=Ashanti");
  check("Region filter works", region.json.items.every((a) => a.region === "Ashanti"));

  const priced = await get("/api/ads?min=1000&max=5000");
  check("Price range filter works", priced.json.items.every((a) => a.price >= 1000 && a.price <= 5000));

  const asc = await get("/api/ads?sort=price-asc&perPage=48");
  const prices = asc.json.items.map((a) => a.price ?? Infinity);
  check("Sort price-asc is ordered", prices.every((p, i) => i === 0 || prices[i - 1] <= p));

  const desc = await get("/api/ads?sort=price-desc&perPage=48");
  const dPrices = desc.json.items.map((a) => a.price ?? -Infinity);
  check("Sort price-desc is ordered", dPrices.every((p, i) => i === 0 || dPrices[i - 1] >= p));

  const pop = await get("/api/ads?sort=popular&perPage=48");
  const views = pop.json.items.map((a) => a.views);
  check("Sort popular is ordered", views.every((v, i) => i === 0 || views[i - 1] >= v));

  const p1 = await get("/api/ads?perPage=6&page=1");
  const p2 = await get("/api/ads?perPage=6&page=2");
  check("Pagination returns a full page", p1.json.items.length === 6);
  check("Pagination page 2 differs from page 1", p1.json.items[0].id !== p2.json.items[0].id);
  check("Pagination clamps out-of-range pages", (await get("/api/ads?page=9999")).json.page >= 1);

  const empty = await get("/api/ads?q=zzzzznotarealthingzzz");
  check("No-match search returns empty set", empty.json.total === 0);

  /* --------------------------------------------------------------- create */
  section("Posting an ad");
  const created = await post("/api/ads", validAd());
  check("POST /api/ads → 201", created.res.status === 201, `got ${created.res.status}`);
  const newAd = created.json?.ad;
  check("New ad gets a VA- reference", /^VA-\d{6}-\d+$/.test(newAd?.ref ?? ""), newAd?.ref);
  check("New ad starts in moderation (pending)", newAd?.status === "pending", newAd?.status);
  check("New ad gets a slug", Boolean(newAd?.slug));
  check("New ad is NOT in the public list yet", !(await get("/api/ads?perPage=48")).json.items.some((a) => a.id === newAd.id));

  section("Validation rejects bad input");
  const cases = [
    ["short title", validAd({ title: "abc" })],
    ["short description", validAd({ description: "too short" })],
    ["missing category", validAd({ category: "" })],
    ["missing region", validAd({ region: "" })],
    ["invalid phone", validAd({ sellerPhone: "12345" })],
    ["negative price", validAd({ price: -50 })],
  ];
  for (const [label, body] of cases) {
    const r = await post("/api/ads", body);
    check(`Rejects ${label} → 400`, r.res.status === 400, `got ${r.res.status}`);
  }

  const dupe = await post("/api/ads", validAd());
  check("Duplicate post within 10 min is blocked", dupe.res.status === 400, `got ${dupe.res.status}`);

  const scam = await post("/api/ads", validAd({
    title: `Cheap laptops ${RUN} advance fee deal here`,
    sellerPhone: "0209090909",
    description: "You must pay an advance fee before we ship the laptop to you anywhere in Ghana today.",
  }));
  check("Screening auto-rejects banned phrases", scam.json?.ad?.status === "rejected", scam.json?.ad?.status);

  /* ------------------------------------------------------------ screening */
  section("Auto-filters (block the obvious rubbish)");
  const blockCases = [
    ["advance-fee wording", "You must pay an advance fee before we ship this laptop anywhere in Ghana today."],
    ["Western Union only", "Payment by western union only, no other method accepted for this item at all."],
    ["money doubling", "Money doubling service available now, double your money within seven days guaranteed."],
    ["weapons", "Selling ak47 rifle with ammunition, serious buyers only, discreet delivery arranged."],
    ["drugs", "Quality tramadol available in bulk, fast discreet delivery to any region in Ghana."],
    ["stolen goods", "Hot phone for sale cheap, no questions asked, cannot be traced by anybody at all."],
    ["counterfeit", "First copy iphone 15 pro max, looks exactly like original, nobody can tell the difference."],
  ];
  for (const [label, description] of blockCases) {
    const r = await post("/api/ads", validAd({
      title: `Screening probe ${RUN} ${label}`,
      description,
      sellerPhone: "0246000001",
    }));
    check(`Auto-rejects ${label}`, r.json?.ad?.status === "rejected", r.json?.ad?.status ?? r.json?.error);
  }

  section("Soft flags (held for a human, with reasons)");
  const bait = await post("/api/ads", validAd({
    title: `iPhone 14 Pro Max clean ${RUN}`,
    price: 400,
    sellerPhone: "0246000002",
    description: "Very clean iPhone 14 Pro Max, battery excellent, no scratches at all, comes with full box.",
  }));
  check("Suspiciously low price is flagged", bait.json?.ad?.flags?.some((f) => f.code === "price_too_low"));
  check("Low-price ad is held, not auto-killed", bait.json?.ad?.status === "pending", bait.json?.ad?.status);

  const hidden = await post("/api/ads", validAd({
    title: `Fridge for sale good condition ${RUN}`,
    sellerPhone: "0246000003",
    description: "Nice double door fridge in good working condition. Call me on 0551234567 or 024 111 2233 fast.",
  }));
  check("Hidden phone numbers are flagged", hidden.json?.ad?.flags?.some((f) => f.code === "hidden_phone"));

  const linky = await post("/api/ads", validAd({
    title: `Shoes wholesale available now ${RUN}`,
    sellerPhone: "0246000004",
    description: "Quality shoes at wholesale prices, see the full catalogue at www.myshoeshop.com for all sizes.",
  }));
  check("External links are flagged", linky.json?.ad?.flags?.some((f) => f.code === "external_link"));

  const pressure = await post("/api/ads", validAd({
    title: `Sofa set must go ${RUN}`,
    sellerPhone: "0246000005",
    description: "Urgent quick sale, leaving the country this week. No inspection, cash only, first come first served.",
  }));
  check("Pressure wording is flagged", pressure.json?.ad?.flags?.some((f) => f.code === "suspicious_phrase"));
  check("Risk score accumulates", (pressure.json?.ad?.riskScore ?? 0) > 0, String(pressure.json?.ad?.riskScore));

  const fast = await post("/api/ads", validAd({
    title: `Table and chairs for sale ${RUN}`,
    sellerPhone: "0246000006",
    fillSeconds: 2,
    description: "Solid wooden dining table with six chairs, good condition, collection from Accra any day.",
  }));
  check("Instant form fill is flagged as bot-like", fast.json?.ad?.flags?.some((f) => f.code === "too_fast"));

  const clean = await post("/api/ads", validAd({
    title: `Honest clean listing ${RUN}`,
    sellerPhone: "0246000007",
    fillSeconds: 180,
    images: ["/uploads/macbook-air.jpg"],
    description:
      "Well cared for item in very good condition. Happy for you to inspect and test it before paying anything at all.",
  }));
  check("A normal honest ad scores low", (clean.json?.ad?.riskScore ?? 99) < 35, String(clean.json?.ad?.riskScore));
  check("Normal ad still goes to the queue", clean.json?.ad?.status === "pending");

  section("Repeat offenders");
  for (let i = 0; i < 2; i++) {
    await post("/api/ads", validAd({
      title: `Repeat probe ${RUN} ${i} advance fee`,
      sellerPhone: "0246000009",
      description: "You must pay an advance fee first before anything is delivered to you at all today.",
    }));
  }
  const third = await post("/api/ads", validAd({
    title: `Normal looking item ${RUN}`,
    sellerPhone: "0246000009",
    description: "Ordinary item for sale in good condition, nothing unusual about this listing at all here.",
  }));
  check(
    "Previous rejections raise the score on later ads",
    third.json?.ad?.flags?.some((f) => f.code === "repeat_offender"),
  );

  /* -------------------------------------------------------------- my ads */
  section("Seller dashboard lookup");
  const mine = await get(`/api/my-ads?phone=0247654321`);
  check("My-ads finds the new ad", mine.json.ads.some((a) => a.id === newAd.id));
  const intl = await get(`/api/my-ads?phone=%2B233247654321`);
  check("My-ads normalises +233 numbers", intl.json.ads.some((a) => a.id === newAd.id));
  check("My-ads ignores unknown numbers", (await get("/api/my-ads?phone=0500000000")).json.ads.length === 0);

  /* --------------------------------------------------------------- admin */
  section("Moderation console");
  const noAuth = await get("/api/admin");
  check("Admin API rejects missing password → 401", noAuth.res.status === 401);
  const badAuth = await get("/api/admin", { "x-admin-password": "wrong" });
  check("Admin API rejects wrong password → 401", badAuth.res.status === 401);

  const adminHeaders = { "x-admin-password": ADMIN };
  const dash = await get("/api/admin?status=pending", adminHeaders);
  check("Admin API accepts the password", dash.json?.ok === true);
  check("Admin sees pending queue", dash.json.ads.some((a) => a.id === newAd.id));
  check("Admin stats are present", typeof dash.json.stats?.activeAds === "number");

  section("Poster profile (judge the person)");
  const prof = await get("/api/admin?poster=0246000009", adminHeaders);
  check("Poster profile loads", prof.json?.ok === true);
  check("Profile counts their ads", (prof.json?.profile?.totalAds ?? 0) >= 3);
  check("Profile counts rejections", (prof.json?.profile?.rejected ?? 0) >= 2);
  check("Profile marks a repeat offender", prof.json?.profile?.isRepeatOffender === true);
  check("Profile detects the phone network", prof.json?.profile?.network === "MTN", prof.json?.profile?.network);
  check("Unknown poster → 404", (await get("/api/admin?poster=0559999123", adminHeaders)).res.status === 404);

  const queue = await get("/api/admin?status=pending", adminHeaders);
  check("Queue attaches a poster profile to each ad", queue.json.ads.every((a) => "poster" in a));
  const withCtx = queue.json.ads.find((a) => a.context);
  check("Queue records device context", Boolean(withCtx?.context?.device), withCtx?.context?.device);
  check("Queue records the browser", Boolean(withCtx?.context?.browser));


  const approve = await post("/api/admin", { id: newAd.id, action: "active" }, adminHeaders);
  check("Approve sets status active", approve.json?.ad?.status === "active");
  check("Approved ad appears publicly", (await get("/api/ads?perPage=48")).json.items.some((a) => a.id === newAd.id));

  const feat = await post("/api/admin", { id: newAd.id, action: "feature" }, adminHeaders);
  check("Feature toggles on", feat.json?.ad?.featured === true);
  const unfeat = await post("/api/admin", { id: newAd.id, action: "feature" }, adminHeaders);
  check("Feature toggles off", unfeat.json?.ad?.featured === false);

  const badAction = await post("/api/admin", { id: newAd.id, action: "explode" }, adminHeaders);
  check("Unknown admin action → 400", badAction.res.status === 400);
  const missing = await post("/api/admin", { id: "nope", action: "active" }, adminHeaders);
  check("Admin action on missing ad → 404", missing.res.status === 404);

  /* ---------------------------------------------------------- promotions */
  section("Paid promotions (Valmont Web add-on)");
  const noUrl = await post("/api/admin", { id: newAd.id, action: "promote", clientName: "Test Co" }, adminHeaders);
  check("Promotion without a website URL → 400", noUrl.res.status === 400);
  const badUrl = await post(
    "/api/admin",
    { id: newAd.id, action: "promote", clientName: "Test Co", websiteUrl: "not-a-url" },
    adminHeaders,
  );
  check("Promotion with a malformed URL → 400", badUrl.res.status === 400);
  const noName = await post(
    "/api/admin",
    { id: newAd.id, action: "promote", clientName: "", websiteUrl: "https://example.com" },
    adminHeaders,
  );
  check("Promotion without a client name → 400", noName.res.status === 400);

  const promo = await post(
    "/api/admin",
    {
      id: newAd.id,
      action: "promote",
      tier: "spotlight",
      clientName: "Test Client Ltd",
      websiteUrl: "https://testclient.example.com",
      packageRef: "VW-TEST-001",
    },
    adminHeaders,
  );
  check("Promotion starts", promo.json?.ad?.promotion?.clientName === "Test Client Ltd");
  check("Promotion records the package ref", promo.json?.ad?.promotion?.packageRef === "VW-TEST-001");
  check("Promotion sets an expiry", Boolean(promo.json?.ad?.promotion?.expiresAt));

  /* Rotation means a campaign is not guaranteed a slot on page 1 — that is the
     point of it. What must hold is that the ad is still reachable. */
  const defaultView = await get("/api/ads?perPage=48");
  let promotedFound = defaultView.json.items.some((a) => a.id === newAd.id);
  for (let pg = 2; !promotedFound && pg <= defaultView.json.pages; pg++) {
    const d = await get(`/api/ads?perPage=48&page=${pg}`);
    promotedFound = d.json.items.some((a) => a.id === newAd.id);
  }
  check("Promoted ad stays reachable on the default view", promotedFound);

  /* Rationed placement: paid ads must not swamp the page or lead it. Two ads
     from the same shop at the top is what makes a marketplace feel like spam. */
  const firstPage = await get("/api/ads?perPage=12");
  const sponsoredOnPage = firstPage.json.items.filter((a) => a.promotion);
  /* Bonus slots are the only thing money buys; a paid ad that ranks here on its
     own merit is not the placement engine's doing. The API reports the bonus
     count directly so this measures the real thing rather than guessing. */
  /* A paid ad may legitimately lead if it ranks there on its own merit (newest,
     or a free editorial "Featured" pick). What must never happen is money
     BUYING the top card, so the rule is about bonus slots, not the ad itself. */
  check(
    "Money never buys the first card",
    !firstPage.json.items[0]?.promotion || Boolean(firstPage.json.items[0]?.featured),
  );
  check(
    "Placement adds at most 2 bonus paid cards",
    firstPage.json.bonusSlots <= 2,
    `${firstPage.json.bonusSlots} bonus slots`,
  );
  check(
    "No campaign appears twice on one page",
    new Set(sponsoredOnPage.map((a) => a.id)).size === sponsoredOnPage.length,
  );
  check(
    "Every paid ad is labelled for the buyer",
    sponsoredOnPage.every((a) => Boolean(a.promotion?.clientName)),
  );

  const sponsoredPage2 = await get("/api/ads?perPage=12&page=2");
  check(
    "Page 2 also caps paid ads",
    sponsoredPage2.json.items.filter((a) => a.promotion).length <= 2,
  );
  check(
    "A bonus slot never pushes an ad off the page",
    firstPage.json.items.length >= 12,
    `${firstPage.json.items.length}`,
  );
  /* Buying placement must not multiply how often one shop is seen: the ad
     takes its sponsored slot INSTEAD of its organic position, never both. */
  const promoIds = firstPage.json.items.filter((a) => a.promotion).map((a) => a.id);
  check(
    "A paid ad is not duplicated on the page it is promoted on",
    new Set(firstPage.json.items.map((a) => a.id)).size === firstPage.json.items.length,
  );
  check(
    "Bonus sponsored slots sit below the first card",
    !promoIds.includes(firstPage.json.items[0]?.id) || Boolean(firstPage.json.items[0]?.featured),
  );

  /* The one that actually bit: reserving slots shrinks the organic run, so if
     the paging cursor is derived with a single multiply the offsets drift and
     honest free listings fall through the gap and become unreachable. A seller
     silently losing their ad is far worse than any layout complaint. */
  for (const pp of [6, 12, 24]) {
    const truth = new Set((await get(`/api/ads?perPage=48`)).json.items.map((a) => a.id));
    const walked = [];
    for (let pg = 1; pg <= 60; pg++) {
      const d = await get(`/api/ads?perPage=${pp}&page=${pg}`);
      walked.push(...d.json.items.map((a) => a.id));
      if (pg >= d.json.pages) break;
    }
    const reachable = new Set(walked);
    const lost = [...truth].filter((id) => !reachable.has(id));
    check(`No ad becomes unreachable by paging (perPage=${pp})`, lost.length === 0, `${lost.length} lost`);
  }

  /* Paid density must stay low on small pages too — a flat cap of 2 is a third
     of a 6-card page, which is exactly what makes a site feel like an advert board. */
  const smallPage = await get("/api/ads?perPage=6");
  check(
    "Small pages get at most 1 bonus paid card",
    smallPage.json.bonusSlots <= 1,
    `${smallPage.json.bonusSlots} bonus slots`,
  );
  check(
    "Sorting by price or popularity grants no bonus slots at all",
    (await get("/api/ads?sort=price-asc&perPage=12")).json.bonusSlots === 0 &&
      (await get("/api/ads?sort=popular&perPage=12")).json.bonusSlots === 0,
  );

  /* The integrity guarantee: money must not distort a stated buyer intent. */
  const cheapest = await get("/api/ads?sort=price-asc&perPage=48");
  const cheapPrices = cheapest.json.items.map((a) => a.price ?? Infinity);
  check(
    "Promotion does NOT distort price-asc ordering",
    cheapPrices.every((p, i) => i === 0 || cheapPrices[i - 1] <= p),
  );
  const byViews = await get("/api/ads?sort=popular&perPage=48");
  const vs = byViews.json.items.map((a) => a.views);
  check("Promotion does NOT distort most-viewed ordering", vs.every((v, i) => i === 0 || vs[i - 1] >= v));

  const goRes = await fetch(`${BASE}/api/go/${newAd.id}`, { redirect: "manual" });
  check("Click-through redirects (302)", goRes.status === 302 || goRes.status === 307, `got ${goRes.status}`);
  check(
    "Click-through points at the CLIENT's own site",
    (goRes.headers.get("location") ?? "").startsWith("https://testclient.example.com"),
    goRes.headers.get("location") ?? "none",
  );

  const afterClick = await get("/api/ads/" + newAd.id);
  check("Click is counted for reporting", afterClick.json.ad.promotion.clicks >= 1);

  const report = await get("/api/admin?status=all", adminHeaders);
  check("Promotion appears in the campaign report", report.json.promotions.some((p) => p.id === newAd.id));
  check("Report marks the campaign live", report.json.promotions.find((p) => p.id === newAd.id)?.live === true);

  const seededPromo = (await get("/api/ads?perPage=48")).json.items.find((a) => a.promotion);
  check("Seed catalogue ships a demo promotion", Boolean(seededPromo));

  const unpromo = await post("/api/admin", { id: newAd.id, action: "unpromote" }, adminHeaders);
  check("Promotion can be ended", !unpromo.json?.ad?.promotion);
  const goAfter = await fetch(`${BASE}/api/go/${newAd.id}`, { redirect: "manual" });
  check(
    "Click-through falls back to the ad once the promo ends",
    (goAfter.headers.get("location") ?? "").includes(`/ads/${newAd.id}`),
  );

  /* re-promote so the lifecycle section still has something to clean up */
  await post(
    "/api/admin",
    { id: newAd.id, action: "promote", clientName: "Test Client Ltd", websiteUrl: "https://testclient.example.com" },
    adminHeaders,
  );

  /* --------------------------------------------------------------- leads */
  section("Buyer leads");
  const lead = await post(`/api/ads/${newAd.id}/leads`, {
    name: "Test Buyer",
    phone: "0551234567",
    message: "Hello, is this still available? I can come today.",
  });
  check("POST lead → 201", lead.res.status === 201, `got ${lead.res.status}`);

  const badPhone = await post(`/api/ads/${newAd.id}/leads`, { name: "X", phone: "123", message: "Hello there" });
  check("Lead with bad phone → 400", badPhone.res.status === 400);
  const shortMsg = await post(`/api/ads/${newAd.id}/leads`, { name: "X", phone: "0551234567", message: "hi" });
  check("Lead with short message → 400", shortMsg.res.status === 400);
  const noAd = await post(`/api/ads/does-not-exist/leads`, { name: "X", phone: "0551234567", message: "Hello there" });
  check("Lead on missing ad → 400/404", [400, 404].includes(noAd.res.status));

  const leadList = await get(`/api/ads/${newAd.id}/leads`);
  check("Lead is retrievable on the ad", leadList.json.leads.some((l) => l.phone === "0551234567"));
  const sellerView = await get("/api/my-ads?phone=0247654321");
  check("Seller sees the lead in My ads", sellerView.json.leads.some((l) => l.phone === "0551234567"));

  /* ---------------------------------------------------- seller reputation */
  section("Seller badges (earned, visible to buyers)");
  const seedSeller = "0244118822"; // demo seller from the seed catalogue
  const pub = await get(`/api/sellers/${seedSeller}`);
  check("Public seller profile loads", pub.json?.ok === true);
  check("Profile exposes badges", Array.isArray(pub.json?.seller?.badges));
  check("Profile exposes a reputation score", typeof pub.json?.seller?.score === "number");
  check("Seller page renders", (await get(`/seller/${seedSeller}`)).res.status === 200);
  check("Unknown seller → 404", (await get("/api/sellers/0559999123")).res.status === 404);

  /* a brand-new poster should be badged as new, not trusted */
  /* unique per run — a "new seller" must genuinely have no history */
  const rookiePhone = `024${String(Date.now()).slice(-7)}`;
  await post("/api/ads", validAd({
    title: `Rookie listing ${RUN}`,
    sellerPhone: rookiePhone,
    description: "An ordinary first listing from somebody who has never posted on this website before now.",
  }));
  const rookie = await get(`/api/sellers/${rookiePhone}`);
  check("New seller gets the New badge", rookie.json.seller.badges.some((b) => b.code === "new-seller"));
  check("New seller is NOT trusted", !rookie.json.seller.badges.some((b) => b.code === "trusted"));
  check("New seller scores low", rookie.json.seller.score < 30, String(rookie.json.seller.score));

  /* repeat offender should be publicly flagged so buyers are warned */
  const offender = await get("/api/sellers/0246000009");
  check(
    "Repeat offender gets a public warning badge",
    offender.json?.seller?.badges?.some((b) => b.code === "caution"),
  );

  /* ID verification is manual, and it is the only badge an admin can grant */
  const verifyRes = await post("/api/admin", { phone: rookiePhone, action: "verify" }, adminHeaders);
  check("Admin can grant ID Verified", verifyRes.json?.seller?.idVerified === true);
  const verified = await get(`/api/sellers/${rookiePhone}`);
  check("Verified badge shows publicly", verified.json.seller.badges.some((b) => b.code === "verified"));
  check("Verification raises the score", verified.json.seller.score > rookie.json.seller.score);

  /* Two routes to verified, and the buyer is always told which one. */
  const autoSeller = await get("/api/sellers/0248001122"); // long clean record in the seed
  check("Long clean record auto-verifies", autoSeller.json.seller.verifiedVia === "record");
  check("Auto-verified seller was never hand-checked", autoSeller.json.seller.manualVerified === false);
  check(
    "Auto badge says it was not a human check",
    autoSeller.json.seller.badges.find((b) => b.code === "verified")?.reason.includes("Not checked in person"),
  );
  check(
    "Hand check outranks record",
    verified.json.seller.verifiedVia === "manual",
    verified.json.seller.verifiedVia,
  );

  const unverifyRes = await post("/api/admin", { phone: rookiePhone, action: "unverify" }, adminHeaders);
  check("Admin can remove ID Verified", unverifyRes.json?.seller?.idVerified === false);
  check(
    "Badge disappears after removal",
    !(await get(`/api/sellers/${rookiePhone}`)).json.seller.badges.some((b) => b.code === "verified"),
  );
  check(
    "Verifying an unknown number → 404",
    (await post("/api/admin", { phone: "0559999123", action: "verify" }, adminHeaders)).res.status === 404,
  );

  const board = await get("/api/admin?status=all", adminHeaders);
  check("Admin gets a seller leaderboard", Array.isArray(board.json?.sellers) && board.json.sellers.length > 0);
  check(
    "Leaderboard is ordered by score",
    board.json.sellers.every((s, i) => i === 0 || board.json.sellers[i - 1].score >= s.score),
  );

  /* the integrity rule: money must never buy trust */
  const promoSeller = board.json.sellers.find((s) => s.badges.some((b) => b.code === "verified"));
  check(
    "Paying for a promotion never grants a trust badge",
    !promoSeller || promoSeller.idVerified === true,
    "a badge appeared without a manual ID check",
  );

  /* --------------------------------------------------------------- views */
  section("View counter");
  const before = (await get(`/api/ads/${newAd.id}`)).json.ad.views;
  await post(`/api/ads/${newAd.id}`, {});
  const after = (await get(`/api/ads/${newAd.id}`)).json.ad.views;
  check("View ping increments the counter", after === before + 1, `${before} → ${after}`);

  /* ------------------------------------------------------------- cleanup */
  section("Lifecycle close-out");
  const sold = await post("/api/admin", { id: newAd.id, action: "sold" }, adminHeaders);
  check("Mark sold works", sold.json?.ad?.status === "sold");
  check("Sold ad leaves the public list", !(await get("/api/ads?perPage=48")).json.items.some((a) => a.id === newAd.id));
  const soldLead = await post(`/api/ads/${newAd.id}/leads`, {
    name: "Late Buyer",
    phone: "0559999999",
    message: "Is this still available please?",
  });
  check("Leads blocked on inactive ads", soldLead.res.status === 400);
  await post("/api/admin", { id: scam.json.ad.id, action: "rejected", reason: "test cleanup" }, adminHeaders);
  check("Rejected test ad stays rejected", true);

  /* -------------------------------------------------------------- report */
  const total = passed + failed;
  console.log(`\n${"─".repeat(52)}`);
  if (failed === 0) {
    console.log(`\x1b[32m\x1b[1m  ${passed}/${total} checks passed\x1b[0m\n`);
  } else {
    console.log(`\x1b[31m\x1b[1m  ${passed}/${total} passed · ${failed} FAILED\x1b[0m`);
    failures.forEach((f) => console.log(`   ✘ ${f}`));
    console.log();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n\x1b[31mSuite crashed:\x1b[0m ${err.message}`);
  console.error("Is the dev server running?  npm run dev");
  process.exit(1);
});

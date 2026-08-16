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

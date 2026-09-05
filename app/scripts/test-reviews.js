#!/usr/bin/env node
/* test-reviews.js — the verified-purchase review suite.
 *
 * Two halves, because the feature has two failure modes worth catching:
 *
 *   1. LIVE (the API contract). Boots its own dev server on a private port with
 *      a clean in-memory database, then walks the whole story: a guest cannot
 *      review, a signed-in customer cannot review something they have not had
 *      delivered, a pending order is not a purchase, a delivered one is — and
 *      once it is, the review, the aggregate, the "Verified buyer" mark, the
 *      edit path, the retraction path and the moderation path all behave.
 *      Boots its own server so the numbers are never inherited from whatever
 *      state a previous run left behind.
 *
 *   2. STATIC (the honesty contract). Every generated product page carries the
 *      reviews mount for the bundle it is actually about, carries no rating
 *      schema of its own, and the widget only injects schema from a response
 *      that also produced the visible list. This is the half that keeps a
 *      future edit from baking "4.9 ★ (2,140 reviews)" into a page nobody has
 *      reviewed.
 *
 *   node scripts/test-reviews.js                        # boots its own server
 *   node scripts/test-reviews.js --base=http://localhost:8787   # use a running one
 *
 * Exit code 1 on any failure. Zero dependencies, like everything else here.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const K = require("../lib/keywords.js");
const { BUNDLES } = require("../lib/demo-data.js");

const PORT = Number(process.env.REVIEWS_TEST_PORT || 8799);
const explicitBase =
  (process.argv.find((a) => a.startsWith("--base=")) || "").split("=")[1] || process.env.REVIEWS_BASE;
const BASE = (explicitBase || `http://127.0.0.1:${PORT}`).replace(/\/$/, "");
const OWN_SERVER = !explicitBase;

let checks = 0;
let fails = 0;
const section = (t) => console.log("\n── " + t + " ".repeat(Math.max(0, 58 - t.length)));
function ok(cond, msg) {
  checks++;
  if (!cond) { fails++; console.log("  ✘ FAIL  " + msg); }
  else console.log("  ✔ " + msg);
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const money = (n) => K.SITE.currencySymbol + Number(n).toFixed(2);

/* -------------------------------------------------------------------------- */
/* HTTP helpers                                                                */
/* -------------------------------------------------------------------------- */

let TOKEN = null; // set per-request by auth()

async function call(method, urlPath, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + urlPath, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, ok: res.ok, data: data || {}, headers: res.headers };
}
const get = (p, token) => call("GET", p, undefined, token);
const post = (p, body, token) => call("POST", p, body, token);
const del = (p, token) => call("DELETE", p, undefined, token);

/** Sign and post a Valmont-Pay charge.success webhook — the real delivery path. */
async function deliver(reference) {
  const order = (await get("/api/orders?reference=" + encodeURIComponent(reference))).data.order;
  if (!order) throw new Error("order not found: " + reference);
  const payload = {
    event: "charge.success",
    data: {
      reference,
      status: "success",
      amount: Number(order.amount),
      currency: "GHS",
      channel: "mobile_money",
      paid_at: new Date().toISOString(),
      merchant: "valmontdata",
      gateway_reference: "VP-TEST-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    },
  };
  const raw = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha512", process.env.VALMONTPAY_WEBHOOK_SECRET || "dev-webhook-secret")
    .update(raw)
    .digest("hex");
  const res = await fetch(BASE + "/api/valmontpay/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "ValmontPay-Webhook/1.0",
      "x-valmontpay-tenant": "valmontdata",
      "x-valmontpay-event": "charge.success",
      "x-valmontpay-signature": signature,
    },
    body: raw,
    signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/** Kill the server we booted and wait for the port to actually go away. */
async function shutdown(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const deadline = Date.now() + 4000;
  while (child.exitCode === null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function waitForServer(timeoutMs = 25000) {
  const started = Date.now();
  let lastErr = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(BASE + "/api/bundles", { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("server at " + BASE + " never became ready" + (lastErr ? " (" + lastErr.message + ")" : ""));
}

/* -------------------------------------------------------------------------- */
/* the live contract                                                           */
/* -------------------------------------------------------------------------- */

async function liveChecks() {
  // Bundle ids belong to the running database, so look them up rather than
  // hard-coding them (the seed order is an implementation detail).
  const catalogue = (await get("/api/bundles")).data.bundles || [];
  const byKey = {};
  for (const b of catalogue) byKey[b.network + ":" + Number(b.size_mb)] = b;
  const bundleOf = (net, size) => byKey[net + ":" + size];
  ok(catalogue.length === BUNDLES.length, `catalogue served: ${catalogue.length} bundles`);
  const MTN_10GB = bundleOf("mtn", 10240);
  const MTN_1GB = bundleOf("mtn", 1024);
  const TEL_10GB = bundleOf("telecel", 10240);
  ok(Boolean(MTN_10GB && MTN_1GB && TEL_10GB), "the three bundles this suite uses are on sale");
  const listUrl = "/api/reviews?network=mtn&size_mb=10240";

  /* --- admin + float so an MTN order can actually be placed --------------- */
  const adminLogin = await post("/api/admin/login", { password: process.env.ADMIN_PASSWORD || "admin123" });
  const ADMIN = adminLogin.data.token;
  ok(Boolean(ADMIN), "admin login issued a token (needed to top up float)");
  await post("/api/admin/float/topup", { network: "mtn", amount: 500 }, ADMIN);
  await post("/api/admin/float/topup", { network: "telecel", amount: 200 }, ADMIN);

  /* --- 1. an unreviewed bundle claims nothing ----------------------------- */
  section("1. before anybody has bought: no reviews, no rating");
  const empty = await get(listUrl);
  ok(empty.status === 200, `GET ${listUrl} → 200`);
  ok(empty.data.ok === true, "response is ok:true");
  ok(Array.isArray(empty.data.reviews) && empty.data.reviews.length === 0, "review list is empty (not seeded, not invented)");
  ok(empty.data.summary.count === 0, "summary.count is 0");
  ok(Number(empty.data.summary.average) === 0, "summary.average is 0");
  ok(empty.data.network === "mtn" && Number(empty.data.size_mb) === 10240, "response echoes the bundle it is about");
  ok(!JSON.stringify(empty.data).match(/aggregateRating/i), "no rating vocabulary in an empty response");
  ok((empty.headers.get("cache-control") || "").includes("s-maxage"), "public list is cacheable by the CDN");

  const noParams = await get("/api/reviews");
  ok(noParams.status === 400, "GET without network/size_mb → 400");
  ok((await get("/api/reviews?network=vodafone&size_mb=1024")).status === 404, "unknown network → 404");
  ok((await get("/api/reviews?network=mtn&size_mb=999999")).status === 404, "size we do not sell → 404");

  /* --- 2. gating ---------------------------------------------------------- */
  section("2. who is allowed to write a review");
  ok((await post("/api/reviews", { network: "mtn", size_mb: 10240, rating: 5 })).status === 401, "guest POST → 401");
  ok((await del("/api/reviews?id=1")).status === 401, "guest DELETE → 401");

  const signUp = async (name, phone, email) =>
    (await post("/api/auth/customer", { name, phone, pin: "1234", email })).data.token;

  const AMA = await signUp("Ama Reviewer", "0249990101", "ama.reviewer@example.com");
  const KWAME = await signUp("Kwame Buyer", "0249990102", "kwame.buyer@example.com");
  ok(Boolean(AMA) && Boolean(KWAME), "two customer accounts created");

  const refused = await post(
    "/api/reviews",
    { network: "mtn", size_mb: 10240, rating: 5, title: "Amazing", body: "Never even bought it" },
    AMA
  );
  ok(refused.status === 403, "signed-in customer with no purchase → 403");
  ok(/verified purchase/i.test(refused.data.error || ""), "403 explains the verified-purchase rule: " + JSON.stringify(refused.data.error));

  const youBefore = await get(listUrl, AMA);
  ok(youBefore.data.you && youBefore.data.you.signed_in === true, "authed GET includes a `you` block");
  ok(youBefore.data.you.can_review === false, "you.can_review is false without a delivered order");
  ok(youBefore.data.you.reason === "no-delivered-order", "you.reason says no-delivered-order");
  ok((youBefore.headers.get("cache-control") || "") === "no-store", "authed read is no-store (never shared-cached)");

  /* --- 3. a pending order is not a purchase ------------------------------- */
  section("3. an order that has not delivered yet is not a purchase");
  const pendingOrder = await post("/api/orders", { bundle_id: MTN_10GB.id, phone: "0249990101" }, AMA);
  const PENDING_REF = pendingOrder.data.reference;
  ok(pendingOrder.status < 300 && Boolean(PENDING_REF), "order placed (reference " + PENDING_REF + ")");
  ok((await get("/api/orders?reference=" + PENDING_REF)).data.order.status === "pending", "order is pending before payment");
  ok(
    (await post("/api/reviews", { network: "mtn", size_mb: 10240, rating: 5 }, AMA)).status === 403,
    "reviewing a pending order → 403"
  );

  /* --- 4. delivered: now it counts ---------------------------------------- */
  section("4. after delivery the verified buyer can review");
  const delivered = await deliver(PENDING_REF);
  ok(delivered.status === 200, "signed payment webhook accepted (HTTP " + delivered.status + ")");
  ok((await get("/api/orders?reference=" + PENDING_REF)).data.order.status === "delivered", "order is now delivered");

  const PHONE_IN_BODY = "0249990101";
  const created = await post(
    "/api/reviews",
    {
      network: "mtn",
      size_mb: 10240,
      rating: 5,
      title: "Landed before I closed the app",
      body: "Paid with MoMo and the 10GB was on " + PHONE_IN_BODY + " inside a minute. Price was exactly " + money(MTN_10GB.price) + ", no surprises.",
    },
    AMA
  );
  ok(created.status === 201, "POST from a verified buyer → 201");
  ok(created.data.created === true, "response says a review was created");
  ok(created.data.review.verified === true, "the review is flagged verified");

  const one = await get(listUrl);
  ok(one.data.reviews.length === 1, "the bundle now lists exactly one review");
  ok(one.data.summary.count === 1, "summary.count is 1 — the same one review that is listed");
  ok(Number(one.data.summary.average) === 5, "summary.average is 5");
  ok(one.data.summary.histogram["5"] === 1 && one.data.summary.histogram["1"] === 0, "histogram matches the single 5-star review");
  ok(one.data.reviews[0].author === "Ama", "author is a first name only, not the full name");
  ok(Boolean(one.data.reviews[0].order_reference), "the review carries the order reference that verified it");
  ok(!JSON.stringify(one.data).includes(PHONE_IN_BODY), "a phone number typed into a review is scrubbed, not published");
  ok(/number removed/i.test(one.data.reviews[0].body || ""), "scrubbed text is marked, not silently dropped");
  ok(!/email|@example\.com/i.test(JSON.stringify(one.data.reviews)), "no contact details leak into the public list");

  const you = await get(listUrl, AMA);
  ok(you.data.you.can_review === true, "you.can_review is true after delivery");
  ok(you.data.you.already_reviewed === true, "you.already_reviewed is true");
  ok(you.data.you.review && you.data.you.review.rating === 5, "your own review is returned so the form can be pre-filled");
  ok(you.data.you.order_reference === PENDING_REF, "you.order_reference names the delivered order");

  /* --- 5. one review per customer per bundle ------------------------------ */
  section("5. one review per customer per bundle — posting again edits");
  const edited = await post("/api/reviews", { network: "mtn", size_mb: 10240, rating: 4, title: "Still quick", body: "" }, AMA);
  ok(edited.status === 200 && edited.data.created === false, "second POST → 200 with created:false (an edit, not a duplicate)");
  const afterEdit = await get(listUrl);
  ok(afterEdit.data.reviews.length === 1, "still exactly one review from that customer");
  ok(Number(afterEdit.data.summary.average) === 4, "the aggregate moved to 4 — it is computed, not cached");
  ok(afterEdit.data.reviews[0].title === "Still quick", "the edit replaced the title");
  ok(afterEdit.data.reviews[0].body === "", "the edit cleared the body");

  /* --- 6. validation ------------------------------------------------------ */
  section("6. validation");
  for (const bad of [6, 0, -1, 4.5, "great", null, undefined]) {
    const r = await post("/api/reviews", { network: "mtn", size_mb: 10240, rating: bad }, AMA);
    ok(r.status === 400, "rating " + JSON.stringify(bad) + " → 400");
  }
  ok((await post("/api/reviews", { network: "mtn", size_mb: 10240, rating: 5 }, AMA)).status === 200, "a valid edit still succeeds after the rejected ones");
  const longTitle = await post("/api/reviews", { network: "mtn", size_mb: 10240, rating: 5, title: "x".repeat(120) }, AMA);
  ok(longTitle.status === 200 && longTitle.data.review.title.length === 80, "an over-long title is capped at 80 characters");
  const longBody = await post("/api/reviews", { network: "mtn", size_mb: 10240, rating: 5, title: "t", body: "y".repeat(900) }, AMA);
  ok(longBody.status === 200 && longBody.data.review.body.length === 600, "an over-long body is capped at 600 characters");
  ok((await post("/api/reviews", { network: "mtn", size_mb: 999999, rating: 5 }, AMA)).status === 404, "reviewing a bundle we do not sell → 404");

  /* restore a clean, known state for the aggregate checks that follow */
  await post(
    "/api/reviews",
    { network: "mtn", size_mb: 10240, rating: 5, title: "Landed before I closed the app", body: "Ten gigabytes on the line in under a minute, at the price the site showed." },
    AMA
  );

  /* --- 7. bundles are isolated -------------------------------------------- */
  section("7. a purchase verifies that bundle, not the whole catalogue");
  const smallOrder = await post("/api/orders", { bundle_id: MTN_1GB.id, phone: "0249990102" }, KWAME);
  await deliver(smallOrder.data.reference);
  ok((await post("/api/reviews", { network: "mtn", size_mb: 1024, rating: 3, title: "Fine for a day" }, KWAME)).status === 201, "buyer of 1GB can review 1GB → 201");
  ok((await post("/api/reviews", { network: "mtn", size_mb: 10240, rating: 5 }, KWAME)).status === 403, "buyer of 1GB cannot review 10GB → 403");
  ok((await post("/api/reviews", { network: "telecel", size_mb: 10240, rating: 5 }, KWAME)).status === 403, "cannot review another network's bundle → 403");
  const small = await get("/api/reviews?network=mtn&size_mb=1024");
  ok(small.data.reviews.length === 1 && small.data.summary.count === 1, "the 1GB page shows only the 1GB review");
  ok(Number(small.data.summary.average) === 3, "the 1GB average is 3, untouched by the 10GB review");
  ok((await get("/api/reviews?network=telecel&size_mb=10240")).data.summary.count === 0, "a bundle nobody reviewed still reports 0");
  ok((await get(listUrl)).data.reviews.length === 1, "the 10GB list is still one review");

  /* --- 8. retraction and moderation --------------------------------------- */
  section("8. retracting and moderating hides a review without deleting it");
  const reviewId = (await get(listUrl)).data.reviews[0].id;
  const smallId = small.data.reviews[0].id;
  ok((await del("/api/reviews?id=" + reviewId, KWAME)).status === 403, "another customer cannot retract your review → 403");
  ok((await del("/api/reviews?id=" + reviewId, AMA)).status === 200, "the author can retract their own review → 200");
  const retracted = await get(listUrl);
  ok(retracted.data.reviews.length === 0 && retracted.data.summary.count === 0, "a retracted review disappears from the list and the aggregate");
  ok((await get(listUrl, AMA)).data.you.can_review === true, "the verified buyer may review again after retracting");

  const reposted = await post("/api/reviews", { network: "mtn", size_mb: 10240, rating: 2, title: "Slower this time" }, AMA);
  ok(reposted.status === 200 && reposted.data.created === false, "re-reviewing after a retraction revives the same row → 200 (no duplicate)");
  ok(reposted.data.review.id === reviewId, "the revived review keeps its original id — the history survives");
  const hiddenId = reposted.data.review.id;
  ok((await del("/api/reviews?id=" + hiddenId, AMA)).status === 200, "author retraction of the new review → 200");
  ok((await del("/api/reviews?id=999999", ADMIN)).status === 404, "admin removal of an unknown id → 404");
  ok((await del("/api/reviews?id=" + smallId, ADMIN)).status === 200, "admin can hide any review → 200");
  ok((await get("/api/reviews?network=mtn&size_mb=1024")).data.summary.count === 0, "the moderated review is gone from the public list");

  /* --- 9. two verified buyers, one aggregate ------------------------------ */
  section("9. the aggregate is the average of the reviews that are published");
  await post("/api/reviews", { network: "mtn", size_mb: 10240, rating: 5, title: "Fast" }, AMA);
  const k10 = await post("/api/orders", { bundle_id: MTN_10GB.id, phone: "0249990102" }, KWAME);
  await deliver(k10.data.reference);
  await post("/api/reviews", { network: "mtn", size_mb: 10240, rating: 4, title: "Good" }, KWAME);
  const two = await get(listUrl);
  ok(two.data.reviews.length === 2, "two verified buyers → two reviews");
  ok(two.data.summary.count === 2, "count is 2");
  ok(Math.abs(Number(two.data.summary.average) - 4.5) < 0.001, "average is 4.5 (5 and 4)");
  ok(two.data.summary.histogram["5"] === 1 && two.data.summary.histogram["4"] === 1, "histogram shows one 5-star and one 4-star");
  ok(new Set(two.data.reviews.map((r) => r.author)).size === 2, "the two reviews show two different first names");
  ok(two.data.reviews.every((r) => r.verified === true), "every listed review is verified");
  ok(TEL_10GB && (await get("/api/reviews?network=telecel&size_mb=10240")).data.summary.count === 0, "the Telecel 10GB bundle is still unreviewed");
}

/* -------------------------------------------------------------------------- */
/* the static contract                                                         */
/* -------------------------------------------------------------------------- */

function staticChecks() {
  section("10. every generated product page carries its own reviews mount");
  const productPages = BUNDLES.map((b) => "bundles/" + b.network + "/" + K.sizeSlug(b.size_mb) + ".html");
  let mountFails = 0;
  let scriptFails = 0;
  let mismatch = 0;
  let bakedRating = 0;
  let policyFails = 0;

  for (const rel of productPages) {
    if (!exists(rel)) { mountFails++; console.log("    ! missing page: " + rel); continue; }
    const html = read(rel);
    const mount = html.match(/<div class="reviews-mount"([^>]*)>/);
    if (!mount) { mountFails++; console.log("    ! " + rel + ": no .reviews-mount"); continue; }
    const net = (mount[1].match(/data-network="([^"]*)"/) || [, ""])[1];
    const size = (mount[1].match(/data-size-mb="([^"]*)"/) || [, ""])[1];
    const bundle = BUNDLES.find((b) => b.network === net && Number(b.size_mb) === Number(size));
    if (!bundle) { mismatch++; console.log("    ! " + rel + ": mount points at " + net + "/" + size + ", which is not in the catalogue"); continue; }
    if ("bundles/" + bundle.network + "/" + K.sizeSlug(bundle.size_mb) + ".html" !== rel) {
      mismatch++; console.log("    ! " + rel + ": mount says " + net + " " + size + "MB, page is a different bundle");
    }
    if (!/data-label="[^"]+"/.test(mount[1])) { mismatch++; console.log("    ! " + rel + ": mount has no data-label"); }
    if (!html.includes('<script src="/assets/js/reviews.js" defer></script>')) { scriptFails++; console.log("    ! " + rel + ": reviews.js is not loaded"); }
    // the page must not carry a rating of its own — the widget injects it live
    const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
    if (/aggregateRating|"review"|ratingValue/i.test(ld)) { bakedRating++; console.log("    ! " + rel + ": static JSON-LD contains a rating"); }
    if (!/verified purchase/i.test(html)) { policyFails++; console.log("    ! " + rel + ": no visible verified-purchase wording"); }
  }

  ok(mountFails === 0, `all ${productPages.length} product pages have a reviews mount`);
  ok(mismatch === 0, "every mount points at the bundle its page is about");
  ok(scriptFails === 0, "every product page loads assets/js/reviews.js");
  ok(bakedRating === 0, "no product page bakes a rating or review count into its static schema");
  ok(policyFails === 0, "every product page states the verified-purchase rule in visible copy");
  ok(!/<div class="reviews-mount"/.test(read("bundles/mtn.html")), "network hub pages do not carry a mount (they list bundles, they are not one)");
  ok(!/<div class="reviews-mount"/.test(read("index.html")), "the homepage does not carry a mount");

  section("11. the widget cannot claim a rating it is not showing");
  const js = read("assets/js/reviews.js");
  ok(/Number\(data\.summary\.count\)\s*>\s*0/.test(js), "schema injection is gated on summary.count > 0");
  ok(/delete product\.aggregateRating/.test(js), "an empty response removes any previously injected rating");
  ok(/"@type": "AggregateRating"/.test(js) && /ratingValue: String\(data\.summary\.average\)/.test(js), "the injected ratingValue comes from the same response as the list");
  ok(/product\.review = data\.reviews\.map/.test(js), "the injected review[] is the same array that is rendered");
  ok(!/localhost|127\.0\.0\.1/.test(js), "the widget fetches a relative URL (no hard-coded host)");
  ok(js.includes('"/api/reviews?network="'), "the widget calls /api/reviews with network + size_mb");
  ok(/function esc\(/.test(js) && /esc\(r\.body\)/.test(js) && /esc\(r\.author\)/.test(js), "reviewer-supplied text and names are escaped before hitting the DOM");
  ok(/Verified buyer/.test(js), 'the visible "Verified buyer" mark is rendered by the widget');
  const R = require("../lib/reviews.js");
  ok(js.includes('maxlength="' + R.MAX_TITLE + '"'), `the widget's title limit is the server's (${R.MAX_TITLE})`);
  ok(js.includes('maxlength="' + R.MAX_BODY + '"'), `the widget's body limit is the server's (${R.MAX_BODY})`);
  ok(R.scrub("call me on 0241234567 ok") === "call me on [number removed] ok", "the scrubber removes a Ghana mobile number from review text");
  ok(R.scrub("GH₵52.00 and 10GB") === "GH₵52.00 and 10GB", "the scrubber leaves prices and sizes alone");
  ok(R.summarise([]).count === 0 && R.summarise([]).average === 0, "an empty list summarises to zero, not to a number");
  ok(R.summarise([{ rating: 5 }, { rating: 4 }]).average === 4.5, "the aggregate is the mean of the ratings it is given");
  ok(R.summarise([{ rating: 5 }, { rating: 99 }]).count === 1, "an out-of-range rating is ignored, never averaged in");
  ok(/\/signin\.html/.test(js) && /\/history\.html/.test(js), "a customer who cannot review is told why and given a way in");

  section("12. the table exists in all three places that must agree");
  ok(exists("supabase/migrations/2026-09-04_product_reviews.sql"), "migration file is committed");
  const migration = read("supabase/migrations/2026-09-04_product_reviews.sql");
  const schema = read("supabase/schema.sql");
  const mock = read("lib/supabase.js");
  for (const [name, src] of [["migration", migration], ["schema.sql", schema]]) {
    ok(/create table if not exists public\.product_reviews/.test(src), name + " creates product_reviews idempotently");
    ok(/unique \(bundle_id, customer_id\)/.test(src), name + " enforces one review per customer per bundle");
    ok(/rating between 1 and 5/.test(src), name + " constrains the rating to 1..5");
    ok(/status in \('published','removed'\)/.test(src), name + " allows hiding a review instead of deleting it");
    ok(/enable row level security/.test(src), name + " turns on RLS");
  }
  ok(/product_reviews_public_read/.test(schema) && /using \(status = 'published'\)/.test(schema), "RLS exposes published rows only");
  ok(/product_reviews: \[\]/.test(mock) && /product_reviews: 0/.test(mock), "the mock database has the table and its id sequence");
  ok(/duplicate key value violates unique constraint on product_reviews/.test(mock), "the mock enforces the same uniqueness as Postgres");
  const routes = read("scripts/dev-server.js");
  ok(/"GET \/api\/reviews": accountRouter/.test(routes) && /"POST \/api\/reviews": accountRouter/.test(routes) && /"DELETE \/api\/reviews": accountRouter/.test(routes), "the dev server routes all three review verbs");
  const rewrites = JSON.parse(read("vercel.json"));
  ok(rewrites.rewrites.some((r) => r.source === "/api/reviews" && /account\?section=reviews/.test(r.destination)), "vercel.json rewrites /api/reviews into the merged account function (still 12 functions or fewer)");
  const apiFiles = (function walk(dir) {
    const out = [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = dir + "/" + e.name;
      if (e.isDirectory()) out.push(...walk(rel));
      else if (e.name.endsWith(".js")) out.push(rel);
    }
    return out;
  })("api");
  ok(apiFiles.length <= 12, `serverless functions: ${apiFiles.length} of Vercel Hobby's 12 — reviews added none`);
  ok(read("api/account.js").includes('require("../lib/reviews")'), "reviews live inside the merged account function, not a new one");
}

/* -------------------------------------------------------------------------- */
/* the widget, executed                                                        */
/* -------------------------------------------------------------------------- */

/* There is no browser and no jsdom in this project (zero dependencies, no build
   step), so the widget is run in a node:vm context with just enough DOM to prove
   three things: it executes without throwing, it renders what the API returned,
   and the schema it injects is built from that same response. */
function runWidget(apiResponses, opts) {
  const vm = require("vm");
  const productLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "MTN 10GB data bundle",
    offers: { "@type": "Offer", price: "52.00", priceCurrency: "GHS" },
  };
  const ldNode = { textContent: JSON.stringify(productLd, null, 2) };
  const mount = {
    innerHTML: '<p class="reviews-loading">Loading reviews…</p>',
    classList: { add() {}, remove() {} },
    getAttribute: (n) => ({ "data-network": "mtn", "data-size-mb": "10240", "data-label": "MTN 10GB" })[n] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const calls = [];
  const sandbox = {
    console,
    window: { confirm: () => true },
    localStorage: { getItem: () => (opts && opts.token) || null, setItem() {}, removeItem() {} },
    document: {
      readyState: "complete",
      addEventListener() {},
      querySelector: () => null,
      querySelectorAll: (sel) =>
        sel === 'script[type="application/ld+json"]' ? [ldNode] : sel === ".reviews-mount" ? [mount] : [],
    },
    fetch: async (url) => {
      calls.push(String(url));
      const body = apiResponses[String(url).replace(/^https?:\/\/[^/]+/, "")] || apiResponses["*"];
      if (!body) return { ok: false, status: 404, json: async () => ({ error: "not stubbed: " + url }) };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("assets/js/reviews.js"), sandbox, { filename: "assets/js/reviews.js" });
  // init() kicks off an async load; give it the microtasks + a macrotask.
  return new Promise((resolve) => setTimeout(() => resolve({ mount, ldNode, calls, sandbox }), 60));
}

async function widgetChecks() {
  section("13. the widget renders the API response and injects matching schema");

  const review = (n) => ({
    id: n,
    rating: n === 1 ? 5 : 4,
    title: n === 1 ? "Landed in a minute" : "Good value",
    body: n === 1 ? "Paid with MoMo and it arrived straight away." : "Second time buying, no complaints.",
    author: n === 1 ? "Ama" : "Kwame",
    verified: true,
    order_reference: "VD-260905-000" + n,
    created_at: "2026-09-0" + n + "T10:00:00.000Z",
  });
  const withReviews = {
    ok: true,
    network: "mtn",
    size_mb: 10240,
    reviews: [review(1), review(2)],
    summary: { count: 2, average: 4.5, histogram: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 } },
  };
  const empty = { ok: true, network: "mtn", size_mb: 10240, reviews: [], summary: { count: 0, average: 0, histogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } } };

  const url = "/api/reviews?network=mtn&size_mb=10240";
  const ran = await runWidget({ [url]: withReviews });
  const html = ran.mount.innerHTML;
  const injected = JSON.parse(ran.ldNode.textContent);

  ok(ran.calls.length === 1 && ran.calls[0].endsWith(url), "the widget called " + url + " exactly once");
  ok(/4\.5 out of 5/.test(html), "the visible average is the API's average (4.5 out of 5)");
  ok(/2 verified reviews/.test(html), "the visible count is the API's count (2 verified reviews)");
  ok((html.match(/<li class="rv-item">/g) || []).length === 2, "both reviews are rendered as list items");
  ok((html.match(/✓ Verified buyer/g) || []).length === 2, "each rendered review carries the verified mark");
  ok(html.includes("Ama") && html.includes("Kwame"), "reviewer first names are shown");
  ok(html.includes("Landed in a minute") && html.includes("no complaints"), "reviewer text is shown");
  ok(/Sign in to review/.test(html), "a signed-out visitor gets the sign-in prompt instead of the form");
  ok(!/<form/.test(html), "a signed-out visitor gets no form at all");
  ok(/width:50%/.test(html), "the histogram bar widths are derived from the counts");

  ok(injected.aggregateRating && injected.aggregateRating["@type"] === "AggregateRating", "AggregateRating was added to the existing Product node");
  ok(injected.aggregateRating.ratingValue === "4.5", "schema ratingValue equals the visible average");
  ok(injected.aggregateRating.reviewCount === 2, "schema reviewCount equals the visible count");
  ok(injected.aggregateRating.bestRating === "5" && injected.aggregateRating.worstRating === "1", "the rating scale is declared");
  ok(Array.isArray(injected.review) && injected.review.length === 2, "schema review[] has one node per visible review");
  ok(injected.review.every((r, i) => r.reviewBody === withReviews.reviews[i].body), "each schema reviewBody is a body the reader can see");
  ok(injected.review.every((r, i) => String(r.reviewRating.ratingValue) === String(withReviews.reviews[i].rating)), "each schema star value matches the stars rendered");
  ok(injected.review.every((r) => r.author && r.author.name), "each schema review names its author");
  ok(injected.review.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.datePublished || "")), "each schema review has an ISO datePublished");
  ok(ran.ldNode.textContent.split('"@type": "Product"').length === 2, "still exactly one Product node — the rating was added, not duplicated");
  ok(injected.offers && injected.offers.price === "52.00", "the page's own Product offer survived the injection");

  /* signed-in, verified, already reviewed → the edit form, pre-filled */
  const authed = JSON.parse(JSON.stringify(withReviews));
  authed.you = { signed_in: true, can_review: true, already_reviewed: true, order_reference: "VD-260905-0001", review: review(1) };
  const ranAuthed = await runWidget({ [url]: authed }, { token: "fake.token.here" });
  ok(/<form/.test(ranAuthed.mount.innerHTML), "a verified buyer gets the form");
  ok(/Update review/.test(ranAuthed.mount.innerHTML), "an existing review pre-fills the form as an edit");
  ok(/value="5"/.test(ranAuthed.mount.innerHTML) && /Landed in a minute/.test(ranAuthed.mount.innerHTML), "the pre-fill carries their rating and title");
  ok(/Retract my review/.test(ranAuthed.mount.innerHTML), "the author can retract from the same form");
  ok(!/Sign in to review/.test(ranAuthed.mount.innerHTML), "no sign-in prompt for somebody who is signed in");

  /* signed in, nothing delivered → the reason, not the form */
  const blocked = JSON.parse(JSON.stringify(empty));
  blocked.you = { signed_in: true, can_review: false, already_reviewed: false, reason: "no-delivered-order", review: null };
  const ranBlocked = await runWidget({ [url]: blocked }, { token: "fake.token.here" });
  ok(!/<form/.test(ranBlocked.mount.innerHTML), "a customer with no delivered order gets no form");
  ok(/delivered/.test(ranBlocked.mount.innerHTML) && /history\.html/.test(ranBlocked.mount.innerHTML), "they are told the rule and given their order history");

  /* no reviews → no stars, no schema */
  const ranEmpty = await runWidget({ [url]: empty });
  ok(/No verified reviews/.test(ranEmpty.mount.innerHTML), "an unreviewed bundle says so in words");
  ok(!/out of 5/.test(ranEmpty.mount.innerHTML), "an unreviewed bundle shows no star average");
  ok(!/<form/.test(ranEmpty.mount.innerHTML), "an unreviewed bundle shows no form to a guest");
  const emptyLd = JSON.parse(ranEmpty.ldNode.textContent);
  ok(!emptyLd.aggregateRating && !emptyLd.review, "an unreviewed bundle emits no rating schema at all");

  /* API failure → honest message, still no schema */
  const ranFail = await runWidget({ [url]: null, "*": null });
  ok(/could not be loaded/i.test(ranFail.mount.innerHTML), "a failed fetch says reviews could not be loaded");
  ok(!JSON.parse(ranFail.ldNode.textContent).aggregateRating, "a failed fetch emits no rating schema");

  /* escaping: reviewer text must not be able to break out of the DOM */
  const hostile = JSON.parse(JSON.stringify(empty));
  hostile.reviews = [{ id: 9, rating: 1, title: '<img src=x onerror="alert(1)">', body: '"><script>alert(2)<\/script>', author: "Ama<script>", verified: true, created_at: "2026-09-05T10:00:00.000Z" }];
  hostile.summary = { count: 1, average: 1, histogram: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 } };
  const ranHostile = await runWidget({ [url]: hostile });
  ok(!/<img src=x/i.test(ranHostile.mount.innerHTML), "reviewer HTML is escaped, not injected");
  ok(!ranHostile.mount.innerHTML.includes("<script>alert"), "reviewer script text cannot execute");
  ok(ranHostile.mount.innerHTML.includes("&lt;"), "the escaped form is what reaches the DOM");
}

/* -------------------------------------------------------------------------- */
/* boot                                                                        */
/* -------------------------------------------------------------------------- */

let bootedChild = null;
for (const sig of ["SIGINT", "SIGTERM", "uncaughtException"]) {
  process.on(sig, async () => { await shutdown(bootedChild); process.exit(1); });
}

(async () => {
  console.log("REVIEWS SUITE — verified-purchase product reviews");
  console.log("  target: " + BASE + (OWN_SERVER ? " (this suite boots its own clean server on :" + PORT + ")" : " (using the server you gave it)"));

  let child = null;
  try {
    if (OWN_SERVER) {
      // A leftover server on this port would look "ready" instantly and the
      // suite would quietly assert against somebody else's dirty database.
      const squat = await fetch(BASE + "/api/bundles", { signal: AbortSignal.timeout(1200) })
        .then((r) => r.status)
        .catch(() => null);
      if (squat) {
        throw new Error(
          "port " + PORT + " is already serving an API (HTTP " + squat + "). " +
          "Kill that process, or run with REVIEWS_TEST_PORT=<free port> / --base=<url>."
        );
      }
      child = spawn(process.execPath, ["scripts/dev-server.js"], {
        cwd: ROOT,
        env: Object.assign({}, process.env, { PORT: String(PORT), SEED_DEMO: "0", SUPABASE_MOCK: "1" }),
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.on("data", () => {});
      child.stderr.on("data", (d) => { if (fails) process.stderr.write(d); });
      child.on("exit", (code) => { if (code && !checks) console.log("  ! dev server exited early with code " + code); });
      bootedChild = child;
      await waitForServer();
    } else {
      await waitForServer(5000);
    }

    await liveChecks();
  } catch (err) {
    fails++;
    console.log("\n  ✘ FAIL  live checks could not run: " + (err && err.message));
  } finally {
    await shutdown(child);
  }

  try {
    await widgetChecks();
  } catch (err) {
    fails++;
    console.log("\n  ✘ FAIL  widget checks could not run: " + (err && err.message));
  }

  try {
    staticChecks();
  } catch (err) {
    fails++;
    console.log("\n  ✘ FAIL  static checks could not run: " + (err && err.message));
  }

  console.log("\n" + "─".repeat(64));
  console.log(fails ? `REVIEWS SUITE: ${fails} of ${checks} checks FAILED` : `REVIEWS SUITE: all ${checks} checks passed`);
  console.log("─".repeat(64));
  process.exit(fails ? 1 : 0);
})();

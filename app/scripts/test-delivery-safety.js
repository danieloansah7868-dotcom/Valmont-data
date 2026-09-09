#!/usr/bin/env node
/* ============================================================================
   Delivery safety, review invitation and storefront suite.

   This is deliberately separate from scripts/test.sh: that established API
   baseline stays untouched. The suite boots isolated mock servers and a tiny
   local Valmont-Pay stand-in, so it can exercise the live-mode refund state
   without making a real payment request.

     node scripts/test-delivery-safety.js

   Coverage:
   - persistent, one-use OTP API behavior in mock parity
   - verified buyer History CTA and safe /rev sign-in return behavior
   - admin review list/filter/verification and hide → author block → unhide audit
   - one-segment SMS invitation policy and account-linked WhatsApp receipt result
   - server-rendered active reseller metadata, plus noindex 404s
   - live-mode refund_pending → explicit admin completion flow
   - deployment guards for cron, usage, Supabase, suppliers, Valmont-Pay and WA

   Zero dependencies. It never touches :8787 or scripts/test.sh state.
   ============================================================================ */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const HAPPY_PORT = Number(process.env.DELIVERY_SAFETY_TEST_PORT || 8800);
const REFUND_PORT = Number(process.env.DELIVERY_SAFETY_REFUND_PORT || 8801);
const GATEWAY_PORT = Number(process.env.DELIVERY_SAFETY_GATEWAY_PORT || 8898);
const WEBHOOK_SECRET = "delivery-safety-webhook-secret-2026";
const AUTH_SECRET = "delivery-safety-auth-secret-2026";
const SITE_URL = "https://reviews.test";

let checks = 0;
let fails = 0;
let gateway = null;
let children = [];

function section(title) {
  console.log("\n── " + title + " ".repeat(Math.max(0, 64 - title.length)));
}
function ok(condition, message) {
  checks += 1;
  if (condition) console.log("  ✔ " + message);
  else {
    fails += 1;
    console.log("  ✘ FAIL  " + message);
  }
}
function note(message) {
  console.log("  ! " + message);
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function cleanServerEnv(extra) {
  const env = Object.assign({}, process.env, {
    PORT: String(extra.port),
    SEED_DEMO: "0",
    SUPABASE_MOCK: "1",
    AUTH_SECRET,
    ADMIN_PASSWORD: "admin123",
    ADMIN_ACTOR: "delivery-safety-test",
    SITE_URL,
    VALMONTPAY_MODE: "live",
    VALMONTPAY_API_URL: `http://127.0.0.1:${GATEWAY_PORT}/api`,
    VALMONTPAY_API_KEY: "delivery-safety-gateway-key",
    VALMONTPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    SMS_PROVIDER: "mock",
    WHATSAPP_MODE: "mock",
    SUPPLIER_ORDER: "mock",
    SUPPLIER_DRIVER: "mock",
    MOCK_FAIL_RATE: String(extra.failRate || 0),
    FORCE_COLOR: "0",
  });
  // This suite tests live *gateway mode* locally, not a Vercel deployment.
  delete env.VERCEL;
  delete env.VERCEL_ENV;
  delete env.VERCEL_URL;
  return env;
}

async function startGateway() {
  gateway = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw); } catch {}
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      // createCheckout accepts either a top-level or data-wrapped response.
      res.end(JSON.stringify({
        status: "success",
        data: {
          reference: body.reference || "test-reference",
          checkout_url: "https://checkout.example.test/pay/" + encodeURIComponent(body.reference || "test"),
        },
      }));
    });
  });
  await new Promise((resolve, reject) => {
    gateway.once("error", reject);
    gateway.listen(GATEWAY_PORT, "127.0.0.1", () => {
      gateway.off("error", reject);
      resolve();
    });
  });
}

async function stopGateway() {
  if (!gateway) return;
  const current = gateway;
  gateway = null;
  await new Promise((resolve) => current.close(() => resolve()));
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  const deadline = Date.now() + 5000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(50);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await sleep(100);
  }
}

async function cleanup() {
  await Promise.all(children.map(stopChild));
  children = [];
  await stopGateway();
}

async function waitFor(base, child) {
  const deadline = Date.now() + 20000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("dev server exited early (" + child.exitCode + ")");
    try {
      const response = await fetch(base + "/api/bundles", { signal: AbortSignal.timeout(1200) });
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await sleep(150);
  }
  throw new Error("server never became ready" + (lastError ? ": " + lastError.message : ""));
}

async function startApp(port, failRate) {
  const base = "http://127.0.0.1:" + port;
  const child = spawn(process.execPath, ["scripts/dev-server.js"], {
    cwd: ROOT,
    env: cleanServerEnv({ port, failRate }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (data) => { log += String(data); });
  child.stderr.on("data", (data) => { log += String(data); });
  children.push(child);
  try {
    await waitFor(base, child);
  } catch (error) {
    throw new Error(error.message + "\n" + log.slice(-1200));
  }
  return { base, child };
}

async function call(base, method, pathname, body, token) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = "Bearer " + token;
  const response = await fetch(base + pathname, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
  return { status: response.status, ok: response.ok, data, raw, headers: response.headers };
}
const get = (base, p, token) => call(base, "GET", p, undefined, token);
const post = (base, p, body, token) => call(base, "POST", p, body, token);
const del = (base, p, token) => call(base, "DELETE", p, undefined, token);

async function adminLogin(base) {
  const result = await post(base, "/api/admin/login", { password: "admin123" });
  ok(result.status === 200 && Boolean(result.data.token), "admin login issues a signed token");
  return result.data.token;
}

async function createCustomer(base, name, phone, email) {
  const result = await post(base, "/api/auth/customer", {
    action: "signup", name, phone, email, pin: "1234",
  });
  ok(result.status === 200 && Boolean(result.data.token), "customer account created for " + phone);
  return result.data.token;
}

async function topUpMtn(base, admin) {
  const result = await post(base, "/api/admin/float/topup", { network: "mtn", amount: 500 }, admin);
  ok(result.status === 200, "MTN float is available for the isolated order");
}

async function createOrder(base, token, phone, bundleId) {
  const result = await post(base, "/api/orders", { bundle_id: bundleId, phone }, token);
  ok(result.status === 201, "live-mode checkout order is created");
  ok(/^https:\/\/checkout\.example\.test\/pay\//.test(result.data.checkout_url || ""), "checkout came from the local gateway stand-in (not a dev simulation)");
  return result.data;
}

async function webhook(base, reference, amount, suffix) {
  const payload = {
    event: "charge.success",
    data: {
      reference,
      status: "success",
      amount: Number(amount),
      currency: "GHS",
      channel: "mobile_money",
      paid_at: new Date().toISOString(),
      merchant: "valmontdata",
      gateway_reference: "VP-SAFETY-" + suffix + "-" + Date.now(),
    },
  };
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac("sha512", WEBHOOK_SECRET).update(raw).digest("hex");
  const response = await fetch(base + "/api/valmontpay/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-valmontpay-signature": signature },
    body: raw,
    signal: AbortSignal.timeout(12000),
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: response.status, data };
}

function parseLastJson(text) {
  const lines = String(text).trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines[lines.length - 1]);
}

function runProbe(source, label) {
  try {
    return parseLastJson(execFileSync(process.execPath, ["-e", source], {
      cwd: ROOT,
      encoding: "utf8",
      env: Object.assign({}, process.env, { FORCE_COLOR: "0" }),
      stdio: ["ignore", "pipe", "pipe"],
    }));
  } catch (error) {
    note(label + " probe failed: " + String(error.stderr || error.message).slice(0, 500));
    return null;
  }
}

async function otpReviewsAndStorefront() {
  section("1. OTP persistence parity, invitation policy, moderation and storefront SSR");
  const { base, child } = await startApp(HAPPY_PORT, 0);
  try {
    // Persistent OTP API: dev mock exposes a code only because no real SMS was used.
    const otpSend = await post(base, "/api/auth/otp/send", { phone: "0249990102" });
    ok(otpSend.status === 200 && otpSend.data.dev === true && /^\d{6}$/.test(otpSend.data.dev_code || ""), "OTP send stores/sends a six-digit local-dev code");
    const badOtp = await post(base, "/api/auth/otp/verify", { phone: "0249990102", code: "000000" });
    ok(badOtp.status === 401, "wrong OTP is rejected without consuming the code");
    const goodOtp = await post(base, "/api/auth/otp/verify", { phone: "0249990102", code: otpSend.data.dev_code });
    ok(goodOtp.status === 200 && Boolean(goodOtp.data.token), "persistent OTP verifies and issues a customer token");
    const replayOtp = await post(base, "/api/auth/otp/verify", { phone: "0249990102", code: otpSend.data.dev_code });
    ok(replayOtp.status === 400, "a consumed OTP cannot be replayed");

    const admin = await adminLogin(base);
    await topUpMtn(base, admin);
    const buyer = await createCustomer(base, "Ama Reviewer", "0249990101", "ama.safety@example.test");
    const catalogue = await get(base, "/api/bundles");
    const bundle = (catalogue.data.bundles || []).find((item) => item.network === "mtn" && Number(item.size_mb) === 10240);
    ok(Boolean(bundle), "MTN 10GB catalogue bundle is available for review checks");
    if (!bundle) return;

    const created = await createOrder(base, buyer, "0249990101", bundle.id);
    const delivered = await webhook(base, created.reference, created.amount_due, "DELIVERED");
    ok(delivered.status === 200 && delivered.data.outcome === "delivered", "signed live-mode webhook completes delivery");

    const history = await get(base, "/api/account/history", buyer);
    const historyOrder = (history.data.orders || []).find((item) => item.reference === created.reference);
    ok(history.status === 200 && historyOrder?.status === "delivered", "delivered order appears in the buyer's authenticated History");
    ok(historyOrder?.review_url === "/rev/mtn/10gb", "History returns the safe direct verified-review CTA route");

    const invitationPage = await get(base, "/rev/mtn/10gb");
    ok(invitationPage.status === 200 && /reviews-mount/.test(invitationPage.raw), "/rev invitation URL resolves to its existing bundle page");

    const noAdmin = await get(base, "/api/reviews/admin?network=mtn&status=published");
    ok(noAdmin.status === 401, "review moderation queue rejects a guest");

    const submitted = await post(base, "/api/reviews", {
      network: "mtn", size_mb: 10240, rating: 5, title: "Delivered quickly", body: "The verified bundle arrived.",
    }, buyer);
    ok(submitted.status === 201 && Boolean(submitted.data.review?.id), "verified buyer can publish one review tied to delivery");
    const reviewId = submitted.data.review?.id;

    const queue = await get(base, "/api/reviews/admin?network=mtn&status=published", admin);
    const queueReview = (queue.data.reviews || []).find((item) => Number(item.id) === Number(reviewId));
    ok(queue.status === 200 && queueReview?.order_verification?.valid === true, "admin queue exposes delivered-order verification evidence");
    ok(queueReview?.order_verification?.reference === created.reference, "admin queue exposes the matching order reference");
    const telecelQueue = await get(base, "/api/reviews/admin?network=telecel&status=published", admin);
    ok(telecelQueue.status === 200 && (telecelQueue.data.reviews || []).length === 0, "admin network filter excludes another network's review");

    const hidden = await post(base, "/api/reviews/admin", { id: reviewId, status: "removed" }, admin);
    ok(hidden.status === 200 && hidden.data.status === "removed" && hidden.data.hidden_by_admin === true, "admin can hide a review without deleting it");
    ok(hidden.data.moderation_history?.[0]?.action === "hide" && hidden.data.moderation_history?.[0]?.by === "delivery-safety-test", "hide transition retains actor-labelled audit provenance");
    const hiddenQueue = await get(base, "/api/reviews/admin?network=mtn&status=removed", admin);
    ok((hiddenQueue.data.reviews || []).some((item) => Number(item.id) === Number(reviewId)), "admin status filter finds hidden reviews");
    const publicAfterHide = await get(base, "/api/reviews?network=mtn&size_mb=10240");
    ok(publicAfterHide.data.summary?.count === 0, "hidden review is absent from the public aggregate/list");

    const authorRepublish = await post(base, "/api/reviews", {
      network: "mtn", size_mb: 10240, rating: 4, title: "Trying to republish",
    }, buyer);
    ok(authorRepublish.status === 403, "review author cannot republish an admin-hidden review");
    const authorRetract = await del(base, "/api/reviews?id=" + encodeURIComponent(reviewId), buyer);
    ok(authorRetract.status === 403, "review author cannot alter an admin-hidden review through retraction");

    const unhidden = await post(base, "/api/reviews/admin", { id: reviewId, status: "published" }, admin);
    ok(unhidden.status === 200 && unhidden.data.hidden_by_admin === false, "admin can unhide the retained review");
    ok(unhidden.data.moderation_history?.length === 2 && unhidden.data.moderation_history?.[1]?.action === "unhide", "hide and unhide provenance both remain on the row");
    const authorUpdate = await post(base, "/api/reviews", {
      network: "mtn", size_mb: 10240, rating: 4, title: "Updated after unhide",
    }, buyer);
    ok(authorUpdate.status === 200 && authorUpdate.data.created === false, "author may update the original retained review only after admin unhide");

    const createdStore = await post(base, "/api/store", {
      store_name: "Ama's Data <Store>", slug: "ama-safe-store", tagline: "Bundles & support", markup_percent: 10,
    }, buyer);
    ok(createdStore.status === 201, "customer can create an active reseller store for SSR check");
    const storefront = await get(base, "/s/ama-safe-store");
    ok(storefront.status === 200, "active /s/<slug> storefront is server-rendered");
    ok(/<title>Ama&#39;s Data &lt;Store&gt; — data bundles \| Valmont Data store<\/title>/.test(storefront.raw), "SSR title is active-store data and HTML escaped");
    ok(storefront.raw.includes(`<link rel="canonical" href="${SITE_URL}/s/ama-safe-store">`), "SSR canonical points to the valid /s/<slug> URL");
    ok(/meta name="robots" content="index,follow"/.test(storefront.raw), "active storefront is indexable in server HTML");
    ok(/property="og:title" content="Ama&#39;s Data &lt;Store&gt; — data bundles \| Valmont Data store"/.test(storefront.raw), "SSR Open Graph title is populated from the same active store");
    ok(!/STOREFRONT_(?:TITLE|DESCRIPTION|CANONICAL|NAME|TAGLINE|OWNER)_START/.test(storefront.raw), "server response contains no unresolved storefront tokens");

    const inactive = await post(base, "/api/store", { status: "inactive" }, buyer);
    ok(inactive.status === 200, "store owner can set the test store inactive");
    const inactivePage = await get(base, "/s/ama-safe-store");
    ok(inactivePage.status === 404 && /name="robots" content="noindex"/.test(inactivePage.raw), "inactive storefront returns noindex 404 HTML");
    const missingPage = await get(base, "/s/not-a-real-store");
    ok(missingPage.status === 404 && /Store not found/.test(missingPage.raw), "missing storefront returns noindex 404 HTML");
  } finally {
    await stopChild(child);
    children = children.filter((item) => item !== child);
  }
}

function policyAndNotificationChecks() {
  section("2. direct invitation and notification safety contracts");
  const invitationProbe = runProbe(`
    process.env.SUPABASE_MOCK = '1';
    process.env.SITE_URL = 'https://reviews.test';
    const { db } = require('./lib/supabase');
    const orders = require('./lib/orders');
    (async () => {
      const customer = (await db.insert('customers', { phone: '0249990101', pin_hash: 'x' }))[0];
      const base = { customer_id: customer.id, network_code: 'mtn', size_mb: 10240, reference: 'VD-260909-0001' };
      const self = await orders.reviewInvitationLinks({ ...base, phone: '0249990101', whatsapp_from: '233249990101' });
      const gift = await orders.reviewInvitationLinks({ ...base, phone: '0559990101', whatsapp_from: '233249990101' });
      const stranger = await orders.reviewInvitationLinks({ ...base, phone: '0249990101', whatsapp_from: '233559990101' });
      const noAccount = await orders.reviewInvitationLinks({ ...base, customer_id: null, phone: '0249990101', whatsapp_from: '233249990101' });
      console.log(JSON.stringify({ self, gift, stranger, noAccount }));
    })().catch((error) => { console.error(error); process.exit(1); });
  `, "invitation policy");
  const expectedUrl = SITE_URL + "/rev/mtn/10gb";
  ok(invitationProbe?.self?.sms_review_url === expectedUrl && invitationProbe?.self?.whatsapp_review_url === expectedUrl, "self buyer/recipient receives eligible SMS and linked WhatsApp review URLs");
  ok(invitationProbe?.gift?.sms_review_url === null && invitationProbe?.gift?.whatsapp_review_url === expectedUrl, "gift recipient never gets SMS account link while matching WhatsApp buyer may receive one");
  ok(invitationProbe?.stranger?.whatsapp_review_url === null && Object.keys(invitationProbe?.noAccount || {}).length === 0, "unlinked WhatsApp sender and unauthenticated order receive no review invitation");

  const smsProbe = runProbe(`
    const sms = require('./lib/sms');
    const order = { size_mb: 10240, network_code: 'mtn', phone: '0249990101', reference: 'VD-260909-0001', review_url: 'https://reviews.test/rev/mtn/10gb' };
    const text = sms.templates.orderDelivered(order);
    // GSM-7 permits 160 septets in one segment; a non-GSM emoji switches the
    // entire SMS to UCS-2, where only 70 code units fit. Keep this in one
    // assertion so the suite remains the required 70 checks.
    const gsm160 = sms.messageInfo('a'.repeat(160));
    const gsm161 = sms.messageInfo('a'.repeat(161));
    const unicode70 = sms.messageInfo('✅' + 'a'.repeat(69));
    const unicode71 = sms.messageInfo('✅' + 'a'.repeat(70));
    const longReviewUrl = 'https://' + 'a'.repeat(60) + '.test/rev/mtn/10gb';
    const plainReceipt = sms.templates.orderDelivered({ ...order, review_url: '' });
    const overflowCandidate = plainReceipt + ' Review: ' + longReviewUrl;
    const overflowReceipt = sms.templates.orderDelivered({ ...order, review_url: longReviewUrl });
    console.log(JSON.stringify({ text, info: sms.messageInfo(text), one: sms.isOneGsmSegment(text), gsm160, gsm161, unicode70, unicode71, overflowInfo: sms.messageInfo(overflowCandidate), overflowReceipt }));
  `, "SMS template");
  ok(
    Boolean(smsProbe?.one) && smsProbe?.info?.encoding === "gsm7" && smsProbe?.info?.segments === 1
      && smsProbe?.gsm160?.encoding === "gsm7" && smsProbe?.gsm160?.units === 160 && smsProbe?.gsm160?.segments === 1
      && smsProbe?.gsm161?.encoding === "gsm7" && smsProbe?.gsm161?.units === 161 && smsProbe?.gsm161?.segments === 2
      && smsProbe?.unicode70?.encoding === "ucs2" && smsProbe?.unicode70?.units === 70 && smsProbe?.unicode70?.segments === 1
      && smsProbe?.unicode71?.encoding === "ucs2" && smsProbe?.unicode71?.units === 71 && smsProbe?.unicode71?.segments === 2
      && smsProbe?.overflowInfo?.encoding === "gsm7" && smsProbe?.overflowInfo?.segments === 2
      && !smsProbe?.overflowReceipt?.includes(" Review: "),
    "eligible SMS review invitation is one GSM-7 segment; GSM-7 uses 160 septets, Unicode uses the 70-unit UCS-2 limit, and an overflow link is omitted"
  );
  ok(smsProbe?.text?.includes(expectedUrl) && !/(reward|bonus|credit|discount|incentive)/i.test(smsProbe?.text || ""), "SMS invitation is a plain direct link with no incentive language");

  const whatsappProbe = runProbe(`
    process.env.SUPABASE_MOCK = '1';
    process.env.WHATSAPP_MODE = 'live';
    process.env.WHATSAPP_TOKEN = 'test-wa-token';
    process.env.WHATSAPP_PHONE_ID = 'test-phone-id';
    const notify = require('./lib/notify');
    let request = null;
    global.fetch = async (url, opts) => {
      request = { url: String(url), body: JSON.parse(opts.body) };
      return { ok: true, json: async () => ({ messages: [{ id: 'wamid.live-receipt' }] }) };
    };
    (async () => {
      const result = await notify.send('order.receipt', {
        whatsapp_from: '233249990101', size_mb: 10240, network_code: 'mtn', reference: 'VD-260909-0001', phone: '0249990101'
      });
      console.log(JSON.stringify({ result, request }));
    })().catch((error) => { console.error(error); process.exit(1); });
  `, "WhatsApp receipt");
  ok(whatsappProbe?.request?.body?.to === "233249990101", "receipt sends to the originating WhatsApp sender, not the data recipient");
  ok(whatsappProbe?.result?.whatsapp?.message_id === "wamid.live-receipt", "live WhatsApp message_id is recognized as a successful notify receipt");

  const signin = fs.readFileSync(path.join(ROOT, "signin.html"), "utf8");
  const signup = fs.readFileSync(path.join(ROOT, "signup.html"), "utf8");
  const widget = fs.readFileSync(path.join(ROOT, "assets/js/reviews.js"), "utf8");
  ok([signin, signup].every((page) => page.includes("function safeReviewReturn") && page.includes("target.origin !== window.location.origin") && page.includes("mtn|telecel|airteltigo")), "sign-in and sign-up validate same-origin review-only return paths");
  ok(/reviewReturnPath/.test(widget) && /signin\.html\?return=/.test(widget), "review widget preserves the safe invitation return flow");
}

async function refundSafetyChecks() {
  section("3. live payment failure remains pending until an admin records completion");
  const { base, child } = await startApp(REFUND_PORT, 1);
  try {
    const admin = await adminLogin(base);
    await topUpMtn(base, admin);
    const buyer = await createCustomer(base, "Kojo Refund", "0249990103", "kojo.refund@example.test");
    const catalogue = await get(base, "/api/bundles");
    const bundle = (catalogue.data.bundles || []).find((item) => item.network === "mtn" && Number(item.size_mb) === 10240);
    ok(Boolean(bundle), "refund test has an MTN 10GB bundle");
    if (!bundle) return;

    const created = await createOrder(base, buyer, "0249990103", bundle.id);
    const firstDelivery = await webhook(base, created.reference, created.amount_due, "FAIL");
    ok(firstDelivery.status === 200 && firstDelivery.data.outcome !== "delivered", "permanent supplier failure prevents delivery after paid webhook");
    const retryOne = await post(base, "/api/admin/orders/retry", { reference: created.reference }, admin);
    const retryTwo = await post(base, "/api/admin/orders/retry", { reference: created.reference }, admin);
    ok(retryOne.status === 200 && retryTwo.status === 200, "admin retries exhaust the configured delivery attempts");

    const publicPending = await get(base, "/api/orders?reference=" + encodeURIComponent(created.reference));
    ok(publicPending.data.order?.status === "refund_pending", "live failed paid order is refund_pending, not claimed as refunded");
    ok(Boolean(publicPending.data.order?.refund_requested_at) && !publicPending.data.order?.refund_completed_at, "pending refund records request time but no fabricated completion time");

    const adminOrders = await get(base, "/api/admin/orders?status=refund_pending", admin);
    const pendingOrder = (adminOrders.data.orders || []).find((item) => item.reference === created.reference);
    ok(pendingOrder?.refund_completable === true && Boolean(pendingOrder?.provider_reference), "admin sees real provider-reference reconciliation eligibility");

    const unconfirmed = await post(base, "/api/admin/orders/refund-complete", { reference: created.reference }, admin);
    ok(unconfirmed.status === 400, "admin completion endpoint demands explicit real-gateway confirmation");
    const completed = await post(base, "/api/admin/orders/refund-complete", {
      reference: created.reference,
      gateway_refund_completed: true,
      note: "Gateway case GS-1234 completed",
    }, admin);
    ok(completed.status === 200 && completed.data.status === "refunded", "admin can record completion only after the real gateway confirmation flag");
    const publicCompleted = await get(base, "/api/orders?reference=" + encodeURIComponent(created.reference));
    ok(publicCompleted.data.order?.status === "refunded" && Boolean(publicCompleted.data.order?.refund_completed_at), "customer status changes to refunded only after completion is recorded");
    const replayCompletion = await post(base, "/api/admin/orders/refund-complete", {
      reference: created.reference, gateway_refund_completed: true,
    }, admin);
    ok(replayCompletion.status === 409, "refund completion cannot be recorded twice");
  } finally {
    await stopChild(child);
    children = children.filter((item) => item !== child);
  }
}

function deploymentGuardChecks() {
  section("4. production configuration rejects local/mock conveniences");
  const probe = runProbe(`
    const crypto = require('crypto');
    process.env.VERCEL = '1';
    process.env.CRON_SECRET = '';
    process.env.USAGE_REPORT_KEY = '';
    process.env.SUPABASE_MOCK = '1';
    process.env.AUTH_SECRET = 'dev-secret-change-me';
    process.env.SUPPLIER_ORDER = 'mock';
    process.env.VALMONTPAY_MODE = 'mock';
    process.env.VALMONTPAY_API_URL = 'https://gateway.example.test/api';
    process.env.VALMONTPAY_API_KEY = 'key';
    process.env.VALMONTPAY_WEBHOOK_SECRET = 'a-strong-webhook-secret';
    process.env.WHATSAPP_MODE = 'mock';
    process.env.WHATSAPP_VERIFY_TOKEN = 'a-strong-whatsapp-token';
    const { cronAuthorization } = require('./api/cron');
    const usage = require('./api/usage');
    const { db } = require('./lib/supabase');
    const auth = require('./lib/auth');
    const supplier = require('./lib/supplier');
    const pay = require('./lib/valmontpay');
    const whatsapp = require('./lib/whatsapp');
    function invoke(handler, req) {
      return new Promise((resolve) => {
        const res = { statusCode: 200, setHeader() {}, end(body) { resolve({ status: this.statusCode, body: String(body || '') }); } };
        handler(req, res);
      });
    }
    (async () => {
      const usageMissing = await invoke(usage, { method: 'GET', url: '/api/usage?phone=0249990101', headers: {} });
      let dbStatus = 0;
      try { await db.select({ from: 'networks' }); } catch (error) { dbStatus = error.status || 0; }
      const badSignature = crypto.createHmac('sha512', process.env.VALMONTPAY_WEBHOOK_SECRET).update('x').digest('hex');
      const cronMissing = cronAuthorization({ headers: {} });
      process.env.CRON_SECRET = 'cron-secret-that-is-long-enough';
      const cronGood = cronAuthorization({ headers: { authorization: 'Bearer cron-secret-that-is-long-enough' } });
      const cronBad = cronAuthorization({ headers: { authorization: 'Bearer wrong' } });
      const waMock = whatsapp.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'a-strong-whatsapp-token', 'hub.challenge': 'x' });
      process.env.WHATSAPP_MODE = 'live';
      process.env.WHATSAPP_VERIFY_TOKEN = 'short';
      const waWeak = whatsapp.verifyWebhook({ 'hub.mode': 'subscribe', 'hub.verify_token': 'short', 'hub.challenge': 'x' });
      console.log(JSON.stringify({
        cronMissing, cronGood, cronBad, usageStatus: usageMissing.status, dbStatus,
        authConfigured: auth.isConfigured(), supplierReady: supplier.getSupplierRouter().preflight('mtn').ok,
        payConfigured: pay.configured(), signatureAccepted: pay.verifySignature('x', badSignature),
        waMock: waMock.valid, waWeak: waWeak.valid
      }));
    })().catch((error) => { console.error(error); process.exit(1); });
  `, "deployment safety");
  ok(probe?.cronMissing?.configuration === true && probe?.cronGood?.ok === true && probe?.cronBad?.ok === false, "cron requires a strong Bearer CRON_SECRET in deployment");
  ok(probe?.usageStatus === 503 && probe?.dbStatus === 503, "deployed missing usage key and Supabase mock storage are rejected");
  ok(probe?.authConfigured === false && probe?.supplierReady === false, "default auth secret and mock supplier are rejected in deployment");
  ok(probe?.payConfigured === false && probe?.signatureAccepted === false, "non-live Valmont-Pay mode cannot accept a deployed webhook signature");
  ok(probe?.waMock === false && probe?.waWeak === false, "mock WhatsApp mode and weak webhook token cannot validate in deployment");

  const apiFiles = (function walk(relative) {
    const out = [];
    for (const entry of fs.readdirSync(path.join(ROOT, relative), { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) out.push(...walk(next));
      else if (entry.name.endsWith(".js")) out.push(next);
    }
    return out;
  })("api");
  ok(apiFiles.length === 11, "feature stays within the existing 11 Vercel function files (no new function)");
  const rewrites = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")).rewrites;
  ok(rewrites.some((row) => row.source === "/s/:slug" && /api\/account\?section=storefront/.test(row.destination)), "storefront SSR is folded into api/account through Vercel rewrite");
  ok(rewrites.some((row) => row.source === "/api/reviews/admin" && /api\/account\?section=reviews/.test(row.destination)), "admin review route is folded into api/account through Vercel rewrite");
}

(async () => {
  console.log("DELIVERY SAFETY SUITE — isolated API and policy checks");
  console.log(`  app ports: ${HAPPY_PORT}, ${REFUND_PORT}; gateway port: ${GATEWAY_PORT}`);
  try {
    await startGateway();
    await otpReviewsAndStorefront();
    policyAndNotificationChecks();
    await refundSafetyChecks();
    deploymentGuardChecks();
  } catch (error) {
    fails += 1;
    console.log("\n  ✘ FAIL  suite setup/runtime error: " + (error && error.stack || error));
  } finally {
    await cleanup();
  }

  console.log("\n" + "─".repeat(72));
  console.log(fails ? `DELIVERY SAFETY SUITE: ${fails} of ${checks} checks FAILED` : `DELIVERY SAFETY SUITE: all ${checks} checks passed`);
  console.log("─".repeat(72));
  process.exit(fails ? 1 : 0);
})();

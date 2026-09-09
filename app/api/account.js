/* ============================================================================
   Customer Account API
     GET    /api/account        → profile, time greeting, saved numbers, recent numbers, order history
     POST   /api/account/saved  → save a data line or MoMo number (max 10 per category)
     DELETE /api/account/saved  → remove a saved number
     POST   /api/account/optin  → SMS marketing opt-in (public — storefront popup)

   Referrals (merged here to stay under Vercel Hobby's 12-function cap)
     GET    /api/referrals          → referral stats (code, credits, referrals)
     POST   /api/referrals/claim    → claim a referral code at signup time
     GET    /api/referrals/credits  → credit balance + history
     GET    /api/referrals/verify   → public: verify a code exists

   Purchase history (merged here for the same reason)
     GET    /api/account/history    → full paginated order history + search,
                                      status/network filters and a live
                                      delivery-progress summary (recent
                                      turnaround times + what's in the queue)

   Reseller store (merged here for the same reason)
     GET    /api/store              → own store data (customer-authenticated)
     POST   /api/store              → create/update store (customer-authenticated)
     GET    /api/store/check        → check slug availability
     GET    /api/store/earnings     → earnings ledger (store owner)
     GET    /api/store/orders       → recent store orders (store owner)
     GET    /api/store/public       → public store data (no auth)

   Product reviews (merged here for the same reason) — verified purchases only
     GET    /api/reviews?network=mtn&size_mb=10240
                                   → public: published reviews + the aggregate
                                     (the ONLY numbers the landing pages may
                                     turn into rating schema). Sends a `you`
                                     block when a customer token is present.
     POST   /api/reviews            → create/edit your review of a bundle you
                                     have had delivered (customer-authenticated)
     DELETE /api/reviews?id=123     → author retracts their own review; legacy
                                     admin hide remains status-only.
     GET    /api/reviews/admin      → authenticated admin moderation queue
     POST   /api/reviews/admin      → admin-only publish/remove transition.

   Reseller storefront HTML (same function; no new Vercel entrypoint)
     GET    /s/:slug                → server-rendered active-store metadata + shell
   ============================================================================ */

const { json, readRawBody, wrap } = require("../lib/http");
const { requireCustomer, requireAdmin, getCustomer, getAdmin } = require("../lib/auth");
const { db } = require("../lib/supabase");
const phones = require("../lib/phones");
const orders = require("../lib/orders");
const referrals = require("../lib/referrals");
const resellers = require("../lib/resellers");
const reviews = require("../lib/reviews");
const { siteOrigin } = require("../lib/runtime");
const fs = require("fs");
const pathUtil = require("path");

function getTimeGreeting(name, email) {
  const hour = new Date().getUTCHours(); // Ghana is UTC+0
  let greeting = "Good morning";
  if (hour >= 12 && hour < 17) greeting = "Good afternoon";
  else if (hour >= 17) greeting = "Good evening";

  let firstName = "Kofi";
  if (name && name.trim()) {
    firstName = name.trim().split(/\s+/)[0];
  } else if (email && email.includes("@")) {
    const part = email.split("@")[0].replace(/[._-]/g, " ");
    firstName = part.charAt(0).toUpperCase() + part.slice(1).split(/\s+/)[0];
  }
  return `${greeting}, ${firstName}`;
}

function routeHint(req) {
  const url = new URL(req.url, "http://local");
  const path = url.pathname || "";
  const section = url.searchParams.get("section") || "";
  const sub = url.searchParams.get("sub") || "";
  const haystack = `${path} ${req.url || ""}`.toLowerCase();
  return { url, path, section, sub, haystack };
}

async function get(req, res) {
  const auth = requireCustomer(req);

  const customerRows = await db.select({ from: "customers", where: { id: `eq.${auth.id}` } });
  const customer = customerRows[0] || auth;

  const savedRows = await db.select({
    from: "saved_numbers",
    where: { customer_id: `eq.${auth.id}` },
    order: "created_at.desc",
  });

  const orderRows = await db.select({
    from: "orders",
    where: { customer_id: `eq.${auth.id}` },
    order: "created_at.desc",
    limit: 10,
  });

  const enrichedOrders = await Promise.all(
    orderRows.map(async (o) => {
      const bundle = await orders.findBundleById(o.bundle_id);
      const network = await orders.findNetworkById(o.network_id);
      return {
        id: o.id,
        reference: o.reference,
        phone: o.phone,
        amount: Number(o.amount),
        status: o.status,
        created_at: o.created_at,
        bundle: bundle ? { size_mb: bundle.size_mb, validity_days: bundle.validity_days } : null,
        network: network ? network.code : null,
        network_name: network ? network.name : null,
      };
    })
  );

  // Recent delivery numbers deduped from customer's orders
  const recentMap = new Set();
  const recentNumbers = [];
  for (const o of enrichedOrders) {
    if (o.phone && !recentMap.has(o.phone)) {
      recentMap.add(o.phone);
      recentNumbers.push(o.phone);
    }
  }

  const greeting = getTimeGreeting(customer.name, customer.email);
  const dataLines = savedRows.filter((s) => s.kind === "data");
  const momoNumbers = savedRows.filter((s) => s.kind === "momo");

  return json(res, 200, {
    customer: {
      id: customer.id,
      phone: customer.phone,
      email: customer.email,
      name: customer.name,
      first_name: (customer.name || customer.email || "Kofi").trim().split(/[\s@]+/)[0],
    },
    time_greeting: greeting,
    greeting: greeting,
    saved_numbers: savedRows,
    data_lines: dataLines,
    momo_numbers: momoNumbers,
    recent_numbers: recentNumbers,
    orders: enrichedOrders,
  });
}

async function post(req, res) {
  const auth = requireCustomer(req);

  const body = await readRawBody(req).then((b) => {
    try { return JSON.parse(b); } catch { return null; }
  });
  if (!body) return json(res, 400, { error: "Invalid JSON" });

  const kind = body.kind === "momo" ? "momo" : "data";
  const check = phones.validate(body.phone);
  if (!check.valid) return json(res, 400, { error: check.reason });

  // 10-per-kind cap
  const existing = await db.select({
    from: "saved_numbers",
    where: { customer_id: `eq.${auth.id}`, kind: `eq.${kind}` },
  });
  if (existing.length >= 10) {
    return json(res, 400, { error: `Maximum 10 ${kind === "data" ? "data lines" : "MoMo numbers"} allowed` });
  }

  const label = (body.label || "").trim() || (kind === "data" ? "Saved line" : "MoMo");

  try {
    const inserted = await db.insert("saved_numbers", {
      customer_id: auth.id,
      kind,
      phone: check.normalized,
      label,
    });
    return json(res, 201, { ok: true, saved_number: inserted[0] });
  } catch (e) {
    if (e.status === 409 || e.message?.includes("unique constraint")) {
      return json(res, 409, { error: "This number is already saved in this category" });
    }
    throw e;
  }
}

async function del(req, res) {
  const auth = requireCustomer(req);

  const url = new URL(req.url, "http://local");
  const idQuery = url.searchParams.get("id");
  let id = idQuery ? Number(idQuery) : null;
  let phone = url.searchParams.get("phone");
  let kind = url.searchParams.get("kind");

  if (!id && !phone) {
    const body = await readRawBody(req).then((b) => {
      try { return JSON.parse(b); } catch { return null; }
    });
    if (body?.id) id = Number(body.id);
    if (body?.phone) phone = body.phone;
    if (body?.kind) kind = body.kind;
  }

  if (id) {
    await db.delete("saved_numbers", { id: `eq.${id}`, customer_id: `eq.${auth.id}` });
    return json(res, 200, { ok: true });
  }

  if (phone) {
    const check = phones.validate(phone);
    const normalized = check.valid ? check.normalized : phone;
    const where = { phone: `eq.${normalized}`, customer_id: `eq.${auth.id}` };
    if (kind) where.kind = `eq.${kind}`;
    await db.delete("saved_numbers", where);
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: "Number id or phone required for deletion" });
}

/* ---------- SMS marketing opt-in (public — no account needed) ----------
   Storefront popup posts here after 10s of landing. Ghana mobile format is
   validated server-side; the unique constraint keeps the list deduped. */
async function optin(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });

  const body = await readRawBody(req).then((b) => {
    try { return JSON.parse(b); } catch { return null; }
  });
  if (!body) return json(res, 400, { error: "Invalid JSON" });

  const check = phones.validate(body.phone);
  if (!check.valid) return json(res, 400, { error: check.reason });

  const source = String(body.source || "storefront-popup").slice(0, 60);

  try {
    const inserted = await db.insert("sms_leads", {
      phone: check.normalized,
      source,
    });
    return json(res, 201, { ok: true, phone: check.normalized, lead: inserted[0] });
  } catch (e) {
    if (e.status === 409 || e.message?.includes("unique constraint")) {
      // Already opted in — treat as success so the popup still goes away.
      return json(res, 200, { ok: true, duplicate: true, phone: check.normalized });
    }
    throw e;
  }
}

/* ---------- Purchase history ----------------------------------------------
   GET /api/account/history
     ?q=          search phone / reference / provider reference / track no.
     ?status=     all | processing | delivered | failed | refund_pending | refunded
     ?network=    all | mtn | telecel | airteltigo
     ?page=       1-based
     ?per_page=   default 10, max 50

   Returns each order enriched for the history card (bundle size, network,
   status group, copyable references, a plain-English explainer) plus a
   platform-wide `progress` block: how fast the last deliveries actually
   landed, which tracking number the delivery line is currently on, and
   whether the supplier network is running slow right now.
   -------------------------------------------------------------------------- */

const PROCESSING_STATUSES = ["pending", "paid", "delivering"];

function trackNumber(order) {
  // Stable, human-friendly tracking number derived from the order id.
  return String(2000000 + Number(order.id || 0));
}

function statusGroup(status) {
  if (PROCESSING_STATUSES.includes(status)) return "processing";
  if (status === "delivered") return "delivered";
  if (status === "refund_pending" || status === "refunded") return "refunded";
  return "failed";
}

const STATUS_LABEL = {
  pending: "Awaiting payment",
  paid: "Processing",
  delivering: "Processing",
  delivered: "Delivered",
  failed: "Failed",
  refund_pending: "Refund being arranged",
  refunded: "Refund completed",
};

function explainOrder(order) {
  switch (order.status) {
    case "pending":
      return {
        tone: "warn",
        title: "⏳ Waiting for payment",
        body: "We haven't received your payment yet. Complete checkout and delivery starts automatically.",
      };
    case "paid":
      return {
        tone: "ok",
        title: "✅ Verified & accepted — being delivered",
        body: "Your number passed verification and the order has been accepted. Your data is being delivered now — no action needed.",
      };
    case "delivering":
      return {
        tone: "ok",
        title: "✅ Verified & accepted — being delivered",
        body: "Your number passed verification and the order has been accepted. Your data is being delivered now — no action needed.",
      };
    case "delivered":
      return {
        tone: "ok",
        title: "✅ Delivered",
        body: "The bundle landed on this number. If the balance looks wrong, dial your network's balance code again — it can lag a few minutes.",
      };
    case "refund_pending":
      return {
        tone: "info",
        title: "↩️ Refund being arranged",
        body: order.refund_note || order.supplier_response?.refund_reason || order.supplier_response?.refund?.reason || order.supplier_response?.reason || "Delivery could not be completed. Our team is arranging a refund to the original payment method.",
      };
    case "refunded":
      return {
        tone: "info",
        title: "↩️ Refund completed",
        body: order.refund_note || order.supplier_response?.refund_reason || order.supplier_response?.refund?.reason || order.supplier_response?.reason || "The refund has been completed to the original payment method. Provider timing can vary.",
      };
    default:
      return {
        tone: "bad",
        title: "⚠️ Delivery failed",
        body: order.supplier_response?.error || "We could not deliver this bundle. Failed orders retry automatically. If delivery cannot be completed, our team arranges a refund to the original payment method.",
      };
  }
}

function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/* Platform-wide delivery pulse: the two most recent completed deliveries
   (fastest = "fast lane", slowest = "standard queue"), the order the
   delivery line is currently working on, and a slow-network warning when
   recent turnaround crosses 4 hours. */
async function deliveryProgress() {
  const recent = await db.select({
    from: "orders",
    order: "created_at.desc",
    limit: 200,
  });

  const completed = recent
    .filter((o) => o.status === "delivered" && o.delivered_at && o.created_at)
    .map((o) => ({
      track: trackNumber(o),
      placed_at: o.created_at,
      delivered_at: o.delivered_at,
      ms: new Date(o.delivered_at).getTime() - new Date(o.created_at).getTime(),
    }))
    .filter((o) => o.ms >= 0)
    .sort((a, b) => new Date(b.delivered_at) - new Date(a.delivered_at))
    .slice(0, 12);

  const bySpeed = [...completed].sort((a, b) => a.ms - b.ms);
  const fastest = bySpeed[0] || null;
  const slowest = bySpeed.length > 1 ? bySpeed[bySpeed.length - 1] : null;

  const inFlight = recent
    .filter((o) => PROCESSING_STATUSES.includes(o.status))
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const workingOn = inFlight[0] || null;

  const avgMs = completed.length
    ? completed.reduce((s, o) => s + o.ms, 0) / completed.length
    : 0;
  const slow = avgMs >= 4 * 3600000;

  return {
    checked_at: new Date().toISOString(),
    network_slow: slow,
    notice: slow
      ? "Network is slow (4+ hrs) — all orders will still be delivered."
      : "Network is healthy — orders are delivering normally.",
    fast_lane: fastest
      ? { ...fastest, duration: humanDuration(fastest.ms), lane: "Fast lane" }
      : null,
    standard_queue: slowest
      ? { ...slowest, duration: humanDuration(slowest.ms), lane: "Standard queue" }
      : null,
    checking_now: workingOn
      ? { track: trackNumber(workingOn), placed_at: workingOn.created_at }
      : null,
    in_flight: inFlight.length,
    average_duration: completed.length ? humanDuration(avgMs) : null,
  };
}

async function handleHistory(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
  const auth = requireCustomer(req);
  const url = new URL(req.url, "http://local");

  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const statusFilter = (url.searchParams.get("status") || "all").toLowerCase();
  const networkFilter = (url.searchParams.get("network") || "all").toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
  const perPage = Math.min(50, Math.max(1, Number(url.searchParams.get("per_page") || 10) || 10));

  const allRows = await db.select({
    from: "orders",
    where: { customer_id: `eq.${auth.id}` },
    order: "created_at.desc",
  });

  const enriched = await Promise.all(
    allRows.map(async (o) => {
      const bundle = await orders.findBundleById(o.bundle_id);
      const network = await orders.findNetworkById(o.network_id);
      const sizeMb = bundle ? bundle.size_mb : null;
      return {
        id: o.id,
        track: trackNumber(o),
        reference: o.reference,
        provider_reference: o.provider_reference || null,
        phone: o.phone,
        amount: Number(o.amount),
        credit_applied: Number(o.credit_applied || 0),
        status: o.status,
        status_group: statusGroup(o.status),
        status_label: STATUS_LABEL[o.status] || o.status,
        attempts: o.attempts || 0,
        created_at: o.created_at,
        delivered_at: o.delivered_at || null,
        duration: o.delivered_at
          ? humanDuration(new Date(o.delivered_at) - new Date(o.created_at))
          : null,
        network: network ? network.code : null,
        network_name: network ? network.name : null,
        size_mb: sizeMb,
        size_label: sizeMb ? (sizeMb >= 1024 ? `${sizeMb / 1024}GB` : `${sizeMb}MB`) : null,
        validity_days: bundle ? bundle.validity_days : null,
        // History is already authenticated and scoped to this buyer. Unlike an
        // SMS invitation, it remains available for every delivered order.
        review_url: o.status === "delivered" && network && sizeMb
          ? reviews.reviewPath(network.code, sizeMb)
          : null,
        explain: explainOrder(o),
      };
    })
  );

  let filtered = enriched;
  if (statusFilter !== "all") {
    // "processing" is a presentation group; refund states remain distinct so
    // a customer never sees a pending manual refund labelled as completed.
    filtered = filtered.filter((o) =>
      statusFilter === "processing" ? o.status_group === "processing" : o.status === statusFilter
    );
  }
  if (networkFilter !== "all") filtered = filtered.filter((o) => o.network === networkFilter);
  if (q) {
    filtered = filtered.filter((o) =>
      [o.phone, o.reference, o.provider_reference, o.track, o.network_name, o.size_label]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const start = (page - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

  const spent = enriched
    .filter((o) => o.status_group === "delivered")
    .reduce((s, o) => s + o.amount, 0);

  const progress = await deliveryProgress();

  // The delivery line is "just behind" a customer order when that order is
  // still processing and an older tracking number is being worked on now.
  const lineTrack = progress.checking_now?.track || progress.standard_queue?.track || null;
  for (const o of pageRows) {
    if (o.status_group === "processing" && lineTrack && lineTrack !== o.track) {
      o.queue_hint = {
        title: `🚚 Delivery line is at Tracking #${lineTrack}`,
        body: `Your order (#${o.track}) is just behind the line — the queue is moving up toward you.`,
      };
    }
  }

  return json(res, 200, {
    orders: pageRows,
    progress,
    filters: { q, status: statusFilter, network: networkFilter },
    totals: {
      all: enriched.length,
      matched: total,
      processing: enriched.filter((o) => o.status_group === "processing").length,
      delivered: enriched.filter((o) => o.status_group === "delivered").length,
      failed: enriched.filter((o) => o.status_group === "failed").length,
      refunded: enriched.filter((o) => o.status === "refunded").length,
      refund_pending: enriched.filter((o) => o.status === "refund_pending").length,
      spent: Math.round(spent * 100) / 100,
    },
    page,
    per_page: perPage,
    pages,
    has_more: page < pages,
  });
}

/* ---------- Referrals ---------- */
async function handleReferrals(req, res, hint) {
  const { url, path, sub, haystack } = hint;
  const isCredits = path.includes("/credits") || sub === "credits" || haystack.includes("/credits");
  const isClaim = path.includes("/claim") || sub === "claim" || haystack.includes("/claim");
  const isVerify = path.includes("/verify") || sub === "verify" || haystack.includes("/verify");

  if (req.method === "GET" && isCredits) {
    const customer = requireCustomer(req);
    const balance = await referrals.getBalance(customer.id);
    const history = await db.select({
      from: "referral_credits",
      where: { customer_id: `eq.${customer.id}` },
      order: "id.desc",
      limit: 20,
    });
    return json(res, 200, {
      balance,
      history: history.map((h) => ({
        id: h.id,
        direction: h.direction,
        amount: Number(h.amount),
        balance_after: Number(h.balance_after),
        note: h.note,
        created_at: h.created_at,
      })),
    });
  }

  if (req.method === "POST" && isClaim) {
    const customer = requireCustomer(req);
    const body = await readRawBody(req).then((b) => {
      try { return JSON.parse(b); } catch { return null; }
    });
    if (!body || !body.code) return json(res, 400, { error: "Referral code required" });

    const result = await referrals.recordReferral(body.code, customer.id);
    if (!result) {
      return json(res, 400, { error: "Invalid referral code or self-referral not allowed" });
    }
    return json(res, 200, { ok: true, referral_id: result.id });
  }

  // Public endpoint: verify a referral code exists (for the signup page)
  if (req.method === "GET" && isVerify) {
    const code = url.searchParams.get("code") || "";
    if (!code) return json(res, 400, { error: "Code required" });
    const rows = await db.select({ from: "customers", where: { referral_code: `eq.${code.toUpperCase()}` } });
    if (!rows.length) return json(res, 404, { error: "Invalid referral code" });
    const referrer = rows[0];
    return json(res, 200, {
      valid: true,
      referrer_name: referrer.name?.split(" ")[0] || "A friend",
    });
  }

  if (req.method === "GET") {
    const customer = requireCustomer(req);
    const stats = await referrals.getStats(customer.id);
    return json(res, 200, {
      ...stats,
      referral_link: `${(process.env.SITE_URL || "https://valmontdata.com").replace(/\/$/, "")}/r/${stats.code}`,
      credit_amount: referrals.DEFAULT_CREDIT,
      max_credit: referrals.MAX_CREDIT_PER_CUSTOMER,
    });
  }

  return json(res, 404, { error: "Not found" });
}

/* ---------- Reseller store ---------- */
async function handleStore(req, res, hint) {
  const { url, path, sub, haystack } = hint;
  const isPublic = path.includes("/public") || sub === "public" || haystack.includes("/public");
  const isCheck = path.includes("/check") || sub === "check" || haystack.includes("/check");
  const isEarnings = path.includes("/earnings") || sub === "earnings" || haystack.includes("/earnings");
  const isOrders = path.includes("/orders") || sub === "orders" || haystack.includes("/orders");

  // ---- Public endpoints (no auth) ----
  if (req.method === "GET" && isPublic) {
    const slug = url.searchParams.get("slug") || "";
    if (!slug) return json(res, 400, { error: "Slug required" });
    const store = await resellers.getStoreBySlug(slug);
    if (!store) return json(res, 404, { error: "Store not found" });
    return json(res, 200, { store });
  }

  if (req.method === "GET" && isCheck) {
    const slug = resellers.slugify(url.searchParams.get("slug") || "");
    if (slug.length < 3) return json(res, 200, { available: false, reason: "too short" });
    const available = await resellers.isSlugAvailable(slug);
    return json(res, 200, { available, slug });
  }

  // ---- Authenticated endpoints ----
  const customer = requireCustomer(req);

  if (req.method === "GET" && isEarnings) {
    const store = await resellers.getStoreForCustomer(customer.id);
    if (!store) return json(res, 404, { error: "No store found — create one first" });
    const earnings = await resellers.getEarnings(store.id);
    return json(res, 200, earnings);
  }

  if (req.method === "GET" && isOrders) {
    const store = await resellers.getStoreForCustomer(customer.id);
    if (!store) return json(res, 404, { error: "No store found — create one first" });
    const storeOrders = await resellers.getStoreOrders(store.id);
    return json(res, 200, { orders: storeOrders });
  }

  if (req.method === "GET") {
    const store = await resellers.getStoreForCustomer(customer.id);
    return json(res, 200, { store });
  }

  if (req.method === "POST") {
    const body = await readRawBody(req).then((b) => {
      try { return JSON.parse(b); } catch { return null; }
    });
    if (!body) return json(res, 400, { error: "Invalid JSON" });

    // Check if store already exists — if so, update; otherwise create
    const existing = await resellers.getStoreForCustomer(customer.id);
    if (existing) {
      const result = await resellers.updateStore(customer.id, body);
      if (!result.ok) return json(res, 400, { error: result.error });
      return json(res, 200, { ok: true, store: result.store, updated: true });
    } else {
      const result = await resellers.createStore(customer.id, body);
      if (!result.ok) return json(res, 400, { error: result.error });
      return json(res, 201, { ok: true, store: result.store, created: true });
    }
  }

  return json(res, 404, { error: "Not found" });
}

/* ---------- Admin review moderation (folded into this existing function) -- */
async function handleAdminReviews(req, res, hint) {
  // Authenticate before reading any review/order provenance. No customer token
  // is enough for this queue.
  const admin = requireAdmin(req);
  const { url } = hint;

  if (req.method === "GET") {
    const result = await reviews.listForAdmin({
      network: url.searchParams.get("network") || "all",
      status: url.searchParams.get("status") || "all",
      limit: url.searchParams.get("limit") || 100,
    });
    if (!result.ok) return json(res, result.status || 400, { error: result.error });
    res.setHeader("Cache-Control", "no-store");
    return json(res, 200, result);
  }

  if (req.method === "POST") {
    const body = await readRawBody(req).then((b) => {
      try { return JSON.parse(b); } catch { return null; }
    });
    if (!body) return json(res, 400, { error: "Invalid JSON" });
    const actor = String(admin.actor || "administrator").slice(0, 80);
    const result = await reviews.moderateReview(Number(body.id || 0), body.status, actor);
    if (!result.ok) return json(res, result.status || 400, { error: result.error });
    res.setHeader("Cache-Control", "no-store");
    return json(res, 200, result);
  }

  return json(res, 405, { error: "GET/POST only" });
}

/* ---------------------------------------------------------------------------
   Product reviews — verified purchases only.

   The public GET is what the generated landing pages render; the same response
   is what assets/js/reviews.js turns into AggregateRating/Review schema, so the
   structured data can never claim a rating the page is not showing.

   Writes require a customer token AND a delivered order for that exact bundle
   (checked in lib/reviews.js). Admins can hide a review; nobody deletes rows.
   --------------------------------------------------------------------------- */
async function handleReviews(req, res, hint) {
  const { url, path, sub } = hint;
  if (sub === "admin" || /\/reviews\/admin$/.test(path)) {
    return handleAdminReviews(req, res, hint);
  }

  if (req.method === "GET") {
    const network = url.searchParams.get("network") || "";
    const size_mb = url.searchParams.get("size_mb") || url.searchParams.get("size") || "";
    if (!network || !size_mb) {
      return json(res, 400, { error: "network and size_mb are required (e.g. /api/reviews?network=mtn&size_mb=10240)" });
    }

    const customer = getCustomer(req);
    const found = await reviews.listForBundle(network, size_mb, { limit: url.searchParams.get("limit") || 20 });
    if (!found.bundle) return json(res, 404, { error: "We do not sell that bundle" });

    const out = {
      ok: true,
      network: found.bundle.network,
      size_mb: found.bundle.size_mb,
      reviews: found.reviews,
      summary: found.summary,
    };

    // `you` is per-account, so an authed read must never be shared-cached.
    if (customer) {
      const mine = await reviews.canReview(customer.id, network, size_mb);
      out.you = {
        signed_in: true,
        can_review: Boolean(mine.ok),
        already_reviewed: Boolean(mine.already_reviewed),
        reason: mine.ok ? null : mine.reason,
        order_reference: mine.order_reference || null,
        review: mine.already_reviewed ? await reviews.myReview(customer.id, network, size_mb) : null,
      };
      res.setHeader("Cache-Control", "no-store");
      return json(res, 200, out);
    }

    // Moderation must disappear immediately rather than remain as stale CDN
    // content after an admin hides a row.
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=0, must-revalidate");
    return json(res, 200, out);
  }

  if (req.method === "POST") {
    const auth = requireCustomer(req);
    const body = await readRawBody(req).then((b) => {
      try { return JSON.parse(b); } catch { return null; }
    });
    if (!body) return json(res, 400, { error: "Invalid JSON" });

    const result = await reviews.upsertReview(auth.id, body);
    if (!result.ok) return json(res, result.status || 400, { error: result.error });
    return json(res, result.created ? 201 : 200, {
      ok: true,
      created: result.created,
      review: result.review,
      message: result.created ? "Thanks — your review is live" : "Review updated",
    });
  }

  if (req.method === "DELETE") {
    // Admin may hide any review; a customer may retract their own. Either way it
    // is a status change — the row (and the order it was verified against) stays.
    const admin = getAdmin(req);
    const author = admin ? null : requireCustomer(req);   // throws 401 for a guest
    let id = Number(url.searchParams.get("id") || 0);
    if (!id) {
      const body = await readRawBody(req).then((b) => {
        try { return JSON.parse(b); } catch { return null; }
      });
      if (body && body.id) id = Number(body.id);
    }
    if (!id) return json(res, 400, { error: "id is required" });
    const result = admin
      ? await reviews.moderateReview(id, "removed", String(admin.actor || "administrator").slice(0, 80))
      : await reviews.removeOwnReview(author.id, id);
    if (!result.ok) return json(res, result.status || 400, { error: result.error });
    return json(res, 200, { ok: true, removed: result.id });
  }

  return json(res, 405, { error: "Method not allowed" });
}

/* ---------- Server-rendered reseller storefront (/s/:slug) ---------------- */
const STOREFRONT_TEMPLATE = pathUtil.join(__dirname, "..", "storefront.html");
const STORE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])
  );
}

function storefrontNotFound(res) {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Store not found | Valmont Data</title><style>body{margin:0;background:#0b1a38;color:#f8fafc;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}.card{max-width:34rem;padding:2rem;text-align:center}.btn{display:inline-block;margin-top:1rem;padding:.75rem 1rem;border-radius:.5rem;background:#ff8c00;color:#fff;text-decoration:none;font-weight:700}</style></head><body><main class="card"><h1>Store not found</h1><p>This reseller store is unavailable or no longer active.</p><a class="btn" href="/">Visit Valmont Data</a></main></body></html>`);
}

function replaceStoreToken(html, token, value) {
  const pattern = new RegExp(
    "<!--" + token + "_START-->[\\s\\S]*?<!--" + token + "_END-->",
    "g"
  );
  return html.replace(pattern, () => escapeHtml(value));
}

async function handleStorefront(req, res, hint) {
  if (req.method !== "GET") return json(res, 405, { error: "GET only" });
  const rawSlug = String(hint.url.searchParams.get("slug") || "").trim().toLowerCase();
  if (!STORE_SLUG.test(rawSlug) || rawSlug.length < 3 || rawSlug.length > 40) {
    return storefrontNotFound(res);
  }

  const store = await resellers.getStoreBySlug(rawSlug); // active stores only
  if (!store) return storefrontNotFound(res);

  let template;
  try {
    template = fs.readFileSync(STOREFRONT_TEMPLATE, "utf8");
  } catch (err) {
    // includeFiles in vercel.json makes this a deployment configuration error,
    // not a silent fallback to a generic, indexable storefront.
    throw err;
  }

  const storeName = String(store.store_name || "Valmont Data reseller store").trim().slice(0, 120);
  const tagline = String(store.tagline || "").trim().slice(0, 240);
  const ownerName = String(store.owner_name || "Valmont customer").trim().slice(0, 120);
  const title = `${storeName} — data bundles | Valmont Data store`;
  const description = `${storeName} is a Valmont Data reseller store${tagline ? `: ${tagline}` : ""}. Buy MTN, Telecel and AirtelTigo data bundles with Mobile Money or card.`.slice(0, 300);
  const canonical = `${siteOrigin(req.headers?.host)}/s/${rawSlug}`;

  let html = template;
  html = replaceStoreToken(html, "STOREFRONT_TITLE", title);
  html = replaceStoreToken(html, "STOREFRONT_DESCRIPTION", description);
  html = replaceStoreToken(html, "STOREFRONT_CANONICAL", canonical);
  html = replaceStoreToken(html, "STOREFRONT_NAME", storeName);
  html = replaceStoreToken(html, "STOREFRONT_TAGLINE", tagline);
  html = replaceStoreToken(html, "STOREFRONT_OWNER", ownerName);
  html = html.replace('content="noindex"', 'content="index,follow"');
  html = html.replace("window.__VALMONT_STOREFRONT_SSR__ = false", "window.__VALMONT_STOREFRONT_SSR__ = true");

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.end(html);
}

module.exports = wrap(async (req, res) => {
  const hint = routeHint(req);
  const { path, section, haystack } = hint;

  // Server-rendered active reseller storefront. This is intentionally before
  // the generic /store API matcher below; /s/:slug rewrites here on Vercel.
  if (section === "storefront" || path.startsWith("/s/")) return handleStorefront(req, res, hint);

  // Public SMS opt-in — no customer token required
  if (path.includes("/optin") || haystack.includes("/optin")) return optin(req, res);

  // Product reviews — must match before the generic account GET
  if (path.includes("/reviews") || section === "reviews" || haystack.includes("/reviews")) {
    return handleReviews(req, res, hint);
  }

  // Purchase history — must match before the generic account GET
  if (path.includes("/history") || section === "history" || haystack.includes("/history")) {
    return handleHistory(req, res);
  }

  // Referrals — must match before the generic account GET/POST
  if (path.includes("/referrals") || section === "referrals" || haystack.includes("/referrals")) {
    return handleReferrals(req, res, hint);
  }

  // Reseller store
  if (path.includes("/store") || section === "store" || haystack.includes("/store")) {
    return handleStore(req, res, hint);
  }

  if (req.method === "GET") return get(req, res);
  if (req.method === "POST") return post(req, res);
  if (req.method === "DELETE") return del(req, res);
  return json(res, 405, { error: "Method not allowed" });
});

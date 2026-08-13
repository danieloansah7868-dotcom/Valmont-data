/* ============================================================================
   Reseller Store API
     GET  /api/store                → own store data (customer-authenticated)
     POST /api/store                → create/update store (customer-authenticated)
     GET  /api/store/check?slug=x   → check slug availability
     GET  /api/store/earnings       → earnings ledger (store owner)
     GET  /api/store/orders         → recent store orders (store owner)
     GET  /api/store/public?slug=x  → public store data (no auth)
   ============================================================================ */

const { json, readRawBody, wrap } = require("../lib/http");
const { requireCustomer, getCustomer } = require("../lib/auth");
const resellers = require("../lib/resellers");

async function handler(req, res) {
  const url = new URL(req.url, "http://local");
  const path = url.pathname;

  // ---- Public endpoints (no auth) ----
  if (req.method === "GET" && (path === "/api/store/public" || path.startsWith("/api/store/public"))) {
    const slug = url.searchParams.get("slug") || "";
    if (!slug) return json(res, 400, { error: "Slug required" });
    const store = await resellers.getStoreBySlug(slug);
    if (!store) return json(res, 404, { error: "Store not found" });
    return json(res, 200, { store });
  }

  if (req.method === "GET" && path === "/api/store/check") {
    const slug = resellers.slugify(url.searchParams.get("slug") || "");
    if (slug.length < 3) return json(res, 200, { available: false, reason: "too short" });
    const available = await resellers.isSlugAvailable(slug);
    return json(res, 200, { available, slug });
  }

  // ---- Authenticated endpoints ----
  const customer = requireCustomer(req);

  if (req.method === "GET" && path === "/api/store") {
    const store = await resellers.getStoreForCustomer(customer.id);
    return json(res, 200, { store });
  }

  if (req.method === "POST" && path === "/api/store") {
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

  if (req.method === "GET" && path === "/api/store/earnings") {
    const store = await resellers.getStoreForCustomer(customer.id);
    if (!store) return json(res, 404, { error: "No store found — create one first" });
    const earnings = await resellers.getEarnings(store.id);
    return json(res, 200, earnings);
  }

  if (req.method === "GET" && path === "/api/store/orders") {
    const store = await resellers.getStoreForCustomer(customer.id);
    if (!store) return json(res, 404, { error: "No store found — create one first" });
    const orders = await resellers.getStoreOrders(store.id);
    return json(res, 200, { orders });
  }

  return json(res, 404, { error: "Not found" });
}

module.exports = wrap(handler);

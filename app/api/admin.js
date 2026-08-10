/* ============================================================================
   Unified Admin API router — consolidates all /api/admin/* endpoints into a
   single serverless function (fits comfortably within Vercel Hobby's 12-function limit).

   Handles:
     POST /api/admin/login
     GET  /api/admin/float
     POST /api/admin/float/topup
     POST /api/admin/float/seed
     GET  /api/admin/orders
     POST /api/admin/orders/retry
     GET  /api/admin/pl
     GET  /api/admin/webhooks
     GET  /api/admin/remadata-prices
     GET  /api/admin/wallet-balance
     GET  /api/admin/bundles
     POST /api/admin/bundles/update-prices
   ============================================================================ */

const { json, readRawBody, wrap } = require("../lib/http");
const { db } = require("../lib/supabase");
const { requireAdmin, sign } = require("../lib/auth");
const orders = require("../lib/orders");
const { getSupplier } = require("../lib/supplier");

async function handler(req, res) {
  const url = new URL(req.url, "http://local");
  const pathname = url.pathname;

  // 1. POST /api/admin/login
  if (pathname.endsWith("/login") || pathname === "/api/admin/login") {
    if (req.method !== "POST") return json(res, 405, { error: "POST only" });
    const body = await readRawBody(req).then((b) => {
      try { return JSON.parse(b); } catch { return null; }
    });
    const password = body?.password || "";
    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return json(res, 401, { error: "Wrong password" });
    }
    return json(res, 200, { token: sign({ role: "admin" }) });
  }

  // All other admin endpoints require admin token
  requireAdmin(req);

  // 2. /api/admin/float
  if (pathname.includes("/float/topup")) {
    if (req.method !== "POST") return json(res, 405, { error: "POST only" });
    const body = await readRawBody(req).then((b) => {
      try { return JSON.parse(b); } catch { return null; }
    });
    const amount = Number(body?.amount);
    const network = String(body?.network || "");
    const note = String(body?.note || "").slice(0, 200);
    if (!amount || amount <= 0) return json(res, 400, { error: "Amount must be positive" });
    const nets = await db.select({ from: "networks", where: { code: `eq.${network}` } });
    if (!nets[0]) return json(res, 400, { error: "Unknown network" });
    const balance = await orders.addFloatEntry(nets[0].id, "topup", amount, null, note || "Manual top-up");
    return json(res, 200, { network, balance: Number(balance) });
  }

  if (pathname.includes("/float/seed")) {
    if (req.method !== "POST") return json(res, 405, { error: "POST only" });
    const networks = await db.select({ from: "networks", where: { is_active: "eq.true" }, order: "id.asc" });
    const seedAmount = Math.max(1, Number(process.env.INITIAL_FLOAT || "500"));
    const results = [];
    for (const n of networks) {
      const balance = await orders.currentFloat(n.id);
      if (balance >= 0.01) {
        results.push({ code: n.code, name: n.name, seeded: false, balance });
        continue;
      }
      const bal = await orders.addFloatEntry(n.id, "topup", seedAmount, null, "Seed — initial float");
      results.push({ code: n.code, name: n.name, seeded: true, balance: Number(bal) });
    }
    const seeded = results.filter((r) => r.seeded).length;
    return json(res, 200, {
      seeded,
      seed_amount: seedAmount,
      message: seeded
        ? `Seeded initial float (GH₵${seedAmount}) for ${seeded} network${seeded === 1 ? "" : "s"}`
        : "All networks already have float — nothing to seed",
      results,
    });
  }

  if (pathname.endsWith("/float") || pathname === "/api/admin/float") {
    if (req.method !== "GET") return json(res, 405, { error: "GET only" });
    const networks = await db.select({ from: "networks", where: { is_active: "eq.true" }, order: "id.asc" });
    const threshold = Number(process.env.LOW_FLOAT_THRESHOLD || "50");
    const balances = [];
    for (const n of networks) {
      const balance = await orders.currentFloat(n.id);
      balances.push({ code: n.code, name: n.name, balance, low: balance < threshold, threshold });
    }
    const ledger = await db.select({ from: "float_ledger", order: "id.desc", limit: 20 });
    const ledgerWithNet = ledger.map((l) => ({
      ...l,
      network: networks.find((n) => n.id === l.network_id)?.code,
    }));
    return json(res, 200, { balances, ledger: ledgerWithNet });
  }

  // 3. /api/admin/orders
  if (pathname.includes("/orders/retry")) {
    if (req.method !== "POST") return json(res, 405, { error: "POST only" });
    const body = await readRawBody(req).then((b) => {
      try { return JSON.parse(b); } catch { return null; }
    });
    const reference = String(body?.reference || "");
    const order = await orders.findOrderByReference(reference);
    if (!order) return json(res, 404, { error: "Order not found" });
    const result = await orders.retryOrder(order);
    return json(res, 200, { reference, ...result });
  }

  if (pathname.endsWith("/orders") || pathname === "/api/admin/orders") {
    if (req.method !== "GET") return json(res, 405, { error: "GET only" });
    const status = url.searchParams.get("status");
    const network = url.searchParams.get("network");
    const limit = Math.min(Number(url.searchParams.get("limit") || "50"), 200);
    const where = {};
    if (status && status !== "all") where.status = `eq.${status}`;
    let rows = await db.select({ from: "orders", where, order: "id.desc", limit });
    if (network && network !== "all") {
      const nets = await db.select({ from: "networks", where: { code: `eq.${network}` } });
      const netId = nets[0]?.id;
      rows = rows.filter((r) => r.network_id === netId);
    }
    const nets = await db.select({ from: "networks" });
    const bundles = await db.select({ from: "bundles" });
    const out = rows.map((o) => {
      const net = nets.find((n) => n.id === o.network_id);
      const b = bundles.find((x) => x.id === o.bundle_id);
      return {
        reference: o.reference,
        phone: o.phone,
        network: net?.code,
        bundle: b ? `${b.size_mb / 1024}GB` : null,
        amount: Number(o.amount),
        cost: Number(o.cost_price),
        margin: Number(o.amount) - Number(o.cost_price),
        status: o.status,
        attempts: o.attempts,
        provider_reference: o.provider_reference,
        supplier_ref: o.supplier_ref,
        supplier_error: o.supplier_response?.error || null,
        supplier_response: o.supplier_response,
        created_at: o.created_at,
        delivered_at: o.delivered_at,
        retryable: ["failed", "delivering"].includes(o.status) && Number(o.attempts || 0) < orders.MAX_ATTEMPTS,
      };
    });
    return json(res, 200, { orders: out });
  }

  // 4. /api/admin/pl
  if (pathname.endsWith("/pl") || pathname === "/api/admin/pl") {
    if (req.method !== "GET") return json(res, 405, { error: "GET only" });
    const days = Math.min(Math.max(Number(url.searchParams.get("days") || "30"), 1), 365);
    const rows = await db.rpc("daily_pnl", { p_days: days });
    return json(res, 200, { days, rows });
  }

  // 5. /api/admin/webhooks
  if (pathname.endsWith("/webhooks") || pathname === "/api/admin/webhooks") {
    if (req.method !== "GET") return json(res, 405, { error: "GET only" });
    const limit = Math.min(Number(url.searchParams.get("limit") || "20"), 100);
    const rows = await db.select({ from: "webhook_log", order: "id.desc", limit });
    return json(res, 200, { webhooks: rows });
  }

  // 6. /api/admin/remadata-prices
  if (pathname.includes("/remadata-prices")) {
    if (req.method !== "GET") return json(res, 405, { error: "GET only" });
    const supplier = getSupplier();
    let supplierBundles = [];
    try {
      supplierBundles = await supplier.fetchBundles();
    } catch (err) {
      return json(res, 502, { error: `Failed to fetch prices from RemaData: ${err.message}` });
    }
    const networks = await db.select({ from: "networks", where: { is_active: "eq.true" }, order: "id.asc" });
    const bundles = await db.select({ from: "bundles", where: { is_active: "eq.true" }, order: "network_id.asc,sort_order.asc" });
    const comparison = bundles.map((b) => {
      const net = networks.find((n) => n.id === b.network_id);
      const netCode = net ? net.code.toLowerCase() : "";
      const matchedSupplier = supplierBundles.find(
        (sb) => sb.network.toLowerCase() === netCode && Number(sb.volumeInMB) === Number(b.size_mb)
      );
      const currentCost = Number(b.cost_price);
      const currentSell = Number(b.sell_price);
      const newCost = matchedSupplier ? Number(matchedSupplier.price) : currentCost;
      const suggestedSell = Math.round((newCost * 1.15) * 10) / 10;
      const currentMargin = Number((currentSell - currentCost).toFixed(2));
      const newMargin = Number((currentSell - newCost).toFixed(2));
      const isLoss = currentSell <= newCost;
      return {
        id: b.id,
        network: netCode,
        network_name: net ? net.name : netCode.toUpperCase(),
        size_mb: b.size_mb,
        validity_days: b.validity_days,
        current_cost: currentCost,
        new_cost: newCost,
        current_sell: currentSell,
        current_margin: currentMargin,
        suggested_sell: suggestedSell,
        new_margin: newMargin,
        is_loss: isLoss,
        matched: !!matchedSupplier,
      };
    });
    return json(res, 200, { ok: true, supplier: supplier.name, supplier_bundles: supplierBundles, bundles: comparison });
  }

  // 7. /api/admin/wallet-balance
  if (pathname.includes("/wallet-balance")) {
    if (req.method !== "GET") return json(res, 405, { error: "GET only" });
    const supplier = getSupplier();
    try {
      const data = await supplier.fetchWalletBalance();
      return json(res, 200, {
        ok: true,
        supplier: supplier.name,
        balance: Number(data.balance) || 0,
        currency: data.currency || "GHS",
        mock: !!data.mock,
      });
    } catch (err) {
      return json(res, 502, { error: `Failed to fetch wallet balance: ${err.message}` });
    }
  }

  // 8. /api/admin/bundles
  if (pathname.includes("/bundles")) {
    if (req.method === "GET") {
      const networks = await db.select({ from: "networks", where: { is_active: "eq.true" }, order: "id.asc" });
      const bundles = await db.select({ from: "bundles", where: { is_active: "eq.true" }, order: "network_id.asc,sort_order.asc" });
      const out = bundles.map((b) => ({
        ...b,
        network_code: networks.find((n) => n.id === b.network_id)?.code,
        network_name: networks.find((n) => n.id === b.network_id)?.name,
        cost_price: Number(b.cost_price),
        sell_price: Number(b.sell_price),
      }));
      return json(res, 200, { ok: true, bundles: out });
    }
    if (req.method === "POST" || req.method === "PUT") {
      const body = await readRawBody(req).then((b) => {
        try { return JSON.parse(b); } catch { return null; }
      });
      if (!body) return json(res, 400, { error: "Invalid JSON payload" });
      const updates = Array.isArray(body.updates) ? body.updates : (Array.isArray(body.bundles) ? body.bundles : []);
      if (!updates.length) return json(res, 400, { error: "No bundle updates provided" });
      let updatedCount = 0;
      for (const item of updates) {
        const id = Number(item.id);
        if (!id) continue;
        const fields = {};
        if (item.cost_price !== undefined && !isNaN(Number(item.cost_price)) && Number(item.cost_price) >= 0) {
          fields.cost_price = Number(Number(item.cost_price).toFixed(2));
        }
        if (item.sell_price !== undefined && !isNaN(Number(item.sell_price)) && Number(item.sell_price) >= 0) {
          fields.sell_price = Number(Number(item.sell_price).toFixed(2));
        }
        if (Object.keys(fields).length > 0) {
          await db.update("bundles", fields, { id: `eq.${id}` });
          updatedCount += 1;
        }
      }
      return json(res, 200, { ok: true, message: `Updated ${updatedCount} bundle${updatedCount === 1 ? "" : "s"} successfully`, updated: updatedCount });
    }
  }

  return json(res, 404, { error: "Admin endpoint not found" });
}

module.exports = wrap(handler);

/* Admin orders
     GET  /api/admin/orders?status=&network=&limit=   → orders (incl. cost + supplier response)
     POST /api/admin/orders/retry { reference }        → manual retry of failed delivery
   Requires admin token. */

const { json, readRawBody, wrap } = require("../../lib/http");
const { db } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");
const orders = require("../../lib/orders");

async function get(req, res) {
  requireAdmin(req);
  const url = new URL(req.url, "http://local");
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

async function retry(req, res) {
  requireAdmin(req);
  const body = await readRawBody(req).then((b) => {
    try { return JSON.parse(b); } catch { return null; }
  });
  const reference = String(body?.reference || "");
  const order = await orders.findOrderByReference(reference);
  if (!order) return json(res, 404, { error: "Order not found" });
  const result = await orders.retryOrder(order);
  return json(res, 200, { reference, ...result });
}

module.exports = wrap(async (req, res) => {
  if (req.method === "GET") return get(req, res);
  if (req.method === "POST" && req.url.includes("/retry")) return retry(req, res);
  return json(res, 405, { error: "Method not allowed" });
});

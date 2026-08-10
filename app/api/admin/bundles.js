/* ============================================================================
   Admin bundles API — view full catalog with cost prices and apply price updates.
   POST /api/admin/bundles/update-prices
   Admin-authenticated only (service role write).
   ============================================================================ */

const { json, readRawBody, wrap } = require("../../lib/http");
const { db } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

async function get(req, res) {
  requireAdmin(req);
  const networks = await db.select({
    from: "networks",
    where: { is_active: "eq.true" },
    order: "id.asc",
  });
  const bundles = await db.select({
    from: "bundles",
    where: { is_active: "eq.true" },
    order: "network_id.asc,sort_order.asc",
  });
  const out = bundles.map((b) => ({
    ...b,
    network_code: networks.find((n) => n.id === b.network_id)?.code,
    network_name: networks.find((n) => n.id === b.network_id)?.name,
    cost_price: Number(b.cost_price),
    sell_price: Number(b.sell_price),
  }));
  return json(res, 200, { ok: true, bundles: out });
}

async function post(req, res) {
  requireAdmin(req);
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

  return json(res, 200, {
    ok: true,
    message: `Updated ${updatedCount} bundle${updatedCount === 1 ? "" : "s"} successfully`,
    updated: updatedCount,
  });
}

module.exports = wrap(async (req, res) => {
  if (req.method === "GET") return get(req, res);
  if (req.method === "POST" || req.method === "PUT") return post(req, res);
  return json(res, 405, { error: "Method not allowed" });
});

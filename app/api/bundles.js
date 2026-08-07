/* ============================================================================
   GET /api/bundles — public catalogue + availability.
   Returns only safe fields (never cost_price). `available` is computed
   server-side from live float so the UI auto-disables sold-out bundles.
   ============================================================================ */

const { json, wrap } = require("../lib/http");
const { db } = require("../lib/supabase");
const orders = require("../lib/orders");

async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "GET only" });

  const networks = await db.select({
    from: "networks",
    where: { is_active: "eq.true" },
    select: "id,code,name,logo_url",
    order: "id.asc",
  });
  const bundles = await db.select({
    from: "bundles",
    where: { is_active: "eq.true" },
    select: "id,network_id,size_mb,validity_days,sell_price,sort_order",
    order: "network_id.asc,sort_order.asc",
  });

  const threshold = Number(process.env.LOW_FLOAT_THRESHOLD || "50");
  const floats = {};
  const lowFloat = {};
  for (const n of networks) {
    const balance = await orders.currentFloat(n.id);
    floats[n.code] = balance;
    lowFloat[n.code] = balance < threshold;
  }

  const out = bundles.map((b) => ({
    id: b.id,
    network: networks.find((n) => n.id === b.network_id)?.code,
    size_mb: b.size_mb,
    validity_days: b.validity_days,
    price: Number(b.sell_price),
    available: floats[networks.find((n) => n.id === b.network_id)?.code] >= Number(b.cost_price),
  }));

  return json(res, 200, {
    networks: networks.map((n) => ({ code: n.code, name: n.name })),
    bundles: out,
    floats,
    low_float: lowFloat,
    threshold,
  });
}

module.exports = wrap(handler);

/* ============================================================================
   GET /api/admin/remadata-prices — fetch live supplier prices and build
   a comparison matrix against our active bundle catalog.
   Admin-authenticated only.
   ============================================================================ */

const { json, wrap } = require("../../lib/http");
const { db } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");
const { remadata, mock, getSupplier } = require("../../lib/supplier");

async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "GET only" });

  requireAdmin(req);

  const supplier = getSupplier();
  let supplierBundles = [];
  try {
    supplierBundles = await supplier.fetchBundles();
  } catch (err) {
    return json(res, 502, { error: `Failed to fetch prices from RemaData: ${err.message}` });
  }

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

  const comparison = bundles.map((b) => {
    const net = networks.find((n) => n.id === b.network_id);
    const netCode = net ? net.code.toLowerCase() : "";

    const matchedSupplier = supplierBundles.find(
      (sb) => sb.network.toLowerCase() === netCode && Number(sb.volumeInMB) === Number(b.size_mb)
    );

    const currentCost = Number(b.cost_price);
    const currentSell = Number(b.sell_price);
    const newCost = matchedSupplier ? Number(matchedSupplier.price) : currentCost;

    // Suggested sell = cost × 1.15 rounded to GH₵0.10
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

  return json(res, 200, {
    ok: true,
    supplier: supplier.name,
    supplier_bundles: supplierBundles,
    bundles: comparison,
  });
}

module.exports = wrap(handler);

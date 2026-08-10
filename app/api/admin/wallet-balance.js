/* ============================================================================
   GET /api/admin/wallet-balance — fetch the live supplier wallet balance
   from RemaData to show alongside ledger float.
   Admin-authenticated only.
   ============================================================================ */

const { json, wrap } = require("../../lib/http");
const { requireAdmin } = require("../../lib/auth");
const { getSupplier } = require("../../lib/supplier");

async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "GET only" });

  requireAdmin(req);

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

module.exports = wrap(handler);

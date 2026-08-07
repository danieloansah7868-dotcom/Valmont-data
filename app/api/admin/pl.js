/* GET /api/admin/pl?days=7|30 — daily P&L per network (revenue, cost, margin) */

const { json, wrap } = require("../../lib/http");
const { db } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

async function handler(req, res) {
  requireAdmin(req);
  const url = new URL(req.url, "http://local");
  const days = Math.min(Math.max(Number(url.searchParams.get("days") || "30"), 1), 365);
  const rows = await db.rpc("daily_pnl", { p_days: days });
  return json(res, 200, { days, rows });
}

module.exports = wrap(handler);

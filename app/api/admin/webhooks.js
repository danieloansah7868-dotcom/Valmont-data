/* GET /api/admin/webhooks?limit=20 — recent Valmont-Pay callback log (audit) */

const { json, wrap } = require("../../lib/http");
const { db } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");

async function handler(req, res) {
  requireAdmin(req);
  const url = new URL(req.url, "http://local");
  const limit = Math.min(Number(url.searchParams.get("limit") || "20"), 100);
  const rows = await db.select({ from: "webhook_log", order: "id.desc", limit });
  return json(res, 200, { webhooks: rows });
}

module.exports = wrap(handler);

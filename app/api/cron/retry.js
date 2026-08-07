/* ============================================================================
   Vercel Cron: GET /api/cron/retry  (every 15 min — see vercel.json)

   1. Retries failed/stuck deliveries (backoff = cron cadence; max 3 attempts)
   2. Alerts admin when float is low per network
   ============================================================================ */

const { json, wrap } = require("../../lib/http");
const { db } = require("../../lib/supabase");
const orders = require("../../lib/orders");
const { notify } = require("../../lib/notify");

async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return json(res, 405, { error: "GET/POST only" });

  const retried = [];
  const candidates = await db.select({
    from: "orders",
    where: { status: "in.(failed,delivering)" },
    order: "id.asc",
    limit: 25,
  });

  for (const order of candidates) {
    if (Number(order.attempts || 0) >= orders.MAX_ATTEMPTS) continue;
    // stuck "delivering" older than 30 min is treated as failed → retry
    if (order.status === "delivering") {
      const ageMin = (Date.now() - new Date(order.created_at).getTime()) / 60000;
      if (ageMin < 30) continue;
    }
    const result = await orders.retryOrder(order);
    retried.push({ reference: order.reference, ...result });
  }

  // low-float alert
  const low = [];
  const networks = await db.select({ from: "networks", where: { is_active: "eq.true" } });
  const threshold = Number(process.env.LOW_FLOAT_THRESHOLD || "50");
  for (const n of networks) {
    const balance = await orders.currentFloat(n.id);
    if (balance < threshold) {
      low.push({ network: n.code, balance: Number(balance), threshold });
      await notify.lowFloat(n.code, balance, threshold);
    }
  }

  return json(res, 200, { retried, low_float: low, ts: new Date().toISOString() });
}

module.exports = wrap(handler);

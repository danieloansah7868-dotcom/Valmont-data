/* Admin float dashboard
     GET  /api/admin/float            → balances + low-float flags + recent ledger
     POST /api/admin/float/topup      → { network, amount, note } top-up entry
     POST /api/admin/float/seed       → seed initial float for every network that
                                        still has GH₵0 balance (INITIAL_FLOAT,
                                        default 500). Safe to re-run — never
                                        clobbers existing float.
   All require the admin token. */

const { json, readRawBody, wrap } = require("../../lib/http");
const { db } = require("../../lib/supabase");
const { requireAdmin } = require("../../lib/auth");
const orders = require("../../lib/orders");

async function get(req, res) {
  requireAdmin(req);
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

async function topup(req, res) {
  requireAdmin(req);
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

/* One-click bring-the-shop-live: seed every network that has no float yet.
   Only touches networks with a zero balance, so it is safe to run any time
   (and to re-run after adding a new network). */
async function seed(req, res) {
  requireAdmin(req);
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

module.exports = wrap(async (req, res) => {
  if (req.method === "GET") return get(req, res);
  if (req.method === "POST" && req.url.includes("/topup")) return topup(req, res);
  if (req.method === "POST" && req.url.includes("/seed")) return seed(req, res);
  return json(res, 405, { error: "Method not allowed" });
});

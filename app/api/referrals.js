/* ============================================================================
   Referrals API (customer-authenticated)
     GET  /api/referrals        → referral stats (code, credits, referrals)
     POST /api/referrals/claim  → claim a referral code at signup time
     GET  /api/referrals/credits → credit balance + history
   ============================================================================ */

const { json, readRawBody, wrap } = require("../lib/http");
const { requireCustomer, getCustomer } = require("../lib/auth");
const referrals = require("../lib/referrals");
const { db } = require("../lib/supabase");

async function handler(req, res) {
  const url = new URL(req.url, "http://local");
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/referrals") {
    const customer = requireCustomer(req);
    const stats = await referrals.getStats(customer.id);
    return json(res, 200, {
      ...stats,
      referral_link: `${(process.env.SITE_URL || "https://valmontdata.com").replace(/\/$/, "")}/r/${stats.code}`,
      credit_amount: referrals.DEFAULT_CREDIT,
      max_credit: referrals.MAX_CREDIT_PER_CUSTOMER,
    });
  }

  if (req.method === "GET" && path === "/api/referrals/credits") {
    const customer = requireCustomer(req);
    const balance = await referrals.getBalance(customer.id);
    const history = await db.select({
      from: "referral_credits",
      where: { customer_id: `eq.${customer.id}` },
      order: "id.desc",
      limit: 20,
    });
    return json(res, 200, {
      balance,
      history: history.map((h) => ({
        id: h.id,
        direction: h.direction,
        amount: Number(h.amount),
        balance_after: Number(h.balance_after),
        note: h.note,
        created_at: h.created_at,
      })),
    });
  }

  if (req.method === "POST" && path === "/api/referrals/claim") {
    const customer = requireCustomer(req);
    const body = await readRawBody(req).then((b) => {
      try { return JSON.parse(b); } catch { return null; }
    });
    if (!body || !body.code) return json(res, 400, { error: "Referral code required" });

    const result = await referrals.recordReferral(body.code, customer.id);
    if (!result) {
      return json(res, 400, { error: "Invalid referral code or self-referral not allowed" });
    }
    return json(res, 200, { ok: true, referral_id: result.id });
  }

  // Public endpoint: verify a referral code exists (for the signup page)
  if (req.method === "GET" && path.startsWith("/api/referrals/verify")) {
    const code = url.searchParams.get("code") || "";
    if (!code) return json(res, 400, { error: "Code required" });
    const rows = await db.select({ from: "customers", where: { referral_code: `eq.${code.toUpperCase()}` } });
    if (!rows.length) return json(res, 404, { error: "Invalid referral code" });
    const referrer = rows[0];
    return json(res, 200, {
      valid: true,
      referrer_name: referrer.name?.split(" ")[0] || "A friend",
    });
  }

  return json(res, 404, { error: "Not found" });
}

module.exports = wrap(handler);

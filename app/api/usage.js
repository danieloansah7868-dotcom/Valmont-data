/* ============================================================================
   Usage API — how the web "tracks" the user's data bundle.

     POST /api/usage  { action: "report", reference?, phone?, used_mb }
                       → updates the bundle_usage row for a delivered order
                         (or the newest row for a phone). Returns the updated
                         state incl. `low` and `should_ask` so the caller (or
                         an SMS/WhatsApp automation) can prompt the user.
     GET  /api/usage?phone=0XXXXXXXXX
                       → current usage state for a line (same fields).

   Auth: the telco/supplier integration or the sim-usage script may call with
   an admin token, or with the shared USAGE_REPORT_KEY header (default in dev:
   "dev-usage-key"). This is deliberately NOT customer-authenticated — the
   number IS the key, same model as public order tracking, so it stays simple
   for the supplier pipeline to feed us.
   ============================================================================ */

const { json, readRawBody, wrap } = require("../lib/http");
const { getAdmin } = require("../lib/auth");
const phones = require("../lib/phones");
const orders = require("../lib/orders");
const autoreload = require("../lib/autoreload");

const REPORT_KEY = () => process.env.USAGE_REPORT_KEY || "dev-usage-key";

function authorized(req) {
  // Either an admin token…
  if (getAdmin(req)) return true;
  // …or the shared usage-report key used by the supplier/telco pipeline.
  const key = req.headers?.["x-usage-key"] || req.headers?.["X-Usage-Key"] || "";
  return key === REPORT_KEY();
}

async function get(req, res) {
  if (!authorized(req)) return json(res, 401, { error: "Missing or invalid usage report key" });
  const url = new URL(req.url, "http://local");
  const phone = (url.searchParams.get("phone") || "").trim();
  const reference = (url.searchParams.get("reference") || "").trim();
  if (!phone && !reference) return json(res, 400, { error: "phone or reference query param required" });

  let usage = null;
  if (reference) {
    const order = await orders.findOrderByReference(reference);
    if (!order) return json(res, 404, { error: "Order not found" });
    usage = await autoreload.usageForOrder(order.id);
    if (!usage) return json(res, 404, { error: "No usage record for that order yet — only delivered bundles are tracked" });
  } else {
    usage = await autoreload.latestUsage(phone);
    if (!usage) return json(res, 404, { error: "No usage record for that line yet" });
  }
  const state = autoreload.computeUsageState(usage);
  return json(res, 200, {
    ok: true,
    usage: {
      id: state.id,
      phone: state.phone,
      order_id: state.order_id,
      size_mb: state.size_mb,
      used_mb: state.used_mb,
      percent_used: state.percent_used,
      percent_left: state.percent_left,
      status: state.status,
      low: autoreload.isLow(state),
      expires_at: state.expires_at,
      last_report_at: state.last_report_at,
    },
  });
}

async function post(req, res) {
  if (!authorized(req)) return json(res, 401, { error: "Missing or invalid usage report key" });

  const body = await readRawBody(req).then((b) => {
    try { return JSON.parse(b); } catch { return null; }
  });
  if (!body) return json(res, 400, { error: "Invalid JSON" });

  const reference = body.action === "report" ? body.reference : null;
  const phoneRaw = body.phone || null;
  let phone = null;
  if (phoneRaw) {
    const check = phones.validate(phoneRaw);
    if (!check.valid) return json(res, 400, { error: check.reason });
    phone = check.normalized;
  }

  const usedMb = Number(body.used_mb);
  if (!Number.isFinite(usedMb) || usedMb < 0) {
    return json(res, 400, { error: "used_mb must be a non-negative number" });
  }

  const result = await autoreload.reportUsage({ reference, phone, usedMb });
  if (result.error) return json(res, result.status || 400, { error: result.error });
  return json(res, 200, result);
}

module.exports = wrap(async (req, res) => {
  if (req.method === "GET") return get(req, res);
  if (req.method === "POST") return post(req, res);
  return json(res, 405, { error: "GET/POST only" });
});

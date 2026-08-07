/* ============================================================================
   Orders API (public)
     POST /api/orders  { bundle_id, phone }  → creates pending order, checks
                            float, creates Valmont-Pay checkout, returns
                            { reference, checkout_url }
     GET  /api/orders?reference=VD-...       → public order status (no login)
   ============================================================================ */

const { json, readRawBody, wrap } = require("../lib/http");
const valmontpay = require("../lib/valmontpay");
const phones = require("../lib/phones");
const orders = require("../lib/orders");

async function post(req, res) {
  const body = await readRawBody(req).then((b) => {
    try { return JSON.parse(b); } catch { return null; }
  });
  if (!body) return json(res, 400, { error: "Invalid JSON" });

  const { bundle_id, phone } = body;

  // Phone validation — Ghana format + known prefix. Wrong-network orders are
  // the #1 support burden; we warn (server echoes the warning, UI blocks on it).
  const check = phones.validate(phone);
  if (!check.valid) return json(res, 400, { error: check.reason });
  const networkCheck = phones.checkAgainstNetwork(check.normalized, null);

  const bundle = await orders.findBundleById(Number(bundle_id));
  if (!bundle) return json(res, 404, { error: "Bundle not found or unavailable" });
  const network = await orders.findNetworkById(bundle.network_id);

  // FLOAT GUARD #1 — before we accept the order and take money.
  const float = await orders.currentFloat(bundle.network_id);
  if (float < Number(bundle.cost_price)) {
    return json(res, 422, { error: "This bundle is temporarily unavailable — restocking soon" });
  }

  const order = await orders.createOrder(bundle, check.normalized, bundle.network_id);

  const siteUrl = (process.env.SITE_URL || "").replace(/\/$/, "");
  let checkout;
  try {
    checkout = await valmontpay.createCheckout({
      reference: order.reference,
      amount: Number(order.amount),
      phone: order.phone,
      description: `${(bundle.size_mb / 1024) || bundle.size_mb}${bundle.size_mb >= 1024 ? "GB" : "MB"} ${network.name} data`,
      returnUrl: `${siteUrl}/status.html?reference=${order.reference}`,
      webhookUrl: `${siteUrl}/api/valmontpay/webhook`,
    });
  } catch (e) {
    await orders.setStatus(order.id, "failed", { supplier_response: { checkout_error: e.message } });
    return json(res, 502, { error: "Payment is temporarily unavailable — try again in a minute" });
  }

  return json(res, 201, {
    reference: order.reference,
    checkout_url: checkout.checkout_url || null,
    dev: !!checkout.dev,
    message: checkout.dev
      ? "DEV MODE — no Valmont-Pay configured. Simulate payment: node scripts/sim-webhook.js --ref " + order.reference
      : "Redirecting to Valmont-Pay…",
  });
}

async function get(req, res) {
  const url = new URL(req.url, "http://local");
  const ref = url.searchParams.get("reference") || "";
  if (!/^VD-\d{6}-\d{4}$/.test(ref)) return json(res, 400, { error: "Invalid reference" });

  const order = await orders.findOrderByReference(ref);
  if (!order) return json(res, 404, { error: "Order not found" });

  const bundle = await orders.findBundleById(order.bundle_id);
  const network = await orders.findNetworkById(order.network_id);
  const err = order.supplier_response?.error || (order.status === "refunded" ? order.supplier_response?.reason : null);

  return json(res, 200, {
    order: {
      reference: order.reference,
      phone: order.phone,
      bundle: {
        size_mb: bundle.size_mb,
        validity_days: bundle.validity_days,
        network: network.code,
        network_name: network.name,
      },
      amount: Number(order.amount),
      status: order.status,
      attempts: order.attempts,
      created_at: order.created_at,
      delivered_at: order.delivered_at,
      supplier_error: err || null,
    },
  });
}

module.exports = wrap(async (req, res) => {
  if (req.method === "POST") return post(req, res);
  if (req.method === "GET") return get(req, res);
  return json(res, 405, { error: "Method not allowed" });
});

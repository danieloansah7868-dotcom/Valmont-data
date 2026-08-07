/* ============================================================================
   Valmont-Pay client (tenant #3) + webhook signature verification.

   Valmont-Pay is our own multi-tenant gateway:
   - per-tenant API key → Authorization: Bearer <VALMONTPAY_API_KEY>
   - webhooks signed with HMAC-SHA512 → header `x-valmontpay-signature`
   - key rotation supported: webhook secret is read from env at call time

   The exact checkout/refund endpoint paths follow the gateway's REST
   convention — adjust createCheckout()/refund() if the live API differs
   (ask the Valmont-Pay team for the tenant onboarding pack).
   ============================================================================ */

const crypto = require("crypto");

const VP_BASE = () => (process.env.VALMONTPAY_API_URL || "").replace(/\/$/, "");
const VP_KEY = () => process.env.VALMONTPAY_API_KEY || "";
const VP_SECRET = () => process.env.VALMONTPAY_WEBHOOK_SECRET || "";

function configured() {
  return !!(VP_BASE() && VP_KEY() && VP_SECRET());
}

/** Create a checkout session. Returns { checkout_url, ... } or throws. */
async function createCheckout({ reference, amount, phone, description, returnUrl, webhookUrl }) {
  if (!configured()) {
    // Dev mode: no gateway yet — the caller shows a "simulate payment" path.
    return { checkout_url: null, dev: true };
  }
  const res = await fetch(`${VP_BASE()}/checkouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VP_KEY()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      reference,                    // our order reference — echoed back in the webhook
      amount,
      currency: "GHS",
      customer_phone: phone,
      description,
      return_url: returnUrl,
      webhook_url: webhookUrl,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.checkout_url) {
    const err = new Error("Valmont-Pay checkout failed: " + (data.message || `HTTP ${res.status}`));
    err.status = 502;
    throw err;
  }
  return data;
}

/** Verify x-valmontpay-signature: HMAC-SHA512 of the raw body with our tenant secret. */
function verifySignature(rawBody, signature) {
  if (!VP_SECRET() || !signature) return false;
  const expected = crypto.createHmac("sha512", VP_SECRET()).update(rawBody).digest("hex");
  const provided = String(signature).trim();
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

/** Refund a payment (used by the auto-refund path). */
async function refund(providerReference) {
  if (!configured()) return { dev: true };
  const res = await fetch(`${VP_BASE()}/refunds`, {
    method: "POST",
    headers: { Authorization: `Bearer ${VP_KEY()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ provider_reference: providerReference }),
  });
  return res.json().catch(() => ({}));
}

module.exports = { configured, createCheckout, verifySignature, refund };

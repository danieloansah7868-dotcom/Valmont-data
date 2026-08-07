/* ============================================================================
   ⚠️  THE HEART OF VALMONT DATA — Valmont-Pay payment webhook.

   Rules enforced here (non-negotiable):
   1. IDEMPOTENCY      — provider_reference has a UNIQUE constraint and is set
                         via a conditional UPDATE (is.null). Duplicate webhooks
                         or concurrent retries can NEVER deliver twice.
   2. SIGNATURE        — x-valmontpay-signature (HMAC-SHA512 of raw body with
                         the tenant secret) is verified before anything else.
                         Invalid → 401, logged, ignored.
   3. FLOAT GUARD      — float is checked before checkout (api/orders) AND
                         re-checked here before delivery; the race case ends in
                         an auto-refund, never a negative float.
   4. SERVER-SIDE ONLY — delivery happens exclusively from this handler.
                         The browser never triggers delivery.
   5. AUDIT TRAIL      — every callback is logged to webhook_log, and the full
                         supplier response is stored on the order.
   ============================================================================ */

const { json, readRawBody, getHeader, wrap } = require("../../lib/http");
const { db } = require("../../lib/supabase");
const valmontpay = require("../../lib/valmontpay");
const orders = require("../../lib/orders");

async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });

  const rawBody = await readRawBody(req);
  const signature = getHeader(req, "x-valmontpay-signature");
  const signatureValid = valmontpay.verifySignature(rawBody, signature);

  let payload = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = { raw: rawBody.slice(0, 500) };
  }

  // Audit first — we keep a record of EVERY callback, valid or not.
  const logged = await db.insert("webhook_log", {
    signature_valid: signatureValid,
    payload,
    handled: false,
  });
  const logId = Array.isArray(logged) ? logged[0]?.id : null;

  if (!signatureValid) {
    await db.update("webhook_log", { handled: true, error: "invalid signature" }, { id: `eq.${logId}` });
    return json(res, 401, { error: "invalid signature" });
  }

  // Only payment.succeeded matters. Others are ack'd and ignored.
  if (payload.event !== "payment.succeeded") {
    await db.update("webhook_log", { handled: true }, { id: `eq.${logId}` });
    return json(res, 200, { received: true });
  }

  const { provider_reference, reference, amount } = payload;
  if (!provider_reference || !reference) {
    await db.update("webhook_log", { handled: true, error: "missing provider_reference/reference" }, { id: `eq.${logId}` });
    return json(res, 200, { received: true, error: "missing fields" });
  }

  const order = await orders.findOrderByReference(reference);
  if (!order) {
    // Don't 4xx — the gateway would retry forever. Log for manual reconciliation.
    await db.update("webhook_log", { handled: true, error: `unknown order ${reference}` }, { id: `eq.${logId}` });
    const { notify } = require("../../lib/notify");
    await notify.alert(`Webhook for unknown order ${reference} (${provider_reference})`);
    return json(res, 200, { received: true, error: "unknown order" });
  }

  /* ---- IDEMPOTENCY: claim the order atomically ---- */
  const claimed = await orders.claimOrder(order.id, provider_reference);
  if (!claimed) {
    // Someone else already claimed it. If a previous attempt failed and we
    // still have retries left, give it one more push; otherwise no-op.
    const existing = await orders.findOrderByProviderRef(provider_reference);
    if (existing && existing.status === "failed" && existing.attempts < orders.MAX_ATTEMPTS) {
      await orders.retryOrder(existing);
    }
    await db.update("webhook_log", { handled: true }, { id: `eq.${logId}` });
    return json(res, 200, { received: true, duplicate: true });
  }

  /* ---- amount check: never deliver for the wrong price ---- */
  if (Number(amount) !== Number(claimed.amount)) {
    await orders.refundOrder(claimed, `Amount mismatch: webhook ${amount} vs order ${claimed.amount}`);
    await db.update("webhook_log", { handled: true, error: "amount mismatch → refunded" }, { id: `eq.${logId}` });
    return json(res, 200, { received: true, handled: true, outcome: "refunded" });
  }

  /* ---- FLOAT GUARD (race-condition path) + DELIVERY ---- */
  const result = await orders.deliverOrder(claimed);
  await db.update("webhook_log", { handled: true }, { id: `eq.${logId}` });
  return json(res, 200, { received: true, handled: true, outcome: result.ok ? "delivered" : result.reason || "failed" });
}

module.exports = wrap(handler);

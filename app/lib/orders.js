/* ============================================================================
   Order engine — shared by the webhook, order API, admin retry and cron.
   All float movements go through the add_float_entry RPC (advisory-locked).
   ============================================================================ */

const { db } = require("./supabase");
const { getSupplier } = require("./supplier");
const { notify } = require("./notify");
const valmontpay = require("./valmontpay");
const { genReference } = require("./ids");

const MAX_ATTEMPTS = 3;

/* ---------- lookups ---------- */
async function findNetworkById(id) {
  const rows = await db.select({ from: "networks", where: { id: `eq.${id}` } });
  return rows[0] || null;
}
async function findBundleById(id) {
  const rows = await db.select({ from: "bundles", where: { id: `eq.${id}`, is_active: "eq.true" } });
  return rows[0] || null;
}
async function findOrderByReference(ref) {
  const rows = await db.select({ from: "orders", where: { reference: `eq.${ref}` } });
  return rows[0] || null;
}
async function findOrderByProviderRef(providerRef) {
  const rows = await db.select({ from: "orders", where: { provider_reference: `eq.${providerRef}` } });
  return rows[0] || null;
}

/* ---------- float ---------- */
async function currentFloat(networkId) {
  return Number(await db.rpc("current_float", { p_network_id: Number(networkId) }) || 0);
}
async function addFloatEntry(networkId, direction, amount, orderId, note) {
  return Number(
    await db.rpc("add_float_entry", {
      p_network_id: Number(networkId),
      p_direction: direction,
      p_amount: Number(amount),
      p_order_id: orderId || null,
      p_note: note || null,
    })
  );
}

/* ---------- create ---------- */
async function createOrder(bundle, phone, networkId, customerId = null, opts = {}) {
  const reference = genReference();
  await db.insert("orders", {
    reference,
    phone,
    bundle_id: bundle.id,
    network_id: networkId,
    amount: bundle.sell_price,
    cost_price: bundle.cost_price,
    status: "pending",
    customer_id: customerId || null,
    auto_reload_id: opts.autoReloadId || null,
  });
  return findOrderByReference(reference);
}

/* ---------- claim (idempotency core) ----------
   Sets provider_reference + status=paid in ONE conditional update.
   Returns the order if THIS call won the claim, null if another webhook
   already claimed it (duplicate delivery impossible — unique constraint
   backs this up at the DB level too). */
async function claimOrder(orderId, providerReference) {
  const rows = await db.update(
    "orders",
    { provider_reference: providerReference, status: "paid" },
    { id: `eq.${orderId}`, provider_reference: "is.null" }
  );
  return rows.length ? rows[0] : null;
}

/* ---------- status ---------- */
async function setStatus(orderId, status, extra = {}) {
  await db.update("orders", { status, ...extra }, { id: `eq.${orderId}` });
}

/* ---------- delivery ---------- */
async function enrich(order) {
  const bundle = await findBundleById(order.bundle_id);
  const network = await findNetworkById(order.network_id);
  return { ...order, size_mb: bundle.size_mb, validity_days: bundle.validity_days, network_code: network.code };
}

async function deliverOrder(order) {
  const full = await enrich(order);
  await setStatus(order.id, "delivering");
  const attempts = Number(order.attempts || 0) + 1;

  // Float re-check at delivery time — closes the race where float ran dry
  // between checkout and payment confirmation.
  const float = await currentFloat(order.network_id);
  if (float < Number(order.cost_price)) {
    await refundOrder(order, `Float insufficient at delivery time (${float} < ${order.cost_price})`);
    return { ok: false, reason: "insufficient_float", attempts };
  }

  const supplier = getSupplier();
  const result = await supplier.submit({
    reference: order.reference,
    network: full.network_code,
    sizeMb: full.size_mb,
    phone: order.phone,
    attempts,
  });

  if (result.ok) {
    const nowIso = new Date().toISOString();
    await setStatus(order.id, "delivered", {
      supplier_ref: result.supplier_ref,
      supplier_response: result.raw || {},
      attempts,
      delivered_at: nowIso,
    });
    await addFloatEntry(order.network_id, "debit", order.cost_price, order.id, "delivery cost");
    await notify.receipt({ ...order, ...full, supplier_ref: result.supplier_ref });

    // Usage tracking: every delivered bundle gets a bundle_usage row the
    // auto-reload engine (and the dashboard) watches.
    await db.insert("bundle_usage", {
      order_id: order.id,
      phone: order.phone,
      network_id: order.network_id,
      size_mb: full.size_mb,
      used_mb: 0,
      status: "active",
      started_at: nowIso,
      expires_at: full.validity_days ? new Date(Date.now() + full.validity_days * 86400000).toISOString() : null,
    });

    // Auto-reload bookkeeping: this order WAS the auto-reload → count it.
    if (order.auto_reload_id) {
      const ruleRows = await db.select({ from: "auto_reload", where: { id: `eq.${order.auto_reload_id}` } });
      if (ruleRows.length) {
        const rule = ruleRows[0];
        await db.update(
          "auto_reload",
          { reload_count: Number(rule.reload_count || 0) + 1, last_reload_at: nowIso, updated_at: nowIso },
          { id: `eq.${rule.id}` }
        );
      }
    }
    return { ok: true, attempts };
  }

  await setStatus(order.id, "failed", {
    supplier_response: { ok: false, error: result.error, raw: result.raw || {} },
    attempts,
  });
  if (attempts >= MAX_ATTEMPTS) {
    await notify.alert(`Order ${order.reference} FAILED permanently (${MAX_ATTEMPTS} attempts): ${result.error}`);
  } else {
    await notify.alert(`Order ${order.reference} delivery failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${result.error} — auto-retry queued`);
  }
  return { ok: false, reason: result.error, attempts };
}

/* ---------- refund (race-condition / amount-mismatch path) ---------- */
async function refundOrder(order, reason) {
  await setStatus(order.id, "refunded", { supplier_response: { refunded: true, reason } });
  if (order.provider_reference) {
    await valmontpay.refund(order.provider_reference).catch((e) => console.error("refund call failed", e.message));
  }
  await notify.refunded(order, reason);
  await notify.alert(`Order ${order.reference} auto-refunded: ${reason}`);
}

/* ---------- retry (admin + cron) ---------- */
async function retryOrder(order) {
  if (["delivered", "refunded"].includes(order.status)) return { retried: false, reason: "final status" };
  if (Number(order.attempts || 0) >= MAX_ATTEMPTS) return { retried: false, reason: "max attempts reached" };
  const fresh = await findOrderByReference(order.reference);
  if (!fresh) return { retried: false, reason: "order not found" };
  const result = await deliverOrder(fresh);
  return { retried: true, ...result };
}

module.exports = {
  MAX_ATTEMPTS,
  findNetworkById,
  findBundleById,
  findOrderByReference,
  findOrderByProviderRef,
  currentFloat,
  addFloatEntry,
  createOrder,
  claimOrder,
  setStatus,
  enrich,
  deliverOrder,
  refundOrder,
  retryOrder,
};

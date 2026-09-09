/* ============================================================================
   Order engine — shared by the webhook, order API, admin retry and cron.
   All float movements go through the add_float_entry RPC (advisory-locked).
   ============================================================================ */

const { db } = require("./supabase");
const { getSupplierRouter } = require("./supplier");
const { notify } = require("./notify");
const valmontpay = require("./valmontpay");
const reviews = require("./reviews");
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
  // Refuse to create a paid order unless its delivery route is explicitly
  // configured. In production this excludes the local mock supplier.
  const network = await findNetworkById(networkId);
  if (!network) {
    const err = new Error("Network not found");
    err.status = 400;
    throw err;
  }
  getSupplierRouter().assertAvailable(network.code);

  const reference = genReference();
  const row = {
    reference,
    phone,
    bundle_id: bundle.id,
    network_id: networkId,
    amount: bundle.sell_price,
    cost_price: bundle.cost_price,
    status: "pending",
    customer_id: customerId || null,
    auto_reload_id: opts.autoReloadId || null,
    channel: opts.channel || "web",
    whatsapp_from: opts.whatsappFrom || null,
    credit_applied: opts.creditApplied || 0,
    reseller_id: opts.resellerId || null,
  };
  // Reduce checkout amount by referral credit applied
  if (opts.creditApplied && opts.creditApplied > 0) {
    row.amount = Math.max(0, Number(bundle.sell_price) - Number(opts.creditApplied));
  }
  await db.insert("orders", row);
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

/* ---------- reseller earnings ---------- */
async function creditResellerEarning(order) {
  const resellers = await db.select({ from: "resellers", where: { id: `eq.${order.reseller_id}` } });
  if (!resellers.length) return null;
  const reseller = resellers[0];

  // Earning = the reseller's markup portion
  // The customer paid (sell_price + markup), reseller earns the markup
  const basePrice = Number(order.amount) - Number(order.credit_applied || 0);
  const markupFraction = Number(reseller.markup_percent) / 100;
  // The markup was on top of sell_price, so the earning is: sell_price * markup%
  // But order.amount is already the reduced amount (sell_price - credit_applied).
  // We need the original sell_price to calculate correctly.
  const bundle = await findBundleById(order.bundle_id);
  if (!bundle) return null;
  const earning = Number(Number(bundle.sell_price * markupFraction).toFixed(2));
  if (earning <= 0) return null;

  const currentBal = Number(await db.rpc("current_reseller_balance", { p_reseller_id: reseller.id }) || 0);
  const newBal = currentBal + earning;

  await db.insert("reseller_earnings", {
    reseller_id: reseller.id,
    order_id: order.id,
    direction: "earn",
    amount: earning,
    balance_after: newBal,
    note: `Order ${order.reference} — ${Number(reseller.markup_percent)}% markup`,
  });

  // Update reseller stats
  await db.update("resellers", {
    total_orders: Number(reseller.total_orders || 0) + 1,
    total_revenue: Number(reseller.total_revenue || 0) + Number(order.amount),
    total_earnings: Number(reseller.total_earnings || 0) + earning,
    updated_at: new Date().toISOString(),
  }, { id: `eq.${reseller.id}` });

  return { reseller_id: reseller.id, earning, balance: newBal };
}

/* ---------- delivery ---------- */
async function enrich(order) {
  const bundle = await findBundleById(order.bundle_id);
  const network = await findNetworkById(order.network_id);
  if (!bundle || !network) throw new Error(`Order ${order.reference} has an unavailable bundle or network`);
  return { ...order, size_mb: bundle.size_mb, validity_days: bundle.validity_days, network_code: network.code };
}

function normalDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function originatingWhatsAppMatchesBuyer(whatsappFrom, buyerPhone) {
  const wa = normalDigits(whatsappFrom);
  const phone = normalDigits(buyerPhone);
  return /^233\d{9}$/.test(wa) && /^0\d{9}$/.test(phone) && wa === `233${phone.slice(1)}`;
}

/**
 * Invitations deliberately follow two distinct consent-safe relationships:
 * - SMS goes only to the purchaser's account phone when it is the delivery
 *   recipient too. We never text an unrelated recipient an account link.
 * - WhatsApp goes only to an account whose verified account phone is the same
 *   WhatsApp sender. That buyer may legitimately send a bundle to someone else.
 */
async function reviewInvitationLinks(order) {
  if (!order?.customer_id || !order?.network_code || !order?.size_mb) return {};
  try {
    const customers = await db.select({ from: "customers", where: { id: `eq.${order.customer_id}` }, limit: 1 });
    const customer = customers[0];
    if (!customer) return {};
    const url = reviews.reviewUrl(order.network_code, order.size_mb);
    if (!url) return {};
    const buyerPhone = normalDigits(customer.phone);
    const recipientPhone = normalDigits(order.phone);
    return {
      sms_review_url: buyerPhone && buyerPhone === recipientPhone ? url : null,
      whatsapp_review_url: originatingWhatsAppMatchesBuyer(order.whatsapp_from, customer.phone) ? url : null,
    };
  } catch (error) {
    // A receipt must remain deliverable if a review link cannot be generated;
    // log the configuration/data issue rather than inventing a fallback URL.
    console.error(`[orders] review invitation omitted for ${order.reference}: ${error.message}`);
    return {};
  }
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

  const supplier = getSupplierRouter();
  const availability = supplier.preflight(full.network_code);
  if (!availability.ok) {
    await refundOrder(order, `Delivery cannot start safely: ${availability.error}`);
    return { ok: false, reason: "supplier_unavailable", attempts };
  }
  const result = await supplier.submit({
    reference: order.reference,
    network: full.network_code,
    sizeMb: full.size_mb,
    phone: order.phone,
    attempts,
  });

  // Accepted-but-pending responses and network timeouts are unresolved, not
  // failures. Never send these to a backup supplier: the first provider may
  // still deliver, which would create a costly duplicate bundle.
  if (result.pending || result.ambiguous) {
    await setStatus(order.id, "delivering", {
      supplier_ref: result.supplier_ref || null,
      supplier_response: {
        ...(result.raw || {}),
        supplier: result.supplier || result.raw?.supplier || null,
        unresolved: true,
        pending: !!result.pending,
        ambiguous: !!result.ambiguous,
        error: result.error || null,
      },
      attempts,
    });
    await notify.alert(`Order ${order.reference} is awaiting supplier confirmation (${result.supplier || "unknown"}); backup routing is paused to prevent duplicate delivery.`);
    return { ok: false, reason: "supplier_unconfirmed", unresolved: true, attempts };
  }

  if (result.ok) {
    const nowIso = new Date().toISOString();
    await setStatus(order.id, "delivered", {
      supplier_ref: result.supplier_ref,
      supplier_response: result.raw || {},
      attempts,
      delivered_at: nowIso,
    });
    await addFloatEntry(order.network_id, "debit", order.cost_price, order.id, "delivery cost");
    const invitations = await reviewInvitationLinks(full);
    await notify.receipt({
      ...order, ...full,
      ...invitations,
      supplier_ref: result.supplier_ref,
      whatsapp_from: order.whatsapp_from || null,
      channel: order.channel || "web",
    });

    // Referral program: reward both parties on first delivery
    const referrals = require("./referrals");
    await referrals.rewardFirstOrder(order.id).catch((e) =>
      console.error("[referrals] reward error", e.message)
    );

    // Reseller earnings: credit the reseller's margin on this order
    if (order.reseller_id) {
      await creditResellerEarning(order).catch((e) =>
        console.error("[reseller] earning error", e.message)
      );
    }

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
    supplier_response: {
      ok: false,
      error: result.error,
      supplier: result.supplier || null,
      routing_attempts: result.routing_attempts || [],
      raw: result.raw || {},
    },
    attempts,
  });
  if (attempts >= MAX_ATTEMPTS) {
    await notify.alert(`Order ${order.reference} failed delivery after ${MAX_ATTEMPTS} attempts: ${result.error}`);
    // A real payment that cannot be fulfilled must be reconciled, not merely
    // left as a failed order while the customer has been charged.
    if (valmontpay.mode() === "live") {
      const refund = await refundOrder(order, `Delivery could not be completed after ${MAX_ATTEMPTS} attempts: ${result.error}`);
      return { ok: false, reason: result.error, attempts, refund_status: refund.status || null };
    }
  } else {
    await notify.alert(`Order ${order.reference} delivery failed (attempt ${attempts}/${MAX_ATTEMPTS}): ${result.error} — auto-retry queued`);
  }
  return { ok: false, reason: result.error, attempts };
}

/* ---------- refunds ----------
   Valmont-Pay does not expose a supported automated refund endpoint. In live
   mode, a payment problem becomes refund_pending until an administrator has
   completed the real gateway action and explicitly records it. Local dev keeps
   its deterministic simulated-refund path for the existing no-gateway flow. */
async function refundOrder(order, reason) {
  const fresh = await findOrderByReference(order.reference) || order;
  if (["refunded", "refund_pending"].includes(fresh.status)) {
    return { ok: true, status: fresh.status, already_handled: true };
  }

  const now = new Date().toISOString();
  const supplierResponse = {
    ...(fresh.supplier_response || {}),
    refund_reason: String(reason || "Delivery could not be completed").slice(0, 500),
    refund_gateway: "manual",
  };

  if (valmontpay.mode() === "live") {
    const pendingRows = await db.update("orders", {
      status: "refund_pending",
      refund_requested_at: now,
      refund_note: String(reason || "Delivery could not be completed").slice(0, 500),
      supplier_response: supplierResponse,
    }, { id: `eq.${fresh.id}`, status: "in.(paid,delivering,failed)" });
    const pending = pendingRows[0];
    if (!pending) {
      const current = await findOrderByReference(fresh.reference);
      return { ok: false, status: current?.status || "unknown", reason: "refund state changed" };
    }
    await notify.refundPending(pending, pending.refund_note);
    await notify.alert(`Order ${pending.reference} requires a manual gateway refund: ${pending.refund_note}`);
    return { ok: true, status: "refund_pending", order: pending };
  }

  const refundedRows = await db.update("orders", {
    status: "refunded",
    refund_requested_at: now,
    refund_completed_at: now,
    refund_completed_by: "local-development",
    refund_note: String(reason || "Simulated local refund").slice(0, 500),
    supplier_response: { ...supplierResponse, simulated: true },
  }, { id: `eq.${fresh.id}`, status: "in.(paid,delivering,failed)" });
  const refunded = refundedRows[0];
  if (!refunded) return { ok: false, reason: "refund state changed" };
  await notify.refunded(refunded, refunded.refund_note);
  await notify.alert(`Order ${refunded.reference} simulated local refund completed: ${refunded.refund_note}`);
  return { ok: true, status: "refunded", order: refunded };
}

/** Records completion only after an administrator has performed the gateway refund. */
async function completeRefund(orderId, actor, note) {
  const rows = await db.select({ from: "orders", where: { id: `eq.${orderId}` }, limit: 1 });
  const order = rows[0];
  if (!order) return { ok: false, status: 404, error: "Order not found" };
  if (order.status !== "refund_pending") {
    return { ok: false, status: 409, error: "Only a refund pending order can be marked completed" };
  }
  const now = new Date().toISOString();
  const finalNote = String(note || order.refund_note || "Refund completed by administrator").trim().slice(0, 500);
  const updatedRows = await db.update("orders", {
    status: "refunded",
    refund_completed_at: now,
    refund_completed_by: String(actor || "administrator").slice(0, 80),
    refund_note: finalNote,
    supplier_response: {
      ...(order.supplier_response || {}),
      refund_gateway: "manual",
      refund_completed: true,
      refund_completed_at: now,
    },
  }, { id: `eq.${order.id}`, status: "eq.refund_pending" });
  const updated = updatedRows[0];
  if (!updated) return { ok: false, status: 409, error: "Refund state changed; refresh and try again" };
  await notify.refunded(updated, finalNote);
  await notify.alert(`Order ${updated.reference} manual gateway refund marked completed by ${updated.refund_completed_by}`);
  return { ok: true, order: updated };
}

/* ---------- retry (admin + cron) ---------- */
async function retryOrder(order) {
  if (["delivered", "refunded", "refund_pending"].includes(order.status)) return { retried: false, reason: "final status" };
  if (Number(order.attempts || 0) >= MAX_ATTEMPTS) return { retried: false, reason: "max attempts reached" };
  const fresh = await findOrderByReference(order.reference);
  if (!fresh) return { retried: false, reason: "order not found" };

  // Conservative duplicate guard. An accepted-pending request or a timeout is
  // not safe to resubmit (to the same provider or a backup) until the original
  // supplier confirms failure/not-found through its status API or webhook.
  if (fresh.status === "delivering" && fresh.supplier_response?.unresolved) {
    return {
      retried: false,
      reason: "awaiting_supplier_confirmation",
      supplier: fresh.supplier_response?.supplier || null,
      duplicate_guard: true,
    };
  }

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
  completeRefund,
  reviewInvitationLinks,
  retryOrder,
};

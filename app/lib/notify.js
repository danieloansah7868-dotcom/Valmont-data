/* ============================================================================
   Notifications — delivery receipts + admin alerts + customer channels.

   Channels (all fire in parallel, none blocks the order pipeline):
   1. Webhook — POST { type, ts, ...data } to NOTIFY_WEBHOOK_URL
   2. SMS     — transactional delivery/refund notices
   3. WhatsApp — confirmation back to the originating WhatsApp sender
   4. Console — always logs regardless of other channels

   A failed provider result is retained as a failed result; deployed endpoints
   never substitute a mock "sent" result for SMS or WhatsApp.
   ============================================================================ */

async function send(type, data) {
  const payload = { type, ts: new Date().toISOString(), ...data };

  // Always log
  console.log(`[notify] ${type}`, JSON.stringify(payload));

  const promises = [];

  // 1. Webhook channel
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (url) {
    promises.push(
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then((r) => ({ webhook: r.ok }))
        .catch((e) => ({ webhook: false, error: e.message }))
    );
  }

  // 2. SMS channel — for customer-facing notifications
  if (shouldSendSMS(type, data)) {
    const sms = require("./sms");
    const smsMsg = formatSMS(type, data);
    if (smsMsg && data.phone) promises.push(sms.sendSMS(data.phone, smsMsg));
  }

  // 3. WhatsApp channel — only the original WhatsApp sender receives an
  // in-chat receipt. `notify.receipt()` must preserve this field from orders.
  if (data?.whatsapp_from) promises.push(sendWhatsAppConfirmation(type, data));

  const results = await Promise.allSettled(promises);
  const webhookResult = results.find((r) => r.value?.webhook !== undefined);
  return {
    delivered: webhookResult ? webhookResult.value.webhook : !!(url),
    mode: url ? "webhook" : "log",
    sms: results.find((r) => r.value?.provider)?.value || null,
    // The live Cloud API returns { sent, message_id }; the local dev client also
    // includes `to`. Accept either, rather than reporting a successfully sent
    // live receipt as absent just because Meta does not echo the recipient.
    whatsapp: results.find((r) => r.value?.sent && (r.value?.to || r.value?.message_id))?.value || null,
  };
}

function shouldSendSMS(type, data) {
  if (!data?.phone) return false;
  return ["order.receipt", "order.refund_pending", "order.refunded"].includes(type);
}

function formatSMS(type, data) {
  const sms = require("./sms");
  if (type === "order.receipt") return sms.templates.orderDelivered(data);
  if (type === "order.refund_pending") return sms.templates.orderRefundPending(data);
  if (type === "order.refunded") return sms.templates.orderRefunded(data);
  return null;
}

function safeWhatsAppReviewUrl(value) {
  const url = String(value || "");
  return /^https:\/\/[^\s/]+\/rev\/(mtn|telecel|airteltigo)\/[0-9]+(?:-[0-9]+)?(?:mb|gb)$/.test(url) ? url : "";
}

/* ---- WhatsApp delivery confirmations ----
   WhatsApp Cloud's current button helper only supports quick replies, not URL
   buttons, so the review invitation is a plain direct HTTPS link. */
async function sendWhatsAppConfirmation(type, data) {
  if (!data?.whatsapp_from) return null;
  const whatsapp = require("./whatsapp");
  const waId = String(data.whatsapp_from);

  if (type === "order.receipt") {
    const sizeMb = data.size_mb || 0;
    const size = sizeMb >= 1024 ? `${sizeMb / 1024}GB` : `${sizeMb}MB`;
    const network = (data.network_code || "").toUpperCase();
    const reviewUrl = safeWhatsAppReviewUrl(data.whatsapp_review_url);
    const review = reviewUrl ? `\n\nShare your verified review: ${reviewUrl}` : "";
    const msg = `✅ *Delivered!*\n\n📦 ${size} ${network} → ${data.phone}\n📋 ${data.reference}\n\nThank you for using Valmont Data!${review}\n\n_Want auto-reload? Reply "autoreload" to set it up for this line._`;
    return whatsapp.sendText(waId, msg);
  }
  if (type === "order.refund_pending") {
    const msg = `↩️ *Refund being arranged for ${data.reference}*\n\n${data.reason || "Delivery could not be completed."}\n\nOur team is arranging a refund to the original payment method. We will confirm once it is completed.`;
    return whatsapp.sendText(waId, msg);
  }
  if (type === "order.refunded") {
    const msg = `↩️ *Refund completed for ${data.reference}*\n\n${data.reason || "The refund has been completed."}\n\nPlease check the original payment method. Provider timing can vary.`;
    return whatsapp.sendText(waId, msg);
  }
  return null;
}

const notify = {
  receipt: (order) =>
    send("order.receipt", {
      reference: order.reference,
      phone: order.phone,
      bundle: `${order.size_mb}MB ${order.network_code}`,
      amount: Number(order.amount),
      supplier_ref: order.supplier_ref || null,
      status: "delivered",
      size_mb: order.size_mb,
      network_code: order.network_code,
      // Preserve the originating sender and separate channel eligibility.
      whatsapp_from: order.whatsapp_from || null,
      review_url: order.sms_review_url || null,
      whatsapp_review_url: order.whatsapp_review_url || null,
    }),
  lowFloat: (network, balance, threshold) =>
    send("low_float", { network, balance: Number(balance), threshold: Number(threshold) }),
  alert: (message, extra = {}) => send("alert", { message, ...extra }),
  refundPending: (order, reason) =>
    send("order.refund_pending", {
      reference: order.reference,
      phone: order.phone,
      amount: Number(order.amount),
      reason,
      whatsapp_from: order.whatsapp_from || null,
    }),
  refunded: (order, reason) =>
    send("order.refunded", {
      reference: order.reference,
      phone: order.phone,
      amount: Number(order.amount),
      reason,
      whatsapp_from: order.whatsapp_from || null,
    }),
};

module.exports = { notify, send, safeWhatsAppReviewUrl };

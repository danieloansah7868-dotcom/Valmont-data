/* ============================================================================
   Notifications — delivery receipts + admin alerts + SMS to customers.

   Channels (all fire in parallel, none blocks the order pipeline):
   1. Webhook — POST { type, ts, ...data } to NOTIFY_WEBHOOK_URL
   2. SMS     — send transactional SMS to the customer (if SMS_PROVIDER set)
   3. Console — always logs regardless of other channels

   SMS is opt-in via SMS_DELIVERY=true (or SMS_PROVIDER != mock).
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
    if (smsMsg && data.phone) {
      promises.push(sms.sendSMS(data.phone, smsMsg));
    }
  }

  // 3. WhatsApp channel — if order came from WhatsApp, confirm in-chat
  if (data?.whatsapp_from) {
    promises.push(sendWhatsAppConfirmation(type, data));
  }

  const results = await Promise.allSettled(promises);
  const webhookResult = results.find((r) => r.value?.webhook !== undefined);
  return {
    delivered: webhookResult ? webhookResult.value.webhook : !!(url),
    mode: url ? "webhook" : "log",
    sms: results.find((r) => r.value?.provider)?.value || null,
    whatsapp: results.find((r) => r.value?.sent && r.value?.to)?.value || null,
  };
}

function shouldSendSMS(type, data) {
  // Only send SMS for customer-facing events with a phone number
  if (!data?.phone) return false;
  const smsTypes = ["order.receipt", "order.refunded"];
  return smsTypes.includes(type);
}

function formatSMS(type, data) {
  const sms = require("./sms");
  if (type === "order.receipt") return sms.templates.orderDelivered(data);
  if (type === "order.refunded") return sms.templates.orderRefunded(data, data.reason);
  return null;
}

/* ---- WhatsApp delivery confirmations ----
   If the order was placed via WhatsApp (channel=whatsapp + whatsapp_from set),
   send the confirmation back in the same WhatsApp conversation. */
async function sendWhatsAppConfirmation(type, data) {
  if (!data?.whatsapp_from) return null;
  const whatsapp = require("./whatsapp");
  const waId = String(data.whatsapp_from);

  if (type === "order.receipt") {
    const sizeMb = data.size_mb || 0;
    const size = sizeMb >= 1024 ? `${sizeMb / 1024}GB` : `${sizeMb}MB`;
    const network = (data.network_code || "").toUpperCase();
    const msg = `✅ *Delivered!*\n\n📦 ${size} ${network} → ${data.phone}\n📋 ${data.reference}\n\nThank you for using Valmont Data!\n\n_Want auto-reload? Reply "autoreload" to set it up for this line._`;
    return whatsapp.sendText(waId, msg);
  }
  if (type === "order.refunded") {
    const msg = `↩️ *Order ${data.reference} refunded*\n\n${data.reason || "Amount mismatch"}\n\nYour MoMo has been credited back.`;
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
    }),
  lowFloat: (network, balance, threshold) =>
    send("low_float", { network, balance: Number(balance), threshold: Number(threshold) }),
  alert: (message, extra = {}) => send("alert", { message, ...extra }),
  refunded: (order, reason) =>
    send("order.refunded", {
      reference: order.reference,
      phone: order.phone,
      amount: Number(order.amount),
      reason,
    }),
};

module.exports = { notify, send };

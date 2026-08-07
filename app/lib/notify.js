/* ============================================================================
   Notifications — delivery receipts + admin alerts.
   Default: log to stdout. Point NOTIFY_WEBHOOK_URL at a WhatsApp/SMS
   automation (e.g. a Valmont Web Services flow or WhatsApp Cloud API worker)
   and it POSTs { type, ts, ...data } there.
   ============================================================================ */

async function send(type, data) {
  const payload = { type, ts: new Date().toISOString(), ...data };
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) {
    console.log(`[notify] ${type}`, JSON.stringify(payload));
    return { delivered: false, mode: "log" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { delivered: res.ok, mode: "webhook" };
  } catch (e) {
    console.error("[notify] failed", e.message);
    return { delivered: false, mode: "webhook", error: e.message };
  }
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
    }),
  lowFloat: (network, balance, threshold) =>
    send("low_float", { network, balance: Number(balance), threshold: Number(threshold) }),
  alert: (message, extra = {}) => send("alert", { message, ...extra }),
  refunded: (order, reason) =>
    send("order.refunded", { reference: order.reference, phone: order.phone, amount: Number(order.amount), reason }),
};

module.exports = { notify, send };

/* ============================================================================
   SMS provider integration — sends SMS via Ghana-based providers.

   Supported providers (set SMS_PROVIDER):
     arkesel  — sms.arkesel.com (Ghana-based, cheapest)
     mnotify  — mnotify.com (Ghana-based)
     hubtel   — hubtel.com (Ghana-based)
     mock     — log to console (default in dev)

   Configuration:
     SMS_PROVIDER    — arkesel | mnotify | hubtel | mock (default: mock)
     SMS_API_KEY     — provider API key
     SMS_SENDER_ID   — sender name (e.g., "ValmontData", max 11 chars)

   This module is called by lib/notify.js (the existing notification system)
   when SMS_DELIVERY=true is set. It can also be called directly for
   transactional SMS (order confirmations, OTP, etc.).
   ============================================================================ */

function provider() { return (process.env.SMS_PROVIDER || "mock").toLowerCase(); }
function apiKey() { return process.env.SMS_API_KEY || ""; }
function senderId() { return process.env.SMS_SENDER_ID || "ValmontData"; }
function configured() { return apiKey() && provider() !== "mock"; }

/* Send an SMS to a Ghana phone number.
   phone: Ghana format (0XXXXXXXXX) or international (+233XXXXXXXXX)
   message: plain text, max 160 chars per segment */
async function sendSMS(phone, message) {
  if (!phone || !message) return { sent: false, error: "missing phone/message" };

  // Normalize phone to international format for providers
  let intlPhone = String(phone).replace(/[\s-]/g, "");
  if (intlPhone.startsWith("0")) intlPhone = "+233" + intlPhone.slice(1);
  if (!intlPhone.startsWith("+")) intlPhone = "+" + intlPhone;

  const p = provider();

  if (p === "mock" || !configured()) {
    console.log(`[sms:mock] → ${intlPhone}: ${message.slice(0, 160)}`);
    return { sent: true, dev: true, phone: intlPhone, provider: "mock" };
  }

  try {
    if (p === "arkesel") return await sendArkesel(intlPhone, message);
    if (p === "mnotify") return await sendMnotify(intlPhone, message);
    if (p === "hubtel") return await sendHubtel(intlPhone, message);
    return { sent: false, error: `unknown provider: ${p}` };
  } catch (e) {
    console.error(`[sms:${p}] send error`, e.message);
    return { sent: false, error: e.message };
  }
}

/* ---------- Arkesel (sms.arkesel.com) ---------- */
async function sendArkesel(phone, message) {
  // API: https://sms.arkesel.com/sms/api?action=send-sms
  //     &api_key=xxx&to=233XXXXXXXXX&from=SenderId&sms=text
  const params = new URLSearchParams({
    action: "send-sms",
    api_key: apiKey(),
    to: phone.replace("+", ""),
    from: senderId(),
    sms: message.slice(0, 459), // Arkesel max 3 segments
  });

  const res = await fetch(`https://sms.arkesel.com/sms/api?${params}`, {
    method: "GET",
  });
  const text = await res.text();

  // Arkesel returns XML or plain text
  if (text.includes("1701") || text.toLowerCase().includes("success")) {
    return { sent: true, provider: "arkesel", phone };
  }
  return { sent: false, error: text.slice(0, 200), provider: "arkesel" };
}

/* ---------- mNotify (mnotify.com) ---------- */
async function sendMnotify(phone, message) {
  // API: POST https://api.mnotify.com/api/sms
  // Body: { recipient, sender, message, api_key }
  const res = await fetch("https://api.mnotify.com/api/sms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: phone.replace("+", ""),
      sender: senderId(),
      message: message.slice(0, 459),
      api_key: apiKey(),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && (data.status === "success" || data.status === "200")) {
    return { sent: true, provider: "mnotify", phone };
  }
  return { sent: false, error: data.message || `HTTP ${res.status}`, provider: "mnotify" };
}

/* ---------- Hubtel (hubtel.com) ---------- */
async function sendHubtel(phone, message) {
  // API: POST https://smsc.hubtel.com/v1/messages/send
  const res = await fetch("https://smsc.hubtel.com/v1/messages/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      Recipient: phone,
      Sender: senderId(),
      Message: message.slice(0, 459),
      Type: 1, // flash=0, normal=1
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.Status === "Accepted") {
    return { sent: true, provider: "hubtel", phone };
  }
  return { sent: false, error: data.Message || `HTTP ${res.status}`, provider: "hubtel" };
}

/* ---------- Notification templates ---------- */
const templates = {
  orderDelivered(order) {
    const size = order.size_mb >= 1024 ? `${order.size_mb / 1024}GB` : `${order.size_mb}MB`;
    const network = (order.network_code || order.network || "").toUpperCase();
    return `✅ Valmont Data: Your ${size} ${network} bundle has been delivered to ${order.phone}. Ref: ${order.reference}. Thank you!`;
  },

  orderFailed(order, reason) {
    return `⚠️ Valmont Data: Your order ${order.reference} failed — ${reason || "please try again"}. You have not been charged.`;
  },

  orderRefunded(order, reason) {
    return `↩️ Valmont Data: Order ${order.reference} refunded (${reason || "amount mismatch"}). Your MoMo has been credited back.`;
  },

  lowData(phone, percent, network) {
    return `📊 Valmont Data: Your ${network.toUpperCase()} data on ${phone} is ${percent}% used. Send "hi" on WhatsApp to top up instantly!`;
  },

  welcome(phone, name) {
    const n = name || "there";
    return `👋 Hey ${n}! Welcome to Valmont Data. Buy MTN, Telecel & AirtelTigo data instantly. WhatsApp us: "hi" or visit valmontdata.com`;
  },
};

module.exports = { sendSMS, templates, configured, provider };

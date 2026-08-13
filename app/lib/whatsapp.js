/* ============================================================================
   WhatsApp Cloud API client — sends messages via Meta's official API.

   Configuration:
     WHATSAPP_TOKEN    — permanent access token (System user token from Meta)
     WHATSAPP_PHONE_ID — phone number ID from the WhatsApp Business dashboard
     WHATSAPP_VERIFY_TOKEN — webhook verification token (you pick this string,
                             then set the same string in the Meta webhook config)

   Live vs dev mode:
     WHATSAPP_MODE=live → real API calls (production)
     WHATSAPP_MODE=dev  → messages logged to console + whatsapp_log table (default)
   ============================================================================ */

const { db } = require("./supabase");

const API_BASE = "https://graph.facebook.com/v21.0";

function token() { return process.env.WHATSAPP_TOKEN || ""; }
function phoneId() { return process.env.WHATSAPP_PHONE_ID || ""; }
function verifyToken() { return process.env.WHATSAPP_VERIFY_TOKEN || "valmont-data-verify"; }
function mode() { return process.env.WHATSAPP_MODE === "live" ? "live" : "dev"; }
function configured() { return !!(token() && phoneId()); }

/* ---------------- send a text message ---------------- */
async function sendText(to, text) {
  if (!to || !text) return { sent: false, error: "missing to/text" };

  // Log every outbound message regardless of mode
  await db.insert("whatsapp_log", {
    direction: "outbound",
    phone: String(to),
    message_type: "text",
    message_body: text.slice(0, 4096),
    status: mode() === "live" ? "sending" : "dev",
  }).catch(() => {});

  if (mode() !== "live" || !configured()) {
    console.log(`[whatsapp:dev] → ${to}: ${text.replace(/\n/g, " | ").slice(0, 200)}`);
    return { sent: true, dev: true, to, text };
  }

  try {
    const res = await fetch(`${API_BASE}/${phoneId()}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: String(to),
        type: "text",
        text: { preview_url: false, body: text.slice(0, 4096) },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      console.error(`[whatsapp] send failed: ${msg}`);
      return { sent: false, error: msg };
    }
    return { sent: true, message_id: data?.messages?.[0]?.id || null };
  } catch (e) {
    console.error("[whatsapp] send error", e.message);
    return { sent: false, error: e.message };
  }
}

/* ---------------- send interactive buttons ---------------- */
async function sendButtons(to, text, buttons) {
  // buttons: [{ id: "1", title: "MTN" }, ...] — max 3 buttons
  if (!to || !text || !buttons?.length) return sendText(to, text);

  const btns = buttons.slice(0, 3).map((b) => ({
    type: "reply",
    reply: { id: String(b.id), title: String(b.title).slice(0, 20) },
  }));

  await db.insert("whatsapp_log", {
    direction: "outbound",
    phone: String(to),
    message_type: "interactive",
    message_body: text.slice(0, 4096),
    status: mode() === "live" ? "sending" : "dev",
  }).catch(() => {});

  if (mode() !== "live" || !configured()) {
    const btnLabel = buttons.map((b) => `[${b.id}] ${b.title}`).join(" | ");
    console.log(`[whatsapp:dev] → ${to}: ${text.replace(/\n/g, " | ").slice(0, 200)} — buttons: ${btnLabel}`);
    return { sent: true, dev: true, to, text, buttons };
  }

  try {
    const res = await fetch(`${API_BASE}/${phoneId()}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: String(to),
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: text.slice(0, 1024) },
          action: { buttons: btns },
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      console.error(`[whatsapp] sendButtons failed: ${msg}`);
      // Fall back to plain text with numbered options
      const fallback = `${text}\n\n${buttons.map((b) => `${b.id}. ${b.title}`).join("\n")}`;
      return sendText(to, fallback);
    }
    return { sent: true, message_id: data?.messages?.[0]?.id || null };
  } catch (e) {
    console.error("[whatsapp] sendButtons error", e.message);
    return { sent: false, error: e.message };
  }
}

/* ---------------- verify webhook (GET) ---------------- */
function verifyWebhook(query) {
  const mode_ = query["hub.mode"];
  const token_ = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode_ === "subscribe" && token_ === verifyToken()) {
    return { valid: true, challenge };
  }
  return { valid: false };
}

module.exports = { sendText, sendButtons, verifyWebhook, configured, mode, verifyToken };

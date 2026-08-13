/* ============================================================================
   WhatsApp Webhook — receives messages from Meta's WhatsApp Cloud API.

   Meta sends two types of requests to this endpoint:
   1. GET  — webhook verification (hub.mode + hub.verify_token + hub.challenge)
   2. POST — incoming messages and status updates

   Configuration:
     WHATSAPP_VERIFY_TOKEN — must match the string you set in the Meta webhook config
     WHATSAPP_TOKEN        — API access token
     WHATSAPP_PHONE_ID     — phone number ID
   ============================================================================ */

const { json, readRawBody, wrap } = require("../../lib/http");
const whatsapp = require("../../lib/whatsapp");
const bot = require("../../lib/whatsapp-bot");

async function handler(req, res) {
  // ---- Webhook verification (GET) ----
  if (req.method === "GET") {
    const url = new URL(req.url, "http://local");
    const result = whatsapp.verifyWebhook(Object.fromEntries(url.searchParams));
    if (result.valid) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      return res.end(result.challenge);
    }
    return json(res, 403, { error: "verification failed" });
  }

  // ---- Incoming messages (POST) ----
  if (req.method !== "POST") return json(res, 405, { error: "POST or GET only" });

  const raw = await readRawBody(req);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(res, 400, { error: "invalid JSON" });
  }

  // Always 200 quickly so Meta doesn't retry
  // Process messages asynchronously
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ received: true }));

  // Extract messages from the webhook payload
  try {
    const entries = payload?.entry || [];
    for (const entry of entries) {
      const changes = entry?.changes || [];
      for (const change of changes) {
        if (change?.field !== "messages") continue;
        const value = change.value || {};
        const messages = value.messages || [];

        for (const msg of messages) {
          await processMessage(msg, value);
        }
      }
    }
  } catch (e) {
    console.error("[whatsapp-webhook] processing error", e.message);
  }
}

async function processMessage(msg, value) {
  const from = msg.from; // WhatsApp ID (international, no +)
  if (!from) return;

  let text = "";
  let buttonReply = null;

  if (msg.type === "text" && msg.text?.body) {
    text = msg.text.body;
  } else if (msg.type === "interactive" && msg.interactive) {
    if (msg.interactive.type === "button_reply") {
      buttonReply = msg.interactive.button_reply?.id || msg.interactive.button_reply?.title || "";
      text = msg.interactive.button_reply?.title || "";
    } else if (msg.interactive.type === "list_reply") {
      text = msg.interactive.list_reply?.id || msg.interactive.list_reply?.title || "";
    }
  } else if (msg.type === "button" && msg.button) {
    buttonReply = msg.button.payload || msg.button.text || "";
    text = msg.button.text || "";
  } else {
    // Unsupported message type (image, audio, etc.) — acknowledge
    const whatsapp = require("../../lib/whatsapp");
    await whatsapp.sendText(from, "📎 I can only process text messages right now.\n\nSend *hi* to see what I can do!");
    return;
  }

  // Handle "track" button from welcome menu
  if (buttonReply === "track") {
    const whatsapp = require("../../lib/whatsapp");
    await whatsapp.sendText(from, "📍 Send your order reference (e.g. *VD-260812-1234*) and I'll look it up.");
    return;
  }

  // Handle "order" button from welcome menu
  if (buttonReply === "order") {
    const whatsapp = require("../../lib/whatsapp");
    await whatsapp.sendButtons(from, "📶 *Which network?*", [
      { id: "1", title: "📶 MTN" },
      { id: "2", title: "📶 Telecel" },
      { id: "3", title: "📶 AirtelTigo" },
    ]);
    const botModule = require("../../lib/whatsapp-bot");
    await botModule.upsertSession(from, "pick_network", {});
    return;
  }

  // Handle "help" button
  if (buttonReply === "help") {
    const botModule = require("../../lib/whatsapp-bot");
    // sendHelp is internal — just call handleMessage with "help"
    await botModule.handleMessage({ from, text: "help" });
    return;
  }

  // Route to the bot engine
  await bot.handleMessage({ from, text, buttonReply });
}

module.exports = wrap(handler);

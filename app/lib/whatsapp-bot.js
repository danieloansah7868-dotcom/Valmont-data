/* ============================================================================
   WhatsApp Bot — conversation engine for ordering data bundles via WhatsApp.

   States:
     idle          → show welcome menu
     pick_network  → waiting for MTN / Telecel / AirtelTigo selection
     pick_bundle   → waiting for bundle size selection
     pick_phone    → waiting for the recipient phone number
     confirm       → show summary, waiting for yes/no
     track         → tracking an order by reference

   The bot also understands natural-language shortcuts at any state:
     "hi", "hello", "menu"              → restart from welcome
     "1gb mtn"                          → quick order (skip to confirm)
     "5gb 0241234567"                   → quick order with phone
     "track VD-260812-1234"             → order tracking
     "help"                             → help text
     "cancel", "stop"                   → reset to idle

   All state is persisted in whatsapp_sessions so serverless invocations
   don't lose context between messages.
   ============================================================================ */

const { db } = require("./supabase");
const phones = require("./phones");
const keywords = require("./keywords");
const orders = require("./orders");
const whatsapp = require("./whatsapp");
const { genReference } = require("./ids");

/* ---------- session helpers ---------- */
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes of inactivity → reset

async function getSession(waId) {
  const rows = await db.select({ from: "whatsapp_sessions", where: { phone: `eq.${waId}` } });
  if (!rows.length) return null;
  const session = rows[0];
  // Expire stale sessions
  if (Date.now() - new Date(session.updated_at).getTime() > SESSION_TTL) {
    session.state = "idle";
    session.context = {};
  }
  return session;
}

async function upsertSession(waId, state, context, customerId = null) {
  const existing = await getSession(waId);
  const now = new Date().toISOString();
  if (existing) {
    await db.update("whatsapp_sessions", {
      state,
      context: context || existing.context,
      customer_id: customerId != null ? customerId : existing.customer_id,
      updated_at: now,
    }, { id: `eq.${existing.id}` });
    return { ...existing, state, context: context || existing.context, updated_at: now };
  }
  const rows = await db.insert("whatsapp_sessions", {
    phone: waId,
    state,
    context: context || {},
    customer_id: customerId,
    updated_at: now,
  });
  return rows[0];
}

async function resetSession(waId) {
  return upsertSession(waId, "idle", {});
}

/* ---------- bundle formatting ---------- */
function formatSize(sizeMb) {
  if (sizeMb >= 1024) {
    const gb = sizeMb / 1024;
    return gb % 1 === 0 ? `${gb}GB` : `${gb.toFixed(1)}GB`;
  }
  return `${sizeMb}MB`;
}

function formatPrice(amount) {
  return `GH₵${Number(amount).toFixed(2)}`;
}

/* ---------- network detection from text ----------
   Delegates to lib/keywords.js — the same vocabulary the landing pages, the
   on-site search and the website assistant use, so "voda", "tigo", "at" and
   "airtel" all resolve the same way everywhere.

   (The hand-rolled version this replaced read "tigo" as Telecel: `a || b ||
   c && !d` binds `&&` first, so "tigo 2gb" was routed to the wrong network
   and the order could not deliver. lib/keywords.js has a test for it.) */
function detectNetworkFromText(text) {
  return keywords.detectNetwork(text);
}

/* ---------- size parsing ----------
   Also from lib/keywords.js: handles "2gb", "2 gigs", "500mb", "1.5gb" and
   "10240 mb", and deliberately ignores a bare "5g" (that is a network
   generation, not a size). */
function parseSizeFromText(text) {
  return keywords.sizeFromText(text);
}

/* ---------- phone extraction from text ---------- */
function extractPhoneFromText(text) {
  // Look for Ghana phone numbers: 0XX-XXX-XXXX or +233XXXXXXXXX
  const patterns = [
    /0\d[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}/,
    /\+233\s?\d[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}/,
    /233\d{9}/,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) {
      let num = m[0].replace(/[\s-]/g, "");
      if (num.startsWith("+233")) num = "0" + num.slice(4);
      else if (num.startsWith("233")) num = "0" + num.slice(3);
      const check = phones.validate(num);
      if (check.valid) return check.normalized;
    }
  }
  return null;
}

/* ---------- find bundle by network + size ---------- */
async function findBundleByNetworkAndSize(networkCode, sizeMb) {
  const networks = await db.select({ from: "networks", where: { code: `eq.${networkCode}`, is_active: "eq.true" } });
  if (!networks.length) return null;
  const networkId = networks[0].id;

  const bundles = await db.select({
    from: "bundles",
    where: { network_id: `eq.${networkId}`, size_mb: `eq.${sizeMb}`, is_active: "eq.true" },
  });
  return bundles[0] || null;
}

async function getNetworkBundles(networkCode) {
  const networks = await db.select({ from: "networks", where: { code: `eq.${networkCode}`, is_active: "eq.true" } });
  if (!networks.length) return [];
  const networkId = networks[0].id;
  const bundles = await db.select({
    from: "bundles",
    where: { network_id: `eq.${networkId}`, is_active: "eq.true" },
    order: "sort_order.asc",
  });
  return bundles;
}

/* ---------- link WhatsApp number to customer account ---------- */
async function findCustomerByWhatsApp(waId) {
  // waId is international format without + (e.g., "233241234567")
  // Convert to Ghana format (0241234567) for lookup
  let ghanaPhone = null;
  if (waId.startsWith("233")) ghanaPhone = "0" + waId.slice(3);
  if (!ghanaPhone) return null;

  const rows = await db.select({ from: "customers", where: { phone: `eq.${ghanaPhone}` } });
  return rows[0] || null;
}

/* ============================================================================
   MESSAGE HANDLER — the main entry point for every inbound WhatsApp message.
   ============================================================================ */
async function handleMessage({ from, text, buttonReply }) {
  const waId = String(from);
  const input = (text || "").trim();
  const session = await getSession(waId) || await upsertSession(waId, "idle", {});

  // Log inbound
  await db.insert("whatsapp_log", {
    direction: "inbound",
    phone: waId,
    message_type: buttonReply ? "button_reply" : "text",
    message_body: (buttonReply || input).slice(0, 4096),
    status: "received",
  }).catch(() => {});

  // Link to customer account if possible
  const customer = await findCustomerByWhatsApp(waId);
  if (customer && !session.customer_id) {
    session.customer_id = customer.id;
    await upsertSession(waId, session.state, session.context, customer.id);
  }

  // ---- Global commands (work from any state) ----
  const lower = input.toLowerCase();

  if (buttonReply) {
    // Button replies are handled in the state machine below
  } else if (/^(hi|hello|hey|menu|start|yo)\b/i.test(lower) || lower === "") {
    return sendWelcome(waId, customer);
  } else if (/^(help|info)\b/i.test(lower)) {
    return sendHelp(waId);
  } else if (/^(cancel|stop|reset|quit)\b/i.test(lower)) {
    await resetSession(waId);
    return whatsapp.sendText(waId, "✅ Cancelled. Send *hi* to start a new order.");
  } else if (/^track\s+(VD-\d{6}-\d{4})/i.test(lower) || /^VD-\d{6}-\d{4}$/.test(input.trim())) {
    const ref = (/VD-\d{6}-\d{4}/.exec(input) || [])[0];
    return trackOrder(waId, ref);
  } else if (/^(autoreload|auto|reload)\b/i.test(lower)) {
    return showAutoReloadStatus(waId, customer);
  } else if (/^(credit|credits|referral|balance)\b/i.test(lower)) {
    return showCreditBalance(waId, customer);
  }

  // ---- Quick order shortcuts ----
  if (!buttonReply) {
    const quickResult = await tryQuickOrder(waId, input, session, customer);
    if (quickResult) return quickResult;
  }

  // ---- State machine ----
  const reply = buttonReply || input;
  const ctx = session.context || {};

  switch (session.state) {
    case "pick_network":
      return handlePickNetwork(waId, reply, ctx, customer);
    case "pick_bundle":
      return handlePickBundle(waId, reply, ctx, customer);
    case "pick_phone":
      return handlePickPhone(waId, reply, ctx, customer);
    case "confirm":
      return handleConfirm(waId, reply, ctx, customer);
    case "idle":
    default:
      return sendWelcome(waId, customer);
  }
}

/* ---------- Welcome / Menu ---------- */
async function sendWelcome(waId, customer) {
  await resetSession(waId);
  const name = customer ? customer.name?.split(" ")[0] || "there" : "there";
  const greeting = `👋 Hey ${name}! Welcome to *Valmont Data*.\n\nBuy MTN, Telecel & AirtelTigo data bundles instantly.\n\nWhat would you like to do?`;

  return whatsapp.sendButtons(waId, greeting, [
    { id: "order", title: "📦 Buy Data" },
    { id: "track", title: "📍 Track Order" },
    { id: "help", title: "❓ Help" },
  ]);
}

/* ---------- Help ---------- */
async function sendHelp(waId) {
  const msg = `*Valmont Data — Help*\n\n` +
    `📦 *Buy data*: Send "hi" and tap Buy Data\n` +
    `⚡ *Quick order*: Type e.g. "2gb mtn 0241234567"\n` +
    `📍 *Track order*: Type "track VD-260812-1234"\n` +
    `🔄 *Auto-reload*: Type "autoreload" to see your rules\n` +
    `💰 *Credits*: Type "credit" to check referral balance\n` +
    `❌ *Cancel*: Type "cancel" anytime\n\n` +
    `Payments via MoMo. Data delivers in seconds.\n\n` +
    `Need more help? Visit valmontdata.com or email support@valmontdata.com`;
  return whatsapp.sendText(waId, msg);
}

/* ---------- Order tracking ---------- */
async function trackOrder(waId, reference) {
  if (!reference || !/^VD-\d{6}-\d{4}$/.test(reference)) {
    return whatsapp.sendText(waId, "❓ Please send a valid order reference like *VD-260812-1234*.\n\nYou'll find it in your order confirmation.");
  }
  const order = await orders.findOrderByReference(reference);
  if (!order) {
    return whatsapp.sendText(waId, `❌ Order *${reference}* not found.\n\nDouble-check the reference and try again.`);
  }
  const bundle = await orders.findBundleById(order.bundle_id);
  const network = await orders.findNetworkById(order.network_id);
  const statusEmoji = { pending: "⏳", paid: "💰", delivering: "🚀", delivered: "✅", failed: "❌", refunded: "↩️" };
  const emoji = statusEmoji[order.status] || "📋";

  let msg = `${emoji} *Order ${reference}*\n\n`;
  msg += `📱 ${order.phone}\n`;
  msg += `📦 ${formatSize(bundle.size_mb)} ${network.name}\n`;
  msg += `💰 ${formatPrice(order.amount)}\n`;
  msg += `📊 Status: *${order.status}*\n`;
  if (order.delivered_at) msg += `🕐 Delivered: ${new Date(order.delivered_at).toLocaleString("en-GB", { timeZone: "Africa/Accra" })}\n`;
  if (order.status === "failed" && order.supplier_response?.error) msg += `\n⚠️ ${order.supplier_response.error}`;
  if (order.status === "refunded") msg += `\n↩️ This order was refunded.`;

  return whatsapp.sendText(waId, msg);
}

/* ---------- Quick order parser ---------- */
async function tryQuickOrder(waId, input, session, customer) {
  // Try to parse "2gb mtn 0241234567" or "1gb telecel" or "500mb 0241234567"
  const network = detectNetworkFromText(input);
  const sizeMb = parseSizeFromText(input);
  const phone = extractPhoneFromText(input);

  if (!network || !sizeMb) return null; // Not a quick order — fall through to state machine

  const bundle = await findBundleByNetworkAndSize(network, sizeMb);
  if (!bundle) {
    // Network + size detected but no matching bundle — show available bundles
    const available = await getNetworkBundles(network);
    if (!available.length) {
      return whatsapp.sendText(waId, `❌ No ${network.toUpperCase()} bundles available right now.`);
    }
    const sizes = available.map((b) => formatSize(b.size_mb)).join(", ");
    return whatsapp.sendText(waId, `📦 ${formatSize(sizeMb)} is not available for ${network.toUpperCase()}.\n\nAvailable: ${sizes}\n\nTry again with one of these sizes.`);
  }

  // Check float
  const float = await orders.currentFloat(bundle.network_id);
  if (float < Number(bundle.cost_price)) {
    return whatsapp.sendText(waId, `⏳ ${formatSize(bundle.size_mb)} ${network.toUpperCase()} is temporarily out of stock. Please try again soon.`);
  }

  // If no phone provided, check if customer has a default number
  let recipientPhone = phone;
  if (!recipientPhone && customer?.phone) {
    recipientPhone = customer.phone;
  }

  if (!recipientPhone) {
    // We have network + bundle but no phone — ask for it
    const networks = await db.select({ from: "networks", where: { code: `eq.${network}` } });
    await upsertSession(waId, "pick_phone", {
      network,
      network_id: networks[0]?.id,
      bundle_id: bundle.id,
      size_mb: bundle.size_mb,
      sell_price: Number(bundle.sell_price),
    }, customer?.id);
    return whatsapp.sendText(waId, `📦 ${formatSize(bundle.size_mb)} ${network.toUpperCase()} — ${formatPrice(bundle.sell_price)}\n\nWhat number should receive the data?\n\n_Send a Ghana number like 0241234567_`);
  }

  // Validate recipient phone
  const check = phones.validate(recipientPhone);
  if (!check.valid) {
    return whatsapp.sendText(waId, `❌ ${check.reason}\n\nPlease send a valid Ghana number (e.g. 0241234567).`);
  }

  // Network mismatch warning
  const detected = phones.detectNetwork(check.normalized);
  const mismatch = detected && detected !== network;

  const networks = await db.select({ from: "networks", where: { code: `eq.${network}` } });
  await upsertSession(waId, "confirm", {
    network,
    network_id: networks[0]?.id,
    bundle_id: bundle.id,
    size_mb: bundle.size_mb,
    sell_price: Number(bundle.sell_price),
    phone: check.normalized,
    mismatch: mismatch ? detected : null,
  }, customer?.id);

  let msg = `*Order summary:*\n\n`;
  msg += `📦 ${formatSize(bundle.size_mb)} ${network.toUpperCase()}\n`;
  msg += `📱 ${check.normalized}\n`;
  msg += `💰 ${formatPrice(bundle.sell_price)}\n`;
  if (mismatch) msg += `\n⚠️ This number looks like ${detected} — ${network.toUpperCase()} data may not deliver.\n`;
  msg += `\nConfirm order?`;

  return whatsapp.sendButtons(waId, msg, [
    { id: "yes", title: "✅ Confirm" },
    { id: "no", title: "❌ Cancel" },
  ]);
}

/* ---------- State: Pick network ---------- */
async function handlePickNetwork(waId, reply, ctx, customer) {
  const lower = reply.toLowerCase();
  let network = null;

  if (lower === "1" || lower.includes("mtn")) network = "mtn";
  else if (lower === "2" || lower.includes("telecel") || lower.includes("voda")) network = "telecel";
  else if (lower === "3" || lower.includes("airtel") || lower.includes("tigo")) network = "airteltigo";
  else network = detectNetworkFromText(reply);

  if (!network) {
    return whatsapp.sendButtons(waId, "Please select a network:", [
      { id: "1", title: "📶 MTN" },
      { id: "2", title: "📶 Telecel" },
      { id: "3", title: "📶 AirtelTigo" },
    ]);
  }

  const networks = await db.select({ from: "networks", where: { code: `eq.${network}`, is_active: "eq.true" } });
  if (!networks.length) {
    return whatsapp.sendText(waId, `❌ ${network} is not available right now. Try another network.`);
  }

  const bundles = await getNetworkBundles(network);
  if (!bundles.length) {
    return whatsapp.sendText(waId, `❌ No ${network.toUpperCase()} bundles available.`);
  }

  // Show bundles (WhatsApp limit ~4096 chars, keep it tight)
  let msg = `*${network.toUpperCase()} Data Bundles:*\n\n`;
  bundles.forEach((b, i) => {
    msg += `*${i + 1}.* ${formatSize(b.size_mb)} — ${formatPrice(b.sell_price)}\n`;
  });
  msg += `\n_Reply with the number (e.g. "1") or type the size (e.g. "2gb")_`;

  await upsertSession(waId, "pick_bundle", {
    network,
    network_id: networks[0].id,
    bundles: bundles.map((b) => ({ id: b.id, size_mb: b.size_mb, sell_price: Number(b.sell_price), cost_price: Number(b.cost_price) })),
  }, customer?.id);

  return whatsapp.sendText(waId, msg);
}

/* ---------- State: Pick bundle ---------- */
async function handlePickBundle(waId, reply, ctx, customer) {
  const bundles = ctx.bundles || [];
  const num = parseInt(reply.trim(), 10);
  let selected = null;

  if (num >= 1 && num <= bundles.length) {
    selected = bundles[num - 1];
  } else {
    // Try parsing size
    const sizeMb = parseSizeFromText(reply);
    if (sizeMb) {
      selected = bundles.find((b) => b.size_mb === sizeMb);
    }
  }

  if (!selected) {
    return whatsapp.sendText(waId, `❓ Please reply with the bundle number (1–${bundles.length}) or the size (e.g. "2gb").`);
  }

  // Check float
  const float = await orders.currentFloat(ctx.network_id);
  if (float < Number(selected.cost_price)) {
    return whatsapp.sendText(waId, `⏳ ${formatSize(selected.size_mb)} ${ctx.network.toUpperCase()} is temporarily out of stock.`);
  }

  // If customer has a phone on file, use it as default and skip to confirm
  if (customer?.phone) {
    const detected = phones.detectNetwork(customer.phone);
    const mismatch = detected && detected !== ctx.network;

    await upsertSession(waId, "confirm", {
      ...ctx,
      bundle_id: selected.id,
      size_mb: selected.size_mb,
      sell_price: selected.sell_price,
      phone: customer.phone,
      mismatch: mismatch ? detected : null,
    }, customer.id);

    let msg = `*Order summary:*\n\n`;
    msg += `📦 ${formatSize(selected.size_mb)} ${ctx.network.toUpperCase()}\n`;
    msg += `📱 ${customer.phone} (your number)\n`;
    msg += `💰 ${formatPrice(selected.sell_price)}\n`;
    if (mismatch) msg += `\n⚠️ Your number looks like ${detected} — ${ctx.network.toUpperCase()} data may not deliver.\n`;
    msg += `\nConfirm order?`;

    return whatsapp.sendButtons(waId, msg, [
      { id: "yes", title: "✅ Confirm" },
      { id: "change", title: "🔄 Other number" },
      { id: "no", title: "❌ Cancel" },
    ]);
  }

  // No customer phone — ask for recipient number
  await upsertSession(waId, "pick_phone", {
    ...ctx,
    bundle_id: selected.id,
    size_mb: selected.size_mb,
    sell_price: selected.sell_price,
  }, customer?.id);

  return whatsapp.sendText(waId, `📱 What number should receive *${formatSize(selected.size_mb)} ${ctx.network.toUpperCase()}*?\n\n_Send a Ghana number like 0241234567_`);
}

/* ---------- State: Pick phone ---------- */
async function handlePickPhone(waId, reply, ctx, customer) {
  const check = phones.validate(reply);
  if (!check.valid) {
    return whatsapp.sendText(waId, `❌ ${check.reason}\n\nPlease send a valid Ghana number (e.g. 0241234567).`);
  }

  const detected = phones.detectNetwork(check.normalized);
  const mismatch = detected && detected !== ctx.network;

  await upsertSession(waId, "confirm", {
    ...ctx,
    phone: check.normalized,
    mismatch: mismatch ? detected : null,
  }, customer?.id);

  let msg = `*Order summary:*\n\n`;
  msg += `📦 ${formatSize(ctx.size_mb)} ${ctx.network.toUpperCase()}\n`;
  msg += `📱 ${check.normalized}\n`;
  msg += `💰 ${formatPrice(ctx.sell_price)}\n`;
  if (mismatch) msg += `\n⚠️ This number looks like ${detected} — ${ctx.network.toUpperCase()} data may not deliver.\n`;
  msg += `\nConfirm order?`;

  return whatsapp.sendButtons(waId, msg, [
    { id: "yes", title: "✅ Confirm" },
    { id: "no", title: "❌ Cancel" },
  ]);
}

/* ---------- State: Confirm ---------- */
async function handleConfirm(waId, reply, ctx, customer) {
  const lower = reply.toLowerCase();
  if (lower === "change" || lower.includes("other")) {
    await upsertSession(waId, "pick_phone", { ...ctx, phone: undefined, mismatch: undefined }, customer?.id);
    return whatsapp.sendText(waId, `📱 What number should receive *${formatSize(ctx.size_mb)} ${ctx.network.toUpperCase()}*?\n\n_Send a Ghana number like 0241234567_`);
  }

  if (lower !== "yes" && lower !== "1" && lower !== "confirm" && lower !== "y") {
    await resetSession(waId);
    return whatsapp.sendText(waId, "❌ Order cancelled. Send *hi* to start a new order.");
  }

  if (!ctx.phone || !ctx.bundle_id || !ctx.network_id) {
    await resetSession(waId);
    return whatsapp.sendText(waId, "⚠️ Something went wrong. Please send *hi* to start again.");
  }

  // Find the actual bundle row for createOrder
  const bundleRows = await db.select({ from: "bundles", where: { id: `eq.${ctx.bundle_id}`, is_active: "eq.true" } });
  if (!bundleRows.length) {
    await resetSession(waId);
    return whatsapp.sendText(waId, "❌ This bundle is no longer available. Please send *hi* to start again.");
  }
  const bundle = bundleRows[0];

  // Float guard
  const float = await orders.currentFloat(ctx.network_id);
  if (float < Number(bundle.cost_price)) {
    await resetSession(waId);
    return whatsapp.sendText(waId, `⏳ This bundle is temporarily out of stock. Please try again in a few minutes.`);
  }

  // Check referral credits
  let creditApplied = 0;
  if (customer?.id && !ctx.credit_checked) {
    const referrals = require("./referrals");
    const balance = await referrals.getBalance(customer.id);
    if (balance > 0 && !ctx.skip_credit) {
      creditApplied = Math.min(balance, Number(bundle.sell_price));
      // If we haven't asked about credit yet, ask now
      if (!ctx.credit_offered) {
        await upsertSession(waId, "confirm", { ...ctx, credit_offered: true, credit_available: creditApplied }, customer.id);
        const discounted = Number(bundle.sell_price) - creditApplied;
        let msg = `💰 You have *${formatPrice(creditApplied)}* in referral credits!\n\n`;
        msg += `📦 ${formatSize(ctx.size_mb)} ${ctx.network.toUpperCase()} → ${ctx.phone}\n`;
        msg += `Original: ${formatPrice(bundle.sell_price)}\n`;
        msg += `Credit: -${formatPrice(creditApplied)}\n`;
        msg += `*You pay: ${formatPrice(discounted)}*\n\n`;
        msg += `Use your credit?`;
        return whatsapp.sendButtons(waId, msg, [
          { id: "yes_credit", title: "✅ Yes, use credit" },
          { id: "no_credit", title: "No, pay full price" },
        ]);
      }
    }
  }

  // Handle credit decision
  if (reply.toLowerCase() === "yes_credit" || reply.toLowerCase() === "yes credit") {
    creditApplied = ctx.credit_available || 0;
  } else if (reply.toLowerCase() === "no_credit" || reply.toLowerCase() === "no credit") {
    creditApplied = 0;
  }

  // Spend the credit if applying
  if (creditApplied > 0 && customer?.id) {
    const referrals = require("./referrals");
    // We'll record the spend after order creation (need order.id)
  }

  // Create the order (tagged as WhatsApp channel for delivery confirmations)
  const order = await orders.createOrder(bundle, ctx.phone, ctx.network_id, customer?.id || null, {
    channel: "whatsapp",
    whatsappFrom: waId,
    creditApplied,
  });

  // Record credit spend after order creation
  if (creditApplied > 0 && customer?.id) {
    const referrals = require("./referrals");
    await referrals.spendCredit(customer.id, creditApplied, order.id).catch(() => {});
  }

  await resetSession(waId);

  // In dev mode (no real Valmont-Pay), simulate the payment
  const valmontpay = require("./valmontpay");
  let checkout;
  try {
    checkout = await valmontpay.createCheckout({
      reference: order.reference,
      amount: Number(order.amount),
      phone: ctx.phone,
      email: customer?.email || `${ctx.phone.replace(/\\D/g, "")}@valmontdata.com`,
      description: `${formatSize(ctx.size_mb)} ${ctx.network.toUpperCase()} data`,
      returnUrl: "",
      webhookUrl: "",
    });
  } catch (e) {
    return whatsapp.sendText(waId, `⚠️ Payment system is temporarily unavailable. Please try again later or visit valmontdata.com.`);
  }

  if (checkout.dev || !checkout.checkout_url) {
    // Dev mode — simulate payment immediately
    return whatsapp.sendText(waId,
      `✅ *Order created!* ${order.reference}\n\n` +
      `📦 ${formatSize(ctx.size_mb)} ${ctx.network.toUpperCase()} → ${ctx.phone}\n` +
      `💰 ${formatPrice(ctx.sell_price)}\n\n` +
      `⏳ Payment processing... You'll get a confirmation once delivered.\n\n` +
      `Track: send "track ${order.reference}"`
    );
  }

  // Live mode — send payment link
  return whatsapp.sendText(waId,
    `✅ *Order created!* ${order.reference}\n\n` +
    `📦 ${formatSize(ctx.size_mb)} ${ctx.network.toUpperCase()} → ${ctx.phone}\n` +
    `💰 ${formatPrice(ctx.sell_price)}\n\n` +
    `👉 Pay now: ${checkout.checkout_url}\n\n` +
    `Data delivers instantly after payment. Track: send "track ${order.reference}"`
  );
}

/* ---------- Handle "track" button reply ---------- */
async function handleTrackButton(waId) {
  await upsertSession(waId, "idle", { asking_track: true });
  return whatsapp.sendText(waId, "📍 Send your order reference (e.g. *VD-260812-1234*) and I'll look it up.");
}

/* ---------- Auto-reload status + opt-in ---------- */
async function showAutoReloadStatus(waId, customer) {
  if (!customer) {
    return whatsapp.sendText(waId, "🔒 Auto-reload requires an account.\n\nSign up at valmontdata.com/signup or send *hi* to buy data first.");
  }

  // Check existing rules
  const rules = await db.select({ from: "auto_reload", where: { customer_id: `eq.${customer.id}` } });

  if (rules.length) {
    let msg = `*Your Auto-reload Rules:*\n\n`;
    for (const rule of rules) {
      const networks = await db.select({ from: "networks", where: { id: `eq.${rule.network_id}` } });
      const bundles = await db.select({ from: "bundles", where: { id: `eq.${rule.bundle_id}` } });
      const netName = networks[0]?.name || "?";
      const sizeStr = bundles[0] ? formatSize(bundles[0].size_mb) : "?";
      const status = rule.active ? "✅ Active" : "⏸️ Paused";
      const relation = rule.relation === "other" ? " 📤 (others)" : "";
      msg += `📱 ${rule.phone}${relation}\n   ${sizeStr} ${netName} · when ${rule.trigger_percent}% left\n   ${status}\n\n`;
    }
    msg += `_To add or manage rules, visit valmontdata.com/autoreload.html_`;
    return whatsapp.sendText(waId, msg);
  }

  // No rules — offer to set one up
  return whatsapp.sendText(waId,
    `🔄 *Auto-reload*\n\n` +
    `You don't have auto-reload set up yet.\n\n` +
    `When your data runs low, we automatically buy a new bundle from your pre-authorized MoMo — you approve each charge with your PIN.\n\n` +
    `To set up auto-reload, visit:\nvalmontdata.com/autoreload.html\n\n` +
    `Or just buy data now and we'll offer it after delivery!`
  );
}

/* ---------- Credit balance ---------- */
async function showCreditBalance(waId, customer) {
  if (!customer) {
    return whatsapp.sendText(waId, "🔒 Sign in to check your referral credits.\n\nSend *hi* to get started.");
  }

  const referrals = require("./referrals");
  const balance = await referrals.getBalance(customer.id);
  const stats = await referrals.getStats(customer.id);

  let msg = `💰 *Your Referral Credits*\n\n`;
  msg += `Balance: *${formatPrice(balance)}*\n`;
  msg += `Friends referred: ${stats.total_referred}\n`;
  msg += `Your code: *${stats.code}*\n\n`;

  if (balance > 0) {
    msg += `Credits auto-apply to your next order. Just say *yes* when asked during checkout!`;
  } else {
    msg += `Share your code with friends to earn GH₵2 credit when they buy!`;
  }
  return whatsapp.sendText(waId, msg);
}

module.exports = {
  handleMessage,
  getSession,
  upsertSession,
  resetSession,
  formatSize,
  formatPrice,
  detectNetworkFromText,
  parseSizeFromText,
  extractPhoneFromText,
};

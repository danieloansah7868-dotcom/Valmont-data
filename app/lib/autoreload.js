/* ============================================================================
   Auto-reload engine — "the web tracks your bundle and tops it up for you".

   How it works:
   1. Every delivered order creates a bundle_usage row (see lib/orders.js).
   2. Usage reports (POST /api/usage — telco/supplier integration in prod,
      scripts/sim-usage.js in dev) push used_mb onto that row.
   3. The customer opts in at /autoreload.html (one rule per data line:
      which bundle to re-buy, how much data must be LEFT before we reload,
      and which pre-authorized MoMo number to charge).
   4. The cron (GET/POST /api/cron/autoreload) watches each active rule:
      when the line's current bundle drops below trigger_percent (or expires),
      it creates a normal order and charges the saved MoMo via Valmont-Pay's
      direct-charge endpoint. The signed charge.success webhook then flows
      through the SAME idempotent claim → float check → delivery pipeline as
      a manual purchase — no second payment path, no double-delivery risk.

   Guard rails:
   - Cooldown between reloads (AUTORELOAD_COOLDOWN_MINUTES, default 12h) so
     stale usage reports can't drain the customer's MoMo.
   - Never stack: if an order for that line is already pending/paid/delivering,
     the engine skips until it resolves.
   - Float guard: no order is created if we can't deliver it (the webhook
     re-checks float anyway and auto-refunds the race case).
   - Opt-out is instant: paused/deleted rules are never triggered.
   ============================================================================ */

const crypto = require("crypto");
const { db } = require("./supabase");
const orders = require("./orders");
const valmontpay = require("./valmontpay");
const { notify } = require("./notify");

const COOLDOWN_MINUTES = () => Number(process.env.AUTORELOAD_COOLDOWN_MINUTES || 720); // 12h default
const LOW_PERCENT_FOR_ASK = 80; // lines above this without a rule get the "turn on auto-reload?" prompt

/* Dev-only webhook simulation. NEVER on in live mode: scripts/dev-server.js
   sets AUTORELOAD_SIMULATE=1 locally; production deployments leave it unset,
   so a missing gateway fails loudly instead of faking a payment. */
const SIMULATE = () => process.env.AUTORELOAD_SIMULATE === "1";

/* ---------- labels ---------- */
function mbLabel(sizeMb) {
  return sizeMb >= 1024 ? `${Math.round(sizeMb / 1024)}GB` : `${sizeMb}MB`;
}

/* ---------- lookups ---------- */
async function findRule(id) {
  const rows = await db.select({ from: "auto_reload", where: { id: `eq.${id}` } });
  return rows[0] || null;
}

async function findRuleForPhone(customerId, phone) {
  const rows = await db.select({
    from: "auto_reload",
    where: { customer_id: `eq.${customerId}`, phone: `eq.${phone}` },
  });
  return rows[0] || null;
}

async function latestUsage(phone) {
  const rows = await db.select({
    from: "bundle_usage",
    where: { phone: `eq.${phone}` },
    order: "id.desc",
    limit: 1,
  });
  return rows[0] || null;
}

async function usageForOrder(orderId) {
  const rows = await db.select({ from: "bundle_usage", where: { order_id: `eq.${orderId}` } });
  return rows[0] || null;
}

/* ---------- usage state ---------- */
function computeUsageState(usage) {
  if (!usage) return null;
  const size = Number(usage.size_mb);
  const used = Math.min(Math.max(Number(usage.used_mb || 0), 0), size);
  const percentUsed = size > 0 ? Math.round((used / size) * 100) : 0;
  const expired = usage.expires_at ? new Date(usage.expires_at).getTime() < Date.now() : false;

  let status = usage.status;
  if (status === "active") {
    if (used >= size) status = "exhausted";
    else if (expired) status = "expired";
  }
  return {
    id: usage.id,
    order_id: usage.order_id,
    phone: usage.phone,
    size_mb: size,
    used_mb: Number(usage.used_mb || 0),
    percent_used: percentUsed,
    percent_left: 100 - percentUsed,
    remaining_mb: Math.max(0, size - used),
    status,
    started_at: usage.started_at,
    expires_at: usage.expires_at,
    last_report_at: usage.last_report_at,
  };
}

function isLow(usage) {
  if (!usage) return false;
  return usage.status === "exhausted" || usage.status === "expired" || usage.percent_used >= LOW_PERCENT_FOR_ASK;
}

/* ---------- decision ---------- */
function shouldReload(rule, state) {
  if (!rule.active) return { go: false, reason: "rule paused" };
  if (rule.cooldown_until && new Date(rule.cooldown_until).getTime() > Date.now()) {
    return { go: false, reason: "cooldown" };
  }
  if (!state) return { go: false, reason: "no usage data yet" };
  if (state.status === "exhausted" || state.status === "expired") return { go: true, reason: state.status };
  if (state.status === "active" && state.percent_used >= 100 - Number(rule.trigger_percent)) {
    return { go: true, reason: `used ${state.percent_used}% (reload at ${rule.trigger_percent}% left)` };
  }
  return { go: false, reason: `still has data (${state.percent_left}% left)` };
}

/* A reload for this line is already in flight (order created by us or a manual
   purchase that has not resolved yet) → skip to avoid stacking. */
async function hasInFlightOrder(phone) {
  const recent = await db.select({
    from: "orders",
    where: { phone: `eq.${phone}` },
    order: "id.desc",
    limit: 6,
  });
  return recent.some(
    (o) =>
      ["pending", "paid", "delivering"].includes(o.status) &&
      Date.now() - new Date(o.created_at).getTime() < 24 * 3600 * 1000
  );
}

/* ---------- charge (dev: simulate the gateway webhook locally) ---------- */
function simulateChargeWebhook(order) {
  const providerRef =
    "VP-AR-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(1000 + Math.random() * 9000);
  const payload = {
    event: "charge.success",
    reference: order.reference,
    provider_reference: providerRef,
    amount: Number(order.amount),
    currency: "GHS",
    source: "autoreload-sim",
  };
  const rawBody = JSON.stringify(payload);
  const secret = process.env.VALMONTPAY_WEBHOOK_SECRET || "";
  const signature = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");

  const req = {
    method: "POST",
    url: "/api/valmontpay/webhook",
    headers: {
      "x-valmontpay-signature": signature,
      "content-type": "application/json",
    },
    rawBody, // dev-server convention — readRawBody() returns this
  };
  let bodyText = "";
  const res = {
    statusCode: 200,
    setHeader() {},
    end(data) {
      bodyText = data;
    },
  };

  const webhook = require("../api/valmontpay/webhook");
  return webhook(req, res).then(() => {
    let body = {};
    try {
      body = JSON.parse(bodyText);
    } catch {}
    return { status: res.statusCode, ...body };
  });
}

/* ---------- trigger ---------- */
async function triggerReload(rule) {
  const bundle = await orders.findBundleById(rule.bundle_id);
  const network = await orders.findNetworkById(rule.network_id);
  if (!bundle || !network) return { triggered: false, reason: "bundle/network unavailable" };

  // LIVE GATEWAY GUARD — in live mode a reload must charge a real MoMo. If the
  // gateway is not configured, skip loudly (no simulated success).
  if (valmontpay.mode() === "live" && !valmontpay.configured()) {
    await notify.alert(
      `Auto-reload for ${rule.phone} skipped — Valmont-Pay live mode requires VALMONTPAY_API_KEY and VALMONTPAY_WEBHOOK_SECRET`
    );
    return { triggered: false, reason: "live gateway not configured" };
  }

  // FLOAT GUARD — never create an order we cannot deliver.
  const float = await orders.currentFloat(rule.network_id);
  if (float < Number(bundle.cost_price)) {
    await notify.alert(
      `Auto-reload for ${rule.phone} skipped — float too low for ${mbLabel(bundle.size_mb)} ${network.name} (GH₵${Number(bundle.sell_price).toFixed(2)})`
    );
    return { triggered: false, reason: "insufficient float" };
  }

  const order = await orders.createOrder(bundle, rule.phone, rule.network_id, rule.customer_id, {
    autoReloadId: rule.id,
  });

  const nowIso = new Date().toISOString();
  const cooldownUntil = new Date(Date.now() + COOLDOWN_MINUTES() * 60000).toISOString();
  await db.update(
    "auto_reload",
    { last_triggered_at: nowIso, cooldown_until: cooldownUntil, updated_at: nowIso },
    { id: `eq.${rule.id}` }
  );

  const customerRows = await db.select({ from: "customers", where: { id: `eq.${rule.customer_id}` } });
  const email = customerRows[0]?.email || null;

  await notify.alert(
    `Auto-reload fired for ${rule.phone} — ${mbLabel(bundle.size_mb)} ${network.name} (GH₵${Number(bundle.sell_price).toFixed(2)}) ordered, charging MoMo ${rule.momo_number || "on file"}`
  );

  let charge;
  try {
    charge = await valmontpay.initiateCharge({
      reference: order.reference,
      amount: Number(order.amount),
      phone: rule.momo_number || rule.phone,
      email,
      description: `Auto-reload: ${mbLabel(bundle.size_mb)} ${network.name} for ${rule.phone}`,
    });
  } catch (e) {
    await orders.setStatus(order.id, "failed", {
      supplier_response: { autoreload: true, charge_error: e.message },
    });
    await notify.alert(`Auto-reload charge FAILED for ${rule.phone} (order ${order.reference}): ${e.message}`);
    return { triggered: true, reference: order.reference, charged: false, error: e.message };
  }

  if (charge.dev) {
    if (!SIMULATE()) {
      // Live mode (or simulation disabled): a dev-only fallback must never
      // masquerade as a payment. Fail the order and alert instead.
      await orders.setStatus(order.id, "failed", {
        supplier_response: { autoreload: true, charge_error: "live mode: gateway simulation disabled" },
      });
      await notify.alert(
        `Auto-reload charge FAILED for ${rule.phone} (order ${order.reference}): Valmont-Pay not configured and AUTORELOAD_SIMULATE is off`
      );
      return { triggered: true, reference: order.reference, charged: false, error: "gateway not configured" };
    }
    // Dev mode — no gateway. Simulate the signed charge.success webhook so the
    // claim → float check → delivery path runs exactly as it would live.
    const outcome = await simulateChargeWebhook(order);
    return { triggered: true, reference: order.reference, charged: true, dev: true, outcome };
  }

  return { triggered: true, reference: order.reference, charged: true, live: true };
}

/* ---------- cron ---------- */
async function runCron() {
  const rules = await db.select({
    from: "auto_reload",
    where: { active: "eq.true" },
    order: "id.asc",
    limit: 50,
  });

  const results = [];
  const triggered = [];
  for (const rule of rules) {
    const state = computeUsageState(await latestUsage(rule.phone));
    const check = shouldReload(rule, state);
    if (!check.go) {
      results.push({ id: rule.id, phone: rule.phone, action: "skip", reason: check.reason });
      continue;
    }
    if (await hasInFlightOrder(rule.phone)) {
      results.push({ id: rule.id, phone: rule.phone, action: "skip", reason: "order already in flight" });
      continue;
    }
    const result = await triggerReload(rule);
    results.push({ id: rule.id, phone: rule.phone, action: "trigger", ...result });
    if (result.triggered) triggered.push(result);
  }

  return { checked: rules.length, results, triggered, ts: new Date().toISOString() };
}

/* ---------- usage report (called by api/usage.js) ---------- */
async function reportUsage({ reference, phone, usedMb }) {
  let usage = null;
  if (reference) {
    const order = await orders.findOrderByReference(reference);
    if (!order) return { error: "order not found", status: 404 };
    usage = await usageForOrder(order.id);
    if (!usage) {
      return {
        error: "No usage record for that order yet — only delivered bundles are tracked",
        status: 400,
      };
    }
  } else if (phone) {
    usage = await latestUsage(phone);
    if (!usage) return { error: "No usage record for that line yet", status: 404 };
  } else {
    return { error: "reference or phone required", status: 400 };
  }

  const size = Number(usage.size_mb);
  const amount = Math.min(Math.max(Number(usedMb) || 0, 0), size);
  const status = amount >= size ? "exhausted" : usage.status;
  const nowIso = new Date().toISOString();

  await db.update(
    "bundle_usage",
    { used_mb: amount, status, last_report_at: nowIso },
    { id: `eq.${usage.id}` }
  );

  const state = computeUsageState({ ...usage, used_mb: amount, status, last_report_at: nowIso });

  // Does this line already have an active auto-reload rule? (drives the
  // "should we ask the user to opt in?" flag returned to the reporting side,
  // so an SMS/WhatsApp automation can prompt instead of the engine spamming.)
  const ruleRows = await db.select({
    from: "auto_reload",
    where: { phone: `eq.${usage.phone}`, active: "eq.true" },
    limit: 1,
  });

  // THE GIFT RULE: we only ever ASK the customer about a line that is their
  // OWN number. If this phone is not anyone's account phone, it is a line they
  // buy data FOR (favour/family) — never auto-prompt, or the customer will
  // think the reload tops THEM up when it actually goes to the other person.
  const ownRows = await db.select({
    from: "customers",
    where: { phone: `eq.${usage.phone}` },
    select: "id",
    limit: 1,
  });
  const isOwnLine = ownRows.length > 0;

  return {
    ok: true,
    usage: {
      id: state.id,
      phone: state.phone,
      order_id: state.order_id,
      size_mb: state.size_mb,
      used_mb: state.used_mb,
      percent_used: state.percent_used,
      percent_left: state.percent_left,
      status: state.status,
      low: isLow(state),
      should_ask: isLow(state) && ruleRows.length === 0 && isOwnLine,
      expires_at: state.expires_at,
      last_report_at: state.last_report_at,
    },
  };
}

module.exports = {
  COOLDOWN_MINUTES,
  mbLabel,
  findRule,
  findRuleForPhone,
  latestUsage,
  usageForOrder,
  computeUsageState,
  isLow,
  shouldReload,
  hasInFlightOrder,
  triggerReload,
  runCron,
  reportUsage,
  simulateChargeWebhook,
};

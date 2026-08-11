/* ============================================================================
   Auto-reload API (customer-authenticated — the opt-in place)
     GET    /api/autoreload           → data lines with live usage state, the
                                        customer's rules (enriched), saved MoMo
                                        numbers and the bundle catalogue
     POST   /api/autoreload           → create/update an opt-in rule
                                        { phone, bundle_id, trigger_percent,
                                          momo_number, consent: true }
     POST   /api/autoreload           → { action: "toggle", id, active } pauses
                                        or resumes an existing rule
     DELETE /api/autoreload?id=       → permanent opt-out for that rule
   ============================================================================ */

const { json, readRawBody, wrap } = require("../lib/http");
const { requireCustomer } = require("../lib/auth");
const { db } = require("../lib/supabase");
const phones = require("../lib/phones");
const orders = require("../lib/orders");
const autoreload = require("../lib/autoreload");

async function get(req, res) {
  const auth = requireCustomer(req);

  const [customerRows, savedRows, ruleRows, networks, bundles] = await Promise.all([
    db.select({ from: "customers", where: { id: `eq.${auth.id}` } }),
    db.select({ from: "saved_numbers", where: { customer_id: `eq.${auth.id}` }, order: "created_at.desc" }),
    db.select({ from: "auto_reload", where: { customer_id: `eq.${auth.id}` }, order: "id.desc" }),
    db.select({ from: "networks", where: { is_active: "eq.true" } }),
    db.select({ from: "bundles", where: { is_active: "eq.true" }, order: "network_id.asc,sort_order.asc" }),
  ]);

  const networkById = new Map(networks.map((n) => [n.id, n]));
  const bundleById = new Map(bundles.map((b) => [b.id, b]));

  const dataLines = savedRows.filter((s) => s.kind === "data");
  const momoNumbers = savedRows.filter((s) => s.kind === "momo");

  // Usage state for every data line + the rule attached to it (if any)
  const lines = await Promise.all(
    dataLines.map(async (line) => {
      const usage = autoreload.computeUsageState(await autoreload.latestUsage(line.phone));
      const ruleRow = ruleRows.find((r) => r.phone === line.phone) || null;
      const rule = ruleRow ? enrichRule(ruleRow, networkById, bundleById) : null;
      return {
        phone: line.phone,
        label: line.label || "Data line",
        usage,
        low: autoreload.isLow(usage),
        should_ask: autoreload.isLow(usage) && (!rule || !rule.active),
        rule,
      };
    })
  );

  return json(res, 200, {
    customer: customerRows[0]
      ? { id: customerRows[0].id, phone: customerRows[0].phone, email: customerRows[0].email, name: customerRows[0].name }
      : auth,
    lines,
    rules: ruleRows.map((r) => enrichRule(r, networkById, bundleById)),
    momo_numbers: momoNumbers,
    networks: networks.map((n) => ({ id: n.id, code: n.code, name: n.name })),
    bundles: bundles.map((b) => ({
      id: b.id,
      network_id: b.network_id,
      network: networkById.get(b.network_id)?.code || null,
      size_mb: b.size_mb,
      validity_days: b.validity_days,
      price: Number(b.sell_price),
    })),
    cooldown_minutes: autoreload.COOLDOWN_MINUTES(),
  });
}

function enrichRule(rule, networkById, bundleById) {
  const bundle = bundleById.get(rule.bundle_id);
  const network = networkById.get(rule.network_id);
  return {
    id: rule.id,
    phone: rule.phone,
    network: network ? network.code : null,
    network_name: network ? network.name : null,
    bundle_id: rule.bundle_id,
    bundle_label: bundle
      ? `${autoreload.mbLabel(bundle.size_mb)} ${network ? network.name : ""} — GH₵${Number(bundle.sell_price).toFixed(2)}`
      : "Bundle",
    size_mb: bundle ? bundle.size_mb : null,
    price: bundle ? Number(bundle.sell_price) : null,
    trigger_percent: Number(rule.trigger_percent),
    momo_number: rule.momo_number,
    active: rule.active,
    reload_count: Number(rule.reload_count || 0),
    last_reload_at: rule.last_reload_at,
    last_triggered_at: rule.last_triggered_at,
    cooldown_until: rule.cooldown_until,
    created_at: rule.created_at,
  };
}

async function post(req, res) {
  const auth = requireCustomer(req);

  const body = await readRawBody(req).then((b) => {
    try { return JSON.parse(b); } catch { return null; }
  });
  if (!body) return json(res, 400, { error: "Invalid JSON" });

  /* ---- toggle pause/resume ---- */
  if (body.action === "toggle") {
    if (!body.id) return json(res, 400, { error: "Rule id required" });
    const rows = await db.update(
      "auto_reload",
      { active: body.active ? true : false, updated_at: new Date().toISOString() },
      { id: `eq.${Number(body.id)}`, customer_id: `eq.${auth.id}` }
    );
    if (!rows.length) return json(res, 404, { error: "Auto-reload rule not found" });
    return json(res, 200, { ok: true, rule: rows[0], active: rows[0].active });
  }

  /* ---- create / update rule (the opt-in) ---- */
  const phoneCheck = phones.validate(body.phone);
  if (!phoneCheck.valid) return json(res, 400, { error: phoneCheck.reason });

  const bundle = await orders.findBundleById(Number(body.bundle_id));
  if (!bundle) return json(res, 404, { error: "Bundle not found or unavailable" });
  const network = await orders.findNetworkById(bundle.network_id);
  if (!network) return json(res, 404, { error: "Network not found" });

  // The bundle must be deliverable to this line — hard-fail on a network
  // mismatch (an MTN bundle on an AirtelTigo number would never deliver).
  const netCheck = phones.checkAgainstNetwork(phoneCheck.normalized, network.code);
  if (netCheck.mismatch) {
    return json(res, 400, {
      error: `${netCheck.message} Choose a ${network.name} bundle for ${phoneCheck.normalized}.`,
    });
  }

  let triggerPercent = Number(body.trigger_percent);
  if (!Number.isInteger(triggerPercent) || triggerPercent < 1 || triggerPercent > 50) {
    return json(res, 400, { error: "trigger_percent must be a whole number between 1 and 50" });
  }

  const momoCheck = phones.validate(body.momo_number);
  if (!momoCheck.valid) return json(res, 400, { error: "A valid MoMo number to charge is required: " + momoCheck.reason });

  // Explicit consent is the whole point of this page — never auto-opt a user in.
  if (body.consent !== true) {
    return json(res, 400, {
      error: "Please tick the consent box to authorise automatic top-ups from your MoMo.",
      code: "CONSENT_REQUIRED",
    });
  }

  const nowIso = new Date().toISOString();
  const existing = await autoreload.findRuleForPhone(auth.id, phoneCheck.normalized);

  let rule;
  if (existing) {
    const updated = await db.update(
      "auto_reload",
      {
        bundle_id: bundle.id,
        network_id: bundle.network_id,
        trigger_percent: triggerPercent,
        momo_number: momoCheck.normalized,
        active: true,
        updated_at: nowIso,
      },
      { id: `eq.${existing.id}` }
    );
    rule = updated[0];
  } else {
    try {
      const inserted = await db.insert("auto_reload", {
        customer_id: auth.id,
        phone: phoneCheck.normalized,
        network_id: bundle.network_id,
        bundle_id: bundle.id,
        trigger_percent: triggerPercent,
        momo_number: momoCheck.normalized,
        active: true,
      });
      rule = inserted[0];
    } catch (e) {
      if (e.status === 409 || e.message?.includes("unique constraint")) {
        return json(res, 409, { error: "This line already has an auto-reload rule" });
      }
      throw e;
    }
  }

  await notifyConsent(auth, rule, bundle, network);
  return json(res, 201, { ok: true, rule_id: rule.id, rule });
}

async function del(req, res) {
  const auth = requireCustomer(req);
  const url = new URL(req.url, "http://local");
  const id = Number(url.searchParams.get("id"));
  if (!id) return json(res, 400, { error: "Rule id required" });

  const deleted = await db.delete("auto_reload", { id: `eq.${id}`, customer_id: `eq.${auth.id}` });
  if (!deleted.length) return json(res, 404, { error: "Auto-reload rule not found" });
  return json(res, 200, { ok: true, removed: true });
}

/* Customer-facing audit line for the opt-in (logged; also a receipt the
   customer can point to if they ever dispute a charge). */
async function notifyConsent(auth, rule, bundle, network) {
  const { send } = require("../lib/notify");
  await send("autoreload.optin", {
    customer_id: auth.id,
    customer_phone: auth.phone || auth.email || null,
    rule_id: rule.id,
    phone: rule.phone,
    bundle: `${autoreload.mbLabel(bundle.size_mb)} ${network.name}`,
    price: Number(bundle.sell_price),
    trigger_percent: Number(rule.trigger_percent),
    momo_number: rule.momo_number,
  });
}

module.exports = wrap(async (req, res) => {
  if (req.method === "GET") return get(req, res);
  if (req.method === "POST") return post(req, res);
  if (req.method === "DELETE") return del(req, res);
  return json(res, 405, { error: "Method not allowed" });
});

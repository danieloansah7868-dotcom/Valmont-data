/* ============================================================================
   Demo dataset generator — realistic sample data for the Valmont Data
   marketplace (customers, saved numbers, orders, bundle usage, auto-reload
   opt-ins, float ledger, webhook log).

   One source of truth for two outputs:
     - in-memory mock DB :  SEED_DEMO=1 node scripts/dev-server.js
     - Supabase demo seed:  node scripts/seed-demo.js --sql → supabase/seed-demo.sql

   Deterministic: the same anchor date always yields the same rows, so seeds,
   verifications and tests can assert exact numbers. Networks & bundles are
   NOT generated here — BUNDLES below mirrors the base seed in
   supabase/schema.sql and lib/supabase.js imports it from here (keep all three
   in step). Orders reference bundles by (network, size_mb)
   and customers by phone; each consumer resolves those to ids its own way
   (mock ids in supabase.js, subselects in the generated SQL).
   ============================================================================ */

const crypto = require("crypto");

/* ---------- deterministic PRNG (mulberry32) ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

/* ---------- scrypt PIN hash — identical scheme to api/auth/customer.js ----------
   Salt is derived from the phone so the hash is stable across generations
   (still scrypt:verifiable — verifySecret only splits on ':'). */
function demoPinHash(pin, phone) {
  const salt = crypto.createHash("sha256").update("valmont-demo:" + phone).digest("hex").slice(0, 32);
  const hash = crypto.scryptSync(String(pin), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/* ---------- mirror of the base seed (supabase/schema.sql) ---------- */
const NETWORK_CODES = ["mtn", "telecel", "airteltigo"];

const BUNDLES = [
  // network, size_mb, validity_days, cost_price, sell_price
  { network: "mtn",       size_mb: 1024,  validity_days: null, cost: 3.9,   sell: 6.0 },
  { network: "mtn",       size_mb: 2048,  validity_days: null, cost: 8.1,   sell: 12.0 },
  { network: "mtn",       size_mb: 3072,  validity_days: null, cost: 11.9,  sell: 17.0 },
  { network: "mtn",       size_mb: 4096,  validity_days: null, cost: 16.6,  sell: 23.0 },
  { network: "mtn",       size_mb: 5120,  validity_days: null, cost: 18.9,  sell: 28.0 },
  { network: "mtn",       size_mb: 6144,  validity_days: null, cost: 24.5,  sell: 35.0 },
  { network: "mtn",       size_mb: 8192,  validity_days: null, cost: 32.6,  sell: 43.0 },
  { network: "mtn",       size_mb: 10240, validity_days: null, cost: 38.5,  sell: 52.0 },
  { network: "mtn",       size_mb: 15360, validity_days: null, cost: 58.0,  sell: 75.0 },
  { network: "mtn",       size_mb: 20480, validity_days: null, cost: 73.0,  sell: 93.0 },
  { network: "mtn",       size_mb: 25600, validity_days: null, cost: 98.0,  sell: 115.0 },
  { network: "mtn",       size_mb: 30720, validity_days: null, cost: 111.0, sell: 140.0 },
  { network: "mtn",       size_mb: 40960, validity_days: null, cost: 159.0, sell: 180.0 },
  { network: "mtn",       size_mb: 51200, validity_days: null, cost: 185.0, sell: 220.0 },
  { network: "telecel",   size_mb: 10240, validity_days: 60,   cost: 35.5,  sell: 39.5 },
  { network: "telecel",   size_mb: 20480, validity_days: 60,   cost: 67.8,  sell: 75.0 },
  { network: "telecel",   size_mb: 30720, validity_days: 60,   cost: 98.7,  sell: 110.0 },
  { network: "telecel",   size_mb: 51200, validity_days: 60,   cost: 162.5, sell: 180.0 },
  { network: "telecel",   size_mb: 102400, validity_days: 60,  cost: 367.0, sell: 405.0 },
  { network: "airteltigo", size_mb: 1024, validity_days: 60,   cost: 3.65,  sell: 4.0 },
  { network: "airteltigo", size_mb: 5120, validity_days: 60,   cost: 18.0,  sell: 19.9 },
  { network: "airteltigo", size_mb: 10240, validity_days: 60,  cost: 35.5,  sell: 39.0 },
  { network: "airteltigo", size_mb: 30720, validity_days: 60,  cost: 106.0, sell: 117.0 },
  { network: "airteltigo", size_mb: 51200, validity_days: 60,  cost: 175.0, sell: 193.0 },
];

const PHONE_PREFIXES = {
  mtn: ["024", "025", "026", "054", "055", "059"],
  telecel: ["020", "050"],
  airteltigo: ["027", "056"],
};

/* Provider-reference suffix alphabet (no confusables: no 0/O/1/I) */
const SUFFIX_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/* Demo accounts — documented in the seed output; PINs are the login secrets */
const DEMO_CUSTOMERS = [
  { phone: "0241234567", email: "ama.serwaa@example.com", name: "Ama Serwaa", pin: "1234" },
  { phone: "0209876543", email: "kofi.mensah@example.com", name: "Kofi Mensah", pin: "1234" },
  { phone: "0551112233", email: "abena.owusu@example.com", name: "Abena Owusu", pin: "9876" },
  { phone: "0502345678", email: "yaw.boateng@example.com", name: "Yaw Boateng", pin: "2468" },
  { phone: "0273344556", email: "esi.asante@example.com", name: "Esi Asante", pin: "1357" },
];

const SAVED_NUMBERS = [
  { customer_phone: "0241234567", kind: "data", phone: "0241234567", label: "My line" },
  { customer_phone: "0241234567", kind: "data", phone: "0559988776", label: "Mum's line" },
  { customer_phone: "0241234567", kind: "momo", phone: "0245678901", label: "My MoMo" },
  { customer_phone: "0209876543", kind: "data", phone: "0209876543", label: "My line" },
  { customer_phone: "0209876543", kind: "data", phone: "0201122334", label: "Shop line" },
  { customer_phone: "0209876543", kind: "momo", phone: "0505566778", label: "MoMo" },
  { customer_phone: "0551112233", kind: "data", phone: "0551112233", label: "My line" },
  { customer_phone: "0551112233", kind: "data", phone: "0247788990", label: "Work line" },
  { customer_phone: "0551112233", kind: "momo", phone: "0559998877", label: "MoMo" },
  { customer_phone: "0551112233", kind: "momo", phone: "0241212121", label: "Dad's MoMo" },
  { customer_phone: "0502345678", kind: "data", phone: "0502345678", label: "My line" },
  { customer_phone: "0502345678", kind: "data", phone: "0276655443", label: "Family line" },
  { customer_phone: "0502345678", kind: "momo", phone: "0501234321", label: "Business MoMo" },
  { customer_phone: "0273344556", kind: "data", phone: "0273344556", label: "My line" },
  { customer_phone: "0273344556", kind: "data", phone: "0561122334", label: "Brother's line" },
  { customer_phone: "0273344556", kind: "momo", phone: "0277788990", label: "MoMo" },
];

/* Realistic supplier errors for permanently/temporarily failed deliveries */
const SUPPLIER_ERRORS = [
  "Provider gateway timeout (HTTP 504)",
  "Insufficient float on supplier account — recharge required",
  "Invalid recipient — number cannot receive this bundle",
  "Supplier API error: SUBSCRIBER_NOT_FOUND",
];

const round2 = (n) => Math.round(n * 100) / 100;
const yymmdd = (isoStr) => isoStr.slice(2, 10).replace(/-/g, "");

function genSuffix(rng, length = 4) {
  let s = "";
  for (let i = 0; i < length; i++) s += SUFFIX_CHARS[Math.floor(rng() * SUFFIX_CHARS.length)];
  return s;
}

function genPhone(rng, network) {
  let phone;
  do {
    phone = pick(rng, PHONE_PREFIXES[network]) + String(Math.floor(rng() * 10000000)).padStart(7, "0");
  } while (phone.endsWith("0000")); // keep clear of the test convention in lib/supplier.js
  return phone;
}

/* Pick a bundle, biasing toward the smaller (more popular) sizes */
function pickBundle(rng, network) {
  const pool = BUNDLES.filter((b) => b.network === network);
  const idx = Math.floor(Math.pow(rng(), 1.6) * pool.length);
  return pool[Math.min(idx, pool.length - 1)];
}

/* ============================================================================
   buildDemo — returns { customers, saved_numbers, orders, bundle_usage,
                         auto_reload, float_ledger, webhook_log }
   All timestamps are ISO strings relative to `now` (default: current time).
   ============================================================================ */
function buildDemo({ now = new Date(), rngSeed = 20260807, orderCount = 52 } = {}) {
  const rng = mulberry32(rngSeed);
  const at = (daysAgo, minutes = 0) => new Date(now.getTime() - daysAgo * 86400000 + minutes * 60000).toISOString();

  /* data lines per customer (from SAVED_NUMBERS) — used to make some demo
     orders land on the customers' own lines so usage tracking is visible */
  const customerLines = {};
  for (const s of SAVED_NUMBERS) {
    if (s.kind !== "data") continue;
    customerLines[s.customer_phone] = customerLines[s.customer_phone] || [];
    customerLines[s.customer_phone].push(s.phone);
  }
  const bundleByKey = {};
  for (const b of BUNDLES) bundleByKey[`${b.network}:${b.size_mb}`] = b;

  /* ---- customers ---- */
  const customers = DEMO_CUSTOMERS.map((c, i) => ({
    phone: c.phone,
    email: c.email,
    name: c.name,
    pin_hash: demoPinHash(c.pin, c.phone),
    created_at: at(46 - i * 4, Math.floor(rng() * 120)), // 46..30 days ago
  }));

  /* ---- saved numbers ---- */
  const saved_numbers = SAVED_NUMBERS.map((s, i) => ({
    customer_phone: s.customer_phone,
    kind: s.kind,
    phone: s.phone,
    label: s.label,
    created_at: at(40 - i, Math.floor(rng() * 200)),
  }));

  /* ---- orders ---- */
  const orders = [];
  const usedRefs = new Set();
  const usedProviderRefs = new Set();

  for (let i = 0; i < orderCount; i++) {
    const created = new Date(now.getTime() - rng() * 29 * 86400000 - rng() * 18 * 3600000); // 0..29d back, at least ~1h before now
    const createdIso = created.toISOString();

    let reference;
    do { reference = `VD-${yymmdd(createdIso)}-${Math.floor(1000 + rng() * 9000)}`; } while (usedRefs.has(reference));
    usedRefs.add(reference);

    const r = rng();
    const network = r < 0.6 ? "mtn" : r < 0.85 ? "telecel" : "airteltigo";
    const bundle = pickBundle(rng, network);

    const customer_phone = rng() < 0.7 ? pick(rng, DEMO_CUSTOMERS).phone : null;
    // About half of account orders deliver to one of the customer's OWN saved
    // lines (the rest are gifts/other numbers) — makes bundle usage tracking
    // and auto-reload demo data coherent.
    const ownLines = customer_phone ? (customerLines[customer_phone] || []) : [];
    const phone =
      customer_phone && ownLines.length && rng() < 0.55
        ? pick(rng, ownLines)
        : genPhone(rng, network);

    const roll = rng();
    const status =
      roll < 0.79 ? "delivered"
      : roll < 0.86 ? "failed"
      : roll < 0.92 ? "refunded"
      : roll < 0.96 ? "delivering"
      : "pending";

    let provider_reference = null;
    if (status !== "pending") {
      do { provider_reference = `VP-${yymmdd(createdIso)}-${genSuffix(rng)}`; } while (usedProviderRefs.has(provider_reference));
      usedProviderRefs.add(provider_reference);
    }

    let supplier_ref = null;
    let supplier_response = null;
    let attempts = 0;
    let delivered_at = null;

    if (status === "delivered") {
      attempts = rng() < 0.85 ? 1 : 2;
      supplier_ref = "REM-" + String(Math.floor(10000000 + rng() * 90000000));
      supplier_response = {
        driver: "remadata",
        order_id: supplier_ref,
        status: "success",
        network,
        size_mb: bundle.size_mb,
        phone,
      };
      delivered_at = new Date(created.getTime() + (1 + rng() * 4) * 60000).toISOString();
    } else if (status === "failed") {
      attempts = rng() < 0.5 ? 1 : 3; // a mix of retryable and permanently-failed
      supplier_response = { ok: false, error: pick(rng, SUPPLIER_ERRORS), raw: { driver: "mock", order: reference } };
    } else if (status === "refunded") {
      attempts = 1;
      supplier_response = {
        refunded: true,
        reason: `Amount mismatch: webhook ${round2(bundle.sell + 10).toFixed(2)} vs order ${bundle.sell.toFixed(2)}`,
      };
    } else if (status === "delivering") {
      attempts = 1;
    }

    orders.push({
      reference,
      phone,
      network,
      size_mb: bundle.size_mb,
      amount: bundle.sell,
      cost_price: bundle.cost,
      status,
      provider_reference,
      supplier_ref,
      supplier_response,
      attempts,
      customer_phone,
      created_at: createdIso,
      delivered_at,
    });
  }

  /* ---- bundle usage (one row per delivered order) ---- */
  const bundle_usage = [];
  for (const o of orders) {
    if (o.status !== "delivered") continue;
    const b = bundleByKey[`${o.network}:${o.size_mb}`];
    const deliveredMs = new Date(o.delivered_at).getTime();
    bundle_usage.push({
      order_reference: o.reference,
      phone: o.phone,
      network: o.network,
      size_mb: o.size_mb,
      used_mb: round2(o.size_mb * (0.05 + rng() * 0.9)),
      status: "active",
      started_at: o.delivered_at,
      expires_at: b && b.validity_days ? new Date(deliveredMs + b.validity_days * 86400000).toISOString() : null,
      last_report_at: new Date(deliveredMs + (2 + rng() * 20) * 3600000).toISOString(),
    });
  }

  /* ---- auto-reload opt-ins (explicit customer consent, stored rules) ---- */
  const AR_SEED = [
    // Ama — live rule on her OWN line, cooldown already over, current bundle at
    // 97% → the cron fires the moment you hit /api/cron/autoreload.
    { customer_phone: "0241234567", phone: "0241234567", relation: "self", bundle: "mtn:1024", trigger_percent: 10, momo_number: "0245678901", active: true, reload_count: 3, last_reload_at: at(2, 40), cooldown_hours_from_now: -2 },
    // Kofi — live rule but inside cooldown → the cron skips it. The line is
    // his shop's line (NOT his own number) → relation "other" (gift rule).
    { customer_phone: "0209876543", phone: "0201122334", relation: "other", bundle: "telecel:10240", trigger_percent: 20, momo_number: "0505566778", active: true, reload_count: 1, last_reload_at: at(6, 30), cooldown_hours_from_now: 6 },
    // Yaw — paused rule (opted out) for a family line → relation "other".
    { customer_phone: "0502345678", phone: "0276655443", relation: "other", bundle: "airteltigo:1024", trigger_percent: 15, momo_number: "0501234321", active: false, reload_count: 2, last_reload_at: at(9, 120), cooldown_hours_from_now: null },
  ];
  const auto_reload = AR_SEED.map((a, i) => ({
    customer_phone: a.customer_phone,
    phone: a.phone,
    relation: a.relation || (a.phone === a.customer_phone ? "self" : "other"),
    network: a.bundle.split(":")[0],
    bundle: a.bundle,
    trigger_percent: a.trigger_percent,
    momo_number: a.momo_number,
    active: a.active,
    reload_count: a.reload_count,
    last_reload_at: a.last_reload_at,
    last_triggered_at: null,
    cooldown_until: a.cooldown_hours_from_now == null ? null : new Date(now.getTime() + a.cooldown_hours_from_now * 3600000).toISOString(),
    created_at: at(14 - i * 3, Math.floor(rng() * 200)),
  }));

  // The CURRENT bundle on each auto-reload line is already near the trigger →
  // the dashboard shows the real "low bundle" state and the ask prompt.
  for (const a of auto_reload) {
    const delivered = orders
      .filter((o) => o.status === "delivered" && o.phone === a.phone)
      .sort((x, y) => x.delivered_at.localeCompare(y.delivered_at));
    if (!delivered.length) continue;
    const newest = delivered[delivered.length - 1];
    const u = bundle_usage.find((u2) => u2.order_reference === newest.reference);
    if (u) {
      u.used_mb = round2(u.size_mb * (a.trigger_percent >= 20 ? 0.86 : 0.97));
      u.last_report_at = at(0, -Math.floor(rng() * 120));
    }
  }

  /* ---- float ledger (chronological, balances chained per network) ---- */
  const entries = [];

  // opening balances ~32 days ago
  entries.push({ network: "mtn", direction: "topup", amount: 3000, note: "Initial float (demo seed)", order_reference: null, created_at: at(32, Math.floor(rng() * 100)) });
  entries.push({ network: "telecel", direction: "topup", amount: 2000, note: "Initial float (demo seed)", order_reference: null, created_at: at(32, 120 + Math.floor(rng() * 100)) });
  entries.push({ network: "airteltigo", direction: "topup", amount: 1500, note: "Initial float (demo seed)", order_reference: null, created_at: at(32, 240 + Math.floor(rng() * 100)) });

  // debits for every delivered order (2 min after delivery)
  for (const o of [...orders].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (o.status !== "delivered") continue;
    entries.push({
      network: o.network,
      direction: "debit",
      amount: o.cost_price,
      note: "Delivery cost",
      order_reference: o.reference,
      created_at: new Date(new Date(o.created_at).getTime() + 2 * 60000).toISOString(),
    });
  }

  // mid-period restock top-ups (interleave chronologically with the debits)
  entries.push({ network: "mtn", direction: "topup", amount: 1000, note: "Restock — MTN float", order_reference: null, created_at: at(21, Math.floor(rng() * 300)) });
  entries.push({ network: "telecel", direction: "topup", amount: 800, note: "Restock — Telecel float", order_reference: null, created_at: at(14, Math.floor(rng() * 300)) });
  entries.push({ network: "airteltigo", direction: "topup", amount: 600, note: "Restock — AirtelTigo float", order_reference: null, created_at: at(9, Math.floor(rng() * 300)) });
  entries.push({ network: "mtn", direction: "topup", amount: 500, note: "Restock — MTN float", order_reference: null, created_at: at(4, Math.floor(rng() * 300)) });

  entries.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const float_ledger = [];
  const balances = { mtn: 0, telecel: 0, airteltigo: 0 };
  for (const e of entries) {
    balances[e.network] = round2(balances[e.network] + (e.direction === "debit" ? -e.amount : e.amount));
    float_ledger.push({
      network: e.network,
      direction: e.direction,
      amount: round2(e.amount),
      balance_after: balances[e.network],
      order_reference: e.order_reference,
      note: e.note,
      created_at: e.created_at,
    });
  }

  /* ---- webhook log (audit trail) ---- */
  const webhook_log = [];
  for (const o of orders) {
    if (!o.provider_reference) continue;
    webhook_log.push({
      signature_valid: true,
      handled: true,
      error: o.status === "refunded" ? "amount mismatch → refunded" : null,
      payload: {
        event: "payment.succeeded",
        provider_reference: o.provider_reference,
        reference: o.reference,
        amount: o.amount,
        currency: "GHS",
      },
      created_at: new Date(new Date(o.created_at).getTime() + (2 + rng() * 4) * 60000).toISOString(),
    });
  }

  // edge-case audit entries: forged callbacks, unknown order, ignored event
  const fakeRef = (daysAgo) => `VD-${yymmdd(at(daysAgo))}-0000`;
  webhook_log.push({
    signature_valid: false, handled: true, error: "invalid signature",
    payload: { event: "payment.succeeded", provider_reference: "VP-TEST-FORGED1", reference: fakeRef(3), amount: 43, currency: "GHS" },
    created_at: at(3, Math.floor(rng() * 300)),
  });
  webhook_log.push({
    signature_valid: false, handled: true, error: "invalid signature",
    payload: { event: "payment.succeeded", provider_reference: "VP-TEST-FORGED2", reference: fakeRef(2), amount: 9, currency: "GHS" },
    created_at: at(2, Math.floor(rng() * 300)),
  });
  webhook_log.push({
    signature_valid: true, handled: true, error: `unknown order ${fakeRef(6)}`,
    payload: { event: "payment.succeeded", provider_reference: `VP-${yymmdd(at(6))}-ZZZZ`, reference: fakeRef(6), amount: 19.9, currency: "GHS" },
    created_at: at(6, Math.floor(rng() * 300)),
  });
  webhook_log.push({
    signature_valid: true, handled: true, error: null,
    payload: { event: "payment.failed", provider_reference: `VP-${yymmdd(at(8))}-FFFF`, reference: fakeRef(8), amount: 39.5, currency: "GHS" },
    created_at: at(8, Math.floor(rng() * 300)),
  });
  webhook_log.sort((a, b) => a.created_at.localeCompare(b.created_at));

  return { customers, saved_numbers, orders, bundle_usage, auto_reload, float_ledger, webhook_log };
}

/* ---------- summary (for the CLI + dev-server banner) ---------- */
function summarize(data) {
  const byStatus = {};
  for (const o of data.orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
  const finalFloat = {};
  for (const f of data.float_ledger) finalFloat[f.network] = f.balance_after;
  return {
    customers: data.customers.length,
    saved_numbers: data.saved_numbers.length,
    orders: data.orders.length,
    by_status: byStatus,
    bundle_usage_rows: (data.bundle_usage || []).length,
    auto_reload_rules: (data.auto_reload || []).length,
    float_ledger_entries: data.float_ledger.length,
    webhook_logs: data.webhook_log.length,
    final_float: finalFloat,
  };
}

module.exports = {
  buildDemo,
  summarize,
  demoPinHash,
  BUNDLES,
  NETWORK_CODES,
  DEMO_CUSTOMERS,
  SAVED_NUMBERS,
};

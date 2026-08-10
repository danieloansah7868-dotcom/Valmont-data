/* ============================================================================
   Data layer — thin wrapper over Supabase (PostgREST) with zero dependencies.
   Server-side only: always uses the SERVICE ROLE key. Never import this in
   browser code.

   SUPABASE_MOCK=1 → in-memory store so the whole app runs without a database
   (used by scripts/dev-server.js and CI).
   ============================================================================ */

const MOCK = process.env.SUPABASE_MOCK === "1";
const { buildDemo } = require("./demo-data");

/* ---------------- real PostgREST ---------------- */
async function rest(path, { method = "GET", body, headers = {} } = {}) {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const err = new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured");
    err.status = 500;
    throw err;
  }
  const res = await fetch(url + path, {
    method,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`db ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

/* ---------------- in-memory mock (SUPABASE_MOCK=1) ---------------- */
const mockState = {
  networks: [
    { id: 1, code: "mtn", name: "MTN", is_active: true },
    { id: 2, code: "telecel", name: "Telecel", is_active: true },
    { id: 3, code: "airteltigo", name: "AirtelTigo", is_active: true },
  ],
  bundles: [],
  customers: [],
  saved_numbers: [],
  orders: [],
  float_ledger: [],
  webhook_log: [],
  _seq: { bundles: 0, customers: 0, saved_numbers: 0, orders: 0, float_ledger: 0, webhook_log: 0 },
};

// Seed bundles mirroring supabase/schema.sql
(function seedBundles() {
  const rows = [
    // network, size_mb, validity_days, cost, sell, sort
    ["mtn", 1024, null, 3.9, 4.2, 1], ["mtn", 2048, null, 8.1, 9.0, 2],
    ["mtn", 3072, null, 11.9, 13.5, 3], ["mtn", 5120, null, 18.9, 20.5, 4],
    ["mtn", 10240, null, 38.5, 43.0, 5], ["mtn", 20480, null, 73.0, 82.0, 6],
    ["mtn", 30720, null, 111.0, 125.0, 7], ["mtn", 51200, null, 185.0, 201.0, 8],
    ["mtn", 102400, null, 377.0, 407.0, 9],
    ["telecel", 10240, 60, 35.5, 39.5, 1], ["telecel", 20480, 60, 67.8, 75.0, 2],
    ["telecel", 30720, 60, 98.7, 110.0, 3], ["telecel", 51200, 60, 162.5, 180.0, 4],
    ["telecel", 102400, 60, 367.0, 405.0, 5],
    ["airteltigo", 1024, 60, 3.65, 4.0, 1], ["airteltigo", 5120, 60, 18.0, 19.9, 2],
    ["airteltigo", 10240, 60, 35.5, 39.0, 3], ["airteltigo", 30720, 60, 106.0, 117.0, 4],
    ["airteltigo", 51200, 60, 175.0, 193.0, 5],
  ];
  for (const [code, size_mb, validity_days, cost_price, sell_price, sort_order] of rows) {
    const net = mockState.networks.find((n) => n.code === code);
    mockState._seq.bundles += 1;
    mockState.bundles.push({
      id: mockState._seq.bundles, network_id: net.id, size_mb, validity_days,
      cost_price, sell_price, is_active: true, sort_order,
    });
  }
})();

function parseFilter(key, value) {
  // PostgREST-style: id=eq.5 | provider_reference=is.null | status=in.(failed,delivering)
  const m = /^(.*?)=(.*)$/.exec(key);
  const col = m ? m[1] : key;
  const raw = m ? m[2] : value;
  const [op, val] = raw.split(".");
  if (op === "eq") return (row) => String(row[col]) === String(val);
  if (op === "is") return (row) => (val === "null" ? row[col] == null : row[col] != null);
  if (op === "in") {
    const list = val.slice(1, -1).split(",");
    return (row) => list.includes(String(row[col]));
  }
  if (op === "neq") return (row) => String(row[col]) !== String(val);
  return () => true;
}

function mockSelect({ from, where = {}, order, limit }) {
  let rows = [...(mockState[from] || [])];
  for (const [k, v] of Object.entries(where)) rows = rows.filter(parseFilter(k, v));
  if (order) {
    const [col, dir] = order.split(".");
    rows.sort((a, b) => {
      const av = a[col];
      const bv = b[col];
      const an = Number(av);
      const bn = Number(bv);
      // numeric columns sort numerically (ids, balances…); anything else lexicographically
      let cmp;
      if (av != null && bv != null && av !== "" && bv !== "" && !Number.isNaN(an) && !Number.isNaN(bn)) cmp = an - bn;
      else cmp = String(av || "").localeCompare(String(bv || ""));
      return dir === "desc" ? -cmp : cmp;
    });
  }
  if (limit) rows = rows.slice(0, limit);
  return rows.map((r) => ({ ...r }));
}

function mockInsert(from, row) {
  if (from === "customers") {
    if (row.phone && mockState.customers.some((c) => c.phone === row.phone)) {
      const err = new Error("duplicate key value violates unique constraint on phone");
      err.status = 409;
      throw err;
    }
    if (row.email && mockState.customers.some((c) => c.email && c.email.toLowerCase() === row.email.toLowerCase())) {
      const err = new Error("duplicate key value violates unique constraint on email");
      err.status = 409;
      throw err;
    }
  }
  if (from === "saved_numbers") {
    if (mockState.saved_numbers.some((s) => s.customer_id === row.customer_id && s.kind === row.kind && s.phone === row.phone)) {
      const err = new Error("duplicate key value violates unique constraint on saved_numbers");
      err.status = 409;
      throw err;
    }
  }
  for (const uniq of ["reference", "provider_reference"]) {
    if (row[uniq] != null && (mockState[from] || []).some((r) => r[uniq] === row[uniq])) {
      const err = new Error(`duplicate key value violates unique constraint on ${uniq}`);
      err.status = 409;
      throw err;
    }
  }
  mockState._seq[from] = (mockState._seq[from] || 0) + 1;
  const created = {
    ...row,
    id: mockState._seq[from],
    created_at: row.created_at || new Date().toISOString(),
  };
  mockState[from] = mockState[from] || [];
  mockState[from].push(created);
  return [{ ...created }];
}

function mockUpdate(from, fields, where) {
  let matched = [];
  mockState[from] = (mockState[from] || []).map((r) => {
    const hit = Object.entries(where).every(([k, v]) => parseFilter(k, v)(r));
    if (!hit) return r;
    matched.push({ ...r, ...fields });
    return { ...r, ...fields };
  });
  return matched;
}

function mockDelete(from, where) {
  let deleted = [];
  mockState[from] = (mockState[from] || []).filter((r) => {
    const hit = Object.entries(where).every(([k, v]) => parseFilter(k, v)(r));
    if (hit) deleted.push({ ...r });
    return !hit;
  });
  return deleted;
}

function mockRpc(name, args = {}) {
  if (name === "current_float") {
    const rows = mockState.float_ledger.filter((f) => f.network_id === Number(args.p_network_id));
    return rows.length ? rows[rows.length - 1].balance_after : 0;
  }
  if (name === "add_float_entry") {
    const net = Number(args.p_network_id);
    const last = mockState.float_ledger.filter((f) => f.network_id === net);
    const bal = (last.length ? last[last.length - 1].balance_after : 0)
      + (args.p_direction === "debit" ? -Math.abs(Number(args.p_amount)) : Math.abs(Number(args.p_amount)));
    mockState._seq.float_ledger += 1;
    mockState.float_ledger.push({
      id: mockState._seq.float_ledger,
      network_id: net,
      direction: args.p_direction,
      amount: Number(args.p_amount),
      balance_after: bal,
      order_id: args.p_order_id || null,
      note: args.p_note || null,
      created_at: new Date().toISOString(),
    });
    return bal;
  }
  if (name === "daily_pnl") {
    const days = Number(args.p_days || 30);
    const cutoff = Date.now() - days * 86400000;
    const out = {};
    for (const o of mockState.orders) {
      if (!["paid", "delivering", "delivered"].includes(o.status)) continue;
      if (new Date(o.created_at).getTime() < cutoff) continue;
      const net = mockState.networks.find((n) => n.id === o.network_id);
      const day = o.created_at.slice(0, 10);
      const k = day + "|" + net.code;
      out[k] = out[k] || { day, network: net.code, orders: 0, revenue: 0, cost: 0, margin: 0 };
      out[k].orders += 1;
      out[k].revenue += Number(o.amount);
      out[k].cost += Number(o.cost_price);
      out[k].margin += Number(o.amount) - Number(o.cost_price);
    }
    return Object.values(out).sort((a, b) => b.day.localeCompare(a.day));
  }
  throw new Error("unknown rpc: " + name);
}

/* ---------------- demo seed (SEED_DEMO=1) ----------------
   Populates the in-memory store with realistic demo data (customers, saved
   numbers, orders, float ledger, webhook log). Mock-mode only; callers:
   scripts/dev-server.js (SEED_DEMO=1) and scripts/seed-demo.js. */
function seedDemo(now = new Date()) {
  if (!MOCK) {
    const err = new Error("seedDemo() only works with SUPABASE_MOCK=1 (in-memory DB)");
    err.status = 500;
    throw err;
  }
  if (mockState.orders.length) {
    return { skipped: true, reason: "orders already present — demo seed runs once per process" };
  }

  const data = buildDemo({ now });

  const customerIdByPhone = {};
  for (const c of data.customers) {
    mockState._seq.customers += 1;
    const id = mockState._seq.customers;
    customerIdByPhone[c.phone] = id;
    mockState.customers.push({ id, phone: c.phone, email: c.email, name: c.name, pin_hash: c.pin_hash, created_at: c.created_at });
  }

  for (const s of data.saved_numbers) {
    mockState._seq.saved_numbers += 1;
    mockState.saved_numbers.push({
      id: mockState._seq.saved_numbers,
      customer_id: customerIdByPhone[s.customer_phone],
      kind: s.kind,
      phone: s.phone,
      label: s.label,
      created_at: s.created_at,
    });
  }

  const networkIdByCode = {};
  for (const n of mockState.networks) networkIdByCode[n.code] = n.id;
  const bundleIdByKey = {};
  for (const b of mockState.bundles) {
    const net = mockState.networks.find((n) => n.id === b.network_id);
    bundleIdByKey[`${net.code}:${b.size_mb}`] = b.id;
  }

  const orderIdByRef = {};
  for (const o of data.orders) {
    mockState._seq.orders += 1;
    const id = mockState._seq.orders;
    orderIdByRef[o.reference] = id;
    mockState.orders.push({
      id,
      reference: o.reference,
      phone: o.phone,
      bundle_id: bundleIdByKey[`${o.network}:${o.size_mb}`],
      network_id: networkIdByCode[o.network],
      amount: o.amount,
      cost_price: o.cost_price,
      status: o.status,
      provider_reference: o.provider_reference,
      supplier_ref: o.supplier_ref,
      supplier_response: o.supplier_response,
      attempts: o.attempts,
      customer_id: o.customer_phone ? customerIdByPhone[o.customer_phone] : null,
      created_at: o.created_at,
      delivered_at: o.delivered_at,
    });
  }

  for (const f of data.float_ledger) {
    mockState._seq.float_ledger += 1;
    mockState.float_ledger.push({
      id: mockState._seq.float_ledger,
      network_id: networkIdByCode[f.network],
      direction: f.direction,
      amount: f.amount,
      balance_after: f.balance_after,
      order_id: f.order_reference ? orderIdByRef[f.order_reference] : null,
      note: f.note,
      created_at: f.created_at,
    });
  }

  for (const w of data.webhook_log) {
    mockState._seq.webhook_log += 1;
    mockState.webhook_log.push({
      id: mockState._seq.webhook_log,
      signature_valid: w.signature_valid,
      payload: w.payload,
      handled: w.handled,
      error: w.error,
      created_at: w.created_at,
    });
  }

  return {
    skipped: false,
    counts: {
      customers: data.customers.length,
      saved_numbers: data.saved_numbers.length,
      orders: data.orders.length,
      float_ledger: data.float_ledger.length,
      webhook_log: data.webhook_log.length,
    },
  };
}

function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/* ---------------- exported db API ---------------- */
const db = {
  async select(opts) {
    if (MOCK || !isConfigured()) return mockSelect(opts);
    const qs = new URLSearchParams();
    if (opts.select) qs.set("select", opts.select);
    for (const [k, v] of Object.entries(opts.where || {})) qs.append(k, v);
    if (opts.order) qs.set("order", opts.order);
    if (opts.limit) qs.set("limit", String(opts.limit));
    return rest(`/rest/v1/${opts.from}?${qs}`);
  },
  async insert(from, row, { returning = true } = {}) {
    if (MOCK || !isConfigured()) return mockInsert(from, row);
    return rest(`/rest/v1/${from}`, {
      method: "POST",
      body: row,
      headers: { Prefer: returning ? "return=representation" : "return=minimal" },
    });
  },
  async update(from, fields, where) {
    if (MOCK || !isConfigured()) return mockUpdate(from, fields, where);
    const qs = new URLSearchParams(where);
    return rest(`/rest/v1/${from}?${qs}`, {
      method: "PATCH",
      body: fields,
      headers: { Prefer: "return=representation" },
    });
  },
  async delete(from, where) {
    if (MOCK || !isConfigured()) return mockDelete(from, where);
    const qs = new URLSearchParams(where);
    return rest(`/rest/v1/${from}?${qs}`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" },
    });
  },
  async rpc(name, args = {}) {
    if (MOCK || !isConfigured()) return mockRpc(name, args);
    return rest(`/rest/v1/rpc/${name}`, { method: "POST", body: args });
  },
};

module.exports = { db, MOCK, isConfigured, seedDemo };

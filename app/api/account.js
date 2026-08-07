/* ============================================================================
   Customer Account API
     GET    /api/account        → profile, time greeting, saved numbers, recent numbers, order history
     POST   /api/account/saved  → save a data line or MoMo number (max 10 per category)
     DELETE /api/account/saved  → remove a saved number
   ============================================================================ */

const { json, readRawBody, wrap } = require("../lib/http");
const { requireCustomer } = require("../lib/auth");
const { db } = require("../lib/supabase");
const phones = require("../lib/phones");
const orders = require("../lib/orders");

function getTimeGreeting(name, email) {
  const hour = new Date().getUTCHours(); // Ghana is UTC+0
  let greeting = "Good morning";
  if (hour >= 12 && hour < 17) greeting = "Good afternoon";
  else if (hour >= 17) greeting = "Good evening";

  let firstName = "Kofi";
  if (name && name.trim()) {
    firstName = name.trim().split(/\s+/)[0];
  } else if (email && email.includes("@")) {
    const part = email.split("@")[0].replace(/[._-]/g, " ");
    firstName = part.charAt(0).toUpperCase() + part.slice(1).split(/\s+/)[0];
  }
  return `${greeting}, ${firstName}`;
}

async function get(req, res) {
  const auth = requireCustomer(req);

  const customerRows = await db.select({ from: "customers", where: { id: `eq.${auth.id}` } });
  const customer = customerRows[0] || auth;

  const savedRows = await db.select({
    from: "saved_numbers",
    where: { customer_id: `eq.${auth.id}` },
    order: "created_at.desc",
  });

  const orderRows = await db.select({
    from: "orders",
    where: { customer_id: `eq.${auth.id}` },
    order: "created_at.desc",
    limit: 10,
  });

  const enrichedOrders = await Promise.all(
    orderRows.map(async (o) => {
      const bundle = await orders.findBundleById(o.bundle_id);
      const network = await orders.findNetworkById(o.network_id);
      return {
        id: o.id,
        reference: o.reference,
        phone: o.phone,
        amount: Number(o.amount),
        status: o.status,
        created_at: o.created_at,
        bundle: bundle ? { size_mb: bundle.size_mb, validity_days: bundle.validity_days } : null,
        network: network ? network.code : null,
        network_name: network ? network.name : null,
      };
    })
  );

  // Recent delivery numbers deduped from customer's orders
  const recentMap = new Set();
  const recentNumbers = [];
  for (const o of enrichedOrders) {
    if (o.phone && !recentMap.has(o.phone)) {
      recentMap.add(o.phone);
      recentNumbers.push(o.phone);
    }
  }

  const greeting = getTimeGreeting(customer.name, customer.email);
  const dataLines = savedRows.filter((s) => s.kind === "data");
  const momoNumbers = savedRows.filter((s) => s.kind === "momo");

  return json(res, 200, {
    customer: {
      id: customer.id,
      phone: customer.phone,
      email: customer.email,
      name: customer.name,
      first_name: (customer.name || customer.email || "Kofi").trim().split(/[\s@]+/)[0],
    },
    time_greeting: greeting,
    greeting: greeting,
    saved_numbers: savedRows,
    data_lines: dataLines,
    momo_numbers: momoNumbers,
    recent_numbers: recentNumbers,
    orders: enrichedOrders,
  });
}

async function post(req, res) {
  const auth = requireCustomer(req);

  const body = await readRawBody(req).then((b) => {
    try { return JSON.parse(b); } catch { return null; }
  });
  if (!body) return json(res, 400, { error: "Invalid JSON" });

  const kind = body.kind === "momo" ? "momo" : "data";
  const check = phones.validate(body.phone);
  if (!check.valid) return json(res, 400, { error: check.reason });

  // 10-per-kind cap
  const existing = await db.select({
    from: "saved_numbers",
    where: { customer_id: `eq.${auth.id}`, kind: `eq.${kind}` },
  });
  if (existing.length >= 10) {
    return json(res, 400, { error: `Maximum 10 ${kind === "data" ? "data lines" : "MoMo numbers"} allowed` });
  }

  const label = (body.label || "").trim() || (kind === "data" ? "Saved line" : "MoMo");

  try {
    const inserted = await db.insert("saved_numbers", {
      customer_id: auth.id,
      kind,
      phone: check.normalized,
      label,
    });
    return json(res, 201, { ok: true, saved_number: inserted[0] });
  } catch (e) {
    if (e.status === 409 || e.message?.includes("unique constraint")) {
      return json(res, 409, { error: "This number is already saved in this category" });
    }
    throw e;
  }
}

async function del(req, res) {
  const auth = requireCustomer(req);

  const url = new URL(req.url, "http://local");
  const idQuery = url.searchParams.get("id");
  let id = idQuery ? Number(idQuery) : null;
  let phone = url.searchParams.get("phone");
  let kind = url.searchParams.get("kind");

  if (!id && !phone) {
    const body = await readRawBody(req).then((b) => {
      try { return JSON.parse(b); } catch { return null; }
    });
    if (body?.id) id = Number(body.id);
    if (body?.phone) phone = body.phone;
    if (body?.kind) kind = body.kind;
  }

  if (id) {
    await db.delete("saved_numbers", { id: `eq.${id}`, customer_id: `eq.${auth.id}` });
    return json(res, 200, { ok: true });
  }

  if (phone) {
    const check = phones.validate(phone);
    const normalized = check.valid ? check.normalized : phone;
    const where = { phone: `eq.${normalized}`, customer_id: `eq.${auth.id}` };
    if (kind) where.kind = `eq.${kind}`;
    await db.delete("saved_numbers", where);
    return json(res, 200, { ok: true });
  }

  return json(res, 400, { error: "Number id or phone required for deletion" });
}

module.exports = wrap(async (req, res) => {
  if (req.method === "GET") return get(req, res);
  if (req.method === "POST") return post(req, res);
  if (req.method === "DELETE") return del(req, res);
  return json(res, 405, { error: "Method not allowed" });
});

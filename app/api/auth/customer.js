/* ============================================================================
   Customer Authentication API
     POST /api/auth/customer  (or /api/auth/customer/signup / /login)
     - Signup: { phone, pin, email, password, name } → scrypt hash, auto-saves "My line", returns 30-day HMAC token
     - Login:  { phone, pin, email, password, identifier } → verifies scrypt hash, returns 30-day HMAC token
   ============================================================================ */

const crypto = require("crypto");
const { json, readRawBody, wrap } = require("../../lib/http");
const { sign } = require("../../lib/auth");
const { db } = require("../../lib/supabase");
const phones = require("../../lib/phones");

const CUSTOMER_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(secret), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifySecret(secret, stored) {
  if (!stored || typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  try {
    const key = crypto.scryptSync(String(secret), salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(key, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function extractFirstName(name, email, phone) {
  if (name && name.trim()) return name.trim().split(/\s+/)[0];
  if (email && email.includes("@")) {
    const part = email.split("@")[0].replace(/[._-]/g, " ");
    return part.charAt(0).toUpperCase() + part.slice(1).split(/\s+/)[0];
  }
  return "Kofi";
}

async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });

  const body = await readRawBody(req).then((b) => {
    try { return JSON.parse(b); } catch { return null; }
  });
  if (!body) return json(res, 400, { error: "Invalid JSON" });

  const url = req.url || "";
  const isExplicitSignup = body.action === "signup" || url.includes("/signup");
  const isExplicitLogin = body.action === "login" || url.includes("/login");

  const phoneRaw = body.phone || (body.identifier && /^0\d{9}$/.test(body.identifier.trim()) ? body.identifier.trim() : null);
  const emailRaw = body.email || (body.identifier && body.identifier.includes("@") ? body.identifier.trim() : null);
  const secret = body.pin || body.password || body.pass || "";
  const name = (body.name || "").trim() || null;

  let validatedPhone = null;
  if (phoneRaw) {
    const check = phones.validate(phoneRaw);
    if (check.valid) validatedPhone = check.normalized;
    else if (!emailRaw) return json(res, 400, { error: check.reason });
  }

  const normalizedEmail = emailRaw ? emailRaw.trim().toLowerCase() : null;

  // Determine if this is a login or signup flow
  let isSignup = isExplicitSignup;
  if (!isExplicitSignup && !isExplicitLogin) {
    // If name is provided or we can't find an existing user with this phone/email, treat as signup
    if (name) {
      isSignup = true;
    } else {
      let existing = null;
      if (validatedPhone) {
        const rows = await db.select({ from: "customers", where: { phone: `eq.${validatedPhone}` } });
        if (rows.length) existing = rows[0];
      }
      if (!existing && normalizedEmail) {
        const rows = await db.select({ from: "customers", where: { email: `eq.${normalizedEmail}` } });
        if (rows.length) existing = rows[0];
      }
      isSignup = !existing;
    }
  }

  /* ---------------- SIGNUP ---------------- */
  if (isSignup) {
    if (!validatedPhone && !normalizedEmail) {
      return json(res, 400, { error: "Please provide a valid Ghana phone number or email address" });
    }
    if (!secret || String(secret).length < 4) {
      return json(res, 400, { error: "PIN / Password must be at least 4 characters" });
    }

    // Check for existing customer
    if (validatedPhone) {
      const rows = await db.select({ from: "customers", where: { phone: `eq.${validatedPhone}` } });
      if (rows.length) return json(res, 409, { error: "An account with this phone number already exists" });
    }
    if (normalizedEmail) {
      const rows = await db.select({ from: "customers", where: { email: `eq.${normalizedEmail}` } });
      if (rows.length) return json(res, 409, { error: "An account with this email address already exists" });
    }

    const pin_hash = hashSecret(secret);
    let created;
    try {
      const inserted = await db.insert("customers", {
        phone: validatedPhone,
        email: normalizedEmail,
        name: name,
        pin_hash,
      });
      created = inserted[0];
    } catch (e) {
      if (e.status === 409 || e.message?.includes("unique constraint")) {
        return json(res, 409, { error: "An account already exists with these details" });
      }
      throw e;
    }

    // Auto-create "My line" saved data line if phone is present
    if (validatedPhone && created?.id) {
      await db.insert("saved_numbers", {
        customer_id: created.id,
        kind: "data",
        phone: validatedPhone,
        label: "My line",
      }).catch(() => {});
    }

    const firstName = extractFirstName(created.name, created.email, created.phone);
    const token = sign({
      role: "customer",
      id: created.id,
      phone: created.phone,
      email: created.email,
      name: created.name,
    }, CUSTOMER_TTL);

    return json(res, 200, {
      ok: true,
      token,
      customer: {
        id: created.id,
        phone: created.phone,
        email: created.email,
        name: created.name,
        first_name: firstName,
      },
    });
  }

  /* ---------------- LOGIN ---------------- */
  if (!validatedPhone && !normalizedEmail) {
    return json(res, 400, { error: "Please enter your phone number or email" });
  }
  if (!secret) {
    return json(res, 400, { error: "Please enter your PIN or password" });
  }

  let customer = null;
  if (validatedPhone) {
    const rows = await db.select({ from: "customers", where: { phone: `eq.${validatedPhone}` } });
    if (rows.length) customer = rows[0];
  }
  if (!customer && normalizedEmail) {
    const rows = await db.select({ from: "customers", where: { email: `eq.${normalizedEmail}` } });
    if (rows.length) customer = rows[0];
  }

  if (!customer || !verifySecret(secret, customer.pin_hash)) {
    return json(res, 401, { error: "Invalid phone/email or PIN/password" });
  }

  const firstName = extractFirstName(customer.name, customer.email, customer.phone);
  const token = sign({
    role: "customer",
    id: customer.id,
    phone: customer.phone,
    email: customer.email,
    name: customer.name,
  }, CUSTOMER_TTL);

  return json(res, 200, {
    ok: true,
    token,
    customer: {
      id: customer.id,
      phone: customer.phone,
      email: customer.email,
      name: customer.name,
      first_name: firstName,
    },
  });
}

module.exports = wrap(handler);

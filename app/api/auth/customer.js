/* ============================================================================
   Customer Authentication API
     POST /api/auth/customer  (or /api/auth/customer/signup / /login)
     - Signup: { phone, pin, email, password, name } → scrypt hash, auto-saves "My line", returns 30-day HMAC token
     - Login:  { phone, pin, email, password, identifier } → verifies scrypt hash, returns 30-day HMAC token

   OTP (passwordless — merged here to stay under Vercel Hobby's 12-function cap)
     POST /api/auth/otp/send   { phone } → generates 6-digit code, sends SMS
     POST /api/auth/otp/verify { phone, code } → verifies code, returns token
   ============================================================================ */

const crypto = require("crypto");
const { json, readRawBody, wrap } = require("../../lib/http");
const { sign } = require("../../lib/auth");
const { db } = require("../../lib/supabase");
const phones = require("../../lib/phones");
const sms = require("../../lib/sms");

const CUSTOMER_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const OTP_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_SENDS_PER_HOUR = 5;

// In-memory OTP store (production would use Redis or a DB table)
const otpStore = new Map();

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

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function parseOtpAction(req) {
  const url = new URL(req.url, "http://local");
  const otp = url.searchParams.get("otp") || "";
  const path = url.pathname || "";
  const raw = req.url || "";
  const haystack = `${path} ${raw} ${otp}`.toLowerCase();
  if (haystack.includes("otp/send") || otp === "send") return "send";
  if (haystack.includes("otp/verify") || otp === "verify") return "verify";
  if (haystack.includes("/otp") || otp) return "otp";
  return null;
}

async function handleOtpSend(req, res, body) {
  const phoneRaw = body.phone || "";
  const check = phones.validate(phoneRaw);
  if (!check.valid) return json(res, 400, { error: check.reason });
  const phone = check.normalized;

  // Rate limit
  const key = `otp:${phone}`;
  const existing = otpStore.get(key);
  if (existing && existing.sends >= MAX_SENDS_PER_HOUR) {
    const elapsed = Date.now() - existing.firstSend;
    if (elapsed < RATE_LIMIT_WINDOW) {
      return json(res, 429, { error: "Too many codes sent. Please wait before trying again." });
    }
  }

  // Generate OTP
  const code = generateOTP();
  const record = {
    code,
    phone,
    expires: Date.now() + OTP_TTL,
    attempts: 0,
    sends: (existing?.sends || 0) + 1,
    firstSend: existing?.firstSend || Date.now(),
  };
  otpStore.set(key, record);

  // Clean up old entries (simple GC)
  if (otpStore.size > 10000) {
    const now = Date.now();
    for (const [k, v] of otpStore) {
      if (v.expires < now) otpStore.delete(k);
    }
  }

  // Send SMS
  const result = await sms.sendSMS(phone, `Your Valmont Data code is ${code}. It expires in 5 minutes. Don't share it.`);

  return json(res, 200, {
    ok: true,
    sent: true,
    dev: !!result.dev,
    dev_code: result.dev ? code : undefined, // Only in dev mode
    message: result.dev
      ? `DEV MODE — OTP code: ${code}`
      : `Code sent to ${phone.slice(0, 4)}***${phone.slice(-2)}`,
  });
}

async function handleOtpVerify(req, res, body) {
  const phoneRaw = body.phone || "";
  const code = String(body.code || "").trim();

  const check = phones.validate(phoneRaw);
  if (!check.valid) return json(res, 400, { error: check.reason });
  const phone = check.normalized;

  if (!code || code.length !== 6) {
    return json(res, 400, { error: "Please enter the 6-digit code" });
  }

  const key = `otp:${phone}`;
  const record = otpStore.get(key);

  if (!record) return json(res, 400, { error: "No code sent for this number. Request a new one." });
  if (record.expires < Date.now()) {
    otpStore.delete(key);
    return json(res, 400, { error: "Code expired. Request a new one." });
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    otpStore.delete(key);
    return json(res, 400, { error: "Too many wrong attempts. Request a new code." });
  }

  record.attempts += 1;

  if (record.code !== code) {
    return json(res, 401, { error: "Wrong code. Try again." });
  }

  // Code is valid — clean up
  otpStore.delete(key);

  // Find or create customer
  let customer = null;
  const rows = await db.select({ from: "customers", where: { phone: `eq.${phone}` } });
  if (rows.length) {
    customer = rows[0];
  } else {
    // Auto-create account with a random PIN (they'll use OTP going forward)
    const randomPin = crypto.randomBytes(16).toString("hex");
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(randomPin, salt, 64).toString("hex");
    const pin_hash = `${salt}:${hash}`;

    const inserted = await db.insert("customers", { phone, pin_hash });
    customer = inserted[0];

    // Auto-create "My line"
    if (customer?.id) {
      await db.insert("saved_numbers", {
        customer_id: customer.id,
        kind: "data",
        phone,
        label: "My line",
      }).catch(() => {});
    }
  }

  if (!customer) return json(res, 500, { error: "Could not create or find account" });

  const firstName = customer.name?.split(" ")[0] || phone.slice(-4);
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
    new_account: !rows.length,
  });
}

async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });

  const otpAction = parseOtpAction(req);
  if (otpAction) {
    const body = await readRawBody(req).then((b) => {
      try { return JSON.parse(b); } catch { return null; }
    });
    if (!body) return json(res, 400, { error: "Invalid JSON" });
    if (otpAction === "send") return handleOtpSend(req, res, body);
    if (otpAction === "verify") return handleOtpVerify(req, res, body);
    return json(res, 404, { error: "Use /send or /verify" });
  }

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
  const referralCode = (body.referral_code || body.referral || "").trim() || null;

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

    // Record referral if a referral code was provided
    if (referralCode && created?.id) {
      const referrals = require("../../lib/referrals");
      await referrals.recordReferral(referralCode, created.id).catch(() => {});
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

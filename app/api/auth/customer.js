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
const { sign, assertConfigured } = require("../../lib/auth");
const { db } = require("../../lib/supabase");
const phones = require("../../lib/phones");
const sms = require("../../lib/sms");
const { isDeployment } = require("../../lib/runtime");

const CUSTOMER_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const OTP_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 3;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
const MAX_SENDS_PER_HOUR = 5;

// OTP records live in customer_otps. The database retains only an HMAC, never
// the six-digit code, so a Vercel instance restart cannot invalidate a code or
// expose it through a database read.

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
  // crypto.randomInt avoids predictable Math.random() values for an auth code.
  return String(crypto.randomInt(100000, 1000000));
}

function otpHash(phone, code) {
  // assertConfigured() runs before this route handles a request. Binding the
  // hash to the normalized phone prevents a valid code being moved to another
  // phone record.
  return crypto
    .createHmac("sha256", process.env.AUTH_SECRET)
    .update(`valmont-data:otp:v1:${phone}:${code}`)
    .digest("hex");
}

function sameHash(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function asMs(value) {
  const n = new Date(value || 0).getTime();
  return Number.isFinite(n) ? n : 0;
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

async function findOtp(phone) {
  const rows = await db.select({ from: "customer_otps", where: { phone: `eq.${phone}` }, limit: 1 });
  return rows[0] || null;
}

async function handleOtpSend(req, res, body) {
  const phoneRaw = body.phone || "";
  const check = phones.validate(phoneRaw);
  if (!check.valid) return json(res, 400, { error: check.reason });
  const phone = check.normalized;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const existing = await findOtp(phone);

  // A resend replaces the old hash and gets a fresh five-minute expiry, but the
  // per-phone five-successful-send window survives serverless restarts.
  const withinWindow = existing && asMs(existing.first_sent_at) > now - RATE_LIMIT_WINDOW;
  const previousSends = withinWindow ? Number(existing.send_count || 0) : 0;
  if (previousSends >= MAX_SENDS_PER_HOUR) {
    return json(res, 429, { error: "Too many codes sent. Please wait before trying again." });
  }

  const code = generateOTP();
  const fields = {
    code_hash: otpHash(phone, code),
    expires_at: new Date(now + OTP_TTL).toISOString(),
    attempts: 0,
    send_count: previousSends + 1,
    first_sent_at: withinWindow ? existing.first_sent_at : nowIso,
    consumed_at: null,
    updated_at: nowIso,
  };

  if (existing) {
    await db.update("customer_otps", fields, { id: `eq.${existing.id}` });
  } else {
    await db.insert("customer_otps", { phone, ...fields, created_at: nowIso });
  }

  let result;
  try {
    result = await sms.sendSMS(phone, `Your Valmont Data code is ${code}. It expires in 5 minutes. Don't share it.`);
  } catch (err) {
    result = { sent: false, error: err.message };
  }
  if (!result || !result.sent) {
    // Do not leave an undispatched code usable. Preserve the row for rate-limit
    // accounting and audit, but expire this code immediately.
    const current = await findOtp(phone);
    if (current) {
      await db.update("customer_otps", { expires_at: nowIso, updated_at: nowIso }, { id: `eq.${current.id}` }).catch(() => {});
    }
    return json(res, 503, { error: "We could not send a code right now. Please try again shortly." });
  }

  const dev = Boolean(result.dev) && !isDeployment();
  return json(res, 200, {
    ok: true,
    sent: true,
    dev,
    dev_code: dev ? code : undefined, // only local mock delivery ever exposes this
    message: dev
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

  if (!/^\d{6}$/.test(code)) {
    return json(res, 400, { error: "Please enter the 6-digit code" });
  }

  const record = await findOtp(phone);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  if (!record || record.consumed_at) {
    return json(res, 400, { error: "No active code for this number. Request a new one." });
  }
  if (asMs(record.expires_at) <= now) {
    return json(res, 400, { error: "Code expired. Request a new one." });
  }
  if (Number(record.attempts || 0) >= MAX_ATTEMPTS) {
    return json(res, 400, { error: "Too many wrong attempts. Request a new code." });
  }

  if (!sameHash(record.code_hash, otpHash(phone, code))) {
    const attempts = Number(record.attempts || 0) + 1;
    await db.update(
      "customer_otps",
      { attempts, updated_at: nowIso },
      { id: `eq.${record.id}`, consumed_at: "is.null" }
    );
    if (attempts >= MAX_ATTEMPTS) {
      return json(res, 400, { error: "Too many wrong attempts. Request a new code." });
    }
    return json(res, 401, { error: "Wrong code. Try again." });
  }

  // Conditional consume makes the code single-use even if two verification
  // requests race on different serverless instances.
  const consumed = await db.update(
    "customer_otps",
    { consumed_at: nowIso, updated_at: nowIso },
    { id: `eq.${record.id}`, consumed_at: "is.null" }
  );
  if (!consumed.length) {
    return json(res, 400, { error: "This code has already been used. Request a new one." });
  }

  // Find or create customer
  let customer = null;
  const customerRows = await db.select({ from: "customers", where: { phone: `eq.${phone}` } });
  if (customerRows.length) {
    customer = customerRows[0];
  } else {
    // Auto-create account with a random PIN (they'll use OTP going forward)
    const randomPin = crypto.randomBytes(16).toString("hex");
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(randomPin, salt, 64).toString("hex");
    const pin_hash = `${salt}:${hash}`;

    try {
      const inserted = await db.insert("customers", { phone, pin_hash });
      customer = inserted[0];
    } catch (err) {
      // A concurrent OTP verification can create the customer first. The code
      // itself is still single-use; safely use the account that won that race.
      if (err.status !== 409) throw err;
      const rows = await db.select({ from: "customers", where: { phone: `eq.${phone}` }, limit: 1 });
      customer = rows[0] || null;
    }

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
    new_account: !customerRows.length,
  });
}

async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });

  // Refuse a deployment with a missing/default token secret before creating an
  // account, issuing an OTP or accepting a password.
  assertConfigured();

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

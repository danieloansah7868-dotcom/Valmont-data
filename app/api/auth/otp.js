/* ============================================================================
   OTP Authentication — passwordless sign-in via SMS one-time code.

   Flow:
   1. POST /api/auth/otp/send   { phone } → generates 6-digit code, sends SMS
   2. POST /api/auth/otp/verify { phone, code } → verifies code, returns token

   Security:
   - Codes are 6 digits, expire after 5 minutes
   - Max 3 attempts per code
   - Max 5 sends per phone per hour (rate limit)
   - Codes stored in-memory (dev) or in a lightweight cache (production)
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

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });

  const body = await readRawBody(req).then((b) => {
    try { return JSON.parse(b); } catch { return null; }
  });
  if (!body) return json(res, 400, { error: "Invalid JSON" });

  const url = req.url || "";
  const isSend = url.includes("/send");
  const isVerify = url.includes("/verify");

  if (isSend) return handleSend(req, res, body);
  if (isVerify) return handleVerify(req, res, body);
  return json(res, 404, { error: "Use /send or /verify" });
}

async function handleSend(req, res, body) {
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

async function handleVerify(req, res, body) {
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

module.exports = wrap(handler);

/* Auth — HMAC-signed tokens (server-side only).
   Supports admin tokens (role: "admin", 2h TTL) and customer tokens
   (role: "customer", 30-day TTL).

   Local development may use scripts/dev-server.js's deliberately obvious
   secret. A deployed endpoint refuses to sign or trust tokens unless a real,
   non-default secret is configured. */

const crypto = require("crypto");
const { isDeployment, configurationError, secretIsStrong } = require("./runtime");

const LOCAL_DEFAULT_SECRET = "dev-secret-change-me";

function secret() {
  return process.env.AUTH_SECRET || "";
}

function isConfigured() {
  if (!secret()) return false;
  if (!isDeployment()) return true;
  return secretIsStrong(secret(), { disallow: [LOCAL_DEFAULT_SECRET] });
}

function assertConfigured() {
  if (!isConfigured()) {
    throw configurationError(
      "AUTH_SECRET must be a strong, non-default secret on deployed endpoints"
    );
  }
}

function sign(payload, ttlMs = 2 * 60 * 60 * 1000) {
  assertConfigured();
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !isConfigured()) return null;
  const [body, sig] = parts;
  try {
    const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function extractBearer(req) {
  const header = req.headers?.["authorization"] || req.headers?.["Authorization"] || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

function requireAdmin(req) {
  const token = extractBearer(req);
  const payload = verify(token);
  if (!payload || payload.role !== "admin") {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }
  return payload;
}

function requireCustomer(req) {
  const token = extractBearer(req);
  const payload = verify(token);
  if (!payload || payload.role !== "customer") {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }
  return payload;
}

function getCustomer(req) {
  const token = extractBearer(req);
  const payload = verify(token);
  return payload && payload.role === "customer" ? payload : null;
}

function getAdmin(req) {
  const token = extractBearer(req);
  const payload = verify(token);
  return payload && payload.role === "admin" ? payload : null;
}

module.exports = {
  sign,
  verify,
  requireAdmin,
  requireCustomer,
  getCustomer,
  getAdmin,
  isConfigured,
  assertConfigured,
};

/* Admin auth — HMAC-signed token (server-side only).
   The admin console is a static page; it exchanges ADMIN_PASSWORD for a
   short-lived token, sent as `Authorization: Bearer <token>` on every call. */

const crypto = require("crypto");

function secret() {
  return process.env.AUTH_SECRET || "";
}

function sign(payload, ttlMs = 2 * 60 * 60 * 1000) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !secret()) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Date.now() || payload.role !== "admin") return null;
    return payload;
  } catch {
    return null;
  }
}

function requireAdmin(req) {
  const header = req.headers["authorization"] || req.headers["Authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = verify(token);
  if (!payload) {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }
  return payload;
}

module.exports = { sign, verify, requireAdmin };

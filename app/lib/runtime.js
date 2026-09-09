/* ============================================================================
   Deployment/runtime guards.

   The local dev server deliberately supports an in-memory database, mock
   supplier, mock messages and simulated payments. A Vercel deployment must
   never inherit those conveniences: a missing live dependency is safer as a
   clear 503 than a checkout, delivery, OTP or notification that only appeared
   to work.
   ============================================================================ */

const crypto = require("crypto");

/** Vercel provides these at runtime. Do not use NODE_ENV here: local production
    builds and test runners can legitimately set NODE_ENV=production. */
function isDeployment() {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL);
}

function configurationError(message) {
  const err = new Error(message);
  err.status = 503;
  err.code = "CONFIGURATION_ERROR";
  // http.wrap intentionally keeps 5xx detail private. This marker is useful
  // for callers/tests and for safe operator logs.
  err.expose = false;
  return err;
}

function requireDeploymentConfig(ok, message) {
  if (isDeployment() && !ok) throw configurationError(message);
  return true;
}

function secretIsStrong(value, { minLength = 16, disallow = [] } = {}) {
  const text = String(value || "");
  return text.length >= minLength && !disallow.includes(text);
}

/** Constant-time equality for shared secrets. Empty values are never valid. */
function sameSecret(provided, expected) {
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(String(expected || ""));
  if (!a.length || !b.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function siteOrigin(fallbackHost) {
  const configured = String(process.env.SITE_URL || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  if (isDeployment()) {
    throw configurationError("SITE_URL must be configured on deployed endpoints");
  }
  return fallbackHost ? `http://${fallbackHost}`.replace(/\/$/, "") : "http://localhost:8787";
}

module.exports = {
  isDeployment,
  configurationError,
  requireDeploymentConfig,
  secretIsStrong,
  sameSecret,
  siteOrigin,
};

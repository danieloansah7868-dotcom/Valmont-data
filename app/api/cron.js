/* ============================================================================
   Unified cron function — retry failed deliveries + auto-reload sweep.

   Merged so Vercel Hobby (12-function cap) sees one file instead of two:
     GET/POST /api/cron/retry       → retry failed/stuck deliveries + low-float alert
     GET/POST /api/cron/autoreload  → watch auto-reload rules and re-buy low/expired bundles

   vercel.json rewrites both public paths onto this file. Query fallback:
     /api/cron?job=retry | /api/cron?job=autoreload
   ============================================================================ */

const { json, wrap } = require("../lib/http");
const { db } = require("../lib/supabase");
const orders = require("../lib/orders");
const { notify } = require("../lib/notify");
const autoreload = require("../lib/autoreload");
const { isDeployment, sameSecret, secretIsStrong } = require("../lib/runtime");

async function runRetry() {
  const retried = [];
  const candidates = await db.select({
    from: "orders",
    where: { status: "in.(failed,delivering)" },
    order: "id.asc",
    limit: 25,
  });

  for (const order of candidates) {
    if (Number(order.attempts || 0) >= orders.MAX_ATTEMPTS) continue;
    // stuck "delivering" older than 30 min is treated as failed → retry
    if (order.status === "delivering") {
      const ageMin = (Date.now() - new Date(order.created_at).getTime()) / 60000;
      if (ageMin < 30) continue;
    }
    const result = await orders.retryOrder(order);
    retried.push({ reference: order.reference, ...result });
  }

  // low-float alert
  const low = [];
  const networks = await db.select({ from: "networks", where: { is_active: "eq.true" } });
  const threshold = Number(process.env.LOW_FLOAT_THRESHOLD || "50");
  for (const n of networks) {
    const balance = await orders.currentFloat(n.id);
    if (balance < threshold) {
      low.push({ network: n.code, balance: Number(balance), threshold });
      await notify.lowFloat(n.code, balance, threshold);
    }
  }

  return { retried, low_float: low, ts: new Date().toISOString() };
}

function cronAuthorization(req) {
  const secret = String(process.env.CRON_SECRET || "");
  // Local dev retains a convenient manual cron endpoint only when no secret is
  // configured. Every deployed invocation needs Vercel's Bearer secret.
  if (!isDeployment() && !secret) return { ok: true, local: true };
  if (!secretIsStrong(secret, { minLength: 16, disallow: ["dev-cron-secret", "changeme"] })) {
    return { ok: false, configuration: true };
  }
  const header = String(req.headers?.authorization || req.headers?.Authorization || "");
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return { ok: sameSecret(supplied, secret), configuration: false };
}

async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return json(res, 405, { error: "GET/POST only" });
  const auth = cronAuthorization(req);
  if (!auth.ok) {
    if (auth.configuration) {
      return json(res, 503, { error: "Scheduled jobs are unavailable until CRON_SECRET is securely configured" });
    }
    return json(res, 401, { error: "Missing or invalid cron authorization" });
  }

  const url = new URL(req.url, "http://local");
  const job = (url.searchParams.get("job") || "").toLowerCase();
  const haystack = `${url.pathname} ${req.url || ""} ${job}`.toLowerCase();

  const isRetry = haystack.includes("retry") || job === "retry";
  const isAutoreload = haystack.includes("autoreload") || job === "autoreload";

  if (isAutoreload && !isRetry) {
    const result = await autoreload.runCron();
    return json(res, 200, result);
  }

  if (isRetry && !isAutoreload) {
    return json(res, 200, await runRetry());
  }

  // Bare /api/cron (or both flags) — run both jobs so a single ping still works.
  const retry = await runRetry();
  const sweep = await autoreload.runCron();
  return json(res, 200, { retry, autoreload: sweep, ts: new Date().toISOString() });
}

module.exports = wrap(handler);
module.exports.cronAuthorization = cronAuthorization;

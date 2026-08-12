/* ============================================================================
   Auto-reload cron: GET/POST /api/cron/autoreload

   Watches every active auto-reload rule: when the line's current bundle is
   below the user's chosen threshold (or expired), it re-buys the bundle from
   the pre-authorized MoMo and delivers it. Cooldown + in-flight guards in
   lib/autoreload.js make double-fires impossible.

   Scheduled by a DAILY Vercel cron (vercel.json — Hobby allows one run per
   day; upgrade to Pro or add a GitHub Actions pinger for a 15-min cadence).

   Also callable manually to force a sweep in dev/demo:
     curl http://localhost:8787/api/cron/autoreload
   ============================================================================ */

const { json, wrap } = require("../../lib/http");
const autoreload = require("../../lib/autoreload");

async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return json(res, 405, { error: "GET/POST only" });
  const result = await autoreload.runCron();
  return json(res, 200, result);
}

module.exports = wrap(handler);

/* ============================================================================
   Local dev server — serves the static storefront AND mounts every API
   function exactly like Vercel would. Zero dependencies, no build step.

     SUPABASE_MOCK=1 node scripts/dev-server.js    (default, in-memory DB)
     PORT=8787                                     (default)
   ============================================================================ */

// dev defaults (safe for local only)
process.env.SUPABASE_MOCK = process.env.SUPABASE_MOCK || "1";
process.env.AUTH_SECRET = process.env.AUTH_SECRET || "dev-secret-change-me";
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
process.env.VALMONTPAY_WEBHOOK_SECRET = process.env.VALMONTPAY_WEBHOOK_SECRET || "dev-webhook-secret";
process.env.SITE_URL = process.env.SITE_URL || "http://localhost:8787";
process.env.LOW_FLOAT_THRESHOLD = process.env.LOW_FLOAT_THRESHOLD || "50";
process.env.USAGE_REPORT_KEY = process.env.USAGE_REPORT_KEY || "dev-usage-key";
process.env.AUTORELOAD_COOLDOWN_MINUTES = process.env.AUTORELOAD_COOLDOWN_MINUTES || "720";
// Local dev = simulated payments (VALMONTPAY_MODE=dev) + simulated auto-reload
// webhooks (AUTORELOAD_SIMULATE=1). Production deployments set
// VALMONTPAY_MODE=live and leave AUTORELOAD_SIMULATE unset — no simulation.
process.env.VALMONTPAY_MODE = process.env.VALMONTPAY_MODE || "dev";
process.env.AUTORELOAD_SIMULATE = process.env.AUTORELOAD_SIMULATE || "1";
process.env.WHATSAPP_MODE = process.env.WHATSAPP_MODE || "mock";
process.env.SMS_PROVIDER = process.env.SMS_PROVIDER || "mock";
process.env.REFERRAL_CREDIT_AMOUNT = process.env.REFERRAL_CREDIT_AMOUNT || "2.00";

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || "8787");
const ROOT = path.join(__dirname, "..");

/* Optional demo data: SEED_DEMO=1 → realistic customers/orders/float/webhook
   log in the in-memory DB (see lib/demo-data.js). Off by default so the
   test suite (scripts/test.sh) starts from a clean slate. */
let demoSeed = null;
if (process.env.SEED_DEMO === "1") {
  demoSeed = require("../lib/supabase").seedDemo();
}

const adminRouter = require("../api/admin.js");
const accountRouter = require("../api/account.js");
const authRouter = require("../api/auth/customer.js");
const cronRouter = require("../api/cron.js");

/* route → handler module (mirrors Vercel's consolidated /api folder).
   Public URLs stay the same; OTP/referrals/store/cron are merged into
   fewer files so Vercel Hobby stays under the 12-function cap. */
const routes = {
  "GET /api/bundles": require("../api/bundles.js"),
  "GET /api/orders": require("../api/orders.js"),
  "POST /api/orders": require("../api/orders.js"),
  "POST /api/auth/customer": authRouter,
  "POST /api/auth/customer/signup": authRouter,
  "POST /api/auth/customer/login": authRouter,
  "POST /api/auth/otp/send": authRouter,
  "POST /api/auth/otp/verify": authRouter,
  "GET /api/account": accountRouter,
  "POST /api/account": accountRouter,
  "DELETE /api/account": accountRouter,
  "POST /api/account/saved": accountRouter,
  "DELETE /api/account/saved": accountRouter,
  "POST /api/account/optin": accountRouter,
  "GET /api/account/history": accountRouter,
  "POST /api/valmontpay/webhook": require("../api/valmontpay/webhook.js"),
  "GET /api/whatsapp/webhook": require("../api/whatsapp/webhook.js"),
  "POST /api/whatsapp/webhook": require("../api/whatsapp/webhook.js"),
  "GET /api/referrals": accountRouter,
  "POST /api/referrals/claim": accountRouter,
  "GET /api/referrals/credits": accountRouter,
  "GET /api/referrals/verify": accountRouter,
  "GET /api/store": accountRouter,
  "POST /api/store": accountRouter,
  "GET /api/store/check": accountRouter,
  "GET /api/store/earnings": accountRouter,
  "GET /api/store/orders": accountRouter,
  "GET /api/store/public": accountRouter,
  "POST /api/admin/login": adminRouter,
  "GET /api/admin/float": adminRouter,
  "POST /api/admin/float/topup": adminRouter,
  "POST /api/admin/float/seed": adminRouter,
  "GET /api/admin/orders": adminRouter,
  "POST /api/admin/orders/retry": adminRouter,
  "GET /api/admin/pl": adminRouter,
  "GET /api/admin/webhooks": adminRouter,
  "GET /api/admin/overview": adminRouter,
  "GET /api/admin/sms-leads": adminRouter,
  "GET /api/admin/remadata-prices": adminRouter,
  "GET /api/admin/wallet-balance": adminRouter,
  "GET /api/admin/bundles": adminRouter,
  "POST /api/admin/bundles": adminRouter,
  "POST /api/admin/bundles/update-prices": adminRouter,
  "GET /api/cron": cronRouter,
  "POST /api/cron": cronRouter,
  "GET /api/cron/retry": cronRouter,
  "POST /api/cron/retry": cronRouter,
  "GET /api/cron/autoreload": cronRouter,
  "POST /api/cron/autoreload": cronRouter,
  "GET /api/autoreload": require("../api/autoreload.js"),
  "POST /api/autoreload": require("../api/autoreload.js"),
  "DELETE /api/autoreload": require("../api/autoreload.js"),
  "GET /api/usage": require("../api/usage.js"),
  "POST /api/usage": require("../api/usage.js"),
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:" + PORT);
  const key = `${req.method} ${url.pathname}`;

  // 1) API routes
  if (url.pathname.startsWith("/api/")) {
    const route = routes[key] || (url.pathname.startsWith("/api/admin") ? adminRouter : (req.method === "GET" && routes["GET " + url.pathname]));
    if (route) {
      const body = await new Promise((resolve) => {
        let d = "";
        req.on("data", (c) => (d += c));
        req.on("end", () => resolve(d));
      });
      req.rawBody = body;
      return route(req, res);
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "Not found" }));
  }

  // 2) Static files — resolution mirrors what Vercel does in production, so a
  //    URL that works locally works when deployed:
  //      /bundles/            → /bundles/index.html      (directory index)
  //      /bundles/mtn         → /bundles/mtn.html        (extension-less)
  //      /bundles/mtn.html    → itself
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    res.statusCode = 400;
    return res.end("Bad request");
  }
  const candidates = [];
  if (decoded === "/" || decoded.endsWith("/")) {
    candidates.push(decoded + "index.html");
  } else {
    candidates.push(decoded);
    if (!path.extname(decoded)) {
      candidates.push(decoded + ".html");
      candidates.push(decoded + "/index.html");
    }
  }

  const tryNext = (i) => {
    if (i >= candidates.length) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/html");
      return res.end("<h1>404</h1>");
    }
    const full = path.join(ROOT, candidates[i]);
    if (!full.startsWith(ROOT)) {
      res.statusCode = 403;
      return res.end("Forbidden");
    }
    fs.readFile(full, (err, data) => {
      if (err) return tryNext(i + 1);
      res.statusCode = 200;
      res.setHeader("Content-Type", MIME[path.extname(full)] || "application/octet-stream");
      res.end(data);
    });
  };
  tryNext(0);
});

server.listen(PORT, () => {
  console.log(`\n  Valmont Data dev server → http://localhost:${PORT}`);
  console.log(`  Storefront : http://localhost:${PORT}/`);
  console.log(`  Status     : http://localhost:${PORT}/status.html`);
  console.log(`  Admin      : http://localhost:${PORT}/admin.html  (password: ${process.env.ADMIN_PASSWORD})`);
  console.log(`  Auto-reload: http://localhost:${PORT}/autoreload.html  (opt-in — usage tracking)`);
  console.log(`  Mock DB    : ${process.env.SUPABASE_MOCK === "1" ? "in-memory (SUPABASE_MOCK=1)" : "Supabase"}`);
  console.log(`  Payments   : ${process.env.VALMONTPAY_MODE === "live" ? "LIVE — Valmont-Pay" : "dev — simulated (set VALMONTPAY_MODE=live + keys to go live)"}`);
  console.log(`  Sim payment: node scripts/sim-webhook.js --ref <reference>`);
  console.log(`  Sim usage  : node scripts/sim-usage.js --ref <reference> --used-mb <n>`);
  console.log(`  Auto sweep  : curl http://localhost:${PORT}/api/cron/autoreload`);
  if (demoSeed && demoSeed.skipped) console.log(`  Demo seed  : present (skipped — orders already loaded)`);
  else if (demoSeed) console.log(`  Demo seed  : ${demoSeed.counts.orders} orders, ${demoSeed.counts.customers} customers, ${demoSeed.counts.float_ledger} float entries (SEED_DEMO=1)`);
  console.log("");
});

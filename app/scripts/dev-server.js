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

/* route → handler module (mirrors Vercel's /api folder) */
const routes = {
  "GET /api/bundles": require("../api/bundles.js"),
  "GET /api/orders": require("../api/orders.js"),
  "POST /api/orders": require("../api/orders.js"),
  "POST /api/auth/customer": require("../api/auth/customer.js"),
  "POST /api/auth/customer/signup": require("../api/auth/customer.js"),
  "POST /api/auth/customer/login": require("../api/auth/customer.js"),
  "GET /api/account": require("../api/account.js"),
  "POST /api/account": require("../api/account.js"),
  "DELETE /api/account": require("../api/account.js"),
  "POST /api/account/saved": require("../api/account.js"),
  "DELETE /api/account/saved": require("../api/account.js"),
  "POST /api/valmontpay/webhook": require("../api/valmontpay/webhook.js"),
  "POST /api/admin/login": require("../api/admin/login.js"),
  "GET /api/admin/float": require("../api/admin/float.js"),
  "POST /api/admin/float/topup": require("../api/admin/float.js"),
  "POST /api/admin/float/seed": require("../api/admin/float.js"),
  "GET /api/admin/orders": require("../api/admin/orders.js"),
  "POST /api/admin/orders/retry": require("../api/admin/orders.js"),
  "GET /api/admin/pl": require("../api/admin/pl.js"),
  "GET /api/admin/webhooks": require("../api/admin/webhooks.js"),
  "GET /api/admin/remadata-prices": require("../api/admin/remadata-prices.js"),
  "GET /api/admin/wallet-balance": require("../api/admin/wallet-balance.js"),
  "GET /api/admin/bundles": require("../api/admin/bundles.js"),
  "POST /api/admin/bundles": require("../api/admin/bundles.js"),
  "POST /api/admin/bundles/update-prices": require("../api/admin/bundles.js"),
  "GET /api/cron/retry": require("../api/cron/retry.js"),
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:" + PORT);
  const key = `${req.method} ${url.pathname}`;

  // 1) API routes
  if (url.pathname.startsWith("/api/")) {
    const route = routes[key] || (req.method === "GET" && routes["GET " + url.pathname]);
    if (route) {
      const body = await new Promise((resolve) => {
        let d = "";
        req.on("data", (c) => (d += c));
        req.on("end", () => resolve(d));
      });
      req.rawBody = body;
      // admin float.js checks req.url for /topup — give it the full path
      return route(req, res);
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ error: "Not found" }));
  }

  // 2) Static files
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const full = path.join(ROOT, filePath);
  if (!full.startsWith(ROOT)) {
    res.statusCode = 403;
    return res.end("Forbidden");
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/html");
      return res.end("<h1>404</h1>");
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME[path.extname(full)] || "application/octet-stream");
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Valmont Data dev server → http://localhost:${PORT}`);
  console.log(`  Storefront : http://localhost:${PORT}/`);
  console.log(`  Status     : http://localhost:${PORT}/status.html`);
  console.log(`  Admin      : http://localhost:${PORT}/admin.html  (password: ${process.env.ADMIN_PASSWORD})`);
  console.log(`  Mock DB    : ${process.env.SUPABASE_MOCK === "1" ? "in-memory (SUPABASE_MOCK=1)" : "Supabase"}`);
  console.log(`  Sim payment: node scripts/sim-webhook.js --ref <reference>`);
  if (demoSeed && demoSeed.skipped) console.log(`  Demo seed  : present (skipped — orders already loaded)`);
  else if (demoSeed) console.log(`  Demo seed  : ${demoSeed.counts.orders} orders, ${demoSeed.counts.customers} customers, ${demoSeed.counts.float_ledger} float entries (SEED_DEMO=1)`);
  console.log("");
});

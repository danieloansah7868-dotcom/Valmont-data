#!/usr/bin/env node
/* ============================================================================
   Simulate a Valmont-Pay payment webhook (signed correctly with live contract)
   so you can test the delivery pipeline against local dev or live deployment:

     node scripts/sim-webhook.js --ref VD-260806-4831 --amount 52
     VALMONTPAY_WEBHOOK_SECRET=... node scripts/sim-webhook.js --ref VD-... --amount 52
     node scripts/sim-webhook.js --ref VD-TEST --base https://valmont-data.vercel.app

   Options:
     --ref           order reference (required)
     --amount        amount to send in GHS (defaults to order amount or 52)
     --provider-ref  payment reference (default: auto VP-TEST-...)
     --base          server base (default http://localhost:8787)
     --bad-signature sends an invalid signature (tests the 401 path)
     --wrong-amount  sends amount+10 (tests the refund path)
     --duplicate     sends the same provider-ref again (tests idempotency)
   ============================================================================ */

const crypto = require("crypto");

const args = {};
process.argv.slice(2).forEach((a, i, all) => {
  if (a.startsWith("--")) args[a.slice(2)] = all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true;
});

const secret = process.env.VALMONTPAY_WEBHOOK_SECRET || "dev-webhook-secret";
const base = String(args.base || "http://localhost:8787").replace(/\/$/, "");
const ref = args.ref;
if (!ref) {
  console.error("Usage: node scripts/sim-webhook.js --ref VD-260806-4831 [--amount 52] [--base URL]");
  process.exit(1);
}

(async () => {
  // Fetch the real order amount if not given
  let amount = args.amount;
  if (amount === undefined) {
    try {
      const r = await fetch(`${base}/api/orders?reference=${encodeURIComponent(ref)}`);
      if (r.ok) {
        const d = await r.json();
        if (d.order && d.order.amount !== undefined) {
          amount = d.order.amount;
        }
      }
    } catch {
      // ignore fetch errors, fall back to default
    }
    if (amount === undefined) {
      amount = 52; // default fallback amount
    }
  }

  const finalAmount = args["wrong-amount"] ? Number(amount) + 10 : Number(amount);
  const provider_reference = args["provider-ref"] || `VP-TEST-${Date.now()}`;

  // Live Valmont-Pay charge.success webhook payload shape
  const payload = {
    event: "charge.success",
    data: {
      reference: ref,
      status: "success",
      amount: Number(finalAmount),
      currency: "GHS",
      channel: "mobile_money",
      paid_at: new Date().toISOString(),
      merchant: "valmontdata",
      gateway_reference: provider_reference,
    }
  };

  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac("sha512", secret).update(raw).digest("hex");

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "ValmontPay-Webhook/1.0",
    "x-valmontpay-tenant": "valmontdata",
    "x-valmontpay-event": "charge.success",
    "x-valmontpay-signature": args["bad-signature"] ? "deadbeef" : signature,
  };

  const res = await fetch(`${base}/api/valmontpay/webhook`, {
    method: "POST",
    headers,
    body: raw,
  });

  const data = await res.json().catch(() => ({}));
  console.error(`HTTP ${res.status}`);

  if (res.status === 401) {
    console.error("Signature verification rejected (401). If calling production, verify VALMONTPAY_WEBHOOK_SECRET is set correctly.");
  }

  if (args.duplicate) {
    console.error("--- resending same provider_reference (idempotency test) ---");
    const res2 = await fetch(`${base}/api/valmontpay/webhook`, {
      method: "POST",
      headers,
      body: raw,
    });
    const data2 = await res2.json().catch(() => ({}));
    console.error(`HTTP ${res2.status}`);
    // machine-readable single JSON on stdout for scripts/tests
    console.log(JSON.stringify({ first: data, duplicate: data2 }));
  } else {
    console.log(JSON.stringify(data));
  }
})().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});

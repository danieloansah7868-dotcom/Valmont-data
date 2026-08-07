#!/usr/bin/env node
/* ============================================================================
   Simulate a Valmont-Pay payment webhook (signed correctly) so you can test
   the delivery pipeline without the real gateway:

     node scripts/sim-webhook.js --ref VD-260806-4831 --amount 43
     VALMONTPAY_WEBHOOK_SECRET=... node scripts/sim-webhook.js --ref VD-... --amount 43

   Options:
     --ref           order reference (required)
     --amount        amount to send (defaults to whatever --ref order holds)
     --provider-ref  payment reference (default: auto)
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
  console.error("Usage: node scripts/sim-webhook.js --ref VD-260806-4831 [--amount 43] [--base URL]");
  process.exit(1);
}

(async () => {
  // fetch the real order amount if not given
  let amount = args.amount;
  if (amount === undefined) {
    const r = await fetch(`${base}/api/orders?reference=${ref}`);
    const d = await r.json();
    amount = d.order?.amount;
    if (amount === undefined) {
      console.error("Order not found at", `${base}/api/orders?reference=${ref}`);
      process.exit(1);
    }
  }

  const provider_reference = args["provider-ref"] || `VP-TEST-${Date.now()}`;
  const payload = {
    event: "payment.succeeded",
    provider_reference,
    reference: ref,
    amount: args["wrong-amount"] ? Number(amount) + 10 : Number(amount),
    currency: "GHS",
  };
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac("sha512", secret).update(raw).digest("hex");

  const res = await fetch(`${base}/api/valmontpay/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-valmontpay-signature": args["bad-signature"] ? "deadbeef" : signature,
    },
    body: raw,
  });
  const data = await res.json();
  console.error(`HTTP ${res.status}`);
  if (args.duplicate) {
    console.error("--- resending same provider_reference (idempotency test) ---");
    const res2 = await fetch(`${base}/api/valmontpay/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-valmontpay-signature": signature },
      body: raw,
    });
    const data2 = await res2.json();
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

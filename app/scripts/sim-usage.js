#!/usr/bin/env node
/* ============================================================================
   Simulate usage reports — "the web tracking the bundle" for dev/demo.

     node scripts/sim-usage.js --ref VD-260806-4831 --used-mb 950
     node scripts/sim-usage.js --ref VD-260806-4831 --percent 92
     node scripts/sim-usage.js --phone 0241112222 --used-mb 500

   Requires a running dev server (npm run dev). Sends the report to
   POST /api/usage with the shared usage key (USAGE_REPORT_KEY, default in
   dev: "dev-usage-key"). Override with --key, or pass an admin token with
   --admin-token. In production the telco/supplier integration calls the same
   endpoint (see api/usage.js).
   ============================================================================ */

const B = process.env.B || "http://localhost:8787";
const KEY = process.env.USAGE_REPORT_KEY || "dev-usage-key";

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes("--" + name);

function label(sizeMb) {
  return sizeMb >= 1024 ? `${Math.round(sizeMb / 1024)}GB` : `${sizeMb}MB`;
}

async function main() {
  const ref = arg("ref", null);
  const phone = arg("phone", null);
  const key = arg("key", KEY);

  if (!ref && !phone) {
    console.error("Usage: node scripts/sim-usage.js --ref VD-... [--used-mb N | --percent N]   or   --phone 0XXXXXXXXX --used-mb N");
    process.exit(1);
  }

  let usedMb = null;
  if (has("used-mb")) usedMb = Number(arg("used-mb"));
  else if (has("percent")) {
    // percent needs the current size — read it back first (cheap round trip)
    const q = ref ? `reference=${encodeURIComponent(ref)}` : `phone=${encodeURIComponent(phone)}`;
    const cur = await fetch(`${B}/api/usage?${q}`, { headers: { "x-usage-key": key } });
    if (!cur.ok) {
      console.error(`Could not read current usage (HTTP ${cur.status}): ${await cur.text()}`);
      process.exit(1);
    }
    const d = await cur.json();
    usedMb = Math.round((d.usage.size_mb * Number(arg("percent"))) / 100);
    console.log(`→ current bundle is ${label(d.usage.size_mb)} — ${arg("percent")}% of that = ${usedMb}MB used`);
  } else {
    console.error("Provide --used-mb N or --percent N");
    process.exit(1);
  }

  const res = await fetch(`${B}/api/usage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-usage-key": key },
    body: JSON.stringify({ action: "report", reference: ref, phone, used_mb: usedMb }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Report failed (HTTP ${res.status}): ${body.error || res.statusText}`);
    process.exit(1);
  }

  const u = body.usage;
  console.log(`✓ Usage reported for ${u.phone}:`);
  console.log(`  bundle     : ${label(u.size_mb)}  (${u.percent_used}% used, ${u.percent_left}% left)`);
  console.log(`  status     : ${u.status}${u.low ? "  ⚠️  LOW" : ""}${u.should_ask ? "  — no auto-reload rule yet: ask the user to opt in" : ""}`);
  if (u.should_ask) console.log(`  next step  : user opts in at /autoreload.html (or the storefront ask-prompt)`);
  else console.log(`  next step  : run the sweep → curl ${B}/api/cron/autoreload`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

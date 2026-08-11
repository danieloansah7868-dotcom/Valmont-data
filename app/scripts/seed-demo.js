#!/usr/bin/env node
/* ============================================================================
   Valmont Data — demo seed CLI.

     node scripts/seed-demo.js                 seed the in-memory mock DB and print a summary
     node scripts/seed-demo.js --verify        run consistency checks on the dataset
     node scripts/seed-demo.js --sql           write app/supabase/seed-demo.sql (idempotent)
     node scripts/seed-demo.js --sql-out <p>   write the SQL to a custom path
     node scripts/seed-demo.js --as-of <ISO>   anchor timestamps to a fixed date (default: now)
     node scripts/seed-demo.js --count <n>     override the number of orders (default 52)

   The SQL seed is generated from the same dataset as the in-memory seed, so
   the two can never drift apart. It is for DEMO/STAGING Supabase environments
   only — it self-skips when the orders table already has rows.
   ============================================================================ */

process.env.SUPABASE_MOCK = process.env.SUPABASE_MOCK || "1";

const fs = require("fs");
const path = require("path");
const { buildDemo, summarize, BUNDLES, DEMO_CUSTOMERS } = require("../lib/demo-data");

/* ---------- arg parsing ---------- */
const args = {};
process.argv.slice(2).forEach((a, i, all) => {
  if (a.startsWith("--")) args[a.slice(2)] = all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true;
});

const asOf = args["as-of"] ? new Date(args["as-of"]) : new Date();
if (Number.isNaN(asOf.getTime())) {
  console.error(`Invalid --as-of date: ${args["as-of"]}`);
  process.exit(1);
}
const orderCount = args.count ? Math.max(4, Math.min(200, Number(args.count))) : 52;
const data = buildDemo({ now: asOf, orderCount });

/* ---------- verification ---------- */
function verify(data) {
  const problems = [];
  const orderRefs = new Set();
  const providerRefs = new Set();

  for (const o of data.orders) {
    if (orderRefs.has(o.reference)) problems.push(`duplicate order reference ${o.reference}`);
    orderRefs.add(o.reference);
    if (!/^VD-\d{6}-\d{4}$/.test(o.reference)) problems.push(`malformed reference ${o.reference}`);
    if (!/^0\d{9}$/.test(o.phone)) problems.push(`${o.reference}: bad phone ${o.phone}`);

    if (o.status === "pending") {
      if (o.provider_reference) problems.push(`${o.reference}: pending must have no provider_reference`);
      if (o.attempts !== 0) problems.push(`${o.reference}: pending must have 0 attempts`);
    } else {
      if (!o.provider_reference) problems.push(`${o.reference}: ${o.status} must have provider_reference`);
      else {
        if (providerRefs.has(o.provider_reference)) problems.push(`duplicate provider_reference ${o.provider_reference}`);
        providerRefs.add(o.provider_reference);
      }
    }

    if (o.status === "delivered") {
      if (!o.delivered_at) problems.push(`${o.reference}: delivered without delivered_at`);
      if (!o.supplier_ref) problems.push(`${o.reference}: delivered without supplier_ref`);
      if (!o.supplier_response || o.supplier_response.status !== "success") problems.push(`${o.reference}: delivered without success response`);
      if (!(o.attempts >= 1 && o.attempts <= 3)) problems.push(`${o.reference}: bad attempts ${o.attempts}`);
      if (o.delivered_at < o.created_at) problems.push(`${o.reference}: delivered_at before created_at`);
    }
    if (o.status === "failed" && (!o.supplier_response || o.supplier_response.ok !== false)) problems.push(`${o.reference}: failed without error response`);
    if (o.status === "refunded" && (!o.supplier_response || o.supplier_response.refunded !== true)) problems.push(`${o.reference}: refunded without refund response`);
  }

  // float ledger: per-network chronological chain
  const perNet = { mtn: [], telecel: [], airteltigo: [] };
  for (const f of data.float_ledger) perNet[f.network] = perNet[f.network] || [];
  for (const f of data.float_ledger) perNet[f.network].push(f);
  for (const [net, rows] of Object.entries(perNet)) {
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    let bal = 0;
    for (const r of rows) {
      bal = Math.round((bal + (r.direction === "debit" ? -r.amount : r.amount)) * 100) / 100;
      if (bal !== r.balance_after) problems.push(`ledger ${net}: balance_after ${r.balance_after} != chained ${bal} (${r.created_at})`);
      if (bal < 0) problems.push(`ledger ${net}: float went negative (${bal}) at ${r.created_at}`);
    }
  }

  // every delivered order must have exactly one matching debit
  const debits = new Map();
  for (const f of data.float_ledger) {
    if (f.direction !== "debit" || !f.order_reference) continue;
    debits.set(f.order_reference, (debits.get(f.order_reference) || 0) + 1);
  }
  for (const o of data.orders) {
    if (o.status === "delivered" && debits.get(o.reference) !== 1) problems.push(`${o.reference}: delivered but ledger debit missing/dup`);
    if (o.status !== "delivered" && debits.get(o.reference)) problems.push(`${o.reference}: non-delivered order has a ledger debit`);
  }

  // webhook log cross-reference (forged/unknown entries are deliberate edge cases)
  for (const w of data.webhook_log) {
    const ref = w.payload?.reference;
    if (w.payload?.event === "payment.succeeded" && w.signature_valid && !String(w.error || "").startsWith("unknown order")) {
      if (ref && !orderRefs.has(ref)) problems.push(`webhook references unknown order ${ref}`);
    }
    if (!w.signature_valid && w.error !== "invalid signature") problems.push(`webhook: invalid signature but error=${w.error}`);
  }

  // customer phone/email sanity
  for (const c of data.customers) {
    if (!/^0\d{9}$/.test(c.phone)) problems.push(`customer ${c.phone}: bad phone`);
    if (!c.pin_hash.includes(":")) problems.push(`customer ${c.phone}: malformed pin_hash`);
  }

  // bundle usage: one row per delivered order, sane numbers
  const deliveredRefs = new Set(data.orders.filter((o) => o.status === "delivered").map((o) => o.reference));
  for (const u of data.bundle_usage || []) {
    if (!deliveredRefs.has(u.order_reference)) problems.push(`usage row references non-delivered order ${u.order_reference}`);
    if (!/^0\d{9}$/.test(u.phone)) problems.push(`usage row ${u.order_reference}: bad phone ${u.phone}`);
    if (u.used_mb < 0 || u.used_mb > u.size_mb) problems.push(`usage row ${u.order_reference}: used_mb ${u.used_mb} out of range (${u.size_mb})`);
  }

  // auto-reload rules: real customers, real bundles, valid thresholds
  for (const a of data.auto_reload || []) {
    if (!DEMO_CUSTOMERS.some((c) => c.phone === a.customer_phone)) problems.push(`auto_reload ${a.phone}: unknown customer ${a.customer_phone}`);
    if (!/^0\d{9}$/.test(a.phone)) problems.push(`auto_reload: bad phone ${a.phone}`);
    if (!BUNDLES.some((b) => `${b.network}:${b.size_mb}` === a.bundle)) problems.push(`auto_reload ${a.phone}: unknown bundle ${a.bundle}`);
    if (a.trigger_percent < 1 || a.trigger_percent > 50) problems.push(`auto_reload ${a.phone}: bad trigger_percent ${a.trigger_percent}`);
    if (a.momo_number && !/^0\d{9}$/.test(a.momo_number)) problems.push(`auto_reload ${a.phone}: bad momo_number ${a.momo_number}`);
  }

  return problems;
}

if (args.verify) {
  const problems = verify(data);
  const s = summarize(data);
  console.log(`Demo dataset (${asOf.toISOString()}):`);
  console.log(`  customers=${s.customers} saved_numbers=${s.saved_numbers} orders=${s.orders} float_ledger=${s.float_ledger_entries} webhook_log=${s.webhook_logs}`);
  console.log(`  statuses=${JSON.stringify(s.by_status)} final_float=${JSON.stringify(s.final_float)}`);
  if (problems.length) {
    console.error(`\n✗ ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("\n✓ all consistency checks passed");
  process.exit(0);
}

/* ---------- SQL generation ---------- */
const esc = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const money = (n) => Number(n).toFixed(2);
const jsonb = (o) => (o == null ? "NULL" : `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`);
const iso = (s) => `'${s}'`;

function toSql(data, { now }) {
  const L = [];
  const P = (s) => L.push(s);

  P(`-- ============================================================================`);
  P(`-- VALMONT DATA — demo seed (customers, saved numbers, orders, bundle usage,`);
  P(`-- auto-reload opt-ins, float, webhooks)`);
  P(`-- Generated by : node scripts/seed-demo.js --sql   (edit lib/demo-data.js and re-run,`);
  P(`--                never hand-edit this file)`);
  P(`-- Anchored to  : ${now.toISOString()}`);
  P(`-- Environment  : DEMO / STAGING Supabase ONLY — do not run against production.`);
  P(`-- Safe to re-run: skips itself when public.orders already has rows.`);
  P(`-- Demo logins  : PIN ${DEMO_CUSTOMERS[0].pin} → ${DEMO_CUSTOMERS.map((c) => c.phone + " (" + c.name + ")").join(", ")}`);
  P(`-- ============================================================================`);
  P(``);
  P(`do $$`);
  P(`begin`);
  P(`  if exists (select 1 from public.orders) then`);
  P(`    raise notice 'Valmont Data demo seed SKIPPED — orders table is not empty.';`);
  P(`    return;`);
  P(`  end if;`);
  P(``);

  // customers
  P(`  -- demo customer accounts (scrypt pin_hash; PINs listed in the header)`);
  P(`  insert into public.customers (phone, email, name, pin_hash, created_at) values`);
  data.customers.forEach((c, i) => {
    P(`    (${esc(c.phone)}, ${esc(c.email)}, ${esc(c.name)}, ${esc(c.pin_hash)}, ${iso(c.created_at)})${i < data.customers.length - 1 ? "," : ""}`);
  });
  P(`  on conflict (phone) do nothing;`);
  P(``);

  // saved numbers
  P(`  -- saved data lines + MoMo numbers`);
  for (const s of data.saved_numbers) {
    P(`  insert into public.saved_numbers (customer_id, kind, phone, label, created_at)`);
    P(`  select id, ${esc(s.kind)}, ${esc(s.phone)}, ${esc(s.label)}, ${iso(s.created_at)} from public.customers where phone = ${esc(s.customer_phone)}`);
    P(`  on conflict (customer_id, kind, phone) do nothing;`);
  }
  P(``);

  // orders
  P(`  -- orders (bundle/network/customer ids resolved from the base seed)`);
  for (const o of data.orders) {
    P(`  insert into public.orders (reference, phone, bundle_id, network_id, amount, cost_price, status, provider_reference, supplier_ref, supplier_response, attempts, customer_id, created_at, delivered_at)`);
    P(`  select ${esc(o.reference)}, ${esc(o.phone)},`);
    P(`         (select b.id from public.bundles b join public.networks n on n.id = b.network_id where n.code = ${esc(o.network)} and b.size_mb = ${o.size_mb}),`);
    P(`         (select id from public.networks where code = ${esc(o.network)}),`);
    P(`         ${money(o.amount)}, ${money(o.cost_price)}, ${esc(o.status)},`);
    P(`         ${esc(o.provider_reference)}, ${esc(o.supplier_ref)},`);
    P(`         ${jsonb(o.supplier_response)},`);
    P(`         ${o.attempts},`);
    P(`         ${o.customer_phone ? `(select id from public.customers where phone = ${esc(o.customer_phone)})` : "NULL"},`);
    P(`         ${iso(o.created_at)}, ${o.delivered_at ? iso(o.delivered_at) : "NULL"};`);
  }
  P(``);

  // bundle usage
  P(`  -- bundle usage (one row per delivered order — powers usage tracking)`);
  for (const u of data.bundle_usage || []) {
    P(`  insert into public.bundle_usage (order_id, phone, network_id, size_mb, used_mb, status, started_at, expires_at, last_report_at)`);
    P(`  select (select id from public.orders where reference = ${esc(u.order_reference)}), ${esc(u.phone)},`);
    P(`         (select id from public.networks where code = ${esc(u.network)}),`);
    P(`         ${u.size_mb}, ${money(u.used_mb)}, ${esc(u.status)},`);
    P(`         ${iso(u.started_at)}, ${u.expires_at ? iso(u.expires_at) : "NULL"}, ${iso(u.last_report_at)};`);
  }
  P(``);

  // auto-reload opt-ins
  P(`  -- auto-reload opt-ins (explicit customer consent)`);
  for (const a of data.auto_reload || []) {
    P(`  insert into public.auto_reload (customer_id, phone, network_id, bundle_id, trigger_percent, momo_number, active, reload_count, last_reload_at, last_triggered_at, cooldown_until, created_at, updated_at)`);
    P(`  select (select id from public.customers where phone = ${esc(a.customer_phone)}), ${esc(a.phone)},`);
    P(`         (select id from public.networks where code = ${esc(a.network)}),`);
    P(`         (select b.id from public.bundles b join public.networks n on n.id = b.network_id where n.code = ${esc(a.network)} and b.size_mb = ${a.bundle.split(":")[1]}),`);
    P(`         ${a.trigger_percent}, ${esc(a.momo_number)}, ${a.active}, ${a.reload_count},`);
    P(`         ${a.last_reload_at ? iso(a.last_reload_at) : "NULL"}, ${a.last_triggered_at ? iso(a.last_triggered_at) : "NULL"},`);
    P(`         ${a.cooldown_until ? iso(a.cooldown_until) : "NULL"}, ${iso(a.created_at)}, ${iso(a.created_at)};`);
  }
  P(``);

  // float ledger
  P(`  -- float ledger (chronological; balance_after chained per network)`);
  for (const f of data.float_ledger) {
    P(`  insert into public.float_ledger (network_id, direction, amount, balance_after, order_id, note, created_at)`);
    P(`  select (select id from public.networks where code = ${esc(f.network)}), ${esc(f.direction)}, ${money(f.amount)}, ${money(f.balance_after)},`);
    P(`         ${f.order_reference ? `(select id from public.orders where reference = ${esc(f.order_reference)})` : "NULL"},`);
    P(`         ${esc(f.note)}, ${iso(f.created_at)};`);
  }
  P(``);

  // webhook log
  P(`  -- audit log (forged callbacks & unknown-order entries included on purpose)`);
  for (const w of data.webhook_log) {
    P(`  insert into public.webhook_log (signature_valid, payload, handled, error, created_at)`);
    P(`  values (${w.signature_valid}, ${jsonb(w.payload)}, ${w.handled}, ${esc(w.error)}, ${iso(w.created_at)});`);
  }
  P(``);

  const s = summarize(data);
  P(`  raise notice 'Valmont Data demo seed complete: % customers, % saved numbers, % orders, % usage rows, % auto-reload rules, % float entries, % webhook logs (final float: MTN %, Telecel %, AirtelTigo %).',`);
  P(`    ${s.customers}, ${s.saved_numbers}, ${s.orders}, ${s.bundle_usage_rows}, ${s.auto_reload_rules}, ${s.float_ledger_entries}, ${s.webhook_logs},`);
  P(`    ${money(s.final_float.mtn)}, ${money(s.final_float.telecel)}, ${money(s.final_float.airteltigo)};`);
  P(`end $$;`);
  P(``);
  return L.join("\n");
}

/* ---------- main ---------- */
if (args.sql || args["sql-out"]) {
  const outPath = path.resolve(process.cwd(), args["sql-out"] || path.join(__dirname, "..", "supabase", "seed-demo.sql"));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, toSql(data, { now: asOf }));
  console.log(`Wrote ${outPath}`);
  console.log(`  (${data.orders.length} orders, ${(data.bundle_usage || []).length} usage rows, ${(data.auto_reload || []).length} auto-reload rules, ${data.float_ledger.length} float entries, ${data.webhook_log.length} webhook logs — anchored to ${asOf.toISOString()})`);
} else {
  const { seedDemo } = require("../lib/supabase");
  const result = seedDemo(asOf);
  const s = summarize(data);
  console.log(result.skipped ? `Skipped: ${result.reason}` : `Seeded in-memory mock DB (${asOf.toISOString()})`);
  console.log(`  customers=${s.customers} saved_numbers=${s.saved_numbers} orders=${s.orders} usage_rows=${s.bundle_usage_rows} auto_reload_rules=${s.auto_reload_rules} float_ledger=${s.float_ledger_entries} webhook_log=${s.webhook_logs}`);
  console.log(`  statuses=${JSON.stringify(s.by_status)}`);
  console.log(`  final float=${JSON.stringify(s.final_float)}`);
  console.log(`\nDemo logins (PIN = ${DEMO_CUSTOMERS[0].pin} for the first two):`);
  for (const c of DEMO_CUSTOMERS) console.log(`  ${c.phone.padEnd(10)} ${c.name.padEnd(13)} PIN ${c.pin}`);
  console.log(`\nRun the server with the seed: SEED_DEMO=1 npm run dev`);
}

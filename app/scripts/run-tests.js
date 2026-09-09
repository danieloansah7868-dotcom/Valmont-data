#!/usr/bin/env node
/* run-tests.js — run every suite and report them all, even when one fails.
 *
 * `npm test` used to be `bash scripts/test.sh && node … && node …`, which meant
 * the API pipeline's pre-existing float-state failures (see README → Tested)
 * short-circuited the chain and the supplier, assistant and SEO suites never ran
 * at all. Nobody notices a broken suite that never executes.
 *
 * So: run every suite, print a summary, exit non-zero if anything regressed.
 *
 * scripts/test.sh has 158 checks and, on a fresh unseeded `npm run dev`
 * server, currently finishes 158 passed / 0 failed. Keep that hard floor here
 * so a deleted/failed API assertion cannot be hidden by the aggregate runner.
 * This runner also requires the API suite itself to exit successfully.
 *
 * Output is captured rather than inherited so the pass count can be read without
 * running the API suite twice — a second run would hit a database already dirtied
 * by the first and report different numbers.
 *
 * Zero dependencies, like everything else here.
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const API_BASELINE_PASSED = 158;   // current scripts/test.sh count, fresh unseeded server on :8787

const suites = [
  { name: "api pipeline", cmd: "bash", args: ["scripts/test.sh"], baseline: API_BASELINE_PASSED },
  { name: "supplier router", cmd: "node", args: ["scripts/test-supplier-router.js"] },
  { name: "valmontai", cmd: "node", args: ["scripts/test-valmontai.js"] },
  { name: "seo", cmd: "node", args: ["scripts/test-seo.js"] },
  // Boots its own clean server on :8799, so it needs no SEED_DEMO state — but it
  // does need that port free (REVIEWS_TEST_PORT to move it).
  { name: "reviews", cmd: "node", args: ["scripts/test-reviews.js"] },
  // Own :8800/:8801 app servers plus a local gateway stand-in. It validates the
  // live-mode refund state without contacting a real payment service.
  { name: "delivery safety", cmd: "node", args: ["scripts/test-delivery-safety.js"] },
];

const results = [];

for (const s of suites) {
  process.stdout.write("\n════ " + s.name + " " + "═".repeat(Math.max(0, 56 - s.name.length)) + "\n");
  const run = spawnSync(s.cmd, s.args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, { FORCE_COLOR: "0" }),
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  const m = String(run.stdout || "").match(/RESULT:\s*(\d+)\s*passed,\s*(\d+)\s*failed/);
  results.push({
    suite: s,
    status: run.status,
    error: run.error,
    passed: m ? Number(m[1]) : null,
    failed: m ? Number(m[2]) : null,
  });
}

console.log("\n" + "═".repeat(62));
console.log("TEST SUMMARY");
console.log("═".repeat(62));
let regressed = 0;
for (const r of results) {
  const label = r.suite.name.padEnd(17);
  if (r.error) { console.log(`  ✘ ${label} could not run — ${r.error.message}`); regressed++; continue; }
  if (r.suite.baseline) {
    // Now that no API failures are intentionally tolerated, a non-zero exit or
    // any reported failure is a regression even if the pass count still happens
    // to meet the historical floor.
    const okRun = r.status === 0 && r.passed !== null && r.passed >= r.suite.baseline && r.failed === 0;
    console.log(`  ${okRun ? "✔" : "✘"} ${label} ${r.passed === null ? `exit ${r.status}` : `${r.passed} passed, ${r.failed} failed (baseline: ${r.suite.baseline} passed)`}`);
    if (!okRun) regressed++;
  } else {
    console.log(`  ${r.status === 0 ? "✔" : "✘"} ${label} ${r.status === 0 ? "passed" : "FAILED (exit " + r.status + ")"}`);
    if (r.status !== 0) regressed++;
  }
}
console.log("═".repeat(62));
console.log(regressed ? `✘ ${regressed} suite(s) regressed` : "✔ every suite green");
process.exit(regressed ? 1 : 0);

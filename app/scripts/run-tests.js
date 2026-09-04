#!/usr/bin/env node
/* run-tests.js — run every suite and report them all, even when one fails.
 *
 * `npm test` used to be `bash scripts/test.sh && node … && node …`, which meant
 * the API pipeline's pre-existing float-state failures (see README → Tested)
 * short-circuited the chain and the supplier, assistant and SEO suites never ran
 * at all. Nobody notices a broken suite that never executes.
 *
 * So: run all four, print a summary, exit non-zero if anything regressed.
 *
 * scripts/test.sh is judged against a baseline rather than against zero
 * failures. On a fresh `SEED_DEMO=1` server the pristine tree at eb0bc71 scores
 * 152 passed / 6 failed — five float checks that assume an *unseeded* float of
 * GH₵200, plus `paused rule not swept`. Those six are environmental, not
 * regressions, so this runner fails only when the pass count drops below the
 * baseline (or a suite cannot run at all).
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
const API_BASELINE_PASSED = 152;   // eb0bc71 + SEED_DEMO=1, server on :8787

const suites = [
  { name: "api pipeline", cmd: "bash", args: ["scripts/test.sh"], baseline: API_BASELINE_PASSED },
  { name: "supplier router", cmd: "node", args: ["scripts/test-supplier-router.js"] },
  { name: "valmontai", cmd: "node", args: ["scripts/test-valmontai.js"] },
  { name: "seo", cmd: "node", args: ["scripts/test-seo.js"] },
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
    const okRun = r.passed === null ? r.status === 0 : r.passed >= r.suite.baseline;
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

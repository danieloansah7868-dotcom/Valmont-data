#!/usr/bin/env node
"use strict";

/* Focused safety checks for multi-supplier routing. No network calls. */
const assert = require("node:assert/strict");

process.env.SUPPLIER_ORDER = "typhonic,remadata";
process.env.TYPHONIC_API_URL = "https://example.invalid";
process.env.TYPHONIC_API_KEY = "test-key";
process.env.TYPHONIC_PURCHASE_PATH = "/purchase";
process.env.SUPPLIER_CIRCUIT_FAILURES = "99";

const { getSupplierRouter, typhonic, remadata } = require("../lib/supplier");
const router = getSupplierRouter();
const originalTyphonic = typhonic.submit;
const originalRema = remadata.submit;
const order = { reference: "VD-ROUTER-TEST", network: "mtn", sizeMb: 1024, phone: "0241112222", attempts: 1 };

(async () => {
  let backupCalls = 0;

  // A definitive rejection is safe to fail over.
  typhonic.submit = async () => ({ ok: false, safeToFailover: true, error: "bundle unavailable" });
  remadata.submit = async () => { backupCalls += 1; return { ok: true, supplier_ref: "REMA-1", raw: { status: "success" } }; };
  let result = await router.submit(order);
  assert.equal(result.ok, true);
  assert.equal(result.supplier, "remadata");
  assert.equal(backupCalls, 1);
  assert.deepEqual(result.routing_attempts.map((x) => x.supplier), ["typhonic", "remadata"]);

  // A timeout is ambiguous: never call the backup (duplicate-delivery guard).
  backupCalls = 0;
  typhonic.submit = async () => ({ ok: false, ambiguous: true, safeToFailover: false, error: "timeout" });
  remadata.submit = async () => { backupCalls += 1; return { ok: true, supplier_ref: "SHOULD-NOT-HAPPEN" }; };
  result = await router.submit({ ...order, reference: "VD-ROUTER-TIMEOUT" });
  assert.equal(result.ok, false);
  assert.equal(result.ambiguous, true);
  assert.equal(result.supplier, "typhonic");
  assert.equal(backupCalls, 0);

  // Accepted/pending also sticks to the first supplier.
  typhonic.submit = async () => ({ ok: true, pending: true, supplier_ref: "TYPH-PENDING", raw: { status: "pending" } });
  result = await router.submit({ ...order, reference: "VD-ROUTER-PENDING" });
  assert.equal(result.ok, true);
  assert.equal(result.pending, true);
  assert.equal(result.supplier, "typhonic");

  console.log("PASS  multi-supplier definitive rejection fails over");
  console.log("PASS  ambiguous timeout never fails over");
  console.log("PASS  accepted/pending stays with original supplier");
})().finally(() => {
  typhonic.submit = originalTyphonic;
  remadata.submit = originalRema;
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

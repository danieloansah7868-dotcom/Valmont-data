/* ============================================================================
   Supplier delivery adapter — the ONLY place that talks to a data wholesaler.
   Swapping suppliers = adding a driver here, nothing else changes.

   Driver interface:
     submit({ reference, network, sizeMb, phone }) → { ok, supplier_ref?, error?, raw? }

   Drivers:
     mock     — simulates delivery (dev/test). MOCK_DELIVER_MS, MOCK_FAIL_RATE,
                MOCK_FAIL_FIRST (fail only the first attempt → tests retry path)
     remadata — https://remadata.com (see GET-STARTED.md: free account, no
                upfront capital, plan_id per bundle in REMADATA_PLANS)
   ============================================================================ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const mock = {
  name: "mock",
  async submit(order) {
    await sleep(Number(process.env.MOCK_DELIVER_MS || "1200"));
    const rate = Number(process.env.MOCK_FAIL_RATE || "0");
    const failFirst = process.env.MOCK_FAIL_FIRST === "1" && order.attempts <= 1;
    // Test convention: numbers ending 0000 fail on their first attempt only
    // (lets the test suite exercise the retry path deterministically).
    const failFirstTest = String(order.phone).endsWith("0000") && order.attempts <= 1;
    if (Math.random() < rate || failFirst || failFirstTest) {
      return { ok: false, error: "Mock supplier failure (simulated)", raw: { driver: "mock" } };
    }
    return { ok: true, supplier_ref: "MOCK-" + Date.now(), raw: { driver: "mock", order: order.reference } };
  },
};

const remadata = {
  name: "remadata",
  async submit(order) {
    const key = process.env.REMADATA_API_KEY;
    if (!key) return { ok: false, error: "REMADATA_API_KEY not set" };
    let plans = {};
    try { plans = JSON.parse(process.env.REMADATA_PLANS || "{}"); } catch {}
    const planId = plans?.[order.network]?.[order.sizeMb];
    if (!planId) {
      return { ok: false, error: `No plan_id mapped for ${order.network} ${order.sizeMb}MB — set REMADATA_PLANS` };
    }
    try {
      const res = await fetch("https://remadata.com/api/buy-data", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          network: order.network.toUpperCase() + "-GH",
          phone: order.phone,
          plan_id: planId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        return { ok: false, error: data.message || `HTTP ${res.status}`, raw: data };
      }
      return {
        ok: true,
        supplier_ref: String(data.order_id || data.ref || "REM-" + Date.now()),
        raw: data,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};

function getSupplier() {
  const driver = process.env.SUPPLIER_DRIVER || "mock";
  if (driver === "remadata") return remadata;
  if (driver !== "mock") console.warn(`Supplier "${driver}" not registered — using mock`);
  return mock;
}

module.exports = { getSupplier, mock, remadata };

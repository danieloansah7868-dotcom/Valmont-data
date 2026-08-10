/* ============================================================================
   Supplier delivery adapter — the ONLY place that talks to a data wholesaler.
   Swapping suppliers = adding a driver here, nothing else changes.

   Driver interface:
     submit({ reference, network, sizeMb, phone, attempts }) → { ok, supplier_ref?, error?, raw? }
     fetchBundles(apiKey?) → [ { network, volumeInMB, price, name }, ... ]
     fetchWalletBalance(apiKey?) → { balance, currency, mock? }

   Drivers:
     mock     — simulates delivery (dev/test). MOCK_DELIVER_MS, MOCK_FAIL_RATE,
                MOCK_FAIL_FIRST (fail only the first attempt → tests retry path)
     remadata — https://remadata.com (live REST API: X-API-KEY, volumeInMB,
                networkType, ref, phone)
   ============================================================================ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REMA_BASE = () => (process.env.REMADATA_API_URL || "https://remadata.com/api").replace(/\/$/, "");
const REMA_KEY = () => process.env.REMADATA_API_KEY || "";

function remaHeaders(customKey) {
  const key = customKey || REMA_KEY();
  return {
    "X-API-KEY": key,
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function mockBundlesList() {
  return [
    { network: "mtn", volumeInMB: 1024, price: 3.90, name: "1GB" },
    { network: "mtn", volumeInMB: 2048, price: 8.10, name: "2GB" },
    { network: "mtn", volumeInMB: 3072, price: 11.90, name: "3GB" },
    { network: "mtn", volumeInMB: 5120, price: 18.90, name: "5GB" },
    { network: "mtn", volumeInMB: 10240, price: 38.50, name: "10GB" },
    { network: "mtn", volumeInMB: 20480, price: 73.00, name: "20GB" },
    { network: "mtn", volumeInMB: 30720, price: 111.00, name: "30GB" },
    { network: "mtn", volumeInMB: 51200, price: 185.00, name: "50GB" },
    { network: "mtn", volumeInMB: 102400, price: 377.00, name: "100GB" },
    { network: "telecel", volumeInMB: 10240, price: 35.50, name: "10GB" },
    { network: "telecel", volumeInMB: 20480, price: 67.80, name: "20GB" },
    { network: "telecel", volumeInMB: 30720, price: 98.70, name: "30GB" },
    { network: "telecel", volumeInMB: 51200, price: 162.50, name: "50GB" },
    { network: "telecel", volumeInMB: 102400, price: 367.00, name: "100GB" },
    { network: "airteltigo", volumeInMB: 1024, price: 3.65, name: "1GB" },
    { network: "airteltigo", volumeInMB: 5120, price: 18.00, name: "5GB" },
    { network: "airteltigo", volumeInMB: 10240, price: 35.50, name: "10GB" },
    { network: "airteltigo", volumeInMB: 30720, price: 106.00, name: "30GB" },
    { network: "airteltigo", volumeInMB: 51200, price: 175.00, name: "50GB" },
  ];
}

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
    return { ok: true, supplier_ref: "MOCK-" + Date.now(), raw: { driver: "mock", order: order.reference, networkType: order.network, volumeInMB: order.sizeMb } };
  },

  async fetchBundles() {
    return mockBundlesList();
  },

  async fetchWalletBalance() {
    return { balance: 500.00, currency: "GHS", mock: true };
  },
};

const remadata = {
  name: "remadata",
  async submit(order) {
    const key = REMA_KEY();
    if (!key) return { ok: false, error: "REMADATA_API_KEY not set" };

    try {
      const res = await fetch(`${REMA_BASE()}/buy-data`, {
        method: "POST",
        headers: remaHeaders(key),
        body: JSON.stringify({
          ref: order.reference,
          phone: String(order.phone).trim(),
          volumeInMB: Number(order.sizeMb),
          networkType: String(order.network).toLowerCase(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      const isSuccess = res.ok && (data.status === "success" || data.status === "pending" || data.success === true);

      if (!isSuccess) {
        // RemaData returns status: "error" and auto-refunds the wallet
        const errorMsg = data.message || data.error || (data.status === "error" ? "Supplier order error (auto-refunded)" : `HTTP ${res.status}`);
        return { ok: false, error: errorMsg, raw: data };
      }

      const ref = (data.data && (data.data.reference || data.data.client_reference))
        || data.reference
        || data.order_id
        || `REM-${Date.now()}`;

      return {
        ok: true,
        supplier_ref: String(ref),
        raw: data,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async fetchBundles(customKey) {
    const key = customKey || REMA_KEY();
    if (!key) return mockBundlesList();

    try {
      const res = await fetch(`${REMA_BASE()}/bundles`, {
        headers: remaHeaders(key),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.status === "success" || Array.isArray(data.data) || Array.isArray(data))) {
        const list = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
        return list.map((b) => ({
          network: String(b.network || b.networkType || "").toLowerCase(),
          volumeInMB: Number(b.volumeInMB || b.volume_in_mb || b.volumeMb || (b.capacity ? Number(b.capacity) * 1024 : 0)),
          price: Number(b.price || b.api_price || b.cost_price || 0),
          name: b.name || `${b.volumeInMB || b.volume || ""}MB`,
        }));
      }
      throw new Error(data.message || `Failed to fetch bundles: HTTP ${res.status}`);
    } catch (err) {
      if (!key) return mockBundlesList();
      throw err;
    }
  },

  async fetchWalletBalance(customKey) {
    const key = customKey || REMA_KEY();
    if (!key) return { balance: 500.00, currency: "GHS", mock: true };

    try {
      const res = await fetch(`${REMA_BASE()}/wallet-balance`, {
        headers: remaHeaders(key),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.status === "success" || data.data?.balance !== undefined)) {
        return {
          balance: Number(data.data?.balance !== undefined ? data.data.balance : data.balance) || 0,
          currency: data.data?.currency || data.currency || "GHS",
        };
      }
      throw new Error(data.message || `Failed to fetch wallet balance: HTTP ${res.status}`);
    } catch (err) {
      if (!key) return { balance: 500.00, currency: "GHS", mock: true };
      throw err;
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

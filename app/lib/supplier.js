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
    { network: "mtn", volumeInMB: 4096, price: 16.60, name: "4GB" },
    { network: "mtn", volumeInMB: 5120, price: 18.90, name: "5GB" },
    { network: "mtn", volumeInMB: 6144, price: 24.50, name: "6GB" },
    { network: "mtn", volumeInMB: 8192, price: 32.60, name: "8GB" },
    { network: "mtn", volumeInMB: 10240, price: 38.50, name: "10GB" },
    { network: "mtn", volumeInMB: 15360, price: 58.00, name: "15GB" },
    { network: "mtn", volumeInMB: 20480, price: 73.00, name: "20GB" },
    { network: "mtn", volumeInMB: 25600, price: 98.00, name: "25GB" },
    { network: "mtn", volumeInMB: 30720, price: 111.00, name: "30GB" },
    { network: "mtn", volumeInMB: 40960, price: 159.00, name: "40GB" },
    { network: "mtn", volumeInMB: 51200, price: 185.00, name: "50GB" },
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
        // An explicit supplier rejection / 4xx is safe to route elsewhere.
        // A 5xx may have happened after the supplier accepted the order, so it
        // is deliberately ambiguous: immediate failover could deliver twice.
        const explicitRejection = data.status === "error" || data.success === false;
        const safeToFailover = explicitRejection || (res.status >= 400 && res.status < 500);
        const errorMsg = data.message || data.error || (explicitRejection ? "Supplier order rejected (wallet auto-refunded)" : `HTTP ${res.status}`);
        return { ok: false, error: errorMsg, raw: data, safeToFailover, ambiguous: !safeToFailover, httpStatus: res.status };
      }

      const ref = (data.data && (data.data.reference || data.data.client_reference))
        || data.reference
        || data.order_id
        || `REM-${Date.now()}`;

      return {
        ok: true,
        pending: data.status === "pending",
        supplier_ref: String(ref),
        raw: data,
      };
    } catch (e) {
      // A timeout/network reset is not proof that the request failed. Keep the
      // order unresolved until status can be reconciled; never fail over now.
      return { ok: false, error: e.message, ambiguous: true, safeToFailover: false };
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

/* ---------- Typhonic Data Hub ----------
   Their agent dashboard exposes API keys + webhooks after approval, but the
   endpoint contract is not public. Paths and field names are therefore env
   configured rather than guessed. This driver stays disabled until the live
   documentation values are supplied. */
const TYPHONIC_BASE = () => (process.env.TYPHONIC_API_URL || "").replace(/\/$/, "");
const TYPHONIC_KEY = () => process.env.TYPHONIC_API_KEY || "";

function typhonicPath(name, fallback = "") {
  const value = process.env[name] || fallback;
  return value && value.startsWith("/") ? value : (value ? `/${value}` : "");
}

function typhonicHeaders() {
  const key = TYPHONIC_KEY();
  const header = process.env.TYPHONIC_AUTH_HEADER || "Authorization";
  const configuredScheme = process.env.TYPHONIC_AUTH_SCHEME === undefined ? "Bearer" : process.env.TYPHONIC_AUTH_SCHEME;
  const scheme = configuredScheme && !configuredScheme.endsWith(" ") ? `${configuredScheme} ` : configuredScheme;
  return { [header]: `${scheme}${key}`, "Content-Type": "application/json", Accept: "application/json" };
}

function pick(obj, dottedPaths, fallback) {
  for (const path of dottedPaths) {
    let value = obj;
    for (const part of path.split(".")) value = value && value[part];
    if (value !== undefined && value !== null) return value;
  }
  return fallback;
}

const typhonic = {
  name: "typhonic",
  isConfigured() {
    return !!(TYPHONIC_BASE() && TYPHONIC_KEY() && typhonicPath("TYPHONIC_PURCHASE_PATH"));
  },
  async submit(order) {
    if (!this.isConfigured()) {
      return { ok: false, safeToFailover: true, error: "Typhonic API is not fully configured" };
    }
    const body = {};
    body[process.env.TYPHONIC_REFERENCE_FIELD || "reference"] = order.reference;
    body[process.env.TYPHONIC_PHONE_FIELD || "phone"] = order.phone;
    body[process.env.TYPHONIC_NETWORK_FIELD || "network"] = order.network;
    body[process.env.TYPHONIC_VOLUME_FIELD || "volumeInMB"] = Number(order.sizeMb);
    try {
      const res = await fetch(`${TYPHONIC_BASE()}${typhonicPath("TYPHONIC_PURCHASE_PATH")}`, {
        method: "POST", headers: typhonicHeaders(), body: JSON.stringify(body),
        signal: AbortSignal.timeout(Number(process.env.SUPPLIER_TIMEOUT_MS || "15000")),
      });
      const data = await res.json().catch(() => ({}));
      const status = String(pick(data, ["status", "data.status"], "")).toLowerCase();
      const success = res.ok && (data.success === true || ["success", "successful", "completed", "delivered", "pending", "processing"].includes(status));
      const ref = pick(data, ["data.reference", "data.order_id", "reference", "order_id", "id"], order.reference);
      if (success) return {
        ok: true,
        pending: ["pending", "processing"].includes(status),
        supplier_ref: String(ref),
        raw: data,
      };
      const explicitRejection = data.success === false || ["error", "failed", "rejected", "refunded"].includes(status);
      const safeToFailover = explicitRejection || (res.status >= 400 && res.status < 500);
      return {
        ok: false,
        error: pick(data, ["message", "error", "data.message"], `Typhonic HTTP ${res.status}`),
        raw: data,
        httpStatus: res.status,
        safeToFailover,
        ambiguous: !safeToFailover,
      };
    } catch (e) {
      return { ok: false, error: e.message, ambiguous: true, safeToFailover: false };
    }
  },
  async lookup(reference) {
    const template = typhonicPath("TYPHONIC_STATUS_PATH");
    if (!this.isConfigured() || !template) return { found: false, unsupported: true };
    const path = template.includes("{reference}")
      ? template.replace("{reference}", encodeURIComponent(reference))
      : `${template}${template.includes("?") ? "&" : "?"}reference=${encodeURIComponent(reference)}`;
    try {
      const res = await fetch(`${TYPHONIC_BASE()}${path}`, {
        headers: typhonicHeaders(), signal: AbortSignal.timeout(Number(process.env.SUPPLIER_TIMEOUT_MS || "15000")),
      });
      const data = await res.json().catch(() => ({}));
      const status = String(pick(data, ["status", "data.status"], "")).toLowerCase();
      if (res.status === 404 || ["not_found", "not found"].includes(status)) return { found: false, definitive: true, raw: data };
      if (["success", "successful", "completed", "delivered"].includes(status)) return { found: true, delivered: true, raw: data, supplier_ref: String(pick(data, ["data.reference", "reference", "order_id"], reference)) };
      if (["error", "failed", "rejected", "refunded"].includes(status)) return { found: true, failed: true, definitive: true, raw: data };
      return { found: res.ok, pending: res.ok, raw: data };
    } catch (e) {
      return { found: false, ambiguous: true, error: e.message };
    }
  },
  async fetchBundles() {
    const path = typhonicPath("TYPHONIC_BUNDLES_PATH");
    if (!this.isConfigured() || !path) throw new Error("Typhonic bundles endpoint is not configured");
    const res = await fetch(`${TYPHONIC_BASE()}${path}`, { headers: typhonicHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(pick(data, ["message", "error"], `HTTP ${res.status}`));
    const list = pick(data, ["data.bundles", "data", "bundles"], []);
    return Array.isArray(list) ? list.map((b) => ({
      network: String(pick(b, ["network", "networkType", "network_code"], "")).toLowerCase(),
      volumeInMB: Number(pick(b, ["volumeInMB", "volume_mb", "size_mb"], 0)),
      price: Number(pick(b, ["price", "agent_price", "cost_price"], 0)),
      name: pick(b, ["name", "label"], ""),
    })) : [];
  },
  async fetchWalletBalance() {
    const path = typhonicPath("TYPHONIC_BALANCE_PATH");
    if (!this.isConfigured() || !path) throw new Error("Typhonic wallet endpoint is not configured");
    const res = await fetch(`${TYPHONIC_BASE()}${path}`, { headers: typhonicHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(pick(data, ["message", "error"], `HTTP ${res.status}`));
    return { balance: Number(pick(data, ["data.balance", "balance", "wallet.balance"], 0)), currency: pick(data, ["data.currency", "currency"], "GHS") };
  },
};

/* ---------- router + conservative failover ---------- */
const circuitState = new Map();
function circuitConfig() {
  return {
    threshold: Math.max(1, Number(process.env.SUPPLIER_CIRCUIT_FAILURES || "3")),
    cooldownMs: Math.max(1000, Number(process.env.SUPPLIER_CIRCUIT_COOLDOWN_MS || "300000")),
  };
}
function circuit(name) {
  if (!circuitState.has(name)) circuitState.set(name, { failures: 0, openUntil: 0, lastError: null, lastSuccessAt: null });
  return circuitState.get(name);
}
function circuitAvailable(name) { return circuit(name).openUntil <= Date.now(); }
function recordSuccess(name) { Object.assign(circuit(name), { failures: 0, openUntil: 0, lastError: null, lastSuccessAt: new Date().toISOString() }); }
function recordFailure(name, error) {
  const state = circuit(name); const cfg = circuitConfig();
  state.failures += 1; state.lastError = error || "unknown error";
  if (state.failures >= cfg.threshold) state.openUntil = Date.now() + cfg.cooldownMs;
}

const drivers = { mock, remadata, typhonic };
function configuredNames(network) {
  const networkKey = network ? `SUPPLIER_ORDER_${String(network).toUpperCase().replace(/[^A-Z0-9]/g, "")}` : null;
  const explicit = (networkKey && process.env[networkKey]) || process.env.SUPPLIER_ORDER || process.env.SUPPLIER_DRIVERS;
  const disabled = new Set(String(process.env.SUPPLIER_DISABLED || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean));
  if (explicit) return explicit.split(",").map((x) => x.trim().toLowerCase()).filter((x) => drivers[x] && !disabled.has(x));
  return [String(process.env.SUPPLIER_DRIVER || "mock").toLowerCase()].filter((x) => drivers[x] && !disabled.has(x));
}
function getSupplier(name) {
  const chosen = name
    ? drivers[String(name).toLowerCase()]
    : getSuppliers().find((s) => typeof s.isConfigured !== "function" || s.isConfigured());
  if (chosen) return chosen;
  console.warn(`Supplier "${name || process.env.SUPPLIER_DRIVER}" not registered/configured — using mock`);
  return mock;
}
function getSuppliers(network) { return configuredNames(network).map((name) => drivers[name]); }

const router = {
  name: "router",
  suppliers: getSuppliers,
  health() {
    return getSuppliers().map((s, priority) => ({
      name: s.name, priority: priority + 1,
      configured: typeof s.isConfigured === "function" ? s.isConfigured() : true,
      circuit_open: !circuitAvailable(s.name), ...circuit(s.name),
    }));
  },
  async submit(order) {
    const attempts = [];
    const suppliers = getSuppliers(order.network);
    if (!suppliers.length) return { ok: false, safeToFailover: false, error: `No suppliers configured for ${order.network}`, routing_attempts: attempts };

    for (const supplier of suppliers) {
      if (!circuitAvailable(supplier.name)) {
        attempts.push({ supplier: supplier.name, skipped: true, reason: "circuit_open" });
        continue;
      }
      if (typeof supplier.isConfigured === "function" && !supplier.isConfigured()) {
        attempts.push({ supplier: supplier.name, skipped: true, reason: "not_configured" });
        continue;
      }
      const result = await supplier.submit(order);
      attempts.push({
        supplier: supplier.name, ok: !!result.ok, pending: !!result.pending,
        ambiguous: !!result.ambiguous, safe_to_failover: !!result.safeToFailover,
        error: result.error || null, supplier_ref: result.supplier_ref || null,
      });
      if (result.ok) {
        recordSuccess(supplier.name);
        return { ...result, supplier: supplier.name, routing_attempts: attempts,
          raw: { supplier: supplier.name, response: result.raw || {}, routing_attempts: attempts } };
      }
      // Only infrastructure/ambiguous failures count toward the circuit.
      // Customer validation, unsupported bundles and low wallet are definitive
      // business rejections and must not mark an otherwise healthy API down.
      if (result.ambiguous || Number(result.httpStatus || 0) >= 500) recordFailure(supplier.name, result.error);
      if (!result.safeToFailover) {
        return { ...result, supplier: supplier.name, routing_attempts: attempts,
          raw: { supplier: supplier.name, response: result.raw || {}, routing_attempts: attempts } };
      }
    }
    return { ok: false, safeToFailover: false, error: "All configured suppliers rejected or were unavailable", routing_attempts: attempts,
      raw: { routing_attempts: attempts } };
  },
  async fetchWalletBalances() {
    return Promise.all(getSuppliers().map(async (supplier, priority) => {
      try {
        const data = await supplier.fetchWalletBalance();
        recordSuccess(supplier.name);
        return { ok: true, supplier: supplier.name, priority: priority + 1, ...data };
      } catch (e) {
        recordFailure(supplier.name, e.message);
        return { ok: false, supplier: supplier.name, priority: priority + 1, error: e.message };
      }
    }));
  },
};

function getSupplierRouter() { return router; }
function getSupplierHealth() { return router.health(); }

module.exports = { getSupplier, getSuppliers, getSupplierRouter, getSupplierHealth, mock, remadata, typhonic };

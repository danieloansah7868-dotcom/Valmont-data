/* ============================================================================
   Valmont-Pay client (tenant #3) + webhook signature verification.

   Live Valmont-Pay gateway contract (tenant: valmontdata):
   - POST {VALMONTPAY_API_URL}/transaction/initialize with Bearer token
   - Amounts in GHS cedis (major units, JSON number e.g. 23.50, never pesewas)
   - Webhooks delivered with event `charge.success`
   - Signed with HMAC-SHA512 in header `x-valmontpay-signature`
   - Key rotation supported: webhook secret is read from env at call time
   ============================================================================ */

const crypto = require("crypto");
const { isDeployment, configurationError, secretIsStrong } = require("./runtime");

const VP_BASE = () => (process.env.VALMONTPAY_API_URL || "https://valmontpay.app/api").replace(/\/$/, "");
const VP_KEY = () => process.env.VALMONTPAY_API_KEY || "";
const VP_SECRET = () => process.env.VALMONTPAY_WEBHOOK_SECRET || "";

function configured() {
  // The URL and mode are explicit in deployment: do not quietly use a
  // development default (or accept a webhook) for a money-moving endpoint.
  const configuredMode = String(process.env.VALMONTPAY_MODE || "").toLowerCase();
  return !!(
    VP_KEY()
    && VP_SECRET()
    && (!isDeployment() || (
      configuredMode === "live"
      && process.env.VALMONTPAY_API_URL
      && secretIsStrong(VP_SECRET(), { minLength: 16, disallow: ["dev-webhook-secret", "changeme"] })
    ))
  );
}

/* Live vs dev mode — NO silent dev fallback in live mode.
   VALMONTPAY_MODE=live is the production setting: if the gateway credentials
   are missing, calls fail loudly (503) instead of pretending to work. Dev
   mode (simulated payments, local only) requires VALMONTPAY_MODE=dev, which
   scripts/dev-server.js sets by default. */
function mode() {
  return isDeployment() ? "live" : (process.env.VALMONTPAY_MODE === "live" ? "live" : "dev");
}

function liveConfigError() {
  const err = new Error(
    "Valmont-Pay live gateway is not configured — set VALMONTPAY_API_URL, VALMONTPAY_API_KEY and VALMONTPAY_WEBHOOK_SECRET"
  );
  err.status = 503;
  return err;
}

function assertLiveReady() {
  const configuredMode = String(process.env.VALMONTPAY_MODE || "").toLowerCase();
  if (isDeployment() && configuredMode && configuredMode !== "live") {
    throw configurationError(
      "Only VALMONTPAY_MODE=live is safe on deployed endpoints; simulated checkout is disabled"
    );
  }
  if (isDeployment() && !configured()) {
    throw configurationError(
      "Valmont-Pay live gateway is required on deployed endpoints; simulated checkout is disabled"
    );
  }
  return true;
}

function getEndpoint(path) {
  const base = VP_BASE();
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (base.endsWith("/api")) {
    return `${base}${cleanPath}`;
  }
  return `${base}/api${cleanPath}`;
}

/** Create a checkout session on the live Valmont-Pay gateway. Returns { checkout_url, ... } or throws. */
async function createCheckout({ reference, amount, phone, email, description, returnUrl, webhookUrl }) {
  assertLiveReady();
  if (!configured()) {
    if (mode() === "live") throw liveConfigError();
    // Dev mode only: no gateway configured — the caller shows a "simulate payment" path.
    return { checkout_url: null, dev: true };
  }

  // Amount must strictly be a JSON number in cedis (major units)
  const numAmount = Number(Number(amount).toFixed(2));
  const customerEmail = (email && email.includes("@"))
    ? email.trim()
    : (phone ? `${String(phone).replace(/\D/g, "")}@valmontdata.com` : "customer@valmontdata.com");
  const callbackUrl = returnUrl || "";

  const payload = {
    amount: numAmount,
    reference,
    email: customerEmail,
    phone: phone || "",
    callback_url: callbackUrl,
    currency: "GHS"
  };

  const endpoint = getEndpoint("/transaction/initialize");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VP_KEY()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  const respData = (data && data.data) ? data.data : data;
  const targetUrl = (respData && (respData.checkout_url || respData.pay_url || respData.payment_url)) || null;

  if (!res.ok || !targetUrl) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    const err = new Error("Valmont-Pay checkout failed: " + msg);
    err.status = res.status || 502;
    throw err;
  }

  return {
    ...respData,
    checkout_url: targetUrl,
    pay_url: (respData && respData.pay_url) || targetUrl,
    access_code: (respData && respData.access_code) || null,
    reference: (respData && respData.reference) || reference,
  };
}

/** Pre-authorized direct charge (auto-reload path).
    The customer has opted in to auto-reload and pre-authorized this MoMo
    number, so there is NO checkout redirect: the gateway initiates a charge
    against the saved number. IMPORTANT — mobile money wallets always require
    the wallet owner to approve the debit with their PIN (USSD/app prompt),
    so the charge is AUTHORIZATION-PENDING after this call; the gateway sends
    the signed `charge.success` webhook once the customer approves, and that
    webhook flows through the same idempotent claim → float check → delivery
    pipeline. If the customer never approves, nothing is charged and nothing
    is delivered.

    Gateway contract (tenant #3): POST {base}/transaction/charge with
    method "momo" + type "direct". Requires the "direct charge" permission to
    be enabled for the tenant. In dev (no gateway configured) returns
    { dev: true } and the auto-reload engine simulates the webhook locally. */
async function initiateCharge({ reference, amount, phone, email, description }) {
  assertLiveReady();
  if (!configured()) {
    if (mode() === "live") throw liveConfigError();
    // Dev mode only — see AUTORELOAD_SIMULATE in lib/autoreload.js.
    return { dev: true, reference };
  }

  const numAmount = Number(Number(amount).toFixed(2));
  const customerEmail = (email && email.includes("@"))
    ? email.trim()
    : (phone ? `${String(phone).replace(/\D/g, "")}@valmontdata.com` : "customer@valmontdata.com");

  const payload = {
    amount: numAmount,
    reference,
    email: customerEmail,
    phone: phone || "",
    currency: "GHS",
    method: "momo",
    type: "direct",
    description: description || `Auto-reload ${reference}`,
  };

  const endpoint = getEndpoint("/transaction/charge");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VP_KEY()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  const respData = (data && data.data) ? data.data : data;

  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    const err = new Error("Valmont-Pay direct charge failed: " + msg);
    err.status = res.status || 502;
    throw err;
  }

  const status = String(respData.status || "authorization_pending").toLowerCase();
  // A MoMo charge is initiated, not completed: the wallet owner must approve
  // it with their PIN before money moves. The charge.success webhook is the
  // source of truth for completion (never this response alone).
  const completed = ["success", "confirmed", "completed", "paid"].includes(status);
  return {
    ...respData,
    reference: (respData && respData.reference) || reference,
    status,
    authorization_required: !completed,
    awaiting_pin: !completed,
  };
}

/** Verify x-valmontpay-signature: HMAC-SHA512 of the raw body with our tenant secret. */
function verifySignature(rawBody, signature) {
  if ((isDeployment() && !configured()) || !VP_SECRET() || !signature || !rawBody) return false;
  try {
    const expected = crypto.createHmac("sha512", VP_SECRET()).update(rawBody).digest("hex");
    const provided = String(signature).trim().toLowerCase();
    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(provided, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Valmont-Pay has no supported automated refund endpoint. Callers must put the
 * order into refund_pending and wait for an authenticated operator to confirm
 * completion after doing the gateway action. Kept as an explicit throwing
 * guard so a future caller cannot accidentally claim a refund was submitted.
 */
async function refund() {
  const err = new Error("Automated Valmont-Pay refunds are unsupported; complete the gateway refund manually first");
  err.status = 501;
  throw err;
}

module.exports = { configured, mode, createCheckout, initiateCharge, verifySignature, refund, assertLiveReady };

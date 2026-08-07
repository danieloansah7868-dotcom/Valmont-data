/* ==========================================================================
   Paystack client — MoMo charges + webhook signature verification.

   - Secret key server-side only (PAYSTACK_SECRET_KEY). Without it the app
     runs in dev mode: charges/deposits auto-approve.
   - Amounts cross the wire in pesewas (GHS × 100).
   - Webhook: x-paystack-signature = HMAC-SHA512 of the RAW body with the
     secret key. Configure https://your-domain/api/webhooks/paystack in the
     Paystack dashboard.
   ========================================================================== */

import crypto from "crypto";

const BASE = "https://api.paystack.co";

export function paystackConfigured(): boolean {
  return !!process.env.PAYSTACK_SECRET_KEY;
}

/** Channel names used by the API routes → Paystack MoMo provider codes. */
export type MomoChannel = "mobile_money_mtn" | "mobile_money_vodafone" | "mobile_money_gh";

const PROVIDER_BY_CHANNEL: Record<MomoChannel, string> = {
  mobile_money_mtn: "mtn",
  mobile_money_vodafone: "vod", // Telecel (formerly Vodafone GH)
  mobile_money_gh: "atl", // AirtelTigo
};

/**
 * Create a "charge mobile money" request — the customer approves the MoMo
 * prompt on their phone; the webhook confirms final status.
 */
export async function chargeMobileMoney(opts: {
  email: string;
  amountGhs: number;
  reference: string;
  phone: string;
  channel: MomoChannel;
}): Promise<{ status: boolean; message?: string; data?: unknown }> {
  const res = await fetch(`${BASE}/charge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: opts.email,
      amount: Math.round(opts.amountGhs * 100), // pesewas
      currency: "GHS",
      reference: opts.reference,
      mobile_money: {
        phone: opts.phone,
        provider: PROVIDER_BY_CHANNEL[opts.channel],
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === false) {
    throw new Error("Paystack charge failed: " + (data.message || `HTTP ${res.status}`));
  }
  return data;
}

/** Verify x-paystack-signature against the raw request body. */
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !signature) return false;
  const expected = crypto.createHmac("sha512", key).update(rawBody).digest("hex");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

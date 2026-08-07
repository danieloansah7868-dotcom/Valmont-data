/* ==========================================================================
   RemaData driver — https://remadata.com (wholesale MTN/Telecel/AirtelTigo
   bundles; free account, no upfront capital — you fund a wallet = your float).

   Setup (see GET-STARTED.md at the repo root):
     1. REMADATA_API_KEY — from your RemaData dashboard.
     2. REMADATA_PLANS   — JSON map of network → GB → plan_id, one per bundle
        you sell. scripts/sync-prices.js prints this line from a plans.json
        export of their package catalogue, e.g.
          REMADATA_PLANS={"mtn":{"1":1001,"2":1002,"10":1003},"telecel":{"10":2001},"airteltigo":{"1":3001}}
        (Sizes may also be keyed in MB — both are accepted.)

   The exact request/response shape follows RemaData's public API docs as at
   Aug 2026 — if their live API differs, this file is the only thing to fix.
   ========================================================================== */

import type { DeliveryRequest, DeliveryResult, ProviderDriver } from "@/lib/providers/index";

function planIdFor(network: string, gb: number): number | undefined {
  let plans: Record<string, Record<string, number>> = {};
  try {
    plans = JSON.parse(process.env.REMADATA_PLANS || "{}");
  } catch {
    plans = {};
  }
  const byNetwork = plans?.[network];
  if (!byNetwork) return undefined;
  // Keyed by GB ("10") in this starter; the production app keys by MB
  // ("10240") — accept both so one REMADATA_PLANS line works everywhere.
  return byNetwork[String(gb)] ?? byNetwork[String(gb * 1024)];
}

export const remadata: ProviderDriver = {
  name: "remadata",
  async submit(req: DeliveryRequest): Promise<DeliveryResult> {
    const key = process.env.REMADATA_API_KEY;
    if (!key) return { ok: false, error: "REMADATA_API_KEY not set" };

    const planId = planIdFor(req.network, req.gb);
    if (!planId) {
      return {
        ok: false,
        error: `No plan_id mapped for ${req.network} ${req.gb}GB — set REMADATA_PLANS`,
      };
    }

    try {
      const res = await fetch("https://remadata.com/api/buy-data", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          network: req.network.toUpperCase() + "-GH",
          phone: req.phone,
          plan_id: planId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        return { ok: false, error: data.message || `HTTP ${res.status}`, raw: data };
      }
      return {
        ok: true,
        ref: String(data.order_id || data.ref || "REM-" + Date.now()),
        raw: data,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "network error" };
    }
  },
};

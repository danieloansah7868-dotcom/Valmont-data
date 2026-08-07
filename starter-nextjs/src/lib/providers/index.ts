/* ==========================================================================
   Wholesale provider drivers — the ONLY place that talks to a data supplier.
   One driver = one supplier. Implement ProviderDriver in this folder and set
   PROVIDER_DRIVER to switch; nothing else in the app changes.

     submit({ reference, network, gb, phone, attempts }) → DeliveryResult

   Drivers:
     mock     — simulated delivery (default). MOCK_FAIL_RATE makes it fail
                randomly so you can watch the auto-refund path.
     remadata — https://remadata.com (see remadata.ts, REMADATA_API_KEY +
                REMADATA_PLANS)
   ========================================================================== */

import type { NetworkCode } from "@/lib/format";
import { remadata } from "@/lib/providers/remadata";

export type DeliveryRequest = {
  reference: string; // our public order id (VD-…), echoed back by the supplier
  network: NetworkCode;
  gb: number;
  phone: string; // recipient, 0XXXXXXXXX
  attempts: number; // 1-based attempt counter (for backoff / diagnostics)
};

export type DeliveryResult = {
  ok: boolean;
  ref?: string; // supplier-side reference — keep it for disputes
  error?: string;
  raw?: unknown; // full supplier response — always retained
};

export interface ProviderDriver {
  name: string;
  submit(req: DeliveryRequest): Promise<DeliveryResult>;
}

const mock: ProviderDriver = {
  name: "mock",
  async submit(req) {
    const rate = Number(process.env.MOCK_FAIL_RATE || "0");
    if (Math.random() < rate) {
      return { ok: false, error: "Mock supplier failure (simulated)", raw: { driver: "mock" } };
    }
    return { ok: true, ref: "MOCK-" + Date.now(), raw: { driver: "mock", order: req.reference } };
  },
};

const drivers: Record<string, ProviderDriver> = { mock, remadata, "mock-provider": mock };

/**
 * Resolve the driver to use. A provider row name from the `providers` table
 * wins when registered; otherwise fall back to PROVIDER_DRIVER (default mock).
 */
export function getProvider(providerName?: string): ProviderDriver {
  if (providerName && drivers[providerName]) return drivers[providerName];
  const key = (process.env.PROVIDER_DRIVER || "mock").toLowerCase();
  const driver = drivers[key];
  if (!driver) {
    console.warn(`Provider "${key}" not registered — using mock`);
    return mock;
  }
  return driver;
}

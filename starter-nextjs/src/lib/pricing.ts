/* ==========================================================================
   Bundle catalogue + tier pricing.

   Tiers: guest (no account) → member → reseller → dealer → wholesaler.
   Every bundle carries the full price ladder in `price_tiers` (JSONB), e.g.
   {"guest":43.00,"member":40.50,"reseller":39.50,"dealer":38.50,"wholesaler":37.50}

   Rules kept from the prototype blueprint:
   - No fake discounts — we never show a "was" price; tiers are real prices
     for real account types, nothing else.
   - Prices live in the DB; changing a price = updating the bundles table.
   ========================================================================== */

import { query } from "@/lib/db";
import type { User } from "@/lib/auth";
import type { NetworkCode } from "@/lib/format";

export type Tier = "guest" | "member" | "reseller" | "dealer" | "wholesaler";

export type BundleRow = {
  id: number;
  network: NetworkCode;
  gb: number;
  price_tiers: Record<string, number>;
  expiry_policy: string;
  active: boolean;
};

/** Caller's tier — guests see guest prices, signed-in users their own. */
export function tierOf(user: User | null): Tier {
  return user ? user.tier : "guest";
}

/** price_tiers can come back as a string from some drivers — normalise. */
function parseTiers(raw: unknown): Record<string, number> {
  if (typeof raw === "string") return JSON.parse(raw);
  return (raw || {}) as Record<string, number>;
}

/** Active catalogue, cheapest first. Pass a network to filter. */
export async function getBundles(network?: string): Promise<BundleRow[]> {
  const { rows } = network
    ? await query("SELECT * FROM bundles WHERE network = $1 AND active = true ORDER BY gb", [network])
    : await query("SELECT * FROM bundles WHERE active = true ORDER BY network, gb");
  return rows.map((r) => ({ ...r, price_tiers: parseTiers(r.price_tiers) })) as BundleRow[];
}

/** Resolve one bundle's price for a tier (falls back up the ladder). */
export function priceFor(bundle: BundleRow, tier: Tier): number {
  const tiers = parseTiers(bundle.price_tiers);
  const price = tiers[tier] ?? tiers.member ?? tiers.guest;
  return Number(price);
}

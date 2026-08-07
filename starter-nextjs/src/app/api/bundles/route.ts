import { NextResponse } from "next/server";
import { getBundles, priceFor, tierOf } from "@/lib/pricing";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/bundles?network=mtn
 * Returns the active bundle catalogue with prices resolved for the
 * caller's tier (guest / member / reseller / dealer / wholesaler).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const network = searchParams.get("network") || undefined;
  if (network && !["mtn", "telecel", "airteltigo"].includes(network)) {
    return NextResponse.json({ error: "Unknown network" }, { status: 400 });
  }
  const user = await getSession();
  const tier = tierOf(user);
  const bundles = (await getBundles(network)).map((b) => ({
    network: b.network,
    gb: b.gb,
    price: priceFor(b, tier),
    expiry_policy: b.expiry_policy,
  }));
  return NextResponse.json({ tier, bundles });
}

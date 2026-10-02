import { NextRequest, NextResponse } from "next/server";
import { getSellerStats, listAds } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Public seller profile: earned badges, reputation score and their live ads. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  const { phone } = await params;
  const stats = getSellerStats(decodeURIComponent(phone));
  if (!stats) return NextResponse.json({ ok: false, error: "Seller not found" }, { status: 404 });

  const { items } = listAds({ status: "active", perPage: 48, sort: "recent" });
  return NextResponse.json({
    ok: true,
    seller: stats,
    ads: items.filter((a) => a.sellerPhone === stats.phone),
  });
}

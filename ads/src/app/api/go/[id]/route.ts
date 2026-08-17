import { NextRequest, NextResponse } from "next/server";
import { recordPromoClick } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Click-through for a promoted ad: count the click, then hand the visitor
 * straight to the client's own website. This is the number the client bought,
 * and the redirect is what keeps us out of the middle — the customer lands on
 * the shop we built them, not on a Valmont checkout.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = recordPromoClick(id);
  if (!url) {
    return NextResponse.redirect(new URL(`/ads/${id}`, _req.nextUrl.origin), 302);
  }
  return NextResponse.redirect(url, 302);
}

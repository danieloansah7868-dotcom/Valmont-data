import { NextRequest, NextResponse } from "next/server";
import {
  listAds,
  setStatus,
  stats,
  toggleFeatured,
  listLeads,
  promoteAd,
  unpromoteAd,
  promotionReport,
  posterProfile,
  setVerified,
  topSellers,
} from "@/lib/store";
import type { AdStatus, PromotionTier } from "@/lib/types";

export const dynamic = "force-dynamic";

const PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

function authed(req: NextRequest): boolean {
  const header = req.headers.get("x-admin-password");
  return header === PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });

  /* Single-poster lookup: /api/admin?poster=0241234567 */
  const poster = req.nextUrl.searchParams.get("poster");
  if (poster) {
    const profile = posterProfile(poster);
    if (!profile) return NextResponse.json({ ok: false, error: "No ads from that number" }, { status: 404 });
    const { items: theirAds } = listAds({ status: "all", perPage: 200, sort: "recent", featuredFirst: false });
    return NextResponse.json({
      ok: true,
      profile,
      ads: theirAds.filter((a) => a.sellerPhone === profile.phone),
    });
  }

  const status = (req.nextUrl.searchParams.get("status") as AdStatus | "all") ?? "all";
  const { items } = listAds({ status, perPage: 200, sort: "recent", featuredFirst: false });

  /* Attach the poster's history to each queued ad so the moderator can judge
     the person, not just the words, without a second request. */
  const withProfiles = items.map((ad) => ({ ...ad, poster: posterProfile(ad.sellerPhone) }));

  return NextResponse.json({
    ok: true,
    stats: stats(),
    ads: withProfiles,
    leads: listLeads().slice(0, 30),
    promotions: promotionReport(),
    sellers: topSellers(12),
  });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const id = String(body.id ?? "");
  const action = String(body.action ?? "");

  if (action === "promote") {
    const result = promoteAd(id, {
      tier: (body.tier as PromotionTier) ?? "spotlight",
      clientName: String(body.clientName ?? ""),
      websiteUrl: String(body.websiteUrl ?? ""),
      packageRef: body.packageRef ? String(body.packageRef) : undefined,
      days: body.days ? Number(body.days) : undefined,
    });
    if (!result.ok) return NextResponse.json(result, { status: 400 });
    return NextResponse.json({ ok: true, ad: result.ad });
  }

  /* Manual ID verification — the one badge a human grants. */
  if (action === "verify" || action === "unverify") {
    const phone = String(body.phone ?? id);
    const seller = setVerified(phone, action === "verify");
    if (!seller) return NextResponse.json({ ok: false, error: "Seller not found" }, { status: 404 });
    return NextResponse.json({ ok: true, seller });
  }

  if (action === "unpromote") {
    const ad = unpromoteAd(id);
    if (!ad) return NextResponse.json({ ok: false, error: "Ad not found" }, { status: 404 });
    return NextResponse.json({ ok: true, ad });
  }

  if (action === "feature") {
    const ad = toggleFeatured(id);
    if (!ad) return NextResponse.json({ ok: false, error: "Ad not found" }, { status: 404 });
    return NextResponse.json({ ok: true, ad });
  }

  const allowed: AdStatus[] = ["pending", "active", "rejected", "sold", "expired"];
  if (!allowed.includes(action as AdStatus)) {
    return NextResponse.json({ ok: false, error: `Unknown action “${action}”` }, { status: 400 });
  }

  const ad = setStatus(id, action as AdStatus, body.reason ? String(body.reason) : undefined);
  if (!ad) return NextResponse.json({ ok: false, error: "Ad not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ad });
}

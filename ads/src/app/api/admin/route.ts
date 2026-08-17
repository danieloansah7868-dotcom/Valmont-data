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

  const status = (req.nextUrl.searchParams.get("status") as AdStatus | "all") ?? "all";
  const { items } = listAds({ status, perPage: 200, sort: "recent", featuredFirst: false });

  return NextResponse.json({
    ok: true,
    stats: stats(),
    ads: items,
    leads: listLeads().slice(0, 30),
    promotions: promotionReport(),
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

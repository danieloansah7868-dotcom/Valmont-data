import { NextRequest, NextResponse } from "next/server";
import { createAd, listAds } from "@/lib/store";
import type { AdStatus, ListQuery } from "@/lib/types";

export const dynamic = "force-dynamic";

function num(v: string | null): number | undefined {
  if (v === null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const query: ListQuery = {
    q: sp.get("q") ?? undefined,
    category: sp.get("category") ?? undefined,
    subcategory: sp.get("subcategory") ?? undefined,
    region: sp.get("region") ?? undefined,
    condition: sp.get("condition") ?? undefined,
    min: num(sp.get("min")),
    max: num(sp.get("max")),
    sort: (sp.get("sort") as ListQuery["sort"]) ?? "recent",
    status: (sp.get("status") as AdStatus | "all") ?? "active",
    page: num(sp.get("page")) ?? 1,
    perPage: Math.min(num(sp.get("perPage")) ?? 12, 48),
  };

  return NextResponse.json({ ok: true, ...listAds(query) });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const result = createAd({
    title: String(body.title ?? ""),
    category: String(body.category ?? ""),
    subcategory: body.subcategory ? String(body.subcategory) : undefined,
    price: body.price === null || body.price === "" || body.price === undefined ? null : Number(body.price),
    negotiable: Boolean(body.negotiable),
    condition: body.condition as never,
    region: String(body.region ?? ""),
    town: String(body.town ?? ""),
    description: String(body.description ?? ""),
    images: Array.isArray(body.images) ? (body.images as string[]) : [],
    sellerName: String(body.sellerName ?? ""),
    sellerPhone: String(body.sellerPhone ?? ""),
    whatsapp: body.whatsapp !== false,
    sellerType: body.sellerType === "business" ? "business" : "private",
  });

  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ok: true, ad: result.ad }, { status: 201 });
}

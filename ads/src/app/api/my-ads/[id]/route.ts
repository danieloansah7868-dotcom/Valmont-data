/* Seller-owned changes to one of their own ads.
   All require x-session-token proving the caller holds the seller's number.

   PATCH  { title?, description?, price?, negotiable?, condition?, images?, town? }
   POST   { action: "sold" | "relist" }
   DELETE                                    → removes the ad and its leads */

import { NextRequest, NextResponse } from "next/server";
import { deleteAdBySeller, markSoldBySeller, phoneForToken, relistBySeller, updateAdBySeller } from "@/lib/store";
import type { Ad } from "@/lib/types";

export const dynamic = "force-dynamic";

function requirePhone(req: NextRequest): string | null {
  return phoneForToken(req.headers.get("x-session-token"));
}

const UNAUTH = NextResponse.json(
  { ok: false, error: "Sign in with your phone number first" },
  { status: 401 },
);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const phone = requirePhone(req);
  if (!phone) return UNAUTH;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Parameters<typeof updateAdBySeller>[2] = {};
  if (typeof body.title === "string") patch.title = body.title;
  if (typeof body.description === "string") patch.description = body.description;
  if (body.price === null || typeof body.price === "number" || typeof body.price === "string") {
    patch.price = body.price === null || body.price === "" ? null : Number(body.price);
  }
  if (typeof body.negotiable === "boolean") patch.negotiable = body.negotiable;
  if (typeof body.condition === "string") patch.condition = body.condition as Ad["condition"];
  if (Array.isArray(body.images)) patch.images = body.images.map(String);
  if (typeof body.town === "string") patch.town = body.town;

  const result = updateAdBySeller(id, phone, patch);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, ad: result.ad, requeued: result.requeued });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const phone = requirePhone(req);
  if (!phone) return UNAUTH;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  if (action === "sold") {
    const result = markSoldBySeller(id, phone);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, ad: result.ad });
  }
  if (action === "relist") {
    const result = relistBySeller(id, phone);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, ad: result.ad });
  }
  return NextResponse.json({ ok: false, error: `Unknown action “${action}”` }, { status: 400 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const phone = requirePhone(req);
  if (!phone) return UNAUTH;
  const { id } = await params;

  const result = deleteAdBySeller(id, phone);
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, deleted: result.deleted });
}

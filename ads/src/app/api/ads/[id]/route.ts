import { NextRequest, NextResponse } from "next/server";
import { getAd, recordView } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ad = getAd(id);
  if (!ad) return NextResponse.json({ ok: false, error: "Ad not found" }, { status: 404 });
  return NextResponse.json({ ok: true, ad });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  recordView(id);
  return NextResponse.json({ ok: true });
}

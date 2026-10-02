import { NextRequest, NextResponse } from "next/server";
import { createLead, listLeads, getAd } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ad = getAd(id);
  if (!ad) return NextResponse.json({ ok: false, error: "Ad not found" }, { status: 404 });
  return NextResponse.json({ ok: true, leads: listLeads(ad.id) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const result = createLead(id, {
    name: String(body.name ?? ""),
    phone: String(body.phone ?? ""),
    message: String(body.message ?? ""),
  });

  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ok: true, lead: result.lead }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { findByPhone, listLeads } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get("phone") ?? "";
  const ads = findByPhone(phone);
  const leads = ads.flatMap((a) => listLeads(a.id));
  return NextResponse.json({ ok: true, ads, leads });
}

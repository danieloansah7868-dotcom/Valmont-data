/* A seller's own dashboard: their ads plus the buyer messages sent to them.
   Requires a session token — see src/lib/session.ts for why. */

import { NextRequest, NextResponse } from "next/server";
import { findByPhone, listLeads, phoneForToken } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  /* Previously this trusted ?phone= from the query string, which meant anyone
     could read a stranger's buyer messages by typing the number printed on
     their ad. The token is now the only accepted proof. */
  const phone = phoneForToken(req.headers.get("x-session-token"));
  if (!phone) {
    return NextResponse.json({ ok: false, error: "Sign in with your phone number to see your ads" }, { status: 401 });
  }

  const ads = findByPhone(phone);
  const leads = ads.flatMap((a) => listLeads(a.id));
  return NextResponse.json({ ok: true, phone, ads, leads });
}

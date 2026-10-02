/* Seller login: request a code, then swap it for a session token.
   POST { action: "request", phone }        → sends a 6-digit code
   POST { action: "verify", phone, code }   → { token }
   POST { action: "logout" }  + x-session-token
   GET  + x-session-token                   → who am I */

import { NextRequest, NextResponse } from "next/server";
import { endSession, phoneForToken, requestLoginCode, verifyLoginCode } from "@/lib/store";
import { loginDebugEnabled, sendCode } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const phone = phoneForToken(req.headers.get("x-session-token"));
  if (!phone) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  return NextResponse.json({ ok: true, phone });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const action = String(body.action ?? "");

  if (action === "request") {
    const result = requestLoginCode(String(body.phone ?? ""));
    if (!result.ok) {
      /* 429 for the cooldown so a client can tell "slow down" from "bad number". */
      return NextResponse.json(result, { status: result.retryIn ? 429 : 400 });
    }
    await sendCode(result.phone, result.code);

    /* The code is only ever echoed back in development. In production it goes
       out by SMS and nowhere else — returning it here would make the whole
       login pointless. */
    return NextResponse.json({
      ok: true,
      phone: result.phone,
      resendIn: result.resendIn,
      sent: true,
      ...(loginDebugEnabled() ? { devCode: result.code } : {}),
    });
  }

  if (action === "verify") {
    const result = verifyLoginCode(String(body.phone ?? ""), String(body.code ?? ""));
    if (!result.ok) return NextResponse.json(result, { status: 401 });
    return NextResponse.json(result);
  }

  if (action === "logout") {
    endSession(req.headers.get("x-session-token"));
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: `Unknown action “${action}”` }, { status: 400 });
}

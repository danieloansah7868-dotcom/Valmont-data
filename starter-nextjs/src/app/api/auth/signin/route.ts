import { NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/signin  { email, password }
 */
export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }
  const { rows } = await query("SELECT * FROM users WHERE email = $1", [String(email).toLowerCase()]);
  if (!rows[0] || !rows[0].password_hash) {
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }
  const ok = await verifyPassword(password, rows[0].password_hash);
  if (!ok) return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });

  const { password_hash, ...safe } = rows[0] as unknown as {
    password_hash: string;
    id: number; name: string; email: string; phone: string; tier: "member" | "reseller" | "dealer" | "wholesaler";
    wallet_balance: string; store_id: number | null; created_at: string;
  };
  await createSession(safe);
  return NextResponse.json({ user: safe });
}

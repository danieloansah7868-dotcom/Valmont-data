import { NextResponse } from "next/server";
import { createSession, hashPassword } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/signup  { name, email, phone, password }
 */
export async function POST(req: Request) {
  const { name, email, phone, password } = await req.json().catch(() => ({}));
  if (!name || !email || !/^(0\d{9}|\+233\d{9})$/.test(String(phone || "").replace(/\s/g, "")) || !password) {
    return NextResponse.json({ error: "Fill in name, email, a valid Ghana phone number and a password" }, { status: 400 });
  }
  if (String(password).length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  const dup = await query("SELECT id FROM users WHERE email = $1 OR phone = $2", [
    String(email).toLowerCase(),
    String(phone).replace(/\s/g, ""),
  ]);
  if (dup.rows[0]) {
    return NextResponse.json({ error: "An account with this email or phone already exists" }, { status: 409 });
  }
  const hash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO users (name, email, phone, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, email, phone, tier, wallet_balance, store_id, created_at`,
    [name, String(email).toLowerCase(), String(phone).replace(/\s/g, ""), hash]
  );
  await createSession(rows[0] as unknown as Parameters<typeof createSession>[0]);
  return NextResponse.json({ user: rows[0] }, { status: 201 });
}

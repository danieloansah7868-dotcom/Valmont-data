import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/wallet — balance + recent transactions (auth required) */
export async function GET() {
  const user = await requireUser();
  const txs = await query(
    `SELECT type, amount, ref, note, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [user.id]
  );
  return NextResponse.json({ balance: Number(user.wallet_balance), transactions: txs.rows });
}

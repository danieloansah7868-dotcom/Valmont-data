import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { genReference } from "@/lib/ids";
import { query } from "@/lib/db";
import { chargeMobileMoney, paystackConfigured } from "@/lib/paystack";

export const dynamic = "force-dynamic";

/**
 * POST /api/deposits
 * Body: { amount, phone, network }
 * Credits the user's wallet once Paystack confirms payment (webhook),
 * or immediately in dev mode without Paystack keys.
 */
export async function POST(req: Request) {
  const user = await requireUser();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const amount = Number(body.amount);
  const phone = String(body.phone || "").replace(/\s/g, "");
  const network = body.network;

  if (!amount || amount < 1) return NextResponse.json({ error: "Minimum deposit is GH₵1" }, { status: 400 });
  if (!/^(0\d{9}|\+233\d{9})$/.test(phone)) {
    return NextResponse.json({ error: "Enter a valid MoMo number" }, { status: 400 });
  }
  if (!["mtn", "telecel", "airteltigo"].includes(network)) {
    return NextResponse.json({ error: "Select your MoMo network" }, { status: 400 });
  }

  const reference = genReference("DEP");
  const channelMap: Record<string, "mobile_money_mtn" | "mobile_money_vodafone" | "mobile_money_gh"> = {
    mtn: "mobile_money_mtn",
    telecel: "mobile_money_vodafone",
    airteltigo: "mobile_money_gh",
  };

  if (paystackConfigured()) {
    // Pre-register the pending deposit so the webhook knows which user to credit
    await query(
      `INSERT INTO transactions (user_id, type, amount, ref, note) VALUES ($1, 'deposit', $2, $3, $4)`,
      [user.id, amount, reference, "Awaiting MoMo confirmation"]
    );
    await chargeMobileMoney({
      email: user.email,
      amountGhs: amount,
      reference,
      phone,
      channel: channelMap[network],
    });
    return NextResponse.json({
      payment: { reference, message: "Approve the Mobile Money prompt on your phone" },
    });
  }

  // Dev mode: credit the wallet directly
  await query("UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2", [amount, user.id]);
  await query(
    `INSERT INTO transactions (user_id, type, amount, ref, note) VALUES ($1, 'deposit', $2, $3, $4)`,
    [user.id, amount, reference, "Wallet deposit via " + network + " (dev mode)"]
  );
  return NextResponse.json({
    payment: { reference, message: "DEV MODE: deposit credited (no Paystack key configured)" },
    wallet_balance: Number(user.wallet_balance) + amount,
  });
}

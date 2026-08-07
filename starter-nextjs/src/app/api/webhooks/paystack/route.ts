import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { addEvent, runOrderPipeline } from "@/lib/orders";
import { verifyWebhookSignature } from "@/lib/paystack";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/paystack
 * Paystack calls this on payment events. We verify the HMAC signature,
 * then:
 *   - ORD-* reference  → mark order paid, start delivery pipeline
 *   - DEP-* reference  → credit the wallet + ledger row
 *
 * Configure the webhook URL in Paystack dashboard:
 *   https://your-domain.com/api/webhooks/paystack
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  // In dev mode (no keys) we accept the event so flows are testable.
  if (!verifyWebhookSignature(raw, signature) && process.env.PAYSTACK_SECRET_KEY) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(raw);
  if (event.event !== "charge.success") {
    return NextResponse.json({ received: true });
  }

  const ref: string = event.data?.reference || "";
  const amountGhs = Number(event.data?.amount || 0) / 100;

  if (ref.startsWith("ORD-")) {
    const { rows } = await query("SELECT id, public_id FROM orders WHERE momo_ref = $1", [ref]);
    if (!rows[0]) return NextResponse.json({ error: "Unknown order" }, { status: 404 });
    await query("UPDATE orders SET status = 'paid' WHERE id = $1", [rows[0].id]);
    await addEvent(rows[0].id, "paid", "Payment confirmed by Paystack");
    runOrderPipeline(rows[0].id, rows[0].public_id);
    return NextResponse.json({ received: true });
  }

  if (ref.startsWith("DEP-")) {
    // Credit the wallet that pre-registered this deposit reference,
    // then mark the ledger row as confirmed.
    const { rows } = await query(
      `UPDATE users u SET wallet_balance = wallet_balance + $1
       FROM transactions t
       WHERE t.ref = $2 AND t.type = 'deposit' AND t.user_id = u.id
       RETURNING u.id`,
      [amountGhs, ref]
    );
    if (!rows[0]) {
      console.warn("DEP webhook for unknown reference:", ref);
    } else {
      await query(`UPDATE transactions SET note = $1 WHERE ref = $2`, ["Wallet deposit confirmed", ref]);
    }
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
}

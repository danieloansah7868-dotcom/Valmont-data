import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getBundles, priceFor, tierOf } from "@/lib/pricing";
import { genOrderId, genReference } from "@/lib/ids";
import { addEvent, runOrderPipeline } from "@/lib/orders";
import { query } from "@/lib/db";
import { chargeMobileMoney, paystackConfigured } from "@/lib/paystack";

export const dynamic = "force-dynamic";

/**
 * POST /api/orders
 * Body: { network, bundle_gb, number, payment_method: "momo"|"wallet",
 *         momo_network?, idempotency_key }
 *
 * Flow:
 *  1. validate bundle + number
 *  2. momo  → create Paystack charge (order stays "unpaid" until webhook)
 *            → in dev without Paystack keys, payment is auto-approved
 *  3. wallet → debit balance + insert transaction, order is "paid" immediately
 *  4. paid orders enter the provider pipeline (delivery)
 */
export async function POST(req: Request) {
  const user = await getSession();
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const { network, bundle_gb, number, payment_method, momo_network, idempotency_key } = body;

  if (!["mtn", "telecel", "airteltigo"].includes(network)) {
    return NextResponse.json({ error: "Unknown network" }, { status: 400 });
  }
  if (!/^(0\d{9}|\+233\d{9})$/.test(String(number || "").replace(/\s/g, ""))) {
    return NextResponse.json({ error: "Enter a valid Ghana number, e.g. 024 000 0000" }, { status: 400 });
  }
  if (!["momo", "wallet"].includes(payment_method)) {
    return NextResponse.json({ error: "payment_method must be momo or wallet" }, { status: 400 });
  }
  if (payment_method === "wallet" && !user) {
    return NextResponse.json({ error: "Sign in to pay with your wallet" }, { status: 401 });
  }
  if (payment_method === "momo" && !["mtn", "telecel", "airteltigo"].includes(momo_network || "")) {
    return NextResponse.json({ error: "momo_network is required for MoMo payment" }, { status: 400 });
  }

  const tier = tierOf(user);
  const bundles = await getBundles(network);
  const bundle = bundles.find((b) => b.gb === Number(bundle_gb));
  if (!bundle) return NextResponse.json({ error: "Bundle not found" }, { status: 404 });
  const price = priceFor(bundle, tier);

  // idempotency: the same key can never create two orders
  if (idempotency_key) {
    const dup = await query("SELECT id FROM orders WHERE idempotency_key = $1", [idempotency_key]);
    if (dup.rows[0]) {
      return NextResponse.json({ error: "Duplicate order — this idempotency key was already used" }, { status: 409 });
    }
  }

  const publicId = genOrderId();
  const recipient = String(number).replace(/\s/g, "");

  const created = await query(
    `INSERT INTO orders (public_id, user_id, network, bundle_gb, price, recipient_phone, payment_method, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [publicId, user?.id || null, network, bundle.gb, price, recipient, payment_method, idempotency_key || null]
  );
  const orderDbId = Number(created.rows[0].id);
  await addEvent(orderDbId, "unpaid", "Order created — awaiting payment");

  /* ---- wallet payment: debit now, deliver now ---- */
  if (payment_method === "wallet") {
    if (Number(user!.wallet_balance) < price) {
      await query("UPDATE orders SET status = 'failed' WHERE id = $1", [orderDbId]);
      await addEvent(orderDbId, "failed", "Insufficient wallet balance");
      return NextResponse.json({ error: "Insufficient wallet balance — deposit first" }, { status: 402 });
    }
    await query("UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2", [price, user!.id]);
    await query(
      `INSERT INTO transactions (user_id, type, amount, ref, note) VALUES ($1, 'purchase', $2, $3, $4)`,
      [user!.id, price, publicId, `${bundle.gb}GB ${network} data for ${recipient}`]
    );
    await query("UPDATE orders SET status = 'paid' WHERE id = $1", [orderDbId]);
    await addEvent(orderDbId, "paid", "Paid from wallet");
    runOrderPipeline(orderDbId, publicId); // fire and forget
    return NextResponse.json({ order: { id: publicId, status: "processing", price } });
  }

  /* ---- MoMo payment: Paystack charge ---- */
  const reference = genReference("ORD");
  const channelMap: Record<string, "mobile_money_mtn" | "mobile_money_vodafone" | "mobile_money_gh"> = {
    mtn: "mobile_money_mtn",
    telecel: "mobile_money_vodafone",
    airteltigo: "mobile_money_gh",
  };

  if (paystackConfigured()) {
    await chargeMobileMoney({
      email: user?.email || `guest+${recipient}@valmontdata.com`,
      amountGhs: price,
      reference,
      phone: recipient,
      channel: channelMap[momo_network],
    });
    await query("UPDATE orders SET momo_ref = $1 WHERE id = $2", [reference, orderDbId]);
    return NextResponse.json({
      order: { id: publicId, status: "unpaid", price },
      payment: { reference, message: "Approve the Mobile Money prompt on your phone" },
    });
  }

  /* ---- Dev mode (no Paystack keys): auto-approve payment ---- */
  await query("UPDATE orders SET momo_ref = $1, status = 'paid' WHERE id = $2", [reference, orderDbId]);
  await addEvent(orderDbId, "paid", "Payment auto-approved (dev mode — set PAYSTACK_SECRET_KEY for real charges)");
  runOrderPipeline(orderDbId, publicId);
  return NextResponse.json({
    order: { id: publicId, status: "processing", price },
    payment: { reference, message: "DEV MODE: payment auto-approved (no Paystack key configured)" },
  });
}

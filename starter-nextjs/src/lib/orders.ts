/* ==========================================================================
   Order pipeline — runs after an order is PAID.

     paid → processing → (provider delivers) → delivered
                       → (provider fails)  → failed → auto-refund

   ⚠️  This starter drives the pipeline with setTimeout — fine for a
   long-lived Node server, but serverless platforms freeze after the
   response is sent. Before deploying serverless, move runOrderPipeline
   into a queue worker (BullMQ/Redis) or an idempotent cron. (The production
   app in ../../app solves this with the Valmont-Pay webhook + cron retry.)
   ========================================================================== */

import { query } from "@/lib/db";
import { getProvider } from "@/lib/providers";
import type { NetworkCode } from "@/lib/format";

export type OrderRow = {
  id: number;
  public_id: string;
  user_id: number | null;
  network: NetworkCode;
  bundle_gb: number;
  price: string | number; // NUMERIC comes back as string from pg
  recipient_phone: string;
  payment_method: "momo" | "wallet";
  provider_id: number | null;
  status: string;
};

/** Append a tracking event to the order's timeline. */
export async function addEvent(orderId: number, status: string, note?: string): Promise<void> {
  await query("INSERT INTO order_events (order_id, status, note) VALUES ($1, $2, $3)", [
    orderId,
    status,
    note || null,
  ]);
}

/**
 * Fire-and-forget entry point — called by /api/orders and the Paystack
 * webhook right after payment is confirmed. `publicId` is used for logs.
 */
export function runOrderPipeline(orderDbId: number, publicId: string): void {
  const delayMs = Number(process.env.MOCK_DELIVER_MS || "20000");
  const timer = setTimeout(() => {
    deliver(orderDbId).catch((e) =>
      console.error(`[pipeline] ${publicId}: delivery crashed —`, e)
    );
  }, delayMs);
  // Never keep the Node process alive just for a delivery timer.
  if (typeof timer.unref === "function") timer.unref();
  void markProcessing(orderDbId, publicId);
}

async function markProcessing(orderDbId: number, publicId: string): Promise<void> {
  try {
    await query("UPDATE orders SET status = 'processing' WHERE id = $1 AND status = 'paid'", [orderDbId]);
    await addEvent(orderDbId, "processing", "Paid — sent to provider for delivery");
  } catch (e) {
    console.error(`[pipeline] ${publicId}: could not mark processing —`, e);
  }
}

async function deliver(orderDbId: number): Promise<void> {
  const { rows } = await query("SELECT * FROM orders WHERE id = $1", [orderDbId]);
  const order = rows[0] as OrderRow | undefined;
  if (!order || ["delivered", "failed", "refunded"].includes(order.status)) return;

  // Pick the best active provider row for this network (lowest priority
  // number wins) and pin it on the order for the audit trail.
  const prov = await query(
    "SELECT id, name FROM providers WHERE network = $1 AND active = true ORDER BY priority LIMIT 1",
    [order.network]
  );
  const providerRow = prov.rows[0] as { id: number; name: string } | undefined;
  if (providerRow) {
    await query("UPDATE orders SET provider_id = $1 WHERE id = $2", [providerRow.id, orderDbId]);
  }

  const driver = getProvider(providerRow?.name);
  const result = await driver.submit({
    reference: order.public_id,
    network: order.network,
    gb: order.bundle_gb,
    phone: order.recipient_phone,
    attempts: 1,
  });

  if (result.ok) {
    await query("UPDATE orders SET status = 'delivered', delivered_at = now() WHERE id = $1", [orderDbId]);
    await addEvent(
      orderDbId,
      "delivered",
      `Delivered by ${driver.name}${result.ref ? ` (${result.ref})` : ""}`
    );
    return;
  }

  /* ---- failure → auto-refund ---- */
  await query("UPDATE orders SET status = 'failed' WHERE id = $1", [orderDbId]);
  await addEvent(orderDbId, "failed", `Delivery failed (${driver.name}): ${result.error}`);

  if (order.payment_method === "wallet" && order.user_id) {
    // Wallet orders refund instantly and leave a ledger row — the wallet
    // never moves without a matching transactions entry.
    await query("UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2", [
      order.price,
      order.user_id,
    ]);
    await query(
      `INSERT INTO transactions (user_id, type, amount, ref, note) VALUES ($1, 'refund', $2, $3, $4)`,
      [
        order.user_id,
        order.price,
        order.public_id,
        `Auto-refund: ${order.bundle_gb}GB ${order.network} delivery failed`,
      ]
    );
    await query("UPDATE orders SET status = 'refunded' WHERE id = $1", [orderDbId]);
    await addEvent(orderDbId, "refunded", "Wallet auto-refunded in full");
  } else {
    // Guest MoMo refund goes through the Paystack dashboard/API manually —
    // automating it is on the going-live checklist (see README).
    await addEvent(orderDbId, "failed", "MoMo order — manual Paystack refund required");
    console.warn(`[pipeline] ${order.public_id}: delivery failed — refund GH₵${order.price} to the customer manually`);
  }
}

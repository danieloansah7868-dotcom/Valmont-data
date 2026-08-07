import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/orders/:publicId
 * Order + full event timeline — powers the public tracking page.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const publicId = String(id).toUpperCase();

  const { rows } = await query(
    `SELECT o.id, o.public_id, o.network, o.bundle_gb, o.price, o.recipient_phone,
            o.payment_method, o.status, o.created_at, o.delivered_at
     FROM orders o WHERE o.public_id = $1`,
    [publicId]
  );
  if (!rows[0]) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const events = await query(
    `SELECT status, note, created_at FROM order_events WHERE order_id = $1 ORDER BY created_at`,
    [rows[0].id]
  );

  return NextResponse.json({ order: rows[0], events: events.rows });
}

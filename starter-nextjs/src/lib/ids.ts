/* ==========================================================================
   Public order IDs + payment references.
   ========================================================================== */

/** Customer-facing order id: VD-260802-4831 (VD-<yymmdd>-<4 digits>). */
export function genOrderId(date: Date = new Date()): string {
  const yymmdd = date.toISOString().slice(2, 10).replace(/-/g, "");
  return `VD-${yymmdd}-${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * Payment reference stored on orders.momo_ref / transactions.ref and echoed
 * back by the Paystack webhook. The webhook routes on the prefix:
 * ORD-* → order payment, DEP-* → wallet deposit.
 */
export function genReference(prefix: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${ts}${rand}`;
}

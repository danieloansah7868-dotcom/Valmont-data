/* ==========================================================================
   Shared display constants + formatters (ported from the prototype's
   assets/js/data.js — keep the two in sync).
   ========================================================================== */

export type NetworkCode = "mtn" | "telecel" | "airteltigo";

export const NETWORKS: Record<
  NetworkCode,
  { name: string; short: string; color: string; badge: string }
> = {
  mtn: { name: "MTN", short: "MTN", color: "#ffcb05", badge: "No Expiry" },
  telecel: { name: "Telecel", short: "Telecel", color: "#ff4d3d", badge: "60-Day Rollover" },
  airteltigo: { name: "AirtelTigo", short: "AT iShare", color: "#3d8bff", badge: "60-Day Rollover" },
};

export const NETWORK_CODES = Object.keys(NETWORKS) as NetworkCode[];

/** GH₵12.50 — always 2dp, no fake "was" prices anywhere in the app. */
export function ghs(amount: number | string): string {
  return "GH₵" + Number(amount).toFixed(2);
}

/** "7 Aug 2026, 2:04 pm" — compact timestamp for order timelines. */
export function fmtDateTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

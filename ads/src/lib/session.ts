/* ============================================================================
   Seller sessions — proving you own a phone number before we show you its
   messages.

   The problem this fixes:
     /api/my-ads used to take a phone number in the query string and hand back
     that seller's ads AND every buyer message sent to them. Anyone who typed a
     stranger's number saw their leads: names, phone numbers, message text.
     Phone numbers are printed on the ads themselves, so this was not even a
     guess — it was copy and paste.

   The fix, sized for the job:
     A 6-digit code is sent to the number, exchanged for an opaque token, and
     the token is what /api/my-ads accepts. No passwords, no email, no signup —
     a seller here has never created an account and never should have to. It is
     the same flow they already know from mobile money.

   Honest about the current limits:
     • Delivery is not wired to an SMS gateway yet, so in dev the code is
       returned in the response and printed to the server log. LOGIN_DEBUG
       controls that, and it MUST be off in production or the door is still
       open. See sendCode() below.
     • Sessions live in the same JSON store as everything else, so they share
       its fate on a read-only filesystem (see README, "Do we need Supabase?").
     • This proves control of a phone NUMBER, not identity. Someone holding the
       SIM is the seller as far as we are concerned. That is the right level of
       proof for a free classifieds site; the ID Verified badge is where real
       identity gets checked.

   Server-side only.
   ========================================================================== */

import crypto from "node:crypto";

export const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes to type 6 digits
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days signed in
export const MAX_ATTEMPTS = 5; // wrong guesses before the code dies
export const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between sends

/** Codes are only returned to the caller in dev. Never enable in production. */
export function loginDebugEnabled(): boolean {
  if (process.env.LOGIN_DEBUG === "1") return true;
  if (process.env.LOGIN_DEBUG === "0") return false;
  return process.env.NODE_ENV !== "production";
}

export interface LoginCode {
  phone: string;
  /** Stored hashed — a leaked store file should not hand over live codes. */
  codeHash: string;
  expiresAt: string;
  attempts: number;
  sentAt: string;
}

export interface Session {
  /** Opaque bearer token. The client keeps this, never the phone alone. */
  token: string;
  phone: string;
  createdAt: string;
  expiresAt: string;
}

/** Six digits, evenly distributed. Math.random() is not good enough for auth. */
export function generateCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(phone: string, code: string): string {
  return crypto.createHash("sha256").update(`${phone}:${code}`).digest("hex");
}

/** Constant-time compare so a timing signal cannot leak the code. */
export function codeMatches(phone: string, code: string, hash: string): boolean {
  const candidate = Buffer.from(hashCode(phone, code));
  const expected = Buffer.from(hash);
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Deliver the code to the seller.
 *
 * Not yet connected to an SMS provider. It logs, and — in dev only — the route
 * echoes the code back so the flow is testable without a gateway. When an SMS
 * account exists, this is the single function to change: everything else in
 * the login flow is already provider-agnostic.
 */
export async function sendCode(phone: string, code: string): Promise<void> {
  console.log(`[valmont-ads] login code for ${phone}: ${code}`);
}

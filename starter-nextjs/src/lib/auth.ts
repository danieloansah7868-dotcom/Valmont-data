import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { query } from "@/lib/db";

/* ==========================================================================
   Lightweight session auth (JWT in an httpOnly cookie).
   Swap for NextAuth/Auth.js later if you want Google OAuth out of the box —
   the rest of the app only depends on getSession()/requireUser().
   ========================================================================== */

export type User = {
  id: number;
  name: string;
  email: string;
  phone: string;
  tier: "member" | "reseller" | "dealer" | "wholesaler";
  wallet_balance: string; // NUMERIC comes back as string from pg
  store_id: number | null;
  created_at: string;
};

const COOKIE = "vd_session";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET || "dev-only-secret-change-me");

export async function createSession(user: User) {
  const token = await new SignJWT({ uid: user.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const uid = Number(payload.uid);
    if (!uid) return null;
    const { rows } = await query("SELECT * FROM users WHERE id = $1", [uid]);
    if (!rows[0]) return null;
    return rows[0] as User;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<User> {
  const user = await getSession();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export function toPublicUser(u: User) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, tier: u.tier };
}

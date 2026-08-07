import { NextResponse } from "next/server";
import { getSession, toPublicUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/auth/session — current user (or null) */
export async function GET() {
  const user = await getSession();
  return NextResponse.json({ user: user ? toPublicUser(user) : null });
}

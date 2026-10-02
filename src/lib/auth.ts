/**
 * Anonymous session auth: a signed httpOnly cookie identifies the user. Uploaded books are
 * scoped to this user id and never listed to anyone else. Can be swapped for a full auth provider later.
 */
import { cookies } from "next/headers";
import crypto from "node:crypto";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

const COOKIE = "abx_session";
const SECRET = process.env.SESSION_SECRET ?? "dev-session-secret-change-me";

function sign(id: string): string {
  return `${id}.${crypto.createHmac("sha256", SECRET).update(id).digest("base64url")}`;
}
function verify(token: string | undefined): string | null {
  if (!token) return null;
  const [id, sig] = token.split(".");
  if (!id || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(id).digest("base64url");
  const supplied = Buffer.from(sig);
  const wanted = Buffer.from(expected);
  if (supplied.length !== wanted.length) return null;
  return crypto.timingSafeEqual(supplied, wanted) ? id : null;
}

/** Returns the current user id, creating a user + cookie when missing. */
export async function getUserId(): Promise<string> {
  const jar = await cookies();
  const existing = verify(jar.get(COOKIE)?.value);
  if (existing) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, existing)).limit(1);
    if (u) return u.id;
  }
  const [created] = await db.insert(users).values({}).returning({ id: users.id });
  try {
    jar.set(COOKIE, sign(created.id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === "production" });
  } catch {
    /* cookies can't be set from server components; the API routes will set it */
  }
  return created.id;
}

export async function getSettings(userId: string) {
  const [u] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.settings ?? {};
}

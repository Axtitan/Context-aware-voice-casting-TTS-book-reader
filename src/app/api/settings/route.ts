import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, type UserSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserId } from "@/lib/auth";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getUserId();
  const [u] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId)).limit(1);
  return NextResponse.json({ settings: u?.settings ?? {} });
}

export async function PUT(req: Request) {
  const userId = await getUserId();
  const body = (await req.json().catch(() => ({}))) as UserSettings;
  const clean: UserSettings = {};
  if (["light", "dark", "system"].includes(body.theme ?? "")) clean.theme = body.theme;
  if (typeof body.defaultSpeed === "number" && body.defaultSpeed >= 0.5 && body.defaultSpeed <= 3) clean.defaultSpeed = body.defaultSpeed;
  if (typeof body.autoplayNext === "boolean") clean.autoplayNext = body.autoplayNext;
  if (typeof body.defaultNarratorVoiceId === "string") clean.defaultNarratorVoiceId = body.defaultNarratorVoiceId.slice(0, 80);
  if (body.defaultMode === "single" || body.defaultMode === "multi") clean.defaultMode = body.defaultMode;
  if (body.audioQuality === "standard" || body.audioQuality === "high") clean.audioQuality = body.audioQuality;
  const [u] = await db.select({ settings: users.settings }).from(users).where(eq(users.id, userId)).limit(1);
  const merged = { ...(u?.settings ?? {}), ...clean };
  await db.update(users).set({ settings: merged }).where(eq(users.id, userId));
  return NextResponse.json({ settings: merged });
}

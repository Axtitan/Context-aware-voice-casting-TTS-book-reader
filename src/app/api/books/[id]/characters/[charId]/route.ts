import { NextResponse } from "next/server";
import { db } from "@/db";
import { characters, chapters } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ownedBook } from "@/lib/books/access";
import { allVoices } from "@/lib/tts";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/** PATCH /api/books/:id/characters/:charId – user override: change voice, lock, reset to AI pick. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; charId: string }> }) {
  const { id, charId } = await params;
  const { book } = await ownedBook(id);
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [c] = await db.select().from(characters).where(and(eq(characters.id, charId), eq(characters.bookId, id))).limit(1);
  if (!c) return NextResponse.json({ error: "Character not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { voiceId?: string; locked?: boolean; reset?: boolean };
  const patch: Partial<typeof characters.$inferInsert> = {};
  if (body.reset) {
    patch.voiceId = c.aiVoiceId ?? c.voiceId;
    patch.voiceSource = "ai";
    patch.voiceLocked = false;
  }
  if (typeof body.voiceId === "string") {
    const voices = await allVoices();
    if (!voices.some((v) => v.id === body.voiceId)) return NextResponse.json({ error: "Unknown voice" }, { status: 400 });
    patch.voiceId = body.voiceId;
    patch.voiceSource = "user"; // AI must never overwrite this later
    patch.voiceConfidence = 1;
  }
  if (typeof body.locked === "boolean") patch.voiceLocked = body.locked;
  await db.update(characters).set(patch).where(eq(characters.id, charId));
  if (patch.voiceId && patch.voiceId !== c.voiceId) {
    // Voice changed: chapter renders are stale (segment cache for other voices remains valid)
    await db.update(chapters).set({ audioStatus: "none", audioPath: null, durationMs: 0, audioProgress: 0 }).where(eq(chapters.bookId, id));
  }
  const [updated] = await db.select().from(characters).where(eq(characters.id, charId)).limit(1);
  return NextResponse.json({ character: updated });
}

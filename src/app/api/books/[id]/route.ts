import { NextResponse } from "next/server";
import { db } from "@/db";
import { books, chapters, characters, jobs, playbackProgress } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { ownedBook } from "@/lib/books/access";
import { allVoices } from "@/lib/tts";
import { storage } from "@/lib/storage";
import { describeRequirements, detectCollisions } from "@/lib/casting/cast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/books/:id – full book detail: chapters, cast, jobs, progress, voice pool. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, book } = await ownedBook(id);
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [chs, chars, jobRows, prog, voices] = await Promise.all([
    db.select().from(chapters).where(eq(chapters.bookId, id)).orderBy(asc(chapters.order)),
    db.select().from(characters).where(eq(characters.bookId, id)).orderBy(desc(characters.lineCount), desc(characters.mentionCount)),
    db.select().from(jobs).where(eq(jobs.bookId, id)).orderBy(desc(jobs.createdAt)).limit(5),
    db.select().from(playbackProgress).where(and(eq(playbackProgress.bookId, id), eq(playbackProgress.userId, userId))).limit(1),
    allVoices(),
  ]);
  const pool = voices.filter((v) => v.engine === (book.engine ?? "kokoro"));
  const castable = chars.map((c) => ({ id: c.id, name: c.name, gender: c.gender as "male" | "female" | null, genderConfidence: c.genderConfidence ?? 0, age: c.age, nationality: c.nationality, accent: c.accent, vocalDescriptions: c.vocalDescriptions, personality: c.personality, importance: c.importance, isNarrator: c.isNarrator, voiceId: c.voiceId, voiceSource: c.voiceSource, voiceLocked: c.voiceLocked }));
  const warnings = detectCollisions(castable, chars.filter((c) => c.voiceId).map((c) => ({ characterId: c.id, voiceId: c.voiceId!, confidence: c.voiceConfidence ?? 0, reason: c.voiceReason ?? "", shared: c.voiceShared })), pool);
  return NextResponse.json({
    book,
    chapters: chs,
    characters: chars.map((c, i) => ({ ...c, requirements: describeRequirements(castable[i]) })),
    jobs: jobRows,
    progress: prog[0] ?? null,
    voices: pool,
    warnings,
  });
}

/** PATCH /api/books/:id – update narration mode / narrator voice / metadata. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { book } = await ownedBook(id);
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Partial<{ narrationMode: "single" | "multi"; narratorVoiceId: string; title: string; author: string }>;
  const patch: Partial<typeof books.$inferInsert> = { updatedAt: new Date() };
  if (body.narrationMode === "single" || body.narrationMode === "multi") patch.narrationMode = body.narrationMode;
  if (typeof body.narratorVoiceId === "string") {
    const voices = await allVoices();
    if (!voices.some((v) => v.id === body.narratorVoiceId)) return NextResponse.json({ error: "Unknown voice" }, { status: 400 });
    patch.narratorVoiceId = body.narratorVoiceId;
  }
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim().slice(0, 300);
  if (typeof body.author === "string") patch.author = body.author.trim().slice(0, 300) || null;
  const modeChanged = patch.narrationMode && patch.narrationMode !== book.narrationMode;
  const narratorChanged = patch.narratorVoiceId && patch.narratorVoiceId !== book.narratorVoiceId;
  await db.update(books).set(patch).where(eq(books.id, id));
  if (modeChanged || narratorChanged) {
    // Generated audio depends on mode/narrator; invalidate chapter renders (segment cache stays valid).
    await db.update(chapters).set({ audioStatus: "none", audioPath: null, durationMs: 0, audioProgress: 0 }).where(eq(chapters.bookId, id));
    if (narratorChanged) {
      const { recastBook } = await import("@/lib/jobs/analyze");
      await recastBook(id);
    }
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { book } = await ownedBook(id);
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.update(jobs).set({ status: "cancelled" }).where(and(eq(jobs.bookId, id), eq(jobs.status, "queued")));
  await db.delete(books).where(eq(books.id, id));
  await storage.deletePrefix(`books/${id}`).catch(() => {});
  await storage.deletePrefix(`audio/${id}`).catch(() => {});
  return NextResponse.json({ ok: true });
}

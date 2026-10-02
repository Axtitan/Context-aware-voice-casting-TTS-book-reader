import { NextResponse } from "next/server";
import { db } from "@/db";
import { chapters, playbackProgress } from "@/db/schema";
import { ownedBook } from "@/lib/books/access";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/** PUT /api/books/:id/progress – persist playback position (continue listening). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { userId, book } = await ownedBook(id);
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { chapterId?: string; positionMs?: number; completed?: boolean };
  const rawPosition = Number(body.positionMs ?? 0);
  if (!Number.isFinite(rawPosition)) return NextResponse.json({ error: "Invalid playback position" }, { status: 400 });
  let chapterId: string | null = null;
  if (body.chapterId) {
    const [chapter] = await db.select({ id: chapters.id }).from(chapters).where(and(eq(chapters.id, body.chapterId), eq(chapters.bookId, id))).limit(1);
    if (!chapter) return NextResponse.json({ error: "Chapter not found" }, { status: 400 });
    chapterId = chapter.id;
  }
  const positionMs = Math.max(0, Math.round(rawPosition));
  await db
    .insert(playbackProgress)
    .values({ userId, bookId: id, chapterId, positionMs, completed: !!body.completed })
    .onConflictDoUpdate({ target: [playbackProgress.userId, playbackProgress.bookId], set: { chapterId, positionMs, completed: !!body.completed, updatedAt: new Date() } });
  return NextResponse.json({ ok: true });
}

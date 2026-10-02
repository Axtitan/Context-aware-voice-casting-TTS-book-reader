import { NextResponse } from "next/server";
import { db } from "@/db";
import { chapters, segments, characters } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { ownedBook } from "@/lib/books/access";
import { loadBlocks } from "@/lib/jobs/analyze";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/** GET /api/books/:id/chapters/:chapterId – segments (with timings + speakers) and reading text. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; chapterId: string }> }) {
  const { id, chapterId } = await params;
  const { book } = await ownedBook(id);
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [ch] = await db.select().from(chapters).where(and(eq(chapters.id, chapterId), eq(chapters.bookId, id))).limit(1);
  if (!ch) return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  const segs = await db.select().from(segments).where(eq(segments.chapterId, chapterId)).orderBy(asc(segments.order));
  const chars = await db.select({ id: characters.id, name: characters.name, voiceId: characters.voiceId }).from(characters).where(eq(characters.bookId, id));
  const wantText = new URL(req.url).searchParams.get("text") === "1";
  let blocks: { type: string; text: string; level?: number }[] = [];
  if (wantText) {
    const all = await loadBlocks(id).catch(() => []);
    blocks = all.slice(ch.startBlock, ch.endBlock);
  }
  return NextResponse.json({ chapter: ch, segments: segs, characters: chars, blocks, audioUrl: ch.audioStatus === "ready" ? `/api/audio/${id}/chapters/${ch.id}.wav` : null });
}

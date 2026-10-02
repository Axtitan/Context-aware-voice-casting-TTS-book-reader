import { NextResponse } from "next/server";
import { db } from "@/db";
import { books, chapters, playbackProgress, jobs } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getUserId } from "@/lib/auth";
import { detectFormat, validateMagic } from "@/lib/ingestion/extract";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { createBookFromBuffer } from "@/lib/books/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/books – the caller's private library with progress + latest job. */
export async function GET() {
  const userId = await getUserId();
  const rows = await db.select().from(books).where(eq(books.userId, userId)).orderBy(desc(books.updatedAt));
  const ids = rows.map((b) => b.id);
  const progress = ids.length ? await db.select().from(playbackProgress).where(and(eq(playbackProgress.userId, userId), inArray(playbackProgress.bookId, ids))) : [];
  const chs = ids.length ? await db.select({ bookId: chapters.bookId, order: chapters.order, id: chapters.id, durationMs: chapters.durationMs, audioStatus: chapters.audioStatus, title: chapters.title }).from(chapters).where(inArray(chapters.bookId, ids)) : [];
  const latestJobs = ids.length ? await db.select().from(jobs).where(inArray(jobs.bookId, ids)).orderBy(desc(jobs.createdAt)) : [];
  const out = rows.map((b) => {
    const p = progress.find((x) => x.bookId === b.id);
    const bookChapters = chs.filter((c) => c.bookId === b.id).sort((a, c) => a.order - c.order);
    const ready = bookChapters.filter((c) => c.audioStatus === "ready");
    const totalMs = bookChapters.reduce((n, c) => n + (c.durationMs ?? 0), 0);
    let listenedMs = 0;
    if (p?.chapterId) {
      for (const c of bookChapters) {
        if (c.id === p.chapterId) {
          listenedMs += p.positionMs;
          break;
        }
        listenedMs += c.durationMs ?? 0;
      }
    }
    const job = latestJobs.find((j) => j.bookId === b.id);
    return {
      ...b,
      chapterCount: bookChapters.length,
      readyChapters: ready.length,
      totalMs,
      percent: p?.completed ? 100 : totalMs ? Math.min(100, Math.round((listenedMs / totalMs) * 100)) : 0,
      lastChapterTitle: bookChapters.find((c) => c.id === p?.chapterId)?.title ?? null,
      lastPositionMs: p?.positionMs ?? 0,
      lastPlayedAt: p?.updatedAt ?? null,
      completed: p?.completed ?? false,
      job: job ? { id: job.id, type: job.type, status: job.status, stage: job.stage, progress: job.progress, stats: job.stats, error: job.error } : null,
    };
  });
  return NextResponse.json({ books: out });
}

/** POST /api/books – multipart upload. Validates type/size/magic bytes, stores privately, enqueues analysis. */
export async function POST(req: Request) {
  try {
    const userId = await getUserId();
    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: "The selected file is empty" }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: `File exceeds ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit` }, { status: 413 });
    const format = detectFormat(file.name, file.type);
    if (!format) return NextResponse.json({ error: "Unsupported file type. Use PDF, EPUB, DOCX, DOC or TXT." }, { status: 415 });
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!validateMagic(buffer, format)) return NextResponse.json({ error: `File content does not look like a valid ${format.toUpperCase()}` }, { status: 415 });
    const narrationMode = form.get("mode") === "single" ? "single" : "multi";
    const narratorVoiceId = typeof form.get("narratorVoiceId") === "string" ? String(form.get("narratorVoiceId")) || null : null;
    const title = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || "Untitled";
    const { book, job } = await createBookFromBuffer({ userId, buffer, filename: file.name, format, title, sourceType: "upload", sourceLicense: "Private upload", narrationMode, narratorVoiceId });
    return NextResponse.json({ book, job }, { status: 201 });
  } catch (e) {
    console.error("[upload] failed", e);
    const message = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: `Upload failed: ${message}` }, { status: 500 });
  }
}

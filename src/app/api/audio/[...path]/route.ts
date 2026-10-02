import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { ownedBook } from "@/lib/books/access";
import { storage } from "@/lib/storage";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/** GET /api/audio/:bookId/chapters/:file – authenticated, range-capable audio streaming from private storage. */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const [bookId, kind, file] = path;
  if (!bookId || kind !== "chapters" || !file || !/^[0-9a-f-]{36}\.wav$/i.test(file)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { book } = await ownedBook(bookId);
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let abs: string;
  try {
    abs = storage.resolve(`audio/${bookId}/chapters/${file}`);
    await fs.access(abs);
  } catch {
    return NextResponse.json({ error: "Audio not generated yet" }, { status: 404 });
  }
  const { size } = await fs.stat(abs);
  const range = req.headers.get("range");
  const headers: Record<string, string> = { "content-type": "audio/wav", "accept-ranges": "bytes", "cache-control": "private, max-age=3600" };
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!m || (!m[1] && !m[2])) return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    let start: number;
    let end: number;
    if (!m[1]) {
      const suffix = Math.max(1, Number(m[2]));
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
      return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    headers["content-range"] = `bytes ${start}-${end}/${size}`;
    headers["content-length"] = String(end - start + 1);
    return new NextResponse(Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream, { status: 206, headers });
  }
  headers["content-length"] = String(size);
  return new NextResponse(Readable.toWeb(createReadStream(abs)) as ReadableStream, { status: 200, headers });
}

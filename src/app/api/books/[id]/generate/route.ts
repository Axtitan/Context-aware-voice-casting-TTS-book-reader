import { NextResponse } from "next/server";
import { ownedBook } from "@/lib/books/access";
import { enqueue } from "@/lib/jobs";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/** POST /api/books/:id/generate – enqueue audiobook generation (optionally specific chapters). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { book } = await ownedBook(id);
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!["ready", "generating"].includes(book.status)) return NextResponse.json({ error: "Book analysis is not complete yet" }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { chapterIds?: string[] };
  const job = await enqueue(id, "generate_audio", body.chapterIds?.length ? { chapterIds: body.chapterIds } : {});
  return NextResponse.json({ job }, { status: 202 });
}

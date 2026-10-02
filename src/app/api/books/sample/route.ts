import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { createBookFromBuffer } from "@/lib/books/service";
import { SAMPLE_AUTHOR, SAMPLE_TEXT, SAMPLE_TITLE } from "@/lib/books/sample";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/** POST /api/books/sample – add the bundled demo story to the library and analyse it. */
export async function POST(req: Request) {
  const userId = await getUserId();
  const body = (await req.json().catch(() => ({}))) as { mode?: "single" | "multi" };
  const { book, job } = await createBookFromBuffer({ userId, buffer: Buffer.from(SAMPLE_TEXT, "utf8"), filename: "lamplighter.txt", format: "txt", title: SAMPLE_TITLE, author: SAMPLE_AUTHOR, sourceType: "sample", sourceLicense: "CC0 (demo)", narrationMode: body.mode ?? "multi" });
  return NextResponse.json({ book, job }, { status: 201 });
}

import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { importFreeBook } from "@/lib/books/service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const userId = await getUserId();
  const body = (await req.json().catch(() => ({}))) as { sourceId?: string; mode?: "single" | "multi"; narratorVoiceId?: string };
  if (!body.sourceId || !/^\d{1,7}$/.test(body.sourceId)) return NextResponse.json({ error: "sourceId required" }, { status: 400 });
  try {
    const { book, job } = await importFreeBook(userId, body.sourceId, { narrationMode: body.mode, narratorVoiceId: body.narratorVoiceId ?? null });
    return NextResponse.json({ book, job }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

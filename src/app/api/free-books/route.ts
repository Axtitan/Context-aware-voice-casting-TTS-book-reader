import { NextResponse } from "next/server";
import { searchFreeBooks, FEATURED_FREE_BOOKS } from "@/lib/books/service";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 120);
  const topic = (url.searchParams.get("topic") ?? "").slice(0, 60) || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
  try {
    const data = await searchFreeBooks(q, { topic, page });
    return NextResponse.json({ ...data, featured: FEATURED_FREE_BOOKS, source: { name: "Project Gutenberg", url: "https://www.gutenberg.org", via: "Gutendex API" } });
  } catch (e) {
    return NextResponse.json({ error: `Could not reach Project Gutenberg catalog: ${(e as Error).message}`, results: [], total: 0, next: false, featured: FEATURED_FREE_BOOKS }, { status: 502 });
  }
}

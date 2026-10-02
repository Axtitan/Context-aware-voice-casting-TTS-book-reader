import { NextResponse } from "next/server";
import { db } from "@/db";
import { jobs, books } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserId } from "@/lib/auth";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserId();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [row] = await db.select({ job: jobs, status: books.status, error: books.error }).from(jobs).innerJoin(books, eq(books.id, jobs.bookId)).where(and(eq(jobs.id, id), eq(books.userId, userId))).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job: row.job, bookStatus: row.status, bookError: row.error });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getUserId();
  const [row] = await db.select({ id: jobs.id }).from(jobs).innerJoin(books, eq(books.id, jobs.bookId)).where(and(eq(jobs.id, id), eq(books.userId, userId))).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.update(jobs).set({ status: "cancelled", stage: "Cancelled" }).where(eq(jobs.id, id));
  return NextResponse.json({ ok: true });
}

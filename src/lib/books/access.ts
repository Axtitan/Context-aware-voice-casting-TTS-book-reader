import { db } from "@/db";
import { books } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getUserId } from "@/lib/auth";

/** Load a book only if it belongs to the current session user. */
export async function ownedBook(id: string) {
  const userId = await getUserId();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { userId, book: null };
  const [book] = await db.select().from(books).where(and(eq(books.id, id), eq(books.userId, userId))).limit(1);
  return { userId, book: book ?? null };
}

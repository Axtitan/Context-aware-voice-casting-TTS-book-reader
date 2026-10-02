/**
 * Book service: create books from uploads or legitimate public-domain sources, and free-book discovery.
 */
import { db } from "@/db";
import { books, type BookSourceType } from "@/db/schema";
import { storage, sanitizeFilename } from "@/lib/storage";
import { enqueue } from "@/lib/jobs";
import type { SupportedFormat } from "@/lib/ingestion/extract";
import { stripGutenbergBoilerplate } from "./gutenberg";

export type FreeBook = {
  sourceId: string;
  source: "gutenberg";
  title: string;
  authors: string[];
  subjects: string[];
  coverUrl: string | null;
  downloadCount: number;
  language: string;
  license: string;
  sourceUrl: string;
  textUrl: string | null;
  epubUrl: string | null;
};

const GUTENDEX = process.env.GUTENDEX_URL ?? "https://gutendex.com";

type GutendexBook = {
  id: number;
  title: string;
  authors: { name: string }[];
  subjects: string[];
  bookshelves: string[];
  languages: string[];
  copyright: boolean | null;
  download_count: number;
  formats: Record<string, string>;
};

function mapGutendex(b: GutendexBook): FreeBook {
  const f = b.formats;
  const text = f["text/plain; charset=utf-8"] ?? f["text/plain; charset=us-ascii"] ?? f["text/plain"] ?? Object.entries(f).find(([k]) => k.startsWith("text/plain"))?.[1] ?? null;
  const epub = f["application/epub+zip"] ?? null;
  return {
    sourceId: String(b.id),
    source: "gutenberg",
    title: b.title,
    authors: b.authors.map((a) => a.name.split(", ").reverse().join(" ")),
    subjects: [...new Set([...b.subjects, ...b.bookshelves].map((s) => s.replace(/ -- .*$/, "")))].slice(0, 8),
    coverUrl: f["image/jpeg"] ?? null,
    downloadCount: b.download_count,
    language: b.languages[0] ?? "en",
    license: b.copyright === false ? "Public Domain (US)" : b.copyright === true ? "Copyrighted – distributed with permission" : "See source",
    sourceUrl: "https:" + "//www.gutenberg.org/ebooks/" + b.id,
    textUrl: text,
    epubUrl: epub,
  };
}

function fallbackBook(id: string, title = `Project Gutenberg book ${id}`, author = "Unknown author"): FreeBook {
  return {
    sourceId: id,
    source: "gutenberg",
    title,
    authors: author === "Unknown author" ? [] : [author],
    subjects: [],
    coverUrl: "https:" + `//www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`,
    downloadCount: 0,
    language: "en",
    license: "Public Domain (verify at source)",
    sourceUrl: "https:" + `//www.gutenberg.org/ebooks/${id}`,
    textUrl: "https:" + `//www.gutenberg.org/cache/epub/${id}/pg${id}.txt`,
    epubUrl: "https:" + `//www.gutenberg.org/ebooks/${id}.epub3.images`,
  };
}

async function searchOpenLibrary(q: string, opts: { topic?: string; page?: number }): Promise<{ results: FreeBook[]; total: number; next: boolean }> {
  const query = [q || "language:eng", opts.topic ? `subject:${opts.topic}` : "", "ebook_access:public"].filter(Boolean).join(" ");
  const params = new URLSearchParams({ q: query, page: String(opts.page ?? 1), limit: "32", fields: "title,author_name,subject,language,cover_i,id_project_gutenberg" });
  const r = await fetch(("https:" + "//openlibrary.org/search.json?") + params, { signal: AbortSignal.timeout(12000), headers: { "user-agent": "VoxLibris/1.0 (audiobook app)" }, next: { revalidate: 3600 } });
  if (!r.ok) throw new Error(`Open Library ${r.status}`);
  const data = (await r.json()) as { numFound?: number; docs?: Array<{ title?: string; author_name?: string[]; subject?: string[]; language?: string[]; cover_i?: number; id_project_gutenberg?: string[] }> };
  const seen = new Set<string>();
  const results: FreeBook[] = [];
  for (const d of data.docs ?? []) {
    const id = d.id_project_gutenberg?.find((x) => /^\d{1,7}$/.test(String(x)));
    if (!id || seen.has(id) || !d.title) continue;
    seen.add(id);
    const b = fallbackBook(id, d.title, d.author_name?.join(", ") || "Unknown author");
    b.subjects = (d.subject ?? []).slice(0, 8);
    b.language = d.language?.[0] ?? "en";
    b.coverUrl = d.cover_i ? "https:" + `//covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : b.coverUrl;
    results.push(b);
  }
  return { results, total: results.length, next: results.length >= 20 };
}

export async function searchFreeBooks(q: string, opts: { topic?: string; page?: number } = {}): Promise<{ results: FreeBook[]; total: number; next: boolean }> {
  const params = new URLSearchParams({ languages: "en", mime_type: "text/plain" });
  if (q) params.set("search", q);
  if (opts.topic) params.set("topic", opts.topic);
  if (opts.page) params.set("page", String(opts.page));
  try {
    const r = await fetch(`${GUTENDEX}/books?${params}`, { signal: AbortSignal.timeout(12000), headers: { "user-agent": "VoxLibris/1.0 (audiobook app)" }, next: { revalidate: 3600 } });
    if (!r.ok) throw new Error(`Gutendex ${r.status}`);
    const data = (await r.json()) as { count: number; next: string | null; results: GutendexBook[] };
    const results = data.results.filter((b) => b.copyright !== true).map(mapGutendex);
    return { results, total: data.count, next: !!data.next };
  } catch (primaryError) {
    try {
      return await searchOpenLibrary(q, opts);
    } catch (secondaryError) {
      console.warn("[catalog] Gutendex and Open Library unavailable", primaryError, secondaryError);
      const needle = `${q} ${opts.topic ?? ""}`.trim().toLowerCase();
      const books = FEATURED_FREE_BOOKS.filter((b) => !needle || `${b.title} ${b.author}`.toLowerCase().includes(needle)).map((b) => fallbackBook(b.id, b.title, b.author));
      return { results: books, total: books.length, next: false };
    }
  }
}

export async function getFreeBook(id: string): Promise<FreeBook> {
  try {
    const r = await fetch(`${GUTENDEX}/books/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(12000), headers: { "user-agent": "VoxLibris/1.0 (audiobook app)" } });
    if (!r.ok) throw new Error(`Gutendex ${r.status}`);
    return mapGutendex((await r.json()) as GutendexBook);
  } catch (e) {
    const featured = FEATURED_FREE_BOOKS.find((b) => b.id === id);
    console.warn(`[catalog] Using direct Gutenberg fallback for ${id}:`, e);
    return fallbackBook(id, featured?.title, featured?.author);
  }
}

export async function createBookFromBuffer(opts: {
  userId: string;
  buffer: Buffer;
  filename: string;
  format: SupportedFormat;
  title: string;
  author?: string | null;
  sourceType: BookSourceType;
  sourceUrl?: string | null;
  sourceId?: string | null;
  sourceLicense?: string | null;
  coverUrl?: string | null;
  description?: string | null;
  narrationMode?: "single" | "multi";
  narratorVoiceId?: string | null;
  engine?: string;
}) {
  const [book] = await db
    .insert(books)
    .values({
      userId: opts.userId, title: opts.title, author: opts.author ?? null, sourceType: opts.sourceType, sourceUrl: opts.sourceUrl ?? null, sourceId: opts.sourceId ?? null, sourceLicense: opts.sourceLicense ?? null,
      coverUrl: opts.coverUrl ?? null, description: opts.description ?? null, originalFilename: sanitizeFilename(opts.filename), format: opts.format, status: "uploaded",
      narrationMode: opts.narrationMode ?? "multi", narratorVoiceId: opts.narratorVoiceId ?? null, engine: opts.engine ?? "kokoro",
    })
    .returning();
  const key = `books/${book.id}/source.${opts.format}`;
  try {
    await storage.put(key, opts.buffer);
    await db.update(books).set({ filePath: key }).where(eqId(book.id));
    const job = await enqueue(book.id, "analyze_book");
    return { book: { ...book, filePath: key }, job };
  } catch (e) {
    // Do not leave a broken library entry when storage or queue creation fails.
    await storage.deletePrefix(`books/${book.id}`).catch(() => {});
    await db.delete(books).where(eqId(book.id)).catch(() => {});
    throw e;
  }
}

import { eq } from "drizzle-orm";
function eqId(id: string) {
  return eq(books.id, id);
}

export async function importFreeBook(userId: string, sourceId: string, prefs: { narrationMode?: "single" | "multi"; narratorVoiceId?: string | null } = {}) {
  const fb = await getFreeBook(sourceId);
  // Only import formats explicitly offered by the legitimate source. Try both so a stale
  // catalog URL does not make an otherwise available title fail.
  const candidates = [{ url: fb.textUrl, format: "txt" as const }, { url: fb.epubUrl, format: "epub" as const }].filter((x): x is { url: string; format: "txt" | "epub" } => !!x.url);
  if (!candidates.length) throw new Error("This title has no downloadable text format");
  let buffer: Buffer | null = null;
  let format: SupportedFormat = "txt";
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const r = await fetch(candidate.url, { signal: AbortSignal.timeout(60000), headers: { "user-agent": "VoxLibris/1.0 (audiobook app)" }, redirect: "follow" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const next = Buffer.from(await r.arrayBuffer());
      if (!next.length) throw new Error("empty response");
      buffer = next;
      format = candidate.format;
      break;
    } catch (e) {
      failures.push(`${candidate.format}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!buffer) throw new Error(`The source download is temporarily unavailable (${failures.join("; ")})`);
  if (format === "txt") buffer = Buffer.from(stripGutenbergBoilerplate(buffer.toString("utf8")), "utf8");
  return createBookFromBuffer({
    userId, buffer, filename: `gutenberg-${fb.sourceId}.${format}`, format, title: fb.title, author: fb.authors.join(", ") || null, sourceType: "gutenberg", sourceUrl: fb.sourceUrl, sourceId: fb.sourceId,
    sourceLicense: fb.license, coverUrl: fb.coverUrl, description: fb.subjects.length ? `Subjects: ${fb.subjects.join(", ")}` : null, narrationMode: prefs.narrationMode, narratorVoiceId: prefs.narratorVoiceId,
  });
}

/** Curated public-domain starting points (all Project Gutenberg IDs). */
export const FEATURED_FREE_BOOKS = [
  { id: "1342", title: "Pride and Prejudice", author: "Jane Austen" },
  { id: "84", title: "Frankenstein", author: "Mary Shelley" },
  { id: "1661", title: "The Adventures of Sherlock Holmes", author: "Arthur Conan Doyle" },
  { id: "11", title: "Alice's Adventures in Wonderland", author: "Lewis Carroll" },
  { id: "174", title: "The Picture of Dorian Gray", author: "Oscar Wilde" },
  { id: "64317", title: "The Great Gatsby", author: "F. Scott Fitzgerald" },
  { id: "43", title: "The Strange Case of Dr. Jekyll and Mr. Hyde", author: "Robert Louis Stevenson" },
  { id: "345", title: "Dracula", author: "Bram Stoker" },
  { id: "2701", title: "Moby Dick", author: "Herman Melville" },
  { id: "1400", title: "Great Expectations", author: "Charles Dickens" },
  { id: "16", title: "Peter Pan", author: "J. M. Barrie" },
  { id: "46", title: "A Christmas Carol", author: "Charles Dickens" },
];

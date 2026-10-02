"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { BookCard, usePoll, type LibraryBook } from "@/components/ui";

const FILTERS = ["All", "In Progress", "Completed", "Processing", "Ready"] as const;

export default function LibraryPage() {
  const { data } = usePoll<{ books: LibraryBook[] }>("/api/books", 5000);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const books = useMemo(() => {
    const all = data?.books ?? [];
    const s = q.trim().toLowerCase();
    return all.filter((b) => {
      if (s && !`${b.title} ${b.author ?? ""}`.toLowerCase().includes(s)) return false;
      const processing = ["uploaded", "extracting", "analyzing", "generating"].includes(b.status);
      if (filter === "In Progress") return b.percent > 0 && !b.completed;
      if (filter === "Completed") return b.completed || b.percent >= 100;
      if (filter === "Processing") return processing;
      if (filter === "Ready") return b.readyChapters > 0;
      return true;
    });
  }, [data, q, filter]);
  const all = data?.books ?? [];
  const sections: { title: string; items: LibraryBook[] }[] = filter === "All" && !q
    ? [
        { title: "In progress", items: all.filter((b) => b.percent > 0 && !b.completed) },
        { title: "Recently played", items: [...all].filter((b) => b.lastPlayedAt).sort((a, b) => String(b.lastPlayedAt).localeCompare(String(a.lastPlayedAt))).slice(0, 8) },
        { title: "Recently added", items: [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8) },
        { title: "Completed", items: all.filter((b) => b.completed) },
      ].filter((s) => s.items.length)
    : [{ title: `${books.length} book${books.length === 1 ? "" : "s"}`, items: books }];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="font-display text-4xl font-semibold">My audiobooks</h1><p className="mt-1 text-ink-soft">Private uploads and imported public-domain books.</p></div>
        <Link href="/upload" className="btn-primary">Upload +</Link>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1"><Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-mute" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or author…" className="input pl-10" aria-label="Search library" /></label>
        <div className="flex gap-1 overflow-x-auto no-scrollbar" role="tablist" aria-label="Filter">
          {FILTERS.map((f) => <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${filter === f ? "bg-ink text-white" : "bg-card text-ink-soft"}`}>{f}</button>)}
        </div>
      </div>
      {!data ? <p className="mt-10 text-ink-mute">Loading…</p> : all.length === 0 ? (
        <div className="card mt-10 p-10 text-center"><p className="font-display text-2xl">Your library is empty</p><p className="mt-2 text-ink-soft">Upload a book or import a free classic to get started.</p><div className="mt-5 flex justify-center gap-3"><Link href="/upload" className="btn-primary">Upload</Link><Link href="/discover" className="btn-ghost">Discover free books</Link></div></div>
      ) : sections.map((s) => (
        <section key={s.title} className="mt-10">
          <h2 className="mb-4 font-display text-2xl font-semibold">{s.title}</h2>
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{s.items.map((b) => <BookCard key={b.id} b={b} />)}</div>
        </section>
      ))}
    </div>
  );
}

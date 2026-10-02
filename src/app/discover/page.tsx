"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, Loader2, Download, ExternalLink, BookOpen } from "lucide-react";
import { api } from "@/components/ui";

type FreeBook = { sourceId: string; title: string; authors: string[]; subjects: string[]; coverUrl: string | null; downloadCount: number; license: string; sourceUrl: string };
type Resp = { results: FreeBook[]; total: number; next: boolean; featured: { id: string; title: string; author: string }[]; error?: string };
const TOPICS = ["Fiction", "Adventure", "Mystery", "Romance", "Gothic", "Science fiction", "Children", "Philosophy", "Poetry"];

export default function DiscoverPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [topic, setTopic] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const d = await api<Resp>(`/api/free-books?q=${encodeURIComponent(q)}&topic=${encodeURIComponent(topic)}&page=${page}`);
        setData(d);
        setErr(null);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q, topic, page]);

  const doImport = async (id: string, mode: "multi" | "single") => {
    setImporting(id);
    setErr(null);
    try {
      const { book } = await api<{ book: { id: string } }>("/api/free-books/import", { method: "POST", body: JSON.stringify({ sourceId: id, mode }) });
      router.push(`/books/${book.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setImporting(null);
    }
  };

  return (
    <div>
      <h1 className="font-display text-4xl font-semibold">Discover free books</h1>
      <p className="mt-1 text-ink-soft">Legally free, public-domain titles from <a className="underline" href="https://www.gutenberg.org" target="_blank" rel="noreferrer">Project Gutenberg</a>. Import one and listen without uploading anything.</p>
      <div className="mt-6 flex flex-col gap-3">
        <label className="relative"><Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-mute" /><input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search books by title or author…" className="input pl-10" aria-label="Search free books" /></label>
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          <button onClick={() => { setTopic(""); setPage(1); }} className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${!topic ? "bg-ink text-white" : "bg-card text-ink-soft"}`}>Popular</button>
          {TOPICS.map((t) => <button key={t} onClick={() => { setTopic(t); setPage(1); }} className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${topic === t ? "bg-ink text-white" : "bg-card text-ink-soft"}`}>{t}</button>)}
        </div>
      </div>
      {err && <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm text-red-700" role="alert">{err}</p>}

      {!q && !topic && page === 1 && data?.featured && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-2xl font-semibold">Great for character voices</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
            {data.featured.map((f) => (
              <button key={f.id} onClick={() => doImport(f.id, "multi")} disabled={!!importing} className="card flex w-56 shrink-0 items-center gap-3 p-3 text-left hover:bg-paper-2">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-deep">{importing === f.id ? <Loader2 size={16} className="animate-spin" /> : <BookOpen size={16} />}</span>
                <span className="min-w-0"><span className="block truncate text-sm font-semibold">{f.title}</span><span className="block truncate text-xs text-ink-mute">{f.author}</span></span>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-2xl font-semibold">{q ? `Results for “${q}”` : topic || "Most downloaded"}</h2>{loading && <Loader2 className="animate-spin text-accent" size={18} />}</div>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(data?.results ?? []).map((b) => (
            <li key={b.sourceId} className="card flex gap-4 p-4">
              {b.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={b.coverUrl} alt="" className="h-28 w-20 shrink-0 rounded-xl object-cover shadow-soft" />
              ) : <div className="h-28 w-20 shrink-0 rounded-xl bg-paper-2" />}
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold leading-snug line-clamp-2">{b.title}</h3>
                <p className="text-sm text-ink-soft line-clamp-1">{b.authors.join(", ") || "Unknown"}</p>
                <p className="mt-1 text-[11px] text-ink-mute line-clamp-1">{b.subjects.slice(0, 3).join(" · ")}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="chip bg-green-50 text-green-800">{b.license}</span>
                  <a href={b.sourceUrl} target="_blank" rel="noreferrer" className="chip hover:bg-line"><ExternalLink size={11} /> Source</a>
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => doImport(b.sourceId, "multi")} disabled={!!importing} className="btn-primary h-9 px-4 text-xs">{importing === b.sourceId ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Listen</button>
                  <button onClick={() => doImport(b.sourceId, "single")} disabled={!!importing} className="btn-ghost h-9 px-4 text-xs">One voice</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {data && (data.results.length === 0 && !loading) && <p className="mt-6 text-ink-mute">No matches.</p>}
        <div className="mt-6 flex justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-ghost">Previous</button>
          <button disabled={!data?.next} onClick={() => setPage((p) => p + 1)} className="btn-ghost">Next</button>
        </div>
      </section>
    </div>
  );
}

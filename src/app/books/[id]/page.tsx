"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, User, Headphones, BookOpen, Mic2, Clock, Layers, ExternalLink, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Cover, JobProgress, VoicePicker, api, fmtDuration, usePoll } from "@/components/ui";
import type { BookDetail } from "@/components/bookTypes";

export default function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { data, error, refresh } = usePoll<BookDetail>(`/api/books/${id}`, 2500);
  if (error) return <div className="card p-8 text-center"><p className="font-semibold">Book not found</p><Link href="/library" className="btn-ghost mt-4">Back to library</Link></div>;
  if (!data) return <p className="text-ink-mute">Loading…</p>;
  const { book, chapters, characters, jobs, voices } = data;
  const analyzeJob = jobs.find((j) => j.type === "analyze_book");
  const genJob = jobs.find((j) => j.type === "generate_audio");
  const analysing = ["uploaded", "extracting", "analyzing"].includes(book.status);
  const a = book.analysis;
  const ready = chapters.filter((c) => c.audioStatus === "ready").length;
  const majors = characters.filter((c) => c.importance === "major");
  const setMode = async (m: "single" | "multi") => {
    setBusy(true);
    await api(`/api/books/${id}`, { method: "PATCH", body: JSON.stringify({ narrationMode: m }) }).catch(() => {});
    await refresh();
    setBusy(false);
  };
  const setNarrator = async (v: string) => {
    setBusy(true);
    await api(`/api/books/${id}`, { method: "PATCH", body: JSON.stringify({ narratorVoiceId: v }) }).catch(() => {});
    await refresh();
    setBusy(false);
  };
  const generate = async () => {
    setBusy(true);
    try {
      await api(`/api/books/${id}/generate`, { method: "POST", body: "{}" });
      router.push(`/books/${id}/listen`);
    } catch (e) {
      alert((e as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm("Delete this book and its audio?")) return;
    await api(`/api/books/${id}`, { method: "DELETE" });
    router.push("/library");
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-4">
        <div className="mx-auto max-w-[260px] lg:max-w-none"><Cover title={book.title} author={book.author} coverUrl={book.coverUrl} /></div>
        <div className="card p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-mute">Source</p>
          <p className="mt-1 font-semibold">{book.sourceType === "upload" ? "My upload" : book.sourceType === "gutenberg" ? "Project Gutenberg" : "Demo story"}</p>
          <p className="text-ink-soft">{book.sourceLicense ?? (book.sourceType === "upload" ? "Private" : "")}</p>
          {book.sourceUrl && <a href={book.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-accent-deep underline"><ExternalLink size={12} /> Original source</a>}
          {book.sourceType === "upload" && <p className="mt-2 text-xs text-ink-mute">Stored privately on this server; never listed to other users.</p>}
        </div>
        <button onClick={remove} className="btn-ghost w-full text-red-700"><Trash2 size={16} /> Delete book</button>
      </aside>

      <div className="space-y-6">
        <div>
          <p className="text-sm text-ink-mute">{book.format?.toUpperCase()} {book.language ? `· ${book.language.toUpperCase()}` : ""} {book.publicationYear ? `· ${book.publicationYear}` : ""}</p>
          <h1 className="font-display text-4xl font-semibold leading-tight">{book.title}</h1>
          <p className="mt-1 text-lg text-ink-soft">{book.author ?? "Unknown author"}</p>
        </div>

        {analysing && analyzeJob && <JobProgress stage={analyzeJob.stage} progress={analyzeJob.progress} stats={analyzeJob.stats} />}
        {(book.status === "failed" || book.status === "needs_ocr") && (
          <div className="card border-red-200 p-5"><p className="flex items-center gap-2 font-semibold text-red-700"><AlertTriangle size={18} /> {book.status === "needs_ocr" ? "This scanned PDF could not be read reliably" : "Analysis failed"}</p><p className="mt-1 text-sm text-ink-soft">{book.error}</p></div>
        )}

        {a && !analysing && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { icon: Layers, l: "Chapters", v: a.chapters },
                { icon: Users, l: "Major characters", v: a.majorCharacters },
                { icon: Clock, l: "Est. listening", v: fmtDuration(a.estimatedMinutes * 60000) },
                { icon: Mic2, l: "Narration", v: a.pov === "first" ? "First person" : "Third person" },
              ].map((s) => (
                <div key={s.l} className="card p-4"><s.icon size={16} className="text-accent" /><p className="mt-2 text-xl font-semibold">{s.v}</p><p className="text-xs text-ink-mute">{s.l}</p></div>
              ))}
            </div>
            {a.extraction?.warnings && a.extraction.warnings.length > 0 && (
              <details className="card p-4 text-sm"><summary className="cursor-pointer font-semibold">Notes from analysis ({a.extraction.warnings.length})</summary><ul className="mt-2 list-disc pl-5 text-ink-soft">{a.extraction.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>
            )}

            <section className="card p-5">
              <h2 className="font-semibold">Narration mode</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {([{ v: "multi", icon: Users, t: "Character voices", d: `${a.majorCharacters} major characters, ${a.uniqueVoices ?? 0} unique voices${a.sharedVoices ? `, ${a.sharedVoices} minor roles share voices` : ""}.` }, { v: "single", icon: User, t: "One voice", d: "A single narrator performs everything." }] as const).map((o) => (
                  <button key={o.v} disabled={busy} onClick={() => setMode(o.v)} className={`card flex gap-3 p-4 text-left ${book.narrationMode === o.v ? "ring-2 ring-accent" : "hover:bg-paper-2"}`} aria-pressed={book.narrationMode === o.v}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent-deep"><o.icon size={18} /></span>
                    <span><span className="block font-semibold">{o.t}</span><span className="block text-sm text-ink-soft">{o.d}</span></span>
                  </button>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium">{book.narrationMode === "single" ? "Narrator" : "Narrator voice"}</span>
                <VoicePicker voices={voices} value={book.narratorVoiceId} onChange={setNarrator} previewName="the narrator" disabled={busy} />
              </div>
            </section>

            {book.narrationMode === "multi" && (
              <section className="card p-5">
                <div className="flex items-center justify-between"><h2 className="font-semibold">Cast</h2><Link href={`/books/${id}/casting`} className="btn-soft">Review voice casting</Link></div>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {majors.slice(0, 10).map((c) => { const v = voices.find((x) => x.id === c.voiceId); return <li key={c.id} className="chip">{c.name} → {v?.name ?? "—"}{c.voiceSource === "user" ? " ✎" : ""}</li>; })}
                  {majors.length === 0 && <li className="text-sm text-ink-mute">No speaking characters detected – the narrator performs everything.</li>}
                </ul>
              </section>
            )}

            <section className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="font-semibold">Audiobook</h2><p className="text-sm text-ink-soft">{ready}/{chapters.length} chapters ready{book.totalDurationMs ? ` · ${fmtDuration(book.totalDurationMs)}` : ""}</p></div>
                <div className="flex gap-2">
                  <Link href={`/books/${id}/read`} className="btn-ghost"><BookOpen size={16} /> Read</Link>
                  {ready > 0 && <Link href={`/books/${id}/listen`} className="btn-soft"><Headphones size={16} /> Listen</Link>}
                  <button onClick={generate} disabled={busy || book.status === "generating"} className="btn-primary">{busy || book.status === "generating" ? <Loader2 size={16} className="animate-spin" /> : <Mic2 size={16} />} {ready === chapters.length && ready > 0 ? "Regenerate" : book.status === "generating" ? "Generating…" : ready ? "Continue generating" : "Generate audiobook"}</button>
                </div>
              </div>
              {genJob && genJob.status === "running" && <div className="mt-4"><JobProgress stage={genJob.stage} progress={genJob.progress} stats={genJob.stats} /></div>}
              {genJob?.status === "failed" && <p className="mt-3 text-sm text-red-700">Generation failed: {genJob.error}</p>}
              <ol className="mt-4 divide-y divide-line">
                {chapters.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className={`h-2 w-2 rounded-full ${c.audioStatus === "ready" ? "bg-success" : c.audioStatus === "generating" ? "bg-accent pulse-soft" : c.audioStatus === "failed" ? "bg-red-500" : "bg-line"}`} aria-hidden />
                    <span className="flex-1 truncate">{c.title}</span>
                    {c.audioStatus === "generating" && <span className="w-24 overflow-hidden rounded-full bg-line"><span className="block h-1.5 bg-accent" style={{ width: `${Math.round((c.audioProgress ?? 0) * 100)}%` }} /></span>}
                    <span className="text-xs text-ink-mute">{c.audioStatus === "ready" ? fmtDuration(c.durationMs ?? 0) : c.audioStatus === "generating" ? `${Math.round((c.audioProgress ?? 0) * 100)}%` : c.audioStatus === "queued" ? "Waiting" : c.audioStatus === "failed" ? "Failed" : `${c.wordCount} words`}</span>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

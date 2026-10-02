"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Headphones, Type } from "lucide-react";
import { api, usePoll } from "@/components/ui";
import type { BookDetail, ChapterDetail } from "@/components/bookTypes";

export default function ReadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data } = usePoll<BookDetail>(`/api/books/${id}`, 30000, false);
  const [i, setI] = useState(0);
  const [detail, setDetail] = useState<ChapterDetail | null>(null);
  const [font, setFont] = useState(18);
  const [lh, setLh] = useState(1.8);
  const [theme, setTheme] = useState<"paper" | "sepia" | "night">("paper");
  const chapters = data?.chapters ?? [];
  const ch = chapters[i];
  useEffect(() => {
    if (!data) return;
    const saved = Number(localStorage.getItem(`vox-read-${id}`) ?? -1);
    const p = data.progress?.chapterId ? chapters.findIndex((c) => c.id === data.progress!.chapterId) : -1;
    setI(saved >= 0 ? saved : p >= 0 ? p : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  useEffect(() => {
    if (!ch) return;
    setDetail(null);
    api<ChapterDetail>(`/api/books/${id}/chapters/${ch.id}?text=1`).then(setDetail).catch(() => {});
    localStorage.setItem(`vox-read-${id}`, String(i));
    window.scrollTo({ top: 0 });
  }, [ch, i, id]);
  if (!data) return <p className="text-ink-mute">Loading…</p>;
  const themes = { paper: "bg-card text-ink", sepia: "bg-[#f4e9d8] text-[#3b2f24]", night: "bg-[#1b1917] text-[#e8e2da]" } as const;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/books/${id}`} className="inline-flex items-center gap-1 text-sm text-ink-mute hover:text-ink"><ChevronLeft size={16} /> {data.book.title}</Link>
        <div className="flex flex-wrap items-center gap-2">
          <label className="chip"><Type size={12} /><input type="range" min={14} max={26} value={font} onChange={(e) => setFont(Number(e.target.value))} className="range w-20" aria-label="Font size" /></label>
          <label className="chip">↕<input type="range" min={1.4} max={2.4} step={0.1} value={lh} onChange={(e) => setLh(Number(e.target.value))} className="range w-20" aria-label="Line height" /></label>
          <div className="flex gap-1">{(["paper", "sepia", "night"] as const).map((t) => <button key={t} onClick={() => setTheme(t)} aria-label={`${t} theme`} className={`h-7 w-7 rounded-full border border-line ${t === "paper" ? "bg-white" : t === "sepia" ? "bg-[#f4e9d8]" : "bg-[#1b1917]"} ${theme === t ? "ring-2 ring-accent" : ""}`} />)}</div>
          {ch?.audioStatus === "ready" && <Link href={`/books/${id}/listen`} onClick={() => localStorage.setItem(`vox-pos-${id}`, JSON.stringify({ chapterId: ch.id, positionMs: 0 }))} className="btn-soft h-9 px-3 text-xs"><Headphones size={14} /> Listen from here</Link>}
        </div>
      </div>
      <article className={`rounded-xl2 p-6 shadow-soft sm:p-10 ${themes[theme]}`} style={{ fontSize: font, lineHeight: lh }}>
        <h1 className="font-display mb-6 text-3xl font-semibold">{ch?.title}</h1>
        {!detail ? <p className="opacity-60">Loading…</p> : detail.blocks.map((b, k) => b.type === "heading" ? (k === 0 ? null : <h2 key={k} className="font-display mt-8 mb-3 text-2xl font-semibold">{b.text}</h2>) : <p key={k} className="font-display mb-4">{b.text}</p>)}
      </article>
      <div className="mt-6 flex items-center justify-between">
        <button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i <= 0} className="btn-ghost"><ChevronLeft size={16} /> Previous</button>
        <select value={i} onChange={(e) => setI(Number(e.target.value))} className="input w-auto max-w-[50vw]" aria-label="Chapter">{chapters.map((c, k) => <option key={c.id} value={k}>{c.title}</option>)}</select>
        <button onClick={() => setI((x) => Math.min(chapters.length - 1, x + 1))} disabled={i >= chapters.length - 1} className="btn-ghost">Next <ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

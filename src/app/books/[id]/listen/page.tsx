"use client";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, RotateCcw, RotateCw, Volume2, VolumeX, ListMusic, BookOpen, Loader2, ChevronLeft, AlignLeft } from "lucide-react";
import { Cover, api, fmtTime, usePoll } from "@/components/ui";
import type { BookDetail, ChapterDetail } from "@/components/bookTypes";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export default function ListenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, refresh } = usePoll<BookDetail>(`/api/books/${id}`, 5000);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChapterDetail | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [autoplay, setAutoplay] = useState(true);
  const [showText, setShowText] = useState(true);
  const [showChapters, setShowChapters] = useState(false);
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);
  const restored = useRef(false);
  const lastSave = useRef(0);
  const activeRef = useRef<HTMLSpanElement | null>(null);

  const chapters = useMemo(() => data?.chapters ?? [], [data]);
  const readyChapters = chapters.filter((c) => c.audioStatus === "ready");
  const current = chapters.find((c) => c.id === chapterId) ?? null;
  const idx = current ? chapters.findIndex((c) => c.id === current.id) : -1;

  // Restore position (server first, localStorage fallback)
  useEffect(() => {
    if (!data || restored.current) return;
    const local = JSON.parse(localStorage.getItem(`vox-pos-${id}`) ?? "null") as { chapterId: string; positionMs: number } | null;
    const p = data.progress?.chapterId ? data.progress : local;
    const first = readyChapters[0];
    const target = (p?.chapterId && chapters.find((c) => c.id === p.chapterId && c.audioStatus === "ready")) || first;
    if (!target) return;
    restored.current = true;
    setChapterId(target.id);
    if (p?.chapterId === target.id && p.positionMs > 2000) setPendingSeek(p.positionMs / 1000);
    api<{ settings: { defaultSpeed?: number; autoplayNext?: boolean } }>("/api/settings").then((d) => { if (d.settings.defaultSpeed) setSpeed(d.settings.defaultSpeed); if (d.settings.autoplayNext !== undefined) setAutoplay(d.settings.autoplayNext); }).catch(() => {});
  }, [data, chapters, readyChapters, id]);

  useEffect(() => {
    if (!chapterId) return;
    setDetail(null);
    api<ChapterDetail>(`/api/books/${id}/chapters/${chapterId}`).then(setDetail).catch(() => {});
  }, [chapterId, id]);

  useEffect(() => {
    const a = audioRef.current;
    if (a) { a.playbackRate = speed; a.volume = volume; }
  }, [speed, volume, detail]);

  const save = useCallback((posMs: number, completed = false) => {
    if (!chapterId) return;
    localStorage.setItem(`vox-pos-${id}`, JSON.stringify({ chapterId, positionMs: posMs }));
    void fetch(`/api/books/${id}/progress`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ chapterId, positionMs: posMs, completed }), keepalive: true });
  }, [chapterId, id]);

  const onTime = () => {
    const a = audioRef.current;
    if (!a) return;
    setTime(a.currentTime);
    if (Date.now() - lastSave.current > 5000) { lastSave.current = Date.now(); save(a.currentTime * 1000); }
  };
  const goTo = (i: number, autoPlay = true) => {
    const c = chapters[i];
    if (!c || c.audioStatus !== "ready") return;
    save(audioRef.current ? audioRef.current.currentTime * 1000 : 0);
    setChapterId(c.id);
    setPendingSeek(null);
    setPlaying(autoPlay);
  };
  const onEnded = () => {
    const next = chapters.slice(idx + 1).find((c) => c.audioStatus === "ready");
    const isLast = idx === chapters.length - 1;
    save(duration * 1000, isLast);
    if (autoplay && next && chapters[idx + 1]?.id === next.id) goTo(idx + 1);
    else setPlaying(false);
  };
  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { void a.play(); setPlaying(true); } else { a.pause(); setPlaying(false); }
  };
  const seekBy = (s: number) => { const a = audioRef.current; if (a) a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + s)); };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
      if (e.code === "Space") { e.preventDefault(); toggle(); }
      if (e.code === "ArrowLeft") seekBy(-10);
      if (e.code === "ArrowRight") seekBy(30);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => () => { const a = audioRef.current; if (a && chapterId) save(a.currentTime * 1000); }, [chapterId, save]);

  const tMs = time * 1000;
  const segs = detail?.segments ?? [];
  const activeSeg = segs.find((s) => s.startMs !== null && s.endMs !== null && tMs >= s.startMs! && tMs < s.endMs! + 200) ?? null;
  const speakerName = activeSeg?.speakerCharacterId ? detail?.characters.find((c) => c.id === activeSeg.speakerCharacterId)?.name ?? null : null;
  const showSpeaker = activeSeg && (activeSeg.type === "dialogue" || activeSeg.type === "thought") && speakerName && (activeSeg.speakerConfidence ?? 0) >= 0.45;
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [activeSeg?.id]);

  // Paragraph grouping for reading view
  const paragraphs = useMemo(() => {
    const out: typeof segs[] = [];
    let cur: typeof segs = [];
    for (const s of segs) { cur.push(s); if (s.paragraphEnd || s.type === "heading") { out.push(cur); cur = []; } }
    if (cur.length) out.push(cur);
    return out;
  }, [segs]);

  if (!data) return <p className="text-ink-mute">Loading…</p>;
  const { book } = data;
  if (readyChapters.length === 0) {
    const gen = data.jobs.find((j) => j.type === "generate_audio" && j.status === "running");
    return (
      <div className="card mx-auto max-w-lg p-8 text-center">
        <Loader2 className="mx-auto animate-spin text-accent" size={28} />
        <p className="mt-4 font-display text-2xl">{gen ? "Performing the first chapter…" : "No audio yet"}</p>
        <p className="mt-2 text-sm text-ink-soft">{gen ? `${gen.stage ?? ""} – you can start listening as soon as it's ready.` : "Generate the audiobook from the book page."}</p>
        <Link href={`/books/${id}`} className="btn-ghost mt-5">Book details</Link>
      </div>
    );
  }
  const totalBefore = chapters.slice(0, Math.max(0, idx)).reduce((n, c) => n + (c.durationMs ?? 0), 0);
  const total = chapters.reduce((n, c) => n + (c.durationMs ?? 0), 0);
  const remaining = Math.max(0, (duration - time) * 1000);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
      <audio ref={audioRef} src={detail?.audioUrl ?? undefined} preload="auto" onTimeUpdate={onTime} onEnded={onEnded} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => { const a = e.currentTarget; setDuration(a.duration); a.playbackRate = speed; if (pendingSeek !== null) { a.currentTime = pendingSeek; setPendingSeek(null); } if (playing) void a.play().catch(() => setPlaying(false)); }} />

      {/* Text / reading pane */}
      <section className={`order-2 lg:order-1 ${showText ? "" : "hidden lg:block"}`} aria-label="Synchronized text">
        <div className="mb-3 flex items-center justify-between">
          <Link href={`/books/${id}`} className="inline-flex items-center gap-1 text-sm text-ink-mute hover:text-ink"><ChevronLeft size={16} /> {book.title}</Link>
          <div className="flex gap-2"><Link href={`/books/${id}/read`} className="btn-ghost h-9 px-3 text-xs"><BookOpen size={14} /> Reader</Link></div>
        </div>
        <div className="card min-h-[50vh] p-5 sm:p-8">
          {!detail ? <p className="text-ink-mute">Loading chapter…</p> : (
            <article className="font-display text-[17px] leading-8 sm:text-lg">
              {paragraphs.map((p, i) => {
                const heading = p[0]?.type === "heading";
                if (heading) return <h2 key={i} className="mb-6 mt-2 text-2xl font-semibold not-italic">{p.map((s) => s.text).join(" ")}</h2>;
                return (
                  <p key={i} className="mb-5">
                    {p.map((s) => {
                      const active = activeSeg?.id === s.id;
                      const name = s.speakerCharacterId ? detail.characters.find((c) => c.id === s.speakerCharacterId)?.name : null;
                      const isSpeech = s.type === "dialogue" || s.type === "thought";
                      return (
                        <span key={s.id} ref={active ? activeRef : null} onClick={() => { const a = audioRef.current; if (a && s.startMs !== null) { a.currentTime = s.startMs! / 1000; if (a.paused) { void a.play(); } } }} className={`cursor-pointer rounded px-0.5 transition ${active ? "seg-active" : "hover:bg-paper-2"} ${s.type === "thought" ? "italic" : ""}`} title={isSpeech && name ? `${name} (${Math.round((s.speakerConfidence ?? 0) * 100)}%)` : undefined}>
                          {isSpeech ? `“${s.text}”` : s.text}{" "}
                        </span>
                      );
                    })}
                  </p>
                );
              })}
            </article>
          )}
        </div>
      </section>

      {/* Player panel */}
      <aside className="order-1 lg:order-2 lg:sticky lg:top-4">
        <div className="card p-5 sm:p-6">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-soft">
            <select aria-label="Playback speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="rounded-full bg-paper-2 px-2.5 py-1">{SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}</select>
            <div className="flex items-center gap-1">
              <button onClick={() => setShowText((s) => !s)} className={`grid h-8 w-8 place-items-center rounded-full lg:hidden ${showText ? "bg-accent-soft text-accent-deep" : "bg-paper-2"}`} aria-pressed={showText} aria-label="Toggle text"><AlignLeft size={16} /></button>
              <button onClick={() => setShowChapters((s) => !s)} className={`grid h-8 w-8 place-items-center rounded-full ${showChapters ? "bg-accent-soft text-accent-deep" : "bg-paper-2"}`} aria-pressed={showChapters} aria-label="Chapters"><ListMusic size={16} /></button>
              <button onClick={() => setVolume((v) => (v ? 0 : 1))} className="grid h-8 w-8 place-items-center rounded-full bg-paper-2" aria-label={volume ? "Mute" : "Unmute"}>{volume ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
            </div>
          </div>
          <div className="mx-auto mt-4 w-40 sm:w-52"><Cover title={book.title} author={book.author} coverUrl={book.coverUrl} /></div>
          <h1 className="mt-4 text-center font-display text-xl font-semibold leading-tight">{book.title}</h1>
          <p className="text-center text-sm text-ink-soft">{book.author}</p>
          <div className="mt-3 flex min-h-10 items-center justify-center" aria-live="polite">
            {showSpeaker ? <span className="chip bg-accent-soft text-accent-deep"><span className="h-2 w-2 rounded-full bg-accent" /> {speakerName}</span> : activeSeg?.type === "narration" ? <span className="chip">Narrator</span> : null}
          </div>
          <input type="range" min={0} max={duration || 0} step={0.1} value={Math.min(time, duration || 0)} onChange={(e) => { const a = audioRef.current; if (a) a.currentTime = Number(e.target.value); }} className="range mt-2 w-full" aria-label="Seek" />
          <div className="flex justify-between text-xs tabular-nums text-ink-mute"><span>{fmtTime(tMs)}</span><span>-{fmtTime(remaining)}</span></div>
          <div className="mt-3 flex items-center justify-center gap-3 sm:gap-4">
            <button onClick={() => goTo(idx - 1)} disabled={idx <= 0 || chapters[idx - 1]?.audioStatus !== "ready"} className="grid h-11 w-11 place-items-center rounded-full hover:bg-paper-2 disabled:opacity-30" aria-label="Previous chapter"><SkipBack size={20} /></button>
            <button onClick={() => seekBy(-10)} className="grid h-11 w-11 place-items-center rounded-full text-xs font-bold hover:bg-paper-2" aria-label="Back 10 seconds"><span className="relative"><RotateCcw size={22} /><span className="absolute inset-0 grid place-items-center text-[8px]">10</span></span></button>
            <button onClick={toggle} className="grid h-16 w-16 place-items-center rounded-full bg-accent text-white shadow-[0_12px_28px_-8px_rgb(242_107_58/0.8)] hover:bg-accent-deep" aria-label={playing ? "Pause" : "Play"}>{!detail ? <Loader2 className="animate-spin" /> : playing ? <Pause size={26} /> : <Play size={26} className="ml-1" />}</button>
            <button onClick={() => seekBy(30)} className="grid h-11 w-11 place-items-center rounded-full text-xs font-bold hover:bg-paper-2" aria-label="Forward 30 seconds"><span className="relative"><RotateCw size={22} /><span className="absolute inset-0 grid place-items-center text-[8px]">30</span></span></button>
            <button onClick={() => goTo(idx + 1)} disabled={idx >= chapters.length - 1 || chapters[idx + 1]?.audioStatus !== "ready"} className="grid h-11 w-11 place-items-center rounded-full hover:bg-paper-2 disabled:opacity-30" aria-label="Next chapter"><SkipForward size={20} /></button>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-ink-mute"><Volume2 size={14} /><input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="range flex-1" aria-label="Volume" /></div>
          <p className="mt-4 text-sm font-semibold">Chapter {idx + 1} of {chapters.length}{total ? <span className="font-normal text-ink-mute"> · {fmtTime(totalBefore + tMs)} / {fmtTime(total)}</span> : null}</p>
          <p className="truncate text-sm text-ink-soft">{current?.title}</p>
          <ol className={`mt-3 max-h-72 space-y-1 overflow-y-auto ${showChapters ? "" : "hidden lg:block"}`} aria-label="Chapters">
            {chapters.map((c, i) => (
              <li key={c.id}>
                <button onClick={() => goTo(i)} disabled={c.audioStatus !== "ready"} className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm ${c.id === chapterId ? "bg-accent-soft/60" : "hover:bg-paper-2"} disabled:opacity-50`} aria-current={c.id === chapterId ? "true" : undefined}>
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${c.id === chapterId ? "bg-accent text-white" : "border border-line text-ink-mute"}`}>{c.audioStatus === "generating" ? <Loader2 size={12} className="animate-spin" /> : c.id === chapterId && playing ? <Pause size={10} /> : <Play size={10} className="ml-0.5" />}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.title}</span>{c.id === chapterId && duration > 0 && <span className="mt-1 block h-0.5 w-full rounded bg-line"><span className="block h-full rounded bg-accent" style={{ width: `${(time / duration) * 100}%` }} /></span>}</span>
                  <span className="text-xs tabular-nums text-ink-mute">{c.audioStatus === "ready" ? fmtTime(c.durationMs ?? 0) : c.audioStatus === "generating" ? `${Math.round((c.audioProgress ?? 0) * 100)}%` : c.audioStatus === "queued" ? "…" : "—"}</span>
                </button>
              </li>
            ))}
          </ol>
          {book.status === "generating" && <button onClick={() => void refresh()} className="mt-2 w-full text-center text-xs text-ink-mute">Later chapters are still being performed…</button>}
        </div>
      </aside>
    </div>
  );
}

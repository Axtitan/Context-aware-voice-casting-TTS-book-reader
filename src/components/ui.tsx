"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, Loader2, AlertTriangle, CheckCircle2, Lock, Unlock, RotateCcw, ChevronDown } from "lucide-react";
import type { Voice } from "@/lib/tts/provider";

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
export function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${r.status})`);
  return data as T;
}

/** Poll a JSON endpoint while `active` is true. */
export function usePoll<T>(url: string | null, intervalMs: number, active = true): { data: T | null; error: string | null; refresh: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!url) return;
    try {
      const d = await api<T>(url);
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!active || !url) return;
    const id = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, url, intervalMs, refresh]);
  return { data, error, refresh };
}

const COVER_COLORS = ["from-[#f6d365] to-[#fda085]", "from-[#a18cd1] to-[#fbc2eb]", "from-[#84fab0] to-[#8fd3f4]", "from-[#f093fb] to-[#f5576c]", "from-[#4facfe] to-[#00f2fe]", "from-[#43e97b] to-[#38f9d7]", "from-[#fa709a] to-[#fee140]", "from-[#30cfd0] to-[#330867]"];
export function Cover({ title, author, coverUrl, className = "" }: { title: string; author?: string | null; coverUrl?: string | null; className?: string }) {
  const idx = [...title].reduce((n, c) => n + c.charCodeAt(0), 0) % COVER_COLORS.length;
  if (coverUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={coverUrl} alt={`Cover of ${title}`} className={`aspect-square w-full rounded-2xl object-cover shadow-card ${className}`} />;
  }
  return (
    <div className={`relative aspect-square w-full overflow-hidden rounded-2xl bg-gradient-to-br ${COVER_COLORS[idx]} p-4 text-left shadow-card ${className}`} role="img" aria-label={`Cover of ${title}`}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,.35),transparent_50%)]" />
      <div className="relative flex h-full flex-col justify-end">
        <p className="font-display text-lg font-bold leading-tight text-[#1c1a17] drop-shadow-sm line-clamp-3">{title}</p>
        {author && <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-[#1c1a17]/70 line-clamp-1">{author}</p>}
      </div>
    </div>
  );
}

export type LibraryBook = {
  id: string; title: string; author: string | null; coverUrl: string | null; status: string; sourceType: string; narrationMode: string; percent: number; totalMs: number; chapterCount: number; readyChapters: number;
  lastChapterTitle: string | null; lastPlayedAt: string | null; completed: boolean; updatedAt: string; createdAt: string; error: string | null; analysis: { estimatedMinutes: number; characters: number } | null;
  job: { id: string; type: string; status: string; stage: string | null; progress: number; error: string | null } | null;
};

export function BookCard({ b }: { b: LibraryBook }) {
  const processing = ["uploaded", "extracting", "analyzing"].includes(b.status) || (b.job?.status === "running" && b.job.type === "analyze_book");
  const href = processing || b.status === "failed" || b.status === "needs_ocr" ? `/books/${b.id}` : b.readyChapters > 0 ? `/books/${b.id}/listen` : `/books/${b.id}`;
  return (
    <Link href={href} className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 rounded-2xl">
      <div className="relative">
        <Cover title={b.title} author={b.author} coverUrl={b.coverUrl} className="transition group-hover:-translate-y-0.5" />
        {b.readyChapters > 0 && !processing && (
          <span className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100" aria-hidden>
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/90 text-accent shadow-card"><Play size={20} className="ml-0.5" /></span>
          </span>
        )}
        {processing && <span className="absolute left-2 top-2 chip bg-white/90 text-ink"><Loader2 size={12} className="animate-spin" /> {b.job?.stage ?? "Processing"}</span>}
        {b.status === "failed" && <span className="absolute left-2 top-2 chip bg-white/90 text-red-700"><AlertTriangle size={12} /> Failed</span>}
        {b.status === "generating" && <span className="absolute left-2 top-2 chip bg-white/90 text-ink"><Loader2 size={12} className="animate-spin" /> {b.readyChapters}/{b.chapterCount} ready</span>}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-success transition-all" style={{ width: `${b.percent}%` }} /></div>
        <span className="text-[11px] font-semibold text-ink-soft">{b.percent}%</span>
      </div>
      <h3 className="mt-1.5 text-sm font-semibold leading-snug line-clamp-2">{b.title}</h3>
      <p className="text-xs text-ink-mute line-clamp-1">{b.author ?? "Unknown author"}</p>
    </Link>
  );
}

export function JobProgress({ stage, progress, stats, error, done }: { stage: string | null; progress: number; stats?: Record<string, unknown>; error?: string | null; done?: boolean }) {
  return (
    <div className="card p-5" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 font-medium">
          {error ? <AlertTriangle className="text-red-600" size={18} /> : done ? <CheckCircle2 className="text-success" size={18} /> : <Loader2 className="animate-spin text-accent" size={18} />}
          <span>{error ? "Something went wrong" : stage ?? "Queued"}</span>
        </div>
        <span className="text-sm font-semibold tabular-nums text-ink-soft">{Math.round((done ? 1 : progress) * 100)}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${error ? "bg-red-500" : "bg-accent"} transition-all duration-700`} style={{ width: `${Math.max(2, (done ? 1 : progress) * 100)}%` }} /></div>
      {stats && Object.keys(stats).length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft">
          {Object.entries(stats).map(([k, v]) => (
            <div key={k} className="flex gap-1"><dt className="capitalize">{k}:</dt><dd className="font-semibold text-ink">{String(v)}</dd></div>
          ))}
        </dl>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}

/** Real voice preview player: fetches a synthesised sample of the actual voice. */
let currentPreview: HTMLAudioElement | null = null;
export function PreviewButton({ voiceId, name, text, size = "md", label }: { voiceId: string; name?: string; text?: string; size?: "sm" | "md"; label?: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [err, setErr] = useState<string>("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const toggle = async () => {
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    try {
      const q = new URLSearchParams({ voiceId, ...(name ? { name } : {}), ...(text ? { text } : {}) });
      const r = await fetch(`/api/voices/preview?${q}`);
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Preview failed");
      const url = URL.createObjectURL(await r.blob());
      currentPreview?.pause();
      const a = new Audio(url);
      currentPreview = a;
      audioRef.current = a;
      a.onended = () => setState("idle");
      a.onpause = () => setState("idle");
      await a.play();
      setState("playing");
    } catch (e) {
      setErr((e as Error).message);
      setState("error");
      setTimeout(() => setState("idle"), 4000);
    }
  };
  const cls = size === "sm" ? "h-8 w-8" : "h-10 px-3";
  return (
    <button type="button" onClick={toggle} title={state === "error" ? err : label ?? "Preview voice"} aria-label={label ?? `Preview voice`} className={`inline-flex items-center justify-center gap-1.5 rounded-full bg-accent-soft text-accent-deep text-xs font-semibold hover:bg-[#ffd4c0] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${cls}`}>
      {state === "loading" ? <Loader2 size={14} className="animate-spin" /> : state === "playing" ? <Pause size={14} /> : state === "error" ? <AlertTriangle size={14} /> : <Play size={14} className="ml-0.5" />}
      {size === "md" && <span>{state === "playing" ? "Stop" : state === "error" ? "Unavailable" : label ?? "Preview"}</span>}
    </button>
  );
}

export function VoiceBadge({ v }: { v: Voice }) {
  return <span className="chip">{v.gender === "male" ? "♂" : v.gender === "female" ? "♀" : "•"} {v.name} · {v.accent} · {v.ageRange}</span>;
}

/** Voice selector with grouped options + preview + compare. */
export function VoicePicker({ voices, value, onChange, previewName, disabled }: { voices: Voice[]; value: string | null; onChange: (id: string) => void; previewName?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "female" | "male" | "British" | "American">("all");
  const current = voices.find((v) => v.id === value);
  const list = voices.filter((v) => filter === "all" || v.gender === filter || v.accent === filter).sort((a, b) => b.quality - a.quality);
  return (
    <div className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open} className="btn-ghost w-full justify-between sm:w-auto">
        <span className="truncate">{current ? `${current.name} · ${current.accent} ${current.gender}` : "Choose voice"}</span>
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-[min(92vw,26rem)] rounded-2xl border border-line bg-card p-3 shadow-card right-0 sm:left-0 sm:right-auto">
          <div className="mb-2 flex flex-wrap gap-1">
            {(["all", "female", "male", "American", "British"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${filter === f ? "bg-accent text-white" : "bg-paper-2 text-ink-soft"}`}>{f}</button>
            ))}
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto" role="listbox" aria-label="Voices">
            {list.map((v) => (
              <li key={v.id} role="option" aria-selected={v.id === value} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 ${v.id === value ? "bg-accent-soft" : "hover:bg-paper-2"}`}>
                <PreviewButton voiceId={v.id} name={previewName} size="sm" label={`Preview ${v.name}`} />
                <button type="button" className="flex-1 text-left" onClick={() => { onChange(v.id); setOpen(false); }}>
                  <span className="block text-sm font-semibold">{v.name} <span className="font-normal text-ink-mute">· {v.accent} · {v.gender} · {v.ageRange}</span></span>
                  <span className="block text-[11px] text-ink-mute">{v.style.slice(0, 4).join(", ")} · quality {Math.round(v.quality * 100)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function LockButton({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${locked ? "bg-ink text-white" : "bg-paper-2 text-ink-soft hover:bg-line"}`} aria-pressed={locked} title={locked ? "Voice locked – analysis will never change it" : "Lock this voice"}>
      {locked ? <Lock size={14} /> : <Unlock size={14} />} {locked ? "Locked" : "Lock"}
    </button>
  );
}
export function ResetButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-paper-2 px-3 text-xs font-semibold text-ink-soft hover:bg-line disabled:opacity-40" title="Reset to AI selection">
      <RotateCcw size={14} /> AI pick
    </button>
  );
}

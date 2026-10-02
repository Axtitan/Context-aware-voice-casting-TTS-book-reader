"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Upload, FileText, Loader2, Users, User } from "lucide-react";
import { VoicePicker, api } from "@/components/ui";
import type { Voice } from "@/lib/tts/provider";

const ACCEPT = ".pdf,.epub,.docx,.doc,.txt,application/pdf,application/epub+zip,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"multi" | "single">("multi");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [narrator, setNarrator] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ voices: Voice[] }>("/api/voices").then((d) => setVoices(d.voices)).catch(() => {});
    api<{ settings: { defaultMode?: "single" | "multi"; defaultNarratorVoiceId?: string } }>("/api/settings").then((d) => {
      if (d.settings.defaultMode) setMode(d.settings.defaultMode);
      if (d.settings.defaultNarratorVoiceId) setNarrator(d.settings.defaultNarratorVoiceId);
    }).catch(() => {});
  }, []);

  const submit = async () => {
    if (!file) return;
    setErr(null);
    setBusy("Uploading…");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      if (narrator) fd.append("narratorVoiceId", narrator);
      const r = await fetch("/api/books", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Upload failed");
      router.push(`/books/${data.book.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-4xl font-semibold">Upload a book</h1>
      <p className="mt-2 text-ink-soft">We&apos;ll extract the text, find where the story starts, detect chapters and characters, and cast voices. Max 60 MB.</p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
        className={`card mt-8 flex flex-col items-center justify-center gap-3 border-2 border-dashed p-10 text-center transition ${drag ? "border-accent bg-accent-soft/40" : "border-line"}`}
      >
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent-deep"><Upload size={24} /></span>
        {file ? (
          <div className="flex items-center gap-2 text-sm font-semibold"><FileText size={16} /> {file.name} <span className="font-normal text-ink-mute">({(file.size / 1024 / 1024).toFixed(1)} MB)</span></div>
        ) : (
          <p className="text-sm text-ink-soft">Drag &amp; drop your book here</p>
        )}
        <label className="btn-ghost cursor-pointer">
          <input ref={inputRef} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file ? "Choose a different file" : "Browse files"}
        </label>
        <p className="text-xs text-ink-mute">PDF · EPUB · DOCX · DOC · TXT — scanned PDFs are OCR&apos;d automatically</p>
      </div>

      <fieldset className="mt-8">
        <legend className="font-semibold">How should it be narrated?</legend>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([
            { v: "multi", icon: Users, t: "Character voices", d: "AI casts a distinct, consistent voice for every important character. Narrator reads the rest." },
            { v: "single", icon: User, t: "One voice", d: "A single narrator performs the whole book. You choose the narrator." },
          ] as const).map((o) => (
            <label key={o.v} className={`card flex cursor-pointer gap-3 p-4 ${mode === o.v ? "ring-2 ring-accent" : ""}`}>
              <input type="radio" name="mode" value={o.v} checked={mode === o.v} onChange={() => setMode(o.v)} className="sr-only" />
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent-deep"><o.icon size={18} /></span>
              <span><span className="block font-semibold">{o.t}</span><span className="block text-sm text-ink-soft">{o.d}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 card p-4">
        <p className="font-semibold">{mode === "single" ? "Choose narrator" : "Narrator voice (optional)"}</p>
        <p className="mb-3 text-sm text-ink-soft">{mode === "single" ? "This voice performs everything." : "Leave empty to let the AI pick the best narrator; character voices are cast around it."}</p>
        <VoicePicker voices={voices} value={narrator} onChange={setNarrator} previewName="the narrator" />
      </div>

      {err && <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm text-red-700" role="alert">{err}</p>}
      <div className="mt-6 flex items-center gap-3">
        <button type="button" onClick={submit} disabled={!file || !!busy} className="btn-primary text-base">{busy ? <><Loader2 size={18} className="animate-spin" /> {busy}</> : "Analyse & cast"}</button>
        <p className="text-xs text-ink-mute">Your file stays private to you.</p>
      </div>
    </div>
  );
}

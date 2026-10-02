"use client";
import { useEffect, useState } from "react";
import { VoicePicker, api } from "@/components/ui";
import type { UserSettings } from "@/db/schema";
import type { Voice } from "@/lib/tts/provider";

export default function SettingsPage() {
  const [s, setS] = useState<UserSettings>({});
  const [voices, setVoices] = useState<Voice[]>([]);
  const [engines, setEngines] = useState<{ id: string; name: string }[]>([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api<{ settings: UserSettings }>("/api/settings").then((d) => setS(d.settings));
    api<{ voices: Voice[]; engines: { id: string; name: string }[] }>("/api/voices").then((d) => { setVoices(d.voices); setEngines(d.engines); });
  }, []);
  const save = async (patch: UserSettings) => {
    const next = { ...s, ...patch };
    setS(next);
    if (patch.theme) {
      localStorage.setItem("vox-theme", patch.theme);
      const dark = patch.theme === "dark" || (patch.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    }
    await api("/api/settings", { method: "PUT", body: JSON.stringify(next) });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const Row = ({ t, d, children }: { t: string; d?: string; children: React.ReactNode }) => (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">{t}</p>{d && <p className="text-sm text-ink-soft">{d}</p>}</div><div>{children}</div></div>
  );
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-4xl font-semibold">Settings</h1>
      <p className="mt-1 text-ink-soft">{saved ? "Saved ✓" : "Changes save automatically."}</p>
      <section className="card mt-6 divide-y divide-line px-5"><h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-ink-mute">Appearance</h2>
        <Row t="Theme"><div className="flex gap-1">{(["light", "dark", "system"] as const).map((t) => <button key={t} onClick={() => save({ theme: t })} className={`rounded-full px-3 py-1.5 text-sm capitalize ${(s.theme ?? "system") === t ? "bg-ink text-white" : "bg-paper-2"}`}>{t}</button>)}</div></Row>
      </section>
      <section className="card mt-6 divide-y divide-line px-5"><h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-ink-mute">Playback</h2>
        <Row t="Default speed"><select className="input w-32" value={s.defaultSpeed ?? 1} onChange={(e) => save({ defaultSpeed: Number(e.target.value) })}>{[0.75, 1, 1.25, 1.5, 1.75, 2].map((v) => <option key={v} value={v}>{v}x</option>)}</select></Row>
        <Row t="Auto-play next chapter"><input type="checkbox" className="h-5 w-5 accent-accent" checked={s.autoplayNext ?? true} onChange={(e) => save({ autoplayNext: e.target.checked })} aria-label="Auto-play next chapter" /></Row>
      </section>
      <section className="card mt-6 divide-y divide-line px-5"><h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-ink-mute">Narration</h2>
        <Row t="Default narration mode"><div className="flex gap-1">{(["multi", "single"] as const).map((m) => <button key={m} onClick={() => save({ defaultMode: m })} className={`rounded-full px-3 py-1.5 text-sm ${(s.defaultMode ?? "multi") === m ? "bg-ink text-white" : "bg-paper-2"}`}>{m === "multi" ? "Character voices" : "One voice"}</button>)}</div></Row>
        <Row t="Default narrator" d="Used for new books unless you choose otherwise."><VoicePicker voices={voices} value={s.defaultNarratorVoiceId ?? null} onChange={(v) => save({ defaultNarratorVoiceId: v })} previewName="the narrator" /></Row>
      </section>
      <section className="card mt-6 divide-y divide-line px-5"><h2 className="pt-4 text-xs font-semibold uppercase tracking-wider text-ink-mute">Processing</h2>
        <Row t="Speech engine" d="Engines available on this server."><span className="chip">{engines.map((e) => e.name).join(" · ") || "Kokoro-82M (local)"}</span></Row>
        <Row t="Audio quality" d="High uses the fp32 model when available (slower)."><div className="flex gap-1">{(["standard", "high"] as const).map((q) => <button key={q} onClick={() => save({ audioQuality: q })} className={`rounded-full px-3 py-1.5 text-sm capitalize ${(s.audioQuality ?? "standard") === q ? "bg-ink text-white" : "bg-paper-2"}`}>{q}</button>)}</div></Row>
      </section>
      <section className="card mt-6 p-5 text-sm text-ink-soft"><h2 className="text-xs font-semibold uppercase tracking-wider text-ink-mute">Privacy</h2><p className="mt-2">Uploaded books, extracted text and generated audio are stored on this server&apos;s private storage and tied to your anonymous session. Nothing is sent to third-party AI APIs. Public-domain imports are fetched directly from Project Gutenberg.</p></section>
    </div>
  );
}

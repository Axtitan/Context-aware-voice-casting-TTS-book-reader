"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Mic2, Loader2, ChevronDown } from "lucide-react";
import { LockButton, PreviewButton, ResetButton, VoicePicker, api, usePoll } from "@/components/ui";
import type { BookDetail } from "@/components/bookTypes";

export default function CastingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, refresh } = usePoll<BookDetail>(`/api/books/${id}`, 6000);
  const [busy, setBusy] = useState(false);
  const [showMinor, setShowMinor] = useState(false);
  if (!data) return <p className="text-ink-mute">Loading…</p>;
  const { book, characters, voices, warnings } = data;
  const a = book.analysis;
  const update = async (charId: string, body: Record<string, unknown>) => {
    await api(`/api/books/${id}/characters/${charId}`, { method: "PATCH", body: JSON.stringify(body) });
    await refresh();
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
  const groups = [
    { t: "Major characters", items: characters.filter((c) => c.importance === "major") },
    { t: "Supporting", items: characters.filter((c) => c.importance === "supporting") },
  ];
  const minor = characters.filter((c) => c.importance === "minor");
  const narratorVoice = voices.find((v) => v.id === book.narratorVoiceId);

  return (
    <div className="mx-auto max-w-4xl">
      <Link href={`/books/${id}`} className="text-sm text-ink-mute hover:text-ink">← {book.title}</Link>
      <h1 className="mt-2 font-display text-4xl font-semibold">Voice casting</h1>
      {a && <p className="mt-2 text-ink-soft">We found <strong>{a.characters}</strong> characters ({a.majorCharacters} important). <strong>{a.uniqueVoices ?? 0}</strong> have unique voices{a.sharedVoices ? <>, <strong>{a.sharedVoices}</strong> minor roles share suitable voices</> : null}. Voices stay locked to their character for the entire book.</p>}

      {warnings.length > 0 && (
        <div className="card mt-5 border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-amber-800"><AlertTriangle size={16} /> Voice collision check</p>
          <ul className="mt-1 list-disc pl-5 text-amber-900">{warnings.map((w, i) => <li key={i}>{w.message}{w.suggestion && <> Suggested alternative: <button className="underline" onClick={() => update(w.characterIds[1], { voiceId: w.suggestion })}>{voices.find((v) => v.id === w.suggestion)?.name}</button></>}</li>)}</ul>
        </div>
      )}

      <div className="card mt-6 flex flex-wrap items-center gap-3 p-4">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-white"><Mic2 size={18} /></span>
        <div className="min-w-0 flex-1"><p className="font-semibold">Narrator{a?.pov === "first" && a.narratorCharacterId ? ` (first person: ${characters.find((c) => c.id === a.narratorCharacterId)?.name ?? "—"})` : ""}</p><p className="text-xs text-ink-mute">{narratorVoice ? `${narratorVoice.name} · ${narratorVoice.accent} · ${narratorVoice.style.slice(0, 3).join(", ")}` : "—"}</p></div>
        {narratorVoice && <PreviewButton voiceId={narratorVoice.id} name="the narrator" />}
        <VoicePicker voices={voices} value={book.narratorVoiceId} previewName="the narrator" onChange={async (v) => { await api(`/api/books/${id}`, { method: "PATCH", body: JSON.stringify({ narratorVoiceId: v }) }); await refresh(); }} />
      </div>

      {groups.map((g) => g.items.length > 0 && (
        <section key={g.t} className="mt-8">
          <h2 className="mb-3 font-display text-2xl font-semibold">{g.t}</h2>
          <ul className="space-y-3">{g.items.map((c) => <CharacterRow key={c.id} c={c} voices={voices} update={update} />)}</ul>
        </section>
      ))}
      {minor.length > 0 && (
        <section className="mt-8">
          <button onClick={() => setShowMinor((s) => !s)} className="flex items-center gap-2 font-display text-2xl font-semibold" aria-expanded={showMinor}>Minor characters ({minor.length}) <ChevronDown size={18} className={showMinor ? "rotate-180" : ""} /></button>
          {showMinor && <ul className="mt-3 space-y-3">{minor.map((c) => <CharacterRow key={c.id} c={c} voices={voices} update={update} compact />)}</ul>}
        </section>
      )}

      <div className="sticky bottom-20 mt-10 flex justify-end md:bottom-6">
        <button onClick={generate} disabled={busy} className="btn-primary text-base shadow-card">{busy ? <Loader2 size={18} className="animate-spin" /> : <Mic2 size={18} />} Generate audiobook</button>
      </div>
    </div>
  );
}

function CharacterRow({ c, voices, update, compact }: { c: BookDetail["characters"][number]; voices: BookDetail["voices"]; update: (id: string, b: Record<string, unknown>) => Promise<void>; compact?: boolean }) {
  const v = voices.find((x) => x.id === c.voiceId);
  const [open, setOpen] = useState(false);
  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-accent-soft font-display text-lg font-bold text-accent-deep">{c.name.charAt(0)}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">{c.name}{c.isNarrator && <span className="chip bg-ink text-white">Narrator</span>}{c.voiceSource === "user" && <span className="chip bg-accent text-white">Your pick</span>}{c.voiceShared && <span className="chip">Shared voice</span>}</p>
          <p className="text-xs text-ink-mute">{c.requirements.length ? c.requirements.join(" · ") : "No explicit description in text"}{c.aliases.length ? ` · also “${c.aliases.slice(0, 3).join("”, “")}”` : ""} · {c.lineCount} lines</p>
          <p className="mt-1 text-sm text-ink-soft">{c.voiceSource === "user" ? "Selected by you" : "AI selected"}: <strong>{v?.name ?? "—"}</strong>{v ? ` · ${v.accent} ${v.gender} · ${v.ageRange}` : ""}{c.voiceSource !== "user" && c.voiceConfidence ? <span className="text-ink-mute"> · match {Math.round(c.voiceConfidence * 100)}%</span> : null}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {v && <PreviewButton voiceId={v.id} name={c.name.split(" ")[0]} />}
          <VoicePicker voices={voices} value={c.voiceId} previewName={c.name.split(" ")[0]} onChange={(id) => update(c.id, { voiceId: id })} />
          <LockButton locked={c.voiceLocked} onToggle={() => update(c.id, { locked: !c.voiceLocked })} />
          <ResetButton disabled={c.voiceSource !== "user"} onClick={() => update(c.id, { reset: true })} />
        </div>
      </div>
      {!compact && (
        <div className="mt-3">
          <button onClick={() => setOpen((o) => !o)} className="text-sm font-medium text-accent-deep" aria-expanded={open}>Why this voice? {open ? "▴" : "▾"}</button>
          {open && (
            <div className="mt-2 rounded-2xl bg-paper-2 p-3 text-sm">
              <p className="text-ink-soft">{c.voiceReason}</p>
              {c.evidence.length > 0 ? (
                <ul className="mt-2 space-y-1.5">{c.evidence.slice(0, 8).map((e, i) => <li key={i}><span className="chip mr-2 capitalize">{e.attribute}: {e.value}</span><span className="text-ink-soft">“{e.quote}”</span></li>)}</ul>
              ) : <p className="mt-2 text-ink-mute">The text never describes this character&apos;s age, origin or voice, so a neutral voice was chosen rather than guessing.</p>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

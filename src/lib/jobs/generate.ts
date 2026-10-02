/**
 * generate_audio job: performs the plan chapter by chapter.
 * Each segment is synthesised with the character's locked voice, cached by (engine, voice, version, text hash),
 * post-processed (trim/fade/normalise) and assembled into a chapter WAV with segment timings for text sync.
 */
import { db } from "@/db";
import { audioAssets, books, chapters, characters, segments, type Job } from "@/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { allVoices, synthesize } from "@/lib/tts";
import type { Voice } from "@/lib/tts/provider";
import { assemble, decodeWav, durationMs, encodeWav, normalize, trimAndFade, type AssemblyPiece } from "@/lib/audio/wav";
import { storage, hashText } from "@/lib/storage";
import { isJobCancelled, type ProgressReporter } from "./queue";

export async function generateAudio(job: Job, report: ProgressReporter) {
  const [book] = await db.select().from(books).where(eq(books.id, job.bookId)).limit(1);
  if (!book) throw new Error("Book not found");
  const requested = (job.payload.chapterIds as string[] | undefined) ?? undefined;
  const voices = await allVoices();
  const voiceById = new Map(voices.map((v) => [v.id, v]));
  const engineVoices = voices.filter((v) => v.engine === (book.engine ?? "kokoro"));
  const narratorVoice = voiceById.get(book.narratorVoiceId ?? "") ?? engineVoices.sort((a, b) => b.narratorSuitability - a.narratorSuitability)[0];
  if (!narratorVoice) throw new Error("No narrator voice available");

  const chars = await db.select().from(characters).where(eq(characters.bookId, book.id));
  const charVoice = new Map<string, Voice>();
  const charName = new Map<string, string>();
  for (const c of chars) {
    charName.set(c.id, c.name);
    const v = c.voiceId ? voiceById.get(c.voiceId) : undefined;
    charVoice.set(c.id, v ?? narratorVoice); // consistent per character across the whole book
  }
  const single = book.narrationMode === "single";

  const chapterList = await db
    .select()
    .from(chapters)
    .where(requested?.length ? and(eq(chapters.bookId, book.id), inArray(chapters.id, requested)) : eq(chapters.bookId, book.id))
    .orderBy(asc(chapters.order));
  const todo = chapterList.filter((c) => c.audioStatus !== "ready");
  await db.update(books).set({ status: "generating", updatedAt: new Date() }).where(eq(books.id, book.id));
  await db.update(chapters).set({ audioStatus: "queued" }).where(inArray(chapters.id, todo.map((c) => c.id)));

  const totalWords = todo.reduce((n, c) => n + (c.wordCount ?? 0), 0) || 1;
  let doneWords = 0;

  for (const ch of todo) {
    if (await isJobCancelled(job.id)) return;
    await db.update(chapters).set({ audioStatus: "generating", audioProgress: 0, audioError: null }).where(eq(chapters.id, ch.id));
    await report({ stage: `Performing “${ch.title}”`, progress: doneWords / totalWords, stats: { chapter: ch.order + 1, chapters: chapterList.length } });
    try {
      const segs = await db.select().from(segments).where(eq(segments.chapterId, ch.id)).orderBy(asc(segments.order));
      const pieces: AssemblyPiece[] = [];
      let lastVoice: string | null = null;
      let chWords = 0;
      const chTotal = segs.reduce((n, s) => n + s.text.length, 0) || 1;
      let chDone = 0;
      let lastReport = Date.now();
      for (const s of segs) {
        const voice = single ? narratorVoice : s.speakerCharacterId && s.speakerConfidence !== null && (s.speakerConfidence ?? 0) >= 0.3 ? charVoice.get(s.speakerCharacterId) ?? narratorVoice : narratorVoice;
        const pcm = await synthesizeCached(book.id, ch.id, s.id, s.text, voice, { emotion: s.emotion ?? "neutral", intensity: s.intensity ?? 0.2, pace: (s.pace as "slow" | "medium" | "fast") ?? "medium", delivery: s.delivery });
        pieces.push({ id: s.id, pcm, speakerChange: lastVoice !== null && lastVoice !== voice.id, paragraphEnd: s.paragraphEnd, type: s.type });
        lastVoice = voice.id;
        chDone += s.text.length;
        chWords += s.text.split(/\s+/).length;
        if (Date.now() - lastReport > 2500) {
          lastReport = Date.now();
          const frac = chDone / chTotal;
          await db.update(chapters).set({ audioProgress: frac }).where(eq(chapters.id, ch.id));
          await report({ progress: (doneWords + (ch.wordCount ?? chWords) * frac) / totalWords, stage: `Performing “${ch.title}”` });
        }
        if (pieces.length % 40 === 0 && (await isJobCancelled(job.id))) return;
      }
      const sampleRate = pieces[0]?.pcm.sampleRate ?? 24000;
      const { pcm, timings } = assemble(pieces, sampleRate);
      const key = `audio/${book.id}/chapters/${ch.id}.wav`;
      await storage.put(key, encodeWav(pcm));
      for (let i = 0; i < timings.length; i += 500) {
        const batch = timings.slice(i, i + 500);
        const ids = batch.map((t) => t.id);
        const starts = batch.map((t) => t.startMs);
        const ends = batch.map((t) => t.endMs);
        await db.execute(sql`update segments s set start_ms = t.s, end_ms = t.e from unnest(${ids}::uuid[], ${starts}::int[], ${ends}::int[]) as t(id, s, e) where s.id = t.id`);
      }
      const dur = durationMs(pcm);
      await db.update(chapters).set({ audioStatus: "ready", audioPath: key, durationMs: dur, audioProgress: 1 }).where(eq(chapters.id, ch.id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.update(chapters).set({ audioStatus: "failed", audioError: msg.slice(0, 500) }).where(eq(chapters.id, ch.id));
      throw e;
    }
    doneWords += ch.wordCount ?? 0;
  }
  const all = await db.select({ d: chapters.durationMs, s: chapters.audioStatus }).from(chapters).where(eq(chapters.bookId, book.id));
  const total = all.reduce((n, c) => n + (c.d ?? 0), 0);
  await db.update(books).set({ status: "ready", totalDurationMs: total, updatedAt: new Date() }).where(eq(books.id, book.id));
}

type Delivery = { emotion: string; intensity: number; pace: "slow" | "medium" | "fast"; delivery: string | null };

/** Segment-level audio cache keyed by engine + voice + voice version + text/delivery hash. */
export async function synthesizeCached(bookId: string, chapterId: string | null, segmentId: string | null, text: string, voice: Voice, d: Delivery) {
  const textHash = hashText(text, d.emotion, String(d.intensity), d.pace, d.delivery ?? "");
  const [hit] = await db.select().from(audioAssets).where(and(eq(audioAssets.engine, voice.engine), eq(audioAssets.voiceId, voice.id), eq(audioAssets.voiceVersion, voice.version), eq(audioAssets.textHash, textHash))).limit(1);
  if (hit && (await storage.exists(hit.path))) return decodeWav(await storage.get(hit.path));
  const { audio, voiceUsed } = await synthesize({ text, voice, emotion: d.emotion, intensity: d.intensity, pace: d.pace, delivery: d.delivery });
  const processed = normalize(trimAndFade(audio));
  const key = `audio/${bookId}/segments/${voiceUsed.engine}_${voiceUsed.engineVoiceId}_${textHash}.wav`;
  await storage.put(key, encodeWav(processed));
  await db
    .insert(audioAssets)
    .values({ bookId, chapterId, segmentId, engine: voice.engine, voiceId: voice.id, voiceVersion: voice.version, textHash, path: key, durationMs: durationMs(processed) })
    .onConflictDoNothing();
  return processed;
}

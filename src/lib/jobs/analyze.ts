/**
 * analyze_book job: file -> blocks -> structure -> characters -> narrator -> performance plan -> casting.
 */
import { db } from "@/db";
import { books, chapters, characters, scenes, segments, type Job } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { extractDocument, countWords, type Block, type SupportedFormat } from "@/lib/ingestion/extract";
import { findStoryStart, detectChapters, detectScenes, inferTitleAuthor } from "@/lib/analysis/structure";
import { extractCharacters, detectQuoteStyle, rankImportance } from "@/lib/analysis/characters";
import { detectNarrator, chapterNarrator, buildChapterPlan, type PlanSegment } from "@/lib/analysis/dialogue";
import { castBook, type CastableCharacter } from "@/lib/casting/cast";
import { allVoices } from "@/lib/tts";
import { storage } from "@/lib/storage";
import type { ProgressReporter } from "./queue";

const WORDS_PER_MINUTE = 150;

export async function analyzeBook(job: Job, report: ProgressReporter) {
  const [book] = await db.select().from(books).where(eq(books.id, job.bookId)).limit(1);
  if (!book) throw new Error("Book not found");
  const setStatus = (status: typeof book.status, error?: string) => db.update(books).set({ status, error: error ?? null, updatedAt: new Date() }).where(eq(books.id, book.id));

  try {
    // ---- 1. Extract
    await setStatus("extracting");
    await report({ stage: "Extracting text…", progress: 0.05 });
    if (!book.filePath || !book.format) throw new Error("Book has no source file");
    const buf = await storage.get(book.filePath);
    const doc = await extractDocument(buf, book.format as SupportedFormat, book.originalFilename ?? "book");
    if (doc.ocr && (doc.ocrConfidence ?? 0) < 0.35) {
      await setStatus("needs_ocr", `Scanned PDF: OCR confidence was too low (${Math.round((doc.ocrConfidence ?? 0) * 100)}%) to produce reliable audio.`);
      throw new Error("OCR confidence too low");
    }
    const blocks = doc.blocks;
    const wordCount = blocks.reduce((n, b) => n + countWords(b.text), 0);
    if (wordCount < 30) throw new Error("No readable text found in this document");
    await storage.put(`books/${book.id}/blocks.json`, JSON.stringify(blocks));

    // ---- 2. Metadata + story start
    await setStatus("analyzing");
    await report({ stage: "Understanding your book…", progress: 0.15, stats: { words: wordCount } });
    const inferred = inferTitleAuthor(blocks);
    const title = book.sourceType === "upload" && !isRealTitle(book.title) ? doc.metadata.title && isRealTitle(doc.metadata.title) ? doc.metadata.title : inferred.title ?? book.title : book.title;
    const author = book.author ?? doc.metadata.author ?? inferred.author ?? null;
    const { start, frontMatterBlocks } = findStoryStart(blocks);

    // ---- 3. Chapters + scenes
    await report({ stage: "Detecting chapters…", progress: 0.22 });
    const detected = detectChapters(blocks, start, title);
    const quoteStyle = detectQuoteStyle(blocks.slice(start));
    const storyEnd = detected[detected.length - 1]?.endBlock ?? blocks.length;

    // ---- 4. Characters
    await report({ stage: "Identifying characters…", progress: 0.3, stats: { chapters: detected.length, words: wordCount } });
    const profiles = extractCharacters(blocks, start, storyEnd, quoteStyle);
    const bookNarrator = detectNarrator(blocks, start, storyEnd, profiles, quoteStyle);

    // ---- 5. Performance plan (attribution, emotion) per chapter
    const lineCounts = new Map<string, number>();
    const plans: { chapterIdx: number; segments: PlanSegment[]; scenes: ReturnType<typeof detectScenes>; scenePresence: string[][]; narrator: ReturnType<typeof chapterNarrator> }[] = [];
    let sceneTotal = 0;
    for (let i = 0; i < detected.length; i++) {
      const ch = detected[i];
      const narrator = chapterNarrator(ch, blocks, profiles, bookNarrator, quoteStyle);
      const chScenes = detectScenes(blocks, ch.startBlock, ch.endBlock);
      const { segments: segs, scenePresence } = buildChapterPlan(blocks, ch, chScenes, profiles, narrator, quoteStyle, lineCounts);
      plans.push({ chapterIdx: i, segments: segs, scenes: chScenes, scenePresence, narrator });
      sceneTotal += chScenes.length;
      if (i % 3 === 0) await report({ stage: "Attributing dialogue…", progress: 0.35 + 0.3 * (i / detected.length), stats: { chapters: detected.length, characters: profiles.length, scenes: sceneTotal } });
    }
    for (const p of profiles) p.lineCount = lineCounts.get(p.key) ?? 0;
    // Speaking characters that were filtered as weak candidates still count; drop entities with no lines and few mentions
    const storyWords = detected.reduce((n, c) => n + c.wordCount, 0);
    rankImportance(profiles, storyWords);
    // Keep speaking characters, described (gendered) non-speaking characters, and the narrator; drop place-like entities.
    const finalProfiles = profiles.filter((p) => p.lineCount > 0 || (p.genderConfidence > 0 && p.mentionCount >= 3) || p.key === bookNarrator.narratorKey);
    const narratorKeys = new Set(plans.map((p) => p.narrator.narratorKey).filter(Boolean) as string[]);
    if (bookNarrator.narratorKey) narratorKeys.add(bookNarrator.narratorKey);
    for (const p of finalProfiles) if (narratorKeys.has(p.key)) p.importance = "major";

    // ---- 6. Persist structure (replace previous analysis, keep user voice choices by name)
    await report({ stage: "Casting voices…", progress: 0.7, stats: { chapters: detected.length, characters: finalProfiles.length, scenes: sceneTotal } });
    const previous = await db.select().from(characters).where(eq(characters.bookId, book.id));
    const prevByName = new Map(previous.map((c) => [c.name.toLowerCase(), c]));
    await db.delete(segments).where(eq(segments.bookId, book.id));
    await db.delete(chapters).where(eq(chapters.bookId, book.id));
    await db.delete(characters).where(eq(characters.bookId, book.id));

    const charRows = finalProfiles.length
      ? await db
          .insert(characters)
          .values(
            finalProfiles.map((p) => {
              const prev = prevByName.get(p.name.toLowerCase());
              const keepUser = prev && (prev.voiceSource === "user" || prev.voiceLocked);
              return {
                bookId: book.id, name: p.name, aliases: p.aliases, gender: p.gender, genderConfidence: p.genderConfidence, age: p.age, nationality: p.nationality, accent: p.accent,
                physicalDescriptions: p.physicalDescriptions, vocalDescriptions: p.vocalDescriptions, personality: p.personality, evidence: p.evidence, importance: p.importance,
                mentionCount: p.mentionCount, lineCount: p.lineCount, isNarrator: narratorKeys.has(p.key), characterConfidence: p.characterConfidence,
                voiceId: keepUser ? prev!.voiceId : null, voiceSource: keepUser ? ("user" as const) : ("ai" as const), voiceLocked: keepUser ? prev!.voiceLocked : false,
              };
            }),
          )
          .returning()
      : [];
    const keyToId = new Map<string, string>();
    finalProfiles.forEach((p, i) => keyToId.set(p.key, charRows[i].id));

    const chapterRows = await db
      .insert(chapters)
      .values(
        detected.map((c, i) => ({
          bookId: book.id, order: i, title: c.title, kind: c.kind, startBlock: c.startBlock, endBlock: c.endBlock, wordCount: c.wordCount,
          pov: plans[i].narrator.pov, narratorCharacterId: plans[i].narrator.narratorKey ? keyToId.get(plans[i].narrator.narratorKey) ?? null : null, narratorConfidence: plans[i].narrator.confidence,
        })),
      )
      .returning();

    let segmentTotal = 0;
    let dialogueTotal = 0;
    for (let i = 0; i < chapterRows.length; i++) {
      const plan = plans[i];
      const sceneRows = plan.scenes.length
        ? await db
            .insert(scenes)
            .values(plan.scenes.map((s, k) => ({ chapterId: chapterRows[i].id, order: k, startBlock: s.startBlock, endBlock: s.endBlock, charactersPresent: (plan.scenePresence[k] ?? []).map((key) => keyToId.get(key)).filter(Boolean) as string[] })))
            .returning({ id: scenes.id })
        : [];
      const rows = plan.segments.map((s, order) => ({
        bookId: book.id, chapterId: chapterRows[i].id, sceneId: sceneRows[s.sceneIndex]?.id ?? null, order, blockIndex: s.blockIndex, type: s.type,
        speakerCharacterId: s.speakerKey ? keyToId.get(s.speakerKey) ?? null : null, speakerConfidence: s.speakerConfidence, attributionMethod: s.method, text: s.text,
        emotion: s.emotion, intensity: s.intensity, pace: s.pace, delivery: s.delivery, paragraphEnd: s.paragraphEnd,
      }));
      for (let k = 0; k < rows.length; k += 500) await db.insert(segments).values(rows.slice(k, k + 500));
      segmentTotal += rows.length;
      dialogueTotal += rows.filter((r) => r.type === "dialogue").length;
    }

    // ---- 7. Casting
    const pool = (await allVoices()).filter((v) => v.engine === (book.engine ?? "kokoro"));
    const castable: CastableCharacter[] = charRows.map((c) => ({
      id: c.id, name: c.name, gender: c.gender as "male" | "female" | null, genderConfidence: c.genderConfidence ?? 0, age: c.age, nationality: c.nationality, accent: c.accent,
      vocalDescriptions: c.vocalDescriptions, personality: c.personality, importance: c.importance, isNarrator: c.isNarrator, voiceId: c.voiceId, voiceSource: c.voiceSource, voiceLocked: c.voiceLocked,
    }));
    const narratorPref = book.narratorVoiceId && pool.some((v) => v.id === book.narratorVoiceId) ? book.narratorVoiceId : null;
    const cast = castBook(castable, pool, narratorPref);
    for (const r of cast.results) {
      const c = charRows.find((x) => x.id === r.characterId)!;
      if (c.voiceSource === "user" || c.voiceLocked) continue;
      await db.update(characters).set({ voiceId: r.voiceId, aiVoiceId: r.voiceId, voiceSource: "ai", voiceConfidence: r.confidence, voiceReason: r.reason, voiceShared: r.shared }).where(eq(characters.id, r.characterId));
    }
    const unique = new Set(cast.results.filter((r) => !r.shared).map((r) => r.voiceId)).size;
    const majorCount = charRows.filter((c) => c.importance === "major").length;

    await report({ stage: "Preparing audiobook…", progress: 0.95 });
    await db
      .update(books)
      .set({
        title, author, language: book.language ?? doc.metadata.language ?? "en", publisher: book.publisher ?? doc.metadata.publisher ?? null, publicationYear: book.publicationYear ?? doc.metadata.publicationYear ?? null,
        isbn: book.isbn ?? doc.metadata.isbn ?? null, coverUrl: book.coverUrl ?? doc.metadata.coverDataUrl ?? null, description: book.description ?? doc.metadata.description ?? null,
        subtitle: book.subtitle ?? doc.metadata.subtitle ?? null, narratorVoiceId: cast.narratorVoiceId, blocksPath: `books/${book.id}/blocks.json`, wordCount: storyWords, status: "ready", error: null, updatedAt: new Date(),
        analysis: {
          chapters: detected.length, characters: charRows.length, majorCharacters: majorCount, scenes: sceneTotal, segments: segmentTotal, dialogueSegments: dialogueTotal, wordCount: storyWords,
          storyStartBlock: start, frontMatterBlocks, pov: bookNarrator.pov, narratorCharacterId: bookNarrator.narratorKey ? keyToId.get(bookNarrator.narratorKey) ?? null : null, narratorConfidence: bookNarrator.confidence,
          estimatedMinutes: Math.round(storyWords / WORDS_PER_MINUTE), uniqueVoices: unique, sharedVoices: cast.results.filter((r) => r.shared).length,
          extraction: { pages: doc.pages, scanned: doc.scanned, ocr: doc.ocr, ocrConfidence: doc.ocrConfidence, warnings: [...doc.warnings, ...cast.warnings.map((w) => w.message)] },
        },
      })
      .where(eq(books.id, book.id));
  } catch (e) {
    const [cur] = await db.select({ status: books.status }).from(books).where(eq(books.id, book.id)).limit(1);
    if (cur?.status !== "needs_ocr") await setStatus("failed", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

function isRealTitle(t: string | null | undefined): boolean {
  return !!t && t.trim().length > 1 && !/^(untitled|document|book|upload|new document)\d*$/i.test(t.trim());
}

/** Re-run casting only (after the user changes narrator voice / engine) without re-analysing. */
export async function recastBook(bookId: string) {
  const [book] = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  if (!book) return;
  const rows = await db.select().from(characters).where(eq(characters.bookId, bookId));
  const pool = (await allVoices()).filter((v) => v.engine === (book.engine ?? "kokoro"));
  const cast = castBook(
    rows.map((c) => ({ id: c.id, name: c.name, gender: c.gender as "male" | "female" | null, genderConfidence: c.genderConfidence ?? 0, age: c.age, nationality: c.nationality, accent: c.accent, vocalDescriptions: c.vocalDescriptions, personality: c.personality, importance: c.importance, isNarrator: c.isNarrator, voiceId: c.voiceId, voiceSource: c.voiceSource, voiceLocked: c.voiceLocked })),
    pool,
    book.narratorVoiceId,
  );
  for (const r of cast.results) {
    const c = rows.find((x) => x.id === r.characterId)!;
    if (c.voiceSource === "user" || c.voiceLocked) continue;
    await db.update(characters).set({ voiceId: r.voiceId, aiVoiceId: r.voiceId, voiceConfidence: r.confidence, voiceReason: r.reason, voiceShared: r.shared }).where(eq(characters.id, r.characterId));
  }
  return cast.warnings;
}

export async function loadBlocks(bookId: string): Promise<Block[]> {
  const buf = await storage.get(`books/${bookId}/blocks.json`);
  return JSON.parse(buf.toString("utf8")) as Block[];
}

export async function resetChapterAudio(bookId: string, chapterIds?: string[]) {
  const where = chapterIds?.length ? and(eq(chapters.bookId, bookId), inArray(chapters.id, chapterIds)) : eq(chapters.bookId, bookId);
  await db.update(chapters).set({ audioStatus: "none", audioPath: null, durationMs: 0, audioProgress: 0, audioError: null }).where(where);
}

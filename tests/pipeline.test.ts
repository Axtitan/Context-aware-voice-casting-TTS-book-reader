import { describe, it, expect } from "vitest";
import { extractDocument, textToBlocks, htmlToBlocks, pagesToBlocks, countWords } from "@/lib/ingestion/extract";
import { findStoryStart, detectChapters, classifyHeading, detectScenes } from "@/lib/analysis/structure";
import { extractCharacters, detectQuoteStyle, rankImportance, splitSentences } from "@/lib/analysis/characters";
import { detectNarrator, buildChapterPlan, analyzeDelivery, chapterNarrator } from "@/lib/analysis/dialogue";
import { castBook, detectCollisions } from "@/lib/casting/cast";
import { KOKORO_VOICES } from "@/lib/tts/kokoro";
import { assemble, encodeWav, decodeWav, normalize, trimAndFade } from "@/lib/audio/wav";
import { SAMPLE_TEXT } from "@/lib/books/sample";
import { stripGutenbergBoilerplate } from "@/lib/books/gutenberg";

async function analyse(text: string) {
  const doc = await extractDocument(Buffer.from(text), "txt", "t.txt");
  const { start } = findStoryStart(doc.blocks);
  const chapters = detectChapters(doc.blocks, start, "Book");
  const qs = detectQuoteStyle(doc.blocks.slice(start));
  const end = chapters[chapters.length - 1].endBlock;
  const profiles = extractCharacters(doc.blocks, start, end, qs);
  const narrator = detectNarrator(doc.blocks, start, end, profiles, qs);
  const lines = new Map<string, number>();
  const segments = chapters.flatMap((ch) => buildChapterPlan(doc.blocks, ch, detectScenes(doc.blocks, ch.startBlock, ch.endBlock), profiles, chapterNarrator(ch, doc.blocks, profiles, narrator, qs), qs, lines).segments);
  for (const p of profiles) p.lineCount = lines.get(p.key) ?? 0;
  rankImportance(profiles, chapters.reduce((n, c) => n + c.wordCount, 0));
  return { doc, start, chapters, profiles, narrator, segments };
}

describe("document extraction", () => {
  it("splits plain text into headings and paragraphs, repairing hyphenation", () => {
    const blocks = textToBlocks("CHAPTER ONE\n\nThe cat sat on the mat. It was a won-\nderful day.\n\nII\n\nMore text here that is long enough.");
    expect(blocks[0]).toMatchObject({ type: "heading", text: "CHAPTER ONE" });
    expect(blocks[1].text).toBe("The cat sat on the mat. It was a wonderful day.");
    expect(blocks[2]).toMatchObject({ type: "heading", text: "II" });
  });
  it("preserves EPUB/HTML structure and italics", () => {
    const blocks = htmlToBlocks("<html><body><h1>Chapter 1</h1><p>First paragraph &amp; more.</p><p><i>Why am I here?</i></p></body></html>");
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1, text: "Chapter 1" });
    expect(blocks[1].text).toBe("First paragraph & more.");
    expect(blocks[2].italic).toBe(true);
  });
  it("removes repeated PDF headers/footers and page numbers", () => {
    const pages = Array.from({ length: 6 }, (_, i) => `MY NOVEL TITLE\nThis is the body text of page ${i + 1} which continues on for a while and ends here.\n${i + 1}`);
    const blocks = pagesToBlocks(pages);
    expect(blocks.every((b) => !/MY NOVEL TITLE/.test(b.text))).toBe(true);
    expect(blocks.every((b) => !/^\d+$/.test(b.text))).toBe(true);
    const paras = blocks.filter((b) => b.type === "paragraph");
    expect(paras.length).toBeGreaterThanOrEqual(1);
    expect(paras.map((b) => b.text).join(" ")).toMatch(/page 1 .* page 6/);
  });
  it("does not split sentences after honorifics", () => {
    expect(splitSentences("It was Mr. Darcy who spoke. Mrs. Bennet sighed.")).toEqual(["It was Mr. Darcy who spoke.", "Mrs. Bennet sighed."]);
  });
  it("strips Project Gutenberg boilerplate", () => {
    const t = "junk\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\nStory.\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\nlicense";
    expect(stripGutenbergBoilerplate(t).trim()).toBe("Story.");
  });
});

describe("structure", () => {
  it("classifies chapter headings in many formats", () => {
    expect(classifyHeading("Chapter One")?.title).toBe("Chapter 1");
    expect(classifyHeading("CHAPTER XII. The Return")?.title).toBe("Chapter 12: The Return");
    expect(classifyHeading("IV")?.title).toBe("Chapter 4");
    expect(classifyHeading("Prologue")?.kind).toBe("prologue");
    expect(classifyHeading("Epilogue")?.kind).toBe("epilogue");
    expect(classifyHeading("Part Two")?.kind).toBe("part");
    expect(classifyHeading("Once upon a time")).toBeNull();
  });
  it("skips front matter and finds the correct chapter boundaries", async () => {
    const { doc, start, chapters } = await analyse(SAMPLE_TEXT);
    expect(doc.blocks[start].text).toMatch(/CHAPTER ONE/i);
    expect(doc.blocks.slice(0, start).some((b) => /Copyright/.test(b.text))).toBe(true);
    expect(chapters.map((c) => c.title)).toEqual(["Chapter 1", "Chapter 2", "Chapter 3"]);
    expect(chapters.every((c) => c.wordCount > 100)).toBe(true);
    // Back matter (About the author) excluded
    const lastText = doc.blocks.slice(chapters[2].startBlock, chapters[2].endBlock).map((b) => b.text).join(" ");
    expect(lastText).not.toMatch(/ABOUT THE AUTHOR/);
  });
});

describe("characters", () => {
  it("extracts distinct characters with evidence-based attributes and never invents them", async () => {
    const { profiles } = await analyse(SAMPLE_TEXT);
    const byName = (n: string) => profiles.find((p) => p.name.includes(n))!;
    const mara = byName("Mara");
    expect(mara.gender).toBe("female");
    expect(mara.nationality).toBe("Nigerian");
    expect(mara.age).toBe("young adult");
    expect(mara.vocalDescriptions).toContain("soft");
    const bellamy = byName("Bellamy");
    expect(bellamy.gender).toBe("male");
    expect(bellamy.age).toBe("older adult");
    expect(bellamy.accent).toBe("Scottish");
    expect(bellamy.vocalDescriptions).toEqual(expect.arrayContaining(["deep", "gravelly"]));
    expect(bellamy.aliases).toContain("Captain Aldous Bellamy");
    const tom = byName("Tom");
    expect(tom.age).toBe("child");
    expect(tom.nationality).toBeNull(); // never stated
    expect(tom.accent).toBeNull();
    expect(profiles.filter((p) => p.importance === "major").length).toBe(3);
    expect(profiles.some((p) => p.name === "Aged")).toBe(false);
    expect(mara.evidence.some((e) => e.attribute === "nationality" && /Nigerian/.test(e.quote))).toBe(true);
  });
  it("merges aliases (first name, title + surname, nickname) into one character and keeps different people apart", async () => {
    const text = `CHAPTER ONE\n\nAlexander Hamilton walked in. Alex looked tired, and Mr. Hamilton had not slept. "Good morning," Hamilton said. "Morning," said Alex.\n\nMrs. Hamilton poured the tea. "You look dreadful," Mrs. Hamilton said to her husband. Eliza Hamilton was not one to mince words; she never had been.\n\n"I know," Alexander said. "Thank you, Eliza," he added. Mr. Hamilton smiled. Alex smiled again. Hamilton left. Mrs. Hamilton stayed. Eliza sighed.`;
    const { profiles } = await analyse(text);
    const alex = profiles.find((p) => p.name === "Alexander Hamilton")!;
    expect(alex).toBeTruthy();
    expect(alex.aliases).toEqual(expect.arrayContaining(["Alex", "Mr Hamilton", "Hamilton"]));
    const eliza = profiles.find((p) => p.name === "Eliza Hamilton")!;
    expect(eliza).toBeTruthy();
    expect(eliza.aliases).toContain("Mrs Hamilton");
    expect(eliza.gender).toBe("female");
    expect(alex.gender).toBe("male");
  });
});

describe("narrator + dialogue attribution", () => {
  it("attributes tagged, action-beat and alternating dialogue to the right speakers", async () => {
    const { segments, profiles } = await analyse(SAMPLE_TEXT);
    const name = (k: string | null) => profiles.find((p) => p.key === k)?.name ?? null;
    const d = segments.filter((s) => s.type === "dialogue");
    expect(d.length).toBeGreaterThan(20);
    expect(name(d.find((s) => s.text.startsWith("I didn't know I was expected"))!.speakerKey)).toMatch(/Mara/);
    expect(name(d.find((s) => s.text.startsWith("Everyone's expected"))!.speakerKey)).toMatch(/Tom/);
    expect(name(d.find((s) => s.text.startsWith("Whose names"))!.speakerKey)).toMatch(/Mara/); // action beat
    expect(name(d.find((s) => s.text.startsWith("Be loud"))!.speakerKey)).toMatch(/Bellamy/); // same paragraph
    expect(name(d.find((s) => s.text.startsWith("They listen"))!.speakerKey)).toMatch(/Mara/); // turn-taking
    expect(d.filter((s) => s.speakerConfidence >= 0.9).length).toBeGreaterThan(10);
    // Thought detection: "Why did I come here? Mara thought." stays narration-of-thought, not dialogue
    expect(d.some((s) => /Why did I come here/.test(s.text))).toBe(false);
  });
  it("detects a first-person narrator and voices 'I said' with that character", async () => {
    const text = `CHAPTER ONE\n\nI walked down to the harbour where Sarah was waiting. "You're late, John," Sarah said.\n\n"I know," I said. "The bus broke down."\n\n"You always say that, John." She laughed. I shrugged and followed her along the pier.\n\n"Where are we going?" I asked.\n\n"Home," said Sarah.`;
    const { narrator, segments, profiles } = await analyse(text);
    expect(narrator.pov).toBe("first");
    expect(profiles.find((p) => p.key === narrator.narratorKey)?.name).toBe("John");
    const mine = segments.find((s) => s.text.startsWith("I know"))!;
    expect(mine.speakerKey).toBe(narrator.narratorKey);
    const narr = segments.find((s) => s.type === "narration" && /walked down/.test(s.text))!;
    expect(narr.speakerKey).toBe(narrator.narratorKey);
  });
  it("shapes delivery from context without overacting", () => {
    expect(analyzeDelivery("Hello.", "she said", "dialogue").emotion).toBe("neutral");
    const shout = analyzeDelivery("GET OUT!", "he", "dialogue");
    expect(shout.intensity).toBeGreaterThan(0.6);
    expect(analyzeDelivery("Please don't go", "she whispered", "dialogue")).toMatchObject({ emotion: "hushed", delivery: "soft" });
    expect(analyzeDelivery("It was a quiet evening.", "", "narration").intensity).toBeLessThan(0.5);
  });
});

describe("voice casting", () => {
  const chars = [
    { id: "a", name: "Mikhail", gender: "male" as const, genderConfidence: 0.9, age: "older adult", nationality: "Russian", accent: null, vocalDescriptions: ["deep", "gravelly"], personality: [], importance: "major" as const, isNarrator: false, voiceId: null, voiceSource: null, voiceLocked: false },
    { id: "b", name: "Sarah", gender: "female" as const, genderConfidence: 0.9, age: "young adult", nationality: null, accent: "British", vocalDescriptions: ["soft"], personality: ["calm"], importance: "major" as const, isNarrator: false, voiceId: null, voiceSource: null, voiceLocked: false },
    { id: "c", name: "James", gender: "male" as const, genderConfidence: 0.9, age: "young adult", nationality: null, accent: "American", vocalDescriptions: [], personality: ["confident"], importance: "major" as const, isNarrator: false, voiceId: null, voiceSource: null, voiceLocked: false },
    { id: "d", name: "Unknown", gender: null, genderConfidence: 0, age: null, nationality: null, accent: null, vocalDescriptions: [], personality: [], importance: "minor" as const, isNarrator: false, voiceId: null, voiceSource: null, voiceLocked: false },
  ];
  it("matches explicit descriptions and keeps major voices distinct", () => {
    const { results, narratorVoiceId } = castBook(chars, KOKORO_VOICES, null);
    const v = (id: string) => KOKORO_VOICES.find((x) => x.id === results.find((r) => r.characterId === id)!.voiceId)!;
    expect(v("a").gender).toBe("male");
    expect(v("a").pitch).toBe("low");
    expect(v("b").gender).toBe("female");
    expect(v("b").accent).toBe("British");
    expect(v("c").gender).toBe("male");
    const majors = results.filter((r) => ["a", "b", "c"].includes(r.characterId)).map((r) => r.voiceId);
    expect(new Set(majors).size).toBe(3);
    expect(majors).not.toContain(narratorVoiceId);
    expect(results.find((r) => r.characterId === "a")!.reason).toMatch(/male voice/);
  });
  it("is deterministic (same character -> same voice) and respects user overrides", () => {
    const first = castBook(chars, KOKORO_VOICES, null).results;
    const second = castBook(chars, KOKORO_VOICES, null).results;
    expect(first).toEqual(second);
    const overridden = chars.map((c) => (c.id === "b" ? { ...c, voiceId: "kokoro:af_sky", voiceSource: "user" as const } : c));
    const res = castBook(overridden, KOKORO_VOICES, null).results;
    expect(res.find((r) => r.characterId === "b")!.voiceId).toBe("kokoro:af_sky");
    expect(res.find((r) => r.characterId === "b")!.reason).toMatch(/Selected by you/);
    expect(res.filter((r) => r.characterId !== "b").every((r) => r.voiceId !== "kokoro:af_sky")).toBe(true);
  });
  it("detects voice collisions between major characters", () => {
    const res = [{ characterId: "a", voiceId: "kokoro:am_onyx", confidence: 1, reason: "", shared: false }, { characterId: "c", voiceId: "kokoro:am_onyx", confidence: 1, reason: "", shared: false }];
    const w = detectCollisions(chars, res, KOKORO_VOICES);
    expect(w.length).toBe(1);
    expect(w[0].suggestion).toBeTruthy();
  });
});

describe("audio", () => {
  it("round-trips WAV and assembles segments with speaker-aware pauses and timings", () => {
    const sr = 24000;
    const tone = (n: number) => ({ samples: Float32Array.from({ length: n }, (_, i) => Math.sin(i / 10) * 0.5), sampleRate: sr });
    const a = normalize(trimAndFade(tone(sr)));
    const wav = encodeWav(a);
    const back = decodeWav(wav);
    expect(back.sampleRate).toBe(sr);
    expect(Math.abs(back.samples.length - a.samples.length)).toBeLessThan(2);
    const { pcm, timings } = assemble([{ id: "1", pcm: tone(sr), speakerChange: false, paragraphEnd: false, type: "narration" }, { id: "2", pcm: tone(sr), speakerChange: true, paragraphEnd: false, type: "dialogue" }], sr);
    expect(timings[0].startMs).toBe(0);
    expect(timings[1].startMs - timings[0].endMs).toBe(420);
    expect(pcm.samples.length).toBeGreaterThan(2 * sr);
    expect(countWords("hello world's end")).toBe(3);
  });
});

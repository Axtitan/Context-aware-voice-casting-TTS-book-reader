/* Offline analysis CLI: npx tsx scripts/analyze-cli.ts <file> – prints the structure/casting the app would produce. */
import { readFileSync } from "node:fs";
import { extractDocument, detectFormat, countWords } from "../src/lib/ingestion/extract";
import { findStoryStart, detectChapters, detectScenes } from "../src/lib/analysis/structure";
import { extractCharacters, detectQuoteStyle, rankImportance } from "../src/lib/analysis/characters";
import { detectNarrator, chapterNarrator, buildChapterPlan } from "../src/lib/analysis/dialogue";
import { castBook } from "../src/lib/casting/cast";
import { KOKORO_VOICES } from "../src/lib/tts/kokoro";

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  let buf: Buffer; let name: string;
  if (file) { buf = readFileSync(file); name = file; } else { const s = await import("../src/lib/books/sample"); buf = Buffer.from(s.SAMPLE_TEXT); name = "sample.txt"; }
  const fmt = detectFormat(name)!;
  const doc = await extractDocument(buf, fmt, name);
  console.log("meta", doc.metadata.title, "|", doc.metadata.author, "| blocks", doc.blocks.length, "| words", doc.blocks.reduce((n,b)=>n+countWords(b.text),0));
  const { start, reason } = findStoryStart(doc.blocks);
  console.log("story start", start, reason, "->", JSON.stringify(doc.blocks[start]?.text.slice(0, 60)));
  const chs = detectChapters(doc.blocks, start, doc.metadata.title ?? "Book");
  console.log("chapters", chs.length); chs.slice(0, 12).forEach(c => console.log("  ", c.kind, "|", c.title, "|", c.wordCount, "w"));
  const qs = detectQuoteStyle(doc.blocks.slice(start));
  const end = chs[chs.length-1].endBlock;
  const profiles = extractCharacters(doc.blocks, start, end, qs);
  const narr = detectNarrator(doc.blocks, start, end, profiles, qs);
  const lines = new Map<string, number>();
  const allSegs = [];
  for (const ch of chs) { const n = chapterNarrator(ch, doc.blocks, profiles, narr, qs); const sc = detectScenes(doc.blocks, ch.startBlock, ch.endBlock); const { segments } = buildChapterPlan(doc.blocks, ch, sc, profiles, n, qs, lines); allSegs.push(...segments); }
  for (const p of profiles) p.lineCount = lines.get(p.key) ?? 0;
  rankImportance(profiles, chs.reduce((n,c)=>n+c.wordCount,0));
  console.log("quoteStyle", qs, "| narrator", narr, "| segments", allSegs.length, "dialogue", allSegs.filter(s=>s.type==="dialogue").length, "unresolved", allSegs.filter(s=>s.type==="dialogue"&&!s.speakerKey).length);
  const cast = castBook(profiles.map(p=>({ id:p.key, name:p.name, gender:p.gender, genderConfidence:p.genderConfidence, age:p.age, nationality:p.nationality, accent:p.accent, vocalDescriptions:p.vocalDescriptions, personality:p.personality, importance:p.importance, isNarrator:p.key===narr.narratorKey, voiceId:null, voiceSource:null, voiceLocked:false })), KOKORO_VOICES, null);
  console.log("narrator voice", cast.narratorVoiceId, "warnings", cast.warnings.map(w=>w.message));
  for (const p of profiles.slice(0, 14)) { const r = cast.results.find(x=>x.characterId===p.key); console.log(`  [${p.importance}] ${p.name} (${p.aliases.slice(0,3).join("/")}) g=${p.gender ?? "?"}:${p.genderConfidence.toFixed(2)} age=${p.age} nat=${p.nationality} acc=${p.accent} voice=[${p.vocalDescriptions}] pers=[${p.personality.slice(0,3)}] m=${p.mentionCount} l=${p.lineCount} -> ${r?.voiceId} (${r?.confidence.toFixed(2)}) ${r?.reason}`); }
  if (process.argv.includes("--segments")) for (const s of allSegs.slice(0, 60)) console.log(`   ${s.type.padEnd(9)} ${(s.speakerKey ?? "-").padEnd(18)} ${s.speakerConfidence.toFixed(2)} ${s.method.padEnd(16)} ${s.emotion}/${s.intensity} :: ${s.text.slice(0, 70)}`);
}
main().catch(e => { console.error(e); process.exit(1); });

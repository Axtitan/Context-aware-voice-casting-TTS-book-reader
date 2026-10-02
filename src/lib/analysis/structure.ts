/**
 * Story structure analysis: find where the narrative starts, detect chapters,
 * split chapters into scenes. Operates on the cleaned Block representation.
 */
import { countWords, type Block } from "@/lib/ingestion/extract";
import type { ChapterKind } from "@/db/schema";

export type DetectedChapter = {
  title: string;
  kind: ChapterKind;
  startBlock: number; // inclusive
  endBlock: number; // exclusive
  wordCount: number;
};

export type DetectedScene = { startBlock: number; endBlock: number };

const CHAPTER_WORD = "(chapter|chap\\.|book|part|volume|canto|letter|stave|act|scene)";
const NUMBER_WORDS =
  "(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|the (first|second|third|last))";
const CHAPTER_HEAD_RE = new RegExp(`^${CHAPTER_WORD}\\s+(\\d{1,3}|[ivxlc]{1,7}|${NUMBER_WORDS}(\\s+${NUMBER_WORDS})?)\\b[.:\\-—–\\s]*(.*)$`, "i");
const SPECIAL_HEAD_RE = /^(prologue|epilogue|preface|foreword|introduction|afterword|interlude|prelude|coda|finale|conclusion|postscript)\b[.:\-—–\s]*(.*)$/i;
const ROMAN_ONLY_RE = /^(?=[IVXLC]+\.?$)M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})\.?$/;
const NUM_ONLY_RE = /^\d{1,3}\.?$/;

const FRONT_MATTER_RE =
  /\b(copyright|all rights reserved|isbn|library of congress|printed in|first (published|edition|printing)|published by|publisher|typeset|cover (design|art|illustration)|this is a work of fiction|names, characters, places|without (the )?(prior )?(written )?permission|project gutenberg|www\.|http|e-?book|ebook|table of contents|contents|dedication|dedicated to|for my|to my|acknowledg|about the author|also by|praise for|advance praise|other (books|titles) by|a note on the (text|type)|translator'?s note|edition|imprint|penguin|harpercollins|random house|simon & schuster|macmillan|hachette|scholastic|vintage books|trademark|all characters|resemblance to actual|manufactured in)\b/i;

const BACK_MATTER_RE =
  /^[*\s]*(about the author|acknowledg(e)?ments?|also by|other books by|glossary|index|notes|bibliography|appendix|afterword by|a note (on|about) the author|end of (the )?project gutenberg|transcriber'?s? notes?|colophon|discussion questions|reading group guide|excerpt from|coming soon|sneak peek)\b/i;

export function classifyHeading(text: string): { kind: ChapterKind; title: string } | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const sp = t.match(SPECIAL_HEAD_RE);
  if (sp) {
    const word = sp[1].toLowerCase();
    const kind: ChapterKind = word === "prologue" ? "prologue" : word === "epilogue" ? "epilogue" : "section";
    return { kind, title: capitalize(sp[1]) + (sp[2] ? `: ${cleanSubtitle(sp[2])}` : "") };
  }
  const ch = t.match(CHAPTER_HEAD_RE);
  if (ch) {
    const word = ch[1].toLowerCase();
    const kind: ChapterKind = /^(book|part|volume)$/.test(word) ? "part" : "chapter";
    const sub = cleanSubtitle(ch[ch.length - 1] ?? "");
    const label = `${capitalize(word.replace(".", ""))} ${normalizeNumber(ch[2])}`;
    return { kind, title: sub ? `${label}: ${sub}` : label };
  }
  if (ROMAN_ONLY_RE.test(t) || NUM_ONLY_RE.test(t)) return { kind: "chapter", title: `Chapter ${normalizeNumber(t.replace(/\.$/, ""))}` };
  return null;
}

function cleanSubtitle(s: string): string {
  return s.replace(/^[.:\-—–\s]+/, "").replace(/[.\s]+$/, "").trim();
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};
export function normalizeNumber(s: string): string {
  const t = s.trim().toLowerCase().replace(/\.$/, "");
  if (/^\d+$/.test(t)) return t;
  if (/^[ivxlc]+$/.test(t)) return String(romanToInt(t.toUpperCase()));
  const parts = t.replace(/^the /, "").split(/[\s-]+/);
  let n = 0;
  for (const p of parts) if (WORD_NUM[p]) n += WORD_NUM[p];
  return n ? String(n) : s;
}
function romanToInt(s: string): number {
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = v[s[i]];
    const nxt = v[s[i + 1]] ?? 0;
    n += cur < nxt ? -cur : cur;
  }
  return n;
}

/**
 * Locate the block index where the narrative begins.
 * Strategy: the first chapter/prologue heading that is followed by real prose, else
 * the first block after the last front-matter-looking block in the opening region.
 */
export function findStoryStart(blocks: Block[]): { start: number; frontMatterBlocks: number; reason: string } {
  const n = blocks.length;
  const scanLimit = Math.min(n, Math.max(40, Math.floor(n * 0.15)));
  // Candidate: first structural heading followed by substantive prose within a few blocks.
  const headingIdx: number[] = [];
  for (let i = 0; i < scanLimit; i++) {
    const b = blocks[i];
    if (b.type !== "heading") continue;
    const cls = classifyHeading(b.text);
    if (!cls) continue;
    if (cls.kind === "section" && /preface|foreword|introduction/i.test(cls.title)) continue; // handled below
    if (proseFollows(blocks, i)) headingIdx.push(i);
  }
  // Avoid picking a heading that is actually inside a table of contents (many headings in a row, no prose between)
  const firstReal = headingIdx.find((i) => !inTocCluster(blocks, i));
  if (firstReal !== undefined) {
    // If an author-written Preface/Introduction with prose immediately precedes, include it when it's not publisher boilerplate.
    let start = firstReal;
    for (let j = firstReal - 1; j >= Math.max(0, firstReal - 40); j--) {
      const b = blocks[j];
      if (b.type === "heading" && /^(preface|foreword|introduction|author'?s note)\b/i.test(b.text)) {
        const body = blocks.slice(j + 1, firstReal).map((x) => x.text).join(" ");
        if (countWords(body) > 120 && !FRONT_MATTER_RE.test(body.slice(0, 600)) && !/\bby [A-Z][a-z]+ [A-Z][a-z]+\b/.test(blocks[j].text)) start = j;
        break;
      }
    }
    return { start, frontMatterBlocks: start, reason: `First narrative heading "${blocks[firstReal].text}"` };
  }
  // No usable headings: skip leading front-matter paragraphs.
  let start = 0;
  for (let i = 0; i < scanLimit; i++) {
    const b = blocks[i];
    const words = countWords(b.text);
    if (b.type === "heading" || words < 25 || FRONT_MATTER_RE.test(b.text)) {
      start = i + 1;
      continue;
    }
    break;
  }
  if (start >= n) start = 0;
  return { start, frontMatterBlocks: start, reason: start ? "Skipped leading front matter" : "No front matter detected" };
}

function proseFollows(blocks: Block[], i: number): boolean {
  let words = 0;
  for (let j = i + 1; j < Math.min(blocks.length, i + 6); j++) {
    if (blocks[j].type === "heading") {
      if (j === i + 1) continue; // "Chapter 1" + "The Beginning"
      break;
    }
    words += countWords(blocks[j].text);
    if (words >= 40) return true;
  }
  return words >= 40;
}

function inTocCluster(blocks: Block[], i: number): boolean {
  let headings = 0;
  let prose = 0;
  for (let j = Math.max(0, i - 6); j < Math.min(blocks.length, i + 6); j++) {
    if (blocks[j].type === "heading") headings++;
    else if (countWords(blocks[j].text) > 30) prose++;
  }
  return headings >= 6 && prose <= 1;
}

/** Detect chapter boundaries from `start`. Falls back to length-based splitting when no headings exist. */
export function detectChapters(blocks: Block[], start: number, bookTitle: string): DetectedChapter[] {
  const n = blocks.length;
  const marks: { idx: number; title: string; kind: ChapterKind }[] = [];
  for (let i = start; i < n; i++) {
    const b = blocks[i];
    if (/^\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG/i.test(b.text)) {
      marks.push({ idx: i, title: "__END__", kind: "section" });
      break;
    }
    if (b.type !== "heading") continue;
    if (BACK_MATTER_RE.test(b.text)) {
      marks.push({ idx: i, title: "__END__", kind: "section" });
      break;
    }
    const cls = classifyHeading(b.text);
    if (cls) {
      // Merge "Chapter 1" followed by subtitle heading
      const next = blocks[i + 1];
      let title = cls.title;
      if (next && next.type === "heading" && !classifyHeading(next.text) && next.text.length < 80 && !title.includes(":")) {
        title = `${title}: ${next.text}`;
      }
      marks.push({ idx: i, title, kind: cls.kind });
    } else if (b.level === 1 && b.text.length < 80 && proseFollows(blocks, i) && !/^by\b/i.test(b.text) && b.text.toLowerCase() !== bookTitle.toLowerCase()) {
      // Un-numbered chapter title (e.g. "An Unexpected Party")
      marks.push({ idx: i, title: b.text, kind: "chapter" });
    }
  }
  const end = marks.find((m) => m.title === "__END__")?.idx ?? n;
  const real = marks.filter((m) => m.title !== "__END__" && m.idx < end);

  const chapters: DetectedChapter[] = [];
  // Opening prose before first heading (rare when start is a heading)
  if (real.length === 0 || real[0].idx > start) {
    const firstIdx = real.length ? real[0].idx : end;
    const wc = wordsIn(blocks, start, firstIdx);
    if (wc > 60) chapters.push({ title: real.length ? "Opening" : bookTitle, kind: "chapter", startBlock: start, endBlock: firstIdx, wordCount: wc });
  }
  for (let k = 0; k < real.length; k++) {
    const s = real[k].idx;
    const e = k + 1 < real.length ? real[k + 1].idx : end;
    const wc = wordsIn(blocks, s, e);
    if (wc < 30 && real[k].kind === "part") continue; // bare "Part One" divider – fold into next
    if (wc < 15) continue;
    chapters.push({ title: real[k].title, kind: real[k].kind, startBlock: s, endBlock: e, wordCount: wc });
  }
  // Fallback: split very long unstructured text into ~3000-word sections
  if (chapters.length <= 1 && wordsIn(blocks, start, end) > 6000) {
    return splitByLength(blocks, start, end);
  }
  // Very long single chapter (e.g. scanned books with lost headings) – also split
  return chapters.length ? chapters : [{ title: bookTitle, kind: "chapter", startBlock: start, endBlock: end, wordCount: wordsIn(blocks, start, end) }];
}

function splitByLength(blocks: Block[], start: number, end: number): DetectedChapter[] {
  const out: DetectedChapter[] = [];
  let s = start;
  let acc = 0;
  for (let i = start; i < end; i++) {
    acc += countWords(blocks[i].text);
    const boundary = acc >= 3000 && (blocks[i + 1]?.type === "heading" || /[.!?”"]$/.test(blocks[i].text));
    if (boundary || i === end - 1) {
      out.push({ title: `Section ${out.length + 1}`, kind: "section", startBlock: s, endBlock: i + 1, wordCount: acc });
      s = i + 1;
      acc = 0;
    }
  }
  return out;
}

function wordsIn(blocks: Block[], s: number, e: number): number {
  let n = 0;
  for (let i = s; i < e; i++) n += countWords(blocks[i].text);
  return n;
}

/** Split a chapter into scenes at scene-break markers, headings, or long time/location shifts. */
export function detectScenes(blocks: Block[], startBlock: number, endBlock: number): DetectedScene[] {
  const scenes: DetectedScene[] = [];
  let s = startBlock;
  let words = 0;
  for (let i = startBlock; i < endBlock; i++) {
    const b = blocks[i];
    const isBreak =
      (i > startBlock && b.type === "heading") ||
      /^[*#~•·\-_=\s]{3,}$/.test(b.text) ||
      /^(\* \* \*|\*\*\*|—\s*—\s*—|⁂|§)$/.test(b.text.trim()) ||
      (words > 1200 && /^(later|the next (morning|day|evening|week)|that (night|evening|afternoon)|meanwhile|hours later|by the time|when (he|she|they|i) (woke|arrived|returned)|the following (day|morning|week)|back at|across town|elsewhere)/i.test(b.text));
    if (isBreak && i > s) {
      scenes.push({ startBlock: s, endBlock: i });
      s = i;
      words = 0;
    }
    words += countWords(b.text);
  }
  if (endBlock > s) scenes.push({ startBlock: s, endBlock });
  return scenes;
}

/** Guess title/author from opening blocks when metadata is missing ("The Hobbit" / "by J. R. R. Tolkien"). */
export function inferTitleAuthor(blocks: Block[]): { title?: string; author?: string } {
  const out: { title?: string; author?: string } = {};
  for (let i = 0; i < Math.min(blocks.length, 25); i++) {
    const t = blocks[i].text.trim();
    const by = t.match(/^by\s+([A-Z][A-Za-z.'\- ]{2,60})$/i) || t.match(/^([A-Z][A-Za-z.'\- ]{2,60})\s+by\s+([A-Z][A-Za-z.'\- ]{2,60})$/);
    if (by) {
      if (by.length === 2) out.author = by[1].trim();
      else {
        out.title = by[1].trim();
        out.author = by[2].trim();
      }
      break;
    }
    if (!out.title && blocks[i].type === "heading" && !classifyHeading(t) && t.length < 80 && !FRONT_MATTER_RE.test(t)) out.title = titleCase(t);
  }
  return out;
}

export function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(Of|The|And|A|An|In|On|To)\b/g, (m, i) => (i === 0 ? m : m.toLowerCase()));
}

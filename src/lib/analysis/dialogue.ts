/**
 * Performance-plan builder: narrator detection, dialogue attribution, thought detection,
 * emotion/delivery analysis. Produces speech segments that the TTS layer performs.
 */
import type { Block } from "@/lib/ingestion/extract";
import type { SegmentType } from "@/db/schema";
import { SPEECH_VERBS, splitSentences, escapeRe, type CharacterProfile } from "./characters";
import type { DetectedChapter, DetectedScene } from "./structure";

export type PlanSegment = {
  blockIndex: number;
  type: SegmentType;
  speakerKey: string | null; // character key; null => book narrator voice
  speakerConfidence: number;
  method: string;
  text: string;
  emotion: string;
  intensity: number;
  pace: "slow" | "medium" | "fast";
  delivery: string | null;
  paragraphEnd: boolean;
  sceneIndex: number;
};

export type NarratorInfo = { pov: "first" | "third"; narratorKey: string | null; confidence: number };

const VERB_RE_SRC = `(?:${SPEECH_VERBS})`;
const NAME_TOKEN = `[A-Z][\\w’'\\-]+(?:\\s+(?:de|van|von|of|the|Mac|O')?\\s*[A-Z][\\w’'\\-]+){0,2}`;
const HON = `(?:(?:Mr|Mrs|Ms|Miss|Dr|Prof|Capt|Col|Rev|Lady|Lord|Sir|Aunt|Uncle|Professor|Captain|Doctor)\\.?\\s+)?`;

// ---------------------------------------------------------------- narrator detection
export function detectNarrator(blocks: Block[], start: number, end: number, profiles: CharacterProfile[], quoteStyle: "double" | "single"): NarratorInfo {
  let first = 0;
  let third = 0;
  const vocative = new Map<string, number>();
  const tagged = new Map<string, number>();
  const narrMention = new Map<string, number>();
  const nameIndex = buildNameIndex(profiles);
  for (let i = start; i < end; i++) {
    const b = blocks[i];
    if (b.type === "heading") continue;
    const runs = splitRuns(b.text, quoteStyle);
    for (const r of runs) {
      if (r.quoted) {
        for (const m of r.text.matchAll(new RegExp(`(?:^|[,;!?.—–-]\\s*)${HON}(${NAME_TOKEN})(?=\\s*[,!?.;—–-]|$)`, "g"))) {
          const k = nameIndex.get(m[1]);
          if (k) vocative.set(k, (vocative.get(k) ?? 0) + 1);
        }
      } else {
        first += (r.text.match(/\b(I|me|my|myself|I'm|I'd|I've|I'll)\b/g) ?? []).length;
        third += (r.text.match(/\b(he|she|his|her|him|himself|herself)\b/gi) ?? []).length;
        for (const m of r.text.matchAll(new RegExp(`${HON}(${NAME_TOKEN})`, "g"))) {
          const k = nameIndex.get(m[1]);
          if (!k) continue;
          narrMention.set(k, (narrMention.get(k) ?? 0) + 1);
          const after = r.text.slice(m.index! + m[0].length, m.index! + m[0].length + 30);
          const before = r.text.slice(Math.max(0, m.index! - 30), m.index!);
          if (new RegExp(`^[,\\s]*${VERB_RE_SRC}\\b`, "i").test(after) || new RegExp(`\\b${VERB_RE_SRC}[,\\s]*$`, "i").test(before)) tagged.set(k, (tagged.get(k) ?? 0) + 1);
        }
      }
    }
  }
  const ratio = first / Math.max(1, first + third);
  if (ratio < 0.28) return { pov: "third", narratorKey: null, confidence: Math.min(0.99, 1 - ratio) };
  // First-person: the narrator is addressed by others (vocative) but never tagged as a third-person speaker.
  let best: { key: string; score: number; voc: number } | null = null;
  for (const p of profiles) {
    const voc = vocative.get(p.key) ?? 0;
    const tg = tagged.get(p.key) ?? 0;
    const nm = narrMention.get(p.key) ?? 0;
    const score = voc * 2 - tg * 4 - nm * 0.3;
    if (voc >= 2 && tg <= Math.max(1, voc * 0.25) && (!best || score > best.score)) best = { key: p.key, score, voc };
  }
  if (best && best.score > 0) return { pov: "first", narratorKey: best.key, confidence: Math.min(0.95, 0.5 + best.voc * 0.05) };
  return { pov: "first", narratorKey: null, confidence: 0.6 };
}

/** Per-chapter narrator: chapter titled with a character's name (multi-POV novels) overrides book-level. */
export function chapterNarrator(chapter: DetectedChapter, blocks: Block[], profiles: CharacterProfile[], book: NarratorInfo, quoteStyle: "double" | "single"): NarratorInfo {
  const nameIndex = buildNameIndex(profiles);
  const title = chapter.title.replace(/^(chapter|part)\s+\d+[:\s—-]*/i, "").trim();
  const k = nameIndex.get(title) ?? nameIndex.get(title.replace(/^(\d+\.?\s*)/, ""));
  if (k) {
    const local = detectNarrator(blocks, chapter.startBlock, chapter.endBlock, profiles, quoteStyle);
    if (local.pov === "first") return { pov: "first", narratorKey: k, confidence: 0.9 };
  }
  if (chapter.wordCount > 800) {
    const local = detectNarrator(blocks, chapter.startBlock, chapter.endBlock, profiles, quoteStyle);
    if (local.pov !== book.pov) return local.pov === "first" ? { ...local, narratorKey: local.narratorKey ?? book.narratorKey } : local;
    if (local.pov === "first" && local.narratorKey && local.narratorKey !== book.narratorKey && local.confidence > 0.75) return local;
  }
  return book;
}

function buildNameIndex(profiles: CharacterProfile[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const p of profiles) for (const f of [p.name, ...p.aliases]) idx.set(f, p.key);
  return idx;
}

// ---------------------------------------------------------------- quote runs
type Run = { text: string; quoted: boolean };
export function splitRuns(text: string, style: "double" | "single"): Run[] {
  const runs: Run[] = [];
  const re = style === "single" ? /(?:^|(?<=[\s(—–-]))[‘'](.+?)[’'](?=[\s.,;:!?)—–-]|$)/g : /[“"]([^”"]*?)[”"]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), quoted: false });
    runs.push({ text: m[1], quoted: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), quoted: false });
  // Unterminated opening quote (multi-paragraph speech): treat remainder as quoted
  if (!runs.some((r) => r.quoted) && (style === "double" ? /^[“"]/.test(text.trim()) : /^[‘']/.test(text.trim()))) return [{ text: text.trim().slice(1), quoted: true }];
  return runs.map((r) => ({ ...r, text: r.text.trim() })).filter((r) => r.text);
}

// ---------------------------------------------------------------- emotion / delivery
const VERB_EMOTION: Record<string, [string, number, string?]> = {
  shouted: ["angry", 0.8, "loud"], yelled: ["angry", 0.85, "loud"], screamed: ["terrified", 0.95, "loud"], roared: ["furious", 0.9, "loud"], bellowed: ["furious", 0.85, "loud"], barked: ["stern", 0.7, "clipped"],
  snapped: ["irritated", 0.65, "sharp"], hissed: ["hostile", 0.6, "low"], growled: ["menacing", 0.65, "low"], sneered: ["contemptuous", 0.6], scoffed: ["dismissive", 0.5], spat: ["disgusted", 0.7],
  whispered: ["hushed", 0.45, "soft"], murmured: ["tender", 0.35, "soft"], breathed: ["intimate", 0.4, "soft"], muttered: ["grudging", 0.4, "low"], mumbled: ["hesitant", 0.35, "low"],
  cried: ["distressed", 0.7], sobbed: ["grieving", 0.8, "broken"], wailed: ["grieving", 0.85], whimpered: ["frightened", 0.6, "soft"], pleaded: ["pleading", 0.7], begged: ["desperate", 0.8],
  laughed: ["amused", 0.55], chuckled: ["amused", 0.4], giggled: ["playful", 0.5], grinned: ["cheerful", 0.45], teased: ["playful", 0.5], joked: ["light", 0.45],
  gasped: ["shocked", 0.7], stammered: ["nervous", 0.55, "halting"], stuttered: ["nervous", 0.55, "halting"], faltered: ["uncertain", 0.5, "halting"],
  sighed: ["weary", 0.35], groaned: ["exasperated", 0.5], moaned: ["pained", 0.6], demanded: ["insistent", 0.65], insisted: ["insistent", 0.55], ordered: ["commanding", 0.65], commanded: ["commanding", 0.7],
  exclaimed: ["excited", 0.7], announced: ["confident", 0.5], declared: ["confident", 0.55], drawled: ["languid", 0.35, "slow"], purred: ["seductive", 0.45, "slow"], asked: ["curious", 0.3], inquired: ["curious", 0.3], wondered: ["pensive", 0.3],
  warned: ["grave", 0.55], urged: ["urgent", 0.65], protested: ["defensive", 0.55], retorted: ["sharp", 0.6], agreed: ["warm", 0.3], admitted: ["reluctant", 0.4], confessed: ["vulnerable", 0.5], promised: ["earnest", 0.45], thought: ["pensive", 0.25, "inner"],
};
const ADVERB_EMOTION: Record<string, [string, number]> = {
  angrily: ["angry", 0.75], furiously: ["furious", 0.85], coldly: ["cold", 0.5], icily: ["cold", 0.55], sharply: ["sharp", 0.6], bitterly: ["bitter", 0.6], sadly: ["sad", 0.55], softly: ["tender", 0.35], gently: ["tender", 0.35],
  quietly: ["hushed", 0.35], nervously: ["nervous", 0.55], anxiously: ["anxious", 0.6], fearfully: ["frightened", 0.65], happily: ["happy", 0.55], cheerfully: ["cheerful", 0.5], eagerly: ["eager", 0.6], excitedly: ["excited", 0.7],
  sarcastically: ["sarcastic", 0.55], dryly: ["dry", 0.4], wearily: ["weary", 0.4], tenderly: ["tender", 0.45], firmly: ["firm", 0.5], sternly: ["stern", 0.6], grimly: ["grim", 0.55], hesitantly: ["hesitant", 0.45], desperately: ["desperate", 0.8],
  calmly: ["calm", 0.2], slowly: ["measured", 0.3], hurriedly: ["hurried", 0.6], breathlessly: ["breathless", 0.65], mockingly: ["mocking", 0.55], gravely: ["grave", 0.5], solemnly: ["solemn", 0.45], warmly: ["warm", 0.4], kindly: ["kind", 0.35],
  impatiently: ["impatient", 0.55], triumphantly: ["triumphant", 0.7], proudly: ["proud", 0.55], miserably: ["miserable", 0.6], wistfully: ["wistful", 0.4], contemptuously: ["contemptuous", 0.6], sweetly: ["sweet", 0.4], hoarsely: ["strained", 0.55],
};
const NARRATION_MOOD: [RegExp, string, number][] = [
  [/\b(scream|blood|terror|horror|dread|panic|corpse|knife|gun|shot|dying|death|dead body|shadow(?:s)? moved|footsteps behind)\b/i, "tense", 0.55],
  [/\b(wept|tears|grief|mourn|funeral|sorrow|buried|farewell|lonely|heartbroken)\b/i, "melancholy", 0.5],
  [/\b(laugh|joy|delight|danced|celebrat|merry|sunlight|smiled|cheer)\b/i, "warm", 0.35],
  [/\b(stormy|thunder|lightning|storm|howl|wind screamed|rain lashed)\b/i, "dramatic", 0.5],
  [/\b(whisper|silence|hush|quiet|still|moonlight|candle)\b/i, "hushed", 0.3],
  [/\b(battle|charge|sword|fight|fought|struggl|ran|raced|chase|fled|burst)\b/i, "urgent", 0.5],
];

export function analyzeDelivery(text: string, context: string, type: SegmentType): { emotion: string; intensity: number; pace: "slow" | "medium" | "fast"; delivery: string | null } {
  let emotion = "neutral";
  let intensity = 0.2;
  let delivery: string | null = null;
  let pace: "slow" | "medium" | "fast" = "medium";
  if (type === "dialogue" || type === "thought") {
    const ctx = context.toLowerCase();
    const verb = ctx.match(new RegExp(`\\b(${Object.keys(VERB_EMOTION).join("|")})\\b`));
    if (verb) {
      const [e, i, d] = VERB_EMOTION[verb[1]];
      emotion = e;
      intensity = i;
      delivery = d ?? null;
    }
    const adv = ctx.match(new RegExp(`\\b(${Object.keys(ADVERB_EMOTION).join("|")})\\b`));
    if (adv) {
      const [e, i] = ADVERB_EMOTION[adv[1]];
      if (emotion === "neutral" || i > intensity) {
        emotion = e;
        intensity = Math.max(intensity, i);
      }
    }
    const excl = (text.match(/!/g) ?? []).length;
    const caps = (text.match(/\b[A-Z]{3,}\b/g) ?? []).length;
    if (excl) intensity = Math.min(1, intensity + 0.15 * Math.min(3, excl) + (emotion === "neutral" ? 0.15 : 0));
    if (excl && emotion === "neutral") emotion = "emphatic";
    if (caps) {
      intensity = Math.min(1, intensity + 0.3);
      delivery = delivery ?? "loud";
      if (emotion === "neutral" || emotion === "emphatic") emotion = "shouting";
    }
    if (/\?$/.test(text.trim()) && emotion === "neutral") {
      emotion = "questioning";
      intensity = 0.3;
    }
    if (/[…]|\.\.\.$|—$/.test(text.trim()) && intensity < 0.4) {
      delivery = delivery ?? "trailing";
      pace = "slow";
    }
    if (type === "thought") {
      delivery = delivery ?? "inner";
      intensity = Math.min(intensity, 0.5);
      if (emotion === "neutral") emotion = "pensive";
    }
    if (intensity >= 0.75 && !/soft|slow|halting/.test(delivery ?? "")) pace = "fast";
    if (/soft|slow|broken|halting/.test(delivery ?? "")) pace = "slow";
    // Short greetings stay neutral
    if (text.trim().split(/\s+/).length <= 2 && !excl && !caps && emotion !== "shouting") {
      emotion = emotion === "questioning" ? "questioning" : "neutral";
      intensity = Math.min(intensity, 0.3);
    }
  } else {
    for (const [re, mood, i] of NARRATION_MOOD) {
      if (re.test(text)) {
        emotion = mood;
        intensity = i;
        break;
      }
    }
    if (type === "heading") {
      emotion = "announcing";
      intensity = 0.2;
      pace = "slow";
    }
  }
  return { emotion, intensity: Math.round(intensity * 100) / 100, pace, delivery };
}

// ---------------------------------------------------------------- performance plan
type Ctx = {
  nameIndex: Map<string, string>;
  nameRe: RegExp;
  genderOf: Map<string, "male" | "female" | null>;
  recency: string[]; // most recent first
  lastSpeakers: (string | null)[]; // dialogue paragraph history
  narrator: NarratorInfo;
  lineCounts: Map<string, number>;
  present: Set<string>;
};

export function buildChapterPlan(
  blocks: Block[],
  chapter: DetectedChapter,
  scenes: DetectedScene[],
  profiles: CharacterProfile[],
  narrator: NarratorInfo,
  quoteStyle: "double" | "single",
  lineCounts: Map<string, number>,
): { segments: PlanSegment[]; scenePresence: string[][] } {
  const nameIndex = buildNameIndex(profiles);
  const forms = [...nameIndex.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const ctx: Ctx = {
    nameIndex,
    nameRe: forms.length ? new RegExp(`\\b(${forms.join("|")})\\b`, "g") : /$^/g,
    genderOf: new Map(profiles.map((p) => [p.key, p.gender])),
    recency: [],
    lastSpeakers: [],
    narrator,
    lineCounts,
    present: new Set(),
  };
  const segments: PlanSegment[] = [];
  const scenePresence: string[][] = [];
  const narratorKey = narrator.pov === "first" ? narrator.narratorKey : null;

  // Chapter heading is spoken by the narrator voice
  if (blocks[chapter.startBlock]?.type === "heading" || chapter.title) {
    segments.push({ blockIndex: chapter.startBlock, type: "heading", speakerKey: narratorKey, speakerConfidence: 1, method: "heading", text: chapter.title.replace(/^(\d+)$/, "Chapter $1"), ...analyzeDelivery(chapter.title, "", "heading"), paragraphEnd: true, sceneIndex: 0 });
  }

  scenes.forEach((scene, sceneIndex) => {
    ctx.present = new Set();
    ctx.lastSpeakers = [];
    // Pre-scan scene for present characters
    for (let i = scene.startBlock; i < scene.endBlock; i++) for (const m of blocks[i].text.matchAll(ctx.nameRe)) ctx.present.add(nameIndex.get(m[1])!);
    for (let i = scene.startBlock; i < scene.endBlock; i++) {
      const b = blocks[i];
      if (b.type === "heading") {
        if (i === chapter.startBlock) continue;
        if (i === chapter.startBlock + 1 && chapter.title.includes(b.text)) continue;
        segments.push({ blockIndex: i, type: "heading", speakerKey: narratorKey, speakerConfidence: 1, method: "heading", text: b.text, ...analyzeDelivery(b.text, "", "heading"), paragraphEnd: true, sceneIndex });
        continue;
      }
      const runs = splitRuns(b.text, quoteStyle);
      const paraSegs = attributeParagraph(runs, b, i, ctx, narratorKey, sceneIndex);
      segments.push(...paraSegs);
    }
    scenePresence.push([...ctx.present]);
  });
  return { segments, scenePresence };
}

function attributeParagraph(runs: Run[], block: Block, blockIndex: number, ctx: Ctx, narratorKey: string | null, sceneIndex: number): PlanSegment[] {
  const out: PlanSegment[] = [];
  const hasQuote = runs.some((r) => r.quoted);
  // Track names mentioned in narration of this paragraph (in order)
  const narrationNames: string[] = [];
  for (const r of runs) if (!r.quoted) for (const m of r.text.matchAll(ctx.nameRe)) narrationNames.push(ctx.nameIndex.get(m[1])!);
  for (const k of narrationNames) touchRecency(ctx, k);

  if (!hasQuote) {
    const isThought = !!block.italic && /\b(I|me|my|I'm|I'd)\b/.test(block.text) && block.text.length < 600;
    const type: SegmentType = isThought ? "thought" : "narration";
    const speaker = isThought && ctx.narrator.pov === "third" ? (ctx.recency[0] ?? null) : narratorKey;
    for (const chunk of chunkText(block.text, 550)) {
      out.push({ blockIndex, type, speakerKey: speaker, speakerConfidence: isThought ? 0.5 : 0.95, method: isThought ? "italic-thought" : "narration", text: chunk, ...analyzeDelivery(chunk, "", type), paragraphEnd: false, sceneIndex });
    }
    if (out.length) out[out.length - 1].paragraphEnd = true;
    return out;
  }

  let paragraphSpeaker: string | null | undefined; // first attributed speaker in this paragraph, reused for later quotes
  let paragraphConf = 0;
  let paragraphMethod = "";
  const quotedIdx = runs.map((r, i) => (r.quoted ? i : -1)).filter((i) => i >= 0);

  for (let qi = 0; qi < quotedIdx.length; qi++) {
    const i = quotedIdx[qi];
    const before = i > 0 && !runs[i - 1].quoted ? runs[i - 1].text : "";
    const after = i + 1 < runs.length && !runs[i + 1].quoted ? runs[i + 1].text : "";
    const quote = runs[i].text;
    let speaker: string | null | undefined;
    let conf = 0;
    let method = "";
    let isThought = false;

    const tagAfter = findTag(after.slice(0, 90), "after", ctx);
    const tagBefore = findTag(before.slice(-90), "before", ctx);
    const tag = tagAfter ?? tagBefore;
    if (tag) {
      speaker = resolveRef(tag.ref, ctx, narratorKey);
      conf = tag.ref === "pronoun" ? (speaker ? 0.7 : 0) : tag.ref === "first" ? 0.9 : 0.95;
      method = tag.ref === "pronoun" ? "tag-pronoun" : "tag";
      if (tag.thought) isThought = true;
    }
    if (speaker === undefined && paragraphSpeaker !== undefined) {
      speaker = paragraphSpeaker;
      conf = Math.max(0.3, paragraphConf - 0.1);
      method = "same-paragraph";
    }
    if (speaker === undefined && before) {
      // Action beat: "Sarah looked at him. 'You knew?'"
      const beatNames = [...before.matchAll(ctx.nameRe)].map((m) => ctx.nameIndex.get(m[1])!);
      if (beatNames.length) {
        speaker = beatNames[0];
        conf = beatNames.length === 1 ? 0.65 : 0.5;
        method = "action-beat";
      } else if (/\b(he|she)\b/i.test(before.slice(0, 60))) {
        const g = /\bshe\b/i.test(before) ? "female" : "male";
        speaker = recentOfGender(ctx, g);
        if (speaker) {
          conf = 0.5;
          method = "beat-pronoun";
        }
      } else if (/\bI\b/.test(before) && narratorKey) {
        speaker = narratorKey;
        conf = 0.6;
        method = "beat-first-person";
      }
    }
    if (speaker === undefined && after) {
      const beatNames = [...after.slice(0, 80).matchAll(ctx.nameRe)].map((m) => ctx.nameIndex.get(m[1])!);
      if (beatNames.length === 1 && !/\b(to|at|toward|towards)\s+$/i.test(after.slice(0, after.indexOf(beatNames[0]) < 0 ? 0 : after.indexOf(beatNames[0])))) {
        speaker = beatNames[0];
        conf = 0.45;
        method = "post-beat";
      }
    }
    // Vocative exclusion: "Sarah, come here" is not said by Sarah
    const vocKeys = vocatives(quote, ctx);
    if (speaker === undefined) {
      // Turn-taking
      const prev = ctx.lastSpeakers[ctx.lastSpeakers.length - 1];
      const prev2 = ctx.lastSpeakers[ctx.lastSpeakers.length - 2];
      if (prev2 !== undefined && prev2 !== prev && !vocKeys.has(prev2 ?? "")) {
        speaker = prev2;
        conf = 0.5;
        method = "turn-taking";
      } else if (prev !== undefined) {
        const other = ctx.recency.find((k) => k !== prev && ctx.present.has(k) && !vocKeys.has(k));
        if (other) {
          speaker = other;
          conf = 0.35;
          method = "turn-taking-other";
        } else if (vocKeys.size && ctx.present.size === 2) {
          speaker = [...ctx.present].find((k) => !vocKeys.has(k)) ?? null;
          conf = speaker ? 0.4 : 0;
          method = "vocative-elimination";
        }
      } else if (vocKeys.size && ctx.present.size === 2) {
        speaker = [...ctx.present].find((k) => !vocKeys.has(k)) ?? null;
        conf = speaker ? 0.4 : 0;
        method = "vocative-elimination";
      } else if (ctx.recency[0] && ctx.present.has(ctx.recency[0]) && !vocKeys.has(ctx.recency[0])) {
        speaker = ctx.recency[0];
        conf = 0.3;
        method = "recency";
      }
    } else if (speaker && vocKeys.has(speaker) && method !== "tag") {
      const alt = ctx.recency.find((k) => k !== speaker && !vocKeys.has(k) && ctx.present.has(k));
      speaker = alt ?? null;
      conf = alt ? 0.35 : 0;
      method = "vocative-corrected";
    }
    if (speaker === undefined) {
      speaker = null;
      conf = 0;
      method = "unresolved";
    }
    if (paragraphSpeaker === undefined) {
      paragraphSpeaker = speaker;
      paragraphConf = conf;
      paragraphMethod = method;
    }
    if (speaker) {
      touchRecency(ctx, speaker);
      ctx.present.add(speaker);
      ctx.lineCounts.set(speaker, (ctx.lineCounts.get(speaker) ?? 0) + 1);
    }

    // Emit narration before the quote (only for the first quote, or between quotes)
    if (before && (qi === 0 || quotedIdx[qi - 1] !== i - 2)) {
      const prevQuoted = qi > 0 ? quotedIdx[qi - 1] : -1;
      if (i - 1 !== prevQuoted + 1 || qi === 0) pushNarration(out, before, blockIndex, narratorKey, sceneIndex, ctx);
    }
    if (qi > 0 && i - 1 > quotedIdx[qi - 1] && !runs[i - 1].quoted) {
      // narration between two quotes
      const mid = runs[i - 1].text;
      if (!out.some((s) => s.text === mid && s.blockIndex === blockIndex)) pushNarration(out, mid, blockIndex, narratorKey, sceneIndex, ctx);
    }
    const type: SegmentType = isThought ? "thought" : "dialogue";
    const delivery = analyzeDelivery(quote, `${before.slice(-60)} ${after.slice(0, 60)}`, type);
    for (const chunk of chunkText(quote, 550)) {
      out.push({ blockIndex, type, speakerKey: speaker, speakerConfidence: conf, method: method || paragraphMethod, text: chunk, ...delivery, paragraphEnd: false, sceneIndex });
    }
    // Emit trailing narration after last quote
    if (qi === quotedIdx.length - 1 && after) pushNarration(out, after, blockIndex, narratorKey, sceneIndex, ctx);
  }
  // Dedupe narration runs that got emitted twice due to ordering logic
  const seen = new Set<string>();
  const dedup = out.filter((s) => {
    if (s.type !== "narration") return true;
    const k = `${s.blockIndex}:${s.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  ctx.lastSpeakers.push(paragraphSpeaker ?? null);
  if (ctx.lastSpeakers.length > 6) ctx.lastSpeakers.shift();
  if (dedup.length) dedup[dedup.length - 1].paragraphEnd = true;
  return dedup;
}

function pushNarration(out: PlanSegment[], text: string, blockIndex: number, narratorKey: string | null, sceneIndex: number, ctx: Ctx) {
  const t = text.replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g, "").trim();
  if (!t || /^[,.;:!?—–-]*$/.test(t)) return;
  // Pure speech tags ("she said") are spoken by the narrator; keep them – they are part of the prose.
  void ctx;
  for (const chunk of chunkText(t, 550)) out.push({ blockIndex, type: "narration", speakerKey: narratorKey, speakerConfidence: 0.95, method: "narration", text: chunk, ...analyzeDelivery(chunk, "", "narration"), paragraphEnd: false, sceneIndex });
}

type Tag = { ref: string; thought: boolean };
function findTag(text: string, where: "after" | "before", ctx: Ctx): Tag | null {
  const t = text.replace(/^[,;:\s—–-]+/, "");
  const name = `(${HON}${NAME_TOKEN}|he|she|I|they|we)`;
  const thoughtVerbs = /\b(thought|wondered|mused|reflected|told (?:him|her)self|thought to (?:him|her)self)\b/i;
  const patterns =
    where === "after"
      ? [
          new RegExp(`^${name}(?:['’]s\\s+\\w+)?\\s+(?:\\w+ly\\s+)?${VERB_RE_SRC}\\b`, "i"),
          new RegExp(`^${VERB_RE_SRC}\\s+${name}\\b`, "i"),
          new RegExp(`^${name}\\s+(?:\\w+\\s+){0,3}?(?:${VERB_RE_SRC})\\b`, "i"),
        ]
      : [
          new RegExp(`${name}\\s+(?:\\w+\\s+){0,3}?(?:${VERB_RE_SRC})(?:\\s+\\w+ly)?[,:.]?\\s*$`, "i"),
          new RegExp(`${VERB_RE_SRC}\\s+${name}[,:.]?\\s*$`, "i"),
        ];
  for (const p of patterns) {
    const m = t.match(p);
    if (!m) continue;
    const ref = m[1];
    const thought = thoughtVerbs.test(m[0]);
    if (/^(he|she)$/i.test(ref)) return { ref: "pronoun:" + (ref.toLowerCase() === "he" ? "male" : "female"), thought };
    if (/^I$/.test(ref)) return { ref: "first", thought };
    if (/^(they|we)$/i.test(ref)) return null;
    const key = ctx.nameIndex.get(ref) ?? ctx.nameIndex.get(ref.replace(/^(Mr|Mrs|Ms|Dr)\.?\s+/, "$1 ")) ?? findKeyByToken(ref, ctx);
    if (key) return { ref: "name:" + key, thought };
  }
  return null;
}

function findKeyByToken(ref: string, ctx: Ctx): string | null {
  const m = ref.match(ctx.nameRe);
  return m ? (ctx.nameIndex.get(m[0]) ?? null) : null;
}

function resolveRef(ref: string, ctx: Ctx, narratorKey: string | null): string | null | undefined {
  if (ref.startsWith("name:")) return ref.slice(5);
  if (ref === "first") return narratorKey ?? null;
  if (ref.startsWith("pronoun:")) return recentOfGender(ctx, ref.slice(8) as "male" | "female") ?? undefined;
  return undefined;
}

function recentOfGender(ctx: Ctx, g: "male" | "female"): string | null {
  const exact = ctx.recency.find((k) => ctx.genderOf.get(k) === g);
  if (exact) return exact;
  return ctx.recency.find((k) => !ctx.genderOf.get(k) && ctx.present.has(k)) ?? null;
}

function touchRecency(ctx: Ctx, key: string) {
  const i = ctx.recency.indexOf(key);
  if (i >= 0) ctx.recency.splice(i, 1);
  ctx.recency.unshift(key);
  if (ctx.recency.length > 8) ctx.recency.pop();
}

function vocatives(quote: string, ctx: Ctx): Set<string> {
  const keys = new Set<string>();
  for (const m of quote.matchAll(new RegExp(`(?:^|[,;!?.—–-]\\s+|^\\w+\\s+)(?:oh\\s+|dear\\s+|my\\s+dear\\s+|well\\s+|no\\s+|yes\\s+|please\\s+|thank you\\s+)?${HON}(${NAME_TOKEN})(?=\\s*[,!?.;:—–-]|$)`, "gi"))) {
    const k = ctx.nameIndex.get(m[1]);
    if (k) keys.add(k);
  }
  return keys;
}

/** Split long text at sentence boundaries into chunks of roughly `max` chars (keeps prosody natural). */
export function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const sentences = splitSentences(text);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && cur.length + s.length + 1 > max) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out;
}

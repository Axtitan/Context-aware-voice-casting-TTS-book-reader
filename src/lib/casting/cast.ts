/**
 * Voice casting engine.
 * Character profile -> voice requirements -> compatibility scoring against the voice pool ->
 * best match, uniqueness for major roles, collision detection, human-readable reasoning.
 */
import type { Voice, VoiceAge } from "@/lib/tts/provider";

export type CastableCharacter = {
  id: string;
  name: string;
  gender: "male" | "female" | null;
  genderConfidence: number;
  age: string | null;
  nationality: string | null;
  accent: string | null;
  vocalDescriptions: string[];
  personality: string[];
  importance: "major" | "supporting" | "minor";
  isNarrator: boolean;
  voiceId: string | null;
  voiceSource: "ai" | "user" | null;
  voiceLocked: boolean;
};

export type VoiceRequirements = {
  gender: "male" | "female" | null;
  ageRange: VoiceAge | null;
  accent: string | null;
  pitch: string | null;
  texture: string[];
  style: string[];
};

export type CastingResult = { characterId: string; voiceId: string; confidence: number; reason: string; shared: boolean };
export type CollisionWarning = { characterIds: [string, string]; voiceId: string; message: string; suggestion?: string };

const ACCENT_FAMILY: Record<string, string> = {
  american: "American", texan: "American", southern: "American", bostonian: "American", californian: "American", midwestern: "American", canadian: "American", yankee: "American",
  british: "British", english: "British", scottish: "British", scots: "British", irish: "British", welsh: "British", cockney: "British", yorkshire: "British", australian: "British", "new zealand": "British", posh: "British", "upper-class": "British", highland: "British", "west country": "British", northern: "British",
};

const TEXTURE_TO_STYLE: Record<string, string[]> = {
  deep: ["deep", "low"], low: ["deep", "low"], gravelly: ["gravelly", "gruff", "deep"], gravel: ["gravelly", "gruff"], rough: ["gruff", "gravelly"], gruff: ["gruff"], husky: ["gruff", "whispery"], hoarse: ["gruff"], raspy: ["gravelly", "gruff"],
  soft: ["soft", "gentle", "soft-spoken"], "soft-spoken": ["soft", "gentle", "soft-spoken"], gentle: ["gentle", "soft", "kind"], quiet: ["soft", "calm"], high: ["light", "youthful", "bright"], shrill: ["bright", "light"], thin: ["light"], rich: ["rich", "warm", "resonant"], warm: ["warm", "kind"],
  cold: ["cool", "reserved", "measured"], harsh: ["gruff", "sharp", "stern"], booming: ["booming", "powerful", "deep"], loud: ["powerful", "energetic"], melodious: ["smooth", "expressive"], musical: ["smooth", "expressive"], silky: ["smooth", "elegant"], smooth: ["smooth"], velvety: ["smooth", "rich"],
  commanding: ["authoritative", "commanding"], authoritative: ["authoritative", "commanding", "stately"], stern: ["stern", "authoritative"], firm: ["firm", "assured"], calm: ["calm", "measured"], measured: ["measured", "calm"], drawling: ["languid", "casual"], cheerful: ["cheerful", "bright"],
  bright: ["bright", "clear"], clear: ["clear"], sweet: ["sweet", "gentle"], youthful: ["youthful"], boyish: ["boyish", "youthful"], girlish: ["girlish", "youthful"], aged: ["aged", "grave"], weary: ["calm", "measured"], sad: ["gentle"], solemn: ["grave", "stately"], grave: ["grave"],
};
const PERSONALITY_TO_STYLE: Record<string, string[]> = {
  kind: ["kind", "warm", "gentle"], kindly: ["kind", "warm"], cruel: ["cold", "sharp", "stern"], proud: ["dignified", "authoritative", "poised"], haughty: ["dignified", "cool", "refined"], arrogant: ["confident", "authoritative"], shy: ["soft", "gentle"], timid: ["soft", "gentle"], bold: ["confident", "energetic"],
  brave: ["confident", "firm"], fierce: ["intense", "powerful"], gentle: ["gentle", "soft"], stern: ["stern", "authoritative"], clever: ["witty", "quick"], witty: ["witty", "playful"], sarcastic: ["witty", "dry"], cheerful: ["cheerful", "bright"], jolly: ["jolly", "hearty"], merry: ["cheerful", "playful"],
  gloomy: ["grave", "measured"], melancholy: ["gentle", "measured"], nervous: ["quick", "light"], anxious: ["quick"], calm: ["calm", "measured"], patient: ["calm"], generous: ["warm"], warm: ["warm"], charming: ["smooth", "confident"], mischievous: ["mischievous", "playful"], playful: ["playful"],
  dignified: ["dignified", "stately"], noble: ["stately", "dignified"], wise: ["measured", "warm", "aged"], eccentric: ["expressive"], solemn: ["grave", "solemn"], earnest: ["earnest"], reserved: ["reserved", "measured"], cold: ["cool", "reserved"], imperious: ["commanding", "authoritative"], pompous: ["stately", "booming"],
};

export function buildRequirements(c: CastableCharacter): VoiceRequirements {
  const accentRaw = (c.accent ?? c.nationality ?? "").toLowerCase();
  const accent = ACCENT_FAMILY[accentRaw] ?? (accentRaw ? "Other" : null);
  const texture = new Set<string>();
  for (const v of c.vocalDescriptions) for (const t of TEXTURE_TO_STYLE[v] ?? []) texture.add(t);
  const style = new Set<string>();
  for (const p of c.personality) for (const t of PERSONALITY_TO_STYLE[p] ?? []) style.add(t);
  const wantsDeep = c.vocalDescriptions.some((v) => /deep|low|gravel|boom|bass/.test(v));
  const wantsHigh = c.vocalDescriptions.some((v) => /high|shrill|squeak|thin|piping/.test(v));
  return {
    gender: c.gender,
    ageRange: (c.age as VoiceAge | null) ?? null,
    accent,
    pitch: wantsDeep ? "low" : wantsHigh ? "high" : null,
    texture: [...texture],
    style: [...style],
  };
}

const AGE_ORDER: VoiceAge[] = ["child", "teen", "young adult", "adult", "older adult"];

export function scoreVoice(req: VoiceRequirements, v: Voice, opts: { usedBy: Map<string, "major" | "supporting" | "minor">; forNarrator: boolean; importance: string; narratorVoiceId?: string | null }): { score: number; notes: string[] } {
  let score = 0;
  const notes: string[] = [];
  if (req.gender) {
    if (v.gender === req.gender) {
      score += 40;
      notes.push(`${req.gender} voice`);
    } else score -= 80;
  }
  if (req.accent && req.accent !== "Other") {
    if (v.accent === req.accent) {
      score += 22;
      notes.push(`${req.accent} accent`);
    } else score -= 12;
  }
  if (req.ageRange) {
    const d = Math.abs(AGE_ORDER.indexOf(req.ageRange) - AGE_ORDER.indexOf(v.ageRange));
    if (d === 0) {
      score += 16;
      notes.push(`${req.ageRange} range`);
    } else if (d === 1) score += 6;
    else score -= 10 * (d - 1);
  }
  if (req.pitch) {
    if ((req.pitch === "low" && /low/.test(v.pitch)) || (req.pitch === "high" && /high/.test(v.pitch))) {
      score += 10;
      notes.push(`${req.pitch} pitch`);
    } else if ((req.pitch === "low" && /high/.test(v.pitch)) || (req.pitch === "high" && /low/.test(v.pitch))) score -= 12;
  }
  const textureHits = req.texture.filter((t) => v.style.includes(t));
  score += Math.min(18, textureHits.length * 6);
  if (textureHits.length) notes.push(`described as ${[...new Set(textureHits)].slice(0, 3).join(", ")}`);
  const styleHits = req.style.filter((t) => v.style.includes(t));
  score += Math.min(10, styleHits.length * 3);
  if (styleHits.length && !textureHits.length) notes.push(`personality suits a ${styleHits[0]} delivery`);
  score += v.quality * 14;
  if (opts.forNarrator) score += v.narratorSuitability * 25;
  else if (v.style.includes("narrator") && opts.importance !== "major") score -= 4;
  // Uniqueness
  const used = opts.usedBy.get(v.id);
  if (used) {
    if (opts.importance === "major") score -= used === "major" ? 70 : 40;
    else if (opts.importance === "supporting") score -= used === "major" ? 45 : 18;
    else score -= used === "major" ? 25 : 6;
  }
  if (opts.narratorVoiceId && v.id === opts.narratorVoiceId && !opts.forNarrator) score -= opts.importance === "major" ? 60 : 30;
  return { score, notes };
}

/**
 * Cast the whole book. Respects user-selected/locked voices, casts major characters first so they get the best,
 * most distinct voices, and lets minor characters share voices.
 */
export function castBook(chars: CastableCharacter[], pool: Voice[], narratorVoiceId: string | null): { results: CastingResult[]; narratorVoiceId: string; warnings: CollisionWarning[] } {
  const usedBy = new Map<string, "major" | "supporting" | "minor">();
  const results: CastingResult[] = [];
  const order = { major: 0, supporting: 1, minor: 2 } as const;
  const sorted = [...chars].sort((a, b) => (a.isNarrator ? -1 : b.isNarrator ? 1 : 0) || order[a.importance] - order[b.importance]);

  // Respect existing user choices first so AI picks avoid them
  for (const c of sorted) if (c.voiceId && (c.voiceSource === "user" || c.voiceLocked)) usedBy.set(c.voiceId, c.importance);

  let narrator = narratorVoiceId;
  if (!narrator) {
    const best = [...pool].sort((a, b) => b.narratorSuitability * b.quality - a.narratorSuitability * a.quality)[0];
    narrator = best?.id ?? pool[0].id;
  }

  for (const c of sorted) {
    if (c.voiceId && (c.voiceSource === "user" || c.voiceLocked)) {
      results.push({ characterId: c.id, voiceId: c.voiceId, confidence: 1, reason: "Selected by you", shared: false });
      continue;
    }
    const req = buildRequirements(c);
    let best: { v: Voice; score: number; notes: string[] } | null = null;
    for (const v of pool) {
      const { score, notes } = scoreVoice(req, v, { usedBy, forNarrator: c.isNarrator, importance: c.importance, narratorVoiceId: c.isNarrator ? null : narrator });
      if (!best || score > best.score) best = { v, score, notes };
    }
    if (!best) continue;
    const shared = usedBy.has(best.v.id);
    const prevImp = usedBy.get(best.v.id);
    if (!prevImp || order[c.importance] < order[prevImp]) usedBy.set(best.v.id, c.importance);
    const known = [req.gender, req.accent && req.accent !== "Other" ? req.accent : null, req.ageRange, req.texture.length ? "voice description" : null].filter(Boolean).length;
    const confidence = Math.max(0.2, Math.min(0.97, 0.35 + known * 0.15 + (best.notes.length ? 0.05 : 0) - (shared ? 0.1 : 0)));
    const reason = best.notes.length ? `Matched on ${best.notes.join(", ")}.` : "No explicit description in the text – using a neutral, high-quality voice.";
    results.push({ characterId: c.id, voiceId: best.v.id, confidence, reason: shared ? `${reason} Shares a voice with a minor role.` : reason, shared });
  }
  return { results, narratorVoiceId: narrator, warnings: detectCollisions(chars, results, pool) };
}

/** Warn when two major characters share a voice or sound alike (same gender/accent/age/pitch). */
export function detectCollisions(chars: CastableCharacter[], results: CastingResult[], pool: Voice[]): CollisionWarning[] {
  const warnings: CollisionWarning[] = [];
  const byId = new Map(chars.map((c) => [c.id, c]));
  const voiceOf = new Map(results.map((r) => [r.characterId, r.voiceId]));
  const majors = chars.filter((c) => c.importance === "major" && voiceOf.get(c.id));
  for (let i = 0; i < majors.length; i++) {
    for (let j = i + 1; j < majors.length; j++) {
      const a = majors[i];
      const b = majors[j];
      const va = pool.find((v) => v.id === voiceOf.get(a.id));
      const vb = pool.find((v) => v.id === voiceOf.get(b.id));
      if (!va || !vb) continue;
      if (va.id === vb.id) {
        const used = new Set(results.map((r) => r.voiceId));
        const alt = pool.find((v) => !used.has(v.id) && v.gender === vb.gender && v.accent === vb.accent);
        warnings.push({ characterIds: [a.id, b.id], voiceId: va.id, message: `${a.name} and ${b.name} share the same voice (${va.name}).`, suggestion: alt?.id });
      } else if (va.gender === vb.gender && va.accent === vb.accent && va.ageRange === vb.ageRange && va.pitch === vb.pitch && va.style.filter((s) => vb.style.includes(s)).length >= 2) {
        warnings.push({ characterIds: [a.id, b.id], voiceId: va.id, message: `${byId.get(a.id)!.name} (${va.name}) and ${byId.get(b.id)!.name} (${vb.name}) may sound similar.` });
      }
    }
  }
  return warnings;
}

/** Human-readable "why this voice" bullets from stored evidence. */
export function describeRequirements(c: CastableCharacter): string[] {
  const out: string[] = [];
  if (c.gender) out.push(c.gender === "male" ? "Male" : "Female");
  if (c.age) out.push(c.age.charAt(0).toUpperCase() + c.age.slice(1));
  if (c.accent) out.push(`${c.accent} accent`);
  else if (c.nationality) out.push(c.nationality);
  for (const v of c.vocalDescriptions.slice(0, 3)) out.push(`${v} voice`);
  for (const p of c.personality.slice(0, 2)) out.push(p.charAt(0).toUpperCase() + p.slice(1));
  return out;
}

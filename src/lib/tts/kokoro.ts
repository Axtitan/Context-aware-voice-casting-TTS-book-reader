/**
 * KokoroProvider – Kokoro-82M (Apache-2.0) via kokoro-js / ONNX Runtime, fully local CPU inference.
 * Voice metadata: the engine only exposes language + gender + a quality grade, so the perceptual
 * descriptors (age, pitch, style) live in an application-level catalog (see VOICE_CATALOG).
 */
import { deliveryToSpeed, type PcmAudio, type SpeechRequest, type TTSProvider, type Voice } from "./provider";
import { chunkText } from "@/lib/analysis/dialogue";

export const KOKORO_VERSION = "kokoro-82m-v1.0-q8";
const MODEL_ID = process.env.KOKORO_MODEL_ID ?? "onnx-community/Kokoro-82M-v1.0-ONNX";
const DTYPE = (process.env.KOKORO_DTYPE ?? "q8") as "fp32" | "fp16" | "q8" | "q4" | "q4f16";

type Curated = Omit<Voice, "id" | "engine" | "engineVoiceId" | "language" | "supportsEmotion" | "supportsStyleControl" | "supportsCloning" | "version" | "quality"> & { grade: string };

/** Curated perceptual descriptors for Kokoro's English voices (listening-based; gender/grade from the model card). */
const CURATED: Record<string, Curated> = {
  af_heart: { name: "Heart", accent: "American", gender: "female", ageRange: "adult", pitch: "medium", style: ["warm", "expressive", "clear", "narrator"], narratorSuitability: 1, grade: "A" },
  af_bella: { name: "Bella", accent: "American", gender: "female", ageRange: "adult", pitch: "medium", style: ["energetic", "bright", "confident", "expressive"], narratorSuitability: 0.85, grade: "A-" },
  af_nicole: { name: "Nicole", accent: "American", gender: "female", ageRange: "young adult", pitch: "medium-high", style: ["soft", "whispery", "gentle", "intimate", "soft-spoken"], narratorSuitability: 0.4, grade: "B-" },
  af_sarah: { name: "Sarah", accent: "American", gender: "female", ageRange: "adult", pitch: "medium", style: ["calm", "measured", "steady", "clear"], narratorSuitability: 0.75, grade: "C+" },
  af_kore: { name: "Kore", accent: "American", gender: "female", ageRange: "adult", pitch: "medium-low", style: ["assured", "firm", "authoritative", "commanding"], narratorSuitability: 0.6, grade: "C+" },
  af_aoede: { name: "Aoede", accent: "American", gender: "female", ageRange: "adult", pitch: "medium", style: ["gentle", "smooth", "kind", "tender"], narratorSuitability: 0.65, grade: "C+" },
  af_nova: { name: "Nova", accent: "American", gender: "female", ageRange: "young adult", pitch: "medium-high", style: ["clear", "bright", "cheerful", "youthful"], narratorSuitability: 0.5, grade: "C" },
  af_alloy: { name: "Alloy", accent: "American", gender: "female", ageRange: "adult", pitch: "medium", style: ["neutral", "even", "practical"], narratorSuitability: 0.5, grade: "C" },
  af_sky: { name: "Sky", accent: "American", gender: "female", ageRange: "young adult", pitch: "high", style: ["light", "airy", "youthful", "girlish", "playful"], narratorSuitability: 0.3, grade: "C-" },
  af_jessica: { name: "Jessica", accent: "American", gender: "female", ageRange: "young adult", pitch: "medium-high", style: ["bright", "quick", "lively"], narratorSuitability: 0.3, grade: "D" },
  af_river: { name: "River", accent: "American", gender: "female", ageRange: "teen", pitch: "high", style: ["youthful", "soft", "childish", "light"], narratorSuitability: 0.2, grade: "D" },
  am_michael: { name: "Michael", accent: "American", gender: "male", ageRange: "adult", pitch: "medium-low", style: ["warm", "steady", "narrator", "kind", "rich"], narratorSuitability: 0.9, grade: "C+" },
  am_fenrir: { name: "Fenrir", accent: "American", gender: "male", ageRange: "adult", pitch: "low", style: ["deep", "intense", "energetic", "powerful", "gruff"], narratorSuitability: 0.6, grade: "C+" },
  am_puck: { name: "Puck", accent: "American", gender: "male", ageRange: "young adult", pitch: "medium", style: ["playful", "light", "witty", "mischievous", "boyish"], narratorSuitability: 0.55, grade: "C+" },
  am_adam: { name: "Adam", accent: "American", gender: "male", ageRange: "adult", pitch: "medium", style: ["neutral", "plain", "even"], narratorSuitability: 0.3, grade: "F+" },
  am_echo: { name: "Echo", accent: "American", gender: "male", ageRange: "adult", pitch: "medium", style: ["calm", "measured", "cool", "reserved"], narratorSuitability: 0.45, grade: "D" },
  am_eric: { name: "Eric", accent: "American", gender: "male", ageRange: "adult", pitch: "medium", style: ["friendly", "casual", "warm"], narratorSuitability: 0.4, grade: "D" },
  am_liam: { name: "Liam", accent: "American", gender: "male", ageRange: "young adult", pitch: "medium-high", style: ["youthful", "earnest", "quick", "eager"], narratorSuitability: 0.35, grade: "D" },
  am_onyx: { name: "Onyx", accent: "American", gender: "male", ageRange: "older adult", pitch: "low", style: ["deep", "gravelly", "authoritative", "grave", "resonant"], narratorSuitability: 0.55, grade: "D" },
  am_santa: { name: "Santa", accent: "American", gender: "male", ageRange: "older adult", pitch: "low", style: ["jolly", "deep", "aged", "hearty", "booming"], narratorSuitability: 0.2, grade: "D-" },
  bf_emma: { name: "Emma", accent: "British", gender: "female", ageRange: "adult", pitch: "medium", style: ["warm", "refined", "narrator", "calm", "clear"], narratorSuitability: 0.95, grade: "B-" },
  bf_isabella: { name: "Isabella", accent: "British", gender: "female", ageRange: "adult", pitch: "medium-low", style: ["elegant", "poised", "dignified", "measured"], narratorSuitability: 0.7, grade: "C" },
  bf_alice: { name: "Alice", accent: "British", gender: "female", ageRange: "young adult", pitch: "medium-high", style: ["youthful", "bright", "curious", "light"], narratorSuitability: 0.4, grade: "D" },
  bf_lily: { name: "Lily", accent: "British", gender: "female", ageRange: "young adult", pitch: "high", style: ["soft", "sweet", "gentle", "girlish"], narratorSuitability: 0.3, grade: "D" },
  bm_george: { name: "George", accent: "British", gender: "male", ageRange: "older adult", pitch: "low", style: ["authoritative", "stately", "deep", "stern", "distinguished"], narratorSuitability: 0.8, grade: "C" },
  bm_fable: { name: "Fable", accent: "British", gender: "male", ageRange: "adult", pitch: "medium", style: ["storyteller", "narrator", "expressive", "warm", "smooth"], narratorSuitability: 0.85, grade: "C" },
  bm_lewis: { name: "Lewis", accent: "British", gender: "male", ageRange: "adult", pitch: "medium-low", style: ["gruff", "plain", "working-class", "direct"], narratorSuitability: 0.4, grade: "D+" },
  bm_daniel: { name: "Daniel", accent: "British", gender: "male", ageRange: "young adult", pitch: "medium", style: ["polite", "gentle", "earnest", "youthful"], narratorSuitability: 0.45, grade: "D" },
};

const GRADE: Record<string, number> = { A: 1, "A-": 0.93, "B+": 0.87, B: 0.82, "B-": 0.77, "C+": 0.7, C: 0.62, "C-": 0.55, "D+": 0.48, D: 0.4, "D-": 0.32, "F+": 0.25, F: 0.15 };

export const KOKORO_VOICES: Voice[] = Object.entries(CURATED).map(([engineVoiceId, c]) => ({
  id: `kokoro:${engineVoiceId}`,
  engine: "kokoro",
  engineVoiceId,
  language: "en",
  name: c.name,
  accent: c.accent,
  gender: c.gender,
  ageRange: c.ageRange,
  pitch: c.pitch,
  style: c.style,
  quality: GRADE[c.grade] ?? 0.4,
  narratorSuitability: c.narratorSuitability,
  supportsEmotion: false, // Kokoro has no explicit emotion control; we shape delivery via text + speed
  supportsStyleControl: false,
  supportsCloning: false,
  version: KOKORO_VERSION,
}));

type KokoroModel = {
  generate(text: string, opts: { voice: string; speed?: number }): Promise<{ audio: Float32Array; sampling_rate: number }>;
};

const g = globalThis as typeof globalThis & { __kokoroModel?: Promise<KokoroModel> };

async function loadModel(): Promise<KokoroModel> {
  if (!g.__kokoroModel) {
    g.__kokoroModel = (async () => {
      const { KokoroTTS } = await import("kokoro-js");
      const model = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: DTYPE, device: "cpu" });
      return model as unknown as KokoroModel;
    })().catch((e) => {
      g.__kokoroModel = undefined;
      throw e;
    });
  }
  return g.__kokoroModel;
}

/** Light text shaping so the engine performs the line rather than reading it flat. */
export function shapeTextForDelivery(text: string, req: SpeechRequest): string {
  let t = text.replace(/\s+/g, " ").trim();
  // Expand a few abbreviations engines mispronounce
  t = t.replace(/\bMr\.\s/g, "Mister ").replace(/\bMrs\.\s/g, "Missus ").replace(/\bDr\.\s/g, "Doctor ").replace(/\bSt\.\s(?=[A-Z])/g, "Saint ").replace(/\bMt\.\s/g, "Mount ");
  t = t.replace(/_([^_]+)_/g, "$1").replace(/\*+/g, "");
  t = t.replace(/—/g, ", ").replace(/–/g, ", ").replace(/…/g, "...");
  // Shouting: model reads ALL CAPS letter-by-letter sometimes – normalise, keep exclamation energy
  t = t.replace(/\b([A-Z]{3,})\b/g, (m) => m.charAt(0) + m.slice(1).toLowerCase());
  if (req.delivery === "trailing" && !/[.!?]$/.test(t)) t += "...";
  if (!/[.!?…,;:'"”’)]$/.test(t)) t += ".";
  return t;
}

export class KokoroProvider implements TTSProvider {
  readonly id = "kokoro";
  readonly name = "Kokoro-82M (local, Apache-2.0)";
  async isAvailable(): Promise<boolean> {
    try {
      await loadModel();
      return true;
    } catch {
      return false;
    }
  }
  async listVoices(): Promise<Voice[]> {
    return KOKORO_VOICES;
  }
  async getVoiceCapabilities() {
    return { emotion: false, accent: true, cloning: false, styleControl: false };
  }
  supportsEmotion() {
    return false;
  }
  supportsAccent() {
    return true;
  }
  supportsCloning() {
    return false;
  }
  supportsStyleControl() {
    return false;
  }
  async generateSpeech(req: SpeechRequest): Promise<PcmAudio> {
    const model = await loadModel();
    const speed = deliveryToSpeed(req);
    const text = shapeTextForDelivery(req.text, req);
    // Kokoro's context is ~510 phoneme tokens; chunk long inputs at sentence boundaries.
    const chunks = chunkText(text, 380);
    const parts: Float32Array[] = [];
    let sampleRate = 24000;
    for (const chunk of chunks) {
      const out = await model.generate(chunk, { voice: req.voice.engineVoiceId, speed });
      sampleRate = out.sampling_rate;
      parts.push(out.audio);
    }
    const total = parts.reduce((n, p) => n + p.length, 0) + (parts.length - 1) * Math.round(sampleRate * 0.12);
    const samples = new Float32Array(total);
    let o = 0;
    parts.forEach((p, i) => {
      samples.set(p, o);
      o += p.length + (i < parts.length - 1 ? Math.round(sampleRate * 0.12) : 0);
    });
    return { samples, sampleRate };
  }
  async generatePreview(voiceId: string, text: string): Promise<PcmAudio> {
    const voice = KOKORO_VOICES.find((v) => v.id === voiceId || v.engineVoiceId === voiceId);
    if (!voice) throw new Error(`Unknown Kokoro voice ${voiceId}`);
    return this.generateSpeech({ text, voice, speed: 1 });
  }
}

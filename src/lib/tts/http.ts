/**
 * HttpProvider – talks to a self-hosted OpenAI-compatible speech server
 * (e.g. Qwen3-TTS or Chatterbox served via vLLM-Omni / a small FastAPI wrapper on a GPU box).
 *   POST {TTS_HTTP_URL}/v1/audio/speech  { model, voice, input, speed, response_format: "wav", instructions? }
 * Voices are described by TTS_HTTP_VOICES (JSON array of Voice-like objects) or /v1/audio/voices.
 * Style instructions are passed through `instructions` when TTS_HTTP_STYLE_CONTROL=1 (Qwen3-TTS supports natural-language style control).
 */
import { decodeWav } from "@/lib/audio/wav";
import { deliveryToSpeed, type PcmAudio, type SpeechRequest, type TTSProvider, type Voice } from "./provider";

const BASE = process.env.TTS_HTTP_URL?.replace(/\/$/, "") ?? "";
const MODEL = process.env.TTS_HTTP_MODEL ?? "qwen3-tts";
const STYLE = process.env.TTS_HTTP_STYLE_CONTROL === "1";
const VERSION = process.env.TTS_HTTP_VERSION ?? MODEL;

let cache: Voice[] | null = null;
export async function httpVoices(): Promise<Voice[]> {
  if (cache) return cache;
  const fromEnv = process.env.TTS_HTTP_VOICES;
  let raw: Partial<Voice>[] = [];
  if (fromEnv) {
    try {
      raw = JSON.parse(fromEnv);
    } catch {
      raw = [];
    }
  } else if (BASE) {
    try {
      const r = await fetch(`${BASE}/v1/audio/voices`, { signal: AbortSignal.timeout(4000) });
      if (r.ok) raw = ((await r.json()).voices ?? []) as Partial<Voice>[];
    } catch {
      raw = [];
    }
  }
  cache = raw
    .filter((v) => v.engineVoiceId || v.id)
    .map((v) => ({
      id: `http:${v.engineVoiceId ?? v.id}`,
      engine: "http",
      engineVoiceId: v.engineVoiceId ?? String(v.id),
      name: v.name ?? String(v.engineVoiceId ?? v.id),
      language: v.language ?? "en",
      accent: v.accent ?? "Neutral",
      gender: v.gender ?? "neutral",
      ageRange: v.ageRange ?? "adult",
      pitch: v.pitch ?? "medium",
      style: v.style ?? [],
      quality: v.quality ?? 0.8,
      narratorSuitability: v.narratorSuitability ?? 0.6,
      supportsEmotion: STYLE,
      supportsStyleControl: STYLE,
      supportsCloning: !!v.supportsCloning,
      version: VERSION,
    }));
  return cache;
}

export function styleInstruction(req: SpeechRequest): string {
  const bits: string[] = [];
  if (req.emotion && req.emotion !== "neutral") bits.push(`emotion: ${req.emotion}`);
  if (req.intensity !== undefined) bits.push(`intensity: ${req.intensity < 0.35 ? "subtle" : req.intensity < 0.7 ? "moderate" : "strong"}`);
  if (req.pace && req.pace !== "medium") bits.push(`pace: ${req.pace}`);
  if (req.delivery) bits.push(`delivery: ${req.delivery}`);
  return bits.length ? `Perform this audiobook line naturally, keeping the same voice identity. ${bits.join("; ")}.` : "Read naturally as an audiobook narrator.";
}

export class HttpProvider implements TTSProvider {
  readonly id = "http";
  readonly name = process.env.TTS_HTTP_NAME ?? `Self-hosted ${MODEL}`;
  async isAvailable() {
    if (!BASE) return false;
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
      return r.ok;
    } catch {
      return false;
    }
  }
  listVoices() {
    return httpVoices();
  }
  async getVoiceCapabilities() {
    return { emotion: STYLE, accent: true, cloning: false, styleControl: STYLE };
  }
  supportsEmotion() {
    return STYLE;
  }
  supportsAccent() {
    return true;
  }
  supportsCloning() {
    return false;
  }
  supportsStyleControl() {
    return STYLE;
  }
  async generateSpeech(req: SpeechRequest): Promise<PcmAudio> {
    if (!BASE) throw new Error("TTS_HTTP_URL not configured");
    const body: Record<string, unknown> = { model: MODEL, voice: req.voice.engineVoiceId, input: req.text, speed: deliveryToSpeed(req), response_format: "wav" };
    if (STYLE) body.instructions = styleInstruction(req);
    const r = await fetch(`${BASE}/v1/audio/speech`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    if (!r.ok) throw new Error(`HTTP TTS ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return decodeWav(Buffer.from(await r.arrayBuffer()));
  }
  async generatePreview(voiceId: string, text: string) {
    const voice = (await httpVoices()).find((v) => v.id === voiceId);
    if (!voice) throw new Error(`Unknown voice ${voiceId}`);
    return this.generateSpeech({ text, voice });
  }
}

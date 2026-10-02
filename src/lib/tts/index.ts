/**
 * TTS registry with engine fallback: primary engine -> compatible secondary -> fallback voice.
 * Engines:
 *  - kokoro (default, CPU, bundled)
 *  - http   (optional self-hosted GPU engine such as Qwen3-TTS / Chatterbox behind an
 *            OpenAI-compatible /v1/audio/speech endpoint; configured via TTS_HTTP_URL)
 */
import { KokoroProvider, KOKORO_VOICES } from "./kokoro";
import { HttpProvider, httpVoices } from "./http";
import type { PcmAudio, SpeechRequest, TTSProvider, Voice } from "./provider";

const providers: Record<string, TTSProvider> = { kokoro: new KokoroProvider() };
if (process.env.TTS_HTTP_URL) providers.http = new HttpProvider();

export const DEFAULT_ENGINE = process.env.TTS_DEFAULT_ENGINE && providers[process.env.TTS_DEFAULT_ENGINE] ? process.env.TTS_DEFAULT_ENGINE : "kokoro";

export function getProvider(engine?: string | null): TTSProvider {
  return providers[engine ?? DEFAULT_ENGINE] ?? providers.kokoro;
}
export function listProviders(): { id: string; name: string }[] {
  return Object.values(providers).map((p) => ({ id: p.id, name: p.name }));
}

export async function allVoices(): Promise<Voice[]> {
  const out: Voice[] = [...KOKORO_VOICES];
  if (providers.http) out.push(...(await httpVoices()));
  return out;
}

export async function getVoice(voiceId: string): Promise<Voice | undefined> {
  return (await allVoices()).find((v) => v.id === voiceId);
}

/** Choose the closest voice on another engine (used when the preferred engine is down). */
export async function fallbackVoice(voice: Voice, targetEngine = "kokoro"): Promise<Voice> {
  const pool = (await allVoices()).filter((v) => v.engine === targetEngine);
  let best = pool[0];
  let bestScore = -Infinity;
  for (const v of pool) {
    let s = 0;
    if (v.gender === voice.gender) s += 10;
    if (v.accent === voice.accent) s += 4;
    if (v.ageRange === voice.ageRange) s += 3;
    s += v.style.filter((t) => voice.style.includes(t)).length;
    s += v.quality * 2;
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  return best;
}

export async function synthesize(req: SpeechRequest): Promise<{ audio: PcmAudio; voiceUsed: Voice }> {
  const primary = getProvider(req.voice.engine);
  try {
    return { audio: await primary.generateSpeech(req), voiceUsed: req.voice };
  } catch (e) {
    if (req.voice.engine === "kokoro") throw e;
    const fb = await fallbackVoice(req.voice, "kokoro");
    console.warn(`[tts] engine ${req.voice.engine} failed (${(e as Error).message}); falling back to ${fb.id}`);
    return { audio: await providers.kokoro.generateSpeech({ ...req, voice: fb }), voiceUsed: fb };
  }
}

export const PREVIEW_LINE = (name: string) => `"You're late," ${name} said quietly, but there was unmistakable disappointment in the words. "I waited by the river until the lamps went out."`;

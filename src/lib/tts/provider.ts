/**
 * TTS abstraction. The audiobook engine only talks to TTSProvider; engines are pluggable.
 */
export type VoiceGender = "male" | "female" | "neutral";
export type VoiceAge = "child" | "teen" | "young adult" | "adult" | "older adult";

export type Voice = {
  id: string; // globally unique: `${engine}:${engineVoiceId}`
  engine: string;
  engineVoiceId: string;
  name: string;
  language: string;
  accent: string; // "American" | "British" | ...
  gender: VoiceGender;
  ageRange: VoiceAge;
  pitch: "low" | "medium-low" | "medium" | "medium-high" | "high";
  style: string[]; // descriptive tags used by the casting engine
  quality: number; // 0..1 relative quality within the engine (curated / engine-provided)
  narratorSuitability: number; // 0..1
  supportsEmotion: boolean;
  supportsStyleControl: boolean;
  supportsCloning: boolean;
  version: string;
};

export type SpeechRequest = {
  text: string;
  voice: Voice;
  speed?: number;
  emotion?: string;
  intensity?: number;
  pace?: "slow" | "medium" | "fast";
  delivery?: string | null;
};

export type PcmAudio = { samples: Float32Array; sampleRate: number };

export interface TTSProvider {
  readonly id: string;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  listVoices(): Promise<Voice[]>;
  getVoiceCapabilities(voiceId: string): Promise<{ emotion: boolean; accent: boolean; cloning: boolean; styleControl: boolean }>;
  generateSpeech(req: SpeechRequest): Promise<PcmAudio>;
  generatePreview(voiceId: string, text: string): Promise<PcmAudio>;
  supportsEmotion(): boolean;
  supportsAccent(): boolean;
  supportsCloning(): boolean;
  supportsStyleControl(): boolean;
}

/** Map performance-plan delivery to speed multipliers usable by engines without style tokens. */
export function deliveryToSpeed(req: SpeechRequest): number {
  let speed = req.speed ?? 1;
  const intensity = req.intensity ?? 0.2;
  if (req.pace === "slow") speed *= 0.92;
  if (req.pace === "fast") speed *= 1.08;
  if (req.delivery === "soft" || req.delivery === "inner" || req.delivery === "trailing") speed *= 0.95;
  if (req.delivery === "loud") speed *= 1.04;
  if (req.emotion === "announcing") speed *= 0.9;
  // Very intense lines get a touch quicker, weary/grieving lines slower
  if (intensity > 0.8 && !["grieving", "weary", "melancholy"].includes(req.emotion ?? "")) speed *= 1.03;
  if (["grieving", "weary", "melancholy", "tender"].includes(req.emotion ?? "")) speed *= 0.95;
  return Math.max(0.8, Math.min(1.25, speed));
}

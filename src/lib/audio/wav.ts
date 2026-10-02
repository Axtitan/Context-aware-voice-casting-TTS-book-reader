/** PCM/WAV utilities: encode/decode, loudness normalisation, fades, and audiobook assembly. */
import type { PcmAudio } from "@/lib/tts/provider";

export function encodeWav(pcm: PcmAudio): Buffer {
  const { samples, sampleRate } = pcm;
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, o);
    o += 2;
  }
  return buf;
}

export function decodeWav(buf: Buffer): PcmAudio {
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("Not a WAV file");
  let off = 12;
  let sampleRate = 24000;
  let channels = 1;
  let bits = 16;
  let data: Buffer | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      channels = buf.readUInt16LE(off + 10);
      sampleRate = buf.readUInt32LE(off + 12);
      bits = buf.readUInt16LE(off + 22);
    } else if (id === "data") {
      data = buf.subarray(off + 8, off + 8 + size);
      break;
    }
    off += 8 + size + (size % 2);
  }
  if (!data) throw new Error("WAV missing data chunk");
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) {
      const p = (i * channels + c) * bytes;
      acc += bits === 16 ? data.readInt16LE(p) / 0x8000 : bits === 32 ? data.readFloatLE(p) : (data.readUInt8(p) - 128) / 128;
    }
    samples[i] = acc / channels;
  }
  return { samples, sampleRate };
}

export function durationMs(pcm: PcmAudio): number {
  return Math.round((pcm.samples.length / pcm.sampleRate) * 1000);
}

/** RMS-based loudness normalisation with a peak ceiling (keeps speakers at a consistent level). */
export function normalize(pcm: PcmAudio, targetRms = 0.08, peakCeiling = 0.95): PcmAudio {
  const s = pcm.samples;
  if (!s.length) return pcm;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < s.length; i++) {
    sum += s[i] * s[i];
    peak = Math.max(peak, Math.abs(s[i]));
  }
  const rms = Math.sqrt(sum / s.length) || 1e-6;
  let gain = targetRms / rms;
  if (peak * gain > peakCeiling) gain = peakCeiling / peak;
  const out = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s[i] * gain;
  return { samples: out, sampleRate: pcm.sampleRate };
}

/** Trim leading/trailing near-silence, then apply short fades to avoid clicks. */
export function trimAndFade(pcm: PcmAudio, threshold = 0.004, fadeMs = 12, keepMs = 40): PcmAudio {
  const s = pcm.samples;
  const sr = pcm.sampleRate;
  let start = 0;
  let end = s.length;
  while (start < end && Math.abs(s[start]) < threshold) start++;
  while (end > start && Math.abs(s[end - 1]) < threshold) end--;
  const keep = Math.round((keepMs / 1000) * sr);
  start = Math.max(0, start - keep);
  end = Math.min(s.length, end + keep);
  const out = s.slice(start, end);
  const fade = Math.min(Math.round((fadeMs / 1000) * sr), Math.floor(out.length / 2));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[i] *= g;
    out[out.length - 1 - i] *= g;
  }
  return { samples: out, sampleRate: sr };
}

export function silence(ms: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.round((ms / 1000) * sampleRate));
}

export type AssemblyPiece = { id: string; pcm: PcmAudio; speakerChange: boolean; paragraphEnd: boolean; type: string };
export type AssemblyResult = { pcm: PcmAudio; timings: { id: string; startMs: number; endMs: number }[] };

/** Concatenate segment audio with literary pacing: pauses scale with structure and speaker changes. */
export function assemble(pieces: AssemblyPiece[], sampleRate: number): AssemblyResult {
  const parts: Float32Array[] = [];
  const timings: AssemblyResult["timings"] = [];
  let cursor = 0;
  pieces.forEach((p, i) => {
    if (i > 0) {
      const prev = pieces[i - 1];
      let gap = 220; // sentence-to-sentence within a paragraph
      if (p.speakerChange) gap = 420;
      if (prev.paragraphEnd) gap = Math.max(gap, 600);
      if (prev.type === "heading" || p.type === "heading") gap = 1200;
      const g = silence(gap, sampleRate);
      parts.push(g);
      cursor += g.length;
    }
    const startMs = Math.round((cursor / sampleRate) * 1000);
    parts.push(p.pcm.samples);
    cursor += p.pcm.samples.length;
    timings.push({ id: p.id, startMs, endMs: Math.round((cursor / sampleRate) * 1000) });
  });
  const tail = silence(800, sampleRate);
  parts.push(tail);
  cursor += tail.length;
  const out = new Float32Array(cursor);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return { pcm: { samples: out, sampleRate }, timings };
}

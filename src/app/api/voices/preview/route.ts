import { NextResponse } from "next/server";
import { getVoice, PREVIEW_LINE, synthesize } from "@/lib/tts";
import { encodeWav, normalize, trimAndFade } from "@/lib/audio/wav";
import { storage, hashText } from "@/lib/storage";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET /api/voices/preview?voiceId=..&name=..&text=.. – short real sample in the actual voice (cached). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const voiceId = url.searchParams.get("voiceId") ?? "";
  const voice = await getVoice(voiceId);
  if (!voice) return NextResponse.json({ error: "Unknown voice" }, { status: 404 });
  const name = (url.searchParams.get("name") ?? "Sarah").replace(/[^\w' .-]/g, "").slice(0, 40) || "Sarah";
  const text = (url.searchParams.get("text") ?? PREVIEW_LINE(name)).slice(0, 400);
  const key = `previews/${voice.engine}_${voice.engineVoiceId}_${hashText(voice.version, text)}.wav`;
  let wav: Buffer;
  if (await storage.exists(key)) wav = await storage.get(key);
  else {
    try {
      const { audio } = await synthesize({ text, voice, speed: 1 });
      wav = encodeWav(normalize(trimAndFade(audio)));
      await storage.put(key, wav);
    } catch (e) {
      return NextResponse.json({ error: `Voice engine unavailable: ${(e as Error).message}` }, { status: 503 });
    }
  }
  return new NextResponse(new Uint8Array(wav), { headers: { "content-type": "audio/wav", "cache-control": "public, max-age=86400", "content-length": String(wav.length) } });
}

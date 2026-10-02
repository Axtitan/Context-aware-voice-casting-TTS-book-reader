import { NextResponse } from "next/server";
import { allVoices, listProviders, DEFAULT_ENGINE } from "@/lib/tts";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ voices: await allVoices(), engines: listProviders(), defaultEngine: DEFAULT_ENGINE });
}

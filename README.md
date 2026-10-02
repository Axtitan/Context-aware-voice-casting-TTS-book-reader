# VoxLibris – Context-aware AI audiobooks

> **Give every character a voice.** Upload a book (or import a public-domain classic); the app understands the story, finds the characters, decides who is speaking, casts a consistent voice for each character, performs the book with open-weight TTS, and plays it back with synced text.

## Product overview

- **Two modes**: *One voice* (a narrator you choose) and *Character voices* (AI-cast, consistent per character, user-overridable and lockable).
- **Understanding before speech**: document extraction → story-start detection → chapters → scenes → character registry (aliases merged, attributes only from textual evidence) → narrator/POV detection (incl. first-person and per-chapter narrators) → dialogue & thought attribution with confidence → emotion/delivery → casting → cached, progressive generation → player with read-along highlighting and speaker indicator.
- **Free & private**: Kokoro-82M (Apache-2.0) runs on CPU on your server. Uploads are private to your session. Free books come from Project Gutenberg with attribution.
- **Formats**: PDF (scanned PDFs are OCR'd), EPUB, DOCX, DOC, TXT.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [MODEL_LICENSES.md](MODEL_LICENSES.md).

## Prerequisites

- Node.js 20+ (22 recommended), npm
- The app includes an embedded PGlite database for zero-configuration use; PostgreSQL 14+ is recommended for multi-instance production
- ~1 GB disk for the Kokoro ONNX model cache (downloaded from Hugging Face on first synthesis) and generated audio
- CPU with 4+ cores recommended (synthesis ≈ real-time per core on q8); a GPU is **not** required

## Installation & development

```bash
npm install
cp .env.example .env           # set SESSION_SECRET; DATABASE_URL is optional
npm run db:push                # only needed when using external PostgreSQL
npm run dev                    # http://localhost:3000
```

The first voice preview / generation downloads `onnx-community/Kokoro-82M-v1.0-ONNX` (~90 MB for q8). Set `HF_HOME`/`TRANSFORMERS_CACHE` to control the cache location; for air-gapped deployments pre-populate it.

## Environment variables

See `.env.example`. Key ones: optional `DATABASE_URL`, `SESSION_SECRET`, `STORAGE_DIR`, `MAX_UPLOAD_MB`, `JOB_CONCURRENCY`, `KOKORO_DTYPE` (`q8` default, `fp32` for best quality), `TTS_HTTP_URL` (+`TTS_HTTP_MODEL`, `TTS_HTTP_STYLE_CONTROL`, `TTS_HTTP_VOICES`) for an optional GPU engine, `OCR_MAX_PAGES`, `GUTENDEX_URL`.

## Database

Drizzle ORM schema is in `src/db/schema.ts`. Without `DATABASE_URL`, an embedded PGlite database is created automatically under `STORAGE_DIR`; with external PostgreSQL, apply the schema using `npm run db:push`. Entities: users, books (source/provenance, status, mode, analysis stats), chapters (kind, POV, narrator, audio status), scenes, characters (aliases, evidence, importance, voice + source + lock), segments (performance plan + timings), audio_assets (cache), jobs, playback_progress.

## AI / TTS model setup

- **Default**: nothing to do – `KokoroProvider` loads the ONNX model automatically.
- **Optional GPU engine** (Qwen3-TTS, Chatterbox, …): serve it behind an OpenAI-compatible `POST /v1/audio/speech` (+ optional `/v1/audio/voices`, `/health`), then set `TTS_HTTP_URL` and describe voices in `TTS_HTTP_VOICES`. Set `TTS_HTTP_STYLE_CONTROL=1` if the engine accepts natural-language `instructions`; the delivery engine will pass emotion/pace/delivery. Set `TTS_DEFAULT_ENGINE=http` to prefer it; Kokoro remains the fallback.
- **OCR**: Tesseract.js downloads `eng.traineddata` on first use; `@napi-rs/canvas` renders PDF pages.

## Storage

`StorageAdapter` (local filesystem under `STORAGE_DIR`) stores: original document, `blocks.json` (clean representation), per-segment cached WAVs, per-chapter assembled WAVs, voice previews. Audio is served through `/api/audio/...` with ownership checks and HTTP range support. Swap the adapter for S3/GCS without touching the pipeline.

## Job queue & workers

Jobs are rows in `jobs`; a worker loop runs inside the Next.js server process (started on first API call) with `JOB_CONCURRENCY` slots, requeuing interrupted jobs on restart. For dedicated workers run:

```bash
npx tsx scripts/worker.ts      # same handlers, separate machine; web process still serves the UI
```

Stages reported to the UI: Uploading → Extracting text → Understanding your book → Detecting chapters → Identifying characters → Attributing dialogue → Casting voices → Preparing audiobook; then per-chapter generation with real progress. Chapters become playable as soon as each finishes.

## Next.js bundler compatibility

This project deliberately uses Next.js with Webpack (`next dev --webpack` and `next build --webpack`). The embedded PGlite database loads PostgreSQL through WebAssembly; Turbopack may evaluate that WASM module in its static-path worker and terminate with `Error: Aborted(). Build with -sASSERTIONS`. Do not remove the `--webpack` flags unless the deployment uses an external PostgreSQL `DATABASE_URL`, which bypasses PGlite.

## Running

- Frontend + API: `npm run dev` / `npm run build && npm start`
- Workers: `npx tsx scripts/worker.ts` (optional)
- Offline analysis of any file (no DB needed): `npm run analyze -- path/to/book.epub --segments`

## Tests

```bash
npm test          # vitest: extraction, chapter detection, character extraction & alias merging,
                  # narrator detection, dialogue attribution, delivery, casting determinism/overrides/collisions, audio
```

Validated manually against Project Gutenberg texts (Pride and Prejudice – third person, many aliases; Frankenstein – first-person, epistolary, nested narrators) and the bundled demo story (front matter, tagged/untagged dialogue, thoughts, described characters).

## Production deployment

- Run behind a reverse proxy with HTTPS; set a strong `SESSION_SECRET`; keep `STORAGE_DIR` on persistent disk (or implement the object-storage adapter).
- Size CPU by throughput: Kokoro q8 ≈ 1× real-time per core → a 10-hour audiobook takes ~10 core-hours. Use `JOB_CONCURRENCY` = cores − 1 and/or separate workers.
- For expressive GPU engines budget a 16–24 GB GPU per worker. This cost is infrastructure, not per-API-call.
- Replace anonymous sessions with your auth provider by changing `getUserId()` in `src/lib/auth.ts`.

## Hardware requirements

| Tier | Spec | Experience |
|---|---|---|
| Minimum | 2 vCPU, 4 GB RAM | Analysis is instant; generation ~2× slower than real-time |
| Recommended | 8 vCPU, 16 GB RAM | Several books generating in parallel |
| Expressive | + NVIDIA GPU 16 GB+ | Qwen3-TTS/Chatterbox via `HttpProvider` |

## Known limitations

- Attribute extraction is rule-based (no LLM by design for zero-cost/offline). Untagged dialogue in long multi-party scenes falls back to turn-taking heuristics; low-confidence lines use the narrator voice and are labelled in the player.
- Kokoro has no explicit emotion control; delivery is shaped via pacing/text. Use an HTTP engine with style control for stronger acting.
- Audio is stored as 24 kHz mono WAV (≈170 MB/hour). Add an encoder step for MP3/Opus if disk is a concern.
- Scanned PDFs depend on OCR quality; books below 35 % confidence are rejected rather than narrated badly.
- English-only voice pool by default.

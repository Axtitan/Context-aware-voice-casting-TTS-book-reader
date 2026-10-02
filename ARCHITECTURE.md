# Architecture

```
Browser (Next.js App Router UI)
   │  fetch/poll
   ▼
API routes (src/app/api/**)  ── auth (anonymous signed cookie) ── PostgreSQL or embedded PGlite (Drizzle)
   │ enqueue                                                       ▲
   ▼                                                               │ status/progress
Job queue (src/lib/jobs/queue.ts, DB-backed, in-process worker or scripts/worker.ts)
   ├── analyze_book  → ingestion → structure → characters → narrator → dialogue plan → casting
   └── generate_audio → per-segment TTS (cached) → post-processing → chapter assembly → timings
                          │
                          ▼
             TTSProvider abstraction (src/lib/tts) → KokoroProvider (local ONNX) | HttpProvider (GPU box)
                          │
                          ▼
             Storage adapter (src/lib/storage) → ./storage (local) | S3-compatible (future)
```

## Layers

| Layer | Path | Responsibility |
|---|---|---|
| Ingestion | `src/lib/ingestion/extract.ts` | PDF (unpdf + Tesseract OCR fallback), EPUB (spine/OPF, headings, italics, cover), DOCX (mammoth), DOC (word-extractor), TXT → `Block[]` (heading/paragraph, page, italic). Header/footer & page-number removal, hyphenation repair, whitespace normalisation. |
| Structure | `src/lib/analysis/structure.ts` | Story-start detection (front matter vs. narrative vs. author preface), chapter detection (numbered/roman/word/unnumbered headings, parts, prologue/epilogue, back-matter cut-off, length-based fallback), scene splitting. |
| Characters | `src/lib/analysis/characters.ts` | Name candidate extraction with person-ness scoring, alias merging (full name / title+surname / given / nickname with gender-aware disambiguation), evidence-backed attributes (gender, age, nationality, accent, voice, appearance, personality) – **never inferred from names alone**. |
| Performance plan | `src/lib/analysis/dialogue.ts` | Narrator/POV detection (book & per-chapter, multi-narrator), quote-run splitting (double/single quote styles), attribution (tags, pronoun tags, action beats, same-paragraph, turn-taking, vocative elimination, recency), thought detection, emotion/intensity/pace/delivery. Output: `PlanSegment[]`. |
| Casting | `src/lib/casting/cast.ts` | Requirements → scored match against voice pool; uniqueness for majors, sharing for minors, narrator reservation, user-override precedence, collision detection, human-readable reasons. |
| TTS | `src/lib/tts/*` | `TTSProvider` interface; Kokoro (bundled, CPU) and HTTP (self-hosted GPU engines with style instructions). Delivery → speed/text shaping when an engine lacks style tokens. |
| Audio | `src/lib/audio/wav.ts` | WAV codec, RMS normalisation with peak ceiling, trim + fades, assembly with structure-aware pauses (sentence 220 ms, speaker change 420 ms, paragraph 600 ms, heading 1.2 s), timing map. |
| Jobs | `src/lib/jobs/*` | Queue + handlers. Progress is real (stage + fraction from words processed). Segment audio cache keyed by (engine, voice, voice version, text+delivery hash). |
| Storage | `src/lib/storage` | Path-safe local adapter; swap for object storage. |
| Data | `src/db/schema.ts` | PostgreSQL in production or automatically bootstrapped embedded PGlite when `DATABASE_URL` is absent; users, books, chapters, scenes, characters, segments, audio_assets, jobs, playback_progress. |

## Internal representation

`Block[]` (persisted as `books/{id}/blocks.json`) → `segments` rows: `{type, speakerCharacterId, speakerConfidence, attributionMethod, text, emotion, intensity, pace, delivery, startMs, endMs}`. The frontend consumes segments (with timings) for the read-along player and the block range for the reader; it never touches raw files.

## Voice identity persistence

`characters.voiceId` is the single source of truth for the whole book. `voiceSource='user'` or `voiceLocked` is never overwritten by re-analysis or re-casting; re-analysis re-attaches user choices by character name. Changing a voice invalidates chapter renders (not the segment cache, so unchanged voices are not regenerated).

## Confidence & fallbacks

Every attribution carries `speakerConfidence` + `attributionMethod`. Below 0.3 the narrator voice performs the line; the player only shows a speaker label at ≥0.45. Engine failure on the HTTP provider falls back to the closest Kokoro voice. OCR confidence <35 % marks the book `needs_ocr` instead of producing garbage audio.

## Future-ready hooks

- New formats: add a case in `extractDocument`.
- New engines: implement `TTSProvider`, register in `src/lib/tts/index.ts`.
- Cloning/custom narrators: `Voice.supportsCloning` + a voice row per user.
- Object storage: implement `StorageAdapter`.
- Horizontal workers: run `scripts/worker.ts` with `JOB_CONCURRENCY`.
- LLM refinement: the plan stage is pure functions over `Block[]`; an optional local-LLM pass (Ollama/vLLM) can post-edit `PlanSegment[]`/profiles without touching TTS.

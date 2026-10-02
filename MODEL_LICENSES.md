# Model & Data Source Licenses

VoxLibris runs entirely on open-weight models hosted on infrastructure you control. No paid AI APIs are required.

| Model / Source | Version | License | URL | Commercial use | Required attribution | Notes |
|---|---|---|---|---|---|---|
| **Kokoro-82M** (TTS, default engine) | v1.0 (ONNX, `onnx-community/Kokoro-82M-v1.0-ONNX`, q8 by default) | **Apache-2.0** (code: `hexgrad/kokoro`, weights: `hexgrad/Kokoro-82M`) | https://huggingface.co/hexgrad/Kokoro-82M | ✅ Allowed | Apache-2.0 NOTICE retention; we credit "Kokoro-82M" in the UI footer | 82M-param StyleTTS2-derived model; 28 English voices (American/British). Runs faster than real-time on CPU via ONNX Runtime. Training data were permissive/synthetic per model card. Voice metadata beyond gender/grade is an application-level catalog (`src/lib/tts/kokoro.ts`). |
| **kokoro-js** (runtime) | 1.2.x | Apache-2.0 | https://github.com/hexgrad/kokoro/tree/main/kokoro.js | ✅ | — | Uses `@huggingface/transformers` (Apache-2.0) and `onnxruntime-node` (MIT). |
| **Qwen3-TTS** (optional GPU engine via `HttpProvider`) | 12Hz 1.7B / 0.6B | Apache-2.0 (per Qwen release, Jan 2026) | https://github.com/QwenLM/Qwen3-TTS | ✅ (verify the specific checkpoint card before deploying) | Cite Qwen3-TTS | Supports natural-language style instructions and voice design; requires a GPU (≥12 GB VRAM recommended). Not bundled; connect through `TTS_HTTP_URL`. |
| **Chatterbox** (optional GPU engine) | 0.1.x | MIT (code + weights) | https://github.com/resemble-ai/chatterbox | ✅ | MIT notice | Adds emotion-exaggeration control and zero-shot cloning; outputs carry Resemble's PerTh watermark. Connect through `TTS_HTTP_URL`. |
| **Tesseract.js** (OCR for scanned PDFs) | 5.x / Tesseract 5 | Apache-2.0; `eng.traineddata` Apache-2.0 | https://github.com/naptha/tesseract.js | ✅ | — | Language data is downloaded at first use. |
| **PDF.js via unpdf** | — | Apache-2.0 | https://github.com/unjs/unpdf | ✅ | — | Text extraction and page rendering. |
| **Project Gutenberg** (free-book catalog) | via Gutendex API; Open Library catalog fallback | Texts: public domain in the US; Gutenberg trademark license applies to redistribution *with* the header | https://www.gutenberg.org / https://gutendex.com | Public-domain text is free to use; we strip the Gutenberg header/footer and keep source attribution in metadata | Source + link shown on every imported book | Gutendex results exclude titles explicitly marked copyrighted. The Open Library fallback only retains public-access records that have a Project Gutenberg identifier; imports still download from Project Gutenberg. Check local copyright rules outside the US. |

## Models evaluated but not selected as default

| Model | License | Reason |
|---|---|---|
| XTTS v2 (Coqui) | Coqui Public Model License (non-commercial) | License incompatible with public deployment. |
| Bark | MIT | Slow, unstable long-form, poor voice consistency. |
| Piper | MIT | Very fast but noticeably synthetic; weaker naturalness than Kokoro. |
| F5-TTS | Code MIT; weights CC-BY-NC-4.0 (Emilia-trained) | Weights are non-commercial. |
| Dia (Nari Labs) | Apache-2.0 | Dialogue-oriented, GPU-only, poor long-form/consistency in testing reports. |
| Orpheus | Apache-2.0 (Llama-3 derived weights carry the Llama license) | GPU-only; Llama license terms. Candidate for a future `HttpProvider` target. |

## Selection rationale

Kokoro-82M was chosen as the **default** because it is the only model that satisfies all of: permissive license (Apache-2.0), CPU real-time inference (so the app truly runs at zero API cost), strong naturalness (top of TTS Arena in its class), multiple distinct English voices with two accents, and deterministic voice identity (no cloning drift). Its limitations (no explicit emotion control, no cloning) are handled by the delivery layer (text shaping + speed modulation) and by the pluggable `HttpProvider` for expressive GPU models when a GPU is available.

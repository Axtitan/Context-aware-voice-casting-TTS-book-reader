/**
 * Document ingestion layer.
 * Raw file -> ExtractedDocument (ordered blocks of headings/paragraphs + metadata).
 * Nothing downstream ever sees the raw file.
 */
import JSZip from "jszip";

export type Block = {
  type: "heading" | "paragraph";
  text: string;
  level?: number; // heading level 1-3
  page?: number;
  italic?: boolean; // whole block emphasised (thought/letter hints)
};

export type ExtractedMetadata = {
  title?: string;
  author?: string;
  subtitle?: string;
  language?: string;
  publisher?: string;
  publicationYear?: string;
  isbn?: string;
  coverDataUrl?: string;
  description?: string;
};

export type ExtractedDocument = {
  blocks: Block[];
  metadata: ExtractedMetadata;
  format: string;
  pages?: number;
  scanned?: boolean;
  ocr?: boolean;
  ocrConfidence?: number;
  warnings: string[];
};

export const SUPPORTED_FORMATS = ["pdf", "epub", "docx", "doc", "txt"] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

export function detectFormat(filename: string, mime?: string | null): SupportedFormat | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if ((SUPPORTED_FORMATS as readonly string[]).includes(ext)) return ext as SupportedFormat;
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/epub+zip") return "epub";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mime === "application/msword") return "doc";
  if (mime?.startsWith("text/")) return "txt";
  return null;
}

/** Validate magic bytes so an .epub is really a zip, a .pdf really a pdf, etc. */
export function validateMagic(buf: Buffer, format: SupportedFormat): boolean {
  if (format === "pdf") return buf.subarray(0, 5).toString("latin1").startsWith("%PDF");
  if (format === "epub" || format === "docx") return buf[0] === 0x50 && buf[1] === 0x4b;
  if (format === "doc") return buf[0] === 0xd0 && buf[1] === 0xcf;
  if (format === "txt") {
    const sample = buf.subarray(0, 4096);
    let bad = 0;
    for (const b of sample) if (b === 0) bad++;
    return bad === 0;
  }
  return false;
}

export async function extractDocument(buf: Buffer, format: SupportedFormat, filename: string): Promise<ExtractedDocument> {
  let doc: ExtractedDocument;
  switch (format) {
    case "txt":
      doc = extractTxt(buf);
      break;
    case "epub":
      doc = await extractEpub(buf);
      break;
    case "docx":
      doc = await extractDocx(buf);
      break;
    case "doc":
      doc = await extractDoc(buf);
      break;
    case "pdf":
      doc = await extractPdf(buf);
      break;
  }
  doc.format = format;
  doc.blocks = cleanBlocks(doc.blocks);
  if (!doc.metadata.title) {
    const guess = filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
    doc.metadata.title = guess || "Untitled";
  }
  return doc;
}

// ---------------------------------------------------------------- TXT
export function extractTxt(buf: Buffer): ExtractedDocument {
  let text = buf.toString("utf8");
  if (text.includes("\uFFFD")) text = buf.toString("latin1");
  return { blocks: textToBlocks(text), metadata: metadataFromPlainText(text), format: "txt", warnings: [] };
}

/** Split plain text into paragraphs; detect standalone heading-like lines. */
export function textToBlocks(text: string): Block[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\t/g, " ");
  const paras = normalized.split(/\n\s*\n+/);
  const blocks: Block[] = [];
  for (const raw of paras) {
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    // A short block whose lines are all heading-like -> heading(s)
    if (lines.length <= 2 && lines.every((l) => looksLikeHeadingLine(l))) {
      blocks.push({ type: "heading", text: lines.join(" — "), level: 1 });
      continue;
    }
    // Heading line followed by body text in same block
    if (lines.length > 1 && looksLikeHeadingLine(lines[0]) && !/[.!?,;:]$/.test(lines[0])) {
      blocks.push({ type: "heading", text: lines[0], level: 1 });
      blocks.push({ type: "paragraph", text: joinLines(lines.slice(1)) });
      continue;
    }
    blocks.push({ type: "paragraph", text: joinLines(lines) });
  }
  return blocks;
}

function joinLines(lines: string[]): string {
  // Repair hyphenation across line breaks and collapse to a single paragraph
  let out = "";
  for (const line of lines) {
    if (out.endsWith("-") && /^[a-z]/.test(line)) out = out.slice(0, -1) + line;
    else out += (out ? " " : "") + line;
  }
  return out.replace(/\s+/g, " ").trim();
}

const HEADING_RE =
  /^(chapter|book|part|volume|canto|prologue|epilogue|preface|introduction|foreword|afterword|appendix|interlude|letter)\b/i;
const ROMAN_RE = /^(?=[IVXLC]+\.?$)M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})\.?$/;

export function looksLikeHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (HEADING_RE.test(t)) return true;
  if (ROMAN_RE.test(t)) return true;
  if (/^\d{1,3}\.?$/.test(t)) return true;
  const words = t.split(/\s+/);
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase() && words.length <= 10 && !/[.!?]$/.test(t)) return true;
  return false;
}

function metadataFromPlainText(text: string): ExtractedMetadata {
  const meta: ExtractedMetadata = {};
  const head = text.slice(0, 6000);
  const title = head.match(/^\s*(?:The Project Gutenberg eBook of|Title:)\s*(.+?)\s*(?:,\s*by\s+(.+?))?\s*$/im);
  if (title) {
    meta.title = title[1].trim();
    if (title[2]) meta.author = title[2].trim();
  }
  const author = head.match(/^\s*Author:\s*(.+)$/im);
  if (author) meta.author = author[1].trim();
  const lang = head.match(/^\s*Language:\s*(\w+)/im);
  if (lang) meta.language = lang[1].toLowerCase().slice(0, 2);
  const isbn = text.match(/ISBN[:\s-]*([\d-]{10,17}[\dX])/i);
  if (isbn) meta.isbn = isbn[1];
  return meta;
}

// ---------------------------------------------------------------- EPUB
async function extractEpub(buf: Buffer): Promise<ExtractedDocument> {
  const zip = await JSZip.loadAsync(buf);
  const warnings: string[] = [];
  const container = await zip.file("META-INF/container.xml")?.async("string");
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error("Invalid EPUB: missing OPF package");
  const opf = (await zip.file(opfPath)?.async("string")) ?? "";
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const metadata: ExtractedMetadata = {};
  const dc = (tag: string) => opf.match(new RegExp(`<dc:${tag}[^>]*>([^<]*)</dc:${tag}>`, "i"))?.[1]?.trim();
  metadata.title = decodeEntities(dc("title") ?? "");
  metadata.author = decodeEntities(dc("creator") ?? "");
  metadata.language = dc("language")?.slice(0, 2);
  metadata.publisher = decodeEntities(dc("publisher") ?? "") || undefined;
  const date = dc("date");
  if (date) metadata.publicationYear = date.match(/\d{4}/)?.[0];
  const ids = [...opf.matchAll(/<dc:identifier[^>]*>([^<]*)<\/dc:identifier>/gi)].map((m) => m[1]);
  const isbn = ids.find((i) => /isbn/i.test(i) || /^\d{13}$|^\d{10}$/.test(i.replace(/-/g, "")));
  if (isbn) metadata.isbn = isbn.replace(/^.*?(\d[\d-]{8,}[\dX]).*$/, "$1");
  const desc = dc("description");
  if (desc) metadata.description = stripHtml(decodeEntities(desc)).slice(0, 1200);

  // Manifest + spine
  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const m of opf.matchAll(/<item\b([^>]*)\/?>/gi)) {
    const attrs = m[1];
    const id = attrs.match(/\bid="([^"]+)"/)?.[1];
    const href = attrs.match(/\bhref="([^"]+)"/)?.[1];
    const type = attrs.match(/media-type="([^"]+)"/)?.[1] ?? "";
    const props = attrs.match(/properties="([^"]+)"/)?.[1] ?? "";
    if (id && href) manifest.set(id, { href: decodeURIComponent(href), type, props });
  }
  // Cover
  const coverId = opf.match(/<meta[^>]*name="cover"[^>]*content="([^"]+)"/i)?.[1];
  const coverItem =
    (coverId && manifest.get(coverId)) || [...manifest.values()].find((i) => /cover-image/.test(i.props));
  if (coverItem && coverItem.type.startsWith("image/")) {
    const img = await zip.file(base + coverItem.href)?.async("base64");
    if (img && img.length < 2_500_000) metadata.coverDataUrl = `data:${coverItem.type};base64,${img}`;
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"[^>]*\/?>/gi)].map((m) => m[1]);
  const blocks: Block[] = [];
  for (const idref of spine) {
    const item = manifest.get(idref);
    if (!item || !/html|xml/.test(item.type)) continue;
    const html = await zip.file(base + item.href)?.async("string");
    if (!html) {
      warnings.push(`Missing spine item ${item.href}`);
      continue;
    }
    blocks.push(...htmlToBlocks(html));
  }
  if (!blocks.length) throw new Error("EPUB contained no readable text");
  return { blocks, metadata, format: "epub", warnings };
}

// ---------------------------------------------------------------- DOCX / DOC
async function extractDocx(buf: Buffer): Promise<ExtractedDocument> {
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml({ buffer: buf });
  const blocks = htmlToBlocks(result.value);
  const metadata: ExtractedMetadata = {};
  try {
    const zip = await JSZip.loadAsync(buf);
    const core = await zip.file("docProps/core.xml")?.async("string");
    if (core) {
      metadata.title = decodeEntities(core.match(/<dc:title>([^<]*)</)?.[1] ?? "") || undefined;
      metadata.author = decodeEntities(core.match(/<dc:creator>([^<]*)</)?.[1] ?? "") || undefined;
    }
  } catch {
    /* metadata optional */
  }
  return { blocks, metadata, format: "docx", warnings: result.messages.map((m) => m.message).slice(0, 5) };
}

async function extractDoc(buf: Buffer): Promise<ExtractedDocument> {
  const mod = await import("word-extractor");
  const WordExtractor = (mod.default ?? mod) as unknown as new () => { extract(b: Buffer): Promise<{ getBody(): string }> };
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buf);
  const body = doc.getBody();
  return { blocks: textToBlocks(body), metadata: {}, format: "doc", warnings: [] };
}

// ---------------------------------------------------------------- PDF (+OCR)
async function extractPdf(buf: Buffer): Promise<ExtractedDocument> {
  const { extractText, getDocumentProxy, getMeta } = await import("unpdf");
  const data = new Uint8Array(buf);
  const pdf = await getDocumentProxy(data);
  const { totalPages, text: pages } = await extractText(pdf, { mergePages: false });
  const warnings: string[] = [];
  const metadata: ExtractedMetadata = {};
  try {
    const meta = await getMeta(pdf);
    const info = (meta.info ?? {}) as Record<string, string>;
    if (info.Title && info.Title.trim() && !/untitled|\.pdf$|microsoft word/i.test(info.Title)) metadata.title = info.Title.trim();
    if (info.Author && info.Author.trim()) metadata.author = info.Author.trim();
  } catch {
    /* optional */
  }
  const pageTexts = pages as string[];
  const totalChars = pageTexts.reduce((n, p) => n + p.replace(/\s+/g, "").length, 0);
  const scanned = totalChars < Math.max(200, totalPages * 40);

  if (scanned) {
    const ocr = await ocrPdf(pdf, totalPages, warnings);
    return { blocks: pagesToBlocks(ocr.pages), metadata, format: "pdf", pages: totalPages, scanned: true, ocr: true, ocrConfidence: ocr.confidence, warnings };
  }
  return { blocks: pagesToBlocks(pageTexts), metadata, format: "pdf", pages: totalPages, scanned: false, warnings };
}

async function ocrPdf(
  pdf: Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>,
  totalPages: number,
  warnings: string[],
): Promise<{ pages: string[]; confidence: number }> {
  const { renderPageAsImage } = await import("unpdf");
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  const pages: string[] = [];
  let confSum = 0;
  let confN = 0;
  try {
    const limit = Math.min(totalPages, Number(process.env.OCR_MAX_PAGES ?? 400));
    for (let p = 1; p <= limit; p++) {
      const png = await renderPageAsImage(pdf, p, { scale: 2, canvasImport: () => import("@napi-rs/canvas") });
      const { data } = await worker.recognize(Buffer.from(png));
      pages.push(data.text);
      confSum += data.confidence;
      confN++;
    }
    if (limit < totalPages) warnings.push(`OCR limited to first ${limit} of ${totalPages} pages`);
  } finally {
    await worker.terminate();
  }
  const confidence = confN ? confSum / confN / 100 : 0;
  if (confidence < 0.6) warnings.push(`Low OCR confidence (${Math.round(confidence * 100)}%) – audio may contain recognition errors`);
  return { pages, confidence };
}

/** Page texts -> blocks with running header/footer + page-number removal. */
export function pagesToBlocks(pages: string[]): Block[] {
  const pageLines = pages.map((p) => p.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean));
  // Detect repeated headers/footers: lines that appear (normalised) on >30% of pages at top/bottom.
  const freq = new Map<string, number>();
  for (const lines of pageLines) {
    const edge = [...lines.slice(0, 2), ...lines.slice(-2)].filter(isHeaderCandidate);
    for (const l of new Set(edge.map(normalizeEdgeLine))) freq.set(l, (freq.get(l) ?? 0) + 1);
  }
  const threshold = Math.max(3, pageLines.length * 0.3);
  const repeated = new Set([...freq.entries()].filter(([l, n]) => n >= threshold && l.length > 0).map(([l]) => l));

  const blocks: Block[] = [];
  let carry = ""; // paragraph continuing across page boundary
  pageLines.forEach((lines, idx) => {
    const kept = lines.filter((l, i) => {
      const isEdge = i < 2 || i >= lines.length - 2;
      if (isEdge && isHeaderCandidate(l) && repeated.has(normalizeEdgeLine(l))) return false;
      if (isEdge && /^(page\s*)?\d{1,4}$/i.test(l)) return false;
      if (isEdge && ROMAN_RE.test(l) && lines.length > 5) return false;
      return true;
    });
    // Group lines into paragraphs: blank-line splits already lost, so use sentence-ending + indentation heuristics
    let para = carry;
    const flush = (final: boolean) => {
      const t = para.replace(/\s+/g, " ").trim();
      if (!t) return;
      if (looksLikeHeadingLine(t)) blocks.push({ type: "heading", text: t, level: 1, page: idx + 1 });
      else blocks.push({ type: "paragraph", text: t, page: idx + 1 });
      para = "";
      void final;
    };
    for (let i = 0; i < kept.length; i++) {
      const line = kept[i];
      if (looksLikeHeadingLine(line) && (!para || /[.!?"”’]$/.test(para))) {
        flush(false);
        blocks.push({ type: "heading", text: line, level: 1, page: idx + 1 });
        continue;
      }
      if (para.endsWith("-") && /^[a-z]/.test(line)) para = para.slice(0, -1) + line;
      else para += (para ? " " : "") + line;
      const next = kept[i + 1];
      const endsSentence = /[.!?"”’]\s*$/.test(line);
      const shortLine = line.length < 45;
      const nextStartsNew = next ? /^["“‘(]|^[A-Z]/.test(next) : false;
      if (endsSentence && (shortLine || (nextStartsNew && next && next.length < 60))) flush(false);
    }
    carry = para;
    if (idx === pageLines.length - 1) flush(true);
  });
  return blocks;
}

/** Running headers/footers are short and not sentence-like. */
function isHeaderCandidate(l: string): boolean {
  return l.length < 70 && !(l.length > 40 && /[.!?]$/.test(l));
}

function normalizeEdgeLine(l: string): string {
  return l.toLowerCase().replace(/\d+/g, "#").replace(/[^a-z#]+/g, " ").trim();
}

// ---------------------------------------------------------------- HTML helpers
export function htmlToBlocks(html: string): Block[] {
  let body = html.replace(/<head[\s\S]*?<\/head>/gi, "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  body = body.replace(/<br\s*\/?>/gi, "\n");
  const blocks: Block[] = [];
  const re = /<(h[1-6]|p|li|blockquote|div|td|dd|dt|pre|figcaption)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let any = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const tag = m[1].toLowerCase();
    const inner = m[2];
    if (tag === "div" && /<(p|h[1-6]|div)\b/i.test(inner)) continue; // container, children handled
    const italicWhole = /^\s*<(i|em)\b[^>]*>[\s\S]*<\/\1>\s*$/i.test(inner) && !/<\/(i|em)>[\s\S]*\w[\s\S]*<(i|em)\b/i.test(inner);
    const text = stripHtml(decodeEntities(inner)).replace(/\s+/g, " ").trim();
    if (!text) continue;
    any = true;
    if (/^h[1-6]$/.test(tag)) blocks.push({ type: "heading", text, level: Math.min(3, Number(tag[1])) });
    else if (looksLikeHeadingLine(text) && text.length < 60 && !/[.!?]$/.test(text) && tag !== "li") blocks.push({ type: "heading", text, level: 2 });
    else blocks.push({ type: "paragraph", text, italic: italicWhole || undefined });
  }
  if (!any) return textToBlocks(stripHtml(decodeEntities(body)));
  return blocks;
}

export function stripHtml(s: string): string {
  return s
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ");
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rsquo;/g, "’")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// ---------------------------------------------------------------- Cleaning
export function cleanBlocks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    let text = b.text
      .replace(/\[Illustration:?[^\]]*\]/gi, "")
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .replace(/ ([,.;:!?])/g, "$1")
      .replace(/(\w)- (\w)/g, (m, a, c) => (/^[a-z]/.test(c) ? `${a}${c}` : m))
      .trim();
    if (!text) continue;
    // Strip pure page-number / decorative separator blocks
    if (/^[\d\s]+$/.test(text) && text.length < 6) continue;
    if (/^[*\-_=~•·.\s]+$/.test(text)) continue;
    // Merge trailing fragments onto previous paragraph when a paragraph was split mid-sentence
    const prev = out[out.length - 1];
    if (prev && prev.type === "paragraph" && b.type === "paragraph" && /[a-z,;]$/.test(prev.text) && /^[a-z]/.test(text)) {
      prev.text = `${prev.text} ${text}`;
      continue;
    }
    text = text.replace(/^"([\s\S]*)"$/, "“$1”");
    out.push({ ...b, text });
  }
  return out;
}

export function countWords(text: string): number {
  return (text.match(/[A-Za-z0-9’']+/g) ?? []).length;
}

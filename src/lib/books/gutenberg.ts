/** Strip Project Gutenberg's license header/footer so it is never narrated (attribution is kept in metadata). */
export function stripGutenbergBoilerplate(text: string): string {
  const start = text.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i);
  const end = text.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
  let body = text;
  if (start >= 0) body = body.slice(body.indexOf("\n", start) + 1);
  if (end >= 0) {
    const endIdx = body.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG EBOOK/i);
    if (endIdx > 0) body = body.slice(0, endIdx);
  }
  // Drop "Produced by ..." / "[Illustration]" noise
  return body.replace(/^\s*(Produced by|E-text prepared by|Transcribed from)[^\n]*\n(?:[^\n]*\n){0,3}/im, "").replace(/\[Illustration:?[^\]]*\]/g, "");
}


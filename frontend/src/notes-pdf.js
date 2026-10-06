export const NOTES_PDF_LIMITS = Object.freeze({ text: 1024 * 1024, base64: 1024 * 1024, pages: 1024 });
const WIDTH = 595.28, HEIGHT = 841.89, MARGIN = 48, SIZE = 12, LEADING = 17;
let pdfLibrary, fontLibrary, defaultFont;
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const integer = value => Number.isSafeInteger(value) && value >= 1;
const knownErrors = ['invalid_arguments', 'unsupported_content', 'limit_exceeded', 'stale_target', 'unavailable', 'collision', 'disabled'];
const fontkitLibrary = () => fontLibrary ??= import('@pdf-lib/fontkit').catch(error => { fontLibrary = undefined; throw error; });
const serializationLibrary = () => pdfLibrary ??= import('pdf-lib').catch(error => { pdfLibrary = undefined; throw error; });

async function loadFont() {
  // Only immutable bundled bytes/libraries are cached, never PDF/font instances.
  defaultFont ??= fetch('/fonts/LiberationSans-Regular.ttf').then(async response => {
    if (!response.ok) fail('unavailable', 'The bundled document font is unavailable.');
    return new Uint8Array(await response.arrayBuffer());
  }).catch(error => { defaultFont = undefined; throw error; });
  return defaultFont;
}
function validateText(text, fontLoader) {
  if (typeof text !== 'string' || text.length > NOTES_PDF_LIMITS.text || typeof fontLoader !== 'function') {
    fail('invalid_arguments', 'Expected bounded text and a bundled font loader.');
  }
}
async function prepareFont(text, fontLoader) {
  const module = await fontkitLibrary();
  const loadedFont = await fontLoader();
  if (!(loadedFont instanceof Uint8Array) || !loadedFont.length) fail('unavailable', 'The bundled document font is unavailable.');
  // Caller-owned bytes cannot change across subsequent serialization awaits.
  const fontBytes = new Uint8Array(loadedFont), fontkit = module.default ?? module;
  const face = fontkit.create(fontBytes);
  for (const character of text) {
    // Line separators affect layout, not glyph drawing. Tabs need tab stops and
    // are rejected rather than being silently replaced with spaces.
    if (character === '\n' || character === '\r') continue;
    const code = character.codePointAt(0);
    if (code < 32 || (code >= 0x7f && code <= 0x9f) || (code >= 0xd800 && code <= 0xdfff)
      || !face.hasGlyphForCodePoint(code)) fail('unsupported_content', 'The bundled font cannot faithfully render every character in this note.');
  }
  return { fontBytes, fontkit, face };
}
function layoutText(text, face) {
  const pages = [];
  let page, y;
  function newPage() {
    if (pages.length >= NOTES_PDF_LIMITS.pages) fail('limit_exceeded', 'The note exceeds the document page limit.');
    page = { width: WIDTH, height: HEIGHT, lines: [] }; pages.push(page); y = HEIGHT - MARGIN - SIZE;
  }
  function line(value) {
    if (y < MARGIN) newPage();
    page.lines.push({ text: value, x: MARGIN, y, size: SIZE }); y -= LEADING;
  }
  // Exact CustomFontEmbedder metrics: sum shaped glyph advanceWidth scaled by
  // unitsPerEm. Do not substitute canvas/CSS measurements for PDF authority.
  function width(value) {
    return face.layout(value).glyphs.reduce((total, glyph) => total + glyph.advanceWidth, 0) * SIZE / face.unitsPerEm;
  }
  newPage();
  const maxWidth = WIDTH - MARGIN * 2;
  // Word wrapping retains every whitespace/character, splitting long words at
  // Unicode code-point boundaries. CRLF/CR/LF retain their line structure.
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    if (!paragraph) { line(''); continue; }
    const characters = Array.from(paragraph);
    let start = 0;
    while (start < characters.length) {
      let low = start + 1, high = characters.length, end = start;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (width(characters.slice(start, middle).join('')) <= maxWidth) { end = middle; low = middle + 1; }
        else high = middle - 1;
      }
      if (end === start) fail('unsupported_content', 'A character cannot fit the document page width.');
      if (end < characters.length) {
        for (let index = end - 1; index > start; index--) {
          if (/\s/u.test(characters[index])) { end = index + 1; break; }
        }
      }
      line(characters.slice(start, end).join('')); start = end;
    }
  }
  return { pageCount: pages.length, pages };
}
function preparationError(error) {
  if (knownErrors.includes(error?.code)) throw error;
  fail('unavailable', 'The note could not be converted to a faithful document.');
}

/** Preview only: no PDF document, embedding, drawing, save or base64 encoding. */
export async function layoutNotesPdf(text, { fontLoader = loadFont } = {}) {
  validateText(text, fontLoader);
  try {
    const { face } = await prepareFont(text, fontLoader);
    return layoutText(text, face);
  } catch (error) { preparationError(error); }
}

/** pageCount/pages describe the full source. The optional inclusive range
 * selects only serialized PDF bytes, preserving honest preview numbering. */
export async function createNotesPdf(text, timestamp, { fontLoader = loadFont, pageFrom, pageTo } = {}) {
  validateText(text, fontLoader);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 8_640_000_000_000_000 - 1
    || (pageFrom !== undefined && !integer(pageFrom)) || (pageTo !== undefined && !integer(pageTo))) {
    fail('invalid_arguments', 'Expected a deterministic timestamp and an integer page range.');
  }
  try {
    const { face, fontkit, fontBytes } = await prepareFont(text, fontLoader);
    const { pages, pageCount } = layoutText(text, face);
    const from = pageFrom ?? 1, to = pageTo ?? pageCount;
    if (from > to || to > pageCount) fail('invalid_arguments', 'The page range is outside this note’s actual pagination.');
    const lib = await serializationLibrary(), pdf = await lib.PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(fontBytes, { subset: true }), date = new Date(timestamp);
    pdf.setCreationDate(date); pdf.setModificationDate(date);
    pdf.setProducer('JesterOS simulated document workflow'); pdf.setCreator('JesterOS Notes');
    for (const layout of pages.slice(from - 1, to)) {
      const output = pdf.addPage([WIDTH, HEIGHT]);
      for (const entry of layout.lines) if (entry.text) output.drawText(entry.text, { x: entry.x, y: entry.y, size: entry.size, font });
    }
    const base64 = await pdf.saveAsBase64({ useObjectStreams: false });
    if (base64.length > NOTES_PDF_LIMITS.base64) fail('limit_exceeded', 'The PDF exceeds the document content limit.');
    return { base64, pageCount, pages };
  } catch (error) { preparationError(error); }
}

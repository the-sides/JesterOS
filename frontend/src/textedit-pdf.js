import { copyCanonicalData } from './canonical-data.js';
import { validateTextEditContent, TEXTEDIT_MARK_DEFAULTS } from './textedit-content.js';
export const TEXTEDIT_PDF_LIMITS = Object.freeze({ pages: 1024, base64: 8 * 1024 * 1024 });
const WIDTH = 595.28, HEIGHT = 841.89, MARGIN = 48, BODY = WIDTH - 2 * MARGIN;
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
let pdfLibrary, fontLibrary, fontBytes;
const loadPdf = () => pdfLibrary ??= import('pdf-lib').catch(error => { pdfLibrary = undefined; throw error; });
const loadFontkit = () => fontLibrary ??= import('@pdf-lib/fontkit').catch(error => { fontLibrary = undefined; throw error; });
async function bundledFont() {
  // Same immutable, bundled-resource-only font path as notes-pdf. Never host fonts or external URLs.
  fontBytes ??= fetch('/fonts/LiberationSans-Regular.ttf').then(async response => {
    if (!response.ok) fail('unavailable', 'The bundled Liberation Sans font is unavailable.');
    return new Uint8Array(await response.arrayBuffer());
  }).catch(error => { fontBytes = undefined; throw error; });
  return fontBytes;
}
const attachmentText = block => `[Attachment: ${block.name} (${block.mime}); local file ${block.fileId}]`;
const allRuns = content => content.blocks.flatMap(block => block.type === 'paragraph' ? block.runs : block.type === 'table' ? block.rows.flatMap(row => row.flatMap(cell => cell.runs)) : [{ text: attachmentText(block), marks: { ...TEXTEDIT_MARK_DEFAULTS } }]);

/** Actual embedded-font PDF. Optional fontLoader is for deterministic consumers/tests,
 * not an external-font/network fallback. Named authored fonts use disclosed bundled substitution. */
export async function createTextEditPdf(content, timestamp, { fontLoader = bundledFont } = {}) {
  if (!validateTextEditContent(content) || !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp >= 8_640_000_000_000_000 || typeof fontLoader !== 'function')
    fail('invalid_arguments', 'Expected canonical content, an authored epoch and a bundled font loader.');
  // Capture before every serialization await; no caller mutation can change a started export.
  const snapshot = copyCanonicalData(content);
  try {
    const module = await loadFontkit(), fontkit = module.default ?? module;
    const loaded = await fontLoader();
    if (!(loaded instanceof Uint8Array) || !loaded.length) fail('unavailable', 'The bundled PDF font bytes are unavailable.');
    const bytes = new Uint8Array(loaded), face = fontkit.create(bytes);
    const substitutions = new Set();
    for (const { text, marks } of allRuns(snapshot)) {
      if (marks.font !== 'Liberation Sans') substitutions.add(marks.font);
      for (const character of text) {
        if (character === '\n' || character === '\r' || character === '\t') continue;
        const code = character.codePointAt(0);
        if (code < 32 || (code >= 0x7f && code <= 0x9f) || !face.hasGlyphForCodePoint(code)) fail('unsupported_content', 'The bundled PDF font cannot render every authored character.');
        if (/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(character)) fail('unsupported_content', 'Bidirectional PDF layout is not supported; no text is silently reordered.');
      }
    }
    const lib = await loadPdf(), pdf = await lib.PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await pdf.embedFont(bytes, { subset: true }), date = new Date(timestamp);
    pdf.setCreationDate(date); pdf.setModificationDate(date);
    pdf.setProducer('JesterOS simulated document workflow'); pdf.setCreator('JesterOS TextEdit');
    const measure = (text, size) => font.widthOfTextAtSize(text, size);
    const color = hex => lib.rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
    const pages = []; let page, layout, y;
    const newPage = () => {
      if (pages.length >= TEXTEDIT_PDF_LIMITS.pages) fail('limit_exceeded', 'PDF exceeds the page limit.');
      page = pdf.addPage([WIDTH, HEIGHT]); layout = { lines: [], tables: [] }; pages.push(layout); y = HEIGHT - MARGIN;
    };
    const ensure = height => { if (height > HEIGHT - 2 * MARGIN) fail('unsupported_content', 'A PDF row or line is too tall for one page.'); if (y - height < MARGIN) newPage(); };
    const drawFragment = (fragment, x, baseline) => {
      const { text, marks, width } = fragment;
      if (!text) return;
      const options = { x, y: baseline, font, size: marks.size, color: color(marks.color), ...(marks.italic ? { ySkew: lib.degrees(12) } : {}) };
      // Stroke the one licensed Regular glyph run for synthetic weight. Painting it
      // twice creates duplicate text that PDF readers can reorder during extraction.
      if (marks.bold) page.pushOperators(lib.pushGraphicsState(), lib.setLineWidth(marks.size * 0.036), lib.setStrokingRgbColor(options.color.red, options.color.green, options.color.blue), lib.setTextRenderingMode(lib.TextRenderingMode.FillAndOutline));
      page.drawText(text, options);
      if (marks.bold) page.pushOperators(lib.popGraphicsState());
      if (marks.underline) page.drawLine({ start: { x, y: baseline - marks.size * 0.12 }, end: { x: x + width, y: baseline - marks.size * 0.12 }, thickness: Math.max(0.5, marks.size / 20), color: color(marks.color) });
      if (marks.strike) page.drawLine({ start: { x, y: baseline + marks.size * 0.3 }, end: { x: x + width, y: baseline + marks.size * 0.3 }, thickness: Math.max(0.5, marks.size / 20), color: color(marks.color) });
    };
    function linesFor(runs, width, tabs = [], spacing = 1) {
      if (width < 1) fail('unsupported_content', 'The authored indent leaves no PDF text area.');
      const lines = []; let fragments = [], used = 0, largest = 0;
      const finish = (final = false) => { const size = largest || runs[0]?.marks.size || 12; lines.push({ fragments, width: used, size, height: size * 1.25 * spacing, final }); fragments = []; used = 0; largest = 0; };
      const add = (text, marks, advance = measure(text, marks.size)) => { fragments.push({ text, marks, width: advance }); used += advance; largest = Math.max(largest, marks.size); };
      for (const run of runs) {
        const tokens = run.text.replace(/\r\n?/g, '\n').match(/[^\s]+|[^\S\n\t]+|\n|\t/gu) ?? [];
        for (const token of tokens) {
          if (token === '\n') { finish(true); continue; }
          if (token === '\t') {
            let stop = tabs.find(value => value > used + 0.01) ?? (Math.floor(used / 36) + 1) * 36;
            if (stop > width && used) { finish(); stop = tabs.find(value => value > 0.01) ?? 36; }
            if (stop > width) fail('unsupported_content', 'A tab stop lies outside the PDF text area.');
            add('', run.marks, stop - used); continue;
          }
          const tokenWidth = measure(token, run.marks.size);
          if (used && used + tokenWidth > width) finish();
          if (tokenWidth <= width) { add(token, run.marks, tokenWidth); continue; }
          let chunk = '';
          for (const character of token) {
            const candidate = chunk + character, candidateWidth = measure(candidate, run.marks.size);
            if (candidateWidth > width && chunk) { add(chunk, run.marks); finish(); chunk = character; }
            else chunk = candidate;
            if (measure(chunk, run.marks.size) > width) fail('unsupported_content', 'A glyph is wider than the PDF text area.');
          }
          if (chunk) add(chunk, run.marks);
        }
      }
      finish(true); return lines;
    }
    const drawLine = (line, left, available, align, top) => {
      const shift = align === 'center' ? (available - line.width) / 2 : align === 'right' ? available - line.width : 0;
      const spaces = align === 'justify' && !line.final ? line.fragments.reduce((total, fragment) => total + (fragment.text.match(/ /g)?.length ?? 0), 0) : 0;
      const extra = spaces ? Math.max(0, available - line.width) / spaces : 0;
      const baseline = top - line.size, entries = []; let x = left + shift;
      for (const fragment of line.fragments) {
        if (!extra || !fragment.text.includes(' ')) { drawFragment(fragment, x, baseline); entries.push({ text: fragment.text, x, y: baseline, size: fragment.marks.size, marks: fragment.marks }); x += fragment.width; }
        else {
          for (const part of fragment.text.split(/( )/)) {
            if (!part) continue;
            const width = measure(part, fragment.marks.size);
            drawFragment({ ...fragment, text: part, width }, x, baseline); entries.push({ text: part, x, y: baseline, size: fragment.marks.size, marks: fragment.marks }); x += width + (part === ' ' ? extra : 0);
          }
        }
      }
      layout.lines.push({ text: line.fragments.map(fragment => fragment.text).join(''), x: left + shift, y: baseline, height: line.height, fragments: entries });
    };
    newPage(); let number = 0;
    for (const block of snapshot.blocks) {
      if (block.type === 'paragraph' || block.type === 'attachment') {
        const paragraph = block.type === 'paragraph' ? block : { runs: [{ text: attachmentText(block), marks: { ...TEXTEDIT_MARK_DEFAULTS } }], align: 'left', spacing: 1, indent: 0, tabs: [], list: 'none' };
        number = paragraph.list === 'number' ? number + 1 : 0;
        const prefix = paragraph.list === 'bullet' ? '• ' : paragraph.list === 'number' ? `${number}. ` : '';
        const marks = paragraph.runs[0].marks, prefixWidth = measure(prefix, marks.size), left = MARGIN + paragraph.indent;
        const lines = linesFor(paragraph.runs, BODY - paragraph.indent - prefixWidth, paragraph.tabs.map(tab => tab - prefixWidth).filter(tab => tab > 0), paragraph.spacing);
        lines.forEach((line, i) => { ensure(Math.max(line.height, line.size * 1.05)); if (!i && prefix) drawFragment({ text: prefix, marks, width: prefixWidth }, left, y - line.size); drawLine(line, left + prefixWidth, BODY - paragraph.indent - prefixWidth, paragraph.align, y); y -= line.height; });
        y -= 6;
      } else {
        number = 0; const columns = block.rows[0].length, cellWidth = BODY / columns, padding = 5;
        for (const row of block.rows) {
          const cellLines = row.map(cell => linesFor(cell.runs, cellWidth - padding * 2));
          const rowHeight = Math.max(...cellLines.map(lines => lines.reduce((sum, line) => sum + line.height, 0))) + padding * 2;
          ensure(rowHeight); const top = y;
          row.forEach((_, column) => {
            const x = MARGIN + column * cellWidth;
            page.drawRectangle({ x, y: top - rowHeight, width: cellWidth, height: rowHeight, borderColor: lib.rgb(0.55, 0.55, 0.55), borderWidth: 0.5 });
            let cellY = top - padding;
            for (const line of cellLines[column]) { drawLine(line, x + padding, cellWidth - padding * 2, 'left', cellY); cellY -= line.height; }
          });
          layout.tables.push({ blockId: block.id, x: MARGIN, y: top - rowHeight, width: BODY, height: rowHeight, columns }); y -= rowHeight;
        }
        y -= 6;
      }
    }
    const base64 = await pdf.saveAsBase64({ useObjectStreams: false });
    if (base64.length > TEXTEDIT_PDF_LIMITS.base64) fail('limit_exceeded', 'PDF exceeds the supported byte limit.');
    return { base64, pageCount: pages.length, pages, fontSubstitutions: [...substitutions].map(from => ({ from, to: 'Liberation Sans' })), syntheticEmphasis: true, attachments: 'textual-labels-only', links: 'inert-text-only' };
  } catch (error) {
    if (['invalid_arguments', 'unavailable', 'unsupported_content', 'limit_exceeded'].includes(error?.code)) throw error;
    fail('unavailable', `PDF serialization is unavailable: ${error?.message ?? 'unknown error'}`);
  }
}

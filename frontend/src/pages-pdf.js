import { copyCanonicalData } from './canonical-data.js';
import { encodePreviewData } from './preview-codec.js';
import { pagesChartGeometry } from './pages-render.js';
import { pagesMargins } from './pages-model.js';
let library, fontkitLibrary, fontResource;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
async function bundledFont() {
  fontResource ??= fetch('/fonts/LiberationSans-Regular.ttf').then(async response => { if (!response.ok) fail('unavailable', 'The bundled PDF font is unavailable.'); return new Uint8Array(await response.arrayBuffer()); }).catch(error => { fontResource = undefined; throw error; });
  return fontResource;
}
/** Real vector/text/image PDF, using the document's actual paper dimensions.
 * Named fonts are explicitly substituted by the bundled Liberation Sans face;
 * synthetic emphasis is disclosed by the UI, not claimed as a native font. */
export async function pagesPDF(content, sceneTime, { guard = () => true, fontLoader = bundledFont } = {}) {
  const snapshot = copyCanonicalData(content);
  if (!Number.isSafeInteger(sceneTime) || sceneTime < 0 || guard() !== true) fail('stale_target', 'The original Pages export time is unavailable.');
  library ??= import('pdf-lib').catch(error => { library = undefined; throw error; });
  fontkitLibrary ??= import('@pdf-lib/fontkit').catch(error => { fontkitLibrary = undefined; throw error; });
  const [lib, kitModule, bytes] = await Promise.all([library, fontkitLibrary, fontLoader()]);
  if (guard() !== true) fail('stale_target', 'The original document changed while loading the PDF font.');
  const fontkit = kitModule.default ?? kitModule, face = fontkit.create(bytes), pdf = await lib.PDFDocument.create();
  if (guard() !== true) fail('stale_target', 'The original document changed while creating its PDF.');
  pdf.registerFontkit(fontkit); const font = await pdf.embedFont(bytes, { subset: true });
  if (guard() !== true) fail('stale_target', 'The original document changed while embedding its PDF font.');
  const date = new Date(sceneTime); pdf.setCreationDate(date); pdf.setModificationDate(date); pdf.setTitle(snapshot.title); pdf.setCreator('Pages local document workflow'); pdf.setProducer('JesterOS');
  const { width, height } = snapshot.page, margins = pagesMargins(snapshot.page), margin = margins.left, usable = width - margins.left - margins.right, usableHeight = height - margins.top - margins.bottom;
  const color = hex => lib.rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
  let page, y, count = 0;
  function newPage() { if (++count > 1024) fail('limit_exceeded', 'The PDF exceeds 1024 pages.'); page = pdf.addPage([width, height]); y = height - margins.top; }
  function ensure(space) { if (space > usableHeight) fail('unsupported_content', 'An object or table row is taller than the authored paper area. Resize it before exporting.'); if (y - space < margins.bottom) newPage(); }
  function checkText(text) { for (const char of text) { if ('\n\r\t'.includes(char)) continue; if (!face.hasGlyphForCodePoint(char.codePointAt(0)) || /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(char)) fail('unsupported_content', 'This document needs glyphs or bidirectional layout not supported by the bundled PDF font. DOCX preserves the authored text.'); } }
  function lines(runs, available) {
    const result = []; let row = [], used = 0, largest = 11;
    const finish = () => { result.push({ runs: row, width: used, size: largest }); row = []; used = 0; largest = 11; };
    for (const run of runs) {
      checkText(run.text);
      for (const token of run.text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split(/(\n|[^\S\n]+)/u)) {
        if (!token) continue; if (token === '\n') { finish(); continue; }
        const tokenWidth = font.widthOfTextAtSize(token, run.size);
        if (used && used + tokenWidth > available) finish();
        if (tokenWidth <= available) { row.push({ ...run, text: token, width: tokenWidth }); used += tokenWidth; largest = Math.max(largest, run.size); }
        else for (const character of token) { const advance = font.widthOfTextAtSize(character, run.size); if (advance > available) fail('unsupported_content', 'A glyph is wider than the authored text area.'); if (used && used + advance > available) finish(); row.push({ ...run, text: character, width: advance }); used += advance; largest = Math.max(largest, run.size); }
      }
    }
    finish(); return result;
  }
  function drawLine(line, left, top, available, align, final) {
    const spaces = align === 'justify' && !final ? line.runs.reduce((sum, run) => sum + (run.text.match(/ /g)?.length ?? 0), 0) : 0;
    const extra = spaces ? Math.max(0, available - line.width) / spaces : 0;
    let x = left + (align === 'center' ? (available - line.width) / 2 : align === 'right' ? available - line.width : 0);
    for (const run of line.runs) for (const part of extra ? run.text.split(/( )/u) : [run.text]) {
      if (!part) continue; const w = font.widthOfTextAtSize(part, run.size), baseline = top - line.size;
      const options = { x, y: baseline, size: run.size, font, color: color(run.color), ...(run.italic ? { xSkew: lib.degrees(12) } : {}) };
      page.drawText(part, options); if (run.bold) page.drawText(part, { ...options, x: x + run.size * .018 });
      if (run.underline) page.drawLine({ start: { x, y: baseline - run.size * .12 }, end: { x: x + w, y: baseline - run.size * .12 }, thickness: .6, color: color(run.color) });
      x += w + (part === ' ' ? extra : 0);
    }
  }
  newPage();
  for (const block of snapshot.blocks) {
    if (guard() !== true) fail('stale_target', 'The original export lease expired.');
    if (block.type === 'paragraph') {
      if (block.pageBreakBefore && y < height - margins.top) newPage();
      const rows = lines(block.runs, usable); rows.forEach((line, index) => { ensure(line.size * 1.3); drawLine(line, margin, y, usable, block.align, index === rows.length - 1); y -= line.size * 1.3; }); y -= 10;
    } else if (block.type === 'table') {
      const cellWidth = usable / block.rows[0].length;
      for (const row of block.rows) {
        const wrapped = row.map(cell => lines([{ text: cell.text, font: 'Liberation Sans', size: 10, color: '#222222', bold: false, italic: false, underline: false }], cellWidth - 10)), rowHeight = Math.max(...wrapped.map(rows => rows.length * 13)) + 10;
        ensure(rowHeight); const top = y;
        wrapped.forEach((rows, column) => { const x = margin + column * cellWidth; page.drawRectangle({ x, y: top - rowHeight, width: cellWidth, height: rowHeight, borderWidth: .5, borderColor: color('#aaaaaa') }); rows.forEach((line, index) => drawLine(line, x + 5, top - 5 - index * 13, cellWidth - 10, 'left', true)); }); y -= rowHeight;
      } y -= 10;
    } else if (block.type === 'image') {
      const image = block.content.startsWith('data:image/png;') ? await pdf.embedPng(block.content) : await pdf.embedJpg(block.content);
      if (guard() !== true) fail('stale_target', 'The original document changed while embedding its image.');
      const scale = Math.min(1, usable / block.width, usableHeight / block.height), w = block.width * scale, h = block.height * scale;
      ensure(h); page.drawImage(image, { x: margin, y: y - h, width: w, height: h }); y -= h + 10;
    } else {
      const w = Math.min(usable, 480), h = Math.min(260, usableHeight - 28); if (h < 40) fail('unsupported_content', 'The authored paper area is too small for a chart.'); ensure(h + 28); checkText(block.title);
      page.drawText(block.title, { x: margin, y: y - 14, size: 12, font, color: color('#222222') });
      const geometry = pagesChartGeometry(block, w, h), top = y - 24;
      for (const mark of geometry.marks) {
        if (mark.type === 'rect') page.drawRectangle({ x: margin + mark.x, y: top - mark.y - mark.height, width: mark.width, height: mark.height, color: color(mark.color) });
        else if (mark.type === 'circle') page.drawCircle({ x: margin + mark.x, y: top - mark.y, size: mark.radius, color: color(mark.color) });
        else if (mark.type === 'line') page.drawLine({ start: { x: margin + mark.x1, y: top - mark.y1 }, end: { x: margin + mark.x2, y: top - mark.y2 }, thickness: 1.5, color: color(mark.color) });
        else page.drawSvgPath(`M ${mark.points.map(([x, yy]) => `${x} ${yy}`).join(' L ')} Z`, { x: margin, y: top, color: color(mark.color) });
      }
      for (const label of geometry.labels) { checkText(label.text); const labelWidth = font.widthOfTextAtSize(label.text, 8); page.drawText(label.text, { x: margin + label.x - (label.center ? labelWidth / 2 : 0), y: top - label.y, size: 8, font, color: color(label.color) }); }
      y -= h + 38;
    }
  }
  const bytesOut = await pdf.save(); if (guard() !== true) fail('stale_target', 'The original document changed while serializing its PDF.');
  return { content: encodePreviewData(bytesOut, 'application/pdf'), mime: 'application/pdf', extension: 'pdf', pages: count, fontSubstitution: 'PDF uses bundled Liberation Sans with synthetic bold/italic.' };
}

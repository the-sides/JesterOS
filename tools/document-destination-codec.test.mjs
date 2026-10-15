import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { preparePrintDocument, selectPrintPages, renderPrintPage, destroyPrintResource, validateDestinationDocument } from '../frontend/src/document-destination-codec.js';
import { decodePreviewData, encodePreviewData } from '../frontend/src/preview-codec.js';
import { PRINTING_LIMITS } from '../frontend/src/printing-state.js';

// Public codec seams only: independent real PDF parsing and actual Skia pixels.
// The injected font loader reads the same bundled face as the browser, never a substitute.
const requireFrontend = createRequire(new URL('../frontend/package.json', import.meta.url));
const { PDFDocument, StandardFonts, degrees, PDFName } = requireFrontend('pdf-lib');
const requirePdfjs = createRequire(requireFrontend.resolve('pdfjs-dist/package.json'));
const { createCanvas, loadImage } = requirePdfjs('@napi-rs/canvas');
const fontLoader = async () => new Uint8Array(await Bun.file(new URL('../frontend/public/fonts/LiberationSans-Regular.ttf', import.meta.url)).arrayBuffer());
const options = { fontLoader };
const source = (content, extra = {}) => ({ content, mime: 'text/plain', title: 'Print specimen', timestamp: 1696118400000, ...extra });
async function withDocument(spec, visit, opts = options) {
  const prepared = await preparePrintDocument(spec, opts);
  try { return await visit(prepared); }
  finally { await destroyPrintResource(prepared.resource); }
}
async function pageText(resource, number) {
  const page = await resource.document.getPage(number);
  try { return (await page.getTextContent()).items.filter(item => item.str).map(item => item.str); }
  finally { page.cleanup(); }
}
async function sourcePdf(count = 3) {
  const pdf = await PDFDocument.create({ updateMetadata: false }), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setTitle('Independent PDF'); pdf.setCreationDate(new Date(1696118400000));
  for (let i = 0; i < count; i++) {
    const page = pdf.addPage([300 + i * 10, 240]);
    page.drawText(`Original page ${i + 1}`, { font, x: 20, y: 190, size: 14 });
    if (i === 1) page.setRotation(degrees(90));
  }
  return encodePreviewData(await pdf.save({ useObjectStreams: false }), 'application/pdf');
}

test('literal Unicode text becomes a deterministic genuine PDF with embedded Liberation Sans, not Helvetica', async () => {
  const spec = source('Café — Zoë\nLiteral <b>markup</b> and https://example.invalid');
  let first;
  await withDocument(spec, async result => {
    first = result.content;
    expect(result).toMatchObject({ mime: 'application/pdf', pageCount: 1, pages: [{ width: 595.28, height: 841.89 }] });
    expect((await pageText(result.resource, 1)).join('\n')).toContain('Café — Zoë');
    expect((await pageText(result.resource, 1)).join('\n')).toContain('Literal <b>markup</b>');
    const parsed = await PDFDocument.load(decodePreviewData(result.content).bytes, { updateMetadata: false });
    expect(parsed.getTitle()).toBe('Print specimen');
    expect(parsed.getCreationDate().getTime()).toBe(1696118400000);
    const fonts = parsed.getPage(0).node.Resources().lookup(PDFName.of('Font'));
    const font = fonts.lookup(fonts.keys()[0]);
    expect(font.lookup(PDFName.of('BaseFont')).toString()).toContain('LiberationSans');
    const descendant = font.lookup(PDFName.of('DescendantFonts')).lookup(0);
    const descriptor = descendant.lookup(PDFName.of('FontDescriptor'));
    expect(descriptor.has(PDFName.of('FontFile2'))).toBe(true);
  });
  await withDocument(spec, async result => expect(result.content).toBe(first));
});

test('pagination uses actual line metrics and preserves every line across three pages', async () => {
  const lines = Array.from({ length: 100 }, (_, i) => `Line ${String(i + 1).padStart(3, '0')}`);
  await withDocument(source(lines.join('\n')), async result => {
    expect(result.pageCount).toBe(3);
    const first = await pageText(result.resource, 1), second = await pageText(result.resource, 2), third = await pageText(result.resource, 3);
    expect(first).toHaveLength(49); expect(second).toHaveLength(49); expect(third).toHaveLength(2);
    expect(first[0]).toBe('Line 001'); expect(first.at(-1)).toBe('Line 049');
    expect(second[0]).toBe('Line 050'); expect(third).toEqual(['Line 099', 'Line 100']);
    expect([...first, ...second, ...third]).toEqual(lines);
  });
});

test('wide unbroken words wrap by embedded-font width without truncation or overflow', async () => {
  const text = 'W'.repeat(200);
  await withDocument(source(text), async result => {
    const page = await result.resource.document.getPage(1);
    try {
      const items = (await page.getTextContent()).items.filter(item => item.str);
      expect(items.length).toBeGreaterThan(1);
      expect(items.map(item => item.str).join('')).toBe(text);
      for (const item of items) {
        expect(item.transform[4]).toBeCloseTo(48, 4);
        expect(item.width).toBeLessThanOrEqual(499.28 + 0.01);
      }
    } finally { page.cleanup(); }
  });
});

test('CRLF, literal tabs and explicit form-feed page boundaries have disclosed text behavior', async () => {
  await withDocument(source('First\r\nSecond\tvalue\fThird'), async result => {
    expect(result.pageCount).toBe(2);
    expect((await pageText(result.resource, 1)).join(' ')).toContain('First');
    expect((await pageText(result.resource, 1)).join(' ')).toContain('Second');
    expect(await pageText(result.resource, 2)).toEqual(['Third']);
  });
});

test('source primitives are captured before asynchronous font loading', async () => {
  const spec = source('Captured original');
  await withDocument(spec, async result => {
    expect((await pageText(result.resource, 1)).join(' ')).toBe('Captured original');
    expect((await PDFDocument.load(decodePreviewData(result.content).bytes)).getTitle()).toBe('Print specimen');
  }, { fontLoader: async () => { spec.content = 'Late replacement'; spec.title = 'Late title'; return fontLoader(); } });
});

test('selected PDF pages are a genuine immutable inclusive snapshot with original rotation and metadata', async () => {
  const content = await sourcePdf(), original = content;
  const selected = await selectPrintPages(content, 2, 3);
  expect(content).toBe(original);
  expect(selected).toMatchObject({ mime: 'application/pdf', pageCount: 2 });
  expect(selected.content).toBe(`data:application/pdf;base64,${selected.base64}`);
  expect(selected.base64.length).toBeLessThanOrEqual(PRINTING_LIMITS.pdf);
  const parsed = await PDFDocument.load(decodePreviewData(selected.content).bytes, { updateMetadata: false });
  expect(parsed.getPageCount()).toBe(2); expect(parsed.getPage(0).getRotation().angle).toBe(90);
  expect(parsed.getTitle()).toBe('Independent PDF'); expect(parsed.getCreationDate().getTime()).toBe(1696118400000);
  await withDocument({ content: selected.content, mime: 'application/pdf' }, async result => {
    expect(result.pages).toEqual([{ width: 240, height: 310 }, { width: 320, height: 240 }]);
    expect(await pageText(result.resource, 1)).toEqual(['Original page 2']);
    expect(await pageText(result.resource, 2)).toEqual(['Original page 3']);
  });
});

test('share validation preserves the original genuine PDF and literal text MIME/content unchanged', async () => {
  const content = await sourcePdf();
  expect(await validateDestinationDocument({ content, mime: 'application/pdf' }))
    .toEqual({ content, mime: 'application/pdf' });
  const text = '# Literal Café <b>markup</b>';
  expect(await validateDestinationDocument({ text, mime: 'text/markdown' }))
    .toEqual({ content: text, mime: 'text/markdown' });
  const corrupt = encodePreviewData(new TextEncoder().encode('%PDF-1.7\nnot objects\n%%EOF'), 'application/pdf');
  await expect(validateDestinationDocument({ content: corrupt, mime: 'application/pdf' }))
    .rejects.toMatchObject({ code: 'unsupported_content' });
  await expect(validateDestinationDocument({ text: 'a'.repeat(PRINTING_LIMITS.pdf + 1), mime: 'text/plain' }))
    .rejects.toMatchObject({ code: 'limit_exceeded' });
  await expect(validateDestinationDocument({ content, mime: 'application/pdf' }, { guard: () => false }))
    .rejects.toMatchObject({ code: 'stale_target' });
});

test('signature-only PDFs, MIME relabeling and external paths never become print documents', async () => {
  const corrupt = encodePreviewData(new TextEncoder().encode('%PDF-1.7\nnot objects\n%%EOF'), 'application/pdf');
  await expect(preparePrintDocument({ content: corrupt, mime: 'application/pdf' })).rejects.toMatchObject({ code: 'unsupported_content' });
  await expect(selectPrintPages(corrupt, 1, 1)).rejects.toMatchObject({ code: 'unsupported_content' });
  for (const content of ['https://example.invalid/document.pdf', '/host/file.pdf'])
    await expect(preparePrintDocument({ content, mime: 'application/pdf' })).rejects.toMatchObject({ code: 'unsupported_content' });
  await expect(preparePrintDocument(source('binary', { mime: 'application/octet-stream' }))).rejects.toMatchObject({ code: 'unsupported_content' });
});

test('actual page bounds and encoded archive limits reject rather than narrowing output', async () => {
  const content = await sourcePdf();
  for (const [from, to] of [[0, 1], [2, 1], [1, 4], [1.5, 2], [1, 1025]])
    await expect(selectPrintPages(content, from, to)).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(preparePrintDocument({ content: `data:application/pdf;base64,${'A'.repeat(PRINTING_LIMITS.pdf + 4)}`, mime: 'application/pdf' }))
    .rejects.toMatchObject({ code: 'limit_exceeded' });
  const tooManyPages = await sourcePdf(1025);
  await expect(preparePrintDocument({ content: tooManyPages, mime: 'application/pdf' })).rejects.toMatchObject({ code: 'limit_exceeded' });
  await expect(preparePrintDocument(source('\f'.repeat(1024)), options)).rejects.toMatchObject({ code: 'limit_exceeded' });
});

test('missing real fonts, unsupported glyphs and unsupported bidirectional layout reject honestly', async () => {
  await expect(preparePrintDocument(source('Valid text'), { fontLoader: async () => new Uint8Array() })).rejects.toMatchObject({ code: 'unavailable' });
  for (const text of ['Unsupported 😀', 'Lone surrogate \ud800', 'Control \u0001'])
    await expect(preparePrintDocument(source(text), options)).rejects.toMatchObject({ code: 'unsupported_glyph' });
  await expect(preparePrintDocument(source('עברית'), options)).rejects.toMatchObject({ code: 'unsupported_content' });
});

test('expired font ownership cannot return a document; invalid guards cannot authorize work', async () => {
  let alive = true;
  await expect(preparePrintDocument(source('Owned original'), { guard: () => alive, fontLoader: async () => {
    const bytes = await fontLoader(); alive = false; return bytes;
  } })).rejects.toMatchObject({ code: 'stale_target' });
  await expect(preparePrintDocument(source('Text'), { ...options, guard: null })).rejects.toMatchObject({ code: 'invalid_arguments' });
  await expect(selectPrintPages(await sourcePdf(), 1, 1, { guard: () => false })).rejects.toMatchObject({ code: 'stale_target' });
});

describe('genuine local PDF.js raster and actual image decoding', () => {
  let previousBitmap, previousCanvas;
  beforeAll(() => {
    previousBitmap = globalThis.createImageBitmap; previousCanvas = globalThis.OffscreenCanvas;
    globalThis.createImageBitmap = async blob => loadImage(new Uint8Array(await blob.arrayBuffer()));
    globalThis.OffscreenCanvas = class {
      constructor(width, height) {
        const canvas = createCanvas(width, height);
        canvas.convertToBlob = async ({ type }) => new Blob([canvas.toBuffer(type)], { type });
        return canvas;
      }
    };
  });
  afterAll(() => { globalThis.createImageBitmap = previousBitmap; globalThis.OffscreenCanvas = previousCanvas; });
  function raster(mime) {
    const canvas = createCanvas(30, 20), context = canvas.getContext('2d');
    context.fillStyle = '#ff0000'; context.fillRect(0, 0, 15, 20);
    context.fillStyle = '#0000ff'; context.fillRect(15, 0, 15, 20);
    return encodePreviewData(new Uint8Array(canvas.toBuffer(mime)), mime);
  }
  test('PDF.js paints real text pixels and reports actual raster dimensions, not a placeholder proof', async () => {
    await withDocument(source('Real painted glyphs'), async result => {
      const canvas = createCanvas(1, 1), proof = await renderPrintPage(result.resource, canvas, 1);
      expect(proof).toEqual({ page: 1, width: 596, height: 842, pdf: true, painted: true });
      const data = canvas.getContext('2d').getImageData(48, 48, 180, 18).data;
      expect([...data].filter((value, index) => index % 4 !== 3 && value < 128).length).toBeGreaterThan(50);
      expect(canvas.getContext('2d').getImageData(0, 0, 1, 1).data).toEqual(new Uint8ClampedArray([255, 255, 255, 255]));
      const doubled = await renderPrintPage(result.resource, canvas, 1, { scale: 2 });
      expect(doubled).toMatchObject({ width: 1191, height: 1684 });
    });
  });
  test('PNG, JPEG and WebP become actual embedded image PDFs with original two-color pixels', async () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      await withDocument({ content: raster(mime), mime }, async result => {
        expect(result.pageCount).toBe(1);
        const canvas = createCanvas(1, 1);
        await renderPrintPage(result.resource, canvas, 1);
        const context = canvas.getContext('2d');
        const red = context.getImageData(170, 420, 1, 1).data, blue = context.getImageData(420, 420, 1, 1).data;
        expect(red[0]).toBeGreaterThan(200); expect(red[2]).toBeLessThan(40);
        expect(blue[2]).toBeGreaterThan(200); expect(blue[0]).toBeLessThan(40);
      });
    }
  });
  test('share validation confirms genuine raster decoding without converting or relabeling original bytes', async () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      const content = raster(mime);
      expect(await validateDestinationDocument({ content, mime })).toEqual({ content, mime });
    }
    const content = raster('image/png'), bytes = decodePreviewData(content).bytes;
    const corrupt = encodePreviewData(bytes.slice(0, 33), 'image/png');
    await expect(validateDestinationDocument({ content: corrupt, mime: 'image/png' }))
      .rejects.toMatchObject({ code: 'unsupported_content' });
    await expect(validateDestinationDocument({ content, mime: 'image/jpeg' }))
      .rejects.toMatchObject({ code: 'unsupported_content' });
  });
  test('a valid PNG header with corrupt actual compressed pixels cannot be embedded', async () => {
    const content = raster('image/png'), bytes = decodePreviewData(content).bytes;
    const truncated = encodePreviewData(bytes.slice(0, 33), 'image/png');
    await expect(preparePrintDocument({ content: truncated, mime: 'image/png' })).rejects.toMatchObject({ code: 'unsupported_content' });
  });
  test('ownership expiry during genuine image decoding returns no PDF output', async () => {
    let alive = true; const decode = globalThis.createImageBitmap;
    globalThis.createImageBitmap = async blob => { const image = await decode(blob); alive = false; return image; };
    try {
      await expect(preparePrintDocument({ content: raster('image/png'), mime: 'image/png' }, { guard: () => alive }))
        .rejects.toMatchObject({ code: 'stale_target' });
    } finally { globalThis.createImageBitmap = decode; }
  });
  test('expired ownership does not resize or paint the original canvas and cleanup is idempotent', async () => {
    const result = await preparePrintDocument(source('Original'), options), canvas = createCanvas(3, 2);
    const context = canvas.getContext('2d'); context.fillStyle = '#00ff00'; context.fillRect(0, 0, 3, 2);
    const before = canvas.toBuffer('image/png');
    try {
      await expect(renderPrintPage(result.resource, canvas, 1, { guard: () => false })).rejects.toMatchObject({ code: 'stale_target' });
      expect([canvas.width, canvas.height]).toEqual([3, 2]); expect(canvas.toBuffer('image/png')).toEqual(before);
      await destroyPrintResource(result.resource); await destroyPrintResource(result.resource);
      await expect(renderPrintPage(result.resource, canvas, 1)).rejects.toMatchObject({ code: 'unavailable' });
    } finally { await destroyPrintResource(result.resource); }
  });
  test('stale raster ownership preserves the shared PDF resource for the next page and original canvas', async () => {
    const result = await preparePrintDocument(source('First page\fSecond page'), options), canvas = createCanvas(3, 2);
    const context = canvas.getContext('2d'); context.fillStyle = '#00ff00'; context.fillRect(0, 0, 3, 2);
    const before = canvas.toBuffer('image/png'); let alive = true;
    try {
      // Start the actual PDF.js getPage promise; retire ownership while it is pending.
      const pending = renderPrintPage(result.resource, canvas, 1, { guard: () => alive });
      const nextCanvas = createCanvas(1, 1);
      const nextRender = renderPrintPage(result.resource, nextCanvas, 2);
      alive = false;
      await expect(pending).rejects.toMatchObject({ code: 'stale_target' });
      expect([canvas.width, canvas.height]).toEqual([3, 2]);
      expect(canvas.toBuffer('image/png')).toEqual(before);
      expect(await nextRender)
        .toEqual({ page: 2, width: 596, height: 842, pdf: true, painted: true });
      expect(await pageText(result.resource, 2)).toEqual(['Second page']);
      const pixels = nextCanvas.getContext('2d').getImageData(48, 48, 100, 18).data;
      expect([...pixels].filter((value, index) => index % 4 !== 3 && value < 128).length).toBeGreaterThan(50);
    } finally { await destroyPrintResource(result.resource); }
  });
  test('invalid pages and excessive scale/raster sizes are rejected without a fabricated proof', async () => {
    await withDocument(source('Original'), async result => {
      const canvas = createCanvas(1, 1);
      for (const [page, scale] of [[0, 1], [2, 1], [1, 0], [1, 5]])
        await expect(renderPrintPage(result.resource, canvas, page, { scale })).rejects.toMatchObject({ code: 'invalid_arguments' });
      await expect(renderPrintPage(result.resource, canvas, 1, { scale: 4 })).rejects.toMatchObject({ code: 'limit_exceeded' });
    });
  });
});

import { decodePreviewData, encodePreviewData, openPreviewPdf, inspectPreviewImage, editPreviewImage, exportPreviewPdf, PREVIEW_CODEC_LIMITS } from './preview-codec.js';
import { PRINTING_LIMITS } from './printing-state.js';

const PDF_MIME = 'application/pdf', ALWAYS = () => true;
const WIDTH = 595.28, HEIGHT = 841.89, MARGIN = 48, SIZE = 12, LEADING = 15;
const resources = new WeakMap();
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const localErrorCodes = new Set(['invalid_arguments', 'stale_target', 'limit_exceeded', 'unavailable',
  'unsupported_content', 'unsupported_glyph', 'encrypted_document', 'password_required', 'invalid_password']);
const current = guard => {
  if (typeof guard !== 'function') fail('invalid_arguments', 'Expected a print destination ownership guard.');
  if (!guard()) fail('stale_target', 'The original print destination is no longer current.');
};
async function owned(operation, guard) {
  current(guard);
  try { const value = await operation(); current(guard); return value; }
  catch (error) { current(guard); throw error; }
}
function engineError(error) {
  if (localErrorCodes.has(error?.code)) throw error;
  if (error?.name === 'EncryptedPDFError') fail('encrypted_document', 'Encrypted PDFs cannot be exported by this local print engine.');
  fail('unsupported_content', error?.message || 'The local document could not be decoded or printed.');
}
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
let pdfLibrary, fontLibrary;
const loadPdf = () => pdfLibrary ??= import('pdf-lib').catch(error => { pdfLibrary = undefined; throw error; });
const loadFont = () => fontLibrary ??= import('@pdf-lib/fontkit').catch(error => { fontLibrary = undefined; throw error; });
async function bundledFont(guard) {
  const response = await owned(() => fetch('/fonts/LiberationSans-Regular.ttf'), guard);
  if (!response.ok) fail('unavailable', 'The bundled Liberation Sans font is unavailable.');
  return new Uint8Array(await owned(() => response.arrayBuffer(), guard));
}
function boundedPdf(content) {
  // PRINTING_LIMITS.pdf bounds the encoded base64, not decoded bytes or the URI prefix.
  if (typeof content !== 'string') fail('invalid_arguments', 'Expected canonical local PDF content.');
  const comma = content.indexOf(',');
  if (comma >= 0 && content.length - comma - 1 > PRINTING_LIMITS.pdf)
    fail('limit_exceeded', 'The encoded print PDF exceeds 1 MiB.');
  const decoded = decodePreviewData(content);
  if (decoded.mime !== PDF_MIME) fail('unsupported_content', 'Expected an actual local PDF.');
  return encodePreviewData(decoded.bytes, PDF_MIME);
}
function retainResource(resource) {
  const destroy = resource.destroy, state = { retired: false, tasks: new Set(), destruction: null };
  resources.set(resource, state);
  resource.destroy = () => {
    if (state.retired) return state.destruction ?? Promise.resolve();
    state.retired = true;
    for (const task of state.tasks) task.cancel();
    state.tasks.clear();
    state.destruction = Promise.resolve().then(() => destroy());
    return state.destruction;
  };
  return resource;
}
/** Opaque resources never belong in canonical/session state. Retirement is idempotent. */
export async function destroyPrintResource(resource) {
  if (resource) await resource.destroy();
}
async function retire(resource) {
  try { await destroyPrintResource(resource); } catch { /* Preserve the original document/ownership failure. */ }
}
async function openPrint(content, guard) {
  let resource;
  try {
    await owned(async () => {
      // Capture newly allocated decoder for cleanup even if ownership expires at this await.
      resource = await openPreviewPdf(content, { guard });
      current(guard);
      retainResource(resource);
    }, guard);
    const pages = [];
    for (let number = 1; number <= resource.document.numPages; number++) {
      const page = await owned(() => resource.document.getPage(number), guard);
      try {
        // Decode real page operators too: a valid signature/page tree alone is not print proof.
        await owned(() => page.getOperatorList(), guard);
        const viewport = page.getViewport({ scale: 1 });
        if (!(Number.isFinite(viewport.width) && viewport.width > 0 && Number.isFinite(viewport.height) && viewport.height > 0))
          fail('unsupported_content', 'The PDF has an invalid actual page size.');
        pages.push({ width: viewport.width, height: viewport.height });
      } finally { page.cleanup(); }
    }
    current(guard);
    return { content, mime: PDF_MIME, pageCount: pages.length, pages, resource };
  } catch (error) { await retire(resource); current(guard); engineError(error); }
}
function metadata(pdf, title, timestamp) {
  pdf.setTitle(title); pdf.setCreator('JesterOS local document destination');
  pdf.setProducer('JesterOS local print / pdf-lib; no hardware or host IO');
  const date = new Date(timestamp); pdf.setCreationDate(date); pdf.setModificationDate(date);
}
async function serialize(pdf, guard) {
  const bytes = await owned(() => pdf.save({ useObjectStreams: false, updateFieldAppearances: false }), guard);
  return boundedPdf(encodePreviewData(bytes, PDF_MIME));
}
async function textPdf(text, title, timestamp, guard, fontLoader) {
  const lib = await owned(loadPdf, guard), module = await owned(loadFont, guard), kit = module.default ?? module;
  const loaded = await owned(() => fontLoader ? fontLoader() : bundledFont(guard), guard);
  if (!(loaded instanceof Uint8Array) || !loaded.length) fail('unavailable', 'The bundled Liberation Sans font bytes are unavailable.');
  const bytes = loaded.slice(), face = kit.create(bytes);
  // Literal plain text, CRLF normalized, tabs explicitly expanded to four spaces.
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  for (const character of normalized) {
    if (character === '\n' || character === '\f') continue;
    const point = character.codePointAt(0);
    if (point < 32 || (point >= 127 && point <= 159) || (point >= 0xd800 && point <= 0xdfff) || !face.hasGlyphForCodePoint(point))
      fail('unsupported_glyph', 'Liberation Sans cannot faithfully render every authored character.');
    if (/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/u.test(character))
      fail('unsupported_content', 'Bidirectional text layout is not supported; authored text is never silently reordered.');
  }
  const pdf = await owned(() => lib.PDFDocument.create({ updateMetadata: false }), guard);
  pdf.registerFontkit(kit);
  const font = await owned(() => pdf.embedFont(bytes, { subset: true }), guard);
  metadata(pdf, title, timestamp);
  const body = WIDTH - 2 * MARGIN, linesPerPage = Math.floor((HEIGHT - 2 * MARGIN) / LEADING);
  let page, lineNumber = 0;
  const newPage = () => {
    if (pdf.getPageCount() >= PRINTING_LIMITS.pages) fail('limit_exceeded', 'The print document exceeds 1024 pages.');
    page = pdf.addPage([WIDTH, HEIGHT]); lineNumber = 0;
  };
  const line = value => {
    if (lineNumber === linesPerPage) newPage();
    if (value) page.drawText(value, { x: MARGIN, y: HEIGHT - MARGIN - SIZE - lineNumber * LEADING, size: SIZE, font });
    lineNumber++;
  };
  const width = value => font.widthOfTextAtSize(value, SIZE);
  newPage();
  for (const [sectionIndex, section] of normalized.split('\f').entries()) {
    if (sectionIndex) newPage();
    for (const paragraph of section.split('\n')) {
      let pending = '';
      for (const token of paragraph.match(/[^\s]+|[^\S\n]+/gu) ?? []) {
        // Measure the entire drawn line, including kerning across token boundaries.
        if (width(pending + token) <= body) { pending += token; continue; }
        if (pending) { line(pending); pending = ''; }
        if (width(token) <= body) { pending = token; continue; }
        for (const character of token) {
          if (width(pending + character) > body) {
            if (!pending) fail('unsupported_content', 'An authored glyph is wider than the print text area.');
            line(pending); pending = '';
          }
          if (width(character) > body) fail('unsupported_content', 'An authored glyph is wider than the print text area.');
          pending += character;
        }
      }
      line(pending);
    }
  }
  current(guard);
  return serialize(pdf, guard);
}
async function imagePdf(content, mime, title, timestamp, guard) {
  await owned(() => inspectPreviewImage(content, guard), guard);
  // WebP is genuinely decoded/re-encoded by Preview's real canvas engine, never relabeled.
  if (mime === 'image/webp') {
    const converted = await owned(() => editPreviewImage(content, { mime: 'image/png' }, guard), guard);
    content = converted.text; mime = converted.mime;
  }
  const lib = await owned(loadPdf, guard), pdf = await owned(() => lib.PDFDocument.create({ updateMetadata: false }), guard);
  const bytes = decodePreviewData(content).bytes;
  const image = await owned(() => mime === 'image/png' ? pdf.embedPng(bytes) : pdf.embedJpg(bytes), guard);
  metadata(pdf, title, timestamp);
  const page = pdf.addPage([WIDTH, HEIGHT]);
  const scale = Math.min((WIDTH - 2 * MARGIN) / image.width, (HEIGHT - 2 * MARGIN) / image.height);
  const width = image.width * scale, height = image.height * scale;
  page.drawImage(image, { x: (WIDTH - width) / 2, y: (HEIGHT - height) / 2, width, height });
  return serialize(pdf, guard);
}
/** Confirm genuine local attachments without converting or relabeling their source bytes. */
export async function validateDestinationDocument(spec, { guard = ALWAYS } = {}) {
  current(guard);
  if (!spec || typeof spec !== 'object') fail('invalid_arguments', 'Expected an actual local destination document.');
  const content = spec.content ?? spec.text, mime = spec.mime ?? 'text/plain';
  if (typeof content !== 'string' || typeof mime !== 'string')
    fail('invalid_arguments', 'Expected literal document content and MIME.');
  let decoded;
  try {
    if (mime === PDF_MIME) {
      decoded = await openPrint(boundedPdf(content), guard);
      await retire(decoded.resource); decoded = null;
    } else if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime)) {
      if (decodePreviewData(content).mime !== mime)
        fail('unsupported_content', 'The encoded raster MIME does not match its source record.');
      await owned(() => inspectPreviewImage(content, guard), guard);
    } else if (mime.startsWith('text/')) {
      if (content.length > PRINTING_LIMITS.pdf) fail('limit_exceeded', 'The literal destination text exceeds 1 MiB.');
    } else fail('unsupported_content', 'Local document destinations support literal text, genuine PDF and raster images.');
    current(guard);
    return { mime, content };
  } catch (error) { await retire(decoded?.resource); current(guard); engineError(error); }
}

/** Snapshot primitive source fields before any await. Text is literal, not interpreted markup.
 * Page numbering is one-based; missing authored timestamp means the deterministic epoch. */
export async function preparePrintDocument(spec, { guard = ALWAYS, fontLoader } = {}) {
  current(guard);
  if (!spec || typeof spec !== 'object' || (fontLoader !== undefined && typeof fontLoader !== 'function'))
    fail('invalid_arguments', 'Expected a local source document and optional bundled font loader.');
  const content = spec.content ?? spec.text, mime = spec.mime ?? 'text/plain';
  const title = spec.title ?? spec.name ?? '', timestamp = spec.timestamp ?? 0;
  if (typeof content !== 'string' || typeof mime !== 'string' || typeof title !== 'string' || title.length > PRINTING_LIMITS.pdf
    || !integer(timestamp, 0, 8640000000000000)) fail('invalid_arguments', 'Expected bounded content, MIME, title and authored timestamp.');
  try {
    let pdfContent;
    if (mime === PDF_MIME) pdfContent = boundedPdf(content);
    else if (['image/png', 'image/jpeg', 'image/webp'].includes(mime)) {
      if (decodePreviewData(content).mime !== mime) fail('unsupported_content', 'The encoded image MIME does not match its source record.');
      pdfContent = await owned(() => imagePdf(content, mime, title, timestamp, guard), guard);
    } else if (mime.startsWith('text/')) {
      if (content.length > PRINTING_LIMITS.pdf) fail('limit_exceeded', 'The authored print text exceeds 1 MiB.');
      pdfContent = await owned(() => textPdf(content, title, timestamp, guard, fontLoader), guard);
    } else fail('unsupported_content', 'Local print supports literal text, genuine PDF, PNG, JPEG and WebP.');
    return await openPrint(pdfContent, guard);
  } catch (error) { current(guard); engineError(error); }
}
/** Immutable inclusive selected-page snapshot. Actual PDF forms/annotations are preserved
 * by Preview's serializer, not reduced to a fake byte envelope or raster-only PDF. */
export async function selectPrintPages(content, from, to, { guard = ALWAYS } = {}) {
  current(guard);
  if (!integer(from, 1, PRINTING_LIMITS.pages) || !integer(to, from, PRINTING_LIMITS.pages))
    fail('invalid_arguments', 'Expected a one-based inclusive print page range.');
  let source, selected;
  try {
    source = await openPrint(boundedPdf(content), guard);
    if (to > source.pageCount) fail('invalid_arguments', 'The selected range exceeds the actual source pages.');
    const result = await owned(() => exportPreviewPdf({ content: source.content,
      pageOrder: Array.from({ length: to - from + 1 }, (_, index) => from - 1 + index),
      rotations: {}, marks: [], formValues: {}, lock: { enabled: false, password: '' } }, { guard }), guard);
    selected = await openPrint(boundedPdf(result.text), guard);
    const output = { content: selected.content, base64: selected.content.slice(selected.content.indexOf(',') + 1), mime: PDF_MIME, pageCount: selected.pageCount };
    await retire(selected); selected = null;
    await retire(source); source = null;
    current(guard);
    return output;
  } catch (error) { await retire(selected); await retire(source); current(guard); engineError(error); }
}
function rasterCanvas(width, height, destination) {
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height)
    : (destination?.ownerDocument ?? globalThis.document)?.createElement('canvas');
  if (!canvas) fail('unavailable', 'A real local canvas raster engine is required.');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) fail('unavailable', 'The real local canvas raster engine is unavailable.');
  return { canvas, context };
}
/** PDF.js paints an isolated actual canvas first. The original DOM canvas is only
 * changed after rendering and ownership validation, never from an expired await. */
export async function renderPrintPage(resource, canvas, page, { guard = ALWAYS, scale = 1 } = {}) {
  current(guard);
  const state = resources.get(resource);
  if (!state || state.retired) fail('unavailable', 'The original print PDF resource is retired or unavailable.');
  if (!canvas || typeof canvas.getContext !== 'function' || !integer(page, 1, resource.document.numPages)
    || typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0 || scale > 4)
    fail('invalid_arguments', 'Expected an actual destination canvas, page and raster scale greater than zero and at most four.');
  const ownedGuard = () => guard() && !state.retired;
  let pdfPage, task;
  try {
    pdfPage = await owned(() => resource.document.getPage(page), ownedGuard);
    const viewport = pdfPage.getViewport({ scale }), width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
    if (!integer(width, 1, PREVIEW_CODEC_LIMITS.imageDimension) || !integer(height, 1, PREVIEW_CODEC_LIMITS.imageDimension)
      || width * height > PREVIEW_CODEC_LIMITS.imagePixels) fail('limit_exceeded', 'The print preview raster exceeds the real canvas pixel budget.');
    const temporary = rasterCanvas(width, height, canvas);
    current(ownedGuard);
    task = pdfPage.render({ canvasContext: temporary.context, viewport, background: 'rgb(255,255,255)' });
    state.tasks.add(task);
    await owned(() => task.promise, ownedGuard);
    const context = canvas.getContext('2d');
    if (!context) fail('unavailable', 'The original destination canvas has no raster context.');
    current(ownedGuard);
    canvas.width = width; canvas.height = height;
    context.drawImage(temporary.canvas, 0, 0);
    return { page, width, height, pdf: true, painted: true };
  } catch (error) {
    // Raster ownership is narrower than PDF ownership: changing a page/canvas may
    // retire this task, but must not destroy a decoder shared by the next render.
    const stale = !guard() || state.retired || error?.code === 'stale_target';
    if (task) {
      task.cancel(); state.tasks.delete(task);
      try { await task.promise; } catch { /* Drain this task without retiring the parent resource. */ }
    }
    if (stale || !guard() || state.retired)
      fail('stale_target', 'The original print preview raster is no longer current.');
    engineError(error);
  } finally { if (task) state.tasks.delete(task); pdfPage?.cleanup(); }
}

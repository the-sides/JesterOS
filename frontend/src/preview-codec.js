import { copyCanonicalData } from './canonical-data.js';

// Real local document bytes only. The fictional workspace lock is not PDF encryption.
export const PREVIEW_CODEC_LIMITS = Object.freeze({ base64: 3 * 1024 * 1024, pages: 1024,
  imagePixels: 4 * 1024 * 1024, imageDimension: 8192, marks: 4096, text: 1024 * 1024 });
export const PREVIEW_CODEC_CAPABILITIES = Object.freeze({ pdf: true, encryptionExport: false,
  encryptedEditing: false, imageInput: Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  imageOutput: Object.freeze(['image/png', 'image/jpeg', 'image/webp']), imageAnimation: false,
  signature: 'fictional-visual-mark-not-digital-signature', lock: 'workspace-access-gate-not-encryption' });
const PDF_MIME = 'application/pdf', ALWAYS = () => true;
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const current = guard => { if (typeof guard !== 'function') fail('invalid_arguments', 'Expected an ownership guard.');
  if (!guard()) fail('stale_target', 'The original Preview document is no longer current.'); };
async function owned(operation, guard) {
  current(guard);
  try { const value = await operation(); current(guard); return value; }
  catch (error) { current(guard); throw error; }
}
function engineError(error, fallback = 'unsupported_content') {
  if (typeof error?.code === 'string') throw error;
  if (error?.name === 'EncryptedPDFError' || /encrypted/i.test(error?.message ?? ''))
    fail('encrypted_document', 'Encrypted PDFs can be viewed with a password, but cannot be edited or exported by this local engine.');
  if (error?.name === 'PasswordException') fail(error.code === 2 ? 'invalid_password' : 'password_required', 'The PDF requires its actual document password.');
  fail(fallback, error?.message || 'The local document could not be processed.');
}
const integer = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const supportedMime = mime => mime === PDF_MIME || PREVIEW_CODEC_CAPABILITIES.imageInput.includes(mime);
function signatureMatches(bytes, mime) {
  const ascii = (from, count) => String.fromCharCode(...bytes.subarray(from, from + count));
  if (mime === PDF_MIME) return ascii(0, 5) === '%PDF-';
  if (mime === 'image/png') return bytes.length >= 24 && bytes[0] === 137 && ascii(1, 7) === 'PNG\r\n\x1a\n' && ascii(12, 4) === 'IHDR';
  if (mime === 'image/jpeg') return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  return mime === 'image/webp' && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
}
/** Strict, canonical base64 data URI, never a network/host-filesystem path. */
export function decodePreviewData(text) {
  if (typeof text !== 'string') fail('invalid_arguments', 'Expected a local encoded document.');
  const comma = text.indexOf(',');
  if (comma < 0 || comma > 80) fail('unsupported_content', 'Preview requires a base64 PDF or raster-image data URI.');
  const header = /^data:([^;,]+);base64$/i.exec(text.slice(0, comma)), encoded = text.slice(comma + 1);
  const mime = header?.[1].toLowerCase();
  if (!supportedMime(mime)) fail('unsupported_content', 'Supported local formats are PDF, PNG, JPEG, GIF and WebP.');
  if (encoded.length > PREVIEW_CODEC_LIMITS.base64) fail('limit_exceeded', 'The encoded document exceeds the local byte limit.');
  if (!encoded.length || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    fail('unsupported_content', 'The document contains malformed base64 bytes.');
  const binary = atob(encoded);
  // Reject noncanonical unused padding bits as well as malformed alphabet/length.
  if (btoa(binary) !== encoded) fail('unsupported_content', 'The document contains noncanonical base64 bytes.');
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (!signatureMatches(bytes, mime)) fail('unsupported_content', 'The stored bytes do not match the document format.');
  return { mime, bytes };
}
export function encodePreviewData(bytes, mime) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || !supportedMime(mime))
    fail('invalid_arguments', 'Expected genuine PDF or raster-image bytes and a supported MIME type.');
  if (4 * Math.ceil(bytes.length / 3) > PREVIEW_CODEC_LIMITS.base64) fail('limit_exceeded', 'The encoded document exceeds the local byte limit.');
  if (!signatureMatches(bytes, mime)) fail('unsupported_content', 'The output bytes do not match the requested format.');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
let serialization, renderer, fontkit;
const pdfLibrary = () => serialization ??= import('pdf-lib').catch(error => { serialization = undefined; throw error; });
const fontLibrary = () => fontkit ??= import('@pdf-lib/fontkit').catch(error => { fontkit = undefined; throw error; });
// Vite emits local decoder/font assets (including their accompanying notices).
// There are no remote document/font URLs and no host-font fidelity claims.
const browserBinaryAssets = typeof window === 'undefined' ? null : {
  standardFontDataUrl: import.meta.glob('../node_modules/pdfjs-dist/standard_fonts/*', { query: '?url', import: 'default' }),
  cMapUrl: import.meta.glob('../node_modules/pdfjs-dist/cmaps/*', { query: '?url', import: 'default' }),
  wasmUrl: import.meta.glob('../node_modules/pdfjs-dist/wasm/*', { query: '?url', import: 'default' }),
};
function binaryResources(guard) {
  if (!browserBinaryAssets) return {
    standardFontDataUrl: new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).pathname,
    cMapUrl: new URL('../node_modules/pdfjs-dist/cmaps/', import.meta.url).pathname,
    wasmUrl: new URL('../node_modules/pdfjs-dist/wasm/', import.meta.url).pathname,
  };
  return { BinaryDataFactory: class {
    async fetch({ kind, filename }) {
      current(guard);
      const assets = browserBinaryAssets[kind];
      const key = Object.keys(assets ?? {}).find(path => path.endsWith(`/${filename}`));
      if (!key) fail('unsupported_content', 'The PDF requests an unavailable local decoder resource.');
      const url = await owned(assets[key], guard), response = await owned(() => fetch(url), guard);
      if (!response.ok) fail('unavailable', 'The bundled PDF decoder resource is unavailable.');
      return new Uint8Array(await owned(() => response.arrayBuffer(), guard));
    }
  } };
}
async function pdfRenderer() {
  renderer ??= (typeof process !== 'undefined' && process.versions?.node
    ? import('pdfjs-dist/legacy/build/pdf.mjs')
    : Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
      .then(([library, worker]) => { library.GlobalWorkerOptions.workerSrc = worker.default; return library; }))
    .catch(error => { renderer = undefined; throw error; });
  return renderer;
}
export async function openPreviewPdf(text, { password, guard = ALWAYS } = {}) {
  current(guard);
  if (password !== undefined && (typeof password !== 'string' || password.length > 1024)) fail('invalid_arguments', 'Expected a bounded PDF password.');
  const decoded = decodePreviewData(text);
  if (decoded.mime !== PDF_MIME) fail('unsupported_content', 'This document is not a PDF.');
  let task;
  try {
    const library = await owned(pdfRenderer, guard);
    task = library.getDocument({ data: decoded.bytes, password, useSystemFonts: false, enableXfa: false, ...binaryResources(guard),
      disableAutoFetch: true, disableStream: true, disableRange: true, useWorkerFetch: false,
      isEvalSupported: false, stopAtErrors: true, maxImageSize: PREVIEW_CODEC_LIMITS.imagePixels,
      canvasMaxAreaInBytes: PREVIEW_CODEC_LIMITS.imagePixels * 4 });
    const document = await owned(() => task.promise, guard);
    if (!integer(document.numPages, 1) || document.numPages > PREVIEW_CODEC_LIMITS.pages)
      fail('limit_exceeded', 'PDF documents support one to 1024 actual pages.');
    let retired = false;
    return { document, destroy: () => { if (retired) return Promise.resolve(); retired = true; return task.destroy(); } };
  } catch (error) {
    // Resource retirement must proceed even when ownership has already expired.
    if (task) { try { await task.destroy(); } catch { /* Preserve the document/ownership error. */ } }
    current(guard); engineError(error);
  }
}
const formType = annotation => annotation.fieldType === 'Tx' ? 'text' : annotation.fieldType === 'Sig' ? 'signature'
  : annotation.fieldType === 'Btn' ? annotation.checkBox ? 'checkbox' : annotation.radioButton ? 'radio' : 'unknown'
    : annotation.fieldType === 'Ch' ? annotation.combo ? 'dropdown' : 'option' : 'unknown';
function inspectedForm(annotation) {
  const options = (annotation.options ?? []).map(option => typeof option === 'string' ? option : String(option.exportValue ?? option.displayValue ?? ''));
  let value = annotation.fieldValue ?? '';
  const type = formType(annotation);
  if (type === 'radio' && typeof annotation.buttonValue === 'string') options.push(annotation.buttonValue);
  if (type === 'checkbox') value = value !== '' && value !== 'Off' && value !== false;
  else if (Array.isArray(value)) value = value.join('\n');
  else if (typeof value !== 'string' && typeof value !== 'boolean') value = '';
  return { name: annotation.fieldName, type, value, options, pages: [], readOnly: Boolean(annotation.readOnly) };
}
/** page width/height and marks are unrotated crop-box points; rotation is separate. */
export async function inspectPreviewPdf(resource, guard = ALWAYS) {
  current(guard);
  const document = resource?.document;
  if (!document || !integer(document.numPages, 1) || document.numPages > PREVIEW_CODEC_LIMITS.pages)
    fail('invalid_arguments', 'Expected an open, bounded PDF document.');
  try {
    const pages = [], forms = new Map(); let textUnits = 0, annotationCount = 0;
    for (let index = 0; index < document.numPages; index++) {
      const page = await owned(() => document.getPage(index + 1), guard);
      const content = await owned(() => page.getTextContent(), guard);
      const annotations = await owned(() => page.getAnnotations({ intent: 'display' }), guard);
      const text = content.items.filter(item => typeof item.str === 'string').map(item => `${item.str}${item.hasEOL ? '\n' : ' '}`).join('').trimEnd();
      textUnits += text.length; annotationCount += annotations.length;
      if (textUnits > PREVIEW_CODEC_LIMITS.text || annotationCount > PREVIEW_CODEC_LIMITS.marks)
        fail('limit_exceeded', 'The PDF text or annotations exceed the local inspection limit.');
      const [x1, y1, x2, y2] = page.view, unit = page.userUnit || 1;
      pages.push({ width: (x2 - x1) * unit, height: (y2 - y1) * unit,
        rotation: ((page.rotate % 360) + 360) % 360, text, annotations });
      for (const annotation of annotations) if (annotation.fieldName) {
        const candidate = inspectedForm(annotation), existing = forms.get(annotation.fieldName);
        const field = existing ?? candidate;
        if (!field.pages.includes(index)) field.pages.push(index);
        for (const option of candidate.options) if (!field.options.includes(option)) field.options.push(option);
        if (!existing) forms.set(annotation.fieldName, field);
      }
    }
    const fieldObjects = await owned(() => document.getFieldObjects(), guard);
    for (const [name, fields] of Object.entries(fieldObjects ?? {})) if (fields.length) {
      const field = fields[0], type = ({ text: 'text', checkbox: 'checkbox', combobox: 'dropdown', listbox: 'option', radiobutton: 'radio', signature: 'signature' })[field.type] ?? 'unknown';
      const existing = forms.get(name);
      const options = (field.items ?? []).map(item => typeof item === 'string' ? item : String(item.exportValue ?? item.displayValue ?? ''));
      if (type === 'radio') for (const item of fields) if (typeof item.exportValues === 'string') options.push(item.exportValues);
      const pages = [...new Set(fields.map(item => item.page).filter(page => integer(page) && page < document.numPages))];
      if (existing) {
        for (const option of options) if (!existing.options.includes(option)) existing.options.push(option);
        for (const page of pages) if (!existing.pages.includes(page)) existing.pages.push(page);
        existing.pages.sort((a, b) => a - b);
      } else forms.set(name, { name, type, value: typeof field.value === 'boolean' || typeof field.value === 'string' ? field.value : '',
        options: [...new Set(options)], pages, readOnly: Boolean(field.readonly) });
    }
    const rawOutline = await owned(() => document.getOutline(), guard), outline = [];
    async function visit(items, depth) {
      if (depth > 64) fail('limit_exceeded', 'The PDF bookmark hierarchy is too deep.');
      for (const item of items ?? []) {
        if (outline.length >= PREVIEW_CODEC_LIMITS.marks) fail('limit_exceeded', 'The PDF contains too many bookmarks.');
        let destination = item.dest, page = null;
        if (typeof destination === 'string') destination = await owned(() => document.getDestination(destination), guard);
        if (Array.isArray(destination) && destination[0] !== undefined) {
          page = integer(destination[0]) ? destination[0] : await owned(() => document.getPageIndex(destination[0]), guard);
          if (!integer(page) || page >= document.numPages) page = null;
        }
        outline.push({ title: String(item.title ?? ''), page, depth });
        await owned(() => visit(item.items, depth + 1), guard);
      }
    }
    await owned(() => visit(rawOutline, 0), guard);
    const rawMetadata = await owned(() => document.getMetadata(), guard);
    const permissions = await owned(() => document.getPermissions(), guard);
    current(guard);
    return { pages, outline, metadata: { ...rawMetadata.info, metadata: rawMetadata.metadata?.getAll() ?? {},
      permissions, encrypted: permissions !== null }, forms: [...forms.values()] };
  } catch (error) { current(guard); engineError(error); }
}
async function bundledFont(guard) {
  const response = await owned(() => fetch('/fonts/LiberationSans-Regular.ttf'), guard);
  if (!response.ok) fail('unavailable', 'The bundled Liberation Sans font is unavailable.');
  return new Uint8Array(await owned(() => response.arrayBuffer(), guard));
}
async function embedDocumentFont(pdf, texts, guard, fontLoader) {
  const module = await owned(fontLibrary, guard), kit = module.default ?? module;
  const loaded = await owned(() => fontLoader ? fontLoader() : bundledFont(guard), guard);
  if (!(loaded instanceof Uint8Array) || !loaded.length) fail('unavailable', 'The bundled document font is unavailable.');
  const bytes = new Uint8Array(loaded), face = kit.create(bytes);
  for (const text of texts) for (const character of text) {
    if (character === '\n' || character === '\r') continue;
    const code = character.codePointAt(0);
    if (code < 32 || (code >= 127 && code <= 159) || (code >= 0xd800 && code <= 0xdfff) || !face.hasGlyphForCodePoint(code))
      fail('unsupported_glyph', 'Liberation Sans cannot faithfully render every requested character.');
  }
  pdf.registerFontkit(kit);
  return owned(() => pdf.embedFont(bytes, { subset: true }), guard);
}
function pdfFieldType(field, lib) {
  for (const [type, Class] of [['text', lib.PDFTextField], ['checkbox', lib.PDFCheckBox], ['dropdown', lib.PDFDropdown], ['option', lib.PDFOptionList], ['radio', lib.PDFRadioGroup], ['signature', lib.PDFSignature]])
    if (field instanceof Class) return type;
  return 'unknown';
}
function fillField(field, value, lib) {
  if (field.isReadOnly()) fail('unsupported_content', `The form field ${field.getName()} is read-only.`);
  const type = pdfFieldType(field, lib);
  if (type === 'checkbox') {
    if (typeof value !== 'boolean') fail('invalid_arguments', 'Checkbox form values must be boolean.');
    if (value) field.check(); else field.uncheck();
  } else {
    if (typeof value !== 'string' || value.length > PREVIEW_CODEC_LIMITS.text) fail('invalid_arguments', 'Form values must be bounded text.');
    if (type === 'text') field.setText(value);
    else if (type === 'dropdown' || type === 'option') {
      if (value === '') field.clear();
      else {
        // pdf-lib's public select API uses display labels; the canonical form
        // value is the PDF export value. Preserve both rather than confusing them.
        const choices = field.acroField.getOptions(), index = choices.findIndex(option => option.value.decodeText() === value);
        if (index < 0) fail('invalid_arguments', `The form field ${field.getName()} does not offer that option.`);
        field.acroField.dict.set(lib.PDFName.of('V'), lib.PDFHexString.fromText(value));
        field.acroField.dict.set(lib.PDFName.of('I'), field.doc.context.obj([index]));
        field.markAsDirty();
      }
    } else if (type === 'radio') {
      if (value === '') field.clear();
      else { if (!field.getOptions().includes(value)) fail('invalid_arguments', `The form field ${field.getName()} does not offer that option.`); field.select(value); }
    } else fail('unsupported_content', 'Digital signature and button fields cannot be changed by the fictional signature tool.');
  }
}
function updateFieldAppearance(field, font, lib) {
  if (!(field instanceof lib.PDFDropdown) && !(field instanceof lib.PDFOptionList)) {
    field.defaultUpdateAppearances(font); return;
  }
  const key = lib.PDFName.of('V'), previous = field.acroField.dict.get(key), choices = field.acroField.getOptions();
  const display = field.getSelected().map(value => {
    const option = choices.find(item => item.value.decodeText() === value);
    return (option?.display ?? option?.value)?.decodeText() ?? value;
  });
  try {
    field.acroField.dict.set(key, field.doc.context.obj(display.map(value => lib.PDFHexString.fromText(value))));
    field.defaultUpdateAppearances(font);
  } finally {
    if (previous) field.acroField.dict.set(key, previous); else field.acroField.dict.delete(key);
  }
}
function selectedFieldWidgets(source, indices, lib) {
  const pages = source.getPages(), selected = new Set(indices), form = source.getForm();
  if (form.hasXFA()) fail('unsupported_content', 'XFA forms cannot be faithfully edited or exported.');
  for (const field of form.getFields()) {
    const widgets = field.acroField.getWidgets();
    for (let i = widgets.length - 1; i >= 0; i--) {
      const widget = widgets[i];
      const index = pages.findIndex(page => {
        const annotations = page.node.Annots();
        for (let n = 0; n < (annotations?.size() ?? 0); n++) if (annotations.lookup(n, lib.PDFDict) === widget.dict) return true;
        return false;
      });
      if (index < 0 || !selected.has(index)) field.acroField.removeWidget(i);
    }
    if (widgets.length && !field.acroField.getWidgets().length) form.acroForm.removeField(field.acroField);
  }
  return form;
}
function writeOutline(pdf, items, lib) {
  if (!items.length) return;
  const root = pdf.context.obj({ Type: 'Outlines' }), rootRef = pdf.context.register(root);
  function siblings(entries, parent) {
    const nodes = entries.map(entry => ({ entry, dict: pdf.context.obj({ Title: lib.PDFHexString.fromText(entry.title), Parent: parent,
      Dest: [pdf.getPage(entry.page).ref, 'Fit'] }) }));
    for (const node of nodes) node.ref = pdf.context.register(node.dict);
    let count = nodes.length;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (i) node.dict.set(lib.PDFName.of('Prev'), nodes[i - 1].ref);
      if (i + 1 < nodes.length) node.dict.set(lib.PDFName.of('Next'), nodes[i + 1].ref);
      if (node.entry.children?.length) {
        const child = siblings(node.entry.children, node.ref); count += child.count;
        node.dict.set(lib.PDFName.of('First'), child.first); node.dict.set(lib.PDFName.of('Last'), child.last);
        node.dict.set(lib.PDFName.of('Count'), lib.PDFNumber.of(child.count));
      }
    }
    return { first: nodes[0].ref, last: nodes[nodes.length - 1].ref, count };
  }
  const result = siblings(items, rootRef);
  root.set(lib.PDFName.of('First'), result.first); root.set(lib.PDFName.of('Last'), result.last);
  root.set(lib.PDFName.of('Count'), lib.PDFNumber.of(result.count)); pdf.catalog.set(lib.PDFName.of('Outlines'), rootRef);
}
function sourceOutline(source, mapping, lib) {
  const name = lib.PDFName.of, context = source.context, seen = new Set(); let count = 0;
  const dict = object => object ? context.lookup(object, lib.PDFDict) : undefined;
  function namedDestination(key) {
    const simple = dict(source.catalog.get(name('Dests')))?.get(name(key));
    if (simple) return context.lookup(simple);
    const tree = dict(dict(source.catalog.get(name('Names')))?.get(name('Dests')));
    function visit(node, depth) {
      if (!node || depth > 64) return undefined;
      const names = node.lookupMaybe(name('Names'), lib.PDFArray);
      for (let i = 0; i < (names?.size() ?? 0); i += 2) if (names.lookup(i)?.decodeText?.() === key) return names.lookup(i + 1);
      const kids = node.lookupMaybe(name('Kids'), lib.PDFArray);
      for (let i = 0; i < (kids?.size() ?? 0); i++) { const found = visit(kids.lookup(i, lib.PDFDict), depth + 1); if (found) return found; }
    }
    return visit(tree, 0);
  }
  function resolve(destination) {
    let value = destination ? context.lookup(destination) : undefined;
    if (value instanceof lib.PDFName || value instanceof lib.PDFString || value instanceof lib.PDFHexString) value = namedDestination(value.decodeText());
    if (value instanceof lib.PDFDict) value = value.lookupMaybe(name('D'), lib.PDFArray);
    if (!(value instanceof lib.PDFArray)) return undefined;
    const page = value.get(0);
    if (page instanceof lib.PDFNumber) return mapping.get(page.asNumber());
    const index = source.getPages().findIndex(item => item.ref.toString() === page?.toString());
    return mapping.get(index);
  }
  function visit(ref, depth) {
    if (depth > 64) fail('limit_exceeded', 'The PDF bookmark hierarchy is too deep.');
    const output = [];
    while (ref) {
      const node = dict(ref); if (!node || seen.has(node)) break; seen.add(node);
      if (++count > PREVIEW_CODEC_LIMITS.marks) fail('limit_exceeded', 'The PDF contains too many bookmarks.');
      const action = dict(node.get(name('A'))), page = resolve(node.get(name('Dest')) ?? (action?.get(name('S')) === name('GoTo') ? action.get(name('D')) : undefined));
      const children = visit(node.get(name('First')), depth + 1);
      if (page !== undefined) output.push({ title: node.lookupMaybe(name('Title'), lib.PDFString, lib.PDFHexString)?.decodeText() ?? '', page, children });
      else output.push(...children);
      ref = node.get(name('Next'));
    }
    return output;
  }
  return visit(dict(source.catalog.get(name('Outlines')))?.get(name('First')), 0);
}
function validateMark(mark, pageCount) {
  if (!mark || !integer(mark.page) || mark.page >= pageCount || !['rectangle', 'ellipse', 'line', 'text', 'highlight', 'drawing', 'signature'].includes(mark.kind)
    || ![mark.x, mark.y, mark.width, mark.height].every(finite) || mark.x < 0 || mark.y < 0 || mark.width < 0 || mark.height < 0
    || !/^#[0-9a-f]{6}$/i.test(mark.color) || !finite(mark.lineWidth) || mark.lineWidth < 0 || mark.lineWidth > 128
    || (mark.lineStyle !== undefined && !['solid', 'dashed', 'dotted'].includes(mark.lineStyle))
    || !finite(mark.fontSize) || mark.fontSize <= 0 || mark.fontSize > 512 || (mark.text !== undefined && (typeof mark.text !== 'string' || mark.text.length > PREVIEW_CODEC_LIMITS.text)))
    fail('invalid_arguments', 'The PDF contains an invalid markup object.');
  if (mark.points !== undefined && (!Array.isArray(mark.points) || mark.points.length > PREVIEW_CODEC_LIMITS.marks
    || mark.points.some(point => !point || !finite(point.x) || !finite(point.y) || point.x < 0 || point.y < 0))) fail('invalid_arguments', 'The drawing contains invalid points.');
  if (mark.kind === 'drawing' && !mark.points?.length) fail('invalid_arguments', 'A drawing requires real points.');
  if (mark.kind === 'signature' && !mark.text && !mark.points?.length) fail('invalid_arguments', 'A fictional signature requires text or real drawn points.');
}
function effectivePageBox(page) {
  const crop = page.getCropBox(), media = page.getMediaBox();
  const x = Math.max(crop.x, media.x), y = Math.max(crop.y, media.y);
  const width = Math.min(crop.x + crop.width, media.x + media.width) - x;
  const height = Math.min(crop.y + crop.height, media.y + media.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : media;
}
function drawMark(page, mark, font, lib) {
  const box = effectivePageBox(page), unit = page.node.lookupMaybe(lib.PDFName.of('UserUnit'), lib.PDFNumber)?.asNumber() || 1;
  const width = box.width * unit, height = box.height * unit;
  if (mark.x + mark.width > width + 0.01 || mark.y + mark.height > height + 0.01 || mark.points?.some(point => point.x > width || point.y > height))
    fail('invalid_arguments', 'The markup lies outside the actual PDF crop box.');
  const x = box.x + mark.x / unit, y = box.y + box.height - mark.y / unit, w = mark.width / unit, h = mark.height / unit;
  const color = lib.rgb(...[1, 3, 5].map(offset => parseInt(mark.color.slice(offset, offset + 2), 16) / 255));
  const borderWidth = mark.lineWidth / unit, dashUnit = Math.max(borderWidth, 0.5 / unit);
  const dashArray = mark.lineStyle === 'dashed' ? [dashUnit * 4, dashUnit * 3] : mark.lineStyle === 'dotted' ? [dashUnit, dashUnit * 2] : [];
  const lineCap = mark.lineStyle === 'dotted' ? lib.LineCapStyle.Round : lib.LineCapStyle.Butt;
  if (mark.kind === 'rectangle' || mark.kind === 'highlight') page.drawRectangle({ x, y: y - h, width: w, height: h,
    ...(mark.kind === 'highlight' ? { color, opacity: 0.3, borderWidth: 0 } : { borderColor: color, borderWidth, borderDashArray: dashArray, borderLineCap: lineCap }) });
  else if (mark.kind === 'ellipse') page.drawEllipse({ x: x + w / 2, y: y - h / 2, xScale: w / 2, yScale: h / 2,
    borderColor: color, borderWidth, borderDashArray: dashArray, borderLineCap: lineCap });
  else if (mark.kind === 'line') page.drawLine({ start: { x, y }, end: { x: x + w, y: y - h }, color, thickness: borderWidth, dashArray, lineCap });
  else if (mark.kind === 'drawing' || (mark.kind === 'signature' && mark.points?.length)) {
    const point = item => ({ x: box.x + item.x / unit, y: box.y + box.height - item.y / unit });
    const points = mark.points.length === 1 ? [mark.points[0], { x: mark.points[0].x + 0.01, y: mark.points[0].y }] : mark.points;
    for (let i = 1; i < points.length; i++) page.drawLine({ start: point(points[i - 1]), end: point(points[i]), color, thickness: borderWidth, dashArray, lineCap });
  } else page.drawText(mark.text ?? '', { x, y: y - mark.fontSize / unit, size: mark.fontSize / unit, font, color, lineHeight: mark.fontSize * 1.2 / unit });
}
/** Does NOT encrypt. formValues address actual original PDF field names. */
export async function exportPreviewPdf(documentModel, { guard = ALWAYS, fontLoader } = {}) {
  current(guard);
  let model;
  try { model = copyCanonicalData(documentModel); } catch { fail('invalid_arguments', 'Expected a serializable Preview document model.'); }
  // Older callers exported an unlocked model before workspace locks were added.
  // Preserve that bounded API shape while still validating any supplied lock.
  if (model && model.lock === undefined) model.lock = { enabled: false, password: '' };
  if (!model || typeof model.content !== 'string' || !Array.isArray(model.pageOrder) || !model.pageOrder.length || model.pageOrder.length > PREVIEW_CODEC_LIMITS.pages
    || !Array.isArray(model.marks) || model.marks.length > PREVIEW_CODEC_LIMITS.marks || !model.rotations || !model.formValues || !model.lock
    || typeof model.lock.enabled !== 'boolean' || typeof model.lock.password !== 'string' || model.lock.password.length > 1024
    || (model.flatten !== undefined && typeof model.flatten !== 'boolean')
    || (model.sceneTime !== undefined && (!integer(model.sceneTime) || model.sceneTime > 8640000000000000)))
    fail('invalid_arguments', 'Expected a bounded PDF document model.');
  if (model.lock.enabled && !model.lock.password) fail('invalid_arguments', 'The fictional workspace lock requires its local password.');
  for (const mark of model.marks) validateMark(mark, model.pageOrder.length);
  for (const [page, rotation] of Object.entries(model.rotations)) if (!integer(Number(page)) || Number(page) >= model.pageOrder.length || ![0, 90, 180, 270].includes(rotation))
    fail('invalid_arguments', 'PDF rotations are quarter-turn deltas on output pages.');
  const buckets = [], entries = [];
  for (const entry of model.pageOrder) {
    const content = typeof entry === 'number' ? model.content : entry?.content, index = typeof entry === 'number' ? entry : entry?.index;
    if (typeof content !== 'string' || !integer(index)) fail('invalid_arguments', 'The PDF page order contains an invalid source reference.');
    let bucket = buckets.find(item => item.content === content && !item.indices.includes(index));
    if (!bucket) { bucket = { content, indices: [], copy: buckets.filter(item => item.content === content).length + 1, mapping: new Map() }; buckets.push(bucket); }
    bucket.indices.push(index); bucket.mapping.set(index, entries.length); entries.push({ bucket, index });
  }
  try {
    const lib = await owned(pdfLibrary, guard), output = await owned(() => lib.PDFDocument.create({ updateMetadata: false }), guard);
    const fieldNames = new Set(), updatedNames = new Set(), appliedNames = new Set(), roots = [], outlines = [], texts = model.marks.map(mark => mark.text ?? '');
    for (const bucket of buckets) {
      const decoded = decodePreviewData(bucket.content);
      if (decoded.mime !== PDF_MIME) fail('unsupported_content', 'Inserted pages must contain actual PDF bytes.');
      bucket.source = await owned(() => lib.PDFDocument.load(decoded.bytes, { updateMetadata: false }), guard);
      if (bucket.source.isEncrypted) fail('encrypted_document', 'Encrypted PDFs cannot be edited or exported.');
      if (bucket.source.getPageCount() > PREVIEW_CODEC_LIMITS.pages || bucket.indices.some(index => index >= bucket.source.getPageCount()))
        fail('invalid_arguments', 'A page reference lies outside the actual source PDF.');
      bucket.form = selectedFieldWidgets(bucket.source, bucket.indices, lib);
      for (const field of bucket.form.getFields()) {
        const originalName = field.getName();
        if (Object.hasOwn(model.formValues, originalName)) { fillField(field, model.formValues[originalName], lib); appliedNames.add(originalName); }
        const needsAppearance = ['text', 'checkbox', 'dropdown', 'option', 'radio'].includes(pdfFieldType(field, lib)) && field.needsAppearancesUpdate();
        if (bucket.copy > 1) field.acroField.setPartialName(`${field.acroField.getPartialName()} [copy ${bucket.copy}]`);
        if (fieldNames.has(field.getName())) fail('collision', `Merged PDFs contain the same form field name: ${field.getName()}.`);
        fieldNames.add(field.getName());
        if (needsAppearance) {
          updatedNames.add(field.getName());
          if (field instanceof lib.PDFTextField) texts.push(field.getText() ?? '');
          if (field instanceof lib.PDFDropdown || field instanceof lib.PDFOptionList) texts.push(...field.getOptions());
        }
      }
      bucket.copier = lib.PDFObjectCopier.for(bucket.source.context, output.context);
      outlines.push(...sourceOutline(bucket.source, bucket.mapping, lib));
    }
    for (const name of Object.keys(model.formValues)) if (!appliedNames.has(name)) fail('invalid_arguments', `The form field ${name} is not present on the retained pages.`);
    // Copy indirect page refs, not just page dictionaries: widgets' /P links and
    // field /Kids then share exactly the same copier/ref map as the page tree.
    for (const { bucket, index } of entries) {
      const ref = bucket.copier.copy(bucket.source.getPage(index).ref), node = output.context.lookup(ref, lib.PDFPageLeaf);
      output.addPage(lib.PDFPage.of(node, ref, output));
    }
    for (const bucket of buckets) {
      const sourceAcro = bucket.source.catalog.lookupMaybe(lib.PDFName.of('AcroForm'), lib.PDFDict);
      const fields = sourceAcro?.lookupMaybe(lib.PDFName.of('Fields'), lib.PDFArray);
      for (let i = 0; i < (fields?.size() ?? 0); i++) roots.push(bucket.copier.copy(fields.get(i)));
    }
    if (roots.length) output.catalog.set(lib.PDFName.of('AcroForm'), output.context.register(output.context.obj({ Fields: roots })));
    const needsFont = texts.some(Boolean) || updatedNames.size > 0;
    const font = needsFont ? await owned(() => embedDocumentFont(output, texts, guard, fontLoader), guard) : null;
    if (roots.length) for (const field of output.getForm().getFields()) {
      if (updatedNames.has(field.getName())) updateFieldAppearance(field, font, lib);
    }
    if (model.flatten && roots.length) output.getForm().flatten({ updateFieldAppearances: false });
    for (let index = 0; index < output.getPageCount(); index++) {
      const page = output.getPage(index), rotation = ((page.getRotation().angle + (model.rotations[index] ?? 0)) % 360 + 360) % 360;
      page.setRotation(lib.degrees(rotation));
    }
    for (const mark of model.marks) drawMark(output.getPage(mark.page), mark, font, lib);
    writeOutline(output, outlines, lib);
    const original = buckets.find(bucket => bucket.content === model.content)?.source;
    for (const [get, set] of [['getTitle', 'setTitle'], ['getAuthor', 'setAuthor'], ['getSubject', 'setSubject'], ['getCreator', 'setCreator'], ['getCreationDate', 'setCreationDate'], ['getModificationDate', 'setModificationDate']]) {
      const value = original?.[get](); if (value !== undefined) output[set](value);
    }
    if (model.sceneTime !== undefined) {
      output.setModificationDate(new Date(model.sceneTime));
      if (!output.getCreationDate()) output.setCreationDate(new Date(model.sceneTime));
    }
    output.setProducer('JesterOS local Preview / pdf-lib; workspace lock is not encryption');
    const bytes = await owned(() => output.save({ useObjectStreams: false, updateFieldAppearances: false }), guard);
    return { text: encodePreviewData(bytes, PDF_MIME), mime: PDF_MIME, pageCount: output.getPageCount() };
  } catch (error) { current(guard); engineError(error); }
}
function rasterDimensions(bytes, mime) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === 'image/png') return [view.getUint32(16), view.getUint32(20)];
  if (mime === 'image/gif' && bytes.length >= 10) return [view.getUint16(6, true), view.getUint16(8, true)];
  if (mime === 'image/jpeg') {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7)
        return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      offset += length;
    }
  }
  if (mime === 'image/webp') {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const kind = String.fromCharCode(...bytes.subarray(offset, offset + 4)), size = view.getUint32(offset + 4, true), data = offset + 8;
      if (data + size > bytes.length) break;
      if (kind === 'VP8X' && size >= 10) {
        const u24 = at => bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16;
        return [1 + u24(data + 4), 1 + u24(data + 7)];
      }
      if (kind === 'VP8 ' && size >= 10 && bytes[data + 3] === 157 && bytes[data + 4] === 1 && bytes[data + 5] === 42)
        return [view.getUint16(data + 6, true) & 16383, view.getUint16(data + 8, true) & 16383];
      if (kind === 'VP8L' && size >= 5 && bytes[data] === 47) {
        const bits = view.getUint32(data + 1, true); return [(bits & 16383) + 1, ((bits >>> 14) & 16383) + 1];
      }
      offset = data + size + (size & 1);
    }
  }
  fail('unsupported_content', 'The raster image has no supported, valid dimensions.');
}
function boundPixels(width, height) {
  if (!integer(width, 1) || !integer(height, 1)) fail('invalid_arguments', 'Image dimensions must be positive integers.');
  if (width > PREVIEW_CODEC_LIMITS.imageDimension || height > PREVIEW_CODEC_LIMITS.imageDimension || width * height > PREVIEW_CODEC_LIMITS.imagePixels)
    fail('limit_exceeded', 'The image exceeds the bounded raster-pixel limit.');
}
/** Synchronous encoded-header geometry only; use inspectPreviewImage to confirm
 * actual decodability. Coordinates never apply JPEG EXIF orientation. */
export function previewImageGeometry(content) {
  const { bytes, mime } = decodePreviewData(content);
  if (!PREVIEW_CODEC_CAPABILITIES.imageInput.includes(mime)) fail('unsupported_content', 'Expected a supported local raster image.');
  const [width, height] = rasterDimensions(bytes, mime); boundPixels(width, height);
  return { width, height, mime };
}
export async function inspectPreviewImage(content, guard = ALWAYS) {
  current(guard);
  const decoded = decodePreviewData(content);
  if (!PREVIEW_CODEC_CAPABILITIES.imageInput.includes(decoded.mime)) fail('unsupported_content', 'Expected a supported local raster image.');
  const [width, height] = rasterDimensions(decoded.bytes, decoded.mime); boundPixels(width, height);
  if (typeof createImageBitmap !== 'function') fail('unavailable', 'A real raster-image decoder is required.');
  let bitmap;
  try {
    await owned(() => createImageBitmap(new Blob([decoded.bytes], { type: decoded.mime }), { imageOrientation: 'none' })
      .then(value => { bitmap = value; return value; }), guard);
    if (bitmap.width !== width || bitmap.height !== height) fail('unsupported_content', 'The decoder cannot preserve raw encoded pixel orientation.');
    return { width, height, mime: decoded.mime };
  } catch (error) { current(guard); engineError(error); }
  finally { bitmap?.close?.(); }
}
function canvas(width, height) {
  const result = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height) : globalThis.document?.createElement('canvas');
  if (!result) fail('unavailable', 'A real canvas pixel engine is required.');
  result.width = width; result.height = height;
  const context = result.getContext('2d', { willReadFrequently: true });
  if (!context) fail('unavailable', 'The real canvas pixel engine is unavailable.');
  return { element: result, context };
}
/** Crop -> resize -> RGB adjustments -> clockwise quarter rotation. EXIF is
 * deliberately ignored; coordinates address encoded raster pixels. */
export async function editPreviewImage(content, options = {}, guard = ALWAYS) {
  current(guard);
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('invalid_arguments', 'Expected image-edit options.');
  try { options = copyCanonicalData(options); } catch { fail('invalid_arguments', 'Expected serializable image-edit options.'); }
  const decoded = decodePreviewData(content);
  if (!PREVIEW_CODEC_CAPABILITIES.imageInput.includes(decoded.mime)) fail('unsupported_content', 'Expected a supported local raster image.');
  const [sourceWidth, sourceHeight] = rasterDimensions(decoded.bytes, decoded.mime); boundPixels(sourceWidth, sourceHeight);
  const crop = options.crop ?? { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  if (!crop || !integer(crop.x) || !integer(crop.y) || !integer(crop.width, 1) || !integer(crop.height, 1)
    || crop.x + crop.width > sourceWidth || crop.y + crop.height > sourceHeight) fail('invalid_arguments', 'The crop must lie inside the actual raster pixels.');
  const width = options.width ?? (options.height !== undefined ? Math.max(1, Math.round(crop.width * options.height / crop.height)) : crop.width);
  const height = options.height ?? (options.width !== undefined ? Math.max(1, Math.round(crop.height * options.width / crop.width)) : crop.height);
  boundPixels(width, height);
  const brightness = options.brightness ?? 0, contrast = options.contrast ?? 0, saturation = options.saturation ?? 0, rotation = options.rotation ?? 0, mime = options.mime ?? 'image/png';
  if (![brightness, contrast, saturation].every(value => finite(value) && value >= -100 && value <= 100) || ![0, 90, 180, 270].includes(rotation)
    || !PREVIEW_CODEC_CAPABILITIES.imageOutput.includes(mime)) fail('invalid_arguments', 'Use bounded +/-100 color adjustments, quarter rotations and PNG/JPEG/WebP output.');
  if (typeof createImageBitmap !== 'function') fail('unavailable', 'A real raster-image decoder is required.');
  let bitmap;
  try {
    await owned(() => createImageBitmap(new Blob([decoded.bytes], { type: decoded.mime }), { imageOrientation: 'none' })
      .then(value => { bitmap = value; return value; }), guard);
    if (bitmap.width !== sourceWidth || bitmap.height !== sourceHeight) fail('unsupported_content', 'The decoded raster dimensions differ from the encoded pixel coordinates.');
    const work = canvas(width, height);
    work.context.imageSmoothingEnabled = width !== crop.width || height !== crop.height;
    if (work.context.imageSmoothingEnabled) work.context.imageSmoothingQuality = 'high';
    work.context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
    if (brightness || contrast || saturation) {
      const image = work.context.getImageData(0, 0, width, height), pixels = image.data;
      const gain = contrast === 100 ? 256 : (100 + contrast) / (100 - contrast), chroma = 1 + saturation / 100;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = (pixels[i] - 128) * gain + 128 + brightness * 2.55;
        const g = (pixels[i + 1] - 128) * gain + 128 + brightness * 2.55;
        const b = (pixels[i + 2] - 128) * gain + 128 + brightness * 2.55;
        const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        pixels[i] = luminance + (r - luminance) * chroma;
        pixels[i + 1] = luminance + (g - luminance) * chroma;
        pixels[i + 2] = luminance + (b - luminance) * chroma;
      }
      work.context.putImageData(image, 0, 0);
    }
    const swapped = rotation === 90 || rotation === 270, result = canvas(swapped ? height : width, swapped ? width : height);
    if (mime === 'image/jpeg') { result.context.fillStyle = '#ffffff'; result.context.fillRect(0, 0, result.element.width, result.element.height); }
    result.context.imageSmoothingEnabled = false;
    if (rotation === 90) result.context.translate(height, 0);
    else if (rotation === 180) result.context.translate(width, height);
    else if (rotation === 270) result.context.translate(0, width);
    result.context.rotate(rotation * Math.PI / 180); result.context.drawImage(work.element, 0, 0);
    const blob = await owned(() => typeof result.element.convertToBlob === 'function' ? result.element.convertToBlob({ type: mime, quality: 0.92 })
      : new Promise((resolve, reject) => result.element.toBlob(value => value ? resolve(value) : reject(new Error('The raster encoder failed.')), mime, 0.92)), guard);
    if (!blob || blob.type !== mime) fail('unsupported_content', 'The canvas cannot encode the requested image format.');
    const bytes = new Uint8Array(await owned(() => blob.arrayBuffer(), guard));
    return { text: encodePreviewData(bytes, mime), mime, width: result.element.width, height: result.element.height };
  } catch (error) { current(guard); engineError(error); }
  finally { bitmap?.close?.(); }
}
const ITINERARY = Object.freeze([
  Object.freeze({ title: 'Day 1 - Arrival', lines: Object.freeze(['LOCAL FICTIONAL TRAVEL ITINERARY', '09:30  Arrive at Harbor Central Station', '10:15  Check in at the Lantern Hotel', '12:00  Lunch at Market Square', '14:30  Walk through the waterfront gardens', '18:00  Dinner at the North Pier', 'All locations and reservations are locally authored fiction.']) }),
  Object.freeze({ title: 'Day 2 - Explore', lines: Object.freeze(['A DAY AROUND THE HARBOR', '08:30  Breakfast in the hotel courtyard', '10:00  Visit the city design museum', '12:30  Picnic in the botanical gardens', '15:00  Ferry loop around Lighthouse Island', '19:00  Evening concert at Harbor Hall', 'Use the real form fields below to record local preferences.']) }),
  Object.freeze({ title: 'Day 3 - Departure', lines: Object.freeze(['DEPARTURE AND CHECKLIST', '09:00  Pack and check out', '10:30  Coffee and a final waterfront walk', '12:15  Return to Harbor Central Station', '13:00  Depart for home', 'This document has three actual pages, bookmarks and AcroForm fields.', 'A drawn or typed signature is a fictional visual mark, not cryptography.']) }),
]);
/** Parent seed hook: await createPreviewItinerary(profile.defaults.sceneTime),
 * then store returned text verbatim as the shared Itinerary.pdf content. */
export async function createPreviewItinerary(time = 1696118400000, { guard = ALWAYS, fontLoader } = {}) {
  current(guard);
  if (!integer(time) || time > 8640000000000000) fail('invalid_arguments', 'Expected the authored scene timestamp.');
  try {
    const lib = await owned(pdfLibrary, guard), pdf = await owned(() => lib.PDFDocument.create({ updateMetadata: false }), guard);
    const font = await owned(() => embedDocumentFont(pdf, ITINERARY.flatMap(page => [page.title, ...page.lines]), guard, fontLoader), guard);
    pdf.setTitle('Harbor Weekend Itinerary'); pdf.setAuthor('JesterOS locally authored sample');
    pdf.setCreator('JesterOS Preview fixture'); pdf.setProducer('JesterOS / pdf-lib');
    pdf.setCreationDate(new Date(time)); pdf.setModificationDate(new Date(time));
    const form = pdf.getForm();
    for (let index = 0; index < ITINERARY.length; index++) {
      const spec = ITINERARY[index], page = pdf.addPage([612, 792]);
      page.drawRectangle({ x: 0, y: 736, width: 612, height: 56, color: lib.rgb(0.08, 0.26, 0.34) });
      page.drawText('HARBOR WEEKEND', { x: 48, y: 755, size: 18, font, color: lib.rgb(1, 1, 1) });
      page.drawText(spec.title, { x: 48, y: 686, size: 24, font, color: lib.rgb(0.08, 0.26, 0.34) });
      for (let row = 0; row < spec.lines.length; row++) page.drawText(spec.lines[row], { x: 48, y: 636 - row * 32, size: row === 0 ? 11 : 12, font });
      page.drawText(`Locally authored sample - Page ${index + 1} of 3`, { x: 48, y: 32, size: 10, font, color: lib.rgb(0.4, 0.4, 0.4) });
      const fieldOptions = { x: 48, y: 284, width: 280, height: 26, font, borderWidth: 1, borderColor: lib.rgb(0.4, 0.5, 0.6) };
      if (index === 0) {
        page.drawText('Traveler name', { x: 48, y: 320, size: 12, font });
        const traveler = form.createTextField('traveler'); traveler.setText('Alex Morgan'); traveler.addToPage(page, fieldOptions);
      } else if (index === 1) {
        page.drawText('Meal preference', { x: 48, y: 320, size: 12, font });
        const meal = form.createDropdown('meal'); meal.addOptions(['Standard', 'Vegetarian', 'Vegan']); meal.select('Vegetarian'); meal.addToPage(page, fieldOptions);
        page.drawText('Museum or gardens?', { x: 48, y: 244, size: 12, font });
        const activity = form.createRadioGroup('activity'); activity.addOptionToPage('Museum', page, { x: 48, y: 210, width: 18, height: 18 });
        activity.addOptionToPage('Gardens', page, { x: 190, y: 210, width: 18, height: 18 }); activity.select('Museum');
        page.drawText('Museum', { x: 76, y: 213, size: 12, font }); page.drawText('Gardens', { x: 218, y: 213, size: 12, font });
      } else {
        const packed = form.createCheckBox('packed'); packed.addToPage(page, { x: 48, y: 290, width: 18, height: 18 });
        page.drawText('Packing complete', { x: 80, y: 294, size: 12, font });
        const notes = form.createTextField('notes'); notes.enableMultiline(); notes.addToPage(page, { ...fieldOptions, y: 178, height: 80 });
        page.drawText('Travel notes', { x: 48, y: 266, size: 12, font });
      }
    }
    form.updateFieldAppearances(font);
    writeOutline(pdf, ITINERARY.map((page, index) => ({ title: page.title, page: index })), lib);
    const bytes = await owned(() => pdf.save({ useObjectStreams: false, updateFieldAppearances: false }), guard);
    return { text: encodePreviewData(bytes, PDF_MIME), mime: PDF_MIME };
  } catch (error) { current(guard); engineError(error); }
}

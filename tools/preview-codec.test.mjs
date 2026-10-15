import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodePreviewData, encodePreviewData, openPreviewPdf, inspectPreviewPdf, exportPreviewPdf,
  editPreviewImage, inspectPreviewImage, previewImageGeometry, createPreviewItinerary, PREVIEW_CODEC_LIMITS, PREVIEW_CODEC_CAPABILITIES } from '../frontend/src/preview-codec.js';
import { PREVIEW_ITINERARY_CONTENT, PREVIEW_ITINERARY_MIME, PREVIEW_ITINERARY_TIME } from '../frontend/src/preview-itinerary.js';
import { PREVIEW_IMAGE_CONTENT, PREVIEW_IMAGE_MIME, PREVIEW_IMAGE_WIDTH, PREVIEW_IMAGE_HEIGHT } from '../frontend/src/preview-image-fixture.js';

// Independent real parser/serializer and real Skia raster decoder. No source-text
// assertions, fake document proxy, fake raster pixels or fabricated byte results.
const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const { PDFDocument, PDFName, PDFNumber, PDFHexString, StandardFonts, degrees } = frontendRequire('pdf-lib');
const pdfjsRequire = createRequire(frontendRequire.resolve('pdfjs-dist/package.json'));
const { createCanvas, loadImage } = pdfjsRequire('@napi-rs/canvas');
const fontLoader = async () => new Uint8Array(await Bun.file(new URL('../frontend/public/fonts/LiberationSans-Regular.ttf', import.meta.url)).arrayBuffer());
const options = { fontLoader };
const model = (content, extra = {}) => ({ content, pageOrder: [0, 1, 2], rotations: {}, marks: [], formValues: {}, lock: { enabled: false, password: '' }, ...extra });
const mark = (kind, extra = {}) => ({ id: `mark-${kind}`, page: 0, kind, x: 48, y: 350, width: 120, height: 24,
  color: '#d12626', lineWidth: 2, fontSize: 14, ...extra });
const sourceBytes = text => decodePreviewData(text).bytes;
async function withPdf(text, visit) {
  const resource = await openPreviewPdf(text);
  try { return await visit(resource, await inspectPreviewPdf(resource)); }
  finally { await resource.destroy(); }
}
let seedPromise;
const seed = () => seedPromise ??= createPreviewItinerary(1696118400000, options);
async function tinyPdf(label, { rotation = 0, crop, media, field } = {}) {
  const pdf = await PDFDocument.create({ updateMetadata: false }), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([300, 240]);
  if (media) page.setMediaBox(...media);
  if (crop) page.setCropBox(...crop);
  page.setRotation(degrees(rotation));
  page.drawText(label, { x: 20, y: 200, size: 14, font });
  if (field) { const value = pdf.getForm().createTextField(field); value.setText('Initial'); value.addToPage(page, { x: 20, y: 100, width: 150, height: 24, font }); }
  return encodePreviewData(await pdf.save({ useObjectStreams: false }), 'application/pdf');
}

test('strict MIME/signature/base64 roundtrip preserves actual document bytes', async () => {
  const fixture = await seed(), decoded = decodePreviewData(fixture.text);
  expect(decoded.mime).toBe('application/pdf');
  expect(new TextDecoder().decode(decoded.bytes.subarray(0, 8))).toBe('%PDF-1.7');
  expect(encodePreviewData(decoded.bytes, decoded.mime)).toBe(fixture.text);
  const parsed = await PDFDocument.load(decoded.bytes);
  expect(parsed.getPageCount()).toBe(3);
  expect(parsed.getTitle()).toBe('Harbor Weekend Itinerary');
  expect(parsed.getCreationDate().getTime()).toBe(1696118400000);
});

test('decoder rejects URLs, empty/JSON/SVG payloads, wrong MIME, noncanonical padding and oversize', () => {
  for (const text of ['', 'https://example.invalid/file.pdf', 'data:application/pdf;base64,',
    `data:application/pdf;base64,${btoa('{"pages":3}')}`, 'data:image/svg+xml;base64,PHN2Zy8+',
    `data:image/png;base64,${btoa('%PDF-1.7')}`, 'data:application/pdf;base64,JVBERi0xLjc=\n',
    'data:application/pdf;base64,JVBERi0xLjd=', 'data:application/pdf;base64,JVBERi0xLjc'])
    expect(() => decodePreviewData(text)).toThrow();
  let oversized;
  try { decodePreviewData(`data:application/pdf;base64,${'A'.repeat(PREVIEW_CODEC_LIMITS.base64 + 4)}`); } catch (error) { oversized = error; }
  expect(oversized).toMatchObject({ code: 'limit_exceeded' });
});

test('PDF signature alone is not a valid document: genuine parser rejects corrupt content', async () => {
  const text = encodePreviewData(new TextEncoder().encode('%PDF-1.7\nnot a PDF object tree'), 'application/pdf');
  await expect(openPreviewPdf(text)).rejects.toMatchObject({ code: 'unsupported_content' });
});

test('authored itinerary has three extracted pages, genuine destinations and real AcroForm types/options', async () => {
  const fixture = await seed();
  await withPdf(fixture.text, async (resource, inspected) => {
    expect(resource.document.numPages).toBe(3);
    expect(inspected.pages.map(page => [page.width, page.height, page.rotation])).toEqual([[612, 792, 0], [612, 792, 0], [612, 792, 0]]);
    expect(inspected.pages[0].text).toContain('Harbor Central Station');
    expect(inspected.pages[1].text).toContain('Lighthouse Island');
    expect(inspected.pages[2].text).toContain('DEPARTURE AND CHECKLIST');
    expect(inspected.outline.map(item => [item.title, item.page])).toEqual([['Day 1 - Arrival', 0], ['Day 2 - Explore', 1], ['Day 3 - Departure', 2]]);
    const forms = Object.fromEntries(inspected.forms.map(field => [field.name, field]));
    expect(forms.traveler).toMatchObject({ type: 'text', value: 'Alex Morgan', pages: [0], readOnly: false });
    expect(forms.meal).toMatchObject({ type: 'dropdown', value: 'Vegetarian', options: ['Standard', 'Vegetarian', 'Vegan'] });
    expect(forms.activity).toMatchObject({ type: 'radio', value: 'Museum', options: ['Museum', 'Gardens'], pages: [1] });
    expect(forms.packed).toMatchObject({ type: 'checkbox', value: false });
    expect(forms.notes.type).toBe('text');
    expect(inspected.metadata.encrypted).toBe(false);
    expect(inspected.pages[0].annotations.some(annotation => annotation.fieldName === 'traveler')).toBe(true);
  });
});

test('genuine forms persist changed Unicode text, checkbox and option/radio values through serialization', async () => {
  const fixture = await seed(), original = model(fixture.text, { formValues: { traveler: 'Zoë Example', packed: true, meal: 'Vegan', activity: 'Gardens', notes: 'First line\nSecond line' } });
  const before = JSON.stringify(original), result = await exportPreviewPdf(original, options);
  expect(JSON.stringify(original)).toBe(before);
  const parsed = await PDFDocument.load(sourceBytes(result.text)), form = parsed.getForm();
  expect(form.getTextField('traveler').getText()).toBe('Zoë Example');
  expect(form.getCheckBox('packed').isChecked()).toBe(true);
  expect(form.getDropdown('meal').getSelected()).toEqual(['Vegan']);
  expect(form.getRadioGroup('activity').getSelected()).toBe('Gardens');
  expect(form.getTextField('notes').getText()).toBe('First line\nSecond line');
  await withPdf(result.text, async (_, inspected) => expect(inspected.forms.find(field => field.name === 'traveler').value).toBe('Zoë Example'));
});

test('choice export values stay distinct from their visible labels and genuine flattened appearances show the label', async () => {
  const pdf = await PDFDocument.create({ updateMetadata: false }), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([300, 240]);
  const field = pdf.getForm().createDropdown('choice');
  field.addOptions(['first-label', 'second-label']); field.select('first-label');
  field.addToPage(page, { x: 20, y: 100, width: 180, height: 25, font });
  field.acroField.setOptions([{ value: PDFHexString.fromText('code-1'), display: PDFHexString.fromText('First visible label') },
    { value: PDFHexString.fromText('code-2'), display: PDFHexString.fromText('Second visible label') }]);
  field.acroField.dict.set(PDFName.of('V'), PDFHexString.fromText('code-1'));
  const content = encodePreviewData(await pdf.save({ updateFieldAppearances: false }), 'application/pdf');
  await withPdf(content, async (_, inspected) => expect(inspected.forms[0]).toMatchObject({ value: 'code-1', options: ['code-1', 'code-2'] }));
  const result = await exportPreviewPdf(model(content, { pageOrder: [0], formValues: { choice: 'code-2' } }), options);
  const parsed = await PDFDocument.load(sourceBytes(result.text));
  expect(parsed.getForm().getDropdown('choice').getSelected()).toEqual(['code-2']);
  const flattened = await exportPreviewPdf(model(content, { pageOrder: [0], flatten: true, formValues: { choice: 'code-2' } }), options);
  await withPdf(flattened.text, async (_, inspected) => expect(inspected.pages[0].text).toContain('Second visible label'));
});

test('actual option-list fields retain their options and read-only fields refuse changed values', async () => {
  const pdf = await PDFDocument.create({ updateMetadata: false }), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([300, 240]);
  const list = pdf.getForm().createOptionList('route'); list.addOptions(['Harbor', 'Gardens']); list.select('Harbor');
  list.addToPage(page, { x: 20, y: 70, width: 160, height: 80, font });
  const readonly = pdf.getForm().createTextField('readonly'); readonly.setText('Immutable'); readonly.enableReadOnly();
  readonly.addToPage(page, { x: 20, y: 170, width: 160, height: 24, font });
  const content = encodePreviewData(await pdf.save(), 'application/pdf');
  await withPdf(content, async (_, inspected) => {
    expect(inspected.forms.find(field => field.name === 'route')).toMatchObject({ type: 'option', value: 'Harbor', options: ['Harbor', 'Gardens'], pages: [0] });
    expect(inspected.forms.find(field => field.name === 'readonly').readOnly).toBe(true);
  });
  const result = await exportPreviewPdf(model(content, { pageOrder: [0], formValues: { route: 'Gardens' } }), options);
  expect((await PDFDocument.load(sourceBytes(result.text))).getForm().getOptionList('route').getSelected()).toEqual(['Gardens']);
  await expect(exportPreviewPdf(model(content, { pageOrder: [0], formValues: { readonly: 'Changed' } }), options)).rejects.toMatchObject({ code: 'unsupported_content' });
});

test('flattened forms retain changed visible text in actual page content and remove interactive fields', async () => {
  const fixture = await seed(), output = await exportPreviewPdf(model(fixture.text, { flatten: true, formValues: { traveler: 'Visible New Traveler', meal: 'Vegan', notes: 'Persisted Travel Notes' } }), options);
  const parsed = await PDFDocument.load(sourceBytes(output.text));
  expect(parsed.getForm().getFields()).toHaveLength(0);
  await withPdf(output.text, async (_, inspected) => {
    expect(inspected.forms).toHaveLength(0);
    expect(inspected.pages[0].text).toContain('Visible New Traveler');
    expect(inspected.pages[1].text).toContain('Vegan');
    // A multiline field can wrap between words without losing authored data.
    expect(inspected.pages[2].text.replace(/\s+/gu, ' ')).toContain('Persisted Travel Notes');
  });
});

test('reordering/deletion preserves correct real pages and remaps bookmarks without orphaned form widgets', async () => {
  const fixture = await seed(), output = await exportPreviewPdf(model(fixture.text, { pageOrder: [2, 0], rotations: { 0: 90 } }), options);
  expect(output.pageCount).toBe(2);
  await withPdf(output.text, async (_, inspected) => {
    expect(inspected.pages[0].rotation).toBe(90);
    expect(inspected.pages[0].text).toContain('DEPARTURE AND CHECKLIST');
    expect(inspected.pages[1].text).toContain('Day 1 - Arrival');
    expect(inspected.outline.map(item => [item.title, item.page])).toEqual([['Day 1 - Arrival', 1], ['Day 3 - Departure', 0]]);
    expect(inspected.forms.map(field => field.name).sort()).toEqual(['notes', 'packed', 'traveler']);
  });
  const parsed = await PDFDocument.load(sourceBytes(output.text));
  for (const field of parsed.getForm().getFields()) for (const widget of field.acroField.getWidgets())
    expect(parsed.getPages().some(page => page.ref.toString() === widget.P().toString())).toBe(true);
});

test('merge inserts actual PDF pages and retains independent unique AcroForms', async () => {
  const fixture = await seed(), inserted = await tinyPdf('INSERTED SOURCE PAGE', { field: 'merge-note' });
  const output = await exportPreviewPdf(model(fixture.text, { pageOrder: [0, { content: inserted, index: 0, width: 300, text: 'not an authority' }, 2], formValues: { 'merge-note': 'Actual merged value' } }), options);
  await withPdf(output.text, async (_, inspected) => {
    expect(inspected.pages[1].text).toContain('INSERTED SOURCE PAGE');
    expect(inspected.pages[1].text).not.toContain('not an authority');
    expect(inspected.pages[1].width).toBe(300);
    expect(inspected.forms.find(field => field.name === 'merge-note').value).toBe('Actual merged value');
    expect(inspected.forms.some(field => field.name === 'meal')).toBe(false);
  });
});

test('duplicate pages have independent content/marks and intentionally named copied fields', async () => {
  const fixture = await seed();
  const output = await exportPreviewPdf(model(fixture.text, { pageOrder: [0, 0], marks: [mark('text', { page: 1, text: 'Only second copy' })], formValues: { traveler: 'Copied Traveler' } }), options);
  await withPdf(output.text, async (_, inspected) => {
    expect(inspected.pages[0].text).not.toContain('Only second copy');
    expect(inspected.pages[1].text).toContain('Only second copy');
    expect(inspected.forms.map(field => [field.name, field.value])).toEqual([['traveler', 'Copied Traveler'], ['traveler [copy 2]', 'Copied Traveler']]);
  });
});

test('form collisions, invalid values and real page boundaries reject instead of silent mutation', async () => {
  const fixture = await seed(), other = await tinyPdf('COLLIDING FORM', { field: 'traveler' });
  await expect(exportPreviewPdf(model(fixture.text, { pageOrder: [0, { content: other, index: 0 }] }), options)).rejects.toMatchObject({ code: 'collision' });
  for (const extra of [{ pageOrder: [] }, { pageOrder: [3] }, { pageOrder: [{ content: other, index: 1 }] },
    { rotations: { 0: 45 } }, { formValues: { unknown: 'x' } }, { formValues: { packed: 'true' } },
    { formValues: { meal: 'Unavailable choice' } }, { marks: [mark('rectangle', { x: 600, width: 100 })] },
    { marks: [mark('drawing', { points: [] })] }, { marks: [mark('line', { lineStyle: 'fake-style' })] }])
    await expect(exportPreviewPdf(model(fixture.text, extra), options)).rejects.toMatchObject({ code: 'invalid_arguments' });
});

test('immutable shared-file seed is a real three-page PDF with the authored timestamp and fields', async () => {
  const parsed = await PDFDocument.load(sourceBytes(PREVIEW_ITINERARY_CONTENT));
  expect(PREVIEW_ITINERARY_MIME).toBe('application/pdf');
  expect(parsed.getPageCount()).toBe(3);
  expect(parsed.getCreationDate().getTime()).toBe(PREVIEW_ITINERARY_TIME);
  expect(parsed.getForm().getTextField('traveler').getText()).toBe('Alex Morgan');
  await withPdf(PREVIEW_ITINERARY_CONTENT, async (_, inspected) => expect(inspected.outline.map(item => item.page)).toEqual([0, 1, 2]));
});

test('every vector/visual-signature kind changes genuinely rendered pixels; line styles become actual PDF dash operators', async () => {
  const content = await tinyPdf('Original content');
  const library = await import(frontendRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
  async function render(text) {
    const resource = await openPreviewPdf(text);
    try {
      const page = await resource.document.getPage(1), viewport = page.getViewport({ scale: 1 });
      const canvas = createCanvas(viewport.width, viewport.height), context = canvas.getContext('2d');
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      return { pixels: [...context.getImageData(0, 0, viewport.width, viewport.height).data], ops: await page.getOperatorList() };
    } finally { await resource.destroy(); }
  }
  const baseline = (await render(content)).pixels;
  for (const kind of ['rectangle', 'ellipse', 'line', 'highlight', 'drawing', 'text', 'signature']) {
    const extra = ['drawing', 'signature'].includes(kind) ? { points: [{ x: 20, y: 100 }, { x: 65, y: 120 }, { x: 100, y: 108 }] }
      : kind === 'text' ? { text: 'Real painted mark' } : {};
    const output = await exportPreviewPdf(model(content, { pageOrder: [0], marks: [mark(kind, { x: 20, y: 100, width: 120, height: 24, lineStyle: 'dashed', ...extra })] }), options);
    const rendered = await render(output.text);
    expect(rendered.pixels.some((channel, index) => channel !== baseline[index])).toBe(true);
    if (['rectangle', 'ellipse', 'line', 'drawing', 'signature'].includes(kind)) {
      const dashes = rendered.ops.fnArray.flatMap((op, index) => op === library.OPS.setDash ? [rendered.ops.argsArray[index][0]] : []);
      expect(dashes.some(array => array.length === 2 && array[0] === 8 && array[1] === 6)).toBe(true);
    }
  }
  const dotted = await exportPreviewPdf(model(content, { pageOrder: [0], marks: [mark('line', { x: 20, y: 100, width: 120, height: 0, lineStyle: 'dotted' })] }), options);
  const dottedOps = (await render(dotted.text)).ops;
  expect(dottedOps.fnArray.some((op, index) => op === library.OPS.setDash && dottedOps.argsArray[index][0].join(',') === '2,4')).toBe(true);
  const typed = await exportPreviewPdf(model(content, { pageOrder: [0], marks: [mark('signature', { x: 20, y: 100, text: 'Fictional signer' })] }), options);
  await withPdf(typed.text, async (_, inspected) => expect(inspected.pages[0].text).toContain('Fictional signer'));
});

test('embedded Liberation Sans supports actual Unicode and rejects missing glyphs without substitution', async () => {
  const fixture = await seed();
  const output = await exportPreviewPdf(model(fixture.text, { marks: [mark('text', { text: 'Résumé — Zoë' })] }), options);
  await withPdf(output.text, async (_, inspected) => expect(inspected.pages[0].text).toContain('Résumé — Zoë'));
  await expect(exportPreviewPdf(model(fixture.text, { marks: [mark('text', { text: 'Missing glyph: 🦄' })] }), options)).rejects.toMatchObject({ code: 'unsupported_glyph' });
  await expect(exportPreviewPdf(model(fixture.text, { marks: [mark('text', { text: 'tab\ttext' })] }), options)).rejects.toMatchObject({ code: 'unsupported_glyph' });
});

test('source rotation plus output delta applies once and effective CropBox intersection positions real text', async () => {
  const content = await tinyPdf('Geometry', { rotation: 90, media: [10, 20, 200, 180], crop: [-10, 0, 200, 180] });
  const source = await PDFDocument.load(sourceBytes(content)); source.getPage(0).node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
  const scaled = encodePreviewData(await source.save(), 'application/pdf');
  const output = await exportPreviewPdf(model(scaled, { pageOrder: [0], rotations: { 0: 270 }, marks: [mark('text', { x: 20, y: 40, width: 180, height: 24, text: 'Crop marker' })] }), options);
  await withPdf(output.text, async (resource, inspected) => {
    expect(inspected.pages[0]).toMatchObject({ width: 360, height: 320, rotation: 0 });
    const page = await resource.document.getPage(1), text = await page.getTextContent(), item = text.items.find(item => item.str === 'Crop marker');
    expect(item.transform[4]).toBeCloseTo(20, 5); // effective x=10 + 20 points / UserUnit2
    expect(item.transform[5]).toBeCloseTo(153, 5); // top180 - (40+font14) / UserUnit2
  });
});

test('export PDF metadata uses original or authored scene dates, never implicit host-now metadata', async () => {
  const original = await exportPreviewPdf(model(PREVIEW_ITINERARY_CONTENT), options);
  const preserved = await PDFDocument.load(sourceBytes(original.text), { updateMetadata: false });
  expect(preserved.getCreationDate().getTime()).toBe(PREVIEW_ITINERARY_TIME);
  expect(preserved.getModificationDate().getTime()).toBe(PREVIEW_ITINERARY_TIME);
  const sceneTime = PREVIEW_ITINERARY_TIME + 3600000;
  const changed = await exportPreviewPdf(model(PREVIEW_ITINERARY_CONTENT, { sceneTime }), options);
  const authored = await PDFDocument.load(sourceBytes(changed.text), { updateMetadata: false });
  expect(authored.getCreationDate().getTime()).toBe(PREVIEW_ITINERARY_TIME);
  expect(authored.getModificationDate().getTime()).toBe(sceneTime);
  const withoutDate = await tinyPdf('No source dates');
  const undated = await exportPreviewPdf(model(withoutDate, { pageOrder: [0] }), options);
  const raw = await PDFDocument.load(sourceBytes(undated.text), { updateMetadata: false });
  expect(raw.getCreationDate()).toBeUndefined(); expect(raw.getModificationDate()).toBeUndefined();
});

test('workspace lock is honest: exported bytes remain unencrypted and never contain the password', async () => {
  const fixture = await seed(), password = 'local-only-unique-secret-phrase';
  const output = await exportPreviewPdf(model(fixture.text, { lock: { enabled: true, password } }), options);
  const parsed = await PDFDocument.load(sourceBytes(output.text));
  expect(parsed.isEncrypted).toBe(false);
  expect(new TextDecoder().decode(sourceBytes(output.text))).not.toContain(password);
  expect(PREVIEW_CODEC_CAPABILITIES.encryptionExport).toBe(false);
  await withPdf(output.text, async (_, inspected) => expect(inspected.metadata.encrypted).toBe(false));
});

async function encryptedFixture() {
  // Genuine qpdf encryption generated as test input, not a fake marker.
  const fixture = await seed(), directory = await mkdtemp(join(tmpdir(), 'jester-preview-encrypted-'));
  try {
    const input = join(directory, 'input.pdf'); await writeFile(input, sourceBytes(fixture.text));
    const process = Bun.spawn(['qpdf', '--encrypt', 'actual-password', 'owner-password', '256', '--', input, '-'],
      { stdout: 'pipe', stderr: 'pipe' });
    const [bytes, error, exit] = await Promise.all([new Response(process.stdout).arrayBuffer(), new Response(process.stderr).text(), process.exited]);
    expect(exit, error).toBe(0); return encodePreviewData(new Uint8Array(bytes), 'application/pdf');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const encryptionTest = Bun.which('qpdf') ? test : test.skip;
encryptionTest('actual encrypted PDF opens only with its password and editing never bypasses encryption', async () => {
  const content = await encryptedFixture();
  await expect(openPreviewPdf(content)).rejects.toMatchObject({ code: 'password_required' });
  await expect(openPreviewPdf(content, { password: 'wrong' })).rejects.toMatchObject({ code: 'invalid_password' });
  const resource = await openPreviewPdf(content, { password: 'actual-password' });
  try { expect((await inspectPreviewPdf(resource)).pages).toHaveLength(3); } finally { await resource.destroy(); }
  await expect(exportPreviewPdf(model(content), options)).rejects.toMatchObject({ code: 'encrypted_document' });
});

test('ownership expiry across real font/PDF awaits rejects before output; proxy models are supported', async () => {
  const fixture = await seed();
  await expect(openPreviewPdf(fixture.text, { guard: () => false })).rejects.toMatchObject({ code: 'stale_target' });
  let alive = true;
  await expect(exportPreviewPdf(model(fixture.text, { marks: [mark('text', { text: 'Owned await' })] }), { guard: () => alive, fontLoader: async () => { const bytes = await fontLoader(); alive = false; return bytes; } })).rejects.toMatchObject({ code: 'stale_target' });
  const proxied = new Proxy(model(fixture.text), {});
  expect((await exportPreviewPdf(proxied, options)).pageCount).toBe(3);
  const resource = await openPreviewPdf(fixture.text);
  try { await expect(inspectPreviewPdf(resource, () => false)).rejects.toMatchObject({ code: 'stale_target' }); }
  finally { await resource.destroy(); await resource.destroy(); }
});

describe('actual bounded raster pixel transformations', () => {
  let previousBitmap, previousCanvas;
  beforeAll(() => {
    previousBitmap = globalThis.createImageBitmap; previousCanvas = globalThis.OffscreenCanvas;
    globalThis.createImageBitmap = async blob => loadImage(new Uint8Array(await blob.arrayBuffer()));
    globalThis.OffscreenCanvas = class {
      constructor(width, height) {
        const value = createCanvas(width, height);
        value.convertToBlob = async ({ type }) => new Blob([value.toBuffer(type)], { type });
        return value;
      }
    };
  });
  afterAll(() => { globalThis.createImageBitmap = previousBitmap; globalThis.OffscreenCanvas = previousCanvas; });
  function raster(width = 3, height = 2) {
    const canvas = createCanvas(width, height), context = canvas.getContext('2d');
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff'];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { context.fillStyle = colors[(y * width + x) % colors.length]; context.fillRect(x, y, 1, 1); }
    return encodePreviewData(new Uint8Array(canvas.toBuffer('image/png')), 'image/png');
  }
  async function pixels(text) {
    const image = await loadImage(sourceBytes(text)), canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d');
    context.drawImage(image, 0, 0); return { width: image.width, height: image.height, data: [...context.getImageData(0, 0, image.width, image.height).data] };
  }
  test('authored shared image seed and raw geometry inspection describe actual colorful PNG pixels', async () => {
    expect(PREVIEW_IMAGE_MIME).toBe('image/png');
    expect(previewImageGeometry(PREVIEW_IMAGE_CONTENT)).toEqual({ width: PREVIEW_IMAGE_WIDTH, height: PREVIEW_IMAGE_HEIGHT, mime: PREVIEW_IMAGE_MIME });
    expect(await inspectPreviewImage(PREVIEW_IMAGE_CONTENT)).toEqual({ width: 960, height: 640, mime: 'image/png' });
    const decoded = await pixels(PREVIEW_IMAGE_CONTENT);
    expect(decoded).toMatchObject({ width: 960, height: 640 });
    expect(new Set(decoded.data.filter((_, index) => index % 4 !== 3)).size).toBeGreaterThan(20);
    const crop = await editPreviewImage(PREVIEW_IMAGE_CONTENT, { crop: { x: 100, y: 100, width: 100, height: 80 } });
    expect(await inspectPreviewImage(crop.text)).toEqual({ width: 100, height: 80, mime: 'image/png' });
  });
  test('identity preserves genuine PNG dimensions and every color channel', async () => {
    const input = raster(), output = await editPreviewImage(input, {});
    expect(output).toMatchObject({ mime: 'image/png', width: 3, height: 2 });
    expect((await pixels(output.text)).data).toEqual((await pixels(input)).data);
  });
  test('crop transforms source pixels and clockwise rotation maps corners exactly', async () => {
    const output = await editPreviewImage(raster(), { crop: { x: 1, y: 0, width: 2, height: 2 }, rotation: 90 });
    expect(output).toMatchObject({ width: 2, height: 2 });
    expect((await pixels(output.text)).data).toEqual([0, 255, 255, 255, 0, 255, 0, 255, 255, 0, 255, 255, 0, 0, 255, 255]);
  });
  test('resize one dimension retains crop aspect ratio and produces actual encoded size', async () => {
    const output = await editPreviewImage(raster(), { width: 6 });
    expect(output).toMatchObject({ width: 6, height: 4 });
    expect(await pixels(output.text)).toMatchObject({ width: 6, height: 4 });
    const rotated = await editPreviewImage(raster(), { rotation: 270 });
    expect(await pixels(rotated.text)).toMatchObject({ width: 2, height: 3 });
  });
  test('brightness, contrast and saturation alter real pixels without changing alpha', async () => {
    const gray = await editPreviewImage(raster(), { saturation: -100 });
    const values = (await pixels(gray.text)).data;
    for (let i = 0; i < values.length; i += 4) { expect(values[i]).toBe(values[i + 1]); expect(values[i]).toBe(values[i + 2]); expect(values[i + 3]).toBe(255); }
    expect((await pixels((await editPreviewImage(raster(), { brightness: 100 })).text)).data).toEqual(Array.from({ length: 24 }, () => 255));
    const flat = (await pixels((await editPreviewImage(raster(), { contrast: -100 })).text)).data;
    for (let i = 0; i < flat.length; i += 4) expect(flat.slice(i, i + 4)).toEqual([128, 128, 128, 255]);
  });
  test('PNG alpha survives adjustments and JPEG encodes an opaque real image', async () => {
    const canvas = createCanvas(1, 1), context = canvas.getContext('2d'); context.fillStyle = 'rgba(80,120,160,0.5)'; context.fillRect(0, 0, 1, 1);
    const input = encodePreviewData(new Uint8Array(canvas.toBuffer('image/png')), 'image/png');
    const output = await editPreviewImage(input, { brightness: 10 });
    expect((await pixels(output.text)).data[3]).toBe((await pixels(input)).data[3]);
    const jpeg = await editPreviewImage(input, { mime: 'image/jpeg' });
    expect(decodePreviewData(jpeg.text).mime).toBe('image/jpeg'); expect((await pixels(jpeg.text)).data[3]).toBe(255);
  });
  test('invalid crops, resizes, filters and output types reject actual boundary violations', async () => {
    const input = raster();
    for (const option of [{ crop: { x: 2, y: 0, width: 2, height: 1 } }, { crop: { x: -1, y: 0, width: 1, height: 1 } },
      { width: 0 }, { width: 1.5 }, { rotation: 45 }, { brightness: 101 }, { saturation: -101 }, { mime: 'image/gif' }])
      await expect(editPreviewImage(input, option)).rejects.toMatchObject({ code: 'invalid_arguments' });
    await expect(editPreviewImage(input, { width: 8192, height: 8192 })).rejects.toMatchObject({ code: 'limit_exceeded' });
    const huge = sourceBytes(input).slice(); new DataView(huge.buffer).setUint32(16, 65535);
    await expect(editPreviewImage(encodePreviewData(huge, 'image/png'), {})).rejects.toMatchObject({ code: 'limit_exceeded' });
  });
  test('guard expiry at real decode await rejects without returning stale pixels', async () => {
    let alive = true; const original = globalThis.createImageBitmap;
    globalThis.createImageBitmap = async blob => { const image = await original(blob); alive = false; return image; };
    try { await expect(editPreviewImage(raster(), {}, () => alive)).rejects.toMatchObject({ code: 'stale_target' }); }
    finally { globalThis.createImageBitmap = original; }
  });
});

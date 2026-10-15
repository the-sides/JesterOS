import { expect, test } from 'bun:test';
import { PDFDocument, PDFName, PDFNumber, degrees } from '../frontend/node_modules/pdf-lib/es/index.js';
import { createPreviewWindow } from '../frontend/src/preview-state.js';
import { decodePreviewData, encodePreviewData, openPreviewPdf, exportPreviewPdf } from '../frontend/src/preview-codec.js';
import { createPreviewNativeView, previewPdfSourcePoint, previewPdfSourceRect, previewPdfProjectedRect,
  capturePreviewPdfSelection } from '../frontend/src/preview-native-view.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCzwAAAAASUVORK5CYII=';
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

// Browser-only boundaries use a small ORIGINAL DOM, not a mocked native facade
// or mocked PDF library. Membership, focus, replacement and decode settlement
// are observed mutations; PDF geometry below comes from genuine stored bytes.
function dom() {
  let selection = null;
  const document = { activeElement: null, getSelection: () => selection,
    defaultView: { devicePixelRatio: 3, getComputedStyle: node => ({ display: 'block', visibility: 'visible', opacity: '1', ...node.computed }) } };
  function element(parent = null, attributes = {}) {
    const values = new Map(Object.entries(attributes)), children = [], styles = new Map();
    const node = { parentElement: parent, ownerDocument: document, hidden: false, inert: false,
      disabled: false, computed: {}, style: { setProperty: (key, value) => styles.set(key, value) },
      classList: { add() {} }, children, scrollTop: 0, scrollLeft: 0, clientWidth: 500, clientHeight: 400,
      bounds: { left: 80, top: 60, width: 240, height: 120 },
      getAttribute: name => values.get(name) ?? null,
      setAttribute: (name, value) => values.set(name, String(value)), hasAttribute: name => values.has(name),
      getBoundingClientRect() { return this.bounds; }, getClientRects() { return this.hidden ? [] : [this.bounds]; },
      contains(other) { for (let current = other; current; current = current.parentElement) if (current === this) return true; return false; },
      append(child) { child.parentElement = this; children.push(child); },
      remove() { const index = this.parentElement?.children.indexOf(this); if (index >= 0) this.parentElement.children.splice(index, 1); this.parentElement = null; this.detached = true; },
      querySelectorAll() { const result = []; function visit(node) { for (const child of node.children) { if (child.hasAttribute('data-preview-control')) result.push(child); visit(child); } } visit(this); return result; },
      focus() { document.activeElement = this; this.onFocus?.(); },
    };
    Object.defineProperty(node, 'isConnected', { get: () => !node.detached && (node.parentElement ? node.parentElement.isConnected : node.mounted === true) });
    if (parent) parent.children.push(node);
    return node;
  }
  document.createElement = () => element();
  return { document, element, selection(value) { selection = value; } };
}
function fixture() {
  const tree = dom();
  const root = tree.element(null, { 'data-preview-window': 'preview-one' }); root.mounted = true;
  const reader = tree.element(root), image = tree.element(root), control = tree.element(root, { 'data-preview-control': 'search' });
  const decodes = [];
  Object.defineProperty(image, 'src', { get: () => image.getAttribute('src'), set: value => image.setAttribute('src', value) });
  image.naturalWidth = 1; image.naturalHeight = 1;
  image.decode = () => { const decode = deferred(); decodes.push(decode); return decode.promise; };
  const bitmaps = [], bitmapInputs = [];
  tree.document.defaultView.createImageBitmap = (blob, options) => {
    const bitmap = { width: 1, height: 1, closed: false, close() { this.closed = true; } };
    bitmaps.push(bitmap); bitmapInputs.push({ blob, options });
    return Promise.resolve(bitmap);
  };
  const session = createPreviewWindow('preview-one');
  session.selectedId = 'document-one'; session.documentIds = ['document-one']; session.fit = 'custom'; session.zoom = 2;
  session.scroll = { top: 31, left: 7 };
  const document = { id: 'document-one', fileId: 'file-one', fileRevision: 4, revision: 2, mime: 'image/png',
    content: PNG, pages: [{ width: 1, height: 1, rotation: 0, text: '' }], unlocked: true,
    edits: { pageOrder: [0], rotations: [0], marks: [], formValues: [], imageContent: '', lock: { enabled: false, password: '' } } };
  const refs = { root, reader, image, canvas: null, text: null, document, session, available: true, thumbnails: [] };
  const view = createPreviewNativeView({ getRoot: () => refs.root, getReader: () => refs.reader,
    getCanvas: () => refs.canvas, getTextLayer: () => refs.text, getImage: () => refs.image,
    getThumbnails: () => refs.thumbnails, getDocument: () => refs.document, getSession: () => refs.session,
    isAvailable: () => refs.available, windowId: 'preview-one' });
  return { tree, root, reader, image, control, session, document, refs, view, decodes, bitmaps, bitmapInputs };
}
function close(actual, expected) { for (const key of Object.keys(expected)) expect(actual?.[key], key).toBeCloseTo(expected[key], 6); }

async function pdfFixture(rotation = 0, userUnit = 1) {
  const pdf = await PDFDocument.create(), page = pdf.addPage([400, 300]);
  page.setMediaBox(10, 20, 360, 250); page.setCropBox(40, 70, 240, 120); page.setRotation(degrees(rotation));
  page.node.set(PDFName.of('UserUnit'), PDFNumber.of(userUnit));
  return encodePreviewData(await pdf.save(), 'application/pdf');
}
// Forward reference calculation is deliberately independent of the code under
// test and of convertToViewportPoint, so inverse/rotation errors cannot cancel.
function clientPoint(rotation, x, y, width, height, scale, bounds, viewport) {
  const [vx, vy] = rotation === 0 ? [x, y] : rotation === 90 ? [height - y, x]
    : rotation === 180 ? [width - x, height - y] : [y, width - x];
  return [bounds.left + vx * scale * bounds.width / viewport.width,
    bounds.top + vy * scale * bounds.height / viewport.height];
}
function clientRect(rotation, source, width, height, scale, bounds, viewport) {
  const points = [[source.x, source.y], [source.x + source.width, source.y],
    [source.x, source.y + source.height], [source.x + source.width, source.y + source.height]]
    .map(([x, y]) => clientPoint(rotation, x, y, width, height, scale, bounds, viewport));
  const left = Math.min(...points.map(point => point[0])), top = Math.min(...points.map(point => point[1]));
  return { left, top, width: Math.max(...points.map(point => point[0])) - left,
    height: Math.max(...points.map(point => point[1])) - top };
}

for (const rotation of [0, 90, 180, 270]) for (const unit of [1, 2]) {
  test(`genuine PDF viewport inverts crop origin, rotation ${rotation}, UserUnit ${unit} and CSS scaling`, async () => {
    const resource = await openPreviewPdf(await pdfFixture(rotation, unit));
    try {
      const page = await resource.document.getPage(1), scale = 1.75, viewport = page.getViewport({ scale });
      const bounds = { left: 93, top: 117, width: viewport.width * 0.6, height: viewport.height * 0.6 };
      const expected = { x: 37, y: 29 }, source = { x: 14, y: 22, width: 41, height: 19 };
      const [x, y] = clientPoint(rotation, expected.x, expected.y, 240 * unit, 120 * unit, scale, bounds, viewport);
      close(previewPdfSourcePoint(viewport, bounds, x, y), expected);
      close(previewPdfSourceRect(viewport, bounds,
        clientRect(rotation, source, 240 * unit, 120 * unit, scale, bounds, viewport)), source);
      const displayed = clientRect(rotation, source, 240 * unit, 120 * unit, scale, bounds, viewport);
      close(previewPdfProjectedRect(viewport, bounds, source), { ...displayed,
        left: displayed.left - bounds.left, top: displayed.top - bounds.top });
      expect(previewPdfProjectedRect(viewport, bounds, { ...source, x: -1 })).toBeNull();
      expect(previewPdfProjectedRect(viewport, bounds, { ...source, width: 10000 })).toBeNull();
      expect(previewPdfSourcePoint(viewport, bounds, bounds.left - 1, bounds.top)).toBeNull();
      expect(previewPdfSourcePoint(viewport, bounds, NaN, bounds.top)).toBeNull();
      expect(previewPdfSourceRect(viewport, bounds, { left: -100, top: -100, width: 1, height: 1 })).toBeNull();
    } finally { await resource.destroy(); }
  });
}

test('serialized source rotation plus canonical delta is inverted exactly once', async () => {
  const content = await pdfFixture(90, 2);
  const output = await exportPreviewPdf({ content, pageOrder: [0], rotations: { 0: 90 }, marks: [], formValues: {} });
  const resource = await openPreviewPdf(output.text);
  try {
    const page = await resource.document.getPage(1), viewport = page.getViewport({ scale: 2 });
    expect(viewport.rotation).toBe(180);
    const bounds = { left: 80, top: 60, width: viewport.width, height: viewport.height };
    const [x, y] = clientPoint(180, 39, 21, 480, 240, 2, bounds, viewport);
    close(previewPdfSourcePoint(viewport, bounds, x, y), { x: 39, y: 21 });
  } finally { await resource.destroy(); }
});

test('selection captures real original ranges, not a selected string from another page or root', async () => {
  const resource = await openPreviewPdf(await pdfFixture(270, 2));
  try {
    const viewport = (await resource.document.getPage(1)).getViewport({ scale: 1.5 });
    const tree = dom(), root = tree.element(); root.mounted = true;
    const canvas = tree.element(root), layer = tree.element(root), text = tree.element(layer), outside = tree.element(root);
    canvas.bounds = { left: 80, top: 60, width: viewport.width, height: viewport.height };
    const source = { x: 23, y: 32, width: 51, height: 17 };
    const rect = clientRect(270, source, 480, 240, 1.5, canvas.bounds, viewport);
    const range = { startContainer: text, endContainer: text, toString: () => 'Original selected PDF text', getClientRects: () => [rect, rect] };
    const selection = { rangeCount: 1, isCollapsed: false, anchorNode: text, focusNode: text, getRangeAt: () => range };
    tree.selection(selection);
    let currentRoot = root, currentLayer = layer, revision = 3;
    const originalRevision = revision, guard = () => currentRoot === root && currentLayer === layer && revision === originalRevision;
    const spec = { root, canvas, textLayer: layer, viewport };
    const captured = capturePreviewPdfSelection(spec, guard);
    expect(captured.text).toBe('Original selected PDF text'); expect(captured.rects).toHaveLength(1); close(captured.rects[0], source);
    selection.focusNode = outside; expect(capturePreviewPdfSelection(spec, guard)).toBeNull(); selection.focusNode = text;
    range.endContainer = outside; expect(capturePreviewPdfSelection(spec, guard)).toBeNull(); range.endContainer = text;
    currentLayer = tree.element(root); expect(capturePreviewPdfSelection(spec, guard)).toBeNull(); currentLayer = layer;
    currentRoot = tree.element(); currentRoot.mounted = true; expect(capturePreviewPdfSelection(spec, guard)).toBeNull(); currentRoot = root;
    range.getClientRects = () => { revision++; return [rect]; };
    expect(capturePreviewPdfSelection(spec, guard)).toBeNull();
    range.getClientRects = () => [rect]; revision = originalRevision; canvas.detached = true;
    expect(capturePreviewPdfSelection(spec, guard)).toBeNull();
  } finally { await resource.destroy(); }
});

test('a mounted window identity cannot be borrowed by a replacement native root', () => {
  const f = fixture(); expect(f.view.available()).toBe(true); expect(f.view.focus('search')).toBe(true);
  const replacement = f.tree.element(null, { 'data-preview-window': 'preview-one' }); replacement.mounted = true;
  f.refs.root = replacement;
  expect(f.view.available()).toBe(false); expect(f.view.focus('search')).toBe(false);
  expect(f.view.scroll({ top: 100, left: 9 })).toBe(false); expect(f.reader.scrollTop).toBe(0);
  expect(f.view.captureSelection()).toBeNull(); expect(f.view.selectAll()).toBe(false); expect(f.view.point(90, 90)).toBeNull();
  f.view.destroy();
});

test('focus success requires the original visible enabled control after its focus event', () => {
  const f = fixture();
  f.control.disabled = true; expect(f.view.focus('search')).toBe(false); f.control.disabled = false;
  f.control.computed.visibility = 'hidden'; expect(f.view.focus('search')).toBe(false); f.control.computed.visibility = 'visible';
  expect(f.view.focus('missing')).toBe(false); expect(f.view.focus('search', () => false)).toBe(false);
  f.control.onFocus = () => { f.refs.session = { ...f.session }; };
  expect(f.view.focus('search')).toBe(false); expect(f.tree.document.activeElement).toBe(f.control);
  f.view.destroy();
});

test('scroll does not write a replacement reader after the first native offset setter', () => {
  const f = fixture(), replacement = f.tree.element(f.root); let top = 0;
  Object.defineProperty(f.reader, 'scrollTop', { get: () => top, set: value => { top = value; f.refs.reader = replacement; } });
  expect(f.view.scroll({ top: 44, left: 18 })).toBe(false);
  expect(top).toBe(44); expect(f.reader.scrollLeft).toBe(0); expect(replacement.scrollLeft).toBe(0);
  f.view.destroy();
});

test('image decode renders only original canonical bytes and preserves canonical scroll/zoom', async () => {
  const f = fixture(), pending = f.view.render();
  expect(f.image.src).toBe(f.document.edits.imageContent || f.document.content);
  expect(f.view.describePage()).toBeNull(); f.decodes[0].resolve(); expect(await pending).toBe(true);
  expect(f.image.style.width).toBe('2px'); expect(f.image.style.height).toBe('2px');
  expect(f.reader.scrollTop).toBe(31); expect(f.reader.scrollLeft).toBe(7);
  expect(f.view.describePage()).toEqual({ documentId: 'document-one', revision: 2, page: 1, width: 1, height: 1, rotation: 0 });
  expect(f.view.describe().fileRevision).toBe(4); expect(f.view.describe().rendered).toBe(true);
  expect(f.image.style.imageOrientation).toBe('none');
  expect(f.view.projectRect({ x: 0, y: 0, width: 1, height: 1 })).toBeNull();
  expect(f.view.captureSelection()).toBeNull(); expect(f.view.selectAll()).toBe(false); expect(f.view.point(90, 90)).toBeNull();
  f.session.scroll = { top: 12, left: 4 }; expect(f.view.describePage()).toBeNull();
  f.view.destroy();
});

const invalidations = {
  'root replacement': f => { f.refs.root = f.tree.element(null, { 'data-preview-window': 'preview-one' }); f.refs.root.mounted = true; },
  'root disconnection': f => { f.root.mounted = false; },
  'window attribute replacement': f => { f.root.setAttribute('data-preview-window', 'other-window'); },
  'session replacement with equal public identity': f => { f.refs.session = { ...f.session }; },
  'document replacement with equal public identity': f => { f.refs.document = { ...f.document }; },
  'document revision': f => { f.document.revision++; },
  'file revision': f => { f.document.fileRevision++; },
  'file identity': f => { f.document.fileId = 'other-file'; },
  'selected document identity': f => { f.session.selectedId = 'other-document'; },
  'reader replacement': f => { f.refs.reader = f.tree.element(f.root); },
  'canvas replacement': f => { f.refs.canvas = f.tree.element(f.root); },
  'text-layer replacement': f => { f.refs.text = f.tree.element(f.root); },
  'image replacement': f => { f.refs.image = f.tree.element(f.root); },
  'decoded source replacement': f => { f.image.src = 'data:image/png;base64,different-original-source'; },
  'page navigation': f => { f.session.page++; },
  'zoom': f => { f.session.zoom++; },
  'canonical scroll': f => { f.session.scroll = { top: 11, left: 2 }; },
  'locked original': f => { f.document.edits.lock.enabled = true; f.document.unlocked = false; },
  'view visibility': f => { f.refs.available = false; },
};
for (const [name, invalidate] of Object.entries(invalidations)) {
  test(`late image decode rejects ${name} without touching replacement nodes`, async () => {
    const f = fixture(), pending = f.view.render(); invalidate(f); f.decodes[0].resolve();
    expect(await pending).toBe(false); expect(f.view.describePage()).toBeNull();
    expect(f.image.style.width).toBeUndefined(); expect(f.refs.image.style.width).toBeUndefined();
    expect(f.reader.scrollTop).toBe(0); f.view.destroy();
  });
}

test('external ownership guard is checked after the original decoder await', async () => {
  const f = fixture(); let current = true; const pending = f.view.render(() => current);
  current = false; f.decodes[0].resolve(); expect(await pending).toBe(false);
  expect(f.image.style.width).toBeUndefined(); expect(f.view.describePage()).toBeNull(); f.view.destroy();
});

test('an older decode cannot clear a completed newer revision or borrow its render ticket', async () => {
  const f = fixture(), first = f.view.render(); f.document.revision++;
  const second = f.view.render(); f.decodes[1].resolve(); expect(await second).toBe(true);
  const description = f.view.describePage(); f.decodes[0].resolve(); expect(await first).toBe(false);
  expect(f.view.describePage()).toEqual(description); expect(description.revision).toBe(3);
  expect(f.view.describe().rendered).toBe(true); f.view.destroy();
});

test('destroy retires the original pending view without late DOM success', async () => {
  const f = fixture(), pending = f.view.render(); f.view.destroy(); f.view.destroy(); f.decodes[0].resolve();
  expect(await pending).toBe(false); expect(f.view.available()).toBe(false); expect(f.image.style.width).toBeUndefined();
  expect(f.view.describePage()).toBeNull(); expect(await f.view.render()).toBe(false);
});

test('a failed real decode is reported, never replaced with manufactured page/text success', async () => {
  const f = fixture(), pending = f.view.render(); f.decodes[0].reject(new Error('Original image decoder refused the bytes'));
  expect(await pending).toBe(false); expect(f.view.describe().error).toBe('Original image decoder refused the bytes');
  expect(f.view.describePage()).toBeNull(); expect(f.image.style.width).toBeUndefined(); f.view.destroy();
});

test('image thumbnails draw the original decoded pixels at bounded DPR, never a placeholder', async () => {
  const f = fixture(), thumbnail = f.tree.element(f.root, { 'data-preview-thumbnail': '1' }), draws = [];
  thumbnail.getContext = () => ({ drawImage: (...args) => draws.push(args) });
  f.refs.thumbnails = [{ canvas: thumbnail, page: 1 }];
  const pending = f.view.render(); f.decodes[0].resolve(); expect(await pending).toBe(true);
  expect(draws).toEqual([[f.bitmaps[0], 0, 0, 240, 240]]); expect(f.bitmaps[0].closed).toBe(true);
  expect(f.bitmapInputs[0].options).toEqual({ imageOrientation: 'none' });
  expect(new Uint8Array(await f.bitmapInputs[0].blob.arrayBuffer())).toEqual(decodePreviewData(PNG).bytes);
  expect(thumbnail.width).toBe(240); expect(thumbnail.height).toBe(240);
  expect(thumbnail.style.width).toBe('120px'); expect(thumbnail.style.height).toBe('120px');
  f.view.destroy();
});

test('a thumbnail replacement across decode cannot borrow the original render', async () => {
  const f = fixture(), thumbnail = f.tree.element(f.root, { 'data-preview-thumbnail': '1' }), draws = [];
  thumbnail.getContext = () => ({ drawImage: (...args) => draws.push(args) });
  f.refs.thumbnails = [{ canvas: thumbnail, page: 1 }];
  const pending = f.view.render();
  const replacement = f.tree.element(f.root, { 'data-preview-thumbnail': '1' });
  replacement.getContext = () => ({ drawImage: (...args) => draws.push(args) });
  f.refs.thumbnails = [{ canvas: replacement, page: 1 }];
  f.decodes[0].resolve(); expect(await pending).toBe(false);
  expect(draws).toEqual([]); expect(replacement.style.width).toBeUndefined();
  expect(f.view.describePage()).toBeNull(); f.view.destroy();
});

test('thumbnail identity is checked again after obtaining the original canvas context', async () => {
  const f = fixture(), thumbnail = f.tree.element(f.root, { 'data-preview-thumbnail': '1' }), draws = [];
  f.refs.thumbnails = [{ canvas: thumbnail, page: 1 }];
  thumbnail.getContext = () => {
    f.refs.thumbnails = [];
    return { drawImage: (...args) => draws.push(args) };
  };
  const pending = f.view.render(); f.decodes[0].resolve(); expect(await pending).toBe(false);
  expect(draws).toEqual([]); expect(f.view.describePage()).toBeNull(); f.view.destroy();
});

test('images exceeding the codec pixel limit fail before native sizing or thumbnails', async () => {
  const f = fixture(), bytes = decodePreviewData(PNG).bytes, header = new DataView(bytes.buffer);
  header.setUint32(16, 4096); header.setUint32(20, 2048);
  f.document.content = encodePreviewData(bytes, 'image/png');
  expect(await f.view.render()).toBe(false); expect(f.decodes).toHaveLength(0);
  expect(f.image.style.width).toBeUndefined(); expect(f.view.describePage()).toBeNull();
  expect(f.view.describe().error).toContain('limit'); f.view.destroy();
});

test('effective CropBox intersection, not the nominal CropBox, owns source selection geometry', async () => {
  const pdf = await PDFDocument.create(), page = pdf.addPage([400, 300]);
  page.setMediaBox(10, 20, 300, 200); page.setCropBox(-20, 50, 420, 300);
  page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
  const resource = await openPreviewPdf(encodePreviewData(await pdf.save(), 'application/pdf'));
  try {
    const actual = await resource.document.getPage(1), viewport = actual.getViewport({ scale: 1 });
    expect(actual.view).toEqual([10, 50, 310, 220]);
    const bounds = { left: 80, top: 60, width: 600, height: 340 };
    close(previewPdfSourcePoint(viewport, bounds, 100, 90), { x: 20, y: 30 });
    close(previewPdfSourceRect(viewport, bounds, { left: 70, top: 90, width: 45, height: 17 }),
      { x: 0, y: 30, width: 35, height: 17 });
  } finally { await resource.destroy(); }
});

test('clamped native scroll measurements, not requested offsets, are described', () => {
  const f = fixture(); let top = 0, left = 0;
  Object.defineProperty(f.reader, 'scrollTop', { get: () => top, set: value => { top = Math.min(98, value); } });
  Object.defineProperty(f.reader, 'scrollLeft', { get: () => left, set: value => { left = Math.min(4, value); } });
  expect(f.view.scroll({ top: 10000, left: 10000 })).toBe(true);
  expect(f.view.describe().scroll).toEqual({ top: 98, left: 4 });
  f.refs.root = f.tree.element(); f.refs.root.mounted = true;
  expect(f.view.describe().scroll).toBeNull(); f.view.destroy();
});

test('an empty original root can focus a real control without inventing a reader or document', async () => {
  const f = fixture(); f.refs.document = null; f.refs.reader = null;
  f.session.selectedId = null; f.session.documentIds = [];
  expect(f.view.focus('search')).toBe(true); expect(f.view.scroll({ top: 0, left: 0 })).toBe(false);
  expect(await f.view.render()).toBe(false); expect(f.view.describePage()).toBeNull(); f.view.destroy();
});

test('a late raw bitmap decoder cannot paint after original file revision changes and must close its resource', async () => {
  const f = fixture(), thumbnail = f.tree.element(f.root, { 'data-preview-thumbnail': '1' }), draws = [], decode = deferred();
  thumbnail.getContext = () => ({ drawImage: (...args) => draws.push(args) });
  f.refs.thumbnails = [{ canvas: thumbnail, page: 1 }];
  f.tree.document.defaultView.createImageBitmap = () => decode.promise;
  const pending = f.view.render(); f.decodes[0].resolve(); await Promise.resolve();
  f.document.fileRevision++;
  const bitmap = { width: 1, height: 1, closed: false, close() { this.closed = true; } };
  decode.resolve(bitmap); expect(await pending).toBe(false);
  expect(bitmap.closed).toBe(true); expect(draws).toEqual([]); expect(f.image.style.width).toBeUndefined();
  expect(f.view.describePage()).toBeNull(); f.view.destroy();
});

test('raw bitmap dimensions must match genuine encoded header axes before any original canvas paint', async () => {
  const f = fixture(), thumbnail = f.tree.element(f.root, { 'data-preview-thumbnail': '1' }), draws = [];
  const bitmap = { width: 2, height: 1, closed: false, close() { this.closed = true; } };
  thumbnail.getContext = () => ({ drawImage: (...args) => draws.push(args) });
  f.refs.thumbnails = [{ canvas: thumbnail, page: 1 }];
  f.tree.document.defaultView.createImageBitmap = () => Promise.resolve(bitmap);
  const pending = f.view.render(); f.decodes[0].resolve(); expect(await pending).toBe(false);
  expect(bitmap.closed).toBe(true); expect(draws).toEqual([]); expect(f.view.describePage()).toBeNull();
  expect(f.view.describe().error).toContain('encoded pixel coordinates'); f.view.destroy();
});

test('an original reader resize across decode rejects the obsolete viewport before native sizing',async()=>{
 const f=fixture(),pending=f.view.render();f.reader.clientWidth=640;f.decodes[0].resolve();
 expect(await pending).toBe(false);expect(f.view.describePage()).toBeNull();expect(f.image.style.width).toBeUndefined();f.view.destroy();
});
test('acknowledged measured scrolling preserves the original rendered image owner',async()=>{
 const f=fixture(),pending=f.view.render();f.decodes[0].resolve();expect(await pending).toBe(true);
 expect(f.view.scroll({top:44,left:18})).toBe(true);f.session.scroll={top:f.reader.scrollTop,left:f.reader.scrollLeft};
 expect(f.view.describePage()).toEqual({documentId:'document-one',revision:2,page:1,width:1,height:1,rotation:0});
 f.refs.reader=f.tree.element(f.root);expect(f.view.describePage()).toBeNull();f.view.destroy();
});

test('an image reader cannot attach or emit PDF reading observations',()=>{
 const f=fixture();let observations=0;
 expect(f.view.bindReadingProgress({documentId:'document-one',fileId:'file-one',fileRevision:4,guard:()=>true,onReadingProgress:()=>{observations++;return true;}})).toBe(false);
 expect(observations).toBe(0);expect(f.view.clearReadingProgress()).toBe(false);f.view.destroy();
});
test('binding an actual PDF source or requesting a failed native raster never advances reading progress',async()=>{
 const f=fixture();f.document.mime='application/pdf';f.document.content=await pdfFixture();
 f.document.pages=[{width:240,height:120,rotation:0,text:''}];let observations=0;
 const binding={documentId:'document-one',fileId:'file-one',fileRevision:4,guard:()=>true,onReadingProgress:()=>{observations++;return true;}};
 expect(f.view.bindReadingProgress(binding)).toBe(true);expect(observations).toBe(0);
 // No original PDF canvas/TextLayer exists: real bytes alone are not a paint.
 expect(await f.view.render()).toBe(false);expect(observations).toBe(0);
 expect(f.view.clearReadingProgress('another-file')).toBe(false);
 expect(f.view.clearReadingProgress('file-one')).toBe(true);
 expect(f.view.bindReadingProgress(binding)).toBe(true);f.view.destroy();
 expect(f.view.clearReadingProgress()).toBe(false);expect(f.view.bindReadingProgress(binding)).toBe(false);
});

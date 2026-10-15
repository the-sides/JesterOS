import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { compile } from 'svelte/compiler';
import { createApplicationFileBridges } from './application-file-bridges.js';
import { canonicalStringUnits, copyCanonicalData } from './canonical-data.js';
import { rootFileId } from './disk-family-state.js';
import { createPagesCommands } from './pages-commands.js';
import { createPagesState, validatePagesState, pagesWindow, pagesDocument, pagesDirty, pagesText, pagesDefaultRun, pagesCreateDocument, pagesAllocate, pagesReplaceRange, pagesFormatRange, pagesSelectedText, pagesCapabilities, pagesMenus, pagesCatalog, pagesDefaultToolbar, PAGES_PROFILES } from './pages-model.js';
import { pagesDefaultFiles, pagesCodecDocument } from './pages-documents.js';
import { encodeDOCX, decodeDOCX } from './createoffice-xml-codec.js';
import { pagesPDF } from './pages-pdf.js';
import { createPagesNativeView, pagesNativeDifference } from './pages-native.js';
import { pagesChartGeometry, pagesEstimatePages } from './pages-render.js';
import { PREVIEW_IMAGE_CONTENT } from './preview-image-fixture.js';

// Production actor + production planned Files transaction, not fabricated saves.
// Injected hooks below deliberately attack an in-flight ownership boundary.
function fixture(profileId = PAGES_PROFILES[1]) {
  const profile = { id: profileId, family: profileId.startsWith('windows') ? 'windows' : 'macos' }, state = createPagesState(profile), root = rootFileId(profile);
  const row = (id, parentId, name, kind) => ({ id, parentId, name, kind, content: '', revision: 1, deleted: false });
  const store = { nextFileId: 1, files: [{ ...row(root, null, 'Startup', 'folder'), volumeId: 'startup-volume', mounted: true, driveLetter: profile.family === 'windows' ? 'C' : null }, row('documents', root, 'Documents', 'folder'), row('trash', root, 'Trash', 'folder')] };
  const windows = new Map(), views = new Map(), clipboard = { kind: 'text', text: '', fileIds: [] };
  let time = 1720000000000, held = 0, quota = 4 * 1024 * 1024, disposed = false, hook = null, serial = 1;
  const units = () => canonicalStringUnits(state) + canonicalStringUnits(store) + canonicalStringUnits(clipboard);
  const canCommit = delta => units() + held + delta <= quota;
  const services = createApplicationFileBridges({ profile, getStore: () => store, alive: () => !disposed, getSceneTime: () => time, canCommit, getClipboard: () => clipboard, makeRecord: copyCanonicalData, reserve(delta, callback) { held += delta; try { return callback() === true; } finally { held -= delta; } } });
  let controller;
  const ctx = { ...services, profile, getState: () => state, getWindow: id => windows.get(id) ?? null, getWindows: () => [...windows.values()], getView: id => views.get(id) ?? null, available: window => windows.get(window.id) === window, alive: () => !disposed, getSceneTime: () => time, canCommit, getClipboard: () => clipboard, tick: async () => {},
    async readFile(id, ownership) { const response = services.readFile(id, ownership); if (hook) await hook('read', { id, ownership, response }); return response; },
    async createWindow(appId, options) { if (options.isCurrent?.() !== true) return null; const actual = { id: `pages-window-${serial++}`, appId }; windows.set(actual.id, actual); if (!controller.windowOpened(actual, options)) { windows.delete(actual.id); return null; } return actual.id; },
    async closeWindow(id, ownership) { const actual = windows.get(id); if (!actual || ownership.guard() !== true || !controller.windowClosed(actual, ownership)) return false; windows.delete(id); views.delete(id); return true; },
    async chooseFile(spec, ownership) { if (hook) await hook('choose', { spec, ownership }); if (ownership.guard() !== true) return { status: 'rejected', error: { code: 'stale_target', message: 'Original chooser source changed.' } }; const file = store.files.find(row => row.mime === spec.accept[0]); return file ? { status: 'applied', target: { fileId: file.id } } : { status: 'rejected', error: { code: 'cancelled', message: 'No File chosen.' } }; },
  };
  controller = createPagesCommands(ctx);
  const actual = { id: 'pages-window', appId: pagesCapabilities(profile).appId }; windows.set(actual.id, actual); assert.equal(controller.windowOpened(actual), true);
  const session = pagesWindow(state, actual.id), view = { available: () => windows.get(actual.id) === actual, captureSelection: () => copyCanonicalData(session.selection), describe: () => ({ editor: 'test-retained-original' }), imageDimensions: async (content, guard) => guard() && content === PREVIEW_IMAGE_CONTENT ? { width: 960, height: 640 } : null };
  views.set(actual.id, view);
  return { profile, state, store, ctx, services, controller, actual, session, view, views, windows, clipboard, units,
    command: (suffix, payload = {}, windowId = actual.id) => controller.handlers[`pages.${suffix}`]({ windowId }, payload),
    document: () => pagesDocument(state, session.documentId), setQuota: value => { quota = value; }, setTime: value => { time = value; }, setHook: value => { hook = value; }, dispose: () => { disposed = true; controller.dispose(); },
    seed(spec = pagesDefaultFiles(profile)[0]) { const result = services.createFile(spec, { guard: () => true }); assert.equal(result.status, 'applied'); return result.file; },
  };
}

for (const profile of PAGES_PROFILES) test(`${profile}: chooser, rich objects, genuine DOCX, multi-document history and browser`, async () => {
  const f = fixture(profile), originalGraph = f.state, windows = f.state.windows, documents = f.state.documents;
  assert.equal(f.session.mode, 'templates'); assert.equal(f.actual.appId, profile.startsWith('windows') ? 'pages-local' : 'pages');
  assert.equal((await f.command('create', { template: 'report' })).status, 'applied');
  const doc = f.document(), content = doc.content, block = content.blocks[0], runs = block.runs;
  assert.equal((await f.command('text.format', { blockId: block.id, start: 0, end: 7, style: { bold: true, italic: true, color: '#aa3322' } })).status, 'applied');
  assert.equal(doc.content, content); assert.equal(doc.content.blocks[0], block); assert.equal(block.runs, runs);
  assert.equal((await f.command('text.replace', { blockId: block.id, start: 0, end: 7, text: 'Harbor' })).status, 'applied');
  const edited = pagesText(block); await f.command('undo'); assert.notEqual(pagesText(block), edited); await f.command('redo'); assert.equal(pagesText(block), edited);
  await f.command('table.insert', { rows: 2, columns: 2 }); const table = content.blocks.at(-1), cell = table.rows[0][0];
  await f.command('table.cell', { blockId: table.id, row: 0, column: 0, text: 'Actual cell' }); assert.equal(table.rows[0][0], cell); assert.equal(cell.text, 'Actual cell');
  await f.command('chart.insert', { kind: 'line' }); const chart = content.blocks.at(-1);
  await f.command('chart.edit', { blockId: chart.id, kind: 'bar', title: 'Actual series', labels: ['A', 'B'], values: [11, 21] }); assert.equal(chart.title, 'Actual series');
  const image = f.seed({ name: 'Harbor.png', mime: 'image/png', content: PREVIEW_IMAGE_CONTENT, parentId: 'documents' });
  assert.equal((await f.command('image.insert', { fileId: image.id })).status, 'applied');
  const save = await f.command('save', { name: 'Rich Report.docx' }); assert.equal(save.status, 'applied'); assert.equal(pagesDirty(doc), false);
  const file = f.services.getFile(save.fileId), decoded = decodeDOCX(file.content);
  assert.ok(decoded.blocks.some(row => row.type === 'table' && row.rows[0][0].text === 'Actual cell')); assert.ok(decoded.blocks.some(row => row.type === 'chart' && row.title === 'Actual series')); assert.ok(decoded.blocks.some(row => row.type === 'image' && row.content === PREVIEW_IMAGE_CONTENT));
  const zip = unzipSync(new Uint8Array(Buffer.from(file.content.split(',')[1], 'base64'))); assert.ok(zip['word/document.xml']); assert.ok(Object.keys(zip).some(name => name.startsWith('word/charts/'))); assert.match(strFromU8(zip['word/document.xml']), /w:tbl/u);
  assert.equal(f.state, originalGraph); assert.equal(f.state.windows, windows); assert.equal(f.state.documents, documents);
  const browser = await f.command('browser'); assert.ok(browser.files.some(row => row.id === file.id));
  await f.command('create', { template: 'blank' }); const second = f.document(); assert.notEqual(second.id, doc.id); assert.equal(f.state.documents.length, 2);
  await f.command('document.switch', { documentId: doc.id }); assert.equal(f.document(), doc); assert.equal(doc.content, content);
  assert.equal(validatePagesState(f.state, f.profile).ok, true);
});

test('exact planned actor delta, old existing fields, strict third metadata and stable File identity', async () => {
  const f = fixture(); await f.command('create', { template: 'blank' }); await f.command('save', { name: 'Atomic.docx' });
  const doc = f.document(), file = f.services.getFile(doc.fileId), oldContent = file.content, oldRevision = file.revision;
  await f.command('text.replace', { blockId: doc.content.blocks[0].id, start: 0, end: 0, text: 'New original content' });
  let callback = false;
  f.ctx.createFile = (spec, ownership) => f.services.createFile({ ...spec, onCommit(id, original, third) { callback = true; assert.equal(original, file); assert.equal(original.content, oldContent); assert.equal(original.revision, oldRevision); assert.equal(third, spec.plan.metadata); assert.equal(third.revision, oldRevision + 1); const before = canonicalStringUnits(f.state), result = spec.onCommit(id, original, third); assert.equal(canonicalStringUnits(f.state) - before, spec.reserveTextUnits); return result; } }, ownership);
  assert.equal((await f.command('save')).status, 'applied'); assert.equal(callback, true); assert.equal(f.services.getFile(doc.fileId), file); assert.equal(doc.fileRevision, file.revision); assert.notEqual(file.content, oldContent); assert.equal(pagesDirty(doc), false);
});

test('lying third metadata, callback false and quota overflow publish neither actor nor Files', async () => {
  const f = fixture(); await f.command('create', { template: 'blank' });
  const before = JSON.stringify({ state: f.state, files: f.store });
  f.ctx.createFile = (spec, ownership) => f.services.createFile({ ...spec, onCommit: (id, original, metadata) => spec.onCommit(id, original, { ...metadata, revision: metadata.revision + 1 }) }, ownership);
  assert.equal((await f.command('save', { name: 'Rejected.docx' })).status, 'rejected'); assert.equal(JSON.stringify({ state: f.state, files: f.store }), before);
  f.ctx.createFile = f.services.createFile; f.setQuota(f.units()); assert.equal((await f.command('save', { name: 'Quota.docx' })).error.code, 'limit_exceeded'); assert.equal(JSON.stringify({ state: f.state, files: f.store }), before);
});

for (const changed of ['graph', 'nested', 'window', 'view', 'file', 'time']) test(`awaited read rejects replaced original ${changed}`, async () => {
  const f = fixture(), file = f.seed(); const beforeDocuments = JSON.stringify(f.state.documents);
  f.setHook((phase) => { if (phase !== 'read') return; if (changed === 'graph') f.ctx.getState = () => copyCanonicalData(f.state); if (changed === 'nested') f.state.windows[0].selection = { ...f.state.windows[0].selection }; if (changed === 'window') f.windows.set(f.actual.id, { ...f.actual }); if (changed === 'view') f.views.set(f.actual.id, { ...f.view }); if (changed === 'file') f.store.files[f.store.files.indexOf(file)] = copyCanonicalData(file); if (changed === 'time') f.setTime(1720000000001); });
  assert.equal((await f.command('open', { fileId: file.id })).error.code, 'stale_target'); assert.equal(JSON.stringify(f.state.documents), beforeDocuments);
});

test('original picker source is guarded and a copied read File is not accepted', async () => {
  const f = fixture(); f.seed(); f.setHook(phase => { if (phase === 'choose') f.setTime(1720000000001); });
  assert.equal((await f.command('open')).error.code, 'stale_target'); assert.equal(f.state.documents.length, 0);
  f.setHook(null); const file = f.store.files.find(row => row.mime?.includes('wordprocessingml')); const productionRead = f.services.readFile;
  f.ctx.readFile = (id, owner) => { const actual = productionRead(id, owner); return { ...actual, file: copyCanonicalData(actual.file) }; };
  assert.equal((await f.command('open', { fileId: file.id })).status, 'rejected'); assert.equal(f.state.documents.length, 0);
});

test('multi-paragraph native ranges retain both boundary styles and undo all affected objects', async () => {
  const f = fixture(); await f.command('create', { template: 'blank' }); const doc = f.document(), first = doc.content.blocks[0];
  await f.command('text.replace', { blockId: first.id, start: 0, end: 0, text: 'Alpha' }); await f.command('text.split', { blockId: first.id, start: 5, end: 5 }); const second = doc.content.blocks[1]; await f.command('text.replace', { blockId: second.id, start: 0, end: 0, text: 'Bravo' });
  const range = { blockId: first.id, start: 2, endBlockId: second.id, end: 3 };
  assert.equal(pagesSelectedText(doc.content, range), 'pha\nBra'); assert.equal((await f.command('text.format', { ...range, style: { italic: true } })).status, 'applied');
  assert.equal((await f.command('selection', range)).status, 'applied'); assert.equal((await f.command('cut')).status, 'applied'); assert.equal(f.clipboard.text, 'pha\nBra'); assert.equal(doc.content.blocks.length, 1); assert.equal(pagesText(first), 'Alvo');
  await f.command('undo'); assert.equal(doc.content.blocks.length, 2); assert.equal(pagesText(doc.content.blocks[1]), 'Bravo');
  assert.throws(() => pagesReplaceRange(doc.content, { ...range, start: 99 }, 'X'), /unavailable/u);
  const snapshot = copyCanonicalData(doc.content); pagesFormatRange(snapshot, { blockId: first.id, start: 5, endBlockId: snapshot.blocks[1].id, end: 0 }, { bold: true }); assert.equal(snapshot.blocks[0].runs[0].bold, doc.content.blocks[0].runs[0].bold);
});

test('dirty close cancel/discard/save and multiple actual document windows', async () => {
  const f = fixture(); await f.command('create', { template: 'letter' });
  const newWindow = await f.command('window.new', { documentId: f.document().id }); assert.equal(newWindow.status, 'applied'); assert.equal(f.state.windows.length, 2);
  assert.equal((await f.command('window.close', {}, newWindow.target.windowId)).status, 'applied');
  assert.equal((await f.command('window.close')).confirmationRequired, true); assert.equal(f.session.dialog, 'close'); assert.equal(f.controller.appQuit(f.actual.appId), false);
  await f.command('dialog', { dialog: null }); assert.equal(f.session.closing, false);
  await f.command('window.close'); assert.equal((await f.command('save', { name: 'Close Save.docx' })).status, 'applied'); assert.equal(f.windows.has(f.actual.id), false); assert.equal(f.state.windows.length, 0);
  const g = fixture(); await g.command('create', { template: 'blank' }); assert.equal((await g.command('window.close', { discard: true })).status, 'applied'); assert.equal(g.state.documents.length, 0);
});

test('proprietary Pages packages, invalid pie series and impossible margins are honest atomic rejections', async () => {
  const f = fixture(), native = f.seed({ name: 'Original.pages', mime: 'application/vnd.apple.pages', content: 'not a DOCX package', parentId: 'documents' });
  assert.match((await f.command('open', { fileId: native.id })).error.message, /IWA/u); assert.equal(f.state.documents.length, 0);
  await f.command('create', { template: 'blank' }); await f.command('chart.insert', { kind: 'pie' }); const chart = f.document().content.blocks.at(-1), before = JSON.stringify(f.state);
  assert.equal((await f.command('chart.edit', { blockId: chart.id, kind: 'pie', title: 'Bad', labels: ['A'], values: [-1] })).status, 'rejected'); assert.equal(JSON.stringify(f.state), before);
  assert.equal((await f.command('page', { width: 144, height: 144, margin: 100 })).status, 'rejected'); assert.equal(JSON.stringify(f.state), before);
});

test('DOCX asymmetric margins, text marks and media survive real import/export projections', async () => {
  const f = fixture(), document = pagesCreateDocument(createPagesState(f.profile), 'blank'); document.content.page.margin = { top: 40, right: 50, bottom: 60, left: 70 }; document.content.blocks[0].runs = [{ ...pagesDefaultRun('Half-point typography'), size: 11.5, bold: true, italic: true, underline: true }];
  const encoded = encodeDOCX(pagesCodecDocument(document.content)), file = f.seed({ name: 'Margins.docx', mime: encoded.mime, content: encoded.content, parentId: 'documents' });
  assert.equal((await f.command('open', { fileId: file.id })).status, 'applied'); assert.deepEqual(f.document().content.page.margin, document.content.page.margin); assert.equal(f.document().content.blocks[0].runs[0].size, 11.5); assert.equal(f.document().content.blocks[0].runs[0].underline, true);
});

test('PDF contains real pages, image resources, vector chart operations and actual paper size', async () => {
  const state = createPagesState(PAGES_PROFILES[2]), doc = pagesCreateDocument(state, 'report'); doc.content.page = { width: 595.28, height: 841.89, margin: { top: 48, right: 50, bottom: 52, left: 54 } };
  doc.content.blocks.push({ id: pagesAllocate(state, 'pages-block'), type: 'image', content: PREVIEW_IMAGE_CONTENT, width: 420, height: 280, alt: 'Harbor' }); doc.content.blocks.push({ id: pagesAllocate(state, 'pages-block'), type: 'chart', kind: 'pie', title: 'Real vector chart', labels: ['A', 'B'], values: [10, 20] });
  const font = new Uint8Array(await readFile(new URL('../public/fonts/LiberationSans-Regular.ttf', import.meta.url))), result = await pagesPDF(doc.content, 1720000000000, { fontLoader: async () => font }), pdf = await PDFDocument.load(Buffer.from(result.content.split(',')[1], 'base64'));
  assert.equal(pdf.getPageCount(), result.pages); assert.equal(pdf.getTitle(), doc.content.title); assert.ok(Math.abs(pdf.getPage(0).getWidth() - 595.28) < .01); assert.ok(result.content.startsWith('data:application/pdf;base64,JVBER'));
  assert.match(result.fontSubstitution, /Liberation Sans/u); assert.equal(pagesChartGeometry(doc.content.blocks.at(-1)).marks.filter(row => row.type === 'polygon').length, 2);
  let original = true; await assert.rejects(pagesPDF(doc.content, 1720000000000, { guard: () => original, fontLoader: async () => { original = false; return font; } }), error => error.code === 'stale_target');
});

test('mounted facade never accepts replaced root, state, window, profile or retired controls', () => {
  const f = fixture(), root = { isConnected: true, querySelectorAll: () => [], ownerDocument: { getSelection: () => null } }; let actualRoot = root, actualState = f.state, actualWindow = f.actual, actualProfile = f.profile;
  const view = createPagesNativeView({ getRoot: () => actualRoot, getState: () => actualState, getWindow: () => actualWindow, getProfile: () => actualProfile, windowId: f.actual.id, available: () => true });
  assert.equal(view.available(), true); actualRoot = { ...root }; assert.equal(view.available(), false); actualRoot = root; actualState = copyCanonicalData(f.state); assert.equal(view.available(), false); actualState = f.state; actualWindow = { ...f.actual }; assert.equal(view.available(), false); actualWindow = f.actual; actualProfile = { ...f.profile }; assert.equal(view.available(), false); actualProfile = f.profile; view.destroy(); assert.equal(view.available(), false); assert.equal(view.focus('save-confirm'), false);
  assert.deepEqual(pagesNativeDifference('First text', 'First changed text'), { start: 6, end: 6, text: 'changed ' });
});

test('native Svelte component compiles and every menu command is a real closed catalog request', async () => {
  const source = await readFile(new URL('./PagesApp.svelte', import.meta.url), 'utf8'); assert.ok(compile(source, { filename: 'PagesApp.svelte', generate: 'client' }).js.code.length > 0);
  const f = fixture(); for (const group of pagesMenus({ state: f.state, profile: f.profile, windowId: f.actual.id })) for (const item of group.children) if (item.request?.command.startsWith('pages.')) assert.ok(Object.hasOwn(pagesCatalog, item.request.command));
});

test('only Root receives genuine print/share packets and opening a destination does not claim delivery', async () => {
  const f = fixture(); await f.command('create', { template: 'report' });
  let sharePacket;
  f.ctx.share = async (spec, owner) => { assert.equal(owner.guard(), true); assert.equal(spec.source.documentId, f.document().id); assert.equal(spec.source.appId, f.actual.appId); assert.equal(spec.source.windowId, f.actual.id); sharePacket = spec; decodeDOCX(spec.content); return { status: 'applied', shareId: 'root-share-panel', windowId: 'root-share-destination' }; };
  const response = await f.command('share'); assert.equal(response.status, 'applied'); assert.equal(response.delivered, false); assert.equal(response.printed, false); assert.ok(sharePacket.content.startsWith('data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEs')); assert.equal(f.store.files.length, 3);
  f.ctx.share = async () => ({ status: 'rejected', error: { code: 'cancelled', message: 'Root cancelled its destination.' } });
  assert.equal((await f.command('share')).error.code, 'cancelled');
});

test('metadata clone with equal bytes is not the signed original third argument', async () => {
  const f = fixture(); await f.command('create', { template: 'blank' }); const before = JSON.stringify({ state: f.state, files: f.store });
  f.ctx.createFile = (spec, owner) => f.services.createFile({ ...spec, onCommit: (id, file, metadata) => spec.onCommit(id, file, { ...metadata }) }, owner);
  assert.equal((await f.command('save', { name: 'Clone Metadata.docx' })).status, 'rejected'); assert.equal(JSON.stringify({ state: f.state, files: f.store }), before);
});

test('discarding one dirty window never deletes another retained dirty document', async () => {
  const f = fixture(); await f.command('create', { template: 'report' }); const other = f.document(); await f.command('create', { template: 'blank' }); const closing = f.document();
  assert.equal((await f.command('window.close', { discard: true })).status, 'applied'); assert.equal(f.state.documents.some(row => row.id === closing.id), false); assert.equal(f.state.documents.find(row => row.id === other.id), other); assert.equal(pagesDirty(other), true);
});

test('Print passes a real paginated PDF to the one Root print endpoint without creating a separate print authority', async () => {
  const f = fixture(); await f.command('create', { template: 'report' }); const beforeFiles = JSON.stringify(f.store), font = await readFile(new URL('../public/fonts/LiberationSans-Regular.ttf', import.meta.url));
  const originalFetch = globalThis.fetch; globalThis.fetch = async (url, ...options) => url === '/fonts/LiberationSans-Regular.ttf' ? new Response(font) : originalFetch(url, ...options);
  let packet;
  f.ctx.print = async (spec, ownership) => { assert.equal(ownership.guard(), true); assert.equal(spec.source.documentId, f.document().id); packet = spec; const pdf = await PDFDocument.load(spec.content); assert.ok(pdf.getPageCount() >= 1); return { status: 'applied', printDialogId: 'root-print-panel', windowId: 'root-print-destination' }; };
  try { const response = await f.command('print'); assert.equal(response.status, 'applied'); assert.equal(response.printed, false); assert.equal(packet.mime, 'application/pdf'); assert.ok(packet.content.startsWith('data:application/pdf;base64,JVBER')); assert.equal(JSON.stringify(f.store), beforeFiles); } finally { globalThis.fetch = originalFetch; }
});

test('exact classic toolbar defaults and Share menu match observed Pages 6.3 and 7.2 differences', async () => {
  const high = fixture(PAGES_PROFILES[0]), mojave = fixture(PAGES_PROFILES[1]);
  assert.equal(pagesCapabilities(high.profile).era, 'Pages 6.3-era'); assert.equal(pagesCapabilities(mojave.profile).era, 'Pages 7.2-era');
  assert.equal(high.session.toolbar.items.includes('page'), false); assert.equal(mojave.session.toolbar.items[2], 'page'); assert.equal(mojave.session.toolbar.items.includes('share'), false);
  for (const f of [high, mojave]) { await f.command('create', { template: 'report' }); const menus = pagesMenus({ state: f.state, profile: f.profile, windowId: f.actual.id }), ids = menus.map(row => row.id); assert.equal(ids.indexOf('share'), ids.indexOf('view') + 1); assert.equal(ids.indexOf('window'), ids.indexOf('share') + 1); assert.ok(menus.find(row => row.id === 'share').children.every(row => row.request.command === 'pages.share')); }
});

test('toolbar hide/customize/icons/reorder/reset are canonical and Format/Document remains inseparable', async () => {
  const f = fixture(), toolbar = f.session.toolbar, items = toolbar.items; await f.command('create', { template: 'blank' });
  assert.equal((await f.command('toolbar', { visible: false, iconsOnly: true, items: ['media', 'inspector', 'text'] })).status, 'applied'); assert.equal(f.session.toolbar, toolbar); assert.equal(toolbar.items, items); assert.deepEqual(items, ['media', 'inspector', 'text']); assert.equal(toolbar.visible, false); assert.equal(toolbar.iconsOnly, true);
  const before = JSON.stringify(f.state); assert.equal((await f.command('toolbar', { items: ['text', 'text'] })).status, 'rejected'); assert.equal(JSON.stringify(f.state), before);
  assert.equal((await f.command('dialog', { dialog: 'toolbar' })).status, 'applied'); assert.equal(f.session.dialog, 'toolbar'); await f.command('toolbar', pagesDefaultToolbar(f.profile)); assert.deepEqual(f.session.toolbar, pagesDefaultToolbar(f.profile)); await f.command('dialog', { dialog: null });
});

test('Add Page inserts an actual blank page after the selected page and survives history, DOCX and PDF', async () => {
  const f = fixture(); await f.command('create', { template: 'report' }); const doc = f.document(), original = doc.content.blocks.map(row => row.id), before = pagesEstimatePages(doc.content);
  assert.equal((await f.command('page.add')).status, 'applied'); const blank = doc.content.blocks.find(row => row.id === f.session.selectedId); assert.equal(blank.pageBreakBefore, true); assert.equal(pagesText(blank), ''); assert.deepEqual(doc.content.blocks.filter(row => row !== blank).map(row => row.id), original); assert.equal(pagesEstimatePages(doc.content).length, before.length + 1);
  await f.command('undo'); assert.equal(doc.content.blocks.some(row => row.id === blank.id), false); await f.command('redo'); assert.equal(doc.content.blocks.find(row => row.id === blank.id).pageBreakBefore, true);
  const saved = await f.command('save', { name: 'Actual Page Break.docx' }); assert.equal(saved.status, 'applied'); const file = f.services.getFile(saved.fileId), decoded = decodeDOCX(file.content); assert.equal(decoded.blocks.at(-1).pageBreakBefore, true);
  const base64 = file.content.split(',')[1], parts = unzipSync(Buffer.from(base64, 'base64')); assert.match(strFromU8(parts['word/document.xml']), /<w:pageBreakBefore\b[^>]*w:val="1"/u);
  const font = await readFile(new URL('../public/fonts/LiberationSans-Regular.ttf', import.meta.url)), pdf = await pagesPDF(doc.content, f.ctx.getSceneTime(), { fontLoader: async () => font }); assert.equal((await PDFDocument.load(pdf.content)).getPageCount(), 2);
  await f.command('create', { template: 'blank' }); const reopened = await f.command('open', { fileId: saved.fileId }); assert.equal(reopened.status, 'applied'); assert.equal(f.document().content.blocks.at(-1).pageBreakBefore, true);
});

test('About delegates to Root native About utility while Help remains the document instructions', () => {
  for (const profile of PAGES_PROFILES) { const f = fixture(profile), menus = pagesMenus({ state: f.state, profile: f.profile, windowId: f.actual.id }), about = menus.find(row => row.id === 'pages').children.find(row => row.id === 'about'), help = menus.find(row => row.id === 'help').children[0]; assert.deepEqual(about.request, { command: 'app.about.open', target: { appId: f.actual.appId }, payload: {} }); assert.equal(help.request.command, 'pages.dialog'); assert.equal(help.request.payload.dialog, 'help'); }
});

test('Add Page follows the clicked original page rather than a stale paragraph selection', async () => {
  const f = fixture(); await f.command('create', { template: 'blank' }); await f.command('page.add'); const doc = f.document(), existingSecond = doc.content.blocks.at(-1), first = doc.content.blocks[0];
  assert.equal((await f.command('page.select', { blockId: first.id })).status, 'applied'); assert.equal(f.session.pageAnchor, first.id); await f.command('page.add'); const added = doc.content.blocks.find(row => row.id === f.session.pageAnchor); assert.equal(doc.content.blocks.indexOf(added), 1); assert.equal(existingSecond.pageBreakBefore, true); assert.equal(doc.content.blocks.at(-1), existingSecond); assert.deepEqual(pagesEstimatePages(doc.content), [[first.id], [added.id], [existingSecond.id]]);
  const before = JSON.stringify(f.state); assert.equal((await f.command('page.select', { blockId: 'foreign-page-block' })).status, 'rejected'); assert.equal(JSON.stringify(f.state), before);
});

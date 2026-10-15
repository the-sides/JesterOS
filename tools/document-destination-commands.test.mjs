import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createMacDesktopFileStore } from '../frontend/src/desktop-file-state.js';
import { createWindows11AppState } from '../frontend/src/windows11-app-state.js';
import { createApplicationFileBridges } from '../frontend/src/application-file-bridges.js';
import { canonicalStringUnits } from '../frontend/src/canonical-data.js';
import { createDocumentDestinationPresentation, createDocumentDestinationCommands, DOCUMENT_DESTINATION_PROFILES } from '../frontend/src/document-destination-commands.js';
import { printingDefaults, validatePrintingState, printedPageTotal, PRINTING_LIMITS } from '../frontend/src/printing-state.js';
import { encodePreviewData, decodePreviewData, openPreviewPdf } from '../frontend/src/preview-codec.js';
import { createTextEditContent } from '../frontend/src/textedit-content.js';
import { encodeTextEditFile } from '../frontend/src/textedit-codec.js';
const requireFrontend = createRequire(new URL('../frontend/package.json', import.meta.url));
const { PDFDocument, StandardFonts } = requireFrontend('pdf-lib');
const clone = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixturePdf(count = 3) {
  const pdf = await PDFDocument.create({ updateMetadata: false }), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let index = 1; index <= count; index++) { const page = pdf.addPage([300, 400]); page.drawText(`Distinct source page ${index}`, { font, x: 20, y: 350 }); }
  return encodePreviewData(await pdf.save({ useObjectStreams: false }), 'application/pdf');
}
async function extracted(content) {
  const resource = await openPreviewPdf(content);
  try { const result = []; for (let page = 1; page <= resource.document.numPages; page++) result.push((await (await resource.document.getPage(page)).getTextContent()).items.map(item => item.str).join(' ')); return result; }
  finally { await resource.destroy(); }
}
function consumer(profileId = DOCUMENT_DESTINATION_PROFILES[1]) {
  const profile = getOSProfile(profileId), time = Date.parse(profile.defaults.sceneTime), windows = new Map(), views = new Map();
  const printing = printingDefaults(), presentation = createDocumentDestinationPresentation(), files = profileId.startsWith('windows') ? createWindows11AppState() : createMacDesktopFileStore(profile, time);
  const clipboard = { kind: 'empty', text: '', fileIds: [] }, drafts = [];
  let controller, windowCounter = 1, active = true, sequence = 0, reserved = 0, limit = 4 * 1024 * 1024, unrelated = 0;
  const sourceWindow = { id: 'source-window', appId: profileId.startsWith('windows') ? 'edge' : 'preview' };
  // Root active-window identity plus the source app's real caret hooks: a
  // retiring destination must return focus/selection only to the still-current
  // original window, never to a user-focused third window.
  let focusId = sourceWindow.id, sourceReturn = null;
  const facade = () => ({ available: () => true, describe: () => ({ connected: true }), proof: () => null, focus: () => true, scroll: () => true,
    editSelection: () => sourceReturn,
    restoreEditSelection: (capture, selection, guard) => {
      if (guard() !== true || capture !== sourceReturn || !capture || !capture.value || selection.start !== capture.start
        || selection.end !== capture.end || selection.direction !== capture.direction) return false;
      focusId = sourceWindow.id; return true;
    } });
  windows.set(sourceWindow.id, sourceWindow); views.set(sourceWindow.id, facade());
  const units = () => canonicalStringUnits({ printing, files: { nextFileId: files.nextFileId, files: files.files.filter(file => !file.readOnly) }, clipboard, drafts }) + unrelated;
  const canCommit = delta => Number.isSafeInteger(delta) && units() + reserved + delta <= limit;
  const reserve = (delta, operation) => { reserved += delta; try { return operation(); } finally { reserved -= delta; } };
  const bridges = createApplicationFileBridges({ profile, getStore: () => files, getClipboard: () => clipboard, getSceneTime: () => time,
    alive: () => active, canCommit, reserve });
  const compose = (kind, spec, ownership) => {
    if (!ownership.guard()) return { status: 'rejected', error: { code: 'stale_target', message: 'Original source retired.' } };
    const draft = { id: `draft-${drafts.length + 1}`, kind, subject: spec.subject, body: spec.body, attachments: clone(spec.attachments), recipient: '' };
    const delta = canonicalStringUnits([...drafts, draft]) - canonicalStringUnits(drafts);
    if (!canCommit(delta + (spec.reserveTextUnits ?? 0))) return { status: 'rejected', error: { code: 'limit_exceeded', message: 'Combined quota exceeded.' } };
    if (!reserve(delta, () => spec.onCommit(draft.id, draft))) return { status: 'rejected', error: { code: 'stale_target', message: 'Draft acknowledgement declined.' } };
    drafts.push(draft); return { status: 'applied', draftId: draft.id, draft };
  };
  const ctx = { profile, getPrinting: () => printing, getPresentation: () => presentation, getFilesStore: () => files, alive: () => active,
    canCommit, getSceneTime: () => time, getWindow: id => windows.get(id), getView: id => views.get(id), available: window => windows.get(window.id) === window,
    getActiveWindowId: () => focusId,
    fontLoader: async () => new Uint8Array(await Bun.file(new URL('../frontend/public/fonts/LiberationSans-Regular.ttf', import.meta.url)).arrayBuffer()),
    tick: async () => {},
    createWindow(appId, options) {
      if (!options.isCurrent()) return null;
      const window = { id: `utility-${windowCounter++}`, appId, utilityKind: options.utilityKind };
      windows.set(window.id, window); views.set(window.id, facade());
      focusId = window.id;
      if (!controller.windowOpened(window, options)) { windows.delete(window.id); views.delete(window.id); focusId = sourceWindow.id; return null; }
      return window.id;
    },
    closeWindow(id, ownership) {
      if (!ownership.guard()) return { status: 'rejected', error: { code: 'stale_target', message: 'Original window changed.' } };
      controller.windowClosed(id); windows.delete(id); views.delete(id);
      if (focusId === id) {
        const target = ownership.returnFocus;
        focusId = target?.guard() === true && windows.get(target.window.id) === target.window ? target.window.id : [...windows.keys()].at(-1) ?? null;
      }
      return { status: 'applied', windowId: id };
    },
    createFile: bridges.createFile, setClipboard: bridges.setClipboard,
    composeMail: (spec, owner) => compose('mail', spec, owner), composeMessage: (spec, owner) => compose('message', spec, owner),
  };
  controller = createDocumentDestinationCommands(ctx);
  const ownership = () => { const version = sequence; return { windowId: sourceWindow.id, guard: () => active && sequence === version }; };
  const run = (suffix, panel, payload = {}, extra = {}) => controller.handlers[`documentDestination.${suffix}`]({ ...(panel ? { panelId: panel.id } : {}), ...extra }, payload);
  return { profile, printing, presentation, files, clipboard, drafts, windows, views, sourceWindow, controller, ctx, bridges, run, ownership,
    get focusId() { return focusId; },
    setActive: id => { focusId = id; },
    setSourceDraft: value => { sourceReturn = { field: 'draft-body', draftId: 'draft-1', start: value.length, end: value.length, direction: 'none', value }; },
    invalidate: () => { sequence++; }, replaceSource: () => windows.set(sourceWindow.id, { ...sourceWindow }), dispose: () => { active = false; controller.dispose(); },
    setLimit: value => { limit = value; }, setUnrelated: value => { unrelated = value; }, units,
    snapshot: () => clone({ printing, files, clipboard, drafts }),
    async openPrint(content, extra = {}) { const result = await controller.printDocument({ title: 'Source.pdf', mime: 'application/pdf', content, documentId: 'document-1', ...extra }, ownership());
      expect(result.status).toBe('applied'); return presentation.panels.find(panel => panel.id === result.printDialogId); },
    async queue() { const result = await run('queue.open', null); expect(result.status).toBe('applied'); return presentation.panels.find(panel => panel.id === result.queueId); },
    async picker(accept = ['application/pdf']) { const result = controller.chooseFile({ accept, multiple: false }, ownership()); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      return { panel: presentation.panels.find(panel => panel.kind === 'picker'), result }; },
    async addFile(name, mime, text) { const result = await bridges.createFile({ name, mime, text }, ownership()); expect(result.status).toBe('applied'); return bridges.getFile(result.fileId); },
  };
}

test('all five profiles open original native print windows and never queue before the actual Print command', async () => {
  const content = await fixturePdf();
  for (const profileId of DOCUMENT_DESTINATION_PROFILES) {
    const c = consumer(profileId), before = c.snapshot();
    const result = await c.controller.printDocument({ title: 'Immutable source', mime: 'application/pdf', content }, c.ownership());
    expect(result).toMatchObject({ status: 'applied', pageCount: 3 }); expect(result.jobId).toBeUndefined();
    const panel = c.presentation.panels.find(row => row.id === result.printDialogId), window = c.windows.get(panel.windowId);
    expect(window).toMatchObject({ appId: profileId.startsWith('windows') ? 'explorer' : 'finder', utilityKind: 'document-print' });
    expect(panel.pageCount).toBe(3); expect(c.snapshot()).toEqual(before);
    expect((await c.run('cancel', panel)).cancelled).toBe(true); expect(c.presentation.panels).toEqual([]); expect(c.snapshot()).toEqual(before);
    c.dispose();
  }
});

test('range/copy settings archive precisely selected genuine pages, exactly once, independently of later source edits', async () => {
  const c = consumer(), content = await fixturePdf(), panel = await c.openPrint(content);
  expect((await c.run('configure', panel, { copies: 3, pageFrom: 2, pageTo: 2 })).status).toBe('applied');
  const first = c.run('print', panel), duplicate = await c.run('print', panel);
  expect(duplicate).toMatchObject({ status: 'rejected', error: { code: 'disabled' } });
  const result = await first; expect(result.status).toBe('applied');
  expect(c.printing.jobs.length).toBe(1); const job = c.printing.jobs[0], archived = c.bridges.getFile(result.fileId);
  expect(job).toMatchObject({ source: { appId: 'preview', windowId: c.sourceWindow.id, documentId: 'document-1' }, mime: 'application/pdf', archiveFileId: result.fileId,
    copies: 3, pageCount: 3, pageFrom: 2, pageTo: 2, status: 'queued', printedPages: 0, createdAt: Date.parse(c.profile.defaults.sceneTime) });
  expect(printedPageTotal(job)).toBe(3); expect(archived.content).toBe(`data:application/pdf;base64,${job.pdfBase64}`);
  expect(await extracted(archived.content)).toEqual(['Distinct source page 2']);
  expect((await PDFDocument.load(decodePreviewData(archived.content).bytes)).getPageCount()).toBe(1);
  const immutable = clone(job); c.invalidate(); c.controller.windowClosed(c.sourceWindow.id); archived.content = 'Edited independently in Files'; archived.revision++;
  expect(job).toEqual(immutable); expect(await extracted(`data:application/pdf;base64,${job.pdfBase64}`)).toEqual(['Distinct source page 2']);
  expect(validatePrintingState(c.printing)).toEqual({ ok: true });
});

test('combined Files-plus-print quota rejects atomically although either destination graph alone fits', async () => {
  const content = await fixturePdf(1), sample = consumer(), before = sample.snapshot(), initial = sample.units(), panel = await sample.openPrint(content);
  await sample.run('print', panel);
  const jobDelta = canonicalStringUnits(sample.printing) - canonicalStringUnits(before.printing);
  const fileDelta = sample.units() - initial - jobDelta;
  const c = consumer(), original = c.snapshot();
  c.setLimit(c.units() + Math.max(fileDelta, jobDelta + 128) + 1);
  const live = await c.openPrint(content), result = await c.run('print', live);
  expect(result).toMatchObject({ status: 'rejected', error: { code: 'limit_exceeded' } });
  expect(c.snapshot()).toEqual(original); expect(c.printing.nextJobId).toBe(1); expect(live.busy).toBe(false);
  c.controller.dispose();
});

test('exact combined quota uses actual archive identity rather than rejecting a worst-case prospective ID', async () => {
  const content = await fixturePdf(1), sample = consumer(), initial = sample.units(), samplePanel = await sample.openPrint(content);
  expect((await sample.run('print', samplePanel)).status).toBe('applied');
  const exactDelta = sample.units() - initial, c = consumer(), ceiling = c.units() + exactDelta;
  c.setLimit(ceiling);
  const panel = await c.openPrint(content), result = await c.run('print', panel);
  expect(result.status).toBe('applied'); expect(c.units()).toBe(ceiling); expect(c.printing.jobs).toHaveLength(1);
});

test('cancel during asynchronous file preparation leaves no orphan PDF/job and no consumed canonical identity', async () => {
  const c = consumer(), panel = await c.openPrint(await fixturePdf()), entered = deferred(), release = deferred(), original = c.snapshot();
  c.ctx.createFile = async (spec, ownership) => { entered.resolve(); await release.promise; return c.bridges.createFile(spec, ownership); };
  const pending = c.run('print', panel); await entered.promise;
  expect((await c.run('cancel', panel)).status).toBe('applied'); release.resolve();
  expect(await pending).toMatchObject({ status: 'rejected', error: { code: 'stale_target' } }); expect(c.snapshot()).toEqual(original);
});

test('acknowledged atomic print commit stays applied after immediate source/window retirement', async () => {
  const c = consumer(), panel = await c.openPrint(await fixturePdf(1));
  c.ctx.createFile = async (spec, ownership) => { const result = c.bridges.createFile(spec, ownership); c.controller.windowClosed(c.sourceWindow.id); c.windows.delete(c.sourceWindow.id); return result; };
  const result = await c.run('print', panel);
  expect(result.status).toBe('applied'); expect(c.printing.jobs).toHaveLength(1); expect(c.bridges.getFile(result.fileId)).not.toBeNull();
  expect(c.presentation.panels).toHaveLength(0); expect(validatePrintingState(c.printing).ok).toBe(true);
});

test('pending source/file/view replacement before mount rejects the original print with no persistent mutation', async () => {
  for (const change of ['source', 'view', 'file', 'root']) {
    const c = consumer(), content = await fixturePdf(1), file = await c.addFile('Original.pdf', 'application/pdf', content), entered = deferred(), release = deferred();
    const original = c.snapshot(); c.ctx.tick = async () => { entered.resolve(); await release.promise; };
    const pending = c.controller.printDocument({ title: file.name, mime: file.mime, content: file.content, source: { fileId: file.id } }, c.ownership());
    await entered.promise;
    if (change === 'source') c.replaceSource();
    if (change === 'view') c.views.set(c.sourceWindow.id, { available: () => true });
    if (change === 'file') { file.content = await fixturePdf(2); file.revision++; }
    if (change === 'root') c.invalidate();
    const changed = c.snapshot(); release.resolve();
    expect((await pending).error.code).toBe('stale_target'); expect(c.snapshot()).toEqual(change === 'file' ? changed : original); expect(c.presentation.panels).toHaveLength(0);
  }
});

test('Save PDF preserves selected actual pages and never enqueues; closed dialogs cannot replay', async () => {
  const c = consumer(), panel = await c.openPrint(await fixturePdf()); await c.run('configure', panel, { pageFrom: 3, pageTo: 3 });
  const result = await c.run('savePdf', panel, { name: 'Only third.pdf' });
  expect(result.status).toBe('applied'); expect(result.jobId).toBeUndefined(); expect(c.printing.jobs).toHaveLength(0);
  expect(await extracted(c.bridges.getFile(result.fileId).content)).toEqual(['Distinct source page 3']);
  expect((await c.run('print', panel)).error.code).toBe('stale_target');
});

test('FIFO queue skips paused jobs, preserves resumed partial progress, and persists across queue close/reopen', async () => {
  const c = consumer(), content = await fixturePdf(1);
  for (const copies of [3, 2, 1]) { const panel = await c.openPrint(content); await c.run('configure', panel, { copies }); await c.run('print', panel); }
  const [first, second, third] = c.printing.jobs, immutable = c.printing.jobs.map(job => ({ ...clone(job), status: undefined, printedPages: undefined }));
  let queue = await c.queue();
  await c.run('queue.advance', queue, { pages: 1 }); expect(first).toMatchObject({ printedPages: 1, status: 'printing' });
  const size = c.units(); c.setLimit(size); expect((await c.run('queue.pause', queue, {}, { jobId: first.id })).status).toBe('applied'); // Signed shrinking status delta.
  c.setLimit(4 * 1024 * 1024); await c.run('queue.advance', queue, { pages: 1 }); expect(second).toMatchObject({ printedPages: 1, status: 'printing' });
  await c.run('queue.resume', queue, {}, { jobId: first.id }); await c.run('queue.advance', queue, { pages: 1 });
  expect(first).toMatchObject({ printedPages: 2, status: 'printing' }); expect(second).toMatchObject({ printedPages: 1, status: 'queued' });
  await c.run('queue.cancel', queue, {}, { jobId: third.id }); const retained = clone(c.printing);
  await c.run('cancel', queue); expect(c.printing).toEqual(retained); queue = await c.queue();
  const advanced = await c.run('queue.advance', queue, { pages: 1024 }); expect(advanced.jobIds).toEqual([first.id, second.id]);
  expect(first).toMatchObject({ printedPages: 3, status: 'completed' }); expect(second).toMatchObject({ printedPages: 2, status: 'completed' }); expect(third.status).toBe('cancelled');
  expect(c.printing.jobs.map(job => ({ ...clone(job), status: undefined, printedPages: undefined }))).toEqual(immutable);
  const before = c.snapshot(); expect((await c.run('queue.resume', queue, {}, { jobId: first.id })).error.code).toBe('disabled'); expect((await c.run('queue.advance', queue, { pages: 1 })).error.code).toBe('disabled'); expect(c.snapshot()).toEqual(before);
  expect(validatePrintingState(c.printing).ok).toBe(true);
});

test('native picker stays pending until Open and returns the exact live original File, not a metadata copy', async () => {
  for (const profileId of DOCUMENT_DESTINATION_PROFILES) {
    const c = consumer(profileId), file = await c.addFile('Genuine.pdf', 'application/pdf', await fixturePdf(1)), text = await c.addFile('Plain.txt', 'text/plain', 'literal text');
    const picker = await c.picker(); let settled = false; picker.result.then(() => { settled = true; });
    expect((await c.run('picker.select', picker.panel, { fileId: text.id })).error.code).toBe('unavailable');
    await c.run('picker.select', picker.panel, { fileId: file.id }); await Promise.resolve(); expect(settled).toBe(false);
    const opened = await c.run('picker.open', picker.panel); expect(opened.status).toBe('applied');
    const result = await picker.result; expect(result.fileId).toBe(file.id); expect(result.file).toBe(file); expect(c.bridges.getFile(result.fileId)).toBe(file);
    expect(c.presentation.panels).toHaveLength(0);
  }
});

test('picker rejects changed revision, replaced identity, deleted ancestor and closed source, never choosing a new file by old ID', async () => {
  for (const change of ['revision', 'identity', 'ancestor', 'source']) {
    const c = consumer(), file = await c.addFile('Choice.pdf', 'application/pdf', await fixturePdf(1)), picker = await c.picker();
    await c.run('picker.select', picker.panel, { fileId: file.id });
    if (change === 'revision') { file.content = await fixturePdf(2); file.revision++; }
    if (change === 'identity') c.files.files[c.files.files.indexOf(file)] = { ...file };
    if (change === 'ancestor') c.files.files.find(row => row.id === 'documents').deleted = true;
    if (change === 'source') c.controller.windowClosed(c.sourceWindow.id);
    if (change !== 'source') expect((await c.run('picker.open', picker.panel)).error.code).toBe('stale_target');
    const result = await picker.result; expect(result).toMatchObject({ status: 'rejected', error: { code: 'stale_target' } }); expect(result.file).toBeUndefined(); expect(c.presentation.panels).toHaveLength(0);
  }
});

test('picker cancellation and source quit settle truthful rejection; filtered location/query do not select invisible files', async () => {
  const c = consumer(), file = await c.addFile('Choice.pdf', 'application/pdf', await fixturePdf(1));
  const one = await c.picker(); await c.run('picker.query', one.panel, { query: 'missing' }); expect((await c.run('picker.select', one.panel, { fileId: file.id })).error.code).toBe('unavailable');
  await c.run('cancel', one.panel); expect((await one.result).error.code).toBe('cancelled');
  const two = await c.picker(); c.controller.appQuit(c.sourceWindow.appId); expect((await two.result).status).toBe('rejected'); expect(c.presentation.panels).toHaveLength(0);
});

test('native Open settles exactly once after the actual sheet closes and the original source window regains focus', async () => {
  const c = consumer(), file = await c.addFile('Choice.pdf', 'application/pdf', await fixturePdf(1));
  c.setSourceDraft('Pending reply body');
  const picker = await c.picker();
  await c.run('picker.select', picker.panel, { fileId: file.id });
  let settled = 0; picker.result.then(() => { settled++; });
  const before = c.snapshot();
  expect((await c.run('picker.open', picker.panel)).status).toBe('applied');
  const result = await picker.result;
  expect(result.status).toBe('applied'); expect(result.fileId).toBe(file.id); expect(result.file).toBe(file);
  expect(settled).toBe(1);
  expect(c.presentation.panels).toEqual([]); expect(c.windows.get(picker.panel.windowId)).toBeUndefined();
  expect(c.focusId).toBe(c.sourceWindow.id);
  expect(c.snapshot()).toEqual(before);
  expect(c.controller.windowClosed(picker.panel.windowId)).toBeNull();
  c.controller.appQuit(c.sourceWindow.appId);
  expect((await c.run('cancel', picker.panel)).error.code).toBe('stale_target');
  expect(settled).toBe(1); expect(c.snapshot()).toEqual(before);
});

test('a user-focused third window keeps focus across destination settlement with no caret steal or mutation', async () => {
  const c = consumer(), file = await c.addFile('Choice.pdf', 'application/pdf', await fixturePdf(1));
  c.setSourceDraft('Pending reply body');
  const picker = await c.picker();
  await c.run('picker.select', picker.panel, { fileId: file.id });
  let settled = 0; picker.result.then(() => { settled++; });
  const before = c.snapshot();
  expect((await c.run('picker.open', picker.panel)).status).toBe('applied');
  c.setActive('third-window'); // The actor genuinely focused another window while the sheet settled.
  const result = await picker.result;
  expect(result.status).toBe('applied'); expect(settled).toBe(1);
  expect(c.focusId).toBe('third-window');
  expect(c.snapshot()).toEqual(before);
});

test('withdrawn destinations close original utilities after graph expiry without closing equal-ID replacement windows', async () => {
  for (const getter of ['getPrinting', 'getPresentation', 'getFilesStore']) {
    for (const replaceWindow of [false, true]) {
      const c = consumer(), picker = await c.picker(), entered = deferred(), release = deferred();
      const original = c.windows.get(picker.panel.windowId), close = c.ctx.closeWindow;
      c.ctx.closeWindow = async (windowId, ownership) => {
        entered.resolve();
        await release.promise;
        return close(windowId, ownership);
      };
      const before = c.snapshot();
      expect((await c.run('cancel', picker.panel)).status).toBe('applied');
      await entered.promise;
      const replacementGraph = clone(c.ctx[getter]());
      c.ctx[getter] = () => replacementGraph;
      const replacementWindow = replaceWindow ? { ...original } : null;
      if (replacementWindow) c.windows.set(original.id, replacementWindow);
      c.windows.set('third-window', { id: 'third-window', appId: 'calculator' });
      c.setActive('third-window');
      release.resolve();
      expect((await picker.result).error.code).toBe('cancelled');
      expect(c.presentation.panels).toEqual([]);
      if (replacementWindow) expect(c.windows.get(original.id)).toBe(replacementWindow);
      else expect(c.windows.get(original.id)).toBeUndefined();
      expect(c.ctx[getter]()).toBe(replacementGraph);
      expect(c.windows.get(c.sourceWindow.id)).toBe(c.sourceWindow);
      expect(c.focusId).toBe('third-window');
      expect(c.snapshot()).toEqual(before);
    }
  }
});

test('external sheet close hands the root the exact original source descriptor and settles the chooser once', async () => {
  const c = consumer(), file = await c.addFile('Choice.pdf', 'application/pdf', await fixturePdf(1));
  c.setSourceDraft('Pending reply body');
  const picker = await c.picker();
  await c.run('picker.select', picker.panel, { fileId: file.id });
  let settled = 0; picker.result.then(() => { settled++; });
  const before = c.snapshot();
  // The root closes the spliced native sheet and consumes only the exact
  // original-source descriptor the destination returns.
  const descriptor = c.controller.windowClosed(picker.panel.windowId);
  c.windows.delete(picker.panel.windowId); c.views.delete(picker.panel.windowId);
  expect(descriptor.window).toBe(c.sourceWindow); expect(descriptor.guard()).toBe(true);
  if (c.focusId === picker.panel.windowId && descriptor.guard() === true
    && c.windows.get(descriptor.window.id) === descriptor.window) c.setActive(descriptor.window.id);
  const result = await picker.result;
  expect(result.status).toBe('rejected'); expect(result.error.code).toBe('cancelled'); expect(settled).toBe(1);
  expect(c.focusId).toBe(c.sourceWindow.id);
  expect(c.presentation.panels).toEqual([]); expect(c.snapshot()).toEqual(before);
});

test('a genuinely committed Save As stays applied when the source retires during the real Files transaction', async () => {
  const c = consumer(), text = 'Whole retained bytes';
  const request = c.controller.saveFile({ name: 'Retained.txt', mime: 'text/plain', text }, c.ownership());
  for (let index = 0; index < 6; index++) await Promise.resolve();
  const panel = c.presentation.panels.find(row => row.saveMode);
  expect((await c.run('picker.location', panel, { location: 'documents' })).status).toBe('applied');
  c.ctx.createFile = async (spec, ownership) => {
    const result = c.bridges.createFile(spec, ownership);
    c.controller.windowClosed(c.sourceWindow.id); c.windows.delete(c.sourceWindow.id);
    return result;
  };
  const saved = await c.run('save.confirm', panel);
  expect(saved.status).toBe('applied');
  const result = await request;
  expect(result.status).toBe('applied'); expect(result.fileId).toBe(saved.fileId);
  expect(c.files.files.find(row => row.id === saved.fileId).content).toBe(text);
  expect(c.presentation.panels).toHaveLength(0);
});

test('local share creates genuine unaddressed Mail and Message drafts retaining exact attachment MIME and bytes, not delivery', async () => {
  for (const action of ['mail', 'message']) {
    const c = consumer(), content = await fixturePdf(1), opened = await c.controller.share({ title: 'Attachment.pdf', mime: 'application/pdf', content }, c.ownership());
    expect(opened.status).toBe('applied'); expect(c.drafts).toHaveLength(0);
    const panel = c.presentation.panels.find(row => row.id === opened.shareId), result = await c.run('share.action', panel, { action });
    expect(result).toMatchObject({ status: 'applied', draftId: 'draft-1', localOnly: true }); expect(result.sent).toBeUndefined(); expect(result.delivery).toBeUndefined();
    expect(c.drafts[0]).toMatchObject({ kind: action, recipient: '', body: '', attachments: [{ name: 'Attachment.pdf', mime: 'application/pdf', content }] });
    expect(await extracted(c.drafts[0].attachments[0].content)).toEqual(['Distinct source page 1']); expect(c.presentation.panels).toHaveLength(0);
  }
});

test('share text clipboard genuinely shrinks quota, file action writes actual MIME/content, binary copy rejects rather than flattening', async () => {
  const c = consumer(); Object.assign(c.clipboard, { kind: 'text', text: 'x'.repeat(1000) }); c.setLimit(c.units());
  let opened = await c.controller.share({ title: 'Plain.txt', mime: 'text/plain', text: 'short' }, c.ownership()), panel = c.presentation.panels.find(row => row.id === opened.shareId);
  expect((await c.run('share.action', panel, { action: 'clipboard' })).status).toBe('applied'); expect(c.clipboard.text).toBe('short');
  c.setLimit(4 * 1024 * 1024); const content = await fixturePdf(1);
  opened = await c.controller.share({ title: 'Bytes.pdf', mime: 'application/pdf', content }, c.ownership()); panel = c.presentation.panels.find(row => row.id === opened.shareId);
  const before = c.snapshot(); expect((await c.run('share.action', panel, { action: 'clipboard' })).error.code).toBe('unsupported_content'); expect(c.snapshot()).toEqual(before);
  const result = await c.run('share.action', panel, { action: 'file' }); expect(result.status).toBe('applied'); expect(c.bridges.getFile(result.fileId)).toMatchObject({ mime: 'application/pdf', content });
});

test('share loses source during composer await without drafts and retains acknowledged drafts despite immediate retirement', async () => {
  for (const committed of [false, true]) {
    const c = consumer(), opened = await c.controller.share({ title: 'Text', text: 'Full body' }, c.ownership()), panel = c.presentation.panels.find(row => row.id === opened.shareId), entered = deferred(), release = deferred();
    const real = c.ctx.composeMail;
    c.ctx.composeMail = async (spec, ownership) => {
      const result = committed ? real(spec, ownership) : null; entered.resolve(); await release.promise; return result ?? real(spec, ownership);
    };
    const pending = c.run('share.action', panel, { action: 'mail' }); await entered.promise; c.controller.windowClosed(c.sourceWindow.id); c.windows.delete(c.sourceWindow.id); release.resolve();
    const result = await pending; expect(result.status).toBe(committed ? 'applied' : 'rejected'); expect(c.drafts.length).toBe(committed ? 1 : 0); expect(c.presentation.panels).toHaveLength(0);
  }
});

test('closed schemas, actual ranges, original native identity and bounded counters reject without mutation', async () => {
  const c = consumer(), panel = await c.openPrint(await fixturePdf()), before = c.snapshot();
  for (const [suffix, payload, extra] of [['configure', { copies: 100 }], ['configure', { copies: 0 }], ['configure', { pageFrom: 1.5 }], ['configure', { pageFrom: 3, pageTo: 2 }], ['configure', { pageTo: 4 }], ['configure', { unknown: 1 }], ['previewPage', { page: NaN }], ['print', {}, { injected: true }]]) {
    expect((await c.run(suffix, panel, payload, extra ?? {})).error.code).toBe('invalid_arguments'); expect(c.snapshot()).toEqual(before);
  }
  const originalView = c.views.get(panel.windowId); c.views.set(panel.windowId, { available: () => false }); expect((await c.run('print', panel)).status).toBe('rejected'); expect(c.snapshot()).toEqual(before); c.views.set(panel.windowId, originalView);
  const exhausted = consumer(); exhausted.printing.nextJobId = PRINTING_LIMITS.counter;
  const exhaustedPanel = await exhausted.openPrint(await fixturePdf()), counterState = exhausted.snapshot();
  expect((await exhausted.run('print', exhaustedPanel)).error.code).toBe('limit_exceeded');
  expect(exhausted.snapshot()).toEqual(counterState);
  await c.run('cancel', panel); c.presentation.nextPanelId = PRINTING_LIMITS.counter; expect((await c.controller.printDocument({ title: 'Bound', mime: 'application/pdf', content: await fixturePdf(1) }, c.ownership())).error.code).toBe('limit_exceeded');
});

test('generic printing persistence rejects note-specific legacy fields, duplicate archives, unsafe progress and forged PDF bytes', async () => {
  const c = consumer(), panel = await c.openPrint(await fixturePdf(1)); await c.run('print', panel); expect(validatePrintingState(c.printing).ok).toBe(true);
  for (const mutate of [state => { state.jobs[0].sourceNoteId = 'note-1'; }, state => { state.jobs[0].source.windowId = '__proto__'; }, state => { state.nextJobId = 1; },
    state => { state.jobs.push({ ...clone(state.jobs[0]), id: 'job-2' }); state.nextJobId = 3; }, state => { state.jobs[0].printedPages = 2; }, state => { state.jobs[0].pageTo = 9; },
    state => { state.jobs[0].pdfBase64 = btoa('Not a PDF'); }, state => { state.jobs[0].status = 'completed'; }]) {
    const broken = clone(c.printing); mutate(broken); const original = clone(broken); expect(validatePrintingState(broken).ok).toBe(false); expect(broken).toEqual(original);
  }
});

test('replacement native destination window/view/panel cannot inherit old picker authority or close a replacement root window', async () => {
  for (const change of ['window', 'view', 'panel']) {
    const c = consumer(), file = await c.addFile('Choice.pdf', 'application/pdf', await fixturePdf(1)), picker = await c.picker();
    await c.run('picker.select', picker.panel, { fileId: file.id });
    const original = c.windows.get(picker.panel.windowId), before = c.snapshot();
    if (change === 'window') c.windows.set(original.id, { ...original });
    if (change === 'view') c.views.set(original.id, { available: () => true, describe: () => ({ connected: true }) });
    if (change === 'panel') c.presentation.panels = c.presentation.panels.map(panel => ({ ...panel }));
    expect((await c.run('picker.open', picker.panel)).error.code).toBe('stale_target');
    expect((await picker.result).error.code).toBe('stale_target'); expect(c.snapshot()).toEqual(before); expect(c.presentation.panels).toHaveLength(0);
    if (change === 'window') expect(c.windows.get(original.id)).not.toBe(original);
  }
});

test('asynchronous native focus/scroll await genuine facade acknowledgement and refuse source expiry before DOM mutation', async () => {
  for (const suffix of ['focus', 'scroll']) {
    const c = consumer(), panel = await c.openPrint(await fixturePdf(1)), facade = c.views.get(panel.windowId);
    let mutations = 0;
    facade.focus = async (_control, _file, guard) => { await Promise.resolve(); if (!guard()) return false; mutations++; return true; };
    facade.scroll = async (spec, guard) => { await Promise.resolve(); if (!guard()) return false; mutations++; return { area: spec.area, top: 12, left: 0 }; };
    const payload = suffix === 'focus' ? { controlId: 'copies' } : { area: 'preview', top: 9999, left: 0 };
    expect((await c.run(suffix, panel, payload)).status).toBe('applied'); expect(mutations).toBe(1);
    const entered = deferred(), release = deferred();
    facade[suffix] = async (...args) => { entered.resolve(); await release.promise; if (!args.at(-1)()) return false; mutations++; return suffix === 'focus' ? true : { area: 'preview', top: 0, left: 0 }; };
    const pending = c.run(suffix, panel, payload); await entered.promise; c.invalidate(); release.resolve();
    expect((await pending).error.code).toBe('stale_target'); expect(mutations).toBe(1); c.controller.dispose();
  }
});

test('share rejects forged PDF/raster MIME bytes and never presents a fake successful local attachment', async () => {
  const c = consumer(), before = c.snapshot();
  for (const spec of [{ title: 'Fake.pdf', mime: 'application/pdf', content: `data:application/pdf;base64,${btoa('%PDF-1.7\\nnot a page tree\\n%%EOF')}` },
    { title: 'Fake.png', mime: 'image/png', content: `data:image/png;base64,${btoa('not PNG pixels')}` }]) {
    const result = await c.controller.share(spec, c.ownership());
    expect(result.status).toBe('rejected'); expect(c.snapshot()).toEqual(before); expect(c.presentation.panels).toHaveLength(0);
  }
});

test('all five native Save As destinations preserve full Unicode bytes, real folder choice and explicit collision revisions', async () => {
  for (const profileId of DOCUMENT_DESTINATION_PROFILES) {
    const c = consumer(profileId), text = '\uFEFFCall sheet — 🌊\nMeet at 07:30.\n';
    const mime = 'text/plain;charset="utf-8";title="Call sheet"';
    const original = await c.addFile('Call sheet.txt', 'text/plain', 'Original unrelated bytes\n');
    const request = c.controller.saveFile({ name: original.name, mime, text }, c.ownership());
    for (let index = 0; index < 6; index++) await Promise.resolve();
    const panel = c.presentation.panels.find(row => row.saveMode);
    expect(c.windows.get(panel.windowId).utilityKind).toBe('document-picker');
    expect((await c.run('picker.location', panel, { location: 'documents' })).status).toBe('applied');
    const collision = await c.run('save.confirm', panel);
    expect(collision.replacementRequired).toBe(true);
    expect(original.content).toBe('Original unrelated bytes\n');
    const revision = original.revision;
    expect((await c.run('save.replace', panel, { fileId: original.id, revision: revision + 1 })).error.code).toBe('stale_target');
    expect(original.revision).toBe(revision);
    const saved = await c.run('save.replace', panel, { fileId: original.id, revision });
    expect(saved.status).toBe('applied');
    expect((await request).fileId).toBe(original.id);
    expect(c.bridges.getFile(original.id)).toBe(original);
    expect(original.revision).toBe(revision + 1);
    expect(original.mime).toBe(mime);
    expect(new TextEncoder().encode(original.content)).toEqual(new TextEncoder().encode(text));
    expect(c.presentation.panels).toHaveLength(0);
    c.dispose();
  }
});

test('Save As refuses invalid MIME metadata before opening a destination or creating a File', async () => {
  for (const mime of ['text/plain;charset="unterminated', 'text/plain;\ncharset=utf-8', 'text/plain; charset=', `text/plain; title="${'x'.repeat(256)}"`]) {
    const c = consumer(), before = c.snapshot(), windows = [...c.windows.keys()];
    const result = await c.controller.saveFile({ name: 'Untouched.txt', mime, text: 'Original café Ω 東京\n' }, c.ownership());
    expect(result).toMatchObject({ status: 'rejected', error: { code: 'invalid_arguments' } });
    expect(c.snapshot()).toEqual(before);
    expect(c.presentation.panels).toEqual([]);
    expect([...c.windows.keys()]).toEqual(windows);
    c.dispose();
  }
});

test('Save As rejects equal-valued folder replacement and retired source without publishing any retained File', async () => {
  for (const change of ['folder', 'source', 'quota']) {
    const c = consumer(), before = c.snapshot();
    const request = c.controller.saveFile({ name: 'Retained.txt', mime: 'text/plain', text: 'Whole retained 🌊\n' }, c.ownership());
    for (let index = 0; index < 6; index++) await Promise.resolve();
    const panel = c.presentation.panels.find(row => row.saveMode);
    if (change === 'folder') {
      const index = c.files.files.findIndex(row => row.id === panel.location);
      c.files.files[index] = { ...c.files.files[index] };
    } else if (change === 'source') c.replaceSource();
    else c.setLimit(c.units());
    const result = await c.run('save.confirm', panel);
    expect(result.status).toBe('rejected');
    expect(result.error.code).toBe(change === 'quota' ? 'limit_exceeded' : 'stale_target');
    expect(c.files.files.some(row => row.name === 'Retained.txt')).toBe(false);
    expect(c.files.nextFileId).toBe(before.files.nextFileId);
    c.dispose();
    expect((await request).status).toBe('rejected');
  }
});

test('native text MIME parameters match the real picker base filter without discarding original metadata or text', async () => {
  for (const profileId of DOCUMENT_DESTINATION_PROFILES) {
    const c = consumer(profileId), text = '\uFEFFNative TextEdit café — 🏔️\n', encoded = encodeTextEditFile(createTextEditContent(text, 'plain'));
    const file = await c.addFile('Original native text.txt', encoded.mime, encoded.text);
    const picker = await c.picker(['text/plain']);
    expect((await c.run('picker.select', picker.panel, { fileId: file.id })).status).toBe('applied');
    expect((await c.run('picker.open', picker.panel)).status).toBe('applied');
    const result = await picker.result;
    expect(result.file).toBe(file);
    expect(result.file.mime).toBe(encoded.mime);
    expect(new TextEncoder().encode(result.file.content)).toEqual(new TextEncoder().encode(text));
    c.dispose();
  }
});

test('unrenderable literal text remains a truthful cancellable failure dialog without creating substitute files or jobs', async () => {
  const c = consumer(), before = c.snapshot();
  const result = await c.controller.printDocument({ title: 'Original Unicode conversation', text: 'Original café 東京 Ω', documentId: 'conversation-1' }, c.ownership());
  expect(result).toMatchObject({ status: 'rejected', error: { code: 'unsupported_glyph' } });
  const panel = c.presentation.panels[0];
  expect(panel.error).toBe(result.error.message);
  expect(panel.busy).toBe(false);
  expect(panel.pageCount).toBe(0);
  expect(c.snapshot()).toEqual(before);
  expect(c.windows.has(panel.windowId)).toBe(true);
  expect((await c.run('cancel', panel)).status).toBe('applied');
  expect(c.presentation.panels).toEqual([]);
  expect(c.focusId).toBe(c.sourceWindow.id);
  expect(c.snapshot()).toEqual(before);
  c.dispose();
});

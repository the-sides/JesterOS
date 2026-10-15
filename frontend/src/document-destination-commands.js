import { object, choice, empty, defineCommand } from './command-schema.js';
import { copyCanonicalData } from './canonical-data.js';
import { PRINTING_LIMITS, printedPageTotal, validatePrintingState, printingTextUnits, validPrintingId } from './printing-state.js';
import { preparePrintDocument, selectPrintPages, renderPrintPage, validateDestinationDocument } from './document-destination-codec.js';
import { validFileMime, applicationFileMime } from './application-file-bridges.js';

export const DOCUMENT_DESTINATION_PROFILES = Object.freeze(['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428']);
export const createDocumentDestinationPresentation = () => ({ nextPanelId: 1, panels: [] });
const id = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const int = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const text = maximum => ({ type: 'string', maxLength: maximum });
const offset = { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const panelTarget = object({ panelId: id });
const jobTarget = object({ panelId: id, jobId: id });
const specs = {
  configure: [panelTarget, object({ copies: int(1, 99), pageFrom: int(1, 1024), pageTo: int(1, 1024) }, []), 'Change the real print range and copy settings together.'],
  previewPage: [panelTarget, object({ page: int(1, 1024) }), 'Navigate a genuinely decoded PDF page.'],
  print: [panelTarget, empty, 'Atomically archive selected genuine PDF pages in Files and enqueue exactly one virtual print job.'],
  savePdf: [panelTarget, object({ name: text(255) }), 'Save selected genuine PDF pages without queueing a print job.'],
  cancel: [panelTarget, empty, 'Withdraw the original pending destination, settling a picker with a truthful cancellation.'],
  'picker.select': [panelTarget, object({ fileId: id }), 'Select the original live MIME-matching shared File.'],
  'picker.location': [panelTarget, object({ location: id }), 'Navigate an original live folder in the shared Files graph.'],
  'picker.query': [panelTarget, object({ query: text(256) }), 'Filter actual local Files by name.'],
  'picker.open': [panelTarget, empty, 'Resolve only the originally selected, still-current, live File after native Open.'],
  'save.name': [panelTarget, object({ name: text(255) }), 'Edit the actual Save As filename without changing retained source bytes.'],
  'save.confirm': [panelTarget, empty, 'Save exact retained MIME and bytes into the selected original writable folder; collisions require explicit original-revision replacement.'],
  'save.replace': [panelTarget, object({ fileId: id, revision: int(1, Number.MAX_SAFE_INTEGER) }), 'Replace only the explicitly confirmed original collision File revision with retained bytes.'],
  'share.action': [panelTarget, object({ action: choice('mail', 'message', 'clipboard', 'file') }), 'Create a real local draft, clipboard value or File; never claim sending.'],
  'queue.open': [empty, empty, 'Open the native virtual queue without changing the persistent archive.'],
  'queue.pause': [jobTarget, empty, 'Pause a pending original FIFO job.'],
  'queue.resume': [jobTarget, empty, 'Resume a paused original FIFO job, retaining partial progress.'],
  'queue.cancel': [jobTarget, empty, 'Cancel a pending original job, retaining its immutable archive.'],
  'queue.advance': [panelTarget, object({ pages: int(1, 1024) }), 'Advance actual queued page/copy progress in FIFO order, skipping paused jobs.'],
  focus: [panelTarget, object({ controlId: text(128), fileId: id }, ['controlId']), 'Focus only a genuine original enabled native control.'],
  scroll: [panelTarget, object({ area: choice('body', 'files', 'preview', 'settings', 'sidebar', 'share', 'jobs'), top: offset, left: offset }, ['area', 'top']), 'Scroll the real original native inner surface and return actual retained offsets.'],
};
export const documentDestinationCatalog = Object.fromEntries(Object.entries(specs).map(([suffix, [target, payload, description]]) =>
  defineCommand(DOCUMENT_DESTINATION_PROFILES, `documentDestination.${suffix}`, 'document.destinations', target, payload,
    ['Original canonical printing/Files graphs and original source/window/presentation/native-view identities.', 'Local simulated destinations only; no host IO, hardware printing, network, or remote delivery.'],
    [description], ['printing', 'files', 'clipboard', 'mail', 'messages'], [], object({ panelId: id, windowId: id }))));

const rejected = (code, message) => ({ status: 'rejected', error: { code, message } });
const applied = (panel, extra = {}) => ({ status: 'applied', target: panel ? { panelId: panel.id, windowId: panel.windowId } : {}, ...extra });
const stale = () => rejected('stale_target', 'The original source, file revision, destination, or native window changed.');
const fail = result => { const error = new Error(result.error.message); error.code = result.error.code; throw error; };
const fields = (value, keys, required = keys) => value && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  && required.every(key => Object.hasOwn(value, key));
function schemaValid(value, schema) {
  if (schema.enum) return schema.enum.includes(value);
  if (schema.type === 'object') return fields(value, Object.keys(schema.properties), schema.required)
    && Object.entries(value).every(([key, child]) => schemaValid(child, schema.properties[key]));
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity)
    && (!schema.pattern || new RegExp(schema.pattern).test(value)) && (schema !== id || validPrintingId(value));
  return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value))
    && value >= schema.minimum && value <= schema.maximum;
}
export const documentFileMime = file => applicationFileMime(file)?.split(';')[0].trim().toLowerCase() ?? null;
export const documentMimeAccepted = (mime, accept) => typeof mime === 'string' && accept.some(filter => filter === '*/*' || filter === mime || filter.endsWith('/*') && mime.startsWith(filter.slice(0, -1)));
const isLive = (store, file) => {
  if (!file || file.deleted || file.trashed || file.inTrash || file.parentId === 'trash' || file.parentId === 'recycle-bin') return false;
  const visited = new Set([file.id]);
  let parentId = file.parentId;
  while (parentId) {
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    const parent = store.files.find(row => row.id === parentId);
    if (!parent) return false;
    if (parent.deleted || parent.trashed || parent.inTrash || ['trash', 'recycle-bin'].includes(parent.id)) return false;
    parentId = parent.parentId;
  }
  return true;
};
const fileContent = file => file?.content ?? file?.text;
const ownedGuard = ownership => typeof ownership === 'function' ? ownership : ownership?.guard ?? ownership?.isCurrent;

/** Resource/Promise authority remains outside transient Svelte state. Every
 * public destination is a genuine root window, never a copied window record. */
export function createDocumentDestinationCommands(ctx) {
  const printing = ctx.getPrinting(), presentation = ctx.getPresentation(), files = ctx.getFilesStore();
  const entries = new Map();
  const alive = () => ctx.alive() === true && ctx.getPrinting() === printing && ctx.getPresentation() === presentation && ctx.getFilesStore() === files;
  const appId = ctx.profile.family === 'windows' || ctx.profile.id.startsWith('windows') ? 'explorer' : 'finder';
  const getFile = fileId => files.files.find(file => file.id === fileId && isLive(files, file)) ?? null;
  const budget = delta => Number.isSafeInteger(delta) && ctx.canCommit(delta) === true;
  const hasPanel = panel => alive() && presentation.panels.includes(panel) && entries.get(panel.id)?.panel === panel;
  function sourceLease(spec, ownership) {
    const guard = ownedGuard(ownership);
    const windowId = ownership?.windowId ?? spec?.source?.windowId ?? spec?.windowId;
    if (typeof guard !== 'function' || !validPrintingId(windowId) || !guard() || !alive()) return null;
    const window = ctx.getWindow(windowId), view = ctx.getView(windowId);
    if (!window) return null;
    const source = { appId: window.appId, windowId, ...(spec?.source?.documentId ?? spec?.documentId ? { documentId: spec?.source?.documentId ?? spec.documentId } : {}) };
    if (!Object.values(source).every(validPrintingId)) return null;
    const fileId = spec?.source?.fileId ?? spec?.fileId;
    const file = fileId ? getFile(fileId) : null, signature = file ? JSON.stringify(file) : null;
    if (fileId && !file) return null;
    const current = () => alive() && guard() === true && ctx.getWindow(windowId) === window && ctx.getView(windowId) === view
      && (!fileId || getFile(fileId) === file && JSON.stringify(file) === signature);
    return { source, window, view, file, guard: current };
  }
  function panelLease(panelId, native = true) {
    const entry = entries.get(panelId), panel = entry?.panel;
    if (!panel || !hasPanel(panel) || !entry.source?.guard?.() && panel.kind !== 'queue') return null;
    const window = ctx.getWindow(panel.windowId), view = ctx.getView(panel.windowId), serial = entry.serial;
    if (!window || window !== entry.window || view !== entry.view || native && (!view || ctx.available(window) !== true || view.available?.() !== true)) return null;
    const guard = () => hasPanel(panel) && entry.serial === serial && ctx.getWindow(panel.windowId) === window && ctx.getView(panel.windowId) === view
      && (panel.kind === 'queue' || entry.source.guard()) && (!native || ctx.available(window) === true && view.available?.() === true);
    return { entry, panel, window, view, guard };
  }
  // A retiring destination hands the exact original source window back to the
  // root's synchronous close transfer; the original chooser/save promise
  // settles only after the actual utility close or verified absence, a tick,
  // and a guarded native caret restore. No stale utility can answer for the
  // original source, and a user-focused third window is never stolen from.
  function captureSourceReturn(view) {
    if (!view) return null;
    if (typeof view.captureSourceReturn === 'function' || typeof view.restoreSourceReturn === 'function') {
      if (typeof view.captureSourceReturn !== 'function' || typeof view.restoreSourceReturn !== 'function') return null;
      try {
        const capture = view.captureSourceReturn();
        return capture ? { view, capture, kind: 'source-control' } : null;
      } catch { return null; }
    }
    if (typeof view.editSelection !== 'function' || typeof view.restoreEditSelection !== 'function') return null;
    let capture = null;
    try { capture = view.editSelection(); } catch { return null; }
    if (!capture || !Number.isInteger(capture.start) || !Number.isInteger(capture.end)
      || !['none', 'forward', 'backward'].includes(capture.direction ?? 'none')) return null;
    return { view, capture, kind: 'selection', selection: { start: capture.start, end: capture.end, direction: capture.direction ?? 'none' } };
  }
  const returnDescriptor = entry => entry.source
    ? { window: entry.source.window, guard: () => alive() && entry.source.guard() === true } : null;
  async function restoreSourceReturn(entry) {
    const token = entry.returnToken, source = entry.source;
    if (!token || !source) return false;
    const current = () => source.guard() && ctx.getView(source.source.windowId) === source.view
      && source.view.available?.() === true
      && (typeof ctx.getActiveWindowId !== 'function' || ctx.getActiveWindowId() === source.source.windowId);
    if (!current()) return false;
    const restored = token.kind === 'source-control'
      ? await token.view.restoreSourceReturn(token.capture, current)
      : await token.view.restoreEditSelection(token.capture, token.selection, current);
    return restored === true && current();
  }
  function holdSettlement(entry) {
    let complete;
    const pending = new Promise(resolve => { complete = resolve; });
    entry.pendingCommit = pending;
    return () => {
      if (entry.pendingCommit === pending) entry.pendingCommit = null;
      complete();
    };
  }
  function scheduleSettlement(entry) {
    entry.scheduled = true;
    void (async () => {
      try {
        const window = entry.window;
        if (entry.close !== false && window && ctx.getWindow(entry.panel.windowId) === window)
          await ctx.closeWindow(entry.panel.windowId, { guard: () => ctx.getWindow(entry.panel.windowId) === window,
            windowId: entry.panel.windowId, returnFocus: returnDescriptor(entry) });
        if (entry.pendingCommit) await entry.pendingCommit;
        await ctx.tick();
        await restoreSourceReturn(entry);
      } catch { /* The panel is already withdrawn; the recorded truthful reason still settles. */ }
      finally {
        if (entry.pendingCommit) await entry.pendingCommit;
        entry.settled = true;
        const resolve = entry.resolve;
        entry.resolve = null;
        if (entry.resource) { const resource = entry.resource; entry.resource = null; Promise.resolve(resource.destroy()).catch(() => {}); }
        if (resolve) resolve(entry.reason ?? rejected('cancelled', 'The local destination was cancelled.'));
      }
    })();
  }
  function settleEntry(entry, reason) {
    if (!entry || entry.settled) return false;
    entry.reason = reason;
    if (!entry.scheduled) scheduleSettlement(entry);
    return true;
  }
  function retire(panel, reason = rejected('cancelled', 'The local destination was cancelled.'), close = true) {
    const entry = entries.get(panel.id);
    if (!entry || entry.panel !== panel) return false;
    entry.serial++; entries.delete(panel.id);
    presentation.panels = presentation.panels.filter(row => row.id !== panel.id);
    if (entry.reason === null) entry.reason = reason;
    entry.close = close;
    if (!entry.scheduled) scheduleSettlement(entry);
    if (entry.resource) { const resource = entry.resource; entry.resource = null; Promise.resolve(resource.destroy()).catch(() => {}); }
    return true;
  }
  async function open(kind, title, source, spec = {}, resolve = null) {
    if (!alive() || source && !source.guard()) return { error: stale() };
    if (!Number.isSafeInteger(presentation.nextPanelId) || presentation.nextPanelId >= PRINTING_LIMITS.counter || presentation.panels.length >= 128)
      return { error: rejected('limit_exceeded', 'The destination identity capacity is exhausted.') };
    const panel = { id: `destination-${presentation.nextPanelId++}`, kind, windowId: null, title, busy: kind === 'print' || kind === 'share', error: '',
      copies: 1, pageFrom: 1, pageTo: 1, pageCount: 0, previewPage: 1, selectedFileId: null, accept: spec.accept ?? ['*/*'], location: spec.saveMode ? 'downloads' : 'documents', query: '',
      saveMode: spec.saveMode === true, saveName: spec.saveMode ? spec.name : '', replacement: null,
      actions: ['mail', 'message', 'clipboard', 'file'] };
    presentation.panels.push(panel);
    const returnToken = source ? captureSourceReturn(source.view) : null;
    const entry = { panel: presentation.panels.at(-1), source, spec, serial: 0, resource: null, resolve, selection: null, returnToken,
      reason: null, scheduled: false, settled: false, close: true, pendingCommit: null };
    // Reading back the inserted panel preserves Svelte's original deep-state proxy.
    entries.set(panel.id, entry);
    const actualPanel = entry.panel;
    const guard = () => hasPanel(actualPanel) && (!source || source.guard());
    try {
      const windowId = await ctx.createWindow(appId, { utilityKind: kind === 'queue' ? 'document-print' : `document-${kind}`, documentDestinationId: actualPanel.id,
        destinationKind: kind, title, isCurrent: guard });
      if (!guard()) { retire(actualPanel, stale()); return { error: stale(), entry: actualPanel }; }
      const window = ctx.getWindow(windowId);
      if (!validPrintingId(windowId) || !window || actualPanel.windowId !== windowId) {
        if (window && actualPanel.windowId !== windowId) await ctx.closeWindow(windowId, { guard: () => ctx.getWindow(windowId) === window, windowId });
        retire(actualPanel, rejected('unavailable', 'The root did not synchronously register the actual destination window.'));
        return { error: rejected('unavailable', 'The root did not acknowledge an original destination window.'), entry: actualPanel };
      }
      await ctx.tick();
      if (!guard() || ctx.getWindow(windowId) !== window) { retire(actualPanel, stale()); return { error: stale(), entry: actualPanel }; }
      entry.view = ctx.getView(windowId);
      const lease = panelLease(actualPanel.id);
      if (!lease) { retire(actualPanel, rejected('unavailable', 'The original native destination is not mounted.')); return { error: rejected('unavailable', 'The actual native destination facade is unavailable.'), entry: actualPanel }; }
      return { panel: actualPanel, entry, lease };
    } catch (error) { const result = rejected(error.code ?? 'unavailable', error.message ?? 'The native destination could not open.'); retire(actualPanel, result); return { error: result, entry: actualPanel }; }
  }
  function packet(spec) {
    if (!spec || typeof spec !== 'object' || typeof spec.title !== 'string' || spec.title.length > 1024
      || typeof (spec.mime ?? 'text/plain') !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(spec.mime ?? 'text/plain')
      || typeof (spec.content ?? spec.text) !== 'string' || (spec.content ?? spec.text).length > PRINTING_LIMITS.pdf
      || spec.origin !== undefined && (typeof spec.origin !== 'string' || spec.origin.length > 256)) return null;
    return { title: spec.title, mime: spec.mime ?? 'text/plain', content: spec.content ?? spec.text, origin: spec.origin ?? spec.appId ?? '',
      ...(spec.text !== undefined ? { text: spec.text } : {}) };
  }
  async function printDocument(spec, ownership) {
    const source = sourceLease(spec, ownership), document = packet(spec);
    if (!source) return stale();
    if (!document) return rejected('invalid_arguments', 'Provide a genuine bounded document MIME/content or text and title.');
    const opened = await open('print', document.title, source, document);
    if (opened.error) return opened.error;
    const { panel, entry, lease } = opened;
    try {
      const output = await preparePrintDocument({ ...document, timestamp: ctx.getSceneTime() }, { guard: lease.guard, fontLoader: ctx.fontLoader });
      if (!lease.guard()) { await output.resource.destroy(); retire(panel, stale()); return stale(); }
      if (hasPanel(panel)) {
        entry.resource = output.resource; entry.content = output.content;
        panel.pageCount = output.pageCount; panel.pageTo = output.pageCount; panel.busy = false;
      } else void Promise.resolve(output.resource.destroy()).catch(() => {});
      return applied(panel, { printDialogId: panel.id, pageCount: output.pageCount });
    } catch (error) {
      const result = rejected(error.code ?? 'unsupported_content', error.message ?? 'The genuine print document could not be decoded.');
      if (!lease.guard()) { retire(panel, stale()); return stale(); }
      panel.busy = false; panel.error = result.error.message;
      return result;
    }
  }
  async function chooseFile(spec = {}, ownership) {
    const source = sourceLease(spec, ownership), accept = spec.accept ?? ['*/*'];
    if (!source) return stale();
    if (!Array.isArray(accept) || !accept.length || accept.length > 32 || !accept.every(mime => typeof mime === 'string' && /^(?:\*\/\*|[\w.+-]+\/(?:[\w.+-]+|\*))$/.test(mime)) || spec.multiple === true)
      return rejected('invalid_arguments', 'Choose one original File using actual MIME filters.');
    return new Promise(resolve => { open('picker', typeof spec.title === 'string' ? spec.title.slice(0, 1024) : 'Open', source, { accept: [...accept] }, resolve)
      .then(opened => { if (opened.error && !opened.entry) resolve(opened.error); }).catch(error => resolve(rejected('unavailable', error.message))); });
  }
  async function saveFile(spec = {}, ownership) {
    const source = sourceLease(spec, ownership);
    if (!source) return stale();
    if (!fields(spec, ['name', 'mime', 'text', 'appId', 'windowId'], ['name', 'mime', 'text'])
      || typeof spec.name !== 'string' || !spec.name || spec.name.length > 255
      || !validFileMime(spec.mime)
      || typeof spec.text !== 'string' || spec.text.length > 1024 * 1024)
      return rejected('invalid_arguments', 'Provide an original bounded filename, MIME and exact file content.');
    const retained = { name: spec.name, mime: spec.mime, text: spec.text, saveMode: true };
    return new Promise(resolve => { open('picker', spec.name, source, retained, resolve)
      .then(opened => {
        if (opened.error && !opened.entry) { resolve(opened.error); return; }
        const folder = getFile(opened.panel.location);
        opened.entry.folder = folder ? { file: folder, signature: JSON.stringify(folder) } : null;
      }).catch(error => resolve(rejected('unavailable', error.message))); });
  }
  async function share(spec, ownership) {
    const source = sourceLease(spec, ownership), document = packet(spec);
    if (!source) return stale();
    if (!document) return rejected('invalid_arguments', 'Provide genuine document bytes or text for sharing.');
    const opened = await open('share', document.title, source, document);
    if (opened.error) return opened.error;
    const { panel, lease } = opened;
    panel.busy = true;
    try {
      await validateDestinationDocument(document, { guard: lease.guard });
      if (!lease.guard()) { retire(panel, stale()); return stale(); }
      panel.busy = false; return applied(panel, { shareId: panel.id });
    } catch (error) {
      const result = rejected(error.code ?? 'unsupported_content', error.message ?? 'The original shared document bytes could not be decoded.');
      retire(panel, result); return result;
    }
  }
  function windowOpened(window, options = {}) {
    if (!alive() || !window || ctx.getWindow(window.id) !== window || window.appId !== appId) return false;
    const entry = entries.get(options.documentDestinationId);
    if (!entry || entry.panel.windowId !== null || !hasPanel(entry.panel) || entry.source && !entry.source.guard()
      || window.utilityKind !== (entry.panel.kind === 'queue' ? 'document-print' : `document-${entry.panel.kind}`)) return false;
    entry.panel.windowId = window.id; entry.window = window;
    return true;
  }
  function windowClosed(windowOrId) {
    const windowId = typeof windowOrId === 'string' ? windowOrId : windowOrId?.id;
    let descriptor = null;
    for (const entry of [...entries.values()]) {
      const panel = entry.panel;
      if (panel.windowId === windowId && (typeof windowOrId === 'string' || entry?.window === windowOrId)) {
        retire(panel, rejected('cancelled', 'The native destination window closed.'), false);
        // The root consumes this exact original-source descriptor for its
        // synchronous active-window focus transfer; legacy boolean callers
        // simply observe truthiness.
        descriptor ??= returnDescriptor(entry);
      }
      else if (entry?.source?.source.windowId === windowId && (typeof windowOrId === 'string' || entry.source.window === windowOrId)) retire(panel, stale());
    }
    return descriptor;
  }
  function appQuit(quitAppId) {
    for (const entry of [...entries.values()]) {
      const panel = entry.panel;
      if (quitAppId === appId || entry?.source?.source.appId === quitAppId) retire(panel, rejected('cancelled', 'The owning application quit.'));
    }
  }
  async function renderPage(canvas, panelId, page, guard = () => true) {
    const lease = panelLease(panelId), resource = lease?.entry.resource;
    if (!lease || lease.panel.kind !== 'print' || !resource || !guard()) fail(stale());
    const current = () => lease.guard() && lease.entry.resource === resource && lease.panel.previewPage === page && guard() === true;
    return renderPrintPage(resource, canvas, page, { guard: current });
  }
  function targets() {
    for (const entry of [...entries.values()]) {
      const panel = entry.panel;
      if (!hasPanel(panel) || entry.source && !entry.source.guard() || entry.window && ctx.getWindow(panel.windowId) !== entry.window
        || entry.view && ctx.getView(panel.windowId) !== entry.view) retire(panel, stale());
    }
    if (!alive()) return { panels: [], jobs: [], localOnly: true };
    return { panels: presentation.panels.map(panel => ({ ...copyCanonicalData(panel), native: ctx.getView(panel.windowId)?.describe?.() ?? null,
      previewProof: ctx.getView(panel.windowId)?.proof?.() ?? null })), jobs: copyCanonicalData(printing.jobs), localOnly: true };
  }
  function candidateJob(lease, output) {
    if (!validatePrintingState(printing).ok) return { error: rejected('invalid_state', 'The canonical print graph is invalid.') };
    const time = ctx.getSceneTime();
    if (printing.jobs.length >= PRINTING_LIMITS.jobs || printing.nextJobId >= PRINTING_LIMITS.counter || !Number.isSafeInteger(time)
      || time < (printing.jobs.at(-1)?.createdAt ?? 0) || time > PRINTING_LIMITS.timestamp) return { error: rejected('limit_exceeded', 'The print archive identity/time capacity is exhausted.') };
    const panel = lease.panel, job = { id: `job-${printing.nextJobId}`, title: panel.title, source: copyCanonicalData(lease.entry.source.source),
      origin: lease.entry.spec.origin, mime: lease.entry.spec.mime, archiveFileId: 'pending-archive', printerId: 'studio-printer', copies: panel.copies,
      pageCount: panel.pageCount, pageFrom: panel.pageFrom, pageTo: panel.pageTo, pdfBase64: output.base64, status: 'queued', printedPages: 0, createdAt: time };
    return { job, nextJobId: printing.nextJobId + 1 };
  }
  async function outputPdf(lease, name, queue) {
    if (lease.panel.kind !== 'print' || lease.panel.busy || !lease.entry.resource) return rejected('disabled', 'The original decoded print document is not ready.');
    const panel = lease.panel, content = lease.entry.content, from = panel.pageFrom, to = panel.pageTo, copies = panel.copies;
    panel.busy = true;
    const guard = () => lease.guard() && lease.entry.content === content && panel.pageFrom === from && panel.pageTo === to && panel.copies === copies;
    let acknowledged = null, callbackFailure = null, finishCommit = null;
    try {
      const output = await selectPrintPages(content, from, to, { guard });
      if (!guard()) return stale();
      const prepared = queue ? candidateJob(lease, output) : {};
      if (prepared.error) return prepared.error;
      const oldCounter = printing.nextJobId, oldJobs = [...printing.jobs], signature = JSON.stringify(printing);
      const commitGuard = () => guard() && printing.nextJobId === oldCounter && oldJobs.length === printing.jobs.length
        && oldJobs.every((job, index) => printing.jobs[index] === job) && JSON.stringify(printing) === signature;
      // The prospective ID is not authority. Reserve known job growth now; in
      // onCommit the root's pending Files delta is combined with the exact real
      // archive ID/job delta, avoiding conservative-ID false quota rejections.
      const provisional = queue ? { ...prepared.job, archiveFileId: '' } : null;
      const reserve = queue ? printingTextUnits({ nextJobId: prepared.nextJobId, jobs: [...printing.jobs, provisional] }) - printingTextUnits(printing) : 0;
      if (!budget(reserve)) return rejected('limit_exceeded', 'The complete scene cannot retain the print archive.');
      finishCommit = holdSettlement(lease.entry);
      const result = await ctx.createFile({ name, mime: 'application/pdf', text: output.content, source: copyCanonicalData(lease.entry.source.source), reserveTextUnits: reserve,
        onCommit: (fileId, file) => {
          if (acknowledged || !commitGuard() || !validPrintingId(fileId) || !file || file.id !== fileId || fileContent(file) !== output.content || documentFileMime(file) !== 'application/pdf') return false;
          if (queue) {
            const job = { ...prepared.job, archiveFileId: fileId }, candidate = { nextJobId: prepared.nextJobId, jobs: [...printing.jobs, job] };
            const delta = printingTextUnits(candidate) - printingTextUnits(printing);
            if (!validatePrintingState(candidate).ok) { callbackFailure = rejected('invalid_state', 'The exact canonical print archive failed validation.'); return false; }
            if (!budget(delta)) { callbackFailure = rejected('limit_exceeded', 'The combined Files and print archive exceed the complete scene budget.'); return false; }
            printing.jobs.push(job); printing.nextJobId = prepared.nextJobId;
            acknowledged = { fileId, jobId: job.id };
          } else acknowledged = { fileId };
          return true;
        } }, { guard: commitGuard, windowId: panel.windowId });
      if (acknowledged) {
        // Acknowledged canonical commits survive a later presentation retirement.
        if (!retire(panel, applied(panel, acknowledged))) settleEntry(lease.entry, applied(panel, acknowledged));
        return applied(panel, { ...acknowledged, ...(result?.status !== 'applied' ? { presentationRetired: !hasPanel(panel) } : {}) });
      }
      return callbackFailure ?? (guard() ? result?.status === 'rejected' ? result : rejected('unavailable', 'Files did not atomically acknowledge the genuine PDF archive.') : stale());
    } catch (error) {
      if (acknowledged) { if (!retire(panel, applied(panel, acknowledged))) settleEntry(lease.entry, applied(panel, acknowledged)); return applied(panel, acknowledged); }
      return rejected(error.code ?? 'unsupported_content', error.message ?? 'The genuine PDF output failed.');
    }
    finally { finishCommit?.(); if (hasPanel(panel)) panel.busy = false; }
  }
  async function shareAction(lease, action) {
    const { panel, entry } = lease;
    if (panel.kind !== 'share' || panel.busy) return rejected('disabled', 'The original local sharing sheet is not ready.');
    const document = entry.spec;
    panel.busy = true;
    let acknowledged = null;
    const onCommit = (id, record) => {
      if (acknowledged || !lease.guard()) return false;
      if (action === 'mail' || action === 'message') {
        if (!validPrintingId(id) || !record || record.id !== id) return false;
        acknowledged = { draftId: id };
      } else if (action === 'file') {
        if (!validPrintingId(id) || !record || record.id !== id || fileContent(record) !== document.content || documentFileMime(record) !== document.mime) return false;
        acknowledged = { fileId: id };
      } else acknowledged = { clipboard: true };
      return true;
    };
    const finishCommit = holdSettlement(entry);
    try {
      let result;
      const ownership = { guard: lease.guard, windowId: panel.windowId };
      if (action === 'file') result = await ctx.createFile({ name: document.title, mime: document.mime, text: document.content,
        source: copyCanonicalData(entry.source.source), reserveTextUnits: 0, onCommit }, ownership);
      else if (action === 'clipboard') {
        if (!document.mime.startsWith('text/')) return rejected('unsupported_content', 'The shared clipboard accepts text only; use Mail, Messages or Files to preserve PDF/image MIME and bytes.');
        result = await ctx.setClipboard({ kind: 'text', text: document.content, fileIds: [], reserveTextUnits: 0, onCommit }, ownership);
      } else {
        const composer = action === 'mail' ? ctx.composeMail : ctx.composeMessage;
        if (typeof composer !== 'function') return rejected('unavailable', 'The original local draft composer is unavailable.');
        const plain = document.mime.startsWith('text/');
        result = await composer({ title: document.title, subject: document.title, body: plain ? document.content : '',
          attachments: plain ? [] : [{ name: document.title, mime: document.mime, content: document.content, text: document.content }],
          source: copyCanonicalData(entry.source.source), reserveTextUnits: 0, onCommit }, ownership);
      }
      if (acknowledged) {
        // Atomic draft/file/clipboard acknowledgement survives later presentation retirement.
        if (!retire(panel, applied(panel, acknowledged))) settleEntry(lease.entry, applied(panel, { shareId: panel.id, action, ...acknowledged, localOnly: true }));
        return applied(panel, { shareId: panel.id, action, ...acknowledged, localOnly: true });
      }
      return lease.guard() ? result?.status === 'rejected' ? result : rejected('unavailable', 'The local destination did not acknowledge an actual canonical draft/value.') : stale();
    } catch (error) {
      if (acknowledged) { if (!retire(panel, applied(panel, acknowledged))) settleEntry(lease.entry, applied(panel, { shareId: panel.id, action, ...acknowledged, localOnly: true })); return applied(panel, { shareId: panel.id, action, ...acknowledged, localOnly: true }); }
      return rejected(error.code ?? 'unavailable', error.message ?? 'The local sharing action failed.');
    }
    finally { finishCommit(); if (hasPanel(panel)) panel.busy = false; }
  }
  function queueMutation(lease, suffix, jobId, pages) {
    if (lease.panel.kind !== 'queue') return rejected('disabled', 'Open the actual native print queue first.');
    if (!validatePrintingState(printing).ok) return rejected('invalid_state', 'The canonical print graph is invalid.');
    const candidate = copyCanonicalData(printing), job = candidate.jobs.find(row => row.id === jobId), jobIds = [];
    if (suffix !== 'queue.advance') {
      if (!job) return stale();
      if (suffix === 'queue.pause' && ['queued', 'printing'].includes(job.status)) job.status = 'paused';
      else if (suffix === 'queue.resume' && job.status === 'paused') job.status = 'queued';
      else if (suffix === 'queue.cancel' && ['queued', 'printing', 'paused'].includes(job.status)) job.status = 'cancelled';
      else return rejected('disabled', 'Only pending jobs can pause/cancel, and only paused jobs can resume.');
      jobIds.push(job.id);
    } else {
      let remaining = pages;
      for (const row of candidate.jobs) {
        if (!['queued', 'printing'].includes(row.status)) continue;
        if (!remaining) { if (row.status === 'printing') row.status = 'queued'; continue; }
        const count = Math.min(remaining, printedPageTotal(row) - row.printedPages);
        row.printedPages += count; remaining -= count;
        row.status = row.printedPages === printedPageTotal(row) ? 'completed' : 'printing'; jobIds.push(row.id);
      }
      if (!jobIds.length) return rejected('disabled', 'There are no runnable queued jobs.');
    }
    const delta = printingTextUnits(candidate) - printingTextUnits(printing);
    if (!validatePrintingState(candidate).ok || !budget(delta)) return rejected('limit_exceeded', 'The complete scene text budget would be exceeded.');
    if (!lease.guard()) return stale();
    for (let index = 0; index < candidate.jobs.length; index++) {
      // All immutable source/PDF/archive metadata stays on original job objects.
      printing.jobs[index].status = candidate.jobs[index].status; printing.jobs[index].printedPages = candidate.jobs[index].printedPages;
    }
    return applied(lease.panel, { jobIds });
  }
  const handlers = {};
  for (const [suffix, [targetSchema, payloadSchema]] of Object.entries(specs)) handlers[`documentDestination.${suffix}`] = async (target = {}, payload = {}) => {
    if (!schemaValid(target, targetSchema) || !schemaValid(payload, payloadSchema)) return rejected('invalid_arguments', 'Use the closed document destination command schema.');
    if (suffix === 'queue.open') {
      const opened = await open('queue', 'Print Center', null);
      return opened.error ?? applied(opened.panel, { queueId: opened.panel.id });
    }
    const lease = panelLease(target.panelId), panel = lease?.panel;
    if (!lease) {
      const entry = entries.get(target.panelId);
      if (entry && (!hasPanel(entry.panel) || entry.source && !entry.source.guard() || entry.window && ctx.getWindow(entry.panel.windowId) !== entry.window
        || entry.view && ctx.getView(entry.panel.windowId) !== entry.view)) retire(entry.panel, stale());
      return stale();
    }
    if (suffix === 'cancel') { retire(panel); return applied(panel, { cancelled: true }); }
    if (suffix === 'focus') {
      const focused = await lease.view.focus?.(payload.controlId, payload.fileId, lease.guard);
      if (!lease.guard()) return stale();
      return focused === true ? applied(panel) : rejected('unavailable', 'The actual enabled native control is unavailable.');
    }
    if (suffix === 'scroll') {
      const position = await lease.view.scroll?.({ area: payload.area, top: payload.top, left: payload.left ?? 0 }, lease.guard);
      if (!lease.guard()) return stale();
      return position && typeof position.top === 'number' && typeof position.left === 'number'
        ? applied(panel, { position, native: lease.view.describe?.() ?? null }) : rejected('unavailable', 'The actual native inner scroller is unavailable.');
    }
    if (suffix.startsWith('queue.')) return queueMutation(lease, suffix, target.jobId, payload.pages);
    if (panel.busy) return rejected('disabled', 'Wait for the original local document operation.');
    if (suffix === 'configure') {
      if (panel.kind !== 'print' || !Object.keys(payload).length) return rejected('invalid_arguments', 'Configure the actual print settings.');
      const settings = { copies: panel.copies, pageFrom: panel.pageFrom, pageTo: panel.pageTo, ...payload };
      if (settings.pageFrom > settings.pageTo || settings.pageTo > panel.pageCount) return rejected('invalid_arguments', 'The selected page range must exist in the genuinely decoded document.');
      Object.assign(panel, settings); return applied(panel);
    }
    if (suffix === 'previewPage') {
      if (panel.kind !== 'print' || payload.page > panel.pageCount) return rejected('invalid_arguments', 'The requested genuine PDF page does not exist.');
      panel.previewPage = payload.page; return applied(panel);
    }
    if (suffix === 'print') {
      const suffix = ` - ${printing.nextJobId}.pdf`, windows = appId === 'explorer';
      const title = panel.title.trim().replace(windows ? /[\\/:*?"<>|\u0000-\u001f]/g : /[:/\u0000-\u001f]/g, '-').replace(/^\.+/, '') || 'Document';
      return outputPdf(lease, `${title.slice(0, (windows ? 100 : 255) - suffix.length)}${suffix}`, true);
    }
    if (suffix === 'savePdf') return outputPdf(lease, payload.name, false);
    if (suffix === 'share.action') return shareAction(lease, payload.action);
    if (suffix.startsWith('save.')) {
      if (panel.kind !== 'picker' || !panel.saveMode) return rejected('disabled', 'The original destination is not a Save As sheet.');
      if (suffix === 'save.name') { panel.saveName = payload.name; panel.replacement = null; lease.entry.replacement = null; return applied(panel); }
      const folder = lease.entry.folder;
      if (!folder || getFile(panel.location) !== folder.file || folder.file.readOnly || JSON.stringify(folder.file) !== folder.signature) return stale();
      const collision = files.files.find(file => isLive(files, file) && file.parentId === panel.location
        && file.name.toLocaleLowerCase() === panel.saveName.toLocaleLowerCase());
      if (suffix === 'save.confirm' && collision) {
        if (collision.kind === 'folder' || collision.readOnly) return rejected('disabled', 'The existing destination cannot be replaced.');
        lease.entry.replacement = { file: collision, signature: JSON.stringify(collision) };
        panel.replacement = { fileId: collision.id, revision: collision.revision, name: collision.name };
        return applied(panel, { replacementRequired: true });
      }
      if (suffix === 'save.replace') {
        const original = lease.entry.replacement;
        if (!original || collision !== original.file || payload.fileId !== original.file.id || payload.revision !== original.file.revision
          || getFile(payload.fileId) !== original.file || JSON.stringify(original.file) !== original.signature) return stale();
      }
      if (typeof ctx.createFile !== 'function') return rejected('unavailable', 'The actual shared Files save transaction is unavailable.');
      const spec = { name: panel.saveName, mime: lease.entry.spec.mime, text: lease.entry.spec.text, folderId: panel.location,
        ...(suffix === 'save.replace' ? { existingFileId: collision.id, expectedRevision: payload.revision } : {}) };
      panel.busy = true;
      const finishCommit = holdSettlement(lease.entry);
      try {
        const result = await ctx.createFile(spec, { guard: lease.guard, windowId: panel.windowId });
        if (result?.status !== 'applied')
          return result?.status === 'rejected' ? result : rejected('unavailable', 'The actual File did not acknowledge its save.');
        const fileId = result.fileId ?? result.target?.fileId;
        if (!validPrintingId(fileId)) return rejected('unavailable', 'The actual save did not acknowledge a File identity.');
        const acknowledged = { ...result, fileId };
        if (!retire(panel, acknowledged)) settleEntry(lease.entry, acknowledged);
        return acknowledged;
      } finally { finishCommit(); if (hasPanel(panel)) panel.busy = false; }
    }
    if (panel.kind !== 'picker') return rejected('disabled', 'The original destination is not a file picker.');
    if (suffix === 'picker.location') {
      const folder = getFile(payload.location);
      if (!folder || folder.kind !== 'folder' || panel.saveMode && folder.readOnly) return stale();
      panel.location = folder.id; panel.selectedFileId = null; panel.replacement = null; lease.entry.selection = null;
      lease.entry.replacement = null; lease.entry.folder = { file: folder, signature: JSON.stringify(folder) }; return applied(panel);
    }
    if (suffix === 'picker.query') { panel.query = payload.query; panel.selectedFileId = null; lease.entry.selection = null; return applied(panel); }
    if (suffix === 'picker.select') {
      if (panel.saveMode) return rejected('disabled', 'Select a destination folder, not a source File, in Save As.');
      const file = getFile(payload.fileId);
      if (!file || file.kind === 'folder' || file.parentId !== panel.location || !documentMimeAccepted(documentFileMime(file), panel.accept)
        || !file.name.toLocaleLowerCase().includes(panel.query.toLocaleLowerCase())) return rejected('unavailable', 'Select a current live File matching the actual MIME filter and location.');
      panel.selectedFileId = file.id; lease.entry.selection = { file, signature: JSON.stringify(file) }; return applied(panel, { fileId: file.id });
    }
    if (suffix === 'picker.open') {
      if (panel.saveMode) return rejected('disabled', 'The Save As sheet cannot open a source File.');
      const selection = lease.entry.selection, file = selection?.file;
      if (!file || getFile(panel.selectedFileId) !== file || JSON.stringify(file) !== selection.signature || !documentMimeAccepted(documentFileMime(file), panel.accept)) {
        const result = stale(); retire(panel, result); return result;
      }
      // The native Open acknowledgement returns at once; the original chooser
      // promise settles only after the actual utility close, a tick and the
      // guarded original focus/caret restore, never before them.
      const result = applied(panel, { fileId: file.id, file });
      if (!retire(panel, result)) settleEntry(lease.entry, result);
      return result;
    }
    return rejected('unsupported_command', 'The local document destination command is unavailable.');
  };
  return { handlers, targets, windowOpened, windowClosed, appQuit, printDocument, chooseFile, saveFile, share, renderPage,
    dispose: () => { for (const entry of [...entries.values()]) retire(entry.panel, stale()); } };
}

import { applyCanonicalData, copyCanonicalData, canonicalStringUnits } from './canonical-data.js';
import { encodeDOCX, decodeDOCX } from './createoffice-xml-codec.js';
import { pagesPDF } from './pages-pdf.js';
import { pagesCodecDocument } from './pages-documents.js';
import { pagesEstimatePages } from './pages-render.js';
import { pagesCapabilities, pagesWindowMetadata, pagesNewWindow, pagesWindow, pagesDocument, pagesDirty, pagesText, pagesDefaultRun, pagesAllocate, pagesCreateDocument, pagesNormalizeRuns, pagesReplaceText, pagesReplaceRange, pagesFormatRange, pagesSelectedText, pagesHistory, pagesPreset, pagesCommandSpecs, pagesTargetSchema, pagesSelectionSchema, pagesSchemaValid, validatePagesState, pagesIdSchema, pagesRunSchema, PAGES_DOCX_MIME, PAGES_LIMITS } from './pages-model.js';

const rejected = (code, message) => ({ status: 'rejected', error: { code, message } });
const applied = (windowId, extra = {}) => ({ status: 'applied', target: { windowId }, ...extra });
const stale = () => rejected('stale_target', 'The original Pages graph, document, nested reference, window, editor, File or scene time changed.');
const unavailable = message => rejected('unavailable', message);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const references = (value, path = [], result = []) => { if (value && typeof value === 'object') { result.push([path, value]); for (const key of Object.keys(value)) references(value[key], [...path, key], result); } return result; };
const refsCurrent = (value, refs) => refs.every(([path, original]) => path.reduce((node, key) => node?.[key], value) === original);
const nameValid = name => typeof name === 'string' && !!name.trim() && name.length <= 128 && !/[\x00-\x1f/\\]/u.test(name) && !['.', '..'].includes(name);

export function createPagesCommands(ctx) {
  const state = ctx.getState(), cap = pagesCapabilities(ctx.profile), originals = new Map(), creations = new WeakMap(); let disposed = false, generation = 0;
  const now = () => ctx.getSceneTime();
  const alive = () => !disposed && ctx.alive() === true && ctx.getState() === state;
  function graphGuard() { const signature = JSON.stringify(state), refs = references(state), version = generation, time = now(); return () => alive() && generation === version && now() === time && JSON.stringify(state) === signature && refsCurrent(state, refs); }
  function lease(windowId, native = false) {
    if (!alive() || !validatePagesState(state, ctx.profile).ok) return null;
    const window = ctx.getWindow(windowId), session = pagesWindow(state, windowId), view = ctx.getView(windowId), document = session && pagesDocument(state, session.documentId);
    if (!window || window.appId !== cap.appId || !session || originals.get(windowId) !== window || ctx.available(window) !== true || native && view?.available?.() !== true) return null;
    const graph = graphGuard(), windowSignature = JSON.stringify(window), windowRefs = references(window);
    return { windowId, window, session, document, view, time: now(), guard: () => graph() && ctx.getWindow(windowId) === window && originals.get(windowId) === window && pagesWindow(state, windowId) === session && pagesDocument(state, session.documentId) === document && ctx.getView(windowId) === view && JSON.stringify(window) === windowSignature && refsCurrent(window, windowRefs) && ctx.available(window) === true && (!native || view.available() === true) };
  }
  function prepare(owner, mutate) {
    if (!owner.guard()) return { error: stale() };
    const candidate = copyCanonicalData(state), session = pagesWindow(candidate, owner.windowId), document = pagesDocument(candidate, session.documentId);
    try { mutate(candidate, session, document); session.revision++; } catch (error) { return { error: rejected(error.code ?? 'invalid_arguments', error.message) }; }
    const valid = validatePagesState(candidate, ctx.profile), delta = canonicalStringUnits(candidate) - canonicalStringUnits(state);
    if (!valid.ok) return { error: rejected('invalid_state', valid.message) };
    if (ctx.canCommit(delta) !== true) return { error: rejected('limit_exceeded', 'The complete scene document/history retention budget is exhausted.') };
    return owner.guard() ? { candidate, delta } : { error: stale() };
  }
  function publish(candidate) { applyCanonicalData(state, candidate); generation++; }
  function commit(owner, mutate, extra = {}) { const plan = prepare(owner, mutate); if (plan.error) return plan.error; if (!owner.guard()) return stale(); publish(plan.candidate); return applied(owner.windowId, extra); }
  function requireDoc(owner) { if (!owner.document || owner.session.mode !== 'editor') fail('disabled', 'Open or create an actual document first.'); }
  function block(document, id, type) { const row = document?.content.blocks.find(row => row.id === id); if (!row || type && row.type !== type) fail('stale_target', 'The original document object is unavailable.'); return row; }
  function reconcile(candidate, document) {
    for (const session of candidate.windows.filter(row => row.documentId === document.id)) {
      if (session.selectedId && !document.content.blocks.some(row => row.id === session.selectedId)) session.selectedId = null;
      if (session.pageAnchor && !document.content.blocks.some(row => row.id === session.pageAnchor)) session.pageAnchor = document.content.blocks[0].id;
      const row = document.content.blocks.find(row => row.id === session.selection.blockId);
      if (!row || row.type !== 'paragraph') session.selection = { blockId: null, start: 0, end: 0 };
      else {
        session.selection.start = Math.min(session.selection.start, pagesText(row).length);
        const end = document.content.blocks.find(block => block.id === (session.selection.endBlockId ?? row.id));
        if (!end || end.type !== 'paragraph' || document.content.blocks.indexOf(end) < document.content.blocks.indexOf(row)) { delete session.selection.endBlockId; session.selection.end = session.selection.start; }
        else session.selection.end = Math.min(session.selection.end, pagesText(end).length);
        if (!session.selection.endBlockId) session.selection.end = Math.max(session.selection.start, session.selection.end);
      }
    }
  }
  function selectDocument(session, document) { session.documentId = document.id; session.mode = 'editor'; session.dialog = null; session.closing = false; session.popup = null; session.menu = null; session.selectedId = null; const first = document.content.blocks.find(row => row.type === 'paragraph'); session.selection = { blockId: first?.id ?? null, start: 0, end: 0 }; session.pageAnchor = document.content.blocks[0].id; }
  function edit(owner, change) { requireDoc(owner); return commit(owner, (candidate, session, document) => { pagesHistory(document, content => change(content, candidate, session, document)); if (session.selectedId !== owner.session.selectedId) session.pageAnchor = session.selectedId; else if (session.selection.blockId !== owner.session.selection.blockId) session.pageAnchor = session.selection.blockId; reconcile(candidate, document); session.status = ''; session.popup = null; }); }
  function fileLease(owner, fileId, expectedRevision) {
    const file = ctx.getFile?.(fileId);
    if (!file || file.id !== fileId || expectedRevision !== undefined && file.revision !== expectedRevision) return { error: rejected('conflict', 'The original File revision is unavailable. Save As preserves both versions.') };
    const signature = JSON.stringify(file), refs = references(file), revision = file.revision;
    return { ...owner, file, guard: () => owner.guard() && ctx.getFile(fileId) === file && file.revision === revision && JSON.stringify(file) === signature && refsCurrent(file, refs) };
  }
  async function choose(owner, accept, title) {
    if (typeof ctx.chooseFile !== 'function') return { error: unavailable('The Root native File chooser is unavailable.') };
    const result = await ctx.chooseFile({ title, accept, multiple: false, source: { appId: cap.appId, windowId: owner.windowId, ...(owner.document ? { documentId: owner.document.id } : {}) } }, { guard: owner.guard, windowId: owner.windowId });
    if (!owner.guard()) return { error: stale() };
    const fileId = result?.fileId ?? result?.target?.fileId;
    return result?.status === 'applied' && pagesSchemaValid(fileId, pagesIdSchema) ? { fileId } : { error: result?.status === 'rejected' ? result : unavailable('No original File was selected.') };
  }
  async function read(owner, fileId, expectedRevision) {
    const pinned = fileLease(owner, fileId, expectedRevision); if (pinned.error) return pinned;
    if (typeof ctx.readFile !== 'function') return { error: unavailable('The Root original File byte reader is unavailable.') };
    const result = await ctx.readFile(fileId, { guard: pinned.guard, windowId: owner.windowId });
    if (!pinned.guard()) return { error: stale() };
    if (result?.status !== 'applied' || result.file !== pinned.file || typeof result.text !== 'string' || result.mime !== pinned.file.mime || result.name !== pinned.file.name) return { error: result?.status === 'rejected' ? result : unavailable('The reader did not return the actual original File and bytes.') };
    return { ...pinned, text: result.text, mime: result.mime, name: result.name };
  }
  function imported(candidate, neutral) {
    const content = { title: neutral.title || 'Untitled', page: { width: neutral.page?.width ?? 612, height: neutral.page?.height ?? 792, margin: neutral.page?.margin ?? 54 }, blocks: [] };
    for (const row of neutral.blocks ?? []) {
      const id = pagesAllocate(candidate, 'pages-block');
      if (row.type === 'paragraph') content.blocks.push({ id, type: 'paragraph', style: 'Body', align: row.align ?? 'left', ...(Object.hasOwn(row, 'pageBreakBefore') ? { pageBreakBefore: row.pageBreakBefore } : {}), runs: pagesNormalizeRuns((row.runs ?? []).map(run => ({ ...pagesDefaultRun(run.text ?? ''), ...Object.fromEntries(Object.keys(pagesRunSchema.properties).filter(key => Object.hasOwn(run, key)).map(key => [key, run[key]])) }))) });
      else if (row.type === 'table') content.blocks.push({ id, type: 'table', rows: row.rows.map(cells => cells.map(cell => ({ text: typeof cell === 'string' ? cell : cell.text ?? '' }))) });
      else if (row.type === 'image') content.blocks.push({ id, type: 'image', content: row.content, width: row.width, height: row.height, alt: row.alt ?? 'Imported image' });
      else if (row.type === 'chart') content.blocks.push({ id, type: 'chart', kind: row.kind, title: row.title ?? '', labels: [...row.labels], values: [...row.values] });
      else fail('unsupported_content', 'This DOCX contains an object that cannot be retained by the rich Pages model.');
    }
    if (!content.blocks.length) content.blocks.push({ id: pagesAllocate(candidate, 'pages-block'), type: 'paragraph', style: 'Body', align: 'left', runs: [pagesDefaultRun('')] });
    return content;
  }
  async function open(owner, payload) {
    let fileId = payload.fileId; if (!fileId) { const selected = await choose(owner, [PAGES_DOCX_MIME], 'Open a Word document'); if (selected.error) return selected.error; fileId = selected.fileId; }
    const source = await read(owner, fileId); if (source.error) return source.error;
    if (source.mime !== PAGES_DOCX_MIME || /\.pages$/iu.test(source.name)) return rejected('unsupported_content', 'Native .pages IWA packages are unavailable. Open a genuine .docx document exported from Pages or Word.');
    const neutral = decodeDOCX(source.text);
    return commit(source, (candidate, session) => {
      let document = candidate.documents.find(row => row.fileId === fileId);
      if (document) { if (document.fileRevision !== source.file.revision) fail('conflict', 'This File has changed since the retained document was opened. Save As before reopening.'); selectDocument(session, document); return; }
      if (candidate.documents.length >= PAGES_LIMITS.documents) fail('limit_exceeded', 'At most 32 retained documents are supported.');
      const content = imported(candidate, neutral); document = { id: pagesAllocate(candidate, 'pages-document'), content, fileId, fileRevision: source.file.revision, savedSignature: JSON.stringify(content), revision: 0, undo: [], redo: [] }; candidate.documents.push(document); selectDocument(session, document); session.status = 'Opened genuine DOCX. Native .pages packages are not supported.';
    });
  }
  async function write(owner, output, { save = false, existingFileId = null, expectedRevision = null } = {}) {
    if (typeof ctx.createFile !== 'function' || typeof ctx.planFile !== 'function') return unavailable('The Root planned atomic File writer is unavailable.');
    if (!nameValid(output.name) || !output.name.toLowerCase().endsWith(`.${output.extension}`)) return rejected('invalid_arguments', `Use a valid ${output.extension.toUpperCase()} file name with .${output.extension}; proprietary .pages files cannot be saved.`);
    if (!owner.guard()) return stale();
    const spec = { name: output.name, mime: output.mime, content: output.content, parentId: 'documents', ...(existingFileId ? { existingFileId, expectedRevision } : {}) };
    const ownership = { guard: owner.guard, windowId: owner.windowId };
    const filePlan = ctx.planFile(spec, ownership);
    if (!owner.guard()) return stale();
    if (filePlan?.status !== 'applied' || typeof filePlan.current !== 'function' || filePlan.current() !== true || !pagesSchemaValid(filePlan.fileId, pagesIdSchema)) return filePlan?.status === 'rejected' ? filePlan : unavailable('Root did not return an actual private File plan.');
    const metadata = filePlan.metadata, metadataSignature = JSON.stringify(metadata);
    if (!metadata || metadata.id !== filePlan.fileId || metadata.name !== output.name || metadata.mime !== output.mime || metadata.content !== output.content || metadata.revision === undefined || existingFileId && (filePlan.fileId !== existingFileId || metadata.revision === expectedRevision)) return unavailable('Root File plan does not describe the actual requested bytes and next revision.');
    const plannedOwner = { ...owner, guard: () => owner.guard() && filePlan.current() === true && filePlan.metadata === metadata && JSON.stringify(metadata) === metadataSignature };
    const plan = prepare(plannedOwner, (_, session, document) => {
      session.dialog = null; session.status = save ? 'Saved genuine DOCX.' : `Exported genuine ${output.extension.toUpperCase()}.`;
      if (save) { document.savedSignature = JSON.stringify(document.content); document.fileId = filePlan.fileId; document.fileRevision = metadata.revision; }
    });
    if (plan.error) return plan.error;
    let committed = null;
    const result = await ctx.createFile({ ...spec, plan: filePlan, reserveTextUnits: plan.delta,
      onCommit(fileId, file, actualPlannedMetadata) {
        if (committed || !plannedOwner.guard() || fileId !== filePlan.fileId || !file || file.id !== fileId || existingFileId && file !== owner.file || actualPlannedMetadata !== metadata || JSON.stringify(actualPlannedMetadata) !== metadataSignature) return false;
        const originalSignature = JSON.stringify(file), originalRefs = references(file);
        if (!validatePagesState(plan.candidate, ctx.profile).ok || canonicalStringUnits(plan.candidate) - canonicalStringUnits(state) !== plan.delta || ctx.canCommit(plan.delta) !== true || !plannedOwner.guard() || JSON.stringify(file) !== originalSignature || !refsCurrent(file, originalRefs)) return false;
        publish(plan.candidate); committed = { fileId, file }; return true;
      },
    }, { guard: plannedOwner.guard, windowId: owner.windowId });
    // Acknowledged actor publication intentionally invalidates the old lease.
    if (committed) return applied(owner.windowId, { fileId: committed.fileId, presentationAvailable: alive() && ctx.getWindow(owner.windowId) === owner.window && ctx.available(owner.window) === true });
    return plannedOwner.guard() ? result?.status === 'rejected' ? result : unavailable('Files did not accept the synchronous atomic document callback.') : stale();
  }
  async function save(owner, payload) {
    requireDoc(owner);
    if ((!owner.document.fileId || payload.saveAs) && !payload.name) return commit(owner, (_, session) => { session.dialog = 'save'; }, { confirmationRequired: true });
    const existingFileId = payload.saveAs ? null : owner.document.fileId;
    if (existingFileId) { const source = await read(owner, existingFileId, owner.document.fileRevision); if (source.error) return source.error; owner = source; }
    const encoded = encodeDOCX(pagesCodecDocument(owner.document.content)), name = payload.name ?? owner.file?.name ?? `${owner.document.content.title || 'Untitled'}.docx`;
    const result = await write(owner, { ...encoded, name }, { save: true, existingFileId, expectedRevision: owner.document.fileRevision });
    if (result.status === 'applied' && alive() && pagesWindow(state, owner.windowId) === owner.session && owner.session.closing) {
      const next = lease(owner.windowId);
      return next ? shell(next, 'window.close', {}) : result;
    }
    return result;
  }
  async function output(owner, suffix, payload) {
    requireDoc(owner); const format = suffix === 'print' ? 'pdf' : payload.format ?? 'docx';
    const encoded = format === 'pdf' ? await pagesPDF(owner.document.content, owner.time, { guard: owner.guard }) : encodeDOCX(pagesCodecDocument(owner.document.content));
    if (!owner.guard()) return stale();
    const title = owner.document.content.title || 'Untitled', name = payload.name ?? `${title}.${format}`;
    if (suffix === 'export') return write(owner, { ...encoded, name });
    const bridge = suffix === 'print' ? ctx.print : ctx.share;
    if (typeof bridge !== 'function') return unavailable(`The Root ${suffix} destination is unavailable.`);
    const result = await bridge({ title, name, mime: encoded.mime, content: encoded.content, source: { appId: cap.appId, windowId: owner.windowId, documentId: owner.document.id } }, { guard: owner.guard, windowId: owner.windowId });
    // Root has acknowledged its intentional destination publication; do not
    // demand the old source-availability lease after its modal window opens.
    return result?.status === 'applied' ? applied(owner.windowId, { destination: result, printed: false, delivered: false, presentationAvailable: owner.guard() }) : owner.guard() ? result?.status === 'rejected' ? result : unavailable('The Root destination did not open.') : stale();
  }
  async function browser(owner, payload) {
    if (typeof ctx.listFiles !== 'function') return unavailable('The Root virtual document browser is unavailable.');
    const listed = await ctx.listFiles({ guard: owner.guard, windowId: owner.windowId }); if (!owner.guard()) return stale();
    if (listed?.status !== 'applied' || !Array.isArray(listed.files)) return listed?.status === 'rejected' ? listed : unavailable('The Root virtual File listing is unavailable.');
    const query = payload.query ?? owner.session.browserQuery;
    const files = listed.files.filter(file => file.mime === PAGES_DOCX_MIME && file.name.toLowerCase().includes(query.toLowerCase())).map(file => ({ id: file.id, name: file.name, mime: file.mime, revision: file.revision, parentId: file.parentId }));
    return commit(owner, (_, session) => { session.mode = 'browser'; session.browserQuery = query; session.menu = null; session.dialog = null; }, { files });
  }
  async function clipboard(owner, suffix) {
    requireDoc(owner);
    const selection = owner.view?.captureSelection?.({ allowUnfocused: true }) ?? owner.session.selection;
    if (!pagesSchemaValid(selection, pagesSelectionSchema)) return rejected('stale_target', 'The actual native text selection is unavailable.');
    if (suffix === 'paste') {
      const clipboard = ctx.getClipboard?.(), refs = references(clipboard), fingerprint = JSON.stringify(clipboard);
      if (!clipboard || !owner.guard()) return stale();
      if (clipboard.kind === 'image') {
        const response = edit(owner, (content, candidate, session) => { if (ctx.getClipboard() !== clipboard || JSON.stringify(clipboard) !== fingerprint || !refsCurrent(clipboard, refs)) fail('stale_target', 'The original clipboard changed.'); const id = pagesAllocate(candidate, 'pages-block'); content.blocks.push({ id, type: 'image', content: clipboard.content, width: clipboard.width, height: clipboard.height, alt: 'Pasted image' }); session.selectedId = id; }); return response;
      }
      if (clipboard.kind !== 'text' || typeof clipboard.text !== 'string' || !selection.blockId) return rejected('unsupported_content', 'Paste accepts Root text or PNG/JPEG image clipboard content.');
      return edit(owner, (content, _, session) => { if (ctx.getClipboard() !== clipboard || JSON.stringify(clipboard) !== fingerprint || !refsCurrent(clipboard, refs)) fail('stale_target', 'The original clipboard changed.'); pagesReplaceRange(content, selection, clipboard.text); session.selection = { blockId: selection.blockId, start: selection.start + clipboard.text.length, end: selection.start + clipboard.text.length }; });
    }
    if (!selection.blockId || !selection.endBlockId && selection.start === selection.end) return rejected('disabled', 'Select real paragraph text to copy or cut.');
    const text = pagesSelectedText(owner.document.content, selection);
    if (typeof ctx.setClipboard !== 'function') return unavailable('Root clipboard writer is unavailable.');
    const plan = suffix === 'cut' ? prepare(owner, (candidate, session, document) => { pagesHistory(document, content => pagesReplaceRange(content, selection, '')); session.selection = { blockId: selection.blockId, start: selection.start, end: selection.start }; session.pageAnchor = selection.blockId; reconcile(candidate, document); }) : null;
    if (plan?.error) return plan.error; let committed = false;
    const response = await ctx.setClipboard({ kind: 'text', text, fileIds: [], reserveTextUnits: plan?.delta ?? 0, onCommit: () => { if (!owner.guard() || plan && ctx.canCommit(plan.delta) !== true) return false; if (plan) publish(plan.candidate); committed = true; return true; } }, { guard: owner.guard, windowId: owner.windowId });
    if (committed) return applied(owner.windowId); return owner.guard() ? response?.status === 'rejected' ? response : unavailable('Root clipboard did not acknowledge the synchronous callback.') : stale();
  }
  async function image(owner, payload) {
    requireDoc(owner); let fileId = payload.fileId;
    if (!fileId) { const selected = await choose(owner, ['image/png', 'image/jpeg'], 'Choose an image'); if (selected.error) return selected.error; fileId = selected.fileId; }
    const source = await read(owner, fileId); if (source.error) return source.error;
    if (!['image/png', 'image/jpeg'].includes(source.mime) || !source.text.startsWith(`data:${source.mime};base64,`)) return rejected('unsupported_content', 'Choose an actual PNG or JPEG image File.');
    if (typeof owner.view?.imageDimensions !== 'function' || owner.view.available() !== true) return unavailable('The original mounted image decoder is unavailable.');
    const dimensions = await owner.view.imageDimensions(source.text, source.guard); if (!source.guard()) return stale(); if (!dimensions) return rejected('invalid_format', 'The actual image bytes could not be decoded.');
    return edit(source, (content, candidate, session) => { const id = pagesAllocate(candidate, 'pages-block'), scale = Math.min(1, 420 / dimensions.width, 1200 / dimensions.height), width = dimensions.width * scale; content.blocks.push({ id, type: 'image', content: source.text, width, height: dimensions.height * scale, alt: source.name }); session.selectedId = id; });
  }
  async function shell(owner, suffix, payload) {
    if (suffix === 'window.close') {
      const dirty = owner.document && pagesDirty(owner.document), otherWindow = state.windows.some(row => row !== owner.session && row.documentId === owner.session.documentId);
      if (dirty && !otherWindow && !payload.discard) return commit(owner, (_, session) => { session.dialog = 'close'; session.closing = true; }, { confirmationRequired: true });
      if (typeof ctx.closeWindow !== 'function') return unavailable('The Root window closer is unavailable.');
      const result = await ctx.closeWindow(owner.windowId, { guard: owner.guard, windowId: owner.windowId, discard: payload.discard === true });
      return alive() && !ctx.getWindow(owner.windowId) && !pagesWindow(state, owner.windowId) ? applied(owner.windowId) : owner.guard() ? result?.status === 'rejected' ? result : unavailable('The Root did not close the original window.') : stale();
    }
    if (typeof ctx.createWindow !== 'function') return unavailable('The Root document window factory is unavailable.');
    if (payload.documentId && !pagesDocument(state, payload.documentId)) return rejected('stale_target', 'The original retained document is unavailable.');
    const options = { ...pagesWindowMetadata(ctx.profile), ...payload, isCurrent: owner.guard, ownership: { guard: owner.guard, windowId: owner.windowId } }; creations.set(options, { original: null });
    const result = await ctx.createWindow(cap.appId, options), record = creations.get(options), id = typeof result === 'string' ? result : result?.id ?? result?.windowId ?? result?.target?.windowId;
    creations.delete(options);
    return record?.original && ctx.getWindow(id) === record.original && originals.get(id) === record.original && pagesWindow(state, id) ? applied(id) : alive() ? unavailable('Root did not acknowledge an owned canonical document window.') : stale();
  }
  const handlers = {};
  for (const [suffix, [schema]] of Object.entries(pagesCommandSpecs)) handlers[`pages.${suffix}`] = async (target, payload = {}) => {
    if (!pagesSchemaValid(target, pagesTargetSchema) || !pagesSchemaValid(payload, schema)) return rejected('invalid_arguments', 'Use the closed Pages target and payload schema.');
    const owner = lease(target.windowId, ['focus', 'scroll', 'image.insert', 'copy', 'cut', 'paste'].includes(suffix));
    if (!owner) return unavailable('The original canonical Pages window or mounted native editor is unavailable.');
    try {
      if (suffix.startsWith('window.')) return await shell(owner, suffix, payload);
      if (suffix === 'open') return await open(owner, payload);
      if (suffix === 'save') return await save(owner, payload);
      if (['export', 'print', 'share'].includes(suffix)) return await output(owner, suffix, payload);
      if (suffix === 'browser') return await browser(owner, payload);
      if (suffix === 'image.insert') return await image(owner, payload);
      if (['copy', 'cut', 'paste'].includes(suffix)) return await clipboard(owner, suffix);
      if (suffix === 'focus' || suffix === 'scroll') { const result = suffix === 'focus' ? owner.view.focus(payload.controlId) : owner.view.scroll(payload); return owner.guard() && (suffix === 'focus' ? result === true : !!result) ? applied(owner.windowId, suffix === 'scroll' ? { scroll: result } : {}) : unavailable('The original enabled native control did not accept the request.'); }
      if (suffix === 'create') return commit(owner, (candidate, session) => { if (candidate.documents.length >= PAGES_LIMITS.documents) fail('limit_exceeded', 'At most 32 documents can be retained.'); const document = pagesCreateDocument(candidate, payload.template); candidate.documents.push(document); selectDocument(session, document); });
      if (suffix === 'document.switch') return commit(owner, (candidate, session) => { const document = pagesDocument(candidate, payload.documentId); if (!document) fail('stale_target', 'The retained document is unavailable.'); selectDocument(session, document); });
      if (suffix === 'page.select') {
        requireDoc(owner); const row = block(owner.document, payload.blockId), index = pagesEstimatePages(owner.document.content).findIndex(ids => ids.includes(row.id)), plan = prepare(owner, (_, session) => { session.pageAnchor = row.id; });
        if (plan.error) return plan.error;
        if (payload.focus && (typeof owner.view?.focus !== 'function' || owner.view.available?.() !== true || owner.view.focus(`page-surface:${index + 1}`) !== true)) return unavailable('The original mounted page surface did not accept focus.');
        if (!owner.guard()) return stale(); publish(plan.candidate); return applied(owner.windowId);
      }
      if (['templates', 'selection', 'object.select', 'inspector', 'menu', 'popup', 'dialog', 'view', 'toolbar'].includes(suffix)) return commit(owner, (_, session, document) => {
        if (suffix === 'templates') { session.mode = 'templates'; if (payload.template) session.template = payload.template; if (payload.category) session.category = payload.category; }
        else if (suffix === 'selection') { if (payload.blockId) block(document, payload.blockId, 'paragraph'); session.selection = copyCanonicalData(payload); session.selectedId = payload.blockId; if (payload.blockId) session.pageAnchor = payload.blockId; }
        else if (suffix === 'object.select') { const row = block(document, payload.blockId); session.selectedId = row.id; session.pageAnchor = row.id; if (row.type !== 'paragraph') session.selection = { blockId: null, start: 0, end: 0 }; }
        else if (suffix === 'inspector') session.inspector = payload.panel;
        else if (suffix === 'view') { if (payload.zoom !== undefined) session.zoom = payload.zoom; if (payload.thumbnails !== undefined) session.thumbnails = payload.thumbnails; }
        else if (suffix === 'toolbar') for (const key of ['visible', 'iconsOnly', 'items']) { if (payload[key] !== undefined) session.toolbar[key] = copyCanonicalData(payload[key]); }
        else if (suffix === 'dialog') { if (payload.dialog === null && ['close', 'save'].includes(session.dialog)) session.closing = false; session.dialog = payload.dialog; }
        else session[suffix] = payload[suffix];
      });
      if (suffix === 'undo' || suffix === 'redo') { requireDoc(owner); return commit(owner, (candidate, session, document) => { const from = suffix === 'undo' ? document.undo : document.redo, to = suffix === 'undo' ? document.redo : document.undo; if (!from.length) fail('disabled', 'No retained history is available.'); to.push(copyCanonicalData(document.content)); if (to.length > PAGES_LIMITS.history) to.shift(); document.content = from.pop(); document.revision++; reconcile(candidate, document); session.dialog = null; }); }
      return edit(owner, (content, candidate, session, document) => {
        if (suffix === 'document.rename') content.title = payload.title;
        else if (suffix === 'page') content.page = copyCanonicalData(payload);
        else if (suffix === 'text.replace') { pagesReplaceRange(content, payload, payload.text); session.selection = { blockId: payload.blockId, start: payload.start + payload.text.length, end: payload.start + payload.text.length }; session.selectedId = payload.blockId; }
        else if (suffix === 'text.format') pagesFormatRange(content, payload, payload.style);
        else if (suffix === 'text.split') { pagesReplaceRange(content, payload, ''); const row = block(document, payload.blockId, 'paragraph'), text = pagesText(row), after = copyCanonicalData(row); after.id = pagesAllocate(candidate, 'pages-block'); delete after.pageBreakBefore; pagesReplaceText(row, payload.start, text.length, ''); pagesReplaceText(after, 0, payload.start, ''); content.blocks.splice(content.blocks.indexOf(row) + 1, 0, after); session.selection = { blockId: after.id, start: 0, end: 0 }; session.selectedId = after.id; }
        else if (suffix === 'text.merge') { const row = block(document, payload.blockId, 'paragraph'), index = content.blocks.indexOf(row), previous = content.blocks[index - 1]; if (!previous || previous.type !== 'paragraph') fail('disabled', 'There is no preceding paragraph.'); const start = pagesText(previous).length; previous.runs = pagesNormalizeRuns([...previous.runs, ...row.runs]); content.blocks.splice(index, 1); session.selection = { blockId: previous.id, start, end: start }; session.selectedId = previous.id; }
        else if (suffix === 'paragraph.style') { const row = block(document, payload.blockId, 'paragraph'); row.style = payload.style; row.runs = row.runs.map(run => ({ ...run, ...pagesPreset(payload.style) })); }
        else if (suffix === 'paragraph.align') block(document, payload.blockId, 'paragraph').align = payload.align;
        else if (suffix === 'object.delete') { const row = block(document, payload.blockId); content.blocks.splice(content.blocks.indexOf(row), 1); if (!content.blocks.length) content.blocks.push({ id: pagesAllocate(candidate, 'pages-block'), type: 'paragraph', style: 'Body', align: 'left', runs: [pagesDefaultRun('')] }); }
        else if (suffix === 'object.move') { const row = block(document, payload.blockId), index = content.blocks.indexOf(row), next = index + (payload.direction === 'up' ? -1 : 1); if (next < 0 || next >= content.blocks.length) fail('disabled', 'The object is already at the edge of the document.'); content.blocks.splice(index, 1); content.blocks.splice(next, 0, row); }
        else if (suffix === 'paragraph.add') { const id = pagesAllocate(candidate, 'pages-block'), index = content.blocks.findIndex(row => row.id === session.selectedId); content.blocks.splice(index < 0 ? content.blocks.length : index + 1, 0, { id, type: 'paragraph', style: 'Body', align: 'left', runs: [pagesDefaultRun('')] }); session.selectedId = id; session.selection = { blockId: id, start: 0, end: 0 }; }
        else if (suffix === 'page.add') {
          const groups = pagesEstimatePages(content), group = groups.find(ids => ids.includes(session.pageAnchor ?? session.selectedId ?? session.selection.blockId)) ?? groups.at(-1), index = content.blocks.findIndex(row => row.id === group.at(-1)) + 1;
          const next = content.blocks[index], id = pagesAllocate(candidate, 'pages-block'), blank = { id, type: 'paragraph', style: 'Body', align: 'left', runs: [pagesDefaultRun('')], pageBreakBefore: true };
          content.blocks.splice(index, 0, blank);
          if (next?.type === 'paragraph') next.pageBreakBefore = true;
          else if (next) content.blocks.splice(index + 1, 0, { ...copyCanonicalData(blank), id: pagesAllocate(candidate, 'pages-block') });
          session.selectedId = id; session.pageAnchor = id; session.selection = { blockId: id, start: 0, end: 0 };
        }
        else if (suffix === 'table.insert') { const id = pagesAllocate(candidate, 'pages-block'); content.blocks.push({ id, type: 'table', rows: Array.from({ length: payload.rows ?? 4 }, () => Array.from({ length: payload.columns ?? 3 }, () => ({ text: '' }))) }); session.selectedId = id; }
        else if (suffix === 'table.cell') { const row = block(document, payload.blockId, 'table'); if (!row.rows[payload.row]?.[payload.column]) fail('stale_target', 'The actual table cell is unavailable.'); row.rows[payload.row][payload.column].text = payload.text; }
        else if (suffix === 'table.resize') { const row = block(document, payload.blockId, 'table'); row.rows = Array.from({ length: payload.rows }, (_, r) => Array.from({ length: payload.columns }, (_, c) => row.rows[r]?.[c] ?? { text: '' })); }
        else if (suffix === 'image.size') { const row = block(document, payload.blockId, 'image'); for (const key of ['width', 'height', 'alt']) if (Object.hasOwn(payload, key)) row[key] = payload[key]; }
        else if (suffix === 'chart.insert') { const id = pagesAllocate(candidate, 'pages-block'); content.blocks.push({ id, type: 'chart', kind: payload.kind ?? 'bar', title: 'Chart Title', labels: ['First', 'Second', 'Third', 'Fourth'], values: [12, 24, 18, 30] }); session.selectedId = id; }
        else if (suffix === 'chart.edit') { const row = block(document, payload.blockId, 'chart'); for (const key of ['kind', 'title', 'labels', 'values']) row[key] = copyCanonicalData(payload[key]); session.dialog = null; }
        else fail('invalid_arguments', 'Unknown Pages operation.');
      });
    } catch (error) { return rejected(error.code ?? 'unsupported_content', String(error.message).slice(0, 512)); }
  };
  function windowOpened(actual, options = {}) {
    if (!alive() || !validatePagesState(state, ctx.profile).ok || !actual || actual.appId !== cap.appId || !pagesSchemaValid(actual.id, pagesIdSchema) || ctx.getWindow(actual.id) !== actual || options.isCurrent && options.isCurrent() !== true || options.ownership?.guard && options.ownership.guard() !== true) return false;
    const existing = pagesWindow(state, actual.id);
    if (existing) { if (originals.has(actual.id) && originals.get(actual.id) !== actual) return false; originals.set(actual.id, actual); const pending = creations.get(options); if (pending) pending.original = actual; return true; }
    const guard = graphGuard(), candidate = copyCanonicalData(state); candidate.windows.push(pagesNewWindow(actual.id, ctx.profile, options));
    if (!validatePagesState(candidate, ctx.profile).ok || ctx.canCommit(canonicalStringUnits(candidate) - canonicalStringUnits(state)) !== true || !guard() || ctx.getWindow(actual.id) !== actual) return false;
    publish(candidate); originals.set(actual.id, actual); const pending = creations.get(options); if (pending) pending.original = actual; return true;
  }
  function remove(actuals, ownership = {}) {
    if (!alive() || ownership.guard && ownership.guard() !== true || actuals.some(actual => originals.get(actual.id) !== actual || ctx.getWindow(actual.id) && ctx.getWindow(actual.id) !== actual)) return false;
    const guard = graphGuard(), candidate = copyCanonicalData(state), ids = actuals.map(actual => actual.id);
    for (const row of candidate.windows.filter(row => ids.includes(row.windowId))) { const doc = pagesDocument(candidate, row.documentId); if (doc && pagesDirty(doc) && !candidate.windows.some(other => !ids.includes(other.windowId) && other.documentId === doc.id) && ownership.discard !== true) return false; }
    const discarded = new Set(candidate.windows.filter(row => ids.includes(row.windowId)).map(row => row.documentId));
    candidate.windows = candidate.windows.filter(row => !ids.includes(row.windowId));
    // Closing the last editor discards only unsaved content when explicitly acknowledged.
    if (ownership.discard === true) candidate.documents = candidate.documents.filter(doc => !discarded.has(doc.id) || !pagesDirty(doc) || candidate.windows.some(row => row.documentId === doc.id));
    if (!validatePagesState(candidate, ctx.profile).ok || ctx.canCommit(canonicalStringUnits(candidate) - canonicalStringUnits(state)) !== true || !guard() || ownership.guard && ownership.guard() !== true) return false;
    publish(candidate); ids.forEach(id => originals.delete(id)); return true;
  }
  return { handlers,
    targets(windowId) { const owner = lease(windowId); return { windowId, appId: cap.appId, available: !!owner, capabilities: cap, session: owner ? copyCanonicalData(owner.session) : null, document: owner?.document ? copyCanonicalData(owner.document) : null, native: owner?.view?.describe?.() ?? null }; },
    windowOpened,
    windowClosed(actual, ownership) { if (!actual || !pagesWindow(state, actual.id)) return false; return remove([actual], ownership); },
    appQuit(appId, ownership) { if (appId !== cap.appId) return false; const actuals = state.windows.map(row => originals.get(row.windowId)); if (actuals.some(actual => !actual)) return false; return remove(actuals, ownership); },
    dispose() { disposed = true; generation++; originals.clear(); },
  };
}

import { rejected } from './feature-commands.js';
import { liveFile } from './windows11-app-helpers.js';
import { layoutNotesPdf } from './notes-pdf.js';

const fields = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => allowed.includes(key));
const empty = value => fields(value, []) && Object.keys(value).length === 0;
const invalid = () => rejected('invalid_arguments', 'Use the documented live File dialog target and closed payload.');
const unavailable = () => rejected('unavailable', 'This File workflow is not available.');
const stale = () => rejected('stale_target', 'The File dialog or its original Notes document is no longer current.');
const applied = dialogId => ({ status: 'applied', target: { dialogId } });
const controls = ['panel', 'name', 'folder', 'tags', 'copies', 'page-from', 'page-to', 'confirm', 'cancel', 'save-pdf', 'preview-previous', 'preview-next'];

/** One transient sheet per local root. Cancellation invalidates every captured
 * operation lease, even if another sheet immediately opens for the same note. */
export function createFileDialogCommands(ctx) {
  let generation = 0, nextId = 1;
  const returns = new Map();
  const current = target => fields(target, ['dialogId']) && typeof target.dialogId === 'string'
    && ctx.state.current?.id === target.dialogId ? ctx.state.current : null;
  const source = windowId => ctx.getSource(windowId);
  const unchanged = dialog => {
    const original = source(dialog.windowId);
    return original?.noteId === dialog.noteId && original.text === dialog.sourceText
      && original.createdAt === dialog.sourceCreatedAt && original.updatedAt === dialog.sourceUpdatedAt;
  };
  const captureLease = () => {
    const token = generation;
    return () => token === generation && ctx.alive();
  };
  async function close(dialog) {
    if (ctx.state.current?.id !== dialog.id) return false;
    ctx.state.current = null;
    const token = ++generation;
    const prior = returns.get(dialog.id);
    returns.delete(dialog.id);
    await ctx.settle();
    if (generation === token && !ctx.state.current && ctx.alive()) await ctx.restoreReturn(prior, dialog);
    return true;
  }
  async function open(target, payload) {
    if (!fields(target, ['windowId']) || typeof target.windowId !== 'string'
      || !fields(payload, ['format']) || !['markdown', 'pdf', 'print'].includes(payload.format)) return invalid();
    if (!ctx.available() || ctx.state.current) return unavailable();
    const original = source(target.windowId);
    if (!original) return stale();
    const token = ++generation, prior = ctx.captureReturn();
    let preview;
    if (payload.format === 'print') {
      try { preview = await layoutNotesPdf(original.text, { fontLoader: ctx.fontLoader }); }
      catch (error) { return rejected(error.code ?? 'unavailable', error.message ?? 'The printable document could not be prepared.'); }
    }
    const latest = source(target.windowId);
    if (!ctx.available() || generation !== token || latest?.noteId !== original.noteId
      || latest.text !== original.text || latest.createdAt !== original.createdAt || latest.updatedAt !== original.updatedAt) return stale();
    const titleEnd = original.text.indexOf('\n');
    const title = original.text.slice(0, titleEnd < 0 ? undefined : titleEnd) || 'New Note';
    const stem = title.replace(/[:/\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().slice(0, 240) || 'New Note';
    const dialog = { id: `${ctx.getIdPrefix?.() ?? ''}file-dialog-${nextId++}`, windowId: target.windowId,
      noteId: original.noteId, sourceText: original.text, sourceCreatedAt: original.createdAt,
      sourceUpdatedAt: original.updatedAt, title, format: payload.format,
      name: `${stem}.${payload.format === 'markdown' ? 'md' : 'pdf'}`, folderId: 'downloads', tags: [],
      copies: 1, pageFrom: 1, pageTo: preview?.pageCount ?? 1, pageCount: preview?.pageCount ?? 1,
      previewPages: preview?.pages ?? [], busy: false, returnToPrint: false };
    returns.set(dialog.id, prior);
    ctx.state.current = dialog;
    await ctx.settle();
    const control = dialog.format === 'print' ? 'copies' : 'name';
    if (!ctx.available() || ctx.state.current?.id !== dialog.id || !ctx.getView()?.focus(control)) {
      await close(dialog);
      return unavailable();
    }
    return applied(dialog.id);
  }
  function configure(target, payload) {
    const dialog = current(target);
    if (!dialog) return stale();
    if (!ctx.available() || dialog.busy) return unavailable();
    const allowed = dialog.format === 'print' ? ['copies', 'pageFrom', 'pageTo'] : ['name', 'folderId', 'tags'];
    if (!fields(payload, allowed) || Object.keys(payload).length === 0) return invalid();
    if (Object.hasOwn(payload, 'name') && (typeof payload.name !== 'string' || payload.name.length > 255)) return invalid();
    if (Object.hasOwn(payload, 'folderId')) {
      const folder = liveFile(ctx.files, payload.folderId);
      if (!folder || folder.kind !== 'folder' || folder.id === 'trash' || folder.readOnly) return invalid();
    }
    if (Object.hasOwn(payload, 'tags') && (!Array.isArray(payload.tags) || payload.tags.length > 64
      || payload.tags.some(tag => typeof tag !== 'string' || tag.length > 256))) return invalid();
    if (Object.hasOwn(payload, 'copies') && (!Number.isInteger(payload.copies) || payload.copies < 1 || payload.copies > 99)) return invalid();
    if (['pageFrom', 'pageTo'].some(key => Object.hasOwn(payload, key) && !Number.isInteger(payload[key]))) return invalid();
    const from = payload.pageFrom ?? dialog.pageFrom, to = payload.pageTo ?? dialog.pageTo;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > dialog.pageCount) return invalid();
    Object.assign(dialog, payload);
    return applied(dialog.id);
  }
  async function confirm(target, payload) {
    if (!fields(payload, ['replace']) || (Object.hasOwn(payload, 'replace') && typeof payload.replace !== 'boolean')) return invalid();
    const dialog = current(target);
    if (!dialog) return stale();
    if (!ctx.available() || dialog.busy) return unavailable();
    if (!unchanged(dialog)) return stale();
    if (dialog.format === 'print' && Object.hasOwn(payload, 'replace')) return invalid();
    let request;
    if (dialog.format === 'print') request = { command: 'printing.submit', target: { noteId: dialog.noteId },
      payload: { copies: dialog.copies, pageFrom: dialog.pageFrom, pageTo: dialog.pageTo } };
    else {
      const exportPayload = { folderId: dialog.folderId, name: dialog.name, format: dialog.format, tags: dialog.tags };
      if (dialog.returnToPrint) Object.assign(exportPayload, { pageFrom: dialog.pageFrom, pageTo: dialog.pageTo });
      if (payload.replace) {
        const existing = ctx.files.files.find(file => file.parentId === dialog.folderId
          && file.name.toLowerCase() === dialog.name.toLowerCase() && liveFile(ctx.files, file.id));
        if (!existing || existing.kind !== 'document' || existing.readOnly) return invalid();
        exportPayload.replaceFileId = existing.id;
      }
      request = { command: 'notes.export', target: { noteId: dialog.noteId }, payload: exportPayload };
    }
    dialog.busy = true;
    let result;
    try { result = await ctx.invoke(request.command, request.target, request.payload); }
    finally { dialog.busy = false; }
    if (result.status === 'applied') await close(dialog);
    return result.status === 'applied' ? applied(dialog.id) : result;
  }
  async function cancel(target, payload) {
    if (!empty(payload)) return invalid();
    const dialog = current(target);
    if (!dialog) return stale();
    if (!ctx.available()) return unavailable();
    if (dialog.returnToPrint) {
      const token = ++generation;
      dialog.format = 'print'; dialog.returnToPrint = false; dialog.busy = false;
      await ctx.settle();
      if (!ctx.available() || generation !== token || ctx.state.current?.id !== dialog.id) return stale();
      ctx.getView()?.focus('save-pdf');
    } else await close(dialog);
    return applied(dialog.id);
  }
  async function exportPdf(target, payload) {
    if (!empty(payload)) return invalid();
    const dialog = current(target);
    if (!dialog) return stale();
    if (!ctx.available() || dialog.busy || dialog.format !== 'print') return unavailable();
    const token = ++generation;
    dialog.format = 'pdf'; dialog.returnToPrint = true;
    await ctx.settle();
    if (!ctx.available() || generation !== token || ctx.state.current?.id !== dialog.id) return stale();
    ctx.getView()?.focus('name');
    return applied(dialog.id);
  }
  async function focus(target, payload) {
    if (!fields(target, ['dialogId', 'control', 'fileId']) || !controls.includes(target.control)
      || (Object.hasOwn(target, 'fileId') && typeof target.fileId !== 'string') || !empty(payload)) return invalid();
    const dialog = current({ dialogId: target.dialogId });
    if (!dialog) return stale();
    if (!ctx.available()) return unavailable();
    const currentLease = captureLease();
    await ctx.settle();
    if (!ctx.available() || !currentLease() || ctx.state.current?.id !== dialog.id) return stale();
    if (!ctx.getView()?.focus(target.control, target.fileId)) return unavailable();
    return applied(dialog.id);
  }
  function scroll(target, payload) {
    if (!fields(target, ['dialogId', 'area']) || !['files', 'preview'].includes(target.area)
      || !fields(payload, ['top', 'left']) || !Number.isFinite(payload.top) || payload.top < 0
      || (Object.hasOwn(payload, 'left') && (!Number.isFinite(payload.left) || payload.left < 0))) return invalid();
    const dialog = current({ dialogId: target.dialogId });
    if (!dialog) return stale();
    if (!ctx.available() || !ctx.getView()?.scroll(target.area, payload.top, payload.left ?? 0)) return unavailable();
    return applied(dialog.id);
  }
  return { captureLease, suspend: () => { generation++; },
    handlers: { 'fileDialog.open': open, 'fileDialog.configure': configure, 'fileDialog.confirm': confirm,
      'fileDialog.cancel': cancel, 'fileDialog.exportPdf': exportPdf, 'fileDialog.focus': focus, 'fileDialog.scroll': scroll },
    targets: () => ctx.state.current ? { ...ctx.state.current, native: ctx.getView()?.describe() ?? null } : null };
}

import { object, empty, choice, flag, defineCommand } from './command-schema.js';
import { NOTES_WORKSPACE_PROFILES, NOTES_WORKSPACE_SHEETS, applyNotesWorkspaceCandidate, notesWorkspaceIdSchema as id, notesWorkspacePreferencesSchema, notesWorkspaceAccountSchema, notesWorkspaceSchemaValid, validateNotesWorkspace, notesWorkspaceWindow, createNotesWorkspaceWindow, visibleWorkspaceNotes, noteWorkspaceLocked, noteWorkspaceText, noteWorkspaceTitle, workspaceNote, reconcileNotesWorkspace, sweepNotesWorkspace } from './notes-workspace-state.js';
import { notesDocumentSchema, notesSelectionSchema, NOTES_MARKS, NOTES_STYLES, paragraph, firstDocumentSelection, validDocumentSelection, replaceSelection, markSelection, documentHTML, documentText, runsText, selectionRuns } from './notes-workspace-document.js';
import { createNotesPdf } from './notes-pdf.js';
import { decodeNotesAttachment } from './notes-workspace-attachments.js';
import { copyCanonicalData, canonicalStringUnits } from './canonical-data.js';
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] }), text = maxLength => ({ type: 'string', maxLength }), integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const targetSchema = object({ windowId: id });
export const notesWorkspaceCommandSpecs = {
  create: [object({ text: text(1048576) }, []), 'Create and select a canonical rich note.'],
  duplicate: [object({ noteId: id }), 'Duplicate the complete unlocked rich document and canonical attachment references.'],
  select: [object({ noteId: id }), 'Select a currently visible original note.'],
  search: [object({ query: text(4096) }), 'Search unlocked canonical plaintext projections.'],
  'folder.select': [object({ folderId: id }), 'Select an actual account folder or all/deleted/attachments collection.'],
  'folder.save': [object({ folderId: nullable(id), accountId: id, name: { ...text(128), minLength: 1 } }), 'Create or rename a custom account folder.'],
  'folder.delete': [object({ folderId: id, confirm: flag }), 'Trash a custom folder and its notes after exact confirmation; recover notes into an available source folder.'],
  'folder.restore': [object({ folderId: id }), 'Recover a recently deleted custom folder and its retained notes.'],
  move: [object({ noteId: id, folderId: id }), 'Move a note between real enabled fictional account folders.'],
  pin: [object({ noteId: id, pinned: flag }), 'Pin or unpin a live note.'],
  'color.set': [object({ noteId: id, color: choice('yellow', 'green', 'pink', 'purple', 'blue', 'gray', 'charcoal') }), 'Set the classic Sticky Notes card color; a disclosed local extension on Mac.'],
  trash: [object({ noteId: id, confirm: flag }, ['noteId']), 'Move a note to Recently Deleted using the shared authored instant and configured confirmation.'],
  restore: [object({ noteId: id }), 'Restore a retained note to its original available folder or local Notes.'],
  'delete.permanent': [object({ noteId: id, confirm: flag }), 'Confirm permanent deletion of an exact retained note.'],
  'trash.empty': [object({ confirm: flag }), 'Confirm permanent deletion of retained deleted notes.'],
  'retention.sweep': [empty, 'Expire deleted notes only at the explicit shared authored instant, after 30 days.'],
  'document.set': [object({ noteId: id, revision: integer(0, Number.MAX_SAFE_INTEGER - 1), document: notesDocumentSchema, selection: notesSelectionSchema }), 'Commit an actual editable rich DOM projection under original document revision.'],
  'selection.set': [object({ noteId: id, revision: integer(0, Number.MAX_SAFE_INTEGER - 1), selection: notesSelectionSchema }), 'Observe a native range belonging to the original rich document.'],
  insert: [object({ text: text(1048576) }), 'Replace the actual selected native range, preserving marks and multiline blocks.'],
  format: [object({ kind: choice('style', 'mark', 'list', 'indent'), value: choice(...NOTES_STYLES, ...NOTES_MARKS, 'none', 'bullet', 'number', 'check', 'increase', 'decrease') }), 'Style the actual selected paragraph or marked native range.'],
  checklist: [object({ blockId: id, checked: flag }), 'Toggle an original checklist paragraph.'],
  table: [object({ operation: choice('insert', 'row.add', 'row.delete', 'column.add', 'column.delete', 'delete'), blockId: nullable(id), row: integer(0, 63), column: integer(0, 15) }, ['operation']), 'Insert/edit a rectangular canonical table at the native selection.'],
  'table.navigate': [object({ backwards: flag }), 'Focus the actual adjacent editable cell; append a last row at forward Tab.'],
  undo: [empty, 'Restore a complete canonical document and its before-edit native range.'],
  redo: [empty, 'Restore the redo document and its saved native range.'],
  clipboard: [object({ operation: choice('copy', 'cut', 'paste', 'selectAll') }), 'Use the one actual scene clipboard and original contenteditable range, never host clipboard.'],
  'attachment.add': [object({ noteId: id, fileId: id }), 'Read and attach an actual canonical Files image or PDF.'],
  'attachment.remove': [object({ noteId: id, attachmentId: id }), 'Remove a reference without deleting its actual Files source.'],
  'attachment.open': [object({ noteId: id, attachmentId: id, reveal: flag }), 'Open/reveal the exact actual shared Files source.'],
  lock: [object({ noteId: id, secret: { ...text(256), minLength: 1 }, hint: text(256) }), 'Apply explicitly fictional nonencrypted local password gating.'],
  unlock: [object({ noteId: id, secret: text(256) }), 'Unlock only when the fictional secret matches the original note.'],
  relock: [object({ noteId: nullable(id) }), 'Close fictional unlocked-note access and hide content projections.'],
  'lock.remove': [object({ noteId: id, secret: text(256) }), 'Remove fictional gating with the exact original secret.'],
  'collaboration.set': [object({ noteId: id, enabled: flag, permission: choice('edit', 'view'), participants: { type: 'array', maxItems: 31, items: object({ id, name: { ...text(128), minLength: 1 }, role: choice('edit', 'view') }) } }), 'Present functional local collaboration participants/permissions, with no transport or authentication claim.'],
  'account.save': [object({ account: notesWorkspaceAccountSchema }), 'Add/update a named fictional enabled account section.'],
  'account.delete': [object({ accountId: id }), 'Remove an unused custom fictional account; no silent note loss.'],
  'preferences.set': [object({ preferences: notesWorkspacePreferencesSchema }), 'Apply native-era preferences and labeled local extensions.'],
  'view.set': [object({ sidebarVisible: flag, mode: choice('list', 'gallery'), standalone: flag }, []), 'Set actual folders visibility, standalone note card, and native gallery/local Sticky Notes workspace layout.'],
  'sheet.open': [object({ sheet: choice(...NOTES_WORKSPACE_SHEETS.filter(value => value !== 'none')), noteId: nullable(id), folderId: nullable(id) }, ['sheet']), 'Open an actual original-window native sheet.'],
  'sheet.close': [empty, 'Dismiss the current actual sheet.'],
  'menu.set': [object({ menu: nullable(choice('notes', 'file', 'edit', 'format', 'view', 'window', 'help')) }), 'Open/close the actual enabled native menu.'],
  'context.set': [object({ noteId: nullable(id) }), 'Open/close original-note context actions.'],
  export: [object({ noteId: id, name: { ...text(256), minLength: 1 }, format: choice('text', 'markdown', 'html', 'pdf'), existingFileId: id }, ['noteId', 'name', 'format']), 'Export through actual Files; PDF is explicitly a text projection, HTML preserves supported local rich structure.'],
  print: [object({ noteId: id }), 'Open an actual shared print dialog/job for the unlocked rich projection.'],
  share: [object({ noteId: id }), 'Open an actual shared share destination, not remote delivery.'],
  'window.new': [object({ noteId: nullable(id) }, []), 'Create a real Notes window via guarded shell bridge.'],
  'window.close': [empty, 'Close the original actual managed Notes window through the guarded shell bridge.'],
  focus: [object({ controlId: { ...text(256), minLength: 1 } }), 'Focus an actual enabled native control.'],
  scroll: [object({ area: choice('list', 'editor'), top: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, left: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }), 'Scroll the original rendered native area and retain observed offsets.'],
};
export const notesWorkspaceCatalog = Object.fromEntries(Object.entries(notesWorkspaceCommandSpecs).map(([suffix, [schema, description]]) => defineCommand(NOTES_WORKSPACE_PROFILES, `notes.${suffix}`, 'notes.workspace', targetSchema, schema, ['Original canonical Notes workspace and actual original managed window; presentation commands require mounted facade.', 'Fictional accounts/passwords/collaboration only; all external actions use guarded real scene bridges.'], [description], ['notes'], [], targetSchema)));
const reject = (code, message) => ({ status: 'rejected', error: { code, message } }), applied = (target, extra = {}) => ({ status: 'applied', target, ...extra });
export function createNotesWorkspaceCommands(ctx) {
  const state = ctx.getState(); let generation = 0;
  const alive = () => ctx.getState() === state && ctx.alive() === true && state.profileId === ctx.profile.id;
  function owner(windowId, native = false) {
    if (!alive() || !validateNotesWorkspace(state, ctx.profile).ok) return null;
    const window = ctx.getWindow(windowId), session = notesWorkspaceWindow(state, windowId), view = ctx.getView(windowId);
    if (!window || !session || native && (!view || !ctx.available(window) || !view.available())) return null;
    const version = generation, signature = JSON.stringify(state);
    const guard = () => alive() && generation === version && ctx.getWindow(windowId) === window && notesWorkspaceWindow(state, windowId) === session && ctx.getView(windowId) === view && (!native || ctx.available(window) && view.available()) && JSON.stringify(state) === signature;
    return { window, session, view, guard, windowId };
  }
  const stale = () => reject('stale_target', 'The original note, native selection, window or profile changed.'), unavailable = message => reject('unavailable', message), invalid = () => reject('invalid_arguments', 'Use the closed Notes command schema and current original identities.');
  function time(candidate) {
    const authored = ctx.getSceneTime(); if (!Number.isSafeInteger(authored) || authored < 0 || authored >= 8639999999999999) return null;
    const latest = Math.max(authored, ...candidate.notes.map(note => note.updatedAt)); return latest < 8639999999999999 ? latest + 1 : null;
  }
  const selected = lease => state.notes.find(note => note.id === lease.session.selectedId);
  const writable = note => note && note.deletedAt === null && !noteWorkspaceLocked(note) && (!note.collaboration.enabled || note.collaboration.permission === 'edit') && state.accounts.some(account => account.enabled && state.folders.some(folder => folder.id === note.folderId && folder.accountId === account.id));
  function prepare(lease, mutation, sharedComposition = false) {
    if (!lease.guard()) return { error: stale() };
    const candidate = copyCanonicalData(state), window = notesWorkspaceWindow(candidate, lease.windowId);
    if (lease.nativeSelection) window.selection = copyCanonicalData(lease.nativeSelection);
    const result = mutation(candidate, window);
    if (result?.status === 'rejected') return { error: result };
    reconcileNotesWorkspace(candidate); const validation = validateNotesWorkspace(candidate, ctx.profile);
    if (!validation.ok) return { error: reject('limit_exceeded', validation.message) };
    const deltaTextUnits = canonicalStringUnits(candidate) - canonicalStringUnits(state);
    if (!sharedComposition && ctx.canCommit(deltaTextUnits) !== true) return { error: reject('limit_exceeded', 'The complete scene content budget would be exceeded.') };
    return { candidate, deltaTextUnits, result: result ?? {} };
  }
  async function commit(lease, mutation, restoreSelection = false) {
    const prepared = prepare(lease, mutation); if (prepared.error) return prepared.error;
    if (!lease.guard()) return stale(); applyNotesWorkspaceCandidate(state, prepared.candidate); const version = ++generation;
    const window = notesWorkspaceWindow(state, lease.windowId), note = selected({ session: window });
    await ctx.tick();
    if (restoreSelection && alive() && generation === version && ctx.getWindow(lease.windowId) === lease.window && ctx.getView(lease.windowId) === lease.view && lease.view?.available() && window.selection && note && !noteWorkspaceLocked(note)) lease.view.restoreSelection(window.selection);
    return applied({ windowId: lease.windowId }, prepared.result);
  }
  function edit(candidate, window, action) {
    const note = candidate.notes.find(row => row.id === window.selectedId); if (!writable(note)) return reject('read_only', 'Unlock and restore a writable original note first.');
    const selection = window.selection ?? firstDocumentSelection(note.document), before = { document: copyCanonicalData(note.document), selection: copyCanonicalData(selection) };
    const next = action(note, selection, candidate); if (next?.status === 'rejected') return next;
    if (!next) return reject('invalid_arguments', 'The actual selected block/range is unavailable for this action.');
    const stamp = time(candidate); if (stamp === null || note.revision >= Number.MAX_SAFE_INTEGER - 1) return reject('limit_exceeded', 'The authored Notes clock/revision is exhausted.');
    note.undo.push(before); if (note.undo.length > 32) note.undo.shift(); note.redo = []; note.updatedAt = stamp; note.revision++; window.selection = next;
    // An edit losing a search match leaves no selected editor, never borrows a different record.
    if (window.query && !noteWorkspaceText(note).replace(/\s+/g, ' ').trim().toLowerCase().includes(window.query.replace(/\s+/g, ' ').trim().toLowerCase())) { window.selectedId = null; window.selection = null; }
    return {};
  }
  const bridgeResult = result => result?.status === 'applied' || result?.status === 'rejected' ? result : unavailable('The actual shared destination did not acknowledge an applied identity.');
  async function external(lease, bridge, spec) {
    if (typeof ctx[bridge] !== 'function') return unavailable(`The actual ${bridge} bridge is unavailable.`);
    if (!lease.guard()) return stale(); const result = await ctx[bridge](spec, { guard: lease.guard, windowId: lease.windowId });
    // Shared acknowledged commits remain applied even if shell retirement follows.
    if (result?.status === 'applied') {
      const keys = { createFile: ['fileId'], printDocument: ['printDialogId', 'jobId'], share: ['shareId'] }[bridge];
      if (keys && !keys.some(key => typeof result[key] === 'string' && result[key])) return unavailable('The shared bridge did not return its actual committed destination identity.');
      return applied({ windowId: lease.windowId }, Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'status' && key !== 'target')));
    }
    if (!lease.guard()) return stale(); return bridgeResult(result);
  }
  const handlers = {};
  for (const [suffix, [schema]] of Object.entries(notesWorkspaceCommandSpecs)) handlers[`notes.${suffix}`] = async (target, payload = {}) => {
    if (!notesWorkspaceSchemaValid(target, targetSchema) || !notesWorkspaceSchemaValid(payload, schema)) return invalid();
    const native = ['insert', 'format', 'table.navigate', 'clipboard', 'focus', 'scroll', 'selection.set', 'document.set'].includes(suffix), lease = owner(target.windowId, native);
    if (!lease) return unavailable('The original Notes window/workspace or required native view is unavailable.');
    const current = selected(lease), record = payload.noteId ? state.notes.find(note => note.id === payload.noteId) : current;
    if (['insert', 'format'].includes(suffix)) {
      const selection = lease.view.captureSelection(); if (!current || !selection || !validDocumentSelection(current.document, selection)) return unavailable('Select an actual original paragraph or table-cell range first.');
      lease.nativeSelection = selection;
    }
    if (payload.noteId && !record && !['window.new'].includes(suffix)) return stale();
    if (suffix === 'create' || suffix === 'duplicate') {
      if (suffix === 'duplicate' && (!record || noteWorkspaceLocked(record) || record.deletedAt !== null)) return reject('read_only', 'Only a live unlocked note can be duplicated.');
      return commit(lease, (candidate, window) => {
        const stamp = time(candidate); if (stamp === null) return reject('limit_exceeded', 'Authored clock exhausted.');
        while (candidate.notes.some(note => note.id === `note-${candidate.nextId}`)) candidate.nextId++;
        const id = `note-${candidate.nextId++}`, folder = candidate.folders.find(folder => folder.id === window.folderId && folder.deletedAt === null) ?? candidate.folders.find(folder => folder.accountId === candidate.preferences.defaultAccountId && folder.deletedAt === null) ?? candidate.folders.find(folder => folder.id === 'notes');
        const note = workspaceNote(id, payload.text ?? '', folder.id, stamp); note.document.blocks[0].style = candidate.preferences.defaultStyle;
        if (suffix === 'duplicate') { note.document = copyCanonicalData(record.document); note.attachments = copyCanonicalData(record.attachments); }
        candidate.notes.push(note); window.folderId = folder.id; window.query = ''; window.selectedId = id; window.selection = firstDocumentSelection(note.document); return { noteId: id };
      }, true);
    }
    if (suffix === 'select') { if (!visibleWorkspaceNotes(state, lease.session).includes(record)) return stale(); return commit(lease, (_, window) => { window.selectedId = record.id; window.selection = firstDocumentSelection(record.document); }); }
    if (suffix === 'search') return commit(lease, (candidate, window) => { window.query = payload.query; if (!visibleWorkspaceNotes(candidate, window).some(note => note.id === window.selectedId)) { const first = visibleWorkspaceNotes(candidate, window)[0]; window.selectedId = first?.id ?? null; window.selection = first ? firstDocumentSelection(first.document) : null; } });
    if (suffix === 'folder.select') {
      if (!['all', 'deleted', 'attachments'].includes(payload.folderId) && !state.folders.some(folder => folder.id === payload.folderId && folder.deletedAt === null)) return stale();
      return commit(lease, (candidate, window) => { window.folderId = payload.folderId; window.standalone = false; window.query = ''; const first = visibleWorkspaceNotes(candidate, window)[0]; window.selectedId = first?.id ?? null; window.selection = first ? firstDocumentSelection(first.document) : null; });
    }
    if (suffix === 'folder.save') return commit(lease, (candidate, window) => {
      if (!payload.name.trim() || !candidate.accounts.some(account => account.id === payload.accountId && account.enabled)) return invalid();
      const folder = candidate.folders.find(folder => folder.id === payload.folderId); if (payload.folderId && (!folder || folder.builtin || folder.deletedAt !== null)) return reject('read_only', 'Only an available custom folder can be renamed.');
      if (folder) { folder.name = payload.name; folder.accountId = payload.accountId; } else candidate.folders.push({ id: `folder-${candidate.nextId++}`, accountId: payload.accountId, name: payload.name, deletedAt: null, builtin: false });
      if (window.sheet === 'folder') { window.sheet = 'none'; window.sheetFolderId = null; } return {};
    });
    if (suffix === 'folder.delete' || suffix === 'folder.restore') {
      const folder = state.folders.find(folder => folder.id === payload.folderId); if (!folder || folder.builtin) return reject('read_only', 'Builtin recovery folders cannot be deleted.');
      if (suffix === 'folder.delete' && !payload.confirm) return commit(lease, (_, window) => { window.sheet = 'delete-folder'; window.sheetFolderId = folder.id; });
      return commit(lease, candidate => { const row = candidate.folders.find(row => row.id === folder.id), stamp = time(candidate); if (stamp === null) return invalid();
        if (suffix === 'folder.restore') { const groupDeletedAt = row.deletedAt; if (groupDeletedAt === null) return invalid(); row.deletedAt = null; for (const note of candidate.notes.filter(note => note.folderId === row.id && note.deletedAt === groupDeletedAt)) { note.deletedAt = null; note.restoreFolderId = null; note.updatedAt = stamp; note.revision++; } }
        else { row.deletedAt = stamp; for (const note of candidate.notes.filter(note => note.folderId === row.id && note.deletedAt === null)) { note.deletedAt = stamp; note.restoreFolderId = row.id; note.updatedAt = stamp; note.revision++; note.lock && (note.lock.unlocked = false); } }
        for (const window of candidate.windows) if (window.sheetFolderId === row.id && window.sheet === 'delete-folder') { window.sheet = 'none'; window.sheetFolderId = null; }
        return {}; });
    }
    if (['pin', 'move', 'trash', 'restore', 'delete.permanent'].includes(suffix)) {
      if (!record) return stale();
      if (suffix === 'delete.permanent' && record.deletedAt === null || suffix === 'restore' && record.deletedAt === null) return invalid();
      if (['pin', 'move', 'trash'].includes(suffix) && record.deletedAt !== null) return reject('read_only', 'The original note is already deleted.');
      if (suffix === 'move' && !state.folders.some(folder => folder.id === payload.folderId && folder.deletedAt === null && state.accounts.some(account => account.id === folder.accountId && account.enabled))) return invalid();
      if (suffix === 'trash' && state.preferences.confirmDelete && payload.confirm !== true) return commit(lease, (_, window) => { window.sheet = 'trash-note'; window.sheetNoteId = record.id; });
      if (suffix === 'delete.permanent' && !payload.confirm) return commit(lease, (_, window) => { window.sheet = 'delete-note'; window.sheetNoteId = record.id; });
      return commit(lease, candidate => { const note = candidate.notes.find(note => note.id === record.id), stamp = time(candidate); if (stamp === null) return invalid();
        if (suffix === 'pin') note.pinned = payload.pinned;
        if (suffix === 'move') note.folderId = payload.folderId;
        if (suffix === 'trash') { note.deletedAt = stamp; note.restoreFolderId = note.folderId; note.lock && (note.lock.unlocked = false); }
        if (suffix === 'restore') { const folder = candidate.folders.find(folder => folder.id === note.restoreFolderId && folder.deletedAt === null); note.folderId = folder?.id ?? 'notes'; note.deletedAt = null; note.restoreFolderId = null; }
        if (suffix === 'delete.permanent') candidate.notes = candidate.notes.filter(row => row !== note); else { note.updatedAt = stamp; note.revision++; }
        if (suffix === 'trash') for (const window of candidate.windows) if (window.sheetNoteId === note.id) { window.sheet = 'none'; window.sheetNoteId = null; }
        return {}; });
    }
    if (suffix === 'trash.empty') {
      if (!payload.confirm) return commit(lease, (_, window) => { window.sheet = 'empty-trash'; });
      return commit(lease, candidate => { candidate.notes = candidate.notes.filter(note => note.deletedAt === null); for (const window of candidate.windows) if (window.sheet === 'empty-trash') window.sheet = 'none'; return {}; });
    }
    if (suffix === 'retention.sweep') return commit(lease, candidate => sweepNotesWorkspace(candidate, ctx.getSceneTime()) ? {} : invalid());
    if (suffix === 'document.set' || suffix === 'selection.set') {
      if (record !== current || record.revision !== payload.revision || noteWorkspaceLocked(record) || !validDocumentSelection(payload.document ?? record.document, payload.selection)) return stale();
      if (suffix === 'selection.set') return commit(lease, (_, window) => { window.selection = payload.selection; });
      return commit(lease, (candidate, window) => edit(candidate, window, note => { note.document = payload.document; return payload.selection; }), true);
    }
    if (suffix === 'insert') return commit(lease, (candidate, window) => edit(candidate, window, (note, selection) => replaceSelection(note.document, selection, payload.text)), true);
    if (suffix === 'format') return commit(lease, (candidate, window) => edit(candidate, window, (note, selection) => {
      const block = note.document.blocks.find(block => block.id === selection.blockId); if (!block) return null;
      if (payload.kind === 'mark') return markSelection(note.document, selection, payload.value) ? selection : null;
      if (block.type !== 'paragraph') return null;
      if (payload.kind === 'style' && NOTES_STYLES.includes(payload.value)) block.style = payload.value;
      else if (payload.kind === 'list' && ['none', 'bullet', 'number', 'check'].includes(payload.value)) { block.list = payload.value; block.checked = false; }
      else if (payload.kind === 'indent' && ['increase', 'decrease'].includes(payload.value)) block.indent = Math.max(0, Math.min(8, block.indent + (payload.value === 'increase' ? 1 : -1)));
      else return null; return selection;
    }), true);
    if (suffix === 'checklist') return commit(lease, (candidate, window) => edit(candidate, window, (note, selection) => {
      const block = note.document.blocks.find(block => block.id === payload.blockId && block.type === 'paragraph' && block.list === 'check'); if (!block) return null;
      block.checked = payload.checked;
      if (candidate.preferences.sortChecked) {
        const at = note.document.blocks.indexOf(block); let start = at, end = at + 1;
        while (start > 0 && note.document.blocks[start - 1].type === 'paragraph' && note.document.blocks[start - 1].list === 'check') start--;
        while (end < note.document.blocks.length && note.document.blocks[end].type === 'paragraph' && note.document.blocks[end].list === 'check') end++;
        const group = note.document.blocks.slice(start, end); note.document.blocks.splice(start, group.length, ...group.filter(row => !row.checked), ...group.filter(row => row.checked));
      }
      return selection;
    }), true);
    if (suffix === 'table') return commit(lease, (candidate, window) => edit(candidate, window, (note, selection) => {
      if (payload.operation === 'insert') { const blockId = `table-${candidate.nextId++}`, table = { id: blockId, type: 'table', rows: Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => [{ text: '', marks: [] }])) }; const at = note.document.blocks.findIndex(block => block.id === selection.blockId); note.document.blocks.splice(at + 1, 0, table); return { blockId, row: 0, column: 0, start: 0, end: 0, direction: 'none' }; }
      const table = note.document.blocks.find(block => block.id === (payload.blockId ?? selection.blockId) && block.type === 'table'); if (!table) return null;
      const row = payload.row ?? Math.max(0, selection.row), column = payload.column ?? Math.max(0, selection.column); if (row >= table.rows.length || column >= table.rows[0].length) return null;
      if (payload.operation === 'delete' || payload.operation === 'row.delete' && table.rows.length === 1 || payload.operation === 'column.delete' && table.rows[0].length === 1) { note.document.blocks.splice(note.document.blocks.indexOf(table), 1); if (!note.document.blocks.length) note.document.blocks.push(paragraph(`block-${candidate.nextId++}`)); return firstDocumentSelection(note.document); }
      if (payload.operation === 'row.add') table.rows.splice(row + 1, 0, table.rows[0].map(() => [{ text: '', marks: [] }]));
      if (payload.operation === 'row.delete') table.rows.splice(row, 1);
      if (payload.operation === 'column.add') table.rows.forEach(row => row.splice(column + 1, 0, [{ text: '', marks: [] }]));
      if (payload.operation === 'column.delete') table.rows.forEach(row => row.splice(column, 1));
      return { blockId: table.id, row: Math.min(row, table.rows.length - 1), column: Math.min(column, table.rows[0].length - 1), start: 0, end: 0, direction: 'none' };
    }), true);
    if (suffix === 'table.navigate') {
      const selection = lease.view.captureSelection(); if (!current || !selection || !validDocumentSelection(current.document, selection)) return stale();
      const table = current.document.blocks.find(block => block.id === selection.blockId && block.type === 'table'); if (!table) return invalid();
      const columns = table.rows[0].length, index = selection.row * columns + selection.column + (payload.backwards ? -1 : 1);
      if (index < 0) return unavailable('Already at the first table cell.');
      return commit(lease, (candidate, window) => { const note = candidate.notes.find(note => note.id === current.id), block = note.document.blocks.find(block => block.id === table.id); if (index >= block.rows.length * columns) { const changed = edit(candidate, window, () => { block.rows.push(block.rows[0].map(() => [{ text: '', marks: [] }])); return { ...selection, row: block.rows.length - 1, column: 0, start: 0, end: 0 }; }); return changed; } window.selection = { ...selection, row: Math.floor(index / columns), column: index % columns, start: 0, end: 0 }; return {}; }, true);
    }
    if (suffix === 'undo' || suffix === 'redo') return commit(lease, (candidate, window) => {
      const note = candidate.notes.find(note => note.id === window.selectedId); if (!writable(note)) return reject('read_only', 'The original document is unavailable for history.');
      const source = note[suffix], destination = note[suffix === 'undo' ? 'redo' : 'undo']; if (!source.length) return unavailable('No history entry is available.');
      const next = source.pop(); destination.push({ document: note.document, selection: window.selection ?? firstDocumentSelection(note.document) }); if (destination.length > 32) destination.shift(); note.document = next.document; window.selection = next.selection; const stamp = time(candidate); if (stamp === null) return invalid(); note.updatedAt = stamp; note.revision++; return {};
    }, true);
    if (suffix === 'clipboard') {
      const search = lease.view.captureSearch?.();
      if (search) {
        if (search.value !== lease.session.query) return stale();
        if (payload.operation === 'selectAll') { search.node.setSelectionRange(0, search.value.length); return applied(target); }
        const value = search.value.slice(search.start, search.end);
        if (payload.operation === 'copy') return external(lease, 'setClipboard', { kind: 'text', text: value, fileIds: [] });
        let replacement = '';
        if (payload.operation === 'paste') {
          if (typeof ctx.getClipboard !== 'function') return unavailable('The actual scene clipboard bridge is unavailable.');
          const clipboard = await ctx.getClipboard(); if (!lease.guard()) return stale(); if (clipboard?.kind !== 'text' || typeof clipboard.text !== 'string') return unavailable('The scene clipboard contains no text.');
          replacement = clipboard.text.replace(/\r?\n/g, ' ');
        }
        const query = search.value.slice(0, search.start) + replacement + search.value.slice(search.end);
        const prepared = prepare(lease, (_, window) => { window.query = query; }, payload.operation === 'cut'); if (prepared.error) return prepared.error; let committedGeneration;
        if (payload.operation === 'cut') {
          if (typeof ctx.setClipboard !== 'function') return unavailable('The actual scene clipboard bridge is unavailable.');
          let committed = false; const onCommit = () => { if (!lease.guard() || lease.view.captureSearch?.()?.node !== search.node) return false; applyNotesWorkspaceCandidate(state, prepared.candidate); committedGeneration = ++generation; committed = true; return true; };
          const result = await ctx.setClipboard({ kind: 'text', text: value, fileIds: [], reserveTextUnits: prepared.deltaTextUnits, onCommit }, { guard: lease.guard, windowId: lease.windowId });
          if (!committed) return !lease.guard() ? stale() : result?.status === 'rejected' ? result : unavailable('The clipboard bridge did not atomically commit the original cut.');
        } else { if (!lease.guard()) return stale(); applyNotesWorkspaceCandidate(state, prepared.candidate); committedGeneration = ++generation; }
        await ctx.tick();
        if (alive() && generation === committedGeneration && ctx.getWindow(lease.windowId) === lease.window && ctx.getView(lease.windowId) === lease.view && lease.view.captureSearch?.()?.node === search.node) search.node.setSelectionRange(search.start + replacement.length, search.start + replacement.length);
        return applied(target);
      }
      if (!current || noteWorkspaceLocked(current)) return reject('read_only', 'No unlocked original editor.');
      const selection = lease.view.captureSelection(); if (!selection || !validDocumentSelection(current.document, selection)) return stale();
      if (payload.operation === 'selectAll') { if (lease.view.selectAll() !== true) return unavailable('The actual native selection cannot be selected.'); return applied(target); }
      if (payload.operation === 'copy' || payload.operation === 'cut') {
        if (typeof ctx.setClipboard !== 'function') return unavailable('The actual shared scene clipboard bridge is unavailable.');
        const value = runsText(selectionRuns(current.document, selection)).slice(selection.start, selection.end);
        if (payload.operation === 'copy') return external(lease, 'setClipboard', { kind: 'text', text: value, fileIds: [] });
        if (!writable(current)) return reject('read_only', 'The original editor is read-only.');
        const prepared = prepare(lease, (candidate, window) => { window.selection = selection; return edit(candidate, window, (note, range) => replaceSelection(note.document, range, '')); }, true); if (prepared.error) return prepared.error;
        let committed = false, committedGeneration; const onCommit = () => { if (!lease.guard()) return false; applyNotesWorkspaceCandidate(state, prepared.candidate); committedGeneration = ++generation; committed = true; return true; };
        const result = await ctx.setClipboard({ kind: 'text', text: value, fileIds: [], reserveTextUnits: prepared.deltaTextUnits, onCommit }, { guard: lease.guard, windowId: lease.windowId });
        if (!committed) return !lease.guard() ? stale() : result?.status === 'rejected' ? result : unavailable('The clipboard bridge did not atomically commit the original cut.');
        await ctx.tick(); if (alive() && generation === committedGeneration && ctx.getWindow(lease.windowId) === lease.window && ctx.getView(lease.windowId) === lease.view && lease.view.available()) lease.view.restoreSelection(notesWorkspaceWindow(state, lease.windowId).selection); return applied(target);
      }
      if (typeof ctx.getClipboard !== 'function') return unavailable('The actual scene clipboard is unavailable.');
      const clipboard = await ctx.getClipboard(); if (!lease.guard()) return stale(); if (clipboard?.kind !== 'text' || typeof clipboard.text !== 'string') return unavailable('The scene clipboard does not contain text.');
      return commit(lease, (candidate, window) => { window.selection = selection; return edit(candidate, window, (note, range) => replaceSelection(note.document, range, clipboard.text)); }, true);
    }
    if (suffix.startsWith('attachment.')) {
      if (!record || noteWorkspaceLocked(record) || record.deletedAt !== null) return reject('read_only', 'Only an unlocked live note exposes attachments.');
      if (suffix === 'attachment.add') {
        if (!writable(record) || typeof ctx.readFile !== 'function') return unavailable('An actual writable note and canonical Files bridge are required.');
        const result = await ctx.readFile(payload.fileId, { guard: lease.guard, windowId: lease.windowId }); if (!lease.guard()) return stale(); if (result?.status !== 'applied') return bridgeResult(result);
        const decoded = decodeNotesAttachment(result.file); if (decoded.status !== 'applied') return decoded;
        if (decoded.fileId !== payload.fileId) return stale();
        return commit(lease, candidate => { const note = candidate.notes.find(note => note.id === record.id); if (note.attachments.some(attachment => attachment.fileId === decoded.fileId)) return invalid(); const stamp = time(candidate); if (stamp === null) return invalid(); note.attachments.push({ id: `attachment-${candidate.nextId++}`, fileId: decoded.fileId, name: decoded.name, mime: decoded.mime }); note.revision++; note.updatedAt = stamp; return {}; });
      }
      const attachment = record.attachments.find(attachment => attachment.id === payload.attachmentId); if (!attachment) return stale();
      if (suffix === 'attachment.remove') { if (!writable(record)) return reject('read_only', 'A view-only collaborator cannot remove attachments.'); return commit(lease, candidate => { const note = candidate.notes.find(note => note.id === record.id); note.attachments = note.attachments.filter(row => row.id !== attachment.id); note.revision++; return {}; }); }
      const name = payload.reveal ? 'revealFile' : 'openFile'; if (typeof ctx[name] !== 'function') return unavailable(`The actual ${name} bridge is unavailable.`);
      const result = payload.reveal ? await ctx.revealFile(attachment.fileId, { guard: lease.guard, windowId: lease.windowId }) : await ctx.openFile(attachment.fileId, null, { guard: lease.guard, windowId: lease.windowId }); return result?.status === 'applied' ? applied(target, result) : lease.guard() ? bridgeResult(result) : stale();
    }
    if (['lock', 'unlock', 'relock', 'lock.remove'].includes(suffix)) return commit(lease, candidate => {
      const note = candidate.notes.find(note => note.id === record?.id);
      if (suffix === 'relock') {
        const closing = candidate.notes.filter(row => payload.noteId === null || row.id === payload.noteId); for (const row of closing) if (row.lock) row.lock.unlocked = false;
        for (const window of candidate.windows) if (closing.some(row => row.id === window.sheetNoteId) && ['attachments', 'export', 'collaboration', 'lock'].includes(window.sheet)) { window.sheet = 'none'; window.sheetNoteId = null; }
        return {};
      }
      if (!note || note.deletedAt !== null) return invalid();
      if (suffix === 'lock') { if (note.lock || note.collaboration.enabled) return reject('conflict', 'Remove existing fictional lock or local collaboration first.'); note.lock = { secret: payload.secret, hint: payload.hint, unlocked: true }; }
      if (suffix === 'unlock' || suffix === 'lock.remove') { if (!note.lock || note.lock.secret !== payload.secret) return reject('incorrect_password', 'The fictional local password does not match.'); if (suffix === 'unlock') note.lock.unlocked = true; else note.lock = null; }
      for (const window of candidate.windows) if (window.sheetNoteId === note.id) { window.sheet = 'none'; window.sheetNoteId = null; } return {};
    });
    if (suffix === 'collaboration.set') {
      if (!record || noteWorkspaceLocked(record) || record.lock || record.deletedAt !== null) return reject('read_only', 'Remove fictional locking before local collaboration.');
      return commit(lease, candidate => { candidate.notes.find(note => note.id === record.id).collaboration = { enabled: payload.enabled, permission: payload.permission, participants: payload.participants }; return {}; });
    }
    if (suffix === 'account.save') return commit(lease, candidate => {
      if (!payload.account.name.trim()) return invalid();
      const existing = candidate.accounts.find(account => account.id === payload.account.id); if (existing) Object.assign(existing, payload.account); else { candidate.accounts.push(payload.account); candidate.folders.push({ id: `folder-${candidate.nextId++}`, accountId: payload.account.id, name: 'Notes', builtin: false, deletedAt: null }); } return {};
    });
    if (suffix === 'account.delete') return commit(lease, candidate => {
      if (['local', 'icloud', 'microsoft', candidate.preferences.defaultAccountId].includes(payload.accountId)) return reject('read_only', 'Builtin/default sources cannot be removed.');
      const folders = candidate.folders.filter(folder => folder.accountId === payload.accountId); if (candidate.notes.some(note => folders.some(folder => folder.id === note.folderId))) return reject('conflict', 'Move or permanently delete every source note first.');
      candidate.folders = candidate.folders.filter(folder => folder.accountId !== payload.accountId); candidate.accounts = candidate.accounts.filter(account => account.id !== payload.accountId); return {};
    });
    if (suffix === 'color.set') {
      if (!record || record.deletedAt !== null) return reject('read_only', 'Choose a live original note.');
      return commit(lease, candidate => { const note = candidate.notes.find(note => note.id === record.id), stamp = time(candidate); if (stamp === null) return invalid(); note.color = payload.color; note.revision++; note.updatedAt = stamp; return {}; });
    }
    if (suffix === 'preferences.set') return commit(lease, candidate => { candidate.preferences = payload.preferences; });
    if (suffix === 'view.set') return commit(lease, (_, window) => { Object.assign(window, payload); });
    if (suffix === 'sheet.open') {
      if (['lock', 'unlock', 'collaboration', 'attachments', 'export'].includes(payload.sheet) && !record) return unavailable('Select an original note before opening this sheet.');
      if (['collaboration', 'attachments', 'export'].includes(payload.sheet) && noteWorkspaceLocked(record)) return reject('locked', 'Unlock before exposing note-specific content.');
      return commit(lease, (_, window) => { window.sheet = payload.sheet; window.sheetNoteId = payload.noteId ?? (['lock', 'unlock', 'collaboration', 'attachments', 'export'].includes(payload.sheet) ? current?.id ?? null : null); window.sheetFolderId = payload.folderId ?? null; });
    }
    if (suffix === 'sheet.close') return commit(lease, (_, window) => { window.sheet = 'none'; window.sheetNoteId = null; window.sheetFolderId = null; });
    if (suffix === 'menu.set') return commit(lease, (_, window) => { window.menu = payload.menu; });
    if (suffix === 'context.set') return commit(lease, (_, window) => { window.contextNoteId = payload.noteId; });
    if (suffix === 'export' || suffix === 'print' || suffix === 'share') {
      if (!record || noteWorkspaceLocked(record)) return reject('locked', 'Unlock the original note before exporting, printing or sharing.');
      const title = noteWorkspaceTitle(record), text = noteWorkspaceText(record), html = documentHTML(record.document);
      if (suffix === 'print') return external(lease, 'printDocument', { appId: 'notes', documentId: record.id, title, text, html });
      if (suffix === 'share') return external(lease, 'share', { appId: 'notes', documentId: record.id, title, text, mime: 'text/plain' });
      if (typeof ctx.createFile !== 'function') return unavailable('The actual Files createFile bridge is unavailable.');
      let content = text, mime = 'text/plain';
      if (payload.format === 'markdown') { mime = 'text/markdown'; content = `# ${title.replace(/[\\`*_{}\[\]()#+.!<>~-]/g, '\\$&')}\n\n${text.split('\n').slice(1).join('\n')}`; }
      if (payload.format === 'html') { mime = 'text/html'; content = `<!doctype html><meta charset="utf-8"><title>Notes local rich export</title>${html}`; }
      if (payload.format === 'pdf') { try { const output = await createNotesPdf(text, ctx.getSceneTime(), ctx.fontLoader ? { fontLoader: ctx.fontLoader } : {}); if (!lease.guard()) return stale(); content = `data:application/pdf;base64,${output.base64}`; mime = 'application/pdf'; } catch (error) { return reject(error.code ?? 'unavailable', error.message); } }
      return external(lease, 'createFile', { name: payload.name, mime, text: content, source: { appId: 'notes', windowId: lease.windowId, documentId: record.id }, ...(payload.existingFileId ? { existingFileId: payload.existingFileId } : {}) });
    }
    if (suffix === 'window.new') {
      if (typeof ctx.createWindow !== 'function') return unavailable('The actual shell creation bridge is unavailable.');
      if (payload.noteId && (!record || noteWorkspaceLocked(record))) return reject('locked', 'Open only an unlocked original note in another window.');
      const id = await ctx.createWindow('notes', { noteId: payload.noteId ?? null, isCurrent: lease.guard }); return typeof id === 'string' ? applied({ windowId: id }) : unavailable('The shell did not create an actual Notes window.');
    }
    if (suffix === 'window.close') { if (typeof ctx.closeWindow !== 'function') return unavailable('The actual shell close bridge is unavailable.'); const result = await ctx.closeWindow(lease.windowId, { isCurrent: lease.guard }); return result === true || result?.status === 'applied' ? applied(target) : unavailable('The original shell window did not close.'); }
    if (suffix === 'focus') { if (!lease.view.focus(payload.controlId) || !alive() || ctx.getWindow(lease.windowId) !== lease.window || ctx.getView(lease.windowId) !== lease.view) return unavailable('The actual enabled native control is unavailable.'); ctx.focusWindow(lease.windowId); return applied(target); }
    if (suffix === 'scroll') { const position = lease.view.scroll(payload.area, payload); if (!position || !lease.guard()) return unavailable('The actual native scroll area is unavailable.'); return commit(lease, (_, window) => { window.scroll[payload.area] = position; return { position }; }); }
    return invalid();
  };
  return {
    handlers,
    targets: () => ({ windows: state.windows.map(window => ({ windowId: window.windowId, noteIds: visibleWorkspaceNotes(state, window).map(note => note.id), folderIds: ['all', 'deleted', 'attachments', ...state.folders.filter(folder => folder.deletedAt === null).map(folder => folder.id)] })) }),
    windowOpened(window, options = {}) {
      if (!alive() || notesWorkspaceWindow(state, window.id)) return false;
      const candidate = copyCanonicalData(state); candidate.windows.push(createNotesWorkspaceWindow(candidate, window.id, options));
      if (!validateNotesWorkspace(candidate, ctx.profile).ok || ctx.canCommit(canonicalStringUnits(candidate) - canonicalStringUnits(state)) !== true) return false;
      applyNotesWorkspaceCandidate(state, candidate); generation++; return true;
    },
    windowClosed(window) { if (!alive() || ctx.getWindow(window.id) !== window) return false; state.windows = state.windows.filter(row => row.windowId !== window.id); if (!state.windows.length) for (const note of state.notes) if (note.lock) note.lock.unlocked = false; generation++; return true; },
    appQuit() { if (!alive()) return false; state.windows = []; for (const note of state.notes) if (note.lock) note.lock.unlocked = false; generation++; return true; },
  };
}

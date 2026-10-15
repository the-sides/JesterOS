import { object, choice, flag } from './command-schema.js';
import { documentFromText, documentText, notesDocumentSchema, notesSelectionSchema, firstDocumentSelection, validDocumentSelection, runsText } from './notes-workspace-document.js';
import { copyCanonicalData, canonicalStringUnits } from './canonical-data.js';
export const NOTES_WORKSPACE_PROFILES = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
export const NOTES_WORKSPACE_LIMITS = Object.freeze({ notes: 1024, folders: 128, accounts: 16, windows: 64, history: 32, attachments: 128, text: 1048576, total: 4194304, retentionDays: 30 });
export const notesWorkspaceIdSchema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const id = notesWorkspaceIdSchema, nullable = schema => ({ anyOf: [{ type: 'null' }, schema] }), timestamp = { type: 'integer', minimum: 0, maximum: 8639999999999999 }, text = maxLength => ({ type: 'string', maxLength }), array = (items, maxItems) => ({ type: 'array', items, maxItems });
export const notesWorkspacePreferencesSchema = object({ sortBy: choice('date-edited', 'date-created', 'title'), groupByDate: flag, textSize: { type: 'integer', minimum: 12, maximum: 24 }, defaultStyle: choice('title', 'heading', 'body'), defaultAccountId: id, sortChecked: flag, confirmDelete: flag, theme: choice('light', 'dark', 'system') });
export const notesWorkspaceAccountSchema = object({ id, name: text(128), kind: choice('local', 'icloud', 'exchange', 'microsoft'), enabled: flag });
export const notesWorkspaceFolderSchema = object({ id, accountId: id, name: text(128), deletedAt: nullable(timestamp), builtin: flag });
export const notesWorkspaceAttachmentSchema = object({ id, fileId: id, name: text(256), mime: choice('image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf') });
const history = object({ document: notesDocumentSchema, selection: notesSelectionSchema });
export const notesWorkspaceNoteSchema = object({ id, folderId: id, document: notesDocumentSchema, color: choice('yellow', 'green', 'pink', 'purple', 'blue', 'gray', 'charcoal'), pinned: flag, createdAt: timestamp, updatedAt: timestamp, deletedAt: nullable(timestamp), restoreFolderId: nullable(id), revision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 }, attachments: array(notesWorkspaceAttachmentSchema, 128), lock: nullable(object({ secret: text(256), hint: text(256), unlocked: flag })), collaboration: object({ enabled: flag, permission: choice('edit', 'view'), participants: array(object({ id, name: text(128), role: choice('owner', 'edit', 'view') }), 32) }), undo: array(history, 32), redo: array(history, 32) });
export const NOTES_WORKSPACE_SHEETS = ['none', 'preferences', 'accounts', 'folder', 'delete-folder', 'trash-note', 'delete-note', 'empty-trash', 'lock', 'unlock', 'collaboration', 'attachments', 'export', 'help', 'about'];
export const notesWorkspaceWindowSchema = object({ windowId: id, folderId: id, selectedId: nullable(id), query: text(4096), sidebarVisible: flag, standalone: flag, mode: choice('list', 'gallery'), selection: nullable(notesSelectionSchema), sheet: choice(...NOTES_WORKSPACE_SHEETS), sheetNoteId: nullable(id), sheetFolderId: nullable(id), menu: nullable(choice('notes', 'file', 'edit', 'format', 'view', 'window', 'help')), contextNoteId: nullable(id), scroll: object({ list: object({ top: { type: 'number', minimum: 0 }, left: { type: 'number', minimum: 0 } }), editor: object({ top: { type: 'number', minimum: 0 }, left: { type: 'number', minimum: 0 } }) }) });
export const notesWorkspaceSchema = object({ version: { const: 1 }, profileId: choice(...NOTES_WORKSPACE_PROFILES), nextId: { type: 'integer', minimum: 5, maximum: Number.MAX_SAFE_INTEGER - 1 }, accounts: { ...array(notesWorkspaceAccountSchema, 16), minItems: 1 }, folders: { ...array(notesWorkspaceFolderSchema, 128), minItems: 1 }, notes: array(notesWorkspaceNoteSchema, 1024), preferences: notesWorkspacePreferencesSchema, windows: array(notesWorkspaceWindowSchema, 64) });
export function notesWorkspacePublicProjection(state) {
  return { version: state.version, profileId: state.profileId, accounts: copyCanonicalData(state.accounts), folders: copyCanonicalData(state.folders), preferences: copyCanonicalData(state.preferences), windows: copyCanonicalData(state.windows), notes: state.notes.map(noteWorkspaceProjection) };
}
/** Commit only a fully validated/budgeted candidate. Preserve surviving original
 * record/session/attachment identities so a presentation edit cannot replace
 * an attachment's DOM owner or cause PDF pages to reload. Retired IDs are gone. */
export function applyNotesWorkspaceCandidate(state, candidate) {
  for (const field of ['accounts', 'folders', 'notes', 'windows']) {
    const key = field === 'windows' ? 'windowId' : 'id', originals = new Map(state[field].map(row => [row[key], row]));
    candidate[field] = candidate[field].map(row => {
      const original = originals.get(row[key]); if (!original) return row;
      if (field === 'notes') {
        // Selection/folder/preferences commits must not replace unchanged native
        // text-run owners and disturb the browser's live caret.
        if (JSON.stringify(original.document) === JSON.stringify(row.document)) row.document = original.document;
        const attachments = new Map(original.attachments.map(attachment => [attachment.id, attachment]));
        row.attachments = row.attachments.map(attachment => { const owned = attachments.get(attachment.id); return owned && owned.fileId === attachment.fileId && owned.name === attachment.name && owned.mime === attachment.mime ? owned : attachment; });
      }
      Object.assign(original, row); return original;
    });
  }
  Object.assign(state, candidate);
}
export function notesWorkspaceSchemaValid(value, schema, seen = new Set()) {
  if (schema.anyOf) return schema.anyOf.some(item => notesWorkspaceSchemaValid(value, item, seen));
  if (schema.oneOf) return schema.oneOf.filter(item => notesWorkspaceSchemaValid(value, item, seen)).length === 1;
  if (Object.hasOwn(schema, 'const') && value !== schema.const || schema.enum && !schema.enum.includes(value)) return false;
  if (!schema.type) return true;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity) && (!schema.pattern || new RegExp(schema.pattern).test(value));
  if (schema.type === 'number' || schema.type === 'integer') return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity) || Reflect.ownKeys(value).some(key => key !== 'length' && (!/^(0|[1-9]\d*)$/.test(String(key)) || Number(key) >= value.length))) return false;
    seen.add(value); const okay = Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index))).every(descriptor => descriptor && Object.hasOwn(descriptor, 'value') && notesWorkspaceSchemaValid(descriptor.value, schema.items, seen)); seen.delete(value);
    return okay && (!schema.uniqueItems || new Set(value.map(item => JSON.stringify(item))).size === value.length);
  }
  if (schema.type === 'object') {
    const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(value); if (keys.some(key => typeof key !== 'string' || !Object.hasOwn(schema.properties, key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) || schema.required.some(key => !Object.hasOwn(value, key))) return false;
    seen.add(value); const okay = keys.every(key => notesWorkspaceSchemaValid(Object.getOwnPropertyDescriptor(value, key).value, schema.properties[key], seen)); seen.delete(value); return okay;
  }
  return false;
}
export function validateNotesWorkspace(state, profile) {
  const invalid = message => ({ ok: false, message });
  if (!notesWorkspaceSchemaValid(state, notesWorkspaceSchema)) return invalid('Notes workspace must match the closed descriptor-safe schema.');
  if (profile && state.profileId !== profile.id) return invalid('Notes profile does not match the scene.');
  const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;
  if (![state.accounts, state.folders, state.notes].every(unique) || new Set(state.windows.map(row => row.windowId)).size !== state.windows.length) return invalid('Duplicate Notes identity.');
  if (!state.accounts.some(row => row.id === state.preferences.defaultAccountId && row.enabled)) return invalid('The default account must be enabled.');
  if (!state.folders.some(row => row.id === 'notes' && row.builtin && row.deletedAt === null)) return invalid('The local Notes recovery folder must remain available.');
  if (state.folders.some(folder => !folder.name.trim() || !state.accounts.some(account => account.id === folder.accountId))) return invalid('Folders require a named real source account.');
  for (const note of state.notes) {
    const folder = state.folders.find(row => row.id === note.folderId);
    if (!folder || note.createdAt > note.updatedAt || note.deletedAt !== null && note.deletedAt > note.updatedAt || note.deletedAt === null && folder.deletedAt !== null || !unique(note.attachments) || note.lock && !note.lock.secret.length || !unique(note.collaboration.participants)) return invalid('Invalid note folder, lock, attachment or authored timestamps.');
    if (note.restoreFolderId !== null && !state.folders.some(row => row.id === note.restoreFolderId)) return invalid('Unknown recovery folder.');
    for (const document of [note.document, ...note.undo.map(row => row.document), ...note.redo.map(row => row.document)]) {
      if (!unique(document.blocks) || documentText(document).length > NOTES_WORKSPACE_LIMITS.text || document.blocks.some(block => block.type === 'table' && block.rows.some(row => row.length !== block.rows[0].length))) return invalid('Invalid bounded rich document or rectangular table.');
    }
    if ([...note.undo, ...note.redo].some(row => !validDocumentSelection(row.document, row.selection))) return invalid('History selections must belong to their saved documents.');
  }
  for (const window of state.windows) {
    if (!['all', 'deleted', 'attachments'].includes(window.folderId) && !state.folders.some(folder => folder.id === window.folderId && folder.deletedAt === null)) return invalid('Window folder is missing.');
    const note = state.notes.find(row => row.id === window.selectedId);
    if (window.selectedId !== null && !visibleWorkspaceNotes(state, window).includes(note) || window.selection !== null && (!note || !validDocumentSelection(note.document, window.selection))) return invalid('Window selection must belong to a visible original note.');
    if (window.sheetNoteId !== null && !state.notes.some(row => row.id === window.sheetNoteId) || window.contextNoteId !== null && !state.notes.some(row => row.id === window.contextNoteId) || window.sheetFolderId !== null && !state.folders.some(row => row.id === window.sheetFolderId)) return invalid('Sheet refers to a retired original record.');
  }
  return canonicalStringUnits(state) <= NOTES_WORKSPACE_LIMITS.total ? { ok: true } : invalid('Notes exceeds the complete scene text bound.');
}
const fixtures = [
  'Camping trip\nLeave Friday after lunch and drive up to the lake.\n\nBring the tent, sleeping bags, a lantern, and the little camp stove. Check the weather before we go.\n\nMeet Emma at the trailhead at 3:00. She is bringing coffee and the map.',
  'Photography spots\nThe old pier at sunrise.\nThe overlook above the lake, just before sunset.\nThe trail through the birch trees if the leaves have started turning.\n\nPack the 35mm lens, a spare battery, and the tripod.',
  'Shopping list\nApples\nBread and cheese\nCoffee\nTrail mix\nMarshmallows\nMatches\n\nPick everything up on Thursday evening.',
  'Old packing list\nRain jacket\nExtra socks\nWater bottles\n\nCopied these into the camping note.'
];
const sierraFixtures = ['Camilla and Bob anniversary\nCall 4–5 days ahead for party reservation and confirm the guest list.', 'Kitchen remodel ideas\nRomano wants marble or granite. Bring the samples when we meet on Thursday.', 'Romano Contractor Notes\nThe inspector will visit next Thursday. Check with Diana to see who should work from home.', 'Old packing list\nRain jacket\nExtra socks\nWater bottles'];
export function workspaceNote(id, text, folderId, time) { return { id, folderId, document: documentFromText(text, id), color: 'yellow', pinned: false, createdAt: time, updatedAt: time, deletedAt: null, restoreFolderId: null, revision: 0, attachments: [], lock: null, collaboration: { enabled: false, permission: 'edit', participants: [] }, undo: [], redo: [] }; }
export function notesWorkspacePreferencesDefaults(profile) {
  return { sortBy: 'date-edited', groupByDate: true, textSize: 14, defaultStyle: 'title', defaultAccountId: 'local', sortChecked: false, confirmDelete: profile.id.startsWith('windows11'), theme: 'system' };
}
export function createNotesWorkspace(profile) {
  if (!NOTES_WORKSPACE_PROFILES.includes(profile?.id)) throw new TypeError('An installed Notes profile is required.');
  const now = Date.parse(profile.defaults.sceneTime); if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('An authored scene instant is required.');
  const sierra = profile.id === NOTES_WORKSPACE_PROFILES[0], base = sierra ? Date.UTC(2017, 8, 25, 9, 41) : now - 42 * 60000;
  const notes = (sierra ? sierraFixtures : fixtures).map((text, index) => { const note = workspaceNote(`note-${index + 1}`, text, 'notes', sierra ? base - (index + 1) * 86400000 : base + [0, 5, 10, 2][index] * 60000); note.updatedAt = sierra ? base - index * 60000 : base + [42, 35, 20, 30][index] * 60000; note.pinned = index === 0; if (index === 3) { note.deletedAt = note.updatedAt; note.restoreFolderId = 'notes'; } return note; });
  const windows = profile.id.startsWith('windows11'), cloudId = windows ? 'microsoft' : 'icloud';
  return { version: 1, profileId: profile.id, nextId: 5, accounts: [{ id: 'local', name: windows ? 'This device' : 'On My Mac', kind: 'local', enabled: true }, { id: cloudId, name: windows ? 'Microsoft (fictional)' : 'iCloud (fictional)', kind: windows ? 'microsoft' : 'icloud', enabled: true }], folders: [{ id: 'notes', accountId: 'local', name: 'Notes', builtin: true, deletedAt: null }, { id: `${cloudId}-notes`, accountId: cloudId, name: 'Notes', builtin: true, deletedAt: null }], notes, preferences: notesWorkspacePreferencesDefaults(profile), windows: [] };
}
export function importLegacyNotesWorkspace(profile, legacy) {
  const state = createNotesWorkspace(profile);
  state.notes = legacy.notes.map(source => { const note = workspaceNote(source.id, source.text, 'notes', source.createdAt); note.updatedAt = source.updatedAt; note.pinned = source.pinned; if (source.deleted) { note.deletedAt = source.updatedAt; note.restoreFolderId = 'notes'; } return note; });
  state.nextId = Math.max(5, ...state.notes.map(note => Number(/^note-(\d+)$/.exec(note.id)?.[1] ?? 0) + 1));
  if (legacy.preferences) for (const key of ['sortBy', 'groupByDate', 'textSize']) if (Object.hasOwn(legacy.preferences, key)) state.preferences[key] = legacy.preferences[key];
  return state;
}
export function legacyNotesWorkspaceWindowOptions(legacy) {
  return { folderId: legacy.folder ?? 'notes', noteId: legacy.selectedId ?? null, query: legacy.search ?? '', sidebarVisible: legacy.sidebarVisible ?? true, standalone: false };
}
export const noteWorkspaceLocked = note => !!note?.lock && !note.lock.unlocked;
export const noteWorkspaceText = note => note && !noteWorkspaceLocked(note) ? documentText(note.document) : '';
export const noteWorkspaceTitle = note => noteWorkspaceLocked(note) ? 'Locked Note' : noteWorkspaceText(note).split('\n', 1)[0].trim() || 'New Note';
export const noteWorkspacePreview = note => noteWorkspaceText(note).split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();
export const noteWorkspaceProjection = note => ({ id: note.id, text: noteWorkspaceText(note), title: noteWorkspaceTitle(note), preview: noteWorkspacePreview(note), pinned: note.pinned, deleted: note.deletedAt !== null, createdAt: note.createdAt, updatedAt: note.updatedAt, locked: noteWorkspaceLocked(note), folderId: note.folderId });
const workspaceTitleOrder = new Intl.Collator('en-US', { sensitivity: 'base', numeric: true });
export function visibleWorkspaceNotes(state, window) {
  if (!window) return [];
  const query = window.query.replace(/\s+/g, ' ').trim().toLowerCase(), deleted = window.folderId === 'deleted';
  return state.notes.filter(note => (note.deletedAt !== null) === deleted && (deleted || window.folderId === 'all' || window.folderId === 'attachments' && !noteWorkspaceLocked(note) && note.attachments.length || note.folderId === window.folderId) && state.accounts.some(account => account.enabled && state.folders.some(folder => folder.id === note.folderId && folder.accountId === account.id)) && (!query || (!noteWorkspaceLocked(note) && noteWorkspaceText(note).replace(/\s+/g, ' ').trim().toLowerCase().includes(query))))
    .sort((a, b) => !deleted && a.pinned !== b.pinned ? a.pinned ? -1 : 1 : state.preferences.sortBy === 'title' ? workspaceTitleOrder.compare(noteWorkspaceTitle(a), noteWorkspaceTitle(b)) || a.id.localeCompare(b.id) : b[state.preferences.sortBy === 'date-created' ? 'createdAt' : 'updatedAt'] - a[state.preferences.sortBy === 'date-created' ? 'createdAt' : 'updatedAt'] || b[state.preferences.sortBy === 'date-created' ? 'updatedAt' : 'createdAt'] - a[state.preferences.sortBy === 'date-created' ? 'updatedAt' : 'createdAt'] || a.id.localeCompare(b.id));
}
export const notesWorkspaceWindow = (state, windowId) => state.windows.find(window => window.windowId === windowId);
export function createNotesWorkspaceWindow(state, windowId, options = {}) {
  const requested = state.notes.find(note => note.id === options.noteId), folderId = options.folderId ?? (requested ? requested.deletedAt !== null ? 'deleted' : requested.folderId : 'notes');
  const window = { windowId, folderId, selectedId: null, query: options.query ?? '', sidebarVisible: options.sidebarVisible ?? true, standalone: options.standalone ?? !!requested, mode: 'list', selection: null, sheet: 'none', sheetNoteId: null, sheetFolderId: null, menu: null, contextNoteId: null, scroll: { list: { top: 0, left: 0 }, editor: { top: 0, left: 0 } } };
  const initial = visibleWorkspaceNotes(state, window); window.selectedId = initial.find(note => note.id === options.noteId)?.id ?? (state.profileId === NOTES_WORKSPACE_PROFILES[0] ? initial.find(note => note.id === 'note-3')?.id : null) ?? initial[0]?.id ?? null;
  if (window.selectedId) window.selection = firstDocumentSelection(state.notes.find(note => note.id === window.selectedId).document);
  return window;
}
export function reconcileNotesWorkspace(state) {
  for (const window of state.windows) {
    if (!['all', 'deleted', 'attachments'].includes(window.folderId) && !state.folders.some(folder => folder.id === window.folderId && folder.deletedAt === null)) window.folderId = 'notes';
    const visible = visibleWorkspaceNotes(state, window), note = visible.find(note => note.id === window.selectedId);
    if (!note && window.selectedId !== null) { window.selectedId = window.standalone ? null : visible[0]?.id ?? null; window.selection = window.selectedId ? firstDocumentSelection(visible[0].document) : null; }
    else if (note && window.selection && !validDocumentSelection(note.document, window.selection)) window.selection = firstDocumentSelection(note.document);
    if (!state.notes.some(note => note.id === window.contextNoteId)) window.contextNoteId = null;
    if (window.sheetNoteId && !state.notes.some(note => note.id === window.sheetNoteId) || window.sheetFolderId && !state.folders.some(folder => folder.id === window.sheetFolderId)) { window.sheet = 'none'; window.sheetNoteId = null; window.sheetFolderId = null; }
  }
}
export function sweepNotesWorkspace(state, sceneTime) {
  if (!Number.isSafeInteger(sceneTime) || sceneTime < 0) return false;
  const expired = new Set(state.notes.filter(note => note.deletedAt !== null && sceneTime - note.deletedAt >= 30 * 86400000).map(note => note.id));
  state.notes = state.notes.filter(note => !expired.has(note.id));
  state.folders = state.folders.filter(folder => folder.builtin || folder.deletedAt === null || sceneTime - folder.deletedAt < 30 * 86400000 || state.notes.some(note => note.folderId === folder.id || note.restoreFolderId === folder.id));
  reconcileNotesWorkspace(state); return true;
}
export function notesWorkspaceGroupLabel(note, sceneTime) {
  if (note.pinned) return 'Pinned'; const days = Math.floor(sceneTime / 86400000) - Math.floor(note.updatedAt / 86400000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? 'Previous 7 Days' : days < 30 ? 'Previous 30 Days' : new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(note.updatedAt);
}

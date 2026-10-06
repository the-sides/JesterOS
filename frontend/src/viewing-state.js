import { object, choice, flag } from './command-schema.js';
import { isRecord } from './feature-commands.js';
import { createMacApplicationFiles } from './mac-application-files.js';

export const VIEWING_LIMIT = 1024;
export const NOTE_ZOOM_STEPS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
const forbidden = [...Object.getOwnPropertyNames(Object.prototype), 'prototype'];
export const viewingIdentitySchema = { type: 'string', minLength: 1, maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: forbidden } };
// These are installation directories, not a permissive extension of mutable IDs.
const installedFolderPattern = '^mac-application-folder:(?:Applications|System|System/Applications|System/Applications/Utilities|System/Library|System/Library/CoreServices|System/Library/CoreServices/Applications)$';
const installedFolderExpression = new RegExp(installedFolderPattern);
export const viewingFolderIdentitySchema = { anyOf: [viewingIdentitySchema,
  { type: 'string', pattern: installedFolderPattern }] };
export const validViewingIdentity = value => typeof value === 'string' && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !forbidden.includes(value);
export const isInstalledViewingFolderId = value => typeof value === 'string' && installedFolderExpression.test(value);
export const closedViewingFields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  && required.every(key => Object.hasOwn(value, key));
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
export const finderViewSchema = object({ mode: choice('icons', 'list', 'columns', 'gallery'),
  sortBy: choice('name', 'kind', 'size', 'date-created', 'date-modified', 'date-added', 'tags'), descending: flag,
  groupBy: choice('none', 'kind', 'size', 'date-created', 'date-modified', 'date-added', 'tags'),
  iconSize: integer(32, 128), gridSpacing: integer(8, 48), textSize: integer(10, 20) });
export const finderPresentationSchema = { ...object({ toolbarVisible: flag, sidebarVisible: flag,
  pathBarVisible: flag, statusBarVisible: flag, previewVisible: flag }),
  allOf: [{ if: { properties: { toolbarVisible: { const: false } }, required: ['toolbarVisible'] },
    then: { properties: { sidebarVisible: { const: false } } } }] };
export const notesPresentationSchema = { ...object({ mode: choice('list', 'gallery'), documentVisible: flag }),
  allOf: [{ if: { properties: { mode: { const: 'list' } }, required: ['mode'] },
    then: { properties: { documentVisible: { const: true } } } }] };
export const notesViewProperties = { mode: choice('list', 'gallery'), showNoteCount: flag,
  sortBy: choice('default', 'date-edited', 'date-created', 'title'), sortDirection: choice('default', 'ascending', 'descending') };
export const viewingSchema = object({
  notes: object({ ...notesViewProperties, zooms: { type: 'object', maxProperties: VIEWING_LIMIT,
    propertyNames: viewingIdentitySchema, additionalProperties: choice(...NOTE_ZOOM_STEPS) } }),
  finder: object({ folderViews: { type: 'object', maxProperties: VIEWING_LIMIT,
    propertyNames: viewingFolderIdentitySchema, additionalProperties: finderViewSchema } }),
});
export const finderViewDefaults = () => ({ mode: 'icons', sortBy: 'name', descending: false,
  groupBy: 'none', iconSize: 64, gridSpacing: 24, textSize: 12 });
export const finderPresentationDefaults = () => ({ toolbarVisible: true, sidebarVisible: true,
  pathBarVisible: false, statusBarVisible: false, previewVisible: false });
export const notesPresentationDefaults = (mode = 'list') => ({ mode, documentVisible: mode === 'list' });
export const viewingDefaults = () => ({ notes: { mode: 'list', showNoteCount: true,
  sortBy: 'default', sortDirection: 'default', zooms: {} }, finder: { folderViews: {} } });
const bounded = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
export function validFinderView(value, partial = false) {
  return closedViewingFields(value, Object.keys(finderViewSchema.properties), partial ? [] : undefined)
    && (!partial || Object.keys(value).length > 0)
    && Object.entries(value).every(([key, entry]) => key === 'descending' ? typeof entry === 'boolean'
      : key === 'iconSize' ? bounded(entry, 32, 128) : key === 'gridSpacing' ? bounded(entry, 8, 48)
        : key === 'textSize' ? bounded(entry, 10, 20) : finderViewSchema.properties[key].enum.includes(entry));
}
export function validFinderPresentation(value, partial = false) {
  return closedViewingFields(value, Object.keys(finderPresentationSchema.properties), partial ? [] : undefined)
    && (!partial || Object.keys(value).length > 0) && Object.values(value).every(entry => typeof entry === 'boolean')
    && !(value.toolbarVisible === false && value.sidebarVisible === true);
}
export function validNotesPresentation(value) {
  return closedViewingFields(value, ['mode', 'documentVisible']) && ['list', 'gallery'].includes(value.mode)
    && typeof value.documentVisible === 'boolean' && (value.mode !== 'list' || value.documentVisible);
}
export function validNotesViewPatch(value) {
  return closedViewingFields(value, Object.keys(notesViewProperties), []) && Object.keys(value).length > 0
    && Object.entries(value).every(([key, entry]) => key === 'showNoteCount' ? typeof entry === 'boolean'
      : notesViewProperties[key].enum.includes(entry));
}
export function validateViewing(viewing, { notes, files } = {}, profile) {
  const invalid = message => ({ ok: false, message });
  if (!closedViewingFields(viewing, ['notes', 'finder'])
    || !closedViewingFields(viewing.notes, [...Object.keys(notesViewProperties), 'zooms'])
    || !validNotesViewPatch(Object.fromEntries(Object.keys(notesViewProperties).map(key => [key, viewing.notes[key]])))
    || !closedViewingFields(viewing.finder, ['folderViews'])) return invalid('Expected a closed complete viewing domain.');
  const zooms = viewing.notes.zooms, folders = viewing.finder.folderViews;
  for (const map of [zooms, folders]) if (!isRecord(map) || Reflect.ownKeys(map).length > VIEWING_LIMIT
    || Reflect.ownKeys(map).some(key => typeof key !== 'string'
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(map, key), 'value'))) return invalid('Viewing dictionaries need bounded plain data properties.');
  const noteRecords = notes?.notes ?? (Array.isArray(notes) ? notes : null);
  const noteIds = noteRecords ? new Set(noteRecords.map(note => note.id)) : null;
  for (const [noteId, zoom] of Object.entries(zooms)) {
    if (!validViewingIdentity(noteId) || !NOTE_ZOOM_STEPS.includes(zoom)
      || noteIds && !noteIds.has(noteId)) return invalid('Invalid note zoom identity, canonical note or finite zoom step.');
  }
  // Safe unknown mutable IDs survive deletion/undo. Known records must actually
  // be folders; colon/slash installation IDs are accepted only from the profile.
  const records = files?.files ?? (Array.isArray(files) ? files : []);
  const registered = profile ? new Set(createMacApplicationFiles(profile).filter(file => file.kind === 'folder').map(file => file.id)) : new Set();
  for (const [folderId, view] of Object.entries(folders)) {
    if (!(validViewingIdentity(folderId) || registered.has(folderId)) || !validFinderView(view)) return invalid('Invalid complete folder view or unregistered folder identity.');
    const existing = records.find(file => file.id === folderId);
    if (existing && existing.kind !== 'folder') return invalid('Folder preferences cannot name a document or application bundle.');
  }
  return { ok: true };
}

/** Project sorting only; selection and document data remain canonical/shared. */
export function notesViewProjection(notes, viewing) {
  const override = notes.folder !== 'deleted';
  const sortBy = override && viewing.notes.sortBy !== 'default'
    ? viewing.notes.sortBy : notes.preferences?.sortBy ?? 'date-edited';
  const sortDirection = override && viewing.notes.sortDirection !== 'default'
    ? viewing.notes.sortDirection : sortBy === 'title' ? 'ascending' : 'descending';
  return { ...notes, preferences: { ...notes.preferences, sortBy, sortDirection } };
}

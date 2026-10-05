import { text, identity, choice, object, empty } from './command-schema.js';
import { applied, invalid, stale, uiState, liveFile, children, createFile, validName, uniqueName, isTrashed, pathOf } from './windows11-app-helpers.js';

export const menus = ['new', 'view', 'more'];
export const createState = () => ({ ui: uiState(), folderId: 'root', selectedId: null, view: 'details', search: '', history: ['root'], historyIndex: 0 });
const fileTarget = object({ fileId: identity });
const folderTarget = object({ folderId: identity });
export const specs = {
  'win11.explorer.navigate': [folderTarget, empty, ['Open File Explorer before navigating; retain folder history.']],
  'win11.explorer.history': [empty, object({ direction: choice('back', 'forward') })],
  'win11.explorer.select': [fileTarget, empty],
  'win11.explorer.view': [empty, object({ view: choice('details', 'icons') })],
  'win11.explorer.search': [empty, object({ query: text })],
  'win11.explorer.create': [folderTarget, object({ name: text, kind: choice('folder', 'text') }), [], ['Create a session virtual file.']],
  'win11.explorer.rename': [fileTarget, object({ name: text }), [], ['Rename a live virtual file.']],
  'win11.explorer.copy': [fileTarget, object({ folderId: identity, name: text }), [], ['Recursively copy virtual files.']],
  'win11.explorer.move': [fileTarget, object({ folderId: identity, name: text }), [], ['Move a virtual file without creating a cycle.']],
  'win11.explorer.trash': [fileTarget, empty, [], ['Move an item and its descendants to Recycle Bin.']],
  'win11.explorer.restore': [fileTarget, empty, [], ['Restore to the original live folder without overwriting.']],
  'win11.explorer.properties': [fileTarget, empty],
  'win11.explorer.dialog.open': [empty, object({ kind: choice('create-folder', 'create-text', 'rename', 'copy', 'move') })],
  'win11.explorer.dialog.change': [empty, object({ field: choice('name', 'folderId'), value: text })],
  'win11.explorer.dialog.commit': [empty, empty],
  'win11.explorer.dialog.cancel': [empty, empty],
};
const mutable = (apps, id) => { const file = liveFile(apps, id); return file && !['root', 'desktop', 'documents', 'pictures'].includes(id) ? file : null; };
const folder = (apps, id) => { const item = liveFile(apps, id); return item?.kind === 'folder' ? item : null; };
function cycle(apps, sourceId, destinationId) {
  const seen = new Set(); let id = destinationId;
  while (id && !seen.has(id)) { if (id === sourceId) return true; seen.add(id); id = liveFile(apps, id)?.parentId; }
  return false;
}
export const fileSpecs = Object.fromEntries(['create', 'rename', 'copy', 'move', 'trash', 'restore'].map(name =>
  [`win11.files.${name}`, specs[`win11.explorer.${name}`]]));

// Filesystem operations have no application/window scope. Explorer wraps these
// same reducers to retain its local selection policy; Terminal uses them directly.
export function createFileCommands(apps) {
  return {
    'win11.files.create': ({ folderId }, { name, kind }) => {
      if (!folder(apps, folderId)) return stale('Destination folder no longer exists.');
      if (!validName(name) || !uniqueName(apps, folderId, name)) return invalid('Use a valid, unique file name.');
      const file = createFile(apps, folderId, name, kind); return applied({ fileId: file.id });
    },
    'win11.files.rename': ({ fileId }, { name }) => {
      const file = mutable(apps, fileId); if (!file) return stale('This item cannot be renamed.');
      if (!validName(name) || !uniqueName(apps, file.parentId, name, fileId)) return invalid('Use a valid, unique name.');
      file.name = name; file.revision++; return applied({ fileId });
    },
    'win11.files.copy': ({ fileId }, { folderId, name }) => {
      const file = liveFile(apps, fileId); if (!file || fileId === 'root' || !folder(apps, folderId)) return stale('Source or destination no longer exists.');
      if (!validName(name) || !uniqueName(apps, folderId, name) || cycle(apps, fileId, folderId)) return invalid('Destination name conflicts or would create a folder cycle.');
      const duplicate = (source, parentId, title) => { const descendants = source.kind === 'folder' ? children(apps, source.id) : []; const content = source.content && typeof source.content === 'object' ? JSON.parse(JSON.stringify(source.content)) : source.content; const copy = createFile(apps, parentId, title, source.kind, content); for (const child of descendants) duplicate(child, copy.id, child.name); return copy; };
      return applied({ fileId: duplicate(file, folderId, name).id });
    },
    'win11.files.move': ({ fileId }, { folderId, name }) => {
      const file = mutable(apps, fileId); if (!file || !folder(apps, folderId)) return stale('Source or destination no longer exists.');
      if (!validName(name) || !uniqueName(apps, folderId, name, fileId) || cycle(apps, fileId, folderId)) return invalid('Destination name conflicts or would create a folder cycle.');
      file.parentId = folderId; file.name = name; file.revision++; return applied({ fileId });
    },
    'win11.files.trash': ({ fileId }) => { const file = mutable(apps, fileId); if (!file) return stale('This item cannot be deleted.'); file.deleted = true; file.revision++; return applied({ fileId }); },
    'win11.files.restore': ({ fileId }) => {
      const file = apps.files.find(item => item.id === fileId && item.deleted); if (!file) return stale('Item is not directly in Recycle Bin.');
      if (!folder(apps, file.parentId)) return stale('Restore the original parent folder first.');
      if (!uniqueName(apps, file.parentId, file.name, fileId)) return invalid('An item with that name already exists.');
      file.deleted = false; file.revision++; return applied({ fileId });
    },
  };
}

export function createCommands(apps, context) {
  const state = apps.explorer;
  const setFolder = id => { state.folderId = id; state.selectedId = null; state.search = ''; state.ui.menu = null; };
  const commands = {
    'win11.explorer.navigate': async ({ folderId }) => {
      if (folderId !== 'trash' && !folder(apps, folderId)) return stale('Folder no longer exists.');
      const opened = await context.invoke('app.open', { appId: 'explorer' }, {});
      if (opened.status !== 'applied') return opened;
      if (folderId !== 'trash' && !folder(apps, folderId)) return stale('Folder no longer exists.');
      setFolder(folderId);
      state.history = [...state.history.slice(0, state.historyIndex + 1), folderId]; state.historyIndex = state.history.length - 1;
      return applied({ folderId });
    },
    'win11.explorer.history': async (_, { direction }) => {
      const index = state.historyIndex + (direction === 'back' ? -1 : 1); const id = state.history[index];
      if (!id || (id !== 'trash' && !folder(apps, id))) return stale('No available history entry.');
      const result = await context.invoke('app.open', { appId: 'explorer' }, {}); if (result.status !== 'applied') return result;
      if (id !== 'trash' && !folder(apps, id)) return stale('History folder no longer exists.');
      setFolder(id); state.historyIndex = index; return applied({ folderId: id });
    },
    'win11.explorer.select': ({ fileId }) => {
      if (!children(apps, state.folderId).some(file => file.id === fileId && file.name.toLowerCase().includes(state.search.toLowerCase()))) return stale('Item is not in the current view.');
      state.selectedId = fileId; return applied({ fileId });
    },
    'win11.explorer.view': (_, { view }) => { state.view = view; state.ui.menu = null; return applied(); },
    'win11.explorer.search': (_, { query }) => { state.search = query; state.selectedId = null; return applied(); },
    ...Object.fromEntries(Object.entries(createFileCommands(apps)).map(([name, handler]) =>
      [name.replace('win11.files.', 'win11.explorer.'), (target, payload) => {
        const result = handler(target, payload);
        if (result.status === 'applied' && ['move', 'trash', 'restore'].includes(name.split('.')[2])) state.selectedId = null;
        return result;
      }])),
    'win11.explorer.properties': ({ fileId }) => {
      const file = apps.files.find(item => item.id === fileId); if (!file || (isTrashed(apps, file) && !file.deleted)) return stale();
      state.ui.dialog = { kind: 'properties', fileId }; state.ui.menu = null; return applied({ fileId });
    },
    'win11.explorer.dialog.open': (_, { kind }) => {
      const selected = kind === 'copy' ? liveFile(apps, state.selectedId) : mutable(apps, state.selectedId);
      if (kind.startsWith('create-') ? !folder(apps, state.folderId) : !selected) return stale('Select a live editable item or folder first.');
      state.ui.dialog = { kind, fileId: selected?.id || null, name: kind === 'create-folder' ? 'New folder' : kind === 'create-text' ? 'New text document.txt' : selected.name, folderId: state.folderId };
      state.ui.menu = null; return applied();
    },
    'win11.explorer.dialog.change': (_, { field, value }) => { const dialog = state.ui.dialog; if (!dialog || dialog.kind === 'properties' || (field === 'folderId' && !['copy', 'move'].includes(dialog.kind))) return stale('No matching dialog field.'); dialog[field] = value; return applied(); },
    'win11.explorer.dialog.commit': async () => {
      const dialog = state.ui.dialog; if (!dialog || dialog.kind === 'properties') return stale('No editable dialog.');
      let result;
      if (dialog.kind.startsWith('create-')) result = await context.invoke('win11.explorer.create', { folderId: dialog.folderId }, { name: dialog.name, kind: dialog.kind === 'create-folder' ? 'folder' : 'text' });
      else result = await context.invoke(`win11.explorer.${dialog.kind}`, { fileId: dialog.fileId }, dialog.kind === 'rename' ? { name: dialog.name } : { name: dialog.name, folderId: dialog.folderId });
      if (result.status === 'applied') state.ui.dialog = null; return result;
    },
    'win11.explorer.dialog.cancel': () => { if (!state.ui.dialog) return stale('No dialog is open.'); state.ui.dialog = null; return applied(); },
  };
  return commands;
}
export function readTargets(apps) {
  const state = apps.explorer;
  return { folderId: state.folderId, selectedId: state.selectedId, view: state.view, search: state.search, folders: apps.files.filter(file => file.kind === 'folder' && !isTrashed(apps, file)).map(file => ({ id: file.id, name: file.name, path: pathOf(apps, file.id) })), items: children(apps, state.folderId).filter(file => file.name.toLowerCase().includes(state.search.toLowerCase())).map(file => ({ id: file.id, name: file.name, kind: file.kind, deleted: file.deleted })), history: [...state.history], historyIndex: state.historyIndex, menu: state.ui.menu, dialog: state.ui.dialog ? { ...state.ui.dialog } : null };
}

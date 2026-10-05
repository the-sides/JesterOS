import { test, expect } from 'bun:test';
import { macDockFolderDefaults, dockFolderItemId, folderSource, macDockFolders, macDockStackItems,
  macDockStackView, reconcileMacDockFolders } from '../frontend/src/mac-dock-folders.js';

const fixture = () => ({ files: [
  { id: 'disk', parentId: null, name: 'Macintosh HD', kind: 'folder' },
  { id: 'downloads', parentId: 'disk', name: 'Downloads', kind: 'folder', icon: 'folder' },
  { id: 'desktop', parentId: 'disk', name: 'Desktop', kind: 'folder' },
  { id: 'trash', parentId: 'disk', name: 'Trash', kind: 'folder' },
  { id: 'a', parentId: 'downloads', name: 'A', kind: 'folder' },
  { id: 'b', parentId: 'a', name: 'B', kind: 'folder' },
  { id: 'nested', parentId: 'b', name: 'nested.pdf', kind: 'document' },
  { id: 'first', parentId: 'downloads', name: 'File 2.pdf', kind: 'document', addedAt: 30, createdAt: 10, modifiedAt: 20 },
  { id: 'second', parentId: 'downloads', name: 'File 10.pdf', kind: 'document', addedAt: 10, createdAt: 30, modifiedAt: 10 },
  { id: 'deleted', parentId: 'downloads', name: 'Deleted.pdf', kind: 'document', deleted: true, addedAt: 100 },
], nextFileId: 1, sceneTime: 100 });
const open = (state, rootFileId = 'downloads', folderId = rootFileId, pathFileIds = [rootFileId]) => {
  state.folderStack = { rootFileId, folderId, pathFileIds, focusedItemId: null, scroll: { top: 0, left: 0 }, overrideView: null };
};
const record = (store, id) => store.files.find(file => file.id === id);
const ids = entries => entries.map(file => file.id);

test('canonical folder aliases exclude alternate Downloads keys, volume, Trash and unavailable ancestors', () => {
  const store = fixture();
  expect(dockFolderItemId('downloads')).toBe('downloads');
  expect(dockFolderItemId('a')).toBe('folder:a');
  for (const key of ['folder:downloads', 'folder:disk', 'folder:trash', 'folder:first', 'a', 'folder:missing']) expect(folderSource(store, key)).toBeNull();
  record(store, 'a').deleted = true;
  expect(folderSource(store, 'folder:b')).toBeNull();
});

test('live membership follows physical children and renamed folders without changing the filesystem', () => {
  const store = fixture(), state = macDockFolderDefaults();
  const original = structuredClone(store);
  let alias = macDockFolders(state, store)[0];
  expect(ids(alias.entries)).toEqual(['first', 'second', 'a']);
  expect(store).toEqual(original);
  record(store, 'first').parentId = 'a';
  record(store, 'downloads').name = 'Incoming';
  alias = macDockFolders(state, store)[0];
  expect(alias.name).toBe('Incoming');
  expect(ids(alias.entries)).toEqual(['second', 'a']);
  record(store, 'disk').deleted = true;
  expect(macDockFolders(state, store)).toEqual([]);
});

test('all date sorts are newest-first with unknown dates last and deterministic natural-name/id ties', () => {
  const store = fixture(), state = macDockFolderDefaults();
  store.files.push({ id: 'equal-z', parentId: 'downloads', name: 'File 2.pdf', kind: 'document', addedAt: 30 },
    { id: 'equal-a', parentId: 'downloads', name: 'file 2.pdf', kind: 'document', addedAt: 30 },
    { id: 'unknown', parentId: 'downloads', name: 'Unknown.pdf', kind: 'document', addedAt: NaN });
  const sorted = sortBy => {
    state.folderPreferences.downloads.sortBy = sortBy;
    return ids(macDockFolders(state, store)[0].entries);
  };
  expect(sorted('date-added')).toEqual(['equal-a', 'equal-z', 'first', 'second', 'a', 'unknown']);
  expect(sorted('date-created')).toEqual(['second', 'first', 'a', 'equal-a', 'equal-z', 'unknown']);
  expect(sorted('date-modified')).toEqual(['first', 'second', 'a', 'equal-a', 'equal-z', 'unknown']);
  expect(sorted('name')).toEqual(['a', 'equal-a', 'equal-z', 'first', 'second', 'unknown']);
});

test('Kind sorting groups native application/folder/image/PDF/text kinds rather than raw record kinds', () => {
  const store = fixture(), state = macDockFolderDefaults();
  store.files.push({ id: 'app', parentId: 'downloads', name: 'Z.app', kind: 'application' },
    { id: 'image', parentId: 'downloads', name: 'Z.png', kind: 'image' },
    { id: 'text', parentId: 'downloads', name: 'A.txt', kind: 'document' });
  state.folderPreferences.downloads.sortBy = 'kind';
  expect(ids(macDockFolders(state, store)[0].entries)).toEqual(['app', 'a', 'image', 'first', 'second', 'text']);
});

test('stack membership and path reconcile actual ancestry after nested folders move inside or outside the root', () => {
  const store = fixture(), state = macDockFolderDefaults();
  open(state, 'downloads', 'b', ['downloads', 'a', 'b']);
  expect(ids(macDockStackItems(state, store))).toEqual(['nested']);
  record(store, 'b').parentId = 'downloads';
  reconcileMacDockFolders(state, store);
  expect(state.folderStack.pathFileIds).toEqual(['downloads', 'b']);
  expect(state.folderStack.folderId).toBe('b');
  record(store, 'b').parentId = 'desktop';
  expect(macDockStackItems(state, store)).toEqual([]);
  reconcileMacDockFolders(state, store);
  expect(state.folderStack.pathFileIds).toEqual(['downloads']);
  expect(state.folderStack.folderId).toBe('downloads');
});

test('deletion settles to the nearest surviving historical ancestor and prunes stale file focus', () => {
  const store = fixture(), state = macDockFolderDefaults();
  open(state, 'downloads', 'b', ['downloads', 'a', 'b']);
  state.folderStack.focusedItemId = 'file:nested';
  state.folderStack.scroll = { top: 40, left: 10 }; state.folderStack.overrideView = 'grid';
  record(store, 'b').deleted = true;
  reconcileMacDockFolders(state, store);
  expect(state.folderStack.folderId).toBe('a');
  expect(state.folderStack.pathFileIds).toEqual(['downloads', 'a']);
  expect(state.folderStack.focusedItemId).toBeNull();
  expect(state.folderStack.scroll).toEqual({ top: 0, left: 0 });
  expect(state.folderStack.overrideView).toBeNull();
  open(state); state.folderStack.focusedItemId = 'file:first';
  record(store, 'first').parentId = 'desktop';
  reconcileMacDockFolders(state, store);
  expect(state.folderStack.focusedItemId).toBeNull();
});

test('root deletion prunes alias/settings and closes descendants without rewriting the filesystem', () => {
  const store = fixture(), state = macDockFolderDefaults();
  state.folderFileIds.push('a', 'a', 'trash', 'disk', 'missing');
  state.folderPreferences.a = { view: 'list', display: 'folder', sortBy: 'kind' };
  state.folderPreferences.missing = { view: 'fan' };
  open(state, 'a', 'b', ['a', 'b']);
  record(store, 'a').deleted = true;
  const original = structuredClone(store);
  reconcileMacDockFolders(state, store);
  expect(state.folderFileIds).toEqual(['downloads']);
  expect(Object.keys(state.folderPreferences)).toEqual(['downloads']);
  expect(state.folderStack).toBeNull();
  expect(store).toEqual(original);
});

test('corrupt cyclic ancestry cannot escape a pinned root or keep a stale nested stack live', () => {
  const store = fixture(), state = macDockFolderDefaults();
  open(state, 'downloads', 'b', ['downloads', 'a', 'b']);
  record(store, 'a').parentId = 'b';
  expect(macDockStackItems(state, store)).toEqual([]);
  reconcileMacDockFolders(state, store);
  expect(state.folderStack.folderId).toBe('downloads');
  expect(state.folderStack.pathFileIds).toEqual(['downloads']);
});

test('automatic fan/grid and temporary More view respond only to actual live immediate membership', () => {
  const store = fixture(), state = macDockFolderDefaults();
  open(state);
  expect(macDockStackView(state, store)).toBe('fan');
  for (let index = 0; index < 5; index++) store.files.push({ id: `extra-${index}`, parentId: 'downloads', name: `Extra ${index}`, kind: 'document' });
  expect(macDockStackItems(state, store)).toHaveLength(8);
  expect(macDockStackView(state, store)).toBe('grid');
  record(store, 'extra-0').deleted = true;
  expect(macDockStackView(state, store)).toBe('fan');
  state.folderStack.overrideView = 'grid';
  expect(macDockStackView(state, store)).toBe('grid');
  expect(state.folderPreferences.downloads.view).toBe('automatic');
});


import { expect, test } from 'bun:test';
import { createFinderEditing } from '../frontend/src/finder-editing.js';
import { createFinderFileCommands } from '../frontend/src/finder-file-commands.js';
import { createDefaultSceneSeed } from '../frontend/src/scene-seed.js';
import { createDefaultApplicationFiles } from '../frontend/src/default-application-files.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createFile } from '../frontend/src/windows11-app-helpers.js';

const clone = value => structuredClone(value);
const textUnits = value => typeof value === 'string' ? value.length : !value || typeof value !== 'object' ? 0
  : Object.keys(value).reduce((total, key) => total + key.length + textUnits(value[key]), 0);
function scene() {
  const seed = createDefaultSceneSeed(getOSProfile('macos-golden-gate-27.0.1'), { createFiles: createDefaultApplicationFiles }), files = seed.files;
  const window = { id: 'finder-window-1', folderId: 'downloads', finderSelectedFileIds: [] };
  const clipboard = { kind: 'empty', text: '', fileIds: [] };
  let desktop = null, capacity = true, active = window.id, changed = 0;
  const ctx = { files, clipboard, available: () => true,
    getWindow: id => active === id && id === window.id ? window : null,
    getDesktopSelection: () => active === null ? desktop : null,
    selectDesktop: ids => { desktop = Array.isArray(ids) ? [...ids] : [ids]; },
    canAddFiles: records => capacity && textUnits(seed) + records.reduce((total, file, index) =>
      total + textUnits(file) + String(files.files.length + index).length, 0) <= 4 * 1024 * 1024,
    onChanged: () => { changed++; } };
  const editing = createFinderEditing(ctx), commands = createFinderFileCommands({ ...ctx, editingHistory: editing });
  function add(parentId, name, kind = 'document', content = '') {
    const file = createFile(files, parentId, name, kind, content);
    Object.assign(file, { appId: kind === 'folder' ? 'finder' : 'textedit', icon: kind === 'folder' ? 'folder' : 'pdf',
      createdAt: files.sceneTime, modifiedAt: files.sceneTime, addedAt: files.sceneTime, lastOpenedAt: null, tags: [] });
    return file;
  }
  return { files, window, clipboard, editing, commands, add,
    setActive: id => { active = id; }, setDesktop: ids => { desktop = ids; }, setCapacity: value => { capacity = value; },
    run: (name, target = { windowId: window.id }, payload = {}) => editing.handlers[name](target, payload),
    snapshot: () => clone({ files, window, clipboard, desktop, changed }) };
}

test('multiple nested roots paste current content into another folder with independent identities and tags', () => {
  const model = scene(), a = model.add('downloads', 'Reports', 'folder'), b = model.add('downloads', 'Other', 'folder');
  const nested = model.add(a.id, 'Nested', 'folder'), child = model.add(nested.id, 'Review.md', 'document', 'Original');
  child.tags = ['Reviewed']; model.add(b.id, 'Other.md', 'document', 'Other body');
  const deleted = model.add(a.id, 'Removed.md'); deleted.deleted = true;
  model.window.finderSelectedFileIds = [a.id, b.id]; model.clipboard.kind = 'text'; model.clipboard.text = 'old';
  expect(model.run('finder.clipboard.copy').target.fileIds).toEqual([a.id, b.id]);
  expect(model.clipboard).toEqual({ kind: 'files', text: '', fileIds: [a.id, b.id] });
  a.name = 'Reports Current'; child.content = 'Current body';
  model.window.folderId = 'desktop'; model.window.finderSelectedFileIds = [];
  const original = clone(model.files), clipboard = clone(model.clipboard), pasted = model.run('finder.clipboard.paste');
  expect(pasted.status).toBe('applied'); expect(pasted.target.fileIds).toHaveLength(2);
  const roots = pasted.target.fileIds.map(id => model.files.files.find(file => file.id === id));
  expect(roots.map(file => file.name)).toEqual(['Reports Current', 'Other']);
  expect(roots.every(file => file.parentId === 'desktop' && file.revision === 1)).toBe(true);
  const copiedNested = model.files.files.find(file => file.parentId === roots[0].id && file.name === 'Nested');
  const copiedChild = model.files.files.find(file => file.parentId === copiedNested.id);
  expect(copiedChild.content).toBe('Current body'); expect(copiedChild.tags).toEqual(['Reviewed']);
  expect(model.files.files.some(file => file.parentId === roots[0].id && file.name === 'Removed.md')).toBe(false);
  copiedChild.content = 'Independent'; copiedChild.tags.push('Copy');
  expect(model.files.files.slice(0, original.files.length)).toEqual(original.files);
  expect(model.clipboard).toEqual(clipboard);
});

test('same-folder paste uses native copy names and cross-folder collisions keep original names when available', () => {
  const model = scene(), file = model.add('downloads', 'Report.md', 'document', 'Original');
  model.window.finderSelectedFileIds = [file.id]; model.run('finder.clipboard.copy');
  const first = model.run('finder.clipboard.paste'), second = model.run('finder.clipboard.paste');
  expect(model.files.files.find(item => item.id === first.target.fileIds[0]).name).toBe('Report copy.md');
  expect(model.files.files.find(item => item.id === second.target.fileIds[0]).name).toBe('Report copy 2.md');
  model.add('desktop', 'REPORT.MD'); model.window.folderId = 'desktop';
  const elsewhere = model.run('finder.clipboard.paste');
  expect(model.files.files.find(item => item.id === elsewhere.target.fileIds[0]).name).toBe('Report copy.md');
  expect(file.name).toBe('Report.md');
});

test('capacity, whole-scene budget, counter, clock and protected subtree rejection are completely atomic', () => {
  for (const failure of ['capacity', 'budget', 'counter', 'clock', 'protected', 'name', 'content']) {
    const model = scene(), folder = model.add('downloads', 'Reports', 'folder');
    const child = model.add(folder.id, 'Body.md', 'document', 'Complete');
    model.window.finderSelectedFileIds = [folder.id]; model.run('finder.clipboard.copy');
    model.window.folderId = 'desktop'; model.window.finderSelectedFileIds = [];
    if (failure === 'capacity') for (let n = 0; n < 1024; n++) model.add('desktop', `Extra ${n}`);
    if (failure === 'budget') model.setCapacity(false);
    if (failure === 'counter') model.files.nextFileId = Number.MAX_SAFE_INTEGER - 1;
    if (failure === 'clock') model.files.sceneTime = 8_640_000_000_000_000 - 1;
    if (failure === 'protected') child.readOnly = true;
    if (failure === 'name') child.name = 'Invalid/name';
    if (failure === 'content') child.content = 'x'.repeat(1024 * 1024 + 1);
    const before = model.snapshot();
    expect(model.run('finder.clipboard.paste').status).toBe('rejected');
    expect(model.snapshot()).toEqual(before);
    expect(model.editing.targets({ windowId: model.window.id }).paste).toBe(false);
  }
});

test('copy rejects a complete protected or unsupported descendant without overwriting text clipboard', () => {
  for (const kind of ['readonly', 'unsupported', 'anchor']) {
    const model = scene(), folder = model.add('downloads', 'Folder', 'folder');
    const child = model.add(folder.id, 'Protected.md');
    if (kind === 'readonly') child.readOnly = true;
    if (kind === 'unsupported') child.kind = 'executable';
    if (kind === 'anchor') child.id = 'applications';
    model.window.finderSelectedFileIds = [folder.id];
    Object.assign(model.clipboard, { kind: 'text', text: 'Retain me', fileIds: [] });
    const before = model.snapshot();
    expect(model.run('finder.clipboard.copy').status).toBe('rejected'); expect(model.snapshot()).toEqual(before);
  }
});

test('missing, deleted and cyclic clipboard sources cannot paste or alter any state', () => {
  for (const failure of ['missing', 'deleted', 'cycle']) {
    const model = scene(), folder = model.add('downloads', 'Folder', 'folder');
    const child = model.add(folder.id, 'Nested', 'folder');
    model.window.finderSelectedFileIds = [folder.id]; model.run('finder.clipboard.copy');
    model.window.folderId = 'desktop'; model.window.finderSelectedFileIds = [];
    if (failure === 'missing') model.files.files = model.files.files.filter(file => file.id !== folder.id);
    if (failure === 'deleted') folder.deleted = true;
    if (failure === 'cycle') folder.parentId = child.id;
    const before = model.snapshot();
    expect(model.run('finder.clipboard.paste').status).toBe('rejected'); expect(model.snapshot()).toEqual(before);
  }
});

test('undo and redo restore exact reserved subtree identities without rewinding clocks or allocators', () => {
  const model = scene(), folder = model.add('downloads', 'Folder', 'folder'), child = model.add(folder.id, 'Body.md', 'document', 'Body');
  const previous = model.add('desktop', 'Previous.md');
  model.window.finderSelectedFileIds = [folder.id]; model.run('finder.clipboard.copy');
  model.window.folderId = 'desktop'; model.window.finderSelectedFileIds = [previous.id];
  const result = model.run('finder.clipboard.paste'), rootId = result.target.fileIds[0];
  const created = clone(model.files.files.filter(file => file.id === rootId || file.parentId === rootId));
  const number = model.files.nextFileId, time = model.files.sceneTime;
  expect(model.editing.targets({ windowId: model.window.id })).toMatchObject({ undo: true, redo: false });
  expect(model.run('finder.edit.undo').status).toBe('applied');
  expect(model.window.finderSelectedFileIds).toEqual([previous.id]);
  expect(model.files.files.some(file => created.some(record => record.id === file.id))).toBe(false);
  expect(model.files.nextFileId).toBe(number); expect(model.files.sceneTime).toBe(time);
  expect(model.editing.targets({ windowId: model.window.id }).redo).toBe(true);
  expect(model.run('finder.edit.redo').status).toBe('applied');
  const restored = model.files.files.filter(file => created.some(record => record.id === file.id));
  const documentData = ({ id, parentId, name, kind, content, tags }) => ({ id, parentId, name, kind, content, tags });
  expect(restored.map(documentData)).toEqual(created.map(documentData));
  for (const file of restored) expect(file.revision).toBeGreaterThan(created.find(record => record.id === file.id).revision);
  expect(model.window.finderSelectedFileIds).toEqual([rootId]);
  expect(model.files.nextFileId).toBe(number); expect(model.files.sceneTime).toBeGreaterThan(time);
  expect(child.content).toBe('Body');
});

test('changed, moved, deleted, renamed or grafted created children cannot be erased by undo', () => {
  for (const mutation of ['content', 'revision', 'rename', 'move', 'delete', 'tags', 'graft', 'deleted-graft']) {
    const model = scene(), folder = model.add('downloads', 'Folder', 'folder');
    model.add(folder.id, 'Body.md', 'document', 'Body');
    model.window.finderSelectedFileIds = [folder.id]; model.run('finder.clipboard.copy');
    model.window.folderId = 'desktop'; const pasted = model.run('finder.clipboard.paste');
    const root = model.files.files.find(file => file.id === pasted.target.fileIds[0]);
    const child = model.files.files.find(file => file.parentId === root.id);
    if (mutation === 'content') child.content = 'Changed';
    if (mutation === 'revision') child.revision++;
    if (mutation === 'rename') child.name = 'Changed.md';
    if (mutation === 'move') child.parentId = 'downloads';
    if (mutation === 'delete') child.deleted = true;
    if (mutation === 'tags') child.tags.push('Changed');
    if (mutation === 'graft' || mutation === 'deleted-graft') {
      const graft = model.add(root.id, 'Unrelated.md'); graft.deleted = mutation === 'deleted-graft';
    }
    const before = model.snapshot();
    expect(model.editing.targets({ windowId: model.window.id }).undo).toBe(false);
    expect(model.run('finder.edit.undo').error.code).toBe('stale_target');
    expect(model.snapshot()).toEqual(before);
  }
});

test('opening observation and navigating another folder preserve global Finder undo without changing that folder selection', () => {
  const model = scene(), file = model.add('downloads', 'Body.md');
  model.window.finderSelectedFileIds = [file.id]; model.run('finder.clipboard.copy');
  const pasted = model.run('finder.clipboard.paste');
  model.files.files.find(item => item.id === pasted.target.fileIds[0]).lastOpenedAt = ++model.files.sceneTime;
  model.window.folderId = 'desktop'; model.window.finderSelectedFileIds = ['personal'];
  expect(model.run('finder.edit.undo').status).toBe('applied');
  expect(model.files.files.some(record => record.id === pasted.target.fileIds[0])).toBe(false);
  expect(model.window.folderId).toBe('desktop'); expect(model.window.finderSelectedFileIds).toEqual(['personal']);
  expect(model.run('finder.edit.redo').status).toBe('applied');
  expect(model.window.finderSelectedFileIds).toEqual(['personal']);
  expect(model.run('finder.edit.undo').status).toBe('applied');
});

test('redo refuses existing identities, case-insensitive name collisions and insufficient restored budget', () => {
  for (const mutation of ['identity', 'name', 'budget', 'destination']) {
    const model = scene(), file = model.add('downloads', 'Body.md');
    model.window.finderSelectedFileIds = [file.id]; model.run('finder.clipboard.copy');
    const pasted = model.run('finder.clipboard.paste'), record = clone(model.files.files.find(item => item.id === pasted.target.fileIds[0]));
    model.run('finder.edit.undo');
    if (mutation === 'identity') model.files.files.push(record);
    if (mutation === 'name') model.add('downloads', 'BODY COPY.MD');
    if (mutation === 'budget') model.setCapacity(false);
    if (mutation === 'destination') model.files.files.find(item => item.id === 'downloads').deleted = true;
    const before = model.snapshot();
    expect(model.run('finder.edit.redo').status).toBe('rejected'); expect(model.snapshot()).toEqual(before);
  }
});

test('genuine New Folder and Duplicate hooks record full transactions and invalidate redo branches', () => {
  const model = scene(), target = { windowId: model.window.id };
  const created = model.commands['finder.folder.create'](target, { name: 'Created' });
  expect(model.run('finder.edit.undo').status).toBe('applied');
  expect(model.run('finder.edit.redo').status).toBe('applied');
  const folder = model.files.files.find(item => item.id === created.target.fileId);
  model.add(folder.id, 'Nested.md', 'document', 'Full duplicate snapshot');
  const duplicated = model.commands['finder.file.duplicate'](target, {});
  const copiedChild = model.files.files.find(item => item.parentId === duplicated.target.fileId);
  expect(model.run('finder.edit.undo').status).toBe('applied');
  expect(model.files.files.some(item => item.id === copiedChild.id)).toBe(false);
  model.commands['finder.folder.create'](target, { name: 'Branch' });
  expect(model.editing.targets(target).redo).toBe(false);
  expect(model.run('finder.edit.redo').error.code).toBe('disabled');
});

test('permanent storage removal cannot resurrect records or block unrelated earlier Undo', () => {
  const model = scene(), target = { windowId: model.window.id };
  const earlier = model.commands['finder.folder.create'](target, { name: 'Kept' });
  const removed = model.commands['finder.folder.create'](target, { name: 'Purged' });
  model.files.files = model.files.files.filter(file => file.id !== removed.target.fileId);
  model.editing.invalidateFiles([removed.target.fileId]);
  expect(model.run('finder.edit.undo').status).toBe('applied');
  expect(model.files.files.some(file => file.id === earlier.target.fileId)).toBe(false);
  expect(model.run('finder.edit.redo').status).toBe('applied');
  expect(model.files.files.some(file => file.id === earlier.target.fileId)).toBe(true);
  expect(model.files.files.some(file => file.id === removed.target.fileId)).toBe(false);
  expect(model.run('finder.edit.redo').error.code).toBe('disabled');
});

test('windowless Desktop copy and multi-root paste use only actual Desktop ownership', () => {
  const model = scene(), first = model.add('desktop', 'First.md'), second = model.add('desktop', 'Second.md');
  const finder = model.add('downloads', 'Finder.md');
  model.window.finderSelectedFileIds = [finder.id]; model.setDesktop([first.id, second.id]);
  const before = model.snapshot();
  expect(model.run('finder.clipboard.copy', {}).status).toBe('rejected'); expect(model.snapshot()).toEqual(before);
  model.setActive(null);
  expect(model.run('finder.clipboard.copy', {}).target).toEqual({ windowId: null, fileIds: [first.id, second.id] });
  const pasted = model.run('finder.clipboard.paste', {});
  expect(pasted.target.windowId).toBe(null); expect(pasted.target.fileIds).toHaveLength(2);
  expect(model.snapshot().desktop).toEqual(pasted.target.fileIds);
  expect(model.window.finderSelectedFileIds).toEqual([finder.id]);
  expect(model.run('finder.edit.undo', {}).status).toBe('applied');
  expect(model.snapshot().desktop).toEqual([first.id, second.id]);
  const after = model.snapshot();
  expect(model.run('finder.clipboard.copy', { windowId: model.window.id }).status).toBe('rejected'); expect(model.snapshot()).toEqual(after);
});

test('strict empty payloads and optional window targets never accept inferred or extra owners', () => {
  const model = scene();
  for (const command of Object.keys(model.editing.handlers)) {
    for (const [target, payload] of [[{ fileId: 'disk' }, {}], [{ windowId: null }, {}], [{}, { extra: true }]]) {
      expect(model.run(command, target, payload).error.code).toBe('invalid_arguments');
    }
  }
});

test('history evicts the oldest creation after 64 transactions without deleting that old record', () => {
  const model = scene(), target = { windowId: model.window.id }, ids = [];
  for (let index = 0; index < 65; index++) {
    ids.push(model.commands['finder.folder.create'](target, { name: `Created ${index}` }).target.fileId);
  }
  const number = model.files.nextFileId, time = model.files.sceneTime;
  for (let index = 0; index < 64; index++) expect(model.run('finder.edit.undo').status).toBe('applied');
  expect(model.run('finder.edit.undo').error.code).toBe('disabled');
  expect(model.files.files.some(file => file.id === ids[0])).toBe(true);
  expect(model.files.files.some(file => ids.slice(1).includes(file.id))).toBe(false);
  expect(model.files.nextFileId).toBe(number); expect(model.files.sceneTime).toBe(time);
});

test('a reopened Finder owner at the retained original location can use retained history', () => {
  const model = scene();
  model.commands['finder.folder.create']({ windowId: model.window.id }, { name: 'Retained' });
  model.setActive(null);
  expect(model.editing.targets({ windowId: model.window.id }).undo).toBe(false);
  model.window.id = 'finder-window-2';
  model.setActive(model.window.id);
  expect(model.editing.targets({ windowId: model.window.id }).undo).toBe(true);
  expect(model.run('finder.edit.undo').status).toBe('applied');
});

test('read-only and cyclic destination ancestry reject atomically before reserving any identity', () => {
  for (const failure of ['readonly', 'cycle']) {
    const model = scene(), file = model.add('downloads', 'Body.md');
    model.window.finderSelectedFileIds = [file.id]; model.run('finder.clipboard.copy');
    const parent = model.add('desktop', 'Destination', 'folder'), child = model.add(parent.id, 'Nested', 'folder');
    if (failure === 'readonly') parent.readOnly = true;
    if (failure === 'cycle') parent.parentId = child.id;
    model.window.folderId = child.id; model.window.finderSelectedFileIds = [];
    const before = model.snapshot();
    expect(model.run('finder.clipboard.paste').status).toBe('rejected'); expect(model.snapshot()).toEqual(before);
  }
});

test('real aggregate UTF-16 scene budget rejects a multi-root paste even when each source fits its individual limit', () => {
  const model = scene(), source = model.add('downloads', 'Large.md', 'document', 'x'.repeat(1024 * 1024));
  model.add('downloads', 'Filler 1.md', 'document', 'y'.repeat(1024 * 1024));
  model.add('downloads', 'Filler 2.md', 'document', 'z'.repeat(1024 * 1024));
  model.window.finderSelectedFileIds = [source.id]; model.run('finder.clipboard.copy');
  model.window.folderId = 'desktop'; model.window.finderSelectedFileIds = [];
  const before = model.snapshot();
  expect(model.run('finder.clipboard.paste').error.code).toBe('limit_exceeded');
  expect(model.snapshot()).toEqual(before);
});

test('eight Mi UTF-16 retained history evicts oldest even when unrelated edits free live scene budget', () => {
  const model = scene(), source = model.add('downloads', 'Large.md', 'document', 'x'.repeat(1024 * 1024));
  model.window.finderSelectedFileIds = [source.id]; model.run('finder.clipboard.copy');
  const copies = [];
  for (let index = 0; index < 8; index++) {
    const result = model.run('finder.clipboard.paste');
    expect(result.status).toBe('applied');
    const copy = model.files.files.find(file => file.id === result.target.fileIds[0]);
    copies.push(copy);
    if (index < 7) copy.content = '';
  }
  for (let index = 7; index >= 1; index--) {
    copies[index].content = source.content;
    expect(model.run('finder.edit.undo').status).toBe('applied');
  }
  copies[0].content = source.content;
  expect(model.run('finder.edit.undo').error.code).toBe('disabled');
  expect(model.files.files.some(file => file.id === copies[0].id)).toBe(true);
});

test('post-commit selection and change notification failures cannot reject a valid data edit', () => {
  const files = createDefaultSceneSeed(getOSProfile('macos-golden-gate-27.0.1'), { createFiles: createDefaultApplicationFiles }).files;
  const source = createFile(files, 'desktop', 'Body.md', 'document', 'Body');
  Object.assign(source, { appId: 'textedit', icon: 'pdf', tags: [] });
  const clipboard = { kind: 'files', text: '', fileIds: [source.id] };
  const engine = createFinderEditing({ files, clipboard, available: () => true, getWindow: () => null,
    getDesktopSelection: () => [source.id], canAddFiles: () => true,
    selectDesktop: () => { throw new Error('Detached Desktop view'); },
    onChanged: () => { throw new Error('Detached menu view'); } });
  const result = engine.handlers['finder.clipboard.paste']({}, {});
  expect(result.status).toBe('applied');
  expect(files.files.find(file => file.id === result.target.fileIds[0])).toMatchObject({ name: 'Body copy.md', content: 'Body' });
});

test('Desktop undo restores valid volume selection but volume copy remains honestly disabled', () => {
  const model = scene(), file = model.add('desktop', 'Body.md');
  model.window.finderSelectedFileIds = [file.id]; model.setActive(null); model.setDesktop([file.id]);
  model.run('finder.clipboard.copy', {});
  model.setDesktop(['disk']);
  expect(model.run('finder.clipboard.copy', {}).error.code).toBe('disabled');
  expect(model.run('finder.clipboard.paste', {}).status).toBe('applied');
  expect(model.run('finder.edit.undo', {}).status).toBe('applied');
  expect(model.snapshot().desktop).toEqual(['disk']);
});

test('copy accepts valid seed records with omitted optional tags and timestamps', () => {
  const model = scene(), file = model.add('downloads', 'Minimal.md', 'document', 'Seed body');
  for (const key of ['tags', 'createdAt', 'modifiedAt', 'addedAt', 'lastOpenedAt']) delete file[key];
  model.window.finderSelectedFileIds = [file.id];
  expect(model.run('finder.clipboard.copy').status).toBe('applied');
  const pasted = model.run('finder.clipboard.paste');
  expect(pasted.status).toBe('applied');
  const copy = model.files.files.find(item => item.id === pasted.target.fileIds[0]);
  expect(copy.content).toBe('Seed body'); expect(copy.id).not.toBe(file.id);
  copy.content = 'Independent'; expect(file.content).toBe('Seed body');
});
test('creation then rename undo rebases its own leases so the earlier creation can still be undone and redone', () => {
  const model = scene(), target = { windowId: model.window.id };
  const created = model.commands['finder.folder.create'](target, { name: 'Original' });
  const folder = model.files.files.find(file => file.id === created.target.fileId), before = model.editing.capture();
  folder.name = 'Renamed'; folder.revision++; folder.modifiedAt = ++model.files.sceneTime;
  model.editing.recordChanged('Rename', before, { windowId: model.window.id, folderId: model.window.folderId, selectionBefore: [folder.id] }, [folder.id]);
  expect(model.run('finder.edit.undo').status).toBe('applied');
  expect(model.files.files.find(file => file.id === folder.id).name).toBe('Original');
  expect(model.run('finder.edit.undo').status).toBe('applied'); expect(model.files.files.some(file => file.id === folder.id)).toBe(false);
  expect(model.run('finder.edit.redo').status).toBe('applied'); expect(model.files.files.find(file => file.id === folder.id).name).toBe('Original');
  expect(model.run('finder.edit.redo').status).toBe('applied'); expect(model.files.files.find(file => file.id === folder.id).name).toBe('Renamed');
});

test('recorded move and trash deltas undo in order without clobbering unrelated files or losing descendants', () => {
  const model = scene(), folder = model.add('downloads', 'Tree', 'folder'), child = model.add(folder.id, 'Child.md', 'document', 'Independent');
  const owner = { windowId: model.window.id, folderId: model.window.folderId, selectionBefore: [folder.id] };
  let before = model.editing.capture(); folder.parentId = 'desktop'; folder.revision++; folder.modifiedAt = ++model.files.sceneTime;
  model.editing.recordChanged('Move', before, owner, [folder.id]);
  before = model.editing.capture(); folder.deleted = child.deleted = true;
  for (const file of [folder, child]) { file.revision++; file.modifiedAt = ++model.files.sceneTime; }
  model.editing.recordChanged('Move to Trash', before, owner, [folder.id]);
  const unrelated = model.add('desktop', 'Unrelated.md', 'document', 'Keep me'), untouched = clone(unrelated);
  expect(model.run('finder.edit.undo').status).toBe('applied');
  expect(model.files.files.find(file => file.id === folder.id)).toMatchObject({ parentId: 'desktop', deleted: false });
  expect(model.files.files.find(file => file.id === child.id)).toMatchObject({ parentId: folder.id, deleted: false, content: 'Independent' });
  expect(model.run('finder.edit.undo').status).toBe('applied');
  expect(model.files.files.find(file => file.id === folder.id).parentId).toBe('downloads');
  expect(model.files.files.find(file => file.id === unrelated.id)).toEqual(untouched);
});
test('read-only application graph identities do not disable unrelated mutable file clipboard and history', () => {
  const model = scene(), source = model.add('downloads', 'Body.md', 'document', 'Real body');
  const protectedFolder = { id: 'mac-application-folder:System/Library', parentId: 'disk', name: 'Library', kind: 'folder',
    appId: 'finder', icon: 'folder', content: '', deleted: false, revision: 1, readOnly: true };
  model.files.files.push(protectedFolder); model.window.finderSelectedFileIds = [source.id];
  expect(model.run('finder.clipboard.copy').status).toBe('applied');
  const pasted = model.run('finder.clipboard.paste'); expect(pasted.status).toBe('applied');
  expect(model.files.files.find(file => file.id === pasted.target.fileIds[0]).content).toBe('Real body');
  expect(model.run('finder.edit.undo').status).toBe('applied');
  expect(model.files.files.find(file => file.id === protectedFolder.id)).toEqual(protectedFolder);
  model.window.folderId = 'disk'; model.window.finderSelectedFileIds = [protectedFolder.id];
  const before = model.snapshot();
  expect(model.run('finder.clipboard.copy').error.code).toBe('disabled'); expect(model.snapshot()).toEqual(before);
});

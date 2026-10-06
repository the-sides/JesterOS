import { expect, test } from 'bun:test';
import { createFinderFileCommands } from '../frontend/src/finder-file-commands.js';
import { createDefaultSceneSeed, validateSceneSeed } from '../frontend/src/scene-seed.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createFile } from '../frontend/src/windows11-app-helpers.js';
import { createMacApplicationFiles } from '../frontend/src/mac-application-files.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');
const clone = value => structuredClone(value);
function scene() {
  const seed = createDefaultSceneSeed(profile), files = seed.files;
  const window = { id: 'finder-window-1', folderId: 'downloads', finderSelectedFileIds: [] };
  let desktop = null, capacity = true;
  const commands = createFinderFileCommands({ files, available: () => true,
    getWindow: id => id === window.id ? window : null,
    canAddFiles: () => capacity, getDesktopSelection: () => desktop,
    selectDesktop: id => { desktop = [id]; } });
  function add(parentId, name, kind = 'document', content = '') {
    const file = createFile(files, parentId, name, kind, content);
    Object.assign(file, { appId: kind === 'folder' ? 'finder' : 'textedit', icon: kind === 'folder' ? 'folder' : 'pdf',
      createdAt: files.sceneTime, modifiedAt: files.sceneTime, addedAt: files.sceneTime, lastOpenedAt: null, tags: [] });
    return file;
  }
  return { seed, files, window, commands, add,
    setDesktop: ids => { desktop = ids; }, setCapacity: value => { capacity = value; },
    run: (name, target = { windowId: window.id }, payload = {}) => commands[name](target, payload),
    snapshot: () => clone({ files, window, desktop }) };
}

test('real readonly bundle identities can be selected and revealed but never duplicated', () => {
  const model = scene();
  model.files.files.push(...createMacApplicationFiles(profile, model.files.sceneTime));
  const bundle = model.files.files.find(file => file.bundleAppId === 'safari');
  model.window.folderId = bundle.parentId;
  expect(model.run('finder.selection.set', undefined, { fileIds: [bundle.id] }).status).toBe('applied');
  expect(model.window.finderSelectedFileIds).toEqual([bundle.id]);
  const before = model.snapshot();
  expect(model.run('finder.file.duplicate').error.code).toBe('disabled');
  expect(model.snapshot()).toEqual(before);
  expect(model.run('finder.selection.set', undefined, { fileIds: ['mac-application:absent'] }).error.code).toBe('stale_target');
  expect(model.window.finderSelectedFileIds).toEqual([bundle.id]);
});

test('Finder creates at its current location and recursive copies are independent complete live subtrees', () => {
  const model = scene();
  const created = model.run('finder.folder.create', undefined, { name: 'Reports.v1' });
  expect(created.status).toBe('applied');
  const source = model.files.files.find(file => file.id === created.target.fileId);
  expect(source.parentId).toBe('downloads');
  const child = model.add(source.id, 'Review.md', 'document', 'Review\nExact source body'); child.tags = ['Reviewed'];
  const subfolder = model.add(source.id, 'Nested', 'folder'), grandchild = model.add(subfolder.id, 'Details.md', 'document', 'Nested content');
  const deleted = model.add(source.id, 'Removed.md', 'document', 'Must not be copied'); deleted.deleted = true;
  const originals = clone([source, child, subfolder, grandchild, deleted]);
  const copied = model.run('finder.file.duplicate');
  expect(copied.status).toBe('applied');
  const root = model.files.files.find(file => file.id === copied.target.fileId);
  expect(root).toMatchObject({ parentId: 'downloads', name: 'Reports.v1 copy', revision: 1 });
  const children = model.files.files.filter(file => file.parentId === root.id);
  expect(children.map(file => file.name).sort()).toEqual(['Nested', 'Review.md']);
  const copiedChild = children.find(file => file.name === child.name), nested = children.find(file => file.kind === 'folder');
  expect(copiedChild.content).toBe(child.content);
  expect(model.files.files.find(file => file.parentId === nested.id).content).toBe(grandchild.content);
  copiedChild.tags.push('Copy only'); copiedChild.content = 'Changed copy';
  expect([source, child, subfolder, grandchild, deleted]).toEqual(originals);
  expect(model.window.finderSelectedFileIds).toEqual([root.id]);
  expect(validateSceneSeed(model.seed, profile)).toEqual({ ok: true });
});

test('a complete protected descendant and a rejected capacity leave every source counter timestamp and selection unchanged', () => {
  const model = scene(), parent = model.add('downloads', 'Protected subtree', 'folder');
  model.add(parent.id, 'Ordinary.md', 'document', 'First copy would have been visible');
  const protectedChild = model.add(parent.id, 'Protected.md', 'document', 'Read-only'); protectedChild.readOnly = true;
  model.window.finderSelectedFileIds = [parent.id];
  let before = model.snapshot();
  expect(model.run('finder.file.duplicate').error.code).toBe('disabled'); expect(model.snapshot()).toEqual(before);
  delete protectedChild.readOnly; model.setCapacity(false); before = model.snapshot();
  expect(model.run('finder.file.duplicate').error.code).toBe('limit_exceeded'); expect(model.snapshot()).toEqual(before);
  expect(model.run('finder.folder.create').error.code).toBe('limit_exceeded'); expect(model.snapshot()).toEqual(before);
});

test('real folder selection cannot borrow Desktop records and collision handling keeps existing children unchanged', () => {
  const model = scene(), local = model.add('downloads', 'Report.md', 'document', 'Current location'), other = model.add('desktop', 'Other.md', 'document', 'Wrong location');
  model.window.finderSelectedFileIds = [local.id]; model.setDesktop([other.id]);
  const before = model.snapshot();
  expect(model.run('finder.selection.set', undefined, { fileIds: [other.id] }).error.code).toBe('stale_target');
  expect(model.snapshot()).toEqual(before);
  expect(model.run('finder.file.duplicate', { windowId: model.window.id, fileId: other.id }).error.code).toBe('stale_target');
  expect(model.snapshot()).toEqual(before);
  const first = model.run('finder.file.duplicate');
  model.window.finderSelectedFileIds = [local.id]; const second = model.run('finder.file.duplicate');
  expect(model.files.files.find(file => file.id === first.target.fileId).name).toBe('Report copy.md');
  expect(model.files.files.find(file => file.id === second.target.fileId).name).toBe('Report copy 2.md');
  expect(local.content).toBe('Current location'); expect(other.content).toBe('Wrong location');
});

test('windowless copy uses real foreground Desktop selection and protected volume cannot consume an ID', () => {
  const model = scene(), file = model.add('desktop', 'Desktop.md', 'document', 'Desktop data');
  model.setDesktop([file.id]);
  const copied = model.run('finder.file.duplicate', {});
  expect(copied).toMatchObject({ status: 'applied', target: { windowId: null } });
  const record = model.files.files.find(item => item.id === copied.target.fileId);
  expect(record).toMatchObject({ parentId: 'desktop', content: 'Desktop data', name: 'Desktop copy.md' });
  model.setDesktop(['disk']); const before = model.snapshot();
  expect(model.run('finder.file.duplicate', {}).error.code).toBe('disabled'); expect(model.snapshot()).toEqual(before);
});

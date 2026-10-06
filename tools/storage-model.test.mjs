import { expect, test } from 'bun:test';
import {
  storageInventory, storageRows, storageViewDefaults, storagePreferencesDefaults, validateStoragePreferences,
  trashStorageFiles, restoreStorageFiles, purgeStorageFiles, setStorageRecommendation, maintainStorage,
  downloadStorageFile,
} from '../frontend/src/storage-model.js';
import { createMacApplicationFiles, applicationBundleId } from '../frontend/src/mac-application-files.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');
const DAY = 86_400_000;
const folder = (id, parentId, fields = {}) => ({ id, name: id, parentId, kind: 'folder', content: '', deleted: false, revision: 1, ...fields });
const document = (id, parentId = 'documents', fields = {}) => ({ id, name: `${id}.txt`, parentId, kind: 'document', content: '', deleted: false, revision: 1, ...fields });
const store = (files = [], sceneTime = 0) => ({ files: [folder('disk', null),
  ...['desktop', 'documents', 'downloads', 'icloud-drive', 'mail-cache', 'trash'].map(id => folder(id, 'disk')), ...files], sceneTime, nextFileId: 1 });
const category = (inventory, id) => inventory.categories.find(item => item.id === id);
const row = (inventory, id) => [...inventory.browserRows, ...category(inventory, 'trash').rows].find(item => item.fileId === id);
const ids = rows => rows.map(item => item.fileId);

test('inventory accounts UTF-8, decoded PDFs, cloud residency and nested payloads once in their real partitions', () => {
  const files = store([folder('nested', 'documents'), document('unicode', 'nested', { content: 'é🙂' }),
    document('pdf', 'nested', { content: 'data:application/pdf;base64,YWI=' }),
    document('remote', 'nested', { content: 'remote', inCloud: true, localResident: false }),
    document('cloud-anchor', 'icloud-drive', { content: 'abc' }), document('mail', 'mail-cache', { content: 'mail' }),
    document('gone', 'documents', { content: 'trash', deleted: true, deletedAt: 0 })]);
  const before = structuredClone(files);
  const inventory = storageInventory(profile, files);
  expect(category(inventory, 'documents').residentBytes).toBe(8);
  expect(category(inventory, 'documents').payloadBytes).toBe(8);
  expect(category(inventory, 'icloud').residentBytes).toBe(3);
  expect(category(inventory, 'icloud').payloadBytes).toBe(9);
  expect(category(inventory, 'mail').residentBytes).toBe(4);
  expect(category(inventory, 'trash').residentBytes).toBe(5);
  expect(row(inventory, 'nested').bytes).toBe(8);
  expect(row(inventory, 'nested').payloadBytes).toBe(14);
  expect(row(inventory, 'unicode').bytes).toBe(6);
  expect(row(inventory, 'pdf').bytes).toBe(2);
  expect(row(inventory, 'remote').bytes).toBe(0);
  expect(row(inventory, 'remote').canDownload).toBe(true);
  expect(ids(category(inventory, 'documents').rows)).not.toContain('remote');
  expect(files).toEqual(before);
});

test('real readonly application bundles exclude System paths without inventing per-bundle bytes or a writable catalog', () => {
  const files = store(createMacApplicationFiles(profile));
  const inventory = storageInventory(profile, files);
  const apps = category(inventory, 'applications');
  const safari = apps.rows.find(item => item.fileId === applicationBundleId('safari'));
  expect(safari.path).toContain('/Applications/Safari.app');
  expect(safari.bytes).toBeNull();
  expect(safari.payloadBytes).toBeNull();
  expect(safari.canDelete).toBe(false);
  expect(apps.rows.some(item => item.fileId === applicationBundleId('mail'))).toBe(false);
  expect(inventory.browserRows.some(item => item.fileId === applicationBundleId('mail'))).toBe(true);
  expect(trashStorageFiles(files, [safari.fileId]).status).toBe('rejected');
});

test('folder Trash, restore and purge preserve identity and content while normalizing ancestor selections', () => {
  const files = store([folder('project', 'documents'), folder('sub', 'project'),
    document('nested', 'sub', { content: 'é🙂', inCloud: true, localResident: false }), document('other')], 100);
  const project = files.files.find(item => item.id === 'project');
  const child = files.files.find(item => item.id === 'nested');
  expect(trashStorageFiles(files, ['nested', 'project']).target.fileIds).toEqual(['project']);
  expect(project.parentId).toBe('documents');
  expect(project.deletedAt).toBe(101);
  expect(child.deleted).toBe(false);
  let inventory = storageInventory(profile, files);
  expect(ids(inventory.browserRows)).not.toContain('nested');
  expect(ids(category(inventory, 'trash').rows)).toEqual(['project', 'sub', 'nested']);
  expect(category(inventory, 'trash').payloadBytes).toBe(6);
  expect(category(inventory, 'trash').residentBytes).toBe(0);
  expect(restoreStorageFiles(files, ['nested']).status).toBe('rejected');
  expect(restoreStorageFiles(files, ['nested', 'project']).status).toBe('applied');
  expect(files.files.find(item => item.id === 'nested')).toBe(child);
  expect(child.content).toBe('é🙂');
  expect(Object.hasOwn(project, 'deletedAt')).toBe(false);
  expect(trashStorageFiles(files, ['project']).status).toBe('applied');
  expect(purgeStorageFiles(files, ['nested', 'project']).target.fileIds).toEqual(['project', 'sub', 'nested']);
  inventory = storageInventory(profile, files);
  expect(ids(category(inventory, 'trash').rows)).toEqual([]);
  expect(files.files.some(item => item.id === 'nested')).toBe(false);
  expect(files.files.some(item => item.id === 'other')).toBe(true);
});

test('invalid batch members and readonly or protected descendants leave every file and the clock untouched', () => {
  const batches = [
    files => trashStorageFiles(files, ['ordinary', 'unknown']),
    files => trashStorageFiles(files, ['ordinary', 'documents']),
    files => trashStorageFiles(files, ['ordinary', 'catalog']),
    files => trashStorageFiles(files, ['ordinary', 'mixed']),
    files => trashStorageFiles(files, ['ordinary', 'ordinary']),
    files => purgeStorageFiles(files, ['removed', 'ordinary']),
    files => purgeStorageFiles(files, ['removed', 'readonly-trash']),
  ];
  for (const action of batches) {
    const files = store([document('ordinary'), document('catalog', 'documents', { readOnly: true }),
      folder('mixed', 'documents'), document('protected-child', 'mixed', { readOnly: true }),
      document('removed', 'documents', { deleted: true, deletedAt: 1 }),
      document('readonly-trash', 'documents', { deleted: true, readOnly: true })], 20);
    const original = structuredClone(files);
    expect(action(files).status).toBe('rejected');
    expect(files).toEqual(original);
  }
});

test('restore plans parent-first regardless of selection order and never overwrites live or batch names', () => {
  const files = store([folder('parent', 'documents', { deleted: true, deletedAt: 10 }),
    document('child', 'parent', { deleted: true, deletedAt: 9, content: 'preserved' })], 20);
  expect(restoreStorageFiles(files, ['child']).status).toBe('rejected');
  expect(restoreStorageFiles(files, ['child', 'parent']).target.fileIds).toEqual(['parent', 'child']);
  expect(ids(category(storageInventory(profile, files), 'documents').rows)).toEqual(['parent', 'child']);
  expect(files.files.find(item => item.id === 'parent').modifiedAt).toBeLessThan(files.files.find(item => item.id === 'child').modifiedAt);
  const failures = [
    [document('old', 'documents', { name: 'Report.txt', deleted: true }), document('new', 'documents', { name: 'report.TXT' })],
    [document('first', 'documents', { name: 'Same.txt', deleted: true }), document('second', 'documents', { name: 'same.txt', deleted: true })],
    [folder('lost', 'absent', { deleted: true })],
    [folder('a', 'b', { deleted: true }), folder('b', 'a', { deleted: true })],
  ];
  for (const records of failures) {
    const broken = store(records, 30), original = structuredClone(broken);
    expect(restoreStorageFiles(broken, records.filter(item => item.deleted).map(item => item.id)).status).toBe('rejected');
    expect(broken).toEqual(original);
  }
});

test('Documents browser preserves hierarchy, dims foreign categories and sorts unknown access times last without mutation', () => {
  const files = store([folder('downloads-sub', 'downloads'), document('download', 'downloads-sub'),
    document('cloud-download', 'downloads', { inCloud: true, localResident: false, content: 'cloud' }),
    document('b', 'documents', { name: 'É🙂.txt', lastOpenedAt: 0 }),
    document('a', 'documents', { name: 'É🙂.txt', lastOpenedAt: 0 }),
    document('unknown', 'documents'), folder('deleted-parent', 'documents', { deleted: true }),
    document('hidden', 'deleted-parent')]);
  const inventory = storageInventory(profile, files), original = structuredClone(inventory);
  const view = storageViewDefaults('documents');
  expect(ids(storageRows(inventory, { ...view, scope: 'downloads' }))).toContain('download');
  expect(ids(storageRows(inventory, { ...view, scope: 'downloads' }))).not.toContain('cloud-download');
  const browser = storageRows(inventory, { ...view, scope: 'file-browser', folderId: 'downloads' });
  const cloud = browser.find(item => item.fileId === 'cloud-download');
  expect(cloud.categoryId).toBe('icloud');
  expect(cloud.readOnly).toBe(true);
  expect(cloud.canDelete).toBe(false);
  expect(browser.find(item => item.fileId === 'downloads-sub').canNavigate).toBe(true);
  expect(storageRows(inventory, { ...view, scope: 'file-browser', folderId: 'deleted-parent' })).toEqual([]);
  for (const direction of ['ascending', 'descending']) {
    const rows = storageRows(inventory, { ...view, scope: 'file-browser', folderId: 'documents', sort: 'last-accessed', direction });
    expect(ids(rows)).toEqual(['a', 'b', 'unknown']);
    expect(rows[0].name).toBe('É🙂.txt');
  }
  expect(inventory).toEqual(original);
  expect(view.selectedFileIds).toEqual([]);
});

test('storage preferences reject accessor and foreign arguments without invoking them or partially changing state', () => {
  let reads = 0;
  const accessor = { optimizeStorage: false, emptyTrashAutomatically: false };
  Object.defineProperty(accessor, 'storeInCloud', { enumerable: true, get() { reads++; return false; } });
  expect(validateStoragePreferences(accessor).ok).toBe(false);
  expect(reads).toBe(0);
  for (const input of [null, [], { ...storagePreferencesDefaults(), extra: false }, { ...storagePreferencesDefaults(), storeInCloud: 1 }])
    expect(validateStoragePreferences(input).ok).toBe(false);
  const files = store([document('old', 'documents', { content: 'old', createdAt: 0 })], 31 * DAY);
  const preferences = storagePreferencesDefaults(), original = structuredClone(files);
  expect(setStorageRecommendation(files, preferences, 'unknown', true).status).toBe('rejected');
  expect(setStorageRecommendation(files, preferences, 'storeInCloud', 1).status).toBe('rejected');
  expect(setStorageRecommendation(files, accessor, 'storeInCloud', true).status).toBe('rejected');
  expect(reads).toBe(0);
  expect(files).toEqual(original);
  expect(preferences.storeInCloud).toBe(false);
});

test('real cloud and Mail maintenance preserves payloads, recent accesses and unknown ages while reducing local allocation', () => {
  const files = store([document('old', 'documents', { content: 'é🙂', createdAt: 0 }),
    document('recent', 'desktop', { content: 'recent', createdAt: 0, lastOpenedAt: 30 * DAY }),
    document('unknown', 'icloud-drive', { content: 'unknown' }),
    document('readonly', 'documents', { content: 'fixed', createdAt: 0, readOnly: true }),
    document('mail-old', 'mail-cache', { content: 'mail payload', createdAt: 0 })], 31 * DAY);
  const preferences = storagePreferencesDefaults(), old = files.files.find(item => item.id === 'old');
  expect(setStorageRecommendation(files, preferences, 'storeInCloud', true).target.changedFileIds).toEqual(['old', 'recent', 'unknown']);
  expect(old.inCloud).toBe(true);
  expect(old.localResident).toBe(false);
  expect(old.content).toBe('é🙂');
  expect(files.files.find(item => item.id === 'old')).toBe(old);
  expect(files.files.find(item => item.id === 'recent').localResident).not.toBe(false);
  expect(files.files.find(item => item.id === 'unknown').localResident).not.toBe(false);
  expect(files.files.find(item => item.id === 'readonly').inCloud).toBeUndefined();
  expect(setStorageRecommendation(files, preferences, 'optimizeStorage', true).target.changedFileIds).toEqual(['mail-old']);
  const inventory = storageInventory(profile, files);
  expect(category(inventory, 'icloud').residentBytes).toBe(13);
  expect(category(inventory, 'icloud').payloadBytes).toBe(19);
  expect(category(inventory, 'mail').residentBytes).toBe(0);
  expect(category(inventory, 'mail').payloadBytes).toBe(12);
  const clock = files.sceneTime;
  expect(maintainStorage(files, preferences)).toEqual({ changedFileIds: [], removedFileIds: [] });
  expect(files.sceneTime).toBe(clock);
  expect(setStorageRecommendation(files, preferences, 'storeInCloud', false).target.changedFileIds).toEqual([]);
  expect(old.localResident).toBe(false);
});

test('download restores actual residency and activity; the exact thirty-day boundary cannot immediately re-evict it', () => {
  const files = store([document('payload', 'documents', { content: 'retained', createdAt: 0 })], 31 * DAY);
  const preferences = storagePreferencesDefaults(), payload = files.files.find(item => item.id === 'payload');
  expect(setStorageRecommendation(files, preferences, 'storeInCloud', true).status).toBe('applied');
  const revision = payload.revision;
  expect(downloadStorageFile(files, 'payload').target).toEqual({ fileId: 'payload', localResident: true });
  expect(payload.revision).toBe(revision + 1);
  expect(payload.lastOpenedAt).toBe(files.sceneTime);
  expect(payload.content).toBe('retained');
  expect(downloadStorageFile(files, 'payload').status).toBe('rejected');
  expect(downloadStorageFile(files, 'missing').status).toBe('rejected');
  expect(downloadStorageFile(files, 'documents').status).toBe('rejected');
  expect(maintainStorage(files, preferences).changedFileIds).toEqual([]);
  files.sceneTime = payload.lastOpenedAt + 30 * DAY;
  expect(maintainStorage(files, preferences).changedFileIds).toEqual([]);
  files.sceneTime++;
  expect(maintainStorage(files, preferences).changedFileIds).toEqual(['payload']);
  expect(payload.localResident).toBe(false);
  expect(payload.content).toBe('retained');
});

test('automatic Trash expiry uses strictly more than thirty scene days, removes descendants, and never dates unknown tombstones', () => {
  const files = store([folder('expired', 'documents', { deleted: true, deletedAt: 0 }),
    document('descendant', 'expired', { content: 'payload' }),
    document('unknown-date', 'documents', { deleted: true, content: 'keep' }),
    document('future-date', 'documents', { deleted: true, deletedAt: 31 * DAY, content: 'future' }),
    document('readonly-date', 'documents', { deleted: true, deletedAt: 0, readOnly: true })], 30 * DAY);
  const preferences = storagePreferencesDefaults();
  expect(setStorageRecommendation(files, preferences, 'emptyTrashAutomatically', true).target.removedFileIds).toEqual([]);
  expect(files.sceneTime).toBe(30 * DAY);
  files.sceneTime++;
  expect(maintainStorage(files, preferences)).toEqual({ changedFileIds: [], removedFileIds: ['expired', 'descendant'] });
  expect(files.files.some(item => item.id === 'descendant')).toBe(false);
  expect(files.files.find(item => item.id === 'unknown-date').deletedAt).toBeUndefined();
  expect(files.files.some(item => item.id === 'future-date')).toBe(true);
  expect(files.files.some(item => item.id === 'readonly-date')).toBe(true);
  expect(category(storageInventory(profile, files), 'trash').residentBytes).toBe(10);
});

test('restore validates newly exposed descendants as a single collision-safe transaction', () => {
  const files = store([folder('parent', 'documents', { deleted: true, deletedAt: 1 }),
    document('one', 'parent', { name: 'Notes.txt', content: 'first' }),
    document('two', 'parent', { name: 'notes.TXT', content: 'second' }),
    document('independent', 'documents', { deleted: true, deletedAt: 2 })], 20);
  const original = structuredClone(files);
  expect(restoreStorageFiles(files, ['independent', 'parent']).status).toBe('rejected');
  expect(files).toEqual(original);
});

test('purging an implicitly trashed subtree removes just those actual descendants and preserves other tombstones', () => {
  const files = store([folder('outer', 'documents', { deleted: true, deletedAt: 0 }),
    folder('inner', 'outer'), document('child', 'inner', { content: 'payload' }),
    document('sibling', 'outer', { content: 'keep' })], 10);
  expect(purgeStorageFiles(files, ['inner']).target.fileIds).toEqual(['inner', 'child']);
  expect(ids(category(storageInventory(profile, files), 'trash').rows)).toEqual(['outer', 'sibling']);
  expect(files.files.find(item => item.id === 'outer').deletedAt).toBe(0);
});

test('clock and revision limits reject a whole mutation or recommendation before changing its first member', () => {
  const files = store([document('one'), document('two')], 8_640_000_000_000_000 - 2);
  let original = structuredClone(files);
  expect(trashStorageFiles(files, ['one', 'two']).status).toBe('rejected');
  expect(files).toEqual(original);
  files.sceneTime = 31 * DAY;
  files.files.find(item => item.id === 'one').createdAt = 0;
  files.files.find(item => item.id === 'two').createdAt = 0;
  files.files.find(item => item.id === 'two').revision = Number.MAX_SAFE_INTEGER - 1;
  original = structuredClone(files);
  const preferences = storagePreferencesDefaults();
  expect(setStorageRecommendation(files, preferences, 'storeInCloud', true).status).toBe('rejected');
  expect(files).toEqual(original);
  expect(preferences.storeInCloud).toBe(false);
});

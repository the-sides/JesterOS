import test from 'node:test';
import assert from 'node:assert/strict';
import { createFilesystemTransactions, validateFilesystemStore, filesystemFileAssociation } from '../frontend/src/filesystem-transactions.js';
import { canonicalStringUnits } from '../frontend/src/canonical-data.js';

const folder = (id, parentId, name) => ({ id, parentId, name, kind: 'folder', content: '', deleted: false, revision: 1 });
function fixture(windows = false) {
  const root = windows ? 'root' : 'disk', profile = { id: windows ? 'windows11-23h2-22631.2428' : 'macos-mojave-10.14', family: windows ? 'windows' : 'macos' };
  const store = { files: [folder(root, null, windows ? 'C:' : 'Macintosh HD'), folder('documents', root, 'Documents')], nextFileId: 1, sceneTime: 1000 };
  const actor = { history: [] }; let time = 1000, pending = 0, limit = Infinity, currentStore = store, records = 0;
  const units = () => canonicalStringUnits({ store, actor });
  const ctx = { profile, getStore: () => currentStore, alive: () => true, getSceneTime: () => time,
    canCommit: delta => units() + pending + delta <= limit,
    reserve: (delta, commit) => { pending += delta; try { return commit(); } finally { pending -= delta; } },
    makeRecord: record => { records++; return record; } };
  const api = createFilesystemTransactions(ctx), write = (name = 'a.txt', content = 'actual contents') => ({ type: 'write', parentId: 'documents', name, content, mime: 'text/plain' });
  return { store, actor, ctx, api, write, units, setLimit: value => { limit = value; }, setTime: value => { time = value; }, replace: value => { currentStore = value; }, records: () => records };
}
const owner = { guard: () => true };

test('mkdir plus referenced write publishes actual shared IDs and preserves collection identities', () => {
  const f = fixture(), rows = f.store.files, documents = rows[1]; let callbackFile;
  const result = f.api.mutateFiles({ operations: [{ type: 'mkdir', parentId: 'documents', name: 'Working', ref: 'working' }, { ...f.write(), parentId: '$working' }], onCommit: (results, metadata) => {
    callbackFile = results[1].file; assert.equal(f.store.files.length, 2); assert.equal(metadata[1].parentId, results[0].fileId); assert.ok(Object.isFrozen(metadata)); assert.ok(Object.isFrozen(metadata[1])); return true;
  } }, owner);
  assert.equal(result.status, 'applied'); assert.equal(f.store.files, rows); assert.equal(f.store.files[1], documents);
  assert.equal(f.api.getFile(result.results[1].fileId), callbackFile); assert.equal(callbackFile.content, 'actual contents'); assert.equal(f.store.nextFileId, 3);
});

test('full authored MIME parameters survive writes and validation without changing application association', () => {
  for (const windows of [false, true]) {
    const f = fixture(windows);
    const mime = 'Text/Plain; charset="utf-8"; format=flowed';
    const result = f.api.mutateFiles({ operations: [{ ...f.write('Unicode.txt', 'Café 東京\n'), mime, encoding: 'utf8' }] }, owner);
    assert.equal(result.status, 'applied');
    const file = result.results[0].file;
    assert.equal(file.mime, mime);
    assert.equal(file.content, 'Café 東京\n');
    assert.equal(file.appId, windows ? 'notepad' : 'textedit');
    assert.deepEqual(validateFilesystemStore(f.store, f.ctx.profile), { ok: true });
    assert.deepEqual(filesystemFileAssociation('Application/PDF; title="Café"', f.ctx.profile), { appId: windows ? 'edge' : 'preview', icon: 'pdf' });
    const before = structuredClone(f.store);
    for (const invalid of ['text/plain; charset=', 'text/plain\r\nX: injected', 'text/plain; charset="unterminated']) {
      assert.equal(f.api.mutateFiles({ operations: [{ type: 'write', fileId: file.id, content: 'bad', mime: invalid }] }, owner).status, 'rejected');
      assert.deepEqual(f.store, before);
    }
  }
});

test('genuine source MIME associations follow the actual File on creation and replacement', () => {
  for (const windows of [false, true]) {
    const f = fixture(windows), suffix = windows ? '-local' : '';
    const source = f.api.mutateFiles({ operations: [{ ...f.write('Empty.zip', 'data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA=='), mime: 'application/zip' }] }, owner);
    assert.equal(source.status, 'applied'); const file = source.results[0].file;
    assert.equal(file.appId, 'archive-utility' + suffix);
    const rewritten = f.api.mutateFiles({ operations: [{ type: 'write', fileId: file.id, name: 'Source.applescript', content: 'return 42', mime: 'text/x-applescript', expectedRevision: 1 }] }, owner);
    assert.equal(rewritten.status, 'applied'); assert.equal(rewritten.results[0].file, file); assert.equal(file.appId, 'scripteditor' + suffix);
    const plain = f.api.mutateFiles({ operations: [{ type: 'write', fileId: file.id, name: 'Actual.txt', content: 'actual text', mime: 'text/plain' }] }, owner);
    assert.equal(plain.status, 'applied'); assert.equal(file.appId, windows ? 'notepad' : 'textedit');
    for (const mime of ['application/x-iso9660-image', 'application/x-vhd']) {
      assert.deepEqual(filesystemFileAssociation(mime, f.ctx.profile), { appId: 'diskutility' + suffix, icon: 'diskutility' });
    }
    const associations = [
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'word'],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'excel'],
      ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'powerpoint'],
      ['application/epub+zip', windows ? 'fictional-books' : 'books'],
      ['application/x-chess-pgn', 'chess' + suffix], ['application/x-chess-fen', 'chess' + suffix],
      ['audio/wav', windows ? 'media-player' : 'quicktime'], ['video/webm', windows ? 'media-player' : 'quicktime'],
      ['application/x-pem-file', 'keychain'], ['application/pkix-cert', 'keychain'],
      ['application/vnd.iccprofile', 'colorsync'], ['application/iccprofile', 'colorsync'],
      ['font/ttf', 'fontbook'], ['font/otf', 'fontbook'], ['font/woff2', 'fontbook'],
    ];
    for (const [mime, appId] of associations) assert.equal(filesystemFileAssociation(mime, f.ctx.profile).appId, appId);
  }
});

test('existing callback sees original fields while immutable metadata describes the eventual revision', () => {
  const f = fixture(), created = f.api.mutateFiles({ operations: [f.write()] }, owner), file = created.results[0].file, tags = file.tags;
  const result = f.api.mutateFiles({ operations: [{ type: 'write', fileId: file.id, expectedRevision: 1, content: 'changed', mime: 'text/plain' }], onCommit: (results, metadata) => {
    assert.equal(results[0].file, file); assert.equal(file.content, 'actual contents'); assert.equal(file.revision, 1); assert.equal(metadata[0].content, 'changed'); assert.equal(metadata[0].revision, 2); return true;
  } }, owner);
  assert.equal(result.status, 'applied'); assert.equal(f.api.getFile(file.id), file); assert.equal(file.content, 'changed'); assert.equal(file.revision, 2); assert.equal(file.tags, tags);
});

test('an actor can retire its original lease inside a successful paired callback', () => {
  const f = fixture(); let generation = 0;
  const result = f.api.mutateFiles({ operations: [f.write()], onCommit: () => { f.actor.history.push('saved'); generation++; return true; } }, { guard: () => generation === 0 });
  assert.equal(result.status, 'applied'); assert.deepEqual(f.actor.history, ['saved']); assert.equal(f.api.getFile(result.results[0].fileId).content, 'actual contents');
});

test('an acknowledged actor clock advance is retained without replaying its retired ownership guard', () => {
  const f = fixture(); let generation = 0;
  const result = f.api.mutateFiles({ operations: [f.write()], onCommit: () => {
    f.setTime(1010); f.store.sceneTime = 1010; generation++; return true;
  } }, { guard: () => generation === 0 });
  assert.equal(result.status, 'applied'); assert.equal(f.store.sceneTime, 1010);
  assert.equal(result.results[0].file.createdAt, 1000);
});

for (const callback of [() => false, () => { throw new Error('refused'); }, () => Promise.resolve(true), () => 1]) test(`non-strict synchronous acceptance (${callback.toString()}) leaves Files and counter unchanged`, () => {
  const f = fixture(), before = structuredClone(f.store);
  assert.equal(f.api.mutateFiles({ operations: [f.write()], onCommit: callback }, owner).status, 'rejected'); assert.deepEqual(f.store, before);
});

test('late collision rejects all staged operations without an orphan or counter increment', () => {
  const f = fixture(), before = structuredClone(f.store);
  const result = f.api.mutateFiles({ operations: [f.write('New.txt'), f.write('NEW.TXT')] }, owner);
  assert.equal(result.status, 'rejected'); assert.equal(result.error.code, 'name_collision'); assert.deepEqual(f.store, before);
});

test('Files-only reservation lets actor budget see the complete paired graph', () => {
  const f = fixture(), before = structuredClone(f.store), original = f.units(), text = 'h'.repeat(400);
  f.setLimit(original + 500);
  let attempted = false;
  const result = f.api.mutateFiles({ operations: [f.write()], onCommit: () => {
    attempted = true; const delta = canonicalStringUnits({ history: [text] }) - canonicalStringUnits(f.actor);
    if (!f.ctx.canCommit(delta)) return false; f.actor.history.push(text); return true;
  } }, owner);
  assert.equal(attempted, true); assert.equal(result.status, 'rejected'); assert.deepEqual(f.store, before); assert.deepEqual(f.actor.history, []);
});

test('signed actor retirement can pay for a real Files payload without premature publication', () => {
  const f = fixture(), text = 'h'.repeat(600); f.actor.history.push(text); f.setLimit(f.units());
  const delta = canonicalStringUnits({ history: [] }) - canonicalStringUnits(f.actor);
  const result = f.api.mutateFiles({ operations: [f.write()], reserveTextUnits: delta, onCommit: () => {
    if (!f.ctx.canCommit(delta)) return false; f.actor.history.splice(0); return true;
  } }, owner);
  assert.equal(result.status, 'applied'); assert.deepEqual(f.actor.history, []); assert.equal(f.store.files.length, 3);
});

test('same-ID source replacement during budget preflight is not accepted as the original File', () => {
  const f = fixture(); f.api.mutateFiles({ operations: [f.write()] }, owner); const original = f.store.files[2];
  f.ctx.canCommit = () => { f.store.files[2] = { ...original }; return true; };
  const result = f.api.mutateFiles({ operations: [{ type: 'rename', fileId: original.id, name: 'renamed.txt' }] }, owner);
  assert.equal(result.status, 'rejected'); assert.equal(result.error.code, 'stale_target'); assert.equal(original.name, 'a.txt'); assert.equal(f.store.files[2].name, 'a.txt');
});

test('clock movement and Files root replacement independently retire the source lease', () => {
  for (const mutate of [f => f.setTime(1001), f => f.replace(structuredClone(f.store))]) {
    const f = fixture(), before = structuredClone(f.store); f.ctx.canCommit = () => { mutate(f); return true; };
    assert.equal(f.api.mutateFiles({ operations: [f.write()] }, owner).error.code, 'stale_target'); assert.deepEqual(f.store, before);
  }
});

test('nested Files calls during callbacks reject without compromising the outer commit', () => {
  const f = fixture(); let nested;
  const result = f.api.mutateFiles({ operations: [f.write('outer.txt')], onCommit: () => { nested = f.api.mutateFiles({ operations: [f.write('inner.txt')] }, owner); return true; } }, owner);
  assert.equal(nested.error.code, 'reentrant_transaction'); assert.equal(result.status, 'applied'); assert.equal(f.store.files.length, 3); assert.equal(f.store.files[2].name, 'outer.txt');
});

test('copying a nonempty directory is recursive and receives fresh stable identities', () => {
  const f = fixture(); const created = f.api.mutateFiles({ operations: [{ type: 'mkdir', parentId: 'documents', name: 'Source', ref: 'dir' }, { ...f.write(), parentId: '$dir' }] }, owner), source = created.results[0].file;
  const noRecursive = f.api.mutateFiles({ operations: [{ type: 'copy', fileId: source.id, parentId: 'documents', name: 'Copy' }] }, owner);
  assert.equal(noRecursive.error.code, 'is_directory');
  const copied = f.api.mutateFiles({ operations: [{ type: 'copy', fileId: source.id, parentId: 'documents', name: 'Copy', recursive: true }] }, owner);
  assert.equal(copied.status, 'applied'); assert.equal(copied.results[0].fileIds.length, 2);
  const child = f.store.files.find(file => file.parentId === copied.results[0].fileId); assert.notEqual(child.id, created.results[1].fileId); assert.equal(child.content, created.results[1].file.content);
  assert.equal(f.api.mutateFiles({ operations: [{ type: 'move', fileId: source.id, parentId: source.id }] }, owner).error.code, 'cyclic_move');
});

test('trash hides descendants and recursive remove retires references with final deleted metadata', () => {
  const f = fixture(), created = f.api.mutateFiles({ operations: [{ type: 'mkdir', parentId: 'documents', name: 'Folder', ref: 'dir' }, { ...f.write(), parentId: '$dir' }] }, owner);
  const child = created.results[1].file;
  assert.equal(f.api.mutateFiles({ operations: [{ type: 'remove', fileId: created.results[0].fileId }] }, owner).error.code, 'directory_not_empty');
  const removed = f.api.mutateFiles({ operations: [{ type: 'remove', fileId: created.results[0].fileId, recursive: true }] }, owner);
  assert.equal(removed.status, 'applied'); assert.equal(child.deleted, true); assert.equal(f.api.getFile(child.id), null); assert.equal(f.store.files.length, 2);
  const next = f.api.mutateFiles({ operations: [{ type: 'mkdir', parentId: 'documents', name: 'Other', ref: 'dir' }, { ...f.write(), parentId: '$dir' }] }, owner);
  f.api.mutateFiles({ operations: [{ type: 'trash', fileId: next.results[0].fileId }] }, owner);
  assert.equal(f.api.getFile(next.results[1].fileId), null); assert.equal(next.results[1].file.deleted, true);
  const emptied = f.api.mutateFiles({ operations: [{ type: 'remove', fileId: next.results[0].fileId, recursive: true }] }, owner);
  assert.equal(emptied.status, 'applied'); assert.equal(f.store.files.length, 2);
});

test('authoritative volume mount metadata controls live reads and descendant writes', () => {
  const f = fixture(), volume = f.api.mutateFiles({ operations: [{ type: 'mkdir', parentId: null, name: 'Backup', volumeId: 'backup-volume', mounted: true, ref: 'volume' }, { ...f.write(), parentId: '$volume' }] }, owner);
  const root = volume.results[0].file, payload = volume.results[1].file;
  assert.equal(f.api.mutateFiles({ operations: [{ type: 'volume', fileId: root.id, mounted: false, expectedRevision: 1 }] }, owner).status, 'applied');
  assert.equal(f.api.getFile(root.id), null); assert.equal(f.api.getFile(payload.id), null); assert.equal(f.api.getFilesStore().files.find(file => file.id === root.id), root);
  assert.equal(f.api.mutateFiles({ operations: [{ type: 'write', fileId: payload.id, content: 'cannot write', mime: 'text/plain' }] }, owner).error.code, 'not_found');
  assert.equal(f.api.mutateFiles({ operations: [{ type: 'volume', fileId: root.id, mounted: true, name: 'Backup Renamed' }] }, owner).status, 'applied'); assert.equal(f.api.getFile(payload.id), payload); assert.equal(root.name, 'Backup Renamed');
});

test('Windows root drive syntax stays native and reserved device names remain invalid payloads', () => {
  const f = fixture(true); assert.equal(validateFilesystemStore(f.store, f.ctx.profile).ok, true);
  assert.equal(f.api.mutateFiles({ operations: [f.write('NUL.txt')] }, owner).error.code, 'invalid_name');
  assert.equal(f.api.mutateFiles({ operations: [f.write('Useful.txt')] }, owner).status, 'applied');
});

test('POSIX dotfiles are genuine writable entries, while dot paths and prototype aliases cannot be names or refs', () => {
  const f = fixture(); assert.equal(f.api.mutateFiles({ operations: [f.write('.profile')] }, owner).status, 'applied');
  assert.equal(f.api.mutateFiles({ operations: [f.write('..')] }, owner).error.code, 'invalid_name');
  assert.equal(f.api.mutateFiles({ operations: [{ type: 'mkdir', parentId: 'documents', name: 'Working', ref: '__proto__' }] }, owner).status, 'rejected');
});

test('sparse arrays, getters, extra fields, corrupt ancestors and stale revisions cannot partially publish', () => {
  const f = fixture(), sparse = []; sparse[1] = f.write();
  const accessor = { type: 'write', parentId: 'documents', name: 'bad.txt', mime: 'text/plain' }; Object.defineProperty(accessor, 'content', { enumerable: true, get() { throw new Error('must not evaluate'); } });
  for (const operations of [sparse, [accessor], [{ ...f.write(), extra: true }], [f.write('a.txt'), { type: 'move', fileId: '$unknown', parentId: 'documents' }]]) {
    const before = structuredClone(f.store); assert.equal(f.api.mutateFiles({ operations }, owner).status, 'rejected'); assert.deepEqual(f.store, before);
  }
  f.api.mutateFiles({ operations: [f.write()] }, owner); const payload = f.store.files[2];
  assert.equal(f.api.mutateFiles({ operations: [{ type: 'rename', fileId: payload.id, name: 'wrong.txt', expectedRevision: 2 }] }, owner).error.code, 'revision_conflict');
  f.store.files[1].parentId = payload.id; assert.equal(validateFilesystemStore(f.store, f.ctx.profile).ok, false);
});

test('per-file byte retention and full file-count budgets reject growth before callbacks', () => {
  const f = fixture(); let called = false;
  assert.equal(f.api.mutateFiles({ operations: [f.write('huge.txt', 'x'.repeat(1024 * 1024 + 1))], onCommit: () => { called = true; return true; } }, owner).status, 'rejected'); assert.equal(called, false);
  f.setLimit(f.units()); assert.equal(f.api.mutateFiles({ operations: [f.write('budget.txt')] }, owner).error.code, 'limit_exceeded'); assert.equal(f.store.nextFileId, 1);
  for (let i = 1; i <= 1022; i++) f.store.files.push({ id: `file-${i}`, parentId: 'documents', name: `file${i}.txt`, kind: 'document', content: '', deleted: false, revision: 1 });
  f.store.nextFileId = 1023; f.setLimit(Infinity); const before = structuredClone(f.store);
  assert.equal(f.api.mutateFiles({ operations: [f.write('overflow.txt')] }, owner).error.code, 'limit_exceeded'); assert.deepEqual(f.store, before);
});

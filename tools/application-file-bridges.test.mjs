import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStringUnits } from '../frontend/src/canonical-data.js';
import { createApplicationFileBridges } from '../frontend/src/application-file-bridges.js';
import { createTextEditContent, textEditPlainText } from '../frontend/src/textedit-content.js';
import { encodeTextEditFile, decodeTextEditFile } from '../frontend/src/textedit-codec.js';
import { documentFileMime } from '../frontend/src/document-destination-commands.js';
import { PREVIEW_IMAGE_CONTENT, PREVIEW_IMAGE_MIME } from '../frontend/src/preview-image-fixture.js';
import { decodePreviewData } from '../frontend/src/preview-codec.js';

function fixture() {
  const store = { files: [{ id: 'documents', parentId: null, name: 'Documents', kind: 'folder', deleted: false }], nextFileId: 1 };
  const clipboard = { kind: 'text', text: 'original clipboard', fileIds: [] }, domain = { history: [] };
  let pending = 0, limit = Infinity;
  const units = () => canonicalStringUnits({ store, clipboard, domain });
  const ctx = {
    profile: { family: 'windows' }, getStore: () => store, getClipboard: () => clipboard,
    alive: () => true, getSceneTime: () => 1000,
    canCommit: delta => units() + pending + delta <= limit,
    reserve: (delta, commit) => { pending += delta; try { return commit(); } finally { pending -= delta; } },
  };
  return { store, clipboard, domain, ctx, units, bridge: createApplicationFileBridges(ctx), setLimit: value => { limit = value; } };
}
const document = { name: 'Actual.txt', mime: 'text/plain', text: 'authored content' };

test('a refused document callback leaves neither a file nor an allocated identity', () => {
  const f = fixture(), before = structuredClone(f.store);
  assert.equal(f.bridge.createFile({ ...document, onCommit: () => false }).status, 'rejected');
  assert.deepEqual(f.store, before);
});

test('Files and domain history share one quota even when each isolated mutation would fit', () => {
  const f = fixture(), before = structuredClone({ store: f.store, domain: f.domain });
  const base = f.units(), history = 'h'.repeat(300);
  const candidate = { files: [...f.store.files, { id: 'file-1', parentId: 'documents', name: document.name,
    kind: 'text', content: document.text, mime: document.mime, deleted: false, revision: 1 }], nextFileId: 2 };
  const fileDelta = canonicalStringUnits(candidate) - canonicalStringUnits(f.store);
  const historyDelta = canonicalStringUnits({ history: [history] }) - canonicalStringUnits(f.domain);
  f.setLimit(base + fileDelta + historyDelta - 1);
  const result = f.bridge.createFile({ ...document, onCommit: () => {
    if (!f.ctx.canCommit(historyDelta)) return false;
    f.domain.history.push(history); return true;
  } });
  assert.equal(result.status, 'rejected');
  assert.deepEqual({ store: f.store, domain: f.domain }, before);
});

test('a save cannot overwrite a same-identity file revision changed during quota preflight', () => {
  const f = fixture();
  const result = f.bridge.createFile(document), file = f.bridge.getFile(result.fileId);
  f.ctx.canCommit = () => { file.content = 'concurrent edit'; file.revision++; return true; };
  const rejected = f.bridge.createFile({ ...document, existingFileId: file.id, expectedRevision: file.revision, text: 'stale replacement' });
  assert.equal(rejected.status, 'rejected');
  assert.equal(file.content, 'concurrent edit');
  assert.equal(file.revision, 2);
});

test('clipboard quota failure leaves the original rich-document cut transaction uncommitted', () => {
  const f = fixture(), before = structuredClone(f.clipboard), removedText = 'original document';
  f.domain.history.push(removedText);
  let documentText = removedText;
  f.setLimit(f.units());
  const result = f.bridge.setClipboard({ kind: 'text', text: 'x'.repeat(300), fileIds: [], onCommit: () => { documentText = ''; return true; } });
  assert.equal(result.status, 'rejected');
  assert.equal(documentText, removedText);
  assert.deepEqual(f.clipboard, before);
});

test('file picking and reading exclude descendants of a trashed folder', () => {
  const f = fixture();
  const result = f.bridge.createFile(document);
  f.store.files[0].deleted = true;
  assert.equal(f.bridge.readFile({ fileId: result.fileId, guard: () => true }).status, 'rejected');
  assert.deepEqual(f.bridge.listFiles({ guard: () => true }).files, []);
});

test('native text encodings retain real MIME parameters and complete content through original Files', () => {
  for (const [encoding, text] of [['utf-8', '\uFEFFOriginal café — 🏔️\n'], ['utf-16le', 'Original café — 🏔️\n'], ['windows-1252', 'Original café — €\n']]) {
    const f = fixture(), encoded = encodeTextEditFile(createTextEditContent(text, 'plain'), encoding);
    const saved = f.bridge.createFile({ name: 'Native original.txt', ...encoded });
    assert.equal(saved.status, 'applied');
    const original = f.bridge.getFile(saved.fileId), read = f.bridge.readFile(saved.fileId);
    assert.equal(read.file, original);
    assert.equal(read.mime, encoded.mime);
    assert.equal(original.encoding, encoding);
    assert.equal(read.text, encoded.text);
    assert.equal(textEditPlainText(decodeTextEditFile({ text: read.text, mime: read.mime }).content), text);
    if (encoding === 'utf-8') assert.deepEqual(new TextEncoder().encode(read.text), new TextEncoder().encode(text));
  }
});

test('bounded media type parameters preserve their exact metadata but malformed parameters never mutate Files', () => {
  const f = fixture(), mime = 'application/vnd.example+json; profile="local; example"; version=1';
  const saved = f.bridge.createFile({ name: 'Parameters.json', mime, text: '{"original":true}\n' });
  assert.equal(saved.status, 'applied');
  assert.equal(f.bridge.readFile(saved.fileId).mime, mime);
  const before = structuredClone(f.store);
  for (const invalid of ['text/plain; charset', 'text/plain; charset=', 'text/plain; =utf-8',
    'text/plain; charset="unterminated', 'text/plain; charset=two words', 'text/plain; charset=utf-8;',
    'text/plain\n', 'text/plain;\ncharset=utf-8', 'text/plain; charset="utf-\u00008"', 'text/plain; charset="utf-\t8"',
    `text/plain; parameter=${'x'.repeat(256)}`]) {
    assert.equal(f.bridge.createFile({ name: 'Rejected.txt', mime: invalid, text: 'No orphan\n' }).error.code, 'invalid_arguments');
    assert.deepEqual(f.store, before);
  }
});

test('explicit plain encoding preserves literal data-like text while legacy raster bytes retain their MIME and identity', () => {
  const f = fixture(), literal = PREVIEW_IMAGE_CONTENT;
  for (const encoding of ['utf8', 'utf-8', 'text']) {
    const file = { id: `literal-${encoding}`, parentId: 'documents', name: 'Actual text', kind: 'text',
      content: literal, encoding, deleted: false, revision: 9 };
    f.store.files.push(file);
    const read = f.bridge.readFile(file.id);
    assert.equal(read.file, file);
    assert.equal(read.text, literal);
    assert.equal(read.mime, 'text/plain');
    assert.equal(documentFileMime(file), 'text/plain');
  }
  const raster = { id: 'legacy-raster', parentId: 'documents', name: 'Original raster', kind: 'text',
    content: PREVIEW_IMAGE_CONTENT, deleted: false, revision: 7 };
  f.store.files.push(raster);
  const before = structuredClone(f.store), read = f.bridge.readFile(raster.id);
  assert.equal(read.file, raster);
  assert.equal(read.mime, PREVIEW_IMAGE_MIME);
  assert.equal(documentFileMime(raster), PREVIEW_IMAGE_MIME);
  assert.deepEqual(decodePreviewData(read.text).bytes, decodePreviewData(PREVIEW_IMAGE_CONTENT).bytes);
  assert.deepEqual(f.store, before);
});

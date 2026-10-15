import { expect, test } from 'bun:test';
import { createTextEditController } from '../frontend/src/textedit-commands.js';
import { createTextEditState, validateTextEditState, textEditDirty, textEditTextUnits } from '../frontend/src/textedit-state.js';
import { createTextEditContent, textEditPlainText } from '../frontend/src/textedit-content.js';
import { encodeTextEditFile } from '../frontend/src/textedit-codec.js';
import { canonicalStringUnits } from '../frontend/src/canonical-data.js';
import { createTextAssistance } from '../frontend/src/text-assistance.js';
import { createApplicationFileBridges } from '../frontend/src/application-file-bridges.js';
import { createWindows11AppState } from '../frontend/src/windows11-app-state.js';
import { createWindows11AppCommands } from '../frontend/src/windows11-app-commands.js';
import { readFile } from 'node:fs/promises';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(profileId = 'windows11-23h2-22631.2428', assistance) {
  const profile = { id: profileId, family: profileId.startsWith('windows') ? 'windows' : 'macos' }, state = createTextEditState(profile), windows = new Map(), views = new Map(), files = new Map();
  let live = true, sequence = 0, fileSequence = 0, focusedWindow = null, clipboard = { kind: 'text', text: '', fileIds: [] };
  const ctx = { profile, getState: () => state, getWindow: id => windows.get(id), getWindows: () => [...windows.values()], getView: id => views.get(id), alive: () => live, available: window => windows.get(window.id) === window && !window.minimized, canCommit: () => true, tick: async () => {}, getSceneTime: () => 1696988520000,
    focusWindow(id, ownership = {}) { if (ownership.isCurrent && !ownership.isCurrent()) return; const window = windows.get(id); if (window) { window.minimized = false; focusedWindow = window; } },
    getFile: id => files.get(id) ?? null,
    async readFile(id, ownership) { if (!ownership.guard()) return { status: 'rejected', error: { code: 'stale_target' } }; const file = files.get(id); return file ? { status: 'applied', file, text: file.content, mime: file.mime, name: file.name } : { status: 'rejected', error: { code: 'stale_target' } }; },
    async createFile(spec, ownership) {
      if (!ownership.guard()) return { status: 'rejected', error: { code: 'stale_target' } };
      const previous = spec.existingFileId && files.get(spec.existingFileId);
      if (spec.existingFileId && (!previous || previous.revision !== spec.expectedRevision)) return { status: 'rejected', error: { code: 'conflict' } };
      const file = { id: previous?.id ?? `file-${++fileSequence}`, name: spec.name, mime: spec.mime, content: spec.text, revision: (previous?.revision ?? 0) + 1 };
      if (spec.onCommit && !spec.onCommit(file.id, file)) return { status: 'rejected', error: { code: 'limit_exceeded' } };
      files.set(file.id, file); return { status: 'applied', fileId: file.id };
    },
    async closeWindow(id, { isCurrent }) { const window = windows.get(id); if (!isCurrent() || controller.windowClosed(window) === false) return { status: 'rejected', error: { code: 'stale_target' } }; windows.delete(id); views.delete(id); return { status: 'applied', windowId: id }; },
    async createWindow(appId, options) { if (!options.isCurrent()) return { status: 'rejected', error: { code: 'stale_target' } }; return add(appId, options); },
    async setWindowAppId(appId, ownership) { if (!ownership.guard() || !ownership.onCommit()) return { status: 'rejected', error: { code: 'stale_target' } }; windows.get(ownership.windowId).appId = appId; return { status: 'applied', windowId: ownership.windowId, appId }; },
    getClipboard: async () => clipboard,
    async setClipboard(spec, ownership) { if (!ownership.guard() || spec.onCommit && !spec.onCommit()) return { status: 'rejected', error: { code: 'stale_target' } }; clipboard = { kind: spec.kind, text: spec.text, fileIds: spec.fileIds }; return { status: 'applied' }; },
  };
  if (assistance) ctx.assistance = assistance;
  const controller = createTextEditController(ctx);
  function add(appId = profile.family === 'windows' ? 'notepad' : 'textedit', options = {}) {
    const window = { id: `window-${++sequence}`, appId };
    windows.set(window.id, window); if (!controller.windowOpened(window, options)) { windows.delete(window.id); throw new Error('Window ownership not installed'); }
    const model = state.windows.find(row => row.windowId === window.id), document = state.documents.find(row => row.id === model.documentId);
    const native = { available: () => ctx.available(window) && state.windows.includes(model) && state.documents.includes(document) && model.documentId === document.id,
      captureSelection: () => model.selection, selectRange: () => true, setSpelling: () => {} };
    views.set(window.id, native); ctx.focusWindow(window.id);
    return window.id;
  }
  const windowId = add(), target = { windowId };
  const doc = (id = windowId) => state.documents.find(doc => doc.id === state.windows.find(win => win.windowId === id)?.documentId);
  const run = (name, payload = {}, destination = target) => controller.handlers[`textedit.${name}`](destination, payload);
  async function input(text, id = windowId) { const source = doc(id), end = text.length; return run('input', { documentId: source.id, generation: source.generation, content: createTextEditContent(text, source.content.kind), start: end, end }, { windowId: id }); }
  return { profile, state, windows, views, files, ctx, controller, target, windowId, doc, run, input, add, retireProfile: () => { live = false; }, clipboard: () => clipboard, focusedWindow: () => focusedWindow };
}

test('all five profile defaults produce closed valid plain/rich document graphs', () => {
  for (const id of ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428']) {
    const value = fixture(id); expect(validateTextEditState(value.state)).toEqual({ ok: true }); expect(value.doc().content.kind).toBe(id.startsWith('windows') ? 'plain' : 'rich');
    expect(textEditTextUnits(value.state)).toBe(canonicalStringUnits(value.state));
  }
});

test('separate real managed windows own independent document histories and save exact files', async () => {
  const value = fixture(); await value.input('first buffer'); const next = await value.run('new', { kind: 'plain' });
  expect(next.status).toBe('applied'); expect(next.target.windowId).not.toBe(value.windowId); await value.input('second buffer', next.target.windowId);
  expect(textEditPlainText(value.doc().content)).toBe('first buffer'); expect(textEditPlainText(value.doc(next.target.windowId).content)).toBe('second buffer');
  const saved = await value.run('saveAs', { name: 'first.txt', encoding: 'utf-8' }); expect(value.files.get(saved.fileId).content).toBe('first buffer'); expect(value.doc().fileRevision).toBe(1); expect(value.doc(next.target.windowId).fileId).toBeNull();
});

test('undo returns exactly to saved content without resurrecting a stale input generation', async () => {
  const value = fixture(); await value.input('saved'); await value.run('saveAs', { name: 'document.txt', encoding: 'utf-8' }); const oldGeneration = value.doc().generation;
  await value.input('edited'); expect(textEditDirty(value.doc())).toBe(true); await value.run('undo');
  expect(textEditPlainText(value.doc().content)).toBe('saved'); expect(textEditDirty(value.doc())).toBe(false); expect(value.doc().generation).toBeGreaterThan(oldGeneration);
  const stale = await value.run('input', { documentId: value.doc().id, generation: oldGeneration, content: createTextEditContent('late', 'plain'), start: 4, end: 4 }); expect(stale.error.code).toBe('stale_target');
  await value.run('redo'); expect(textEditPlainText(value.doc().content)).toBe('edited');
});

test('external file changes reject ordinary save without overwriting either authority', async () => {
  const value = fixture(); await value.input('original'); const saved = await value.run('saveAs', { name: 'exact.txt', encoding: 'utf-8' });
  value.files.get(saved.fileId).revision++; value.files.get(saved.fileId).content = 'external'; await value.input('local');
  const result = await value.run('save'); expect(result.error.code).toBe('conflict'); expect(value.files.get(saved.fileId).content).toBe('external'); expect(textEditPlainText(value.doc().content)).toBe('local'); expect(textEditDirty(value.doc())).toBe(true);
});

test('reused public window ID and replacement facade cannot inherit a pending file read', async () => {
  for (const replacement of ['window', 'view', 'profile']) {
    const value = fixture(), gate = deferred(); value.files.set('shared-file', { id: 'shared-file', name: 'shared.txt', content: 'file text', mime: 'text/plain;charset=utf-8', revision: 1 });
    value.ctx.readFile = async () => { await gate.promise; const file = value.files.get('shared-file'); return { status: 'applied', file, text: file.content, mime: file.mime, name: file.name }; };
    const pending = value.run('open', { fileId: 'shared-file' });
    if (replacement === 'window') value.windows.set(value.windowId, { id: value.windowId, appId: 'notepad' });
    if (replacement === 'view') value.views.set(value.windowId, { available: () => true });
    if (replacement === 'profile') value.retireProfile(); gate.resolve();
    expect((await pending).error.code).toBe('stale_target'); expect(value.state.documents).toHaveLength(1); expect(textEditPlainText(value.doc().content)).toBe('');
  }
});

test('save bridge must atomically return real file revision; missing acknowledgement cannot mark clean', async () => {
  const value = fixture(); await value.input('unsaved'); value.ctx.createFile = async (spec, ownership) => { expect(ownership.guard()).toBe(true); expect(spec.onCommit('new-file')).toBe(false); return { status: 'rejected', error: { code: 'unavailable' } }; };
  expect((await value.run('saveAs', { name: 'missing.txt', encoding: 'utf-8' })).status).toBe('rejected'); expect(textEditDirty(value.doc())).toBe(true); expect(value.doc().fileId).toBeNull();
});

test('native unsaved close, Cancel, first Save sheet and exact file commit resume original close', async () => {
  const value = fixture(); await value.input('keep this'); expect(value.controller.windowClosed(value.windows.get(value.windowId))).toBe(false);
  expect((await value.run('close.resolve', { action: 'cancel' })).closed).toBe(false); expect(value.windows.has(value.windowId)).toBe(true);
  await value.run('close'); const waiting = await value.run('close.resolve', { action: 'save' }); expect(waiting.confirmationRequired).toBe(true);
  const saved = await value.run('save', { name: 'kept.txt', encoding: 'utf-8' }); expect(saved.status).toBe('applied'); expect(saved.closed).toBe(true); expect(value.files.get(saved.fileId).content).toBe('keep this'); expect(value.windows.has(value.windowId)).toBe(false); expect(value.state.documents).toHaveLength(1);
});

test('Discard restores the saved baseline in retained buffer instead of falsely marking edited content saved', async () => {
  const value = fixture(); await value.input('saved baseline'); await value.run('saveAs', { name: 'baseline.txt', encoding: 'utf-8' }); await value.input('throw away'); await value.run('close');
  const result = await value.run('close.resolve', { action: 'discard' }); expect(result.closed).toBe(true); expect(textEditPlainText(value.state.documents[0].content)).toBe('saved baseline'); expect(value.files.get(value.state.documents[0].fileId).content).toBe('saved baseline');
});

test('find uses original Unicode offsets and replace selection does not advance to next match', async () => {
  const value = fixture(); await value.input('İ x CAT cat'); value.state.windows[0].selection = { start: 0, end: 0 };
  const found = await value.run('find', { query: 'cat', replacement: '$&', matchCase: false, direction: 'next' }); expect(found.range).toEqual({ start: 4, end: 7 });
  await value.run('find', { query: 'cat', replacement: '$&', matchCase: false, direction: 'next', select: false }); await value.run('replace', { all: false });
  expect(textEditPlainText(value.doc().content)).toBe('İ x $& cat'); await value.run('undo'); expect(textEditPlainText(value.doc().content)).toBe('İ x CAT cat');
});

test('rich typing marks, table mutation and Windows app-kind conversion change actual canonical semantics', async () => {
  const value = fixture(); const converted = await value.run('convert', { kind: 'rich', confirmed: true }); expect(converted.status).toBe('applied'); expect(value.windows.get(value.windowId).appId).toBe('wordpad');
  expect((await value.run('format', { bold: true, color: '#ff0000' })).status).toBe('applied'); await value.input('rich'); expect(value.doc().content.blocks[0].runs[0].marks.bold).toBe(true); expect(value.doc().content.blocks[0].runs[0].marks.color).toBe('#ff0000');
  await value.run('table', { action: 'insert', rows: 2, columns: 2 }); const table = value.doc().content.blocks.find(block => block.type === 'table'); await value.run('table', { action: 'add-row', blockId: table.id, row: 0 }); expect(value.doc().content.blocks.find(block => block.id === table.id).rows).toHaveLength(3);
  await value.run('undo'); expect(value.doc().content.blocks.find(block => block.id === table.id).rows).toHaveLength(2);
});

test('import cannot create a rich document with orphan canonical Files attachment references', async () => {
  const value = fixture(), content = createTextEditContent('attachment', 'rich'); content.blocks.push({ id: 'attachment-1', type: 'attachment', fileId: 'missing-file', name: 'gone.png', mime: 'image/png' });
  const encoded = encodeTextEditFile(content); value.files.set('source-file', { id: 'source-file', name: 'document.rtf', revision: 1, content: encoded.text, mime: encoded.mime });
  const result = await value.run('open', { fileId: 'source-file' }); expect(result.status).toBe('rejected'); expect(value.state.documents).toHaveLength(1);
});

test('atomic cut rejects stale original selection without mutating clipboard or document', async () => {
  const value = fixture(); await value.input('cut me'); value.state.windows[0].selection = { start: 0, end: 3 }; const gate = deferred();
  value.ctx.setClipboard = async (spec, ownership) => { await gate.promise; return ownership.guard() && spec.onCommit() ? { status: 'applied' } : { status: 'rejected', error: { code: 'stale_target' } }; };
  const pending = value.run('clipboard', { action: 'cut' }); value.state.windows[0].selection = { start: 4, end: 6 }; gate.resolve();
  expect((await pending).status).toBe('rejected'); expect(textEditPlainText(value.doc().content)).toBe('cut me'); expect(value.clipboard().text).toBe('');
});

test('complete candidate budget rejects history growth with no content/undo mutation', async () => {
  const value = fixture(); await value.input('before'); const before = JSON.stringify(value.state); value.ctx.canCommit = delta => delta <= 0;
  const result = await value.input('larger replacement'); expect(result.error.code).toBe('limit_exceeded'); expect(JSON.stringify(value.state)).toBe(before);
});

test('closed validation never executes getters and rejects sparse arrays and malformed history', () => {
  let calls = 0; const state = createTextEditState({ id: 'macos-mojave-10.14' }); Object.defineProperty(state, 'documents', { get() { calls++; return []; }, enumerable: true }); expect(validateTextEditState(state).ok).toBe(false); expect(calls).toBe(0);
  const sparse = createTextEditState({}); sparse.documents = Array(1); expect(validateTextEditState(sparse).ok).toBe(false);
  const value = fixture(); value.doc().undo.push({ content: createTextEditContent('', 'plain'), contentRevision: -1, fileMime: 'text/plain', encoding: 'utf-8' }); expect(validateTextEditState(value.state).ok).toBe(false);
});

test('validated reactive proxies can transition without structuredClone DataCloneError', async () => {
  const value = fixture(), cache = new WeakMap();
  const proxy = object => { if (!object || typeof object !== 'object') return object; if (!cache.has(object)) cache.set(object, new Proxy(object, { get(target, key, receiver) { return proxy(Reflect.get(target, key, receiver)); } })); return cache.get(object); };
  const root = proxy(value.state); value.ctx.getState = () => root;
  // Native managed/view objects remain external stable identities; canonical records are proxy-backed.
  const doc = root.documents[0]; const result = await value.run('input', { documentId: doc.id, generation: doc.generation, content: createTextEditContent('proxy edit', 'plain'), start: 10, end: 10 }); expect(result.status).toBe('applied'); expect(textEditPlainText(root.documents[0].content)).toBe('proxy edit');
});

test('same-ID same-revision replacement Files cannot inherit pending open ownership', async () => {
  const value = fixture(), gate = deferred();
  const original = { id: 'original-file', name: 'original.txt', mime: 'text/plain;charset=utf-8', content: 'old source', revision: 1 }; value.files.set(original.id, original);
  value.ctx.readFile = async () => { await gate.promise; return { status: 'applied', file: original, text: original.content, mime: original.mime, name: original.name }; };
  const pending = value.run('open', { fileId: original.id }); value.files.set(original.id, { ...original, content: 'replacement source' }); gate.resolve();
  expect((await pending).error.code).toBe('stale_target'); expect(value.state.documents).toHaveLength(1);
});

test('save completion remains applied when exact acknowledged source retires immediately afterwards', async () => {
  const value = fixture(); await value.input('committed content');
  const realCreate = value.ctx.createFile;
  value.ctx.createFile = async (spec, ownership) => { const result = await realCreate(spec, ownership); value.windows.delete(value.windowId); value.views.delete(value.windowId); return result; };
  const saved = await value.run('saveAs', { name: 'committed.txt', encoding: 'utf-8' }); expect(saved.status).toBe('applied'); expect(value.files.get(saved.fileId).content).toBe('committed content'); expect(textEditDirty(value.state.documents[0])).toBe(false);
});

test('duplicate retains real rich styles but does not borrow source File ownership or history', async () => {
  const value = fixture(); await value.run('convert', { kind: 'rich', confirmed: true }); await value.run('format', { italic: true }); await value.input('original rich text'); await value.run('saveAs', { name: 'original.rtf', encoding: 'utf-8' });
  const duplicated = await value.run('duplicate'); const copy = value.doc(duplicated.target.windowId);
  expect(copy.content.blocks[0].runs[0].marks.italic).toBe(true); expect(textEditPlainText(copy.content)).toBe('original rich text'); expect(copy.fileId).toBeNull(); expect(copy.undo).toHaveLength(0); expect(textEditDirty(copy)).toBe(true);
  await value.input('different duplicate', duplicated.target.windowId); expect(textEditPlainText(value.doc().content)).toBe('original rich text');
});

test('RTF directives and HTML source preferences open actual File bytes as safe plain documents', async () => {
  const value = fixture(), rich = createTextEditContent('rich source', 'rich');
  const encoded = encodeTextEditFile(rich); value.files.set('rtf-source', { id: 'rtf-source', name: 'source.rtf', revision: 1, content: encoded.text, mime: encoded.mime });
  await value.run('preferences', { displayRtfAsCode: true }); const opened = await value.run('open', { fileId: 'rtf-source' }); const source = value.doc(opened.target.windowId);
  expect(source.content.kind).toBe('plain'); expect(textEditPlainText(source.content)).toStartWith('{\\rtf1'); expect(source.fileMime).toBe('application/rtf');
  value.files.set('html-source', { id: 'html-source', name: 'source.html', revision: 1, mime: 'text/html', content: '<script>never execute</script><img src="https://invalid.example/">' });
  const html = await value.run('open', { fileId: 'html-source' }); expect(textEditPlainText(value.doc(html.target.windowId).content)).toBe(value.files.get('html-source').content); expect(value.doc(html.target.windowId).content.kind).toBe('plain');
  await value.run('preferences', { displayHtmlAsCode: false }); expect((await value.run('open', { fileId: 'html-source' })).error.code).toBe('unsupported_file_type');
});

test('add-TXT extension and Restore Defaults affect real saves/preferences rather than display-only switches', async () => {
  const value = fixture(); await value.input('text');
  const saved = await value.run('saveAs', { name: 'no-extension', encoding: 'utf-8' }); expect(value.files.get(saved.fileId).name).toBe('no-extension.txt');
  await value.run('preferences', { addTxtExtension: false, windowColumns: 120, windowLines: 45, plainSize: 16 });
  const second = await value.run('saveAs', { name: 'literal-name', encoding: 'utf-8' }); expect(value.files.get(second.fileId).name).toBe('literal-name');
  await value.run('preferences', { restoreDefaults: true }); expect(value.state.preferences).toEqual(createTextEditState(value.profile).preferences);
});

test('native GoTo, Delete and TimeDate operate on original Unicode buffer and authored epoch', async () => {
  const value = fixture(); await value.input('first\n😀 second'); const jumped = await value.run('goto', { line: 2 }); expect(jumped.range).toEqual({ start: 6, end: 6 });
  await value.run('delete'); expect(textEditPlainText(value.doc().content)).toBe('first\n second'); await value.run('undo'); expect(textEditPlainText(value.doc().content)).toBe('first\n😀 second');
  value.state.windows[0].selection = { start: 0, end: 0 }; const date = await value.run('timeDate'); expect(date.timeZone).toBe('UTC'); expect(date.text).toBe('01:42 10/11/2023'); expect(textEditPlainText(value.doc().content)).toStartWith(date.text);
});

test('real bundled English nspell suggestions learn and persist without browser spelling or fabricated issues', async () => {
  const assistance = createTextAssistance({ loadDictionary: async () => {
    const [aff, dic] = await Promise.all([readFile(new URL('../frontend/node_modules/dictionary-en/index.aff', import.meta.url), 'utf8'), readFile(new URL('../frontend/node_modules/dictionary-en/index.dic', import.meta.url), 'utf8')]); return { aff, dic };
  } });
  const value = fixture('windows11-23h2-22631.2428', assistance); await value.input('mispeling'); value.state.windows[0].selection = { start: 0, end: 0 };
  const checked = await value.run('spelling', { action: 'check' }); expect(checked.issue.word).toBe('mispeling'); expect(checked.issue.suggestions.length).toBeGreaterThan(0);
  await value.run('spelling', { action: 'learn', word: 'mispeling' }); expect(value.state.personalWords).toContain('mispeling'); value.state.windows[0].selection = { start: 0, end: 0 };
  const learned = await value.run('spelling', { action: 'check' }); expect(learned.issue).toBeNull();
});

test('pending typing format survives a same-high-surrogate emoji replacement without splitting Unicode', async () => {
  const value = fixture(); await value.run('convert', { kind: 'rich', confirmed: true }); await value.input('😀'); value.state.windows[0].selection = { start: 0, end: 0 }; await value.run('format', { bold: true }); await value.input('😃');
  expect(textEditPlainText(value.doc().content)).toBe('😃'); expect(value.doc().content.blocks[0].runs[0].marks.bold).toBe(true);
});

test('conversion undo/redo restores real Windows app identity and historical file encoding', async () => {
  const value = fixture(); await value.input('plain'); await value.run('saveAs', { name: 'source.txt', encoding: 'utf-16le' }); await value.run('convert', { kind: 'rich', confirmed: true });
  expect(value.doc().encoding).toBe('utf-8'); expect(value.windows.get(value.windowId).appId).toBe('wordpad');
  await value.run('undo'); expect(value.doc().content.kind).toBe('plain'); expect(value.doc().encoding).toBe('utf-16le'); expect(value.windows.get(value.windowId).appId).toBe('notepad'); expect(textEditDirty(value.doc())).toBe(false);
  await value.run('redo'); expect(value.doc().content.kind).toBe('rich'); expect(value.windows.get(value.windowId).appId).toBe('wordpad');
});

test('saving a converted document preserves original File rather than writing plain bytes under RTF ownership', async () => {
  const value = fixture(); await value.run('convert', { kind: 'rich', confirmed: true }); await value.input('rich saved'); const original = await value.run('saveAs', { name: 'document.rtf', encoding: 'utf-8' }); const before = { ...value.files.get(original.fileId) };
  await value.run('convert', { kind: 'plain', confirmed: true }); const prompt = await value.run('save'); expect(prompt.confirmationRequired).toBe(true); expect(value.files.get(original.fileId)).toEqual(before);
  const plain = await value.run('saveAs', { name: 'document.txt', encoding: 'utf-8' }); expect(plain.fileId).not.toBe(original.fileId); expect(value.files.get(plain.fileId).mime).toBe('text/plain;charset=utf-8'); expect(value.files.get(original.fileId)).toEqual(before);
});

test('plain display typography becomes genuine rich runs and imported table rows remain editable beyond64', async () => {
  const value = fixture(); await value.run('preferences', { plainFont: 'Consolas', plainSize: 17 }); await value.input('visible plain'); await value.run('convert', { kind: 'rich', confirmed: true });
  expect(value.doc().content.blocks[0].runs[0].marks.font).toBe('Consolas'); expect(value.doc().content.blocks[0].runs[0].marks.size).toBe(17);
  await value.run('table', { action: 'insert', rows: 66, columns: 1 }); const table = value.doc().content.blocks.find(block => block.type === 'table'); await value.run('table', { action: 'delete-row', blockId: table.id, row: 65 }); expect(value.doc().content.blocks.find(block => block.id === table.id).rows).toHaveLength(65);
  await value.run('table', { action: 'add-row', blockId: table.id, row: 64 }); expect(value.doc().content.blocks.find(block => block.id === table.id).rows).toHaveLength(66);
});

test('native file opening decodes genuine shared Files content without an empty intermediary document', async () => {
  for (const profileId of ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428']) {
    const value = fixture(profileId), literal = 'Original Ω\nsecond line 📨';
    const mac = value.profile.family === 'macos';
    const file = { id: 'actual-source', parentId: 'documents', name: 'Source.txt', kind: mac ? 'document' : 'text', appId: mac ? 'textedit' : 'notepad', icon: 'text-file', content: literal, deleted: false, revision: 7 };
    const directory = { kind: 'folder', appId: mac ? 'finder' : 'explorer', icon: 'folder', content: '', deleted: false, revision: 1 };
    const store = { files: [{ ...directory, id: 'root', parentId: null, name: 'Root' }, { ...directory, id: 'documents', parentId: 'root', name: 'Documents' }, file], nextFileId: 1, sceneTime: 1696988520000 };
    const bridges = createApplicationFileBridges({ profile: value.profile, getStore: () => store, alive: value.ctx.alive });
    value.ctx.getFile = bridges.getFile; value.ctx.readFile = bridges.readFile;
    const before = value.state.documents.length, windows = value.state.windows.length;
    const opened = await value.controller.openFile(file.id, { windowId: 'original-messages', guard: () => true });
    expect(opened.status).toBe('applied'); expect(opened.fileId).toBe(file.id);
    expect(value.state.documents).toHaveLength(before + 1); expect(value.state.windows).toHaveLength(windows + 1);
    const document = value.state.documents.find(row => row.id === opened.documentId);
    expect(document.fileId).toBe(file.id); expect(document.fileRevision).toBe(7); expect(document.fileMime).toBe('text/plain');
    expect(textEditPlainText(document.content)).toBe(literal); expect(file.content).toBe(literal);
    expect(Object.hasOwn(file, 'text')).toBe(false); expect(bridges.getFile(file.id)).toBe(file);
  }
});

test('all five native text openers focus the same original clean reader across an inactive transition', async () => {
  for (const profileId of ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428']) {
    const value = fixture(profileId), literal = 'Original Welcome Ω\nunchanged second line 📨';
    const file = { id: 'readme', parentId: 'documents', name: 'Welcome.txt', kind: 'text', encoding: 'utf8', content: literal, deleted: false, revision: 1 };
    const directory = { kind: 'folder', content: '', deleted: false, revision: 1 };
    const store = { files: [{ ...directory, id: 'root', parentId: null, name: 'Root' }, { ...directory, id: 'documents', parentId: 'root', name: 'Documents' }, file], nextFileId: 1 };
    const bridges = createApplicationFileBridges({ profile: value.profile, getStore: () => store, alive: value.ctx.alive });
    value.ctx.getFile = bridges.getFile; value.ctx.readFile = bridges.readFile;
    const source = { id: 'original-file-browser', appId: value.profile.family === 'windows' ? 'explorer' : 'finder' };
    const apps = value.profile.family === 'windows' && createWindows11AppState(value.profile, { files: store });
    const commands = apps && createWindows11AppCommands(apps, { getWindows: () => [source, ...value.windows.values()], openAssociatedFile: value.controller.openFile });
    const open = () => commands ? commands['win11.files.open']({ windowId: source.id, fileId: file.id }, {})
      : value.controller.openFile(file.id, { windowId: source.id, guard: () => true });
    const first = await open(), window = value.windows.get(first.windowId), view = value.views.get(first.windowId);
    const document = value.doc(first.windowId), session = value.state.windows.find(row => row.windowId === first.windowId), content = document.content;
    const root = value.state, documents = root.documents, sessions = root.windows, originalGraph = JSON.stringify(root), originalFiles = structuredClone(store);
    const available = view.available; view.available = () => available() && value.focusedWindow() === window;
    value.ctx.focusWindow(value.windowId);
    expect(view.available()).toBe(false); expect(textEditDirty(document)).toBe(false);
    value.ctx.canCommit = () => false;
    const reopened = await open();
    expect(reopened.status).toBe('applied'); expect(reopened.presentationAvailable).toBe(true);
    expect(reopened.target).toEqual({ windowId: window.id, documentId: document.id, fileId: file.id, appId: window.appId, presentationAvailable: true });
    expect(value.focusedWindow()).toBe(window); expect(view.available()).toBe(true);
    expect(value.windows.get(reopened.windowId)).toBe(window); expect(value.views.get(reopened.windowId)).toBe(view);
    expect(value.state).toBe(root); expect(root.documents).toBe(documents); expect(root.windows).toBe(sessions);
    expect(value.doc(reopened.windowId)).toBe(document); expect(root.windows.find(row => row.windowId === reopened.windowId)).toBe(session);
    expect(document.content).toBe(content); expect(JSON.stringify(root)).toBe(originalGraph);
    expect(textEditPlainText(value.doc(reopened.windowId).content)).toBe(literal);
    expect(bridges.getFile(file.id)).toBe(file); expect(store).toEqual(originalFiles);
  }
});

test('reopening a dirty original text file preserves its exact edited buffer and opens a separate clean reader', async () => {
  const value = fixture(), file = { id: 'readme', name: 'Welcome.txt', mime: 'text/plain', content: 'saved original', revision: 1 };
  value.files.set(file.id, file);
  const first = await value.controller.openFile(file.id), window = value.windows.get(first.windowId), document = value.doc(first.windowId);
  await value.input('unsaved local Ω', first.windowId);
  const content = document.content, undo = document.undo, original = JSON.stringify(document);
  const reopened = await value.controller.openFile(file.id), next = value.doc(reopened.windowId);
  expect(reopened.status).toBe('applied'); expect(value.focusedWindow()).toBe(value.windows.get(reopened.windowId));
  expect(value.windows.get(first.windowId)).toBe(window); expect(value.doc(first.windowId)).toBe(document);
  expect(document.content).toBe(content); expect(document.undo).toBe(undo); expect(JSON.stringify(document)).toBe(original);
  expect(textEditDirty(document)).toBe(true); expect(textEditPlainText(document.content)).toBe('unsaved local Ω');
  expect(reopened.windowId).not.toBe(first.windowId); expect(next).not.toBe(document);
  expect(textEditPlainText(next.content)).toBe(file.content); expect(textEditDirty(next)).toBe(false);
  expect(value.files.get(file.id)).toBe(file); expect(file.revision).toBe(1);
});

test('revision, MIME, encoding, content and app-kind drift cannot reuse an otherwise clean original text reader', async () => {
  for (const drift of ['revision', 'mime', 'encoding', 'content', 'app-kind', 'utility-kind', 'window']) {
    const value = fixture(), file = { id: 'readme', name: 'Welcome.txt', mime: 'text/plain', content: 'same source café', revision: 1 };
    value.files.set(file.id, file);
    const first = await value.controller.openFile(file.id), document = value.doc(first.windowId), window = value.windows.get(first.windowId);
    if (drift === 'revision') file.revision++;
    if (drift === 'mime') file.mime = 'text/plain;charset=utf-8';
    if (drift === 'encoding') document.encoding = 'windows-1252';
    if (drift === 'content') file.content = 'different same-revision source';
    if (drift === 'app-kind') window.appId = 'wordpad';
    if (drift === 'utility-kind') window.utilityKind = 'different-utility';
    if (drift === 'window') value.windows.set(window.id, { ...window });
    const original = JSON.stringify(document), content = document.content;
    const reopened = await value.controller.openFile(file.id), next = value.doc(reopened.windowId);
    expect(reopened.status).toBe('applied'); expect(reopened.windowId).not.toBe(first.windowId); expect(next).not.toBe(document);
    expect(value.doc(first.windowId)).toBe(document); expect(document.content).toBe(content); expect(JSON.stringify(document)).toBe(original);
    expect(next.fileRevision).toBe(file.revision); expect(next.fileMime).toBe(file.mime); expect(next.encoding).toBe('utf-8');
    expect(textEditPlainText(next.content)).toBe(file.content); expect(value.files.get(file.id)).toBe(file);
  }
  const value = fixture(), literal = 'same decoded café €', file = { id: 'encoded-source', name: 'Encoded.txt', mime: 'text/plain', content: literal, revision: 1 };
  value.files.set(file.id, file);
  const first = await value.controller.openFile(file.id), original = value.doc(first.windowId), encoded = encodeTextEditFile(createTextEditContent(literal, 'plain'), 'utf-16le');
  Object.assign(file, { content: encoded.text, mime: encoded.mime });
  const reopened = await value.controller.openFile(file.id), next = value.doc(reopened.windowId);
  expect(reopened.status).toBe('applied'); expect(next).not.toBe(original); expect(next.encoding).toBe('utf-16le');
  expect(textEditPlainText(next.content)).toBe(literal); expect(original.encoding).toBe('utf-8'); expect(textEditPlainText(original.content)).toBe(literal);
});

test('an originally eligible text reader cannot inherit equal-ID replacement during asynchronous file decoding', async () => {
  for (const replacement of ['root', 'document', 'session', 'window', 'view', 'file', 'content', 'app-kind', 'utility-kind']) {
    const value = fixture(), file = { id: 'readme', name: 'Welcome.txt', mime: 'text/plain', content: 'original source', revision: 1 };
    value.files.set(file.id, file);
    const first = await value.controller.openFile(file.id), window = value.windows.get(first.windowId), view = value.views.get(first.windowId);
    const document = value.doc(first.windowId), session = value.state.windows.find(row => row.windowId === first.windowId), gate = deferred();
    value.ctx.focusWindow(value.windowId);
    const focused = value.focusedWindow(), documents = value.state.documents.length, sessions = value.state.windows.length;
    value.ctx.readFile = async () => { await gate.promise; return { status: 'applied', file, text: file.content, mime: file.mime, name: file.name }; };
    const pending = value.controller.openFile(file.id);
    if (replacement === 'root') { const next = structuredClone(value.state); value.ctx.getState = () => next; }
    if (replacement === 'document') value.state.documents[value.state.documents.indexOf(document)] = structuredClone(document);
    if (replacement === 'session') value.state.windows[value.state.windows.indexOf(session)] = structuredClone(session);
    if (replacement === 'window') value.windows.set(window.id, { ...window });
    if (replacement === 'view') value.views.set(window.id, { ...view });
    if (replacement === 'file') value.files.set(file.id, { ...file });
    if (replacement === 'content') document.content = structuredClone(document.content);
    if (replacement === 'app-kind') window.appId = 'wordpad';
    if (replacement === 'utility-kind') window.utilityKind = 'different-utility';
    gate.resolve();
    expect((await pending).error.code).toBe('stale_target');
    expect(value.state.documents).toHaveLength(documents); expect(value.state.windows).toHaveLength(sessions);
    expect(value.focusedWindow()).toBe(focused); expect(textEditPlainText(document.content)).toBe('original source');
  }
});

test('text reader focus commits only while original ownership survives its asynchronous boundary', async () => {
  for (const replacement of ['document', 'session', 'window', 'view', 'file']) {
    const value = fixture(), file = { id: 'readme', name: 'Welcome.txt', mime: 'text/plain', content: 'original source', revision: 1 };
    value.files.set(file.id, file);
    const first = await value.controller.openFile(file.id), window = value.windows.get(first.windowId), view = value.views.get(first.windowId);
    const document = value.doc(first.windowId), session = value.state.windows.find(row => row.windowId === first.windowId), entered = deferred(), gate = deferred();
    value.ctx.focusWindow(value.windowId); const focused = value.focusedWindow(), focus = value.ctx.focusWindow;
    value.ctx.focusWindow = async (id, ownership) => { entered.resolve(); await gate.promise; focus(id, ownership); };
    const pending = value.controller.openFile(file.id); await entered.promise;
    if (replacement === 'document') value.state.documents[value.state.documents.indexOf(document)] = structuredClone(document);
    if (replacement === 'session') value.state.windows[value.state.windows.indexOf(session)] = structuredClone(session);
    if (replacement === 'window') value.windows.set(window.id, { ...window });
    if (replacement === 'view') value.views.set(window.id, { ...view });
    if (replacement === 'file') value.files.set(file.id, { ...file });
    gate.resolve();
    expect((await pending).error.code).toBe('stale_target'); expect(value.focusedWindow()).toBe(focused);
    expect(value.state.documents).toHaveLength(2); expect(value.state.windows).toHaveLength(2);
    expect(textEditPlainText(document.content)).toBe('original source');
  }
});

test('text reader reuse rejects absent or unsuccessful actual focus instead of reporting a fake applied target', async () => {
  for (const focus of [undefined, () => {}]) {
    const value = fixture(), file = { id: 'readme', name: 'Welcome.txt', mime: 'text/plain', content: 'original source', revision: 1 };
    value.files.set(file.id, file);
    const first = await value.controller.openFile(file.id), window = value.windows.get(first.windowId), view = value.views.get(first.windowId), available = view.available;
    view.available = () => available() && value.focusedWindow() === window;
    value.ctx.focusWindow(value.windowId); const focused = value.focusedWindow(); value.ctx.focusWindow = focus;
    const reopened = await value.controller.openFile(file.id);
    expect(reopened.status).toBe('rejected'); expect(value.focusedWindow()).toBe(focused);
    expect(value.state.documents).toHaveLength(2); expect(value.state.windows).toHaveLength(2);
    expect(value.doc(first.windowId).fileId).toBe(file.id); expect(textEditPlainText(value.doc(first.windowId).content)).toBe(file.content);
  }
});

test('Explorer text association opens real Notepad with literal data-like UTF8 and fully decoded native text bytes', async () => {
  for (const encoding of ['utf8', 'utf-16le', 'windows-1252']) {
    const value = fixture('windows11-23h2-22631.2428');
    const literal = 'data:application/pdf;base64,this is actual plain text — café €\n';
    const encoded = encoding === 'utf8' ? { text: literal, encoding } : encodeTextEditFile(createTextEditContent(literal, 'plain'), encoding);
    const file = { id: 'original-explorer-text', parentId: 'documents', name: 'Original text',
      kind: 'text', content: encoded.text, encoding, ...(encoded.mime ? { mime: encoded.mime } : {}),
      deleted: false, revision: 11 };
    const directory = { kind: 'folder', content: '', deleted: false, revision: 1 };
    const store = { files: [{ ...directory, id: 'root', parentId: null, name: 'Root' },
      { ...directory, id: 'documents', parentId: 'root', name: 'Documents' }, file], nextFileId: 1 };
    const bridges = createApplicationFileBridges({ profile: value.profile, getStore: () => store, alive: value.ctx.alive });
    value.ctx.getFile = bridges.getFile; value.ctx.readFile = bridges.readFile;
    const apps = createWindows11AppState(value.profile, { files: store });
    const source = { id: 'native-source-explorer', appId: 'explorer' }, before = structuredClone(store);
    const commands = createWindows11AppCommands(apps, {
      getWindows: () => [source, ...value.windows.values()],
      invoke: () => { throw new Error('File association must not feed encoded content into legacy kind-only Notepad.'); },
      openAssociatedFile: value.controller.openFile,
    });
    const opened = await commands['win11.files.open']({ windowId: source.id, fileId: file.id }, {});
    expect(opened.status).toBe('applied');
    const document = value.state.documents.find(row => row.id === opened.documentId);
    expect(textEditPlainText(document.content)).toBe(literal);
    expect(document.fileId).toBe(file.id);
    expect(document.fileRevision).toBe(file.revision);
    expect(bridges.getFile(file.id)).toBe(file);
    expect(store).toEqual(before);
  }
});

test('late equal-ID reader replacement or competing native focus rejects reuse without undoing actual focus', async () => {
  for (const replacement of ['root', 'document', 'session', 'window', 'view', 'file', 'focus']) {
    const value = fixture(), file = { id: 'readme', name: 'Welcome.txt', mime: 'text/plain', content: 'original source', revision: 1 };
    value.files.set(file.id, file);
    const first = await value.controller.openFile(file.id), window = value.windows.get(first.windowId), view = value.views.get(first.windowId), available = view.available;
    const document = value.doc(first.windowId), session = value.state.windows.find(row => row.windowId === first.windowId), entered = deferred(), gate = deferred();
    view.available = () => available() && value.focusedWindow() === window;
    value.ctx.focusWindow(value.windowId);
    value.ctx.tick = async () => { entered.resolve(); await gate.promise; };
    const pending = value.controller.openFile(file.id); await entered.promise;
    expect(value.focusedWindow()).toBe(window);
    if (replacement === 'root') { const next = structuredClone(value.state); value.ctx.getState = () => next; }
    if (replacement === 'document') value.state.documents[value.state.documents.indexOf(document)] = structuredClone(document);
    if (replacement === 'session') value.state.windows[value.state.windows.indexOf(session)] = structuredClone(session);
    if (replacement === 'window') value.windows.set(window.id, { ...window });
    if (replacement === 'view') value.views.set(window.id, { ...view });
    if (replacement === 'file') value.files.set(file.id, { ...file });
    if (replacement === 'focus') value.ctx.focusWindow(value.windowId);
    const actualFocus = value.focusedWindow(); gate.resolve();
    expect((await pending).error.code).toBe('stale_target'); expect(value.focusedWindow()).toBe(actualFocus);
    expect(value.state.documents).toHaveLength(2); expect(value.state.windows).toHaveLength(2);
    expect(textEditPlainText(document.content)).toBe('original source');
  }
});

import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createNotesWorkspaceCommands } from '../frontend/src/notes-workspace-commands.js';
import { createNotesWorkspace, notesWorkspaceWindow, noteWorkspaceText, validateNotesWorkspace, NOTES_WORKSPACE_PROFILES } from '../frontend/src/notes-workspace-state.js';
import { documentFromText, firstDocumentSelection } from '../frontend/src/notes-workspace-document.js';
import { createMacDesktopFileStore } from '../frontend/src/desktop-file-state.js';
import { createWindows11AppState } from '../frontend/src/windows11-app-state.js';
import { createApplicationFileBridges } from '../frontend/src/application-file-bridges.js';
import { canonicalStringUnits } from '../frontend/src/canonical-data.js';
import { openPreviewPdf } from '../frontend/src/preview-codec.js';
const fontLoader = async () => new Uint8Array(await Bun.file(new URL('../frontend/public/fonts/LiberationSans-Regular.ttf', import.meta.url)).arrayBuffer());
const clone = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function consumer(profileId = NOTES_WORKSPACE_PROFILES[1]) {
  const profile = getOSProfile(profileId), state = createNotesWorkspace(profile), files = profileId.startsWith('windows') ? createWindows11AppState() : createMacDesktopFileStore(profile);
  const window = { id: 'notes-file-window', appId: profileId.startsWith('windows') ? 'stickynotes' : 'notes' }, view = { available: () => true, restoreSelection: () => true };
  let originalWindow = window, originalView = view, time = Date.parse(profile.defaults.sceneTime), limit = 4 * 1024 * 1024, reserved = 0, unrelated = 0;
  const units = () => canonicalStringUnits({ state, files: { nextFileId: files.nextFileId, files: files.files.filter(file => !file.readOnly) } }) + unrelated;
  const canCommit = delta => units() + reserved + delta <= limit;
  const bridges = createApplicationFileBridges({ profile, getStore: () => files, alive: () => true, getSceneTime: () => time, canCommit,
    reserve: (delta, callback) => { reserved += delta; try { return callback(); } finally { reserved -= delta; } } });
  const ctx = { profile, getState: () => state, getWindow: id => id === window.id ? originalWindow : null, getView: () => originalView,
    available: () => true, alive: () => true, tick: async () => {}, getSceneTime: () => time, canCommit, focusWindow: () => {}, fontLoader, createFile: bridges.createFile };
  const controller = createNotesWorkspaceCommands(ctx); expect(controller.windowOpened(window)).toBe(true);
  const run = (suffix, payload = {}) => controller.handlers[`notes.${suffix}`]({ windowId: window.id }, payload);
  const selected = () => state.notes.find(note => note.id === notesWorkspaceWindow(state, window.id)?.selectedId);
  const setText = text => { const note = selected(); note.document = documentFromText(text, note.id); notesWorkspaceWindow(state, window.id).selection = firstDocumentSelection(note.document); return note; };
  return { profile, state, files, view, ctx, run, selected, setText, bridges, units, setLimit: value => { limit = value; }, setUnrelated: value => { unrelated = value; },
    time: value => { time = value; }, replaceWindow: () => { originalWindow = { ...window }; }, replaceView: () => { originalView = { ...view }; },
    snapshot: () => clone({ state, files }) };
}
async function textInPdf(content) {
  const resource = await openPreviewPdf(content);
  try { const text = []; for (let page = 1; page <= resource.document.numPages; page++) text.push((await (await resource.document.getPage(page)).getTextContent()).items.map(item => item.str).join(' ')); return text.join('\n'); }
  finally { await resource.destroy(); }
}

test('all five real rich Notes workspaces duplicate complete structure without mutating the original source', async () => {
  for (const profileId of NOTES_WORKSPACE_PROFILES) {
    const c = consumer(profileId), note = c.setText('Exact heading\nBody one\nTrailing spaces  ');
    note.document.blocks[1].runs[0].marks = ['bold']; note.pinned = true;
    const original = clone(note), result = await c.run('duplicate', { noteId: note.id });
    expect(result.status).toBe('applied'); expect(note).toEqual(original);
    const copy = c.state.notes.find(row => row.id === result.noteId);
    expect(copy.document).toEqual(original.document); expect(copy.attachments).toEqual(original.attachments); expect(copy.document).not.toBe(note.document);
    expect(copy.pinned).toBe(false); expect(copy.deletedAt).toBeNull(); expect(copy.createdAt).toBe(copy.updatedAt);
    expect(notesWorkspaceWindow(c.state, 'notes-file-window').selectedId).toBe(copy.id); expect(validateNotesWorkspace(c.state, c.profile).ok).toBe(true);
  }
});

test('real Files exports preserve full rich HTML and literal plaintext/Markdown without source or selection mutation', async () => {
  const c = consumer(), note = c.setText('Heading & title\nExact body <unsafe>\n\nTail  ');
  note.document.blocks[1].runs[0].marks = ['bold', 'italic'];
  const original = clone(c.state);
  for (const [format, name, mime] of [['text', 'Full.txt', 'text/plain'], ['markdown', 'Full.md', 'text/markdown'], ['html', 'Full.html', 'text/html']]) {
    const result = await c.run('export', { noteId: note.id, format, name }); expect(result.status).toBe('applied');
    const file = c.bridges.getFile(result.fileId); expect(file.mime).toBe(mime); expect(file.parentId).toBe('documents');
    if (format === 'text') expect(file.content).toBe('Heading & title\nExact body <unsafe>\n\nTail  ');
    if (format === 'markdown') expect(file.content).toContain('Exact body <unsafe>\n\nTail  ');
    if (format === 'html') { expect(file.content).toContain('<em><strong>Exact body &lt;unsafe&gt;</strong></em>'); expect(file.content).toContain('Tail  '); expect(file.content).not.toContain('<unsafe>'); }
    expect(c.state).toEqual(original);
  }
});

test('bundled-font rich Notes PDF text projection independently decodes every actual source page', async () => {
  const c = consumer(), text = Array.from({ length: 120 }, (_, index) => `Marker${String(index).padStart(3, '0')} line`).join('\n'), note = c.setText(text), original = clone(c.state);
  const result = await c.run('export', { noteId: note.id, format: 'pdf', name: 'Complete.pdf' }); expect(result.status).toBe('applied');
  const file = c.bridges.getFile(result.fileId); expect(file.mime).toBe('application/pdf');
  const consumed = await textInPdf(file.content); expect(consumed).toContain('Marker000 line'); expect(consumed).toContain('Marker119 line');
  const resource = await openPreviewPdf(file.content); try { expect(resource.document.numPages).toBeGreaterThan(2); } finally { await resource.destroy(); }
  expect(c.state).toEqual(original); expect(validateNotesWorkspace(c.state, c.profile).ok).toBe(true);
});

test('explicit same-file export replacement preserves original identity, timestamps and counter and applies only the true Files delta', async () => {
  const c = consumer(), note = c.setText('Heading\nLiteral full body');
  const result = await c.run('export', { noteId: note.id, format: 'text', name: 'Replace.txt' }), file = c.bridges.getFile(result.fileId), original = clone(file), counter = c.files.nextFileId;
  const ceiling = c.units(); c.setLimit(ceiling);
  const replacement = await c.run('export', { noteId: note.id, format: 'text', name: 'Replace.txt', existingFileId: file.id });
  expect(replacement.status).toBe('applied'); expect(replacement.fileId).toBe(file.id); expect(c.bridges.getFile(file.id)).toBe(file); expect(file.revision).toBe(original.revision + 1);
  expect(file.createdAt).toBe(original.createdAt); expect(c.files.nextFileId).toBe(counter);
  const before = c.snapshot(); expect((await c.run('export', { noteId: note.id, format: 'text', name: 'New.txt' })).error.code).toBe('limit_exceeded'); expect(c.snapshot()).toEqual(before);
});

test('actual rich export rejects source/native identity changes during asynchronous font load before allocating a File', async () => {
  for (const change of ['source', 'window', 'view']) {
    const c = consumer(), note = c.setText('Original\nOriginal full content'), entered = deferred(), release = deferred();
    c.ctx.fontLoader = async () => { const bytes = await fontLoader(); entered.resolve(); await release.promise; return bytes; };
    const pending = c.run('export', { noteId: note.id, format: 'pdf', name: 'Pending.pdf' }); await entered.promise;
    if (change === 'source') { note.document.blocks[1].runs[0].text = 'Concurrent original source edit'; note.revision++; }
    if (change === 'window') c.replaceWindow();
    if (change === 'view') c.replaceView();
    const changed = c.snapshot(); release.resolve(); expect((await pending).error.code).toBe('stale_target'); expect(c.snapshot()).toEqual(changed);
  }
});

test('unsupported font glyphs, real Files collisions and invalid native names fail without Notes/File mutations', async () => {
  const c = consumer(), note = c.setText('Unsupported\n\u{1F984}'), before = c.snapshot();
  expect((await c.run('export', { noteId: note.id, format: 'pdf', name: 'Glyph.pdf' })).status).toBe('rejected'); expect(c.snapshot()).toEqual(before);
  c.setText('Heading\nBody'); await c.run('export', { noteId: note.id, format: 'text', name: 'Collision.txt' }); const stable = c.snapshot();
  for (const payload of [{ name: 'collision.TXT', format: 'text' }, { name: '.hidden', format: 'text' }, { name: 'Bad/name', format: 'text' }, { name: 'Collision.txt', format: 'text', extra: true }]) {
    expect((await c.run('export', { noteId: note.id, ...payload })).status).toBe('rejected'); expect(c.snapshot()).toEqual(stable);
  }
});

test('complete-root budget includes unrelated strings for duplicate and export; authored duplicate time never reads host clock', async () => {
  const c = consumer(), note = c.setText('Clock\nFull authored body'); c.time(note.updatedAt + 4 * 86400000);
  const result = await c.run('duplicate', { noteId: note.id }), copy = c.state.notes.find(row => row.id === result.noteId);
  expect(result.status).toBe('applied'); expect(copy.createdAt).toBe(note.updatedAt + 4 * 86400000 + 1);
  c.setUnrelated(4 * 1024 * 1024 - c.units() - 1); const before = c.snapshot();
  expect((await c.run('duplicate', { noteId: copy.id })).error.code).toBe('limit_exceeded'); expect(c.snapshot()).toEqual(before);
  expect((await c.run('export', { noteId: copy.id, name: 'Budget.txt', format: 'text' })).error.code).toBe('limit_exceeded'); expect(c.snapshot()).toEqual(before);
});

test('locked rich Notes reject actual export/print/share rather than exposing source content through a destination', async () => {
  const c = consumer(), note = c.setText('Secret\nDo not expose');
  await c.run('lock', { noteId: note.id, secret: 'fictional-local', hint: 'Local' }); await c.run('relock', { noteId: note.id });
  const before = c.snapshot();
  for (const [suffix, payload] of [['export', { noteId: note.id, name: 'Leak.txt', format: 'text' }], ['print', { noteId: note.id }], ['share', { noteId: note.id }]]) {
    expect((await c.run(suffix, payload)).error.code).toBe('locked'); expect(c.snapshot()).toEqual(before);
  }
  expect(noteWorkspaceText(c.selected())).toBe('');
});

import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { NOTES_WORKSPACE_PROFILES, createNotesWorkspace, importLegacyNotesWorkspace, notesWorkspaceSchema, notesWorkspaceSchemaValid, validateNotesWorkspace, notesWorkspaceWindow, noteWorkspaceText, noteWorkspaceTitle, notesWorkspacePublicProjection, sweepNotesWorkspace, visibleWorkspaceNotes } from '../frontend/src/notes-workspace-state.js';
import { createNotesWorkspaceCommands } from '../frontend/src/notes-workspace-commands.js';
import { documentFromText, documentText, documentHTML, fontSelection, normalizeRuns, markSelection, replaceSelection, firstDocumentSelection } from '../frontend/src/notes-workspace-document.js';
function consumer(profileId = NOTES_WORKSPACE_PROFILES[1], overrides = {}) {
  const profile = getOSProfile(profileId), state = createNotesWorkspace(profile), window = { id: 'notes-test-window', appId: 'notes' }; let currentWindow = window, sceneTime = Date.parse(profile.defaults.sceneTime), currentView;
  const view = { available: () => true, restoreSelection: selection => { view.selection = selection; return true; }, captureSelection: () => notesWorkspaceWindow(state, window.id).selection, focus: () => true, scroll: (_, value) => value };
  currentView = view;
  const ctx = { profile, getState: () => state, getWindow: id => id === window.id ? currentWindow : null, getWindows: () => currentWindow ? [currentWindow] : [], getView: () => currentView, available: () => true, alive: () => true, tick: async () => {}, getSceneTime: () => sceneTime, canCommit: () => true, focusWindow: () => {}, ...overrides };
  const controller = createNotesWorkspaceCommands(ctx); expect(controller.windowOpened(window)).toBe(true);
  const run = (suffix, payload = {}) => controller.handlers[`notes.${suffix}`]({ windowId: window.id }, payload);
  return { state, window, view, ctx, controller, run, selected: () => state.notes.find(note => note.id === notesWorkspaceWindow(state, window.id)?.selectedId), replaceWindow: () => { currentWindow = { ...window }; }, replaceView: () => { currentView = { ...view }; }, time: value => { sceneTime = value; } };
}
for (const profileId of NOTES_WORKSPACE_PROFILES) test(`Notes canonical rich authority supports ${profileId}`, async () => {
  const c = consumer(profileId); expect(validateNotesWorkspace(c.state, c.ctx.profile).ok).toBe(true); expect(c.state.notes.map(note => note.id)).toEqual(['note-1', 'note-2', 'note-3', 'note-4']);
  const created = await c.run('create', { text: 'Title\nRich body' }); expect(created.status).toBe('applied'); const note = c.selected(); expect(Object.hasOwn(note, 'text')).toBe(false); expect(noteWorkspaceText(note)).toBe('Title\nRich body');
  const selection = { ...firstDocumentSelection(note.document), start: 0, end: 5, direction: 'forward' }; await c.run('selection.set', { noteId: note.id, revision: note.revision, selection });
  expect((await c.run('format', { kind: 'mark', value: 'bold' })).status).toBe('applied'); expect(c.selected().document.blocks[0].runs[0].marks).toEqual(['bold']); expect((await c.run('undo')).status).toBe('applied'); expect(c.selected().document.blocks[0].runs[0].marks).toEqual([]); expect((await c.run('redo')).status).toBe('applied');
});
test('rich replacement retains disjoint marks and inserts stable multiline paragraphs', () => {
  const document = documentFromText('abcdef'); const selection = { ...firstDocumentSelection(document), start: 1, end: 5, direction: 'forward' };
  expect(markSelection(document, selection, 'bold')).toBe(true); const caret = replaceSelection(document, { ...selection, start: 2, end: 4 }, 'X\nY');
  expect(documentText(document)).toBe('abX\nYef'); expect(document.blocks[0].runs[1].marks).toEqual(['bold']); expect(caret.blockId).toBe(document.blocks[1].id); expect(caret.start).toBe(1);
});
test('actual cell edits, row/column transitions and undo survive native view retirement', async () => {
  const c = consumer(); await c.run('create', { text: 'Table note' }); await c.run('table', { operation: 'insert' });
  const table = c.selected().document.blocks[1]; expect(table.rows.length).toBe(2); expect((await c.run('insert', { text: 'Persisted cell' })).status).toBe('applied');
  await c.run('table', { operation: 'column.add', blockId: table.id, row: 0, column: 0 }); expect(c.selected().document.blocks[1].rows[0].length).toBe(3);
  const noteId = c.selected().id; expect(c.controller.windowClosed(c.window)).toBe(true); expect(c.state.notes.find(note => note.id === noteId).document.blocks[1].rows[0][0][0].text).toBe('Persisted cell');
  expect(c.controller.windowOpened(c.window, { noteId })).toBe(true); expect((await c.run('undo')).status).toBe('applied'); expect(c.selected().document.blocks[1].rows[0].length).toBe(2);
});
test('missing output bridges and locked projections never claim success or expose plaintext', async () => {
  const c = consumer(); const note = c.selected(); const title = noteWorkspaceTitle(note);
  expect((await c.run('share', { noteId: note.id })).error.code).toBe('unavailable'); expect((await c.run('export', { noteId: note.id, name: 'Note.html', format: 'html' })).error.code).toBe('unavailable');
  await c.run('lock', { noteId: note.id, secret: 'fictional', hint: 'Local' }); await c.run('relock', { noteId: note.id });
  expect(noteWorkspaceText(c.selected())).toBe(''); expect(JSON.stringify(notesWorkspacePublicProjection(c.state))).not.toContain(title);
  expect((await c.run('unlock', { noteId: note.id, secret: 'wrong' })).error.code).toBe('incorrect_password'); expect((await c.run('print', { noteId: note.id })).error.code).toBe('locked');
  expect((await c.run('unlock', { noteId: note.id, secret: 'fictional' })).status).toBe('applied'); expect(noteWorkspaceTitle(c.selected())).toBe(title);
});
test('canonical attachment read loses original ownership across awaited shell replacement', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const c = consumer(NOTES_WORKSPACE_PROFILES[1], { readFile: async () => { await waiting; return { status: 'applied', file: { id: 'real-image', name: 'Image.png', mime: 'image/png', text: 'data:image/png;base64,iVBORw0KGgo=' } }; } });
  const noteId = c.selected().id, pending = c.run('attachment.add', { noteId, fileId: 'real-image' }); c.replaceWindow(); release();
  expect((await pending).error.code).toBe('stale_target'); expect(c.state.notes.find(note => note.id === noteId).attachments).toEqual([]);
});
test('folder deletion trashes notes, recovering individual note falls back safely, retention uses authored threshold only', async () => {
  const c = consumer(); await c.run('folder.save', { folderId: null, accountId: 'local', name: 'Research' }); const folder = c.state.folders.find(folder => folder.name === 'Research');
  const id = c.selected().id; await c.run('move', { noteId: id, folderId: folder.id }); await c.run('folder.delete', { folderId: folder.id, confirm: true });
  expect(c.state.notes.find(note => note.id === id).deletedAt).not.toBe(null); await c.run('restore', { noteId: id }); expect(c.state.notes.find(note => note.id === id).folderId).toBe('notes');
  await c.run('trash', { noteId: id, confirm: true }); const deletedAt = c.state.notes.find(note => note.id === id).deletedAt;
  c.time(deletedAt + 30 * 86400000 - 1); await c.run('retention.sweep'); expect(c.state.notes.some(note => note.id === id)).toBe(true);
  c.time(deletedAt + 30 * 86400000); await c.run('retention.sweep'); expect(c.state.notes.some(note => note.id === id)).toBe(false);
});
test('complete scene budget rejects rich history growth without partial document mutation', async () => {
  const c = consumer(); c.ctx.canCommit = delta => delta <= 0; const before = JSON.stringify(c.state);
  expect((await c.run('insert', { text: 'more authored text' })).error.code).toBe('limit_exceeded'); expect(JSON.stringify(c.state)).toBe(before);
});
test('descriptor-safe schema refuses getters, cycles, ragged tables and stale native selection', async () => {
  let invoked = false; const c = consumer(), malformed = { ...c.state }; Object.defineProperty(malformed, 'notes', { get() { invoked = true; return []; }, enumerable: true });
  expect(notesWorkspaceSchemaValid(malformed, notesWorkspaceSchema)).toBe(false); expect(invoked).toBe(false);
  await c.run('table', { operation: 'insert' }); const table = c.selected().document.blocks.find(block => block.type === 'table'); table.rows[1].pop(); expect(validateNotesWorkspace(c.state).ok).toBe(false);
});
test('legacy import preserves exact source IDs, timestamps and derived text without mirrored authority', () => {
  const profile = getOSProfile(NOTES_WORKSPACE_PROFILES[1]), legacy = { notes: [{ id: 'note-99', text: 'Legacy\nBody', pinned: true, deleted: false, createdAt: 1, updatedAt: 2 }] };
  const imported = importLegacyNotesWorkspace(profile, legacy); expect(imported.notes[0].id).toBe('note-99'); expect(imported.notes[0].updatedAt).toBe(2); expect(imported.nextId).toBe(100); expect(noteWorkspaceText(imported.notes[0])).toBe('Legacy\nBody'); expect(Object.hasOwn(imported.notes[0], 'text')).toBe(false);
});

test('whitespace-normalized multiline search retains existing note IDs and projections', async () => {
  const c = consumer(); const created = await c.run('create', { text: 'Search\nalpha  beta\nGamma' });
  await c.run('search', { query: ' ALPHA beta Gamma ' });
  expect(visibleWorkspaceNotes(c.state, notesWorkspaceWindow(c.state, c.window.id)).map(note => note.id)).toEqual([created.noteId]);
});
test('standalone card retirement does not silently borrow a different note', async () => {
  const c = consumer(NOTES_WORKSPACE_PROFILES[4]), originalId = c.selected().id; c.controller.windowClosed(c.window);
  expect(c.controller.windowOpened(c.window, { noteId: originalId })).toBe(true);
  expect(notesWorkspaceWindow(c.state, c.window.id).standalone).toBe(true);
  await c.run('trash', { noteId: originalId, confirm: true });
  expect(notesWorkspaceWindow(c.state, c.window.id).selectedId).toBe(null);
  expect(c.state.notes.find(note => note.id === originalId).deletedAt).not.toBe(null);
});
test('folder recovery does not resurrect notes deleted separately before the folder', async () => {
  const c = consumer(); await c.run('folder.save', { folderId: null, accountId: 'local', name: 'Folder' }); const folder = c.state.folders.find(folder => folder.name === 'Folder');
  await c.run('move', { noteId: 'note-1', folderId: folder.id }); await c.run('move', { noteId: 'note-2', folderId: folder.id }); await c.run('trash', { noteId: 'note-2', confirm: true });
  await c.run('folder.delete', { folderId: folder.id, confirm: true }); await c.run('folder.restore', { folderId: folder.id });
  expect(c.state.notes.find(note => note.id === 'note-1').deletedAt).toBe(null); expect(c.state.notes.find(note => note.id === 'note-2').deletedAt).not.toBe(null);
});
test('atomic cut reserves rich-history text and commits neither graph on shared clipboard budget rejection', async () => {
  const clipboard = { kind: 'empty', text: '', fileIds: [] }; let allowed = false, reserved;
  const c = consumer(NOTES_WORKSPACE_PROFILES[1], {
    setClipboard: async (spec, ownership) => {
      reserved = spec.reserveTextUnits;
      if (!ownership.guard() || !allowed) return { status: 'rejected', error: { code: 'limit_exceeded', message: 'Complete scene clipboard budget rejected.' } };
      if (spec.onCommit && !spec.onCommit()) return { status: 'rejected', error: { code: 'stale_target', message: 'Original cut retired.' } };
      Object.assign(clipboard, { kind: spec.kind, text: spec.text, fileIds: spec.fileIds }); return { status: 'applied' };
    },
  });
  await c.run('create', { text: 'abcdef' }); const note = c.selected(); await c.run('selection.set', { noteId: note.id, revision: note.revision, selection: { ...firstDocumentSelection(note.document), start: 1, end: 4, direction: 'forward' } });
  const before = JSON.stringify(c.state); expect((await c.run('clipboard', { operation: 'cut' })).error.code).toBe('limit_exceeded'); expect(JSON.stringify(c.state)).toBe(before); expect(clipboard.kind).toBe('empty'); expect(Number.isFinite(reserved)).toBe(true);
  allowed = true; expect((await c.run('clipboard', { operation: 'cut' })).status).toBe('applied'); expect(noteWorkspaceText(c.selected())).toBe('aef'); expect(clipboard.text).toBe('bcd'); expect(c.selected().undo.length).toBe(1);
});
test('retention projection changes only when supplied an authored instant', () => {
  const state = createNotesWorkspace(getOSProfile(NOTES_WORKSPACE_PROFILES[1])), deleted = state.notes.find(note => note.id === 'note-4'), boundary = deleted.deletedAt + 30 * 86400000;
  expect(sweepNotesWorkspace(state, boundary - 1)).toBe(true); expect(state.notes.some(note => note.id === deleted.id)).toBe(true);
  expect(sweepNotesWorkspace(state, boundary)).toBe(true); expect(state.notes.some(note => note.id === deleted.id)).toBe(false);
});

test('selection-only transitions preserve original rich run and editor document owners', async () => {
  const c = consumer(), original = c.selected(), document = original.document, run = document.blocks[0].runs[0];
  await c.run('selection.set', { noteId: original.id, revision: original.revision, selection: { ...firstDocumentSelection(document), start: 1, end: 2, direction: 'forward' } });
  expect(c.selected()).toBe(original); expect(c.selected().document).toBe(document); expect(c.selected().document.blocks[0].runs[0]).toBe(run);
});
test('authored font literals survive selected-run emphasis, typing, empty paragraphs and HTML export', () => {
  const document = documentFromText('abcdef'), range = { ...firstDocumentSelection(document), start: 1, end: 5 };
  expect(fontSelection(document, range, 'An unavailable authored family')).toBe(true);
  expect(document.blocks[0].runs.map(run => [run.text, run.font])).toEqual([['a', undefined], ['bcde', 'An unavailable authored family'], ['f', undefined]]);
  expect(markSelection(document, { ...range, start: 2, end: 4 }, 'bold')).toBe(true);
  expect(document.blocks[0].runs.find(run => run.text === 'cd').font).toBe('An unavailable authored family');
  replaceSelection(document, { ...range, start: 3, end: 3 }, 'X');
  expect(document.blocks[0].runs.find(run => run.text.includes('X')).font).toBe('An unavailable authored family');
  expect(documentHTML(document)).toContain('An unavailable authored family');
  const empty = documentFromText(''); fontSelection(empty, firstDocumentSelection(empty), 'Imported "Font"');
  expect(normalizeRuns(empty.blocks[0].runs)[0].font).toBe('Imported "Font"');
  replaceSelection(empty, firstDocumentSelection(empty), 'First typed characters');
  expect(empty.blocks[0].runs[0].font).toBe('Imported "Font"');
  expect(documentHTML(empty)).toContain('&quot;');
});

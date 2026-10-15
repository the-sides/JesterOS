import { expect, test } from 'bun:test';
import { createNotesWorkspace, createNotesWorkspaceWindow, noteWorkspaceText, noteWorkspaceLocked } from '../frontend/src/notes-workspace-state.js';
import { createTextEditingCommands } from '../frontend/src/text-editing-commands.js';
import { createNotesWorkspaceCommands } from '../frontend/src/notes-workspace-commands.js';
import { documentFromText, firstDocumentSelection } from '../frontend/src/notes-workspace-document.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createTextToolsCommands } from '../frontend/src/text-tools-commands.js';
import { editingPreferencesDefaults } from '../frontend/src/editing-state.js';
import { createNativeClipboardCommands } from '../frontend/src/native-clipboard.js';
import { findTextMatches, replaceAllNoteMatches } from '../frontend/src/text-find.js';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(text = 'cat Title\ncat Cat concatenate a+b 😀') {
  const profile = getOSProfile('macos-golden-gate-27.0.1'), notes = createNotesWorkspace(profile), note = notes.notes[0];
  note.document = documentFromText(text);
  const window = { id: 'notes-main', appId: 'notes' };
  const session = createNotesWorkspaceWindow(notes, window.id, { noteId: note.id, standalone: false }); notes.windows.push(session);
  const preferences = editingPreferencesDefaults(), clipboard = { kind: 'empty', text: '', fileIds: [] };
  const state = { find: null, panel: null, spelling: null, liveSpelling: null };
  let nativeSelection = firstDocumentSelection(note.document);
  const view = { available: () => true, ownsNote: owner => owner === note,
    captureSelection: () => nativeSelection, restoreSelection: next => { nativeSelection = next; return true; } };
  const native = createNotesWorkspaceCommands({ profile, getState: () => notes, getWindow: () => window, getView: () => view,
    alive: () => true, available: () => true, canCommit: () => true, getSceneTime: () => 1800000000000, tick: async () => {} });
  const editor = createTextEditingCommands(notes, clipboard, { available: () => true, dataAvailable: () => true,
    getView: () => view, prepare: async () => true, invoke: (name, target, payload) => native.handlers[name](target, payload) });
  const ctx = { available: () => true, getDocument: target => target.windowId === window.id && target.noteId === session.selectedId && !noteWorkspaceLocked(note)
      ? { note, revision: note.revision, value: noteWorkspaceText(note), readOnly: note.deletedAt !== null, session, view } : null,
    getNotesWindow: id => id === window.id, focusTool: async () => true, prepareDocument: async () => true,
    getToolInput: () => null, captureReturn: () => null, restoreReturn: async () => true,
    revealMatch: async () => true, canCommitPreferences: () => true, onChanged: () => {},
    invoke: (name, target, payload) => native.handlers[name](target, payload) };
  const assistance = { ready: async () => true, check: async () => ({ issues: [], nextFrom: null }) };
  const tools = createTextToolsCommands(state, preferences, clipboard, assistance, ctx);
  const target = { windowId: window.id, noteId: session.selectedId };
  return { notes, preferences, clipboard, state, editor, tools, ctx, assistance, target,
    note: () => note,
    versioned: () => ({ ...target, revision: note.revision }),
    run: (command, payload = {}, owner = target) => tools.handlers[command](owner, payload) };
}

test('Find All replaces literal full-document matches in title and body as one undoable transaction', async () => {
  const value = fixture(), original = noteWorkspaceText(value.note());
  await value.run('text.find.open');
  await value.run('text.find.configure', { query: 'cat', replacement: '$&', wholeWord: true });
  const result = await value.run('text.find.replace', { all: true }, value.versioned());
  expect(result.target.count).toBe(3); expect(noteWorkspaceText(value.note())).toBe('$& Title\n$& $& concatenate a+b 😀');
  await value.editor.handlers['text.undo']({ ...value.versioned(), control: 'editor' }, {});
  expect(noteWorkspaceText(value.note())).toBe(original);
  await value.editor.handlers['text.redo']({ ...value.versioned(), control: 'editor' }, {});
  expect(noteWorkspaceText(value.note())).toBe('$& Title\n$& $& concatenate a+b 😀');
});

test('Find matching is Unicode-aware, literal, and navigates beyond the decoration bound', () => {
  const text = 'cat\u0301 cat 😀 a+b A+B ' + 'cat '.repeat(600);
  const result = findTextMatches(text, 'cat', { wholeWord: true }, 600);
  expect(result.count).toBe(601); expect(result.highlights).toHaveLength(500);
  expect(result.selected.index).toBe(600); expect(text.slice(result.selected.start, result.selected.end)).toBe('cat');
  expect(result.highlights[0].start).toBe(5);
  expect(replaceAllNoteMatches(text, 'a+b', '', { caseSensitive: false }).text).toBe(text.replace('a+b', '').replace('A+B', ''));
});

test('Find cannot apply an obsolete query or replacement after asynchronous preparation', async () => {
  const value = fixture(); await value.run('text.find.open');
  await value.run('text.find.configure', { query: 'cat', replacement: 'dog' });
  const gate = deferred(); value.ctx.prepareDocument = async () => { await gate.promise; return true; };
  const original = noteWorkspaceText(value.note()), pending = value.run('text.find.replace', { all: true }, value.versioned());
  await value.run('text.find.configure', { query: 'a+b', replacement: 'new' }); gate.resolve();
  expect((await pending).error.code).toBe('stale_target'); expect(noteWorkspaceText(value.note())).toBe(original);
  expect(value.state.find.query).toBe('a+b');
});

test('changed substitution preferences invalidate pending transformations without creating undo', async () => {
  const value = fixture('Title\n"hello" --');
  await value.run('text.preferences.set', { smartQuotes: true, smartDashes: true }, { windowId: 'notes-main' });
  const gate = deferred(); value.ctx.prepareDocument = async () => { await gate.promise; return true; };
  const pending = value.run('text.substitutions.apply', {}, value.versioned());
  await value.run('text.preferences.set', { smartQuotes: false }, { windowId: 'notes-main' }); gate.resolve();
  expect((await pending).error.code).toBe('stale_target'); expect(noteWorkspaceText(value.note())).toBe('Title\n"hello" --');
  expect(value.note().undo).toHaveLength(0);
});

test('a later explicit automatic-correction choice wins over pending dictionary readiness', async () => {
  const value = fixture(), gate = deferred(); value.ctx.prepareAssistance = async () => { await gate.promise; return true; };
  const pending = value.run('text.preferences.set', { correctSpellingAutomatically: true }, { windowId: 'notes-main' });
  await value.run('text.preferences.set', { correctSpellingAutomatically: false }, { windowId: 'notes-main' }); gate.resolve();
  expect((await pending).error.code).toBe('stale_target'); expect(value.preferences.correctSpellingAutomatically).toBe(false);
});

test('presentation failure cannot turn committed Find, spelling or substitution edits into rejections', async () => {
  const value = fixture('cat\n"cat" --'); await value.run('text.find.open');
  await value.run('text.find.configure', { query: 'cat', replacement: 'dog' });
  value.ctx.revealMatch = async () => { throw new Error('detached presentation'); };
  expect((await value.run('text.find.replace', { all: true }, value.versioned())).status).toBe('applied');
  expect(noteWorkspaceText(value.note())).toBe('dog\n"dog" --');
  expect((await value.run('text.spelling.replace', { replacement: 'cat' }, { ...value.versioned(), start: 0, end: 3 })).status).toBe('applied');
  await value.run('text.preferences.set', { smartQuotes: true, smartDashes: true }, { windowId: 'notes-main' });
  expect((await value.run('text.substitutions.apply', {}, value.versioned())).status).toBe('applied');
  expect(noteWorkspaceText(value.note())).toBe('cat\n“dog” —');
});

function draftFixture() {
  const clipboard = { kind: 'text', text: 'Z', fileIds: [] }, node = {}, model = { ownerId: 'save-1', value: 'abc', start: 1, end: 2, connected: true };
  const ctx = { getControl: target => model.connected && model.ownerId === target.ownerId ? { node, value: model.value,
      start: model.start, end: model.end, maxLength: 6, commit: value => { model.value = value; return { status: 'applied' }; } } : null,
    prepare: async () => true, finish: async (_target, range) => { model.start = range.start; model.end = range.end; }, onChanged: () => {} };
  const bridge = createNativeClipboardCommands(clipboard, ctx);
  const target = () => ({ surface: 'file-dialog', ownerId: model.ownerId, control: 'name', value: model.value, start: model.start, end: model.end });
  return { model, clipboard, ctx, bridge, target, run: operation => bridge.handlers['clipboard.control'](target(), { operation }) };
}

test('draft cut/paste undo restores original selection and leaves root clipboard independent from document history', async () => {
  const value = draftFixture(); expect((await value.run('cut')).status).toBe('applied');
  expect(value.model.value).toBe('ac'); expect(value.clipboard.text).toBe('b');
  expect((await value.run('undo')).status).toBe('applied');
  expect(value.model.value).toBe('abc'); expect([value.model.start, value.model.end]).toEqual([1, 2]);
  expect((await value.run('redo')).status).toBe('applied'); expect(value.model.value).toBe('ac');
  expect((await value.run('paste')).status).toBe('applied'); expect(value.model.value).toBe('abc');
});

test('draft owner replacement and field capacity reject without consuming clipboard or recording undo', async () => {
  const value = draftFixture(), gate = deferred(); value.ctx.prepare = async () => { await gate.promise; return true; };
  const pending = value.run('paste'); value.model.ownerId = 'save-2'; gate.resolve();
  expect((await pending).error.code).toBe('stale_target'); expect(value.model.value).toBe('abc'); expect(value.clipboard.text).toBe('Z');
  value.ctx.prepare = async () => true; value.clipboard.text = '123456';
  expect((await value.run('paste')).error.code).toBe('limit_exceeded'); expect(value.model.value).toBe('abc');
  expect(value.bridge.targets(value.target()).undo).toBe(false);
});

test('native draft input after an external overwrite cannot undo through that overwrite', async () => {
  const value = draftFixture(); await value.run('paste'); value.model.value = 'xy'; value.model.start = value.model.end = 2;
  value.bridge.recordInput(value.target(), 'x', 'xy', { start: 1, end: 1 }, { start: 2, end: 2 });
  expect((await value.run('undo')).status).toBe('applied'); expect(value.model.value).toBe('x');
  expect((await value.run('undo')).error.code).toBe('disabled'); expect(value.model.value).toBe('x');
});
test('spelling replacement clipboard edits its real draft without changing the document and supports draft undo', async () => {
  const value = fixture('Title\ncolour');
  value.ctx.getNotesWindow = id => id === 'notes-main' ? { id, appId: 'notes' } : null;
  const selection = { start: 0, end: 5, direction: 'forward' };
  value.ctx.getToolInput = () => ({ value: value.state.spelling.replacement, ...selection });
  value.ctx.finishToolSelection = async (_target, range) => Object.assign(selection, range);
  value.assistance.check = async () => ({ issues: [{ word: 'colour', start: 6, end: 12, suggestions: ['color'], reason: 'misspelled' }], nextFrom: null });
  await value.run('text.spelling.open', {}, value.versioned());
  const target = () => ({ windowId: 'notes-main', control: 'word', toolId: value.state.spelling.toolId,
    value: value.state.spelling.replacement, start: selection.start, end: selection.end });
  expect((await value.run('text.tools.clipboard', { operation: 'copy' }, target())).status).toBe('applied');
  expect(value.clipboard.text).toBe('color');
  expect((await value.run('text.tools.clipboard', { operation: 'cut' }, target())).status).toBe('applied');
  expect(value.state.spelling.replacement).toBe(''); expect(noteWorkspaceText(value.note())).toBe('Title\ncolour');
  expect((await value.run('text.tools.clipboard', { operation: 'undo' }, target())).status).toBe('applied');
  expect(value.state.spelling.replacement).toBe('color'); expect([selection.start, selection.end]).toEqual([0, 5]);
});
test('modal or retained-root unavailability preserves the Find draft but withdraws live revision and matches', async () => {
  const value = fixture(); await value.run('text.find.open'); await value.run('text.find.configure', { query: 'cat' });
  const before = value.tools.targets().find, text = noteWorkspaceText(value.note());
  expect(before.count).toBe(4);
  value.ctx.available = () => false;
  expect(value.tools.targets().find).toBeNull();
  expect(noteWorkspaceText(value.note())).toBe(text);
  value.ctx.available = () => true;
  expect(value.tools.targets().find).toMatchObject({ query: 'cat', count: before.count, revision: before.revision });
});

test('cross-run substitutions retain surrounding marks, table cells and one canonical history entry', async () => {
  const value = fixture('Title\nhello cat -- "world"');
  value.note().document.blocks[1].runs = [
    { text: 'hello ', marks: ['underline'] }, { text: 'ca', marks: ['bold'] },
    { text: 't', marks: ['italic'] }, { text: ' -- "world"', marks: ['strike'] },
  ];
  value.note().document.blocks.push({ id: 'table-rich', type: 'table', rows: [[[{ text: 'Keep', marks: ['italic'] }]]] });
  await value.run('text.replacements.set', { replacements: [{ from: 'cat', to: 'dog' }] }, { windowId: 'notes-main' });
  await value.run('text.preferences.set', { textReplacement: true, smartDashes: true, smartQuotes: true }, { windowId: 'notes-main' });
  expect((await value.run('text.substitutions.apply', {}, value.versioned())).status).toBe('applied');
  expect(noteWorkspaceText(value.note())).toBe('Title\nhello dog — “world”\nKeep');
  expect(value.note().document.blocks[1].runs[0]).toEqual({ text: 'hello ', marks: ['underline'] });
  expect(value.note().document.blocks[1].runs.at(-1).marks).toEqual(['strike']);
  expect(value.note().document.blocks[2].rows[0][0]).toEqual([{ text: 'Keep', marks: ['italic'] }]);
  expect(value.note().undo).toHaveLength(1);
});

test('locking a note withdraws previously cached spelling words and Find selection text', async () => {
  const value = fixture('Secret\ncolour');
  await value.run('text.find.open'); await value.run('text.find.configure', { query: 'Secret' });
  value.assistance.check = async () => ({ issues: [{ word: 'colour', start: 7, end: 13, suggestions: ['color'], reason: 'misspelled' }], nextFrom: null });
  await value.run('text.spelling.open', {}, value.versioned());
  value.note().lock = { secret: 'fictional', hint: '', unlocked: false };
  const projected = value.tools.targets();
  expect(projected.find).toBeNull(); expect(projected.spelling).toBeNull(); expect(projected.panel).toBeNull();
  expect(JSON.stringify(projected)).not.toContain('colour');
  expect(JSON.stringify(projected)).not.toContain('Secret');
  expect((await value.run('text.spelling.replace', { replacement: 'color' }, { ...value.versioned(), start: 7, end: 13 })).status).toBe('rejected');
});

test('same-ID note or mounted facade replacement does not inherit an awaited original rich source lease', async () => {
  const value = fixture(); await value.run('text.find.open'); await value.run('text.find.configure', { query: 'cat', replacement: 'dog' });
  const gate = deferred(); value.ctx.prepareDocument = async () => { await gate.promise; return true; };
  const pending = value.run('text.find.replace', { all: true }, value.versioned());
  const original = value.ctx.getDocument;
  value.ctx.getDocument = target => { const source = original(target); return source && { ...source, view: { ...source.view } }; };
  gate.resolve(); expect((await pending).error.code).toBe('stale_target');
  expect(noteWorkspaceText(value.note())).toBe('cat Title\ncat Cat concatenate a+b 😀'); expect(value.note().undo).toHaveLength(0);
});

test('Find replacement at a bold paragraph start and across rich runs inherits selected marks without flattening other runs', async () => {
  const value = fixture('cat tail');
  value.note().document.blocks[0].runs = [
    { text: 'ca', marks: ['bold'] }, { text: 't', marks: ['italic'] }, { text: ' tail', marks: ['underline'] },
  ];
  await value.run('text.find.open'); await value.run('text.find.configure', { query: 'cat', replacement: 'dog' });
  expect((await value.run('text.find.replace', {}, value.versioned())).status).toBe('applied');
  expect(value.note().document.blocks[0].runs).toEqual([
    { text: 'dog', marks: ['bold'] }, { text: ' tail', marks: ['underline'] },
  ]);
  expect(value.note().undo[0].document.blocks[0].runs).toEqual([
    { text: 'ca', marks: ['bold'] }, { text: 't', marks: ['italic'] }, { text: ' tail', marks: ['underline'] },
  ]);
});

test('boundary-spanning Find ranges reject rather than flatten paragraphs', async () => {
  const value = fixture('cat\ncat'), before = structuredClone(value.note().document);
  expect((await value.run('text.find.useSelection', {}, { ...value.versioned(), start: 0, end: 7 })).error.code).toBe('invalid_arguments');
  await value.run('text.find.open'); await value.run('text.find.configure', { query: 'cat\ncat', replacement: 'flat' });
  expect((await value.run('text.find.replace', { all: true }, value.versioned())).error.code).toBe('invalid_arguments');
  expect(value.note().document).toEqual(before); expect(value.note().undo).toHaveLength(0);
});

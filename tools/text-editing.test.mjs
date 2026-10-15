import { test, expect } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createNotesWorkspace, createNotesWorkspaceWindow, noteWorkspaceText } from '../frontend/src/notes-workspace-state.js';
import { createNotesWorkspaceCommands } from '../frontend/src/notes-workspace-commands.js';
import { createTextEditingCommands } from '../frontend/src/text-editing-commands.js';
import { documentFromText, firstDocumentSelection } from '../frontend/src/notes-workspace-document.js';
import { noteRichAnnotations } from '../frontend/src/text-annotations.js';

function fixture(text = 'Title\nabc') {
  const profile = getOSProfile('macos-golden-gate-27.0.1'), notes = createNotesWorkspace(profile), note = notes.notes[0];
  note.document = documentFromText(text); note.pinned = true;
  const window = { id: 'notes-main', appId: 'notes' };
  const session = createNotesWorkspaceWindow(notes, window.id, { noteId: note.id, standalone: false });
  let selection = firstDocumentSelection(note.document), available = true, budget = true;
  const clipboard = { kind: 'empty', text: '', fileIds: [] };
  notes.windows.push(session);
  const view = { available: () => available, ownsNote: owner => owner === note && session.selectedId === note.id,
    captureSelection: () => ({ ...selection }), restoreSelection: next => { selection = { ...next }; return available; }, captureSearch: () => null };
  const native = createNotesWorkspaceCommands({ profile, getState: () => notes, getWindow: id => id === window.id ? window : null,
    getView: () => view, available: () => available, alive: () => true, tick: async () => {}, getSceneTime: () => 1800000000000,
    canCommit: () => budget, getClipboard: () => clipboard,
    setClipboard: (value, ownership) => {
      if (!ownership.guard()) return { status: 'rejected', error: { code: 'stale_target' } };
      if (!budget) return { status: 'rejected', error: { code: 'limit_exceeded' } };
      if (value.onCommit && !value.onCommit()) return { status: 'rejected', error: { code: 'stale_target' } };
      Object.assign(clipboard, { kind: value.kind, text: value.text, fileIds: value.fileIds }); return { status: 'applied' };
    } });
  const ctx = { dataAvailable: () => true, available: () => available, getView: () => view, prepare: async () => available,
    invoke: (name, target, payload) => native.handlers[name](target, payload) };
  const editing = createTextEditingCommands(notes, clipboard, ctx);
  const target = (start = 0, end = start) => ({ windowId: window.id, noteId: note.id, control: 'editor', revision: note.revision, start, end });
  return { notes, note, session, view, ctx, clipboard, editing, target, native,
    budget: value => { budget = value; }, unavailable: () => { available = false; },
    run: (name, start, end, payload = {}) => editing.handlers[name](target(start, end), payload) };
}

test('rich replacement preserves unrelated runs, paragraph metadata and real canonical history', async () => {
  const value = fixture(); value.note.document.blocks[1].runs = [{ text: 'a', marks: ['bold'] }, { text: 'bc', marks: ['italic'] }];
  const metadata = { ...value.note.document.blocks[0] };
  expect((await value.run('text.replace', 7, 8, { text: 'Z' })).status).toBe('applied');
  expect(noteWorkspaceText(value.note)).toBe('Title\naZc');
  expect(value.note.document.blocks[0]).toEqual(metadata);
  expect(value.note.document.blocks[1].runs.at(-1)).toEqual({ text: 'c', marks: ['italic'] });
  expect(value.note.undo).toHaveLength(1);
  const owner = value.target(); delete owner.start; delete owner.end;
  expect((await value.editing.handlers['text.undo'](owner, {})).status).toBe('applied');
  expect(noteWorkspaceText(value.note)).toBe('Title\nabc');
  expect(value.note.document.blocks[1].runs).toEqual([{ text: 'a', marks: ['bold'] }, { text: 'bc', marks: ['italic'] }]);
});

test('cross-block ranges and title/body legacy owners reject without flattening', async () => {
  const value = fixture(), before = structuredClone(value.notes);
  expect((await value.run('text.replace', 3, 8, { text: 'flat' })).error.code).toBe('invalid_arguments');
  expect((await value.editing.handlers['text.replace']({ ...value.target(), control: 'body' }, { text: 'flat' })).error.code).toBe('invalid_arguments');
  expect(value.notes).toEqual(before);
});

test('original revision, caret and presentation are retained through asynchronous preparation', async () => {
  const value = fixture(); let release; value.ctx.prepare = () => new Promise(resolve => { release = resolve; });
  const pending = value.run('text.replace', 6, 7, { text: 'X' });
  value.view.restoreSelection({ ...firstDocumentSelection(value.note.document), start: 1, end: 1 }); release(true);
  expect((await pending).error.code).toBe('stale_target'); expect(noteWorkspaceText(value.note)).toBe('Title\nabc');
});

test('cut shares the canonical atomic clipboard reservation and budget failure leaves both owners unchanged', async () => {
  const value = fixture(), before = structuredClone(value.notes); value.budget(false);
  expect((await value.run('text.clipboard.cut', 6, 7)).error.code).toBe('limit_exceeded');
  expect(value.notes).toEqual(before); expect(value.clipboard.kind).toBe('empty');
  value.budget(true); expect((await value.run('text.clipboard.cut', 6, 7)).status).toBe('applied');
  expect(noteWorkspaceText(value.note)).toBe('Title\nbc'); expect(value.clipboard.text).toBe('a');
});

test('locked note source, history projection and decorations never expose content', async () => {
  const value = fixture('Secret\nprivate'); value.note.lock = { secret: 'fictional', hint: '', unlocked: false };
  expect((await value.run('text.clipboard.copy', 0, 6)).status).toBe('rejected');
  expect(value.editing.targets().history.notes.some(note => note.noteId === value.note.id)).toBe(false);
  expect(noteRichAnnotations(value.note, firstDocumentSelection(value.note.document), { highlights: [{ start: 0, end: 6 }] })).toEqual({ value: '', segments: [] });
});

test('table-cell offsets annotate and replace only their original cell', async () => {
  const value = fixture('Title'); value.note.document.blocks.push({ id: 'table-1', type: 'table', rows: [[[{ text: 'A😀B', marks: ['bold'] }], [{ text: 'second', marks: ['italic'] }]]] });
  const cell = { blockId: 'table-1', row: 0, column: 0, start: 1, end: 3, direction: 'forward' };
  const annotation = noteRichAnnotations(value.note, cell, { highlights: [{ start: 7, end: 9 }] });
  expect(annotation.value).toBe('A😀B'); expect(annotation.segments.find(segment => segment.find).text).toBe('😀');
  expect((await value.run('text.replace', 7, 9, { text: 'X' })).status).toBe('applied');
  expect(value.note.document.blocks[1].rows[0][0]).toEqual([{ text: 'AXB', marks: ['bold'] }]);
  expect(value.note.document.blocks[1].rows[0][1]).toEqual([{ text: 'second', marks: ['italic'] }]);
});

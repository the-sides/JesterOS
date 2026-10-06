import { expect, test } from 'bun:test';
import { createNotesState, setSearch, updateNote, visibleNotes } from '../frontend/src/notes-state.js';
import { createTextEditingCommands, noteTextControlValue } from '../frontend/src/text-editing-commands.js';

const clone = value => structuredClone(value);
const MAX_TEXT = 1024 * 1024, MAX_TIME = 8_640_000_000_000_000 - 1;
const caret = (start = 0, end = start, direction = 'none') => ({ start, end, direction });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function model() {
  const notes = createNotesState(), clipboard = { kind: 'empty', text: '', fileIds: [] };
  const native = { visible: true, awake: true, connected: true, owner: 'notes-main', focused: null,
    selections: { title: caret(), body: caret(), search: caret() } };
  let engine;
  const currentRevision = target => target.control === 'search' ? engine.targets().searchRevision
    : notes.notes.find(note => note.id === target.noteId)?.updatedAt;
  const context = {
    available: () => native.visible && native.awake,
    dataAvailable: () => native.awake,
    getSource: target => {
      if (!native.connected || !native.visible || target.windowId !== native.owner) return null;
      const note = target.control === 'search' ? undefined : notes.notes.find(item => item.id === target.noteId);
      if (target.control !== 'search' && (!note || note.id !== notes.selectedId || !visibleNotes(notes).includes(note))) return null;
      return { note, value: target.control === 'search' ? notes.search.replace(/[\r\n]/g, '') : noteTextControlValue(note, target.control),
        selection: { ...native.selections[target.control] }, readOnly: Boolean(note?.deleted) };
    },
    prepare: async target => {
      if (!context.getSource(target)) return false;
      native.focused = { windowId: target.windowId, control: target.control, noteId: target.noteId };
      return true;
    },
    finishSelection: async (target, range, revision) => {
      if (!context.getSource(target) || currentRevision(target) !== revision) return;
      native.focused = { windowId: target.windowId, control: target.control, noteId: target.noteId };
      native.selections[target.control] = { ...range };
    },
    canCommitNote: () => true, canCommitSearch: () => true, onChanged: () => {},
  };
  engine = createTextEditingCommands(notes, clipboard, context);
  return { notes, clipboard, native, context, engine,
    run: (name, target = {}, payload = {}) => engine.handlers[name](target, payload),
    note: () => notes.notes.find(note => note.id === notes.selectedId),
    target: (control = 'body', start = 0, end = start) => ({ windowId: native.owner, control,
      revision: control === 'search' ? engine.targets().searchRevision : notes.notes.find(note => note.id === notes.selectedId).updatedAt,
      start, end, ...(control === 'search' ? {} : { noteId: notes.selectedId }) }),
    snapshot: () => clone({ notes, clipboard, selections: native.selections, targets: engine.targets() }),
  };
}
const owner = target => { const { start, end, ...identity } = target; return identity; };
const history = value => value.engine.targets().history.notes.find(item => item.noteId === value.notes.selectedId);

test('owned title and body use real canonical UTF-16 values and preserve the untouched raw field', async () => {
  const value = model(), note = value.note();
  note.text = '  Ti\rtle\r\nA\r\nB\rC  ';
  expect(noteTextControlValue(note, 'title')).toBe('  Title');
  expect(noteTextControlValue(note, 'body')).toBe('A\nB\nC  ');
  const creation = note.createdAt, pin = note.pinned;
  expect((await value.run('text.replace', value.target('title', 2, 7), { text: 'New\r\nTitle' })).status).toBe('applied');
  expect(note.text).toBe('  NewTitle\nA\r\nB\rC  ');
  const titleRaw = note.text.split('\n')[0];
  const body = value.target('body', 2, 3);
  const response = await value.run('text.replace', body, { text: '😀\r\nZ\rQ', label: 'typing' });
  expect(response.target).toEqual({ ...body, revision: note.updatedAt, start: 8, end: 8 });
  expect(note.text).toBe(`${titleRaw}\nA\n😀\nZ\nQ\nC  `);
  expect(note.createdAt).toBe(creation); expect(note.pinned).toBe(pin);
  expect(value.native.selections.body).toEqual(caret(8));
});

test('native selection, copy, cut and paste operate on exact ranges and a page-local clipboard', async () => {
  const value = model(), note = value.note(); note.text = 'Title\nzero 😀 two';
  const range = value.target('body', 5, 7);
  expect((await value.run('text.selection.set', range, { direction: 'backward' })).status).toBe('applied');
  expect(value.native.selections.body).toEqual(caret(5, 7, 'backward'));
  const clock = note.updatedAt;
  value.clipboard.kind = 'files'; value.clipboard.fileIds = ['file-1'];
  expect((await value.run('text.clipboard.copy', range)).target).toEqual(range);
  expect(value.clipboard).toEqual({ kind: 'text', text: '😀', fileIds: [] });
  expect(note.updatedAt).toBe(clock); expect(history(value)).toBeUndefined();
  expect((await value.run('text.clipboard.cut', range)).status).toBe('applied');
  expect(note.text).toBe('Title\nzero  two');
  expect(value.native.selections.body).toEqual(caret(5));
  expect((await value.run('text.clipboard.paste', value.target('body', 5))).status).toBe('applied');
  expect(note.text).toBe('Title\nzero 😀 two');
  expect(history(value)).toMatchObject({ undoCount: 2, redoCount: 0 });
});

test('Deleted is selectable/copyable but cut, paste, replacement and undo cannot mutate it', async () => {
  const value = model(); value.notes.folder = 'deleted'; value.notes.search = '';
  value.notes.selectedId = value.notes.notes.find(note => note.deleted).id;
  const note = value.note(), range = value.target('title', 0, 3), text = noteTextControlValue(note, 'title').slice(0, 3);
  expect((await value.run('text.selection.set', range)).status).toBe('applied');
  expect((await value.run('text.clipboard.copy', range)).status).toBe('applied');
  expect(value.clipboard.text).toBe(text);
  for (const command of ['text.clipboard.cut', 'text.clipboard.paste', 'text.replace', 'text.undo', 'text.redo']) {
    const before = value.snapshot();
    const result = await value.run(command, ['text.undo', 'text.redo'].includes(command) ? owner(range) : range,
      command === 'text.replace' ? { text: 'No' } : {});
    expect(result.error.code).toBe('read_only'); expect(value.snapshot()).toEqual(before);
  }
});

test('closed targets reject malformed ranges, wrong ownership and stale revision atomically', async () => {
  const value = model(); value.note().text = 'Title\nabc';
  const base = value.target('body', 0, 1);
  for (const patch of [{ start: -1 }, { start: 2, end: 1 }, { end: 1.5 }, { end: Number.MAX_SAFE_INTEGER + 1 },
    { noteId: undefined }, { extra: true }, { windowId: '' }]) {
    const before = value.snapshot();
    expect((await value.run('text.replace', { ...base, ...patch }, { text: 'x' })).error.code).toBe('invalid_arguments');
    expect(value.snapshot()).toEqual(before);
  }
  for (const patch of [{ end: 4 }, { windowId: 'other-window' }, { noteId: 'missing-note' }, { revision: base.revision - 1 }]) {
    const before = value.snapshot();
    expect((await value.run('text.replace', { ...base, ...patch }, { text: 'x' })).error.code).toBe('stale_target');
    expect(value.snapshot()).toEqual(before);
  }
  expect((await value.run('text.replace', { ...value.target('search'), noteId: value.notes.selectedId }, { text: 'x' })).error.code).toBe('invalid_arguments');
  expect((await value.run('text.undo', base)).error.code).toBe('invalid_arguments');
});

test('asynchronous focus cannot retarget an owner, content, revision or native selection', async () => {
  for (const alter of [value => { value.native.owner = 'new-owner'; }, value => { value.notes.selectedId = 'note-2'; },
    value => { value.note().text += 'external'; }, value => { value.note().updatedAt++; },
    value => { value.native.selections.body = caret(1); }, value => { value.native.connected = false; },
    value => { value.native.awake = false; }]) {
    const value = model(), entered = deferred(), release = deferred(); value.note().text = 'Title\nabc';
    value.context.prepare = async () => { entered.resolve(); await release.promise; return true; };
    const pending = value.run('text.clipboard.cut', value.target('body', 0, 1));
    await entered.promise; alter(value); const changed = value.snapshot(); release.resolve();
    expect((await pending).error.code).toBe('stale_target'); expect(value.snapshot()).toEqual(changed);
  }
});

test('undo/redo restore complete title/body text and original selection, retain monotonic metadata, then branch locally', async () => {
  const value = model(), note = value.note(); note.text = 'Original\nabcdef';
  const creation = note.createdAt, pin = note.pinned;
  value.native.selections.body = caret(1, 3, 'backward');
  await value.run('text.replace', value.target('body', 1, 3), { text: 'XX', label: 'typing' });
  await value.run('text.replace', value.target('title', 0, 8), { text: 'Changed', label: 'substitution' });
  let clock = note.updatedAt;
  await value.run('text.undo', owner(value.target('body')));
  expect(note.text).toBe('Original\naXXdef'); expect(note.updatedAt).toBeGreaterThan(clock); clock = note.updatedAt;
  await value.run('text.undo', owner(value.target('title')));
  expect(note.text).toBe('Original\nabcdef'); expect(value.native.selections.body).toEqual(caret(1, 3, 'backward'));
  expect(note.updatedAt).toBeGreaterThan(clock); clock = note.updatedAt;
  await value.run('text.redo', owner(value.target('title')));
  expect(note.text).toBe('Original\naXXdef'); expect(note.updatedAt).toBeGreaterThan(clock);
  await value.run('text.replace', value.target('body', 0, 1), { text: 'NEW' });
  expect(history(value)).toMatchObject({ undoCount: 2, redoCount: 0, canRedo: false });
  expect((await value.run('text.redo', owner(value.target('body')))).error.code).toBe('disabled');
  expect(note.createdAt).toBe(creation); expect(note.pinned).toBe(pin);
});

test('pure legacy edits are source-neutral genuine history and stay isolated across notes and search', async () => {
  const value = model(), first = value.note(), original = first.text;
  value.native.visible = false; value.native.connected = false;
  expect(value.run('notes.edit', { noteId: first.id }, { text: 'First\nbody' }).status).toBe('applied');
  value.notes.selectedId = 'note-2'; const second = value.note(), secondOriginal = second.text;
  value.run('notes.edit', { noteId: second.id }, { text: 'Second\nbody' });
  value.native.visible = true; value.native.connected = true;
  await value.run('text.undo', owner(value.target('body')));
  expect(second.text).toBe(secondOriginal); expect(first.text).toBe('First\nbody');
  value.notes.selectedId = first.id;
  await value.run('text.undo', owner(value.target('body'))); expect(first.text).toBe(original);
  await value.run('text.redo', owner(value.target('body'))); expect(first.text).toBe('First\nbody');
  value.run('notes.search', {}, { query: 'First' }); const revision = value.engine.targets().searchRevision;
  await value.run('text.replace', value.target('search', 5), { text: '\r\n body' });
  expect(value.notes.search).toBe('First body'); expect(value.engine.targets().searchRevision).toBeGreaterThan(revision);
  await value.run('text.undo', owner(value.target('search'))); expect(value.notes.search).toBe('First');
  await value.run('text.redo', owner(value.target('search'))); expect(value.notes.search).toBe('First body');
  expect(value.engine.targets().history.notes.find(item => item.noteId === second.id)).toMatchObject({ canRedo: true });
});

test('undo refuses complete-text external edits instead of clobbering an untouched field', async () => {
  const value = model(); value.note().text = 'Title\nbody';
  await value.run('text.replace', value.target('body', 0, 4), { text: 'new' });
  updateNote(value.notes, value.notes.selectedId, 'External title\nnew');
  const before = value.snapshot();
  expect((await value.run('text.undo', owner(value.target('body')))).error.code).toBe('stale_target');
  expect(value.snapshot()).toEqual(before);
  value.run('notes.search', {}, { query: 'External' }); setSearch(value.notes, 'new');
  const searchBefore = value.snapshot();
  expect((await value.run('text.undo', owner(value.target('search')))).error.code).toBe('stale_target');
  expect(value.snapshot()).toEqual(searchBefore);
});

test('clipboard kind, empty text, per-value limits and root isolation are real data behavior', async () => {
  const value = model(), other = model(); value.note().text = 'Title\nbody';
  for (const kind of ['empty', 'files']) {
    value.clipboard.kind = kind; value.clipboard.text = ''; value.clipboard.fileIds = kind === 'files' ? ['file-1'] : [];
    const before = value.snapshot();
    expect((await value.run('text.clipboard.paste', value.target('body'))).error.code).toBe('disabled');
    expect(value.snapshot()).toEqual(before);
  }
  const emptySelection = value.snapshot();
  expect((await value.run('text.clipboard.copy', value.target('body', 0, 0))).error.code).toBe('disabled');
  expect(value.snapshot()).toEqual(emptySelection);
  const clock = value.note().updatedAt;
  await value.run('text.clipboard.paste', value.target('body'));
  expect(value.note().updatedAt).toBe(clock); expect(history(value)).toBeUndefined();
  value.clipboard.kind = 'text'; value.clipboard.fileIds = [];
  value.clipboard.text = 'x'.repeat(MAX_TEXT + 1); const before = value.snapshot();
  expect((await value.run('text.clipboard.paste', value.target('body'))).error.code).toBe('limit_exceeded');
  expect(value.snapshot()).toEqual(before); expect(other.clipboard.kind).toBe('empty');
});

test('date, quota and failed preparation preserve data clocks, selection, clipboard and private history', async () => {
  for (const constrain of [value => { value.notes.notes[1].updatedAt = MAX_TIME; },
    value => { value.context.canCommitNote = () => false; }, value => { value.context.prepare = async () => false; }]) {
    const value = model(); value.note().text = 'Title\nbody'; value.native.selections.body = caret(0, 4, 'backward');
    constrain(value); const before = value.snapshot();
    expect((await value.run('text.clipboard.cut', value.target('body', 0, 4))).status).toBe('rejected');
    expect(value.snapshot()).toEqual(before);
    expect(value.run('notes.edit', { noteId: value.notes.selectedId }, { text: value.note().text }).status).toBe('applied');
    expect(value.snapshot()).toEqual(before);
  }
  const value = model(); value.context.canCommitSearch = () => false;
  const before = value.snapshot();
  expect(value.run('notes.search', {}, { query: 'x' }).error.code).toBe('limit_exceeded');
  expect((await value.run('text.replace', value.target('search'), { text: 'x' })).error.code).toBe('limit_exceeded');
  expect(value.snapshot()).toEqual(before);
});

test('quotas changed during focus reject before cut changes the clipboard or history', async () => {
  const value = model(), entered = deferred(), release = deferred(); value.note().text = 'Title\nbody';
  value.context.prepare = async () => { entered.resolve(); await release.promise; return true; };
  const pending = value.run('text.clipboard.cut', value.target('body', 0, 4));
  await entered.promise; value.context.canCommitNote = () => false;
  const before = value.snapshot(); release.resolve();
  expect((await pending).error.code).toBe('limit_exceeded'); expect(value.snapshot()).toEqual(before);
});

test('successful commits cannot be turned into rejection or steal another owner by post-render selection', async () => {
  const value = model(); value.note().text = 'Title\nbody';
  value.context.finishSelection = async () => { value.native.owner = 'other-owner'; throw new Error('Disconnected after commit'); };
  const result = await value.run('text.replace', value.target('body', 0, 4), { text: 'Committed' });
  expect(result.status).toBe('applied'); expect(value.note().text).toBe('Title\nCommitted');
  expect(value.native.selections.body).toEqual(caret()); expect(value.native.owner).toBe('other-owner');
});

test('per-control and aggregate text budgets reject without a partial replacement or history transaction', async () => {
  const value = model(); value.note().text = 'T\n' + 'x'.repeat(MAX_TEXT - 2);
  let before = value.snapshot();
  expect((await value.run('text.replace', value.target('body'), { text: 'x' })).error.code).toBe('limit_exceeded');
  expect(value.snapshot()).toEqual(before);
  expect(value.run('notes.edit', { noteId: value.notes.selectedId }, { text: 'x'.repeat(MAX_TEXT + 1) }).error.code).toBe('limit_exceeded');
  expect(value.snapshot()).toEqual(before);
  value.run('notes.search', {}, { query: 'x'.repeat(4096) });
  before = value.snapshot();
  expect((await value.run('text.replace', value.target('search', 4096), { text: 'x' })).error.code).toBe('limit_exceeded');
  expect(value.snapshot()).toEqual(before);
  value.notes.search = ''; value.notes.selectedId = 'note-1';
  for (const note of value.notes.notes) note.text = 'x'.repeat(MAX_TEXT);
  before = value.snapshot();
  expect(value.run('notes.search', {}, { query: 'x' }).error.code).toBe('limit_exceeded');
  expect(value.snapshot()).toEqual(before);
});

test('empty-body and canonical equal-value replacements do not create delimiters, tick dates or record undo', async () => {
  const value = model(); value.note().text = 'Raw\rTitle';
  const before = value.snapshot();
  expect((await value.run('text.replace', value.target('body'), { text: '' })).status).toBe('applied');
  expect((await value.run('text.replace', value.target('title', 0, 8), { text: 'RawTitle' })).status).toBe('applied');
  expect(value.note().text).toBe(before.notes.notes[0].text);
  expect(value.note().updatedAt).toBe(before.notes.notes[0].updatedAt);
  expect(history(value)).toBeUndefined();
});

test('history is bounded globally by 64 transactions and four Mi UTF-16 retained text, metadata is detached', async () => {
  const value = model(); value.note().text = 'Title\n';
  for (let index = 0; index < 70; index++) value.run('notes.edit', { noteId: value.notes.selectedId }, { text: `Title\n${index}` });
  expect(history(value).undoCount).toBe(64);
  const detached = value.engine.targets(); detached.clipboard.fileIds.push('bad'); detached.history.notes[0].undoCount = -1;
  expect(history(value).undoCount).toBe(64); expect(value.clipboard.fileIds).toEqual([]);
  const large = 'L'.repeat(700_000);
  for (let index = 0; index < 5; index++) value.run('notes.edit', { noteId: value.notes.selectedId }, { text: `${index}\n${large}` });
  expect(history(value).undoCount).toBeLessThanOrEqual(3);
});

test('ambiguous repeated-character typing keeps the actual native insertion caret across undo and redo', async () => {
  const value = model(); value.note().text = 'Title\naaa'; value.native.selections.body = caret(0);
  expect((await value.run('text.replace', value.target('body', 3), { text: 'a', label: 'typing', cursor: 1 })).status).toBe('applied');
  expect(value.note().text).toBe('Title\naaaa'); expect(value.native.selections.body).toEqual(caret(1));
  await value.run('text.undo', owner(value.target('body')));
  expect(value.note().text).toBe('Title\naaa'); expect(value.native.selections.body).toEqual(caret(0));
  await value.run('text.redo', owner(value.target('body')));
  expect(value.note().text).toBe('Title\naaaa'); expect(value.native.selections.body).toEqual(caret(1));
});

test('composition document commits retain exact before and after native selection for history', async () => {
  const value = model(); value.note().text = 'Title\nabc'; value.native.selections.body = caret(1, 2, 'backward');
  expect(value.engine.editDocument(value.notes.selectedId, 'Title\na漢c', 'typing',
    { control: 'body', before: caret(1, 2, 'backward'), after: caret(2) }).status).toBe('applied');
  value.native.selections.body = caret(2);
  await value.run('text.undo', owner(value.target('body')));
  expect(value.note().text).toBe('Title\nabc'); expect(value.native.selections.body).toEqual(caret(1, 2, 'backward'));
  await value.run('text.redo', owner(value.target('body')));
  expect(value.note().text).toBe('Title\na漢c'); expect(value.native.selections.body).toEqual(caret(2));
});

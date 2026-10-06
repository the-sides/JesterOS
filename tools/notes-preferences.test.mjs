import { expect, test } from 'bun:test';
import { createNotesState, createNote, visibleNotes, groupNotes } from '../frontend/src/notes-state.js';
import { notesPreferencesDefaults } from '../frontend/src/notes-preferences.js';

const DAY = 86400000;
const time = Date.UTC(2026, 9, 6, 0, 30);
const note = (id, text, createdAt, updatedAt = createdAt, fields = {}) => ({ id, text, createdAt, updatedAt, pinned: false, deleted: false, ...fields });
function state(notes, preferences = {}) {
  return { timeBase: time, notes, folder: 'notes', search: '', selectedId: notes[0]?.id ?? null,
    preferences: { ...notesPreferencesDefaults(), ...preferences } };
}
const ids = notes => notes.map(note => note.id);

test('pin precedence survives every preference sort and edited/created orders differ', () => {
  const model = state([
    note('edited', 'Zebra', time - 10 * DAY, time),
    note('created', 'Alpha', time - DAY),
    note('pinned', 'Zulu', time - 20 * DAY, undefined, { pinned: true }),
  ]);
  expect(ids(visibleNotes(model))).toEqual(['pinned', 'edited', 'created']);
  model.preferences.sortBy = 'date-created';
  expect(ids(visibleNotes(model))).toEqual(['pinned', 'created', 'edited']);
  model.preferences.sortBy = 'title';
  expect(ids(visibleNotes(model))).toEqual(['pinned', 'created', 'edited']);
});

test('natural case-insensitive title ties are deterministic without modifying selection or records', () => {
  const model = state([
    note('z', 'Item 2', time), note('ten', 'Item 10', time),
    note('a', 'item 2', time), note('one', 'Item 1', time),
  ], { sortBy: 'title' });
  const before = structuredClone(model);
  expect(ids(visibleNotes(model))).toEqual(['one', 'a', 'z', 'ten']);
  expect(groupNotes(model).map(group => [group.id, ids(group.notes)])).toEqual([['notes', ['one', 'a', 'z', 'ten']]]);
  expect(model).toEqual(before);
  model.preferences.sortBy = 'date-edited';
  expect(ids(visibleNotes(model))).toEqual(['a', 'one', 'ten', 'z']);
});

test('group boundaries use UTC days and the latest hidden or deleted record rather than host time', () => {
  const midnight = Date.UTC(2026, 9, 6);
  const model = state([
    note('today', 'Today', midnight), note('yesterday', 'Yesterday', midnight - 1),
    note('six', 'Six', midnight - 6 * DAY), note('seven', 'Seven', midnight - 7 * DAY),
    note('twenty-nine', 'Twenty-nine', midnight - 29 * DAY), note('thirty', 'Thirty', midnight - 30 * DAY),
    note('older', 'Older', Date.UTC(2025, 11, 31)),
    note('pin', 'Pin', midnight - 40 * DAY, undefined, { pinned: true }),
  ]);
  const before = structuredClone(model);
  expect(groupNotes(model).map(group => [group.id, ids(group.notes)])).toEqual([
    ['pinned', ['pin']], ['today', ['today']], ['yesterday', ['yesterday']],
    ['previous-7-days', ['six']], ['previous-30-days', ['seven', 'twenty-nine']],
    ['month-2026-9', ['thirty']], ['year-2025', ['older']],
  ]);
  expect(model).toEqual(before);
  model.notes.push(note('clock', 'Hidden clock', midnight + 2 * DAY, undefined, { deleted: true }));
  model.search = 'Today';
  expect(groupNotes(model).map(group => group.id)).toEqual(['previous-7-days']);
});

test('date-created grouping uses creation date, grouping can be disabled and deleted pins are ordinary notes', () => {
  const model = state([
    note('old', 'Old', time - 10 * DAY, time),
    note('new', 'New', time - DAY),
  ], { sortBy: 'date-created' });
  expect(groupNotes(model).map(group => [group.id, ids(group.notes)])).toEqual([
    ['yesterday', ['new']], ['previous-30-days', ['old']],
  ]);
  model.preferences.groupByDate = false;
  expect(groupNotes(model).map(group => [group.id, ids(group.notes)])).toEqual([['notes', ['new', 'old']]]);
  model.folder = 'deleted';
  model.notes[0].deleted = true;
  model.notes[0].pinned = true;
  model.notes[1].deleted = true;
  expect(groupNotes(model).map(group => [group.id, ids(group.notes)])).toEqual([['notes', ['new', 'old']]]);
  model.preferences.groupByDate = true;
  expect(groupNotes(model).map(group => group.id)).toEqual(['yesterday', 'previous-30-days']);
  model.search = 'missing';
  expect(groupNotes(model)).toEqual([]);
});

test('creating selected plaintext is one timestamped operation and historical sort remains unchanged', () => {
  const model = createNotesState();
  const latest = Math.max(model.timeBase, ...model.notes.flatMap(note => [note.createdAt, note.updatedAt]));
  const text = '  Selected title\r\n\nExact body  ';
  const id = createNote(model, text);
  const created = model.notes.find(note => note.id === id);
  expect(created.text).toBe(text);
  expect(created.createdAt).toBe(latest + 1);
  expect(created.updatedAt).toBe(created.createdAt);
  expect(model.selectedId).toBe(id);
  expect(model.preferences).toBeUndefined();
  const blank = createNote(model);
  expect(model.notes.find(note => note.id === blank).text).toBe('');
  expect(ids(visibleNotes(model))).toEqual(['note-1', blank, id, 'note-2', 'note-3']);
});

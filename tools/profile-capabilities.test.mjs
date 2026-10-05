import { test, expect } from 'bun:test';
import { createFeatureCommands } from '../frontend/src/feature-commands.js';
import { createNotesCommands } from '../frontend/src/notes-commands.js';
import { createNotesState, createNote, updateNote } from '../frontend/src/notes-state.js';
import { commandCatalog } from '../frontend/src/command-catalog.js';
import { DEFAULT_PROFILE_ID, getOSProfile } from '../frontend/src/os-profiles.js';

// Real domain handlers/models: a profile boundary must reject before writing,
// even when the command's JSON arguments are otherwise valid.
test('uninstalled profiles and missing capabilities cannot write Notes data', async () => {
  const profile = getOSProfile(DEFAULT_PROFILE_ID);
  let activeProfile = profile;
  const notes = createNotesState();
  notes.folder = 'deleted';
  notes.search = 'existing query';
  notes.selectedId = notes.notes.find((note) => note.deleted).id;
  const view = {};
  const handlers = createNotesCommands(notes, view, {
    getView: () => null,
    isVisible: () => false,
    focusWindow: () => { throw new Error('Data-only command must not request window focus.'); },
  });
  const catalog = Object.fromEntries(Object.keys(handlers).map((name) => [name, commandCatalog[name]]));
  const api = createFeatureCommands(handlers,
    () => structuredClone({ notes, view }), async () => {}, catalog,
    () => ({ noteIds: notes.notes.map((note) => note.id) }), () => activeProfile, commandCatalog);
  const before = structuredClone({ notes, view });
  for (const unsupported of [null, { ...profile, id: 'uninstalled-windows-profile' }, { ...profile, capabilities: [] }]) {
    activeProfile = unsupported;
    const result = await api.execute({ command: 'notes.create', requestId: 'blocked-write' });
    expect(result.status).toBe('rejected');
    expect(result.error.code).toBe('unsupported_profile');
    expect(result.requestId).toBe('blocked-write');
    expect({ notes, view }).toEqual(before);
  }
  activeProfile = profile;
  const result = await api.execute({ command: 'notes.create' });
  expect(result.status).toBe('applied');
  const created = notes.notes.find((note) => note.id === result.target.noteId);
  expect(created.text).toBe('');
  expect(created.deleted).toBe(false);
  expect(notes.selectedId).toBe(created.id);
  expect(notes.folder).toBe('notes');
  expect(notes.search).toBe('');
});

test('period Notes scenes keep their own clock after editing and empty-collection creation', () => {
  const base = Date.UTC(2017, 8, 25, 17, 0);
  const state = createNotesState(base);
  const latest = Math.max(...state.notes.map((note) => note.updatedAt));
  const selected = state.notes.find((note) => note.id === state.selectedId);
  updateNote(state, selected.id, 'A period-correct fictional note.');
  expect(selected.updatedAt).toBeGreaterThan(latest);
  expect(new Date(selected.updatedAt).getUTCFullYear()).toBe(2017);
  state.notes = [];
  const id = createNote(state);
  const created = state.notes.find((note) => note.id === id);
  expect(created.createdAt).toBeGreaterThan(base);
  expect(new Date(created.createdAt).getUTCFullYear()).toBe(2017);
});

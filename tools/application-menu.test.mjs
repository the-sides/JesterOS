import { expect, test } from 'bun:test';
import { createApplicationMenuCommands } from '../frontend/src/application-menu.js';
import { createDefaultSceneSeed } from '../frontend/src/scene-seed.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { updateNote } from '../frontend/src/notes-state.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');
const sourceWindowId = 'notes-window-2';
// Independent document/view consumer: the service uses the real Notes model;
// native focus preparation can fail or trigger another actor's document change.
function consumer() {
  const notes = createDefaultSceneSeed(profile).notes;
  let activeAppId = 'notes', activeWindowId = sourceWindowId, focus = 'title';
  let focusFailure = false, focusHook;
  const source = target => {
    if (activeAppId !== 'notes' || activeWindowId !== target.windowId || notes.selectedId !== target.noteId) return null;
    const note = notes.notes.find(note => note.id === target.noteId);
    if (!note || note.deleted !== (notes.folder === 'deleted')) return null;
    const split = note.text.indexOf('\n');
    return { note, value: target.control === 'title' ? split === -1 ? note.text : note.text.slice(0, split)
      : split === -1 ? '' : note.text.slice(split + 1) };
  };
  const handlers = createApplicationMenuCommands({ profile, notes, available: () => true,
    getActiveAppId: () => activeAppId, getRunningAppIds: () => ['finder', 'notes', 'safari'],
    isHidden: () => false, isQuitting: () => false, getSource: source,
    captureFocus: () => focus,
    restoreFocus: async token => { if (activeAppId === 'notes' && activeWindowId === sourceWindowId) focus = token; },
    focusServiceBody: async () => {
      if (focusFailure) { focus = 'outside'; return false; }
      focus = 'body'; await focusHook?.(); return true;
    }, noteCreated: () => {},
  });
  return { notes, handlers, focus: () => focus, source,
    failFocus: () => { focusFailure = true; }, onFocus: hook => { focusHook = hook; },
    activateSafari: () => { activeAppId = 'safari'; activeWindowId = 'safari-window-3'; focus = 'safari'; },
    settings: payload => handlers['app.settings.set']({ appId: 'notes' }, payload),
    service: (noteId, control, start, end) => handlers['app.service.perform']({ appId: 'notes', serviceId: 'create-note',
      windowId: sourceWindowId, noteId, control }, { start, end }),
  };
}

test('partial settings retain document data/selection and validate the entire patch before mutation', () => {
  const c = consumer(), documents = structuredClone(c.notes.notes), selectedId = c.notes.selectedId;
  expect(c.settings({ sortBy: 'title' }).status).toBe('applied');
  expect(c.settings({ groupByDate: false, textSize: 24 }).status).toBe('applied');
  const preferences = structuredClone(c.notes.preferences);
  for (const invalid of [{ sortBy: 'date-created', textSize: 25 }, { groupByDate: true, textSize: 11 },
    { sortBy: undefined }, { textSize: NaN }, { textSize: 13.5 }, { groupByDate: 'yes' }, { unknown: true }, {}]) {
    expect(c.settings(invalid).error.code).toBe('invalid_arguments');
    expect(c.notes.preferences).toEqual(preferences);
  }
  expect(c.notes.notes).toEqual(documents); expect(c.notes.selectedId).toBe(selectedId); expect(c.focus()).toBe('title');
  expect(c.settings({ sortBy: 'date-edited', textSize: 12 }).status).toBe('applied');
  expect(c.notes.preferences.groupByDate).toBe(false);
});

test('selection service copies the explicit substring once, retains source, and allocates one complete new editable record', async () => {
  const c = consumer(), sourceId = c.notes.selectedId, original = structuredClone(c.notes.notes), before = c.source({
    windowId: sourceWindowId, noteId: sourceId, control: 'body' }).value;
  const result = await c.service(sourceId, 'body', 7, 76);
  expect(result.status).toBe('applied');
  expect(c.notes.notes.filter(note => note.id !== result.target.noteId)).toEqual(original);
  const created = c.notes.notes.find(note => note.id === result.target.noteId);
  expect(created.text).toBe(before.slice(7, 76)); expect(created.deleted).toBe(false); expect(created.pinned).toBe(false);
  expect(created.createdAt).toBeGreaterThan(Math.max(...original.map(note => note.updatedAt)));
  expect(created.updatedAt).toBe(created.createdAt);
  expect(c.notes.selectedId).toBe(created.id); expect(c.notes.folder).toBe('notes'); expect(c.notes.search).toBe('');
  expect(c.focus()).toBe('body');
});

test('a readonly deleted source can create an editable note without restoring or altering its source', async () => {
  const c = consumer(); c.notes.folder = 'deleted'; c.notes.selectedId = 'note-4';
  const original = structuredClone(c.notes.notes);
  const result = await c.service('note-4', 'title', 0, 16);
  expect(result.status).toBe('applied');
  expect(c.notes.notes.filter(note => note.id !== result.target.noteId)).toEqual(original);
  expect(c.notes.notes.find(note => note.id === result.target.noteId).text).toBe('Old packing list');
  expect(c.notes.folder).toBe('notes'); expect(c.notes.selectedId).toBe(result.target.noteId);
});

test('invalid source ranges and failed native preparation leave every record and original focus unchanged', async () => {
  const c = consumer(), before = structuredClone(c.notes);
  for (const [start, end] of [[0, 0], [3, 2], [-1, 3], [0.5, 3], [0, 10000]]) {
    expect((await c.service('note-1', 'title', start, end)).error.code).toBe('invalid_arguments');
    expect(c.notes).toEqual(before); expect(c.focus()).toBe('title');
  }
  c.failFocus();
  expect((await c.service('note-1', 'body', 0, 10)).error.code).toBe('unavailable');
  expect(c.notes).toEqual(before); expect(c.focus()).toBe('title');
});

test('in-place source edits during native preparation are retained but cannot create a note from stale range data', async () => {
  const c = consumer(), sourceId = c.notes.selectedId;
  c.onFocus(() => updateNote(c.notes, sourceId, 'Changed source\nA different body.'));
  const result = await c.service(sourceId, 'body', 0, 10);
  expect(result.error.code).toBe('stale_target');
  expect(c.notes.notes.map(note => note.id)).toEqual(['note-1', 'note-2', 'note-3', 'note-4']);
  expect(c.notes.notes.find(note => note.id === sourceId).text).toBe('Changed source\nA different body.');
  expect(c.notes.selectedId).toBe(sourceId); expect(c.focus()).toBe('title');
});

test('another app taking foreground during preparation cannot create a note or have its focus stolen', async () => {
  const c = consumer(), before = structuredClone(c.notes);
  c.onFocus(c.activateSafari);
  expect((await c.service('note-1', 'body', 0, 10)).error.code).toBe('stale_target');
  expect(c.notes).toEqual(before); expect(c.focus()).toBe('safari');
});

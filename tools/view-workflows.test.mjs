import { expect, test } from 'bun:test';
import { goldenGateProfile as profile } from '../frontend/src/golden-gate-profile.js';
import { createNotesState, visibleNotes, groupNotes, selectFolder } from '../frontend/src/notes-state.js';
import { createNotesCommands } from '../frontend/src/notes-commands.js';
import { notesPreferencesDefaults } from '../frontend/src/notes-preferences.js';
import { createMacDesktopFileStore } from '../frontend/src/desktop-file-state.js';
import { createMacApplicationFiles } from '../frontend/src/mac-application-files.js';
import { createFeatureCommands } from '../frontend/src/feature-commands.js';
import { createViewWorkflowCommands, viewWorkflowCatalog, VIEW_OPTIONS_CONTROLS } from '../frontend/src/view-workflow-commands.js';
import { viewingDefaults, finderViewDefaults, finderPresentationDefaults, notesPresentationDefaults,
  validateViewing, validFinderPresentation, validNotesPresentation, notesViewProjection } from '../frontend/src/viewing-state.js';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function fixture(proxyPane = false) {
  const notes = createNotesState(); notes.preferences = notesPreferencesDefaults();
  const files = createMacDesktopFileStore(profile, notes.timeBase);
  files.files.push(...createMacApplicationFiles(profile, notes.timeBase));
  const viewing = viewingDefaults(), presentation = { options: null, nextOptionsId: 1, error: null };
  if (proxyPane) {
    let pane = null;
    Object.defineProperty(presentation, 'options', { enumerable: true, get: () => pane,
      set: value => { pane = value ? new Proxy(value, {}) : null; } });
  }
  const windows = [
    { id: 'notes-main', appId: 'notes', minimized: false, notesPresentation: notesPresentationDefaults() },
    { id: 'notes-other', appId: 'notes', minimized: false, notesPresentation: notesPresentationDefaults() },
    { id: 'finder-main', appId: 'finder', folderId: 'desktop', minimized: false, finderBrowseMode: 'icons', finderPresentation: finderPresentationDefaults() },
    { id: 'finder-other', appId: 'finder', folderId: 'desktop', minimized: false, finderBrowseMode: 'icons', finderPresentation: finderPresentationDefaults() },
    { id: 'notes-settings', appId: 'notes', utilityKind: 'notes-settings', minimized: false },
  ];
  let active = 'notes-main', available = true, quota = true, mutations = 0;
  const native = { control: null, top: 0, left: 0 }, settlements = [], restores = [], selections = [], candidates = [];
  // Any attempt by the domain to peek at a native-focus token fails immediately.
  const token = new Proxy({}, { get() { throw new Error('opaque token read'); }, ownKeys() { throw new Error('opaque token enumeration'); } });
  const canonical = createNotesCommands(notes, {}, { getView: () => null, focusWindow: () => {}, isVisible: () => false });
  const ctx = {
    available: () => available,
    windowAvailable: windowId => available && active === windowId,
    getWindow: windowId => windows.find(window => window.id === windowId) ?? null,
    getNotes: () => notes, getFiles: () => files,
    prepare: async windowId => ctx.windowAvailable(windowId),
    selectNote: async (windowId, noteId) => {
      selections.push({ windowId, noteId });
      return canonical['notes.select']({ noteId }, {});
    },
    finishNotes: async (windowId, kind, noteId) => { settlements.push({ windowId, kind, noteId }); },
    finishFinder: async windowId => { settlements.push({ windowId, kind: 'finder' }); },
    captureFocus: () => token,
    restoreFocus: async (actual, guard) => { if (guard()) restores.push(actual); },
    focusOptions: async (windowId, optionsId, control) => {
      const pane = presentation.options;
      if (!ctx.windowAvailable(windowId) || pane?.id !== optionsId || pane.windowId !== windowId || !VIEW_OPTIONS_CONTROLS.includes(control)) return false;
      native.control = control; return true;
    },
    scrollOptions: async (windowId, optionsId, offsets) => {
      if (!ctx.windowAvailable(windowId) || presentation.options?.id !== optionsId) return null;
      native.top = Math.min(120, offsets.top); native.left = Math.min(18, offsets.left);
      return { top: native.top, left: native.left };
    },
    getOptionsControls: () => VIEW_OPTIONS_CONTROLS.map(control => ({ control, enabled: true })),
    validateCandidate: (candidate, windowCandidate) => {
      candidates.push({ candidate, windowCandidate });
      return quota && validateViewing(candidate, { notes, files }, profile).ok
        && (!windowCandidate?.notesPresentation || validNotesPresentation(windowCandidate.notesPresentation))
        && (!windowCandidate?.finderPresentation || validFinderPresentation(windowCandidate.finderPresentation));
    },
    changed: () => { mutations++; },
  };
  const workflows = createViewWorkflowCommands(viewing, presentation, ctx);
  return { notes, files, viewing, presentation, windows, ctx, workflows, native, settlements, restores, selections, candidates, token,
    activate: id => { active = id; }, gateRoot: value => { available = value; }, quota: value => { quota = value; },
    changes: () => mutations,
    window: id => windows.find(window => window.id === id),
    run: (command, target, payload = {}) => workflows.handlers[command](target, payload),
    snapshot: () => structuredClone({ notes, files, viewing, windows }),
    notesTarget: () => ({ windowId: 'notes-main', folder: notes.folder }),
    noteTarget: noteId => ({ windowId: 'notes-main', noteId: noteId ?? notes.selectedId }),
    finderTarget: () => ({ windowId: 'finder-main', folderId: windows.find(window => window.id === 'finder-main').folderId }),
  };
}
const win = windowId => ({ windowId });
const paneTarget = model => ({ windowId: model.presentation.options.windowId, optionsId: model.presentation.options.id });

test('Notes mode is last-used for new windows but existing windows own independent list/gallery detail', async () => {
  const value = fixture(), unchanged = structuredClone(value.notes);
  const changed = await value.run('notes.view.set', value.notesTarget(), { mode: 'gallery' });
  expect(changed.target.presentation).toEqual({ mode: 'gallery', documentVisible: false });
  expect(value.workflows.notesForWindow('notes-other').presentation).toEqual({ mode: 'list', documentVisible: true });
  value.windows.push({ id: 'notes-new', appId: 'notes', minimized: false, notesPresentation: notesPresentationDefaults(value.viewing.notes.mode) });
  expect(value.workflows.notesForWindow('notes-new').presentation.mode).toBe('gallery');
  const opened = await value.run('notes.view.openNote', value.noteTarget('note-2'));
  expect(opened.status).toBe('applied'); expect(opened.target.presentation.documentVisible).toBe(true);
  expect(value.selections).toEqual([{ windowId: 'notes-main', noteId: 'note-2' }]);
  expect(value.notes.selectedId).toBe('note-2');
  expect(value.workflows.notesForWindow('notes-other').noteId).toBe('note-2');
  expect(value.workflows.notesForWindow('notes-other').presentation.mode).toBe('list');
  expect(value.notes.notes).toEqual(unchanged.notes);
  expect(value.settlements.at(-1)).toEqual({ windowId: 'notes-main', kind: 'body', noteId: 'note-2' });
  expect((await value.run('notes.view.return', win('notes-main'))).target.presentation.documentVisible).toBe(false);
  expect(value.notes.selectedId).toBe('note-2');
  expect(value.settlements.at(-1).kind).toBe('row');
  expect((await value.run('notes.view.return', win('notes-other'))).status).toBe('rejected');
});

test('Return opens actual Notes contents from list without inventing a new document window', async () => {
  const value = fixture(), count = value.windows.length;
  expect((await value.run('notes.view.openNote', value.noteTarget())).target.presentation).toEqual({ mode: 'list', documentVisible: true });
  expect(value.windows).toHaveLength(count);
  expect(value.settlements.at(-1).kind).toBe('body');
  await value.run('notes.view.set', value.notesTarget(), { mode: 'list' });
  expect(value.settlements.at(-1).kind).toBe('preserve');
  await value.run('notes.view.set', value.notesTarget(), { showNoteCount: false });
  expect(value.settlements.at(-1).kind).toBe('preserve');
});

test('Notes folder overrides affect canonical visible/grouped consumers; Deleted follows changed global defaults', async () => {
  const value = fixture(); value.notes.notes.forEach(note => { note.pinned = false; });
  value.notes.notes[0].text = 'Zulu\nfirst'; value.notes.notes[1].text = 'Alpha\nsecond';
  await value.run('notes.view.set', value.notesTarget(), { sortBy: 'title', sortDirection: 'descending', showNoteCount: false });
  const projected = notesViewProjection(value.notes, value.viewing);
  expect(visibleNotes(projected).map(note => note.id)).toEqual(['note-1', 'note-3', 'note-2']);
  expect(groupNotes(projected)[0].notes.map(note => note.id)).toEqual(['note-1', 'note-3', 'note-2']);
  expect(projected.notes).toBe(value.notes.notes); expect(projected.preferences.textSize).toBe(value.notes.preferences.textSize);
  expect(value.notes.preferences.sortBy).toBe('date-edited');
  expect(value.workflows.notesForWindow('notes-other').view.showNoteCount).toBe(false);
  selectFolder(value.notes, 'deleted'); value.notes.preferences.sortBy = 'date-created';
  const deleted = notesViewProjection(value.notes, value.viewing);
  expect(deleted.preferences.sortBy).toBe('date-created'); expect(deleted.preferences.sortDirection).toBe('descending');
  expect(visibleNotes(deleted).map(note => note.id)).toEqual(['note-4']);
  const original = structuredClone(value.viewing);
  expect((await value.run('notes.view.set', value.notesTarget(), { sortBy: 'default' })).error.code).toBe('disabled');
  expect((await value.run('notes.view.set', value.notesTarget(), { sortDirection: 'ascending' })).error.code).toBe('disabled');
  expect(value.viewing).toEqual(original);
  expect(value.workflows.notesForWindow('notes-main').view).toMatchObject({ sortBy: 'default', sortDirection: 'default' });
  selectFolder(value.notes, 'notes');
  await value.run('notes.view.set', value.notesTarget(), { sortBy: 'default', sortDirection: 'default' });
  expect(notesViewProjection(value.notes, value.viewing).preferences.sortBy).toBe('date-created');
  value.notes.preferences.sortBy = 'title';
  expect(notesViewProjection(value.notes, value.viewing).preferences.sortDirection).toBe('ascending');
});

test('Zoom is per selected note, bounded, readable for Deleted, and never changes text/timestamps/default text size', async () => {
  const value = fixture(), records = structuredClone(value.notes.notes), preferences = structuredClone(value.notes.preferences);
  expect((await value.run('notes.view.zoom', value.noteTarget(), { action: 'in' })).target.zoom).toBe(1.25);
  expect(value.workflows.notesForWindow('notes-other').zoom).toBe(1.25);
  await value.run('notes.view.openNote', value.noteTarget('note-2'));
  expect(value.workflows.notesForWindow('notes-main').zoom).toBe(1);
  await value.run('notes.view.zoom', value.noteTarget(), { action: 'out' });
  expect(value.viewing.notes.zooms).toEqual({ 'note-1': 1.25, 'note-2': 0.75 });
  for (let step = 0; step < 10; step++) await value.run('notes.view.zoom', value.noteTarget(), { action: 'out' });
  expect(value.viewing.notes.zooms['note-2']).toBe(0.5);
  await value.run('notes.view.zoom', value.noteTarget(), { action: 'reset' });
  expect(Object.hasOwn(value.viewing.notes.zooms, 'note-2')).toBe(false);
  selectFolder(value.notes, 'deleted');
  expect((await value.run('notes.view.zoom', value.noteTarget(), { action: 'in' })).status).toBe('applied');
  expect(value.notes.notes).toEqual(records); expect(value.notes.preferences).toEqual(preferences);
  expect(value.settlements.at(-1).kind).toBe('preserve');
  await value.run('notes.view.set', value.notesTarget(), { mode: 'gallery' });
  expect((await value.run('notes.view.zoom', value.noteTarget(), { action: 'in' })).error.code).toBe('stale_target');
});

test('Finder folder preferences are shared by same-folder windows while chrome belongs to only the original window', async () => {
  const value = fixture(); value.activate('finder-main');
  await value.run('finder.view.set', value.finderTarget(), { mode: 'list', sortBy: 'date-added', descending: true, groupBy: 'kind', iconSize: 80, gridSpacing: 16, textSize: 15 });
  const current = value.workflows.finderForWindow('finder-main');
  expect(value.workflows.finderForWindow('finder-other').view).toEqual(current.view);
  const untouchedChrome = structuredClone(value.window('finder-other').finderPresentation);
  await value.run('finder.chrome.set', win('finder-main'), { statusBarVisible: true, toolbarVisible: false });
  expect(value.workflows.finderForWindow('finder-main').chrome).toMatchObject({ toolbarVisible: false, sidebarVisible: false, statusBarVisible: true });
  expect(value.workflows.finderForWindow('finder-other').chrome).toEqual(untouchedChrome);
  const before = structuredClone(value.window('finder-main').finderPresentation);
  expect((await value.run('finder.chrome.set', win('finder-main'), { sidebarVisible: true })).error.code).toBe('disabled');
  expect(value.window('finder-main').finderPresentation).toEqual(before);
  expect((await value.run('finder.chrome.set', win('finder-main'), { toolbarVisible: false, sidebarVisible: true })).error.code).toBe('invalid_arguments');
  await value.run('finder.chrome.set', win('finder-main'), { toolbarVisible: true });
  expect(value.window('finder-main').finderPresentation.sidebarVisible).toBe(false);
  await value.run('finder.chrome.set', win('finder-main'), { sidebarVisible: true, pathBarVisible: true, previewVisible: true });
  value.window('finder-main').folderId = 'downloads';
  await value.run('finder.view.set', value.finderTarget(), { mode: 'gallery' });
  expect(value.workflows.finderForWindow('finder-other').view.mode).toBe('list');
  expect(value.workflows.finderForWindow('finder-main').view.mode).toBe('gallery');
});

test('Readonly installation folders allow view/chrome changes but do not widen mutable ID validation', async () => {
  const value = fixture(); value.activate('finder-main');
  const folder = value.files.files.find(file => file.kind === 'folder' && file.readOnly && file.id.endsWith('Applications'));
  const records = structuredClone(value.files.files);
  value.window('finder-main').folderId = folder.id;
  expect((await value.run('finder.view.set', value.finderTarget(), { mode: 'columns', sortBy: 'kind' })).status).toBe('applied');
  expect((await value.run('finder.chrome.set', win('finder-main'), { toolbarVisible: false })).status).toBe('applied');
  expect(value.files.files).toEqual(records);
  const retained = { ...value.viewing, finder: { folderViews: { ...value.viewing.finder.folderViews, 'file-999': finderViewDefaults() } } };
  expect(validateViewing(retained, value, profile).ok).toBe(true);
  const badIds = ['constructor', '__proto__', 'prototype', 'mutable:path', 'mutable/folder', 'mac-application-folder:Applications/Forged', 'mac-application:notes'];
  for (const folderId of badIds) {
    const bad = { ...value.viewing, finder: { folderViews: { [folderId]: finderViewDefaults() } } };
    expect(validateViewing(bad, value, profile).ok).toBe(false);
    expect((await value.run('finder.view.set', { windowId: 'finder-main', folderId }, { mode: 'list' })).status).toBe('rejected');
  }
  const forged = 'mac-application-folder:Applications/Forged';
  value.files.files.push({ ...folder, id: forged }); value.window('finder-main').folderId = forged;
  expect((await value.run('finder.view.set', value.finderTarget(), { mode: 'list' })).status).toBe('rejected');
  const realDocument = value.files.files.find(file => file.kind === 'document');
  expect(validateViewing({ ...value.viewing, finder: { folderViews: { [realDocument.id]: finderViewDefaults() } } }, value, profile).ok).toBe(false);
});

test('Every persistent view mutation validates detached candidates before commit and quota rejection leaves all consumers untouched', async () => {
  const value = fixture(); value.quota(false);
  const before = value.snapshot();
  expect((await value.run('notes.view.set', value.notesTarget(), { mode: 'gallery', showNoteCount: false })).error.code).toBe('limit_exceeded');
  expect((await value.run('notes.view.zoom', value.noteTarget(), { action: 'in' })).error.code).toBe('limit_exceeded');
  value.activate('finder-main');
  expect((await value.run('finder.view.set', value.finderTarget(), { mode: 'list' })).error.code).toBe('limit_exceeded');
  expect((await value.run('finder.chrome.set', win('finder-main'), { toolbarVisible: false })).error.code).toBe('limit_exceeded');
  expect(value.snapshot()).toEqual(before); expect(value.changes()).toBe(0);
  expect(value.candidates[0].candidate.notes).not.toBe(value.viewing.notes);
  expect(value.candidates[1].candidate.notes.zooms).not.toBe(value.viewing.notes.zooms);
  expect(value.candidates[2].candidate.finder.folderViews).not.toBe(value.viewing.finder.folderViews);
  value.activate('notes-main'); value.quota(true);
  await value.run('notes.view.set', value.notesTarget(), { mode: 'gallery' }); value.quota(false);
  expect((await value.run('notes.view.openNote', value.noteTarget('note-2'))).error.code).toBe('limit_exceeded');
  expect(value.selections).toHaveLength(0); expect(value.notes.selectedId).toBe('note-1');
});

test('Bounded dictionaries reject 1025 entries, unsafe note IDs, missing notes, nonfinite zooms and incomplete folder preferences', () => {
  const value = fixture();
  const views = Object.fromEntries(Array.from({ length: 1024 }, (_, index) => [`retained-${index}`, finderViewDefaults()]));
  value.viewing.finder.folderViews = views;
  expect(validateViewing(value.viewing, value, profile).ok).toBe(true);
  views['one-too-many'] = finderViewDefaults(); expect(validateViewing(value.viewing, value, profile).ok).toBe(false);
  delete views['one-too-many']; views['retained-0'] = { mode: 'icons' };
  expect(validateViewing(value.viewing, value, profile).ok).toBe(false);
  value.viewing.finder.folderViews = {};
  for (const zoom of [NaN, Infinity, 0, 1.1, 3, '1']) {
    value.viewing.notes.zooms = { 'note-1': zoom }; expect(validateViewing(value.viewing, value, profile).ok).toBe(false);
  }
  for (const key of ['constructor', 'note:1', 'missing-note']) {
    value.viewing.notes.zooms = { [key]: 1.25 }; expect(validateViewing(value.viewing, value, profile).ok).toBe(false);
  }
  value.viewing.notes.zooms = Object.fromEntries(Array.from({ length: 1025 }, (_, index) => [`note-${index}`, 1.25]));
  expect(validateViewing(value.viewing, value, profile).ok).toBe(false);
  value.viewing.notes.zooms = {};
  Object.defineProperty(value.viewing.finder.folderViews, 'poison', { enumerable: true, get() { throw new Error('not data'); } });
  expect(validateViewing(value.viewing, value, profile).ok).toBe(false);
});

test('At-capacity folder dictionaries reject insertion but still permit changing an existing exact folder', async () => {
  const value = fixture(); value.activate('finder-main');
  value.viewing.finder.folderViews = Object.fromEntries(Array.from({ length: 1024 }, (_, index) => [`retained-${index}`, finderViewDefaults()]));
  const before = structuredClone(value.viewing);
  expect((await value.run('finder.view.set', value.finderTarget(), { mode: 'list' })).error.code).toBe('limit_exceeded');
  expect(value.viewing).toEqual(before);
  delete value.viewing.finder.folderViews['retained-0'];
  value.viewing.finder.folderViews.desktop = finderViewDefaults();
  expect((await value.run('finder.view.set', value.finderTarget(), { mode: 'columns' })).status).toBe('applied');
  expect(Object.keys(value.viewing.finder.folderViews)).toHaveLength(1024);
  expect(value.viewing.finder.folderViews.desktop.mode).toBe('columns');
});

test('Pending Notes view/zoom cannot retarget a different selected note, edited source, root, presentation or preference', async () => {
  for (const change of [
    value => { value.notes.selectedId = 'note-2'; },
    value => { value.notes.notes[0].text += '\nchanged'; },
    value => { value.notes.preferences.sortBy = 'title'; },
    value => { value.viewing.notes.zooms['note-1'] = 1.5; },
    value => { value.window('notes-main').notesPresentation.mode = 'gallery'; },
    value => { value.activate('notes-other'); },
    value => { value.gateRoot(false); },
    value => { const index = value.windows.findIndex(window => window.id === 'notes-main'); value.windows[index] = { ...value.windows[index] }; },
  ]) {
    const value = fixture(), gate = deferred(); value.ctx.prepare = async () => { await gate.promise; return true; };
    const pending = value.run('notes.view.zoom', value.noteTarget(), { action: 'in' });
    change(value); const afterExternal = value.snapshot(); gate.resolve();
    expect((await pending).error.code).toBe('stale_target'); expect(value.snapshot()).toEqual(afterExternal); expect(value.changes()).toBe(0);
  }
  const value = fixture(), gate = deferred(); value.ctx.prepare = async () => { await gate.promise; return true; };
  const pending = value.run('notes.view.set', value.notesTarget(), { showNoteCount: false });
  selectFolder(value.notes, 'deleted'); gate.resolve();
  expect((await pending).error.code).toBe('stale_target'); expect(value.viewing.notes.showNoteCount).toBe(true);
});

test('Gallery opening rechecks the original note and folder before calling canonical selection', async () => {
  const value = fixture(); await value.run('notes.view.set', value.notesTarget(), { mode: 'gallery' });
  const gate = deferred(); value.ctx.prepare = async () => { await gate.promise; return true; };
  const pending = value.run('notes.view.openNote', value.noteTarget('note-2'));
  value.notes.notes[1].deleted = true; gate.resolve();
  expect((await pending).error.code).toBe('stale_target');
  expect(value.selections).toHaveLength(0); expect(value.notes.selectedId).toBe('note-1');
  expect(value.window('notes-main').notesPresentation.documentVisible).toBe(false);
});

test('Pending Finder preferences and chrome preserve a changed folder, original identity and in-place preference', async () => {
  for (const change of [
    value => { value.window('finder-main').folderId = 'downloads'; },
    value => { value.files.files.find(file => file.id === 'desktop').revision++; },
    value => { value.window('finder-main').finderPresentation.sidebarVisible = false; },
    value => { value.viewing.finder.folderViews.desktop.textSize = 16; },
    value => { value.activate('finder-other'); },
    value => { value.window('finder-main').minimized = true; },
  ]) {
    const value = fixture(); value.activate('finder-main'); value.viewing.finder.folderViews.desktop = finderViewDefaults();
    const gate = deferred(); value.ctx.prepare = async () => { await gate.promise; return true; };
    const pending = value.run('finder.view.set', value.finderTarget(), { mode: 'gallery' });
    change(value); const afterExternal = value.snapshot(); gate.resolve();
    expect((await pending).error.code).toBe('stale_target'); expect(value.snapshot()).toEqual(afterExternal);
  }
});

test('Presentation disappearance after committed preferences, zoom or canonical selection cannot report failure', async () => {
  const value = fixture(); value.ctx.finishNotes = async () => { throw new Error('removed view'); };
  expect((await value.run('notes.view.zoom', value.noteTarget(), { action: 'in' })).status).toBe('applied');
  expect(value.viewing.notes.zooms['note-1']).toBe(1.25);
  expect((await value.run('notes.view.set', value.notesTarget(), { mode: 'gallery' })).status).toBe('applied');
  expect((await value.run('notes.view.openNote', value.noteTarget('note-2'))).status).toBe('applied');
  expect(value.notes.selectedId).toBe('note-2'); expect(value.window('notes-main').notesPresentation.documentVisible).toBe(true);
  value.activate('finder-main'); value.ctx.finishFinder = async () => { throw new Error('removed view'); };
  expect((await value.run('finder.view.set', value.finderTarget(), { mode: 'list' })).status).toBe('applied');
  expect(value.viewing.finder.folderViews.desktop.mode).toBe('list');
});

test('View Options controls are exact-owned, identities monotonic, tokens private and scroll results actual clamped offsets', async () => {
  const value = fixture(true); value.activate('finder-main');
  const opened = await value.run('finder.view.options.open', value.finderTarget());
  expect(opened.status).toBe('applied'); expect(value.native.control).toBe('panel');
  const first = paneTarget(value);
  expect(value.workflows.finderForWindow('finder-other').options).toBeNull();
  expect(value.workflows.finderForWindow('finder-main').nativeControls.map(control => control.control)).toEqual([...VIEW_OPTIONS_CONTROLS]);
  expect(JSON.stringify(value.workflows.targets())).not.toContain('token');
  expect(JSON.stringify(value.workflows.finderForWindow('finder-main'))).not.toContain('token');
  expect((await value.run('finder.view.options.focus', { ...first, control: 'gridSpacing' })).status).toBe('applied');
  expect(value.native.control).toBe('gridSpacing');
  expect((await value.run('finder.view.options.scroll', first, { top: 900, left: 100 })).target).toEqual({ ...first, top: 120, left: 18 });
  await value.run('finder.view.options.open', value.finderTarget()); const replacement = paneTarget(value);
  expect(replacement.optionsId).not.toBe(first.optionsId);
  expect((await value.run('finder.view.options.focus', { ...first, control: 'mode' })).error.code).toBe('stale_target');
  expect((await value.run('finder.view.options.close', first)).error.code).toBe('stale_target');
  expect(value.presentation.options.id).toBe(replacement.optionsId);
  expect((await value.run('finder.view.options.close', replacement)).status).toBe('applied');
  expect(value.presentation.options).toBeNull(); expect(value.restores).toHaveLength(1); expect(value.restores[0]).toBe(value.token);
  expect(value.presentation.nextOptionsId).toBe(3);
});

test('An older pending Options setup cannot replace a newer pane or steal its focus', async () => {
  const value = fixture(); value.activate('finder-main'); const gate = deferred(), entered = deferred();
  let attempts = 0;
  value.ctx.prepare = async () => { if (++attempts === 1) { entered.resolve(); await gate.promise; } return true; };
  const older = value.run('finder.view.options.open', value.finderTarget()); await entered.promise;
  const newer = await value.run('finder.view.options.open', value.finderTarget());
  const current = value.presentation.options;
  gate.resolve(); expect((await older).error.code).toBe('stale_target');
  expect(value.presentation.options).toBe(current); expect(current.id).toBe(newer.target.optionsId);
  expect(value.restores).toHaveLength(0);
});

test('Late Options focus failure never rolls back a replacement and close restoration cannot steal newly-owned focus', async () => {
  const value = fixture(); value.activate('finder-main'); const gate = deferred(), entered = deferred();
  const realFocus = value.ctx.focusOptions;
  value.ctx.focusOptions = async (...args) => { if (args[1] === 'view-options-1') { entered.resolve(); await gate.promise; return false; } return realFocus(...args); };
  const older = value.run('finder.view.options.open', value.finderTarget()); await entered.promise;
  const newer = await value.run('finder.view.options.open', value.finderTarget()); gate.resolve();
  expect((await older).error.code).toBe('stale_target'); expect(value.presentation.options.id).toBe(newer.target.optionsId);
  expect(value.restores).toHaveLength(0);
  const closeGate = deferred(), closeEntered = deferred();
  value.ctx.restoreFocus = async (token, guard) => { closeEntered.resolve(); await closeGate.promise; if (guard()) value.restores.push(token); };
  const closing = value.run('finder.view.options.close', paneTarget(value)); await closeEntered.promise;
  const replacement = await value.run('finder.view.options.open', value.finderTarget());
  closeGate.resolve(); expect((await closing).status).toBe('applied');
  expect(value.presentation.options.id).toBe(replacement.target.optionsId); expect(value.restores).toHaveLength(0);
});

test('Native Options failures and navigation reject stale presentation without resurrecting detached owners', async () => {
  const value = fixture(); value.activate('finder-main'); value.ctx.focusOptions = async () => false;
  expect((await value.run('finder.view.options.open', value.finderTarget())).error.code).toBe('stale_target');
  expect(value.presentation.options).toBeNull(); expect(value.presentation.nextOptionsId).toBe(2);
  expect(value.restores).toHaveLength(1); expect(value.restores[0]).toBe(value.token);
  value.ctx.focusOptions = async () => true; await value.run('finder.view.options.open', value.finderTarget());
  const target = paneTarget(value), gate = deferred();
  value.ctx.scrollOptions = async () => { await gate.promise; return { top: 10, left: 0 }; };
  const pending = value.run('finder.view.options.scroll', target, { top: 10 });
  value.window('finder-main').folderId = 'downloads'; value.workflows.dismissOptions(); gate.resolve();
  expect((await pending).error.code).toBe('stale_target');
  expect((await value.run('finder.view.options.close', target)).error.code).toBe('stale_target');
  expect(value.restores).toHaveLength(1);
  await value.run('finder.view.options.open', value.finderTarget());
  value.ctx.restoreFocus = async () => { throw new Error('detached return token'); };
  expect((await value.run('finder.view.options.close', paneTarget(value))).status).toBe('applied');
  expect(value.presentation.options).toBeNull();
});

test('Native pane dismissal discards focus returns, cancels pending setup and leaves monotonic identity intact', async () => {
  const value = fixture(); value.activate('finder-main');
  await value.run('finder.view.options.open', value.finderTarget());
  const closed = paneTarget(value);
  value.workflows.dismissOptions();
  expect(value.presentation.options).toBeNull(); expect(value.restores).toHaveLength(0);
  expect((await value.run('finder.view.options.close', closed)).error.code).toBe('stale_target');
  const changes = value.changes();
  value.workflows.dismissOptions(); expect(value.changes()).toBe(changes);
  const gate = deferred(), entered = deferred();
  value.ctx.prepare = async () => { entered.resolve(); await gate.promise; return true; };
  const pending = value.run('finder.view.options.open', value.finderTarget()); await entered.promise;
  value.workflows.dismissOptions(); gate.resolve();
  expect((await pending).error.code).toBe('stale_target');
  expect(value.presentation.options).toBeNull(); expect(value.presentation.nextOptionsId).toBe(2);
  expect(value.restores).toHaveLength(0);
});

test('In-place pane identity replacement invalidates awaited native control results', async () => {
  const value = fixture(); value.activate('finder-main'); await value.run('finder.view.options.open', value.finderTarget());
  const target = paneTarget(value), gate = deferred(); value.ctx.focusOptions = async () => { await gate.promise; return true; };
  const pending = value.run('finder.view.options.focus', { ...target, control: 'textSize' });
  value.presentation.options.id = 'view-options-99'; gate.resolve();
  expect((await pending).error.code).toBe('stale_target'); expect(value.presentation.options.id).toBe('view-options-99');
});

test('Closed handler arguments reject unknown fields, fractional options, impossible chrome and wrong utility/window owners', async () => {
  const value = fixture();
  const original = value.snapshot();
  for (const payload of [{}, { mode: 'columns' }, { sortDirection: 'reverse' }, { showNoteCount: true, surprise: true }])
    expect((await value.run('notes.view.set', value.notesTarget(), payload)).error.code).toBe('invalid_arguments');
  expect((await value.run('notes.view.openNote', { ...value.noteTarget(), folder: 'notes' })).error.code).toBe('invalid_arguments');
  expect((await value.run('notes.view.return', win('notes-settings'))).status).toBe('rejected');
  expect((await value.run('notes.view.zoom', value.noteTarget(), { action: 'in', reset: true })).error.code).toBe('invalid_arguments');
  value.activate('finder-main');
  for (const payload of [{}, { textSize: 12.5 }, { iconSize: 129 }, { gridSpacing: 7 }, { mode: 'icons', useAsDefaults: true }])
    expect((await value.run('finder.view.set', value.finderTarget(), payload)).error.code).toBe('invalid_arguments');
  expect((await value.run('finder.chrome.set', win('finder-main'), { toolbarVisible: false, sidebarVisible: true })).error.code).toBe('invalid_arguments');
  expect((await value.run('finder.view.options.open', value.finderTarget(), { force: true })).error.code).toBe('invalid_arguments');
  expect((await value.run('finder.view.options.scroll', { windowId: 'finder-main', optionsId: 'view-options-1' }, { top: Infinity })).error.code).toBe('invalid_arguments');
  expect(value.snapshot()).toEqual(original);
});

test('Historical profiles and capability cutovers reject View changes without mutating the live session', async () => {
  const value = fixture(), catalog = viewWorkflowCatalog(profile); let activeProfile = profile;
  const registry = createFeatureCommands(value.workflows.handlers, () => ({ viewing: structuredClone(value.viewing) }), async () => {}, catalog,
    value.workflows.targets, () => activeProfile, catalog);
  const applied = await registry.execute({ command: 'notes.view.set', target: value.notesTarget(), payload: { mode: 'gallery' }, requestId: 'view-1' });
  expect(applied.status).toBe('applied');
  expect(value.window('notes-main').notesPresentation).toEqual({ mode: 'gallery', documentVisible: false });
  const before = value.snapshot();
  activeProfile = { ...profile, id: 'macos-sonoma-14.8.5' };
  expect((await registry.execute({ command: 'notes.view.set', target: value.notesTarget(), payload: { mode: 'list' } })).error.code).toBe('unsupported_profile');
  activeProfile = { ...profile, capabilities: profile.capabilities.filter(capability => capability !== 'shell.view-workflows') };
  expect((await registry.execute({ command: 'notes.view.set', target: value.notesTarget(), payload: { mode: 'list' } })).error.code).toBe('unsupported_profile');
  expect(value.snapshot()).toEqual(before);
});

test('Finder browsing keeps its window view in unconfigured folders and restores explicit folder choices', async () => {
  const model = fixture();
  model.activate('finder-main');
  expect((await model.run('finder.view.set', model.finderTarget(), { mode: 'columns' })).status).toBe('applied');
  model.window('finder-main').folderId = 'personal';
  expect(model.workflows.finderForWindow('finder-main').view.mode).toBe('columns');
  expect(model.workflows.finderForWindow('finder-other').view.mode).toBe('columns');
  model.activate('finder-other');
  model.window('finder-other').folderId = 'downloads';
  expect((await model.run('finder.view.set', { windowId: 'finder-other', folderId: 'downloads' }, { mode: 'gallery' })).status).toBe('applied');
  expect(model.workflows.finderForWindow('finder-main').view.mode).toBe('columns');
  model.window('finder-main').folderId = 'downloads';
  expect(model.workflows.finderForWindow('finder-main').view.mode).toBe('gallery');
});

test('Finder window chrome survives an unavailable retained folder without inventing folder data', async () => {
  const model = fixture();
  model.activate('finder-main');
  expect((await model.run('finder.chrome.set', win('finder-main'), { statusBarVisible: true, toolbarVisible: false })).status).toBe('applied');
  model.window('finder-main').folderId = 'removed-folder';
  const beforeFiles = structuredClone(model.files);
  const unavailable = model.workflows.finderForWindow('finder-main');
  expect(unavailable.folderAvailable).toBe(false);
  expect(unavailable.chrome.sidebarVisible).toBe(false);
  expect(unavailable.chrome.toolbarVisible).toBe(false);
  expect(unavailable.chrome.statusBarVisible).toBe(true);
  expect((await model.run('finder.chrome.set', win('finder-main'), { toolbarVisible: true, sidebarVisible: true })).status).toBe('applied');
  expect(model.workflows.finderForWindow('finder-main').chrome.sidebarVisible).toBe(true);
  expect((await model.run('finder.view.set', model.finderTarget(), { mode: 'list' })).status).toBe('rejected');
  expect(model.files).toEqual(beforeFiles);
});

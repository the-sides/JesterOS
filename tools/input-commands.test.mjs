import { test, expect } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { inputDefaults, keyboardRows, characterResults } from '../frontend/src/input-model.js';
import { createInputCommands } from '../frontend/src/input-commands.js';
import { createNotesState } from '../frontend/src/notes-state.js';
import { createTextEditingCommands, noteTextControlValue } from '../frontend/src/text-editing-commands.js';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function root(options = {}) {
  let state = inputDefaults(), alive = true, interactive = true, owner = true;
  const presentation = { keyboard: null, characters: null, activeKind: null };
  const profile = getOSProfile('macos-golden-gate-27.0.1');
  const notes = createNotesState(), note = notes.notes.find(record => record.id === notes.selectedId);
  note.text = 'Title\nabc';
  let selection = { start: 0, end: 0, direction: 'none' };
  const clipboard = { kind: 'empty', text: '', fileIds: [] };
  const writer = createTextEditingCommands(notes, clipboard, {
    available: () => alive && interactive && owner, dataAvailable: () => alive,
    getSource: target => target.windowId === 'notes-main' && target.noteId === note.id
      ? { note, value: noteTextControlValue(note, 'body'), readOnly: note.deleted, selection: { ...selection } } : null,
    prepare: async () => alive && interactive && owner,
    finishSelection: async (_target, range) => { selection = { ...range }; },
    canCommitNote: () => true, onChanged() {},
  });
  const editor = () => ({ note, value: noteTextControlValue(note, 'body'), revision: note.updatedAt, selection: { ...selection }, secret: 'private-editor' });
  const sameEditor = token => token !== null && token.note === note && token.value === noteTextControlValue(note, 'body')
    && token.revision === note.updatedAt && token.selection.start === selection.start && token.selection.end === selection.end;
  const views = {};
  for (const kind of ['keyboard', 'characters']) {
    let focused = null, top = 0, query = '';
    const controls = () => {
      const pane = presentation[kind]; if (!pane) return [];
      return kind === 'keyboard' ? ['panel', 'close', 'shift', 'option', ...keyboardRows(state.activeSourceId, pane).flat()
        .filter(key => key.action !== 'modifier' && (options.editable !== false || key.action === 'modifier')).map(key => `key:${key.keyId}`)]
        : ['panel', 'close', 'search', ...['all', 'emoji', 'symbols', 'latin'].map(category => `category:${category}`),
          ...characterResults(pane.query, pane.category).map(character => `character:${character.id}`), ...(options.editable === false ? [] : ['insert'])];
    };
    views[kind] = {
      available: control => interactive && alive && Boolean(presentation[kind]) && (control === undefined || controls().includes(control)),
      controlIds: controls, focusedControl: () => focused,
      focus: async control => { if (!controls().includes(control)) return false; focused = control; return true; },
      scrollTop: () => top, scrollTo: async requested => { top = Math.min(requested, 240); return top; },
      query: () => query, setQuery: async next => { query = next; return true; },
      modifiers: () => ({ shift: presentation[kind]?.shift === true, option: presentation[kind]?.option === true }),
    };
  }
  const original = { appId: 'notes', windowId: 'notes-main', focus: { secret: 'private-return' } };
  const context = {
    profile, presentation, getState: () => state, available: () => alive && interactive,
    canBegin: () => alive && interactive, canCommit: options.canCommit ?? (() => true),
    settle: async () => {}, getView: kind => views[kind], capture: () => original,
    captureEditor: () => options.editable === false ? null : editor(),
    ownerCurrent: () => owner && alive, editorCurrent: sameEditor,
    sameEditor: (a, b) => a !== null && b !== null && a.note === b.note && a.value === b.value && a.revision === b.revision
      && a.selection.start === b.selection.start && a.selection.end === b.selection.end && a.selection.direction === b.selection.direction,
    restore: async () => {}, retireMenu: async () => {},
    insert: async (token, action) => {
      if (!sameEditor(token)) return { result: { status: 'rejected', error: { code: 'stale_target' } } };
      const result = await writer.handlers['text.replace']({ windowId: 'notes-main', noteId: note.id, control: 'body',
        revision: token.revision, start: token.selection.start, end: token.selection.end },
      { text: action.action === 'newline' ? '\n' : action.text, label: 'typing' });
      return { result, editor: result.status === 'applied' ? editor() : token, original };
    },
  };
  const controller = createInputCommands(context);
  return { controller, context, views, presentation, notes, note, writer, clipboard,
    state: () => state, replace: next => { state = next; }, lock: () => { interactive = false; }, unlock: () => { interactive = true; },
    loseOwner: () => { owner = false; }, selection: () => ({ ...selection }), moveCaret: next => { selection = { ...next }; },
    run: (name, target = {}, payload = {}) => controller.handlers[name](target, payload) };
}

test('source changes preserve last-source semantics and configuration retains only valid previous membership', () => {
  const scene = root();
  scene.run('input.source.select', { sourceId: 'fr' });
  scene.run('input.source.select', { sourceId: 'fr' });
  expect(scene.state().previousSourceId).toBe('us');
  scene.run('input.source.cycle', {}, { direction: 'last' });
  expect(scene.state().activeSourceId).toBe('us'); expect(scene.state().previousSourceId).toBe('fr');
  scene.run('input.sources.configure', {}, { sourceIds: ['de', 'fr'] });
  expect(scene.state().activeSourceId).toBe('de'); expect(scene.state().previousSourceId).toBe('fr');
  scene.run('input.source.cycle', {}, { direction: 'next' });
  expect(scene.state().activeSourceId).toBe('fr');
  scene.run('input.sources.configure', {}, { sourceIds: ['de'] });
  expect(scene.state().activeSourceId).toBe('de'); expect(scene.state().previousSourceId).toBeNull();
  scene.run('input.source.cycle', {}, { direction: 'last' });
  expect(scene.state().previousSourceId).toBeNull();
  expect(scene.run('input.source.select', { sourceId: 'us' }).error.code).toBe('stale_target');
});

test('readonly and full-root budget rejection never partially change source lists or selection', () => {
  const readonly = root();
  Object.defineProperty(readonly.state(), 'previousSourceId', { value: null, writable: false, enumerable: true, configurable: true });
  expect(readonly.run('input.source.select', { sourceId: 'fr' }).error.code).toBe('invalid_arguments');
  expect(readonly.state().activeSourceId).toBe('us');
  const frozen = root(); Object.freeze(frozen.state().sourceIds);
  expect(frozen.run('input.sources.configure', {}, { sourceIds: ['fr'] }).error.code).toBe('invalid_arguments');
  expect(frozen.state().sourceIds).toEqual(['us', 'fr', 'de']);
  const budget = root({ canCommit: delta => delta <= 0 });
  expect(budget.run('input.source.select', { sourceId: 'fr' }).error.code).toBe('limit_exceeded');
  expect(budget.state().activeSourceId).toBe('us');
  expect(budget.state().previousSourceId).toBeNull();
  expect(budget.run('input.sources.configure', {}, { sourceIds: ['fr'] }).status).toBe('applied');
  expect(budget.state().sourceIds).toEqual(['fr']);
  expect(budget.state().activeSourceId).toBe('fr');
  expect(budget.state().previousSourceId).toBeNull();
});

test('a budget callback that replaces canonical state rejects stale before quota failure', () => {
  const scene = root();
  scene.context.canCommit = () => { scene.replace({ sourceIds: ['de'], activeSourceId: 'de', previousSourceId: null, showInMenuBar: false }); return false; };
  expect(scene.run('input.source.select', { sourceId: 'fr' }).error.code).toBe('stale_target');
  expect(scene.state().activeSourceId).toBe('de');
});

test('two independent viewers reuse their kind, refuse foreign leases, retain through lock and discard on original owner loss', async () => {
  const alex = root(), casey = root();
  const keyboard = await alex.run('input.viewer.open', {}, { kind: 'keyboard' });
  const characters = await alex.run('input.viewer.open', {}, { kind: 'characters' });
  const reused = await alex.run('input.viewer.open', {}, { kind: 'keyboard' });
  expect(reused.target.viewerId).toBe(keyboard.target.viewerId);
  expect(alex.controller.targets().viewers).toHaveLength(2);
  expect((await casey.run('input.viewer.close', { viewerId: keyboard.target.viewerId })).error.code).toBe('stale_target');
  alex.lock(); alex.controller.reconcile();
  expect(alex.presentation.keyboard.viewerId).toBe(keyboard.target.viewerId);
  expect((await alex.run('input.viewer.focus', { viewerId: keyboard.target.viewerId, control: 'panel' })).error.code).toBe('unavailable');
  alex.unlock();
  const publicText = JSON.stringify(alex.controller.targets());
  expect(publicText.includes('private-editor')).toBe(false); expect(publicText.includes('private-return')).toBe(false);
  alex.loseOwner(); alex.controller.reconcile();
  expect(alex.presentation.keyboard).toBeNull(); expect(alex.presentation.characters).toBeNull();
  expect((await alex.run('input.viewer.close', { viewerId: characters.target.viewerId })).error.code).toBe('stale_target');
});

test('desktop browsing cannot insert and clear/disposal makes every original viewer ID unusable', async () => {
  const scene = root({ editable: false });
  const opened = await scene.run('input.viewer.open', {}, { kind: 'characters' });
  expect(scene.controller.targets().viewers[0].canInsert).toBe(false);
  expect((await scene.run('input.characters.insert', { viewerId: opened.target.viewerId, characterId: 'grinning-face' })).status).toBe('rejected');
  expect(scene.note.text).toBe('Title\nabc');
  scene.controller.clear();
  expect((await scene.run('input.viewer.close', { viewerId: opened.target.viewerId })).error.code).toBe('stale_target');
  const later = await scene.run('input.viewer.open', {}, { kind: 'keyboard' });
  expect(later.target.viewerId).not.toBe(opened.target.viewerId);
  scene.controller.dispose();
  expect((await scene.run('input.viewer.open', {}, { kind: 'keyboard' })).status).toBe('rejected');
});

test('filtered characters and authored keyboard glyphs use the real canonical writer, UTF-16 caret and undo without clipboard mutation', async () => {
  const scene = root();
  const keyboard = await scene.run('input.viewer.open', {}, { kind: 'keyboard' });
  scene.run('input.source.select', { sourceId: 'fr' });
  expect((await scene.run('input.keyboard.press', { viewerId: keyboard.target.viewerId, keyId: 'KeyQ' })).status).toBe('applied');
  expect(scene.note.text).toBe('Title\naabc');
  expect(scene.selection().start).toBe(1);
  const characters = await scene.run('input.viewer.open', {}, { kind: 'characters' });
  await scene.run('input.characters.search', { viewerId: characters.target.viewerId }, { query: 'family' });
  expect((await scene.run('input.characters.insert', { viewerId: characters.target.viewerId, characterId: 'grinning-face' })).error.code).toBe('stale_target');
  expect((await scene.run('input.characters.insert', { viewerId: characters.target.viewerId, characterId: 'family' })).status).toBe('applied');
  expect(scene.note.text).toBe('Title\na👨‍👩‍👧abc');
  expect(scene.selection().start).toBe(9);
  expect(scene.clipboard).toEqual({ kind: 'empty', text: '', fileIds: [] });
  expect(scene.writer.targets().history.notes[0].undoCount).toBe(2);
  await scene.writer.handlers['text.undo']({ windowId: 'notes-main', noteId: scene.note.id, control: 'body', revision: scene.note.updatedAt }, {});
  expect(scene.note.text).toBe('Title\naabc');
  expect(scene.presentation.characters).not.toBeNull();
});

test('after-await owner loss rejects search and failed opening removes only its own candidate viewer', async () => {
  const scene = root();
  const keyboard = await scene.run('input.viewer.open', {}, { kind: 'keyboard' });
  const entered = deferred(), release = deferred();
  scene.views.characters.focus = async () => { entered.resolve(); await release.promise; return true; };
  const opening = scene.run('input.viewer.open', {}, { kind: 'characters' });
  await entered.promise; release.resolve();
  expect((await opening).status).toBe('rejected'); // Native focus never actually became search.
  expect(scene.presentation.characters).toBeNull();
  expect(scene.presentation.keyboard.viewerId).toBe(keyboard.target.viewerId);
  const other = root(); const opened = await other.run('input.viewer.open', {}, { kind: 'characters' });
  const enteredSearch = deferred(), releaseSearch = deferred();
  other.views.characters.setQuery = async () => { enteredSearch.resolve(); await releaseSearch.promise; return true; };
  const pending = other.run('input.characters.search', { viewerId: opened.target.viewerId }, { query: 'euro' });
  await enteredSearch.promise; other.loseOwner(); releaseSearch.resolve();
  expect((await pending).error.code).toBe('stale_target');
  expect(other.note.text).toBe('Title\nabc');
});

test('original editor selection changes reject rather than silently binding a new caret', async () => {
  const scene = root(); const opened = await scene.run('input.viewer.open', {}, { kind: 'keyboard' });
  scene.moveCaret({ start: 2, end: 2, direction: 'none' });
  expect((await scene.run('input.keyboard.press', { viewerId: opened.target.viewerId, keyId: 'KeyA' })).error.code).toBe('stale_target');
  expect(scene.note.text).toBe('Title\nabc');
});

test('literal argument accessors and extra properties reject before invoking a unavailable native surface', async () => {
  const scene = root(); scene.lock();
  let reads = 0;
  const target = {};
  Object.defineProperty(target, 'sourceId', { enumerable: true, get() { reads++; return 'fr'; } });
  expect(scene.run('input.source.select', target).error.code).toBe('invalid_arguments');
  const payload = { sourceIds: ['fr'] };
  Object.defineProperty(payload.sourceIds, '0', { enumerable: true, get() { reads++; return 'fr'; } });
  expect(scene.run('input.sources.configure', {}, payload).error.code).toBe('invalid_arguments');
  expect((await scene.run('input.viewer.open', {}, { kind: 'keyboard', extra: true })).error.code).toBe('invalid_arguments');
  expect(reads).toBe(0);
  expect(scene.state().activeSourceId).toBe('us');
});

test('changing query/category clears only a selected character that is filtered away', async () => {
  const scene = root(); const opened = await scene.run('input.viewer.open', {}, { kind: 'characters' });
  const target = { viewerId: opened.target.viewerId };
  await scene.run('input.characters.select', { ...target, characterId: 'euro' });
  await scene.run('input.characters.search', target, { query: 'currency' });
  expect(scene.presentation.characters.selectedCharacterId).toBe('euro');
  await scene.run('input.characters.category', target, { category: 'latin' });
  expect(scene.presentation.characters.selectedCharacterId).toBeNull();
  expect((await scene.run('input.characters.select', { ...target, characterId: 'euro' })).error.code).toBe('stale_target');
  expect(scene.note.text).toBe('Title\nabc');
});

test('source change during awaited modifier settlement rejects stale and restores only its own private toggle', async () => {
  const scene = root(); const opened = await scene.run('input.viewer.open', {}, { kind: 'keyboard' });
  const entered = deferred(), release = deferred(); let held = false;
  scene.context.settle = async () => { if (!held) { held = true; entered.resolve(); await release.promise; } };
  const pending = scene.run('input.keyboard.modifiers', { viewerId: opened.target.viewerId }, { shift: true });
  await entered.promise;
  scene.run('input.source.select', { sourceId: 'de' });
  release.resolve();
  expect((await pending).error.code).toBe('stale_target');
  expect(scene.state().activeSourceId).toBe('de');
  expect(scene.presentation.keyboard.shift).toBe(false);
  expect(scene.note.text).toBe('Title\nabc');
});


test('return ownership can be inherited only from a node inside the exact retained viewer', async () => {
  const scene = root(); const opened = await scene.run('input.viewer.open', {}, { kind: 'keyboard' });
  const node = {}, foreign = {};
  const element = { isConnected: true, contains: candidate => candidate === node };
  scene.views.keyboard.element = () => element;
  expect(scene.controller.getReturnFocus(foreign)).toBeUndefined();
  expect(scene.controller.getReturnFocus(node).windowId).toBe('notes-main');
  scene.loseOwner();
  expect(scene.controller.getReturnFocus(node)).toBeUndefined();
  scene.controller.clear();
  expect(scene.controller.getReturnFocus(node)).toBeUndefined();
  expect((await scene.run('input.viewer.close', { viewerId: opened.target.viewerId })).error.code).toBe('stale_target');
});

test('both viewers on the same exact editor advance only through successful canonical writes', async () => {
  const scene = root();
  const keyboard = await scene.run('input.viewer.open', {}, { kind: 'keyboard' });
  const characters = await scene.run('input.viewer.open', {}, { kind: 'characters' });
  scene.run('input.source.select', { sourceId: 'fr' });
  expect((await scene.run('input.keyboard.press', { viewerId: keyboard.target.viewerId, keyId: 'KeyQ' })).status).toBe('applied');
  expect(scene.controller.targets().viewers.every(viewer => viewer.canInsert)).toBe(true);
  expect((await scene.run('input.characters.insert', { viewerId: characters.target.viewerId, characterId: 'grinning-face' })).status).toBe('applied');
  expect((await scene.run('input.keyboard.press', { viewerId: keyboard.target.viewerId, keyId: 'KeyM' })).status).toBe('applied');
  expect(scene.note.text).toBe('Title\na😀,abc');
  expect(scene.selection().start).toBe(4);
  expect(scene.writer.targets().history.notes[0].undoCount).toBe(3);
  scene.moveCaret({ start: 0, end: 0, direction: 'none' });
  expect((await scene.run('input.characters.insert', { viewerId: characters.target.viewerId, characterId: 'euro' })).error.code).toBe('stale_target');
  expect(scene.note.text).toBe('Title\na😀,abc');
});

test('a superseded opening cannot replace or retire a later successfully mounted same-kind viewer', async () => {
  const scene = root(), entered = deferred(), release = deferred(); let pendingMenu = true;
  scene.context.retireMenu = async () => { if (pendingMenu) { pendingMenu = false; entered.resolve(); await release.promise; } };
  const first = scene.run('input.viewer.open', {}, { kind: 'keyboard' });
  await entered.promise;
  const second = await scene.run('input.viewer.open', {}, { kind: 'keyboard' });
  expect(second.status).toBe('applied');
  release.resolve();
  expect((await first).error.code).toBe('stale_target');
  expect(scene.presentation.keyboard.viewerId).toBe(second.target.viewerId);
  expect(scene.controller.targets().viewers).toHaveLength(1);
});

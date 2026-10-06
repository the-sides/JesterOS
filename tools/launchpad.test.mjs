import { test, expect } from 'bun:test';
import { createRequire } from 'node:module';
import { createWindowCommands } from '../frontend/src/window-commands.js';
import { launchpadAppIds, launchpadDefaults, launchpadItems, launchpadControlIds, launchpadLocation, createLaunchpadCommands } from '../frontend/src/launchpad.js';

const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const { proxy } = await import(frontendRequire.resolve('svelte/internal/client'));
const clone = value => JSON.parse(JSON.stringify(value));
const denseIds = count => Array.from({ length: count }, (_, index) => `app-${String(index + 1).padStart(2, '0')}`);
const appItem = id => `app:${id}`;
const folderItem = id => `folder:${id}`;
const profileWithApps = (ids = ['notes', 'safari', 'mail', 'contacts'], otherAppIds = [], names = {}) => ({
  id: 'macos-mojave-10.14', family: 'macos', capabilities: ['shell.apps', 'shell.launchpad'],
  defaults: { desktopAppId: 'finder' }, launchpad: { otherAppIds },
  applications: {
    finder: { id: 'finder', name: 'Finder', icon: 'finder' },
    launchpad: { id: 'launchpad', name: 'Launchpad', icon: 'launchpad', presentation: 'launchpad' },
    ...Object.fromEntries(ids.map(id => [id, { id, name: names[id] ?? id, icon: 'notes' }])),
  },
});
const original = (id, appId) => ({ id, appId, minimized: false, hidden: false, pendingQuit: false,
  bounds: { x: 18, y: 29, width: 760, height: 540 }, restoreBounds: { x: 9, y: 16, width: 680, height: 480 },
  data: { draft: `Unsent ${id}`, selection: [2, 7] } });

// The adapter represents the native DOM/context boundary, with bounded measured
// controls and physical caret ownership. Activation goes through the existing
// real typed window-focus handler on original objects, not model-internal spies.
function consumer(profile = profileWithApps(), initial = launchpadDefaults(profile), managed = [original('notes-original', launchpadAppIds(profile)[0])]) {
  const state = proxy(initial);
  let activeWindowId = managed[0]?.id ?? null, activeAppId = managed[0]?.appId ?? null, nextWindowId = 1;
  let physicalFocus = managed[0] ? { kind: 'original', windowId: managed[0].id, caret: [2, 7] } : { kind: 'workspace' };
  let positions = { main: { top: 0, left: 0 }, folder: { top: 0, left: 0 } };
  let running = managed.map(window => window.appId), mru = [...running];
  let competing = { menu: 'File', switcher: { itemId: activeAppId }, chooser: { owner: activeWindowId } };
  const settings = { scene: true, native: true, failPrepare: false, failFocus: null, pretendFocus: null,
    failRestore: false, activation: null, onPrepare: null, onScroll: null };
  const ids = () => launchpadControlIds(profile, state);
  const region = () => state.view?.folderId ? 'folder' : 'main';
  const captureFocus = () => clone(physicalFocus);
  const restoreFocus = token => {
    if (settings.failRestore || !token) return false;
    if (token.kind === 'original' && !managed.some(window => window.id === token.windowId)) return false;
    if (token.kind === 'launchpad' && (!state.view || !ids().includes(token.itemId))) return false;
    physicalFocus = clone(token);
    return true;
  };
  const captureScene = () => ({ activeWindowId, activeAppId, nextWindowId, physicalFocus: captureFocus(), positions: clone(positions),
    running: [...running], mru: [...mru], competing: clone(competing), originals: managed.map(window => ({ window, values: clone(window) })) });
  const restoreScene = previous => {
    activeWindowId = previous.activeWindowId;
    activeAppId = previous.activeAppId;
    nextWindowId = previous.nextWindowId;
    physicalFocus = clone(previous.physicalFocus);
    positions = clone(previous.positions);
    running = [...previous.running];
    mru = [...previous.mru];
    competing = clone(previous.competing);
    managed.splice(0, managed.length, ...previous.originals.map(entry => entry.window));
    for (const { window, values } of previous.originals) {
      for (const key of Object.keys(window)) if (!Object.hasOwn(values, key)) delete window[key];
      Object.assign(window, clone(values));
    }
  };
  const settle = async () => {
    if (physicalFocus.kind === 'launchpad' && (!state.view || !ids().includes(physicalFocus.itemId))) physicalFocus = { kind: 'workspace' };
  };
  const view = {
    available: () => Boolean(state.view) && settings.native && settings.scene,
    bounds: () => view.available() ? { x: 0, y: 0, width: 390, height: 700 } : null,
    prepare: async () => {
      if (settings.failPrepare) { settings.failPrepare = false; throw new Error('The actual native layout failed.'); }
      await settings.onPrepare?.();
    },
    itemIds: () => view.available() ? ids() : [],
    focusedItemId: () => view.available() && physicalFocus.kind === 'launchpad' ? physicalFocus.itemId : null,
    focus: async itemId => {
      if (!view.available() || !ids().includes(itemId)) return false;
      if (settings.failFocus === itemId) { settings.failFocus = null; return false; }
      if (settings.pretendFocus === itemId) { settings.pretendFocus = null; return true; }
      if (physicalFocus.kind !== 'launchpad' || physicalFocus.itemId !== itemId) {
        physicalFocus = { kind: 'launchpad', itemId, caret: itemId === 'search' || itemId === 'folder-name-input' ? [0, 0] : null };
      }
      return true;
    },
    scroll: async (requestedRegion, top, left) => {
      if (!view.available() || requestedRegion !== region()) return null;
      await settings.onScroll?.();
      if (!view.available() || requestedRegion !== region()) return null;
      positions[requestedRegion] = { top: Math.min(top, requestedRegion === 'main' ? 120 : 60), left: Math.min(left, 12) };
      return { ...positions[requestedRegion] };
    },
    scrollPosition: requestedRegion => view.available() && requestedRegion === region() ? { ...positions[requestedRegion] } : null,
  };
  const windows = createWindowCommands(() => managed, {
    available: () => settings.scene,
    focus: id => {
      const index = managed.findIndex(window => window.id === id), window = managed[index];
      managed.splice(index, 1);
      managed.push(window);
      window.minimized = false;
      window.hidden = false;
      activeWindowId = id;
      activeAppId = window.appId;
    },
    focusKeyboard: async id => {
      if (settings.activation !== 'missing-native-focus') physicalFocus = { kind: 'original', windowId: id, caret: [...managed.find(window => window.id === id).data.selection] };
    },
  }, 'zoomed');
  const commands = createLaunchpadCommands({ profile, state,
    available: () => settings.scene, settle, getView: () => view, captureScene, restoreScene, captureFocus, restoreFocus,
    dismissPresentations: async () => { competing = null; },
    getActiveWindowId: () => activeWindowId, getActiveAppId: () => activeAppId, getWindows: () => managed,
    isOriginalFocused: id => physicalFocus.kind === 'original' && physicalFocus.windowId === id
      && managed.some(window => window.id === id && !window.minimized && !window.hidden),
    invoke: async (command, target) => {
      if (command !== 'app.open' || state.view !== null) throw new Error('Activation must invoke the existing app transition after dismissing Launchpad.');
      let window = [...managed].reverse().find(window => window.appId === target.appId);
      if (!window) { window = original(`new-original-${nextWindowId++}`, target.appId); managed.push(window); }
      running = [...new Set([...running, target.appId])];
      mru = [target.appId, ...mru.filter(id => id !== target.appId)];
      competing = { appMenu: target.appId };
      const result = await windows['window.focus']({ windowId: window.id }, {});
      if (settings.activation === 'reject-after-change') return { status: 'rejected', error: { code: 'consumer_rejection', message: 'The real downstream transition rejected.' } };
      if (settings.activation === 'wrong-owner') return { status: 'applied', target: { appId: target.appId, windowId: managed.find(entry => entry.appId !== target.appId)?.id ?? 'missing-original' } };
      if (settings.activation === 'wrong-active-owner') activeAppId = 'finder';
      if (settings.activation === 'minimized-original') window.minimized = true;
      if (settings.activation === 'null-original') return { status: 'applied', target: { appId: target.appId, windowId: null } };
      return result;
    },
  });
  return { profile, state, managed, settings, view, invoke: (command, target = {}, payload = {}) => commands[command](target, payload),
    focus: () => captureFocus(), setFocus: token => { physicalFocus = clone(token); },
    scene: () => ({ activeWindowId, activeAppId, nextWindowId, physicalFocus: captureFocus(), positions: clone(positions), running: [...running], mru: [...mru], competing: clone(competing), windows: clone(managed) }) };
}
const snapshot = c => ({ state: clone(c.state), scene: c.scene() });
const membership = c => c.state.pages.flat().flatMap(itemId => itemId.startsWith('app:') ? [itemId.slice(4)]
  : [...c.state.folders.find(folder => folderItem(folder.id) === itemId).appIds]);
function exactlyOnce(c) {
  expect([...membership(c)].sort()).toEqual([...launchpadAppIds(c.profile)].sort());
  expect(new Set(membership(c)).size).toBe(membership(c).length);
}
async function open(c) { expect((await c.invoke('shell.launchpad.open')).status).toBe('applied'); }
async function createFolder(c, appId = 'notes', overAppId = 'safari', name) {
  const result = await c.invoke('launchpad.folder.create', { appId, overAppId }, name === undefined ? {} : { name });
  expect(result.status).toBe('applied');
  return result.target.folderId;
}
async function move(c, itemId, folderId, page = 0, beforeItemId = null) {
  const result = await c.invoke('launchpad.move', { itemId }, { folderId, page, beforeItemId });
  expect(result.status).toBe('applied');
  return result.target;
}

// Model seams are helpers, typed commands, canonical arrangement and the actual
// context's observable ownership/focus/scroll. No source/wiring/count assertions.
test('defaults use only installed eligible apps and seed a real nonempty Other folder in registry order', () => {
  const profile = profileWithApps(['notes', 'safari', 'mail', 'contacts'], ['contacts', 'missing', 'mail', 'finder']);
  profile.applications.otherPresentation = { id: 'otherPresentation', name: 'Overview', presentation: 'mission-control' };
  const c = consumer(profile);
  expect(launchpadAppIds(profile)).toEqual(['notes', 'safari', 'mail', 'contacts']);
  expect(c.state.pages).toEqual([['app:notes', 'app:safari', 'folder:launchpad-folder-1']]);
  expect(c.state.folders).toEqual([{ id: 'launchpad-folder-1', name: 'Other', appIds: ['mail', 'contacts'] }]);
  exactlyOnce(c);
  expect(consumer(profileWithApps([], ['missing'])).state.pages).toEqual([[]]);
  expect(consumer(profileWithApps([], ['missing'])).state.folders).toEqual([]);
});

test('same-page movement resolves the stable before item after source removal, and before-self is atomic', async () => {
  const c = consumer();
  await open(c);
  expect(await move(c, 'app:notes', null, 0, 'app:mail')).toEqual({ itemId: 'app:notes', folderId: null, page: 0, index: 1 });
  expect(c.state.pages).toEqual([['app:safari', 'app:notes', 'app:mail', 'app:contacts']]);
  expect(c.focus().itemId).toBe('app:notes');
  const before = snapshot(c);
  expect((await c.invoke('launchpad.move', { itemId: 'app:notes' }, { folderId: null, page: 0, beforeItemId: 'app:notes' })).error.code).toBe('disabled');
  expect(snapshot(c)).toEqual(before);
  exactlyOnce(c);
});

test('a dense root insertion cascades overflow forward without losing, copying or opening an app', async () => {
  const c = consumer(profileWithApps(denseIds(72)));
  await open(c);
  const scene = c.scene();
  expect(await move(c, 'app:app-72', null, 0, 'app:app-01')).toEqual({ itemId: 'app:app-72', folderId: null, page: 0, index: 0 });
  expect(c.state.pages.map(page => [page[0], page.at(-1), page.length])).toEqual([
    ['app:app-72', 'app:app-34', 35], ['app:app-35', 'app:app-69', 35], ['app:app-70', 'app:app-71', 2],
  ]);
  expect(c.scene().windows).toEqual(scene.windows);
  expect(c.scene().mru).toEqual(scene.mru);
  exactlyOnce(c);
});

test('the editing-only blank page is transient and movement reports the actual page after source-page compaction', async () => {
  const profile = profileWithApps(['notes', 'safari', 'mail']);
  const initial = launchpadDefaults(profile);
  initial.pages = [['app:notes'], ['app:safari', 'app:mail']];
  const c = consumer(profile, initial);
  await open(c);
  expect((await c.invoke('shell.launchpad.setPage', { region: 'main' }, { page: 2 })).error.code).toBe('disabled');
  await c.invoke('shell.launchpad.setEditing', {}, { editing: true });
  expect((await c.invoke('shell.launchpad.setPage', { region: 'main' }, { page: 2 })).target).toEqual({ region: 'main', page: 2 });
  expect(c.state.pages).toEqual([['app:notes'], ['app:safari', 'app:mail']]);
  expect(launchpadItems(profile, c.state)).toEqual([]);
  expect(await move(c, 'app:notes', null, 2)).toEqual({ itemId: 'app:notes', folderId: null, page: 1, index: 0 });
  expect(c.state.pages).toEqual([['app:safari', 'app:mail'], ['app:notes']]);
  await c.invoke('shell.launchpad.setPage', { region: 'main' }, { page: 2 });
  await c.invoke('shell.launchpad.setEditing', {}, { editing: false });
  expect(c.state.view.page).toBe(1);
  expect(c.state.pages).toEqual([['app:safari', 'app:mail'], ['app:notes']]);
  exactlyOnce(c);
});

test('folder creation keeps target-first order, single-app folders survive, emptied folders dissolve and committed IDs never repeat', async () => {
  const c = consumer();
  await open(c);
  const first = await createFolder(c);
  expect(c.state.pages[0]).toEqual([folderItem(first), 'app:mail', 'app:contacts']);
  expect(c.state.folders[0].appIds).toEqual(['safari', 'notes']);
  await move(c, 'app:notes', null, 0, 'app:mail');
  expect(c.state.folders[0].appIds).toEqual(['safari']);
  await move(c, 'app:safari', null, 0, 'app:mail');
  expect(c.state.folders).toEqual([]);
  const second = await createFolder(c, 'notes', 'mail');
  expect([first, second]).toEqual(['launchpad-folder-1', 'launchpad-folder-2']);
  expect(c.state.folders[0].appIds).toEqual(['mail', 'notes']);
  exactlyOnce(c);
});

test('dissolving a sole-app source folder happens before root overflow, not after an artificial extra-page cascade', async () => {
  const profile = profileWithApps(denseIds(35), ['app-01']);
  const c = consumer(profile);
  await open(c);
  expect(await move(c, 'app:app-01', null, 0, 'app:app-02')).toEqual({ itemId: 'app:app-01', folderId: null, page: 0, index: 0 });
  expect(c.state.folders).toEqual([]);
  expect(c.state.pages.map(page => [page[0], page.at(-1), page.length])).toEqual([['app:app-01', 'app:app-35', 35]]);
  exactlyOnce(c);
});

test('folder insertion overflows flat 21-app chunks and stable-before movement survives source-index shifts', async () => {
  const profile = profileWithApps(denseIds(25), denseIds(24));
  const c = consumer(profile);
  await open(c);
  const folderId = c.state.folders[0].id;
  expect(await move(c, 'app:app-25', folderId, 0, 'app:app-01')).toEqual({ itemId: 'app:app-25', folderId, page: 0, index: 0 });
  expect(c.state.view.folderId).toBe(folderId);
  expect(launchpadItems(profile, c.state, 'folder').map(row => row.appId)).toEqual(['app-25', ...denseIds(20)]);
  expect(await move(c, 'app:app-25', folderId, 1, 'app:app-24')).toEqual({ itemId: 'app:app-25', folderId, page: 1, index: 2 });
  expect(launchpadItems(profile, c.state, 'folder').map(row => row.appId)).toEqual(['app-22', 'app-23', 'app-25', 'app-24']);
  expect(c.focus().itemId).toBe('app:app-25');
  expect(c.state.folders[0].appIds).toEqual([...denseIds(23), 'app-25', 'app-24']);
  exactlyOnce(c);
});

test('folder tiles cannot nest and before controls must belong to the requested destination page', async () => {
  const c = consumer(profileWithApps(denseIds(40)));
  await open(c);
  const one = await createFolder(c, 'app-01', 'app-02');
  const two = await createFolder(c, 'app-03', 'app-04');
  const before = snapshot(c);
  expect((await c.invoke('launchpad.move', { itemId: folderItem(one) }, { folderId: two, page: 0, beforeItemId: null })).error.code).toBe('disabled');
  expect((await c.invoke('launchpad.move', { itemId: 'app:app-05' }, { folderId: null, page: 0, beforeItemId: 'app:app-40' })).error.code).toBe('disabled');
  expect(snapshot(c)).toEqual(before);
  exactlyOnce(c);
});

test('real search flattens root and folder traversal, never opens apps, preserves Search caret and restores the pre-search page', async () => {
  const profile = profileWithApps(['alpha', 'beta', 'gamma', 'delta'], ['beta', 'gamma'],
    { alpha: 'Alpha Editor', beta: 'BETA Browser', gamma: 'Gamma Editor', delta: 'Delta Viewer' });
  const initial = launchpadDefaults(profile);
  initial.pages = [['app:alpha', 'folder:launchpad-folder-1'], ['app:delta']];
  const c = consumer(profile, initial);
  await open(c);
  await c.invoke('shell.launchpad.folder.open', { folderId: 'launchpad-folder-1' });
  await c.invoke('launchpad.folder.rename.begin', { folderId: 'launchpad-folder-1' });
  await c.invoke('launchpad.folder.rename.change', {}, { name: 'Uncommitted name' });
  const beforeApps = c.scene().windows;
  const result = await c.invoke('shell.launchpad.search', {}, { query: 'bEtA' });
  expect(result.target).toEqual({ query: 'bEtA', itemIds: ['app:beta'] });
  expect(c.state.view.folderId).toBeNull();
  expect(c.state.view.rename).toBeNull();
  expect(c.state.folders[0].name).toBe('Other');
  await c.invoke('shell.launchpad.search', {}, { query: '' });
  await c.invoke('shell.launchpad.setPage', { region: 'main' }, { page: 1 });
  c.setFocus({ kind: 'launchpad', itemId: 'search', caret: [1, 4] });
  expect((await c.invoke('shell.launchpad.search', {}, { query: 'EDITOR' })).target.itemIds).toEqual(['app:alpha', 'app:gamma']);
  expect(c.focus()).toEqual({ kind: 'launchpad', itemId: 'search', caret: [1, 4] });
  const arranged = clone(c.state.pages);
  expect((await c.invoke('launchpad.move', { itemId: 'app:alpha' }, { folderId: null, page: 0, beforeItemId: null })).error.code).toBe('disabled');
  expect(c.state.pages).toEqual(arranged);
  expect((await c.invoke('shell.launchpad.search', {}, { query: 'no actual matches' })).target.itemIds).toEqual([]);
  expect(launchpadControlIds(profile, c.state)).toEqual(['search']);
  await c.invoke('shell.launchpad.search', {}, { query: '' });
  expect(c.state.view.page).toBe(1);
  expect(c.scene().windows).toEqual(beforeApps);
  exactlyOnce(c);
});

test('invalid rename retains record, draft and input caret with explicit error; change clears error and commit trims the label', async () => {
  const c = consumer();
  await open(c);
  const folderId = await createFolder(c);
  await c.invoke('shell.launchpad.folder.open', { folderId });
  await c.invoke('launchpad.folder.rename.begin', { folderId });
  for (const name of ['   ', 'Bad\nName', 'Bad\0Name']) {
    await c.invoke('launchpad.folder.rename.change', {}, { name });
    c.setFocus({ kind: 'launchpad', itemId: 'folder-name-input', caret: [1, 2] });
    expect((await c.invoke('launchpad.folder.rename.commit')).error.code).toBe('invalid_arguments');
    expect(c.state.folders[0].name).toBe('Folder');
    expect(c.state.view.rename.name).toBe(name);
    expect(typeof c.state.view.rename.error).toBe('string');
    expect(c.focus()).toEqual({ kind: 'launchpad', itemId: 'folder-name-input', caret: [1, 2] });
  }
  await c.invoke('launchpad.folder.rename.change', {}, { name: '  Studio Apps  ' });
  expect(c.state.view.rename.error).toBeNull();
  const arranged = clone(c.state.pages);
  expect((await c.invoke('launchpad.move', { itemId: 'app:notes' }, { folderId: null, page: 0, beforeItemId: null })).error.code).toBe('disabled');
  expect(c.state.pages).toEqual(arranged);
  expect((await c.invoke('launchpad.folder.rename.commit')).target).toEqual({ folderId, name: 'Studio Apps' });
  expect(c.state.view.rename).toBeNull();
  expect(c.focus().itemId).toBe('folder-name');
});

test('rename cancellation and folder dismissal discard only drafts, focus the real label/tile and permit duplicate folder labels', async () => {
  const c = consumer();
  await open(c);
  const first = await createFolder(c);
  const second = await createFolder(c, 'mail', 'contacts');
  await c.invoke('launchpad.folder.rename', { folderId: first }, { name: 'Same Label' });
  await c.invoke('launchpad.folder.rename', { folderId: second }, { name: 'Same Label' });
  await c.invoke('shell.launchpad.folder.open', { folderId: first });
  await c.invoke('launchpad.folder.rename.begin', { folderId: first });
  await c.invoke('launchpad.folder.rename.change', {}, { name: 'Discard this' });
  expect((await c.invoke('launchpad.folder.rename.cancel')).target).toEqual({ folderId: first });
  expect(c.focus().itemId).toBe('folder-name');
  await c.invoke('launchpad.folder.rename.begin', { folderId: first });
  await c.invoke('launchpad.folder.rename.change', {}, { name: 'Discard again' });
  expect((await c.invoke('shell.launchpad.folder.close')).target.closed).toBe(true);
  expect(c.focus().itemId).toBe(folderItem(first));
  expect(c.state.view.rename).toBeNull();
  expect(c.state.folders.map(folder => folder.name)).toEqual(['Same Label', 'Same Label']);
  expect((await c.invoke('shell.launchpad.folder.close')).target.closed).toBe(false);
});

test('the actual assigned Svelte proxy owns its lifecycle and repeated open retains exact original return caret', async () => {
  const c = consumer();
  const originalFocus = c.focus();
  await open(c);
  const assigned = c.state.view;
  await c.invoke('shell.launchpad.select', { itemId: 'app:mail' });
  await open(c);
  expect(c.state.view).toBe(assigned);
  expect(c.focus().itemId).toBe('app:mail');
  await c.invoke('shell.launchpad.search', {}, { query: 'note' });
  expect((await c.invoke('shell.launchpad.close')).target).toEqual({ closed: true });
  expect(c.state.view).toBeNull();
  expect(c.focus()).toEqual(originalFocus);
  expect((await c.invoke('shell.launchpad.close')).target).toEqual({ closed: false });
  await open(c);
  expect(c.state.view.query).toBe('');
  expect(c.state.view.page).toBe(0);
});

test('failed actual preparation restores competing native trees, originals, scroll and caret rather than reporting applied', async () => {
  const c = consumer();
  const before = snapshot(c), retained = c.managed[0];
  c.settings.failPrepare = true;
  expect((await c.invoke('shell.launchpad.open')).error.code).toBe('unavailable');
  expect(snapshot(c)).toEqual(before);
  expect(c.managed[0]).toBe(retained);
  await open(c);
  await c.invoke('shell.launchpad.scroll', { region: 'main' }, { top: 500, left: 100 });
  c.setFocus({ kind: 'launchpad', itemId: 'search', caret: [1, 3] });
  const mountedBefore = snapshot(c), assigned = c.state.view;
  c.settings.failPrepare = true;
  expect((await c.invoke('shell.launchpad.search', {}, { query: 'mail' })).error.code).toBe('unavailable');
  expect(snapshot(c)).toEqual(mountedBefore);
  expect(c.state.view).toBe(assigned);
});

test('a refused or merely claimed DOM focus rolls arrangement and monotonic creation state back', async () => {
  const c = consumer();
  await open(c);
  await c.invoke('shell.launchpad.scroll', { region: 'main' }, { top: 500, left: 100 });
  const before = snapshot(c), assigned = c.state.view;
  c.settings.failFocus = 'folder:launchpad-folder-1';
  expect((await c.invoke('launchpad.folder.create', { appId: 'notes', overAppId: 'safari' })).error.code).toBe('unavailable');
  expect(snapshot(c)).toEqual(before);
  expect(c.state.view).toBe(assigned);
  c.settings.pretendFocus = 'app:mail';
  expect((await c.invoke('shell.launchpad.select', { itemId: 'app:mail' })).error.code).toBe('unavailable');
  expect(snapshot(c)).toEqual(before);
  expect(await createFolder(c)).toBe('launchpad-folder-1');
});

test('activation uses the exact existing original after clearing Launchpad, retaining edited data, geometry and native caret', async () => {
  const managed = [original('notes-original', 'notes'), original('mail-original', 'mail')];
  managed[0].data.draft = 'Act two: retained live edit';
  const retained = managed[0], data = clone(retained), c = consumer(profileWithApps(), undefined, managed);
  await open(c);
  const result = await c.invoke('shell.launchpad.activate', { appId: 'notes' });
  expect(result.target).toEqual({ appId: 'notes', windowId: 'notes-original' });
  expect(c.state.view).toBeNull();
  expect(c.managed.at(-1)).toBe(retained);
  expect(retained).toEqual(data);
  expect(c.focus()).toEqual({ kind: 'original', windowId: 'notes-original', caret: [2, 7] });
});

test('activation rejects nonvisible or editing controls without app lifetime changes, but search and folder visible apps activate', async () => {
  const profile = profileWithApps(denseIds(40), ['app-02', 'app-03']);
  const c = consumer(profile);
  await open(c);
  const before = snapshot(c);
  expect((await c.invoke('shell.launchpad.activate', { appId: 'app-40' })).error.code).toBe('disabled');
  expect((await c.invoke('shell.launchpad.activate', { appId: 'app-02' })).error.code).toBe('disabled');
  expect(snapshot(c)).toEqual(before);
  await c.invoke('shell.launchpad.setEditing', {}, { editing: true });
  const editing = snapshot(c);
  expect((await c.invoke('shell.launchpad.activate', { appId: 'app-01' })).error.code).toBe('disabled');
  expect(snapshot(c)).toEqual(editing);
  await c.invoke('shell.launchpad.setEditing', {}, { editing: false });
  await c.invoke('shell.launchpad.search', {}, { query: 'app-40' });
  expect((await c.invoke('shell.launchpad.activate', { appId: 'app-40' })).target.appId).toBe('app-40');
  await open(c);
  await c.invoke('shell.launchpad.folder.open', { folderId: 'launchpad-folder-1' });
  expect((await c.invoke('shell.launchpad.activate', { appId: 'app-02' })).target.appId).toBe('app-02');
});

for (const failure of ['reject-after-change', 'wrong-owner', 'wrong-active-owner', 'minimized-original', 'null-original', 'missing-native-focus']) {
  test(`downstream ${failure} restores original objects, new-window lifetime, MRU, view scroll and Search caret`, async () => {
    const c = consumer();
    await open(c);
    await c.invoke('shell.launchpad.search', {}, { query: 'safari' });
    await c.invoke('shell.launchpad.scroll', { region: 'main' }, { top: 900, left: 100 });
    c.setFocus({ kind: 'launchpad', itemId: 'search', caret: [2, 5] });
    const before = snapshot(c), assigned = c.state.view, retained = c.managed[0];
    c.settings.activation = failure;
    const result = await c.invoke('shell.launchpad.activate', { appId: 'safari' });
    expect(result.status).toBe('rejected');
    expect(result.error.code).toBe(failure === 'reject-after-change' ? 'consumer_rejection' : 'unavailable');
    expect(snapshot(c)).toEqual(before);
    expect(c.state.view).toBe(assigned);
    expect(c.managed[0]).toBe(retained);
    c.settings.activation = null;
    expect((await c.invoke('shell.launchpad.activate', { appId: 'safari' })).target.windowId).toBe('new-original-1');
  });
}

test('scroll returns physical clamp, inactive regions reject, and late queued scroll after close cannot resurrect or read a null view', async () => {
  const c = consumer();
  await open(c);
  expect((await c.invoke('shell.launchpad.scroll', { region: 'main' }, { top: 900, left: 100 })).target).toEqual({ region: 'main', top: 120, left: 12 });
  expect(c.state.view.scroll.main).toEqual({ top: 120, left: 12 });
  expect((await c.invoke('shell.launchpad.scroll', { region: 'folder' }, { top: 1, left: 0 })).error.code).toBe('disabled');
  const outside = { kind: 'dock', itemId: 'app:mail' };
  c.setFocus(outside);
  expect((await c.invoke('shell.launchpad.close', {}, { restoreFocus: false })).target.closed).toBe(true);
  const closed = snapshot(c);
  expect((await c.invoke('shell.launchpad.scroll', { region: 'main' }, { top: 18, left: 0 })).error.code).toBe('unavailable');
  expect(snapshot(c)).toEqual(closed);
  expect(c.focus()).toEqual(outside);
  expect(await c.view.scroll('main', 18, 0)).toBeNull();
});

test('a failed exact return-focus restoration leaves the launcher transaction intact', async () => {
  const c = consumer();
  await open(c);
  const before = snapshot(c), assigned = c.state.view;
  c.settings.failRestore = true;
  expect((await c.invoke('shell.launchpad.close')).error.code).toBe('unavailable');
  expect(snapshot(c)).toEqual(before);
  expect(c.state.view).toBe(assigned);
  c.settings.failRestore = false;
  expect((await c.invoke('shell.launchpad.close')).target.closed).toBe(true);
  expect(c.focus()).toEqual({ kind: 'original', windowId: 'notes-original', caret: [2, 7] });
});

test('closed typed arguments reject before mutation, including nonfinite offsets, noninteger pages and extra keys', async () => {
  const c = consumer();
  await open(c);
  const before = snapshot(c);
  const requests = [
    ['shell.launchpad.open', { unknown: true }, {}],
    ['shell.launchpad.close', {}, { restoreFocus: 'false' }],
    ['shell.launchpad.search', {}, { query: 2 }],
    ['shell.launchpad.setPage', { region: 'main' }, { page: 0.5 }],
    ['shell.launchpad.setPage', { region: 'main' }, { page: '0' }],
    ['shell.launchpad.setEditing', {}, { editing: 1 }],
    ['shell.launchpad.scroll', { region: 'main' }, { top: Infinity, left: 0 }],
    ['shell.launchpad.scroll', { region: 'main' }, { top: 0, left: -1 }],
    ['shell.launchpad.activate', { appId: 'notes', extra: true }, {}],
    ['launchpad.move', { itemId: 'app:notes' }, { folderId: null, page: 0 }],
    ['launchpad.folder.create', { appId: 'notes', overAppId: 'mail' }, { name: '  ' }],
    ['launchpad.folder.rename.change', {}, { name: 'Name', extra: true }],
  ];
  for (const [command, target, payload] of requests) expect((await c.invoke(command, target, payload)).error.code).toBe('invalid_arguments');
  expect(snapshot(c)).toEqual(before);
  const windows = consumer({ ...profileWithApps(), id: 'windows-11', family: 'windows' });
  expect((await windows.invoke('shell.launchpad.open')).error.code).toBe('unsupported_profile');
  expect(windows.state.view).toBeNull();
});

test('folder paging uses only real folder controls, preserves rename-input caret and resets folder page on reopening', async () => {
  const profile = profileWithApps(denseIds(25), denseIds(25));
  const c = consumer(profile);
  await open(c);
  const folderId = c.state.folders[0].id;
  expect((await c.invoke('shell.launchpad.folder.open', { folderId })).target).toEqual({ folderId, page: 0, itemId: 'app:app-01' });
  expect((await c.invoke('shell.launchpad.select', { itemId: 'search' })).error.code).toBe('not_found');
  expect((await c.invoke('shell.launchpad.setPage', { region: 'main' }, { page: 0 })).error.code).toBe('disabled');
  expect((await c.invoke('shell.launchpad.scroll', { region: 'main' }, { top: 20, left: 0 })).error.code).toBe('disabled');
  await c.invoke('launchpad.folder.rename.begin', { folderId });
  await c.invoke('launchpad.folder.rename.change', {}, { name: 'Still typing' });
  c.setFocus({ kind: 'launchpad', itemId: 'folder-name-input', caret: [2, 4] });
  expect((await c.invoke('shell.launchpad.setPage', { region: 'folder' }, { page: 1 })).target).toEqual({ region: 'folder', page: 1 });
  expect(c.focus()).toEqual({ kind: 'launchpad', itemId: 'folder-name-input', caret: [2, 4] });
  expect(launchpadItems(profile, c.state, 'folder').map(row => row.appId)).toEqual(['app-22', 'app-23', 'app-24', 'app-25']);
  expect(c.state.folders[0].name).toBe('Other');
  await c.invoke('shell.launchpad.folder.close');
  expect(c.state.view.rename).toBeNull();
  expect(c.focus().itemId).toBe(folderItem(folderId));
  expect((await c.invoke('shell.launchpad.folder.open', { folderId })).target.page).toBe(0);
  expect(c.focus().itemId).toBe('app:app-01');
});

test('failed native focus after a rename commit restores the record, assigned view, exact draft and caret', async () => {
  const c = consumer();
  await open(c);
  const folderId = await createFolder(c);
  await c.invoke('shell.launchpad.folder.open', { folderId });
  await c.invoke('launchpad.folder.rename.begin', { folderId });
  await c.invoke('launchpad.folder.rename.change', {}, { name: 'Uncommitted studio apps' });
  c.setFocus({ kind: 'launchpad', itemId: 'folder-name-input', caret: [3, 8] });
  const before = snapshot(c), assigned = c.state.view;
  c.settings.failFocus = 'folder-name';
  expect((await c.invoke('launchpad.folder.rename.commit')).error.code).toBe('unavailable');
  expect(snapshot(c)).toEqual(before);
  expect(c.state.view).toBe(assigned);
  expect((await c.invoke('launchpad.folder.rename.commit')).target).toEqual({ folderId, name: 'Uncommitted studio apps' });
  expect(c.state.view.rename).toBeNull();
  expect(c.focus().itemId).toBe('folder-name');
});

test('search can temporarily hide an editing-only blank preview without persisting it, and ending edit clamps its return page', async () => {
  const c = consumer();
  await open(c);
  await c.invoke('shell.launchpad.setEditing', {}, { editing: true });
  await c.invoke('shell.launchpad.setPage', { region: 'main' }, { page: 1 });
  const pages = clone(c.state.pages);
  await c.invoke('shell.launchpad.search', {}, { query: 'notes' });
  expect(c.state.view.page).toBe(0);
  expect((await c.invoke('shell.launchpad.setPage', { region: 'main' }, { page: 1 })).error.code).toBe('disabled');
  await c.invoke('shell.launchpad.search', {}, { query: '' });
  expect(c.state.view.page).toBe(1);
  expect(launchpadItems(c.profile, c.state)).toEqual([]);
  expect(c.state.pages).toEqual(pages);
  await c.invoke('shell.launchpad.search', {}, { query: 'notes' });
  await c.invoke('shell.launchpad.setEditing', {}, { editing: false });
  await c.invoke('shell.launchpad.search', {}, { query: '' });
  expect(c.state.view.page).toBe(0);
  expect(c.state.pages).toEqual(pages);
});

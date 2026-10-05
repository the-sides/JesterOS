import { test, expect } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createWindowCommands } from '../frontend/src/window-commands.js';
import {
  applicationSwitchingDefaults, recordApplicationActivation, reconcileApplicationSwitching,
  applicationSwitcherItems, applicationMenuItems, createApplicationSwitchingCommands,
} from '../frontend/src/application-switching.js';

const mac = getOSProfile('macos-mojave-10.14');
const windowsProfile = getOSProfile('windows11-23h2-22631.2428');
const window = (id, appId, minimized = false) => ({ id, appId, title: `Document ${id}`, minimized, zoomed: false,
  bounds: { x: 20, y: 30, width: 720, height: 480 }, restoreBounds: { x: 10, y: 15, width: 640, height: 400 } });
const itemIds = (state, profile, running, windows, pending = []) => applicationSwitcherItems(state, profile, running, windows, pending).map(item => item.itemId);
const open = (state, kind, ids, selectedItemId) => {
  state.switcher = { kind, itemIds: ids, selectedItemId, commitOnRelease: null, scroll: { top: 0, left: 0 } };
};
const leaf = (state, appId, running, id, pending = []) => applicationMenuItems(state, mac, appId, running, pending).find(item => item.id === id);

// This consumer uses the existing window primitive, including its minimized restoration,
// and changes actual stacking/MRU on each focus. No switcher view or fake DOM success is used.
function cyclingConsumer(profile, managed, running, activeWindowId) {
  const state = applicationSwitchingDefaults();
  let activeId = activeWindowId, activeAppId = managed.find(entry => entry.id === activeId)?.appId;
  for (const entry of managed) recordApplicationActivation(state, entry.appId, entry.id, true);
  const native = createWindowCommands(() => managed, {
    available: () => true,
    focus(id) {
      const index = managed.findIndex(entry => entry.id === id), entry = managed[index];
      entry.minimized = false;
      managed.splice(index, 1);
      managed.push(entry);
      activeId = id;
      activeAppId = entry.appId;
      recordApplicationActivation(state, entry.appId, id);
    },
    focusKeyboard: async () => {},
  }, profile.family === 'macos' ? 'zoomed' : 'maximized');
  const commands = createApplicationSwitchingCommands(state, {
    profile, getWindows: () => managed, getRunningAppIds: () => running,
    getActiveWindowId: () => activeId, getActiveAppId: () => activeAppId, getPendingQuitAppIds: () => [],
    available: () => true, clearPresentations: () => undefined,
    invoke: (name, target, payload) => native[name](target, payload),
  });
  return { state, commands, activeWindowId: () => activeId };
}

test('application MRU collapses same-app windows while window MRU retains exact documents and creation order', () => {
  const state = applicationSwitchingDefaults(), managed = [window('safari-one', 'safari'), window('notes-one', 'notes'), window('safari-two', 'safari')];
  recordApplicationActivation(state, 'safari', 'safari-one', true);
  recordApplicationActivation(state, 'notes', 'notes-one', true);
  recordApplicationActivation(state, 'safari', 'safari-two', true);
  recordApplicationActivation(state, 'notes', 'notes-one');
  recordApplicationActivation(state, 'safari', 'safari-one');
  recordApplicationActivation(state, 'safari');
  expect(itemIds(state, mac, ['finder', 'safari', 'notes'], managed)).toEqual(['app:safari', 'app:notes', 'app:finder']);
  expect(state.activationWindowIds).toEqual(['safari-one', 'notes-one', 'safari-two']);
  expect(state.creationWindowIds).toEqual(['safari-one', 'notes-one', 'safari-two']);
  expect(applicationSwitcherItems(state, mac, ['finder', 'safari', 'notes'], managed)[0].windowIds).toEqual(['safari-one', 'safari-two']);
});

test('Mac switching retains hidden, all-minimized and zero-window running apps without resurrecting closed or quitting apps', () => {
  const state = applicationSwitchingDefaults(), managed = [window('safari-one', 'safari', true), window('safari-two', 'safari', true), window('notes-one', 'notes')];
  state.hiddenAppIds = ['safari'];
  recordApplicationActivation(state, 'safari', 'safari-two', true);
  recordApplicationActivation(state, 'mail');
  const original = structuredClone(managed);
  const items = applicationSwitcherItems(state, mac, ['finder', 'safari', 'notes', 'photos', 'not-installed'], managed, ['notes']);
  expect(items.map(item => item.itemId)).toEqual(['app:safari', 'app:finder', 'app:photos']);
  expect(items[0]).toMatchObject({ name: 'Safari', icon: 'safari', hidden: true, minimized: true, windowIds: ['safari-one', 'safari-two'] });
  expect(items.find(item => item.appId === 'photos')).toMatchObject({ hidden: false, minimized: false, windowIds: [] });
  expect(managed).toEqual(original);
});

test('Windows switching exposes each actual window, including minimized documents, but never zero-window applications', () => {
  const state = applicationSwitchingDefaults();
  const managed = [window('text-one', 'notepad'), window('text-two', 'notepad', true), window('browser-one', 'edge'), window('foreign', 'not-installed')];
  recordApplicationActivation(state, 'notepad', 'text-one', true);
  const items = applicationSwitcherItems(state, windowsProfile, ['notepad', 'edge', 'calculator', 'not-installed'], managed);
  expect(items.map(item => item.itemId)).toEqual(['window:text-one', 'window:browser-one', 'window:text-two']);
  expect(items.find(item => item.windowId === 'text-two')).toMatchObject({ appId: 'notepad', name: 'Notepad', title: 'Document text-two', minimized: true });
  expect(itemIds(state, windowsProfile, ['notepad', 'edge', 'calculator'], managed, ['notepad'])).toEqual(['window:browser-one']);
});

test('an open switcher freezes order across MRU changes and appends newly running apps rather than reshuffling selection', () => {
  const state = applicationSwitchingDefaults(), managed = [window('safari-one', 'safari'), window('notes-one', 'notes')];
  recordApplicationActivation(state, 'finder');
  recordApplicationActivation(state, 'safari', 'safari-one', true);
  recordApplicationActivation(state, 'notes', 'notes-one', true);
  const running = ['finder', 'safari', 'notes'];
  open(state, 'applications', itemIds(state, mac, running, managed), 'app:safari');
  recordApplicationActivation(state, 'safari', 'safari-one');
  recordApplicationActivation(state, 'photos');
  running.push('photos');
  reconcileApplicationSwitching(state, mac, running, managed);
  expect(state.switcher.itemIds).toEqual(['app:notes', 'app:safari', 'app:finder', 'app:photos']);
  expect(state.switcher.selectedItemId).toBe('app:safari');
  expect(state.activationAppIds).toEqual(['photos', 'safari', 'notes', 'finder']);
  state.switcher = null;
  expect(itemIds(state, mac, running, managed)).toEqual(['app:photos', 'app:safari', 'app:notes', 'app:finder']);
});

test('removing the selected item chooses the nearest surviving OLD position, not its shifted new index', () => {
  const state = applicationSwitchingDefaults();
  open(state, 'applications', ['app:finder', 'app:mail', 'app:safari', 'app:notes', 'app:photos'], 'app:safari');
  reconcileApplicationSwitching(state, mac, ['finder', 'notes', 'photos'], []);
  expect(state.switcher.itemIds).toEqual(['app:finder', 'app:notes', 'app:photos']);
  expect(state.switcher.selectedItemId).toBe('app:notes');
  reconcileApplicationSwitching(state, mac, ['finder'], []);
  expect(state.switcher.selectedItemId).toBe('app:finder');
});

test('selection stays on its live identity when preceding items disappear and the selected window is minimized', () => {
  const state = applicationSwitchingDefaults(), managed = [window('a', 'edge'), window('b', 'notepad'), window('c', 'edge')];
  open(state, 'windows', ['window:a', 'window:b', 'window:c'], 'window:c');
  managed.shift();
  managed[1].minimized = true;
  reconcileApplicationSwitching(state, windowsProfile, ['edge', 'notepad'], managed);
  expect(state.switcher.itemIds).toEqual(['window:b', 'window:c']);
  expect(state.switcher.selectedItemId).toBe('window:c');
  expect(applicationSwitcherItems(state, windowsProfile, ['edge', 'notepad'], managed).at(-1).minimized).toBe(true);
});

test('a pending quit prunes its switcher entry, and cancellation appends eligibility without rewriting frozen survivors', () => {
  const state = applicationSwitchingDefaults(), running = ['finder', 'safari', 'notes'];
  recordApplicationActivation(state, 'finder');
  recordApplicationActivation(state, 'safari');
  recordApplicationActivation(state, 'notes');
  open(state, 'applications', ['app:notes', 'app:safari', 'app:finder'], 'app:safari');
  reconcileApplicationSwitching(state, mac, running, [], ['safari']);
  expect(state.switcher.itemIds).toEqual(['app:notes', 'app:finder']);
  expect(state.switcher.selectedItemId).toBe('app:finder');
  expect(state.activationAppIds).toEqual(['notes', 'safari', 'finder']);
  reconcileApplicationSwitching(state, mac, running, []);
  expect(state.switcher.itemIds).toEqual(['app:notes', 'app:finder', 'app:safari']);
  expect(state.switcher.selectedItemId).toBe('app:finder');
});

test('closing a Mac last window retains the running app, but quitting discards its hidden state and old lifetime history', () => {
  const state = applicationSwitchingDefaults(), managed = [window('safari-old', 'safari'), window('notes-one', 'notes')];
  recordApplicationActivation(state, 'safari', 'safari-old', true);
  recordApplicationActivation(state, 'notes', 'notes-one', true);
  state.hiddenAppIds = ['safari'];
  managed.shift();
  reconcileApplicationSwitching(state, mac, ['finder', 'safari', 'notes'], managed);
  expect(state.activationAppIds).toEqual(['notes', 'safari']);
  expect(state.activationWindowIds).toEqual(['notes-one']);
  expect(state.creationWindowIds).toEqual(['notes-one']);
  expect(applicationSwitcherItems(state, mac, ['finder', 'safari', 'notes'], managed).find(item => item.appId === 'safari')).toMatchObject({ hidden: true, windowIds: [] });
  reconcileApplicationSwitching(state, mac, ['finder', 'notes'], managed);
  expect(state.activationAppIds).toEqual(['notes']);
  expect(state.hiddenAppIds).toEqual([]);
  managed.push(window('safari-new', 'safari'));
  recordApplicationActivation(state, 'safari', 'safari-new', true);
  reconcileApplicationSwitching(state, mac, ['finder', 'notes', 'safari'], managed);
  expect(state.creationWindowIds).toEqual(['notes-one', 'safari-new']);
  expect(itemIds(state, mac, ['finder', 'notes', 'safari'], managed)).toEqual(['app:safari', 'app:notes', 'app:finder']);
});

test('Windows dismisses a switcher when its last window closes rather than leaving a zero-window app card', () => {
  const state = applicationSwitchingDefaults();
  recordApplicationActivation(state, 'notepad', 'only-window', true);
  open(state, 'windows', ['window:only-window'], 'window:only-window');
  reconcileApplicationSwitching(state, windowsProfile, ['notepad'], []);
  expect(state.switcher).toBeNull();
  expect(itemIds(state, windowsProfile, ['notepad'], [])).toEqual([]);
  expect(state.creationWindowIds).toEqual([]);
  expect(state.activationWindowIds).toEqual([]);
});

test('Finder can hide when another app can receive foreground, cannot quit, and unavailable app interiors stay disabled', () => {
  const state = applicationSwitchingDefaults(), running = ['finder', 'safari'];
  expect(leaf(state, 'finder', running, 'hide').enabled).toBe(true);
  expect(leaf(state, 'finder', running, 'quit').enabled).toBe(false);
  expect(leaf(state, 'safari', running, 'quit').enabled).toBe(true);
  for (const id of ['about', 'preferences', 'services']) expect(leaf(state, 'safari', running, id).enabled).toBe(false);
  expect(leaf(state, 'safari', running, 'preferences').label).toBe('Preferences…');
  expect(applicationMenuItems(state, getOSProfile('macos-sonoma-14.0'), 'safari', running).find(item => item.id === 'preferences').label).toBe('Settings…');
  expect(leaf(state, 'finder', ['finder'], 'hide').enabled).toBe(false);
});

test('menu eligibility reflects whole running/hidden batches and does not offer a partial Hide Others during quit', () => {
  const state = applicationSwitchingDefaults(), running = ['finder', 'safari', 'notes'];
  state.hiddenAppIds = ['finder', 'notes'];
  expect(leaf(state, 'safari', running, 'hide-others').enabled).toBe(false);
  expect(leaf(state, 'safari', running, 'show-all').enabled).toBe(true);
  state.hiddenAppIds = ['finder'];
  expect(leaf(state, 'safari', running, 'hide-others').enabled).toBe(true);
  expect(leaf(state, 'safari', running, 'hide-others', ['notes']).enabled).toBe(false);
  expect(leaf(state, 'safari', running, 'show-all', ['finder']).enabled).toBe(false);
});

test('a disabled menu selection moves to the nearest available action, while hiding or quitting its owner dismisses it', () => {
  const state = applicationSwitchingDefaults(), running = ['finder', 'safari', 'notes'];
  state.appMenu = { appId: 'safari', itemId: 'hide-others', scrollTop: 40 };
  state.hiddenAppIds = ['finder', 'notes'];
  reconcileApplicationSwitching(state, mac, running, []);
  expect(state.appMenu).toEqual({ appId: 'safari', itemId: 'show-all', scrollTop: 40 });
  state.hiddenAppIds.push('safari');
  reconcileApplicationSwitching(state, mac, running, []);
  expect(state.appMenu).toBeNull();
  state.hiddenAppIds = [];
  state.appMenu = { appId: 'safari', itemId: 'quit', scrollTop: 0 };
  reconcileApplicationSwitching(state, mac, running, [], ['safari']);
  expect(state.appMenu).toBeNull();
});

test('one running Finder has no fake enabled application-menu leaf, and a newly running app makes Hide reachable', () => {
  const state = applicationSwitchingDefaults();
  state.appMenu = { appId: 'finder', itemId: 'hide', scrollTop: 0 };
  reconcileApplicationSwitching(state, mac, ['finder'], []);
  expect(state.appMenu.itemId).toBeNull();
  reconcileApplicationSwitching(state, mac, ['finder', 'safari'], []);
  expect(state.appMenu.itemId).toBe('hide');
});

test('Mac repeated cycling follows stable creation order despite MRU/stacking updates and skips minimized and other-app windows', async () => {
  const managed = [window('a', 'safari'), window('other', 'notes'), window('b', 'safari'), window('minimized', 'safari', true), window('c', 'safari')];
  const consumer = cyclingConsumer(mac, managed, ['finder', 'safari', 'notes'], 'a'), sequence = [];
  for (let index = 0; index < 5; index += 1) {
    const result = await consumer.commands['window.cycle']({}, {});
    expect(result.status).toBe('applied');
    sequence.push(consumer.activeWindowId());
  }
  expect(sequence).toEqual(['b', 'c', 'a', 'b', 'c']);
  await consumer.commands['window.cycle']({}, { direction: 'previous' });
  expect(consumer.activeWindowId()).toBe('b');
  expect(managed.find(entry => entry.id === 'minimized').minimized).toBe(true);
  consumer.state.hiddenAppIds = ['safari'];
  const result = await consumer.commands['window.cycle']({}, {});
  expect(result.error.code).toBe('disabled');
  expect(consumer.activeWindowId()).toBe('b');
});

test('Windows cycles all eligible creation-order windows instead of alternating between the last two MRU windows', async () => {
  const managed = [window('browser', 'edge'), window('text', 'notepad'), window('minimized', 'edge', true), window('calculator', 'calculator')];
  const consumer = cyclingConsumer(windowsProfile, managed, ['edge', 'notepad', 'calculator'], 'browser'), sequence = [];
  for (let index = 0; index < 4; index += 1) {
    await consumer.commands['window.cycle']({}, {});
    sequence.push(consumer.activeWindowId());
  }
  expect(sequence).toEqual(['text', 'calculator', 'browser', 'text']);
  managed.splice(managed.findIndex(entry => entry.id === 'calculator'), 1);
  reconcileApplicationSwitching(consumer.state, windowsProfile, ['edge', 'notepad'], managed);
  await consumer.commands['window.cycle']({}, {});
  expect(consumer.activeWindowId()).toBe('browser');
  expect(managed.find(entry => entry.id === 'minimized').minimized).toBe(true);
  managed.find(entry => entry.id === 'minimized').minimized = false;
  await consumer.commands['window.cycle']({}, {});
  expect(consumer.activeWindowId()).toBe('text');
  await consumer.commands['window.cycle']({}, {});
  expect(consumer.activeWindowId()).toBe('minimized');
  expect(managed.find(entry => entry.id === 'minimized').bounds).toEqual({ x: 20, y: 30, width: 720, height: 480 });
});

test('visibility batch rejection leaves every hidden group, retained document and geometry unchanged', async () => {
  const state = applicationSwitchingDefaults(), managed = [window('safari', 'safari'), window('notes', 'notes', true)];
  const running = ['finder', 'safari', 'notes'];
  state.hiddenAppIds = ['finder'];
  const beforeWindows = structuredClone(managed);
  let pending = ['notes'], sceneAvailable = true;
  const commands = createApplicationSwitchingCommands(state, {
    profile: mac, getRunningAppIds: () => running, getPendingQuitAppIds: () => pending,
    available: () => sceneAvailable,
  });
  const quitBlocked = await commands['app.hideOthers']({ appId: 'safari' }, {});
  expect(quitBlocked.error.code).toBe('unavailable');
  expect(state.hiddenAppIds).toEqual(['finder']);
  pending = [];
  running.push('uninstalled');
  const staleBatch = await commands['app.hideOthers']({ appId: 'safari' }, {});
  expect(staleBatch.error.code).toBe('not_found');
  expect(state.hiddenAppIds).toEqual(['finder']);
  sceneAvailable = false;
  const modalBlocked = await commands['app.setHidden']({ appId: 'safari' }, { hidden: true });
  expect(modalBlocked.error.code).toBe('unavailable');
  const invalidPayload = await commands['app.setHidden']({ appId: 'safari' }, { hidden: true, minimized: true });
  expect(invalidPayload.error.code).toBe('invalid_arguments');
  expect(state.hiddenAppIds).toEqual(['finder']);
  expect(managed).toEqual(beforeWindows);
});

test('last-running-app hide rejects before discarding its native menu or changing visibility', async () => {
  const state = applicationSwitchingDefaults();
  state.appMenu = { appId: 'finder', itemId: null, scrollTop: 0 };
  const commands = createApplicationSwitchingCommands(state, {
    profile: mac, getRunningAppIds: () => ['finder'], getPendingQuitAppIds: () => [], available: () => true,
  });
  const result = await commands['app.setHidden']({ appId: 'finder' }, { hidden: true });
  expect(result.error.code).toBe('disabled');
  expect(state.hiddenAppIds).toEqual([]);
  expect(state.appMenu).toEqual({ appId: 'finder', itemId: null, scrollTop: 0 });
});

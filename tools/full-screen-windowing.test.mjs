import { test, expect } from 'bun:test';
import { createRequire } from 'node:module';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createWindowCommands } from '../frontend/src/window-commands.js';
import {
  fullScreenDefaults, fullScreenStage, reconcileFullScreenWindowing, splitViewItems,
  windowGreenMenuItems, createFullScreenCommands,
} from '../frontend/src/full-screen-windowing.js';

const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const { proxy } = await import(frontendRequire.resolve('svelte/internal/client'));

const mac = getOSProfile('macos-mojave-10.14');
const sonoma = getOSProfile('macos-sonoma-14.0');
const windowsProfile = getOSProfile('windows11-23h2-22631.2428');
const document = (id, appId = 'notes', fullScreen = false) => ({ id, appId, title: id, fullScreen, minimized: false,
  zoomed: true, bounds: { x: 21, y: 42, width: 730, height: 510 }, restoreBounds: { x: 5, y: 10, width: 600, height: 400 },
  data: { draft: `Unsent ${id}`, selection: [2, 7] } });
const pairing = (id, ids, previousFullScreen = false, selected = ids[0] ?? null) => ({ windowId: id, side: 'left',
  previousFullScreen, windowIds: ids, selectedWindowId: selected, scroll: { top: 0, left: 0 } });
const nonmembership = windows => windows.map(({ fullScreen, ...window }) => structuredClone(window));
const stage = (state, windows, active) => fullScreenStage(state, windows, active, []);

// The consumer runs the real ordinary window focus primitive. Presentation adapters
// are deliberately bounded in-memory controls for deterministic model tests, not DOM
// parity or runtime evidence; they reject absent identities and retain measured focus/scroll.
function consumer(profile, managed, state = fullScreenDefaults()) {
  let active = managed[0]?.id ?? null, focused = null, selectedMenu = null;
  let scroll = { top: 0, left: 0 }, menuTop = 0;
  const controls = { stage: true, picker: true, menu: true, failFocus: null, failPrepare: false,
    competing: { nativeMenu: 'file' }, hidden: [], pending: [], blocked: false };
  const native = createWindowCommands(() => managed, {
    available: () => !controls.blocked,
    focus(id) {
      const index = managed.findIndex(window => window.id === id), window = managed[index];
      window.minimized = false;
      managed.splice(index, 1);
      managed.push(window);
      active = id;
    },
    focusKeyboard: async () => {},
  }, profile.family === 'macos' ? 'zoomed' : 'maximized');
  const actualIds = () => splitViewItems(profile, state, managed, controls.hidden, controls.pending).map(item => item.windowId);
  const menuIds = () => windowGreenMenuItems(profile, state, managed.find(window => window.id === state.greenMenu?.windowId))
    .filter(item => !item.disabled).map(item => item.itemId);
  const pairingView = {
    available: () => controls.picker && Boolean(state.pairing),
    prepare: async () => { if (controls.failPrepare) throw new Error('native layout failed'); },
    focus(id) {
      if (!pairingView.available() || (id !== null && !actualIds().includes(id)) || (id === null && actualIds().length)) return false;
      focused = id;
      return true;
    },
    focusedWindowId: () => focused, windowIds: actualIds,
    scrollTo(value) { scroll = { top: Math.min(value.top, 80), left: Math.min(value.left, 12) }; return { ...scroll }; },
    scrollPosition: () => ({ ...scroll }),
  };
  const greenView = {
    available: () => controls.menu && Boolean(state.greenMenu), prepare: pairingView.prepare,
    focus(id) { if (!greenView.available() || !menuIds().includes(id)) return false; selectedMenu = id; return true; },
    focusedItemId: () => selectedMenu, itemIds: menuIds,
    scrollTo(top) { menuTop = Math.min(top, 40); return menuTop; }, scrollTop: () => menuTop,
  };
  const commands = createFullScreenCommands({
    profile, state, getWindows: () => managed, getActiveWindowId: () => active,
    getHiddenAppIds: () => controls.hidden, getPendingQuitAppIds: () => controls.pending,
    available: () => !controls.blocked, settle: async () => {},
    getStageView: () => ({ available: () => controls.stage, canReveal: () => true }), getPairingView: () => pairingView, getGreenMenuView: () => greenView,
    async focusWindow(id) {
      controls.beforeNativeFocus?.(id);
      if (controls.failFocus === id) return false;
      return (await native['window.focus']({ windowId: id }, {})).status === 'applied';
    },
    async restoreFocus(id) {
      if (!managed.some(window => window.id === id)) return false;
      active = id;
      return true;
    },
    clearPresentations() {
      const previous = { competing: controls.competing, order: managed.map(window => window.id), active };
      controls.competing = null;
      return previous;
    },
    restorePresentations(previous) {
      controls.competing = previous.competing;
      const order = new Map(previous.order.map((id, index) => [id, index]));
      managed.sort((a, b) => order.get(a.id) - order.get(b.id));
      active = previous.active;
    },
  });
  return { state, commands, controls, active: () => active, activate: id => { active = id; },
    invoke: (name, target = {}, payload = {}) => commands[name](target, payload) };
}

async function pair(c, first, second, side = 'left') {
  expect((await c.invoke('window.splitView.begin', { windowId: first }, { side })).status).toBe('applied');
  expect((await c.invoke('window.splitView.accept', { windowId: second })).status).toBe('applied');
}

test('an empty picker owns Cancel with real Svelte deep state and cancellation restores the original window', async () => {
  const original = document('a'), state = proxy(fullScreenDefaults()), c = consumer(mac, [original], state);
  const result = await c.invoke('window.splitView.begin', { windowId: 'a' }, { side: 'right' });
  expect(result).toEqual({ status: 'applied', target: { windowId: 'a', side: 'right', selectedWindowId: null } });
  expect(fullScreenStage(state, [original], c.active()).mode).toBe('pairing');
  expect(state.pairing.windowIds).toEqual([]);
  expect(original.fullScreen).toBe(true);
  expect((await c.invoke('window.splitView.cancel')).target).toEqual({ cancelled: true });
  expect(original.fullScreen).toBe(false);
  expect(fullScreenStage(state, [original], c.active()).mode).toBe('normal');
});

test('enter and exit retain the exact original document, geometry and zoom/restore state on Mac and Windows', async () => {
  for (const profile of [mac, windowsProfile]) {
    const original = document('a', profile.family === 'macos' ? 'notes' : 'notepad');
    const managed = [original], before = nonmembership(managed), c = consumer(profile, managed);
    expect((await c.invoke('window.setFullScreen', { windowId: 'a' }, { fullScreen: true })).target.fullScreen).toBe(true);
    expect(stage(c.state, managed, 'a').mode).toBe('fullScreen');
    expect((await c.invoke('window.setFullScreen', { windowId: 'a' }, { fullScreen: false })).target.fullScreen).toBe(false);
    expect(managed[0]).toBe(original);
    expect(nonmembership(managed)).toEqual(before);
    expect(stage(c.state, managed, 'a').mode).toBe('normal');
  }
});

test('multiple independent pairs resume from exact original members and resize/swap affect only foreground group', async () => {
  const managed = ['a', 'b', 'c', 'd'].map(id => document(id)), c = consumer(mac, managed);
  const originals = new Map(managed.map(window => [window.id, window])), before = new Map(nonmembership(managed).map(window => [window.id, window]));
  await pair(c, 'a', 'b');
  await pair(c, 'c', 'd', 'right');
  expect(c.state.splitViews).toHaveLength(2);
  c.activate('a');
  expect(stage(c.state, managed, 'a').windowIds).toEqual(['a', 'b']);
  await c.invoke('window.splitView.resize', {}, { ratio: 0.7 });
  await c.invoke('window.splitView.swap');
  expect(c.state.splitViews).toEqual([
    { leftWindowId: 'b', rightWindowId: 'a', ratio: 0.7 },
    { leftWindowId: 'd', rightWindowId: 'c', ratio: 0.5 },
  ]);
  c.activate('d');
  expect(stage(c.state, managed, 'd').windowIds).toEqual(['d', 'c']);
  for (const window of managed) { expect(window).toBe(originals.get(window.id)); expect(nonmembership([window])[0]).toEqual(before.get(window.id)); }
});

test('cancel restores both ordinary and already-fullscreen initiator membership, including an empty candidate picker', async () => {
  for (const previous of [false, true]) {
    const managed = [document('a', 'notes', previous)], c = consumer(mac, managed);
    expect((await c.invoke('window.splitView.begin', { windowId: 'a' }, { side: 'right' })).target.selectedWindowId).toBeNull();
    expect(stage(c.state, managed, 'a').mode).toBe('pairing');
    expect((await c.invoke('window.splitView.cancel')).target.cancelled).toBe(true);
    expect(managed[0].fullScreen).toBe(previous);
    expect(c.state.pairing).toBeNull();
    expect((await c.invoke('window.splitView.cancel')).target.cancelled).toBe(false);
  }
});

test('failed picker preparation restores ordinary membership, competing presentation and actual original focus', async () => {
  const managed = [document('a'), document('b')], c = consumer(mac, managed);
  c.controls.picker = false;
  const before = structuredClone(c.state), windows = structuredClone(managed);
  expect((await c.invoke('window.splitView.begin', { windowId: 'b' }, { side: 'left' })).status).toBe('rejected');
  expect(c.state).toEqual(before);
  expect(new Map(managed.map(window => [window.id, window]))).toEqual(new Map(windows.map(window => [window.id, window])));
  expect(c.active()).toBe('a');
  expect(c.controls.competing).toEqual({ nativeMenu: 'file' });
});

test('acceptance focus failure rolls back candidate membership and pair while preserving real picker selection/scroll', async () => {
  const managed = [document('a'), document('b'), document('c')], c = consumer(mac, managed);
  await c.invoke('window.splitView.begin', { windowId: 'a' }, { side: 'left' });
  await c.invoke('window.splitView.scroll', {}, { top: 999, left: 888 });
  expect(c.state.pairing.scroll).toEqual({ top: 80, left: 12 });
  const before = structuredClone(c.state);
  c.controls.failFocus = 'c';
  expect((await c.invoke('window.splitView.accept', { windowId: 'c' })).status).toBe('rejected');
  expect(c.state).toEqual(before);
  expect(managed.find(window => window.id === 'c').fullScreen).toBe(false);
  expect(c.active()).toBe('a');
});

test('replacement cancel restores the original pair and acceptance retains ratio while returning only replaced member to desktop', async () => {
  const managed = ['a', 'b', 'c'].map(id => document(id)), c = consumer(sonoma, managed);
  await pair(c, 'a', 'b');
  await c.invoke('window.splitView.resize', {}, { ratio: 0.6 });
  expect((await c.invoke('window.splitView.replace', { windowId: 'a' })).target).toEqual({ windowId: 'a', side: 'right', selectedWindowId: 'c' });
  expect(c.state.pairing.windowId).toBe('b');
  expect(splitViewItems(sonoma, c.state, managed).map(item => item.windowId)).toEqual(['c']);
  await c.invoke('window.splitView.cancel');
  expect(c.state.splitViews).toEqual([{ leftWindowId: 'a', rightWindowId: 'b', ratio: 0.6 }]);
  await c.invoke('window.splitView.replace', { windowId: 'a' });
  await c.invoke('window.splitView.accept', { windowId: 'c' });
  expect(c.state.splitViews).toEqual([{ leftWindowId: 'c', rightWindowId: 'b', ratio: 0.6 }]);
  expect(managed.find(window => window.id === 'a').fullScreen).toBe(false);
  expect(managed.find(window => window.id === 'b').fullScreen).toBe(true);
});

test('Sonoma native green actions perform actual solo/desktop transitions and menu scrolling retains clamped values', async () => {
  const managed = ['a', 'b'].map(id => document(id)), c = consumer(sonoma, managed);
  await pair(c, 'a', 'b');
  await c.invoke('window.greenMenu.open', { windowId: 'a' });
  expect((await c.invoke('window.greenMenu.scroll', {}, { top: 999 })).target).toEqual({ top: 40 });
  expect((await c.invoke('window.greenMenu.execute', { itemId: 'make-full-screen' })).target.action).toBe('make-full-screen');
  expect(c.state.splitViews).toEqual([]);
  expect(managed.every(window => window.fullScreen)).toBe(true);
  await pair(c, 'a', 'b');
  await c.invoke('window.greenMenu.open', { windowId: 'a' });
  await c.invoke('window.greenMenu.execute', { itemId: 'move-to-desktop' });
  expect(managed.find(window => window.id === 'a').fullScreen).toBe(false);
  expect(managed.find(window => window.id === 'b').fullScreen).toBe(true);
});

test('reconciliation breaks only affected pairs on hidden, minimized, quitting and closed lifetimes without resurrecting windows', () => {
  for (const transition of ['hidden', 'minimized', 'quitting', 'closed']) {
    const managed = ['a', 'b', 'c', 'd'].map(id => document(id, id === 'a' ? 'safari' : 'notes', true)), state = fullScreenDefaults();
    state.splitViews = [{ leftWindowId: 'a', rightWindowId: 'b', ratio: 0.5 }, { leftWindowId: 'c', rightWindowId: 'd', ratio: 0.6 }];
    if (transition === 'minimized') managed[0].minimized = true;
    if (transition === 'closed') managed.shift();
    const before = structuredClone(managed);
    reconcileFullScreenWindowing(state, managed, transition === 'hidden' ? ['safari'] : [], transition === 'quitting' ? ['safari'] : []);
    expect(state.splitViews).toEqual([{ leftWindowId: 'c', rightWindowId: 'd', ratio: 0.6 }]);
    expect(managed).toEqual(before);
    expect(stage(state, managed, 'b').mode).toBe('fullScreen');
  }
});

test('picker reconciliation preserves frozen survivors across stacking and chooses nearest old position when selection closes', () => {
  const managed = ['owner', 'a', 'b', 'c', 'd'].map(id => document(id)), state = fullScreenDefaults();
  managed[0].fullScreen = true;
  state.pairing = pairing('owner', ['a', 'b', 'c', 'd'], false, 'b');
  managed.reverse();
  managed.splice(managed.findIndex(window => window.id === 'b'), 1);
  managed.push(document('e'));
  reconcileFullScreenWindowing(state, managed);
  expect(state.pairing.windowIds).toEqual(['a', 'c', 'd', 'e']);
  expect(state.pairing.selectedWindowId).toBe('c');
  managed.find(window => window.id === 'owner').minimized = true;
  reconcileFullScreenWindowing(state, managed);
  expect(state.pairing).toBeNull();
  expect(managed.find(window => window.id === 'owner').fullScreen).toBe(false);
});

test('hidden/minimized/quitting/stale targets and closed fields reject without changing membership or presentations', async () => {
  const managed = [document('a'), document('b', 'safari')], c = consumer(mac, managed);
  const requests = [
    ['window.setFullScreen', { windowId: 'missing' }, { fullScreen: true }],
    ['window.setFullScreen', { windowId: 'a', extra: true }, { fullScreen: true }],
    ['window.setFullScreen', { windowId: 'a' }, { fullScreen: 1 }],
    ['window.splitView.begin', { windowId: 'a' }, { side: 'center' }],
    ['shell.fullScreen.reveal', { edge: 'top' }, { visible: true }],
  ];
  const before = structuredClone({ state: c.state, managed });
  for (const [name, target, payload] of requests) expect((await c.invoke(name, target, payload)).status).toBe('rejected');
  for (const kind of ['hidden', 'minimized', 'pending']) {
    c.controls.hidden = kind === 'hidden' ? ['safari'] : [];
    c.controls.pending = kind === 'pending' ? ['safari'] : [];
    managed[1].minimized = kind === 'minimized';
    expect((await c.invoke('window.setFullScreen', { windowId: 'b' }, { fullScreen: true })).status).toBe('rejected');
  }
  managed[1].minimized = false;
  expect({ state: c.state, managed }).toEqual(before);
  expect(c.controls.competing).toEqual({ nativeMenu: 'file' });
});

test('ordinary foreground does not erase background fullscreen membership and paired exit preserves the partner', async () => {
  const managed = ['a', 'b', 'normal'].map(id => document(id)), c = consumer(mac, managed);
  await pair(c, 'a', 'b');
  c.activate('normal');
  expect(stage(c.state, managed, 'normal').mode).toBe('normal');
  expect(c.state.splitViews).toHaveLength(1);
  expect((await c.invoke('window.splitView.resize', {}, { ratio: 0.3 })).status).toBe('rejected');
  await c.invoke('window.setFullScreen', { windowId: 'a' }, { fullScreen: false });
  expect(c.state.splitViews).toEqual([]);
  expect(stage(c.state, managed, 'b').mode).toBe('fullScreen');
});

test('a candidate or initiator closing during acceptance rejects without resurrecting its lifetime or retaining a phantom pair', async () => {
  for (const closedId of ['a', 'c']) {
    const managed = ['a', 'b', 'c'].map(id => document(id)), c = consumer(mac, managed);
    await c.invoke('window.splitView.begin', { windowId: 'a' }, { side: 'left' });
    c.controls.beforeNativeFocus = id => {
      if (id === 'c') managed.splice(managed.findIndex(window => window.id === closedId), 1);
    };
    expect((await c.invoke('window.splitView.accept', { windowId: 'c' })).status).toBe('rejected');
    expect(managed.some(window => window.id === closedId)).toBe(false);
    expect(c.state.splitViews).toEqual([]);
    if (closedId === 'a') {
      expect(c.state.pairing).toBeNull();
      expect(managed.every(window => !window.fullScreen)).toBe(true);
    } else {
      expect(c.state.pairing.windowIds).toEqual(['b']);
      expect(c.state.pairing.selectedWindowId).toBe('b');
      expect(managed.find(window => window.id === 'a').fullScreen).toBe(true);
    }
  }
});

test('exceptional native preparation is an atomic unavailable rejection rather than an acknowledged empty presentation', async () => {
  const managed = [document('a'), document('b')], c = consumer(sonoma, managed);
  const before = structuredClone({ managed, state: c.state });
  c.controls.failPrepare = true;
  const result = await c.invoke('window.greenMenu.open', { windowId: 'a' });
  expect(result.status).toBe('rejected');
  expect({ managed, state: c.state }).toEqual(before);
  expect(c.active()).toBe('a');
  expect(c.controls.competing).toEqual({ nativeMenu: 'file' });
});

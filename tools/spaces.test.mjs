import { test, expect } from 'bun:test';
import { createRequire } from 'node:module';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createWindowCommands } from '../frontend/src/window-commands.js';
import { fullScreenDefaults, createFullScreenCommands, reconcileFullScreenWindowing, splitViewItems } from '../frontend/src/full-screen-windowing.js';
import { spacesDefaults, spacesItems, windowSpaceId, missionControlWindows, missionControlItems, reconcileSpaces, createSpacesCommands } from '../frontend/src/spaces.js';

const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const { proxy } = await import(frontendRequire.resolve('svelte/internal/client'));
const mac = getOSProfile('macos-mojave-10.14');
// The parent adds OS-15's capability; the model consumer deliberately uses the
// same explicit Mac identity without depending on discovery/wiring tests.
const profile = { ...mac, capabilities: [...mac.capabilities, 'shell.mission-control'] };
const original = (id, appId = 'notes', fullScreen = false, spaceId = 'desktop-1') => ({ id, appId, title: id, fullScreen, spaceId,
  minimized: false, zoomed: true, bounds: { x: 21, y: 42, width: 730, height: 510 },
  restoreBounds: { x: 5, y: 10, width: 600, height: 400 }, data: { draft: `Unsent ${id}`, selection: [2, 7] } });
const clone = value => JSON.parse(JSON.stringify(value));
const contents = windows => new Map(windows.map(({ spaceId, fullScreen, ...window }) => [window.id, clone(window)]));
const fullId = id => `full:${encodeURIComponent(id)}`;
const groupId = (a, b) => `split:${JSON.stringify([a, b].sort())}`;

// Bounded native-control adapters exercise ownership/focus/scroll failure paths,
// not DOM parity. All membership transitions below run the existing real typed
// full-screen and ordinary window-focus handlers on the exact original objects.
function consumer(managed, state = spacesDefaults(), presentation = fullScreenDefaults()) {
  let active = managed.find(window => !window.minimized)?.id ?? null;
  let physicalFocus = { kind: 'input', windowId: active, caret: [2, 7] }, focused = null, candidate = null;
  let scroll = { windows: { top: 0, left: 0 }, spaces: { top: 0, left: 0 } }, candidateScroll = { top: 0, left: 0 };
  const controls = { scene: true, overview: true, hidden: [], pending: [], creation: managed.map(window => window.id),
    failPrepare: false, failOverviewFocus: null, failOriginalFocus: null, failForeground: false,
    failDownstream: null, competing: { menu: 'File', switcher: { itemId: 'notes' } } };
  const visible = window => window && !window.minimized && !controls.hidden.includes(window.appId) && !controls.pending.includes(window.appId);
  const readSpaces = () => spacesItems(state, presentation, managed, profile, controls.hidden, controls.pending);
  const readWindows = () => missionControlWindows(state, managed, controls.hidden, controls.pending);
  const ids = () => missionControlItems(state, readSpaces(), readWindows());
  const captureFocus = () => clone(physicalFocus);
  const restoreFocus = token => {
    if (!token || token.kind === 'input' && !managed.some(window => window.id === token.windowId)) return false;
    physicalFocus = clone(token);
    if (token.kind === 'overview') focused = token.itemId;
    return true;
  };
  const captureScene = () => ({ active, physicalFocus: captureFocus(), focused, candidate, scroll: clone(scroll), candidateScroll: clone(candidateScroll),
    order: managed.map(window => window.id), competing: clone(controls.competing) });
  const restoreScene = previous => {
    active = previous.active;
    physicalFocus = clone(previous.physicalFocus);
    focused = previous.focused;
    candidate = previous.candidate;
    scroll = clone(previous.scroll);
    candidateScroll = clone(previous.candidateScroll);
    controls.competing = clone(previous.competing);
    const order = new Map(previous.order.map((id, index) => [id, index]));
    managed.sort((a, b) => order.get(a.id) - order.get(b.id));
  };
  const native = createWindowCommands(() => managed, {
    available: () => controls.scene,
    focus(id) {
      const index = managed.findIndex(window => window.id === id), window = managed[index];
      managed.splice(index, 1);
      managed.push(window);
      active = id;
    },
    focusKeyboard: async id => { physicalFocus = { kind: 'input', windowId: id, caret: [...managed.find(window => window.id === id).data.selection] }; },
  }, 'zoomed');
  const focusOriginal = async id => {
    if (controls.failOriginalFocus === id || !visible(managed.find(window => window.id === id))) return false;
    return (await native['window.focus']({ windowId: id }, {})).status === 'applied';
  };
  const overviewView = {
    available: () => controls.overview && Boolean(state.overview),
    bounds: () => controls.overview && state.overview ? { x: 0, y: 0, width: 390, height: 844 } : null,
    prepare: async () => { if (controls.failPrepare) throw new Error('actual overview preparation failed'); },
    itemIds: ids,
    focusedItemId: () => focused,
    focus(id) {
      if (!overviewView.available() || !ids().includes(id) || controls.failOverviewFocus === id) return false;
      focused = id;
      physicalFocus = { kind: 'overview', itemId: id };
      return true;
    },
    scroll(region, top, left) {
      if (!overviewView.available()) return null;
      scroll[region] = { top: Math.min(top, region === 'windows' ? 80 : 0), left: Math.min(left, region === 'spaces' ? 120 : 0) };
      return { ...scroll[region] };
    },
    scrollPosition: region => overviewView.available() ? { ...scroll[region] } : null,
  };
  const candidateIds = () => splitViewItems(profile, presentation, managed, controls.hidden, controls.pending).map(item => item.windowId);
  const picker = {
    available: () => Boolean(presentation.pairing), prepare: async () => {},
    focus(id) {
      if (id === null ? candidateIds().length > 0 : !candidateIds().includes(id)) return false;
      candidate = id;
      physicalFocus = { kind: 'picker', windowId: id };
      return true;
    },
    focusedWindowId: () => candidate, windowIds: candidateIds,
    scrollPosition: () => ({ ...candidateScroll }), scrollTo: position => { candidateScroll = { ...position }; return { ...candidateScroll }; },
  };
  const core = createFullScreenCommands({ profile, state: presentation, getWindows: () => managed, getActiveWindowId: () => active,
    getHiddenAppIds: () => controls.hidden, getPendingQuitAppIds: () => controls.pending,
    available: () => controls.scene, settle: async () => {}, getStageView: () => ({ available: () => controls.scene }),
    getPairingView: () => picker, getGreenMenuView: () => null, focusWindow: focusOriginal,
    restoreFocus: async id => { active = id; return restoreFocus({ kind: 'input', windowId: id, caret: [2, 7] }); },
    clearPresentations: () => { const previous = captureScene(); controls.competing = null; state.overview = null; return previous; },
    restorePresentations: restoreScene,
  });
  const activateSpace = async entry => {
    const eligibleIds = entry.windowIds.filter(id => visible(managed.find(window => window.id === id)));
    const id = [...managed].reverse().find(window => eligibleIds.includes(window.id))?.id ?? null;
    if (id) return focusOriginal(id);
    active = null;
    physicalFocus = { kind: 'workspace' };
    return true;
  };
  const commands = createSpacesCommands({ profile, state, presentation, getWindows: () => managed,
    getHiddenAppIds: () => controls.hidden, getPendingQuitAppIds: () => controls.pending,
    getCreationWindowIds: () => controls.creation, getActiveWindowId: () => active,
    available: () => controls.scene, settle: async () => {}, getView: () => overviewView,
    captureScene, restoreScene, captureFocus, restoreFocus,
    dismissPresentations: () => { controls.competing = null; }, activateSpace,
    foregroundMembershipChanged: async () => !controls.failForeground && activateSpace(readSpaces().find(item => item.spaceId === state.activeSpaceId)),
    invoke: async (name, target, payload) => {
      if (controls.failDownstream?.(name, target)) return { status: 'rejected', error: { code: 'consumer_rejection', message: 'Actual downstream refused this transition.' } };
      return core[name](target, payload);
    },
  });
  return { state, presentation, managed, controls, commands, readSpaces, readWindows,
    invoke: (name, target = {}, payload = {}) => commands[name](target, payload),
    active: () => active, physicalFocus: () => clone(physicalFocus), scene: captureScene,
    activate: id => { active = id; },
    reconcile: () => { reconcileFullScreenWindowing(presentation, managed, controls.hidden, controls.pending);
      reconcileSpaces(state, presentation, managed, profile, controls.hidden, controls.pending, controls.creation); },
  };
}

async function add(c) {
  const result = await c.invoke('space.create');
  expect(result.status).toBe('applied');
  return result.target.spaceId;
}
async function open(c, expanded = false) {
  expect((await c.invoke('shell.missionControl.open')).status).toBe('applied');
  if (expanded) expect((await c.invoke('shell.missionControl.setExpanded', {}, { expanded: true })).status).toBe('applied');
}
function snapshot(c) {
  return { spaces: clone(c.state), presentation: clone(c.presentation), windows: clone(c.managed), scene: c.scene() };
}

test('desktop deletion migrates every HOME owner, including hidden/minimized/quitting/full-screen originals, without reopening or changing documents', async () => {
  const managed = [original('normal'), original('hidden', 'safari'), original('minimized'), original('full', 'notes', true), original('quitting', 'mail')];
  const c = consumer(managed), second = await add(c), third = await add(c);
  for (const window of managed) window.spaceId = second;
  managed.find(window => window.id === 'minimized').minimized = true;
  c.controls.hidden = ['safari'];
  c.controls.pending = ['mail'];
  const before = contents(managed), identities = new Map(managed.map(window => [window.id, window]));
  const result = await c.invoke('space.remove', { spaceId: second });
  expect(result.target).toEqual({ spaceId: second, destinationSpaceId: 'desktop-1', windowIds: ['normal', 'hidden', 'minimized', 'full', 'quitting'] });
  expect(c.state.desktops.map(desktop => desktop.id)).toEqual(['desktop-1', third]);
  expect(managed.every(window => window.spaceId === 'desktop-1')).toBe(true);
  expect(contents(managed)).toEqual(before);
  for (const window of managed) expect(window).toBe(identities.get(window.id));
  expect(managed.find(window => window.id === 'full').fullScreen).toBe(true);
  expect((await c.invoke('space.remove', { spaceId: 'desktop-1' })).target.destinationSpaceId).toBe(third);
  expect(c.readSpaces().find(item => item.spaceId === third).label).toBe('Desktop 1');
});

test('last ordinary desktop and sixteen-desktop limit reject atomically, while deleted monotonic IDs are never reused', async () => {
  const c = consumer([]), initial = snapshot(c);
  expect((await c.invoke('space.remove', { spaceId: 'desktop-1' })).error.code).toBe('disabled');
  expect(snapshot(c)).toEqual(initial);
  const ids = [];
  for (let i = 1; i < 16; i += 1) ids.push(await add(c));
  const limit = snapshot(c);
  expect((await c.invoke('space.create')).error.code).toBe('disabled');
  expect(snapshot(c)).toEqual(limit);
  await c.invoke('space.remove', { spaceId: ids[4] });
  expect(await add(c)).toBe('desktop-17');
  expect(c.state.activeSpaceId).toBe('desktop-1');
});

test('derived pair identity survives swap and independent group lifetimes reconcile without owning or rewriting core membership', () => {
  const managed = [original('b:/', 'notes', true), original('a"', 'safari', true), original('solo:/', 'notes', true), original('other', 'notes', true)];
  const c = consumer(managed), pairId = groupId('b:/', 'a"');
  c.presentation.splitViews = [{ leftWindowId: 'b:/', rightWindowId: 'a"', ratio: 0.6 }];
  c.reconcile();
  expect(c.readSpaces().map(item => item.spaceId)).toEqual(['desktop-1', pairId, fullId('solo:/'), fullId('other')]);
  expect(windowSpaceId(c.state, c.presentation, managed[0])).toBe(pairId);
  c.presentation.splitViews[0] = { leftWindowId: 'a"', rightWindowId: 'b:/', ratio: 0.6 };
  c.reconcile();
  expect(c.readSpaces().find(item => item.spaceId === pairId)).toMatchObject({ windowIds: ['a"', 'b:/'], ratio: 0.6 });
  c.state.activeSpaceId = pairId;
  c.controls.hidden = ['safari'];
  const beforeCore = clone(c.presentation);
  reconcileSpaces(c.state, c.presentation, managed, profile, c.controls.hidden);
  expect(c.presentation).toEqual(beforeCore);
  expect(c.state.activeSpaceId).toBe('desktop-1');
  expect(c.state.order).toEqual(['desktop-1', fullId('solo:/'), fullId('other'), fullId('b:/')]);
  expect(managed[1].spaceId).toBe('desktop-1');
  expect(managed[1].fullScreen).toBe(true);
  c.reconcile();
  expect(c.presentation.splitViews).toEqual([]);
  managed.find(window => window.id === 'solo:/').minimized = true;
  c.reconcile();
  expect(c.state.order).toEqual(['desktop-1', fullId('other'), fullId('b:/')]);
});

test('overview preserves creation/frozen order and repairs a moved or removed selection to its nearest surviving enabled control without destination activation', async () => {
  const managed = ['a', 'b', 'c', 'd'].map(id => original(id)), c = consumer(managed), second = await add(c);
  c.controls.creation = ['d', 'b', 'a', 'c'];
  await open(c, true);
  expect(c.state.overview.windowIds).toEqual(['d', 'b', 'a', 'c']);
  await c.invoke('shell.missionControl.select', { itemId: 'window:b' });
  managed.reverse();
  c.controls.creation.push('e');
  managed.push(original('e'));
  c.reconcile();
  expect(c.state.overview.windowIds).toEqual(['d', 'b', 'a', 'c', 'e']);
  await c.invoke('window.moveToSpace', { windowId: 'b', spaceId: second });
  expect(c.state.overview.selectedItemId).toBe('window:a');
  expect(c.physicalFocus()).toEqual({ kind: 'overview', itemId: 'window:a' });
  expect(c.state.activeSpaceId).toBe('desktop-1');
  await c.invoke('shell.missionControl.select', { itemId: `remove:${second}` });
  await c.invoke('space.remove', { spaceId: second });
  expect(c.state.overview.selectedItemId).toBe('add-space');
  expect(c.physicalFocus()).toEqual({ kind: 'overview', itemId: 'add-space' });
  expect(c.state.overview.windowIds).toEqual(['d', 'a', 'c', 'e', 'b']);
});

test('pairing, desktop removal and group exit retain each original document/geometry and restore the first member HOME outside Mission Control', async () => {
  const managed = [original('left', 'safari', true), original('right')], c = consumer(managed), second = await add(c);
  managed[0].spaceId = second;
  const originals = new Map(managed.map(window => [window.id, window])), before = contents(managed);
  const paired = await c.invoke('space.pair', { windowId: 'right', spaceId: fullId('left') });
  expect(paired.target).toEqual({ spaceId: groupId('left', 'right'), leftWindowId: 'left', rightWindowId: 'right' });
  expect(c.state.activeSpaceId).toBe(groupId('left', 'right'));
  expect(managed.find(window => window.id === 'left').spaceId).toBe(second);
  expect(managed.find(window => window.id === 'right').spaceId).toBe('desktop-1');
  expect((await c.invoke('space.exitFullScreen', { spaceId: paired.target.spaceId })).target.windowIds).toEqual(['left', 'right']);
  expect(c.state.activeSpaceId).toBe(second);
  expect(c.active()).toBe('left');
  expect(managed.every(window => !window.fullScreen)).toBe(true);
  await c.invoke('space.remove', { spaceId: second });
  expect(c.state.activeSpaceId).toBe('desktop-1');
  expect(contents(managed)).toEqual(before);
  for (const window of managed) expect(window).toBe(originals.get(window.id));
});

test('real Svelte assigned overview identity supports empty workspace controls, scroll clamps and exact return caret', async () => {
  const c = consumer([original('a')], proxy(spacesDefaults()), proxy(fullScreenDefaults()));
  const focus = c.physicalFocus();
  await open(c);
  const identity = c.state.overview;
  expect((await c.invoke('shell.missionControl.scroll', { region: 'windows' }, { top: 999, left: 888 })).target).toEqual({ region: 'windows', top: 80, left: 0 });
  expect((await c.invoke('shell.missionControl.scroll', { region: 'spaces' }, { top: 999, left: 888 })).target).toEqual({ region: 'spaces', top: 0, left: 120 });
  expect(c.state.overview).toBe(identity);
  expect((await c.invoke('shell.missionControl.close')).status).toBe('applied');
  expect(c.physicalFocus()).toEqual(focus);
  const empty = consumer([], proxy(spacesDefaults()));
  await open(empty);
  expect(empty.state.overview.selectedItemId).toBe('space:desktop-1');
  expect((await empty.invoke('space.create')).target.spaceId).toBe('desktop-2');
  expect(empty.physicalFocus()).toEqual({ kind: 'overview', itemId: 'space:desktop-2' });
});

test('failed actual overview preparation or initial control focus restores exact prior scene, focus, HOME and presentation state', async () => {
  for (const failure of ['prepare', 'focus', 'unmounted']) {
    const c = consumer([original('a'), original('b', 'safari', true)]), before = snapshot(c);
    if (failure === 'prepare') c.controls.failPrepare = true;
    if (failure === 'focus') c.controls.failOverviewFocus = 'window:a';
    if (failure === 'unmounted') c.controls.overview = false;
    expect((await c.invoke('shell.missionControl.open')).error.code).toBe('unavailable');
    expect(snapshot(c)).toEqual(before);
  }
});

test('failed create/select/collapse focus restores desktop lifetime, expanded selection, native focus and retained scroll', async () => {
  const c = consumer([original('a')]), second = await add(c);
  await open(c, true);
  await c.invoke('shell.missionControl.scroll', { region: 'spaces' }, { top: 0, left: 999 });
  let before = snapshot(c);
  c.controls.failOverviewFocus = 'space:desktop-3';
  expect((await c.invoke('space.create')).status).toBe('rejected');
  expect(snapshot(c)).toEqual(before);
  c.controls.failOverviewFocus = 'space:desktop-1';
  expect((await c.invoke('shell.missionControl.select', { itemId: 'space:desktop-1' })).status).toBe('rejected');
  expect(snapshot(c)).toEqual(before);
  c.controls.failOverviewFocus = null;
  await c.invoke('shell.missionControl.select', { itemId: `remove:${second}` });
  before = snapshot(c);
  c.controls.failOverviewFocus = 'add-space';
  expect((await c.invoke('shell.missionControl.setExpanded', {}, { expanded: false })).status).toBe('rejected');
  expect(snapshot(c)).toEqual(before);
});

test('failed foreground settlement or actual original activation restores moves/removal/overview instead of switching to a destination', async () => {
  const c = consumer([original('a'), original('b')]), second = await add(c);
  await open(c);
  c.controls.failForeground = true;
  let before = snapshot(c);
  expect((await c.invoke('window.moveToSpace', { windowId: 'a', spaceId: second })).status).toBe('rejected');
  expect(snapshot(c)).toEqual(before);
  expect((await c.invoke('space.remove', { spaceId: 'desktop-1' })).status).toBe('rejected');
  expect(snapshot(c)).toEqual(before);
  c.controls.failForeground = false;
  c.controls.failOriginalFocus = 'b';
  before = snapshot(c);
  expect((await c.invoke('shell.missionControl.activate', { windowId: 'b' })).status).toBe('rejected');
  expect(snapshot(c)).toEqual(before);
  expect((await c.invoke('space.activate', { spaceId: 'desktop-1' })).status).toBe('rejected');
  expect(snapshot(c)).toEqual(before);
});

test('a downstream pair rejection restores pre-begin flags, HOME/order, chooser/green/reveals, original owner and exact overview focus/scroll', async () => {
  const c = consumer([original('left', 'safari', true), original('right'), original('other', 'notes', true)]);
  c.presentation.greenMenu = { windowId: 'left', itemId: 'full-screen', scrollTop: 17 };
  c.presentation.revealed = { top: true, launcher: true };
  await open(c, true);
  await c.invoke('shell.missionControl.scroll', { region: 'spaces' }, { top: 0, left: 999 });
  const before = snapshot(c);
  c.controls.failDownstream = name => name === 'window.splitView.accept';
  const result = await c.invoke('space.pair', { windowId: 'right', spaceId: fullId('left') });
  expect(result.error.code).toBe('consumer_rejection');
  expect(snapshot(c)).toEqual(before);
});

test('actual post-pair preparation/focus failure restores both original flags and the prior overview after successful typed core transitions', async () => {
  for (const failure of ['prepare', 'focus', 'original']) {
    const c = consumer([original('left', 'safari', true), original('right')]);
    await open(c, true);
    const before = snapshot(c);
    if (failure === 'prepare') c.controls.failPrepare = true;
    if (failure === 'focus') c.controls.failOverviewFocus = `space:${groupId('left', 'right')}`;
    if (failure === 'original') c.controls.failOriginalFocus = 'right';
    expect((await c.invoke('space.pair', { windowId: 'right', spaceId: fullId('left') })).status).toBe('rejected');
    expect(snapshot(c)).toEqual(before);
  }
});

test('failure exiting the second paired original rolls back the first exit and retains exact pair identity/ratio and overview', async () => {
  const managed = [original('left', 'safari', true), original('right', 'notes', true)], c = consumer(managed);
  c.presentation.splitViews = [{ leftWindowId: 'left', rightWindowId: 'right', ratio: 0.7 }];
  c.reconcile();
  await open(c, true);
  await c.invoke('shell.missionControl.select', { itemId: `exit:${groupId('left', 'right')}` });
  const before = snapshot(c);
  c.controls.failDownstream = (name, target) => name === 'window.setFullScreen' && target.windowId === 'right';
  expect((await c.invoke('space.exitFullScreen', { spaceId: groupId('left', 'right') })).error.code).toBe('consumer_rejection');
  expect(snapshot(c)).toEqual(before);
});

test('pairing and exiting in Mission Control preserve frozen normal survivors, original HOME membership and the assigned overview return-focus owner', async () => {
  const managed = [original('right'), original('left', 'safari', true), original('survivor')];
  const c = consumer(managed, proxy(spacesDefaults()), proxy(fullScreenDefaults())), second = await add(c);
  managed.find(window => window.id === 'left').spaceId = second;
  const before = contents(managed), returnFocus = c.physicalFocus();
  await open(c, true);
  const overview = c.state.overview;
  const result = await c.invoke('space.pair', { windowId: 'right', spaceId: fullId('left') });
  expect(result.status).toBe('applied');
  expect(c.state.overview).toBe(overview);
  expect(c.state.overview.windowIds).toEqual(['survivor']);
  expect(c.state.overview.selectedItemId).toBe(`space:${groupId('left', 'right')}`);
  expect(c.physicalFocus()).toEqual({ kind: 'overview', itemId: `space:${groupId('left', 'right')}` });
  expect(managed.find(window => window.id === 'left').spaceId).toBe(second);
  expect(managed.find(window => window.id === 'right').spaceId).toBe('desktop-1');
  expect((await c.invoke('space.exitFullScreen', { spaceId: groupId('left', 'right') })).status).toBe('applied');
  expect(c.state.overview).toBe(overview);
  expect(c.state.overview.windowIds).toEqual(['survivor', 'right']);
  expect(c.state.activeSpaceId).toBe('desktop-1');
  expect(contents(managed)).toEqual(before);
  expect((await c.invoke('shell.missionControl.close')).status).toBe('applied');
  expect(c.physicalFocus()).toEqual(returnFocus);
});

test('closed and minimized overview lifetimes keep frozen survivors and select the nearest old enabled neighbor without activating it', async () => {
  const managed = ['a', 'b', 'c', 'd'].map(id => original(id)), c = consumer(managed);
  await open(c);
  await c.invoke('shell.missionControl.select', { itemId: 'window:b' });
  const active = c.active();
  managed.splice(managed.findIndex(window => window.id === 'b'), 1);
  managed.find(window => window.id === 'd').minimized = true;
  managed.reverse();
  c.reconcile();
  expect(c.state.overview.windowIds).toEqual(['a', 'c']);
  expect(c.state.overview.selectedItemId).toBe('window:c');
  expect(c.active()).toBe(active);
  expect(managed.find(window => window.id === 'd').spaceId).toBe('desktop-1');
  expect(managed.find(window => window.id === 'd').minimized).toBe(true);
});

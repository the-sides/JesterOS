import { expect, test } from 'bun:test';
import { createMenuBarCommands, menuBarDefaults, menuBarRequest, menuBarTargets } from '../frontend/src/menu-bar.js';

const leaf = (id, command = 'window.focus') => ({ id, label: id, enabled: true,
  request: { command, target: command.startsWith('session.') || command.startsWith('power.') ? {} : { windowId: id }, payload: {} } });
const provider = (menuId, items, extra = {}) => ({ menuId, kind: menuId, label: menuId, enabled: true, items, ...extra });

// A retained-focus consumer, not a mock of the command implementation: the view
// owns independent focus/scroll/availability and actions consume its real focus.
function consumer(definitions, profileId = 'macos-golden-gate-27.0.1') {
  const state = menuBarDefaults(), menus = structuredClone(definitions);
  const editor = { caret: 7, scrollTop: 96, text: 'Original document' };
  let focus = { kind: 'editor', editor }, presentation = 'switcher', available = true;
  let focusFailure = null, scrollFailure = false, restoreFailure = false, actionError = null, actionResult = { status: 'applied', target: {} };
  const hidden = new Set(), covered = new Set(), offsets = new Map(), actions = [];
  let captures = 0, lifecycle, restoreHook;
  const items = (menuId, level) => {
    let rows = menus.find(menu => menu.menuId === menuId)?.items ?? [];
    for (let index = 1; index <= level; index += 1) rows = rows.find(row => row.id === state.levels[index]?.parentId)?.children ?? [];
    return rows;
  };
  const mounted = (menuId, level) => available && state.menuId === menuId && !!state.levels[level]
    && !hidden.has(menuId) && !covered.has(level);
  const view = {
    available: menuId => available && !hidden.has(menuId),
    itemIds: (menuId, level) => mounted(menuId, level) ? items(menuId, level).filter(row => row.enabled && !row.separator).map(row => row.id) : [],
    focusedItem: (menuId, level) => focus.kind === 'row' && focus.menuId === menuId && focus.level === level ? focus.itemId : null,
    async focus(menuId, level, itemId) {
      if (!mounted(menuId, level) || focusFailure === `${menuId}:${level}:${itemId}`) {
        focus = { kind: 'lost' }; return false;
      }
      if (itemId !== null && !this.itemIds(menuId, level).includes(itemId)) return false;
      focus = { kind: itemId === null ? 'panel' : 'row', menuId, level, itemId };
      if (itemId && items(menuId, level).findIndex(row => row.id === itemId) > 1 && (offsets.get(level) ?? 0) < 80) offsets.set(level, 80);
      return true;
    },
    async focusInvoker(menuId) {
      if (!this.available(menuId) || focusFailure === `${menuId}:invoker`) { focus = { kind: 'lost' }; return false; }
      focus = { kind: 'invoker', menuId }; return true;
    },
    bounds: menuId => !view.available(menuId) ? null : { invoker: { x: 8, y: 0, width: 64, height: 24 },
      popups: state.menuId === menuId ? state.levels.flatMap((_, level) => covered.has(level) ? [] : [{ level,
        popup: { x: 8 + level * 100, y: 24, width: 100, height: 180 }, controls: [] }]) : [] },
    scrollTop: (menuId, level) => mounted(menuId, level) ? offsets.get(level) ?? 0 : null,
    async scroll(menuId, level, top) {
      if (!mounted(menuId, level) || scrollFailure) return null;
      const actual = Math.min(120, top); offsets.set(level, actual); return actual;
    },
  };
  const commands = createMenuBarCommands({ profile: { id: profileId, capabilities: ['shell.menu-bar', 'shell.window-menu', 'app.visibility', 'session.fictional'], applications: { notes: {}, safari: {} } },
    state, getMenus: () => menus, getView: () => view, available: () => available, settle: async () => {},
    registerLifecycle: value => { lifecycle = value; },
    captureFocus: () => { captures += 1; return focus; },
    restoreFocus: async token => { await restoreHook?.(token); if (restoreFailure) { focus = { kind: 'lost' }; return false; } focus = token; return true; },
    preparePresentation: () => { const before = presentation; presentation = null; return before; },
    restorePresentation: async token => { presentation = token; },
    invoke: async request => {
      if (actionError) throw actionError;
      actions.push({ request: structuredClone(request), focus, state: structuredClone(state) });
      return actionResult;
    },
  });
  return { state, menus, editor, view, actions, hidden, covered, offsets, lifecycle,
    run: (name, target = {}, payload = {}) => commands[name](target, payload),
    request: (action, menuId, args = {}) => { const request = menuBarRequest(action, menuId, menus, args); return commands[request.command](request.target ?? {}, request.payload ?? {}); },
    focus: () => focus, presentation: () => presentation, captures: () => captures,
    setFocus: value => { focus = value; }, failFocus: value => { focusFailure = value; },
    failScroll: value => { scrollFailure = value; }, setAvailable: value => { available = value; },
    failRestore: value => { restoreFailure = value; },
    setRestoreHook: value => { restoreHook = value; },
    setActionResult: value => { actionResult = value; }, setActionError: value => { actionError = value; } };
}

async function unchanged(scene, command, target = {}, payload = {}) {
  const before = structuredClone(scene.state), result = await scene.run(command, target, payload);
  expect(result.status).toBe('rejected'); expect(scene.state).toEqual(before); return result;
}

test('provider switching shares one popup and original editor return without recapturing menu focus', async () => {
  const s = consumer([provider('apple', [leaf('lock', 'session.lock')]), provider('application', [leaf('hide')], { appId: 'notes' }), provider('window', [leaf('close')])]);
  await s.request('open', 'apple'); await s.request('navigate', 'apple', { key: 'ArrowRight' });
  expect(s.state.menuId).toBe('application'); expect(s.state.appId).toBe('notes'); expect(s.captures()).toBe(1);
  await s.request('navigate', 'application', { key: 'ArrowRight' }); expect(s.state.menuId).toBe('window'); expect(s.state.appId).toBeNull();
  await s.request('open', 'apple'); await s.request('execute', 'apple', { itemId: 'lock' });
  expect(s.actions[0].focus).toEqual({ kind: 'editor', editor: s.editor });
  expect(s.actions[0].state.menuId).toBeNull(); expect(s.state.levels).toEqual([]); expect(s.captures()).toBe(1);
  expect(s.editor).toEqual({ caret: 7, scrollTop: 96, text: 'Original document' });
});

test('failed first mount restores competing presentation and original physical focus', async () => {
  const s = consumer([provider('apple', [leaf('lock')])]);
  s.failFocus('apple:0:lock');
  expect((await unchanged(s, 'session.menu.open', { menuId: 'apple' })).error.code).toBe('unavailable');
  expect(s.presentation()).toBe('switcher'); expect(s.focus().editor).toBe(s.editor);
  expect(s.lifecycle.getReturnFocus()).toBeUndefined();
  s.failFocus(null); await s.request('open', 'apple'); expect(s.captures()).toBe(2);
});

test('failed provider switch preserves the original popup selection, actual scroll and native focus', async () => {
  const s = consumer([provider('apple', [leaf('sleep'), leaf('restart'), leaf('lock')]), provider('window', [leaf('close')])]);
  await s.request('open', 'apple', { position: 'last' });
  expect(s.state.levels[0].scrollTop).toBe(80);
  s.failFocus('window:0:close');
  await unchanged(s, 'menu.open', { menuId: 'window' });
  expect(s.focus()).toEqual({ kind: 'row', menuId: 'apple', level: 0, itemId: 'lock' });
  expect(s.offsets.get(0)).toBe(80); expect(s.captures()).toBe(1);
  s.failFocus(null); await s.request('execute', 'apple', { itemId: 'lock' }); expect(s.actions[0].focus.editor).toBe(s.editor);
});

test('child navigation selects endpoints, wraps enabled rows, and returns one parent at a time', async () => {
  const s = consumer([provider('window', [{ id: 'resize', label: 'Move & Resize', enabled: true, children: [
    { ...leaf('blocked'), enabled: false }, leaf('fill'), { id: 'separator', label: '', enabled: false, separator: true },
    { id: 'more', label: 'More', enabled: true, children: [leaf('restore'), leaf('fullscreen')] },
  ] }, leaf('close')])]);
  await s.request('open', 'window'); await s.request('navigate', 'window', { key: 'Enter' });
  expect(s.state.levels).toEqual([{ parentId: null, itemId: 'resize', scrollTop: 0 }, { parentId: 'resize', itemId: 'fill', scrollTop: 0 }]);
  await s.request('navigate', 'window', { key: 'ArrowUp' }); expect(s.state.levels[1].itemId).toBe('more');
  await s.request('submenu', 'window', { itemId: 'more', position: 'last' }); expect(s.state.levels[2].itemId).toBe('fullscreen');
  await s.request('navigate', 'window', { key: 'Home' }); expect(s.state.levels[2].itemId).toBe('restore');
  await s.request('navigate', 'window', { key: 'Escape' }); expect(s.state.levels).toHaveLength(2); expect(s.focus().itemId).toBe('more');
  await s.request('navigate', 'window', { key: 'ArrowLeft' }); expect(s.state.levels).toHaveLength(1); expect(s.focus().itemId).toBe('resize');
  await s.request('navigate', 'window', { key: 'Tab' }); expect(s.state.menuId).toBeNull(); expect(s.focus()).toEqual({ kind: 'invoker', menuId: 'window' });
});

test('selecting an ancestor truncates descendants but reopening the same child preserves its chosen row', async () => {
  const s = consumer([provider('window', [{ id: 'resize', label: 'Resize', enabled: true, children: [leaf('fill'), leaf('restore'), leaf('fullscreen')] }, leaf('close')])]);
  await s.request('open', 'window'); await s.request('submenu', 'window', { itemId: 'resize', position: 'last' });
  await s.request('scroll', 'window', { top: 104, level: 1 });
  await s.request('submenu', 'window', { itemId: 'resize' });
  expect(s.state.levels[1]).toEqual({ parentId: 'resize', itemId: 'fullscreen', scrollTop: 104 });
  await s.request('select', 'window', { itemId: 'close' });
  expect(s.state.levels).toHaveLength(1); expect(s.focus().itemId).toBe('close');
  await unchanged(s, 'menu.execute', { menuId: 'window', itemId: 'fill' }); expect(s.actions).toEqual([]);
});

test('failed child focus or native return rolls the complete source path back', async () => {
  const s = consumer([provider('window', [{ id: 'resize', label: 'Resize', enabled: true, children: [leaf('fill')] }])]);
  await s.request('open', 'window'); s.failFocus('window:1:fill');
  await unchanged(s, 'menu.submenu.open', { menuId: 'window', itemId: 'resize' });
  expect(s.focus()).toEqual({ kind: 'row', menuId: 'window', level: 0, itemId: 'resize' });
  s.failFocus(null); await s.request('submenu', 'window', { itemId: 'resize' }); s.failFocus('window:0:resize');
  await unchanged(s, 'menu.submenu.close', { menuId: 'window' });
  expect(s.focus()).toEqual({ kind: 'row', menuId: 'window', level: 1, itemId: 'fill' });
});

test('a genuinely empty enabled child focuses its panel, while disabled rows never focus or execute', async () => {
  const s = consumer([provider('window', [{ id: 'empty', label: 'Empty', enabled: true, children: [{ ...leaf('disabled'), enabled: false }] },
    { id: 'separator', label: '', enabled: false, separator: true }, leaf('close')])]);
  await s.request('open', 'window'); await s.request('submenu', 'window', { itemId: 'empty' });
  expect(s.state.levels[1].itemId).toBeNull(); expect(s.focus()).toEqual({ kind: 'panel', menuId: 'window', level: 1, itemId: null });
  await s.request('navigate', 'window', { key: 'Enter' }); expect(s.actions).toEqual([]);
  expect((await unchanged(s, 'menu.select', { menuId: 'window', itemId: 'disabled' })).error.code).toBe('disabled');
  expect((await unchanged(s, 'menu.execute', { menuId: 'window', itemId: 'separator' })).error.code).toBe('disabled');
  await s.request('navigate', 'window', { key: 'Escape' }); await s.request('navigate', 'window', { key: 'ArrowUp' });
  expect(s.state.levels[0].itemId).toBe('close');
});

test('closed-heading arrows skip unavailable providers and capture the editor before opening the adjacent provider', async () => {
  const s = consumer([provider('apple', [leaf('lock')]), provider('application', [leaf('hide')], { appId: 'notes' }),
    provider('window', [leaf('close')]), provider('users', [leaf('login')], { enabled: false })]);
  s.hidden.add('application');
  const request = menuBarRequest('navigate', 'apple', [], { key: 'ArrowRight' });
  await s.run(request.command, request.target, request.payload);
  expect(s.state.menuId).toBe('window'); expect(s.captures()).toBe(1);
  await s.request('navigate', 'window', { key: 'ArrowRight' }); expect(s.state.menuId).toBe('apple');
  await s.request('close', 'apple');
  await unchanged(s, 'menu.navigate', { menuId: 'apple' }, { key: 'ArrowDown' });
});

test('wrong provider, stale application ownership and malformed closed payloads reject without native writes', async () => {
  const s = consumer([provider('apple', [leaf('lock')]), provider('application', [leaf('hide')], { appId: 'notes' }), provider('window', [leaf('close')])]);
  await s.request('open', 'application'); const native = s.focus();
  await unchanged(s, 'menu.close', { menuId: 'window' });
  await unchanged(s, 'session.menu.select', { menuId: 'apple', itemId: 'lock' });
  await unchanged(s, 'app.menu.open', { appId: 'notes' }, { position: 'first', itemId: 'hide' });
  await unchanged(s, 'app.menu.scroll', {}, { top: 20, level: 0 });
  await unchanged(s, 'menu.navigate', { menuId: 'application' }, { key: 'ArrowDown', extra: true });
  expect(s.focus()).toBe(native); expect(s.actions).toEqual([]);
  s.menus[1].appId = 'safari';
  expect((await unchanged(s, 'app.menu.select', { itemId: 'hide' })).error.code).toBe('not_found');
  await unchanged(s, 'app.menu.open', { appId: 'notes' });
});

test('a removed or disabled child path is rejected rather than executing a stale request', async () => {
  const s = consumer([provider('window', [{ id: 'resize', label: 'Resize', enabled: true, children: [leaf('fill'), leaf('restore')] }])]);
  await s.request('open', 'window'); await s.request('submenu', 'window', { itemId: 'resize' });
  s.menus[0].items[0].children.shift();
  expect((await unchanged(s, 'menu.execute', { menuId: 'window', itemId: 'restore' })).error.code).toBe('not_found');
  expect(s.actions).toEqual([]);
  s.menus[0].items[0].children.unshift(leaf('fill')); s.menus[0].items[0].enabled = false;
  expect((await unchanged(s, 'menu.navigate', { menuId: 'window' }, { key: 'ArrowDown' })).error.code).toBe('disabled');
});

test('child navigation has a hard eight-level bound and no root-close alias', async () => {
  let tree = [leaf('last')];
  for (let index = 8; index >= 0; index -= 1) tree = [{ id: `branch-${index}`, label: 'Branch', enabled: true, children: tree }];
  const s = consumer([provider('window', tree)]);
  await s.request('open', 'window');
  await unchanged(s, 'menu.submenu.close', { menuId: 'window' });
  for (let index = 0; index < 7; index += 1) await s.request('submenu', 'window', { itemId: `branch-${index}` });
  expect(s.state.levels).toHaveLength(8);
  expect((await unchanged(s, 'menu.submenu.open', { menuId: 'window', itemId: 'branch-7' })).error.code).toBe('disabled');
  expect(s.focus().level).toBe(7);
});

test('explicit ancestor scroll retains independent clamped offsets and cannot target a covered popup', async () => {
  const s = consumer([provider('application', [{ id: 'parent', label: 'Parent', enabled: true, children: [leaf('child')] }], { appId: 'notes' })]);
  await s.request('open', 'application'); await s.request('submenu', 'application', { itemId: 'parent' });
  await s.request('scroll', 'application', { top: 1000, level: 0 }); expect(s.state.levels[0].scrollTop).toBe(120); expect(s.state.levels[1].scrollTop).toBe(0);
  s.offsets.set(1, 43); await s.request('scroll', 'application', { top: 999, observe: true }); expect(s.state.levels[1].scrollTop).toBe(43);
  s.covered.add(0); await unchanged(s, 'menu.scroll', { menuId: 'application' }, { top: 10, level: 0 });
  await unchanged(s, 'menu.scroll', { menuId: 'application' }, { top: 10, level: 2 });
  expect(s.offsets.get(0)).toBe(120);
});

test('observed focus records only actual owned native rows and failed focus/scroll restores prior selection', async () => {
  const s = consumer([provider('application', [leaf('hide'), leaf('quit'), leaf('show-all')], { appId: 'notes' })]);
  await s.request('open', 'application');
  await unchanged(s, 'app.menu.select', { itemId: 'quit' }, { observe: true });
  s.setFocus({ kind: 'row', menuId: 'application', level: 0, itemId: 'quit' }); s.offsets.set(0, 36);
  await s.request('select', 'application', { itemId: 'quit', observe: true }); expect(s.state.levels[0]).toEqual({ parentId: null, itemId: 'quit', scrollTop: 36 });
  s.failFocus('application:0:show-all'); await unchanged(s, 'app.menu.select', { itemId: 'show-all' });
  expect(s.focus().itemId).toBe('quit'); expect(s.offsets.get(0)).toBe(36);
  s.failFocus(null); s.failScroll(true); await unchanged(s, 'app.menu.scroll', {}, { top: 100 }); expect(s.state.levels[0].scrollTop).toBe(36);
});

test('rejected canonical execution and failed original-focus restoration keep the popup and never lose its return owner', async () => {
  const s = consumer([provider('apple', [leaf('lock', 'session.lock')])]);
  await s.request('open', 'apple'); const token = s.lifecycle.getReturnFocus();
  s.failRestore(true); await unchanged(s, 'session.menu.select', { menuId: 'apple', itemId: 'lock' });
  expect(s.actions).toEqual([]); expect(s.focus().itemId).toBe('lock'); expect(s.lifecycle.getReturnFocus()).toBe(token);
  s.failRestore(false); s.setActionResult({ status: 'rejected', error: { code: 'disabled', message: 'Actual action declined.' } });
  const result = await unchanged(s, 'session.menu.select', { menuId: 'apple', itemId: 'lock' });
  expect(result.error).toEqual({ code: 'disabled', message: 'Actual action declined.' });
  expect(s.actions[0].focus.editor).toBe(s.editor); expect(s.focus().itemId).toBe('lock');
  s.setActionResult({ status: 'applied', target: {} }); await s.request('execute', 'apple', { itemId: 'lock' }); expect(s.lifecycle.getReturnFocus()).toBeUndefined();
});

test('programming errors remain thrown after rollback rather than masquerading as native unavailability', async () => {
  const s = consumer([provider('window', [leaf('close')])]), error = new Error('Broken canonical operation');
  await s.request('open', 'window'); const before = structuredClone(s.state); s.setActionError(error);
  await expect(s.request('execute', 'window', { itemId: 'close' })).rejects.toBe(error);
  expect(s.state).toEqual(before); expect(s.focus().itemId).toBe('close');
  expect(() => menuBarRequest('invented-action', 'window', s.menus)).toThrow(RangeError);
});

test('closed Window execution permits only a current enabled root leaf and returns its real window identity', async () => {
  const s = consumer([provider('window', [leaf('window:notes-1'), { id: 'resize', label: 'Resize', enabled: true, children: [leaf('fill')] }, { ...leaf('minimize'), enabled: false }])]);
  s.menus[0].items[0].request.target.windowId = 'notes-1';
  const result = await s.request('execute', 'window', { itemId: 'window:notes-1' });
  expect(result.target).toEqual({ menuId: 'window', itemId: 'window:notes-1', windowId: 'notes-1' });
  expect(s.focus()).toEqual({ kind: 'invoker', menuId: 'window' });
  await unchanged(s, 'menu.execute', { menuId: 'window', itemId: 'fill' });
  await unchanged(s, 'menu.execute', { menuId: 'window', itemId: 'resize' });
  await unchanged(s, 'menu.execute', { menuId: 'window', itemId: 'minimize' });
});

test('lifecycle clearing releases opaque return focus without focusing a disposed owner or reviving pending setup', async () => {
  const s = consumer([provider('apple', [leaf('lock')])]);
  await s.request('open', 'apple'); const native = s.focus();
  expect(s.lifecycle.getReturnFocus().editor).toBe(s.editor);
  s.lifecycle.clear(); expect(s.state.menuId).toBeNull(); expect(s.lifecycle.getReturnFocus()).toBeUndefined(); expect(s.focus()).toBe(native);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), mounted = new Promise(resolve => { entered = resolve; });
  const physicalFocus = s.view.focus;
  s.view.focus = async (...args) => { entered(); await gate; return physicalFocus.apply(s.view, args); };
  const pending = s.request('open', 'apple'); await mounted;
  s.lifecycle.clear(); release();
  expect((await pending).error.code).toBe('unavailable'); expect(s.state.menuId).toBeNull(); expect(s.lifecycle.getReturnFocus()).toBeUndefined();
});

test('detached discovery reports semantic ownership and native unavailable levels without exposing return tokens', async () => {
  const s = consumer([provider('window', [{ id: 'resize', label: 'Resize', enabled: true, children: [leaf('fill')] }])]);
  await s.request('open', 'window'); await s.request('submenu', 'window', { itemId: 'resize' }); s.covered.add(0);
  const targets = menuBarTargets(s.state, s.menus, () => s.view);
  expect(targets.providers[0].levels.map(level => level.available)).toEqual([false, true]);
  targets.providers[0].items[0].children[0].enabled = false; targets.levels[1].scrollTop = 99;
  expect(s.menus[0].items[0].children[0].enabled).toBe(true); expect(s.state.levels[1].scrollTop).toBe(0);
  const unavailableTargets = menuBarTargets(s.state, s.menus, () => null);
  expect(unavailableTargets.providers[0].available).toBe(false); expect(unavailableTargets.providers[0].bounds).toBeNull();
  expect(JSON.stringify(targets)).not.toContain('Original document');
});

test('historical profiles cannot mutate canonical menu state through new navigation or provider handlers', async () => {
  const s = consumer([provider('window', [leaf('close')])], 'macos-sonoma-14.0');
  expect((await unchanged(s, 'menu.navigate', { menuId: 'window' }, { key: 'ArrowRight' })).error.code).toBe('unsupported_profile');
  expect((await unchanged(s, 'menu.submenu.open', { menuId: 'window', itemId: 'close' })).error.code).toBe('unsupported_profile');
  expect((await unchanged(s, 'menu.open', { menuId: 'window' })).error.code).toBe('unsupported_profile');
});

test('returning from a scrolled child retains the parent offset actually revealed by native focus', async () => {
  const s = consumer([provider('window', [{ id: 'resize', label: 'Resize', enabled: true, children: [leaf('fill')] }])]);
  await s.request('open', 'window'); await s.request('submenu', 'window', { itemId: 'resize' });
  await s.request('scroll', 'window', { top: 120, level: 0 });
  const physicalFocus = s.view.focus;
  s.view.focus = async (...args) => {
    const focused = await physicalFocus.apply(s.view, args);
    if (focused && args[1] === 0) s.offsets.set(0, 24);
    return focused;
  };
  await s.run('menu.submenu.close', { menuId: 'window' });
  expect(s.state.levels[0].scrollTop).toBe(24); expect(s.offsets.get(0)).toBe(24); expect(s.focus().itemId).toBe('resize');
});

test('lifecycle interruption during original-focus restoration cannot dispatch a leaf into the new owner', async () => {
  const s = consumer([provider('apple', [leaf('lock', 'session.lock')])]);
  await s.request('open', 'apple');
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), restoring = new Promise(resolve => { entered = resolve; });
  s.setRestoreHook(async () => { entered(); await gate; });
  const pending = s.request('execute', 'apple', { itemId: 'lock' }); await restoring;
  s.lifecycle.clear(); release();
  expect((await pending).error.code).toBe('unavailable'); expect(s.actions).toEqual([]); expect(s.state.menuId).toBeNull();
  expect(s.lifecycle.getReturnFocus()).toBeUndefined();
});

test('the existing Window-menu scroll API scrolls its root pane even while a child is open', async () => {
  const s = consumer([provider('window', [{ id: 'resize', label: 'Resize', enabled: true, children: [leaf('fill')] }]), provider('apple', [leaf('lock')])]);
  await s.request('open', 'window'); await s.request('submenu', 'window', { itemId: 'resize' });
  await s.run('desktop.scroll', { region: 'window-menu' }, { top: 93 });
  expect(s.state.levels[0].scrollTop).toBe(93); expect(s.state.levels[1].scrollTop).toBe(0); expect(s.focus().level).toBe(1);
  s.covered.add(0); await unchanged(s, 'desktop.scroll', { region: 'window-menu' }, { top: 20 });
  await unchanged(s, 'desktop.scroll', { region: 'window-menu' }, { top: 20, observe: true });
  await s.request('open', 'apple'); await unchanged(s, 'desktop.scroll', { region: 'window-menu' }, { top: 20 });
});

test('opening a different scrollable parent reveals it before mounting its child and rolls back the former child on failure', async () => {
  const s = consumer([provider('window', [
    { id: 'first', label: 'First', enabled: true, children: [leaf('old-child')] }, leaf('close'),
    { id: 'later', label: 'Later', enabled: true, children: [leaf('new-child')] },
  ])]);
  await s.request('open', 'window'); await s.request('submenu', 'window', { itemId: 'first' });
  s.failFocus('window:1:new-child');
  await unchanged(s, 'menu.submenu.open', { menuId: 'window', itemId: 'later' });
  expect(s.focus()).toEqual({ kind: 'row', menuId: 'window', level: 1, itemId: 'old-child' }); expect(s.offsets.get(0)).toBe(0);
  s.failFocus(null); await s.request('submenu', 'window', { itemId: 'later' });
  expect(s.state.levels[0]).toEqual({ parentId: null, itemId: 'later', scrollTop: 80 });
  expect(s.state.levels[1].itemId).toBe('new-child');
});

test('app-owned command headings preserve original focus across cross-heading navigation and reject another app owner', async () => {
  const s = consumer([provider('file', [leaf('new-note')], { appId: 'notes' }),
    provider('edit', [leaf('search')], { appId: 'notes' })]);
  await s.request('open', 'file');
  expect(s.state.appId).toBe('notes');
  expect((await unchanged(s, 'app.commandMenu.execute', { menuId: 'file', appId: 'safari', itemId: 'new-note' })).error.code).toBe('disabled');
  expect((await unchanged(s, 'app.commandMenu.select', { menuId: 'file', appId: 'unknown', itemId: 'new-note' })).error.code).toBe('not_found');
  await s.request('navigate', 'file', { key: 'ArrowRight' });
  expect(s.state.menuId).toBe('edit'); expect(s.state.appId).toBe('notes'); expect(s.captures()).toBe(1);
  expect((await unchanged(s, 'app.commandMenu.execute', { menuId: 'file', appId: 'notes', itemId: 'new-note' })).error.code).toBe('unavailable');
  await s.request('execute', 'edit', { itemId: 'search' });
  expect(s.actions[0].focus.editor).toBe(s.editor); expect(s.state.menuId).toBeNull();
});

test('document state can disable the highlighted row without trapping navigation or allowing the disabled action', async () => {
  const s = consumer([provider('file', [leaf('new-note'), leaf('pin-note')], { appId: 'notes' })]);
  await s.request('open', 'file', { itemId: 'pin-note' });
  s.menus[0].items[1].enabled = false;
  expect((await unchanged(s, 'app.commandMenu.execute', { menuId: 'file', appId: 'notes', itemId: 'pin-note' })).error.code).toBe('disabled');
  await s.request('navigate', 'file', { key: 'ArrowDown' });
  expect(s.state.levels[0].itemId).toBe('new-note'); expect(s.focus().itemId).toBe('new-note'); expect(s.actions).toEqual([]);
  s.menus[0].items.shift();
  await s.request('navigate', 'file', { key: 'Home' });
  expect(s.state.levels[0].itemId).toBeNull(); expect(s.focus().kind).toBe('panel');
  await s.request('navigate', 'file', { key: 'Escape' }); expect(s.focus()).toEqual({ kind: 'invoker', menuId: 'file' });
});

test('an app switch during original-focus return cannot execute a same-named row for the replacement owner', async () => {
  const s = consumer([provider('file', [leaf('new-window')], { appId: 'notes' })]);
  await s.request('open', 'file');
  s.setRestoreHook(() => { s.menus[0].appId = 'safari'; });
  expect((await unchanged(s, 'app.commandMenu.execute', { menuId: 'file', appId: 'notes', itemId: 'new-window' })).error.code).toBe('not_found');
  expect(s.actions).toEqual([]); expect(s.state.appId).toBe('notes');
});

test('canonical preparation rechecks current document enablement after restoring original native focus', async () => {
  const s = consumer([provider('file', [leaf('new-note'), leaf('delete-note')], { appId: 'notes' })]);
  await s.request('open', 'file', { itemId: 'delete-note' });
  s.setRestoreHook(() => { s.menus[0].items[1].enabled = false; });
  expect((await unchanged(s, 'app.commandMenu.execute', { menuId: 'file', appId: 'notes', itemId: 'delete-note' })).error.code).toBe('disabled');
  expect(s.actions).toEqual([]); expect(s.editor.text).toBe('Original document');
});

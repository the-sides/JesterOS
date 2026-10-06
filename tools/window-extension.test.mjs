import { expect, test } from 'bun:test';
import { createWindowExtensionCommands } from '../frontend/src/window-extension-commands.js';

const window = (id, appId = 'finder', fields = {}) => ({ id, appId, title: id, minimized: false, fullScreen: false,
  spaceId: 'desktop-1', bounds: { x: 20, y: 40, width: 800, height: 600 }, ...fields });
function consumer(windows, activeWindowId) {
  const state = { windows, activeWindowId, activeAppId: 'finder', spaceId: 'desktop-1', available: true, hidden: false, quitting: false };
  const ctx = {
    getWindows: () => state.windows, getActiveAppId: () => state.activeAppId, getActiveWindowId: () => state.activeWindowId,
    getActiveSpaceId: () => state.spaceId, available: () => state.available,
    isRegistered: appId => ['finder', 'notes', 'safari'].includes(appId), isHidden: () => state.hidden, isQuitting: () => state.quitting,
    isPresented: entry => entry.spaceId === state.spaceId,
    captureFocus: () => new Proxy({}, { get() { throw new Error('opaque native focus read'); } }),
    prepare: async () => true, setWindows: next => { state.windows = next; },
    activate: id => { state.activeWindowId = id; }, finish: async () => {},
  };
  const domain = createWindowExtensionCommands(ctx);
  return { state, ctx, run: target => domain.handlers['app.bringAllToFront'](target ?? { appId: 'finder' }, {}) };
}

test('Bring All to Front raises current-Space app windows including utilities without moving other groups or changing window data', async () => {
  const first = window('first'), second = window('second'), info = window('info', 'finder', { utilityKind: 'desktop-info' });
  const safari = window('safari', 'safari'), notes = window('notes', 'notes');
  const minimized = window('minimized', 'finder', { minimized: true }), elsewhere = window('elsewhere', 'finder', { spaceId: 'desktop-2' });
  const value = consumer([first, safari, second, notes, minimized, elsewhere, info], 'second');
  const before = structuredClone(value.state.windows);
  expect((await value.run()).status).toBe('applied');
  expect(value.state.windows.map(entry => entry.id)).toEqual(['safari', 'notes', 'minimized', 'elsewhere', 'first', 'info', 'second']);
  expect(value.state.activeWindowId).toBe('second');
  for (const entry of before) expect(value.state.windows.find(current => current.id === entry.id)).toEqual(entry);
});

test('Windowless active Finder raises its existing foremost window without creating or restoring minimized windows', async () => {
  const first = window('first'), minimized = window('minimized', 'finder', { minimized: true }), second = window('second');
  const value = consumer([first, minimized, second, window('other', 'notes')], null);
  await value.run();
  expect(value.state.windows.map(entry => entry.id)).toEqual(['minimized', 'other', 'first', 'second']);
  expect(value.state.activeWindowId).toBe('second');
  expect(minimized.minimized).toBe(true);
});

test('Grouping an all-minimized, hidden, quitting or other-app group rejects without disturbing stacking or focus', async () => {
  for (const blocked of ['minimized', 'hidden', 'quitting', 'other-app']) {
    const value = consumer([window('finder'), window('other', 'notes')], 'finder');
    if (blocked === 'minimized') value.state.windows[0].minimized = true;
    if (blocked === 'hidden') value.state.hidden = true;
    if (blocked === 'quitting') value.state.quitting = true;
    const before = structuredClone(value.state);
    const result = await value.run({ appId: blocked === 'other-app' ? 'notes' : 'finder' });
    expect(result.status).toBe('rejected');
    expect(value.state).toEqual(before);
  }
});

test('Pending grouping cannot retarget a changed app, Space, window instance, order or eligibility', async () => {
  for (const change of [
    state => { state.activeAppId = 'notes'; },
    state => { state.spaceId = 'desktop-2'; },
    state => { state.windows[0] = { ...state.windows[0] }; },
    state => { state.windows.reverse(); },
    state => { state.windows[0].minimized = true; },
    state => { state.available = false; },
  ]) {
    const value = consumer([window('finder'), window('other', 'notes')], 'finder');
    let release;
    value.ctx.prepare = () => new Promise(resolve => { release = resolve; });
    const pending = value.run();
    change(value.state);
    const changed = structuredClone(value.state);
    release(true);
    expect((await pending).status).toBe('rejected');
    expect(value.state).toEqual(changed);
  }
});

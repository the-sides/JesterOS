import { expect, test } from 'bun:test';
import { createApplicationMenuCommands } from '../frontend/src/application-menu.js';
import { appCommandMenuProviders } from '../frontend/src/app-command-menus.js';
import { createNotesWorkspace, notesWorkspaceWindow } from '../frontend/src/notes-workspace-state.js';
import { createNotesWorkspaceCommands } from '../frontend/src/notes-workspace-commands.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');
function consumer() {
  const state = createNotesWorkspace(profile), window = { id: 'notes-main', appId: 'notes' };
  const view = { available: () => true };
  const controller = createNotesWorkspaceCommands({ profile, getState: () => state,
    getWindow: id => id === window.id ? window : null, getView: () => view,
    available: () => true, alive: () => true, focusWindow: async () => true,
    tick: async () => {}, getSceneTime: () => 1760000000000, canCommit: () => true });
  controller.windowOpened(window, { standalone: false });
  const execute = request => controller.handlers[request.command](request.target, request.payload ?? {});
  let panelCalls = 0, bridges = 0;
  const ctx = { profile, available: () => true, getActiveAppId: () => 'notes',
    getRunningAppIds: () => ['notes'], isHidden: () => false, isQuitting: () => false,
    openPanel: () => { panelCalls++; return { status: 'applied' }; },
    openNotesPreferences: async () => {
      bridges++;
      const result = await execute({ command: 'notes.sheet.open', target: { windowId: window.id }, payload: { sheet: 'preferences' } });
      return result.status === 'applied' ? { status: 'applied', target: { appId: 'notes', windowId: window.id } } : result;
    } };
  return { state, window, controller, execute, ctx, shell: createApplicationMenuCommands(ctx),
    counts: () => ({ panelCalls, bridges }),
    menus: () => appCommandMenuProviders({ profile, appId: 'notes', enabled: true, activeWindow: window, notes: state }) };
}
function row(c, group, id) { return c.menus().find(menu => menu.menuId === group).items.find(item => item.id === id); }

test('application settings opens the original canonical preferences sheet without a mirrored utility', async () => {
  const c = consumer(), documents = structuredClone(c.state.notes);
  const result = await c.shell['app.settings.open']({ appId: 'notes' }, {});
  expect(result).toEqual({ status: 'applied', target: { appId: 'notes', windowId: 'notes-main' } });
  expect(notesWorkspaceWindow(c.state, c.window.id).sheet).toBe('preferences');
  expect(c.state.windows).toHaveLength(1);
  expect(c.state.notes).toEqual(documents);
  expect(c.counts()).toEqual({ panelCalls: 0, bridges: 1 });
  const preferences = { ...c.state.preferences, sortBy: 'title', textSize: 24 };
  expect((await c.execute({ command: 'notes.preferences.set', target: { windowId: c.window.id }, payload: { preferences } })).status).toBe('applied');
  expect(c.state.preferences).toEqual(preferences);
  expect(c.state.notes).toEqual(documents);
  const before = structuredClone(c.state);
  expect((await c.execute({ command: 'notes.preferences.set', target: { windowId: c.window.id },
    payload: { preferences: { ...preferences, textSize: 25 } } })).status).toBe('rejected');
  expect(c.state).toEqual(before);
});

test('missing preferences bridge rejects rather than opening a replacement utility', async () => {
  const c = consumer(); delete c.ctx.openNotesPreferences;
  const handlers = createApplicationMenuCommands(c.ctx), before = structuredClone(c.state);
  expect((await handlers['app.settings.open']({ appId: 'notes' }, {})).error.code).toBe('unavailable');
  expect(c.state).toEqual(before); expect(c.counts().panelCalls).toBe(0);
});

test('Notes menus route view, native rich format and preferences to the canonical original session', async () => {
  const c = consumer();
  expect(row(c, 'format', 'title').request.command).toBe('notes.format');
  expect(row(c, 'view', 'gallery').request).toEqual({ command: 'notes.view.set', target: { windowId: c.window.id }, payload: { mode: 'gallery', standalone: false } });
  expect((await c.execute(row(c, 'view', 'gallery').request)).status).toBe('applied');
  expect(notesWorkspaceWindow(c.state, c.window.id).mode).toBe('gallery');
  expect((await c.execute(row(c, 'notes', 'preferences').request)).status).toBe('applied');
  expect(notesWorkspaceWindow(c.state, c.window.id).sheet).toBe('preferences');
  expect(row(c, 'window', 'minimize').request.command).toBe('window.setMinimized');
  expect(row(c, 'notes', 'quit').request.command).toBe('app.quit');
});

test('locked canonical content disables rich editing and export while preserving unlock access', () => {
  const c = consumer(), session = notesWorkspaceWindow(c.state, c.window.id);
  const note = c.state.notes.find(note => note.id === session.selectedId);
  note.lock = { secret: 'fictional', hint: '', unlocked: false };
  expect(row(c, 'edit', 'copy').enabled).toBe(false);
  expect(row(c, 'format', 'title').enabled).toBe(false);
  expect(row(c, 'file', 'export').enabled).toBe(false);
  expect(row(c, 'file', 'unlock').enabled).toBe(true);
});

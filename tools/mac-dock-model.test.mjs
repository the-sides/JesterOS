import { test, expect } from 'bun:test';
import { macDockApps, macDockDefaults, macDockContextItems, macDockWindowCards, macDockItems, macDockTiles, recordMacAppUse } from '../frontend/src/mac-dock-model.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createMacDesktopFileStore } from '../frontend/src/desktop-file-state.js';
import { macDockFolders } from '../frontend/src/mac-dock-folders.js';

const intersects = (a, b) => a.x < b.x + b.width - 0.001 && a.x + a.width > b.x + 0.001
  && a.y < b.y + b.height - 0.001 && a.y + a.height > b.y + 0.001;

test('dense App Exposé contains distinct live-window cards and labels without changing normal or minimized state', () => {
  const windows = Array.from({ length: 40 }, (_, index) => ({ id: `safari-${index}`, appId: 'safari', title: `Window ${index}`,
    minimized: index % 2 === 0, bounds: { x: index * 2, y: index * 3, width: 540, height: 360, scale: 0.75 },
    restoreBounds: index % 3 ? null : { x: 12, y: 18, width: 360, height: 240, scale: 0.5 } }));
  windows.push({ id: 'notes', appId: 'notes', title: 'Unrelated Notes', minimized: false, bounds: { x: 1, y: 1, width: 800, height: 300, scale: 0.8 } });
  const original = structuredClone(windows), area = { width: 320, height: 150 };
  const cards = macDockWindowCards(windows, 'safari', area);
  expect(cards.map(card => card.windowId)).toEqual(windows.filter(window => window.appId === 'safari').map(window => window.id));
  const boxes = cards.flatMap(card => [card.rect, card.label]);
  for (const [index, box] of boxes.entries()) {
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(area.width);
    expect(box.y + box.height).toBeLessThanOrEqual(area.height);
    expect(boxes.slice(index + 1).some(other => intersects(box, other))).toBe(false);
  }
  expect(windows).toEqual(original);
});

test('removing a pin retains running aliases, removes closed aliases, and does not duplicate declared recents', () => {
  const profile = getOSProfile('macos-mojave-10.14'), state = macDockDefaults(profile);
  state.pinnedAppIds = state.pinnedAppIds.filter(id => id !== 'safari');
  expect(macDockApps(profile, state, ['finder', 'safari']).main.map(app => app.id)).toContain('safari');
  expect(macDockApps(profile, state, ['finder']).main.map(app => app.id)).not.toContain('safari');
  state.pinnedAppIds.push('photos'); state.mainOrderAppIds.push('photos');
  const pinnedRecent = macDockApps(profile, state, ['finder', 'photos']);
  expect(pinnedRecent.main.filter(app => app.id === 'photos')).toHaveLength(1);
  expect(pinnedRecent.recent.map(app => app.id)).not.toContain('photos');
  state.pinnedAppIds = state.pinnedAppIds.filter(id => id !== 'photos');
  const unpinnedRecent = macDockApps(profile, state, ['finder']);
  expect(unpinnedRecent.main.map(app => app.id)).not.toContain('photos');
  expect(unpinnedRecent.recent.map(app => app.id)).toContain('photos');
});

test('successful app use orders unique recent aliases, excludes pins, and keeps older running apps reachable', () => {
  const profile = getOSProfile('macos-mojave-10.14'), state = macDockDefaults(profile);
  const ids = ['safari', 'mail', 'contacts', 'calendar'];
  state.pinnedAppIds = state.pinnedAppIds.filter(id => !ids.includes(id));
  for (const id of ids) recordMacAppUse(state, id);
  let apps = macDockApps(profile, state, ['finder', ...ids]);
  expect(apps.recent.map(app => app.id)).toEqual(['calendar', 'contacts', 'mail']);
  expect(apps.main.map(app => app.id)).toContain('safari');
  expect(apps.main.map(app => app.id)).not.toContain('mail');
  recordMacAppUse(state, 'mail');
  expect(state.recentHistory.filter(entry => entry.appId === 'mail')).toEqual([{ appId: 'mail', sequence: state.usageSequence }]);
  expect(macDockApps(profile, state, ids).recent.map(app => app.id)).toEqual(['mail', 'calendar', 'contacts']);
  state.pinnedAppIds.push('calendar');
  expect(macDockApps(profile, state, ids).recent.map(app => app.id)).toEqual(['mail', 'contacts', 'safari']);
  state.preferences.showRecent = false;
  apps = macDockApps(profile, state, ids);
  expect(apps.recent).toEqual([]);
  for (const id of ids) expect(apps.main.map(app => app.id)).toContain(id);
  const legacy = getOSProfile('macos-high-sierra-10.13'), legacyState = macDockDefaults(legacy);
  legacyState.pinnedAppIds = legacyState.pinnedAppIds.filter(id => id !== 'safari');
  recordMacAppUse(legacyState, 'safari');
  legacyState.preferences.showRecent = true;
  expect(macDockApps(legacy, legacyState, ['safari']).recent).toEqual([]);
  expect(macDockApps(legacy, legacyState, ['safari']).main.map(app => app.id)).toContain('safari');
});

test('minimized tiles project actual live records in file-side order and disappear on restore or app minimization', () => {
  const profile = getOSProfile('macos-mojave-10.14'), state = macDockDefaults(profile);
  const a = { id: 'a', appId: 'safari', title: 'A', minimized: true, bounds: { x: 9, y: 12, width: 500, height: 300, scale: 0.75 } };
  const b = { id: 'b', appId: 'safari', title: 'B', minimized: true, bounds: { x: 17, y: 21, width: 400, height: 250, scale: 0.5 } };
  const windows = [a, b], geometry = windows.map(window => ({ ...window.bounds }));
  state.secondaryOrderItemIds = ['window:b', 'downloads', 'window:a'];
  expect(macDockTiles(state, windows)).toEqual([b, a]);
  expect(macDockItems(profile, state, ['finder', 'safari'], windows, macDockFolders(state, createMacDesktopFileStore(profile))).filter(item => item.kind !== 'app').map(item => item.itemId))
    .toEqual(['separator', 'window:b', 'downloads', 'window:a', 'trash']);
  b.minimized = false;
  expect(macDockTiles(state, windows)).toEqual([a]);
  state.preferences.minimizeIntoApp = true;
  expect(macDockTiles(state, windows)).toEqual([]);
  state.preferences.minimizeIntoApp = false;
  state.appWindows = { appId: 'safari' };
  expect(macDockTiles(state, windows)).toEqual([]);
  state.appWindows = null;
  expect(macDockTiles(state, windows)).toEqual([a]);
  expect(windows.map(window => window.bounds)).toEqual(geometry);
});

test('Dock Hide requires another foreground receiver, while Show remains available without reopening a window', () => {
  const profile = getOSProfile('macos-mojave-10.14'), state = macDockDefaults(profile);
  state.context = { kind: 'app', appId: 'finder' };
  const hide = (running, quitting = [], hidden = []) =>
    macDockContextItems(profile, state, [], running, null, quitting, hidden).find(item => item.id === 'hide');
  expect(hide(['finder']).enabled).toBe(false);
  expect(hide(['finder', 'notes']).enabled).toBe(true);
  expect(hide(['finder', 'notes'], ['notes']).enabled).toBe(false);
  expect(hide(['finder', 'notes'], [], ['finder'])).toMatchObject({ label: 'Show', enabled: true });
  expect(hide(['finder', 'notes'], ['finder'], ['finder']).enabled).toBe(false);
});

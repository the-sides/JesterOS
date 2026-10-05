import { test, expect } from 'bun:test';
import { macDockApps, macDockDefaults, macDockWindowCards } from '../frontend/src/mac-dock-model.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';

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

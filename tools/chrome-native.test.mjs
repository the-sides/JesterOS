import { expect, test } from 'bun:test';
import { browserProfiles, createBrowserState, createBrowserWindow, browserSessionSnapshot, validateBrowserState } from '../frontend/src/browser-state.js';
import { createBrowserCommands, browserCatalog } from '../frontend/src/browser-commands.js';
import { canonicalStringUnits } from '../frontend/src/canonical-data.js';
import { chromeMenuProvider, chromeGlobalMenuProvider } from '../frontend/src/chrome-family-adapter.js';
import { chromeProfileMetadata } from '../frontend/src/chrome-profile-metadata.js';
import { chromePreferenceSections, chromeSelectedPreference } from '../frontend/src/chrome-preferences.js';

// Dependencies stand in only for native Root/DOM ports. Every browser mutation,
// validation, candidate budget and native ownership guard is production code.
function actor(profileId = 'macos-sonoma-14.0') {
  const profile = { id: profileId }, state = createBrowserState(profile);
  const primaryId = profileId.startsWith('windows11') ? 'edge' : 'safari';
  const roots = [{ id: 'chrome-one', appId: 'chrome' }, { id: 'primary-one', appId: primaryId }];
  state.windows.push(createBrowserWindow(state, roots[0].id, false, 'chrome'), createBrowserWindow(state, roots[1].id, false, primaryId));
  const views = new Map(roots.map(root => [root.id, { available: () => roots.includes(root), describe: () => ({ controlIds: ['address'], selection: null }) }]));
  let limit = Infinity, serial = 0, controller;
  const creates = [], closes = [];
  const ctx = {
    profile, getState: () => state, getWindow: id => roots.find(root => root.id === id), getView: id => views.get(id),
    available: root => roots.includes(root), getSceneTime: () => Date.parse('2023-10-17T09:41:00Z'), tick: async () => {},
    canCommit: delta => canonicalStringUnits(state) + delta <= limit,
    createWindow: (appId, options) => {
      creates.push({ appId, options });
      if (options.isCurrent() !== true) return false;
      const root = { id: options.restoreWindowId ?? `new-root-${++serial}`, appId };
      if (controller.windowOpened(root, options) !== true) return false;
      roots.push(root); views.set(root.id, { available: () => roots.includes(root), describe: () => ({ controlIds: ['address'], selection: null }) });
      return root.id;
    },
    closeWindow: (id, options) => {
      const root = roots.find(root => root.id === id);
      if (!root || options.isCurrent() !== true) return false;
      closes.push(root); roots.splice(roots.indexOf(root), 1); views.delete(id);
      controller.windowClosed(root); return true;
    },
  };
  controller = createBrowserCommands(ctx);
  const command = (suffix, payload = {}, windowId = roots[0]?.id ?? 'chrome-one', tab = false) => controller.handlers[`browser.${suffix}`]({ windowId, ...(tab ? { tabId: state.windows.find(row => row.id === windowId).activeTabId } : {}) }, payload);
  return { state, roots, views, controller, command, creates, closes, profile, setLimit: value => { limit = value; } };
}

for (const profileId of browserProfiles) {
  test(`${profileId}: Chrome uses the one controller and native canonical identity`, async () => {
    const s = actor(profileId), chrome = s.state.windows[0], primary = s.state.windows[1];
    const library = s.state.bookmarks, settings = s.state.settings;
    expect(chrome.nativeAppId).toBe('chrome');
    expect(validateBrowserState(s.state, s.profile)).toBe(true);
    const result = await s.command('bookmark.save', { parentId: 'browser-favorites', title: 'Shared production', url: 'jester://studio', kind: 'bookmark' });
    expect(result.status).toBe('applied');
    expect(s.state.bookmarks).toBe(library);
    expect(s.state.windows[0]).toBe(chrome);
    expect(s.state.windows[1]).toBe(primary);
    expect(library.some(row => row.title === 'Shared production')).toBe(true);
    expect((await s.command('preference.set', { key: 'searchSuggestions', value: false })).status).toBe('applied');
    expect(s.state.settings).toBe(settings);
    expect(s.controller.targets().windows.map(row => row.nativeAppId)).toEqual(['chrome', primary.nativeAppId]);
    expect(Object.keys(s.controller.handlers)).toEqual(Object.keys(browserCatalog));
    expect(Object.keys(s.controller.handlers).some(name => name.startsWith('chrome.'))).toBe(false);
  });
  test(`${profileId}: Chrome settings select unique valid canonical slots`, async () => {
    const s = actor(profileId), sections = chromePreferenceSections(s.profile);
    expect(new Set(sections.map(section => section.canonicalTab)).size).toBe(sections.length);
    for (const section of sections) {
      expect((await s.command('preference.tab', { tab: section.canonicalTab })).status).toBe('applied');
      expect(chromeSelectedPreference(s.state, s.profile, 'chrome-one').id).toBe(section.id);
      expect(validateBrowserState(s.state, s.profile)).toBe(true);
    }
  });
}

test('Chrome new/private window derives Chrome from the genuine source Root; retained primary remains separate', async () => {
  const s = actor();
  expect((await s.command('window.new', { private: true })).status).toBe('applied');
  expect(s.creates[0].appId).toBe('chrome');
  const created = s.state.windows.find(row => row.id === 'new-root-1');
  expect(created.nativeAppId).toBe('chrome'); expect(created.private).toBe(true);
  expect(s.state.windows.find(row => row.id === 'primary-one').nativeAppId).toBe('safari');
});

test('Chrome retained reopen never borrows a later closed Safari row', async () => {
  const s = actor(), chrome = s.state.windows[0];
  const retainedChrome = createBrowserWindow(s.state, 'closed-chrome', false, 'chrome'); retainedChrome.closed = true;
  const retainedSafari = createBrowserWindow(s.state, 'closed-safari', false, 'safari'); retainedSafari.closed = true;
  s.state.windows.push(retainedChrome, retainedSafari);
  expect((await s.command('window.reopen')).status).toBe('applied');
  expect(s.creates[0].appId).toBe('chrome'); expect(s.creates[0].options.restoreWindowId).toBe('closed-chrome');
  expect(s.state.windows.find(row => row.id === 'closed-chrome')).toBe(retainedChrome);
  expect(retainedSafari.closed).toBe(true); expect(s.state.windows[0]).toBe(chrome);
});

test('Chrome quit closes only actual Chrome Roots and does not cancel primary tabs', async () => {
  const s = actor(), primary = s.state.windows[1], originalTab = primary.tabs[0];
  expect((await s.command('window.new', { private: true })).status).toBe('applied');
  expect((await s.command('quit')).status).toBe('applied');
  expect(s.closes.map(root => root.appId)).toEqual(['chrome', 'chrome']);
  expect(s.roots.map(root => root.appId)).toEqual(['safari']);
  expect(primary.closed).toBe(false); expect(primary.tabs[0]).toBe(originalTab);
  expect(s.state.windows.some(row => row.private)).toBe(false);
});

test('real nativeAppId mismatch and same-ID replacement with foreign app never borrow Chrome controls', async () => {
  const s = actor(), before = JSON.stringify(s.state), root = s.roots[0];
  s.roots[0] = { id: root.id, appId: 'safari' };
  expect((await s.command('tab.new')).status).toBe('rejected');
  expect(JSON.stringify(s.state)).toBe(before);
});

test('Chrome canonical candidate rejection leaves complete original graph and counters intact', async () => {
  const s = actor(), before = JSON.stringify(s.state), original = s.state.windows[0];
  s.setLimit(canonicalStringUnits(s.state));
  expect((await s.command('tab.new')).status).toBe('rejected');
  expect(JSON.stringify(s.state)).toBe(before); expect(s.state.windows[0]).toBe(original);
  expect((await s.command('window.new', { private: true })).status).toBe('rejected');
  expect(s.roots).toHaveLength(2); expect(JSON.stringify(s.state)).toBe(before);
});

test('private Chrome snapshots strip actual windows/forms without stripping ordinary primary or bookmarks', () => {
  const s = actor(), privateChrome = createBrowserWindow(s.state, 'private-chrome', true, 'chrome');
  privateChrome.tabs[0].form.message = 'PRIVATE-FORM-NOT-PERSISTED'; s.state.windows.push(privateChrome);
  const snapshot = browserSessionSnapshot(s.state);
  expect(snapshot.windows.map(row => row.nativeAppId)).toEqual(['chrome', 'safari']);
  expect(JSON.stringify(snapshot)).not.toContain('PRIVATE-FORM-NOT-PERSISTED');
  expect(snapshot.bookmarks).toEqual(s.state.bookmarks); expect(privateChrome.tabs[0].form.message).toBe('PRIVATE-FORM-NOT-PERSISTED');
});

test('Chrome global Mac menus exclude the toolbar popup; Windows has only native three-dot group', () => {
  const s = actor(); s.state.windows.push(createBrowserWindow(s.state, 'chrome-two', false, 'chrome'));
  const options = { state: s.state, profile: s.profile, windowId: 'chrome-one', view: s.views.get('chrome-one') };
  expect(chromeMenuProvider(options).some(group => group.id === 'chrome')).toBe(true);
  expect(chromeGlobalMenuProvider(options).map(group => group.label)).toEqual(['Chrome','File','Edit','View','History','Bookmarks','Window','Help']);
  const windows = chromeMenuProvider(options).find(group => group.id === 'window').items;
  expect(windows.find(row => row.id === 'window-chrome-two').request.target.windowId).toBe('chrome-two');
  expect(windows.some(row => row.id === 'window-primary-one')).toBe(false);
  const w = actor('windows11-23h2-22631.2428');
  expect(chromeMenuProvider({ state: w.state, profile: w.profile, windowId: 'chrome-one', view: w.views.get('chrome-one') }).map(group => group.id)).toEqual(['chrome']);
});

test('five Chrome counterparts qualify gradual refresh and exact unavailable Golden Gate source', () => {
  expect(chromeProfileMetadata({ id: browserProfiles[0] }).era).toBe('classic');
  expect(chromeProfileMetadata({ id: browserProfiles[1] }).version.startsWith('69.')).toBe(true);
  expect(chromeProfileMetadata({ id: browserProfiles[2] }).qualifier).toContain('gradual');
  expect(chromeProfileMetadata({ id: browserProfiles[4] }).version).toBe('118.0.5993.89');
  expect(chromeProfileMetadata({ id: browserProfiles[3] }).qualifier).toContain('NOT an exact27 or current-latest build claim');
  expect(() => chromeProfileMetadata({ id: 'ubuntu-22.04' })).toThrow();
});

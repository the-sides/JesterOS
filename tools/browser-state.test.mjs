import { expect, test } from 'bun:test';
import { browserProfiles, createBrowserState, createBrowserWindow, validateBrowserState, browserSessionSnapshot } from '../frontend/src/browser-state.js';
import { resolveBrowserURL, browserPage, pageSource } from '../frontend/src/browser-pages.js';
import { createBrowserCommands } from '../frontend/src/browser-commands.js';
import { copyCanonicalData, canonicalStringUnits } from '../frontend/src/canonical-data.js';
import { createApplicationFileBridges } from '../frontend/src/application-file-bridges.js';
import { createMacDesktopFileStore } from '../frontend/src/desktop-file-state.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';
const profile = { id: 'macos-sonoma-14.0' };
function scene() {
  const state = createBrowserState(profile);
  state.windows.push(createBrowserWindow(state, 'window-1'));
  return state;
}

test('Unicode search bookmarks round-trip through the closed resolver without external navigation or HTML execution', () => {
  const result = resolveBrowserURL('🦊 café <script>alert(1)</script> '.repeat(100));
  expect(resolveBrowserURL(result.url)).toEqual(result);
  expect(result.url.length).toBeLessThanOrEqual(2048);
  expect(result.title.length).toBeLessThanOrEqual(256);
  const astral = resolveBrowserURL('🦊'.repeat(200));
  expect(astral.url.length).toBeLessThanOrEqual(2048);
  expect(resolveBrowserURL(astral.url)).toEqual(astral);
  expect(pageSource(result)).not.toContain('<script>alert(1)</script>');
  expect(browserPage(result).kind).toBe('search');
  const state = scene();
  state.windows[0].tabs[0].entries.push(result);
  state.windows[0].tabs[0].index = 1;
  state.windows[0].tabs[0].address = result.url;
  expect(validateBrowserState(state, profile)).toBe(true);
  const unknown = resolveBrowserURL('https://example.com/account');
  expect(unknown.error).toBe('offline');
  expect(unknown.url).toBe('https://example.com/account');
  expect(browserPage(resolveBrowserURL('https://studio.invalid')).kind).toBe('form');
});

test('semantic validation rejects forged local pages, folder cycles, borrowed identities and unsafe stored passwords', () => {
  const state = scene();
  const original = state.windows[0].tabs[0].entries[0];
  state.windows[0].tabs[0].entries[0] = { ...original, pageId: 'journal' };
  expect(validateBrowserState(state, profile)).toBe(false);
  state.windows[0].tabs[0].entries[0] = original;
  state.bookmarks.push({ id: 'folder-a', kind: 'folder', title: 'A', url: '', parentId: 'folder-b' }, { id: 'folder-b', kind: 'folder', title: 'B', url: '', parentId: 'folder-a' });
  expect(validateBrowserState(state, profile)).toBe(false);
  state.bookmarks.splice(-2);
  state.nextId = 1;
  expect(validateBrowserState(state, profile)).toBe(false);
  state.nextId = 2;
  state.passwords[0].password = 'an actual password is not permitted';
  expect(validateBrowserState(state, profile)).toBe(false);
});

test('saved-session snapshot drops private browsing and interrupts in-flight ownership without mutating the live scene', () => {
  const state = scene();
  const ordinary = state.windows[0], privateWindow = createBrowserWindow(state, 'window-private', true);
  state.windows.push(privateWindow);
  const tab = ordinary.tabs[0];
  tab.phase = 'loading'; tab.pending = resolveBrowserURL('journal'); tab.address = tab.pending.url; tab.loadToken++;
  privateWindow.tabs[0].form = { name: 'Private sample', email: 'private@studio.invalid', password: 'FICTIONAL-SAMPLE-ONLY', message: 'private draft', submitted: false };
  state.downloads.push({ id: `browser-download-${state.nextId++}`, windowId: ordinary.id, private: false, url: 'jester://downloads', name: 'Studio Call Sheet.txt', status: 'downloading', progress: 35, fileId: null, token: 1, error: '' });
  const snapshot = browserSessionSnapshot(state);
  expect(snapshot.windows.map(w => w.id)).toEqual([ordinary.id]);
  expect(snapshot.windows[0].tabs[0].phase).toBe('idle');
  expect(snapshot.windows[0].tabs[0].pending).toBeNull();
  expect(snapshot.downloads[0].status).toBe('cancelled');
  expect(JSON.stringify(snapshot)).not.toContain('private draft');
  expect(validateBrowserState(snapshot, profile)).toBe(true);
  expect(tab.phase).toBe('loading');
  expect(tab.pending.pageId).toBe('journal');
  expect(state.downloads[0].status).toBe('downloading');
  expect(privateWindow.tabs[0].form.message).toBe('private draft');
});

test('security warnings are authored policy outcomes and saved runtime tokens remain bounded', () => {
  const blocked = resolveBrowserURL('https://unsafe.studio.invalid');
  expect(blocked.error).toBe('security');
  const allowed = resolveBrowserURL(blocked.url, { blockFraud: false });
  expect(allowed.error).toBe('');
  expect(browserPage(allowed).heading).toBe('A deliberately flagged fictional site');
  const state = scene(), tab = state.windows[0].tabs[0];
  tab.entries.push(blocked, allowed); tab.index = 2; tab.address = allowed.url;
  expect(validateBrowserState(state, profile)).toBe(true);
  tab.phase = 'loading'; tab.pending = resolveBrowserURL('journal'); tab.loadToken = Number.MAX_SAFE_INTEGER;
  state.downloads.push({ id: `browser-download-${state.nextId++}`, windowId: state.windows[0].id, private: false, url: 'jester://downloads', name: 'Studio Call Sheet.txt', status: 'downloading', progress: 35, fileId: null, token: Number.MAX_SAFE_INTEGER, error: '' });
  const snapshot = browserSessionSnapshot(state);
  expect(snapshot.windows[0].tabs[0].loadToken).toBe(0);
  expect(snapshot.downloads[0].token).toBe(0);
  expect(validateBrowserState(snapshot, profile)).toBe(true);
});

test('closed schemas do not execute getters or accept sparse canonical collections', () => {
  const state = scene();
  let invoked = false;
  Object.defineProperty(state.windows[0], 'private', { enumerable: true, get() { invoked = true; return false; } });
  expect(validateBrowserState(state, profile)).toBe(false);
  expect(invoked).toBe(false);
  const sparse = scene();
  sparse.windows[0].tabs.length = 2;
  expect(validateBrowserState(sparse, profile)).toBe(false);
});

// Only native presentation/Root dependencies are supplied here. Browser
// transitions and the joined Files transaction use their production handlers.
function commandScene(address = 'jester://start') {
  const nativeProfile = getOSProfile(profile.id);
  const sceneTime = '2023-09-26T17:42:00Z';
  const state = scene(), record = state.windows[0], tab = record.tabs[0];
  const entry = resolveBrowserURL(address);
  tab.entries[0] = entry;
  tab.address = entry.url;
  tab.phase = entry.error ? 'error' : 'idle';
  expect(validateBrowserState(state, nativeProfile)).toBe(true);
  const nativeWindow = { id: record.id, appId: 'safari' };
  const sharedRoot = {
    sceneTime, browser: state, windows: [nativeWindow],
    macFiles: createMacDesktopFileStore(nativeProfile, Date.parse(sceneTime)),
    clipboard: { kind: 'text', text: '', fileIds: [] }, printJobs: [],
    retainedText: 'Another application owns this shared scene capacity.',
  };
  let live = true, mounted = true, blocked = false, limit = Infinity, reserved = 0;
  const budgetCalls = [], fileCalls = [], callbacks = [];
  const units = () => canonicalStringUnits(sharedRoot);
  const view = {
    available: () => mounted,
    describe: () => ({ controlIds: ['address'], selection: null }),
  };
  const ctx = {
    profile: nativeProfile, getState: () => state, alive: () => live,
    getWindow: id => sharedRoot.windows.find(window => window.id === id),
    getView: id => id === record.id && mounted ? view : null,
    available: window => !blocked && sharedRoot.windows.includes(window),
    getSceneTime: () => Date.parse(sharedRoot.sceneTime), tick: async () => {},
    canCommit: delta => {
      const accepted = units() + reserved + delta <= limit;
      budgetCalls.push({ delta, reserved, units: units(), accepted });
      return accepted;
    },
    reserve: (delta, commit) => {
      reserved += delta;
      try { return commit(); } finally { reserved -= delta; }
    },
    getStore: () => sharedRoot.macFiles, getClipboard: () => sharedRoot.clipboard,
    clipboard: {
      read: () => sharedRoot.clipboard.text,
      write: text => {
        const delta = text.length - sharedRoot.clipboard.text.length;
        if (!ctx.canCommit(delta)) return false;
        sharedRoot.clipboard.text = text;
        return true;
      },
    },
  };
  const files = createApplicationFileBridges(ctx);
  ctx.createFile = spec => {
    fileCalls.push(spec);
    const onCommit = spec.onCommit;
    return files.createFile({
      ...spec,
      ...(onCommit ? { onCommit: (fileId, publishedRecord, plannedRecord) => {
        const before = copyCanonicalData(state);
        const accepted = onCommit(fileId, publishedRecord, plannedRecord);
        callbacks.push({ fileId, plannedRecord: copyCanonicalData(plannedRecord), before, after: copyCanonicalData(state), accepted, reserved });
        return accepted;
      } } : {}),
    });
  };
  const commands = createBrowserCommands(ctx);
  const target = { windowId: record.id, tabId: tab.id };
  const windowTarget = { windowId: record.id };
  return {
    state, record, tab, nativeWindow, sharedRoot, ctx, view, files, commands,
    target, windowTarget, budgetCalls, fileCalls, callbacks, units,
    run: (suffix, payload = {}, commandTarget = target) => commands.handlers[`browser.${suffix}`](commandTarget, payload),
    setLimit: value => { limit = value; },
    setBlocked: value => { blocked = value; },
    closeSource: (retire = false) => {
      commands.windowClosed(record.id);
      sharedRoot.windows.splice(sharedRoot.windows.indexOf(nativeWindow), 1);
      mounted = false;
      if (retire) live = false;
    },
  };
}

const growthCommands = [
  { name: 'new tab', address: 'jester://start', suffix: 'tab.new', window: true, payload: {} },
  { name: 'navigation and history', address: 'jester://start', suffix: 'navigate', payload: { address: 'jester://guide' } },
  { name: 'bookmark row', address: 'jester://start', suffix: 'bookmark.save', window: true, payload: { parentId: 'browser-favorites', title: 'x', url: '', kind: 'folder' } },
  { name: 'permission row', address: 'jester://studio', suffix: 'permission', payload: { key: 'camera', value: 'allow' } },
  { name: 'download row', address: 'jester://downloads', suffix: 'download.start', payload: { name: 'Studio Call Sheet.txt' } },
];
for (const command of growthCommands) {
  test(`full shared-root budget rejects ${command.name} without a partial canonical write`, async () => {
    const f = commandScene(command.address);
    const before = copyCanonicalData(f.sharedRoot);
    const windows = f.state.windows, tabs = f.record.tabs, entries = f.tab.entries;
    const bookmarks = f.state.bookmarks, permissions = f.state.permissions, downloads = f.state.downloads;
    f.setLimit(f.units());
    const result = await f.run(command.suffix, command.payload, command.window ? f.windowTarget : f.target);
    expect(result.status).toBe('rejected');
    expect(result.error.code).toBe('limit_exceeded');
    expect(f.sharedRoot).toEqual(before);
    expect(f.state.windows).toBe(windows);
    expect(f.state.windows[0]).toBe(f.record);
    expect(f.record.tabs).toBe(tabs);
    expect(f.record.tabs[0]).toBe(f.tab);
    expect(f.tab.entries).toBe(entries);
    expect(f.state.bookmarks).toBe(bookmarks);
    expect(f.state.permissions).toBe(permissions);
    expect(f.state.downloads).toBe(downloads);
    expect(f.fileCalls).toHaveLength(0);
    expect(f.budgetCalls.some(call => call.delta > 0 && !call.accepted)).toBe(true);
    expect(validateBrowserState(f.state, profile)).toBe(true);
  });
}

test('new bookmark capacity includes record property names and two-digit collection indices, not just string values', async () => {
  const f = commandScene();
  for (let index = 0; index < 5; index++) {
    expect((await f.run('bookmark.save', { parentId: 'browser-favorites', title: `Folder ${index}`, url: '', kind: 'folder' }, f.windowTarget)).status).toBe('applied');
  }
  expect(f.state.bookmarks).toHaveLength(10);
  const before = copyCanonicalData(f.sharedRoot), oldRow = f.state.bookmarks[0];
  // The generated ID, its parent, title and kind fit; object keys and
  // the new array key "10" must still consume the complete-scene quota.
  const valuesOnly = `browser-bookmark-${f.state.nextId}`.length + 'browser-favorites'.length + 'x'.length + 'folder'.length;
  f.setLimit(f.units() + valuesOnly);
  const result = await f.run('bookmark.save', { parentId: 'browser-favorites', title: 'x', url: '', kind: 'folder' }, f.windowTarget);
  expect(result.status).toBe('rejected');
  expect(result.error.code).toBe('limit_exceeded');
  expect(f.sharedRoot).toEqual(before);
  expect(f.state.bookmarks[0]).toBe(oldRow);
  expect(f.budgetCalls.at(-1).delta).toBeGreaterThan(valuesOnly);
});

test('navigation revalidates the full entries-plus-history candidate after its loading presentation fits', async () => {
  const f = commandScene(), entry = resolveBrowserURL('jester://guide');
  const entries = f.tab.entries, oldEntry = entries[0], history = f.state.history, nextId = f.state.nextId;
  const loadingGrowth = canonicalStringUnits(entry) + entry.url.length - f.tab.address.length + 'loading'.length - f.tab.phase.length;
  f.setLimit(f.units() + loadingGrowth);
  const result = await f.run('navigate', { address: entry.url });
  expect(result.status).toBe('rejected');
  expect(result.error.code).toBe('limit_exceeded');
  expect(f.tab.entries).toBe(entries);
  expect(entries).toEqual([oldEntry]);
  expect(entries[0]).toBe(oldEntry);
  expect(f.state.history).toBe(history);
  expect(history).toHaveLength(0);
  expect(f.state.nextId).toBe(nextId);
  expect(f.tab.pending).toBeNull();
  expect(f.tab.phase).toBe('idle');
  expect(f.tab.address).toBe(oldEntry.url);
  expect(f.budgetCalls.some(call => call.accepted && call.delta > 0)).toBe(true);
  expect(f.budgetCalls.some(call => !call.accepted)).toBe(true);
  expect(validateBrowserState(f.state, profile)).toBe(true);
});

test('successful command candidates preserve existing browser records and collections through real writes', async () => {
  const f = commandScene('jester://studio');
  const identities = {
    windows: f.state.windows, tabs: f.record.tabs, entries: f.tab.entries,
    entry: f.tab.entries[0], find: f.tab.find, form: f.tab.form,
    settings: f.state.settings, bookmarks: f.state.bookmarks, favorite: f.state.bookmarks[0],
    permissions: f.state.permissions, history: f.state.history,
  };
  expect((await f.run('address', { value: 'jester://guide' })).status).toBe('applied');
  expect(f.tab.address).toBe('jester://guide');
  expect((await f.run('permission', { key: 'camera', value: 'allow' })).status).toBe('applied');
  const permission = f.state.permissions[0];
  expect((await f.run('permission', { key: 'microphone', value: 'deny' })).status).toBe('applied');
  expect(f.state.permissions[0]).toBe(permission);
  expect(permission.camera).toBe('allow');
  expect(permission.microphone).toBe('deny');
  expect((await f.run('bookmark.save', { id: identities.favorite.id, parentId: null, title: 'Saved favorites', url: '', kind: 'folder' }, f.windowTarget)).status).toBe('applied');
  expect(identities.favorite.title).toBe('Saved favorites');
  expect((await f.run('navigate', { address: 'jester://guide' })).status).toBe('applied');
  expect(f.state.history).toHaveLength(1);
  expect(f.state.history[0].at).toBe(Date.parse(f.sharedRoot.sceneTime));
  expect(f.state.history[0].url).toBe('jester://guide');
  expect((await f.run('tab.new', {}, f.windowTarget)).status).toBe('applied');
  expect(f.record.tabs).toHaveLength(2);
  expect(f.state.windows).toBe(identities.windows);
  expect(f.state.windows[0]).toBe(f.record);
  expect(f.record.tabs).toBe(identities.tabs);
  expect(f.record.tabs[0]).toBe(f.tab);
  expect(f.tab.entries).toBe(identities.entries);
  expect(f.tab.entries[0]).toBe(identities.entry);
  expect(f.tab.find).toBe(identities.find);
  expect(f.tab.form).toBe(identities.form);
  expect(f.state.settings).toBe(identities.settings);
  expect(f.state.bookmarks).toBe(identities.bookmarks);
  expect(f.state.bookmarks[0]).toBe(identities.favorite);
  expect(f.state.permissions).toBe(identities.permissions);
  expect(f.state.history).toBe(identities.history);
  expect(validateBrowserState(f.state, profile)).toBe(true);
});

function cancelledDownloadScene() {
  const f = commandScene('jester://downloads');
  f.state.downloads.push({
    id: `browser-download-${f.state.nextId++}`, windowId: f.record.id, private: false,
    url: 'jester://downloads', name: 'Studio Call Sheet.txt', status: 'cancelled',
    progress: 80, fileId: null, token: 1, error: '',
  });
  f.record.panel = 'downloads';
  expect(validateBrowserState(f.state, profile)).toBe(true);
  return f;
}

test('download completion joins actual Files growth and browser metadata under the same full-root quota', async () => {
  const probe = cancelledDownloadScene(), probeBefore = copyCanonicalData(probe.sharedRoot);
  const success = await probe.run('download.retry', { id: probe.state.downloads[0].id }, probe.windowTarget);
  expect(success.status).toBe('applied');
  const fileDelta = canonicalStringUnits(probe.sharedRoot.macFiles) - canonicalStringUnits(probeBefore.macFiles);
  const browserDelta = canonicalStringUnits(probe.state) - canonicalStringUnits(probeBefore.browser);
  expect(fileDelta).toBeGreaterThan(0);
  expect(browserDelta).toBeGreaterThan(0);

  const f = cancelledDownloadScene(), item = f.state.downloads[0];
  const files = f.sharedRoot.macFiles.files, beforeFiles = copyCanonicalData(f.sharedRoot.macFiles), base = f.units();
  const cap = base + fileDelta + browserDelta - 1;
  expect(base + fileDelta).toBeLessThanOrEqual(cap);
  expect(base + browserDelta).toBeLessThanOrEqual(cap);
  f.setLimit(cap);
  const result = await f.run('download.retry', { id: item.id }, f.windowTarget);
  expect(result.status).toBe('rejected');
  expect(f.sharedRoot.macFiles).toEqual(beforeFiles);
  expect(f.sharedRoot.macFiles.files).toBe(files);
  expect(f.state.downloads[0]).toBe(item);
  expect(item.fileId).toBeNull();
  expect(item.status).not.toBe('complete');
  expect(item.progress).toBeLessThan(100);
  for (const callback of f.callbacks) {
    expect(callback.accepted).toBe(false);
    expect(callback.after).toEqual(callback.before);
  }
  expect(f.budgetCalls.some(call => !call.accepted)).toBe(true);

  const exact = cancelledDownloadScene(), exactItem = exact.state.downloads[0], rows = exact.state.downloads;
  const downloadsFolder = exact.files.getFile('downloads'), rootFiles = exact.sharedRoot.macFiles.files;
  const exactCap = exact.units() + fileDelta + browserDelta;
  exact.setLimit(exactCap);
  const committed = await exact.run('download.retry', { id: exactItem.id }, exact.windowTarget);
  expect(committed.status).toBe('applied');
  expect(exact.state.downloads).toBe(rows);
  expect(exact.state.downloads[0]).toBe(exactItem);
  expect(exact.sharedRoot.macFiles.files).toBe(rootFiles);
  expect(exact.files.getFile('downloads')).toBe(downloadsFolder);
  expect(exactItem.status).toBe('complete');
  expect(exactItem.progress).toBe(100);
  expect(exactItem.fileId).toBe(committed.fileId);
  const actualFile = exact.files.getFile(committed.fileId);
  expect(actualFile).not.toBeNull();
  expect(actualFile.parentId).toBe('downloads');
  expect(actualFile.content).toBe(browserPage(resolveBrowserURL('downloads')).downloads[0].content);
  expect(exact.callbacks).toHaveLength(1);
  expect(exact.callbacks[0].accepted).toBe(true);
  expect(exact.callbacks[0].fileId).toBe(actualFile.id);
  expect(exact.callbacks[0].plannedRecord).toEqual(actualFile);
  expect(exact.callbacks[0].reserved).toBe(fileDelta);
  expect(exact.budgetCalls.some(call => call.reserved === fileDelta && call.accepted)).toBe(true);
  expect(exact.units()).toBe(exactCap);
  expect(validateBrowserState(exact.state, profile)).toBe(true);
});

for (const acknowledgment of ['applied result', 'truthy acknowledgment']) {
  test(`native clipboard keeps its ${acknowledgment} after exactly one real canonical edit closes the original Root`, async () => {
    const f = commandScene(), state = f.state, tab = f.tab, windows = state.windows, entries = tab.entries;
    let commits = 0, captured;
    f.view.clipboard = async (operation, boundary, isCurrent) => {
      expect(operation).toBe('paste');
      expect(isCurrent()).toBe(true);
      commits++;
      captured = await boundary.commit('address', 'jester://journal');
      expect(captured.status).toBe('applied');
      expect(f.tab.address).toBe('jester://journal');
      f.closeSource(true);
      expect(isCurrent()).toBe(false);
      return acknowledgment === 'applied result' ? captured : captured.status === 'applied';
    };
    const result = await f.run('clipboard', { operation: 'paste' }, f.windowTarget);
    expect(commits).toBe(1);
    expect(captured.status).toBe('applied');
    expect(result.status).toBe('applied');
    expect(result.presentationAvailable).toBe(false);
    expect(result.target).toEqual(f.windowTarget);
    // Ordinary close resets the displayed address, but not the acknowledged
    // canonical edit's result; the callback really committed before that close.
    expect(state.windows).toBe(windows);
    expect(state.windows[0]).toBe(f.record);
    expect(f.record.tabs[0]).toBe(tab);
    expect(tab.entries).toBe(entries);
    expect(f.record.closed).toBe(true);
    expect(f.sharedRoot.windows).toHaveLength(0);
  });
}

test('a clipboard candidate rejected by shared capacity is invoked once and cannot be acknowledged as applied', async () => {
  const f = commandScene(), before = copyCanonicalData(f.sharedRoot);
  let commits = 0, captured;
  f.setLimit(f.units());
  f.view.clipboard = async (operation, boundary, isCurrent) => {
    expect(isCurrent()).toBe(true);
    commits++;
    captured = await boundary.commit('address', 'x'.repeat(100));
    return captured;
  };
  const result = await f.run('clipboard', { operation: 'paste' }, f.windowTarget);
  expect(commits).toBe(1);
  expect(captured.status).toBe('rejected');
  expect(result.status).toBe('rejected');
  expect(f.sharedRoot).toEqual(before);
});

test('an acknowledged canonical print remains applied when its original source Root and controller retire after commit', async () => {
  const f = commandScene('jester://guide');
  let calls = 0;
  f.ctx.printDocument = async spec => {
    calls++;
    expect(spec.isCurrent()).toBe(true);
    expect(spec.source).toBe('browser');
    expect(spec.mode).toBe('print');
    const job = { id: 'print-job-1', windowId: spec.windowId, title: spec.title, mime: spec.mime, text: spec.text, html: spec.html, status: 'queued' };
    f.sharedRoot.printJobs.push(job);
    f.closeSource(true);
    expect(spec.isCurrent()).toBe(false);
    return { status: 'applied', jobId: job.id };
  };
  const result = await f.run('print');
  expect(calls).toBe(1);
  expect(f.sharedRoot.printJobs).toHaveLength(1);
  expect(result.jobId).toBe(f.sharedRoot.printJobs[0].id);
  expect(result.status).toBe('applied');
  expect(result.presentationAvailable).toBe(false);
  expect(result.target).toEqual(f.target);
});

test('an acknowledged actual file completion remains applied when the bridge closes its source immediately after its atomic commit', async () => {
  const f = commandScene('jester://downloads'), createFile = f.ctx.createFile;
  let calls = 0;
  f.ctx.createFile = async spec => {
    calls++;
    expect(spec.isCurrent()).toBe(true);
    const result = createFile(spec);
    expect(result.status).toBe('applied');
    expect(f.files.getFile(result.fileId)).not.toBeNull();
    f.closeSource(true);
    return result;
  };
  const result = await f.run('download.start', { name: 'Studio Call Sheet.txt' });
  expect(calls).toBe(1);
  expect(f.callbacks).toHaveLength(1);
  const item = f.state.downloads[0], file = f.files.getFile(item.fileId);
  expect(result.status).toBe('applied');
  expect(result.presentationAvailable).toBe(false);
  expect(result.fileId).toBe(file.id);
  expect(result.downloadId).toBe(item.id);
  expect(item.status).toBe('complete');
  expect(item.progress).toBe(100);
  expect(f.record.closed).toBe(true);
  expect(validateBrowserState(f.state, profile)).toBe(true);
});

test('native print cannot commit through a source blocked before the external transaction', async () => {
  const f = commandScene('jester://guide');
  f.ctx.printDocument = async spec => {
    f.setBlocked(true);
    if (!spec.isCurrent()) return { status: 'rejected', error: { code: 'stale_target', message: 'The original source became blocked before commit.' } };
    f.sharedRoot.printJobs.push({ id: 'print-job-1', title: spec.title });
    return { status: 'applied', jobId: 'print-job-1' };
  };
  const result = await f.run('print');
  expect(result.status).toBe('rejected');
  expect(f.sharedRoot.printJobs).toHaveLength(0);
});

test('closing and reopening two tabs from one real window keeps distinct retained records and existing tab identity', async () => {
  const f = commandScene(), originalTab = f.tab, tabs = f.record.tabs, closedTabs = f.state.closedTabs;
  expect((await f.run('tab.new', {}, f.windowTarget)).status).toBe('applied');
  const secondTab = tabs[1];
  expect((await f.run('tab.new', {}, f.windowTarget)).status).toBe('applied');
  const thirdTab = tabs[2];
  expect(new Set(tabs.map(tab => tab.id)).size).toBe(3);
  expect((await f.run('tab.close', {}, { windowId: f.record.id, tabId: thirdTab.id })).status).toBe('applied');
  const firstRetained = closedTabs[0], firstRetainedTab = firstRetained.tab;
  expect(firstRetainedTab.id).toBe(thirdTab.id);
  expect((await f.run('tab.close', {}, { windowId: f.record.id, tabId: secondTab.id })).status).toBe('applied');
  expect(f.state.closedTabs).toBe(closedTabs);
  expect(closedTabs).toHaveLength(2);
  expect(closedTabs[0]).not.toBe(closedTabs[1]);
  expect(closedTabs[0].tab).not.toBe(closedTabs[1].tab);
  expect(closedTabs[0].tab.id).toBe(secondTab.id);
  expect(closedTabs[1]).toBe(firstRetained);
  expect(closedTabs[1].tab).toBe(firstRetainedTab);
  expect(closedTabs.map(row => row.windowId)).toEqual([f.record.id, f.record.id]);
  expect(validateBrowserState(f.state, profile)).toBe(true);
  expect((await f.run('tab.reopen', {}, f.windowTarget)).status).toBe('applied');
  expect(tabs.map(tab => tab.id)).toEqual([originalTab.id, secondTab.id]);
  expect(closedTabs).toHaveLength(1);
  expect(closedTabs[0].tab.id).toBe(thirdTab.id);
  expect(validateBrowserState(f.state, profile)).toBe(true);
  expect((await f.run('tab.reopen', {}, f.windowTarget)).status).toBe('applied');
  expect(f.record.tabs).toBe(tabs);
  expect(tabs[0]).toBe(originalTab);
  expect(tabs.map(tab => tab.id)).toEqual([originalTab.id, secondTab.id, thirdTab.id]);
  expect(new Set(tabs.map(tab => tab.id)).size).toBe(3);
  expect(tabs[1]).not.toBe(tabs[2]);
  expect(closedTabs).toHaveLength(0);
  expect(validateBrowserState(f.state, profile)).toBe(true);
});

for (const command of ['print', 'pdf', 'download.start']) {
  test(`missing canonical bridge cannot acknowledge browser ${command}`, async () => {
    const f = commandScene('jester://downloads'), before = copyCanonicalData(f.sharedRoot);
    if (command === 'download.start') delete f.ctx.createFile;
    const result = await f.run(command, command === 'download.start' ? { name: 'Studio Call Sheet.txt' } : {});
    expect(result.status).toBe('rejected');
    expect(result.error.code).toBe('unavailable');
    expect(f.sharedRoot).toEqual(before);
    expect(f.callbacks).toHaveLength(0);
  });
}

test('closing the native download source before its real file precommit cannot create a canonical file', async () => {
  const f = commandScene('jester://downloads'), createFile = f.ctx.createFile;
  const beforeFiles = copyCanonicalData(f.sharedRoot.macFiles);
  f.ctx.createFile = async spec => {
    expect(spec.isCurrent()).toBe(true);
    f.closeSource();
    expect(spec.isCurrent()).toBe(false);
    return createFile(spec);
  };
  const result = await f.run('download.start', { name: 'Studio Call Sheet.txt' });
  expect(result.status).toBe('rejected');
  expect(f.sharedRoot.macFiles).toEqual(beforeFiles);
  expect(f.callbacks).toHaveLength(0);
  expect(f.state.downloads[0].fileId).toBeNull();
  expect(f.state.downloads[0].status).not.toBe('complete');
  expect(validateBrowserState(f.state, profile)).toBe(true);
});

test('a real committed browser edit is still applied when the final native flush retires its presentation', async () => {
  const f = commandScene();
  let flushes = 0;
  f.ctx.tick = async () => {
    flushes++;
    expect(f.tab.address).toBe('jester://journal');
    f.closeSource(true);
  };
  const result = await f.run('address', { value: 'jester://journal' });
  expect(flushes).toBe(1);
  expect(result.status).toBe('applied');
  expect(result.presentationAvailable).toBe(false);
  expect(result.target).toEqual(f.target);
  expect(f.record.closed).toBe(true);
  expect(f.sharedRoot.windows).toHaveLength(0);
});

test('required native application ownership persists across all five profiles without owner aliases', () => {
  for (const profileId of browserProfiles) {
    const nativeProfile = getOSProfile(profileId), state = createBrowserState(nativeProfile);
    const primary = createBrowserWindow(state, 'primary-root');
    const chrome = createBrowserWindow(state, 'chrome-root', false, 'chrome');
    state.windows.push(primary, chrome);
    expect(primary.nativeAppId).toBe(profileId.startsWith('windows11') ? 'edge' : 'safari');
    expect(chrome.nativeAppId).toBe('chrome');
    chrome.closed = true;
    expect(validateBrowserState(state, nativeProfile)).toBe(true);
    expect(browserSessionSnapshot(state).windows[1].nativeAppId).toBe('chrome');
    const missing = copyCanonicalData(state); delete missing.windows[1].nativeAppId;
    expect(validateBrowserState(missing, nativeProfile)).toBe(false);
    const alias = copyCanonicalData(state); alias.windows[1].appId = 'chrome';
    expect(validateBrowserState(alias, nativeProfile)).toBe(false);
    const foreign = copyCanonicalData(state); foreign.windows[0].nativeAppId = profileId.startsWith('windows11') ? 'safari' : 'edge';
    expect(validateBrowserState(foreign, nativeProfile)).toBe(false);
  }
});

test('one browser controller captures actual Chrome Root ownership and routes native menu and canonical edits', async () => {
  const f = commandScene(), chromeRoot = { id: 'chrome-root', appId: 'chrome' };
  expect(f.commands.windowOpened(chromeRoot)).toBe(true);
  f.sharedRoot.windows.push(chromeRoot);
  f.ctx.getView = id => f.ctx.getWindow(id) ? f.view : null;
  const chrome = f.state.windows.find(row => row.id === chromeRoot.id);
  const target = { windowId: chrome.id, tabId: chrome.activeTabId };
  expect((await f.run('address', { value: 'jester://journal' }, target)).status).toBe('applied');
  expect(chrome.tabs[0].address).toBe('jester://journal');
  expect(f.tab.address).toBe('jester://start');
  expect((await f.run('menu', { menu: 'chrome' }, { windowId: chrome.id })).status).toBe('applied');
  expect(f.commands.targets().windows.find(row => row.windowId === chrome.id).menus.some(row => row.id === 'chrome')).toBe(true);
  expect(f.commands.targets().windows.find(row => row.windowId === f.record.id).menus.some(row => row.id === 'chrome')).toBe(false);
  expect((await f.run('panel', { panel: 'source' }, { windowId: chrome.id })).status).toBe('applied');
  expect((await f.run('panel', { panel: 'source' }, f.windowTarget)).status).toBe('rejected');
  chromeRoot.appId = 'safari';
  expect((await f.run('address', { value: 'jester://studio' }, target)).status).toBe('rejected');
  expect(chrome.tabs[0].address).toBe('jester://journal');
  expect(f.commands.windowOpened({ id: chrome.id, appId: 'safari' })).toBe(false);
  expect(chrome.nativeAppId).toBe('chrome');
});

test('new and reopened windows derive native application from their captured source, never the last foreign closed row', async () => {
  const f = commandScene(), chromeRoot = { id: 'chrome-root', appId: 'chrome' };
  expect(f.commands.windowOpened(chromeRoot)).toBe(true);
  f.sharedRoot.windows.push(chromeRoot);
  f.ctx.getView = id => f.ctx.getWindow(id) ? f.view : null;
  const chrome = f.state.windows.find(row => row.id === chromeRoot.id), opened = [];
  f.ctx.createWindow = async (nativeAppId, options) => {
    expect(options.isCurrent()).toBe(true);
    const root = { id: options.restoreWindowId ?? `created-root-${opened.length}`, appId: nativeAppId };
    expect(f.commands.windowOpened(root, options)).toBe(true);
    f.sharedRoot.windows.push(root); opened.push({ root, options }); return root.id;
  };
  expect((await f.run('window.new', { private: false }, { windowId: chrome.id })).status).toBe('applied');
  expect(opened[0].root.appId).toBe('chrome');
  const retainedChrome = f.state.windows.find(row => row.id === opened[0].root.id);
  f.commands.windowClosed(retainedChrome.id);
  f.sharedRoot.windows.splice(f.sharedRoot.windows.indexOf(opened[0].root), 1);
  const foreign = createBrowserWindow(f.state, 'last-closed-safari');
  foreign.closed = true; f.state.windows.push(foreign);
  expect((await f.run('window.reopen', {}, { windowId: chrome.id })).status).toBe('applied');
  expect(opened[1].root.id).toBe(retainedChrome.id);
  expect(opened[1].root.appId).toBe('chrome');
  expect(foreign.closed).toBe(true);
  expect(retainedChrome.closed).toBe(false);
});

test('unified browser Quit and lifecycle quit only retire their own native application Roots', async () => {
  const f = commandScene(), chromeRoot = { id: 'chrome-root', appId: 'chrome' };
  expect(f.commands.windowOpened(chromeRoot)).toBe(true);
  f.sharedRoot.windows.push(chromeRoot);
  f.ctx.getView = id => f.ctx.getWindow(id) ? f.view : null;
  const chrome = f.state.windows.find(row => row.id === chromeRoot.id), closed = [];
  f.ctx.closeWindow = async (windowId, options) => {
    expect(options.isCurrent()).toBe(true);
    const root = f.ctx.getWindow(windowId);
    f.commands.windowClosed(windowId); f.sharedRoot.windows.splice(f.sharedRoot.windows.indexOf(root), 1);
    closed.push(windowId); return true;
  };
  expect((await f.run('quit', {}, { windowId: chrome.id })).status).toBe('applied');
  expect(closed).toEqual([chrome.id]);
  expect(chrome.closed).toBe(true);
  expect(f.record.closed).toBe(false);
  expect(f.ctx.getWindow(f.record.id)).toBe(f.nativeWindow);
  f.commands.appQuit('chrome');
  expect(f.record.closed).toBe(false);
  f.commands.appQuit('safari');
  expect(f.record.closed).toBe(true);
});

test('cancel and save end the real bookmark editing transaction without changing retained bookmarks on cancel', async () => {
  const s = commandScene('jester://guide'), originals = copyCanonicalData(s.state.bookmarks);
  expect((await s.run('bookmark.begin', {}, s.windowTarget)).status).toBe('applied');
  expect((await s.run('bookmark.edit', { field: 'title', value: '' }, s.windowTarget)).status).toBe('applied');
  expect((await s.run('bookmark.edit', { field: 'url', value: '' }, s.windowTarget)).status).toBe('applied');
  expect(s.record.bookmarkDraft.editing).toBe(true);
  expect((await s.run('bookmark.cancel', {}, s.windowTarget)).status).toBe('applied');
  expect(s.state.bookmarks).toEqual(originals);
  expect(s.record.bookmarkDraft.title).toBe('');
  await s.run('bookmark.begin', { kind: 'folder' }, s.windowTarget);
  expect((await s.run('bookmark.save', { parentId: 'browser-favorites', title: 'Production', url: '', kind: 'folder' }, s.windowTarget)).status).toBe('applied');
  expect(s.state.bookmarks.at(-1).title).toBe('Production');
  expect(s.record.bookmarkDraft.title).toBe('');
  expect(validateBrowserState(s.state, profile)).toBe(true);
});

test('Reading List opening visits its actual local article and marks only that retained item read', async () => {
  const s = commandScene(), reading = s.state.readingList[0];
  expect((await s.run('reading.open', { id: reading.id }, s.windowTarget)).status).toBe('applied');
  expect(s.tab.entries[s.tab.index].url).toBe(reading.url);
  expect(reading.read).toBe(true);
  expect(s.state.history[0].url).toBe(reading.url);
  expect(s.state.readingList[0]).toBe(reading);
});

test('stopping an actual loading navigation restores its committed address without a visit or pending entry', async () => {
  const s = commandScene('jester://guide');
  const navigating = s.run('navigate', { address: 'jester://journal' });
  expect(s.tab.phase).toBe('loading');
  expect((await s.run('stop')).status).toBe('applied');
  expect((await navigating).status).toBe('rejected');
  expect(s.tab.address).toBe('jester://guide');
  expect(s.tab.pending).toBe(null);
  expect(s.tab.entries).toHaveLength(1);
  expect(s.state.history).toHaveLength(0);
});

test('a fictional pop-up is blocked only when requested and a local grant opens the real journal tab', async () => {
  const s = commandScene('jester://studio');
  expect((await s.run('reload')).status).toBe('applied');
  expect(s.tab.popupBlocked).toBe(false);
  expect((await s.run('popup')).blocked).toBe(true);
  expect(s.record.tabs).toHaveLength(1);
  expect((await s.run('permission', { key: 'popups', value: 'allow' })).status).toBe('applied');
  expect((await s.run('popup')).status).toBe('applied');
  expect(s.record.tabs).toHaveLength(2);
  expect(s.record.tabs.find(row => row.id === s.record.activeTabId).entries[0].url).toBe('jester://journal');
  expect(s.tab.popupBlocked).toBe(false);
});

test('Clear History preparation and cancel preserve actual visits; its open modal rejects unrelated browser changes', async () => {
  const s = commandScene('jester://journal');
  await s.run('reload');
  const visits = copyCanonicalData(s.state.history);
  expect((await s.run('history.clear.prepare', { range: 'all' }, s.windowTarget)).status).toBe('applied');
  expect((await s.run('tab.new', {}, s.windowTarget)).status).toBe('rejected');
  expect(s.record.tabs).toHaveLength(1);
  expect((await s.run('history.clear.cancel', {}, s.windowTarget)).status).toBe('applied');
  expect(s.state.history).toEqual(visits);
  await s.run('history.clear.prepare', { range: 'all' }, s.windowTarget);
  expect((await s.run('history.clear', { range: 'all' }, s.windowTarget)).status).toBe('applied');
  expect(s.state.history).toHaveLength(0);
  expect(s.record.historyClear.open).toBe(false);
});

test('Same Page and Empty Page preferences create real local tab destinations rather than cosmetic settings', async () => {
  const s = commandScene('jester://journal');
  await s.run('preference.set', { key: 'newTabs', value: 'last' }, s.windowTarget);
  const same = await s.run('tab.new', {}, s.windowTarget);
  expect(s.record.tabs.find(row => row.id === same.tabId).entries[0].url).toBe('jester://journal');
  await s.run('preference.set', { key: 'newTabs', value: 'empty' }, s.windowTarget);
  const empty = await s.run('tab.new', {}, s.windowTarget);
  expect(s.record.tabs.find(row => row.id === empty.tabId).entries[0].pageId).toBe('empty');
});

test('new Same Page windows use their genuine source window rather than the last unrelated ordinary window', () => {
  const state = scene(), source = state.windows[0];
  state.settings.openWith = 'last';
  source.tabs[0].entries[0] = resolveBrowserURL('jester://guide');
  source.tabs[0].address = 'jester://guide';
  const other = createBrowserWindow(state, 'window-2');
  other.tabs[0].entries[0] = resolveBrowserURL('jester://journal');
  other.tabs[0].address = 'jester://journal';
  state.windows.push(other);
  const destination = createBrowserWindow(state, 'window-3', false, 'safari', source.id);
  expect(destination.tabs[0].entries[0].url).toBe('jester://guide');
});

test('opening a downloaded SVG retains its actual Files identity and bytes in a real browser tab without a Preview substitute', async () => {
  const s = commandScene('jester://downloads');
  s.ctx.getFile = id => s.sharedRoot.macFiles.files.find(row => row.id === id) ?? null;
  const downloaded = await s.run('download.start', { name: 'Coast Reference.svg' });
  expect(downloaded.status).toBe('applied');
  const file = s.ctx.getFile(downloaded.fileId), original = file.content, revision = file.revision;
  const opened = await s.run('download.open', { id: downloaded.downloadId }, s.windowTarget);
  expect(opened.status).toBe('applied');
  expect(s.record.tabs.find(row => row.id === s.record.activeTabId).entries[0].url).toBe(`jester://file/${file.id}`);
  expect(s.ctx.getFile(file.id)).toBe(file);
  expect(file.content).toBe(original);
  expect(file.revision).toBe(revision);
  expect(file.content.startsWith('<svg')).toBe(true);
  expect(validateBrowserState(s.state, profile)).toBe(true);
});

test('address limits preserve Unicode and exact encoded search URL bounds', () => {
  const address = 'https://example.invalid/' + 'a'.repeat(2024) + '🦊';
  const entry = resolveBrowserURL(address);
  expect(entry.url.isWellFormed()).toBe(true);
  expect(entry.url.length).toBeLessThanOrEqual(2048);
  expect(resolveBrowserURL(entry.url)).toEqual(entry);
  // A mixture can fill every final encoded unit, unlike repeated emoji alone.
  for (let suffix = 0; suffix < 12; suffix++) {
    const search = resolveBrowserURL('🦊'.repeat(169) + 'a'.repeat(suffix));
    expect(search.url.length).toBeLessThanOrEqual(2048);
    expect(resolveBrowserURL(search.url)).toEqual(search);
  }
});

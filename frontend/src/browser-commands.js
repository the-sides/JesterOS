import { defineCommand, object, empty, choice, flag, NONE } from './command-schema.js';
import { browserProfiles, browserPanels, browserSettingsSchema, browserValueConforms, validateBrowserState, browserNextToken, createBrowserWindow, createBrowserTab } from './browser-state.js';
import { browserPages, browserSiteURLs, browserPage, resolveBrowserURL, pageText, pageSource, browserSVGFileId, browserSVGSource } from './browser-pages.js';
import { browserPreferenceTabs, browserMenuProvider } from './browser-menus.js';
import { chromeMenuProvider } from './chrome-family-adapter.js';
import { copyCanonicalData, applyCanonicalData, canonicalStringUnits } from './canonical-data.js';
const str = (max = 2048) => ({ type: 'string', maxLength: max });
const id = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const num = (min, max) => ({ type: 'integer', minimum: min, maximum: max });
const wt = object({ windowId: id }), tt = object({ windowId: id, tabId: id });
const bookmark = { id, parentId: { anyOf: [{ type: 'null' }, id] }, title: str(256), url: str(), kind: choice('folder', 'bookmark') };
const specs = {
  address: [tt, object({ value: str() })], navigate: [tt, object({ address: str() })], back: [tt, empty], forward: [tt, empty], reload: [tt, empty], stop: [tt, empty],
  'file.open': [wt, object({ fileId: id })], 'file.decode': [tt, object({ fileId: id, revision: num(1, Number.MAX_SAFE_INTEGER - 1) })],
  'tab.new': [wt, empty], 'tab.select': [tt, empty], 'tab.close': [tt, empty], 'tab.pin': [tt, empty], 'tab.reopen': [wt, empty],
  'tab.detach': [tt, empty], 'window.merge': [wt, empty],
  'window.new': [wt, object({ private: flag })], 'window.close': [wt, empty], 'window.reopen': [wt, empty], 'window.focus': [wt, empty], quit: [wt, empty],
  panel: [wt, object({ panel: choice(...browserPanels) })], sidebar: [wt, empty], bookmarksBar: [wt, empty], menu: [wt, object({ menu: { anyOf: [{ type: 'null' }, str(64)] } })],
  'history.search': [wt, object({ query: str(256) })], 'history.clear': [wt, object({ range: choice('hour', 'day', 'all') })],
  'history.clear.prepare': [wt, object({ range: choice('hour', 'day', 'all') })], 'history.clear.cancel': [wt, empty],
  'bookmark.begin': [wt, object({ id, kind: choice('bookmark', 'folder') }, [])], 'bookmark.edit': [wt, object({ field: choice('title', 'url', 'parentId', 'kind'), value: { anyOf: [str(), { type: 'null' }] } })],
  'bookmark.cancel': [wt, empty], 'reading.open': [wt, object({ id })],
  'bookmark.save': [wt, object(bookmark, ['parentId', 'title', 'url', 'kind'])], 'bookmark.delete': [wt, object({ id })],
  'reading.add': [tt, empty], 'reading.toggle': [wt, object({ id })], 'reading.delete': [wt, object({ id })],
  'download.start': [tt, object({ name: str(256) })], 'download.cancel': [wt, object({ id })], 'download.retry': [wt, object({ id })], 'download.reveal': [wt, object({ id })], 'download.open': [wt, object({ id })],
  'download.clear': [wt, empty],
  reader: [tt, empty], zoom: [tt, object({ value: num(50, 300) })], 'find.open': [tt, empty], 'find.query': [tt, object({ query: str(256) })], 'find.next': [tt, object({ backward: flag })], 'find.close': [tt, empty],
  share: [tt, object({ destination: choice('mail', 'messages', 'copy') })], print: [tt, empty], pdf: [tt, empty],
  'form.edit': [tt, object({ field: choice('name', 'email', 'password', 'message'), value: str() })], 'form.submit': [tt, empty], 'autofill.open': [tt, empty], 'autofill.apply': [tt, empty],
  permission: [tt, object({ key: choice('camera', 'microphone', 'location', 'notifications', 'popups', 'reader', 'zoom'), value: { anyOf: [choice('ask', 'allow', 'deny'), flag, num(50, 300)] } })], popup: [tt, empty],
  'preference.tab': [wt, object({ tab: str(64) })], 'preference.set': [wt, object({ key: choice(...Object.keys(browserSettingsSchema.properties)), value: { anyOf: [str(), flag] } })],
  focus: [wt, object({ controlId: str(256) })], scroll: [wt, object({ areaId: choice('page', 'sidebar', 'sidebar-list', 'preferences', 'preferences-pane', 'overview', 'website', 'security', 'share', 'help', 'downloads-popover', 'menu-popup', 'suggestions', 'findbar', 'inspector', 'inspector-tree', 'inspector-list', 'inspector-detail'), top: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, left: { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } })],
  clipboard: [wt, object({ operation: choice('copy', 'cut', 'paste', 'selectAll', 'undo', 'redo') })],
  'inspector.nodes': [wt, empty], 'inspector.select': [wt, object({ nodeId: id })],
};
export const browserCatalog = Object.fromEntries(Object.entries(specs).map(([suffix, [target, payload]]) => defineCommand(browserProfiles, `browser.${suffix}`, 'browser.local', target, payload, ['Original mounted browser window and canonical browser graph, no blocked scene.', 'Authored local pages only; required canonical file/print/share/clipboard bridges must be available.'], [`Execute the native ${suffix} control and its bounded canonical transition; loading and download completions retain original record ownership.`], ['browser.windows', 'browser.bookmarks', 'browser.history', 'browser.readingList', 'browser.downloads', 'browser.permissions', 'browser.settings'], NONE, target)));
const reject = (code, message) => ({ status: 'rejected', error: { code, message } });
const stale = () => reject('stale_target', 'The original browser window, tab, load or mounted view changed.');
const invalid = message => reject('invalid_arguments', message ?? 'Use the closed browser command target and payload.');
const applied = (target, extra = {}) => ({ status: 'applied', target, ...extra });
const nativeBrowserMenuProvider = options => options.state.windows.find(window => window.id === options.windowId)?.nativeAppId === 'chrome' ? chromeMenuProvider(options) : browserMenuProvider(options);
export function createBrowserCommands(ctx, { acceptedAppIds = [ctx.profile.id.startsWith('windows11') ? 'edge' : 'safari', 'chrome'], menuProvider = ctx.menuProvider ?? nativeBrowserMenuProvider } = {}) {
  const state = ctx.getState(), windows = state.windows;
  const alive = () => ctx.getState() === state && state.profileId === ctx.profile.id && state.windows === windows && browserProfiles.includes(ctx.profile.id) && (!ctx.alive || ctx.alive());
  const now = () => { const raw = ctx.getSceneTime(); return typeof raw === 'number' ? raw : Date.parse(raw); };
  const limit = () => reject('limit_exceeded', 'The bounded browser or complete-scene text limit is reached.');
  const missing = () => reject('unavailable', 'The original mounted enabled native browser view and canonical bridge are required.');
  const ownsWindow = window => acceptedAppIds.includes(window.nativeAppId);
  const windowFor = id => windows.find(window => window.id === id && ownsWindow(window));
  const allocate = (candidate, kind) => `browser-${kind}-${candidate.nextId++}`;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const presentation = target => alive() && ctx.getView(target.windowId)?.available() === true;
  // Root's policy includes active file reservations; property names and array
  // indices belong to the candidate delta, not only newly typed string values.
  function mutate(change, guard = alive, transferredTabs = []) {
    if (!guard()) return stale();
    const candidate = copyCanonicalData(state), result = change(candidate);
    if (result?.status === 'rejected') return result;
    if (!validateBrowserState(candidate, ctx.profile)) return invalid('The proposed transition violates the closed canonical browser graph.');
    if (typeof ctx.canCommit !== 'function') return reject('unavailable', 'The complete-scene budget policy is required.');
    if (ctx.canCommit(canonicalStringUnits(candidate) - canonicalStringUnits(state)) !== true) return limit();
    if (!guard()) return stale();
    let adopted = null;
    if (transferredTabs.length) {
      adopted = new Set();
      const transfers = new Map(transferredTabs.map(tab => [tab.id, tab]));
      for (const window of candidate.windows) for (let index = 0; index < window.tabs.length; index++) {
        const tab = transfers.get(window.tabs[index].id);
        if (!tab) continue;
        applyCanonicalData(tab, window.tabs[index]); window.tabs[index] = tab; adopted.add(tab);
      }
    }
    applyCanonicalData(state, candidate, adopted);
    return result ?? applied({});
  }
  function owner(target) {
    if (!alive()) return null;
    const record = windowFor(target.windowId), native = ctx.getWindow(target.windowId), view = ctx.getView(target.windowId);
    if (!record || record.closed || !native || native.appId !== record.nativeAppId || !view || typeof ctx.available !== 'function' || ctx.available(native) !== true || view.available() !== true) return null;
    const tabs = record.tabs, tab = target.tabId ? tabs.find(tab => tab.id === target.tabId) : tabs.find(tab => tab.id === record.activeTabId);
    if (!tab) return null;
    const identityCurrent = () => alive() && !record.closed && windowFor(record.id) === record && ctx.getWindow(record.id) === native && native.appId === record.nativeAppId && ctx.getView(record.id) === view && record.tabs === tabs && tabs.includes(tab);
    const current = () => identityCurrent() && ctx.available(native) === true && view.available() === true;
    const entries = tab.entries, index = tab.index, token = tab.loadToken, entry = entries[index];
    const documentCurrent = () => current() && record.activeTabId === tab.id && tab.entries === entries && tab.index === index && tab.loadToken === token && tab.entries[index] === entry;
    return { record, native, view, tabs, tab, entry, current, identityCurrent, documentCurrent };
  }
  function changeTab(lease, change, guard = lease.current) {
    return mutate(candidate => {
      const window = candidate.windows.find(window => window.id === lease.record.id), tab = window?.tabs.find(tab => tab.id === lease.tab.id);
      if (!window || !tab) return stale();
      return change(candidate, window, tab);
    }, guard);
  }
  function local(suffix, target, payload, lease) {
    return changeTab(lease, (state, window, tab) => {
      const windows = state.windows, tabs = window.tabs, entry = tab.entries[tab.index], done = extra => applied(target, extra);
      if (suffix === 'bookmark.save' && payload.id === 'browser-favorites' && (payload.kind !== 'folder' || payload.parentId !== null)) return invalid('The Favorites root remains a top-level folder.');
      switch (suffix) {
        case 'address': tab.address = payload.value; return done();
        case 'stop': if (tab.phase !== 'loading') return invalid('This tab is not loading.'); tab.loadToken = browserNextToken(tab.loadToken); tab.pending = null; tab.phase = entry.error ? 'error' : 'idle'; tab.address = entry.url; return done();
        case 'tab.new': { if (tabs.length >= 32) return limit(); const address = state.settings.newTabs === 'homepage' ? state.settings.homepage : state.settings.newTabs === 'empty' ? 'jester://empty' : state.settings.newTabs === 'last' ? entry.url : 'jester://start'; const row = createBrowserTab(state, address); tabs.push(row); if (state.settings.switchToNewTab) window.activeTabId = row.id; return done({ tabId: row.id }); }
        case 'tab.select': window.activeTabId = tab.id; window.panel = 'none'; return done();
        case 'tab.pin': tab.pinned = !tab.pinned; tabs.splice(tabs.indexOf(tab), 1); tabs.splice(tab.pinned ? 0 : tabs.filter(tab => tab.pinned).length, 0, tab); return done();
        case 'tab.close': {
          if (tab.pinned) return invalid('Unpin this tab before closing it.');
          if (!window.private) { const closed = copyCanonicalData(tab); closed.pending = null; closed.loadToken = browserNextToken(closed.loadToken); closed.phase = closed.entries[closed.index].error ? 'error' : 'idle'; state.closedTabs.unshift({ windowId: window.id, tab: closed }); if (state.closedTabs.length > 32) state.closedTabs.pop(); }
          const index = tabs.indexOf(tab); tabs.splice(index, 1); if (window.activeTabId === tab.id) window.activeTabId = tabs[Math.min(index, tabs.length - 1)].id; return done();
        }
        case 'tab.reopen': { if (window.private) return invalid('Private closed tabs are not retained.'); if (tabs.length >= 32) return limit(); const index = state.closedTabs.findIndex(row => row.windowId === window.id); if (index < 0) return invalid('No closed tab belongs to this window.'); const tab = state.closedTabs.splice(index, 1)[0].tab; tabs.push(tab); window.activeTabId = tab.id; return done({ tabId: tab.id }); }
        case 'panel': if (['source', 'inspector'].includes(payload.panel) && !state.settings.develop && window.nativeAppId === 'safari') return invalid('Enable the Develop menu in Advanced first.'); window.panel = payload.panel; window.menu = null; return done();
        case 'sidebar': window.sidebar = !window.sidebar; return done();
        case 'bookmarksBar': window.bookmarksBar = !window.bookmarksBar; return done();
        case 'menu': if (payload.menu !== null && !menuProvider({ state, profile: ctx.profile, windowId: window.id, view: lease.view }).some(group => group.id === payload.menu)) return invalid('Choose a current native menu heading.'); window.menu = payload.menu; return done();
        case 'history.search': window.historyQuery = payload.query; return done();
        case 'history.clear.prepare': window.historyClear.open = true; window.historyClear.range = payload.range; window.panel = 'history'; window.menu = null; return done();
        case 'history.clear.cancel': window.historyClear.open = false; return done();
        case 'history.clear': { const cutoff = payload.range === 'hour' ? now() - 3600000 : payload.range === 'day' ? now() - 86400000 : -1; state.history = state.history.filter(row => row.at < cutoff); window.historyClear.open = false; return done(); }
        case 'bookmark.begin': { const row = payload.id ? state.bookmarks.find(row => row.id === payload.id) : null; if (payload.id && !row) return stale(); window.bookmarkDraft = row ? { ...row, editing: true } : { id: null, parentId: 'browser-favorites', title: payload.kind === 'folder' ? 'Untitled Folder' : entry.title, url: payload.kind === 'folder' ? '' : entry.url, kind: payload.kind ?? 'bookmark', editing: true }; window.panel = 'bookmarks'; return done(); }
        case 'bookmark.edit': { if (!window.bookmarkDraft.editing) return invalid('Open the actual bookmark editor before changing its draft.'); const schema = payload.field === 'parentId' ? bookmark.parentId : bookmark[payload.field]; if (!browserValueConforms(payload.value, schema)) return invalid(); window.bookmarkDraft[payload.field] = payload.value; if (payload.field === 'kind' && payload.value === 'folder') window.bookmarkDraft.url = ''; return done(); }
        case 'bookmark.cancel': window.bookmarkDraft = { id: null, parentId: null, title: '', url: '', kind: 'bookmark', editing: false }; return done();
        case 'bookmark.save': {
          const row = payload.id ? state.bookmarks.find(row => row.id === payload.id) : null; if (payload.id && !row) return stale();
          if (!payload.title.trim() || payload.kind === 'bookmark' && !payload.url.trim() || payload.kind === 'folder' && payload.url !== '') return invalid('A bookmark needs a title and address; a folder has no address.');
          const parent = payload.parentId ? state.bookmarks.find(row => row.id === payload.parentId) : null; if (payload.parentId && parent?.kind !== 'folder') return invalid('Choose an existing bookmark folder.');
          for (let ancestor = parent; ancestor; ancestor = state.bookmarks.find(row => row.id === ancestor.parentId)) if (ancestor === row) return invalid('A folder cannot contain itself.');
          if (!row && state.bookmarks.length >= 256) return limit();
          if (row?.kind === 'folder' && payload.kind !== 'folder' && state.bookmarks.some(child => child.parentId === row.id)) return invalid('Move or delete the folder’s children first.');
          const data = { parentId: payload.parentId, title: payload.title, url: payload.url, kind: payload.kind }; if (row) Object.assign(row, data); else state.bookmarks.push({ id: allocate(state, 'bookmark'), ...data }); window.bookmarkDraft = { id: null, parentId: null, title: '', url: '', kind: 'bookmark', editing: false }; return done();
        }
        case 'bookmark.delete': { const row = state.bookmarks.find(row => row.id === payload.id); if (!row) return stale(); if (row.id === 'browser-favorites') return invalid('The Favorites root is retained.'); const ids = new Set([row.id]); let changed = true; while (changed) { changed = false; for (const row of state.bookmarks) if (ids.has(row.parentId) && !ids.has(row.id)) { ids.add(row.id); changed = true; } } state.bookmarks = state.bookmarks.filter(row => !ids.has(row.id)); if (ids.has(window.bookmarkDraft.id)) window.bookmarkDraft = { id: null, parentId: null, title: '', url: '', kind: 'bookmark', editing: false }; return done(); }
        case 'reading.add': if (state.readingList.some(row => row.url === entry.url)) return done(); if (state.readingList.length >= 256) return limit(); state.readingList.push({ id: allocate(state, 'reading'), url: entry.url, title: entry.title, read: false }); return done();
        case 'reading.toggle': case 'reading.delete': { const index = state.readingList.findIndex(row => row.id === payload.id); if (index < 0) return stale(); if (suffix === 'reading.delete') state.readingList.splice(index, 1); else state.readingList[index].read = !state.readingList[index].read; return done(); }
        case 'download.clear': state.downloads = state.downloads.filter(row => windowFor(row.windowId)?.nativeAppId !== window.nativeAppId || row.status === 'downloading' || row.private && row.windowId !== window.id); return done();
        case 'download.cancel': { const row = state.downloads.find(row => row.id === payload.id); if (!row || windowFor(row.windowId)?.nativeAppId !== window.nativeAppId || row.private && row.windowId !== window.id) return stale(); if (row.status !== 'downloading') return invalid('The download is not running.'); row.token = browserNextToken(row.token); row.status = 'cancelled'; return done(); }
        case 'reader': if (!browserPage(entry).reader) return invalid('This authored page has no Reader article.'); tab.reader = !tab.reader; return done();
        case 'zoom': tab.zoom = payload.value; return done();
        case 'form.edit': if (entry.pageId !== 'studio') return invalid('This page has no fictional form.'); if (payload.field === 'password' && !['', 'FICTIONAL-SAMPLE-ONLY'].includes(payload.value)) return invalid('Only the built-in fictional password is accepted.'); if (payload.value.length > (payload.field === 'message' ? 2048 : 256)) return limit(); tab.form[payload.field] = payload.value; tab.form.submitted = false; return done();
        case 'autofill.open': if (entry.pageId !== 'studio') return invalid('This page has no sample form.'); tab.autofillOpen = !tab.autofillOpen; return done();
        case 'permission': {
          const schema = payload.key === 'zoom' ? num(50, 300) : payload.key === 'reader' ? flag : payload.key === 'popups' ? choice('allow', 'deny') : choice('ask', 'allow', 'deny');
          if (!browserValueConforms(payload.value, schema) || !browserSiteURLs.includes(entry.url)) return invalid('Choose an authored site and a valid permission value.');
          const rows = window.private ? window.privatePermissions : state.permissions; let permission = rows.find(row => row.origin === entry.url);
          if (!permission) { if (rows.length >= 32) return limit(); permission = { origin: entry.url, camera: 'ask', microphone: 'ask', location: 'ask', notifications: 'ask', popups: 'deny', reader: false, zoom: 100 }; rows.push(permission); }
          permission[payload.key] = payload.value; if (payload.key === 'zoom') tab.zoom = payload.value; if (payload.key === 'reader') tab.reader = payload.value && browserPage(entry).reader; return done();
        }
        case 'popup': { if (entry.pageId !== 'studio') return invalid('This page has no sample pop-up.'); const permission = (window.private ? window.privatePermissions : state.permissions).find(row => row.origin === entry.url); if (permission?.popups !== 'allow') { tab.popupBlocked = true; return done({ blocked: true }); } if (tabs.length >= 32) return limit(); const row = createBrowserTab(state, 'jester://journal'); tabs.push(row); window.activeTabId = row.id; tab.popupBlocked = false; return done({ tabId: row.id }); }
        case 'preference.tab': if (!browserPreferenceTabs(ctx.profile, state.settings).includes(payload.tab)) return invalid('Choose a currently visible tab in this native counterpart.'); window.preferencesTab = payload.tab; return done();
        case 'preference.set': { if (!browserValueConforms(payload.value, browserSettingsSchema.properties[payload.key])) return invalid('The preference has the wrong value type.'); state.settings[payload.key] = payload.value; if (payload.key === 'develop' && !payload.value) for (const row of windows) { if (row.menu === 'develop') row.menu = null; if (['Developer', 'Feature Flags'].includes(row.preferencesTab)) row.preferencesTab = 'Advanced'; if (row.nativeAppId === 'safari' && ['source', 'inspector'].includes(row.panel)) row.panel = 'none'; } return done(); }
        default: return invalid();
      }
    });
  }
  function resolveAddress(address) {
    const fileId = browserSVGFileId(String(address).trim());
    return resolveBrowserURL(address, { ...state.settings, svgAvailable: !fileId || Boolean(browserSVGSource(ctx.getFile?.(fileId))) });
  }
  async function navigate(lease, entry, mode = 'push', index = null, ownRequest = () => true, finish = null) {
    if (!lease.documentCurrent() || !ownRequest()) return stale();
    if (entry.pageId === 'unsafe' || entry.pageId === 'svg' || browserSVGFileId(entry.url)) entry = resolveAddress(entry.url);
    const started = changeTab(lease, (_, window, tab) => {
      tab.loadToken = browserNextToken(tab.loadToken); tab.pending = copyCanonicalData(entry); tab.phase = 'loading'; tab.address = entry.url; tab.reader = false; tab.find.token = browserNextToken(tab.find.token); tab.find.index = 0; tab.find.query = ''; tab.form.submitted = false; tab.autofillOpen = false; tab.popupBlocked = false; window.inspectorNodeId = null; window.panel = 'none';
    });
    if (started.status !== 'applied') return started;
    const tab = lease.tab, entries = tab.entries, token = tab.loadToken, pending = tab.pending;
    const current = () => lease.current() && ownRequest() && tab.entries === entries && tab.loadToken === token && tab.pending === pending;
    const interrupted = () => {
      const guard = () => alive() && lease.record.tabs === lease.tabs && lease.tabs.includes(tab) && tab.entries === entries && tab.loadToken === token && tab.pending === pending;
      const result = changeTab(lease, (_, window, tab) => { tab.pending = null; tab.phase = tab.entries[tab.index].error ? 'error' : 'idle'; tab.address = tab.entries[tab.index].url; }, guard);
      // Other apps may have consumed the loading stage's released address units.
      // Cancellation still removes pending data without allocating a restored URL.
      if (result.error?.code === 'limit_exceeded') changeTab(lease, (_, window, tab) => { tab.pending = null; tab.phase = tab.entries[tab.index].error ? 'error' : 'idle'; }, guard);
      return stale();
    };
    await ctx.tick(); if (!current()) return interrupted();
    await pause(180); if (!current()) return interrupted();
    const result = changeTab(lease, (state, window, tab) => {
      if (mode === 'push') { tab.entries.splice(tab.index + 1); tab.entries.push(copyCanonicalData(entry)); if (tab.entries.length > 128) tab.entries.shift(); tab.index = tab.entries.length - 1; }
      else if (mode === 'index') { tab.entries[index] = copyCanonicalData(entry); tab.index = index; }
      else tab.entries[tab.index] = copyCanonicalData(entry);
      tab.pending = null; tab.phase = entry.error ? 'error' : 'idle';
      const permission = (window.private ? window.privatePermissions : state.permissions).find(row => row.origin === entry.url);
      tab.zoom = permission?.zoom ?? 100; tab.reader = permission?.reader === true && browserPage(entry).reader;
      if (!window.private && !entry.error && entry.pageId !== 'home') { if (state.nextId >= Number.MAX_SAFE_INTEGER - 1) return limit(); state.history.unshift({ id: allocate(state, 'visit'), url: entry.url, title: entry.title, at: now() }); if (state.history.length > 512) state.history.pop(); }
      if (finish) finish(state, window, tab);
      return applied({ windowId: window.id, tabId: tab.id });
    }, current);
    if (result.status !== 'applied') interrupted();
    return result;
  }
  async function bridge(name, spec, guard) {
    if (typeof ctx[name] !== 'function') return reject('unavailable', `The canonical ${name} bridge is not installed.`);
    if (!guard()) return stale();
    const result = await ctx[name]({ ...spec, isCurrent: guard });
    if (result?.status === 'applied') return { ...result, presentationAvailable: presentation(spec) };
    if (!guard()) return stale();
    return result?.status === 'rejected' ? result : reject('unavailable', `The ${name} bridge did not commit a canonical result.`);
  }
  async function download(lease, payload, retry = false) {
    if (typeof ctx.createFile !== 'function') return reject('unavailable', 'The canonical createFile bridge is required.');
    const existing = retry ? state.downloads.find(row => row.id === payload.id) : null;
    if (retry && (!existing || windowFor(existing.windowId)?.nativeAppId !== lease.record.nativeAppId || existing.private && existing.windowId !== lease.record.id)) return stale();
    if (retry && !['cancelled', 'failed'].includes(existing.status)) return invalid('Only a cancelled or failed download can be retried.');
    const source = retry ? existing.url : lease.entry.url, asset = browserPages.find(page => page.address === source)?.downloads?.find(asset => asset.name === (retry ? existing.name : payload.name));
    if (!asset) return invalid('Choose an authored local download.');
    const started = changeTab(lease, (state, window) => {
      let item = retry ? state.downloads.find(row => row.id === payload.id) : null;
      if (!item) { if (state.downloads.length >= 64) return limit(); item = { id: allocate(state, 'download'), windowId: window.id, private: window.private, url: source, name: asset.name, status: 'downloading', progress: 0, fileId: null, token: 0, error: '' }; state.downloads.push(item); }
      item.windowId = window.id; item.private = window.private; item.token = browserNextToken(item.token); item.status = 'downloading'; item.progress = 0; item.fileId = null; item.error = ''; window.panel = 'downloads';
      return applied({ windowId: window.id }, { downloadId: item.id });
    });
    if (started.status !== 'applied') return started;
    const downloadId = started.downloadId, item = state.downloads.find(row => row.id === downloadId), rows = state.downloads, token = item.token;
    const current = () => lease.current() && state.downloads === rows && rows.includes(item) && item.token === token && item.status === 'downloading';
    const update = (change, guard = current) => mutate(candidate => { const row = candidate.downloads.find(row => row.id === downloadId); if (!row) return stale(); change(row); }, guard);
    const interrupted = () => { update(row => { row.token = browserNextToken(row.token); row.status = 'cancelled'; }, () => alive() && state.downloads === rows && rows.includes(item) && item.token === token && item.status === 'downloading'); return stale(); };
    for (const progress of [35, 80]) { await ctx.tick(); await pause(180); if (!current()) return interrupted(); const step = update(row => { row.progress = progress; }); if (step.status !== 'applied') return step; }
    await ctx.tick(); await pause(180); if (!current()) return interrupted();
    let committedFileId = null, completionFailure = null;
    const result = await ctx.createFile({
      source: 'browser.download', windowId: lease.record.id, operationId: `${downloadId}.${token}`, folder: 'downloads', name: asset.name, mime: asset.mime, content: asset.content,
      reserveTextUnits: 0, isCurrent: current,
      onCommit: (fileId, publishedRecord, plannedRecord) => {
        if (!current() || !browserValueConforms(fileId, id) || publishedRecord?.id !== fileId || plannedRecord?.id !== fileId) return false;
        const committed = update(row => { row.fileId = fileId; row.progress = 100; row.status = 'complete'; });
        if (committed.status !== 'applied') { completionFailure = committed; return false; }
        committedFileId = fileId; return true;
      },
    });
    if (committedFileId !== null) {
      if (result?.status !== 'applied' || result.fileId !== committedFileId) return reject('unavailable', 'The file bridge violated its atomic completion contract.');
      return applied({ windowId: lease.record.id }, { downloadId, fileId: committedFileId, presentationAvailable: presentation({ windowId: lease.record.id }) });
    }
    if (!current()) return interrupted();
    update(row => { row.status = 'failed'; row.error = (result?.error?.message ?? 'The virtual file could not be saved.').slice(0, 256).toWellFormed(); });
    return completionFailure ?? (result?.status === 'rejected' ? result : reject('unavailable', 'The file store did not atomically commit the canonical download and its metadata.'));
  }
  async function close(lease, target) {
    if (typeof ctx.closeWindow !== 'function') return missing();
    if (await ctx.closeWindow(lease.record.id, { isCurrent: lease.current }) === false) return missing();
    if (alive() && !lease.record.closed) windowClosed(lease.record.id);
    return applied(target, { presentationAvailable: false });
  }
  async function dispatch(suffix, target, payload) {
    if (suffix === 'window.focus') {
      const record = windowFor(target.windowId), native = ctx.getWindow(target.windowId);
      if (!alive() || !record || record.closed || !native || native.appId !== record.nativeAppId || typeof ctx.focusWindow !== 'function') return missing();
      const isCurrent = () => alive() && windowFor(record.id) === record && !record.closed && ctx.getWindow(record.id) === native && native.appId === record.nativeAppId;
      if (await ctx.focusWindow(record.id, { isCurrent }) === false) return missing();
      return applied(target);
    }
    const lease = owner(target); if (!lease) return missing();
    const { record: window, tab, view, entry } = lease, done = extra => applied(target, extra);
    if (window.historyClear.open && !['history.clear.prepare', 'history.clear.cancel', 'history.clear', 'focus', 'scroll', 'window.close'].includes(suffix))
      return reject('unavailable', 'Finish or cancel the original Clear History sheet first.');
    if (target.tabId && !['tab.select', 'tab.close', 'tab.pin'].includes(suffix) && window.activeTabId !== tab.id) return stale();
    switch (suffix) {
      case 'navigate': return navigate(lease, resolveAddress(payload.address));
      case 'back': return tab.index > 0 ? navigate(lease, tab.entries[tab.index - 1], 'index', tab.index - 1) : invalid('There is no earlier page.');
      case 'forward': return tab.index + 1 < tab.entries.length ? navigate(lease, tab.entries[tab.index + 1], 'index', tab.index + 1) : invalid('There is no later page.');
      case 'reload': return navigate(lease, entry, 'reload');
      case 'file.open': {
        const file = ctx.getFile?.(payload.fileId);
        if (!browserSVGSource(file)) return invalid('Choose an existing SVG File with original SVG bytes.');
        const revision = file.revision, current = () => lease.current() && ctx.getFile?.(file.id) === file && file.revision === revision && !file.deleted;
        const started = changeTab(lease, (state, window) => {
          if (window.tabs.length >= 32) return limit();
          const row = createBrowserTab(state); window.tabs.push(row); window.activeTabId = row.id; window.panel = 'none';
          return applied({ windowId: window.id }, { tabId: row.id });
        }, current);
        if (started.status !== 'applied') return started;
        await ctx.tick();
        const next = owner({ windowId: window.id, tabId: started.tabId });
        if (!next || !current()) return stale();
        return navigate(next, resolveAddress(`jester://file/${file.id}`), 'reload', null, current);
      }
      case 'file.decode': {
        const file = ctx.getFile?.(payload.fileId), observed = view.describe().svg;
        if (!file || file.revision !== payload.revision || browserSVGFileId(entry.url) !== file.id || observed?.fileId !== file.id || observed.revision !== file.revision) return stale();
        if (!observed.complete) return reject('unavailable', 'The original SVG image decoder is still running.');
        return changeTab(lease, (_, window, tab) => {
          const failed = !observed.width || !observed.height;
          tab.entries[tab.index] = resolveBrowserURL(entry.url, { svgError: failed }); tab.phase = failed ? 'error' : 'idle';
          return done({ decoded: !failed, width: observed.width, height: observed.height });
        }, lease.documentCurrent);
      }
      case 'reading.open': {
        const row = state.readingList.find(row => row.id === payload.id);
        if (!row) return stale();
        return navigate(lease, resolveBrowserURL(row.url, state.settings), 'push', null, () => state.readingList.includes(row), state => { state.readingList.find(item => item.id === row.id).read = true; });
      }
      case 'tab.close': if (tab.pinned) return invalid('Unpin this tab before closing it.'); return window.tabs.length === 1 ? close(lease, target) : local(suffix, target, payload, lease);
      case 'window.close': return close(lease, target);
      case 'tab.detach': {
        if (window.tabs.length < 2 || tab.pinned) return invalid('Choose an unpinned tab from a window with more than one tab.');
        if (typeof ctx.createWindow !== 'function') return missing();
        if (windows.length >= 16) return limit();
        const created = await ctx.createWindow(window.nativeAppId, { private: window.private, sourceWindowId: window.id, isCurrent: lease.current });
        const id = typeof created === 'string' ? created : created?.id, destination = windowFor(id);
        if (!id || !destination || destination.private !== window.private || destination.closed) return missing();
        return mutate(candidate => {
          const source = candidate.windows.find(row => row.id === window.id), receiver = candidate.windows.find(row => row.id === id);
          const index = source.tabs.findIndex(row => row.id === tab.id), moved = source.tabs.splice(index, 1)[0];
          moved.loadToken = browserNextToken(moved.loadToken); moved.pending = null; moved.phase = moved.entries[moved.index].error ? 'error' : 'idle'; moved.address = moved.entries[moved.index].url;
          if (source.activeTabId === moved.id) source.activeTabId = source.tabs[Math.min(index, source.tabs.length - 1)].id;
          source.menu = null; source.panel = 'none';
          receiver.tabs.splice(0, receiver.tabs.length, moved); receiver.activeTabId = moved.id;
          return applied(target, { windowId: id, tabId: moved.id });
        }, () => lease.current() && windows.includes(destination) && !destination.closed && ctx.getWindow(id)?.appId === window.nativeAppId, [tab]);
      }
      case 'window.merge': {
        if (window.private) return invalid('Private windows remain isolated and are not merged.');
        if (typeof ctx.mergeBrowserWindows !== 'function') return reject('unavailable', 'The canonical atomic Root window merge bridge is required.');
        const sources = windows.filter(row => row.id !== window.id && row.nativeAppId === window.nativeAppId && !row.closed && !row.private)
          .map(record => ({ record, native: ctx.getWindow(record.id), view: ctx.getView(record.id), tabs: record.tabs }));
        if (!sources.length) return invalid('There are no other ordinary browser windows to merge.');
        if (window.tabs.length + sources.reduce((count, source) => count + source.tabs.length, 0) > 32) return limit();
        const current = () => lease.current() && sources.every(source => windows.includes(source.record) && !source.record.closed && source.record.tabs === source.tabs && ctx.getWindow(source.record.id) === source.native && ctx.getView(source.record.id) === source.view);
        let committed = null;
        const result = await ctx.mergeBrowserWindows({
          sourceWindowIds: sources.map(source => source.record.id), destinationWindowId: window.id, isCurrent: current,
          onCommit: () => {
            committed = mutate(candidate => {
              const receiver = candidate.windows.find(row => row.id === window.id), consumed = new Set(sources.map(source => source.record.id));
              for (const source of candidate.windows.filter(row => consumed.has(row.id))) receiver.tabs.push(...source.tabs);
              receiver.tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned));
              for (const row of receiver.tabs) { row.loadToken = browserNextToken(row.loadToken); row.pending = null; row.phase = row.entries[row.index].error ? 'error' : 'idle'; row.address = row.entries[row.index].url; }
              for (const row of candidate.downloads) if (consumed.has(row.windowId)) { row.windowId = window.id; if (row.status === 'downloading') { row.status = 'cancelled'; row.token = browserNextToken(row.token); } }
              for (const row of candidate.closedTabs) if (consumed.has(row.windowId)) row.windowId = window.id;
              candidate.windows = candidate.windows.filter(row => !consumed.has(row.id)); receiver.panel = 'none'; receiver.menu = null;
              return applied(target);
            }, current, sources.flatMap(source => source.tabs));
            return committed.status === 'applied';
          },
        });
        if (committed?.status === 'applied') return result?.status === 'applied' ? done({ droppedWindowIds: sources.map(source => source.record.id) }) : reject('unavailable', 'The Root bridge did not acknowledge its committed canonical window merge.');
        return committed ?? result ?? missing();
      }
      case 'window.new': case 'window.reopen': {
        if (typeof ctx.createWindow !== 'function') return missing();
        const retained = suffix === 'window.reopen' ? [...windows].reverse().find(row => row.nativeAppId === window.nativeAppId && row.closed && !row.private) : null;
        if (suffix === 'window.reopen' && !retained) return invalid('There is no retained ordinary window.');
        if (!retained && windows.length >= 16) return limit();
        const isCurrent = () => lease.current() && (retained ? windows.includes(retained) && retained.closed : windows.length < 16 && state.nextId < Number.MAX_SAFE_INTEGER - 1);
        const result = await ctx.createWindow(window.nativeAppId, { private: retained ? false : payload.private, sourceWindowId: window.id, ...(retained ? { restoreWindowId: retained.id } : {}), isCurrent });
        const id = typeof result === 'string' ? result : result?.id;
        if (!id || retained && id !== retained.id) return reject('unavailable', 'Creation must return the genuine new or retained stable Root ID.');
        // Root already joined windowOpened to its creation transaction and
        // focused the genuine new Root. Never recreate a retired private record.
        return done({ windowId: id });
      }
      case 'quit': {
        if (typeof ctx.closeWindow !== 'function') return missing();
        const originals = windows.filter(row => row.nativeAppId === window.nativeAppId && !row.closed && ctx.getWindow(row.id)).map(record => ({ record, native: ctx.getWindow(record.id), view: ctx.getView(record.id) }));
        for (const original of originals) {
          const isCurrent = () => alive() && windows.includes(original.record) && !original.record.closed && ctx.getWindow(original.record.id) === original.native && ctx.getView(original.record.id) === original.view;
          if (!isCurrent()) return stale();
          if (await ctx.closeWindow(original.record.id, { isCurrent }) === false) return missing();
          if (alive() && windows.includes(original.record) && !original.record.closed) windowClosed(original.record.id);
        }
        return done({ presentationAvailable: false });
      }
      case 'download.start': return download(lease, payload);
      case 'download.retry': return download(lease, payload, true);
      case 'download.reveal': case 'download.open': {
        const item = state.downloads.find(row => row.id === payload.id);
        if (!item || windowFor(item.windowId)?.nativeAppId !== window.nativeAppId || item.private && item.windowId !== window.id) return stale();
        if (item.status !== 'complete') return invalid('The canonical file has not completed.');
        if (suffix === 'download.open' && item.name.endsWith('.svg') && window.nativeAppId === 'safari')
          return dispatch('file.open', { windowId: window.id }, { fileId: item.fileId });
        return bridge(suffix === 'download.reveal' ? 'revealFile' : 'openFile', { fileId: item.fileId, appId: item.name.endsWith('.svg') ? (ctx.profile.id.startsWith('windows11') ? 'photos' : 'safari') : (ctx.profile.id.startsWith('windows11') ? 'notepad' : 'textedit'), windowId: window.id }, () => lease.current() && state.downloads.includes(item) && item.status === 'complete');
      }
      case 'find.open': {
        const result = changeTab(lease, (_, window, tab) => { tab.find.open = true; });
        if (result.status !== 'applied') return result;
        await ctx.tick();
        const focused = lease.current() && await view.focus('find', lease.current);
        return done({ presentationAvailable: Boolean(focused) });
      }
      case 'find.close': {
        const result = changeTab(lease, (_, window, tab) => { tab.find.token = browserNextToken(tab.find.token); tab.find.open = false; tab.find.query = ''; tab.find.index = 0; });
        if (result.status !== 'applied') return result;
        if (lease.current()) await view.find('', 0, lease.current);
        return done({ presentationAvailable: lease.current() });
      }
      case 'find.query': case 'find.next': {
        if (!tab.find.open) return invalid('Open Find first.');
        const query = suffix === 'find.query' ? payload.query : tab.find.query, index = suffix === 'find.query' ? 0 : tab.find.index + (payload.backward ? -1 : 1);
        const prepared = copyCanonicalData(state), planned = prepared.windows.find(row => row.id === window.id).tabs.find(row => row.id === tab.id);
        planned.find.query = query; planned.find.token = browserNextToken(planned.find.token);
        if (!validateBrowserState(prepared, ctx.profile)) return invalid();
        if (typeof ctx.canCommit !== 'function' || ctx.canCommit(canonicalStringUnits(prepared) - canonicalStringUnits(state)) !== true) return limit();
        const begun = changeTab(lease, (_, window, tab) => { tab.find.token = browserNextToken(tab.find.token); }, lease.documentCurrent);
        if (begun.status !== 'applied') return begun;
        const token = tab.find.token, current = () => lease.documentCurrent() && tab.find.token === token && tab.find.open;
        const found = await view.find(query, index, current);
        if (!current() || !found) return stale();
        return changeTab(lease, (_, window, tab) => { tab.find.query = query; tab.find.index = found.index; return done({ count: found.count, index: found.index }); }, current);
      }
      case 'share': return bridge('share', { source: 'browser', windowId: window.id, destination: payload.destination, title: entry.title, url: entry.url, text: `${entry.title}\n${entry.url}` }, lease.documentCurrent);
      case 'print': case 'pdf': return bridge('printDocument', { source: 'browser', windowId: window.id, title: entry.title, mime: 'text/plain', text: pageText(entry), html: pageSource(entry), mode: suffix === 'pdf' ? 'pdf' : 'print' }, lease.documentCurrent);
      case 'form.submit': {
        if (entry.pageId !== 'studio' || !tab.form.name.trim() || !/^[^@\s]+@[^@\s]+\.invalid$/u.test(tab.form.email) || tab.form.password !== 'FICTIONAL-SAMPLE-ONLY') return invalid('Use a fictional name, an .invalid email and the built-in sample password.');
        if (state.settings.blockCookies) return reject('unavailable', 'Turn off Block all cookies to permit this fictional local session.');
        const form = tab.form, original = { ...form }, current = () => tab.form === form && !state.settings.blockCookies && Object.keys(original).every(key => key === 'submitted' || form[key] === original[key]);
        const result = await navigate(lease, resolveBrowserURL('jester://confirmation'), 'push', null, current, (_, window, tab) => { tab.form.submitted = true; });
        return result.status === 'applied' ? done({ confirmation: 'Fictional login accepted. No account, external request or calendar appointment was created.' }) : result;
      }
      case 'autofill.apply': {
        if (!tab.autofillOpen || !state.settings.autofillContacts && !state.settings.autofillPasswords) return invalid('Enable an AutoFill category and open its sheet.');
        const form = tab.form, original = { ...form }, passwords = state.passwords, contactsEnabled = state.settings.autofillContacts, passwordsEnabled = state.settings.autofillPasswords;
        const current = () => lease.documentCurrent() && state.passwords === passwords && tab.form === form && tab.autofillOpen && Object.keys(original).every(key => form[key] === original[key]) && state.settings.autofillContacts === contactsEnabled && state.settings.autofillPasswords === passwordsEnabled;
        let contact = null;
        if (contactsEnabled) { if (typeof ctx.resolveContacts !== 'function') return reject('unavailable', 'The canonical resolveContacts bridge is required.'); const rows = await ctx.resolveContacts('Casey'); if (!current()) return stale(); contact = Array.isArray(rows) ? rows.find(row => typeof row.name === 'string' && row.name.length <= 256 && typeof row.email === 'string' && row.email.length <= 256 && /^[^@\s]+@[^@\s]+\.invalid$/u.test(row.email)) : null; }
        const password = passwordsEnabled ? passwords.find(row => row.origin === browserPage(entry).address) : null;
        if (!contact && !password) return reject('unavailable', 'No canonical fictional contact or sample password matches.');
        return changeTab(lease, (_, window, tab) => { if (contact) { tab.form.name = contact.name; tab.form.email = contact.email; } if (password) { tab.form.email = password.username; tab.form.password = password.password; } tab.autofillOpen = false; tab.form.submitted = false; return done({ contactFilled: Boolean(contact), passwordFilled: Boolean(password), note: contact ? 'Filled the canonical fictional contact.' : 'No contact matched; only the saved sample login was filled.' }); }, current);
      }
      case 'focus': {
        if (!view.describe().controlIds.includes(payload.controlId)) return missing();
        ctx.focusWindow(window.id);
        if (!await view.prepare(payload.controlId, lease.documentCurrent) || !lease.documentCurrent() || !await view.focus(payload.controlId, lease.documentCurrent)) return stale();
        return done();
      }
      case 'scroll': { const result = await view.scroll(payload.areaId, payload, lease.current); return result && lease.current() ? done({ offsets: result }) : stale(); }
      case 'inspector.nodes': case 'inspector.select': {
        if (window.panel !== 'inspector' || !state.settings.develop && window.nativeAppId === 'safari') return invalid('Open the enabled local inspector first.');
        const current = () => lease.documentCurrent() && window.panel === 'inspector';
        const snapshot = suffix === 'inspector.nodes' ? await view.inspectTree(current) : await view.inspect(payload.nodeId, current);
        if (!current() || !snapshot) return stale();
        if (suffix === 'inspector.nodes') return done({ nodes: snapshot });
        return changeTab(lease, (_, window) => { window.inspectorNodeId = payload.nodeId; return done({ node: snapshot }); }, current);
      }
      case 'clipboard': {
        if (typeof ctx.clipboard?.read !== 'function' || typeof ctx.clipboard?.write !== 'function') return reject('unavailable', 'The canonical fictional clipboard bridge is required.');
        let committed = null;
        const result = await view.clipboard(payload.operation, {
          read: () => ctx.clipboard.read(), write: text => ctx.clipboard.write(text),
          commit: async (controlId, value) => {
            if (!lease.documentCurrent()) return stale();
            const command = ['address', 'address-search'].includes(controlId) ? ['address', { value }] : controlId === 'find' ? ['find.query', { query: value }] : controlId === 'history-search' ? ['history.search', { query: value }] : controlId.startsWith('form-') ? ['form.edit', { field: controlId.slice(5), value }] : ['bookmark-title', 'bookmark-url'].includes(controlId) ? ['bookmark.edit', { field: controlId.slice(9), value }] : controlId === 'prefs-homepage' ? ['preference.set', { key: 'homepage', value }] : null;
            if (!command) return invalid();
            const nestedTarget = /^(history|bookmark|preference)/.test(command[0]) ? { windowId: window.id } : { windowId: window.id, tabId: tab.id };
            const acknowledgment = await dispatch(command[0], nestedTarget, command[1]);
            if (acknowledgment.status === 'applied') committed = acknowledgment;
            return acknowledgment;
          },
        }, lease.documentCurrent);
        if (committed) return done({ ...(typeof committed.count === 'number' ? { count: committed.count, index: committed.index } : {}), presentationAvailable: result?.status === 'applied' ? result.presentationAvailable !== false : result === true });
        if (result?.status === 'applied') return done({ presentationAvailable: result.presentationAvailable !== false });
        return result === true ? done() : reject('unavailable', 'The actual native clipboard operation could not be applied.');
      }
      default: return local(suffix, target, payload, lease);
    }
  }
  const handlers = Object.fromEntries(Object.entries(specs).map(([suffix, [targetSchema, payloadSchema]]) => [`browser.${suffix}`, async (target, payload = {}) => {
    if (!browserProfiles.includes(ctx.profile.id)) return reject('unsupported_profile', 'This profile has no installed native browser counterpart.');
    if (!browserValueConforms(target, targetSchema) || !browserValueConforms(payload, payloadSchema)) return invalid();
    if (state.nextId >= Number.MAX_SAFE_INTEGER - 1 && ['navigate', 'back', 'forward', 'reload', 'tab.new', 'tab.detach', 'file.open', 'window.new', 'reading.add', 'reading.open', 'bookmark.save', 'download.start', 'form.submit', 'popup'].includes(suffix)) return limit();
    const originalRoot = ctx.getWindow(target.windowId), originalView = ctx.getView(target.windowId);
    const result = await dispatch(suffix, { ...target }, { ...payload });
    await ctx.tick();
    if (result.status === 'applied') return { ...result, target: { ...target }, presentationAvailable: result.presentationAvailable !== false && alive() && ctx.getWindow(target.windowId) === originalRoot && (!originalView && suffix === 'window.focus' || ctx.getView(target.windowId) === originalView) && presentation(target) };
    return alive() ? result : stale();
  }]));
  function windowOpened(windowId, options = {}) {
    const originalRoot = typeof windowId === 'string' ? ctx.getWindow(windowId) : windowId;
    const id = originalRoot?.id, nativeAppId = originalRoot?.appId;
    if (!originalRoot || !acceptedAppIds.includes(nativeAppId) || options.nativeAppId !== undefined && options.nativeAppId !== nativeAppId) return false;
    if (!alive()) return false;
    return mutate(candidate => {
      const retained = candidate.windows.find(window => window.id === id);
      if (retained) { if (retained.nativeAppId !== nativeAppId) return stale(); retained.closed = false; retained.menu = null; return; }
      if (candidate.windows.length >= 16 || candidate.nextId >= Number.MAX_SAFE_INTEGER - 1) return limit();
      candidate.windows.push(createBrowserWindow(candidate, id, options.private === true, nativeAppId, options.sourceWindowId));
    }).status === 'applied';
  }
  function windowClosed(windowId) {
    const id = typeof windowId === 'string' ? windowId : windowId.id;
    if (!alive() || !windowFor(id)) return false;
    return mutate(candidate => {
      const window = candidate.windows.find(window => window.id === id);
      for (const tab of window.tabs) { tab.loadToken = browserNextToken(tab.loadToken); tab.pending = null; tab.phase = tab.entries[tab.index].error ? 'error' : 'idle'; }
      for (const item of candidate.downloads) if (item.windowId === id && item.status === 'downloading') { item.token = browserNextToken(item.token); item.status = 'cancelled'; }
      if (window.private) { candidate.windows = candidate.windows.filter(row => row.id !== id); candidate.closedTabs = candidate.closedTabs.filter(row => row.windowId !== id); candidate.downloads = candidate.downloads.filter(row => !(row.private && row.windowId === id)); }
      else { window.closed = true; window.menu = null; window.panel = 'none'; window.historyClear.open = false; }
    }).status === 'applied';
  }
  function appQuit(nativeAppId = ctx.profile.id.startsWith('windows11') ? 'edge' : 'safari') { for (const window of [...windows].filter(row => row.nativeAppId === nativeAppId && ownsWindow(row))) windowClosed(window.id); }
  const targets = () => {
    if (!alive()) return { profileId: ctx.profile.id, available: false, windows: [], bookmarks: [], readingList: [], history: [], downloads: [], permissions: [], closedTabs: [], settings: null };
    return {
      profileId: state.profileId, available: true,
      windows: windows.filter(ownsWindow).map(window => { const view = ctx.getView(window.id); return { windowId: window.id, nativeAppId: window.nativeAppId, private: window.private, closed: window.closed, available: !window.closed && ctx.getWindow(window.id)?.appId === window.nativeAppId && view?.available() === true, activeTabId: window.activeTabId, tabs: window.tabs.map(tab => ({ tabId: tab.id, url: tab.entries[tab.index].url, title: tab.entries[tab.index].title, phase: tab.phase, canBack: tab.index > 0, canForward: tab.index + 1 < tab.entries.length, pinned: tab.pinned, downloadableAssets: (browserPage(tab.entries[tab.index]).downloads ?? []).map(asset => ({ name: asset.name, mime: asset.mime })) })), menus: menuProvider({ state, profile: ctx.profile, windowId: window.id, view }), native: !window.closed && ctx.getWindow(window.id)?.appId === window.nativeAppId && view?.available() ? view.describe() : null }; }),
      bookmarks: copyCanonicalData(state.bookmarks), readingList: copyCanonicalData(state.readingList), history: copyCanonicalData(state.history), downloads: copyCanonicalData(state.downloads.filter(row => windowFor(row.windowId))), permissions: copyCanonicalData(state.permissions),
      closedTabs: state.closedTabs.filter(row => windowFor(row.windowId)).map(row => ({ windowId: row.windowId, tabId: row.tab.id, url: row.tab.entries[row.tab.index].url, title: row.tab.entries[row.tab.index].title })), settings: { ...state.settings },
    };
  };
  return { handlers, targets, windowOpened, windowClosed, appQuit };
}

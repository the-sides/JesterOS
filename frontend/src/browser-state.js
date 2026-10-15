import { object, choice, flag } from './command-schema.js';
import { resolveBrowserURL, browserPages, browserSiteURLs } from './browser-pages.js';
export const browserProfiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
const classicPreferences = ['General', 'Tabs', 'AutoFill', 'Passwords', 'Search', 'Security', 'Privacy', 'Websites', 'Extensions', 'Advanced'];
export const browserPreferenceOptions = {
  'macos-high-sierra-10.13': classicPreferences,
  'macos-mojave-10.14': classicPreferences,
  'macos-sonoma-14.0': [...classicPreferences.slice(0, 8), 'Profiles', ...classicPreferences.slice(8), 'Developer', 'Feature Flags'],
  'macos-golden-gate-27.0.1': [...classicPreferences.slice(0, 3), ...classicPreferences.slice(4, 8), 'Profiles', ...classicPreferences.slice(8), 'Developer', 'Feature Flags'],
  'windows11-23h2-22631.2428': ['Profiles', 'Privacy, search, and services', 'Appearance', 'Start, home, and new tabs', 'Cookies and site permissions', 'Downloads', 'Passwords', 'Extensions', 'About Microsoft Edge'],
};
const menuIds = ['app', 'file', 'edit', 'view', 'history', 'bookmarks', 'window', 'help', 'develop', 'edge', 'chrome'];
const str = (max = 2048) => ({ type: 'string', maxLength: max });
const id = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };
const integer = (min, max) => ({ type: 'integer', minimum: min, maximum: max });
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
export const browserEntrySchema = object({ url: str(), title: str(256), pageId: choice(...browserPages.map(p => p.id), 'search', 'svg'), query: str(), error: choice('', 'offline', 'security', 'decode') });
export const browserTabSchema = object({ id, entries: array(browserEntrySchema, 128), index: integer(0, 127), address: str(), phase: choice('idle', 'loading', 'error'), loadToken: integer(0, Number.MAX_SAFE_INTEGER), pending: nullable(browserEntrySchema), pinned: flag, reader: flag, zoom: integer(50, 300), find: object({ open: flag, query: str(256), index: integer(0, 100000), token: integer(0, Number.MAX_SAFE_INTEGER) }), form: object({ name: str(256), email: str(256), password: choice('', 'FICTIONAL-SAMPLE-ONLY'), message: str(2048), submitted: flag }), autofillOpen: flag, popupBlocked: flag });
const bookmarkFields = { parentId: nullable(id), title: str(256), url: str(), kind: choice('folder', 'bookmark') };
export const browserPanels = ['none', 'overview', 'bookmarks', 'reading', 'history', 'downloads', 'preferences', 'share', 'security', 'source', 'inspector', 'website', 'help'];
export const browserSettingsSchema = object({ homepage: str(), searchEngine: choice('Studio Search', 'DuckDuckGo'), openWith: choice('start', 'last', 'homepage', 'empty'), newTabs: choice('start', 'homepage', 'empty', 'last'), switchToNewTab: flag, autofillContacts: flag, autofillPasswords: flag, searchSuggestions: flag, blockFraud: flag, preventTracking: flag, blockCookies: flag, extensions: flag, develop: flag, showFullAddress: flag });
export const browserPermissionSchema = object({ origin: str(128), camera: choice('ask', 'allow', 'deny'), microphone: choice('ask', 'allow', 'deny'), location: choice('ask', 'allow', 'deny'), notifications: choice('ask', 'allow', 'deny'), popups: choice('allow', 'deny'), reader: flag, zoom: integer(50, 300) });
export const browserWindowSchema = object({ id, nativeAppId: choice('safari', 'edge', 'chrome'), private: flag, closed: flag, privatePermissions: array(browserPermissionSchema, 32), tabs: array(browserTabSchema, 32), activeTabId: id, panel: choice(...browserPanels), sidebar: flag, bookmarksBar: flag, historyQuery: str(256), historyClear: object({ open: flag, range: choice('hour', 'day', 'all') }), preferencesTab: choice(...new Set(Object.values(browserPreferenceOptions).flat())), menu: nullable(choice(...menuIds)), inspectorNodeId: nullable(id), bookmarkDraft: object({ id: nullable(id), ...bookmarkFields, editing: flag }) });
export const browserStateSchema = object({
  profileId: choice(...browserProfiles), nextId: integer(1, Number.MAX_SAFE_INTEGER), windows: array(browserWindowSchema, 16),
  closedTabs: array(object({ windowId: id, tab: browserTabSchema }), 32), bookmarks: array(object({ id, ...bookmarkFields }), 256),
  readingList: array(object({ id, url: str(), title: str(256), read: flag }), 256), history: array(object({ id, url: str(), title: str(256), at: integer(0, 8640000000000000) }), 512),
  downloads: array(object({ id, windowId: id, private: flag, url: str(), name: str(256), status: choice('downloading', 'cancelled', 'complete', 'failed'), progress: integer(0, 100), fileId: nullable(id), token: integer(0, Number.MAX_SAFE_INTEGER), error: str(256) }), 64),
  permissions: array(browserPermissionSchema, 32),
  settings: browserSettingsSchema, passwords: array(object({ id, origin: str(128), username: str(256), password: str(256) }), 8),
});
export function createBrowserTab(state, address = 'jester://start') {
  const entry = resolveBrowserURL(address, state.settings);
  return { id: `browser-tab-${state.nextId++}`, entries: [entry], index: 0, address: entry.url, phase: entry.error ? 'error' : 'idle', loadToken: 0, pending: null, pinned: false, reader: false, zoom: 100, find: { open: false, query: '', index: 0, token: 0 }, form: { name: '', email: '', password: '', message: '', submitted: false }, autofillOpen: false, popupBlocked: false };
}
export function createBrowserWindow(state, windowId, isPrivate = false, nativeAppId = state.profileId.startsWith('windows11') ? 'edge' : 'safari', sourceWindowId = null) {
  const retained = !isPrivate && state.settings.openWith === 'last' ? state.windows.find(w => w.id === sourceWindowId && w.nativeAppId === nativeAppId && !w.private) ?? [...state.windows].reverse().find(w => w.nativeAppId === nativeAppId && !w.private) : null;
  const address = retained ? retained.tabs.find(t => t.id === retained.activeTabId)?.entries[retained.tabs.find(t => t.id === retained.activeTabId)?.index]?.url : state.settings.homepage;
  const tab = createBrowserTab(state, state.settings.openWith === 'last' && address ? address : state.settings.openWith === 'homepage' ? state.settings.homepage : state.settings.openWith === 'empty' ? 'jester://empty' : 'jester://start');
  return { id: windowId, nativeAppId, private: isPrivate, closed: false, privatePermissions: [], tabs: [tab], activeTabId: tab.id, panel: 'none', sidebar: false, bookmarksBar: false, historyQuery: '', historyClear: { open: false, range: 'all' }, preferencesTab: state.profileId.startsWith('windows11') ? 'Profiles' : 'General', menu: null, inspectorNodeId: null, bookmarkDraft: { id: null, parentId: null, title: '', url: '', kind: 'bookmark', editing: false } };
}
export function createBrowserState(profile) {
  return { profileId: profile.id, nextId: 1, windows: [], closedTabs: [], bookmarks: [{ id: 'browser-favorites', parentId: null, title: 'Favorites', url: '', kind: 'folder' }, ...['guide', 'journal', 'studio', 'downloads'].map(pageId => { const page = browserPages.find(p => p.id === pageId); return { id: `browser-bookmark-${pageId}`, parentId: 'browser-favorites', title: page.title, url: page.address, kind: 'bookmark' }; })], readingList: [{ id: 'browser-reading-journal', url: 'jester://journal', title: 'Studio journal', read: false }], history: [], downloads: [], permissions: [], settings: { homepage: 'jester://start', searchEngine: 'Studio Search', openWith: 'last', newTabs: 'start', switchToNewTab: true, autofillContacts: true, autofillPasswords: true, searchSuggestions: true, blockFraud: true, preventTracking: true, blockCookies: false, extensions: false, develop: false, showFullAddress: false }, passwords: [{ id: 'browser-password-studio', origin: 'jester://studio', username: 'casey@studio.invalid', password: 'FICTIONAL-SAMPLE-ONLY' }] };
}
// Includes structural checks so callers need not run a second validator first.
function conforms(value, schema) {
  if (schema.anyOf) return schema.anyOf.some(part => conforms(value, part));
  if (schema.enum) return schema.enum.includes(value);
  if (schema.type === 'null') return value === null;
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'integer') return Number.isSafeInteger(value) && value >= schema.minimum && value <= schema.maximum;
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) && value >= schema.minimum && value <= schema.maximum;
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= schema.maxLength && (!schema.pattern || new RegExp(schema.pattern).test(value));
  if (schema.type === 'array') { if (!Array.isArray(value) || value.length > schema.maxItems) return false; const d = Object.getOwnPropertyDescriptors(value); return Reflect.ownKeys(d).length === value.length + 1 && Array.from({ length: value.length }, (_, i) => d[i]).every(item => item?.enumerable && Object.hasOwn(item, 'value') && conforms(item.value, schema.items)); }
  if (schema.type === 'object') { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d); return schema.required.every(key => Object.hasOwn(d, key)) && keys.every(key => typeof key === 'string' && Object.hasOwn(schema.properties, key) && d[key].enumerable && Object.hasOwn(d[key], 'value') && conforms(d[key].value, schema.properties[key])); }
  return false;
}
export const browserValueConforms = conforms;
export function validateBrowserState(state, profile) {
  if (!conforms(state, browserStateSchema) || state.profileId !== profile.id) return false;
  const ids = new Set();
  const unique = value => { const generated = /^browser-(?:tab|visit|bookmark|reading|download)-(\d+)$/u.exec(value), sequence = generated ? Number(generated[1]) : null; if (ids.has(value) || ['__proto__', 'prototype', 'constructor'].includes(value) || generated && (!Number.isSafeInteger(sequence) || sequence < 1 || sequence >= state.nextId)) return false; ids.add(value); return true; };
  const entryValid = entry => { const resolved = resolveBrowserURL(entry.url, { blockFraud: entry.error === 'security', svgAvailable: entry.pageId === 'svg', svgError: entry.error === 'decode' }); return resolved.url === entry.url && resolved.pageId === entry.pageId && resolved.title === entry.title && resolved.error === entry.error && resolved.query === entry.query; };
  const tabValid = tab => unique(tab.id) && tab.entries.length > 0 && tab.index < tab.entries.length && tab.entries.every(entryValid) && (tab.phase === 'loading') === (tab.pending !== null) && (!tab.pending || entryValid(tab.pending)) && (tab.phase === 'loading' || (tab.phase === 'error') === Boolean(tab.entries[tab.index].error)) && (!tab.form.submitted || Boolean(tab.form.name.trim()) && /^[^@\s]+@[^@\s]+\.invalid$/u.test(tab.form.email) && tab.form.password === 'FICTIONAL-SAMPLE-ONLY');
  for (const window of state.windows) {
    if (window.nativeAppId !== 'chrome' && window.nativeAppId !== (profile.id.startsWith('windows11') ? 'edge' : 'safari')) return false;
    if (!unique(window.id) || !browserPreferenceOptions[profile.id].includes(window.preferencesTab) || window.private && window.closed || !window.private && window.privatePermissions.length || !window.tabs.length || !window.tabs.some(t => t.id === window.activeTabId) || !window.tabs.every(tabValid) || window.closed && window.tabs.some(t => t.phase === 'loading')) return false;
    if (window.nativeAppId === 'chrome' ? window.menu === 'edge' || window.menu === 'develop' || profile.id.startsWith('windows11') && window.menu !== null && window.menu !== 'chrome' : window.nativeAppId === 'edge' ? window.menu !== null && window.menu !== 'edge' : window.menu === 'edge' || window.menu === 'chrome' || window.menu === 'develop' && !state.settings.develop) return false;
    let normalSeen = false; for (const tab of window.tabs) { if (!tab.pinned) normalSeen = true; else if (normalSeen) return false; }
  }
  for (const closed of state.closedTabs) if (!state.windows.some(w => w.id === closed.windowId && !w.private) || !tabValid(closed.tab) || closed.tab.phase === 'loading' || closed.tab.pinned) return false;
  for (const collection of [state.bookmarks, state.readingList, state.history, state.downloads, state.passwords]) for (const item of collection) if (!unique(item.id)) return false;
  const bookmarks = new Map(state.bookmarks.map(b => [b.id, b]));
  for (const b of state.bookmarks) { if (!b.title.trim() || b.kind === 'folder' && b.url !== '' || b.kind === 'bookmark' && !b.url.trim()) return false; const seen = new Set([b.id]); let parentId = b.parentId; while (parentId) { const parent = bookmarks.get(parentId); if (!parent || parent.kind !== 'folder' || seen.has(parent.id)) return false; seen.add(parent.id); parentId = parent.parentId; } }
  for (const collection of [state.permissions, ...state.windows.map(w => w.privatePermissions)]) { const origins = new Set(); for (const permission of collection) { if (origins.has(permission.origin) || !browserSiteURLs.includes(permission.origin)) return false; origins.add(permission.origin); } }
  if (state.passwords.length !== 1 || state.passwords[0].id !== 'browser-password-studio' || state.passwords[0].origin !== 'jester://studio' || state.passwords[0].username !== 'casey@studio.invalid' || state.passwords[0].password !== 'FICTIONAL-SAMPLE-ONLY') return false;
  for (const download of state.downloads) { const owner = state.windows.find(w => w.id === download.windowId); if (!owner || download.private !== owner.private || owner.closed && download.status === 'downloading' || !browserPages.some(p => p.address === download.url && p.downloads?.some(d => d.name === download.name)) || (download.status === 'complete') !== (download.fileId !== null) || download.status === 'complete' && download.progress !== 100) return false; }
  const favorites = state.bookmarks.find(b => b.id === 'browser-favorites');
  if (favorites?.kind !== 'folder' || favorites.parentId !== null) return false;
  return true;
}
export const browserNextToken = token => token === Number.MAX_SAFE_INTEGER ? 0 : token + 1;
export const browserActiveTab = (state, windowId) => { const window = state.windows.find(w => w.id === windowId); return window?.tabs.find(t => t.id === window.activeTabId) ?? null; };
// A detached serialization boundary, never an alternate authoritative graph.
// Private browsing sessions disappear; canonical downloaded files deliberately
// remain in the parent's file-store snapshot, as in native private browsing.
export function browserSessionSnapshot(state) {
  const snapshot = JSON.parse(JSON.stringify(state));
  snapshot.windows = snapshot.windows.filter(window => !window.private);
  const retained = new Set(snapshot.windows.map(window => window.id));
  snapshot.closedTabs = snapshot.closedTabs.filter(row => retained.has(row.windowId));
  snapshot.downloads = snapshot.downloads.filter(row => !row.private && retained.has(row.windowId));
  for (const window of snapshot.windows) {
    window.menu = null;
    window.historyClear.open = false;
    for (const tab of window.tabs) {
      if (tab.phase === 'loading') { tab.loadToken = browserNextToken(tab.loadToken); tab.pending = null; tab.phase = tab.entries[tab.index].error ? 'error' : 'idle'; tab.address = tab.entries[tab.index].url; }
    }
  }
  for (const item of snapshot.downloads) if (item.status === 'downloading') { item.token = browserNextToken(item.token); item.status = 'cancelled'; }
  return snapshot;
}

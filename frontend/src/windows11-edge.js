import { text, identity, object, empty } from './command-schema.js';
import { applied, invalid, stale, uiState } from './windows11-app-helpers.js';

export const pages = [
  { id: 'home', address: 'jester://start', title: 'New tab', heading: 'A little room to explore.', description: 'Your local start page. Everything here stays in this scene.', sections: [{ title: 'Production desk', body: 'Keep the call sheet nearby, sketch a set in Paint, and browse your saved images in Photos.' }, { title: 'Offline by design', body: 'These are authored local pages, not cached websites. No searches, accounts, downloads, or network requests are made.' }] },
  { id: 'guide', address: 'jester://guide', title: 'Scene guide', heading: 'Welcome to your production desktop', description: 'A practical guide to the fictional Windows workspace.', sections: [{ title: 'Make something', body: 'Paint saves SVG images into Pictures. Photos opens the same virtual files. Snipping Tool can capture a selected region of a currently mounted Paint canvas.' }, { title: 'Your files stay here', body: 'Documents and images are session-only virtual files. Closing an app keeps its work; switching to a fresh profile starts a new scene.' }] },
  { id: 'journal', address: 'jester://journal', title: 'Studio journal', heading: 'Notes from the studio', description: 'Tuesday, October 31, 2023', sections: [{ title: '09:00 — Light study', body: 'The coast reference is cool blue against warm sand. Try a dark outline with a single bright accent.' }, { title: '09:41 — Ready for rehearsal', body: 'The call sheet is on the desktop. Leave room for a new sketch and a rectangular crop for the prop board.' }] },
  { id: 'about', address: 'jester://about', title: 'About this browser', heading: 'Microsoft Edge · local simulation', description: 'A native-style browser interior with a deliberately closed address space.', sections: [{ title: 'What works', body: 'Local page navigation, address entry, independent tabs, back and forward, and persistent session history.' }, { title: 'What is not represented', body: 'The Internet, online search, browser extensions, sign-in, downloads, printing, and device access are unavailable.' }] },
];
const initialTab = id => ({ id, entries: ['home'], index: 0, draft: 'jester://start' });
export const createState = () => ({ ui: uiState(), tabs: [initialTab('tab-1')], activeTabId: 'tab-1', nextTabId: 2, history: [], nextHistoryId: 1 });
export const menus = ['browser'];
export const specs = {
  'win11.edge.address': [object({ tabId: identity }), object({ value: text })],
  'win11.edge.navigate': [object({ tabId: identity }), object({ address: text })],
  'win11.edge.back': [object({ tabId: identity }), empty],
  'win11.edge.forward': [object({ tabId: identity }), empty],
  'win11.edge.tab.new': [empty, empty],
  'win11.edge.tab.select': [object({ tabId: identity }), empty],
  'win11.edge.tab.close': [object({ tabId: identity }), empty],
  'win11.edge.history.show': [empty, empty],
  'win11.edge.history.open': [object({ historyId: identity }), empty],
  'win11.edge.history.clear': [empty, empty],
  'win11.edge.dialog.close': [empty, empty],
};
for (const [name, spec] of Object.entries(specs)) {
  spec[2] = [`Render the validated ${name} transition in the offline browser interior.`];
  spec[3] = ['Retain independent tab navigation, address drafts, session history, and browser dialog state in native.apps.edge. No network or host browser effects.'];
}
export function createCommands(apps) {
  const s = apps.edge;
  const tab = id => s.tabs.find(item => item.id === id);
  const visit = (item, page) => { item.entries = [...item.entries.slice(0, item.index + 1), page.id]; item.index++; item.draft = page.address; s.history.unshift({ id: `visit-${s.nextHistoryId++}`, pageId: page.id }); s.ui.menu = null; };
  const handlers = {
    'win11.edge.address': (target, payload) => { const item = tab(target.tabId); if (!item) return stale(); item.draft = payload.value; return applied(target); },
    'win11.edge.navigate': (target, payload) => { const item = tab(target.tabId); if (!item) return stale(); const address = payload.address.trim().toLowerCase().replace(/\/$/, ''); const page = pages.find(p => p.address === address || p.id === address); if (!page) return invalid('Only the listed jester:// local pages are available; no network navigation is performed.'); visit(item, page); return applied(target); },
    'win11.edge.back': target => { const item = tab(target.tabId); if (!item) return stale(); if (item.index === 0) return invalid('There is no earlier page in this tab.'); item.index--; item.draft = pages.find(p => p.id === item.entries[item.index]).address; return applied(target); },
    'win11.edge.forward': target => { const item = tab(target.tabId); if (!item) return stale(); if (item.index + 1 >= item.entries.length) return invalid('There is no later page in this tab.'); item.index++; item.draft = pages.find(p => p.id === item.entries[item.index]).address; return applied(target); },
    'win11.edge.tab.new': () => { const item = initialTab(`tab-${s.nextTabId++}`); s.tabs.push(item); s.activeTabId = item.id; s.ui.menu = null; return applied({ tabId: item.id }); },
    'win11.edge.tab.select': target => { if (!tab(target.tabId)) return stale(); s.activeTabId = target.tabId; return applied(target); },
    'win11.edge.tab.close': target => { const index = s.tabs.findIndex(item => item.id === target.tabId); if (index < 0) return stale(); if (s.tabs.length === 1) return invalid('Keep one tab open.'); s.tabs.splice(index, 1); if (s.activeTabId === target.tabId) s.activeTabId = s.tabs[Math.min(index, s.tabs.length - 1)].id; return applied(target); },
    'win11.edge.history.show': () => { s.ui.dialog = 'history'; s.ui.menu = null; return applied(); },
    'win11.edge.history.open': target => { if (s.ui.dialog !== 'history') return stale('History is not open.'); const entry = s.history.find(item => item.id === target.historyId); if (!entry) return stale(); visit(tab(s.activeTabId), pages.find(p => p.id === entry.pageId)); s.ui.dialog = null; return applied(target); },
    'win11.edge.history.clear': () => { if (s.ui.dialog !== 'history') return stale('History is not open.'); s.history = []; return applied(); },
    'win11.edge.dialog.close': () => { if (!s.ui.dialog) return stale(); s.ui.dialog = null; return applied(); },
  };
  for (const name of ['win11.edge.address', 'win11.edge.navigate', 'win11.edge.back', 'win11.edge.forward', 'win11.edge.tab.new', 'win11.edge.tab.select', 'win11.edge.tab.close', 'win11.edge.history.show']) {
    const handler = handlers[name];
    handlers[name] = (target, payload) => s.ui.dialog ? invalid('Close History before changing the browser.') : handler(target, payload);
  }
  return handlers;
}
export const readTargets = apps => ({ tabs: apps.edge.tabs.map(t => ({ id: t.id, pageId: t.entries[t.index], canBack: t.index > 0, canForward: t.index + 1 < t.entries.length })), activeTabId: apps.edge.activeTabId, pages: pages.map(p => ({ id: p.id, address: p.address, title: p.title })), history: apps.edge.history.map(h => ({ ...h })), ui: { menu: apps.edge.ui.menu, dialog: apps.edge.ui.dialog } });

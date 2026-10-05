import { tick } from 'svelte';
import { text, identity, choice, object, empty, flag } from './command-schema.js';
import { applied, invalid, stale, unavailable, uiState, liveFile, createFile, writeFile, validName, uniqueName, pathOf } from './windows11-app-helpers.js';

export const menus = ['file', 'edit', 'view'];
const newTab = id => ({ id, fileId: null, title: 'Untitled', content: '', savedContent: '', revision: null, selectionStart: 0, selectionEnd: 0 });
export const createState = () => ({ ui: uiState(), tabs: [newTab('tab-1')], activeTabId: 'tab-1', nextTabId: 2, wordWrap: true, find: '', matchCase: false, findMessage: '', pendingClose: null, startup: 'new-session' });
const tabTarget = object({ tabId: identity });
export const specs = {
  'win11.notepad.open': [object({ fileId: identity }), empty, ['Open Notepad and populate a real shared text file.']],
  'win11.notepad.new': [empty, empty],
  'win11.notepad.activate': [tabTarget, empty],
  'win11.notepad.edit': [tabTarget, object({ content: text }), [], ['Update a persistent unsaved document.']],
  'win11.notepad.selection': [tabTarget, object({ start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 } })],
  'win11.notepad.save': [tabTarget, empty, [], ['Save to the exact shared virtual file, rejecting external content conflicts.']],
  'win11.notepad.saveAs': [tabTarget, object({ folderId: identity, name: text }), [], ['Create a shared virtual text file without overwriting.']],
  'win11.notepad.closeTab': [tabTarget, empty],
  'win11.notepad.requestWindowClose': [empty, empty, ['Clean close uses private closeWindow; dirty close restores/raises Notepad before Save / Discard / Cancel. Global modal and unrelated Notepad dialogs must be resolved first.']],
  'win11.notepad.close.resolve': [empty, object({ action: choice('save', 'discard', 'cancel') })],
  'win11.notepad.dialog.open': [empty, object({ kind: choice('open', 'save-as', 'find') })],
  'win11.notepad.dialog.change': [empty, object({ field: choice('name', 'folderId', 'fileId', 'query'), value: text })],
  'win11.notepad.dialog.commit': [empty, empty],
  'win11.notepad.dialog.cancel': [empty, empty],
  'win11.notepad.find': [tabTarget, object({ query: text, matchCase: flag, direction: choice('next', 'previous') })],
  'win11.notepad.wrap': [empty, object({ enabled: flag })],
};
export function createCommands(apps, context) {
  const state = apps.notepad;
  const tab = id => state.tabs.find(item => item.id === id);
  const active = () => tab(state.activeTabId);
  const dirty = item => item.content !== item.savedContent;
  const add = () => { const item = newTab(`tab-${state.nextTabId++}`); state.tabs.push(item); state.activeTabId = item.id; return item; };
  const remove = id => { const index = state.tabs.findIndex(item => item.id === id); state.tabs.splice(index, 1); if (state.activeTabId === id) state.activeTabId = state.tabs[Math.min(index, state.tabs.length - 1)]?.id || null; if (!state.tabs.length) add(); };
  const finishClose = () => {
    const pending = state.pendingClose; if (!pending) return stale('No close is pending.');
    const item = pending.kind === 'tab' ? tab(pending.tabId) : state.tabs.find(dirty);
    if (item && dirty(item)) { state.activeTabId = item.id; state.ui.dialog = { kind: 'close', tabId: item.id }; return applied({}, { confirmationRequired: true, closed: false }); }
    if (pending.kind === 'tab') { if (item) remove(item.id); state.pendingClose = null; state.ui.dialog = null; return applied({}, { confirmationRequired: false, closed: true }); }
    const window = context.getWindows().find(item => item.appId === 'notepad');
    if (!window) return stale('Notepad window no longer exists.');
    if (typeof context.closeWindow !== 'function') return unavailable('Private window close integration is unavailable.');
    state.pendingClose = null; state.ui.dialog = null; state.tabs = []; add(); context.closeWindow(window.id);
    return applied({ windowId: window.id }, { confirmationRequired: false, closed: true });
  };
  const save = item => {
    if (!item.fileId) { state.ui.dialog = { kind: 'save-as', tabId: item.id, folderId: 'documents', name: `${item.title === 'Untitled' ? 'Untitled' : item.title}.txt` }; return applied({ tabId: item.id }, { saved: false, confirmationRequired: true }); }
    const file = liveFile(apps, item.fileId); if (!file || file.kind !== 'text') return stale('File was deleted; use Save as to save a new file.');
    if (file.content !== item.savedContent) return invalid('This file changed in another application. Save as a new file to preserve both versions.');
    writeFile(apps, file, item.content); item.savedContent = item.content; item.revision = file.revision; item.title = file.name; return applied({ tabId: item.id, fileId: file.id }, { saved: true });
  };
  const commands = {
    'win11.notepad.open': async ({ fileId }) => {
      if (state.pendingClose || (state.ui.dialog && state.ui.dialog.kind !== 'open')) return unavailable('Resolve the current Notepad dialog before opening a file.');
      if (liveFile(apps, fileId)?.kind !== 'text') return stale('Only a live text file can be opened in Notepad.');
      const result = await context.invoke('app.open', { appId: 'notepad' }, {}); if (result.status !== 'applied') return result;
      const file = liveFile(apps, fileId); if (file?.kind !== 'text') return stale();
      let item = state.tabs.find(entry => entry.fileId === fileId);
      if (item) { if (!dirty(item)) { item.content = file.content; item.savedContent = file.content; item.revision = file.revision; item.title = file.name; item.selectionStart = 0; item.selectionEnd = 0; } }
      else { item = add(); Object.assign(item, { fileId, title: file.name, content: file.content, savedContent: file.content, revision: file.revision }); }
      state.activeTabId = item.id; state.ui.menu = null; return applied({ fileId, tabId: item.id });
    },
    'win11.notepad.new': () => { if (state.ui.dialog || state.pendingClose) return unavailable('Resolve the current dialog first.'); const item = add(); state.ui.menu = null; return applied({ tabId: item.id }); },
    'win11.notepad.activate': ({ tabId }) => { if (!tab(tabId)) return stale(); if (state.ui.dialog || state.pendingClose) return unavailable('Resolve the current dialog first.'); state.activeTabId = tabId; return applied({ tabId }); },
    'win11.notepad.edit': ({ tabId }, { content }) => { const item = tab(tabId); if (!item || tabId !== state.activeTabId) return stale(); if (state.ui.dialog) return unavailable('Close the dialog before editing.'); item.content = content; item.selectionStart = Math.min(item.selectionStart, content.length); item.selectionEnd = Math.min(item.selectionEnd, content.length); return applied({ tabId }); },
    'win11.notepad.selection': async ({ tabId }, { start, end }) => {
      const item = tab(tabId); if (!item || tabId !== state.activeTabId) return stale();
      if (state.ui.dialog) return unavailable('Close the dialog before selecting document text.');
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end > item.content.length) return invalid('Selection is outside the document.');
      const view = context.getApplicationView('notepad');
      if (!view?.controls().some(control => control.id === 'notepad-editor' && !control.disabled)) return unavailable('Notepad editor is not mounted and available.');
      const actual = view.readSelection('notepad-editor');
      if (actual?.start !== start || actual?.end !== end) { await tick(); if (!await view.select('notepad-editor', start, end)) return unavailable('The editor could not select this range.'); }
      item.selectionStart = start; item.selectionEnd = end; return applied({ tabId });
    },
    'win11.notepad.save': ({ tabId }) => { const item = tab(tabId); if (!item) return stale(); state.ui.menu = null; return save(item); },
    'win11.notepad.saveAs': ({ tabId }, { folderId, name }) => {
      const item = tab(tabId); if (!item || liveFile(apps, folderId)?.kind !== 'folder') return stale('Document or destination no longer exists.');
      if (!validName(name) || !uniqueName(apps, folderId, name)) return invalid('Use a valid unique name; existing files are not overwritten.');
      const file = createFile(apps, folderId, name, 'text', item.content); Object.assign(item, { fileId: file.id, title: file.name, savedContent: item.content, revision: file.revision });
      return applied({ tabId, fileId: file.id }, { saved: true });
    },
    'win11.notepad.closeTab': async ({ tabId }) => {
      const item = tab(tabId); if (!item) return stale();
      if (context.native.shell.dialog || state.ui.dialog || state.pendingClose) return unavailable('Resolve the current dialog first.');
      if (dirty(item)) { const result = await context.invoke('app.open', { appId: 'notepad' }, {}); if (result.status !== 'applied') return result; }
      state.pendingClose = { kind: 'tab', tabId }; state.ui.menu = null; return finishClose();
    },
    'win11.notepad.requestWindowClose': async () => {
      const window = context.getWindows().find(item => item.appId === 'notepad');
      if (!window) return stale('Notepad window no longer exists.');
      if (context.native.shell.dialog || (state.ui.dialog && !state.pendingClose)) return unavailable('Resolve the current dialog first.');
      if (state.tabs.some(dirty) && (!state.pendingClose || window.minimized)) {
        const result = await context.invoke('app.open', { appId: 'notepad' }, {}); if (result.status !== 'applied') return result;
      }
      if (state.pendingClose) return applied({}, { confirmationRequired: true, closed: false });
      state.pendingClose = { kind: 'window' }; state.ui.menu = null; return finishClose();
    },
    'win11.notepad.close.resolve': (_, { action }) => {
      if (context.native.shell.dialog) return unavailable('Resolve the native global modal first.');
      const dialog = state.ui.dialog; const item = tab(dialog?.tabId); if (dialog?.kind !== 'close' || !state.pendingClose || !item) return stale('No close confirmation is pending.');
      if (action === 'cancel') { state.pendingClose = null; state.ui.dialog = null; return applied({}, { confirmationRequired: false, closed: false }); }
      if (action === 'save') { const result = save(item); if (result.status !== 'applied' || !result.saved) return result; }
      else { const file = item.fileId && liveFile(apps, item.fileId); item.content = file?.kind === 'text' ? file.content : item.savedContent; item.savedContent = item.content; }
      return finishClose();
    },
    'win11.notepad.dialog.open': (_, { kind }) => {
      if (state.pendingClose) return unavailable('Resolve the pending close first.');
      const item = active(); if (!item) return stale();
      state.ui.dialog = kind === 'open' ? { kind, fileId: '' } : kind === 'find' ? { kind, tabId: item.id, query: state.find } : { kind, tabId: item.id, folderId: liveFile(apps, item.fileId)?.parentId || 'documents', name: item.fileId ? liveFile(apps, item.fileId)?.name || item.title : 'Untitled.txt' };
      state.ui.menu = null; return applied();
    },
    'win11.notepad.dialog.change': (_, { field, value }) => {
      const dialog = state.ui.dialog; const fields = { open: ['fileId'], 'save-as': ['name', 'folderId'], find: ['query'] };
      if (!dialog || !fields[dialog.kind]?.includes(field)) return stale('No matching dialog field.'); dialog[field] = value; return applied();
    },
    'win11.notepad.dialog.commit': async () => {
      const dialog = state.ui.dialog; if (!dialog || !['open', 'save-as', 'find'].includes(dialog.kind)) return stale();
      const result = dialog.kind === 'open' ? await context.invoke('win11.notepad.open', { fileId: dialog.fileId }, {}) : dialog.kind === 'save-as' ? await context.invoke('win11.notepad.saveAs', { tabId: dialog.tabId }, { folderId: dialog.folderId, name: dialog.name }) : await context.invoke('win11.notepad.find', { tabId: dialog.tabId }, { query: dialog.query, matchCase: state.matchCase, direction: 'next' });
      if (result.status === 'applied' && dialog.kind !== 'find') { state.ui.dialog = null; if (state.pendingClose) return finishClose(); }
      return result;
    },
    'win11.notepad.dialog.cancel': () => { if (!state.ui.dialog || state.ui.dialog.kind === 'close') return stale(); state.ui.dialog = null; state.pendingClose = null; return applied({}, { closed: false }); },
    'win11.notepad.find': async ({ tabId }, { query, matchCase, direction }) => {
      const item = tab(tabId); if (!item || tabId !== state.activeTabId) return stale(); if (!query) return invalid('Enter text to find.');
      if (state.ui.dialog && state.ui.dialog.kind !== 'find') return unavailable('Close the current dialog before finding text.');
      const view = context.getApplicationView('notepad'); if (!view?.select || !context.getWindows().some(window => window.appId === 'notepad' && !window.minimized)) return unavailable('Notepad editor is not mounted and visible.');
      const haystack = matchCase ? item.content : item.content.toLowerCase(); const needle = matchCase ? query : query.toLowerCase();
      let index = direction === 'next' ? haystack.indexOf(needle, item.selectionEnd) : haystack.lastIndexOf(needle, item.selectionStart - 1);
      if (direction === 'previous' && item.selectionStart === 0) index = -1;
      if (index < 0) index = direction === 'next' ? haystack.indexOf(needle) : haystack.lastIndexOf(needle);
      const previous = { dialog: state.ui.dialog };
      if (index >= 0) {
        state.ui.dialog = null; await tick();
        if (!await view.select('notepad-editor', index, index + query.length)) { state.ui.dialog = previous.dialog; await tick(); return unavailable('The editor could not select the match.'); }
        item.selectionStart = index; item.selectionEnd = index + query.length;
      }
      state.find = query; state.matchCase = matchCase; state.findMessage = index < 0 ? `Cannot find “${query}”.` : '';
      return applied({ tabId }, { found: index >= 0 });
    },
    'win11.notepad.wrap': (_, { enabled }) => { if (state.ui.dialog) return unavailable('Close the dialog first.'); state.wordWrap = enabled; state.ui.menu = null; return applied(); },
  };
  return commands;
}
export function readTargets(apps) {
  const state = apps.notepad;
  return { activeTabId: state.activeTabId, tabs: state.tabs.map(item => ({ id: item.id, fileId: item.fileId, title: liveFile(apps, item.fileId)?.name || item.title, dirty: item.content !== item.savedContent, selectionStart: item.selectionStart, selectionEnd: item.selectionEnd })), files: apps.files.filter(file => liveFile(apps, file.id) && file.kind === 'text').map(file => ({ id: file.id, name: file.name, path: pathOf(apps, file.id) })), wordWrap: state.wordWrap, startup: state.startup, find: state.find, matchCase: state.matchCase, findMessage: state.findMessage, pendingClose: state.pendingClose ? { ...state.pendingClose } : null, menu: state.ui.menu, dialog: state.ui.dialog ? { ...state.ui.dialog } : null };
}

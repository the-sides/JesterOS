import { browserActiveTab } from './browser-state.js';
export { chromeProfileMetadata, chromeWindowMetadata, chromeInstalledApp } from './chrome-profile-metadata.js';

export function chromeMenuProvider({ state, profile, windowId, view }) {
  const win = state.windows.find(row => row.id === windowId && row.nativeAppId === 'chrome');
  const tab = browserActiveTab(state, windowId), wt = { windowId }, tt = { windowId, tabId: tab?.id };
  const enabled = Boolean(win && !win.closed && tab && (!view || view.available() === true));
  const observed = view?.describe?.(), selection = observed?.selection;
  const tabCommands = new Set(['back', 'forward', 'reload', 'stop', 'tab.close', 'tab.pin', 'zoom', 'find.open', 'print', 'pdf', 'reading.add']);
  const row = (id, label, command, payload = {}, options = {}) => ({ id, label,
    ...options, enabled: enabled && options.enabled !== false,
    ...(enabled && options.enabled !== false ? { request: { command: `browser.${command}`, target: options.target ?? (tabCommands.has(command) ? tt : wt), payload } } : {}) });
  const panel = (id, label, value) => row(id, label, 'panel', { panel: value });
  const edit = operation => row(operation, { undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All' }[operation], 'clipboard', { operation }, {
    enabled: operation === 'undo' ? observed?.canUndo === true : operation === 'redo' ? observed?.canRedo === true
      : operation === 'paste' ? selection?.editable === true : operation === 'selectAll' ? Boolean(observed?.controlIds?.includes('address'))
        : Boolean(selection?.text) && (operation !== 'cut' || selection.editable === true),
  });
  const groups = [
    { id: 'app', label: 'Chrome', items: [panel('about', 'About Google Chrome', 'help'), panel('settings', profile.id.includes('high-sierra') || profile.id.includes('mojave') ? 'Preferences…' : 'Settings…', 'preferences'), row('quit', 'Quit Google Chrome', 'quit')] },
    { id: 'file', label: 'File', items: [row('new-tab', 'New Tab', 'tab.new'), row('new-window', 'New Window', 'window.new', { private: false }), row('incognito', 'New Incognito Window', 'window.new', { private: true }), row('close-tab', 'Close Tab', 'tab.close', {}, { enabled: !tab?.pinned }), row('close-window', 'Close Window', 'window.close'), row('save', 'Save as PDF…', 'pdf'), row('print', 'Print…', 'print')] },
    { id: 'edit', label: 'Edit', items: ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'].map(edit).concat(row('find', 'Find…', 'find.open')) },
    { id: 'view', label: 'View', items: [row('bookmarks-bar', 'Always Show Bookmarks Bar', 'bookmarksBar', {}, { checked: win?.bookmarksBar }), row('zoom-in', 'Zoom In', 'zoom', { value: Math.min(300, (tab?.zoom ?? 100) + 10) }), row('zoom-out', 'Zoom Out', 'zoom', { value: Math.max(50, (tab?.zoom ?? 100) - 10) }), row('actual-size', 'Actual Size', 'zoom', { value: 100 }), row('reload', 'Reload This Page', 'reload'), row('stop', 'Stop', 'stop', {}, { enabled: tab?.phase === 'loading' }), panel('source', 'View Source', 'source'), panel('inspector', 'Developer Tools', 'inspector')] },
    { id: 'history', label: 'History', items: [row('back', 'Back', 'back', {}, { enabled: tab?.index > 0 }), row('forward', 'Forward', 'forward', {}, { enabled: tab && tab.index + 1 < tab.entries.length }), panel('history', 'Show Full History', 'history'), row('reopen-tab', 'Reopen Closed Tab', 'tab.reopen', {}, { enabled: state.closedTabs.some(row => row.windowId === windowId) }), row('reopen-window', 'Reopen Closed Window', 'window.reopen', {}, { enabled: state.windows.some(row => row.nativeAppId === 'chrome' && row.closed && !row.private) })] },
    { id: 'bookmarks', label: 'Bookmarks', items: [panel('manager', 'Bookmark Manager', 'bookmarks'), row('bookmark-page', 'Bookmark This Tab…', 'bookmark.begin'), row('new-folder', 'Add Folder…', 'bookmark.begin', { kind: 'folder' }), row('bookmarks-bar', 'Show Bookmarks Bar', 'bookmarksBar', {}, { checked: win?.bookmarksBar })] },
    { id: 'window', label: 'Window', items: [row('pin', tab?.pinned ? 'Unpin Tab' : 'Pin Tab', 'tab.pin'), panel('downloads', 'Downloads', 'downloads'), ...state.windows.filter(row => row.nativeAppId === 'chrome' && !row.closed).map(window => row(`window-${window.id}`, window.tabs.find(tab => tab.id === window.activeTabId)?.entries[window.tabs.find(tab => tab.id === window.activeTabId)?.index]?.title ?? 'Google Chrome', 'window.focus', {}, { checked: window.id === windowId, target: { windowId: window.id } }))] },
    { id: 'help', label: 'Help', items: [panel('help', 'Google Chrome Help', 'help')] },
  ];
  const popup = { id: 'chrome', label: 'Customize and control Google Chrome', items: [
    row('new-tab', 'New tab', 'tab.new'), row('new-window', 'New window', 'window.new', { private: false }), row('incognito', 'New Incognito window', 'window.new', { private: true }),
    panel('history', 'History', 'history'), panel('downloads', 'Downloads', 'downloads'),
    { id: 'bookmarks-group', label: 'Bookmarks', enabled, children: groups.find(group => group.id === 'bookmarks').items },
    ...groups.find(group => group.id === 'view').items.filter(item => item.id.startsWith('zoom') || item.id === 'actual-size'),
    row('print', 'Print…', 'print'), panel('share', 'Save and share · local destinations', 'share'), row('find', 'Find…', 'find.open'),
    { id: 'more-tools', label: 'More tools', enabled, children: [panel('tabs', 'Search tabs · local overview', 'overview'), panel('source', 'View source', 'source'), panel('inspector', 'Developer tools', 'inspector')] },
    ...['cut', 'copy', 'paste'].map(edit), panel('settings', 'Settings', 'preferences'), panel('help', 'Help', 'help'), row('exit', 'Exit', 'quit'),
  ] };
  return profile.id.startsWith('windows11') ? [popup] : [...groups, popup];
}

export const chromeGlobalMenuProvider = options => chromeMenuProvider(options).filter(group => group.id !== 'chrome');

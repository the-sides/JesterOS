// Golden Gate represented app menus. Launch-only apps expose shell/window rows,
// File uses real represented document/location operations; broader Edit/View/Help have their own backlog items.
export const APP_COMMAND_MENU_IDS = ['file', 'edit', 'format', 'view', 'go', 'conversation', 'history', 'bookmarks', 'help'];
const commonHeadings = ['file', 'edit', 'view', 'help'];
const appHeadings = {
  finder: ['file', 'edit', 'view', 'go', 'help'],
  notes: ['file', 'edit', 'format', 'view', 'help'],
  messages: ['file', 'edit', 'view', 'conversation', 'help'],
  safari: ['file', 'edit', 'view', 'history', 'bookmarks', 'help'],
};
const label = id => id[0].toUpperCase() + id.slice(1);
const unavailable = (id, text, shortcut) => ({ id, label: text, enabled: false, ...(shortcut ? { shortcut } : {}) });
const leaf = (id, text, enabled, request, extra = {}) => ({ id, label: text, enabled: Boolean(enabled), ...extra,
  ...(enabled ? { request } : {}) });
const request = (command, target = {}, payload = {}) => ({ command, target, payload });

/** Inputs are the current owner and real document/window presentation, never a second menu selection model. */
export function appCommandMenuProviders({ profile, appId, enabled, activeWindow, notes, finder }) {
  const app = profile.applications[appId];
  if (!app) return [];
  const window = activeWindow?.appId === appId ? activeWindow : null;
  const selected = notes?.selected;
  const noteView = appId === 'notes' && notes?.available;
  const editable = noteView && selected && !selected.deleted;
  const fileWorkflows = profile.capabilities.includes('shell.file-workflows');
  const document = fileWorkflows && noteView && notes?.documentAvailable && selected;
  const noteKey = document ? `${window.id}:${selected.id}:${selected.updatedAt}` : 'unavailable';
  const noteFile = format => request('fileDialog.open', { windowId: window?.id }, { format });
  const finderSelection = finder?.selected ?? [];
  const finderItem = finderSelection.length === 1 ? finderSelection[0] : null;
  const finderKey = finderItem ? `${finder.windowId ?? 'desktop'}:${finderItem.id}:${finderItem.revision}` : 'unavailable';
  const finderTarget = finder?.windowId ? { windowId: finder.windowId } : {};
  const close = leaf('close-window', 'Close Window', window && !window.minimized,
    request('window.close', { windowId: window?.id }), { shortcut: '⌘W' });
  const newWindow = leaf('new-window', 'New Window', app.multipleWindows, request('window.create', { appId }), { shortcut: '⌘N' });
  const separator = id => ({ id, label: '', enabled: false, separator: true });
  const rows = {
    file: fileWorkflows && appId === 'notes' ? [
      leaf('new-note', 'New Note', enabled, request('notes.document.create'), { shortcut: '⌘N' }), close,
      separator('separator-note-actions'),
      leaf(`duplicate-note:${noteKey}`, 'Duplicate Note', document && editable,
        request('notes.duplicate', { noteId: selected?.id }, { focus: true }), { shortcut: '⌘D' }),
      leaf('pin-note', selected?.pinned ? 'Unpin Note' : 'Pin Note', editable,
        request('notes.setPinned', { noteId: selected?.id }, { pinned: !selected?.pinned, focus: true })),
      leaf('delete-note', 'Delete Note', editable, request('notes.trash', { noteId: selected?.id }, { focus: true })),
      separator('separator-note-files'),
      unavailable('import-notes', 'Import to Notes…'), unavailable('import-markdown', 'Import Markdown…'),
      { id: `export-note:${noteKey}`, label: 'Export To', enabled: Boolean(document), children: [
        leaf(`export-pdf:${noteKey}`, 'PDF…', document, noteFile('pdf')),
        leaf(`export-markdown:${noteKey}`, 'Markdown…', document, noteFile('markdown')),
      ] },
      separator('separator-note-print'),
      leaf(`print-note:${noteKey}`, 'Print…', document, noteFile('print'), { shortcut: '⌘P' }),
    ] : fileWorkflows && appId === 'finder' ? [
      newWindow,
      leaf(`new-folder:${finder?.windowId ?? 'desktop'}:${finder?.folderId ?? 'desktop'}`, 'New Folder', finder?.writable,
        finder?.windowId ? request('finder.folder.create', finderTarget) : request('desktop.folder.create'), { shortcut: '⇧⌘N' }),
      leaf(`open-file:${finderKey}`, 'Open', finderItem,
        finder?.windowId ? request('finder.file.open', finderTarget) : request('desktop.open', { fileId: finderItem?.id }), { shortcut: '⌘O' }),
      close, separator('separator-finder-files'),
      leaf(`duplicate-file:${finderKey}`, 'Duplicate', finder?.writable && finderItem && !finderItem.readOnly
        && !['disk', 'desktop', 'downloads', 'trash', 'applications'].includes(finderItem.id),
        request('finder.file.duplicate', finderTarget), { shortcut: '⌘D' }),
      leaf(`info-file:${finderKey}`, 'Get Info', finderItem,
        finder?.windowId ? request('finder.info.open', finderTarget) : request('desktop.info.open', { fileId: finderItem?.id }), { shortcut: '⌘I' }),
    ] : [
      ...(appId === 'notes' ? [
        leaf('new-note', 'New Note', noteView, request('notes.create', {}, { focus: true }), { shortcut: '⌘N' }),
        leaf('pin-note', selected?.pinned ? 'Unpin Note' : 'Pin Note', editable,
          request('notes.setPinned', { noteId: selected?.id }, { pinned: !selected?.pinned, focus: true })),
        leaf('delete-note', 'Delete Note', editable, request('notes.trash', { noteId: selected?.id }, { focus: true })),
      ] : [newWindow]), close,
    ],
    edit: [
      unavailable('undo', 'Undo', '⌘Z'), unavailable('redo', 'Redo', '⇧⌘Z'),
      { id: 'separator-clipboard', label: '', enabled: false, separator: true },
      unavailable('cut', 'Cut', '⌘X'), unavailable('copy', 'Copy', '⌘C'), unavailable('paste', 'Paste', '⌘V'),
      leaf('select-all', 'Select All', noteView && notes?.textControl && notes?.hasText,
        request('notes.focus', { control: notes?.textControl }, { select: true }), { shortcut: '⌘A' }),
      ...(appId === 'notes' ? [{ id: 'find', label: 'Find', enabled: Boolean(noteView), children: [
        leaf('search-notes', 'Search Notes', noteView, request('notes.focus', { control: 'search' }, { select: true }), { shortcut: '⌥⌘F' }),
      ] }] : []),
    ],
    format: [unavailable('bold', 'Bold', '⌘B'), unavailable('italic', 'Italic', '⌘I'), unavailable('underline', 'Underline', '⌘U')],
    view: appId === 'notes' ? [leaf('sidebar', notes?.sidebarVisible ? 'Hide Sidebar' : 'Show Sidebar', noteView,
      request('notes.setSidebarVisible', {}, { visible: !notes?.sidebarVisible }))] : [unavailable('show-toolbar', 'Show Toolbar')],
    go: [unavailable('go-to-folder', 'Go to Folder…', '⇧⌘G')],
    conversation: [unavailable('new-conversation', 'New Conversation'), unavailable('details', 'Details')],
    history: [unavailable('back', 'Back', '⌘['), unavailable('forward', 'Forward', '⌘]')],
    bookmarks: [unavailable('add-bookmark', 'Add Bookmark…', '⌘D')],
    help: [unavailable('app-help', `${app.name} Help`)],
  };
  return (appHeadings[appId] ?? commonHeadings).map(menuId => ({ menuId, kind: menuId,
    label: label(menuId), appId, enabled: Boolean(enabled), items: rows[menuId] }));
}

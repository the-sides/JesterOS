// Golden Gate represented app menus. Launch-only apps expose shell/window rows,
// File uses real represented document/location operations; broader Edit/View/Help have their own backlog items.
import { controlDocumentOffset } from './text-native-selection.js';
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

function editMenuItems({ appId, window, selected, noteView, editing, finder }) {
  const source = editing?.selection, tool = editing?.tool, native = editing?.native;
  const clipboard = editing?.clipboard, history = editing?.history;
  const document = noteView && window && !window.utilityKind && selected && editing?.documentAvailable;
  const owner = document ? { windowId: window.id, noteId: selected.id } : null;
  const versioned = owner ? { ...owner, revision: selected.updatedAt } : null;
  const field = tool ?? native ?? source;
  const canCopy = Boolean(field && field.start < field.end);
  const writable = Boolean(field && (tool || native || !editing.selectionReadOnly));
  const copy = operation => tool ? request('text.tools.clipboard', tool, { operation })
    : native ? request('clipboard.control', native, { operation })
    : source ? request(`text.clipboard.${operation}`, source) : null;
  const noteHistory = source?.control === 'search' ? history?.search : history?.notes.find(note => note.noteId === selected?.id);
  const undoOwner = source ? Object.fromEntries(Object.entries(source).filter(([key]) => !['start', 'end'].includes(key)))
    : owner ? { ...versioned, control: 'body' } : null;
  const draftHistory = tool ? editing.toolHistory : native ? editing.nativeHistory : null;
  const finderOwner = finder?.windowId ? { windowId: finder.windowId } : {};
  const location = appId === 'finder' && !field && finder?.folderId;
  const action = direction => tool ? request('text.tools.clipboard', tool, { operation: direction })
    : native ? request('clipboard.control', native, { operation: direction })
    : location ? request(`finder.edit.${direction}`, finderOwner) : undoOwner ? request(`text.${direction}`, undoOwner) : null;
  const labels = { typing: 'Typing', cut: 'Cut', paste: 'Paste', replace: 'Replace', spelling: 'Spelling', substitution: 'Substitutions' };
  const undoLabel = location ? editing.finder?.undoLabel : noteHistory?.undoLabel ? `Undo ${labels[noteHistory.undoLabel]}` : 'Undo';
  const redoLabel = location ? editing.finder?.redoLabel : noteHistory?.redoLabel ? `Redo ${labels[noteHistory.redoLabel]}` : 'Redo';
  const undo = draftHistory ? draftHistory.undo : location ? editing.finder?.undo : (source ? writable : document && !editing.documentReadOnly) && noteHistory?.canUndo;
  const redo = draftHistory ? draftHistory.redo : location ? editing.finder?.redo : (source ? writable : document && !editing.documentReadOnly) && noteHistory?.canRedo;
  const find = editing?.tools.find;
  const found = Boolean(document && find?.noteId === selected.id && find.windowId === window.id && find.count);
  const selectedText = Boolean(document && source?.noteId === selected.id && ['title', 'body'].includes(source.control) && canCopy);
  const fullRange = selectedText ? { ...versioned, start: controlDocumentOffset(selected.text, source.control, source.start),
    end: controlDocumentOffset(selected.text, source.control, source.end) } : null;
  const pref = editing?.preferences;
  const option = (key, text) => leaf(key, text, document, request('text.preferences.set', { windowId: window?.id }, { [key]: !pref?.[key] }), { checked: Boolean(pref?.[key]) });
  const selectAll = tool ? request('text.tools.clipboard', tool, { operation: 'selectAll' })
    : native ? request('clipboard.control', native, { operation: 'selectAll' })
    : source ? request('text.selection.set', { ...source, start: 0, end: editing.selectionValueLength })
    : location ? finder.windowId ? request('finder.selection.set', finderOwner, { fileIds: finder.childIds })
      : request('desktop.select.all') : null;
  const rows = [
    leaf('undo', tool || native ? 'Undo' : undoLabel, undo, action('undo'), { shortcut: '⌘Z' }),
    leaf('redo', tool || native ? 'Redo' : redoLabel, redo, action('redo'), { shortcut: '⇧⌘Z' }),
    { id: 'separator-clipboard', label: '', enabled: false, separator: true },
    leaf('cut', 'Cut', writable && canCopy, copy('cut'), { shortcut: '⌘X' }),
    leaf('copy', 'Copy', field ? canCopy : location && editing.finder?.copy,
      field ? copy('copy') : request('finder.clipboard.copy', finderOwner), { shortcut: '⌘C' }),
    leaf('paste', location ? 'Paste Items' : 'Paste', field ? writable && clipboard?.kind === 'text' && clipboard.text.length > 0
      : location && editing.finder?.paste, field ? copy('paste') : request('finder.clipboard.paste', finderOwner), { shortcut: '⌘V' }),
    ...(appId === 'notes' ? [leaf('paste-match-style', 'Paste and Match Style', writable && clipboard?.kind === 'text' && clipboard.text.length > 0,
      copy('paste'), { shortcut: '⌥⇧⌘V' })] : []),
    leaf('select-all', 'Select All', field ? (tool?.value ?? native?.value)?.length > 0 || Boolean(source && editing.selectionValueLength)
      : location && finder.childIds.length > 0, selectAll, { shortcut: '⌘A' }),
  ];
  if (appId === 'notes') rows.push(
    { id: 'find', label: 'Find', enabled: Boolean(document), children: [
      leaf('find-note', 'Find…', document, request('text.find.open', owner), { shortcut: '⌘F' }),
      leaf('find-next', 'Find Next', found, request('text.find.next', owner), { shortcut: '⌘G' }),
      leaf('find-previous', 'Find Previous', found, request('text.find.next', owner, { backward: true }), { shortcut: '⇧⌘G' }),
      leaf('use-selection-find', 'Use Selection for Find', selectedText, request('text.find.useSelection', fullRange), { shortcut: '⌘E' }),
      leaf('jump-selection', 'Jump to Selection', selectedText, request('text.selection.set', source), { shortcut: '⌘J' }),
      leaf('search-notes', 'Search Notes', noteView, request('notes.focus', { control: 'search' }, { select: true }), { shortcut: '⌥⌘F' }),
    ] },
    { id: 'spelling', label: 'Spelling and Grammar', enabled: Boolean(document), children: [
      leaf('show-spelling', 'Show Spelling and Grammar', document, request('text.spelling.open', versioned), { shortcut: '⌘:' }),
      leaf('check-spelling', 'Check Document Now', document, request('text.spelling.check', versioned, { from: 0, maxIssues: 1, suggestions: true }), { shortcut: '⌘;' }),
      option('checkSpellingWhileTyping', 'Check Spelling While Typing'),
      unavailable('check-grammar', 'Check Grammar With Spelling'), option('correctSpellingAutomatically', 'Correct Spelling Automatically'),
    ] },
    { id: 'substitutions', label: 'Substitutions', enabled: Boolean(document), children: [
      leaf('show-substitutions', 'Show Substitutions', document, request('text.substitutions.open', owner)),
      option('smartQuotes', 'Smart Quotes'), option('smartDashes', 'Smart Dashes'),
      unavailable('smart-links', 'Smart Links'), option('textReplacement', 'Text Replacement'),
    ] });
  return rows;
}

/** Inputs are the current owner and real document/window presentation, never a second menu selection model. */
export function appCommandMenuProviders({ profile, appId, enabled, activeWindow, notes, finder, editing }) {
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
    edit: profile.capabilities.includes('shell.edit-workflows') ? editMenuItems({ appId, window, selected, noteView, editing, finder }) : [
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

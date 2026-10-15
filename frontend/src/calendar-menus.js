import { calendarWindow } from './calendar-state.js';

// Documented identifiers for the parent integration surface.
export const CALENDAR_COMPONENT = 'CalendarApp.svelte';
export const CALENDAR_STYLESHEET = 'calendar.css';
export const CALENDAR_ICON_LIGHT = 'calendar.png';
export const CALENDAR_ICON_DARK = 'calendar-dark.png';
export const CALENDAR_MENU_PROVIDER = 'calendarMenuProvider';

const separator = id => ({ id, label: '', enabled: false, separator: true });
export function calendarMenuProvider({ state, profile, windowId, services = [], edits = null, history = null }) {
  const win = calendarWindow(state, windowId);
  const identity = typeof profile === 'string' ? profile : profile?.renderer ?? profile?.id ?? '';
  const windows = identity === 'windows11' || identity.startsWith('windows11');
  const classic = identity === 'high-sierra' || identity === 'mojave' || identity.startsWith('macos-high-sierra-') || identity.startsWith('macos-mojave-');
  const alive = Boolean(win);
  const owner = { windowId };
  // Disabled leaves keep their own id/label and never carry a request, so a
  // stale "unavailable" id can no longer shadow real control identities.
  const leaf = (id, label, command, payload = {}, enabled = alive, extra = {}) => {
    const item = { id, label, enabled: Boolean(enabled), ...extra };
    if (enabled && command) item.request = { command, target: command.startsWith('app.') ? { appId: 'calendar' } : command.startsWith('window.') ? owner : owner, payload };
    return item;
  };
  const group = (id, label, children, enabled = alive) => ({ id, label, enabled, children });
  const shell = (id, label, command, target, payload = {}, shortcut) => {
    const item = { id, label, enabled: alive, ...(shortcut ? { shortcut } : {}) };
    if (alive) item.request = { command, target, payload };
    return item;
  };
  const textLeaf = (id, label, operation, shortcut) => {
    const enabled = Boolean(edits?.[operation]);
    return leaf(id, label, 'calendar.native.edit', { operation }, enabled, shortcut ? { shortcut } : {});
  };

  const file = [
    leaf('new-event', windows ? 'New event' : 'New Event…', 'calendar.editor.open', {}, alive, windows ? { shortcut: 'Ctrl+N' } : { shortcut: '⌘N' }),
    leaf('new-calendar', windows ? 'New calendar · local extension' : 'New Calendar…', 'calendar.sheet.open', { sheet: 'calendar' }),
    leaf('subscription', windows ? 'Subscribe · local extension' : 'New Calendar Subscription…', 'calendar.sheet.open', { sheet: 'subscription' }),
    separator('file-transfer'),
    leaf('import', windows ? 'Import iCalendar · local extension' : 'Import…', 'calendar.sheet.open', { sheet: 'import' }),
    null, // archive pair lives in File > Export group for mac while Windows has a flat list
    leaf('archive', windows ? 'Export archive · local extension' : 'Export > Calendar Archive · local extension', 'calendar.export', {}, false),
    separator('file-output'),
    leaf('export', windows ? 'Export iCalendar · local extension' : 'Export > Export…', 'calendar.export', {}),
    leaf('print', 'Print…', 'calendar.print', {}, alive, windows ? { shortcut: 'Ctrl+P' } : { shortcut: '⌘P' }),
    separator('file-close'),
    leaf('close', 'Close Window', 'calendar.window.close', {}, alive, windows ? { shortcut: 'Alt+F4' } : { shortcut: '⌘W' })
  ].filter(Boolean);
  const edit = [
    textLeaf('undo', 'Undo', 'undo', windows ? 'Ctrl+Z' : '⌘Z'),
    textLeaf('redo', 'Redo', 'redo', windows ? 'Ctrl+Shift+Z' : '⇧⌘Z'),
    separator('edit-text'),
    textLeaf('cut', 'Cut', 'cut', windows ? 'Ctrl+X' : '⌘X'),
    textLeaf('copy', 'Copy', 'copy', windows ? 'Ctrl+C' : '⌘C'),
    textLeaf('paste', 'Paste', 'paste', windows ? 'Ctrl+V' : '⌘V'),
    textLeaf('select-all', 'Select All', 'selectAll', windows ? 'Ctrl+A' : '⌘A'),
    separator('edit-find'),
    leaf('find', 'Find…', 'calendar.native.focus', { controlId: 'search' }, alive, windows ? { shortcut: 'Ctrl+F' } : { shortcut: '⌘F' }),
    leaf('info', windows ? 'Get info · local extension' : 'Get Info · subscription only', 'calendar.sheet.open', { sheet: 'subscription' }, alive && state.calendars.some(row => row.subscription))
  ];
  const editEvent = [
    leaf('editor-open', windows ? 'New event' : 'New Event…', 'calendar.editor.open', {}, alive, windows ? { shortcut: 'Ctrl+N' } : { shortcut: '⌘N' }),
    leaf('editor-edit', 'Edit…', 'calendar.editor.open', { eventId: win?.selectedEventId, ...(win?.selectedOccurrence ? { occurrenceStart: win.selectedOccurrence } : {}) }, alive && Boolean(win?.selectedEventId), windows ? { shortcut: 'Ctrl+E' } : { shortcut: '⌘E' }),
    leaf('event-delete', 'Delete…', 'calendar.event.delete', { eventId: win?.selectedEventId, scope: 'series', ...(win?.selectedOccurrence ? { occurrenceStart: win.selectedOccurrence } : {}) }, alive && Boolean(win?.selectedEventId))
  ];
  const view = [
    ...['day', 'week', 'month', 'year'].map((name, index) => leaf(`view-${name}`, name[0].toUpperCase() + name.slice(1), 'calendar.view.set', { view: name }, alive, { checked: win?.view === name, radio: true, ...(windows ? {} : { shortcut: `⌘${index + 1}` }) })),
    separator('view-navigation'),
    leaf('today', 'Go to Today', 'calendar.today', {}, alive, windows ? { shortcut: 'Ctrl+T' } : { shortcut: '⌘T' }),
    leaf('previous', 'Previous', 'calendar.navigate', { direction: -1 }, alive, windows ? {} : { shortcut: '⌘←' }),
    leaf('next', 'Next', 'calendar.navigate', { direction: 1 }, alive, windows ? {} : { shortcut: '⌘→' }),
    separator('view-detail'),
    leaf('sidebar', win?.sidebarVisible ? 'Hide Calendar List' : 'Show Calendar List', 'calendar.view.set', { sidebarVisible: !win?.sidebarVisible }, alive, { checked: Boolean(win?.sidebarVisible) }),
    leaf('declined', 'Show Declined Events', 'calendar.preferences.set', { values: { showDeclined: !state.preferences.showDeclined } }, alive, { checked: state.preferences.showDeclined }),
    separator('view-search'),
    leaf('search', 'Search…', 'calendar.native.focus', { controlId: 'search' }, alive, windows ? { shortcut: 'Ctrl+F' } : { shortcut: '⌥⌘F' })
  ];
  const settings = ['General', 'Accounts', 'Alerts', 'Advanced'].map(pane =>
    leaf(`preferences-${pane}`, pane === 'General' ? (windows ? 'Calendar settings' : classic ? 'Preferences…' : 'Settings…') : pane, 'calendar.sheet.open', { sheet: 'preferences', pane }, alive, pane === 'General' && !windows ? { shortcut: '⌘,' } : {}));
  const windowItems = [
    shell(windows ? 'minimize' : 'minimize', 'Minimize', 'window.setMinimized', owner, { minimized: true }, windows ? undefined : '⌘M'),
    shell(windows ? 'maximize' : 'zoom', windows ? 'Maximize' : 'Zoom', windows ? 'window.setMaximized' : 'window.setZoomed', owner, windows ? { maximized: true } : { zoomed: true }),
    leaf('close-window', 'Close Window', 'calendar.window.close', {}, alive, windows ? { shortcut: 'Alt+F4' } : { shortcut: '⌘W' }),
    separator('window-list'),
    ...state.windows.map(row => shell(`window-${row.windowId}`, 'Calendar', 'window.focus', { windowId: row.windowId }))
  ];
  const help = [leaf('help-calendar', windows ? 'Calendar help and local limitations' : 'Calendar Help', 'calendar.sheet.open', { sheet: 'help' })];
  // Host/server-capable services (iCloud share, live subscriptions, free/busy
  // availability, public publication) have no local implementation and stay
  // disabled instead of advertising them.
  const servicesGroup = group('services', 'Services', services.map(row => ({ ...row, enabled: Boolean(row.enabled) && false, ...(row.enabled ? {} : { disabledReason: 'no_local_service' }) })), Boolean(services.length));
  if (windows) return [
    { id: 'commands', label: 'Commands', items: [...view, separator('commands-events'), ...editEvent] },
    { id: 'file', label: 'File', items: [...file, separator('file-text'), ...edit] },
    { id: 'settings', label: 'Settings', items: [...settings, separator('settings-window'), ...windowItems] },
    { id: 'help', label: 'Help', items: help }
  ];
  // Documents a local sheet is not an iCloud service; label Options explicitly.
  const calendarItems = [leaf('accounts', 'Accounts…', 'calendar.sheet.open', { sheet: 'accounts' })];
  return [
    { id: 'calendar', label: 'Calendar', items: [
      leaf('about', 'About Calendar · local recreation', 'calendar.sheet.open', { sheet: 'help' }),
      leaf('preferences', classic ? 'Preferences…' : 'Settings…', 'calendar.sheet.open', { sheet: 'preferences', pane: 'General' }, alive, { shortcut: '⌘,' }),
      leaf('accounts', 'Accounts…', 'calendar.sheet.open', { sheet: 'accounts' }),
      separator('calendar-services'), servicesGroup, separator('calendar-visibility'),
      shell('hide-calendar', 'Hide Calendar', 'app.setHidden', { appId: 'calendar' }, { hidden: true }, '⌘H'),
      shell('hide-others', 'Hide Others', 'app.hideOthers', { appId: 'calendar' }, {}, '⌥⌘H'),
      shell('show-all', 'Show All', 'app.showAll', {}, {}, null),
      separator('calendar-quit'), shell('quit-calendar', 'Quit Calendar', 'app.quit', { appId: 'calendar' }, {}, '⌘Q')
    ] },
    { id: 'file', label: 'File', items: file },
    { id: 'edit', label: 'Edit', items: [...edit, separator('edit-events'), ...editEvent] },
    { id: 'view', label: 'View', items: view },
    { id: 'window', label: 'Window', items: [...windowItems, ...(calendarItems.length ? [separator('window-accounts'), ...calendarItems] : [])] },
    { id: 'help', label: 'Help', items: help }
  ];
}

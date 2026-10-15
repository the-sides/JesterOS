import { callsWindow, callById, callsCapabilities } from './calls-state.js';
import { recipientIdentity } from './messages-recipients.js';

// Same request descriptors consumed by the shell menus and the mounted view.
export function callsMenus(profile, state, windowId, account, blockedCallers = null) {
  const id = typeof profile === 'string' ? profile : profile?.id ?? profile?.renderer ?? '';
  const windows = id.includes('windows');
  const classic = id.includes('high-sierra') || id.includes('mojave');
  const capabilities = callsCapabilities(profile);
  const preferences = state.preferences;
  const win = callsWindow(state, windowId);
  const call = callById(state, win?.callId);
  const live = Boolean(call && ['ringing', 'connecting', 'in-call'].includes(call.status));
  const incoming = call?.status === 'ringing' && call.direction === 'incoming';
  const recipient = win?.recipients?.find(row => row.id === win.selectedContactId);
  const ready = Boolean(win && account?.signedIn && !live && (recipient || win.query.trim()));
  const owner = { windowId };
  const appId = windows ? 'teams' : 'facetime';
  const leaf = (id, label, command, payload = {}, enabled = Boolean(win), extra = {}, target = owner) => ({
    id, label, enabled: Boolean(enabled), ...extra,
    ...(enabled && command ? { request: { command, target, payload } } : {})
  });
  const divider = id => ({ id, separator: true, label: '', enabled: false });
  const start = kind => ({ kind, ...(recipient ? { contactId: recipient.id } : { name: win?.query.trim() ?? '', address: win?.query.trim() ?? '' }) });
  const callItems = [
    leaf('new-call', preferences.defaultKind === 'audio' ? 'New Audio Call…' : windows ? 'New Video Call…' : 'New FaceTime Call…', 'calls.contacts.resolve', { query: '' }, !live, { shortcut: windows ? 'Ctrl+N' : '⌘N' }),
    leaf('group-call', capabilities.groupSupported ? 'New Group Call…' : `Group Call Unavailable · ${capabilities.groupUnavailableReason}`, 'calls.contacts.resolve', { query: '' }, Boolean(win && account?.signedIn && !live && capabilities.groupSupported)),
    leaf('audio-call', windows ? 'Audio call' : 'FaceTime Audio', 'calls.start', start('audio'), ready),
    leaf('video-call', windows ? 'Video call' : 'FaceTime Video', 'calls.start', start('video'), ready),
    divider('call-response'),
    leaf('accept', 'Accept Call', 'calls.accept', {}, incoming),
    leaf('end', incoming ? 'Decline Call' : 'End Call', 'calls.end', {}, live),
    divider('call-media'),
    leaf('mute', call?.muted ? 'Unmute' : 'Mute Microphone', 'calls.media.set', { muted: !call?.muted }, live, { checked: Boolean(call?.muted), shortcut: windows ? 'Ctrl+Shift+M' : '⇧⌘M' }),
    leaf('camera', call?.cameraEnabled ? 'Turn Camera Off' : 'Turn Camera On', 'calls.media.set', { cameraEnabled: !call?.cameraEnabled }, live && call.kind === 'video', { checked: Boolean(call?.cameraEnabled) }),
    divider('call-local'),
    leaf('incoming-audio', 'Incoming audio call · local scene', 'calls.incoming', start('audio'), ready),
    leaf('incoming-video', 'Incoming video call · local scene', 'calls.incoming', start('video'), ready),
    leaf('fail', 'Simulate Connection Failure · local scene', 'calls.fail', { reason: 'The fictional connection was interrupted.' }, live),
    divider('call-blocked'),
    ...((call?.participants ?? []).map(row => leaf(`block:${row.id}`, `Block ${row.name}`, 'calls.block', { address: row.address, ...(row.contactId ? { contactId: row.contactId } : {}) }, Boolean(win && blockedCallers && !blockedCallers.some(block => recipientIdentity(block.address) === recipientIdentity(row.address))))))
  ];
  const viewItems = [
    leaf('find', 'Search Calls', 'calls.native.focus', { controlId: 'search' }, Boolean(win), { shortcut: windows ? 'Ctrl+F' : '⌘F' }),
    leaf('contacts', 'Choose from Contacts…', 'calls.contacts.resolve', { query: win?.query ?? '' }, !live),
    leaf('fullscreen', windows ? 'Expand call window' : 'Enter Full Screen', 'calls.window.expand', {}, Boolean(win), { shortcut: windows ? 'F11' : '⌃⌘F' }),
    leaf('hide-self-view', 'Hide Self View', 'calls.preferences.set', { values: { ...preferences, hideSelfView: !preferences.hideSelfView } }, Boolean(win), { checked: preferences.hideSelfView }),
    divider('view-recents'),
    leaf('recents-all', 'All Calls', 'calls.recents.filter', { filter: 'all' }, Boolean(win), { checked: win?.recentFilter === 'all' }),
    leaf('recents-missed', 'Missed Calls', 'calls.recents.filter', { filter: 'missed' }, Boolean(win), { checked: win?.recentFilter === 'missed' })
  ];
  const editItems = [
    leaf('find-recipient', 'Find…', 'calls.native.focus', { controlId: 'search' }, Boolean(win), { shortcut: windows ? 'Ctrl+F' : '⌘F' }),
    leaf('select-query', 'Select All', 'calls.native.selection', { controlId: 'search', start: 0, end: win?.query.length ?? 0 }, Boolean(win), { shortcut: windows ? 'Ctrl+A' : '⌘A' }),
    leaf('clear-query', 'Clear Search', 'calls.search', { query: '' }, Boolean(win && win.query))
  ];
  const accountItems = [
    leaf('preferences', windows ? 'Call settings…' : classic ? 'Preferences…' : 'Settings…', 'calls.sheet.open', { sheet: 'preferences' }, Boolean(win), windows ? {} : { shortcut: '⌘,' }),
    leaf('account', 'Manage account…', 'calls.sheet.open', { sheet: 'account' }, Boolean(win)),
    leaf('blocked-callers', 'Blocked Callers…', 'calls.sheet.open', { sheet: 'blocked' }, Boolean(win)),
    leaf('notifications', 'Incoming Call Notifications', 'calls.preferences.set', { values: { ...preferences, notificationsEnabled: !preferences.notificationsEnabled } }, Boolean(win), { checked: preferences.notificationsEnabled }),
    leaf('signin', account?.signedIn ? 'Sign Out · fictional account' : 'Sign In · fictional account', 'calls.account.set', { signedIn: !account?.signedIn, status: account?.status ?? 'Available' }),
    leaf('about', windows ? 'About local Teams calls' : 'About FaceTime · local recreation', 'calls.sheet.open', { sheet: 'help' })
  ];
  const windowItems = [
    leaf('minimize', 'Minimize', 'window.setMinimized', { minimized: true }, Boolean(win), windows ? {} : { shortcut: '⌘M' }),
    leaf('zoom', windows ? 'Maximize' : 'Zoom', 'calls.window.expand'),
    leaf('close', 'Close Window', 'calls.window.close', {}, Boolean(win), { shortcut: windows ? 'Alt+F4' : '⌘W' }),
    divider('window-list'),
    ...state.windows.map(row => leaf(`window:${row.windowId}`, windows ? 'Teams call' : 'FaceTime', 'window.focus', {}, true, { checked: row.windowId === windowId }, { windowId: row.windowId }))
  ];
  const helpItems = [leaf('help', windows ? 'Help and local call limitations' : 'FaceTime Help', 'calls.sheet.open', { sheet: 'help' })];
  if (windows) return [{ id: 'call', label: 'Call', items: callItems }, { id: 'view', label: 'View', items: viewItems }, { id: 'account', label: 'Account', items: accountItems }, { id: 'window', label: 'Window', items: windowItems }, { id: 'help', label: 'Help', items: helpItems }];
  return [
    { id: 'facetime', label: 'FaceTime', items: [...accountItems, divider('app-visibility'),
      leaf('hide', 'Hide FaceTime', 'app.setHidden', { hidden: true }, Boolean(win), { shortcut: '⌘H' }, { appId }),
      leaf('hide-others', 'Hide Others', 'app.hideOthers', {}, Boolean(win), { shortcut: '⌥⌘H' }, { appId }),
      leaf('show-all', 'Show All', 'app.showAll', {}, Boolean(win), {}, {}),
      divider('app-quit'), leaf('quit', 'Quit FaceTime', 'app.quit', {}, Boolean(win), { shortcut: '⌘Q' }, { appId })] },
    { id: 'edit', label: 'Edit', items: editItems },
    { id: 'video', label: 'Video', items: callItems },
    { id: 'view', label: 'View', items: viewItems },
    { id: 'window', label: 'Window', items: windowItems },
    { id: 'help', label: 'Help', items: helpItems }
  ];
}

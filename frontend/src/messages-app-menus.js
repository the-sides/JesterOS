// Native-era menu projection from actual canonical selection and mounted input
// availability. Destructive leaves open the real confirmation UI; they never
// manufacture confirmed:true. Windows Teams has no macOS menu bar.
import { recipientIdentity } from './messages-recipients.js';
const request = (command, target = {}, payload = {}) => ({ command, target, payload });
const leaf = (id, label, enabled, command, target, payload = {}, extra = {}) => ({ id, label, enabled: Boolean(enabled),
  ...(enabled ? { request: request(command, target, payload) } : {}), ...extra });
const separator = id => ({ id, label: '', enabled: false, separator: true });

export function messagesAppMenuProviders({ state, profile, windowId, available = false, editing = null, clipboard = null }) {
  if (profile.family !== 'macos' || !profile.capabilities.includes('messages.conversations')) return [];
  const live = available === true && typeof windowId === 'string';
  const conversation = state.conversations.find(row => row.id === state.selectedConversationId);
  const draft = state.drafts.find(row => row.id === state.selectedDraftId);
  const modern = ['sonoma', 'golden-gate'].includes(profile.renderer);
  const target = { windowId }, threadTarget = { windowId, conversationId: conversation?.id };
  const panel = (id, label, kind, enabled = live, extra = {}) => leaf(id, label, enabled, 'messages.conversation.details',
    ['details', 'delete', 'leave', 'attachments'].includes(kind) ? threadTarget : target, { panel: kind, open: true }, extra);
  const selectedText = editing && editing.start < editing.end;
  const editable = editing && !editing.readOnly;
  const edit = (operation, shortcut, enabled) => leaf(operation,
    operation === 'selectAll' ? 'Select All' : operation[0].toUpperCase() + operation.slice(1),
    live && Boolean(editing) && enabled, `messages.edit.${operation}`, target, {}, { shortcut });
  const rows = {
    application: [leaf('about-messages', 'About Messages', live, 'app.about.open', { appId: 'messages' }),
      panel('preferences', modern ? 'Settings…' : 'Preferences…', 'preferences', live, { shortcut: '⌘,' })],
    file: [leaf('new-message', 'New Message', live, 'messages.compose.new', target, {}, { shortcut: '⌘N' }),
      leaf('attach-file', 'Attach Virtual File…', live && Boolean(draft), 'messages.draft.attach', { windowId, draftId: draft?.id }),
      ...(!modern ? [panel('delete-conversation', 'Delete Conversation…', 'delete', live && Boolean(conversation))] : []),
      separator('file-print'), leaf('print-conversation', 'Print…', live && Boolean(conversation), 'messages.conversation.print', threadTarget, {}, { shortcut: '⌘P' }),
      leaf('close-window', 'Close', live, 'window.close', target, {}, { shortcut: '⌘W' })],
    edit: [
      leaf('undo', 'Undo', live && editable && editing.undo, 'messages.edit.undo', target, {}, { shortcut: '⌘Z' }),
      leaf('redo', 'Redo', live && editable && editing.redo, 'messages.edit.redo', target, {}, { shortcut: '⇧⌘Z' }),
      separator('edit-clipboard'), edit('cut', '⌘X', editable && selectedText),
      edit('copy', '⌘C', selectedText), edit('paste', '⌘V', editable && (clipboard?.kind === 'text' && Boolean(clipboard.text)
        || editing?.field === 'body' && clipboard?.kind === 'files' && Boolean(clipboard.fileIds?.length))),
      edit('selectAll', '⌘A', Boolean(editing?.valueLength)), separator('edit-find'),
      leaf('search-conversations', 'Find…', live, 'messages.focus', { windowId, controlId: 'search' }, {}, { shortcut: '⌘F' }),
      panel('emoji-symbols', 'Emoji & Symbols', 'emoji', live && Boolean(draft), { shortcut: '⌃⌘Space' })],
    view: [...(modern ? [
      leaf('all-messages', 'All Messages', live, 'messages.filter.setUnreadOnly', target, { enabled: false }, { checked: !state.unreadOnly, radio: true, shortcut: '⌃⌘1' }),
      leaf('unread-messages', 'Unread Messages', live, 'messages.filter.setUnreadOnly', target, { enabled: true }, { checked: state.unreadOnly, radio: true, shortcut: '⌃⌘4' }), separator('view-text')
    ] : []),
      leaf('text-larger', 'Make Text Bigger', live && state.preferences.textSize < 24, 'messages.preferences.set', target,
        { key: 'textSize', value: Math.min(24, state.preferences.textSize + 1) }, { shortcut: '⌘+' }),
      leaf('text-smaller', 'Make Text Smaller', live && state.preferences.textSize > 10, 'messages.preferences.set', target,
        { key: 'textSize', value: Math.max(10, state.preferences.textSize - 1) }, { shortcut: '⌘−' })],
    conversation: [panel('details', 'Details', 'details', live && Boolean(conversation)),
      ...(modern ? [leaf('mark-unread', conversation?.unread ? 'Mark as Read' : 'Mark as Unread', live && Boolean(conversation),
        'messages.conversation.setUnread', threadTarget, { unread: !conversation?.unread }, { shortcut: '⇧⌘U' })] : []),
      ...(modern ? [leaf('block-person', conversation?.participants[0]
        && state.blockedAddresses.some(address => recipientIdentity(address) === recipientIdentity(conversation.participants[0])) ? 'Unblock Person' : 'Block Person',
        live && conversation?.participants.length === 1, 'messages.block.set', target, {
          address: conversation?.participants[0],
          blocked: !state.blockedAddresses.some(address => recipientIdentity(address) === recipientIdentity(conversation?.participants[0] ?? '')),
        })] : []),
      leaf('hide-alerts', modern ? 'Hide Alerts' : 'Do Not Disturb', live && Boolean(conversation), 'messages.conversation.setDnd', threadTarget,
        { enabled: !conversation?.dnd }, { checked: Boolean(conversation?.dnd) }),
      separator('conversation-management'), ...(modern ? [panel('delete-conversation', 'Delete Conversation…', 'delete', live && Boolean(conversation))] : []),
      panel('leave-conversation', conversation?.participants.length >= 3 ? 'Leave This Conversation…' : 'Leave — local equivalent…',
        'leave', live && Boolean(conversation && conversation.participants.length >= 2 && !conversation.left))],
    window: [leaf('messages-main', 'Messages', true, 'app.open', { appId: 'messages' }, {}, { shortcut: '⌘0' }),
      panel('file-transfers', 'File Transfers — local attachments', 'attachments', live && Boolean(conversation), { shortcut: '⌥⌘L' })],
    help: [panel('messages-help', 'Messages Help', 'help')],
    buddies: [panel('buddy-lists-unavailable', 'Buddy Lists — unavailable with iMessage…', 'help')],
  };
  const headings = ['application', 'file', 'edit', 'view', ...(profile.renderer === 'high-sierra' ? ['buddies'] : []), 'conversation', 'window', 'help'];
  return headings.map(menuId => ({ menuId, kind: menuId,
    label: menuId === 'application' ? 'Messages' : menuId[0].toUpperCase() + menuId.slice(1), appId: 'messages', enabled: live, items: rows[menuId] }));
}

// Resolve only a represented, enabled menu action. Actor keys and menu clicks
// dispatch the exact same canonical request, including release availability.
export function messagesMenuShortcut(event, menus) {
  if (!event.metaKey) return null;
  const key = event.key.toLowerCase();
  let itemId = null;
  if (event.ctrlKey && !event.altKey && !event.shiftKey)
    itemId = ({ ' ': 'emoji-symbols', '1': 'all-messages', '4': 'unread-messages' })[key];
  else if (event.altKey && !event.ctrlKey && !event.shiftKey)
    itemId = key === 'l' ? 'file-transfers' : null;
  else if (!event.ctrlKey && !event.altKey) {
    if (key === 'z') itemId = event.shiftKey ? 'redo' : 'undo';
    else if (key === '+' || key === '=') itemId = 'text-larger';
    else if (event.shiftKey) itemId = key === 'u' ? 'mark-unread' : null;
    else itemId = ({ ',': 'preferences', n: 'new-message', p: 'print-conversation', w: 'close-window',
      m: 'minimize', '-': 'text-smaller', f: 'search-conversations', x: 'cut', c: 'copy', v: 'paste', a: 'selectAll' })[key];
  }
  if (!itemId) return null;
  return menus.flatMap(menu => menu.items).find(item => item.id === itemId && item.enabled && item.request)?.request ?? null;
}

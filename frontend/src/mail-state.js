import { object, choice, flag } from './command-schema.js';
import { canonicalStringUnits } from './canonical-data.js';

export const MAIL_PROFILES = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
export const MAIL_LIMITS = Object.freeze({ accounts: 8, mailboxes: 64, messages: 512, drafts: 32, windows: 32, attachments: 16, attachmentText: 1024 * 1024, activity: 128, signatures: 32, rules: 64, text: 65536, textUnits: 8 * 1024 * 1024 });
export const MAIL_PANES = ['General', 'Accounts', 'Junk Mail', 'Fonts & Colors', 'Viewing', 'Composing', 'Signatures', 'Rules'];
export const MAIL_TOOLBAR = ['get', 'compose', 'reply', 'replyAll', 'forward', 'archive', 'junk', 'delete', 'flag', 'read', 'move', 'search'];
const str = (maxLength = 256, minLength = 0) => ({ type: 'string', minLength, maxLength });
const id = { ...str(128, 1), pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const list = (items, maxItems, uniqueItems = false) => ({ type: 'array', items, maxItems, ...(uniqueItems ? { uniqueItems: true } : {}) });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const timestamp = integer(0, 8640000000000000 - 1);
const address = object({ name: str(256), email: str(254, 3) });
export const mailAttachmentSchema = object({ id, name: str(256, 1), mime: choice('text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/calendar', 'text/html', 'application/pdf', 'image/svg+xml'), text: str(MAIL_LIMITS.attachmentText), fileId: nullable(id) });
const attachmentList = list(mailAttachmentSchema, MAIL_LIMITS.attachments);
const priority = choice('normal', 'high', 'low');
const field = choice('all', 'sender', 'subject', 'unread', 'flagged', 'attachment');
const prefs = {
  defaultAccountId: id, checkInterval: choice('manual', 'minute', 'five', 'fifteen'), playSound: flag, markRead: flag, showPreview: flag,
  conversationView: flag, fontSize: integer(10, 24), fontFamily: choice('system', 'serif', 'monospace'), quoteColor: { ...str(7, 7), pattern: '^#[0-9a-fA-F]{6}$' },
  junkEnabled: flag, deleteJunk: choice('never', 'day', 'week', 'month'), composeFormat: choice('plain', 'rich'), quoteOriginal: flag, replyAll: flag, defaultSignatureId: nullable(id),
};
export const mailPreferencesSchema = object(prefs);
export const mailStateSchema = object({
  version: { const: 1 }, nextId: integer(1, Number.MAX_SAFE_INTEGER),
  accounts: list(object({ id, name: str(256, 1), email: str(254, 3), enabled: flag, online: flag, connection: choice('connected', 'offline', 'failed'), failure: choice('none', 'send', 'receive'), signatureId: nullable(id) }), MAIL_LIMITS.accounts),
  mailboxes: list(object({ id, name: str(256, 1), kind: choice('inbox', 'sent', 'drafts', 'archive', 'junk', 'trash', 'outbox', 'custom', 'smart'), accountId: nullable(id), favorite: flag, criteria: object({ field, value: str(1024) }) }), MAIL_LIMITS.mailboxes),
  messages: list(object({ id, accountId: id, mailboxId: id, previousMailboxId: nullable(id), threadId: id, from: address, to: list(address, 64), cc: list(address, 64), bcc: list(address, 64),
    subject: str(1024), text: str(MAIL_LIMITS.text), html: str(MAIL_LIMITS.text * 16 + 16), format: choice('plain', 'rich'), date: timestamp, read: flag, flagged: flag, priority, attachments: attachmentList,
    invitation: nullable(object({ id, title: str(1024, 1), start: timestamp, end: timestamp, location: str(1024), status: choice('pending', 'accepted', 'declined', 'tentative'), eventId: nullable(id) })),
    headers: list(object({ name: str(128, 1), value: str(2048) }), 32), delivery: choice('received', 'draft', 'queued', 'sent', 'failed', 'cancelled'),
  }), MAIL_LIMITS.messages),
  drafts: list(object({ id, windowId: nullable(id), messageId: nullable(id), accountId: id, to: str(4096), cc: str(4096), bcc: str(4096), subject: str(1024), body: str(MAIL_LIMITS.text),
    format: choice('plain', 'rich'), signatureId: nullable(id), priority, attachments: attachmentList, replyToId: nullable(id), mode: choice('new', 'reply', 'replyAll', 'forward'), dirty: flag,
    history: list(object({ body: str(MAIL_LIMITS.text) }), 32), historyIndex: integer(0, 31),
  }), MAIL_LIMITS.drafts),
  windows: list(object({ windowId: id, kind: choice('mailbox', 'compose', 'preferences', 'activity', 'doctor', 'help'), mailboxId: id, selectedIds: list(id, MAIL_LIMITS.messages, true),
    query: str(4096), filter: choice('all', 'unread', 'flagged', 'attachments'), sort: choice('date', 'sender', 'subject'), ascending: flag, threaded: flag, sidebarVisible: flag, headersVisible: flag,
    readingMode: choice('html', 'text'), draftId: nullable(id), pane: choice(...MAIL_PANES), sheet: choice('none', 'mailbox', 'smart', 'account', 'toolbar', 'attach', 'delete'), status: str(4096), toolbar: list(choice(...MAIL_TOOLBAR), MAIL_TOOLBAR.length, true),
  }), MAIL_LIMITS.windows),
  preferences: mailPreferencesSchema,
  signatures: list(object({ id, name: str(256, 1), text: str(4096) }), MAIL_LIMITS.signatures),
  rules: list(object({ id, name: str(256, 1), enabled: flag, field: choice('sender', 'subject', 'body', 'attachment'), match: str(1024, 1), action: choice('move', 'flag', 'read', 'junk'), mailboxId: nullable(id) }), MAIL_LIMITS.rules),
  activity: list(object({ id, accountId: id, messageId: nullable(id), operation: choice('send', 'receive', 'connect'), status: choice('running', 'completed', 'failed', 'cancelled'), detail: str(2048), time: timestamp }), MAIL_LIMITS.activity), offline: flag,
});

export const mailFold = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US').trim();
export const mailEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/u.test(value);
// Delimit only outside a quoted display name or angle-address. The same
// tokenizer serves validation and autocomplete replacement.
export function mailRecipientParts(text) {
  const parts = [];
  let start = 0, quoted = false, escaped = false, angle = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === '\\') { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === '<') angle = true;
    else if (!quoted && char === '>') angle = false;
    else if (!quoted && !angle && (char === ',' || char === ';')) { parts.push(text.slice(start, index).trim()); start = index + 1; }
  }
  parts.push(text.slice(start).trim());
  return parts;
}
export function mailParseRecipients(text, { allowEmpty = true } = {}) {
  if (typeof text !== 'string' || text.length > 4096) return null;
  if (!text.trim()) return allowEmpty ? [] : null;
  const parts = mailRecipientParts(text).filter(Boolean);
  if (parts.length > 64) return null;
  const results = [];
  for (const part of parts) {
    const match = /^(.*?)\s*<([^<>]+)>$/u.exec(part), email = (match ? match[2] : part).trim(), rawName = match ? match[1].trim() : '';
    if (rawName.startsWith('"') !== rawName.endsWith('"') || rawName && !rawName.startsWith('"') && /[";,]/u.test(rawName)) return null;
    const name = rawName.startsWith('"') ? rawName.slice(1, -1).replace(/\\(["\\])/gu, '$1') : rawName;
    if (!mailEmail(email) || name.length > 256) return null;
    if (!results.some(row => row.email.toLowerCase() === email.toLowerCase())) results.push({ name, email });
  }
  return results;
}
export const mailDisplayAddress = address => {
  const name = /["\\;,]/u.test(address.name) ? `"${address.name.replace(/["\\]/gu, '\\$&')}"` : address.name;
  return name ? `${name} <${address.email}>` : address.email;
};
const escape = text => text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
// A deliberately closed, local rich-text vocabulary. Never store or execute arbitrary sender HTML.
export function mailPlainToHtml(text, rich = true) {
  return text.split('\n').map(line => {
    const quote = rich && /^>\s?/u.test(line);
    let content = escape(quote ? line.replace(/^>\s?/u, '') : line);
    if (rich) content = content.replace(/\*\*([^*\n]+)\*\*/gu, '<strong>$1</strong>').replace(/_([^_\n]+)_/gu, '<em>$1</em>').replace(/\[u\]([^\n]+?)\[\/u\]/gu, '<u>$1</u>');
    return quote ? `<blockquote>${content || '<br>'}</blockquote>` : `<div>${content || '<br>'}</div>`;
  }).join('');
}
export function mailCapabilities(profile) {
  const windows = profile?.family === 'windows' || profile?.id?.startsWith('windows11') || profile?.renderer === 'windows11';
  return { windows, app: 'Mail', version: windows ? 'Mail and Calendar (inbox UWP, October 2023)' : profile?.renderer === 'high-sierra' ? 'Mail 11 · macOS 10.13' : profile?.renderer === 'mojave' ? 'Mail 12 · macOS 10.14' : profile?.renderer === 'sonoma' ? 'Mail guide 16.0 · macOS 14.0' : 'Mail guide 16.0 / OSpath 27 · qualified simulator 27.0.1',
    smartNative: !windows, rulesNative: !windows, doctorNative: !windows, toolbarNative: !windows, preferencesLabel: windows ? 'Settings' : ['sonoma', 'golden-gate'].includes(profile?.renderer) ? 'Settings…' : 'Preferences…',
    // Historical Mac Priority is source-verified. Exact 23H2 UWP Importance
    // placement is unverified; Windows exposes a disclosed local equivalent.
    priorityNative: !windows };
}
export function mailWindow(state, windowId) { return state.windows.find(row => row.windowId === windowId) ?? null; }
export function createMailWindow(state, windowId, kind = 'mailbox', draftId = null) {
  return { windowId, kind, mailboxId: state.mailboxes.find(row => row.kind === 'inbox')?.id ?? state.mailboxes[0].id, selectedIds: [], query: '', filter: 'all', sort: 'date', ascending: false,
    threaded: state.preferences.conversationView, sidebarVisible: true, headersVisible: false, readingMode: 'html', draftId, pane: 'General', sheet: 'none', status: '', toolbar: ['get', 'compose', 'reply', 'archive', 'delete', 'flag', 'search'] };
}
export const mailMailboxFor = (state, accountId, kind) => state.mailboxes.find(row => row.accountId === accountId && row.kind === kind) ?? null;
export function mailMatchesCriterion(message, criteria) {
  if (criteria.field === 'all') return true;
  if (criteria.field === 'unread') return !message.read;
  if (criteria.field === 'flagged') return message.flagged;
  if (criteria.field === 'attachment') return message.attachments.length > 0;
  return mailFold(criteria.field === 'sender' ? mailDisplayAddress(message.from) : message.subject).includes(mailFold(criteria.value));
}
export function mailMessagesInMailbox(state, mailboxId) {
  const box = state.mailboxes.find(row => row.id === mailboxId);
  if (!box) return [];
  return state.messages.filter(message => state.accounts.some(account => account.id === message.accountId && account.enabled) && (box.kind === 'smart' ? (!box.accountId || message.accountId === box.accountId) && !['trash', 'junk'].includes(state.mailboxes.find(row => row.id === message.mailboxId)?.kind) && mailMatchesCriterion(message, box.criteria) : message.mailboxId === box.id));
}
export function visibleMailMessages(state, windowId) {
  const win = mailWindow(state, windowId); if (!win) return [];
  const query = mailFold(win.query);
  const rows = mailMessagesInMailbox(state, win.mailboxId).filter(message => (!query || mailFold(`${mailDisplayAddress(message.from)} ${[...message.to, ...message.cc, ...message.bcc].map(mailDisplayAddress).join(' ')} ${message.subject} ${message.text} ${message.attachments.map(a => a.name).join(' ')}`).includes(query))
    && (win.filter === 'all' || win.filter === 'unread' && !message.read || win.filter === 'flagged' && message.flagged || win.filter === 'attachments' && message.attachments.length));
  const compare = (a, b) => win.sort === 'date' ? a.date - b.date : mailFold(win.sort === 'sender' ? mailDisplayAddress(a.from) : a.subject).localeCompare(mailFold(win.sort === 'sender' ? mailDisplayAddress(b.from) : b.subject));
  rows.sort((a, b) => (win.ascending ? 1 : -1) * compare(a, b) || a.id.localeCompare(b.id));
  if (!win.threaded) return rows;
  const threads = new Map(); for (const row of rows) { const group = threads.get(row.threadId) ?? []; group.push(row); threads.set(row.threadId, group); }
  return [...threads.values()].flat();
}
export function mailboxCount(state, id) { return mailMessagesInMailbox(state, id).filter(row => !row.read).length; }
export function mailNewId(state, prefix) { if (state.nextId >= Number.MAX_SAFE_INTEGER) return null; return `${prefix}-${state.nextId++}`; }
export function createMailState(profile) {
  const time = Date.parse(profile?.defaults?.sceneTime ?? '2023-10-31T09:41:00Z');
  const now = Number.isFinite(time) && time >= 0 ? time : Date.UTC(2023, 9, 31, 9, 41);
  const account = { id: 'mail-account-local', name: 'Personal · fictional', email: 'alex@example.test', enabled: true, online: true, connection: 'connected', failure: 'none', signatureId: 'mail-signature-personal' };
  const mailboxes = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash', 'outbox'].map(kind => ({ id: `mail-box-${kind}`, name: kind[0].toUpperCase() + kind.slice(1), kind, accountId: account.id, favorite: ['inbox', 'sent', 'drafts'].includes(kind), criteria: { field: 'all', value: '' } }));
  mailboxes.push({ id: 'mail-box-projects', name: 'Projects', kind: 'custom', accountId: account.id, favorite: true, criteria: { field: 'all', value: '' } }, { id: 'mail-box-flagged', name: 'Flagged', kind: 'smart', accountId: null, favorite: true, criteria: { field: 'flagged', value: '' } });
  const seed = (id, name, email, subject, text, offset, extra = {}) => ({ id, accountId: account.id, mailboxId: 'mail-box-inbox', previousMailboxId: null, threadId: id, from: { name, email }, to: [{ name: 'Alex', email: account.email }], cc: [], bcc: [], subject, text, html: mailPlainToHtml(text), format: 'rich', date: now - offset, read: false, flagged: false, priority: 'normal', attachments: [], invitation: null,
    headers: [{ name: 'Message-ID', value: `<${id}@example.test>` }, { name: 'X-JesterOS-Transport', value: 'Fictional frontend-local; never delivered' }], delivery: 'received', ...extra });
  const messages = [
    seed('mail-message-route', 'Casey Rivera', 'casey@example.test', 'Saturday along the coast', 'Hi Alex,\n\n**The coastal trail is open.** Let’s meet at the north trailhead at ten.\n\nI attached the route notes.\n\nSee you there,\nCasey', 5 * 60000, { flagged: true, attachments: [{ id: 'mail-attachment-route', name: 'Route notes.txt', mime: 'text/plain', text: 'North trailhead → coastal overlook → picnic area.\nBring water and a light jacket.', fileId: null }] }),
    seed('mail-message-invite', 'Jordan Lee', 'jordan@example.test', 'Invitation: Studio review', 'You’re invited to a studio review.\n\nPlease accept, decline, or mark tentative below.', 3600000, { invitation: { id: 'mail-invitation-review', title: 'Studio review', start: now + 86400000, end: now + 90000000, location: 'Studio · fictional event', status: 'pending', eventId: null } }),
    seed('mail-message-reply', 'Sam Rivera', 'sam@example.test', 'Re: Saturday along the coast', 'I’ll bring lunch.\n\n> Let’s meet at the north trailhead at ten.', 7200000, { threadId: 'mail-message-route', read: true, cc: [{ name: 'Casey Rivera', email: 'casey@example.test' }] }),
    seed('mail-message-welcome', 'Local Mail', 'welcome@example.test', 'Welcome to your fictional inbox', 'This is a local Mail recreation.\n\nAccounts, addresses, connection results, drafts and sent messages exist only in this browser scene. No real credentials, servers or delivery are used.\n\nContact, Calendar, Files and Print actions use the shared scene applications.', 86400000, { read: true }),
  ];
  return { version: 1, nextId: 1, accounts: [account], mailboxes, messages, drafts: [], windows: [],
    preferences: { defaultAccountId: account.id, checkInterval: 'manual', playSound: false, markRead: true, showPreview: true, conversationView: true, fontSize: 13, fontFamily: 'system', quoteColor: '#527baf', junkEnabled: true, deleteJunk: 'never', composeFormat: 'rich', quoteOriginal: true, replyAll: false, defaultSignatureId: 'mail-signature-personal' },
    signatures: [{ id: 'mail-signature-personal', name: 'Personal', text: 'Alex\nSent from fictional local Mail' }], rules: [], activity: [], offline: false };
}

// Closed structural validation without executing accessors, followed by graph invariants.
export function mailSchemaValid(value, schema, seen = new Set()) {
  if (schema.anyOf) return schema.anyOf.some(candidate => mailSchemaValid(value, candidate, seen));
  if (Object.hasOwn(schema, 'const') && value !== schema.const || schema.enum && !schema.enum.includes(value)) return false;
  if (schema.not?.enum?.includes(value)) return false;
  if (!schema.type) return true;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity) && (!schema.pattern || new RegExp(schema.pattern, 'u').test(value));
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'integer' || schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
  if (value === null || typeof value !== 'object' || seen.has(value)) return false;
  const desc = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(desc);
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length)) || keys.length !== value.length + 1) return false;
    const next = new Set(seen); next.add(value);
    for (let index = 0; index < value.length; index++) if (!Object.hasOwn(desc[index], 'value') || !mailSchemaValid(desc[index].value, schema.items, next)) return false;
    return !schema.uniqueItems || new Set(value).size === value.length;
  }
  if (schema.type === 'object') {
    if (Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || schema.required.some(key => !Object.hasOwn(desc, key))
      || keys.some(key => typeof key !== 'string' || !Object.hasOwn(schema.properties, key) || !desc[key].enumerable || !Object.hasOwn(desc[key], 'value'))) return false;
    const next = new Set(seen); next.add(value);
    return keys.every(key => mailSchemaValid(desc[key].value, schema.properties[key], next));
  }
  return true;
}
export function mailTextUnits(value) {
  return canonicalStringUnits(value);
}
export function validateMailState(state, profile) {
  if (profile?.id && !MAIL_PROFILES.includes(profile.id) || !mailSchemaValid(state, mailStateSchema)) return false;
  if (mailTextUnits(state) > MAIL_LIMITS.textUnits) return false;
  const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;
  if (![state.accounts, state.mailboxes, state.messages, state.drafts, state.signatures, state.rules, state.activity].every(unique) || !state.accounts.length || !state.mailboxes.length || new Set(state.windows.map(w => w.windowId)).size !== state.windows.length) return false;
  const accounts = new Map(state.accounts.map(a => [a.id, a])), boxes = new Map(state.mailboxes.map(b => [b.id, b])), messages = new Map(state.messages.map(m => [m.id, m])), signatures = new Set(state.signatures.map(s => s.id));
  const signature = id => id === null || signatures.has(id);
  if (!accounts.has(state.preferences.defaultAccountId) || !signature(state.preferences.defaultSignatureId)) return false;
  for (const account of state.accounts) {
    if (!mailEmail(account.email) || !signature(account.signatureId) || state.accounts.some(other => other !== account && other.email.toLowerCase() === account.email.toLowerCase())) return false;
    for (const kind of ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash', 'outbox']) if (state.mailboxes.filter(b => b.accountId === account.id && b.kind === kind).length !== 1) return false;
    const connection = !account.enabled || !account.online || state.offline ? 'offline' : account.failure === 'receive' ? 'failed' : 'connected';
    if (account.connection !== connection) return false;
  }
  for (const box of state.mailboxes) if (box.accountId !== null && !accounts.has(box.accountId) || box.kind !== 'smart' && box.accountId === null || box.kind !== 'smart' && box.criteria.field !== 'all') return false;
  const attachmentIds = new Set();
  for (const message of state.messages) {
    const box = boxes.get(message.mailboxId);
    if (!accounts.has(message.accountId) || !box || box.kind === 'smart' || box.accountId !== message.accountId || message.previousMailboxId !== null && (!boxes.has(message.previousMailboxId) || boxes.get(message.previousMailboxId).accountId !== message.accountId || boxes.get(message.previousMailboxId).kind === 'smart')
      || ![message.from, ...message.to, ...message.cc, ...message.bcc].every(a => mailEmail(a.email)) || message.html !== mailPlainToHtml(message.text, message.format === 'rich')
      || message.invitation && (message.invitation.end <= message.invitation.start || message.invitation.status === 'pending' && message.invitation.eventId !== null || ['accepted', 'tentative'].includes(message.invitation.status) && message.invitation.eventId === null)) return false;
    if (['queued', 'failed'].includes(message.delivery) && box.kind !== 'outbox' || message.delivery === 'draft' && box.kind !== 'drafts') return false;
    for (const attachment of message.attachments) { if (attachmentIds.has(attachment.id)) return false; attachmentIds.add(attachment.id); }
  }
  for (const draft of state.drafts) {
    const signatureLength = state.signatures.find(row => row.id === draft.signatureId)?.text.length ?? 0;
    if (draft.body.length + (signatureLength ? signatureLength + 2 : 0) > MAIL_LIMITS.text) return false;
    if (!accounts.has(draft.accountId) || !signature(draft.signatureId) || !draft.history.length || draft.historyIndex >= draft.history.length || draft.history[draft.historyIndex].body !== draft.body || draft.replyToId !== null && !messages.has(draft.replyToId)
      || draft.messageId !== null && (!messages.has(draft.messageId) || messages.get(draft.messageId).delivery !== 'draft' || messages.get(draft.messageId).accountId !== draft.accountId)
      || draft.windowId !== null && !state.windows.some(w => w.windowId === draft.windowId && w.kind === 'compose' && w.draftId === draft.id) || !unique(draft.attachments)) return false;
  }
  for (const win of state.windows) {
    if (!boxes.has(win.mailboxId) || win.selectedIds.some(id => !messages.has(id)) || win.kind === 'compose' !== (win.draftId !== null)
      || win.draftId !== null && !state.drafts.some(d => d.id === win.draftId && d.windowId === win.windowId)) return false;
  }
  for (const rule of state.rules) if (rule.action === 'move' && (!boxes.has(rule.mailboxId) || boxes.get(rule.mailboxId).kind === 'smart') || rule.action !== 'move' && rule.mailboxId !== null) return false;
  for (const activity of state.activity) if (!accounts.has(activity.accountId) || activity.messageId !== null && !messages.has(activity.messageId)) return false;
  return true;
}

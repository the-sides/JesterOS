import { object, choice } from './command-schema.js';
import { rejected } from './feature-commands.js';
import { messageRecipients, recipientIdentity } from './messages-recipients.js';
import { copyCanonicalData, applyCanonicalData } from './canonical-data.js';
import { validFileMime } from './application-file-bridges.js';
import { documentFileMime } from './document-destination-commands.js';

const MAX_TEXT = 1024 * 1024, MAX_TIME = 8_640_000_000_000_000 - 1, MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1;
const string = (maxLength, minLength = 0) => ({ type: 'string', minLength, maxLength });
const identity = { ...string(128, 1), pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
const timestamp = { type: 'integer', minimum: 0, maximum: MAX_TIME };
export const messageAttachmentSchema = object({
  id: identity, name: string(255, 1), mime: string(128, 1), dataURI: string(4 * MAX_TEXT, 1),
  byteLength: { type: 'integer', minimum: 0, maximum: 3 * MAX_TEXT },
  originalFileId: { anyOf: [{ type: 'null' }, identity] },
  originalRevision: { anyOf: [{ type: 'null' }, { type: 'integer', minimum: 1, maximum: MAX_COUNTER }] },
  kind: choice('image', 'file', 'audio'),
  durationMs: { anyOf: [{ type: 'null' }, { type: 'integer', minimum: 1, maximum: 300_000 }] },
});
const attachmentKeys = ['id', 'name', 'mime', 'dataURI', 'byteLength', 'originalFileId', 'originalRevision', 'kind', 'durationMs'];
const validIdentity = value => typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
  && ![...Object.getOwnPropertyNames(Object.prototype), 'prototype'].includes(value);
export function validMessageAttachment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== attachmentKeys.length || attachmentKeys.some(key =>
    !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) return false;
  const a = Object.fromEntries(attachmentKeys.map(key => [key, descriptors[key].value]));
  const mime = typeof a.mime === 'string' ? documentFileMime(a) : null;
  if (!validIdentity(a.id) || typeof a.name !== 'string' || !a.name.length || a.name.length > 255 || /[\u0000-\u001f]/u.test(a.name)
    || !validFileMime(a.mime) || a.mime.length > 128
    || !['image', 'file', 'audio'].includes(a.kind) || !Number.isSafeInteger(a.byteLength) || a.byteLength < 0 || a.byteLength > 3 * MAX_TEXT
    || typeof a.dataURI !== 'string' || a.dataURI.length > 4 * MAX_TEXT
    || !a.dataURI.startsWith(`data:${mime};base64,`)
    || !(a.originalFileId === null && a.originalRevision === null
      || validIdentity(a.originalFileId) && Number.isSafeInteger(a.originalRevision) && a.originalRevision >= 1 && a.originalRevision <= MAX_COUNTER)) return false;
  const encoded = a.dataURI.slice(a.dataURI.indexOf(',') + 1);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
    || encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0) !== a.byteLength) return false;
  let bytes;
  try { bytes = atob(encoded); if (btoa(bytes) !== encoded) return false; } catch { return false; }
  if (a.kind === 'image') {
    if (a.durationMs !== null) return false;
    if (mime === 'image/svg+xml') {
      try {
        const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
          .decode(Uint8Array.from(bytes, character => character.charCodeAt(0)));
        // SVG is a UTF-8 document, not a raster signature or arbitrary binary fallback.
        return /^\uFEFF?\s*(?:<\?xml\b[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/u.test(source)
          && !source.includes('\u0000');
      } catch { return false; }
    }
    return mime === 'image/png' && bytes.startsWith('\x89PNG\r\n\x1a\n')
      || mime === 'image/jpeg' && bytes.startsWith('\xff\xd8\xff')
      || mime === 'image/gif' && /^GIF8[79]a/u.test(bytes)
      || mime === 'image/webp' && bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  }
  if (a.kind === 'audio') {
    if (mime !== 'audio/wav' || bytes.length < 44 || !bytes.startsWith('RIFF') || bytes.slice(8, 16) !== 'WAVEfmt '
      || bytes.slice(36, 40) !== 'data') return false;
    const u16 = i => bytes.charCodeAt(i) | bytes.charCodeAt(i + 1) << 8;
    const u32 = i => (u16(i) + u16(i + 2) * 65536);
    const channels = u16(22), rate = u32(24), bits = u16(34), length = u32(40);
    return u32(4) === bytes.length - 8 && u32(16) === 16 && u16(20) === 1 && [1, 2].includes(channels)
      && rate >= 8000 && rate <= 96000 && [8, 16].includes(bits) && u16(32) === channels * bits / 8
      && u32(28) === rate * channels * bits / 8 && length === bytes.length - 44 && length % u16(32) === 0
      && a.durationMs === Math.round(length / u32(28) * 1000) && a.durationMs >= 1 && a.durationMs <= 300_000;
  }
  return a.durationMs === null && !mime.startsWith('image/') && !mime.startsWith('audio/')
    && (mime !== 'application/pdf' || bytes.startsWith('%PDF-'));
}
export const copyMessageAttachment = attachment => copyCanonicalData(attachment);
const literalAttachments = attachments => {
  if (!Array.isArray(attachments) || attachments.length > 16) return null;
  const descriptors = Object.getOwnPropertyDescriptors(attachments);
  if (Reflect.ownKeys(descriptors).length !== attachments.length + 1) return null;
  const result = [];
  for (let index = 0; index < attachments.length; index++) {
    const descriptor = descriptors[index];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || !validMessageAttachment(descriptor.value)) return null;
    result.push(copyMessageAttachment(descriptor.value));
  }
  return new Set(result.map(a => a.id)).size === result.length ? result : null;
};
export const messageDraftSchema = object({ id: identity, kind: { const: 'message' }, conversationId: { anyOf: [{ type: 'null' }, identity] },
  createdAt: timestamp, updatedAt: timestamp, revision: { type: 'integer', minimum: 1, maximum: MAX_COUNTER },
  fields: object({ to: string(4096), body: string(MAX_TEXT) }), attachments: { type: 'array', items: messageAttachmentSchema, maxItems: 16 } });
export const messageDeliverySchema = choice('sent', 'delivered', 'read', 'failed');
const classicTapbacks = new Set(['❤️', '👍', '👎', '😂', '‼️', '❓']);
let emojiSegmenter;
export function validMessageReactionEmoji(value, profile) {
  if (classicTapbacks.has(value)) return true;
  if (!['macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'].includes(profile?.id)
    || typeof value !== 'string' || !value.length || value.length > 64) return false;
  emojiSegmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' });
  return [...emojiSegmenter.segment(value)].length === 1
    && (/^\p{Regional_Indicator}{2}$/u.test(value) || /^[0-9#*]\uFE0F?\u20E3$/u.test(value)
      || /\p{Extended_Pictographic}/u.test(value) && /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200D\uFE0F\uFE0E]+$/u.test(value)
      || /^🏴[\u{E0061}-\u{E007A}]{2,8}\u{E007F}$/u.test(value));
}
const fail = (code, message) => rejected(code, message);
const applied = target => ({ status: 'applied', target });
const timeAfter = (state, time) => Number.isSafeInteger(time) && time >= 0 && time < MAX_TIME
  && Math.max(state.timeBase, time) < MAX_TIME ? Math.max(state.timeBase, time) + 1 : null;
export const messageDraft = (state, id = state.selectedDraftId) => state.drafts.find(draft => draft.id === id) ?? null;
// Preflight callbacks may inspect the entire live scene. They cannot swap an
// equal-valued canonical record or alter account/privacy state under this commit.
const compositionOwner = state => {
  const contents = JSON.stringify(state), references = [];
  const visit = value => {
    for (const [key, child] of Object.entries(value)) if (child && typeof child === 'object') {
      references.push([value, key, child]); visit(child);
    }
  };
  visit(state);
  return () => references.every(([parent, key, child]) => parent[key] === child) && JSON.stringify(state) === contents;
};
export function validMessageDraftField(field, value) {
  return typeof value === 'string' && (field === 'body' ? value.length <= MAX_TEXT
    : field === 'to' && value.length <= 4096 && !/[\r\n]/u.test(value));
}
const literalFields = fields => {
  if (fields === null || typeof fields !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(fields))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(fields);
  if (Reflect.ownKeys(descriptors).length !== 2 || !['to', 'body'].every(key => descriptors[key]?.enumerable
    && Object.hasOwn(descriptors[key], 'value') && validMessageDraftField(key, descriptors[key].value))) return null;
  return { to: descriptors.to.value, body: descriptors.body.value };
};
export function createMessageDraft(state, values, { conversationId = null, time = state.timeBase, attachments = [],
  canCommit = () => true, guard = () => true, onCommit, makeRecord = specification => specification } = {}) {
  const fields = literalFields(values), media = literalAttachments(attachments), timestamp = timeAfter(state, time);
  const conversation = conversationId === null ? null : state.conversations.find(row => row.id === conversationId);
  if (!fields || !media || typeof guard !== 'function' || typeof makeRecord !== 'function'
    || onCommit !== undefined && typeof onCommit !== 'function' || conversationId !== null && !conversation)
    return fail('invalid_arguments', 'Use literal recipient/body fields, real attachments and an existing conversation.');
  if (state.drafts.length >= 128 || state.nextId >= MAX_COUNTER || timestamp === null) return fail('limit_exceeded', 'Messages draft, identity or authored-clock capacity is exhausted.');
  if (conversation && state.drafts.some(draft => draft.conversationId === conversation.id)) return fail('disabled', 'This conversation already owns a draft.');
  const original = compositionOwner(state);
  const specification = { id: `authored-draft-${state.nextId}`, kind: 'message', conversationId, createdAt: timestamp, updatedAt: timestamp, revision: 1, fields, attachments: media };
  const plannedContents = JSON.stringify(specification), draft = makeRecord(specification);
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || JSON.stringify(draft) !== plannedContents)
    return fail('invalid_arguments', 'The draft record factory must preserve the complete planned canonical record.');
  const candidate = { ...state, drafts: [...state.drafts, draft], nextId: state.nextId + 1, timeBase: timestamp,
    selectedConversationId: conversationId, selectedMessageId: null, selectedDraftId: draft.id, query: '', unreadOnly: false };
  if (!original() || guard() !== true) return fail('stale_target', 'The original Messages composition owner changed.');
  if (canCommit(candidate) !== true) return fail('limit_exceeded', 'The complete-scene text budget would be exceeded.');
  if (!original() || guard() !== true || onCommit && onCommit(draft.id, draft) !== true)
    return fail('stale_target', 'The shared composition transaction did not commit.');
  state.drafts.push(draft); state.nextId++; state.timeBase = timestamp;
  state.selectedConversationId = conversationId; state.selectedMessageId = null; state.selectedDraftId = draft.id; state.query = ''; state.unreadOnly = false;
  return applied({ draftId: draft.id, conversationId });
}
export function changeMessageDraft(state, draftId, field, value, { time = state.timeBase, canCommit = () => true } = {}) {
  const draft = messageDraft(state, draftId);
  if (!draft) return fail('stale_target', 'The original Messages draft has retired.');
  if (!validMessageDraftField(field, value)) return fail('invalid_arguments', 'Use a bounded literal recipient or message body.');
  if (field === 'to' && draft.conversationId !== null) return fail('disabled', 'An existing conversation owns its recipient list.');
  if (draft.fields[field] === value) return applied({ draftId, revision: draft.revision });
  const timestamp = timeAfter(state, time);
  if (timestamp === null || draft.revision >= MAX_COUNTER) return fail('limit_exceeded', 'The authored clock or draft revision is exhausted.');
  const original = compositionOwner(state);
  const replacement = { ...draft, fields: { ...draft.fields, [field]: value }, updatedAt: timestamp, revision: draft.revision + 1 };
  if (canCommit({ ...state, drafts: state.drafts.map(row => row === draft ? replacement : row), timeBase: timestamp }) !== true)
    return fail('limit_exceeded', 'The complete-scene text budget would be exceeded.');
  if (!original()) return fail('stale_target', 'The original Messages draft changed during preflight.');
  draft.fields[field] = value; draft.updatedAt = timestamp; draft.revision++; state.timeBase = timestamp;
  return applied({ draftId, revision: draft.revision });
}
export function setMessageDraftAttachments(state, draftId, attachments, { time = state.timeBase, canCommit = () => true,
  guard = () => true, onCommit } = {}) {
  const draft = messageDraft(state, draftId), media = literalAttachments(attachments), timestamp = timeAfter(state, time);
  if (!draft) return fail('stale_target', 'The original Messages draft has retired.');
  if (!media || typeof guard !== 'function' || onCommit !== undefined && typeof onCommit !== 'function')
    return fail('invalid_arguments', 'Use immutable actual attachment snapshots.');
  if (timestamp === null || draft.revision >= MAX_COUNTER) return fail('limit_exceeded', 'The authored clock or draft revision is exhausted.');
  const original = compositionOwner(state);
  const replacement = { ...draft, attachments: media, updatedAt: timestamp, revision: draft.revision + 1 };
  const candidate = { ...state, drafts: state.drafts.map(row => row === draft ? replacement : row), timeBase: timestamp };
  if (!original() || guard() !== true) return fail('stale_target', 'The original attachment owner changed.');
  if (canCommit(candidate) !== true) return fail('limit_exceeded', 'The complete-scene text budget would be exceeded.');
  if (!original() || guard() !== true || onCommit && onCommit(draft.id, draft, replacement) !== true)
    return fail('stale_target', 'The shared attachment transaction did not commit.');
  applyCanonicalData(draft.attachments, media);
  draft.updatedAt = timestamp; draft.revision++; state.timeBase = timestamp;
  return applied({ draftId, revision: draft.revision });
}
function matchingMessageConversation(state, recipients, resolveRecipient) {
  const aliases = new Set(recipients.map(recipient => recipientIdentity(recipient.address)));
  return state.conversations.find(row => row.participants.length === aliases.size
    && row.participants.every(name => {
      const parsed = messageRecipients(name, resolveRecipient);
      return parsed?.length === 1 && aliases.has(recipientIdentity(parsed[0].address));
    })) ?? null;
}
// Availability projection only; sendMessageDraft still validates Contacts,
// graph ownership, capacity and the actual atomic commit independently.
export function messageDraftCanSend(state, draft = messageDraft(state), resolveRecipient) {
  if (!draft || !state.account.signedIn || !state.account.enabled || !draft.fields.body.trim() && !draft.attachments.length) return false;
  const recipients = messageRecipients(draft.fields.to, draft.conversationId === null ? resolveRecipient : null);
  if (!recipients || recipients.some(recipient => state.blockedAddresses.some(address => recipientIdentity(address) === recipientIdentity(recipient.address)))) return false;
  const conversation = draft.conversationId === null ? matchingMessageConversation(state, recipients, resolveRecipient)
    : state.conversations.find(row => row.id === draft.conversationId);
  return (!draft.conversationId || Boolean(conversation)) && !conversation?.left;
}
let timeFormatter;
export function sendMessageDraft(state, draftId, { time = state.timeBase, canCommit = () => true, resolveRecipient, captureOutgoingProfile } = {}) {
  const draft = messageDraft(state, draftId);
  if (!draft) return fail('stale_target', 'The original Messages draft has retired.');
  const current = compositionOwner(state);
  const recipients = messageRecipients(draft.fields.to, draft.conversationId === null ? resolveRecipient : null);
  if (!state.account.signedIn || !state.account.enabled) return fail('disabled', 'Enable the shared fictional account and sign in before sending.');
  if (!recipients || !draft.fields.body.trim() && !draft.attachments.length)
    return fail('disabled', 'A fictional message requires unambiguous recipients and text or a real attachment.');
  if (recipients.some(recipient => state.blockedAddresses.some(address => recipientIdentity(address) === recipientIdentity(recipient.address))))
    return fail('disabled', 'A recipient is blocked in the shared fictional account.');
  const names = recipients.map(recipient => recipient.name);
  const original = draft.conversationId === null ? matchingMessageConversation(state, recipients, resolveRecipient)
    : state.conversations.find(row => row.id === draft.conversationId);
  if (draft.conversationId !== null && !original) return fail('stale_target', 'The draft’s original conversation has retired.');
  if (original?.left) return fail('disabled', 'This local account has left the conversation.');
  const timestamp = timeAfter(state, time), count = original ? 1 : 2;
  if (timestamp === null || state.nextId > MAX_COUNTER - count || draft.revision >= MAX_COUNTER
    || original && original.items.length >= 1024 || !original && state.conversations.length >= 1024)
    return fail('limit_exceeded', 'Messages history, identity, revision or authored-clock capacity is exhausted.');
  const conversationId = original?.id ?? `authored-conversation-${state.nextId}`;
  const messageId = `authored-message-${state.nextId + (original ? 0 : 1)}`;
  const item = { id: messageId, timestamp, kind: 'text', direction: 'outgoing', text: draft.fields.body,
    ...(draft.attachments.length ? { attachments: draft.attachments.map(copyMessageAttachment) } : {}), delivery: 'Sent · local', deliveryStatus: 'sent' };
  timeFormatter ??= new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
  const name = names.join(', ');
  const conversation = original ? { ...original, items: [...original.items, item], timestamp, timeLabel: timeFormatter.format(timestamp), unread: false }
    : { id: conversationId, name: name.length <= 256 ? name : 'Group conversation', initials: names.length > 1 ? 'GC' : names[0].split(/\s+/u).slice(0, 2).map(part => Array.from(part)[0]).join('').toUpperCase().slice(0, 32),
      tint: '#789d82', portrait: null, timestamp, timeLabel: timeFormatter.format(timestamp), pinned: false, unread: false,
      dnd: false, left: false, location: null, shareApproved: false, background: null, participants: recipients.map(recipient => recipient.address), items: [item] };
  const sharing = state.preferences.shareNamePhoto ? captureOutgoingProfile?.(conversation) : null;
  if (state.preferences.shareNamePhoto && (!sharing || typeof sharing.current !== 'function' || sharing.current() !== true))
    return fail('stale_target', 'The original Contacts authority for name and photo sharing is unavailable.');
  if (sharing?.profile) item.profile = sharing.profile;
  const retainedDraft = original ? state.drafts.find(row => row !== draft && row.conversationId === original.id) : null;
  const draftConversationId = retainedDraft ? null : conversationId;
  const selectedDraftId = retainedDraft?.id ?? draft.id;
  const replacement = { ...draft, conversationId: draftConversationId, fields: { ...draft.fields, body: '' }, attachments: [], updatedAt: timestamp, revision: draft.revision + 1 };
  const candidate = { ...state, conversations: original ? state.conversations.map(row => row === original ? conversation : row) : [...state.conversations, conversation],
    drafts: state.drafts.map(row => row === draft ? replacement : row), nextId: state.nextId + count, timeBase: timestamp,
    selectedConversationId: conversationId, selectedMessageId: messageId, selectedDraftId, query: '', unreadOnly: false };
  if (canCommit(candidate) !== true) return fail('limit_exceeded', 'The complete-scene text budget would be exceeded.');
  if (!current() || sharing && sharing.current() !== true)
    return fail('stale_target', 'The original Messages account, Contacts, draft or history changed during preflight.');
  if (original) { original.items.push(item); original.timestamp = timestamp; original.timeLabel = conversation.timeLabel; original.unread = false; }
  else state.conversations.push(conversation);
  draft.conversationId = draftConversationId; draft.fields.body = ''; draft.attachments.splice(0); draft.updatedAt = timestamp; draft.revision++;
  state.nextId += count; state.timeBase = timestamp; state.selectedConversationId = conversationId; state.selectedMessageId = messageId;
  state.selectedDraftId = selectedDraftId; state.query = ''; state.unreadOnly = false;
  return applied({ draftId, conversationId, messageId, delivery: 'sent', fictional: true });
}
export function setMessageDelivery(state, conversationId, messageId, deliveryStatus, { canCommit = () => true } = {}) {
  const conversation = state.conversations.find(row => row.id === conversationId), item = conversation?.items.find(row => row.id === messageId);
  if (!item || item.direction !== 'outgoing' || !item.id.startsWith('authored-message-')) return fail('stale_target', 'Only the original authored outgoing message owns local delivery state.');
  if (!['sent', 'delivered', 'read', 'failed'].includes(deliveryStatus)) return fail('invalid_arguments', 'Use a documented fictional delivery state.');
  const original = compositionOwner(state);
  const delivery = `${({ sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Not delivered' })[deliveryStatus]} · local`;
  const replacement = { ...item, delivery, deliveryStatus };
  if (canCommit({ ...state, conversations: state.conversations.map(row => row === conversation
    ? { ...row, items: row.items.map(value => value === item ? replacement : value) } : row) }) !== true)
    return fail('limit_exceeded', 'The complete-scene text budget would be exceeded.');
  if (!original()) return fail('stale_target', 'The original Messages history changed during preflight.');
  item.delivery = delivery; item.deliveryStatus = deliveryStatus;
  return applied({ conversationId, messageId, delivery: deliveryStatus, fictional: true });
}

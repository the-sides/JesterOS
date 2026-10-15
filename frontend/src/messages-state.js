import { conversations as mojaveConversations } from './messages-scene.js';
import { conversations as highSierraConversations } from './high-sierra-messages-scene.js';
import { object, choice, flag } from './command-schema.js';
import { messageDraftSchema, messageDeliverySchema, messageAttachmentSchema, validMessageAttachment, validMessageReactionEmoji } from './messages-composition.js';
import { recipientIdentity } from './messages-recipients.js';
import { copyCanonicalData } from './canonical-data.js';

const string = (maxLength = 1024, minLength = 0) => ({ type: 'string', minLength, maxLength });
const identity = { ...string(128, 1), pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const array = (items, maxItems = 1024) => ({ type: 'array', items, maxItems });
const timestamp = { type: 'integer', minimum: 0, maximum: 8_640_000_000_000_000 - 1 };
const tint = { ...string(7, 7), pattern: '^#[0-9a-fA-F]{6}$' };
const image = choice('silhouette-photo.png', 'miami-beach.png', 'euna-photo.png', 'grinning-face.png', 'camping.png', 'national-park.png', 'sleeping.png', 'thumbs-up.png');
const emoji = object({ image, label: string(128, 1), line: { type: 'integer', minimum: 0, maximum: 64 }, before: flag }, ['image', 'label', 'line']);
const reactions = array(object({ emoji: string(64, 1), participant: string(320, 1) }), 128);
const attachments = array(messageAttachmentSchema, 16);
const sharedProfile = object({ name: string(256, 1), photo: nullable(messageAttachmentSchema) });
const commonItem = { id: identity, timestamp, direction: choice('incoming', 'outgoing'), sender: string(256), delivery: string(256), deliveryStatus: messageDeliverySchema, attachments, reactions, screened: flag, spam: flag, effect: choice('celebration'), profile: sharedProfile, readReceiptAt: timestamp };
export const messageItemSchema = {
  anyOf: [
    object({ ...commonItem, kind: { const: 'text' }, text: string(1024 * 1024), emoji }, ['id', 'timestamp', 'kind', 'direction', 'text']),
    object({ ...commonItem, kind: { const: 'image' }, asset: image, label: string(256, 1) }, ['id', 'timestamp', 'kind', 'direction', 'asset', 'label']),
    object({ ...commonItem, kind: { const: 'emoji' }, assets: array(object({ asset: image, label: string(128, 1) }), 16) }, ['id', 'timestamp', 'kind', 'direction', 'assets']),
    object({ ...commonItem, kind: { const: 'trail' } }, ['id', 'timestamp', 'kind', 'direction']),
  ],
};
export const messagesAccountSchema = object({
  name: string(256, 1), initials: string(32, 1), address: string(320, 1), signedIn: flag, enabled: flag, readReceipts: flag,
  status: choice('Available', 'Busy', 'Do not disturb', 'Be right back', 'Away', 'Offline'), photo: nullable(messageAttachmentSchema),
});
export const messagesPreferencesSchema = object({
  playSounds: flag, showPreviews: flag, saveHistory: flag, textSize: { type: 'integer', minimum: 10, maximum: 24 },
  keepMessages: choice('forever', '30days', '1year'), saveClosedHistory: flag,
  notifyUnknownContacts: flag, notifyMentions: flag, receivedSound: choice('none', 'glass-study', 'golden-arpeggio'),
  receivedFilesFolderId: identity, screenUnknownSenders: flag, filterSpam: flag,
  shareNamePhoto: flag, shareAutomatically: choice('contacts', 'ask'), autoPlayEffects: flag, allowBackgrounds: flag,
  sharedAutomatic: flag, sharedApps: array(choice('safari', 'photos', 'finder'), 3),
});
export const messageLocationSchema = object({ label: string(256, 1),
  latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 }, sharedAt: timestamp });
export const messagesStateSchema = object({
  account: messagesAccountSchema, preferences: messagesPreferencesSchema,
  blockedAddresses: array(string(320, 1), 128), incomingFixtures: array(identity, 128), knownSenders: array(string(320, 1), 128),
  conversations: array(object({ id: identity, name: string(256, 1), initials: string(32, 1), tint,
    portrait: nullable(string(128, 1)), timestamp, timeLabel: string(128), pinned: flag, unread: flag,
    participants: array(string(320, 1), 128), items: array(messageItemSchema), dnd: flag, left: flag, location: nullable(messageLocationSchema),
    shareApproved: flag, background: nullable(messageAttachmentSchema),
  })),
  selectedConversationId: nullable(identity), selectedMessageId: nullable(identity), query: string(4096), unreadOnly: flag,
  timeBase: timestamp, nextId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER - 1 },
  drafts: array(messageDraftSchema, 128), selectedDraftId: nullable(identity),
});

const textItem = (text, direction = 'incoming', extra = {}) => ({ kind: 'text', direction, text, ...extra });
const identifyItems = (items, time) => items.map((item, index) => ({ id: `message-${index + 1}`, timestamp: time - (items.length - index - 1) * 60_000, ...item }));
const avatarInitials = name => name.split(/\s+/u).slice(0, 2).map(part => part[0]).join('').toUpperCase();

function classicFixture(profile) {
  const highSierra = profile.renderer === 'high-sierra';
  const time = highSierra ? Date.UTC(2017, 8, 25, 9, 41) : profile.renderer === 'sonoma' ? Date.UTC(2023, 8, 26, 9, 41) : Date.UTC(2018, 8, 24, 9, 41);
  const sample = highSierra ? highSierraConversations : mojaveConversations;
  const hero = highSierra ? [
    { kind: 'image', direction: 'incoming', asset: 'miami-beach.png', label: 'People enjoying Miami Beach beside the ocean' },
    textItem('Miami was amazing!'),
    { kind: 'image', direction: 'incoming', asset: 'euna-photo.png', label: 'Euna in a yellow scarf in the sunshine' },
    textItem('I want to go!', 'outgoing', { delivery: 'Delivered' }),
  ] : [
    { kind: 'image', direction: 'incoming', asset: 'silhouette-photo.png', label: 'A woman silhouetted against a sunset' },
    textItem('I love it! You’re a great\nphotographer.', 'outgoing'),
    textItem('Thanks! I’ll be posting the rest\nsoon.'),
    textItem('Hey, we are planning a camping\ntrip next month. You should\ncome!'),
    { kind: 'emoji', direction: 'outgoing', assets: [{ asset: 'grinning-face.png', label: 'Grinning face' }, { asset: 'camping.png', label: 'Camping' }, { asset: 'national-park.png', label: 'National park' }] },
    textItem('I’m there!', 'outgoing', { delivery: 'Delivered' }),
  ];
  const day = Math.floor(time / 86_400_000) * 86_400_000;
  return sample.map((row, index) => {
    const parts = row.time === 'Yesterday' ? null : /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(row.time);
    const timestamp = parts ? day + ((Number(parts[1]) % 12 + (parts[3] === 'PM' ? 12 : 0)) * 60 + Number(parts[2])) * 60_000 : time - 86_400_000;
    return {
      id: `conversation-${index + 1}`, name: row.name, initials: avatarInitials(row.name), tint: '#8b9eac', portrait: row.portrait,
      timestamp, timeLabel: row.time, pinned: false, unread: false, participants: [row.name],
      items: identifyItems(index === 0 ? hero : [textItem(row.preview.join('\n'), 'incoming', row.emoji ? { emoji: { ...row.emoji } } : {})], timestamp),
    };
  });
}

function goldenFixture(profile) {
  const time = Date.parse(profile.defaults.sceneTime);
  const row = (id, name, initials, tint, offset, items, pinned = false, participants = [name]) => ({
    id, name, initials, tint, portrait: null, timestamp: time - offset, timeLabel: '', pinned, unread: false,
    participants, items: identifyItems(items, time - offset),
  });
  return [
    row('casey', 'Casey', 'CR', '#d39a72', 12 * 60_000, [], true, ['Casey Rivera']),
    row('studio', 'Studio', 'ST', '#7d99ac', 15 * 60_000, [], true, ['Studio team']),
    row('trail-crew', 'Trail Crew', 'TC', '#789d82', 0, [
      textItem('Morning! Where are we meeting?', 'outgoing'),
      textItem('At the trailhead by the coast. I made a little sketch of the route.', 'incoming', { sender: 'Casey Rivera' }),
      { kind: 'trail', direction: 'incoming', sender: 'Casey Rivera' },
      textItem('I’ll bring the picnic. See you at ten!', 'incoming', { sender: 'Jordan Lee' }),
      textItem('Perfect. See you both there!', 'outgoing', { delivery: 'Delivered · sample' }),
    ], true, ['Casey Rivera', 'Jordan Lee']),
    row('jordan', 'Jordan Lee', 'JL', '#a49ab7', 9 * 60_000, [textItem('The sketches look great. See you later!')]),
    row('morgan', 'Morgan Park', 'MP', '#b08f77', 23 * 60_000, [textItem('I left the book by your desk.')]),
    row('weekend-plans', 'Weekend Plans', 'WP', '#8ca3b9', 28 * 3_600_000, [textItem('Let’s meet at the café on Saturday.')]),
    row('sam', 'Sam Rivera', 'SR', '#9baa81', 32 * 3_600_000, [textItem('Thanks for the recommendation!')]),
  ];
}

const windowsTime = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' });
function windowsFixture(profile) {
  const time = Date.parse(profile.defaults.sceneTime);
  const row = (id, name, initials, tint, offset, items, unread = false, participants = [name]) => ({
    id, name, initials, tint, portrait: null, timestamp: time - offset, timeLabel: offset < 86_400_000 ? windowsTime.format(time - offset) : 'Yesterday',
    pinned: false, unread, participants, items: identifyItems(items, time - offset),
  });
  return [
    row('teams-casey', 'Casey Rivera', 'CR', '#b1a5d7', 0, [
      textItem('Can you look over the updated route?'),
      textItem('Sure. I’ll check the trailhead and send you my notes.', 'outgoing', { delivery: 'Sent' }),
      textItem('Thanks! The north entrance opens at ten.'),
    ], true),
    row('teams-trail-crew', 'Trail Crew', 'TC', '#89ab94', 18 * 60_000, [
      textItem('Morning! Where are we meeting?', 'outgoing'),
      textItem('At the trailhead by the coast.', 'incoming', { sender: 'Casey Rivera' }),
      textItem('I’ll bring the picnic.', 'incoming', { sender: 'Jordan Lee' }),
    ], true, ['Casey Rivera', 'Jordan Lee']),
    row('teams-jordan', 'Jordan Lee', 'JL', '#a6bad7', 32 * 60_000, [textItem('The sketches look great. See you later!')]),
    row('teams-sam', 'Sam Rivera', 'SR', '#c6ab8b', 28 * 3_600_000, [textItem('Thanks for the recommendation!')], true),
    row('teams-morgan', 'Morgan Park', 'MP', '#c5a5b9', 32 * 3_600_000, []),
  ];
}

export function createMessagesState(profile) {
  const conversations = profile.renderer === 'golden-gate' ? goldenFixture(profile) : profile.family === 'macos' ? classicFixture(profile) : windowsFixture(profile);
  for (const conversation of conversations) { conversation.dnd = false; conversation.left = false; conversation.location = null; conversation.shareApproved = false; conversation.background = null; }
  const selectedConversationId = profile.renderer === 'golden-gate' ? 'trail-crew' : conversations[0]?.id ?? null;
  const drafts = conversations.map(row => ({ id: `draft-${row.id}`, kind: 'message', conversationId: row.id,
    createdAt: row.timestamp, updatedAt: row.timestamp, revision: 1, fields: { to: row.participants.join(', '), body: '' }, attachments: [] }));
  const name = profile.defaults.accountName ?? 'Alex Morgan';
  return { account: { name, initials: avatarInitials(name), address: 'alex.morgan@jester.local', signedIn: true, enabled: true, readReceipts: true, status: 'Available', photo: null },
    preferences: { playSounds: true, showPreviews: true, saveHistory: true, textSize: 13, keepMessages: 'forever',
      saveClosedHistory: true, notifyUnknownContacts: true, notifyMentions: true, receivedSound: 'glass-study',
      receivedFilesFolderId: 'downloads', screenUnknownSenders: false, filterSpam: false, shareNamePhoto: false,
      shareAutomatically: 'contacts', autoPlayEffects: true, allowBackgrounds: true, sharedAutomatic: false, sharedApps: [] },
    blockedAddresses: [], incomingFixtures: [], knownSenders: [],
    conversations, selectedConversationId, selectedMessageId: null, query: '', unreadOnly: false,
    timeBase: Math.max(Date.parse(profile.defaults.sceneTime), ...conversations.map(row => row.timestamp)), nextId: 1,
    drafts, selectedDraftId: drafts.find(draft => draft.conversationId === selectedConversationId)?.id ?? null };
}

// Saving is a projection, never a mutation of histories held by native windows.
// Retain original thread/draft ownership while honoring the local history choice.
export function messagesForPersistence(state) {
  const saved = copyCanonicalData(state);
  if (!saved.preferences.saveHistory) {
    for (const conversation of saved.conversations) conversation.items.splice(0);
    saved.selectedMessageId = null;
  }
  return saved;
}

export function messagePreferenceAvailable(profile, key) {
  if (['playSounds', 'showPreviews', 'saveHistory', 'textSize', 'receivedSound'].includes(key)) return true;
  if (profile.family !== 'macos') return false;
  if (['keepMessages', 'notifyMentions'].includes(key)) return true;
  if (['saveClosedHistory', 'receivedFilesFolderId'].includes(key)) return ['high-sierra', 'mojave'].includes(profile.renderer);
  if (key === 'notifyUnknownContacts') return profile.renderer !== 'golden-gate';
  if (['shareNamePhoto', 'shareAutomatically', 'autoPlayEffects', 'sharedAutomatic', 'sharedApps'].includes(key)) return ['sonoma', 'golden-gate'].includes(profile.renderer);
  return ['screenUnknownSenders', 'filterSpam', 'allowBackgrounds'].includes(key) && profile.renderer === 'golden-gate';
}

// Scene-authored calendar only. A year is a calendar year, with leap day clamped.
export function messagesRetentionCutoff(time, policy) {
  if (policy === 'forever') return 0;
  if (policy === '30days') return Math.max(0, time - 30 * 86_400_000);
  const date = new Date(time), month = date.getUTCMonth(), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCFullYear(date.getUTCFullYear() - 1);
  const last = new Date(date.getTime()); last.setUTCMonth(month + 1, 0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return Math.max(0, date.getTime());
}

// Mutate only the supplied candidate; Root commits with its existing quota/clock
// lease. Empty conversation shells and unsent drafts survive message expiry.
export function expireMessages(state, time) {
  if (!Number.isSafeInteger(time) || time < state.timeBase || time > timestamp.maximum) return 0;
  const cutoff = messagesRetentionCutoff(time, state.preferences.keepMessages);
  let removed = 0;
  for (const conversation of state.conversations) {
    const retained = conversation.items.filter(item => item.timestamp >= cutoff);
    removed += conversation.items.length - retained.length;
    if (retained.length !== conversation.items.length) conversation.items.splice(0, conversation.items.length, ...retained);
  }
  const selected = selectedMessageConversation(state);
  if (state.selectedMessageId && !selected?.items.some(item => item.id === state.selectedMessageId)) state.selectedMessageId = null;
  return removed;
}

export function messageIncomingPolicy(state, conversation, sender, text, contactKnown, profile) {
  const endpoint = recipientIdentity(sender);
  const explicitlyKnown = contactKnown || state.knownSenders.some(value => recipientIdentity(value) === endpoint);
  const priorIncoming = conversation.items.some(item => item.direction === 'incoming' && !item.screened
    && recipientIdentity(item.sender ?? conversation.participants[0]) === endpoint);
  const screened = profile.renderer === 'golden-gate' && state.preferences.screenUnknownSenders && !explicitlyKnown;
  // Explicitly local, deterministic spam counterpart, never a carrier classifier.
  const spam = profile.renderer === 'golden-gate' && state.preferences.filterSpam && !explicitlyKnown
    && typeof text === 'string' && /\b(?:claim your prize|send gift cards|wire money now)\b/iu.test(text);
  const mention = typeof text === 'string' && state.account.name.split(/\s+/u).some(name => name.length > 1
    && text.normalize('NFKC').toLocaleLowerCase('en-US').split(/[^\p{L}\p{N}_]+/u).includes(name.normalize('NFKC').toLocaleLowerCase('en-US')));
  const mentionAlert = state.preferences.notifyMentions && mention;
  const unknownSuppressed = profile.renderer !== 'golden-gate' && !state.preferences.notifyUnknownContacts && !explicitlyKnown && !priorIncoming;
  return { screened, spam, notify: !screened && !spam && state.account.status !== 'Do not disturb'
    && (!conversation.dnd || mentionAlert) && (!unknownSuppressed || mentionAlert), mention };
}

export function messageOutgoingProfile(state, conversation, contactKnown) {
  if (!state.preferences.shareNamePhoto || (state.preferences.shareAutomatically === 'contacts'
    ? !contactKnown : !conversation.shareApproved)) return null;
  return { name: state.account.name, photo: state.account.photo ? copyCanonicalData(state.account.photo) : null };
}

export function messageSharedContent(state, contactEndpoints, appId) {
  if (!state.preferences.sharedAutomatic || !state.preferences.sharedApps.includes(appId)) return [];
  const known = new Set(contactEndpoints.map(recipientIdentity));
  return state.conversations.flatMap(conversation => conversation.items.flatMap(item => {
    if (item.direction !== 'incoming' || item.screened || item.spam
      || !known.has(recipientIdentity(item.sender ?? conversation.participants[0]))) return [];
    const owner = { conversationId: conversation.id, messageId: item.id, conversationName: conversation.name };
    if (appId === 'safari' && item.kind === 'text') return [...item.text.matchAll(/https?:\/\/[^\s<>"']+/gu)]
      .map((match, index) => ({ ...owner, id: `${conversation.id}:${item.id}:url:${index}`, url: match[0], label: match[0], appId }));
    return (item.attachments ?? []).filter(attachment => appId === 'photos' ? attachment.kind === 'image' : appId === 'finder')
      .map(attachment => ({ ...owner, id: `${conversation.id}:${item.id}:${attachment.id}`, attachmentId: attachment.id, label: attachment.name, appId }));
  }));
}

export function markMessagesRead(state, conversation, time) {
  if (!state.account.signedIn || !state.account.enabled || !state.account.readReceipts
    || !Number.isSafeInteger(time) || time < 0 || time > timestamp.maximum) return 0;
  const authoredTime = Math.max(state.timeBase, time);
  let count = 0;
  for (const item of conversation.items) if (item.direction === 'incoming' && !item.screened && !item.spam && item.readReceiptAt === undefined) {
    item.readReceiptAt = authoredTime; count++;
  }
  if (count) state.timeBase = authoredTime;
  return count;
}

export function selectedMessageConversation(state) {
  return state.conversations.find(row => row.id === state.selectedConversationId) ?? null;
}

export function messagePreview(conversation) {
  const last = conversation.items.at(-1);
  if (!last) return { lines: [], emoji: null };
  if (last.kind === 'text') return { lines: last.text ? last.text.split('\n') : last.attachments?.map(a => a.kind === 'audio' ? 'Audio message' : a.name) ?? [], emoji: last.emoji ?? null };
  return { lines: [last.kind === 'emoji' ? last.assets.map(asset => asset.label).join(', ') : 'Photo'], emoji: null };
}

// Literal search, not a regular expression. Unicode normalization is deliberately
// shared by contact, conversation and body matching; queries never execute code.
const fold = text => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
let searchSegmenter;
const whitespace = /\s/u;
export function messageSearchSegments(text, query) {
  const needle = fold(query);
  if (!needle) return [{ text, match: false }];
  const normalized = fold(text);
  let matchStart = normalized.indexOf(needle);
  if (matchStart < 0) return [{ text, match: false }];
  searchSegmenter ??= new Intl.Segmenter('en-US', { granularity: 'grapheme' });
  const pieces = [];
  let matchEnd = matchStart + needle.length, sourceStart = null, offset = 0, position = 0, space = false;
  outer: for (const { segment, index } of searchSegmenter.segment(text)) {
    // Count folded code units without breaking original graphemes or allocating
    // a full-text offset map. Whole-string folding preserves contextual casing.
    const value = segment.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-US');
    for (const character of value) {
      let width = character.length;
      if (whitespace.test(character)) {
        if (!position || space) continue;
        space = true; width = 1;
      } else space = false;
      if (sourceStart === null && position + width > matchStart) sourceStart = index;
      position += width;
      if (position < matchEnd) continue;
      const end = index + segment.length;
      if (sourceStart > offset) pieces.push({ text: text.slice(offset, sourceStart), match: false });
      if (sourceStart <= offset && pieces.at(-1)?.match) pieces.at(-1).text += text.slice(offset, end);
      else pieces.push({ text: text.slice(Math.max(offset, sourceStart), end), match: true });
      offset = end;
      matchStart = normalized.indexOf(needle, matchEnd);
      if (matchStart < 0) break outer;
      matchEnd = matchStart + needle.length; sourceStart = null;
    }
  }
  if (offset < text.length) pieces.push({ text: text.slice(offset), match: false });
  return pieces;
}

export function messageSearchResults(state, { scope = 'all', conversationId = null, historySince = 0 } = {}) {
  const query = fold(state.query);
  return state.conversations.flatMap(conversation => {
    if (state.unreadOnly && !conversation.unread || scope === 'history' && conversation.id !== conversationId) return [];
    const conversationMatch = scope !== 'history' && (!query || fold(conversation.name).includes(query));
    const contactMatch = scope !== 'history' && query && conversation.participants.some(name => fold(name).includes(query));
    const messageIds = query && scope !== 'names' ? conversation.items.filter(item => item.kind === 'text'
      && item.timestamp >= historySince && fold(item.text).includes(query)).map(item => item.id) : [];
    return conversationMatch || contactMatch || messageIds.length ? [{ conversation, messageIds, conversationMatch, contactMatch: Boolean(contactMatch) }] : [];
  });
}

// Teams personal's documented history search is bounded to six calendar months.
// Clamp month-end dates rather than letting April 31 roll forward to May 1.
export function messagesHistoryCutoff(sceneTime) {
  const date = new Date(sceneTime), day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 6);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, date.getUTCDate()));
  return Math.max(0, date.getTime());
}

export function selectMessageConversation(state, conversationId, messageId = null) {
  const conversation = state.conversations.find(row => row.id === conversationId);
  if (!conversation || messageId !== null && !conversation.items.some(item => item.id === messageId)) return false;
  state.selectedConversationId = conversation.id;
  state.selectedMessageId = messageId;
  state.selectedDraftId = state.drafts.find(draft => draft.conversationId === conversation.id)?.id ?? null;
  conversation.unread = false;
  return true;
}

const referenceHistories = new Map();
const sameEmoji = (a, b) => !a && !b || a && b && a.image === b.image && a.label === b.label
  && a.line === b.line && Boolean(a.before) === Boolean(b.before);
function sameReferenceItem(item, reference) {
  return ['kind', 'direction', 'text', 'sender', 'delivery', 'asset', 'label'].every(key => item[key] === reference[key])
    && sameEmoji(item.emoji, reference.emoji)
    && (!item.assets && !reference.assets || item.assets && reference.assets && item.assets.length === reference.assets.length
      && item.assets.every((asset, index) => asset.asset === reference.assets[index].asset && asset.label === reference.assets[index].label));
}

// Preserve measured reference positioning only for the original, exact content.
// Authored/replaced/edited histories use normal flow and cannot borrow hero pixels.
export function isReferenceMessageConversation(conversation, profile) {
  if (!conversation || profile.family !== 'macos' || profile.renderer === 'golden-gate') return false;
  if (!referenceHistories.has(profile.id)) referenceHistories.set(profile.id, classicFixture(profile)[0]);
  const reference = referenceHistories.get(profile.id);
  return conversation.name === reference.name && conversation.items.length === reference.items.length
    && conversation.items.every((item, index) => sameReferenceItem(item, reference.items[index]));
}

export function validateMessagesState(state, profile) {
  const ids = state.conversations.map(row => row.id);
  if (new Set(ids).size !== ids.length) return { ok: false, message: 'Messages conversation IDs must be unique.' };
  const selected = selectedMessageConversation(state);
  if (state.selectedConversationId !== null && !selected || state.selectedMessageId !== null && !selected?.items.some(item => item.id === state.selectedMessageId))
    return { ok: false, message: 'Messages selection must refer to an existing conversation and its own message.' };
  if (!Number.isSafeInteger(state.timeBase) || state.timeBase < 0 || state.timeBase > timestamp.maximum
    || !Number.isSafeInteger(state.nextId) || state.nextId < 1 || state.nextId > Number.MAX_SAFE_INTEGER - 1)
    return { ok: false, message: 'Messages requires bounded authored clock and identity counters.' };
  const validMedia = media => Array.isArray(media) && media.length <= 16 && media.every(validMessageAttachment)
    && new Set(media.map(a => a.id)).size === media.length;
  const preferences = state.preferences;
  if (typeof state.account.enabled !== 'boolean' || typeof state.account.readReceipts !== 'boolean')
    return { ok: false, message: 'The original local account requires explicit enable and read-receipt policy.' };
  if (!preferences || ['playSounds', 'showPreviews', 'saveHistory', 'saveClosedHistory', 'notifyUnknownContacts', 'notifyMentions', 'screenUnknownSenders', 'filterSpam', 'shareNamePhoto', 'autoPlayEffects', 'allowBackgrounds', 'sharedAutomatic'].some(key => typeof preferences[key] !== 'boolean')
    || !Number.isSafeInteger(preferences.textSize) || preferences.textSize < 10 || preferences.textSize > 24
    || !['forever', '30days', '1year'].includes(preferences.keepMessages)
    || !['none', 'glass-study', 'golden-arpeggio'].includes(preferences.receivedSound)
    || !['contacts', 'ask'].includes(preferences.shareAutomatically)
    || !Array.isArray(preferences.sharedApps) || preferences.sharedApps.length > 3
    || preferences.sharedApps.some(app => !['safari', 'photos', 'finder'].includes(app)) || new Set(preferences.sharedApps).size !== preferences.sharedApps.length
    || !['sonoma', 'golden-gate'].includes(profile.renderer) && (preferences.shareNamePhoto || preferences.sharedAutomatic || preferences.sharedApps.length > 0 || preferences.shareAutomatically !== 'contacts')
    || profile.renderer !== 'golden-gate' && (preferences.filterSpam || !preferences.allowBackgrounds)
    || state.account.photo !== null && (!validMessageAttachment(state.account.photo) || state.account.photo.kind !== 'image')
    || typeof preferences.receivedFilesFolderId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(preferences.receivedFilesFolderId)
    || !Array.isArray(state.knownSenders) || state.knownSenders.length > 128
    || state.knownSenders.some(value => typeof value !== 'string' || value.length > 320 || !recipientIdentity(value))
    || new Set(state.knownSenders.map(recipientIdentity)).size !== state.knownSenders.length
    || preferences.screenUnknownSenders && profile.renderer !== 'golden-gate'
    || profile.family !== 'macos' && preferences.keepMessages !== 'forever'
    || !['high-sierra', 'mojave'].includes(profile.renderer) && (!preferences.saveClosedHistory || preferences.receivedFilesFolderId !== 'downloads')
    || profile.renderer !== 'golden-gate' && state.knownSenders.length > 0
    || !Array.isArray(state.blockedAddresses) || state.blockedAddresses.length > 128
    || state.blockedAddresses.some(address => typeof address !== 'string' || address.length > 320 || !recipientIdentity(address))
    || new Set(state.blockedAddresses.map(recipientIdentity)).size !== state.blockedAddresses.length
    || !Array.isArray(state.incomingFixtures) || state.incomingFixtures.length > 128
    || new Set(state.incomingFixtures).size !== state.incomingFixtures.length)
    return { ok: false, message: 'Messages preferences, blocked endpoints and incoming fixture ledger must retain canonical bounded values.' };
  const draftIds = new Set(), draftConversations = new Set(), allocations = new Set();
  const allocation = id => {
    if (!/^authored-(?:draft|conversation|message)-/u.test(id)) return true;
    const number = Number(id.slice(id.lastIndexOf('-') + 1));
    if (!Number.isSafeInteger(number) || number < 1 || number >= state.nextId || allocations.has(number)) return false;
    allocations.add(number); return true;
  };
  for (const draft of state.drafts) {
    if (draftIds.has(draft.id) || !allocation(draft.id) || draft.createdAt > draft.updatedAt || draft.updatedAt > state.timeBase
      || !validMedia(draft.attachments) || draft.conversationId !== null && (!ids.includes(draft.conversationId) || draftConversations.has(draft.conversationId)))
      return { ok: false, message: 'Drafts must retain unique identities, timestamps and original conversation ownership.' };
    draftIds.add(draft.id);
    if (draft.conversationId !== null) draftConversations.add(draft.conversationId);
  }
  const selectedDraft = state.drafts.find(draft => draft.id === state.selectedDraftId);
  if (state.selectedDraftId !== null && (!selectedDraft || selectedDraft.conversationId !== state.selectedConversationId))
    return { ok: false, message: 'The selected Messages draft must belong to the selected conversation or new composer.' };
  if (state.unreadOnly && !['sonoma', 'golden-gate'].includes(profile.renderer))
    return { ok: false, message: 'This macOS version does not provide the modern unread filter.' };
  const portraits = new Set(profile.family === 'windows' ? [] : (profile.renderer === 'high-sierra' ? highSierraConversations : mojaveConversations).map(row => row.portrait));
  const localAssets = new Set(profile.family === 'windows' ? [] : profile.renderer === 'high-sierra' ? ['miami-beach.png', 'euna-photo.png']
    : ['silhouette-photo.png', 'grinning-face.png', 'camping.png', 'national-park.png', 'sleeping.png', 'thumbs-up.png']);
  for (const row of state.conversations) {
    if (!Array.isArray(row.participants) || !row.participants.length || row.participants.length > 128
      || row.participants.some(address => typeof address !== 'string' || address.length > 320 || !recipientIdentity(address))
      || new Set(row.participants.map(recipientIdentity)).size !== row.participants.length)
      return { ok: false, message: 'Messages participants require unique normalized fictional endpoints.' };
    if (typeof row.dnd !== 'boolean' || typeof row.left !== 'boolean' || row.location !== null && (!row.location
      || typeof row.location.label !== 'string' || !row.location.label.length || row.location.label.length > 256
      || !Number.isFinite(row.location.latitude) || Math.abs(row.location.latitude) > 90
      || !Number.isFinite(row.location.longitude) || Math.abs(row.location.longitude) > 180
      || !Number.isSafeInteger(row.location.sharedAt) || row.location.sharedAt < 0 || row.location.sharedAt > state.timeBase))
      return { ok: false, message: 'Messages conversation membership, mute state and fictional location must be canonical.' };
    if (typeof row.shareApproved !== 'boolean' || row.background !== null && (!validMessageAttachment(row.background)
      || row.background.kind !== 'image' || profile.renderer !== 'golden-gate')
      || row.items.some(item => item.spam !== undefined && (typeof item.spam !== 'boolean' || profile.renderer !== 'golden-gate' || item.direction !== 'incoming')
        || item.effect !== undefined && (item.effect !== 'celebration' || !['sonoma', 'golden-gate'].includes(profile.renderer))
        || item.readReceiptAt !== undefined && (item.direction !== 'incoming' || !Number.isSafeInteger(item.readReceiptAt)
          || item.readReceiptAt < item.timestamp || item.readReceiptAt > state.timeBase)
        || item.profile !== undefined && (!['sonoma', 'golden-gate'].includes(profile.renderer) || item.direction !== 'outgoing'
          || typeof item.profile.name !== 'string' || !item.profile.name.length || item.profile.name.length > 256
          || item.profile.photo !== null && (!validMessageAttachment(item.profile.photo) || item.profile.photo.kind !== 'image'))))
      return { ok: false, message: 'Native-era local profile sharing, effects, backgrounds and spam records must retain genuine canonical content.' };
    if (row.items.some(item => item.screened !== undefined && (typeof item.screened !== 'boolean'
      || profile.renderer !== 'golden-gate' || item.direction !== 'incoming')))
      return { ok: false, message: 'Screened incoming records belong only to the qualified Golden Gate profile.' };
    if (row.items.some(item => item.attachments !== undefined && !validMedia(item.attachments)
      || item.reactions !== undefined && (!Array.isArray(item.reactions) || item.reactions.length > 128
        || item.reactions.some(reaction => !validMessageReactionEmoji(reaction.emoji, profile)
          || typeof reaction.participant !== 'string' || !recipientIdentity(reaction.participant))
        || new Set(item.reactions.map(reaction => recipientIdentity(reaction.participant))).size !== item.reactions.length)))
      return { ok: false, message: 'Messages media retains actual byte snapshots and one supported reaction per participant.' };
    if (row.timestamp > state.timeBase || !allocation(row.id) || row.items.some(item => !allocation(item.id)
      || item.deliveryStatus !== undefined && (item.direction !== 'outgoing' || !item.id.startsWith('authored-message-'))))
      return { ok: false, message: 'Authored Messages history must retain its bounded clock, unique allocations and outgoing delivery owner.' };
    if (row.portrait !== null && (!portraits.has(row.portrait) || profile.renderer === 'golden-gate'))
      return { ok: false, message: 'Messages portraits must belong to this profile’s local fixture.' };
    if (new Set(row.items.map(item => item.id)).size !== row.items.length)
      return { ok: false, message: 'Message IDs must be unique within their original conversation.' };
    if (row.items.some(item => item.timestamp > row.timestamp))
      return { ok: false, message: 'A message cannot be newer than its conversation’s latest-message timestamp.' };
    if (row.items.some(item => item.kind === 'trail' && profile.renderer !== 'golden-gate'))
      return { ok: false, message: 'The original trail artwork belongs only to the Golden Gate fixture.' };
    if (row.items.some(item => item.kind === 'image' && !localAssets.has(item.asset)
      || item.kind === 'emoji' && item.assets.some(asset => !localAssets.has(asset.asset))
      || item.kind === 'text' && item.emoji && !localAssets.has(item.emoji.image)))
      return { ok: false, message: 'Messages media must belong to this profile’s existing local assets.' };
  }
  return { ok: true };
}

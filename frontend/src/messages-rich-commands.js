import { messagePreferencePanes } from './messages-preference-navigation.js';
import { rejected, isRecord } from './feature-commands.js';
import { defineCommand, object, empty, identity, flag, choice, NONE } from './command-schema.js';
import { copyCanonicalData, applyCanonicalData, canonicalStringUnits } from './canonical-data.js';
import { validateMessagesState, messagePreferenceAvailable, expireMessages, messageIncomingPolicy, messageSharedContent, markMessagesRead } from './messages-state.js';
import { messageDraft, validMessageDraftField, validMessageAttachment, copyMessageAttachment, setMessageDraftAttachments, changeMessageDraft, validMessageReactionEmoji } from './messages-composition.js';
import { recipientIdentity, messageRecipient } from './messages-recipients.js';
import { validateDestinationDocument } from './document-destination-codec.js';
import { AUDIO_FIXTURES } from './audio-fixtures.js';
import { PREVIEW_IMAGE_CONTENT, PREVIEW_IMAGE_MIME } from './preview-image-fixture.js';
import { applicationFileMime } from './application-file-bridges.js';
import { bytesFromFile } from './disk-image-codec.js';

export const MESSAGE_TAPBACKS = Object.freeze(['❤️', '👍', '👎', '😂', '‼️', '❓']);
export const TEAMS_REACTION_QUICK_SET = Object.freeze(['👍', '❤️', '😂', '😮', '😢', '😠']);
export const MESSAGE_INCOMING_FIXTURES = Object.freeze([
  Object.freeze({ id: 'trailhead-update', label: 'Trailhead update', text: 'The north trailhead is open. I’ll meet you by the map board.' }),
  Object.freeze({ id: 'harbor-map-arrival', label: 'Harbor map arrival', text: 'Here is the harbor map we used last weekend.', image: true }),
  Object.freeze({ id: 'glass-study-audio', label: 'Glass study audio', text: 'An original eight-second Glass Study clip.', audio: true }),
  Object.freeze({ id: 'local-spam-review', label: 'Local spam review', text: 'Claim your prize: send gift cards.', renderers: ['golden-gate'] }),
  Object.freeze({ id: 'celebration-effect', label: 'Local celebration effect', text: 'Alex, congratulations on the trail!', effect: 'celebration', renderers: ['sonoma', 'golden-gate'] }),
  Object.freeze({ id: 'shared-trail-link', label: 'Shared local trail guide', text: 'The local trail guide: https://jester.local/trails', renderers: ['sonoma', 'golden-gate'] }),
]);
const profiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
const MAX_TIME = 8_640_000_000_000_000 - 1, MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1;
const windowTarget = object({ windowId: identity });
const conversationTarget = object({ windowId: identity, conversationId: identity });
const draftTarget = object({ windowId: identity, draftId: identity });
const messageTarget = object({ windowId: identity, conversationId: identity, messageId: identity });
const attachmentTarget = object({ windowId: identity, conversationId: identity, messageId: identity, attachmentId: identity });
const boundedText = maxLength => ({ type: 'string', maxLength });
const location = object({ label: { type: 'string', minLength: 1, maxLength: 256 }, latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 } });
const requires = ['The original installed native messaging window, mounted view and complete canonical domain must remain available until the commit.',
  'Fictional local account, Files, clipboard and notifications only. No host files, microphone, account service, GPS or remote transport. Missing real bridges reject.'];
const define = (name, target, payload, presentation, data = NONE, result = target) =>
  defineCommand(profiles, name, 'messages.conversations', target, payload, requires, presentation, data, NONE, result);
const revisionResult = extra => object({ windowId: identity, draftId: identity, revision: { type: 'integer', minimum: 1 }, ...extra });
export const messagesRichCatalog = Object.fromEntries([
  define('messages.preferences.navigate', windowTarget, object({ pane: choice('general', 'account', 'sharing', 'appearance', 'notifications'), section: choice('settings', 'blocked') }, ['pane']),
    ['Select a release-available pane in the original open Preferences/Settings panel and focus its actual tab. Account sections are Settings/Blocked. Navigation is transient and leaves all canonical messages/preferences unchanged.']),
  define('messages.preferences.set', windowTarget, object({ key: choice('playSounds', 'showPreviews', 'saveHistory', 'textSize', 'keepMessages', 'saveClosedHistory', 'notifyUnknownContacts', 'notifyMentions', 'receivedSound', 'receivedFilesFolderId', 'screenUnknownSenders', 'filterSpam', 'shareNamePhoto', 'shareAutomatically', 'autoPlayEffects', 'allowBackgrounds', 'sharedAutomatic', 'sharedApps'), value: { anyOf: [flag, { type: 'integer', minimum: 10, maximum: 24 }, { type: 'string', minLength: 1, maxLength: 128 }, { type: 'array', items: choice('safari', 'photos', 'finder'), maxItems: 3, uniqueItems: true }] }, confirmed: { const: true }, expectedTime: { type: 'integer', minimum: 0, maximum: MAX_TIME } }, ['key', 'value']),
    ['Set a release-gated original preference. Finite Keep messages requires confirmed:true and immediately expires old message/attachment records at the original authored scene epoch. Window close and quit never mean conversation close. Saved-scene history and previews remain labeled local privacy extensions. Sound choices are genuine JesterOS-original WAV counterparts, not redistributed Apple alerts.'], ['messages.preferences', 'messages.conversations.items', 'messages.selectedMessageId']),
  define('messages.preferences.sound.preview', windowTarget, empty,
    ['Play the selected genuine licensed local WAV in the original mounted Messages audio node. Browser playback refusal is an actual error, not a successful fake preview.']),
  define('messages.account.rename', windowTarget, object({ name: { type: 'string', minLength: 1, maxLength: 256 } }),
    ['Change the original fictional account display name and initials. This is the local name-sharing setup equivalent; no remote profile or photo library is operated.'], ['messages.account.name', 'messages.account.initials']),
  define('messages.account.photo.set', windowTarget, object({ fileId: { anyOf: [identity, { type: 'null' }] } }, []),
    ['Choose an original Files image and retain its validated immutable bytes as the fictional local account photo. Null removes only the local photo.'], ['messages.account.photo']),
  define('messages.conversation.background.set', conversationTarget, object({ fileId: { anyOf: [identity, { type: 'null' }] } }, []),
    ['Golden Gate only: choose genuine original Files image bytes as a local conversation background; no generated artwork or remote sharing.'], ['messages.conversations.background']),
  define('messages.conversation.profile.approve', conversationTarget, object({ approved: flag }),
    ['Modern Mac only: explicitly approve/withdraw name-and-photo sharing for this original local conversation when Always Ask is selected. Only future outgoing local records carry the genuine profile snapshot.'], ['messages.conversations.shareApproved']),
  define('messages.sharedContent.open', windowTarget, object({ appId: choice('safari', 'photos', 'finder'), contentId: { type: 'string', minLength: 1, maxLength: 512 } }),
    ['Open original Contacts-only Shared with You content in the existing Browser, Photos or Files actor. Disabled automatic/app sharing removes that content from this projection without deleting histories. Remote Apple sharing is not operated.']),
  define('messages.sender.markKnown', conversationTarget, empty,
    ['Golden Gate only: mark the original sender known and release their retained screened records into the original conversation. No Contacts record is fabricated.'], ['messages.knownSenders', 'messages.conversations.items']),
  define('messages.conversation.close', conversationTarget, object({ confirmed: { const: true } }, []),
    ['High Sierra/Mojave only: close an individual conversation, never its window. Save history when conversations are closed retains records; otherwise confirmed:true is required to remove the conversation and its owned draft.'], ['messages.conversations', 'messages.drafts', 'messages.selectedConversationId', 'messages.selectedDraftId']),
  define('messages.account.setSignedIn', windowTarget, object({ signedIn: flag, confirmed: { const: true } }, ['signedIn']),
    ['Sign in/out of the existing fictional account; signing out requires confirmed:true and disables send/arrival without discarding history. No credentials or remote account are operated.'], ['messages.account.signedIn']),
  define('messages.account.set', windowTarget, object({ key: choice('enabled', 'readReceipts'), value: flag }),
    ['Set the original fictional local account enable policy or authored local read-receipt policy, distinct from Sign Out. Enable this account is historical Mac-only; receipts never send to a remote service.'], ['messages.account']),
  define('messages.block.set', windowTarget, object({ address: { type: 'string', minLength: 1, maxLength: 320 }, blocked: flag }),
    ['Block/unblock the literal normalized endpoint in the single shared account. Existing history remains; blocked recipients cannot send/receive local events.'], ['messages.blockedAddresses']),
  define('messages.details.navigate', conversationTarget, object({ section: choice('summary', 'name', 'location', 'photos', 'files'), discard: { const: true } }, ['section']),
    ['Navigate the selected original open Details panel, opening its group-name or simulated-location editor or focusing its actual shared Photos/Files section. Navigation is transient; direct conversations have no group-name editor.']),
  define('messages.conversation.details', object({ windowId: identity, conversationId: identity }, ['windowId']), object({ panel: choice('details', 'preferences', 'account', 'help', 'delete', 'leave', 'emoji', 'attachments'), open: flag }, ['open']),
    ['Open/close the actual original native details, settings, account, Help, confirmation, emoji or file-transfer panel. Conversation-specific panels require the selected original conversation; emoji requires its actual draft. Panel presentation is transient and never another data owner.']),
  define('messages.conversation.print', conversationTarget, empty,
    ['Open the actual shared Print workflow with the original literal conversation transcript and attachment names; a shown sheet is not printed hardware output.']),
  define('messages.conversation.rename', conversationTarget, object({ name: { type: 'string', minLength: 1, maxLength: 256 } }),
    ['Rename the selected original local group, preserving the literal title. High Sierra/Mojave Details uses Add a group name; Sonoma and the qualified OS-27 guide use Group Name in Change Group Name and Photo. Teams Name group chat is qualified against living personal-package guidance. Direct conversations reject; real iMessage/Teams permissions and custom group photos are not inferred.'], ['messages.conversations.name']),
  define('messages.conversation.addParticipant', conversationTarget, object({ address: { type: 'string', minLength: 1, maxLength: 320 } }),
    ['Resolve the literal endpoint through actual fictional Contacts and add it to this local group conversation plus its owned draft recipients. Duplicates, self, blocked endpoints and collisions with another live thread are rejected; no transport is contacted.'], ['messages.conversations.participants', 'messages.drafts.fields', 'messages.timeBase']),
  define('messages.conversation.removeParticipant', conversationTarget, object({ address: { type: 'string', minLength: 1, maxLength: 320 }, confirmed: { const: true } }),
    ['Remove the exact existing endpoint from this local group after explicit confirmation, updating the owned draft recipients atomically. Below the documented iMessage three-other-member threshold this is a visibly qualified local equivalent.'], ['messages.conversations.participants', 'messages.drafts.fields', 'messages.timeBase']),
  define('messages.conversation.setDnd', conversationTarget, object({ enabled: flag }),
    ['Change only the selected original conversation’s Do Not Disturb (10.13/10.14), Hide Alerts (14.0/qualified OS-27) or Mute (qualified personal Teams) policy. The sole incoming-message authority still retains history while suppressing this conversation’s local notification; no remote silenced-status or mention override is fabricated.'], ['messages.conversations.dnd']),
  define('messages.conversation.leave', conversationTarget, object({ confirmed: { const: true } }),
    ['Leave the fictional local group after explicit confirmation, retaining its history and disabling future local send/arrival. Actual iMessage group size/transport restrictions and Teams server membership are not claimed.'], ['messages.conversations.left']),
  define('messages.conversation.delete', conversationTarget, object({ confirmed: { const: true } }),
    ['Permanently delete only the original local conversation and its drafts after explicit confirmation, repairing exact selected record references. No remote deletion or modern Recently Deleted is claimed.'], ['messages.conversations', 'messages.drafts', 'messages.selectedConversationId', 'messages.selectedMessageId', 'messages.selectedDraftId']),
  define('messages.location.set', conversationTarget, object({ location: { anyOf: [{ type: 'null' }, location] } }),
    ['Share/change/stop deterministic authored coordinates in the selected original local conversation, retaining its original location record and authored timestamp. The coordinate editor is visibly simulated: High Sierra/Mojave Mac Details only views device-shared locations; Sonoma/qualified OS-27 native sharing requires iCloud and Location Services; no exact 2023 desktop Teams location equivalent is verified. No GPS, map tiles, remote Maps/Find My, device tracking or transport.'], ['messages.conversations.location', 'messages.timeBase']),
  define('messages.draft.attach', draftTarget, object({ fileId: identity }, NONE),
    ['Choose an actual shared scene Files record (or use explicit fileId), validate real MIME/bytes, and retain the original ID/revision/content snapshot in the selected draft. No host chooser.'], ['messages.drafts.attachments', 'messages.drafts.revision', 'messages.timeBase'],
    revisionResult({ attachmentId: identity })),
  define('messages.draft.detach', draftTarget, object({ attachmentId: identity }),
    ['Remove exactly the selected draft’s original attachment. Shared source Files and sent message copies remain unchanged.'], ['messages.drafts.attachments', 'messages.drafts.revision', 'messages.timeBase'],
    revisionResult()),
  define('messages.draft.audio', draftTarget, empty,
    ['Attach the genuine eight-second JesterOS-original PCM WAV Glass Study, not a microphone recording or an invented voice message.'], ['messages.drafts.attachments', 'messages.drafts.revision', 'messages.timeBase'],
    revisionResult({ attachmentId: identity })),
  define('messages.draft.emoji', draftTarget, object({ value: { type: 'string', minLength: 1, maxLength: 64 } }),
    ['Insert exactly one literal emoji grapheme at the actual selected native draft caret, replacing its captured selection. This is not a reaction or fabricated host Character Viewer.'], ['messages.drafts.fields.body', 'messages.drafts.revision', 'messages.timeBase'],
    revisionResult()),
  define('messages.edit.copy', windowTarget, empty,
    ['Copy the exact original native search, recipient or body selection into the one actual scene clipboard. No navigator/host clipboard.']),
  define('messages.edit.cut', windowTarget, empty,
    ['Atomically copy and remove the original native search/recipient/body selection with a strict reserved clipboard onCommit.'], ['messages.query', 'messages.drafts.fields', 'messages.drafts.revision', 'messages.timeBase']),
  define('messages.edit.paste', windowTarget, empty,
    ['Paste the original scene clipboard’s literal text into the retained native search/recipient/body caret, or atomically append exact live clipboard Files to the original body draft after real media decoding. No host clipboard.'], ['messages.query', 'messages.drafts.fields', 'messages.drafts.attachments', 'messages.drafts.revision', 'messages.timeBase']),
  define('messages.edit.selectAll', windowTarget, empty,
    ['Select all in the original retained native search, recipient or draft body field.']),
  define('messages.edit.undo', windowTarget, empty,
    ['Undo the exact original field transition from bounded ephemeral history, authored by draft.set, search, emoji and clipboard edits. No browser/host undo is fabricated.'], ['messages.query', 'messages.drafts.fields']),
  define('messages.edit.redo', windowTarget, empty,
    ['Redo the exact original field transition; unrelated edits invalidate stale history instead of borrowing replacement records.'], ['messages.query', 'messages.drafts.fields']),
  define('messages.attachment.open', attachmentTarget, empty,
    ['Open the exact original Files revision if it still matches the retained bytes; otherwise use the genuine native Save As sheet to preserve retained bytes in a real selected scene File, then open it. Cancellation leaves original Files and Messages unchanged. No replacement source borrowing.']),
  define('messages.attachment.save', attachmentTarget, empty,
    ['Use the actual native Save As filename/folder sheet to create a shared scene File containing exact retained MIME and bytes. Original-name collisions require explicit original-revision Replace; cancellation leaves both original graphs unchanged. A real file acknowledgement remains applied after original presentation retirement.']),
  define('messages.attachment.preview', { oneOf: [
    object({ windowId: identity, draftId: identity, attachmentId: identity }), attachmentTarget,
  ] }, { anyOf: [object({ expanded: flag }), object({ page: { type: 'integer', minimum: 1, maximum: 10000 } }),
    object({ menuOpen: flag, point: object({ x: { type: 'number' }, y: { type: 'number' } }) }, ['menuOpen']),
    object({ playing: flag }), object({ time: { type: 'number', minimum: 0, maximum: 86400 } })] },
    ['Change the original mounted attachment context menu, image expansion, genuine PDF page or audio playback/seek without rewriting its bytes. Target the selected draft or the selected original conversation/message, never both. An open Details/Quick Look panel owns its own presentation. PDF pages and audio seeks must be decoded and in range; audio uses the actual original media element.']),
  define('messages.attachment.quickLook', attachmentTarget, object({ open: flag }, []),
    ['Open (default) or close the exact original retained-byte Quick Look panel using open:false. Display actual retained local image/audio/text/PDF bytes; conversation photo double-click is native even on High Sierra/Mojave, but historical Details opens the associated app instead. Teams Preview is an explicitly qualified local equivalent, not a verified 2023 Quick Look feature.']),
  define('messages.message.actions', messageTarget, object({ open: flag }),
    ['Open/close the original selected message action panel, focus its actual controls and preserve canonical history. The original message must remain in the selected conversation; other open panels are not dismissed implicitly.']),
  define('messages.message.react', messageTarget, object({ emoji: boundedText(64) }),
    ['Toggle/change this account endpoint’s one reaction using the version-appropriate native set: historical 10.13/10.14/14.0 keep exactly the six classic Tapbacks native since Sierra, while Golden Gate’s qualified book-26 reconstruction and Teams use genuine modern arbitrary emoji (Teams expanded reactions rollout disclosed).'], ['messages.conversations.items.reactions']),
  define('messages.message.copy', messageTarget, empty,
    ['Copy the original message’s literal text, or exact unchanged live attachment File IDs, into the actual scene clipboard. Retained-only binary media and historical illustration labels are not substituted with prose. No navigator/host clipboard.']),
  define('messages.message.delete', messageTarget, object({ confirmed: { const: true } }),
    ['Delete only the exact original local history item after explicit confirmation. This is not remote recall; keep source Files and repair selectedMessageId.'], ['messages.conversations.items', 'messages.selectedMessageId']),
  define('messages.incoming.receive', conversationTarget, object({ fixtureId: choice(...MESSAGE_INCOMING_FIXTURES.map(row => row.id)) }),
    ['Consume one deterministic original authored fixture into this conversation and atomically acknowledge its real shared notification. DND receives without a notification; signed-out/blocked/left refuses. Replay never duplicates a message or notification.'], ['messages.conversations', 'messages.incomingFixtures', 'messages.timeBase', 'messages.nextId', 'notifications.items'],
    object({ windowId: identity, conversationId: identity, messageId: identity })),
]);

function literal(value, required, optional = []) {
  if (!isRecord(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (required.some(key => !Object.hasOwn(descriptors, key)) || keys.some(key => typeof key !== 'string' || !required.includes(key) && !optional.includes(key)
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) return null;
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const applied = (target, extra = {}) => ({ status: 'applied', target, ...extra });
const invalid = () => rejected('invalid_arguments', 'Use the closed documented literal Messages target and payload.');
const stale = () => rejected('stale_target', 'The original messaging domain, window, view, record, contents or authored time changed.');
const unavailable = message => rejected('unavailable', message);
const disabled = message => rejected('disabled', message);
const capacity = message => rejected('limit_exceeded', message);
function identities(state) {
  const records = [];
  const visit = value => {
    records.push(value);
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  };
  visit(state);
  return records;
}
const sameIdentities = (before, after) => before.length === after.length && before.every((value, index) => value === after[index]);
function encodedBytes(dataURI, mime) {
  if (typeof dataURI !== 'string' || dataURI.length > 4 * 1024 * 1024 || !dataURI.startsWith(`data:${mime};base64,`)) return null;
  const encoded = dataURI.slice(dataURI.indexOf(',') + 1);
  // Zero-byte generic files are real records; media signatures stay strict.
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) return null;
  try { const bytes = atob(encoded); return btoa(bytes) === encoded ? bytes : null; } catch { return null; }
}
function encodeText(text, mime) {
  const bytes = new TextEncoder().encode(text), blocks = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) blocks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return `data:${mime};base64,${btoa(blocks.join(''))}`;
}
const declaredMimeOf = applicationFileMime;
function mimeOf(file) {
  return declaredMimeOf(file)?.split(';')[0].trim().toLowerCase() ?? null;
}
export function attachmentContent(attachment) {
  // Files keeps literal UTF-8 text/SVG; binary formats keep canonical data URIs.
  const mime = mimeOf(attachment);
  if (!mime?.startsWith('text/') && mime !== 'image/svg+xml') return attachment.dataURI;
  const binary = encodedBytes(attachment.dataURI, mime);
  if (binary === null) return null;
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(binary, character => character.charCodeAt(0))); }
  catch { return null; }
  // Never silently drop a byte-order mark or re-encode differently.
  if (encodeText(decoded, mime) !== attachment.dataURI) return null;
  return decoded;
}
let emojiSegmenter;
function isEmoji(value) {
  if (typeof value !== 'string' || !value.length || value.length > 64 || /[\r\n]/u.test(value)) return false;
  emojiSegmenter ??= new Intl.Segmenter('en-US', { granularity: 'grapheme' });
  return [...emojiSegmenter.segment(value)].length === 1 && /\p{Extended_Pictographic}|\p{Emoji_Presentation}|[0-9#*]\ufe0f?\u20e3/u.test(value);
}

export function createMessagesRichCommands(ctx) {
  const state = ctx.getState();
  let sequence = 0;
  const supported = () => profiles.includes(ctx.profile.id) && ctx.profile.capabilities.includes('messages.conversations');
  const alive = () => supported() && ctx.alive() === true && ctx.getState() === state;
  const draftHistories = new Map();
  let searchHistory = { undo: [], redo: [], expected: state.query };
  function recordDraftTransition(draft, field, before, priorRevision) {
    if (before === draft.fields[field]) return;
    let history = draftHistories.get(draft);
    if (!history || history.revision !== priorRevision) history = { undo: [], redo: [] };
    history.undo.push({ field, before, after: draft.fields[field] }); history.redo = [];
    while (history.undo.length > 32 || history.undo.reduce((sum, item) => sum + item.before.length + item.after.length, 0) > 1024 * 1024) history.undo.shift();
    history.revision = draft.revision; history.expected = { ...draft.fields };
    draftHistories.set(draft, history);
    for (const [original, retained] of draftHistories) {
      if (!state.drafts.includes(original)) { draftHistories.delete(original); continue; }
      if (original !== draft && retained.revision !== original.revision) draftHistories.delete(original);
    }
    let retainedUnits = [...draftHistories.values()].reduce((sum, retained) =>
      sum + [...retained.undo, ...retained.redo].reduce((units, step) => units + step.before.length + step.after.length, 0), 0);
    for (const [original, retained] of draftHistories) {
      while (retainedUnits > 1024 * 1024 && (retained.undo.length || retained.redo.length)) {
        const step = (retained.undo.length ? retained.undo : retained.redo).shift();
        retainedUnits -= step.before.length + step.after.length;
      }
      if (!retained.undo.length && !retained.redo.length) draftHistories.delete(original);
    }
  }
  function recordSearchTransition(before) {
    if (before === state.query) return;
    if (searchHistory.expected !== before) searchHistory = { undo: [], redo: [], expected: before };
    searchHistory.undo.push({ field: 'search', before, after: state.query }); searchHistory.redo = [];
    if (searchHistory.undo.length > 32) searchHistory.undo.shift();
    searchHistory.expected = state.query;
  }
  function historyFor(selection) {
    if (selection.field === 'search') return searchHistory.expected === state.query ? searchHistory : null;
    const draft = messageDraft(state, selection.draftId), history = draftHistories.get(draft);
    return history && history.revision === draft.revision && history.expected.to === draft.fields.to && history.expected.body === draft.fields.body ? history : null;
  }
  function editCapture(lease) {
    if (!lease.current() || typeof lease.view.editSelection !== 'function') return null;
    const selection = lease.view.editSelection();
    if (!selection || !['search', 'to', 'body'].includes(selection.field) || !selection.node || typeof selection.value !== 'string'
      || !Number.isInteger(selection.start) || !Number.isInteger(selection.end) || selection.start < 0
      || selection.end < selection.start || selection.end > selection.value.length) return null;
    const draft = selection.field === 'search' ? null : messageDraft(state, selection.draftId);
    if (selection.field === 'search' ? selection.value !== state.query
      : !draft || state.selectedDraftId !== draft.id || draft.fields[selection.field] !== selection.value) return null;
    return { ...selection, readOnly: selection.readOnly === true || selection.field === 'to' && draft?.conversationId !== null };
  }
  function editingAvailability(windowId) {
    const window = ctx.getWindow(windowId), view = ctx.getView(windowId);
    if (!alive() || !window || !ctx.available(window) || view?.available() !== true || typeof view.editSelection !== 'function') return null;
    const selection = view.editSelection(); if (!selection) return null;
    const history = historyFor(selection);
    return { field: selection.field, draftId: selection.draftId, start: selection.start, end: selection.end,
      valueLength: selection.value.length, readOnly: selection.readOnly === true,
      undo: history?.undo.at(-1)?.field === selection.field, redo: history?.redo.at(-1)?.field === selection.field };
  }
  async function editingOperation(operation, rawTarget, rawPayload) {
    const intent = target(rawTarget, ['windowId']); if (!intent || !literal(rawPayload, [])) return invalid();
    const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
    const selection = editCapture(lease);
    if (!selection || typeof lease.view.restoreEditSelection !== 'function') return unavailable('The original native search/recipient/body selection hooks are required.');
    if (typeof lease.view.editInteraction !== 'function') return unavailable('The real native edit-interaction counter is required.');
    const interaction = lease.view.editInteraction();
    if (!Number.isSafeInteger(interaction)) return unavailable('The original native editor is not retained.');
    let clipboardCurrent = () => true;
    const current = () => {
      if (!lease.current() || !clipboardCurrent() || lease.view.editInteraction() !== interaction) return false;
      const actual = lease.view.editSelection();
      return actual?.node === selection.node && actual.field === selection.field && actual.draftId === selection.draftId
        && actual.value === selection.value && actual.start === selection.start && actual.end === selection.end
        && actual.direction === selection.direction && actual.readOnly === selection.readOnly;
    };
    if (operation === 'selectAll') {
      const selectionOwner = () => lease.current() && lease.view.editSelection()?.node === selection.node;
      return lease.view.restoreEditSelection(selection, { start: 0, end: selection.value.length, direction: 'none' }, selectionOwner) === true
        && selectionOwner() ? applied(intent) : stale();
    }
    const text = selection.value.slice(selection.start, selection.end);
    if (operation === 'copy') {
      if (!text) return disabled('No actual native text range is selected.');
      return external({ ...lease, current, ownership: { guard: current, windowId: intent.windowId } }, 'setClipboard',
        [{ kind: 'text', text, fileIds: [] }], intent);
    }
    if (selection.readOnly) return disabled('The original native field is read-only.');
    let insertion = '', history = null, transition = null;
    if (operation === 'paste') {
      if (typeof ctx.getClipboard !== 'function') return unavailable('The actual scene clipboard lookup bridge is required.');
      const clipboard = await ctx.getClipboard();
      if (!current()) return stale();
      const fingerprint = JSON.stringify(clipboard);
      clipboardCurrent = () => ctx.getClipboard() === clipboard && JSON.stringify(clipboard) === fingerprint;
      if (!current()) return stale();
      if (clipboard?.kind === 'files') {
        const draft = selection.field === 'body' ? messageDraft(state, selection.draftId) : null;
        if (!draft || !Array.isArray(clipboard.fileIds) || !clipboard.fileIds.length || !clipboard.fileIds.every(id)
          || new Set(clipboard.fileIds).size !== clipboard.fileIds.length || typeof ctx.getFile !== 'function')
          return disabled('Paste Files requires the original body draft and exact live scene clipboard File IDs.');
        if (draft.attachments.length + clipboard.fileIds.length > 16) return capacity('The complete draft attachment capacity is exhausted.');
        const sources = clipboard.fileIds.map(fileId => ({ fileId, file: ctx.getFile(fileId) }));
        if (sources.some(source => !source.file)) return stale();
        for (const source of sources) source.fingerprint = JSON.stringify(source.file);
        const ownsClipboard = clipboardCurrent;
        clipboardCurrent = () => ownsClipboard() && sources.every(source => ctx.getFile(source.fileId) === source.file && JSON.stringify(source.file) === source.fingerprint);
        const additions = [], reservedIds = [], revision = draft.revision;
        for (const source of sources) {
          const prepared = await resolveAttachment({ ...lease, current }, draft, source.fileId);
          if (prepared.error) return prepared.error;
          if (!current()) return stale();
          prepared.attachment.id = attachmentId(draft, reservedIds);
          reservedIds.push(prepared.attachment.id); additions.push(prepared.attachment);
        }
        const result = await setAttachments(lease, { ...intent, draftId: draft.id }, [...draft.attachments, ...additions], current);
        if (result.status !== 'applied') return result;
        const presented = () => lease.presentationAvailable() && lease.view.editInteraction() === interaction
          && messageDraft(state, draft.id) === draft && draft.revision === revision + 1 && draft.fields.body === selection.value;
        try { result.presentation.caretRestored = presented() && lease.view.restoreEditSelection(selection,
          { start: selection.start, end: selection.end, direction: selection.direction }, presented) === true; }
        catch { result.presentation.caretRestored = false; }
        return result;
      }
      if (!clipboard || clipboard.kind !== 'text' || typeof clipboard.text !== 'string' || !clipboard.text) return disabled('The scene clipboard has no nonempty literal text.');
      insertion = clipboard.text;
    } else if (operation === 'cut') {
      if (!text) return disabled('No actual native text range is selected.');
    } else {
      history = historyFor(selection);
      transition = history?.[operation]?.at(-1);
      if (!transition || transition.field !== selection.field) return disabled('No original field transition is available in that direction.');
    }
    const value = transition ? transition[operation === 'undo' ? 'before' : 'after']
      : selection.value.slice(0, selection.start) + insertion + selection.value.slice(selection.end);
    const candidate = copyCanonicalData(state), draft = selection.field === 'search' ? null : messageDraft(state, selection.draftId);
    const beforeRevision = draft?.revision;
    if (selection.field === 'search') {
      if (value.length > 4096) return capacity('The literal Messages query exceeds its capacity.');
      candidate.query = value; candidate.selectedMessageId = null;
    } else {
      if (!validMessageDraftField(selection.field, value)) return invalid();
      const time = authoredTime(lease); if (time === null || draft.revision >= MAX_COUNTER) return capacity('The authored clock or draft revision is exhausted.');
      const replacement = candidate.drafts.find(row => row.id === draft.id);
      replacement.fields[selection.field] = value; replacement.revision++; replacement.updatedAt = time; candidate.timeBase = time;
    }
    const guardedLease = { ...lease, current };
    const checked = preflight(guardedLease, candidate); if (checked) return checked;
    let acknowledged = false;
    const commit = () => {
      if (acknowledged || preflight(guardedLease, candidate)) return false;
      applyCanonicalData(state, candidate); acknowledged = true;
      if (history) {
        history[operation].pop(); history[operation === 'undo' ? 'redo' : 'undo'].push(transition);
        if (draft) { history.revision = draft.revision; history.expected = { ...draft.fields }; }
        else history.expected = state.query;
      } else if (draft) recordDraftTransition(draft, selection.field, selection.value, beforeRevision);
      else recordSearchTransition(selection.value);
      return true;
    };
    if (operation === 'cut') {
      if (typeof ctx.setClipboard !== 'function') return unavailable('The actual atomic scene clipboard bridge is required.');
      let result;
      try { result = await ctx.setClipboard({ kind: 'text', text, fileIds: [],
        reserveTextUnits: canonicalStringUnits(candidate) - canonicalStringUnits(state), onCommit: commit }, { guard: current, windowId: intent.windowId }); }
      catch (error) { if (!acknowledged) return current() ? unavailable(error?.message ?? 'The clipboard transaction failed.') : stale(); }
      if (!acknowledged) return current() ? result?.status === 'rejected' ? result : unavailable('The clipboard did not atomically acknowledge the original cut.') : stale();
    } else if (!commit()) return stale();
    if (draft) ctx.onTimeChanged?.(state.timeBase);
    const result = await committedPresentation(lease, intent);
    const caret = transition ? value.length : selection.start + insertion.length;
    const presentationGuard = () => lease.presentationAvailable() && lease.view.editInteraction() === interaction && (draft
      ? messageDraft(state, draft.id) === draft && draft.fields[selection.field] === value && draft.revision === beforeRevision + 1
      : state.query === value);
    try { result.presentation.caretRestored = presentationGuard() && lease.view.restoreEditSelection(selection,
      { start: caret, end: caret, direction: 'none' }, presentationGuard) === true; }
    catch { result.presentation.caretRestored = false; }
    return result;
  }
  function target(value, required, optional = []) {
    const result = literal(value, required, optional);
    return result && Object.values(result).every(id) ? result : null;
  }
  function owner(windowId) {
    if (!alive()) return null;
    const window = ctx.getWindow(windowId), view = ctx.getView(windowId);
    if (!window || !view || !ctx.available(window) || view.available() !== true) return null;
    const version = ++sequence, time = ctx.getSceneTime?.() ?? state.timeBase;
    const snapshot = JSON.stringify(state), records = identities(state), scope = JSON.stringify(ctx.getSearchOptions?.() ?? {});
    const canonical = () => alive() && sequence === version && JSON.stringify(state) === snapshot && sameIdentities(records, identities(state))
      && (ctx.getSceneTime?.() ?? state.timeBase) === time && JSON.stringify(ctx.getSearchOptions?.() ?? {}) === scope
      && ctx.getWindow(windowId) === window && ctx.getView(windowId) === view;
    const current = () => canonical() && ctx.available(window) && view.available() === true;
    // After an acknowledged shared commit the canonical snapshot is stale by
    // design; presentationAvailable observes only surviving original scene,
    // state/window/view identities, never domain content or this lease version.
    const presentationAvailable = () => alive() && ctx.getState() === state && ctx.getWindow(windowId) === window
      && ctx.getView(windowId) === view && ctx.available(window) === true && view.available() === true;
    return { window, view, time, canonical, current, presentationAvailable, ownership: { guard: current, windowId } };
  }
  const missing = windowId => ctx.getWindow(windowId) ? unavailable('The original native messaging window is not available.') : stale();
  function preflight(lease, candidate) {
    if (!lease.current()) return stale();
    const checked = validateMessagesState(candidate, ctx.profile);
    if (!checked.ok) return invalid();
    if (typeof ctx.canCommit !== 'function') return unavailable('The complete-root Messages candidate preflight bridge is required.');
    if (ctx.canCommit(candidate) !== true) return capacity('The complete-scene canonical text budget is exhausted.');
    return lease.current() ? null : stale();
  }
  async function committedPresentation(lease, intent, extra = {}) {
    try {
      const settled = typeof ctx.settle === 'function';
      if (settled) await ctx.settle();
      return applied(intent, { ...extra, presentation: { settled, presentationAvailable: settled && lease.presentationAvailable() } });
    } catch (error) {
      return applied(intent, { ...extra, presentation: { settled: false, presentationAvailable: lease.presentationAvailable(),
        error: error?.message ?? 'The committed original presentation retired.' } });
    }
  }
  async function mutate(lease, intent, change, extra = {}) {
    const candidate = copyCanonicalData(state), result = change(candidate);
    if (result?.status === 'rejected') return result;
    const rejected = preflight(lease, candidate); if (rejected) return rejected;
    applyCanonicalData(state, candidate);
    if (candidate.timeBase !== lease.time) ctx.onTimeChanged?.(state.timeBase);
    return committedPresentation(lease, intent, { ...extra, ...(result ?? {}) });
  }
  function selectedConversation(lease, intent) {
    return lease.current() && state.selectedConversationId === intent.conversationId
      ? state.conversations.find(row => row.id === intent.conversationId) ?? null : null;
  }
  function selectedDraft(lease, intent) {
    return lease.current() && state.selectedDraftId === intent.draftId ? messageDraft(state, intent.draftId) : null;
  }
  const selectedDraftBody = lease => lease.current() ? messageDraft(state, state.selectedDraftId) : null;
  function endpointCollision(state, row, endpoint) {
    const identities = [...new Set([...row.participants.map(recipientIdentity), endpoint])];
    return state.conversations.some(other => other !== row && other.participants.length === identities.length
      && other.participants.every(name => identities.includes(recipientIdentity(name))));
  }
  function participantsEdit(row, additions, removals, time) {
    return candidate => {
      const conversation = candidate.conversations.find(value => value.id === row.id);
      conversation.participants = [...conversation.participants.filter(name => removals.every(endpoint => recipientIdentity(name) !== endpoint)), ...additions];
      const draft = candidate.drafts.find(value => value.conversationId === row.id);
      if (conversation.participants.length > 128 || conversation.participants.join(', ').length > 4096 || draft && draft.revision >= MAX_COUNTER)
        return capacity('The participant, recipient text or owned draft revision capacity is exhausted.');
      if (draft) {
        const replacement = { ...draft, fields: { ...draft.fields, to: conversation.participants.join(', ') }, updatedAt: time, revision: draft.revision + 1 };
        candidate.drafts = candidate.drafts.map(value => value === draft ? replacement : value);
      }
      candidate.timeBase = time;
    };
  }
  function participantChange(kind, rawTarget, rawPayload) {
    const intent = target(rawTarget, ['windowId', 'conversationId']);
    const payload = literal(rawPayload, ['address'], kind === 'remove' ? ['confirmed'] : []);
    if (!intent || !payload || typeof payload.address !== 'string' || !payload.address.length || payload.address.length > 320
      || kind === 'remove' && payload.confirmed !== true) return invalid();
    const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
    const row = selectedConversation(lease, intent); if (!row) return stale();
    if (!state.account.signedIn || row.left) return disabled('The active fictional account and conversation are required.');
    if (row.participants.length < 2) return disabled('Only an existing local group can change participants.');
    if (kind === 'add') {
      if (typeof ctx.resolveRecipient !== 'function') return unavailable('The actual fictional Contacts endpoint resolution bridge is required.');
      const parsed = messageRecipient(payload.address); if (!parsed) return invalid();
      const resolved = ctx.resolveRecipient(parsed);
      if (!resolved || typeof resolved.name !== 'string' || typeof resolved.address !== 'string' || !messageRecipient(`${resolved.name} <${resolved.address}>`)) return invalid();
      const endpoint = recipientIdentity(resolved.address);
      if (!endpoint) return invalid();
      if (endpoint === recipientIdentity(state.account.address)) return disabled('The local account is already an implicit participant.');
      if (row.participants.some(name => recipientIdentity(name) === endpoint)) return disabled('That endpoint is already in this conversation.');
      if (state.blockedAddresses.some(value => recipientIdentity(value) === endpoint)) return disabled('A blocked endpoint cannot join a fictional conversation.');
      if (endpointCollision(state, row, endpoint)) return disabled('An existing conversation already contains exactly this participant set; unrelated drafts are never silently merged.');
      const time = authoredTime(lease); if (time === null) return capacity('The authored clock is exhausted.');
      return mutate(lease, intent, participantsEdit(row, [resolved.address], [], time));
    }
    const endpoint = recipientIdentity(payload.address);
    const index = row.participants.findIndex(name => recipientIdentity(name) === endpoint);
    if (index < 0) return stale();
    if (row.participants.length <= 1) return disabled('The local conversation retains its original other endpoint.');
    const remaining = row.participants.filter(name => recipientIdentity(name) !== endpoint);
    const identities = remaining.map(recipientIdentity);
    if (state.conversations.some(other => other !== row && other.participants.length === identities.length
      && other.participants.every(name => identities.includes(recipientIdentity(name)))))
      return disabled('The remaining participant set already matches another conversation; unrelated drafts are never silently merged.');
    const time = authoredTime(lease); if (time === null) return capacity('The authored clock is exhausted.');
    return mutate(lease, intent, participantsEdit(row, [], [endpoint], time),
      { localEquivalent: row.participants.length - 1 < 3, confirmed: true });
  }
  function selectedItem(lease, intent) {
    return selectedConversation(lease, intent)?.items.find(item => item.id === intent.messageId) ?? null;
  }
  function authoredTime(lease) {
    const value = Math.max(state.timeBase, lease.time);
    return Number.isSafeInteger(value) && value >= 0 && value < MAX_TIME ? value + 1 : null;
  }
  function attachmentId(draft, reservedIds = null) {
    let index = 1;
    while (draft.attachments.some(row => row.id === `attachment-${draft.id}-${draft.revision}-${index}`)
      || reservedIds?.includes(`attachment-${draft.id}-${draft.revision}-${index}`)) index++;
    const id = `attachment-${draft.id}-${draft.revision}-${index}`;
    if (id.length > 128) { const error = new Error('The scoped attachment identity capacity is exhausted.'); error.code = 'limit_exceeded'; throw error; }
    return id;
  }
  async function setAttachments(lease, intent, attachments, guard = lease.current, addedId = null) {
    if (typeof ctx.canCommit !== 'function') return unavailable('The complete-root Messages candidate preflight bridge is required.');
    const result = setMessageDraftAttachments(state, intent.draftId, attachments, { time: lease.time, canCommit: ctx.canCommit, guard });
    if (result.status !== 'applied') return result;
    ctx.onTimeChanged?.(state.timeBase);
    return committedPresentation(lease, { ...intent, ...result.target, ...(addedId ? { attachmentId: addedId } : {}) });
  }
  async function resolveAttachment(lease, draft, fileId) {
    if (typeof ctx.getFile !== 'function') return { error: unavailable('The original canonical Files lookup bridge is required.') };
    const file = ctx.getFile(fileId);
    if (!file || file.id !== fileId || file.kind === 'folder' || file.deleted || typeof file.content !== 'string'
      || typeof file.name !== 'string' || !Number.isSafeInteger(file.revision) || file.revision < 1) return { error: stale() };
    const snapshot = copyCanonicalData(file), fingerprint = JSON.stringify(snapshot);
    const guard = () => lease.current() && ctx.getFile(fileId) === file && JSON.stringify(file) === fingerprint;
    const mime = mimeOf(snapshot);
    if (typeof mime !== 'string') return { error: unavailable('The original Files record has no supported MIME metadata.') };
    if (mime.startsWith('text/') || mime === 'image/svg+xml') {
      const charset = /(?:^|;) *charset *= *(?:"([^"]*)"|([^; ]+))/i.exec(declaredMimeOf(snapshot) ?? '');
      const encoding = (charset?.[1] ?? charset?.[2] ?? 'utf-8').toLowerCase();
      if (encoding !== 'utf-8' || /(?:^|;) *jesteros-bytes *=/i.test(declaredMimeOf(snapshot) ?? ''))
        return { error: rejected('unsupported_content', 'This original File uses non-UTF8 encoded text bytes; attachment preview and saving currently require literal UTF-8 text, not the native byte-storage wrapper.') };
    }
    let dataURI = mime.startsWith('text/') ? encodeText(snapshot.content, mime) : snapshot.content.startsWith('data:') ? snapshot.content : null;
    if (mime === 'image/svg+xml' && !snapshot.content.startsWith('data:')) {
      // Only the actual legacy UTF-8 SVG representation gains normalization.
      // Files' byte reader owns encoding policy; round-trip rejects lone surrogates.
      try {
        if (snapshot.encoding === 'base64') throw new Error('SVG source is not literal UTF-8.');
        const sourceBytes = bytesFromFile(snapshot);
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(sourceBytes);
        if (text !== snapshot.content) throw new Error('SVG source is not lossless UTF-8.');
        dataURI = encodeText(text, mime);
      } catch { return { error: rejected('unsupported_content', 'The original SVG must retain lossless literal UTF-8 bytes.') }; }
    }
    const bytes = encodedBytes(dataURI, mime);
    if (bytes === null) return { error: rejected('unsupported_content', 'The actual file must retain canonical base64 bytes or literal UTF-8 text.') };
    const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : 'file';
    const read32 = index => bytes.charCodeAt(index) + bytes.charCodeAt(index + 1) * 256 + bytes.charCodeAt(index + 2) * 65536 + bytes.charCodeAt(index + 3) * 16777216;
    const durationMs = kind === 'audio' && bytes.length >= 44 ? Math.round(read32(40) / read32(28) * 1000) : null;
    const attachment = { id: attachmentId(draft), name: snapshot.name, mime: declaredMimeOf(snapshot), dataURI, byteLength: bytes.length,
      originalFileId: snapshot.id, originalRevision: snapshot.revision, kind, durationMs };
    if (!validMessageAttachment(attachment)) return { error: rejected('unsupported_content', 'The real file MIME/bytes are not a supported attachment, UTF-8 SVG, raster or PCM WAV.') };
    // SVG's lossless UTF-8/root signature is checked by the attachment model;
    // the native image/associated Files consumer decodes it without rasterizing.
    if (kind === 'image' && mime !== 'image/svg+xml' || mime === 'application/pdf') {
      try { await validateDestinationDocument({ mime, content: dataURI }, { guard }); }
      catch (error) { return { error: guard() ? rejected(error?.code ?? 'unsupported_content', error?.message ?? 'The actual document cannot be decoded.') : stale() }; }
    }
    return guard() ? { attachment, guard } : { error: stale() };
  }
  async function external(lease, bridge, args, intent) {
    if (typeof ctx[bridge] !== 'function') return unavailable(`The actual shared ${bridge} bridge is required.`);
    if (!lease.current()) return stale();
    const result = await ctx[bridge](...args, lease.ownership);
    // A shared bridge is responsible for freshness at its real commit point.
    if (result?.status === 'applied') return applied(intent, { destination: result, ...(result.fileId ? { fileId: result.fileId } : {}),
      presentationAvailable: lease.presentationAvailable?.() ?? lease.current() });
    return lease.current() ? result?.status === 'rejected' ? result : unavailable(`The actual ${bridge} destination did not acknowledge a commit.`) : stale();
  }
  async function attachmentOperation(action, rawTarget, rawPayload) {
    const intent = target(rawTarget, ['windowId', 'conversationId', 'messageId', 'attachmentId']);
    const payload = literal(rawPayload, [], action === 'quickLook' ? ['open'] : []);
    if (!intent || !payload || Object.hasOwn(payload, 'open') && typeof payload.open !== 'boolean') return invalid();
    const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
    const item = selectedItem(lease, intent), attachment = item?.attachments?.find(row => row.id === intent.attachmentId);
    if (!attachment || !validMessageAttachment(attachment)) return stale();
    const snapshot = copyMessageAttachment(attachment);
    if (action === 'quickLook') {
      if (typeof lease.view.quickLookAttachment !== 'function') return unavailable('The actual native attachment Quick Look panel is unavailable.');
      return await lease.view.quickLookAttachment(snapshot, lease.current, intent, payload.open !== false) === true && lease.current() ? applied(intent) : stale();
    }
    if (action === 'open' && typeof ctx.openFile !== 'function') return unavailable('The actual shared Files open bridge is required.');
    const content = attachmentContent(snapshot);
    // Exact named+bytes revision equivalence is required for the original fast
    // path; any drift falls through to a fresh immutable snapshot file.
    if (action === 'open' && snapshot.originalFileId && content !== null && typeof ctx.getFile === 'function') {
      const file = ctx.getFile(snapshot.originalFileId);
      if (file && !file.deleted && file.kind !== 'folder' && file.revision === snapshot.originalRevision
        && (file.content === content || mimeOf(snapshot) === 'image/svg+xml' && file.content === snapshot.dataURI)
        && declaredMimeOf(file) === snapshot.mime && file.name === snapshot.name) {
        const fingerprint = JSON.stringify(file), guard = () => lease.current() && ctx.getFile(file.id) === file && JSON.stringify(file) === fingerprint;
        return external({ ...lease, current: guard, ownership: { guard, windowId: intent.windowId } }, 'openFile', [file.id, null], intent);
      }
    }
    if (typeof ctx.saveAttachmentFile !== 'function') return unavailable('The actual native attachment Save As sheet is required to preserve retained bytes.');
    if (content === null) return rejected('unsupported_content', 'The non-UTF-8 text attachment cannot be preserved without replacing its exact bytes.');
    const saved = await external(lease, 'saveAttachmentFile', [{ name: snapshot.name, mime: snapshot.mime, text: content,
      appId: lease.window.appId, windowId: intent.windowId }], intent);
    if (saved.status !== 'applied') return saved;
    const fileId = saved.destination?.fileId ?? saved.destination?.target?.fileId;
    if (!id(fileId)) return unavailable('The Files save bridge must acknowledge an actual file identity.');
    if (action === 'save') return { ...saved, fileId };
    if (!lease.current()) return applied(intent, { fileId, destination: saved.destination, presentation: { opened: false } });
    // Saving is already committed. A user who selected a third window during
    // the sheet owns focus; do not let this deferred Open reactivate a reader.
    if (typeof ctx.getActiveWindowId === 'function' && ctx.getActiveWindowId() !== intent.windowId)
      return applied(intent, { fileId, destination: saved.destination, presentation: { opened: false, reason: 'focus_changed' } });
    try {
      const opened = await external(lease, 'openFile', [fileId, null], intent);
      return applied(intent, { fileId, destination: saved.destination, presentation: { opened: opened.status === 'applied', result: opened } });
    } catch (error) { return applied(intent, { fileId, destination: saved.destination, presentation: { opened: false, error: error?.message ?? 'The saved attachment could not open.' } }); }
  }
  async function preferenceImage(rawTarget, rawPayload, background) {
    const intent = target(rawTarget, background ? ['windowId', 'conversationId'] : ['windowId']), payload = literal(rawPayload, [], ['fileId']);
    if (!intent || !payload || Object.hasOwn(payload, 'fileId') && payload.fileId !== null && !id(payload.fileId)) return invalid();
    if (background ? ctx.profile.renderer !== 'golden-gate' : !['sonoma', 'golden-gate'].includes(ctx.profile.renderer))
      return disabled('This local image preference does not belong to the installed native release.');
    const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
    if (background && !selectedConversation(lease, intent)) return stale();
    let fileId = payload.fileId;
    if (fileId === undefined) {
      if (typeof ctx.chooseFile !== 'function') return unavailable('The original Files image chooser is required.');
      const chosen = await ctx.chooseFile({ title: background ? 'Choose Conversation Background' : 'Choose Your Local Photo',
        accept: ['image/*'], multiple: false, appId: lease.window.appId, windowId: intent.windowId },
      { guard: lease.canonical, windowId: intent.windowId });
      if (!lease.current()) return stale();
      if (chosen?.status !== 'applied') return chosen?.status === 'rejected' ? chosen : unavailable('The original Files chooser did not select an image.');
      fileId = chosen.fileId ?? chosen.target?.fileId;
    }
    if (fileId === null) return mutate(lease, intent, candidate => {
      if (background) candidate.conversations.find(row => row.id === intent.conversationId).background = null;
      else candidate.account.photo = null;
    });
    if (typeof ctx.getFile !== 'function') return unavailable('The original Files image authority is required.');
    const file = ctx.getFile(fileId), fingerprint = JSON.stringify(file), mime = file && mimeOf(file);
    if (!file || file.kind === 'folder' || file.deleted || typeof mime !== 'string' || !mime.startsWith('image/')) return stale();
    const guard = () => lease.current() && ctx.getFile(fileId) === file && JSON.stringify(file) === fingerprint;
    const bytes = encodedBytes(file.content, mime);
    const attachment = { id: background ? `background-${intent.conversationId}` : 'account-photo',
      name: file.name, mime, dataURI: file.content, byteLength: bytes?.length ?? 0,
      originalFileId: file.id, originalRevision: file.revision, kind: 'image', durationMs: null };
    if (!validMessageAttachment(attachment)) return rejected('unsupported_content', 'Choose a genuine supported raster image from Files.');
    try { await validateDestinationDocument({ mime, content: file.content }, { guard }); }
    catch (error) { return guard() ? rejected(error?.code ?? 'unsupported_content', error?.message ?? 'The image could not be decoded.') : stale(); }
    if (!guard()) return stale();
    return mutate({ ...lease, current: guard }, intent, candidate => {
      if (background) candidate.conversations.find(row => row.id === intent.conversationId).background = attachment;
      else candidate.account.photo = attachment;
    });
  }
  const handlers = {
    'messages.preferences.navigate': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId']), payload = literal(rawPayload, ['pane'], ['section']);
      if (!intent || !payload || !['general', 'account', 'sharing', 'appearance', 'notifications'].includes(payload.pane)
        || payload.section !== undefined && (payload.pane !== 'account' || !['settings', 'blocked'].includes(payload.section))) return invalid();
      if (!messagePreferencePanes(ctx.profile).some(pane => pane.id === payload.pane)) return disabled('This preference pane is not represented in the original release.');
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (typeof lease.view.setPreferencePane !== 'function') return unavailable('The original native preference navigation is unavailable.');
      const section = payload.pane === 'account' ? payload.section ?? 'settings' : null;
      const selected = await lease.view.setPreferencePane(payload.pane, section, lease.current);
      if (!lease.current()) return stale();
      return selected === true ? applied(intent, { pane: payload.pane, section }) : unavailable('Open the original preference panel before navigating its panes.');
    },
    'messages.preferences.set': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId']), payload = literal(rawPayload, ['key', 'value'], ['confirmed', 'expectedTime']);
      if (!intent || !payload || typeof payload.key !== 'string' || !Object.hasOwn(state.preferences, payload.key)
        || Object.hasOwn(payload, 'confirmed') && payload.confirmed !== true
        || Object.hasOwn(payload, 'expectedTime') && (!Number.isSafeInteger(payload.expectedTime) || payload.expectedTime < 0 || payload.expectedTime > MAX_TIME)) return invalid();
      if (!messagePreferenceAvailable(ctx.profile, payload.key)) return disabled('This preference does not belong to this installed native release.');
      const values = { keepMessages: ['forever', '30days', '1year'], receivedSound: ['none', 'glass-study', 'golden-arpeggio'], shareAutomatically: ['contacts', 'ask'] };
      if (payload.key === 'textSize' ? !Number.isInteger(payload.value) || payload.value < 10 || payload.value > 24
        : values[payload.key] ? !values[payload.key].includes(payload.value)
        : payload.key === 'receivedFilesFolderId' ? typeof payload.value !== 'string' || !id(payload.value)
        : payload.key === 'sharedApps' ? !Array.isArray(payload.value) || payload.value.length > 3 || payload.value.some(app => !['safari', 'photos', 'finder'].includes(app)) || new Set(payload.value).size !== payload.value.length
        : typeof payload.value !== 'boolean') return invalid();
      if (payload.key === 'keepMessages' && payload.value !== 'forever' && payload.confirmed !== true)
        return rejected('confirmation_required', 'Changing Keep messages to a finite period permanently removes older messages and attachments. Confirm the authored-scene retention policy.');
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (payload.key === 'keepMessages' && payload.expectedTime !== undefined && payload.expectedTime !== Math.max(lease.time, state.timeBase)) return stale();
      let folder = null, contents = null;
      if (payload.key === 'receivedFilesFolderId') {
        if (typeof ctx.getFile !== 'function') return unavailable('The genuine Files folder authority is required.');
        folder = ctx.getFile(payload.value);
        if (!folder || folder.kind !== 'folder' || folder.deleted || folder.readOnly || folder.id === 'trash') return stale();
        contents = JSON.stringify(folder);
      }
      return mutate(lease, intent, candidate => {
        if (folder && (ctx.getFile(payload.value) !== folder || JSON.stringify(folder) !== contents)) return stale();
        candidate.preferences[payload.key] = payload.value;
        return payload.key === 'keepMessages' ? { expiredMessages: expireMessages(candidate, Math.max(lease.time, candidate.timeBase)) } : {};
      });
    },
    'messages.account.photo.set': (target, payload) => preferenceImage(target, payload, false),
    'messages.conversation.background.set': (target, payload) => preferenceImage(target, payload, true),
    'messages.conversation.profile.approve': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId']), payload = literal(rawPayload, ['approved']);
      if (!intent || !payload || typeof payload.approved !== 'boolean') return invalid();
      if (!['sonoma', 'golden-gate'].includes(ctx.profile.renderer)) return disabled('Name and photo sharing is unavailable in this native era.');
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (!selectedConversation(lease, intent)) return stale();
      return mutate(lease, intent, candidate => { candidate.conversations.find(row => row.id === intent.conversationId).shareApproved = payload.approved; });
    },
    'messages.sharedContent.open': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId']), payload = literal(rawPayload, ['appId', 'contentId']);
      if (!intent || !payload || !['safari', 'photos', 'finder'].includes(payload.appId) || !id(payload.contentId)) return invalid();
      if (!['sonoma', 'golden-gate'].includes(ctx.profile.renderer)) return disabled('Shared with You is unavailable in this native era.');
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (typeof ctx.captureContactEndpoints !== 'function') return unavailable('The original Contacts endpoint authority is required.');
      const contacts = ctx.captureContactEndpoints();
      if (!contacts || !Array.isArray(contacts.endpoints) || typeof contacts.current !== 'function' || !contacts.current()) return stale();
      const entry = messageSharedContent(state, contacts.endpoints, payload.appId).find(row => row.id === payload.contentId);
      if (!entry) return disabled('The original content is not enabled in this Contacts-only app sharing projection.');
      const item = state.conversations.find(row => row.id === entry.conversationId)?.items.find(item => item.id === entry.messageId);
      const attachment = entry.attachmentId ? item?.attachments?.find(row => row.id === entry.attachmentId) : null;
      const current = () => lease.current() && contacts.current();
      return external({ ...lease, current, ownership: { guard: current, windowId: intent.windowId } }, 'openSharedMessageContent',
        [{ ...entry, ...(attachment ? { attachment: copyMessageAttachment(attachment) } : {}) }], intent);
    },
    'messages.preferences.sound.preview': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId']);
      if (!intent || !literal(rawPayload, [])) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (typeof lease.view.playReceivedSound !== 'function') return unavailable('The original genuine local audio preview node is required.');
      const played = await lease.view.playReceivedSound(state.preferences.receivedSound, lease.current);
      return !lease.current() ? stale() : played === true ? applied(intent) : unavailable('The browser did not accept playback of the original local sound.');
    },
    'messages.account.rename': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId']), payload = literal(rawPayload, ['name']);
      if (!intent || !payload || typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 256) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      return mutate(lease, intent, candidate => {
        candidate.account.name = payload.name.trim();
        candidate.account.initials = payload.name.trim().split(/\s+/u).slice(0, 2).map(value => Array.from(value)[0]).join('').toUpperCase();
      });
    },
    'messages.sender.markKnown': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId']);
      if (!intent || !literal(rawPayload, [])) return invalid();
      if (ctx.profile.renderer !== 'golden-gate') return disabled('Unknown Senders screening belongs only to the qualified Golden Gate profile.');
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const row = state.conversations.find(value => value.id === intent.conversationId); if (!row) return stale();
      const endpoint = recipientIdentity(row.participants[0]); if (!endpoint) return invalid();
      if (!state.knownSenders.includes(endpoint) && state.knownSenders.length >= 128) return capacity('The known-sender ledger is full.');
      return mutate(lease, intent, candidate => {
        if (!candidate.knownSenders.includes(endpoint)) candidate.knownSenders.push(endpoint);
        for (const conversation of candidate.conversations) for (const item of conversation.items)
          if ((item.screened || item.spam) && recipientIdentity(item.sender ?? conversation.participants[0]) === endpoint) {
            if (item.screened) item.screened = false;
            if (item.spam) item.spam = false;
          }
      });
    },
    'messages.conversation.close': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId']), payload = literal(rawPayload, [], ['confirmed']);
      if (!intent || !payload || Object.hasOwn(payload, 'confirmed') && payload.confirmed !== true) return invalid();
      if (!['high-sierra', 'mojave'].includes(ctx.profile.renderer)) return disabled('Individual conversation closing is a historical Messages workflow.');
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const row = selectedConversation(lease, intent); if (!row) return stale();
      if (!state.preferences.saveClosedHistory && payload.confirmed !== true) return rejected('confirmation_required', 'Closing this conversation deletes its history and owned draft. Confirm to continue.');
      return mutate(lease, intent, candidate => {
        if (!candidate.preferences.saveClosedHistory) {
          candidate.conversations = candidate.conversations.filter(value => value.id !== row.id);
          candidate.drafts = candidate.drafts.filter(value => value.conversationId !== row.id);
        }
        candidate.selectedConversationId = null; candidate.selectedMessageId = null; candidate.selectedDraftId = null;
      });
    },
    'messages.account.setSignedIn': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId']), payload = literal(rawPayload, ['signedIn'], ['confirmed']);
      if (!intent || !payload || typeof payload.signedIn !== 'boolean' || Object.hasOwn(payload, 'confirmed') && payload.confirmed !== true) return invalid();
      if (!payload.signedIn && payload.confirmed !== true) return rejected('confirmation_required', 'Sign out requires confirmed:true.');
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      return mutate(lease, intent, candidate => { candidate.account.signedIn = payload.signedIn; });
    },
    'messages.account.set': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId']), payload = literal(rawPayload, ['key', 'value']);
      if (!intent || !payload || !['enabled', 'readReceipts'].includes(payload.key) || typeof payload.value !== 'boolean') return invalid();
      if (payload.key === 'enabled' && !['high-sierra', 'mojave'].includes(ctx.profile.renderer))
        return disabled('This account setting does not belong to this installed native profile.');
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      return mutate(lease, intent, candidate => { candidate.account[payload.key] = payload.value; });
    },
    'messages.block.set': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId']), payload = literal(rawPayload, ['address', 'blocked']);
      if (!intent || !payload || typeof payload.address !== 'string' || !payload.address.length || payload.address.length > 320 || typeof payload.blocked !== 'boolean') return invalid();
      const address = recipientIdentity(payload.address); if (!address) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (typeof ctx.setBlockedAddresses !== 'function') return unavailable('The shared three-domain blocked-endpoint bridge is required.');
      const blocked = payload.blocked ? [...new Set([...state.blockedAddresses.map(recipientIdentity), address])] : [...new Set(state.blockedAddresses.map(recipientIdentity).filter(value => value !== address))];
      if (blocked.length > 128) return capacity('The blocked endpoint capacity is exhausted.');
      // Root owns the atomic Messages+Calls+notification commit; acknowledgement
      // intentionally invalidates the pre-commit lease guard, so never gate on it.
      const result = await ctx.setBlockedAddresses(blocked, { guard: lease.current, windowId: intent.windowId, reserveTextUnits: 0 });
      return result?.status === 'applied' ? applied(intent, { address, blocked: payload.blocked, presentationAvailable: lease.presentationAvailable() })
        : lease.current() ? result?.status === 'rejected' ? result : unavailable('The blocked-endpoint bridge did not acknowledge an atomic commit.') : stale();
    },
    'messages.details.navigate': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId']), payload = literal(rawPayload, ['section'], ['discard']);
      if (!intent || !payload || !['summary', 'name', 'location', 'photos', 'files'].includes(payload.section)
        || payload.discard !== undefined && (payload.discard !== true || payload.section !== 'summary')) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const row = selectedConversation(lease, intent); if (!row) return stale();
      if (payload.section === 'name' && (row.participants.length < 2 || row.left)) return disabled('Only an active group has a name editor.');
      if (payload.section === 'location' && (!state.account.signedIn || row.left)) return disabled('The original active local account and conversation are required.');
      if (typeof lease.view.setDetailsSection !== 'function') return unavailable('The original native Details navigation is unavailable.');
      const selected = await lease.view.setDetailsSection(payload.section, payload.discard === true, lease.current);
      if (!lease.current()) return stale();
      return selected === true ? applied(intent, { section: payload.section }) : unavailable('Open the original Details panel before navigating its sections.');
    },
    'messages.conversation.details': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId'], ['conversationId']), payload = literal(rawPayload, ['open'], ['panel']);
      const panel = payload?.panel ?? 'details';
      if (!intent || !payload || typeof payload.open !== 'boolean' || !['details', 'preferences', 'account', 'help', 'delete', 'leave', 'emoji', 'attachments'].includes(panel)) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (['details', 'delete', 'leave', 'attachments'].includes(panel) && (!intent.conversationId || !selectedConversation(lease, intent))) return stale();
      if (panel === 'emoji' && !selectedDraftBody(lease)) return stale();
      if (typeof lease.view.setPanel !== 'function') return unavailable('The actual native Messages panel hook is unavailable.');
      if (payload.open && ['preferences', 'account'].includes(panel) && typeof lease.view.setPreferenceFolders === 'function' && typeof ctx.getReceivedFileFolders === 'function') {
        const folders = ctx.getReceivedFileFolders();
        if (!Array.isArray(folders) || !lease.current()) return stale();
        if (await lease.view.setPreferenceFolders(folders.map(row => ({ id: row.id, name: row.name })), lease.current) !== true) return stale();
      }
      if (payload.open && ['preferences', 'account'].includes(panel) && typeof lease.view.setPreferenceContacts === 'function' && typeof ctx.captureContactEndpoints === 'function') {
        const contacts = ctx.captureContactEndpoints();
        if (!contacts?.current() || !lease.current() || await lease.view.setPreferenceContacts(contacts.endpoints, () => lease.current() && contacts.current()) !== true) return stale();
      }
      if (payload.open && ['preferences', 'account'].includes(panel) && typeof lease.view.setPreferenceSceneTime === 'function'
        && await lease.view.setPreferenceSceneTime(Math.max(lease.time, state.timeBase), lease.current) !== true) return stale();
      ctx.focusWindow(intent.windowId);
      return await lease.view.setPanel(panel, payload.open, lease.current) === true && lease.current() ? applied(intent, { panel, open: payload.open }) : stale();
    },
    'messages.conversation.print': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId']);
      if (!intent || !literal(rawPayload, [])) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const row = selectedConversation(lease, intent); if (!row) return stale();
      const text = row.items.map(item => [item.sender ?? (item.direction === 'outgoing' ? state.account.name : row.name),
        item.kind === 'text' ? item.text : item.kind === 'image' ? item.label : item.kind === 'emoji' ? item.assets.map(asset => asset.label).join(' ') : 'Trail route',
        ...(item.attachments ?? []).map(attachment => attachment.name)].join('\n')).join('\n\n');
      return external(lease, 'printDocument', [{ appId: lease.window.appId, documentId: row.id, title: row.name, text }], intent);
    },
    'messages.conversation.rename': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId']), payload = literal(rawPayload, ['name']);
      if (!intent || !payload || typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 256 || /[\r\n\u0000]/u.test(payload.name)) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const row = selectedConversation(lease, intent); if (!row) return stale();
      if (row.participants.length < 2 || row.left) return disabled('Only an active fictional group can be renamed.');
      return mutate(lease, intent, candidate => { candidate.conversations.find(row => row.id === intent.conversationId).name = payload.name; });
    },
    'messages.conversation.addParticipant': (target, payload) => participantChange('add', target, payload),
    'messages.conversation.removeParticipant': (target, payload) => participantChange('remove', target, payload),
    'messages.conversation.setDnd': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId']), payload = literal(rawPayload, ['enabled']);
      if (!intent || !payload || typeof payload.enabled !== 'boolean') return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (!selectedConversation(lease, intent)) return stale();
      return mutate(lease, intent, candidate => { candidate.conversations.find(row => row.id === intent.conversationId).dnd = payload.enabled; });
    },
    'messages.location.set': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId']), payload = literal(rawPayload, ['location']);
      const value = payload?.location === null ? null : literal(payload?.location, ['label', 'latitude', 'longitude']);
      if (!intent || !payload || payload.location !== null && (!value || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 256
        || !Number.isFinite(value.latitude) || value.latitude < -90 || value.latitude > 90 || !Number.isFinite(value.longitude) || value.longitude < -180 || value.longitude > 180)) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const row = selectedConversation(lease, intent); if (!row) return stale();
      if (!state.account.signedIn || row.left) return disabled('The original active fictional account/conversation is required to share location.');
      const time = authoredTime(lease); if (time === null) return capacity('The authored clock is exhausted.');
      return mutate(lease, intent, candidate => { candidate.conversations.find(row => row.id === intent.conversationId).location = value === null ? null : { ...value, sharedAt: time }; candidate.timeBase = time; });
    },
    'messages.draft.attach': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'draftId']), payload = literal(rawPayload, [], ['fileId']);
      if (!intent || !payload || Object.hasOwn(payload, 'fileId') && !id(payload.fileId)) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const draft = selectedDraft(lease, intent); if (!draft) return stale();
      if (draft.attachments.length >= 16) return capacity('A message can retain at most sixteen attachments.');
      let fileId = payload.fileId;
      if (fileId === undefined) {
        if (typeof ctx.chooseFile !== 'function') return unavailable('The actual shared scene Files chooser bridge is required.');
        const result = await ctx.chooseFile({ title: 'Choose an attachment', accept: ['*/*'], multiple: false, appId: lease.window.appId, windowId: intent.windowId },
          { guard: lease.canonical, windowId: intent.windowId });
        if (!lease.current()) return stale();
        if (result?.status !== 'applied') return result?.status === 'rejected' ? result : unavailable('The Files chooser did not acknowledge an original file.');
        fileId = result.fileId ?? result.target?.fileId;
        if (!id(fileId)) return unavailable('The Files chooser must return an actual canonical file ID.');
      }
      const resolved = await resolveAttachment(lease, draft, fileId); if (resolved.error) return resolved.error;
      return setAttachments(lease, intent, [...draft.attachments.map(copyMessageAttachment), resolved.attachment], resolved.guard, resolved.attachment.id);
    },
    'messages.draft.detach': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'draftId']), payload = literal(rawPayload, ['attachmentId']);
      if (!intent || !payload || !id(payload.attachmentId)) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const draft = selectedDraft(lease, intent); if (!draft || !draft.attachments.some(row => row.id === payload.attachmentId)) return stale();
      return setAttachments(lease, intent, draft.attachments.filter(row => row.id !== payload.attachmentId).map(copyMessageAttachment));
    },
    'messages.draft.audio': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'draftId']); if (!intent || !literal(rawPayload, [])) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const draft = selectedDraft(lease, intent); if (!draft) return stale();
      const fixture = AUDIO_FIXTURES.quicktime, dataURI = fixture.src, bytes = encodedBytes(dataURI, 'audio/wav');
      const attachment = { id: attachmentId(draft), name: fixture.title, mime: 'audio/wav', dataURI, byteLength: bytes?.length ?? 0,
        originalFileId: null, originalRevision: null, kind: 'audio', durationMs: fixture.duration * 1000 };
      if (!validMessageAttachment(attachment)) return unavailable('The actual bundled authored PCM WAV fixture is invalid.');
      return setAttachments(lease, intent, [...draft.attachments.map(copyMessageAttachment), attachment], lease.current, attachment.id);
    },
    'messages.draft.emoji': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'draftId']), payload = literal(rawPayload, ['value']);
      if (!intent || !payload || !isEmoji(payload.value)) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const draft = selectedDraft(lease, intent); if (!draft) return stale();
      if (typeof ctx.canCommit !== 'function') return unavailable('The complete-root Messages candidate preflight bridge is required.');
      if (typeof lease.view.draftSelection !== 'function' || typeof lease.view.restoreDraftSelection !== 'function')
        return unavailable('The original native draft caret/selection hooks are required.');
      const selection = lease.view.draftSelection(draft.id);
      if (!selection || selection.value !== draft.fields.body || !Number.isInteger(selection.start) || !Number.isInteger(selection.end)
        || selection.start < 0 || selection.end < selection.start || selection.end > selection.value.length) return stale();
      if (typeof lease.view.editInteraction !== 'function') return unavailable('The real native edit-interaction counter is required.');
      const interaction = lease.view.editInteraction();
      if (!Number.isSafeInteger(interaction)) return unavailable('The original native draft editor is not retained.');
      const body = selection.value.slice(0, selection.start) + payload.value + selection.value.slice(selection.end);
      const priorRevision = draft.revision;
      const result = changeMessageDraft(state, draft.id, 'body', body, { time: lease.time,
        canCommit: candidate => lease.current() && ctx.canCommit(candidate) === true && lease.current() });
      if (result.status !== 'applied') return result;
      recordDraftTransition(draft, 'body', selection.value, priorRevision);
      ctx.onTimeChanged?.(state.timeBase);
      const revision = draft.revision, snapshot = JSON.stringify(state), records = identities(state);
      const presentationGuard = () => alive() && ctx.getWindow(intent.windowId) === lease.window && ctx.getView(intent.windowId) === lease.view
        && ctx.available(lease.window) && lease.view.available() === true && JSON.stringify(state) === snapshot
        && sameIdentities(records, identities(state)) && messageDraft(state, draft.id) === draft && draft.revision === revision
        && lease.view.editInteraction() === interaction;
      const committed = await committedPresentation(lease, { ...intent, ...result.target });
      const caret = selection.start + payload.value.length;
      try { committed.presentation.caretRestored = presentationGuard()
        && lease.view.restoreDraftSelection(draft.id, { start: caret, end: caret, direction: 'none' }, presentationGuard) === true; }
      catch { committed.presentation.caretRestored = false; }
      return committed;
    },
    'messages.edit.copy': (target, payload) => editingOperation('copy', target, payload),
    'messages.edit.cut': (target, payload) => editingOperation('cut', target, payload),
    'messages.edit.paste': (target, payload) => editingOperation('paste', target, payload),
    'messages.edit.selectAll': (target, payload) => editingOperation('selectAll', target, payload),
    'messages.edit.undo': (target, payload) => editingOperation('undo', target, payload),
    'messages.edit.redo': (target, payload) => editingOperation('redo', target, payload),
    'messages.attachment.preview': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'attachmentId'], ['draftId', 'conversationId', 'messageId']);
      const payload = literal(rawPayload, [], ['expanded', 'page', 'menuOpen', 'point', 'playing', 'time']);
      if (!intent || !payload || ['expanded', 'page', 'menuOpen', 'playing', 'time'].filter(key => Object.hasOwn(payload, key)).length !== 1
        || Object.hasOwn(payload, 'expanded') && typeof payload.expanded !== 'boolean'
        || Object.hasOwn(payload, 'page') && (!Number.isInteger(payload.page) || payload.page < 1 || payload.page > 10000)
        || Object.hasOwn(payload, 'menuOpen') && typeof payload.menuOpen !== 'boolean'
        || Object.hasOwn(payload, 'playing') && typeof payload.playing !== 'boolean'
        || Object.hasOwn(payload, 'time') && (!Number.isFinite(payload.time) || payload.time < 0 || payload.time > 86400)) return invalid();
      if (Object.hasOwn(payload, 'point')) {
        const point = literal(payload.point, ['x', 'y']);
        if (payload.menuOpen !== true || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return invalid();
        payload.point = point;
      }
      if (intent.draftId ? intent.conversationId !== undefined || intent.messageId !== undefined
        : !intent.conversationId || !intent.messageId) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const row = intent.draftId ? selectedDraft(lease, intent) : selectedItem(lease, intent);
      const attachment = row?.attachments?.find(row => row.id === intent.attachmentId);
      if (!attachment) return stale();
      if (Object.hasOwn(payload, 'expanded') && attachment.kind !== 'image'
        || Object.hasOwn(payload, 'page') && mimeOf(attachment) !== 'application/pdf'
        || Object.hasOwn(payload, 'menuOpen') && Boolean(intent.draftId)
        || (Object.hasOwn(payload, 'playing') || Object.hasOwn(payload, 'time')) && attachment.kind !== 'audio') return disabled('The requested presentation does not match the original attachment type.');
      if (typeof lease.view.setAttachmentPreview !== 'function') return unavailable('The original attachment presentation is unavailable.');
      const changed = await lease.view.setAttachmentPreview(intent, payload, lease.current);
      if (!lease.current()) return stale();
      return changed === true ? applied(intent) : unavailable('The original attachment presentation is unavailable or its decoded page is out of range.');
    },
    'messages.attachment.open': (target, payload) => attachmentOperation('open', target, payload),
    'messages.attachment.save': (target, payload) => attachmentOperation('save', target, payload),
    'messages.attachment.quickLook': (target, payload) => attachmentOperation('quickLook', target, payload),
    'messages.message.actions': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId', 'messageId']), payload = literal(rawPayload, ['open']);
      if (!intent || !payload || typeof payload.open !== 'boolean') return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (!selectedItem(lease, intent)) return stale();
      if (typeof lease.view.setMessageActions !== 'function') return unavailable('The original message action presentation is unavailable.');
      const changed = await lease.view.setMessageActions(intent.messageId, payload.open, lease.current);
      if (!lease.current()) return stale();
      return changed === true ? applied(intent) : unavailable('The original message actions are blocked or unavailable.');
    },
    'messages.message.react': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId', 'messageId']), payload = literal(rawPayload, ['emoji']);
      if (!intent || !payload || !validMessageReactionEmoji(payload.emoji, ctx.profile)) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      if (!selectedItem(lease, intent)) return stale();
      if (!state.account.signedIn || selectedConversation(lease, intent).left) return disabled('The active fictional account and conversation are required for reactions.');
      const participant = recipientIdentity(state.account.address); if (!participant) return invalid();
      return mutate(lease, intent, candidate => {
        const item = candidate.conversations.find(row => row.id === intent.conversationId).items.find(row => row.id === intent.messageId);
        const reactions = item.reactions ?? [], index = reactions.findIndex(row => recipientIdentity(row.participant) === participant);
        if (index >= 0) { if (reactions[index].emoji === payload.emoji) reactions.splice(index, 1); else reactions[index] = { emoji: payload.emoji, participant }; }
        else { if (reactions.length >= 128) return capacity('The message reaction capacity is exhausted.'); reactions.push({ emoji: payload.emoji, participant }); }
        if (reactions.length) item.reactions = reactions; else delete item.reactions;
      });
    },
    'messages.message.copy': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId', 'messageId']); if (!intent || !literal(rawPayload, [])) return invalid();
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const item = selectedItem(lease, intent); if (!item) return stale();
      if (item.kind === 'text' && item.text) return external(lease, 'setClipboard', [{ kind: 'text', text: item.text, fileIds: [] }], intent);
      const attachments = item.attachments ?? [];
      if (!attachments.length || typeof ctx.getFile !== 'function')
        return rejected('unsupported_content', 'This message has no literal clipboard text or actual live attachment Files. Illustration labels are not image bytes.');
      const sources = [];
      for (const attachment of attachments) {
        const file = attachment.originalFileId && ctx.getFile(attachment.originalFileId), content = attachmentContent(attachment);
        if (!file || file.deleted || file.kind === 'folder' || content === null || file.revision !== attachment.originalRevision
          || !(file.content === content || mimeOf(attachment) === 'image/svg+xml' && file.content === attachment.dataURI)
          || file.name !== attachment.name || declaredMimeOf(file) !== attachment.mime)
          return rejected('unsupported_content', 'Retained media cannot be replaced with filenames in the clipboard. Copy requires exact unchanged live source Files; use Save to Downloads/Open to retain these genuine bytes.');
        sources.push({ file, fingerprint: JSON.stringify(file) });
      }
      const guard = () => lease.current() && sources.every(({ file, fingerprint }) => ctx.getFile(file.id) === file && JSON.stringify(file) === fingerprint);
      return external({ ...lease, current: guard, ownership: { guard, windowId: intent.windowId } }, 'setClipboard',
        [{ kind: 'files', text: '', fileIds: [...new Set(sources.map(({ file }) => file.id))] }], intent);
    },
    'messages.incoming.receive': async (rawTarget, rawPayload) => {
      const intent = target(rawTarget, ['windowId', 'conversationId']), payload = literal(rawPayload, ['fixtureId']);
      const fixture = payload && MESSAGE_INCOMING_FIXTURES.find(row => row.id === payload.fixtureId);
      if (!intent || !payload || !fixture) return invalid();
      if (fixture.renderers && !fixture.renderers.includes(ctx.profile.renderer)) return disabled('This authored local fixture is not available in the installed release.');
      const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
      const row = state.conversations.find(row => row.id === intent.conversationId); if (!row) return stale();
      if (state.incomingFixtures.includes(fixture.id)) return disabled('This authored incoming fixture has already been consumed.');
      const sender = row.participants[0], endpoint = typeof sender === 'string' ? recipientIdentity(sender) : null;
      if (!state.account.enabled || !state.account.signedIn || row.left || !endpoint || state.blockedAddresses.some(value => recipientIdentity(value) === endpoint)) return disabled('The fictional incoming account is disabled, signed out, blocked or has left this conversation.');
      const contactDependent = !state.preferences.notifyUnknownContacts || state.preferences.screenUnknownSenders || state.preferences.filterSpam;
      const contacts = typeof ctx.captureContactEndpoints === 'function' ? ctx.captureContactEndpoints() : null;
      if (contactDependent && (!contacts || !Array.isArray(contacts.endpoints) || typeof contacts.current !== 'function'))
        return unavailable('The original canonical Contacts endpoint lease is required for sender notification policy.');
      const policyGuard = () => lease.current() && (!contacts || contacts.current() === true);
      if (!policyGuard()) return stale();
      const policy = messageIncomingPolicy(state, row, sender, fixture.text,
        contacts?.endpoints.some(value => recipientIdentity(value) === endpoint) === true, ctx.profile);
      const time = authoredTime(lease);
      if (time === null || state.nextId >= MAX_COUNTER || row.items.length >= 1024 || state.incomingFixtures.length >= 128) return capacity('The local incoming history, identity, fixture or authored clock capacity is exhausted.');
      // Deterministic bundled-authored media: no fabricated original Files
      // identities, no microphone; a detached copy enters the message item.
      let attachment = null;
      if (fixture.image) {
        const bytes = encodedBytes(PREVIEW_IMAGE_CONTENT, PREVIEW_IMAGE_MIME);
        attachment = { id: `incoming-${fixture.id}-attachment`, name: 'Harbor map.png', mime: PREVIEW_IMAGE_MIME,
          dataURI: PREVIEW_IMAGE_CONTENT, byteLength: bytes?.length ?? 0, originalFileId: null, originalRevision: null, kind: 'image', durationMs: null };
      } else if (fixture.audio) {
        const dataURI = AUDIO_FIXTURES.quicktime.src, bytes = encodedBytes(dataURI, 'audio/wav');
        attachment = { id: `incoming-${fixture.id}-attachment`, name: AUDIO_FIXTURES.quicktime.title, mime: 'audio/wav',
          dataURI, byteLength: bytes?.length ?? 0, originalFileId: null, originalRevision: null, kind: 'audio', durationMs: AUDIO_FIXTURES.quicktime.duration * 1000 };
      }
      if (attachment && !validMessageAttachment(copyMessageAttachment(attachment))) return unavailable('The bundled authored incoming media fixture is invalid.');
      const candidate = copyCanonicalData(state), conversation = candidate.conversations.find(value => value.id === row.id);
      const messageId = `authored-message-${candidate.nextId++}`, item = { id: messageId, timestamp: time, kind: 'text', direction: 'incoming', sender, text: fixture.text,
        ...(attachment ? { attachments: [copyMessageAttachment(attachment)] } : {}) };
      if (policy.screened) item.screened = true;
      if (policy.spam) item.spam = true;
      if (fixture.effect) item.effect = fixture.effect;
      conversation.items.push(item); conversation.timestamp = time; conversation.timeLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(time); conversation.unread = true;
      candidate.timeBase = time; candidate.incomingFixtures.push(fixture.id);
      const incomingLease = { ...lease, current: policyGuard };
      const check = preflight(incomingLease, candidate); if (check) return check;
      let savedFileId = null, commitError = null;
      const saveIncoming = attachment && messagePreferenceAvailable(ctx.profile, 'receivedFilesFolderId');
      const committed = () => {
        if (preflight(incomingLease, candidate)) return false;
        if (!saveIncoming) { applyCanonicalData(state, candidate); return true; }
        if (typeof ctx.createFile !== 'function') {
          commitError = unavailable('The real atomic received-attachment Files bridge is required.'); return false;
        }
        const result = ctx.createFile({ name: attachment.name, mime: attachment.mime, text: attachmentContent(attachment),
          folderId: state.preferences.receivedFilesFolderId,
          reserveTextUnits: canonicalStringUnits(candidate) - canonicalStringUnits(state),
          onCommit: fileId => {
            if (!id(fileId) || savedFileId !== null || preflight(incomingLease, candidate)) return false;
            applyCanonicalData(state, candidate); savedFileId = fileId; return true;
          } }, { guard: policyGuard, windowId: intent.windowId });
        if (result?.status !== 'applied') {
          commitError = result?.status === 'rejected' ? result : unavailable('The actual received File did not acknowledge a synchronous commit.'); return false;
        }
        return savedFileId !== null;
      };
      if (!policy.notify) {
        if (!committed()) return commitError ?? stale();
        ctx.onTimeChanged?.(state.timeBase);
        return committedPresentation(lease, { ...intent, messageId }, { fixtureId: fixture.id, fictional: true, notificationId: null, notificationSuppressed: true, ...(savedFileId ? { savedFileId } : {}) });
      }
      if (typeof ctx.notifyMessage !== 'function') return unavailable('The real atomic incoming Messages notification bridge is required.');
      let acknowledgedId = null, result;
      const onCommit = notificationId => {
        if (acknowledgedId !== null || !id(notificationId) || !committed()) return false;
        acknowledgedId = notificationId; return true;
      };
      try {
        result = await ctx.notifyMessage({ id: `incoming-${fixture.id}`, appId: lease.window.appId, title: row.name,
          body: state.preferences.showPreviews ? fixture.text : 'New message', source: { kind: 'message', recordId: row.id, windowId: intent.windowId },
          sound: state.preferences.playSounds && state.preferences.receivedSound !== 'none' ? 'default' : 'none',
          reserveTextUnits: canonicalStringUnits(candidate) - canonicalStringUnits(state), onCommit, actions: ['open', 'reply'] }, lease.ownership);
      } catch (error) { if (acknowledgedId === null) return lease.current() ? unavailable(error?.message ?? 'The incoming notification transaction failed.') : stale(); }
      if (acknowledgedId !== null) {
        ctx.onTimeChanged?.(state.timeBase);
        if (state.preferences.playSounds) void lease.view.playReceivedSound?.(state.preferences.receivedSound, lease.presentationAvailable);
        return committedPresentation(lease, { ...intent, messageId }, { fixtureId: fixture.id, fictional: true,
          notificationId: acknowledgedId, presentationAvailable: lease.presentationAvailable(), ...(savedFileId ? { savedFileId } : {}) });
      }
      return commitError ?? (policyGuard() ? result?.status === 'rejected' ? result : unavailable('The real notification transaction did not synchronously acknowledge the incoming message.') : stale());
    },
  };
  for (const action of ['leave', 'delete']) handlers[`messages.conversation.${action}`] = async (rawTarget, rawPayload) => {
    const intent = target(rawTarget, ['windowId', 'conversationId']), payload = literal(rawPayload, ['confirmed']);
    if (!intent || !payload || payload.confirmed !== true) return invalid();
    const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
    const row = selectedConversation(lease, intent); if (!row) return stale();
    if (action === 'leave' && (row.participants.length < 2 || row.left)) return disabled('Only an active fictional group can be left.');
    return mutate(lease, intent, candidate => {
      if (action === 'leave') candidate.conversations.find(value => value.id === row.id).left = true;
      else {
        candidate.conversations = candidate.conversations.filter(value => value.id !== row.id);
        candidate.drafts = candidate.drafts.filter(value => value.conversationId !== row.id);
        candidate.selectedConversationId = null; candidate.selectedMessageId = null; candidate.selectedDraftId = null;
      }
    });
  };
  handlers['messages.message.delete'] = async (rawTarget, rawPayload) => {
    const intent = target(rawTarget, ['windowId', 'conversationId', 'messageId']), payload = literal(rawPayload, ['confirmed']);
    if (!intent || !payload || payload.confirmed !== true) return invalid();
    const lease = owner(intent.windowId); if (!lease) return missing(intent.windowId);
    if (!selectedItem(lease, intent)) return stale();
    return mutate(lease, intent, candidate => {
      const row = candidate.conversations.find(value => value.id === intent.conversationId);
      row.items = row.items.filter(value => value.id !== intent.messageId);
      if (candidate.selectedMessageId === intent.messageId) candidate.selectedMessageId = null;
    });
  };
  function prepareNotificationOpen(conversationId, ownership) {
    if (!alive() || typeof ownership?.guard !== 'function' || ownership.guard() !== true) return null;
    const conversation = state.conversations.find(row => row.id === conversationId); if (!conversation) return null;
    const snapshot = JSON.stringify(state), records = identities(state), time = ctx.getSceneTime?.() ?? state.timeBase;
    const current = () => alive() && ownership.guard() === true && JSON.stringify(state) === snapshot
      && sameIdentities(records, identities(state)) && (ctx.getSceneTime?.() ?? state.timeBase) === time;
    const candidate = copyCanonicalData(state);
    candidate.selectedConversationId = conversationId; candidate.selectedMessageId = null;
    candidate.selectedDraftId = candidate.drafts.find(row => row.conversationId === conversationId)?.id ?? null;
    candidate.query = ''; candidate.unreadOnly = false; candidate.conversations.find(row => row.id === conversationId).unread = false;
    markMessagesRead(candidate, candidate.conversations.find(row => row.id === conversationId), time);
    if (!validateMessagesState(candidate, ctx.profile).ok || typeof ctx.canCommit !== 'function' || ctx.canCommit(candidate) !== true || !current()) return null;
    let committed = false;
    return { current, delta: canonicalStringUnits(candidate) - canonicalStringUnits(state), recordId: conversationId,
      commit: () => {
        if (committed || !current() || ctx.canCommit(candidate) !== true || !current()) return false;
        applyCanonicalData(state, candidate); committed = true; return true;
      } };
  }
  const guarded = Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, async (...args) => {
    if (!supported()) return rejected('unsupported_profile', 'The installed profile does not support Messages conversations.');
    if (!alive()) return stale();
    try { return await handler(...args); }
    catch (error) { return alive() ? rejected(error?.code ?? 'unavailable', error?.message ?? 'The real original Messages operation failed.') : stale(); }
  }]));
  return { handlers: guarded, recordDraftTransition, recordSearchTransition, editingAvailability, prepareNotificationOpen };
}

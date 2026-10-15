import { expect, test } from 'bun:test';
import { listOSProfiles, getOSProfile } from '../frontend/src/os-profiles.js';
import { createMessagesState, validateMessagesState, messagesForPersistence } from '../frontend/src/messages-state.js';
import { createMessageDraft, changeMessageDraft, sendMessageDraft, setMessageDelivery, setMessageDraftAttachments, validMessageAttachment, validMessageReactionEmoji } from '../frontend/src/messages-composition.js';
import { messageRecipientLabel, messageRecipients } from '../frontend/src/messages-recipients.js';
import { PREVIEW_IMAGE_CONTENT } from '../frontend/src/preview-image-fixture.js';
import { AUDIO_FIXTURES } from '../frontend/src/audio-fixtures.js';

const photo = () => ({ id: 'attachment-harbor', name: 'Harbor-map.png', mime: 'image/png', dataURI: PREVIEW_IMAGE_CONTENT,
  byteLength: atob(PREVIEW_IMAGE_CONTENT.split(',')[1]).length, originalFileId: 'harbor-map', originalRevision: 1, kind: 'image', durationMs: null });

for (const metadata of listOSProfiles()) {
  const profile = getOSProfile(metadata.id);
  test(`${profile.id}: composing existing recipients reuses their original history and preserves unrelated unsent text`, () => {
    const state = createMessagesState(profile), conversation = state.conversations[0];
    const retained = state.drafts.find(draft => draft.conversationId === conversation.id);
    expect(changeMessageDraft(state, retained.id, 'body', 'An earlier unsent draft').status).toBe('applied');
    const history = structuredClone(conversation.items);
    const made = createMessageDraft(state, { to: conversation.participants.join(', '), body: 'Exact first line\nExact second line.  ' });
    expect(made.status).toBe('applied');
    const sent = sendMessageDraft(state, made.target.draftId);
    expect(sent.status).toBe('applied');
    expect(sent.target.conversationId).toBe(conversation.id);
    expect(conversation.items.slice(0, -1)).toEqual(history);
    expect(conversation.items.at(-1).text).toBe('Exact first line\nExact second line.  ');
    expect(state.drafts.find(draft => draft.id === made.target.draftId).fields.body).toBe('');
    expect(retained.fields.body).toBe('An earlier unsent draft');
    expect(state.selectedDraftId).toBe(retained.id);
    expect(validateMessagesState(state, profile)).toEqual({ ok: true });
    expect(setMessageDelivery(state, conversation.id, sent.target.messageId, 'read').status).toBe('applied');
    expect(conversation.items.at(-1).deliveryStatus).toBe('read');
    expect(conversation.items.at(-1).delivery).toBe('Read · local');
  });
  test(`${profile.id}: an attachment-only send retains exact source bytes and clears only the original draft attachments`, () => {
    const state = createMessagesState(profile), original = state.conversations[0], attachment = photo();
    const made = createMessageDraft(state, { to: original.participants.join(', '), body: '' }, { attachments: [attachment] });
    const draft = state.drafts.find(row => row.id === made.target.draftId), attachments = draft.attachments;
    attachment.name = 'Changed source after snapshot.png';
    const sent = sendMessageDraft(state, draft.id);
    expect(sent.status).toBe('applied');
    expect(state.conversations.find(row => row.id === sent.target.conversationId)).toBe(original);
    const item = original.items.at(-1);
    expect(item.text).toBe('');
    expect(item.attachments[0]).toEqual(photo());
    expect(item.attachments[0]).not.toBe(attachment);
    expect(draft.attachments).toBe(attachments);
    expect(draft.attachments).toEqual([]);
    expect(validateMessagesState(state, profile)).toEqual({ ok: true });
  });
  test(`${profile.id}: signed-out, blocked and left account states refuse real outgoing attachment sends without changing drafts`, () => {
    const state = createMessagesState(profile), thread = state.conversations[0], draft = state.drafts.find(row => row.conversationId === thread.id);
    expect(setMessageDraftAttachments(state, draft.id, [photo()]).status).toBe('applied');
    for (const refusal of ['signedOut', 'blocked', 'left']) {
      state.account.signedIn = refusal !== 'signedOut'; state.blockedAddresses.splice(0, state.blockedAddresses.length,
        ...(refusal === 'blocked' ? [thread.participants[0]] : [])); thread.left = refusal === 'left';
      const before = structuredClone(state);
      expect(sendMessageDraft(state, draft.id).error.code).toBe('disabled');
      expect(state).toEqual(before);
    }
  });
}

test('budget rejection leaves the original draft, clock, allocation and complete history unchanged', () => {
  const state = createMessagesState(getOSProfile('macos-golden-gate-27.0.1'));
  const made = createMessageDraft(state, { to: 'New fictional recipient', body: 'Keep this exact unsent body.' });
  const before = structuredClone(state);
  expect(sendMessageDraft(state, made.target.draftId, { canCommit: () => false }).error.code).toBe('limit_exceeded');
  expect(state).toEqual(before);
  expect(changeMessageDraft(state, made.target.draftId, 'body', 'Do not commit', { canCommit: () => false }).error.code).toBe('limit_exceeded');
  expect(state).toEqual(before);
});

test('empty content and accessor recipients cannot allocate a fictional history or invoke actor code', () => {
  const state = createMessagesState(getOSProfile('macos-mojave-10.14'));
  let calls = 0;
  const fields = { get to() { calls++; return 'Morgan'; }, body: 'Hello' };
  const before = structuredClone(state);
  expect(createMessageDraft(state, fields).error.code).toBe('invalid_arguments');
  expect(calls).toBe(0);
  expect(state).toEqual(before);
  const made = createMessageDraft(state, { to: 'Morgan', body: ' \n ' });
  const empty = structuredClone(state);
  expect(sendMessageDraft(state, made.target.draftId).error.code).toBe('disabled');
  expect(state).toEqual(empty);
});

test('shared composition callback receives the actual allocated draft before insertion and false commits neither side', () => {
  const state = createMessagesState(getOSProfile('macos-mojave-10.14')), before = structuredClone(state);
  let callbacks = 0, delivered;
  const result = createMessageDraft(state, { to: '', body: 'Share with a chosen recipient later' }, {
    attachments: [photo()], onCommit(id, draft) {
      callbacks++; delivered = draft;
      expect(state.drafts.includes(draft)).toBe(false);
      expect(draft.id).toBe(id);
      return false;
    },
  });
  expect(result.error.code).toBe('stale_target');
  expect(callbacks).toBe(1);
  expect(state).toEqual(before);
  const applied = createMessageDraft(state, { to: '', body: '' }, { attachments: delivered.attachments,
    onCommit(id, draft) { delivered = draft; return true; } });
  expect(state.drafts.find(row => row.id === applied.target.draftId)).toBe(delivered);
  expect(sendMessageDraft(state, delivered.id).error.code).toBe('disabled');
});

test('attachment candidate budget and guard reject before shared callbacks or any clock/revision mutation', () => {
  const state = createMessagesState(getOSProfile('macos-sonoma-14.0')), draft = state.drafts[0], before = structuredClone(state);
  let callbacks = 0;
  const callback = () => { callbacks++; return true; };
  expect(createMessageDraft(state, { to: '', body: '' }, { attachments: [photo()], canCommit: () => false, onCommit: callback }).error.code).toBe('limit_exceeded');
  expect(setMessageDraftAttachments(state, draft.id, [photo()], { canCommit: () => false, onCommit: callback }).error.code).toBe('limit_exceeded');
  expect(setMessageDraftAttachments(state, draft.id, [photo()], { guard: () => false, onCommit: callback }).error.code).toBe('stale_target');
  expect(callbacks).toBe(0);
  expect(state).toEqual(before);
});

test('adding, reordering and removing draft attachments preserves the original unchanged records owned by native previews', () => {
  for (const metadata of listOSProfiles()) {
    const state = createMessagesState(getOSProfile(metadata.id)), draft = state.drafts[0];
    const text = 'The second attachment keeps its complete original text.\n';
    const second = { id: 'attachment-text', name: 'Original text.txt', mime: 'text/plain',
      dataURI: `data:text/plain;base64,${btoa(text)}`, byteLength: text.length,
      originalFileId: null, originalRevision: null, kind: 'file', durationMs: null };
    expect(setMessageDraftAttachments(state, draft.id, [photo()]).status).toBe('applied');
    const imageOwner = draft.attachments[0], imageContents = structuredClone(imageOwner);
    expect(setMessageDraftAttachments(state, draft.id, [structuredClone(imageOwner), second]).status).toBe('applied');
    const textOwner = draft.attachments[1];
    expect(draft.attachments[0]).toBe(imageOwner);
    expect(imageOwner).toEqual(imageContents);
    expect(setMessageDraftAttachments(state, draft.id, [structuredClone(textOwner), structuredClone(imageOwner)]).status).toBe('applied');
    expect(draft.attachments[0]).toBe(textOwner);
    expect(draft.attachments[1]).toBe(imageOwner);
    expect(setMessageDraftAttachments(state, draft.id, [structuredClone(textOwner)]).status).toBe('applied');
    expect(draft.attachments[0]).toBe(textOwner);
    expect(atob(textOwner.dataURI.split(',')[1])).toBe(text);
    expect(imageOwner).toEqual(imageContents);
  }
});

test('actual PNG and measured PCM WAV survive attachment validation; invented data and accessor bytes do not', () => {
  expect(validMessageAttachment(photo())).toBe(true);
  const wav = AUDIO_FIXTURES.quicktime.src;
  const audio = { id: 'audio-glass', name: 'Glass Study.wav', mime: 'audio/wav', dataURI: wav,
    byteLength: atob(wav.split(',')[1]).length, originalFileId: null, originalRevision: null, kind: 'audio', durationMs: 8000 };
  expect(validMessageAttachment(audio)).toBe(true);
  expect(validMessageAttachment({ ...audio, durationMs: 7999 })).toBe(false);
  expect(validMessageAttachment({ ...photo(), dataURI: 'data:image/png;base64,bm90LWFuLWltYWdl', byteLength: 12 })).toBe(false);
  expect(validMessageAttachment({ ...photo(), originalRevision: null })).toBe(false);
  expect(validMessageAttachment({ id: 'empty-text', name: 'Empty.txt', mime: 'text/plain', dataURI: 'data:text/plain;base64,',
    byteLength: 0, originalFileId: 'empty-file', originalRevision: 1, kind: 'file', durationMs: null })).toBe(true);
  let reads = 0;
  const accessor = { ...photo(), get dataURI() { reads++; return PREVIEW_IMAGE_CONTENT; } };
  expect(validMessageAttachment(accessor)).toBe(false);
  expect(reads).toBe(0);
  const state = createMessagesState(getOSProfile('macos-high-sierra-10.13')), before = structuredClone(state);
  expect(createMessageDraft(state, { to: '', body: '' }, { attachments: [photo(), photo()] }).error.code).toBe('invalid_arguments');
  expect(createMessageDraft(state, { to: '', body: '' }, { attachments: [accessor] }).error.code).toBe('invalid_arguments');
  expect(state).toEqual(before);
});

test('preflight cannot replace equal-valued canonical ownership or change shared privacy underneath a send', () => {
  const state = createMessagesState(getOSProfile('macos-mojave-10.14')), thread = state.conversations[0];
  const draft = state.drafts.find(row => row.conversationId === thread.id);
  changeMessageDraft(state, draft.id, 'body', 'Must remain unsent');
  const itemCount = thread.items.length, originalClock = state.timeBase;
  const result = sendMessageDraft(state, draft.id, { canCommit() {
    thread.items = thread.items.map(row => ({ ...row }));
    return true;
  } });
  expect(result.error.code).toBe('stale_target');
  expect(thread.items.length).toBe(itemCount);
  expect(draft.fields.body).toBe('Must remain unsent');
  expect(state.timeBase).toBe(originalClock);
  const signedOut = sendMessageDraft(state, draft.id, { canCommit() { state.account.signedIn = false; return true; } });
  expect(signedOut.error.code).toBe('stale_target');
  expect(state.account.signedIn).toBe(false);
  expect(draft.fields.body).toBe('Must remain unsent');
});

test('history privacy persistence is a detached projection preserving active records and draft ownership', () => {
  const profile = getOSProfile('macos-high-sierra-10.13'), state = createMessagesState(profile), thread = state.conversations[0];
  state.preferences.saveHistory = false;
  state.selectedMessageId = thread.items[0].id;
  const originalItems = thread.items, before = structuredClone(state);
  const saved = messagesForPersistence(state);
  expect(saved.conversations.every(row => row.items.length === 0)).toBe(true);
  expect(saved.selectedMessageId).toBeNull();
  expect(saved.drafts.map(row => row.conversationId)).toEqual(state.drafts.map(row => row.conversationId));
  expect(state).toEqual(before);
  expect(thread.items).toBe(originalItems);
  expect(validateMessagesState(saved, profile)).toEqual({ ok: true });
});

test('historical Tapbacks and expanded modern reactions validate a single real emoji without arbitrary prose', () => {
  for (const metadata of listOSProfiles()) {
    const profile = getOSProfile(metadata.id), expanded = ['macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'].includes(profile.id);
    expect(validMessageReactionEmoji('❤️', profile)).toBe(true);
    expect(validMessageReactionEmoji('🧑🏽‍🚀', profile)).toBe(expanded);
    expect(validMessageReactionEmoji('🇨🇦', profile)).toBe(expanded);
    expect(validMessageReactionEmoji('1️⃣', profile)).toBe(expanded);
    expect(validMessageReactionEmoji('😀😀', profile)).toBe(false);
    expect(validMessageReactionEmoji('hello', profile)).toBe(false);
  }
});

test('a live draft record factory publishes the identical precommit record and cannot rewrite planned fields', () => {
  const state = createMessagesState(getOSProfile('macos-sonoma-14.0'));
  let produced, acknowledged, allocations = 0;
  const result = createMessageDraft(state, { to: '', body: 'Actual precommit proxy 🌊' }, {
    attachments: [photo()],
    makeRecord(specification) { allocations++; produced = new Proxy(specification, {}); return produced; },
    onCommit(id, draft) { expect(draft.id).toBe(id); acknowledged = draft; return true; },
  });
  expect(result.status).toBe('applied');
  expect(allocations).toBe(1);
  expect(acknowledged).toBe(produced);
  expect(state.drafts.find(row => row.id === result.target.draftId)).toBe(produced);
  const before = structuredClone({ ...state, drafts: state.drafts.map(row => ({ ...row })) });
  let callbacks = 0;
  const invalid = createMessageDraft(state, { to: '', body: 'Never rewritten' }, {
    makeRecord(specification) { return { ...specification, fields: { ...specification.fields, body: 'Rewritten' } }; },
    onCommit() { callbacks++; return true; },
  });
  expect(invalid.error.code).toBe('invalid_arguments');
  expect(callbacks).toBe(0);
  expect({ ...state, drafts: state.drafts.map(row => ({ ...row })) }).toEqual(before);
});

test('native contact punctuation stays one endpoint and preserves its complete display name in sent history', () => {
  const state = createMessagesState(getOSProfile('macos-mojave-10.14'));
  const contact = { name: 'Lin, Jr; Morgan "Q" \\ café 東京', address: '+1 415 555 0173' };
  const to = `${messageRecipientLabel(contact)}, `;
  expect(messageRecipients(to)).toEqual([contact]);
  const created = createMessageDraft(state, { to, body: 'One chosen contact, never phantom recipients.' });
  const sent = sendMessageDraft(state, created.target.draftId);
  expect(sent.status).toBe('applied');
  const thread = state.conversations.find(row => row.id === sent.target.conversationId);
  expect(thread.participants).toEqual([contact.address]);
  expect(thread.name).toBe(contact.name);
  expect(thread.items.at(-1).text).toBe('One chosen contact, never phantom recipients.');
  expect(validateMessagesState(state, getOSProfile('macos-mojave-10.14'))).toEqual({ ok: true });
});

test('unterminated quoted display names cannot consume another endpoint or publish partial history', () => {
  for (const to of ['"Lin, Jr <+1 415 555 0173>, sam@jester.local', '"Lin\\", Jr <+1 415 555 0173>, sam@jester.local',
    '"Lin, Jr" <+1 415 555 0173, sam@jester.local']) {
    const state = createMessagesState(getOSProfile('macos-mojave-10.14'));
    const made = createMessageDraft(state, { to, body: 'Retain this original unsent draft.' });
    const before = structuredClone(state);
    expect(sendMessageDraft(state, made.target.draftId).error.code).toBe('disabled');
    expect(state).toEqual(before);
  }
});

test('send availability reflects original left, blocked and signed-out recipients without changing retained drafts', async () => {
  const { messageDraftCanSend } = await import('../frontend/src/messages-composition.js');
  for (const profile of listOSProfiles()) {
    const state = createMessagesState(profile), draft = state.drafts.find(row => row.id === state.selectedDraftId);
    draft.fields.body = 'Retained local draft café 東京';
    const conversation = state.conversations.find(row => row.id === draft.conversationId);
    expect(messageDraftCanSend(state, draft)).toBe(true);
    conversation.left = true; expect(messageDraftCanSend(state, draft)).toBe(false);
    conversation.left = false; state.blockedAddresses.push(conversation.participants[0]);
    expect(messageDraftCanSend(state, draft)).toBe(false);
    state.blockedAddresses.splice(0); state.account.signedIn = false;
    expect(messageDraftCanSend(state, draft)).toBe(false);
    expect(draft.fields.body).toBe('Retained local draft café 東京');
  }
});

test('Send availability and actual sending share Contacts resolution for blocked name aliases', async () => {
  const { messageDraftCanSend } = await import('../frontend/src/messages-composition.js');
  const state = createMessagesState(getOSProfile('macos-golden-gate-27.0.1'));
  const result = createMessageDraft(state, { to: 'Blocked Alias', body: 'Retained original alias draft' });
  const draft = state.drafts.find(row => row.id === result.target.draftId);
  const resolveRecipient = parsed => parsed.address === 'Blocked Alias' ? { name: 'Blocked Alias', address: 'blocked@jester.local' } : undefined;
  state.blockedAddresses.push('blocked@jester.local');
  expect(messageDraftCanSend(state, draft, resolveRecipient)).toBe(false);
  expect(sendMessageDraft(state, draft.id, { resolveRecipient }).error.code).toBe('disabled');
  expect(draft.fields.body).toBe('Retained original alias draft');
});


test('Send availability and sending resolve retained participant labels before reusing a left thread', async () => {
  const { messageDraftCanSend } = await import('../frontend/src/messages-composition.js');
  const state = createMessagesState(getOSProfile('macos-golden-gate-27.0.1'));
  const conversation = state.conversations[0];
  conversation.participants = ['Casey Alias']; conversation.left = true;
  const result = createMessageDraft(state, { to: 'casey@jester.local', body: 'Retained unsent endpoint draft' });
  const draft = state.drafts.find(row => row.id === result.target.draftId);
  const resolveRecipient = parsed => parsed.address === 'Casey Alias' ? { name: 'Casey Alias', address: 'casey@jester.local' } : undefined;
  const before = structuredClone(state);
  expect(messageDraftCanSend(state, draft, resolveRecipient)).toBe(false);
  expect(sendMessageDraft(state, draft.id, { resolveRecipient }).error.code).toBe('disabled');
  expect(state).toEqual(before);
});

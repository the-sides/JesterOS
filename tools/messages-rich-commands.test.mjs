import { expect, test } from 'bun:test';
import { getOSProfile, listOSProfiles } from '../frontend/src/os-profiles.js';
import { createMessagesState } from '../frontend/src/messages-state.js';
import { createMessagesCommands } from '../frontend/src/messages-commands.js';
import { validMessageAttachment, createMessageDraft, sendMessageDraft } from '../frontend/src/messages-composition.js';
import { AUDIO_FIXTURES } from '../frontend/src/audio-fixtures.js';
import { recipientIdentity } from '../frontend/src/messages-recipients.js';
import { createDomainNotificationBridges } from '../frontend/src/notification-commands.js';
import { notificationsDefaults, validateNotificationsState } from '../frontend/src/notification-model.js';
import { resolveNotificationDestination, retainNotificationDestination, notificationDestinationActions, validateNotificationDestinations } from '../frontend/src/notification-destinations.js';
import { createDefaultSceneSeed, validateSceneSeed, projectSceneSeed, rehydrateSceneSeed } from '../frontend/src/scene-seed.js';
import { createDefaultApplicationFiles } from '../frontend/src/default-application-files.js';
import { createApplicationFileBridges } from '../frontend/src/application-file-bridges.js';
import { canonicalStringUnits } from '../frontend/src/canonical-data.js';
import { PREVIEW_IMAGE_CONTENT } from '../frontend/src/preview-image-fixture.js';
import { createTextEditContent } from '../frontend/src/textedit-content.js';
import { encodeTextEditFile } from '../frontend/src/textedit-codec.js';
import { attachmentContent } from '../frontend/src/messages-rich-commands.js';

function fixture(profileId = 'macos-golden-gate-27.0.1', bridges = {}) {
  const profile = getOSProfile(profileId), state = createMessagesState(profile);
  const window = { id: 'message-window', appId: profile.family === 'windows' ? 'teams' : 'messages' };
  let liveWindow = window, liveState = state, live = true, allow = true;
  const files = new Map();
  const view = { available: () => true, describe: () => ({ controlIds: [], focusedControl: null }),
    setPanel: async (_panel, _open, guard) => guard(), quickLookAttachment: async (_attachment, guard) => guard(),
    draftSelection: () => ({ start: 0, end: 0, direction: 'none', value: state.drafts.find(draft => draft.id === state.selectedDraftId)?.fields.body ?? '' }),
    restoreDraftSelection: () => true };
  const ctx = { profile, getState: () => liveState, alive: () => live, getWindow: id => id === window.id ? liveWindow : null,
    getWindows: () => liveWindow ? [liveWindow] : [], getView: () => view, available: candidate => candidate === liveWindow,
    focusWindow: () => {}, settle: async () => {}, getSceneTime: () => state.timeBase, onTimeChanged: () => {},
    canCommit: () => allow,
    getFile: id => files.get(id) ?? null,
    resolveRecipient: parsed => parsed,
    ...bridges };
  const controller = createMessagesCommands(ctx);
  const conversation = state.conversations.find(row => row.id === state.selectedConversationId);
  return { ctx, state, controller, files, conversation, window, view,
    target: { windowId: window.id },
    conversationTarget: { windowId: window.id, conversationId: conversation.id },
    draftTarget: { windowId: window.id, draftId: state.selectedDraftId },
    messageTarget: { windowId: window.id, conversationId: conversation.id, messageId: conversation.items[0]?.id },
    setAllowed: value => { allow = value; }, retire: () => { live = false; liveWindow = null; },
    replaceWindow: () => { liveWindow = { ...window }; } };
}

test('rich preferences respect the complete candidate budget and reject accessor payloads unread', async () => {
  const scene = fixture(), before = structuredClone(scene.state);
  scene.setAllowed(false);
  const blocked = await scene.controller.handlers['messages.preferences.set'](scene.target, { key: 'textSize', value: 24 });
  expect(blocked.error.code).toBe('limit_exceeded');
  expect(scene.state).toEqual(before);
  let reads = 0;
  const payload = Object.defineProperty({ key: 'textSize' }, 'value', { enumerable: true, get() { reads++; return 24; } });
  const invalid = await scene.controller.handlers['messages.preferences.set'](scene.target, payload);
  expect(invalid.error.code).toBe('invalid_arguments');
  expect(reads).toBe(0);
  scene.setAllowed(true);
  expect((await scene.controller.handlers['messages.preferences.set'](scene.target, { key: 'textSize', value: 24 })).status).toBe('applied');
  expect(scene.state.preferences.textSize).toBe(24);
});

test('incoming text arrives atomically behind the real notification callback', async () => {
  const scene = fixture(undefined, { notifyMessage: async (spec, ownership) => {
    expect(ownership.guard()).toBe(true);
    expect(spec.source).toEqual({ kind: 'message', recordId: scene.conversation.id, windowId: scene.window.id });
    expect(spec.onCommit('notification-1')).toBe(true);
    return { status: 'applied', notificationId: 'notification-1' };
  } }), before = structuredClone(scene.state), items = scene.conversation.items.slice();
  const result = await scene.controller.handlers['messages.incoming.receive'](scene.conversationTarget,
    { fixtureId: 'trailhead-update' });
  expect(result.status).toBe('applied');
  expect(result.notificationId).toBe('notification-1');
  expect(scene.conversation.items.length).toBe(items.length + 1);
  expect(scene.conversation.unread).toBe(true);
  expect(scene.state.incomingFixtures).toEqual(['trailhead-update']);
  expect(scene.state.timeBase).toBeGreaterThan(before.timeBase);
  const replay = await scene.controller.handlers['messages.incoming.receive'](scene.conversationTarget, { fixtureId: 'trailhead-update' });
  expect(replay.error.code).toBe('disabled');
  expect(scene.state.incomingFixtures).toEqual(['trailhead-update']);
});

test('account Do not disturb still commits the authored record without any notification', async () => {
  const scene = fixture();
  let notified = 0;
  scene.ctx.notifyMessage = async () => { notified++; return { status: 'applied', notificationId: 'x' }; };
  scene.state.account.status = 'Do not disturb';
  const result = await scene.controller.handlers['messages.incoming.receive'](scene.conversationTarget, { fixtureId: 'trailhead-update' });
  expect(result.status).toBe('applied');
  expect(result.notificationSuppressed).toBe(true);
  expect(notified).toBe(0);
  expect(scene.state.incomingFixtures).toEqual(['trailhead-update']);
});

test('disabled, signed-out, blocked and left conversations refuse incoming without consuming the fixture', async () => {
  for (const mode of ['disabled', 'signedOut', 'blocked', 'left']) {
    const scene = fixture();
    if (mode === 'disabled') scene.state.account.enabled = false;
    if (mode === 'signedOut') scene.state.account.signedIn = false;
    if (mode === 'blocked') scene.state.blockedAddresses.push(recipientIdentity(scene.conversation.participants[0]));
    if (mode === 'left') scene.conversation.left = true;
    const before = structuredClone(scene.state);
    const result = await scene.controller.handlers['messages.incoming.receive'](scene.conversationTarget, { fixtureId: 'trailhead-update' });
    expect(result.error.code).toBe('disabled');
    expect(scene.state).toEqual(before);
  }
});

test('the harbor image fixture retains exact genuine PNG bytes with no invented file identity', async () => {
  const scene = fixture(undefined, { notifyMessage: async spec => { spec.onCommit('n2'); return { status: 'applied', notificationId: 'n2' }; } });
  const result = await scene.controller.handlers['messages.incoming.receive'](scene.conversationTarget, { fixtureId: 'harbor-map-arrival' });
  expect(result.status).toBe('applied');
  const item = scene.conversation.items.at(-1);
  expect(item.attachments).toHaveLength(1);
  const attachment = item.attachments[0];
  expect(validMessageAttachment(attachment)).toBe(true);
  expect(attachment.kind).toBe('image');
  expect(attachment.originalFileId).toBeNull();
  expect(attachment.originalRevision).toBeNull();
  const decoded = atob(attachment.dataURI.slice(attachment.dataURI.indexOf(',') + 1));
  expect(decoded.slice(0, 8)).toBe('\x89PNG\r\n\x1a\n');
  expect(attachment.byteLength).toBe(decoded.length);
});

test('reactions stay six historical tapbacks but accept real arbitrary emoji on modern profiles', async () => {
  const golden = fixture(), historical = fixture('macos-high-sierra-10.13'), messageTarget = { ...golden.messageTarget };
  const modern = await golden.controller.handlers['messages.message.react'](messageTarget, { emoji: '🚀' });
  expect(modern.status).toBe('applied');
  const item = golden.conversation.items[0];
  expect(item.reactions).toEqual([{ emoji: '🚀', participant: 'alex.morgan@jester.local' }]);
  expect((await golden.controller.handlers['messages.message.react'](messageTarget, { emoji: '🚀' })).status).toBe('applied');
  expect(item.reactions).toBeUndefined();
  const historicalReaction = await historical.controller.handlers['messages.message.react']({ windowId: 'message-window',
    conversationId: historical.conversation.id, messageId: historical.conversation.items[0]?.id }, { emoji: '🚀' });
  expect(historicalReaction.error.code).toBe('invalid_arguments');
  expect((await historical.controller.handlers['messages.message.react']({ windowId: 'message-window',
    conversationId: historical.conversation.id, messageId: historical.conversation.items[0]?.id }, { emoji: '❤️' })).status).toBe('applied');
});

test('draft audio attaches the genuine bundled PCM WAV with exact duration', async () => {
  const scene = fixture();
  const result = await scene.controller.handlers['messages.draft.audio'](scene.draftTarget, {});
  expect(result.status).toBe('applied');
  expect(result.target.attachmentId).toBe(`attachment-${scene.draftTarget.draftId}-1-1`);
  const attachment = scene.state.drafts.find(draft => draft.id === scene.state.selectedDraftId).attachments[0];
  expect(validMessageAttachment(attachment)).toBe(true);
  expect(attachment.kind).toBe('audio');
  expect(attachment.durationMs).toBe(AUDIO_FIXTURES.quicktime.duration * 1000);
  expect(attachment.originalFileId).toBeNull();
});

test('conversation delete requires explicit confirmation and repairs selected records', async () => {
  const scene = fixture();
  const unconfirmed = await scene.controller.handlers['messages.conversation.delete'](scene.conversationTarget, {});
  expect(unconfirmed.error.code).toBe('invalid_arguments');
  const result = await scene.controller.handlers['messages.conversation.delete'](scene.conversationTarget, { confirmed: true });
  expect(result.status).toBe('applied');
  expect(scene.state.conversations.some(row => row.id === scene.conversation.id)).toBe(false);
  expect(scene.state.drafts.some(draft => draft.conversationId === scene.conversation.id)).toBe(false);
  expect(scene.state.selectedConversationId).toBeNull();
  expect(scene.state.selectedDraftId).toBeNull();
});

test('participant removal updates the owned draft recipients atomically and refuses silent merges', async () => {
  const scene = fixture();
  scene.state.account.address = 'alex.morgan@jester.local';
  scene.conversation.participants = ['Casey Rivera <casey@jester.local>', 'Jordan Lee <jordan@jester.local>'];
  const draft = scene.state.drafts.find(row => row.conversationId === scene.conversation.id);
  const result = await scene.controller.handlers['messages.conversation.removeParticipant'](scene.conversationTarget,
    { address: 'jordan@jester.local', confirmed: true });
  expect(result.status).toBe('applied');
  expect(scene.conversation.participants).toEqual(['Casey Rivera <casey@jester.local>']);
  expect(draft.fields.to).toBe('Casey Rivera <casey@jester.local>');
  expect(draft.revision).toBeGreaterThan(1);
  const collision = scene.state.conversations.find(row => row !== scene.conversation && row.participants.length === 1);
  if (collision) {
    scene.conversation.participants = ['Casey Rivera <casey@jester.local>', 'Jordan Lee <jordan@jester.local>'];
    collision.participants = ['Casey Rivera <casey@jester.local>'];
    const refused = await scene.controller.handlers['messages.conversation.removeParticipant'](scene.conversationTarget,
      { address: 'jordan@jester.local', confirmed: true });
    expect(refused.error.code).toBe('disabled');
  }
});

test('Delete Conversation menu opens the original confirmation without silently deleting', async () => {
  const { messagesAppMenuProviders } = await import('../frontend/src/messages-app-menus.js');
  const scene = fixture('macos-mojave-10.14');
  const menus = messagesAppMenuProviders({ state: scene.state, profile: scene.ctx.profile, windowId: scene.window.id, available: true });
  const row = menus.flatMap(menu => menu.items).find(item => item.request?.payload?.panel === 'delete');
  const before = structuredClone(scene.state), request = row.request;
  expect(request.payload).toEqual({ panel: 'delete', open: true });
  expect((await scene.controller.handlers[request.command](request.target, request.payload)).status).toBe('applied');
  expect(scene.state).toEqual(before);
});

test('a caret-only change during atomic clipboard preparation refuses both cut graphs', async () => {
  let release, clipboard = { kind: 'text', text: 'original clipboard', fileIds: [] };
  const prepared = new Promise(resolve => { release = resolve; });
  const scene = fixture(undefined, { setClipboard: async (spec, ownership) => {
    await prepared;
    if (!ownership.guard() || spec.onCommit() !== true)
      return { status: 'rejected', error: { code: 'stale_target', message: 'The exact original native selection changed.' } };
    clipboard = { kind: spec.kind, text: spec.text, fileIds: [] };
    return { status: 'applied' };
  } });
  const draft = scene.state.drafts.find(row => row.id === scene.state.selectedDraftId);
  draft.fields.body = 'north coast';
  const capture = { node: {}, field: 'body', draftId: draft.id, start: 0, end: 5, direction: 'forward', value: draft.fields.body, readOnly: false };
  scene.view.editSelection = () => ({ ...capture });
  scene.view.restoreEditSelection = () => true;
  scene.view.editInteraction = () => 0;
  const before = structuredClone(scene.state);
  const pending = scene.controller.handlers['messages.edit.cut'](scene.target, {});
  capture.end = 2; release();
  expect((await pending).error.code).toBe('stale_target');
  expect(scene.state).toEqual(before);
  expect(clipboard.text).toBe('original clipboard');
});

test('notification acknowledgement preserves incoming PNG even after original window retirement', async () => {
  const scene = fixture(undefined, { notifyMessage: async spec => {
    expect(spec.onCommit('retiring-notification')).toBe(true);
    scene.retire();
    throw new Error('Original presentation retired after actual acknowledgement');
  } });
  const result = await scene.controller.handlers['messages.incoming.receive'](scene.conversationTarget, { fixtureId: 'harbor-map-arrival' });
  expect(result.status).toBe('applied');
  expect(result.notificationId).toBe('retiring-notification');
  expect(result.presentationAvailable).toBe(false);
  expect(scene.conversation.items.at(-1).attachments[0].kind).toBe('image');
  expect(scene.state.incomingFixtures).toEqual(['harbor-map-arrival']);
});

test('over-budget PNG arrival never consumes its fixture or creates a notification', async () => {
  let posted = 0;
  const scene = fixture(undefined, { notifyMessage: async () => { posted++; return { status: 'applied' }; } });
  const before = structuredClone(scene.state);
  scene.setAllowed(false);
  const result = await scene.controller.handlers['messages.incoming.receive'](scene.conversationTarget, { fixtureId: 'harbor-map-arrival' });
  expect(result.error.code).toBe('limit_exceeded');
  expect(scene.state).toEqual(before);
  expect(posted).toBe(0);
});

test('notification opening preflights the original thread without a native window and commits selection once', () => {
  const scene = fixture(), conversation = scene.state.conversations.find(row => row !== scene.conversation);
  scene.state.query = 'no match'; conversation.unread = true;
  const prepared = scene.controller.prepareNotificationOpen(conversation.id, { guard: () => true });
  expect(prepared.recordId).toBe(conversation.id);
  expect(prepared.commit()).toBe(true);
  expect(scene.state.query).toBe('');
  expect(scene.state.selectedConversationId).toBe(conversation.id);
  expect(conversation.unread).toBe(false);
  expect(prepared.commit()).toBe(false);
});

test('an attachment never borrows a source file whose revision changed during preparation', async () => {
  const scene = fixture(), file = { id: 'original-text', name: 'Original.txt', mime: 'text/plain', content: 'original contents',
    kind: 'document', parentId: 'documents', revision: 1, deleted: false };
  scene.files.set(file.id, file);
  const before = structuredClone(scene.state);
  const pending = scene.controller.handlers['messages.draft.attach'](scene.draftTarget, { fileId: file.id });
  file.content = 'changed contents'; file.revision++;
  expect((await pending).error.code).toBe('stale_target');
  expect(scene.state).toEqual(before);
});

test('user caret movement during settled emoji presentation survives the acknowledged body insertion', async () => {
  let release, interactions = 0, restored = 0;
  const settled = new Promise(resolve => { release = resolve; });
  const scene = fixture(undefined, { settle: () => settled });
  const draft = scene.state.drafts.find(row => row.id === scene.state.selectedDraftId);
  draft.fields.body = 'north coast';
  scene.view.draftSelection = () => ({ start: 0, end: 5, direction: 'forward', value: draft.fields.body });
  scene.view.editInteraction = () => interactions;
  scene.view.restoreDraftSelection = () => { restored++; return true; };
  const pending = scene.controller.handlers['messages.draft.emoji'](scene.draftTarget, { value: '🚀' });
  interactions++; release();
  const result = await pending;
  expect(result.status).toBe('applied');
  expect(draft.fields.body).toBe('🚀 coast');
  expect(result.presentation.caretRestored).toBe(false);
  expect(restored).toBe(0);
});

test('independent recipient composers retain distinct attachment identities after joining the same thread', async () => {
  const scene = fixture(), file = { id: 'text-source', name: 'Notes.txt', mime: 'text/plain', content: 'original notes',
    kind: 'document', parentId: 'documents', revision: 1, deleted: false };
  scene.files.set(file.id, file);
  const attachmentIds = [];
  for (const body of ['First note', 'Second note']) {
    const created = createMessageDraft(scene.state, { to: scene.conversation.participants.join(', '), body });
    expect(created.status).toBe('applied');
    const attached = await scene.controller.handlers['messages.draft.attach']({ windowId: scene.window.id, draftId: created.target.draftId }, { fileId: file.id });
    expect(attached.status).toBe('applied'); attachmentIds.push(attached.target.attachmentId);
    const sent = sendMessageDraft(scene.state, created.target.draftId, { resolveRecipient: parsed => parsed });
    expect(sent.status).toBe('applied');
    expect(sent.target.conversationId).toBe(scene.conversation.id);
    expect(scene.conversation.items.at(-1).attachments[0].id).toBe(attached.target.attachmentId);
  }
  expect(new Set(attachmentIds).size).toBe(2);
});

test('native undo and redo traverse the exact original body edit history', async () => {
  const clipboard = { kind: 'text', text: 'Literal addition', fileIds: [] };
  const scene = fixture(undefined, { getClipboard: () => clipboard });
  const draft = scene.state.drafts.find(row => row.id === scene.state.selectedDraftId), before = draft.fields.body, node = {};
  let start = before.length, end = before.length;
  scene.view.editInteraction = () => 0;
  scene.view.editSelection = () => ({ node, field: 'body', draftId: draft.id, value: draft.fields.body, start, end, direction: 'none', readOnly: false });
  scene.view.restoreEditSelection = (_selection, range, guard) => { if (!guard()) return false; start = range.start; end = range.end; return true; };
  expect((await scene.controller.handlers['messages.edit.paste'](scene.target, {})).status).toBe('applied');
  expect(draft.fields.body).toBe(`${before}Literal addition`);
  expect(scene.controller.editingAvailability(scene.window.id).undo).toBe(true);
  expect((await scene.controller.handlers['messages.edit.undo'](scene.target, {})).status).toBe('applied');
  expect(draft.fields.body).toBe(before);
  expect(scene.controller.editingAvailability(scene.window.id).redo).toBe(true);
  expect((await scene.controller.handlers['messages.edit.redo'](scene.target, {})).status).toBe('applied');
  expect(draft.fields.body).toBe(`${before}Literal addition`);
});

test('saving UTF8 text preserves its literal BOM bytes', async () => {
  const profile = getOSProfile('macos-golden-gate-27.0.1');
  const seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles });
  const files = createApplicationFileBridges({ profile, getStore: () => seed.files, alive: () => true,
    getSceneTime: () => seed.files.sceneTime, canCommit: () => true, reserve: (_, commit) => commit() });
  const scene = fixture(profile.id, { ...files,
    saveAttachmentFile: (spec, ownership) => files.createFile({ name: spec.name, mime: spec.mime, text: spec.text, folderId: 'documents' }, ownership) });
  const text = '\uFEFFnorth', bytes = new TextEncoder().encode(text);
  scene.conversation.items[0].attachments = [{ id: 'bom-text', name: 'BOM.txt', mime: 'text/plain',
    dataURI: `data:text/plain;base64,${btoa(String.fromCharCode(...bytes))}`, byteLength: bytes.length,
    originalFileId: null, originalRevision: null, kind: 'file', durationMs: null }];
  const result = await scene.controller.handlers['messages.attachment.save']({ windowId: scene.window.id,
    conversationId: scene.conversation.id, messageId: scene.conversation.items[0].id, attachmentId: 'bom-text' }, {});
  expect(result.status).toBe('applied');
  expect(files.getFile(result.fileId).content).toBe(text);
  expect(new TextEncoder().encode(files.getFile(result.fileId).content)).toEqual(bytes);
  seed.messages = scene.state;
  expect(validateSceneSeed(seed, profile).ok).toBe(true);
});

test('a genuine empty shared text File becomes an exact zero-byte draft attachment', async () => {
  const scene = fixture(), file = { id: 'empty-text', name: 'Empty.txt', mime: 'text/plain', content: '',
    kind: 'document', parentId: 'documents', revision: 1, deleted: false };
  scene.files.set(file.id, file);
  const result = await scene.controller.handlers['messages.draft.attach'](scene.draftTarget, { fileId: file.id });
  expect(result.status).toBe('applied');
  const attachment = scene.state.drafts.find(row => row.id === scene.draftTarget.draftId).attachments[0];
  expect(attachment.byteLength).toBe(0);
  expect(attachment.dataURI).toBe('data:text/plain;base64,');
  expect(attachment.originalFileId).toBe(file.id);
  expect(validMessageAttachment(attachment)).toBe(true);
});


test('message file copy and native body paste retain actual live sources and commit all attachments once', async () => {
  let clipboard = { kind: 'empty', text: '', fileIds: [] };
  const scene = fixture(undefined, { getClipboard: () => clipboard, setClipboard: (spec, ownership) => {
    if (!ownership.guard()) return { status: 'rejected', error: { code: 'stale_target', message: 'Original source changed.' } };
    clipboard = { kind: spec.kind, text: spec.text, fileIds: [...spec.fileIds] }; return { status: 'applied' };
  } });
  const draft = scene.state.drafts.find(row => row.id === scene.state.selectedDraftId);
  draft.fields.body = '';
  for (const [id, content] of [['first-text', 'Literal first 🌊'], ['second-text', 'Second\nline']]) {
    scene.files.set(id, { id, name: `${id}.txt`, mime: 'text/plain', content, kind: 'document', revision: 1, deleted: false });
    expect((await scene.controller.handlers['messages.draft.attach']({ windowId: scene.window.id, draftId: draft.id }, { fileId: id })).status).toBe('applied');
  }
  expect(sendMessageDraft(scene.state, draft.id).status).toBe('applied');
  const message = scene.conversation.items.at(-1);
  expect((await scene.controller.handlers['messages.message.copy']({ ...scene.conversationTarget, messageId: message.id }, {})).status).toBe('applied');
  expect(clipboard).toEqual({ kind: 'files', text: '', fileIds: ['first-text', 'second-text'] });
  const node = {}, revision = draft.revision;
  scene.view.editInteraction = () => 0;
  scene.view.editSelection = () => ({ node, field: 'body', draftId: draft.id, value: draft.fields.body, start: 0, end: 0, direction: 'none', readOnly: false });
  scene.view.restoreEditSelection = () => true;
  expect((await scene.controller.handlers['messages.edit.paste'](scene.target, {})).status).toBe('applied');
  expect(draft.revision).toBe(revision + 1);
  expect(draft.attachments.map(row => row.originalFileId)).toEqual(clipboard.fileIds);
  expect(new Set(draft.attachments.map(row => row.id)).size).toBe(2);
  expect(draft.fields.body).toBe('');
  scene.files.set('first-text', { ...scene.files.get('first-text') });
  scene.files.get('first-text').content = 'Different actual revision contents';
  const before = clipboard;
  const failed = await scene.controller.handlers['messages.message.copy']({ ...scene.conversationTarget, messageId: message.id }, {});
  expect(failed.error.code).toBe('unsupported_content');
  expect(clipboard).toBe(before);
});

test('clipboard equal-valued replacement during paste preflight cannot lend a different source identity', async () => {
  let clipboard = { kind: 'text', text: 'Incoming literal', fileIds: [] };
  const scene = fixture(undefined, { getClipboard: () => clipboard });
  const draft = scene.state.drafts.find(row => row.id === scene.state.selectedDraftId), body = draft.fields.body, node = {};
  scene.view.editInteraction = () => 0;
  scene.view.editSelection = () => ({ node, field: 'body', draftId: draft.id, value: draft.fields.body, start: 0, end: 0, direction: 'none', readOnly: false });
  scene.view.restoreEditSelection = () => true;
  scene.ctx.canCommit = () => { clipboard = { ...clipboard, fileIds: [...clipboard.fileIds] }; return true; };
  const failed = await scene.controller.handlers['messages.edit.paste'](scene.target, {});
  expect(failed.error.code).toBe('stale_target');
  expect(draft.fields.body).toBe(body);
});

for (const profile of listOSProfiles()) {
  test(`${profile.id}: actual incoming producer publishes the original conversation under its one native messaging application`, async () => {
    const scene = fixture(profile.id), notifications = notificationsDefaults(), sources = { messages: scene.state };
    const nativeAppId = profile.family === 'windows' ? 'teams' : 'messages';
    const wrongAppId = nativeAppId === 'teams' ? 'messages' : 'teams';
    const original = scene.conversation, originalItems = original.items.length;
    const bridges = createDomainNotificationBridges({ profile, getState: () => notifications,
      alive: () => true, getSceneTime: scene.ctx.getSceneTime, canCommit: () => true,
      reserve: (_, commit) => commit(),
      retainDestination: entry => retainNotificationDestination(entry, () => sources, profile, () => true) });
    scene.ctx.notifyMessage = bridges.notify;
    const prospective = { appId: nativeAppId, destination: { kind: 'message', recordId: original.id } };
    expect(resolveNotificationDestination(prospective, sources, profile).record).toBe(original);
    expect(resolveNotificationDestination({ ...prospective, appId: wrongAppId }, sources, profile)).toBeNull();
    const result = await scene.controller.handlers['messages.incoming.receive'](scene.conversationTarget, { fixtureId: 'trailhead-update' });
    expect(result.status).toBe('applied');
    expect(scene.state.conversations.find(row => row.id === original.id)).toBe(original);
    expect(original.items).toHaveLength(originalItems + 1);
    const actual = notifications.entries[0];
    expect(notifications.entries).toHaveLength(1); expect(actual.id).toBe(result.notificationId);
    expect(actual.appId).toBe(nativeAppId); expect(actual.destination).toEqual(prospective.destination);
    expect(resolveNotificationDestination(actual, sources, profile).record).toBe(original);
    expect(notificationDestinationActions(resolveNotificationDestination(actual, sources, profile))).toEqual(['open', 'reply']);
    expect(resolveNotificationDestination({ ...actual, appId: wrongAppId }, sources, profile)).toBeNull();
    expect(validateNotificationsState(notifications, profile).ok).toBe(true);
    const seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles });
    seed.messages = scene.state; seed.system.notifications = notifications;
    expect(validateSceneSeed(seed, profile).ok).toBe(true);
    expect(validateSceneSeed(structuredClone(seed), profile).ok).toBe(true);
    expect(validateNotificationDestinations(seed, profile).ok).toBe(true);
    const cold = rehydrateSceneSeed(projectSceneSeed(seed, profile), profile);
    expect(validateSceneSeed(cold, profile).ok).toBe(true);
    expect(cold.messages).toEqual(scene.state);
    expect(cold.system.notifications).toEqual(notifications);
    expect(resolveNotificationDestination(cold.system.notifications.entries[0], cold, profile).record)
      .toBe(cold.messages.conversations.find(row => row.id === original.id));
    const lease = retainNotificationDestination(actual, () => sources, profile, () => true);
    scene.state.conversations = scene.state.conversations.map(row => row === original ? { ...row } : row);
    expect(lease.current()).toBe(false);
    scene.state.conversations = scene.state.conversations.filter(row => row.id !== original.id);
    expect(resolveNotificationDestination(actual, sources, profile)).toBeNull();
    expect(validateNotificationDestinations(seed, profile).ok).toBe(false);
  });
}

test('legacy received attachment commits genuine Files, original message and notification together or none under combined quota', async () => {
  for (const profileId of ['macos-high-sierra-10.13', 'macos-mojave-10.14']) {
    for (const blocked of [false, true]) {
      const profile = getOSProfile(profileId), seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles });
      const scene = fixture(profileId), notifications = notificationsDefaults();
      scene.state.preferences.receivedFilesFolderId = 'documents';
      let reserved = 0;
      const units = () => canonicalStringUnits({ messages: scene.state, files: seed.files, notifications });
      const initial = units(), limit = blocked ? initial + PREVIEW_IMAGE_CONTENT.length + 100 : initial + 4 * 1024 * 1024;
      const reserve = (delta, operation) => { reserved += delta; try { return operation(); } finally { reserved -= delta; } };
      const canCommit = delta => units() + reserved + delta <= limit;
      const files = createApplicationFileBridges({ profile, getStore: () => seed.files, alive: () => true,
        getSceneTime: () => scene.state.timeBase, canCommit, reserve });
      const bridges = createDomainNotificationBridges({ profile, getState: () => notifications, alive: () => true,
        getSceneTime: () => scene.state.timeBase, canCommit, reserve,
        retainDestination: entry => retainNotificationDestination(entry, () => ({ messages: scene.state }), profile, () => true) });
      scene.ctx.createFile = files.createFile;
      scene.ctx.notifyMessage = bridges.notify;
      scene.ctx.canCommit = candidate => canCommit(canonicalStringUnits(candidate) - canonicalStringUnits(scene.state));
      const before = structuredClone({ messages: scene.state, files: seed.files, notifications });
      const result = await scene.controller.handlers['messages.incoming.receive'](scene.conversationTarget, { fixtureId: 'harbor-map-arrival' });
      if (blocked) {
        expect(result.status).toBe('rejected');
        expect({ messages: scene.state, files: seed.files, notifications }).toEqual(before);
      } else {
        expect(result.status).toBe('applied');
        const saved = files.getFile(result.savedFileId), retained = scene.conversation.items.at(-1).attachments[0];
        expect(saved.parentId).toBe('documents');
        expect(saved.content).toBe(PREVIEW_IMAGE_CONTENT);
        expect(saved.content).toBe(retained.dataURI);
        expect(saved.mime).toBe(retained.mime);
        expect(saved.revision).toBe(1);
        expect(retained.originalFileId).toBeNull();
        expect(notifications.entries).toHaveLength(1);
        expect(scene.state.incomingFixtures).toEqual(['harbor-map-arrival']);
      }
    }
  }
});

test('real PNG draft preparation cannot borrow an equal-valued replacement or retired original File across decoder awaits', async () => {
  for (const change of ['replacement', 'retirement', 'revision']) {
    const scene = fixture(), source = { id: 'preview-harbor-image', name: 'Harbor Scene.png', mime: 'image/png',
      kind: 'image', content: PREVIEW_IMAGE_CONTENT, parentId: 'documents', revision: 1, deleted: false };
    scene.files.set(source.id, source);
    const before = structuredClone(scene.state);
    const pending = scene.controller.handlers['messages.draft.attach'](scene.draftTarget, { fileId: source.id });
    if (change === 'replacement') scene.files.set(source.id, { ...source });
    else if (change === 'retirement') scene.files.delete(source.id);
    else { source.revision++; source.name = 'Changed original.png'; }
    const result = await pending;
    expect(result.status).toBe('rejected');
    expect(result.error.code).toBe('stale_target');
    expect(scene.state).toEqual(before);
  }
});

test('native UTF8 text parameters preserve complete attachment bytes and original File identity without mutating Files', async () => {
  const profile = getOSProfile('macos-high-sierra-10.13'), seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles });
  const files = createApplicationFileBridges({ profile, getStore: () => seed.files, alive: () => true,
    getSceneTime: () => Date.parse(profile.defaults.sceneTime), canCommit: () => true });
  const text = '\uFEFFdata:text/plain;base64,this is literal native text — café 🏔️\n', encoded = encodeTextEditFile(createTextEditContent(text, 'plain'));
  const saved = files.createFile({ name: 'Actual native text.txt', ...encoded });
  expect(saved.status).toBe('applied');
  const before = structuredClone(seed.files), source = files.getFile(saved.fileId), original = structuredClone(source);
  const scene = fixture(profile.id, { getFile: files.getFile,
    saveAttachmentFile: (spec, ownership) => files.createFile({ name: 'Retained native text.txt', mime: spec.mime, content: spec.text }, ownership) });
  const attached = await scene.controller.handlers['messages.draft.attach'](scene.draftTarget, { fileId: saved.fileId });
  expect(attached.status).toBe('applied');
  const attachment = scene.state.drafts.find(d => d.id === scene.draftTarget.draftId).attachments[0];
  expect(attachment.originalFileId).toBe(saved.fileId);
  expect(attachment.originalRevision).toBe(1);
  const retained = Uint8Array.from(atob(attachment.dataURI.split(',')[1]), c => c.charCodeAt(0));
  expect(retained).toEqual(new TextEncoder().encode(text));
  const sent = sendMessageDraft(scene.state, scene.draftTarget.draftId);
  expect(sent.status).toBe('applied');
  const message = scene.conversation.items.at(-1), sentAttachment = message.attachments[0];
  expect(sentAttachment.originalFileId).toBe(saved.fileId);
  expect(sentAttachment.originalRevision).toBe(1);
  expect(Uint8Array.from(atob(sentAttachment.dataURI.split(',')[1]), c => c.charCodeAt(0)))
    .toEqual(new TextEncoder().encode(text));
  expect(seed.files).toEqual(before);
  const retainedFile = await scene.controller.handlers['messages.attachment.save']({
    ...scene.messageTarget, messageId: message.id, attachmentId: sentAttachment.id }, {});
  expect(retainedFile.status).toBe('applied');
  const copy = files.getFile(retainedFile.fileId);
  expect(copy.mime).toBe(source.mime);
  expect(copy.content).toBe(source.content);
  expect(copy.content).toBe(text);
  expect(copy.id).not.toBe(source.id);
  expect(files.getFile(saved.fileId)).toBe(source);
  expect(source).toEqual(original);
});

test('native encoded text byte wrappers cannot be mistaken for literal UTF8 attachment bytes', async () => {
  for (const encoding of ['utf-16le', 'windows-1252']) {
    const encoded = encodeTextEditFile(createTextEditContent('Original café — €\n', 'plain'), encoding), scene = fixture();
    const file = { id: 'encoded-original', name: 'Encoded original.txt', mime: encoded.mime, content: encoded.text,
      encoding, kind: 'document', revision: 1, deleted: false };
    scene.files.set(file.id, file);
    const before = structuredClone(scene.state), result = await scene.controller.handlers['messages.draft.attach'](scene.draftTarget, { fileId: file.id });
    expect(result.error.code).toBe('unsupported_content');
    expect(scene.state).toEqual(before);
    expect(scene.files.get(file.id)).toBe(file);
    expect(file.content).toBe(encoded.text);
  }
});

for (const unicode of [false, true]) test(`actual ${unicode ? 'Unicode Files-authored' : 'original Studio'} legacy SVG retains bytes through send, Save and unchanged/changed source Open`, async () => {
  const profile = getOSProfile('windows11-23h2-22631.2428');
  const seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles });
  const files = createApplicationFileBridges({ profile, getStore: () => seed.files, alive: () => true,
    getSceneTime: () => Date.parse(profile.defaults.sceneTime), canCommit: () => true });
  let source = files.getFile('studio-photo');
  expect(source.name).toBe('Studio.svg');
  expect(source.content.startsWith('<svg')).toBe(true);
  if (unicode) {
    const authored = files.createFile({ name: 'Unicode Studio.svg', mime: 'image/svg+xml; charset=utf-8',
      text: source.content.replace('</svg>', '<text x="10" y="30">Studio café Ω 🌊</text></svg>'), encoding: 'utf8' });
    expect(authored.status).toBe('applied');
    source = files.getFile(authored.fileId);
  }
  const original = structuredClone(source), before = structuredClone(seed.files);
  const scene = fixture(profile.id, { getFile: files.getFile,
    // Consume the actual committed Files record, not a reflected command payload.
    openFile: (fileId, _options, ownership) => files.readFile(fileId, ownership),
    saveAttachmentFile: (spec, ownership) => files.createFile({
      name: `Retained ${seed.files.nextFileId}.svg`, mime: spec.mime, text: spec.text }, ownership) });
  expect((await scene.controller.handlers['messages.draft.attach'](scene.draftTarget, { fileId: source.id })).status).toBe('applied');
  const draftAttachment = scene.state.drafts.find(row => row.id === scene.draftTarget.draftId).attachments[0];
  expect(validMessageAttachment(draftAttachment)).toBe(true);
  expect(draftAttachment.kind).toBe('image');
  expect(draftAttachment.mime).toBe(original.mime);
  expect([draftAttachment.originalFileId, draftAttachment.originalRevision]).toEqual([original.id, original.revision]);
  const bytes = new TextEncoder().encode(original.content);
  expect(draftAttachment.byteLength).toBe(bytes.length);
  expect(draftAttachment.dataURI.startsWith('data:image/svg+xml;base64,')).toBe(true);
  expect(Uint8Array.from(atob(draftAttachment.dataURI.split(',')[1]), char => char.charCodeAt(0))).toEqual(bytes);
  expect(attachmentContent(draftAttachment)).toBe(original.content);
  expect(sendMessageDraft(scene.state, scene.draftTarget.draftId).status).toBe('applied');
  const message = scene.conversation.items.at(-1), retained = message.attachments[0];
  expect(retained).toEqual(draftAttachment);
  expect(seed.files).toEqual(before);
  const target = { ...scene.messageTarget, messageId: message.id, attachmentId: retained.id };
  const unchanged = await scene.controller.handlers['messages.attachment.open'](target, {});
  expect(unchanged.status).toBe('applied');
  expect(unchanged.destination.file).toBe(source);
  expect(unchanged.destination.text).toBe(original.content);
  expect(seed.files).toEqual(before); // No Save/materialized substitute on unchanged revision.
  const saved = await scene.controller.handlers['messages.attachment.save'](target, {});
  expect(saved.status).toBe('applied');
  const copy = files.getFile(saved.fileId);
  expect([copy.content, copy.mime]).toEqual([original.content, original.mime]);
  expect(copy.id).not.toBe(original.id);
  expect(source).toEqual(original);
  const revised = files.createFile({ name: source.name, mime: source.mime, existingFileId: source.id,
    expectedRevision: source.revision, text: source.content.replace('</svg>', '<text>Changed source</text></svg>') });
  expect(revised.status).toBe('applied');
  const current = structuredClone(files.getFile(source.id)), stateBefore = structuredClone(scene.state);
  const opened = await scene.controller.handlers['messages.attachment.open'](target, {});
  expect(opened.status).toBe('applied');
  expect(opened.fileId).not.toBe(original.id);
  expect(files.getFile(opened.fileId).content).toBe(original.content);
  expect(files.getFile(opened.fileId).mime).toBe(original.mime);
  expect(opened.presentation.result.destination.file).toBe(files.getFile(opened.fileId));
  expect(opened.presentation.result.destination.text).toBe(original.content);
  expect(files.getFile(original.id)).toEqual(current);
  expect(scene.state).toEqual(stateBefore);
  expect(retained.dataURI).toBe(draftAttachment.dataURI);
});

for (const invalid of ['lone-surrogate', 'binary', 'wrong-encoding', 'wrong-charset', 'malformed-utf8', 'noncanonical-base64'])
  test(`legacy SVG attachments reject ${invalid} without replacing source bytes`, async () => {
    const scene = fixture(), content = '<svg xmlns="http://www.w3.org/2000/svg"><text>café 🌊</text></svg>';
    const source = { id: 'actual-svg', name: 'Actual.svg', mime: 'image/svg+xml', content, revision: 1, kind: 'image', deleted: false };
    if (invalid === 'lone-surrogate') source.content = content.replace('café', '\ud800');
    if (invalid === 'binary') source.content = '\u0000\u00ffPNG binary';
    if (invalid === 'wrong-encoding') source.encoding = 'utf-16le';
    if (invalid === 'wrong-charset') source.mime += '; charset=windows-1252';
    if (invalid === 'malformed-utf8') source.content = `data:image/svg+xml;base64,${btoa('<svg>\xc3\x28</svg>')}`;
    if (invalid === 'noncanonical-base64') source.content = 'data:image/svg+xml;base64,PHN2Zz4';
    scene.files.set(source.id, source);
    const before = structuredClone(scene.state), original = structuredClone(source);
    const result = await scene.controller.handlers['messages.draft.attach'](scene.draftTarget, { fileId: source.id });
    expect(result.error.code).toBe('unsupported_content');
    expect(scene.state).toEqual(before);
    expect(scene.files.get(source.id)).toBe(source);
    expect(source).toEqual(original);
  });

test('received attachment destinations reject Trash and read-only folders without publishing preferences or Files', async () => {
  const profile = getOSProfile('macos-high-sierra-10.13');
  const seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles });
  const files = createApplicationFileBridges({ profile, getStore: () => seed.files, alive: () => true,
    getSceneTime: () => Date.parse(profile.defaults.sceneTime), canCommit: () => true });
  const scene = fixture(profile.id, { getFile: files.getFile });
  const documents = files.getFile('documents'), beforeFiles = structuredClone(seed.files);
  const beforeMessages = structuredClone(scene.state);
  for (const destination of [files.getFile('trash'), { ...documents, readOnly: true }]) {
    scene.ctx.getFile = id => id === destination.id ? destination : files.getFile(id);
    const result = await scene.controller.handlers['messages.preferences.set'](scene.target,
      { key: 'receivedFilesFolderId', value: destination.id });
    expect(result.error.code).toBe('stale_target');
    expect(scene.state).toEqual(beforeMessages);
    expect(seed.files).toEqual(beforeFiles);
  }
  const discarded = files.createFile({ name: 'Received café.txt', mime: 'text/plain;charset=utf-8',
    text: 'Actual received text — 東京\n', folderId: 'trash' });
  expect(discarded.error.code).toBe('stale_target');
  expect(seed.files).toEqual(beforeFiles);
  scene.ctx.getFile = files.getFile;
  expect((await scene.controller.handlers['messages.preferences.set'](scene.target,
    { key: 'receivedFilesFolderId', value: 'documents' })).status).toBe('applied');
  expect(scene.state.preferences.receivedFilesFolderId).toBe('documents');
  const saved = files.createFile({ name: 'Received café.txt', mime: 'text/plain;charset=utf-8',
    text: 'Actual received text — 東京\n', folderId: scene.state.preferences.receivedFilesFolderId });
  expect(saved.status).toBe('applied');
  expect(files.readFile(saved.fileId).text).toBe('Actual received text — 東京\n');
  expect(files.getFile(saved.fileId).parentId).toBe('documents');
});

test('Details section navigation retains the selected original conversation and rejects replacement owners', async () => {
  for (const profile of listOSProfiles()) {
    const scene = fixture(profile.id), before = structuredClone(scene.state);
    let displayed = null;
    scene.view.setDetailsSection = async (section, _discard, guard) => { if (!guard()) return false; displayed = section; return true; };
    const handler = scene.controller.handlers['messages.details.navigate'];
    expect((await handler(scene.conversationTarget, { section: 'location' })).status).toBe('applied');
    expect(displayed).toBe('location'); expect(scene.state).toEqual(before);
    expect((await handler(scene.conversationTarget, { section: 'location', discard: true })).error.code).toBe('invalid_arguments');
    expect((await handler(scene.conversationTarget, { section: 'summary', discard: true })).status).toBe('applied');
    if (scene.conversation.participants.length < 2)
      expect((await handler(scene.conversationTarget, { section: 'name' })).error.code).toBe('disabled');
    scene.view.setDetailsSection = async (_section, _discard, guard) => { scene.replaceWindow(); return guard(); };
    expect((await handler(scene.conversationTarget, { section: 'photos' })).error.code).toBe('stale_target');
    expect(scene.state).toEqual(before);
  }
});

test('attachment presentation preserves original retained bytes and refuses ambiguous or replaced owners', async () => {
  const scene = fixture(), draft = scene.state.drafts.find(row => row.id === scene.state.selectedDraftId);
  scene.files.set('original-image', { id: 'original-image', name: 'Original.png', mime: 'image/png', content: PREVIEW_IMAGE_CONTENT, revision: 1 });
  draft.attachments.push({ id: 'original-image-attachment', name: 'Original.png', mime: 'image/png', dataURI: PREVIEW_IMAGE_CONTENT,
    byteLength: atob(PREVIEW_IMAGE_CONTENT.split(',')[1]).length, originalFileId: 'original-image', originalRevision: 1, kind: 'image', durationMs: null });
  expect(validMessageAttachment(draft.attachments[0])).toBe(true);
  const attachment = draft.attachments[0], target = { ...scene.draftTarget, attachmentId: attachment.id }, before = structuredClone(scene.state);
  let observed = null;
  scene.view.setAttachmentPreview = async (id, payload, guard) => { if (!guard()) return false; observed = { target: id, payload }; return true; };
  const preview = scene.controller.handlers['messages.attachment.preview'];
  expect((await preview(target, { expanded: true })).status).toBe('applied');
  expect(observed).toEqual({ target, payload: { expanded: true } });
  expect((await preview(target, { page: 1 })).error.code).toBe('disabled');
  expect((await preview({ ...target, conversationId: scene.conversation.id }, { expanded: true })).error.code).toBe('invalid_arguments');
  expect((await preview(target, { expanded: true, page: 1 })).error.code).toBe('invalid_arguments');
  scene.view.setAttachmentPreview = async (_id, _payload, guard) => { scene.replaceWindow(); return guard(); };
  expect((await preview(target, { expanded: false })).error.code).toBe('stale_target');
  expect(scene.state).toEqual(before);
});

test('message actions open only the original selected record without changing canonical data', async () => {
  const scene = fixture(), before = structuredClone(scene.state);
  let shown = null;
  scene.view.setMessageActions = async (messageId, open, guard) => { if (!guard()) return false; shown = open ? messageId : null; return true; };
  const actions = scene.controller.handlers['messages.message.actions'];
  expect((await actions(scene.messageTarget, { open: true })).status).toBe('applied');
  expect(shown).toBe(scene.messageTarget.messageId);
  expect((await actions(scene.messageTarget, { open: false })).status).toBe('applied');
  expect(shown).toBeNull(); expect(scene.state).toEqual(before);
  scene.view.setMessageActions = async (_id, _open, guard) => { scene.replaceWindow(); return guard(); };
  expect((await actions(scene.messageTarget, { open: true })).error.code).toBe('stale_target');
  expect(scene.state).toEqual(before);
});

test('Quick Look carries the complete original message target when identical attachment IDs and bytes repeat', async () => {
  const scene = fixture(), source = scene.conversation.items[0];
  const attachment = { id: 'repeated-attachment', name: 'Original.png', mime: 'image/png', dataURI: PREVIEW_IMAGE_CONTENT,
    byteLength: atob(PREVIEW_IMAGE_CONTENT.split(',')[1]).length, originalFileId: null, originalRevision: null, kind: 'image', durationMs: null };
  source.attachments = [attachment];
  const second = { ...structuredClone(source), id: 'second-original-message' };
  scene.conversation.items.push(second);
  const target = { ...scene.conversationTarget, messageId: second.id, attachmentId: attachment.id };
  let presented = null;
  scene.view.quickLookAttachment = async (snapshot, guard, originalTarget, open) => {
    if (!guard()) return false;
    presented = { snapshot, target: originalTarget, open }; return true;
  };
  const before = structuredClone(scene.state);
  expect((await scene.controller.handlers['messages.attachment.quickLook'](target, {})).status).toBe('applied');
  expect(presented.target).toEqual(target); expect(presented.open).toBe(true);
  expect(presented.snapshot).toEqual(second.attachments[0]);
  expect(presented.snapshot).not.toBe(second.attachments[0]);
  expect((await scene.controller.handlers['messages.attachment.quickLook'](target, { open: false })).status).toBe('applied');
  expect(presented.open).toBe(false);
  expect((await scene.controller.handlers['messages.attachment.quickLook'](target, { open: 'false' })).error.code).toBe('invalid_arguments');
  expect(scene.state).toEqual(before);
});

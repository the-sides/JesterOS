import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createMessagesState, expireMessages, messagesRetentionCutoff, messageIncomingPolicy, messagePreferenceAvailable, messageOutgoingProfile, messageSharedContent, markMessagesRead, validateMessagesState } from '../frontend/src/messages-state.js';
import { createMessagesCommands } from '../frontend/src/messages-commands.js';
import { createDefaultSceneSeed, validateSceneSeed } from '../frontend/src/scene-seed.js';
import { createDefaultApplicationFiles } from '../frontend/src/default-application-files.js';
import { createContactsState, emptyContactSpec, createContact } from '../frontend/src/contacts-state.js';
import { recipientIdentity } from '../frontend/src/messages-recipients.js';

const profiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
function originalScene(profileId) {
  const profile = getOSProfile(profileId), state = createMessagesState(profile);
  const window = { id: 'preferences-window', appId: profile.family === 'windows' ? 'teams' : 'messages' };
  const view = { available: () => true, describe: () => ({ controlIds: [] }) };
  const controller = createMessagesCommands({ profile, getState: () => state, alive: () => true,
    getWindow: id => id === window.id ? window : null, getWindows: () => [window], getView: () => view,
    available: value => value === window, focusWindow() {}, settle: async () => {}, getSceneTime: () => state.timeBase,
    onTimeChanged() {}, canCommit: () => true });
  return { profile, state, controller, target: { windowId: window.id }, conversation: state.conversations.find(row => row.id === state.selectedConversationId) };
}

test('finite retention cannot mutate original history until explicitly confirmed; expiry preserves unsent owners', async () => {
  const scene = originalScene(profiles[0]), { state, conversation } = scene;
  const draft = state.drafts.find(row => row.conversationId === conversation.id);
  draft.fields.body = 'Unsent café 東京 remains';
  const old = conversation.items[0], newer = conversation.items.at(-1), originalDrafts = state.drafts;
  state.timeBase += 40 * 86400000;
  newer.timestamp = state.timeBase; conversation.timestamp = state.timeBase;
  state.selectedMessageId = old.id;
  const before = structuredClone(state);
  const denied = await scene.controller.handlers['messages.preferences.set'](scene.target, { key: 'keepMessages', value: '30days' });
  expect(denied.error.code).toBe('confirmation_required'); expect(state).toEqual(before);
  const result = await scene.controller.handlers['messages.preferences.set'](scene.target, { key: 'keepMessages', value: '30days', confirmed: true });
  expect(result.status).toBe('applied'); expect(result.expiredMessages).toBeGreaterThan(0);
  expect(state.conversations.find(row => row.id === conversation.id)).toBe(conversation);
  expect(conversation.items).toContain(newer); expect(conversation.items).not.toContain(old);
  expect(state.drafts).toBe(originalDrafts); expect(state.drafts.find(row => row.id === draft.id)).toBe(draft);
  expect(draft.fields.body).toBe('Unsent café 東京 remains'); expect(state.selectedMessageId).toBeNull();
});

test('authored expiry boundaries are exact and calendar years clamp leap day without host time', () => {
  expect(messagesRetentionCutoff(Date.parse('2024-02-29T12:34:56Z'), '1year')).toBe(Date.parse('2023-02-28T12:34:56Z'));
  const scene = originalScene(profiles[1]), { state, conversation } = scene;
  state.preferences.keepMessages = '30days'; const cutoff = messagesRetentionCutoff(state.timeBase, '30days');
  const at = conversation.items[0], before = conversation.items[1]; at.timestamp = cutoff; before.timestamp = cutoff - 1;
  expireMessages(state, state.timeBase); expect(conversation.items).toContain(at); expect(conversation.items).not.toContain(before);
  const snapshot = structuredClone(state); expect(expireMessages(state, state.timeBase - 1)).toBe(0); expect(state).toEqual(snapshot);
});

test('individual historical close rejects destructive cancellation and does not equal window retirement', async () => {
  for (const id of profiles.slice(0, 2)) {
    const scene = originalScene(id), { state, conversation } = scene;
    state.preferences.saveClosedHistory = false;
    const target = { ...scene.target, conversationId: conversation.id }, before = structuredClone(state);
    const refused = await scene.controller.handlers['messages.conversation.close'](target, {});
    expect(refused.error.code).toBe('confirmation_required'); expect(state).toEqual(before);
    expect((await scene.controller.handlers['messages.conversation.close'](target, { confirmed: true })).status).toBe('applied');
    expect(state.conversations.some(row => row.id === conversation.id)).toBe(false);
    expect(state.drafts.some(row => row.conversationId === conversation.id)).toBe(false);
  }
});

test('unknown-sender notifications borrow original Contacts and prior received history, while mention overrides only thread mute', () => {
  const scene = originalScene(profiles[2]), { state, conversation, profile } = scene;
  conversation.items.splice(0); state.preferences.notifyUnknownContacts = false;
  const sender = 'Known Contact <source@example.test>';
  expect(messageIncomingPolicy(state, conversation, sender, 'A quiet arrival.', false, profile).notify).toBe(false);
  const contacts = createContactsState(profile), spec = emptyContactSpec(contacts);
  spec.name.given = 'Known'; spec.name.family = 'Contact'; spec.emails = [{ label: 'work', value: 'source@example.test' }];
  expect(createContact(contacts, spec, { time: state.timeBase }).status).toBe('applied');
  const endpoint = recipientIdentity(sender), known = contacts.contacts.some(card => card.emails.some(row => recipientIdentity(row.value) === endpoint));
  expect(messageIncomingPolicy(state, conversation, sender, 'A quiet arrival.', known, profile).notify).toBe(true);
  conversation.items.push({ id: 'received-prior', timestamp: state.timeBase, kind: 'text', direction: 'incoming', sender, text: 'Earlier receipt' });
  expect(messageIncomingPolicy(state, conversation, sender, 'A quiet arrival.', false, profile).notify).toBe(true);
  conversation.dnd = true; expect(messageIncomingPolicy(state, conversation, sender, `${state.account.name}, hello!`, known, profile).notify).toBe(true);
  state.preferences.notifyMentions = false; expect(messageIncomingPolicy(state, conversation, sender, `${state.account.name}, hello!`, known, profile).notify).toBe(false);
  state.preferences.notifyMentions = true; state.account.status = 'Do not disturb';
  expect(messageIncomingPolicy(state, conversation, sender, `${state.account.name}, hello!`, known, profile).notify).toBe(false);
});

test('Golden screening/spam keeps genuine records and release gates never backport settings', async () => {
  for (const id of profiles) {
    const scene = originalScene(id);
    expect(messagePreferenceAvailable(scene.profile, 'screenUnknownSenders')).toBe(id === profiles[3]);
    if (id !== profiles[3]) {
      const before = structuredClone(scene.state);
      expect((await scene.controller.handlers['messages.preferences.set'](scene.target, { key: 'screenUnknownSenders', value: true })).error.code).toBe('disabled');
      expect(scene.state).toEqual(before);
    }
  }
  const scene = originalScene(profiles[3]), { state, conversation, profile } = scene;
  state.preferences.screenUnknownSenders = true; state.preferences.filterSpam = true;
  const sender = conversation.participants[0];
  const policy = messageIncomingPolicy(state, conversation, sender, 'Claim your prize: send gift cards.', false, profile);
  expect(policy.screened).toBe(true); expect(policy.spam).toBe(true); expect(policy.notify).toBe(false);
  state.knownSenders.push(recipientIdentity(sender));
  expect(messageIncomingPolicy(state, conversation, sender, 'Claim your prize: send gift cards.', false, profile).notify).toBe(true);
});

test('local name/photo sharing obeys Contacts/approval and immutable earlier snapshots', () => {
  const { state, conversation } = originalScene(profiles[2]); state.preferences.shareNamePhoto = true;
  expect(messageOutgoingProfile(state, conversation, false)).toBeNull();
  const shared = messageOutgoingProfile(state, conversation, true); expect(shared.name).toBe(state.account.name);
  state.account.name = 'Later local name'; expect(shared.name).not.toBe(state.account.name);
  state.preferences.shareAutomatically = 'ask'; expect(messageOutgoingProfile(state, conversation, true)).toBeNull();
  conversation.shareApproved = true; expect(messageOutgoingProfile(state, conversation, false).name).toBe('Later local name');
});

test('Shared with You app/automatic switches affect original Contacts-only projection without dropping graphs', () => {
  const { state, conversation } = originalScene(profiles[2]); const sender = conversation.participants[0];
  conversation.items.push({ id: 'local-shared-link', kind: 'text', direction: 'incoming', timestamp: state.timeBase,
    sender, text: 'Read https://jester.local/trails' });
  const original = structuredClone(state.conversations); state.preferences.sharedApps = ['safari'];
  expect(messageSharedContent(state, [sender], 'safari')).toEqual([]);
  state.preferences.sharedAutomatic = true; expect(messageSharedContent(state, [], 'safari')).toEqual([]);
  const rows = messageSharedContent(state, [sender], 'safari'); expect(rows.at(-1).url).toBe('https://jester.local/trails');
  state.preferences.sharedApps = []; expect(messageSharedContent(state, [sender], 'safari')).toEqual([]);
  expect(state.conversations).toEqual(original);
});

test('old reduced preference saved shape fails explicitly rather than silently migrating or dropping native graphs', () => {
  const profile = getOSProfile(profiles[0]), seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles });
  const old = { playSounds: true, showPreviews: true, saveHistory: true, textSize: 13 };
  seed.messages.preferences = old; expect(validateSceneSeed(seed, profile).ok).toBe(false);
  const state = createMessagesState(profile); state.preferences = old;
  expect(validateMessagesState(state, profile).ok).toBe(false);
});

test('local receipt policy records the original authored epoch once, preserving identity and disabling future receipts only', () => {
  const { state, conversation } = originalScene(profiles[2]), original = conversation.items[0];
  const epoch = state.timeBase + 1000;
  expect(markMessagesRead(state, conversation, epoch)).toBeGreaterThan(0);
  expect(conversation.items[0]).toBe(original); expect(original.readReceiptAt).toBe(epoch);
  expect(markMessagesRead(state, conversation, epoch + 1000)).toBe(0); expect(original.readReceiptAt).toBe(epoch);
  state.account.readReceipts = false;
  const next = { id: 'local-unread-after-policy', kind: 'text', direction: 'incoming', timestamp: state.timeBase, text: 'Later receipt' };
  conversation.items.push(next); expect(markMessagesRead(state, conversation, epoch + 2000)).toBe(0);
  expect(next.readReceiptAt).toBeUndefined(); expect(original.readReceiptAt).toBe(epoch);
});

test('historical Enable this account is distinct from local Sign Out and modern profiles refuse that era-only control', async () => {
  const scene = originalScene(profiles[0]), before = structuredClone(scene.state.conversations);
  expect((await scene.controller.handlers['messages.account.set'](scene.target, { key: 'enabled', value: false })).status).toBe('applied');
  expect(scene.state.account.enabled).toBe(false); expect(scene.state.account.signedIn).toBe(true);
  expect(scene.state.conversations).toEqual(before);
  const modern = originalScene(profiles[2]);
  expect((await modern.controller.handlers['messages.account.set'](modern.target, { key: 'enabled', value: false })).error.code).toBe('disabled');
});

test('stale authored-epoch retention confirmations cannot expire additional records after a clock change', async () => {
  const scene = originalScene(profiles[2]), before = structuredClone(scene.state);
  const result = await scene.controller.handlers['messages.preferences.set'](scene.target,
    { key: 'keepMessages', value: '30days', confirmed: true, expectedTime: scene.state.timeBase - 1 });
  expect(result.error.code).toBe('stale_target'); expect(scene.state).toEqual(before);
});

test('preference navigation is release gated, transient and uses the original mounted view', async () => {
  for (const id of profiles) {
    const scene = originalScene(id), before = structuredClone(scene.state);
    let viewed = null;
    const native = { available: () => true, setPreferencePane: async (pane, section, guard) => {
      if (!guard()) return false;
      viewed = { pane, section }; return true;
    } };
    const window = { id: scene.target.windowId, appId: scene.profile.family === 'windows' ? 'teams' : 'messages' };
    let live = window;
    const controller = createMessagesCommands({ profile: scene.profile, getState: () => scene.state, alive: () => true,
      getWindow: () => live, getWindows: () => [live], getView: () => native,
      available: candidate => candidate === live, getSceneTime: () => scene.state.timeBase });
    const navigate = controller.handlers['messages.preferences.navigate'];
    expect((await navigate(scene.target, { pane: 'account', section: 'blocked' })).status).toBe('applied');
    expect(viewed).toEqual({ pane: 'account', section: 'blocked' });
    expect(scene.state).toEqual(before);
    const sharing = await navigate(scene.target, { pane: 'sharing' });
    expect(sharing.status).toBe(['sonoma', 'golden-gate'].includes(scene.profile.renderer) ? 'applied' : 'rejected');
    if (sharing.status === 'rejected') expect(sharing.error.code).toBe('disabled');
    const appearance = await navigate(scene.target, { pane: 'appearance' });
    expect(appearance.status).toBe(scene.profile.family === 'windows' ? 'applied' : 'rejected');
    expect((await navigate(scene.target, { pane: 'general', section: 'blocked' })).error.code).toBe('invalid_arguments');
    let reads = 0;
    expect((await navigate(scene.target, Object.defineProperty({}, 'pane', { enumerable: true, get() { reads++; return 'general'; } }))).error.code).toBe('invalid_arguments');
    expect(reads).toBe(0);
    native.setPreferencePane = async (_pane, _section, guard) => { live = { ...window }; return guard(); };
    expect((await navigate(scene.target, { pane: 'general' })).error.code).toBe('stale_target');
    expect(scene.state).toEqual(before);
  }
});

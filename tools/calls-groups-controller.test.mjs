import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactsState, createContact, resolveContacts } from '../frontend/src/contacts-state.js';
import { createCallsState, callsWindow } from '../frontend/src/calls-state.js';
import { createCallsCommands } from '../frontend/src/calls-commands.js';
import { listOSProfiles } from '../frontend/src/os-profiles.js';
import { createMessagesState } from '../frontend/src/messages-state.js';
function fixture(profileId = 'macos-sonoma-14.0') {
  const profile = listOSProfiles().find(row => row.id === profileId), state = createCallsState(profile), contacts = createContactsState(profile), messages = createMessagesState(profile), account = messages.account;
  const a = createContact(contacts, { name: 'Actual Ada', email: 'ada@example.test' }).contact, b = createContact(contacts, { name: 'Actual Bea', email: 'bea@example.test' }).contact;
  const window = { id: 'group-window', appId: profileId.startsWith('windows11') ? 'teams' : 'facetime', ...(profileId.startsWith('windows11') ? { utilityKind: 'teams-call' } : {}) }, view = { available: () => true, describe: () => ({ controlIds: [], scrolls: {} }) };
  const ctx = { profile, getState: () => state, getWindow: id => id === window.id ? window : null, getView: () => view, available: () => true, alive: () => true, tick: async () => {}, getSceneTime: () => 1000, getAccount: () => account, getBlockedAddresses: () => messages.blockedAddresses, canCommit: () => true, resolveContacts(query, ownership) { const original = contacts.contacts.slice(), revisions = original.map(row => row.revision); return { status: 'applied', contacts: resolveContacts(contacts, query), isCurrent: () => ownership.guard() && contacts.contacts.length === original.length && original.every((row, index) => contacts.contacts[index] === row && row.revision === revisions[index]) }; } };
  const controller = createCallsCommands(ctx); assert.equal(controller.windowOpened(window), true);
  return { state, contacts, messages, a, b, ctx, controller, run: payload => controller.handlers['calls.group.start']({ windowId: window.id }, payload) };
}
test('native group controller resolves actual canonical Contacts and owns one real call/session graph', async () => {
  const f = fixture(); const result = await f.run({ kind: 'video', contactIds: [f.a.id, f.b.id] });
  assert.equal(result.status, 'applied'); assert.equal(f.state.calls.length, 1); assert.equal(result.callId, f.state.calls[0].id); assert.equal(callsWindow(f.state, 'group-window').callId, result.callId);
  assert.deepEqual(f.state.calls[0].participants.map(row => [row.contactId, row.name, row.address]), [[f.a.id, 'Actual Ada', 'ada@example.test'], [f.b.id, 'Actual Bea', 'bea@example.test']]);
});
test('base High Sierra and Mojave reject group initiation without backporting or consuming call identity', async () => {
  for (const profileId of ['macos-high-sierra-10.13', 'macos-mojave-10.14']) { const f = fixture(profileId), before = JSON.stringify(f.state); const result = await f.run({ kind: 'video', contactIds: [f.a.id, f.b.id] }); assert.equal(result.status, 'rejected'); assert.equal(JSON.stringify(f.state), before); }
});
test('changing one actual original contact after bulk source acknowledgement rejects the entire group atomically', async () => {
  const f = fixture(), resolver = f.ctx.resolveContacts;
  f.ctx.resolveContacts = (query, ownership) => { const result = resolver(query, ownership); queueMicrotask(() => { f.a.revision++; }); return result; };
  const before = JSON.stringify(f.state), result = await f.run({ kind: 'audio', contactIds: [f.a.id, f.b.id] });
  assert.equal(result.status, 'rejected'); assert.equal(JSON.stringify(f.state), before); assert.equal(f.state.nextId, 1);
});
test('Windows fictional shared blocked endpoint rejects entire canonical Contacts group without a Calls shadow store', async () => {
  const f = fixture('windows11-23h2-22631.2428'); f.messages.blockedAddresses.push(f.b.emails[0].value.toUpperCase()); const before = JSON.stringify(f.state);
  assert.equal((await f.run({ kind: 'audio', contactIds: [f.a.id, f.b.id] })).status, 'rejected');
  assert.equal(JSON.stringify(f.state), before); assert.equal(Object.hasOwn(f.state, 'blocked'), false); assert.equal(f.messages.blockedAddresses.length, 1);
});
test('native Mac outgoing group may call actual blocked endpoint without unblocking, under the same original source lease', async () => {
  const f = fixture(); const blocked = f.messages.blockedAddresses; blocked.push(f.b.emails[0].value);
  const result = await f.run({ kind: 'audio', contactIds: [f.a.id, f.b.id] });
  assert.equal(result.status, 'applied'); assert.equal(f.state.calls[0].participants.length, 2); assert.equal(f.messages.blockedAddresses, blocked); assert.deepEqual(blocked, [f.b.emails[0].value]);
});

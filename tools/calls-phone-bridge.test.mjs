import test from 'node:test';
import assert from 'node:assert/strict';
import { listOSProfiles } from '../frontend/src/os-profiles.js';
import { createContactsState, emptyContactSpec, createContact, resolveContacts } from '../frontend/src/contacts-state.js';
import { createMessagesState, validateMessagesState } from '../frontend/src/messages-state.js';
import { recipientIdentity } from '../frontend/src/messages-recipients.js';
import { createCallsState, callsCapabilities, callsWindow, callById } from '../frontend/src/calls-state.js';
import { createCallsCommands } from '../frontend/src/calls-commands.js';
import { copyCanonicalData } from '../frontend/src/canonical-data.js';

function fixture(profile) {
  const calls = createCallsState(profile), contacts = createContactsState(profile), messages = createMessagesState(profile);
  const spec = emptyContactSpec(contacts); spec.name.given = 'Actual Person';
  spec.phones = [{ label: 'mobile', value: '+1 (555) 000-1000' }, { label: 'work', value: '+1 (555) 000-2000' }];
  spec.emails = [{ label: 'home', value: 'primary@example.test' }, { label: 'work', value: 'secondary@example.test' }];
  const card = createContact(contacts, spec).contact, member = card.phones[1], originalAddress = member.value;
  const capability = callsCapabilities(profile), window = { id: 'actual-native-calls', appId: capability.appId, ...(capability.utilityKind ? { utilityKind: capability.utilityKind } : {}) };
  const caller = { id: 'actual-contacts-caller', appId: 'contacts', minimized: false };
  const view = { available: () => true, describe: () => ({ controlIds: [], scrolls: {} }) };
  let callerAlive = true;
  const ctx = { profile, getState: () => calls, getWindow: id => id === window.id ? window : id === caller.id ? caller : null, getView: id => id === window.id ? view : null,
    available: () => true, alive: () => true, tick: async () => {}, getSceneTime: () => 10000, getAccount: () => messages.account,
    getBlockedAddresses: () => messages.blockedAddresses, canCommit: () => true,
    setBlockedAddresses(addresses, ownership) {
      const candidate = copyCanonicalData(messages); candidate.blockedAddresses = addresses.map(recipientIdentity);
      if (!validateMessagesState(candidate, profile).ok || ownership.guard() !== true || ownership.notificationsToDismiss.length) return { status: 'rejected', error: { code: 'unavailable' } };
      if (ownership.onCommit() !== true) return { status: 'rejected', error: { code: 'stale_target' } };
      messages.blockedAddresses.splice(0, messages.blockedAddresses.length, ...candidate.blockedAddresses);
      return { status: 'applied' };
    },
    createWindow(appId, ownership) { assert.equal(appId, window.appId); assert.equal(ownership.isCurrent(), true); return { windowId: window.id }; },
    resolveContacts(query, ownership) {
      const original = contacts.contacts, signature = JSON.stringify(contacts), rows = resolveContacts(contacts, query), requested = ownership.selectedEndpoint;
      if (requested) {
        const actualCard = original.find(row => row.id === requested.contactId), identity = recipientIdentity(requested.address);
        const phone = actualCard?.phones.find(row => recipientIdentity(row.value) === identity), email = actualCard?.emails.find(row => recipientIdentity(row.value) === identity);
        if (!identity || (!phone && !email)) return { status: 'rejected', error: { code: 'stale_target' } };
        const row = rows.find(row => row.id === actualCard.id); if (!row) return { status: 'rejected', error: { code: 'stale_target' } };
        if (phone) row.phone = phone.value; else row.email = email.value;
      }
      return { status: 'applied', contacts: rows, isCurrent: () => ownership.guard() && contacts.contacts === original && JSON.stringify(contacts) === signature };
    } };
  const controller = createCallsCommands(ctx); assert.equal(controller.windowOpened(window), true);
  const callerGuard = () => callerAlive && ctx.getWindow(caller.id) === caller && !caller.minimized && contacts.contacts.includes(card) && card.phones.includes(member) && member.value === originalAddress;
  return { calls, contacts, messages, card, member, ctx, controller, window, caller, setCallerAlive: value => { callerAlive = value; }, callerGuard,
    start: (extra = {}) => controller.startCall({ contactId: card.id, name: 'Caller-supplied label is not authority', address: originalAddress, kind: 'audio', ...extra }, { guard: callerGuard, windowId: caller.id }) };
}

for (const profile of listOSProfiles()) test(`${profile.id}: borrowed secondary canonical phone creates only actual Calls graph and native session`, async () => {
  const f = fixture(profile), result = await f.start();
  assert.equal(result.status, 'applied'); assert.equal(result.windowId, f.window.id);
  const call = callById(f.calls, result.callId); assert.equal(call, f.calls.calls[0]); assert.equal(callsWindow(f.calls, f.window.id).callId, call.id);
  assert.equal(call.participants[0].address, f.member.value); assert.equal(call.participants[0].name, 'Actual Person'); assert.equal(call.participants[0].contactId, f.card.id);
  assert.equal(f.contacts.contacts[0], f.card); assert.equal(f.calls.calls.length, 1); assert.equal(Object.hasOwn(f.calls, 'blocked'), false);
});

test('secondary canonical email uses same selectedEndpoint projection, no endpointKind schema alias', async () => {
  const profile = listOSProfiles().find(row => row.id === 'macos-sonoma-14.0'), f = fixture(profile), address = f.card.emails[1].value;
  assert.equal((await f.start({ address })).status, 'applied'); assert.equal(f.calls.calls[0].participants[0].address, address);
  const other = fixture(profile), before = JSON.stringify(other.calls);
  assert.equal((await other.start({ endpointKind: 'phone' })).status, 'rejected'); assert.equal(JSON.stringify(other.calls), before);
});

test('actual caller endpoint retirement during awaited resolver preparation cannot borrow a replacement phone', async () => {
  const f = fixture(listOSProfiles().find(row => row.id === 'macos-sonoma-14.0')), resolver = f.ctx.resolveContacts;
  let release, encountered; const gate = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { encountered = resolve; });
  f.ctx.resolveContacts = async (...args) => { const acknowledgement = resolver(...args); encountered(); await gate; return acknowledgement; };
  const pending = f.start(); await seen;
  f.member.value = '+15550003000'; f.card.revision++; release();
  assert.equal((await pending).status, 'rejected'); assert.equal(f.calls.calls.length, 0); assert.equal(f.calls.nextId, 1);
});

test('foreign end/mute/preferences forwarding owns exact actual call session and original caller lease', async () => {
  const f = fixture(listOSProfiles().find(row => row.id === 'macos-sonoma-14.0')), started = await f.start(), call = callById(f.calls, started.callId), target = { windowId: f.window.id, callId: call.id };
  const forwarded = (name, payload) => f.controller.forwardCommand(name, target, payload, { guard: f.callerGuard, windowId: f.caller.id });
  assert.equal((await forwarded('calls.media.set', { muted: true })).status, 'applied'); assert.equal(call.muted, true);
  assert.equal((await forwarded('calls.preferences.set', { values: { ...f.calls.preferences, defaultKind: 'audio' } })).status, 'applied'); assert.equal(f.calls.preferences.defaultKind, 'audio');
  const before = JSON.stringify(f.calls); f.setCallerAlive(false);
  assert.equal((await forwarded('calls.end', {})).status, 'rejected'); assert.equal(JSON.stringify(f.calls), before);
  f.setCallerAlive(true); const ended = await forwarded('calls.end', {});
  assert.equal(ended.status, 'applied'); assert.equal(ended.callId, call.id); assert.equal(ended.windowId, f.window.id); assert.equal(call.status, 'ended');
});

test('foreign controls cannot retarget a different selected canonical Calls record or invoke initiation through forwarding', async () => {
  const f = fixture(listOSProfiles().find(row => row.id === 'macos-sonoma-14.0')), started = await f.start();
  await f.controller.handlers['calls.end']({ windowId: f.window.id }, {});
  const other = await f.controller.handlers['calls.start']({ windowId: f.window.id }, { name: 'Another actual local call', address: 'other@example.test', kind: 'audio' }), before = JSON.stringify(f.calls);
  assert.equal((await f.controller.forwardCommand('calls.end', { windowId: f.window.id, callId: started.callId }, {}, { guard: f.callerGuard })).status, 'rejected');
  assert.equal((await f.controller.forwardCommand('calls.start', { windowId: f.window.id, callId: other.callId }, { name: 'Not allowed', address: 'not@example.test', kind: 'audio' }, { guard: f.callerGuard })).status, 'rejected');
  assert.equal(JSON.stringify(f.calls), before); assert.equal(callById(f.calls, other.callId).status, 'ringing');
});
test('actual minimized source caller cannot forward an end into the still-mounted native Calls window', async () => {
  const f = fixture(listOSProfiles().find(row => row.id === 'macos-sonoma-14.0')), started = await f.start(), before = JSON.stringify(f.calls);
  f.caller.minimized = true;
  assert.equal((await f.controller.forwardCommand('calls.end', { windowId: f.window.id, callId: started.callId }, {}, { guard: f.callerGuard, windowId: f.caller.id })).status, 'rejected');
  assert.equal(JSON.stringify(f.calls), before); assert.equal(callById(f.calls, started.callId).status, 'ringing');
});
test('foreign block forwarding changes only actual shared endpoint authority and preserves native Mac outgoing call', async () => {
  const f = fixture(listOSProfiles().find(row => row.id === 'macos-sonoma-14.0')), started = await f.start(), call = callById(f.calls, started.callId), blocked = f.messages.blockedAddresses;
  const result = await f.controller.forwardCommand('calls.block', { windowId: f.window.id, callId: call.id }, { contactId: f.card.id, address: f.member.value }, { guard: f.callerGuard, windowId: f.caller.id });
  assert.equal(result.status, 'applied'); assert.equal(result.callId, call.id); assert.equal(f.messages.blockedAddresses, blocked); assert.deepEqual(blocked, [recipientIdentity(f.member.value)]);
  assert.equal(call.status, 'ringing'); assert.equal(f.calls.calls[0], call); assert.equal(Object.hasOwn(f.calls, 'blocked'), false);
});

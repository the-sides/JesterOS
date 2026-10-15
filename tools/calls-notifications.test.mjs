import test from 'node:test';
import assert from 'node:assert/strict';
import { listOSProfiles } from '../frontend/src/os-profiles.js';
import { canonicalStringUnits, copyCanonicalData } from '../frontend/src/canonical-data.js';
import { notificationsDefaults, validateNotificationsState, postNotification } from '../frontend/src/notification-model.js';
import { createDomainNotificationBridges } from '../frontend/src/notification-commands.js';
import { createCallsState, callById, validateCallsState } from '../frontend/src/calls-state.js';
import { createCallsCommands } from '../frontend/src/calls-commands.js';
import { createMessagesState, validateMessagesState } from '../frontend/src/messages-state.js';
import { recipientIdentity } from '../frontend/src/messages-recipients.js';
import { createContactsState, createContact, resolveContacts } from '../frontend/src/contacts-state.js';
function fixture(base) {
  const appId = base.id.startsWith('windows11') ? 'teams' : 'facetime';
  const profile = { ...base, applications: { ...base.applications, [appId]: base.applications[appId] ?? { label: 'FaceTime' } } };
  const state = createCallsState(profile), notifications = notificationsDefaults(), messages = createMessagesState(profile), account = messages.account, contacts = createContactsState(profile);
  const window = { id: 'call-window', appId, ...(appId === 'teams' ? { utilityKind: 'teams-call' } : {}) }, view = { available: () => true, describe: () => ({ controlIds: [], scrolls: {} }) };
  let time = 1791366060000, quota = Infinity, pending = 0, live = true;
  const budget = delta => canonicalStringUnits(state) + canonicalStringUnits(messages) + canonicalStringUnits(contacts) + canonicalStringUnits(notifications) + pending + delta <= quota;
  const bridges = createDomainNotificationBridges({ profile, getState: () => notifications, alive: () => live, getSceneTime: () => time, canCommit: budget, reserve(delta, commit) { pending += delta; try { return commit(); } finally { pending -= delta; } }, retainDestination(entry) { const call = callById(state, entry.destination.recordId); return call ? { current: () => callById(state, call.id) === call } : null; } });
  const ctx = { profile, getState: () => state, getWindow: id => id === window.id ? window : null, getWindows: () => [window], getView: id => id === window.id ? view : null, available: () => true, alive: () => live, tick: async () => {}, focusWindow: () => true, getSceneTime: () => time, getAccount: () => account, getBlockedAddresses: () => messages.blockedAddresses, canCommit: budget, ...bridges,
    resolveContacts(query, ownership) { const original = contacts.contacts, signature = JSON.stringify(contacts); return { status: 'applied', contacts: resolveContacts(contacts, query), isCurrent: () => ownership.guard() && contacts.contacts === original && JSON.stringify(contacts) === signature }; },
    setBlockedAddresses(addresses, ownership) {
      const blocked = messages.blockedAddresses, signature = JSON.stringify(messages), candidate = copyCanonicalData(messages);
      candidate.blockedAddresses = addresses.map(recipientIdentity);
      if (!validateMessagesState(candidate, profile).ok) return { status: 'rejected', error: { code: 'invalid_arguments' } };
      const delta = canonicalStringUnits(candidate) - canonicalStringUnits(messages);
      const plan = typeof ownership.onCommit === 'function' ? null : controller.prepareBlockedAddressEffects(addresses, ownership);
      if (!plan && typeof ownership.onCommit !== 'function') return { status: 'rejected', error: { code: 'stale_target' } };
      const callsDelta = plan?.delta ?? ownership.reserveTextUnits, ids = plan?.notificationsToDismiss ?? ownership.notificationsToDismiss, applyCalls = plan?.commit ?? ownership.onCommit;
      const current = () => ownership.guard() && (!plan || plan.current()) && messages.blockedAddresses === blocked && JSON.stringify(messages) === signature;
      const apply = () => {
        pending += delta;
        try {
          if (applyCalls() !== true) return false;
          blocked.splice(0, blocked.length, ...candidate.blockedAddresses);
          return true;
        } finally { pending -= delta; }
      };
      if (ids.length && typeof bridges.updateNotifications !== 'function') return { status: 'rejected', error: { code: 'unavailable' } };
      if (ids.length) return bridges.updateNotifications(ids, { dismissed: true, reserveTextUnits: delta + callsDelta, onCommit: apply }, { guard: current, windowId: ownership.windowId });
      if (!current() || !budget(delta + callsDelta)) return { status: 'rejected', error: { code: 'limit_exceeded' } };
      return apply() ? { status: 'applied' } : { status: 'rejected', error: { code: 'stale_target' } };
    } };
  const controller = createCallsCommands(ctx); assert.equal(controller.windowOpened(window), true);
  return { state, messages, contacts, bridges, notifications, account, window, ctx, controller, profile, setTime: value => { time = value; }, now: () => time, setQuota: value => { quota = value; }, setLive: value => { live = value; }, run: (name, payload = {}) => controller.handlers[name]({ windowId: window.id }, payload) };
}
for (const profile of listOSProfiles()) test(`${profile.id}: incoming call creates actual notification allocation; Accept atomically retires it`, async () => {
  const f = fixture(profile), result = await f.run('calls.incoming', { name: 'Fictional Renée', address: 'renee@example.test', kind: 'video' });
  assert.equal(result.status, 'applied'); assert.equal(result.notificationDelivery.status, 'applied');
  const call = callById(f.state, result.callId), notificationId = call.notificationId;
  assert.equal(notificationId, f.notifications.entries[0].id); assert.deepEqual(f.notifications.entries[0].destination, { kind: 'call', recordId: call.id });
  const accepted = await f.controller.notificationAction(call.id, 'accept', { guard: () => true, windowId: f.window.id });
  assert.equal(accepted.status, 'applied'); assert.equal(callById(f.state, call.id), call); assert.equal(call.status, 'connecting'); assert.equal(call.notificationId, null); assert.equal(f.notifications.entries.length, 0);
  f.setTime(f.now() + 2000); assert.equal(f.controller.advance().status, 'applied'); assert.equal(call.status, 'in-call'); assert.equal(validateCallsState(f.state, f.profile).ok, true); assert.equal(validateNotificationsState(f.notifications, f.profile).ok, true);
});
test('missing notification cleanup bridge prevents Accept/close from orphaning the real ringing alert', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  const started = await f.run('calls.incoming', { name: 'Local Caller', address: 'caller@example.test', kind: 'audio' }); assert.equal(started.notificationDelivery.status, 'applied');
  const original = JSON.stringify(f.state); delete f.ctx.updateNotification;
  assert.equal((await f.run('calls.accept')).status, 'rejected'); assert.equal(JSON.stringify(f.state), original); assert.equal(f.notifications.entries.length, 1);
  assert.equal(f.controller.windowClosed(f.window), false); assert.equal(JSON.stringify(f.state), original);
});
test('shared alert budget rejection acknowledges real call only and never fabricates a delivery identity', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  const notify = f.ctx.notify; f.ctx.notify = (spec, ownership) => { f.setQuota(canonicalStringUnits(f.state) + canonicalStringUnits(f.notifications)); return notify(spec, ownership); };
  const result = await f.run('calls.incoming', { name: 'Local Caller', address: 'caller@example.test', kind: 'audio' });
  assert.equal(result.status, 'applied'); assert.equal(result.notificationDelivery.status, 'rejected'); assert.equal(f.state.calls.length, 1); assert.equal(f.state.calls[0].notificationId, null); assert.equal(f.notifications.entries.length, 0);
});
test('canonical blocked address prevents incoming graph/notification allocation until explicitly unblocked', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  await f.run('calls.start', { name: 'Actual Caller', address: 'caller@example.test', kind: 'audio' }); await f.run('calls.end');
  assert.equal((await f.run('calls.block', { address: 'CALLER@example.test' })).status, 'applied'); assert.equal(f.messages.blockedAddresses[0], 'caller@example.test'); assert.equal(Object.hasOwn(f.state, 'blocked'), false);
  const count = f.state.calls.length; assert.equal((await f.run('calls.incoming', { name: 'Changed Display', address: 'caller@example.test', kind: 'video' })).status, 'rejected'); assert.equal(f.state.calls.length, count); assert.equal(f.notifications.entries.length, 0);
  assert.equal((await f.run('calls.unblock', { address: 'caller@example.test' })).status, 'applied'); assert.equal((await f.run('calls.incoming', { name: 'Actual Caller', address: 'caller@example.test', kind: 'video' })).notificationDelivery.status, 'applied');
});
test('staged actual notification dismissal clears ledger only, preserves ringing, and rejects stale plan', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  await f.run('calls.incoming', { name: 'Local Caller', address: 'caller@example.test', kind: 'audio' }); const call = f.state.calls[0], id = call.notificationId;
  const plan = f.controller.prepareNotificationDismissals([id], { guard: () => true }); assert.equal(plan.current(), true); assert.ok(plan.delta < 0);
  const dismissed = f.ctx.updateNotification(id, { dismissed: true, reserveTextUnits: plan.delta, onCommit: () => plan.commit() }, { guard: plan.current, windowId: f.window.id });
  assert.equal(dismissed.status, 'applied'); assert.equal(call.status, 'ringing'); assert.equal(call.notificationId, null); assert.equal(f.notifications.entries.length, 0); assert.equal(plan.current(), false); assert.equal(plan.commit(), false);
});
test('authored incoming timeout retires exact shared notification and keeps genuine missed recent', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  await f.run('calls.incoming', { name: 'Local Caller', address: 'caller@example.test', kind: 'audio' }); const call = f.state.calls[0]; f.setTime(f.now() + 30000);
  assert.equal(f.controller.advance().status, 'applied'); assert.equal(call.status, 'ended'); assert.equal(call.notificationId, null); assert.equal(f.notifications.entries.length, 0); assert.equal(f.state.calls.length, 1);
});
test('disabling real incoming notifications atomically withdraws alert without declining call', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  await f.run('calls.incoming', { name: 'Local Caller', address: 'caller@example.test', kind: 'audio' });
  const call = f.state.calls[0], preferences = f.state.preferences;
  const result = await f.run('calls.preferences.set', { values: { ...preferences, notificationsEnabled: false, defaultKind: 'audio', ringtone: 'Reflection', hideSelfView: true } });
  assert.equal(result.status, 'applied'); assert.equal(f.state.preferences, preferences); assert.equal(call.status, 'ringing'); assert.equal(call.notificationId, null); assert.equal(f.notifications.entries.length, 0);
  await f.run('calls.end');
  const next = await f.run('calls.incoming', { name: 'Second Caller', address: 'second@example.test', kind: 'audio' });
  assert.equal(next.status, 'applied'); assert.equal(Object.hasOwn(next, 'notificationDelivery'), false); assert.equal(f.notifications.entries.length, 0);
});
test('quota-denied actual alert cleanup leaves original preferences, ringing record and ledger unchanged', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  await f.run('calls.incoming', { name: 'Local Caller', address: 'caller@example.test', kind: 'audio' });
  const before = JSON.stringify(f.state), notifications = JSON.stringify(f.notifications);
  f.setQuota(0);
  assert.equal((await f.run('calls.preferences.set', { values: { ...f.state.preferences, notificationsEnabled: false } })).status, 'rejected');
  assert.equal(JSON.stringify(f.state), before); assert.equal(JSON.stringify(f.notifications), notifications);
});
test('blocking original ringing participant commits actual Messages endpoint, Calls end and shared alert removal atomically', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  await f.run('calls.incoming', { name: 'Actual Phone', address: '+1 (555) 123-4567', kind: 'audio' });
  const originalArray = f.messages.blockedAddresses, call = f.state.calls[0], notification = f.notifications.entries[0];
  assert.equal((await f.run('calls.block', { address: '+15551234567' })).status, 'applied');
  assert.equal(f.messages.blockedAddresses, originalArray); assert.deepEqual(originalArray, ['+15551234567']); assert.equal(call.status, 'ended'); assert.equal(call.notificationId, null);
  assert.equal(f.notifications.entries.includes(notification), false); assert.equal(validateMessagesState(f.messages, f.profile).ok, true);
});
test('missing actual shared block setter or notification cleanup preserves all three canonical domains', async () => {
  for (const missing of ['setBlockedAddresses', 'updateNotifications']) {
    const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
    await f.run('calls.incoming', { name: 'Actual Caller', address: 'caller@example.test', kind: 'audio' });
    const before = [f.state, f.messages, f.notifications].map(graph => JSON.stringify(graph));
    if (missing === 'setBlockedAddresses') delete f.ctx.setBlockedAddresses;
    else delete f.bridges.updateNotifications;
    assert.equal((await f.run('calls.block', { address: 'caller@example.test' })).status, 'rejected');
    assert.deepEqual([f.state, f.messages, f.notifications].map(graph => JSON.stringify(graph)), before);
  }
});
test('whole-scene quota preflight credits actual shared alert deletion exactly once when blocking endpoint', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  await f.run('calls.incoming', { name: 'Actual Caller', address: 'caller@example.test', kind: 'audio' });
  const total = () => canonicalStringUnits(f.state) + canonicalStringUnits(f.messages) + canonicalStringUnits(f.contacts) + canonicalStringUnits(f.notifications);
  const quota = total(); f.setQuota(quota);
  assert.equal((await f.run('calls.block', { address: 'caller@example.test' })).status, 'applied');
  assert.ok(total() <= quota); assert.equal(f.notifications.entries.length, 0);
});
test('quota-denied unified block leaves original Messages, Calls and notification rows intact', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  await f.run('calls.incoming', { name: 'Actual Caller', address: 'caller@example.test', kind: 'audio' });
  const originals = [f.state.calls[0], f.messages.blockedAddresses, f.notifications.entries[0]], before = [f.state, f.messages, f.notifications].map(graph => JSON.stringify(graph));
  f.setQuota(0);
  assert.equal((await f.run('calls.block', { address: 'caller@example.test' })).status, 'rejected');
  assert.deepEqual([f.state, f.messages, f.notifications].map(graph => JSON.stringify(graph)), before);
  assert.equal(f.state.calls[0], originals[0]); assert.equal(f.messages.blockedAddresses, originals[1]); assert.equal(f.notifications.entries[0], originals[2]);
});
test('Messages-origin shared block stages actual ringing effects without manufacturing or requiring a Calls window view', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  await f.run('calls.incoming', { name: 'Actual Caller', address: 'caller@example.test', kind: 'audio' });
  const call = f.state.calls[0], blocked = f.messages.blockedAddresses; f.ctx.getView = () => null;
  assert.equal(f.ctx.setBlockedAddresses(['caller@example.test'], { guard: () => true, windowId: 'actual-message-owner', reserveTextUnits: 0 }).status, 'applied');
  assert.equal(call.status, 'ended'); assert.equal(call.endedAt, f.now()); assert.equal(call.notificationId, null); assert.equal(f.notifications.entries.length, 0);
  assert.equal(f.messages.blockedAddresses, blocked); assert.deepEqual(blocked, ['caller@example.test']);
});
test('detached blocked endpoint effects reject original account, blocked authority or authored time replacement', async () => {
  for (const source of ['account', 'blocked', 'time']) {
    const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
    await f.run('calls.incoming', { name: 'Actual Caller', address: 'caller@example.test', kind: 'audio' });
    const before = JSON.stringify(f.state), plan = f.controller.prepareBlockedAddressEffects(['caller@example.test'], { guard: () => true });
    assert.equal(plan.current(), true); assert.equal(plan.notificationsToDismiss[0], f.state.calls[0].notificationId);
    if (source === 'account') f.ctx.getAccount = () => ({ ...f.account });
    else if (source === 'blocked') f.messages.blockedAddresses = [...f.messages.blockedAddresses];
    else f.setTime(f.now() + 1);
    assert.equal(plan.current(), false); assert.equal(plan.commit(), false); assert.equal(JSON.stringify(f.state), before); assert.equal(f.notifications.entries.length, 1);
  }
});
test('detached blocked endpoint effects leave ongoing accepted call alone and acknowledge no-effects without Calls mutation', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  await f.run('calls.incoming', { name: 'Actual Caller', address: 'caller@example.test', kind: 'audio' }); await f.run('calls.accept');
  const before = JSON.stringify(f.state), plan = f.controller.prepareBlockedAddressEffects(['caller@example.test'], { guard: () => true });
  assert.equal(plan.delta, 0); assert.deepEqual(plan.notificationsToDismiss, []); assert.equal(plan.commit(), true); assert.equal(JSON.stringify(f.state), before);
});
for (const profile of listOSProfiles().filter(row => row.family === 'macos')) test(`${profile.id}: native FaceTime can call blocked endpoint while suppressing actual incoming allocation`, async () => {
  const f = fixture(profile), blocked = f.messages.blockedAddresses; blocked.push('+15551234567');
  assert.equal((await f.run('calls.start', { name: 'Blocked phone', address: '+1 (555) 123-4567', kind: 'audio' })).status, 'applied');
  assert.equal(f.messages.blockedAddresses, blocked); assert.deepEqual(blocked, ['+15551234567']); await f.run('calls.end');
  const before = JSON.stringify(f.state);
  assert.equal((await f.run('calls.incoming', { name: 'Blocked phone', address: '+15551234567', kind: 'audio' })).status, 'rejected');
  assert.equal(JSON.stringify(f.state), before); assert.equal(f.notifications.entries.length, 0);
});
test('Blocked Add consumes actual canonical Contacts without inserting a call or blocked-name shadow', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  const contact = createContact(f.contacts, { name: 'Actual Ada', phone: '+1 (555) 123-4567' }).contact;
  assert.equal((await f.run('calls.sheet.open', { sheet: 'blocked' })).status, 'applied');
  assert.equal((await f.run('calls.contacts.resolve', { query: 'Ada' })).status, 'applied');
  assert.equal(f.state.windows[0].recipients[0].id, contact.id);
  assert.equal((await f.run('calls.block', { contactId: contact.id, address: contact.phones[0].value })).status, 'applied');
  assert.deepEqual(f.messages.blockedAddresses, ['+15551234567']); assert.equal(f.state.calls.length, 0); assert.equal(f.notifications.entries.length, 0);
  assert.equal(Object.hasOwn(f.state, 'blocked'), false); assert.equal(f.contacts.contacts[0], contact);
});
test('Blocked Add cannot promote an obsolete picker endpoint after original Contacts revision changes', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0'));
  const contact = createContact(f.contacts, { name: 'Actual Ada', email: 'ada@example.test' }).contact;
  await f.run('calls.contacts.resolve', { query: 'Ada' });
  const oldAddress = f.state.windows[0].recipients[0].email, before = JSON.stringify(f.state);
  contact.emails[0].value = 'changed@example.test'; contact.revision++;
  assert.equal((await f.run('calls.block', { contactId: contact.id, address: oldAddress })).status, 'rejected');
  assert.equal(JSON.stringify(f.state), before); assert.deepEqual(f.messages.blockedAddresses, []); assert.equal(f.notifications.entries.length, 0);
});
test('incoming alert preflights exact allocated ledger identity at scene quota boundary, never pessimistic 128-character cost', async () => {
  const profile = listOSProfiles().find(row => row.id === 'macos-sonoma-14.0'), payload = { name: 'Actual Caller', address: 'caller@example.test', kind: 'audio' };
  const total = f => canonicalStringUnits(f.state) + canonicalStringUnits(f.messages) + canonicalStringUnits(f.contacts) + canonicalStringUnits(f.notifications);
  const reference = fixture(profile);
  assert.equal((await reference.run('calls.incoming', payload)).notificationDelivery.status, 'applied');
  const exact = total(reference), allowed = fixture(profile); allowed.setQuota(exact);
  assert.equal((await allowed.run('calls.incoming', payload)).notificationDelivery.status, 'applied'); assert.equal(total(allowed), exact);
  const denied = fixture(profile); denied.setQuota(exact - 1);
  const result = await denied.run('calls.incoming', payload);
  assert.equal(result.status, 'applied'); assert.equal(result.notificationDelivery.status, 'rejected'); assert.equal(result.notificationDelivery.error.code, 'limit_exceeded');
  assert.equal(denied.state.calls[0].notificationId, null); assert.equal(denied.notifications.entries.length, 0); assert.equal(denied.notifications.nextId, 1);
});
test('missing actual allocation planner rejects incoming before canonical call or notification insertion', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0')); delete f.ctx.planNotification;
  const before = JSON.stringify(f.state);
  assert.equal((await f.run('calls.incoming', { name: 'Actual Caller', address: 'caller@example.test', kind: 'audio' })).status, 'rejected');
  assert.equal(JSON.stringify(f.state), before); assert.equal(f.notifications.entries.length, 0); assert.equal(f.notifications.nextId, 1);
});
test('actual intervening notification allocation retires prospective Calls identity without borrowing next allocation', async () => {
  const f = fixture(listOSProfiles().find(profile => profile.id === 'macos-sonoma-14.0')), planner = f.ctx.planNotification;
  f.ctx.planNotification = ownership => {
    const plan = planner(ownership);
    assert.equal(plan.current(), true); assert.equal(f.notifications.entries.length, 0); assert.equal(f.notifications.nextId, 1);
    assert.equal(postNotification(f.notifications, f.profile, 'facetime', { title: 'Other authored arrival', body: 'Actual unrelated canonical notification' }, f.now(), f.ctx.canCommit).status, 'applied');
    return plan;
  };
  const result = await f.run('calls.incoming', { name: 'Actual Caller', address: 'caller@example.test', kind: 'audio' });
  assert.equal(result.status, 'applied'); assert.equal(result.notificationDelivery.status, 'rejected'); assert.equal(result.notificationDelivery.error.code, 'stale_target');
  assert.equal(f.state.calls[0].notificationId, null); assert.equal(f.notifications.entries.length, 1); assert.equal(f.notifications.nextId, 2);
  assert.equal(f.notifications.entries[0].title, 'Other authored arrival');
});

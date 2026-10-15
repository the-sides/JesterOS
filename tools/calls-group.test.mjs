import test from 'node:test';
import assert from 'node:assert/strict';
import { CALLS_PROFILES, createCallsState, createCallsWindow, callsWindow, callById, startLocalCall, transitionLocalCall, advanceLocalCalls, validateCallsState } from '../frontend/src/calls-state.js';
import { startLocalGroupCall } from '../frontend/src/calls-group.js';

const allow = () => true;
const recipients = count => Array.from({ length: count }, (_, index) => ({ contactId: `contact-${index}`, name: `Participant ${index}`, address: `person-${index}@example.test` }));
for (const profile of CALLS_PROFILES.slice(2)) for (const kind of ['audio', 'video']) test(`${profile}: ${kind} group commits actual identities and all participant transitions`, () => {
  const state = createCallsState(profile); createCallsWindow(state, 'calls-native');
  const limit = profile.startsWith('windows11') ? 19 : 31;
  let budgets = 0;
  const started = startLocalGroupCall(state, { kind, recipients: recipients(limit) }, 1000, () => { budgets++; assert.equal(state.calls.length, 0); return true; });
  assert.equal(started.status, 'applied'); assert.equal(budgets, 1); assert.equal(state.calls.length, 1);
  const call = callById(state, started.callId); const window = callsWindow(state, 'calls-native'); window.callId = call.id;
  assert.equal(call.id, 'call-1'); assert.equal(call.status, 'ringing'); assert.equal(call.direction, 'outgoing');
  assert.equal(call.cameraEnabled, kind === 'video'); assert.equal(call.participants.length, limit);
  assert.equal(call.participants[0].id, 'call-1-remote'); assert.deepEqual(started.participantIds, call.participants.map(row => row.id));
  assert.equal(new Set(started.participantIds).size, limit); assert.deepEqual(call.participants.map(row => row.contactId), recipients(limit).map(row => row.contactId));
  advanceLocalCalls(state, 7000, allow); assert.equal(callById(state, call.id), call); assert.equal(callsWindow(state, window.windowId), window);
  assert.equal(call.status, 'in-call'); assert.equal(call.connectedAt, 5000); assert.deepEqual(call.participants.map(row => row.id), started.participantIds);
  transitionLocalCall(state, call.id, 'end', {}, 9000, allow); assert.equal(call.status, 'ended'); assert.equal(validateCallsState(state, profile).ok, true);
});
for (const profile of CALLS_PROFILES.slice(0, 2)) test(`${profile}: groups unavailable without a later-release backport`, () => {
  const state = createCallsState(profile), before = structuredClone(state);
  const result = startLocalGroupCall(state, { kind: 'video', recipients: recipients(2) }, 1000, allow);
  assert.equal(result.status, 'rejected'); assert.equal(result.error.code, 'unavailable'); assert.deepEqual(state, before);
});
test('Windows rejects its twentieth remote participant without inserting the first call', () => {
  const state = createCallsState(CALLS_PROFILES[4]), before = structuredClone(state);
  assert.equal(startLocalGroupCall(state, { kind: 'audio', recipients: recipients(20) }, 1000, allow).error.code, 'limit_exceeded'); assert.deepEqual(state, before);
});
test('shared communications phone normalization prevents duplicate group endpoints', () => {
  const state = createCallsState(CALLS_PROFILES[2]), before = structuredClone(state);
  assert.equal(startLocalGroupCall(state, { kind: 'audio', recipients: [{ name: 'Same phone', address: '+1 (555) 123-4567' }, { name: 'Same endpoint', address: '+15551234567' }] }, 1000, allow).error.code, 'invalid_arguments');
  assert.deepEqual(state, before);
});
test('closed descriptor-safe group specifications reject getters, unknown fields, duplicates and blank recipients', () => {
  let read = false; const hostile = { name: 'Unsafe', address: 'unsafe@example.test' }; Object.defineProperty(hostile, 'contactId', { enumerable: true, get() { read = true; return 'unsafe'; } });
  const badSpecs = [
    { kind: 'video', recipients: [hostile, recipients(1)[0]] },
    { kind: 'video', recipients: recipients(2), extra: true },
    { kind: 'video', recipients: [{ ...recipients(1)[0], extra: true }, recipients(2)[1]] },
    { kind: 'video', recipients: recipients(1) },
    { kind: 'video', recipients: recipients(32) },
    { kind: 'video', recipients: [{ name: 'A', address: ' A@example.test ' }, { name: 'B', address: 'a@EXAMPLE.test' }] },
    { kind: 'audio', recipients: [recipients(1)[0], { ...recipients(2)[1], contactId: 'contact-0' }] },
    { kind: 'audio', recipients: [recipients(1)[0], { name: '   ', address: 'b@example.test' }] }
  ];
  for (const spec of badSpecs) { const state = createCallsState(CALLS_PROFILES[2]), before = structuredClone(state); assert.equal(startLocalGroupCall(state, spec, 1000, allow).status, 'rejected'); assert.deepEqual(state, before); }
  assert.equal(read, false);
});
test('whole-group budget denial and ownership invalidation are atomic', () => {
  for (const scenario of ['budget', 'guard', 'replacement']) {
    const state = createCallsState(CALLS_PROFILES[2]), before = structuredClone(state); let owned = true;
    const result = startLocalGroupCall(state, { kind: 'video', recipients: recipients(3) }, 1000, () => {
      if (scenario === 'guard') owned = false;
      if (scenario === 'replacement') state.calls = [];
      return scenario !== 'budget';
    }, () => owned);
    assert.equal(result.status, 'rejected'); assert.deepEqual(state, before); assert.equal(state.nextId, 1);
  }
});
test('busy and nonmonotonic time preserve the original live call, not a partial group', () => {
  const state = createCallsState(CALLS_PROFILES[3]); const first = startLocalCall(state, { kind: 'audio', ...recipients(1)[0] }, 1000, allow); const original = callById(state, first.callId), before = structuredClone(state);
  assert.equal(startLocalGroupCall(state, { kind: 'video', recipients: recipients(2) }, 2000, allow).error.code, 'busy'); assert.deepEqual(state, before); assert.equal(callById(state, first.callId), original);
  transitionLocalCall(state, first.callId, 'end', {}, 3000, allow); const ended = structuredClone(state);
  assert.equal(startLocalGroupCall(state, { kind: 'video', recipients: recipients(2) }, 2999, allow).status, 'rejected'); assert.deepEqual(state, ended);
});
test('group creation preserves original terminal records and window ownership while accepting address-only recipients', () => {
  const state = createCallsState(CALLS_PROFILES[2]); createCallsWindow(state, 'original-window');
  const first = startLocalCall(state, { kind: 'audio', ...recipients(1)[0] }, 0, allow);
  const original = callById(state, first.callId), window = callsWindow(state, 'original-window'); window.callId = original.id;
  transitionLocalCall(state, first.callId, 'end', {}, 100, allow);
  const oldRecord = structuredClone(original);
  const started = startLocalGroupCall(state, { kind: 'video', recipients: [{ name: ' Address-only guest ', address: ' guest@example.test ' }, { contactId: 'contact-other', name: 'Actual Contact', address: 'other@example.test' }] }, 100, allow);
  assert.equal(started.status, 'applied'); assert.equal(started.callId, 'call-2');
  assert.equal(callById(state, first.callId), original); assert.deepEqual(original, oldRecord);
  assert.equal(callsWindow(state, 'original-window'), window); assert.equal(window.callId, first.callId);
  const group = callById(state, started.callId); assert.equal(group.participants[0].contactId, null);
  assert.equal(group.participants[0].name, 'Address-only guest'); assert.equal(group.participants[0].address, 'guest@example.test');
  assert.equal(group.participants[1].contactId, 'contact-other'); assert.equal(validateCallsState(state).ok, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { CALLS_PROFILES, createCallsState, createCallsWindow, callsWindow, callById, validateCallsState, startLocalCall, receiveLocalCall, transitionLocalCall, advanceLocalCalls, callDuration, visibleRecentCalls } from '../frontend/src/calls-state.js';
const recipient = { contactId: 'canonical-renee', name: 'Renée Rivera', address: 'renee@example.test', kind: 'video' };
const allow = () => true;
for (const profile of CALLS_PROFILES) test(`${profile}: outgoing canonical audio/video sequence, duration, media and genuine recents`, () => {
  const state = createCallsState(profile); createCallsWindow(state, 'native-call');
  const started = startLocalCall(state, recipient, 10000, allow); assert.equal(started.status, 'applied'); assert.equal(started.callId, state.calls[0].id);
  callsWindow(state, 'native-call').callId = started.callId;
  assert.equal(callById(state, started.callId).status, 'ringing');
  advanceLocalCalls(state, 11999, allow); assert.equal(state.calls[0].status, 'ringing');
  advanceLocalCalls(state, 12000, allow); assert.equal(state.calls[0].status, 'connecting');
  advanceLocalCalls(state, 14000, allow); assert.equal(state.calls[0].status, 'in-call'); assert.equal(state.calls[0].connectedAt, 14000);
  assert.equal(transitionLocalCall(state, started.callId, 'media', { muted: true, cameraEnabled: false }, 15000, allow).status, 'applied');
  assert.equal(state.calls[0].muted, true); assert.equal(state.calls[0].cameraEnabled, false);
  assert.equal(transitionLocalCall(state, started.callId, 'end', {}, 19500, allow).status, 'applied'); assert.equal(callDuration(state.calls[0], 900000), 5);
  callsWindow(state, 'native-call').query = 'RENÉE'; assert.deepEqual(visibleRecentCalls(state, 'native-call').map(row => row.id), [started.callId]);
  assert.equal(transitionLocalCall(state, started.callId, 'accept', {}, 20000, allow).status, 'rejected'); assert.equal(validateCallsState(state, profile).ok, true);
});
test('incoming acceptance retains original connect anchor through short clock steps', () => {
  const state = createCallsState(CALLS_PROFILES[0]), result = receiveLocalCall(state, { ...recipient, kind: 'audio' }, 1000, allow);
  assert.equal(transitionLocalCall(state, result.callId, 'accept', {}, 5000, allow).status, 'applied');
  for (const time of [5100, 5200, 5300, 6000, 6999]) { advanceLocalCalls(state, time, allow); assert.equal(state.calls[0].status, 'connecting'); }
  advanceLocalCalls(state, 7000, allow); assert.equal(state.calls[0].status, 'in-call'); assert.equal(state.calls[0].connectedAt, 7000);
  assert.equal(transitionLocalCall(state, result.callId, 'media', { cameraEnabled: true }, 7100, allow).status, 'rejected');
});
test('large authored clock jump preserves exact connection boundary and duration', () => {
  const state = createCallsState(CALLS_PROFILES[1]); startLocalCall(state, recipient, 100, allow); advanceLocalCalls(state, 100100, allow);
  assert.equal(state.calls[0].connectingAt, 2100); assert.equal(state.calls[0].connectedAt, 4100); assert.equal(callDuration(state.calls[0], 100100), 96);
});
test('incoming missed call times out at authored deadline and deliberate failure is terminal', () => {
  const state = createCallsState(CALLS_PROFILES[2]); receiveLocalCall(state, recipient, 0, allow);
  advanceLocalCalls(state, 29999, allow); assert.equal(state.calls[0].status, 'ringing'); advanceLocalCalls(state, 90000, allow);
  assert.equal(state.calls[0].status, 'ended'); assert.equal(state.calls[0].endedAt, 30000); assert.equal(callDuration(state.calls[0], 90000), 0);
  const result = startLocalCall(state, recipient, 90000, allow); transitionLocalCall(state, result.callId, 'fail', { reason: 'Authored local simulation failure' }, 90500, allow);
  advanceLocalCalls(state, 99000, allow); assert.equal(state.calls[1].status, 'failed'); assert.equal(state.calls[1].failure, 'Authored local simulation failure');
});
test('busy, budget denial, backward clock and missing original guard never insert orphan calls', () => {
  const state = createCallsState(CALLS_PROFILES[3]), before = structuredClone(state);
  assert.equal(startLocalCall(state, recipient, 1000, () => false).status, 'rejected'); assert.deepEqual(state, before);
  assert.equal(startLocalCall(state, recipient, 1000, allow, () => false).status, 'rejected'); assert.deepEqual(state, before);
  startLocalCall(state, recipient, 1000, allow); const active = structuredClone(state);
  assert.equal(startLocalCall(state, recipient, 1001, allow).status, 'rejected'); assert.deepEqual(state, active);
  assert.equal(advanceLocalCalls(state, 999, allow).status, 'rejected'); assert.deepEqual(state, active);
});
test('reentrant budget callback cannot borrow a replacement canonical graph', () => {
  const state = createCallsState(CALLS_PROFILES[4]);
  const result = startLocalCall(state, recipient, 1000, () => { state.calls = []; return true; });
  assert.equal(result.status, 'rejected'); assert.equal(result.error.code, 'stale_target'); assert.equal(state.calls.length, 0); assert.equal(state.nextId, 1);
});
test('closed descriptor-safe validation never executes getters and rejects dangling/contradictory graph', () => {
  const state = createCallsState(CALLS_PROFILES[0]); let called = false;
  const hostile = { ...recipient }; Object.defineProperty(hostile, 'name', { enumerable: true, get() { called = true; return 'Unsafe'; } });
  assert.equal(startLocalCall(state, hostile, 1000, allow).status, 'rejected'); assert.equal(called, false);
  createCallsWindow(state, 'original'); callsWindow(state, 'original').callId = 'missing'; assert.equal(validateCallsState(state).ok, false);
  callsWindow(state, 'original').callId = null; startLocalCall(state, recipient, 1000, allow); state.calls[0].status = 'in-call'; assert.equal(validateCallsState(state).ok, false);
});
test('All/Missed recents derives only terminal unconnected incoming calls from the same records', () => {
  const state = createCallsState(CALLS_PROFILES[0]); createCallsWindow(state, 'recents');
  const incoming = receiveLocalCall(state, recipient, 1000, allow); transitionLocalCall(state, incoming.callId, 'end', {}, 2000, allow);
  const outgoing = startLocalCall(state, recipient, 2000, allow); transitionLocalCall(state, outgoing.callId, 'end', {}, 2100, allow);
  callsWindow(state, 'recents').recentFilter = 'missed'; assert.deepEqual(visibleRecentCalls(state, 'recents').map(row => row.id), [incoming.callId]);
  callsWindow(state, 'recents').recentFilter = 'all'; assert.deepEqual(visibleRecentCalls(state, 'recents').map(row => row.id), [outgoing.callId, incoming.callId]);
});
test('immutable or reentrantly changed root descriptors reject before any partial canonical assignment', () => {
  const state = createCallsState(CALLS_PROFILES[0]); Object.freeze(state);
  assert.equal(startLocalCall(state, recipient, 1000, allow).status, 'rejected'); assert.equal(state.calls.length, 0);
  const mutable = createCallsState(CALLS_PROFILES[0]);
  const result = startLocalCall(mutable, recipient, 1000, () => { Object.defineProperty(mutable, 'nextId', { writable: false }); return true; });
  assert.equal(result.status, 'rejected'); assert.equal(mutable.calls.length, 0); assert.equal(mutable.runtime.lastTime, 0);
});

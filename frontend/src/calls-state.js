import { object, choice, flag } from './command-schema.js';
import { canonicalStringUnits, copyCanonicalData } from './canonical-data.js';
import { recipientIdentity } from './messages-recipients.js';

export const CALLS_PROFILES = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
export const CALLS_LIMITS = { calls: 256, windows: 16, recipients: 512, text: 4096, time: 8639999999999999 };
const text = (maxLength = 4096, minLength = 0) => ({ type: 'string', minLength, maxLength });
export const callsIdSchema = text(128, 1);
const timeSchema = { type: 'integer', minimum: 0, maximum: CALLS_LIMITS.time };
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const array = (schema, maxItems) => ({ type: 'array', items: schema, maxItems });
export const callsRecipientSchema = object({ id: callsIdSchema, name: text(512, 1), email: text(512), phone: text(512) });
export const callsStartSchema = object({ contactId: callsIdSchema, name: text(512, 1), address: text(320, 1), kind: choice('audio', 'video') }, ['kind']);
export const callsPreferencesSchema = object({ notificationsEnabled: flag, defaultKind: choice('audio', 'video'), ringtone: choice('Opening', 'Reflection'), hideSelfView: flag });
const participantSchema = object({ id: callsIdSchema, contactId: nullable(callsIdSchema), name: text(512, 1), address: text(320, 1), role: choice('remote'), media: choice('studio') });
export const callsRecordSchema = object({ id: callsIdSchema, revision: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, kind: choice('audio', 'video'), direction: choice('incoming', 'outgoing'), status: choice('ringing', 'connecting', 'in-call', 'ended', 'failed'), createdAt: timeSchema, connectingAt: nullable(timeSchema), connectedAt: nullable(timeSchema), endedAt: nullable(timeSchema), muted: flag, cameraEnabled: flag, failure: text(512), notificationId: nullable(callsIdSchema), participants: { ...array(participantSchema, 31), minItems: 1 } });
export const callsWindowSchema = object({ windowId: callsIdSchema, callId: nullable(callsIdSchema), query: text(), recentFilter: choice('all', 'missed'), recipients: array(callsRecipientSchema, CALLS_LIMITS.recipients), selectedContactId: nullable(callsIdSchema), pickerOpen: flag, sheet: choice('none', 'account', 'preferences', 'blocked', 'help') });
export const callsStateSchema = object({ version: choice(1), profileId: choice(...CALLS_PROFILES), nextId: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }, calls: array(callsRecordSchema, CALLS_LIMITS.calls), windows: array(callsWindowSchema, CALLS_LIMITS.windows), preferences: callsPreferencesSchema, runtime: object({ lastTime: timeSchema }) });
const reject = (code, message) => ({ status: 'rejected', error: { code, message }, code, message });
export function callsSchemaValid(value, schema, seen = new Set()) {
  try {
    if (Object.hasOwn(schema, 'const')) {
      if (value !== schema.const) return false;
      if (!schema.type && !schema.enum && !schema.anyOf) return true;
    }
    if (schema.anyOf) return schema.anyOf.some(branch => callsSchemaValid(value, branch, new Set(seen)));
    if (schema.enum) return schema.enum.includes(value);
    if (schema.type === 'null') return value === null;
    if (schema.type === 'boolean') return typeof value === 'boolean';
    if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity) && !/[\u0000]/.test(value);
    if (schema.type === 'integer' || schema.type === 'number') return Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (schema.type === 'array') {
      if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > schema.maxItems || value.length < (schema.minItems ?? 0) || Reflect.ownKeys(value).length !== value.length + 1) return false;
      return Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index))).every(descriptor => descriptor?.enumerable && Object.hasOwn(descriptor, 'value') && callsSchemaValid(descriptor.value, schema.items, seen));
    }
    if (schema.type !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string' || !Object.hasOwn(schema.properties, key)) || schema.required.some(key => !keys.includes(key))) return false;
    return keys.every(key => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor?.enumerable && Object.hasOwn(descriptor, 'value') && callsSchemaValid(descriptor.value, schema.properties[key], seen); });
  } catch { return false; }
}
export function validateCallsState(state, profile = null) {
  if (!callsSchemaValid(state, callsStateSchema)) return { ok: false, message: 'Calls requires a bounded closed plain-data graph.' };
  const unique = rows => new Set(rows.map(row => row.id ?? row.windowId)).size === rows.length;
  if ((profile && state.profileId !== (typeof profile === 'string' ? profile : profile.id)) || !unique(state.calls) || !unique(state.windows)) return { ok: false, message: 'Calls requires exact profile and unique stable call/window identities.' };
  if (state.calls.filter(call => !['ended', 'failed'].includes(call.status)).length > 1) return { ok: false, message: 'Only one local authored call may be active.' };
  if (new Set(state.calls.filter(call => call.notificationId).map(call => call.notificationId)).size !== state.calls.filter(call => call.notificationId).length) return { ok: false, message: 'A shared call notification identity belongs to only one canonical call.' };
  const capabilities = callsCapabilities(state.profileId);
  if (state.calls.some(call => call.participants.length > capabilities.maxRemoteParticipants || call.participants.some(row => !recipientIdentity(row.address)) || new Set(call.participants.map(row => recipientIdentity(row.address))).size !== call.participants.length)) return { ok: false, message: 'Participants exceed the researched native release limit or duplicate an address.' };
  for (const call of state.calls) {
    if (!unique(call.participants) || call.participants.some(row => !row.name.trim() || !row.address.trim()) || new Set(call.participants.filter(row => row.contactId).map(row => row.contactId)).size !== call.participants.filter(row => row.contactId).length) return { ok: false, message: 'Participants require distinct actual identities and nonblank names/addresses.' };
    if (call.createdAt > state.runtime.lastTime || (call.connectingAt !== null && (call.connectingAt < call.createdAt || call.connectingAt > state.runtime.lastTime)) || (call.connectedAt !== null && (call.connectingAt === null || call.connectedAt < call.connectingAt || call.connectedAt > state.runtime.lastTime)) || (call.endedAt !== null && (call.endedAt < (call.connectedAt ?? call.connectingAt ?? call.createdAt) || call.endedAt > state.runtime.lastTime))) return { ok: false, message: 'Call timestamps must follow the monotonic authored clock.' };
    if ((['ended', 'failed'].includes(call.status)) !== (call.endedAt !== null) || (call.status === 'in-call' && call.connectedAt === null) || (call.status === 'connecting' && call.connectingAt === null) || (call.status === 'ringing' && call.connectingAt !== null) || (['ringing', 'connecting'].includes(call.status) && call.connectedAt !== null) || (call.status === 'failed') !== !!call.failure || (call.kind === 'audio' && call.cameraEnabled)) return { ok: false, message: 'Call status/media/timestamps disagree.' };
  }
  for (const window of state.windows) if ((window.callId !== null && !callById(state, window.callId)) || !unique(window.recipients) || (window.selectedContactId !== null && !window.recipients.some(row => row.id === window.selectedContactId))) return { ok: false, message: 'Sessions may reference only original existing calls and resolved contacts.' };
  return { ok: true };
}
export function createCallsState(profile) {
  const profileId = typeof profile === 'string' ? profile : profile.id;
  if (!CALLS_PROFILES.includes(profileId)) throw new TypeError('Unsupported Calls profile.');
  return { version: 1, profileId, nextId: 1, calls: [], windows: [], preferences: { notificationsEnabled: true, defaultKind: 'video', ringtone: 'Opening', hideSelfView: false }, runtime: { lastTime: 0 } };
}
export const callsWindow = (state, windowId) => state.windows.find(row => row.windowId === windowId) ?? null;
export const callById = (state, callId) => state.calls.find(row => row.id === callId) ?? null;
export const callsCapabilities = profile => { const id = typeof profile === 'string' ? profile : profile.id, windows = id.startsWith('windows11'), classic = ['macos-high-sierra-10.13', 'macos-mojave-10.14'].includes(id); return { windows, classic, golden: id === 'macos-golden-gate-27.0.1', appId: windows ? 'teams' : 'facetime', utilityKind: windows ? 'teams-call' : null, groupSupported: !classic, maxRemoteParticipants: classic ? 1 : windows ? 19 : 31, groupUnavailableReason: id === 'macos-mojave-10.14' ? 'Installed Mojave 10.14 has no proven later point release. Group FaceTime debuted in 10.14.1; Apple requires 10.14.3 Supplemental or later after its security restoration. Not backported.' : 'High Sierra does not support Group FaceTime.' }; };
export function createCallsWindow(state, windowId, callId = null) {
  if (!validateCallsState(state).ok || !callsSchemaValid(windowId, callsIdSchema) || (callId !== null && !callById(state, callId))) return reject('invalid_arguments', 'Use the original Calls window and call ID.');
  const existing = callsWindow(state, windowId); if (existing) return { status: 'applied', windowId, session: existing };
  if (state.windows.length >= CALLS_LIMITS.windows) return reject('limit_exceeded', 'Too many Calls windows.');
  const session = { windowId, callId, query: '', recentFilter: 'all', recipients: [], selectedContactId: null, pickerOpen: false, sheet: 'none' };
  state.windows.push(session); return { status: 'applied', windowId, session };
}
export function visibleRecentCalls(state, windowId) {
  const session = callsWindow(state, windowId), query = (session?.query ?? '').trim().toLocaleLowerCase();
  return state.calls.filter(call => (session?.recentFilter !== 'missed' || (call.direction === 'incoming' && ['ended', 'failed'].includes(call.status) && call.connectedAt === null)) && (!query || call.participants.some(row => `${row.name} ${row.address}`.toLocaleLowerCase().includes(query)))).slice().sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}
export const callDuration = (call, time) => !call || call.connectedAt === null ? 0 : Math.max(0, Math.floor(((call.endedAt ?? time) - call.connectedAt) / 1000));
export function callsDurationLabel(seconds) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; }
const timeValid = time => callsSchemaValid(time, timeSchema);
// Every public transition budgets the complete candidate and rechecks graph identity
// after a potentially reentrant parent budget decision, immediately before mutation.
export function commitCallsCandidate(state, mutate, canCommit, guard = () => true) {
  if (!validateCallsState(state).ok || typeof canCommit !== 'function' || guard() !== true) return reject('stale_target', 'The original canonical Calls graph or ownership is unavailable.');
  const descriptors = Reflect.ownKeys(state).map(key => [key, Object.getOwnPropertyDescriptor(state, key)]);
  if (descriptors.some(([, descriptor]) => descriptor.writable !== true)) return reject('invalid_arguments', 'The canonical Calls root requires writable data properties for atomic commit.');
  const snapshot = JSON.stringify(state), calls = state.calls, windows = state.windows, runtime = state.runtime;
  const candidate = copyCanonicalData(state), result = mutate(candidate);
  if (result?.status === 'rejected') return result;
  const validation = validateCallsState(candidate); if (!validation.ok) return reject('invalid_arguments', validation.message);
  let allowed; try { allowed = canCommit(canonicalStringUnits(candidate) - canonicalStringUnits(state)); } catch { allowed = false; }
  if (allowed !== true) return reject('limit_exceeded', 'The complete scene text budget rejects this call mutation.');
  if (guard() !== true || state.calls !== calls || state.windows !== windows || state.runtime !== runtime || !validateCallsState(state).ok || JSON.stringify(state) !== snapshot) return reject('stale_target', 'The original Calls graph changed before canonical commit.');
  if (descriptors.some(([key, descriptor]) => { const current = Object.getOwnPropertyDescriptor(state, key); return !current || current.writable !== true || current.value !== descriptor.value || current.configurable !== descriptor.configurable; })) return reject('stale_target', 'The Calls root descriptors changed before canonical commit.');
  const retainRecords = (original, prepared, key) => {
    const byId = new Map(original.map(row => [row[key], row]));
    return prepared.map(row => {
      const retained = byId.get(row[key]);
      if (!retained) return row;
      Object.assign(retained, row);
      return retained;
    });
  };
  calls.splice(0, calls.length, ...retainRecords(calls, candidate.calls, 'id'));
  windows.splice(0, windows.length, ...retainRecords(windows, candidate.windows, 'windowId'));
  Object.assign(runtime, candidate.runtime);
  state.nextId = candidate.nextId;
  Object.assign(state.preferences, candidate.preferences);
  return { status: 'applied', ...(result ?? {}) };
}
function createCall(candidate, spec, time, direction) {
  if (!callsSchemaValid(spec, callsStartSchema) || !spec.name?.trim() || !recipientIdentity(spec.address ?? '') || !timeValid(time) || time < candidate.runtime.lastTime) return reject('invalid_arguments', 'Resolve the actual contact or supply a bounded nonblank recipient and monotonic authored time.');
  if (candidate.calls.some(call => !['ended', 'failed'].includes(call.status))) return reject('busy', 'End the current local call before starting another.');
  if (candidate.calls.length >= CALLS_LIMITS.calls || candidate.nextId >= Number.MAX_SAFE_INTEGER) return reject('limit_exceeded', 'The local Calls history limit is reached.');
  const id = `call-${candidate.nextId++}`;
  if (callById(candidate, id)) return reject('invalid_arguments', 'The next canonical call identity is already in use.');
  candidate.runtime.lastTime = time;
  candidate.calls.push({ id, revision: 1, kind: spec.kind, direction, status: 'ringing', createdAt: time, connectingAt: null, connectedAt: null, endedAt: null, muted: false, cameraEnabled: spec.kind === 'video', failure: '', notificationId: null, participants: [{ id: `${id}-remote`, contactId: spec.contactId ?? null, name: spec.name.trim(), address: spec.address.trim(), role: 'remote', media: 'studio' }] });
  return { callId: id };
}
export function startLocalCall(state, spec, time, canCommit, guard = () => true) { return commitCallsCandidate(state, candidate => createCall(candidate, spec, time, 'outgoing'), canCommit, guard); }
export function receiveLocalCall(state, spec, time, canCommit, guard = () => true) { return commitCallsCandidate(state, candidate => createCall(candidate, spec, time, 'incoming'), canCommit, guard); }
export function transitionLocalCall(state, callId, action, payload, time, canCommit, guard = () => true) {
  return commitCallsCandidate(state, candidate => {
    const call = callById(candidate, callId);
    if (!call || !timeValid(time) || time < candidate.runtime.lastTime) return reject('stale_target', 'The original call or authored time is unavailable.');
    if (['ended', 'failed'].includes(call.status)) return reject('invalid_transition', 'An ended call cannot be resumed or controlled.');
    if (call.revision >= Number.MAX_SAFE_INTEGER) return reject('limit_exceeded', 'Call revision limit reached.');
    if (action === 'accept') { if (call.direction !== 'incoming' || call.status !== 'ringing') return reject('invalid_transition', 'Accept only an original ringing incoming call.'); call.status = 'connecting'; call.connectingAt = time; }
    else if (action === 'end') { call.status = 'ended'; call.endedAt = time; }
    else if (action === 'fail') { if (!callsSchemaValid(payload, object({ reason: text(512, 1) })) || !payload.reason.trim()) return reject('invalid_arguments', 'Supply the deliberate local failure reason.'); call.status = 'failed'; call.failure = payload.reason.trim(); call.endedAt = time; }
    else if (action === 'media') { if (!callsSchemaValid(payload, object({ muted: flag, cameraEnabled: flag }, [])) || !Object.keys(payload).length || (call.kind === 'audio' && payload.cameraEnabled === true)) return reject('invalid_arguments', 'Use actual bounded local audio/video controls.'); Object.assign(call, payload); }
    else return reject('invalid_arguments', 'Unsupported local call transition.');
    call.revision++; candidate.runtime.lastTime = time;
    return { callId, callStatus: call.status };
  }, canCommit, guard);
}
export function advanceLocalCalls(state, time, canCommit, guard = () => true) {
  return commitCallsCandidate(state, candidate => {
    if (!timeValid(time) || time < candidate.runtime.lastTime) return reject('invalid_arguments', 'Calls advances only from the authored monotonic shared clock.');
    for (const call of candidate.calls) {
      const old = call.status;
      if (call.status === 'ringing' && call.direction === 'incoming' && time - call.createdAt >= 30000) { call.status = 'ended'; call.endedAt = call.createdAt + 30000; }
      else if (call.status === 'ringing' && call.direction === 'outgoing' && time - call.createdAt >= 2000) { call.status = 'connecting'; call.connectingAt = call.createdAt + 2000; }
      if (call.status === 'connecting') {
        const connectAt = call.connectingAt + 2000;
        if (time >= connectAt) { call.status = 'in-call'; call.connectedAt = connectAt; }
      }
      if (old !== call.status) { if (call.revision >= Number.MAX_SAFE_INTEGER) return reject('limit_exceeded', 'Call revision limit reached.'); call.revision++; }
    }
    candidate.runtime.lastTime = time; return { time };
  }, canCommit, guard);
}

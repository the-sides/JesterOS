import { object, identity } from './command-schema.js';
import { isRecord, rejected } from './feature-commands.js';

const MAX_TEXT = 1024 * 1024, MAX_TOTAL_TEXT = 4 * MAX_TEXT, MAX_ENTRIES = 256;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1, MAX_TIME = 8_640_000_000_000_000 - 1;
const entryKeys = ['id', 'appId', 'title', 'body', 'createdAt'];
const titleSchema = { type: 'string', minLength: 1, maxLength: 256,
  pattern: '^(?=[\\s\\S]*\\S)(?![\\s\\S]*[\\r\\n\\u2028\\u2029])[\\s\\S]+$' };
export const notificationsSchema = object({
  nextId: { type: 'integer', minimum: 1, maximum: MAX_COUNTER },
  entries: { type: 'array', maxItems: MAX_ENTRIES, items: object({
    id: { type: 'string', pattern: '^notification-[1-9][0-9]*$' }, appId: identity,
    title: titleSchema, body: { type: 'string', maxLength: MAX_TEXT },
    createdAt: { type: 'integer', minimum: 0, maximum: MAX_TIME },
  }) },
});
export const notificationsDefaults = () => ({ nextId: 1, entries: [] });
const bounded = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const title = value => typeof value === 'string' && value.length > 0 && value.length <= 256
  && /\S/u.test(value) && !/[\r\n\u2028\u2029]/u.test(value);
const body = value => typeof value === 'string' && value.length <= MAX_TEXT;
const invalid = () => ({ ok: false, message: 'Notifications require closed plain data, at most 256 registered-app entries, unique positive allocations below nextId, literal nonblank single-line titles, bounded bodies and scene timestamps.' });
const fail = (code, message) => rejected(code, message);
const descriptorSame = (a, b) => a && b && a.enumerable === b.enumerable && a.configurable === b.configurable
  && a.writable === b.writable && a.value === b.value && a.get === b.get && a.set === b.set;

// Inspect the complete descriptor set before reading any actor-supplied value.
function record(value, required, optional = []) {
  if (!isRecord(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string' || !required.includes(key) && !optional.includes(key)
    || descriptors[key].enumerable !== true || !Object.hasOwn(descriptors[key], 'value'))
    || required.some(key => !Object.hasOwn(descriptors, key))) return null;
  return descriptors;
}
function dense(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), length = descriptors.length;
  if (!length || !Object.hasOwn(length, 'value') || !bounded(length.value, 0, MAX_ENTRIES)
    || Reflect.ownKeys(descriptors).length !== length.value + 1) return null;
  for (let index = 0; index < length.value; index++) {
    const field = descriptors[String(index)];
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) return null;
  }
  return descriptors;
}
const allocation = value => typeof value === 'string' && /^notification-[1-9][0-9]*$/.test(value)
  && bounded(Number(value.slice(13)), 1, MAX_COUNTER) ? Number(value.slice(13)) : null;
const registered = (profile, appId) => typeof appId === 'string' && appId.length > 0
  && (profile === undefined || profile?.applications && Object.hasOwn(profile.applications, appId));
function capture(value, descriptors) {
  return { value, prototype: Object.getPrototypeOf(value), descriptors };
}
function current(snapshots) {
  try {
    return snapshots.every(({ value, prototype, descriptors }) => Object.getPrototypeOf(value) === prototype
      && Reflect.ownKeys(value).length === Reflect.ownKeys(descriptors).length
      && Reflect.ownKeys(descriptors).every(key => descriptorSame(Object.getOwnPropertyDescriptor(value, key), descriptors[key])));
  } catch { return false; }
}
function inspect(state, profile) {
  const fields = record(state, ['nextId', 'entries']);
  if (!fields || !bounded(fields.nextId.value, 1, MAX_COUNTER)) return null;
  const entries = fields.entries.value, list = dense(entries);
  if (!list) return null;
  const snapshots = [capture(state, fields), capture(entries, list)], ids = new Set();
  let units = 'nextId'.length + 'entries'.length;
  for (let index = 0; index < list.length.value; index++) {
    const entry = list[String(index)].value, data = record(entry, entryKeys);
    if (!data) return null;
    const ordinal = allocation(data.id.value);
    if (ordinal === null || ordinal >= fields.nextId.value || ids.has(ordinal)
      || !registered(profile, data.appId.value) || !title(data.title.value) || !body(data.body.value)
      || !bounded(data.createdAt.value, 0, MAX_TIME)) return null;
    ids.add(ordinal); snapshots.push(capture(entry, data));
    units += String(index).length;
    for (const key of entryKeys) units += key.length + (typeof data[key].value === 'string' ? data[key].value.length : 0);
    if (units > MAX_TOTAL_TEXT) return null;
  }
  return { entries, nextId: fields.nextId.value, fields, snapshots, units };
}
export function validateNotificationsState(state, profile) {
  try { return inspect(state, profile) ? { ok: true } : invalid(); } catch { return invalid(); }
}
export function notificationGroups(state, profile) {
  try {
    const original = inspect(state, profile); if (!original) return [];
    const grouped = new Map();
    for (const entry of original.entries) {
      let group = grouped.get(entry.appId);
      if (!group) {
        const app = profile?.applications?.[entry.appId];
        group = { groupId: entry.appId, appId: entry.appId, name: app?.name ?? entry.appId,
          icon: app?.icon ?? null, latestAt: entry.createdAt, entries: [] };
        grouped.set(entry.appId, group);
      }
      group.entries.push(entry);
    }
    const chronology = (a, b) => b.createdAt - a.createdAt || allocation(b.id) - allocation(a.id);
    const groups = [...grouped.values()];
    for (const group of groups) { group.entries.sort(chronology); group.latestAt = group.entries[0].createdAt; }
    groups.sort((a, b) => chronology(a.entries[0], b.entries[0]));
    return groups;
  } catch { return []; }
}
function mutationState(state, profile) {
  try {
    const validated = inspect(state, profile);
    if (!validated) return null;
    // Read only validated data properties before taking the mutation lease.
    // Reactive containers lazily wrap their array and entry identities.
    const entries = state.entries;
    for (let index = 0; index < entries.length; index++) void entries[index];
    return inspect(state, profile);
  } catch { return null; }
}
function writable(original, keys) {
  return keys.every(key => original.fields[key]?.writable === true);
}
export function postNotification(state, profile, appId, payload, sceneTime, canCommit = () => true) {
  try {
    if (profile?.id !== 'macos-golden-gate-27.0.1' || !profile.capabilities?.includes('shell.notification-center'))
      return fail('unsupported_profile', 'Only the current Golden Gate profile accepts notification events.');
    const data = record(payload, ['title', 'body'], ['createdAt']);
    if (!data || !registered(profile, appId) || !title(data.title.value) || !body(data.body.value))
      return fail('invalid_arguments', 'Post a registered application and a closed literal title/body payload with an optional bounded createdAt.');
    const createdAt = Object.hasOwn(data, 'createdAt') ? data.createdAt.value : sceneTime;
    if (!bounded(createdAt, 0, MAX_TIME)) return fail('invalid_arguments', 'Notification time must be an integer scene timestamp in the supported Date range.');
    const original = mutationState(state, profile);
    if (!original || !writable(original, ['entries', 'nextId']) || typeof canCommit !== 'function')
      return fail('invalid_arguments', invalid().message);
    if (!current(original.snapshots)) return fail('stale_target', 'The original notification descriptors changed before the quota decision.');
    if (original.entries.length >= MAX_ENTRIES || original.nextId >= MAX_COUNTER)
      return fail('limit_exceeded', 'Notification capacity or the nonreusable allocation counter is exhausted.');
    const entry = { id: `notification-${original.nextId}`, appId, title: data.title.value, body: data.body.value, createdAt };
    const delta = String(original.entries.length).length
      + entryKeys.reduce((total, key) => total + key.length + (typeof entry[key] === 'string' ? entry[key].length : 0), 0);
    if (original.units + delta > MAX_TOTAL_TEXT) return fail('limit_exceeded', 'Notification text exceeds the four Mi scene budget.');
    let accepted = false;
    try { accepted = canCommit(delta) === true; } catch { /* A failed quota decision never authorizes mutation. */ }
    if (!current(original.snapshots)) return fail('stale_target', 'The original notification state changed during its quota decision.');
    if (!accepted) return fail('limit_exceeded', 'The complete-scene notification text budget rejected this event.');
    state.entries = [...original.entries, entry]; state.nextId = original.nextId + 1;
    return { status: 'applied', target: { notificationId: entry.id, appId, createdAt } };
  } catch { return fail('invalid_arguments', invalid().message); }
}
export function dismissNotification(state, notificationId) {
  try {
    const original = mutationState(state);
    if (!original || !writable(original, ['entries']) || allocation(notificationId) === null)
      return fail('invalid_arguments', invalid().message);
    if (!current(original.snapshots)) return fail('stale_target', 'The original notification descriptors changed before dismissal.');
    if (!original.entries.some(entry => entry.id === notificationId)) return fail('not_found', 'The original notification no longer exists.');
    state.entries = original.entries.filter(entry => entry.id !== notificationId);
    return { status: 'applied', target: { notificationId, dismissed: true } };
  } catch { return fail('invalid_arguments', invalid().message); }
}
export function clearNotifications(state, groupId) {
  try {
    const original = mutationState(state);
    if (!original || !writable(original, ['entries']) || groupId !== undefined && (typeof groupId !== 'string' || !groupId.length))
      return fail('invalid_arguments', invalid().message);
    if (!current(original.snapshots)) return fail('stale_target', 'The original notification descriptors changed before clearing.');
    const removedIds = original.entries.filter(entry => groupId === undefined || entry.appId === groupId).map(entry => entry.id);
    if (groupId !== undefined && !removedIds.length) return fail('not_found', 'The original notification application group no longer exists.');
    if (removedIds.length) state.entries = groupId === undefined ? [] : original.entries.filter(entry => entry.appId !== groupId);
    return { status: 'applied', target: { removedIds } };
  } catch { return fail('invalid_arguments', invalid().message); }
}

import { object, flag, choice } from './command-schema.js';
import { isRecord, rejected } from './feature-commands.js';

const MAX_TEXT = 1024 * 1024, MAX_TOTAL_TEXT = 4 * MAX_TEXT, MAX_ENTRIES = 256, MAX_APPLICATIONS = 128;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1, MAX_TIME = 8_640_000_000_000_000 - 1;
const forbiddenIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const identity = { type: 'string', minLength: 1, maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...forbiddenIds] } };
const entryKeys = ['id', 'appId', 'title', 'body', 'createdAt', 'destination', 'snoozedUntil'];
const preferenceKeys = ['doNotDisturb', 'showPreviews', 'applications'];
const appKeys = ['appId', 'allow', 'desktop', 'center', 'style', 'previews'];
const appPatchKeys = appKeys.slice(1), globalPatchKeys = preferenceKeys.slice(0, 2);
const previews = ['always', 'when-unlocked', 'never'], styles = ['temporary', 'persistent'];
const destinationApps = { message: 'messages', mail: 'mail', event: 'calendar', reminder: 'reminders', note: 'notes' };
const destinationKinds = [...Object.keys(destinationApps), 'file'];
const timestampSchema = { type: 'integer', minimum: 0, maximum: MAX_TIME };
const titleSchema = { type: 'string', minLength: 1, maxLength: 256,
  pattern: '^(?=[\\s\\S]*\\S)(?![\\s\\S]*[\\r\\n\\u2028\\u2029])[\\s\\S]+$' };
const appSchema = object({ appId: identity, allow: flag, desktop: flag, center: flag,
  style: choice(...styles), previews: choice('default', ...previews) });
const preferencesSchema = object({ doNotDisturb: flag, showPreviews: choice(...previews),
  applications: { type: 'array', maxItems: MAX_APPLICATIONS, items: appSchema } });
const entrySchema = object({
  id: { type: 'string', pattern: '^notification-[1-9][0-9]*$' }, appId: identity,
  title: titleSchema, body: { type: 'string', maxLength: MAX_TEXT }, createdAt: timestampSchema,
  destination: { anyOf: [{ type: 'null' }, object({ kind: choice(...destinationKinds), recordId: identity })] },
  snoozedUntil: { anyOf: [{ type: 'null' }, timestampSchema] },
});
entrySchema.allOf = Object.entries(destinationApps).map(([kind, appId]) => ({
  if: { properties: { destination: { type: 'object', properties: { kind: { const: kind } }, required: ['kind'] } } },
  then: { properties: { appId: { const: appId } } },
}));
export const notificationsSchema = object({
  nextId: { type: 'integer', minimum: 1, maximum: MAX_COUNTER },
  entries: { type: 'array', maxItems: MAX_ENTRIES, items: entrySchema }, preferences: preferencesSchema,
});
export const notificationsDefaults = () => ({ nextId: 1, entries: [],
  preferences: { doNotDisturb: false, showPreviews: 'when-unlocked', applications: [] } });
const appDefaults = appId => ({ appId, allow: true, desktop: true, center: true, style: 'temporary', previews: 'default' });
const bounded = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const validIdentity = value => typeof value === 'string' && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !forbiddenIds.has(value);
const title = value => typeof value === 'string' && value.length > 0 && value.length <= 256
  && /\S/u.test(value) && !/[\r\n\u2028\u2029]/u.test(value);
const body = value => typeof value === 'string' && value.length <= MAX_TEXT;
const invalid = () => ({ ok: false, message: 'Notifications require closed plain preferences and destinations, distinct registered applications, at most 256 entries, unique positive allocations below nextId, bounded literal text and scene timestamps.' });
const fail = (code, message) => rejected(code, message);
const supported = profile => profile?.id === 'macos-golden-gate-27.0.1'
  && profile.capabilities?.includes('shell.notification-center');
const unsupported = () => fail('unsupported_profile', 'Only the current Golden Gate profile accepts notification changes.');
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
function dense(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), length = descriptors.length;
  if (!length || !Object.hasOwn(length, 'value') || !bounded(length.value, 0, maximum)
    || Reflect.ownKeys(descriptors).length !== length.value + 1) return null;
  for (let index = 0; index < length.value; index++) {
    const field = descriptors[String(index)];
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) return null;
  }
  return descriptors;
}
const allocation = value => typeof value === 'string' && /^notification-[1-9][0-9]*$/.test(value)
  && bounded(Number(value.slice(13)), 1, MAX_COUNTER) ? Number(value.slice(13)) : null;
const registered = (profile, appId) => validIdentity(appId)
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
function literalUnits(descriptors) {
  let units = 0;
  for (const [key, field] of Object.entries(descriptors))
    units += key.length + (typeof field.value === 'string' ? field.value.length : 0);
  return units;
}
function destinationData(value, appId) {
  if (value === null) return { fields: null, copy: null, units: 0 };
  const fields = record(value, ['kind', 'recordId']);
  if (!fields || !destinationKinds.includes(fields.kind.value) || !validIdentity(fields.recordId.value)
    || fields.kind.value !== 'file' && destinationApps[fields.kind.value] !== appId) return null;
  return { fields, copy: { kind: fields.kind.value, recordId: fields.recordId.value }, units: literalUnits(fields) };
}
function validApp(fields, profile) {
  return fields && registered(profile, fields.appId.value)
    && ['allow', 'desktop', 'center'].every(key => typeof fields[key].value === 'boolean')
    && styles.includes(fields.style.value) && ['default', ...previews].includes(fields.previews.value);
}
function inspect(state, profile) {
  const fields = record(state, ['nextId', 'entries', 'preferences']);
  if (!fields || !bounded(fields.nextId.value, 1, MAX_COUNTER)) return null;
  const entries = fields.entries.value, list = dense(entries, MAX_ENTRIES);
  const preferences = fields.preferences.value, preferenceFields = record(preferences, preferenceKeys);
  if (!list || !preferenceFields || typeof preferenceFields.doNotDisturb.value !== 'boolean'
    || !previews.includes(preferenceFields.showPreviews.value)) return null;
  const applications = preferenceFields.applications.value, appList = dense(applications, MAX_APPLICATIONS);
  if (!appList) return null;
  const snapshots = [capture(state, fields), capture(entries, list), capture(preferences, preferenceFields), capture(applications, appList)];
  const ids = new Set(), appIds = new Set();
  let preferenceUnits = literalUnits(preferenceFields), units = literalUnits(fields);
  for (let index = 0; index < appList.length.value; index++) {
    const row = appList[String(index)].value, data = record(row, appKeys);
    if (!validApp(data, profile) || appIds.has(data.appId.value)) return null;
    appIds.add(data.appId.value); snapshots.push(capture(row, data));
    preferenceUnits += String(index).length + literalUnits(data);
  }
  units += preferenceUnits;
  for (let index = 0; index < list.length.value; index++) {
    const entry = list[String(index)].value, data = record(entry, entryKeys);
    if (!data) return null;
    const ordinal = allocation(data.id.value), destination = destinationData(data.destination.value, data.appId.value);
    if (ordinal === null || ordinal >= fields.nextId.value || ids.has(ordinal)
      || !registered(profile, data.appId.value) || !title(data.title.value) || !body(data.body.value)
      || !bounded(data.createdAt.value, 0, MAX_TIME) || !destination
      || data.snoozedUntil.value !== null && !bounded(data.snoozedUntil.value, 0, MAX_TIME)) return null;
    ids.add(ordinal); snapshots.push(capture(entry, data));
    if (destination.fields) snapshots.push(capture(data.destination.value, destination.fields));
    units += String(index).length + literalUnits(data) + destination.units;
  }
  if (units > MAX_TOTAL_TEXT) return null;
  return { entries, nextId: fields.nextId.value, preferences, applications, fields, snapshots, units, preferenceUnits };
}
export function validateNotificationsState(state, profile) {
  try { return inspect(state, profile) ? { ok: true } : invalid(); } catch { return invalid(); }
}
const resolvedApp = (original, appId) => original.applications.find(row => row.appId === appId) ?? appDefaults(appId);
export function notificationAppSettings(state, appId) {
  try {
    const original = inspect(state);
    return original && validIdentity(appId) ? { ...resolvedApp(original, appId) } : null;
  } catch { return null; }
}
export function notificationPreviewVisible(state, appId, unlocked = true) {
  try {
    const original = inspect(state);
    if (!original || !validIdentity(appId) || typeof unlocked !== 'boolean') return false;
    const app = resolvedApp(original, appId), policy = app.previews === 'default' ? original.preferences.showPreviews : app.previews;
    return app.allow && (policy === 'always' || policy === 'when-unlocked' && unlocked);
  } catch { return false; }
}
export function notificationDesktopStyle(state, appId) {
  try {
    const original = inspect(state); if (!original || !validIdentity(appId)) return null;
    const app = resolvedApp(original, appId);
    return app.allow && app.desktop && !original.preferences.doNotDisturb ? app.style : null;
  } catch { return null; }
}
export function notificationGroups(state, profile, sceneTime = MAX_TIME) {
  try {
    const original = inspect(state, profile); if (!original || !bounded(sceneTime, 0, MAX_TIME)) return [];
    const grouped = new Map();
    for (const entry of original.entries) {
      const settings = resolvedApp(original, entry.appId);
      if (!settings.allow || !settings.center || entry.snoozedUntil !== null && entry.snoozedUntil > sceneTime) continue;
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
    if (!inspect(state, profile)) return null;
    // Reactive containers lazily wrap every nested object. Warm only validated
    // data properties before leasing the full original canonical graph.
    const entries = state.entries;
    for (let index = 0; index < entries.length; index++) void entries[index].destination;
    const applications = state.preferences.applications;
    for (let index = 0; index < applications.length; index++) void applications[index];
    return inspect(state, profile);
  } catch { return null; }
}
function writable(original, keys) {
  return keys.every(key => original.fields[key]?.writable === true);
}
function quotaError(original, delta, canCommit) {
  if (typeof canCommit !== 'function') return fail('invalid_arguments', 'Expected a synchronous complete-scene text-budget callback.');
  if (!current(original.snapshots)) return fail('stale_target', 'The original notification descriptors changed before the quota decision.');
  if (original.units + delta > MAX_TOTAL_TEXT) return fail('limit_exceeded', 'Notification text exceeds the four Mi scene budget.');
  let accepted = false;
  try { accepted = canCommit(delta) === true; } catch { /* A failed quota decision never authorizes mutation. */ }
  if (!current(original.snapshots)) return fail('stale_target', 'The original notification state changed during its quota decision.');
  return accepted ? null : fail('limit_exceeded', 'The complete-scene notification text budget rejected this change.');
}
export function postNotification(state, profile, appId, payload, sceneTime, canCommit = () => true) {
  try {
    if (!supported(profile)) return unsupported();
    const data = record(payload, ['title', 'body'], ['createdAt', 'destination']);
    if (!data || !registered(profile, appId) || !title(data.title.value) || !body(data.body.value))
      return fail('invalid_arguments', 'Post a registered application and a closed literal title/body payload with optional createdAt and destination.');
    const createdAt = Object.hasOwn(data, 'createdAt') ? data.createdAt.value : sceneTime;
    const destination = destinationData(Object.hasOwn(data, 'destination') ? data.destination.value : null, appId);
    if (!bounded(createdAt, 0, MAX_TIME) || !destination) return fail('invalid_arguments', invalid().message);
    const entry = { id: '', appId, title: data.title.value, body: data.body.value, createdAt,
      destination: destination.copy, snoozedUntil: null };
    const original = mutationState(state, profile);
    if (!original || !writable(original, ['entries', 'nextId'])) return fail('invalid_arguments', invalid().message);
    if (original.entries.length >= MAX_ENTRIES || original.nextId >= MAX_COUNTER)
      return fail('limit_exceeded', 'Notification capacity or the nonreusable allocation counter is exhausted.');
    entry.id = `notification-${original.nextId}`;
    const delta = String(original.entries.length).length + literalUnits(Object.getOwnPropertyDescriptors(entry)) + destination.units;
    const denied = quotaError(original, delta, canCommit); if (denied) return denied;
    state.entries = [...original.entries, entry]; state.nextId = original.nextId + 1;
    return { status: 'applied', target: { notificationId: entry.id, appId, createdAt } };
  } catch { return fail('invalid_arguments', invalid().message); }
}
function patchData(patch, keys) {
  const fields = record(patch, [], keys);
  if (!fields || !Object.keys(fields).length) return null;
  const copy = {};
  for (const [key, field] of Object.entries(fields)) {
    const value = field.value;
    if (['allow', 'desktop', 'center', 'doNotDisturb'].includes(key) ? typeof value !== 'boolean'
      : key === 'style' ? !styles.includes(value)
        : key === 'previews' ? !['default', ...previews].includes(value) : !previews.includes(value)) return null;
    copy[key] = value;
  }
  return copy;
}
function preferencesUnits(preferences) {
  let units = literalUnits(Object.getOwnPropertyDescriptors(preferences));
  for (let index = 0; index < preferences.applications.length; index++)
    units += String(index).length + literalUnits(Object.getOwnPropertyDescriptors(preferences.applications[index]));
  return units;
}
const detachedPreferences = preferences => ({ doNotDisturb: preferences.doNotDisturb,
  showPreviews: preferences.showPreviews, applications: preferences.applications.map(row => ({ ...row })) });
export function configureNotificationApp(state, profile, appId, patch, canCommit = () => true) {
  try {
    if (!supported(profile)) return unsupported();
    const changes = patchData(patch, appPatchKeys);
    if (!registered(profile, appId) || !changes) return fail('invalid_arguments', 'Configure a registered app with a nonempty closed subset of notification preferences.');
    const original = mutationState(state, profile);
    if (!original || !writable(original, ['preferences'])) return fail('invalid_arguments', invalid().message);
    const settings = { ...resolvedApp(original, appId), ...changes }, defaults = appDefaults(appId);
    const isDefault = appPatchKeys.every(key => settings[key] === defaults[key]);
    const index = original.applications.findIndex(row => row.appId === appId), applications = [...original.applications];
    if (index >= 0) { if (isDefault) applications.splice(index, 1); else applications[index] = settings; }
    else if (!isDefault) {
      if (applications.length >= MAX_APPLICATIONS) return fail('limit_exceeded', 'Notification app preference capacity is exhausted.');
      applications.push(settings);
    }
    const preferences = { doNotDisturb: original.preferences.doNotDisturb, showPreviews: original.preferences.showPreviews, applications };
    const denied = quotaError(original, preferencesUnits(preferences) - original.preferenceUnits, canCommit); if (denied) return denied;
    if (index >= 0 || !isDefault) state.preferences = preferences;
    return { status: 'applied', target: { appId, settings: { ...settings } } };
  } catch { return fail('invalid_arguments', invalid().message); }
}
export function configureNotificationGlobals(state, profile, patch, canCommit = () => true) {
  try {
    if (!supported(profile)) return unsupported();
    const changes = patchData(patch, globalPatchKeys);
    if (!changes) return fail('invalid_arguments', 'Configure a nonempty closed subset of Do Not Disturb and global preview preferences.');
    const original = mutationState(state, profile);
    if (!original || !writable(original, ['preferences'])) return fail('invalid_arguments', invalid().message);
    const preferences = { doNotDisturb: original.preferences.doNotDisturb, showPreviews: original.preferences.showPreviews,
      applications: original.applications, ...changes };
    const denied = quotaError(original, preferencesUnits(preferences) - original.preferenceUnits, canCommit); if (denied) return denied;
    if (Object.keys(changes).some(key => original.preferences[key] !== changes[key])) state.preferences = preferences;
    return { status: 'applied', target: { preferences: detachedPreferences(preferences) } };
  } catch { return fail('invalid_arguments', invalid().message); }
}
export function snoozeNotification(state, notificationId, minutes, sceneTime) {
  try {
    if (allocation(notificationId) === null || ![5, 15, 60, 1440].includes(minutes)
      || !bounded(sceneTime, 0, MAX_TIME) || !bounded(sceneTime + minutes * 60_000, 0, MAX_TIME))
      return fail('invalid_arguments', 'Snooze requires an original notification, an authored duration of 5, 15, 60 or 1440 minutes, and a bounded scene time.');
    const original = mutationState(state);
    if (!original) return fail('invalid_arguments', invalid().message);
    const entry = original.entries.find(value => value.id === notificationId);
    if (!entry) return fail('not_found', 'The original notification no longer exists.');
    if (Object.getOwnPropertyDescriptor(entry, 'snoozedUntil')?.writable !== true) return fail('invalid_arguments', invalid().message);
    if (!current(original.snapshots)) return fail('stale_target', 'The original notification descriptors changed before snoozing.');
    const snoozedUntil = sceneTime + minutes * 60_000;
    entry.snoozedUntil = snoozedUntil;
    return { status: 'applied', target: { notificationId, snoozedUntil } };
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
    if (!original || !writable(original, ['entries']) || groupId !== undefined && !validIdentity(groupId))
      return fail('invalid_arguments', invalid().message);
    if (!current(original.snapshots)) return fail('stale_target', 'The original notification descriptors changed before clearing.');
    const removedIds = original.entries.filter(entry => groupId === undefined || entry.appId === groupId).map(entry => entry.id);
    if (groupId !== undefined && !removedIds.length) return fail('not_found', 'The original notification application group no longer exists.');
    if (removedIds.length) state.entries = groupId === undefined ? [] : original.entries.filter(entry => entry.appId !== groupId);
    return { status: 'applied', target: { removedIds } };
  } catch { return fail('invalid_arguments', invalid().message); }
}

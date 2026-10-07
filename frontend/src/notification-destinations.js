import { isRecord } from './feature-commands.js';

const apps = { message: 'messages', mail: 'mail', event: 'calendar', reminder: 'reminders', note: 'notes' };
const forbidden = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !forbidden.has(value);

function destination(value) {
  if (!isRecord(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || !['kind', 'recordId'].every(key => descriptors[key]?.enumerable
    && Object.hasOwn(descriptors[key], 'value'))) return null;
  const kind = descriptors.kind.value, recordId = descriptors.recordId.value;
  return typeof kind === 'string' && (Object.hasOwn(apps, kind) || kind === 'file') && identity(recordId) ? { kind, recordId } : null;
}

function liveFile(files, recordId) {
  const record = files.files.find(value => value.id === recordId);
  if (!record || !['document', 'image'].includes(record.kind)) return null;
  const visited = new Set();
  for (let current = record; current; current = current.parentId === null ? null : files.files.find(value => value.id === current.parentId)) {
    if (current.deleted || visited.has(current.id)) return null;
    visited.add(current.id);
  }
  return record;
}

/** Resolve only already-validated canonical sources; no invented inbox/thread. */
export function resolveNotificationDestination(entry, sources, profile) {
  if (!identity(entry?.appId) || !Object.hasOwn(profile.applications, entry.appId)) return null;
  if (entry.destination === null) return { kind: 'app', appId: entry.appId, recordId: null, record: profile.applications[entry.appId] };
  const target = destination(entry.destination);
  if (!target || target.kind !== 'file' && apps[target.kind] !== entry.appId) return null;
  let record;
  switch (target.kind) {
    case 'message': case 'mail':
      record = sources.communications.outbox.find(value => value.id === target.recordId && value.kind === target.kind);
      break;
    case 'event': record = sources.widgets.sources.events.find(value => value.id === target.recordId); break;
    case 'reminder': record = sources.widgets.sources.reminders.find(value => value.id === target.recordId); break;
    case 'note': record = sources.notes.notes.find(value => value.id === target.recordId && !value.deleted); break;
    case 'file': record = liveFile(sources.files, target.recordId); if (record?.appId !== entry.appId) return null; break;
  }
  return record ? { ...target, appId: entry.appId, record } : null;
}

export function notificationDestinationActions(source) {
  if (!source) return [];
  if (source.kind === 'event') return ['open', 'snooze'];
  if (source.kind === 'reminder') return source.record.completed ? ['open'] : ['open', 'snooze', 'complete'];
  if (['message', 'mail'].includes(source.kind)) return source.record.fields.to.trim() ? ['open', 'reply'] : ['open'];
  return ['open'];
}

/** Complete seed/save callers invoke this only after descriptor/schema checks. */
export function validateNotificationDestinations(seed, profile) {
  const sources = { notes: seed.notes, files: seed.files, communications: seed.communications, widgets: seed.system.widgets };
  return seed.system.notifications.entries.every(entry => resolveNotificationDestination(entry, sources, profile) !== null)
    ? { ok: true } : { ok: false, message: 'Every notification destination must name a live original record in its exact application domain.' };
}

function retainRecord(record) {
  const snapshots = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    // Materialize validated reactive children before capturing their descriptors.
    for (const key of Reflect.ownKeys(value)) if (key !== 'length') visit(value[key]);
    snapshots.push({ value, prototype: Object.getPrototypeOf(value), descriptors: Object.getOwnPropertyDescriptors(value) });
  };
  visit(record);
  return () => snapshots.every(({ value, prototype, descriptors }) => Object.getPrototypeOf(value) === prototype
    && Reflect.ownKeys(value).length === Reflect.ownKeys(descriptors).length
    && Reflect.ownKeys(descriptors).every(key => {
      const a = descriptors[key], b = Object.getOwnPropertyDescriptor(value, key);
      return b && a.enumerable === b.enumerable && a.configurable === b.configurable && a.writable === b.writable
        && a.value === b.value && a.get === b.get && a.set === b.set;
    }));
}

export function retainNotificationDestination(entry, getSources, profile, alive) {
  const sources = getSources(), source = resolveNotificationDestination(entry, sources, profile);
  if (!source) return null;
  const originalRecord = source.record, unchanged = retainRecord(originalRecord);
  return { source, current() {
    try {
      const currentSources = getSources();
      return alive() && Object.keys(sources).every(key => currentSources[key] === sources[key]) && unchanged()
        && resolveNotificationDestination(entry, currentSources, profile)?.record === originalRecord;
    } catch { return false; }
  } };
}

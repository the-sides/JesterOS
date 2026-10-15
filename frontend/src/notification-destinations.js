import { isRecord } from './feature-commands.js';
import { notesWorkspaceNotificationDestination } from './notes-workspace-projections.js';
import { callsCapabilities } from './calls-state.js';

const apps = { message: ['messages', 'teams'], mail: ['mail'], event: ['calendar'], reminder: ['reminders'],
  note: ['notes'], contact: ['contacts'], call: ['facetime', 'teams'], 'stocks-price': ['stocks'],
  'stocks-story': ['stocks'], 'news-story': ['news'], clock: ['clock'] };
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
  if (!target || target.kind !== 'file' && !apps[target.kind].includes(entry.appId)) return null;
  let record, deliveryRecord;
  switch (target.kind) {
    case 'message': {
      if (entry.appId !== (profile.family === 'windows' ? 'teams' : 'messages')) return null;
      record = sources.messages.conversations.find(value => value.id === target.recordId);
      break;
    }
    case 'mail': record = sources.mail.messages.find(value => value.id === target.recordId
      && sources.mail.accounts.some(account => account.id === value.accountId && account.enabled)
      && sources.mail.mailboxes.some(box => box.id === value.mailboxId && box.kind !== 'trash')); break;
    case 'contact': record = sources.contacts.contacts.find(value => value.id === target.recordId
      && sources.contacts.accounts.some(account => account.id === value.accountId && account.enabled)); break;
    case 'event': record = sources.calendar.events.find(value => value.id === target.recordId); break;
    case 'reminder': record = sources.reminders.tasks.find(value => value.id === target.recordId); break;
    case 'call': {
      const state = sources.calls;
      if (!state || state.profileId !== profile.id || callsCapabilities(state.profileId).appId !== entry.appId) return null;
      record = state.calls.find(value => value.id === target.recordId && value.direction === 'incoming' && value.status === 'ringing'
        && (entry.id === undefined ? value.notificationId === null : value.notificationId === entry.id));
      break;
    }
    case 'stocks-price':
    case 'stocks-story': {
      const state = sources.stocks;
      if (!state || state.profileId !== profile.id || !state.preferences.notifications) return null;
      record = (target.kind === 'stocks-price' ? state.quotes : state.stories).find(value => value.id === target.recordId);
      if (!record || target.kind === 'stocks-price' && !state.watchlist.includes(record.id)
        || target.kind === 'stocks-story' && record.publishedAt > state.runtime.refreshedAt) return null;
      if (entry.id !== undefined) {
        deliveryRecord = state.alerts.find(alert => alert.active && alert.notificationId === entry.id
          && alert.kind === target.kind && alert.recordId === record.id);
        if (!deliveryRecord) return null;
      }
      break;
    }
    case 'news-story': {
      const state = sources.news;
      if (!state || state.profileId !== profile.id || !state.preferences.notificationsEnabled) return null;
      record = state.articles.find(value => value.id === target.recordId);
      if (!record || !record.regions.includes(state.preferences.region) || state.preferences.restrictExplicit && record.explicit
        || !state.channels.some(channel => channel.id === record.channelId)) return null;
      if (entry.id !== undefined) {
        deliveryRecord = state.notifications.find(alert => alert.active && alert.notificationId === entry.id
          && alert.storyId === record.id);
        if (!deliveryRecord) return null;
      }
      break;
    }
    case 'clock': {
      const state = sources.clockApp;
      if (!state || !state.preferences.notifications) return null;
      record = state.alerts.find(value => value.id === target.recordId
        && (entry.id === undefined ? ['pending', 'snoozed'].includes(value.status)
          : value.status === 'delivered' && value.notificationId === entry.id));
      if (!record) return null;
      const original = (record.kind === 'alarm' ? state.alarms : state.timers).find(value => value.id === record.sourceId);
      if (!original) return null;
      return { ...target, appId: entry.appId, record, sourceId: original.id, sourceRecord: original };
    }
    case 'note': {
      const publicDestination = notesWorkspaceNotificationDestination(sources.notes, target.recordId);
      if (!publicDestination) return null;
      return { ...target, appId: entry.appId, record: publicDestination.projection };
    }
    case 'file': record = liveFile(sources.files, target.recordId); if (record?.appId !== entry.appId) return null; break;
  }
  return record ? { ...target, appId: entry.appId, record, ...(deliveryRecord ? { deliveryRecord } : {}) } : null;
}

export function notificationDestinationActions(source) {
  if (!source) return [];
  if (source.kind === 'call') return source.record.direction === 'incoming' && source.record.status === 'ringing'
    ? ['open', 'accept', 'decline'] : ['open'];
  if (source.kind === 'clock') return source.record.status === 'delivered' && source.record.kind === 'alarm'
    && source.sourceRecord.snooze ? ['open', 'snooze'] : ['open'];
  if (source.kind === 'event') return ['open', 'snooze'];
  if (source.kind === 'reminder') return source.record.completed ? ['open'] : ['open', 'snooze', 'complete'];
  if (source.kind === 'message') return source.record.participants.length ? ['open', 'reply'] : ['open'];
  if (source.kind === 'mail') return source.record.from.email.trim() ? ['open', 'reply'] : ['open'];
  return ['open'];
}

/** Complete seed/save callers invoke this only after descriptor/schema checks. */
export function validateNotificationDestinations(seed, profile) {
  const sources = { notes: seed.notes, files: seed.files, messages: seed.messages, mail: seed.mail,
    contacts: seed.contacts, calendar: seed.calendar, reminders: seed.reminders, calls: seed.calls,
    stocks: seed.stocks, news: seed.news, clockApp: seed.clockApp };
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
  const originalRecord = source.kind === 'note' ? sources.notes.notes.find(note => note.id === source.recordId) : source.record;
  const unchanged = retainRecord(originalRecord), originalEntry = retainRecord(entry);
  const originalSourceRecord = source.sourceRecord, sourceUnchanged = retainRecord(originalSourceRecord);
  const originalDeliveryRecord = source.deliveryRecord, deliveryUnchanged = retainRecord(originalDeliveryRecord);
  return { source, current() {
    try {
      const currentSources = getSources();
      const resolved = resolveNotificationDestination(entry, currentSources, profile);
      const record = source.kind === 'note' ? currentSources.notes.notes.find(note => note.id === source.recordId) : resolved?.record;
      return alive() && originalEntry() && Object.keys(sources).every(key => currentSources[key] === sources[key])
        && unchanged() && sourceUnchanged() && resolved !== null && record === originalRecord
        && resolved.sourceRecord === originalSourceRecord && deliveryUnchanged()
        && resolved.deliveryRecord === originalDeliveryRecord;
    } catch { return false; }
  } };
}

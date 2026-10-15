import { expect, test } from 'bun:test';
import { goldenGateProfile as profile } from '../frontend/src/golden-gate-profile.js';
import { createDefaultSceneSeed, validateSceneSeed, projectSceneSeed, rehydrateSceneSeed } from '../frontend/src/scene-seed.js';
import { createDefaultApplicationFiles } from '../frontend/src/default-application-files.js';
import { resolveNotificationDestination, retainNotificationDestination, notificationDestinationActions, validateNotificationDestinations } from '../frontend/src/notification-destinations.js';
import { createContact } from '../frontend/src/contacts-state.js';
import { listOSProfiles } from '../frontend/src/os-profiles.js';
import { receiveLocalCall, callsCapabilities } from '../frontend/src/calls-state.js';
import { createDomainNotificationBridges } from '../frontend/src/notification-commands.js';

const sources = seed => ({ notes: seed.notes, files: seed.files, messages: seed.messages, mail: seed.mail, contacts: seed.contacts,
  calendar: seed.calendar, reminders: seed.reminders, calls: seed.calls, stocks: seed.stocks, news: seed.news, clockApp: seed.clockApp });
const entry = (appId, kind, recordId) => ({ id: 'notification-original', appId, destination: { kind, recordId }, title: 'Original', body: '', dismissed: false });

test('destinations preserve exact canonical task, event, conversation, mail and card identities', () => {
  const seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles }), state = sources(seed);
  if (!seed.contacts.contacts.length) expect(createContact(seed.contacts, { name: 'Canonical contact', email: 'local@example.test' }).status).toBe('applied');
  for (const [appId, kind, rows] of [['reminders', 'reminder', seed.reminders.tasks], ['calendar', 'event', seed.calendar.events], ['messages', 'message', seed.messages.conversations], ['mail', 'mail', seed.mail.messages], ['contacts', 'contact', seed.contacts.contacts]]) {
    const original = rows[0], link = entry(appId, kind, original.id);
    expect(resolveNotificationDestination(link, state, profile)?.record).toBe(original);
    expect(resolveNotificationDestination(entry(appId, kind, 'missing-source'), state, profile)).toBeNull();
    expect(resolveNotificationDestination({ ...link, appId: 'notes' }, state, profile)).toBeNull();
  }
});

test('locked Notes expose only safe projections and trashed Notes retire destinations', () => {
  const seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles }), note = seed.notes.notes[0], state = sources(seed), link = entry('notes', 'note', note.id);
  const unlocked = resolveNotificationDestination(link, state, profile);
  expect(unlocked.record.text.length).toBeGreaterThan(0);
  note.lock = { secret: 'fictional', hint: '', unlocked: false };
  const locked = resolveNotificationDestination(link, state, profile);
  expect(locked.record.text).toBe(''); expect(locked.record.preview).toBe(''); expect(locked.record.title).toBe('Locked Note');
  expect(Object.hasOwn(locked.record, 'document')).toBe(false);
  note.deletedAt = seed.files.sceneTime;
  expect(resolveNotificationDestination(link, state, profile)).toBeNull();
});

test('leases reject source revisions, same-ID record replacement, notification edits and original root retirement', () => {
  let seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles }), alive = true;
  const task = seed.reminders.tasks[0], link = entry('reminders', 'reminder', task.id);
  const lease = retainNotificationDestination(link, () => sources(seed), profile, () => alive);
  expect(lease.current()).toBe(true);
  link.dismissed = true; expect(lease.current()).toBe(false); link.dismissed = false;
  task.revision++; expect(lease.current()).toBe(false); task.revision--;
  expect(lease.current()).toBe(true);
  seed.reminders.tasks = seed.reminders.tasks.map(row => row === task ? { ...row } : row);
  expect(lease.current()).toBe(false);
  seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles }); expect(lease.current()).toBe(false);
  alive = false; expect(lease.current()).toBe(false);
});

test('canonical source retirement removes a destination without borrowing a widget copy', () => {
  const seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles }), state = sources(seed), task = seed.reminders.tasks[0];
  const link = entry('reminders', 'reminder', task.id);
  expect(notificationDestinationActions(resolveNotificationDestination(link, state, profile))).toContain('complete');
  task.completed = true;
  expect(notificationDestinationActions(resolveNotificationDestination(link, state, profile))).toEqual(['open']);
  seed.reminders.tasks = seed.reminders.tasks.filter(row => row !== task);
  expect(resolveNotificationDestination(link, state, profile)).toBeNull();
});

test('getter destinations never execute and retired file ancestors reject', () => {
  const seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles }), state = sources(seed); let reads = 0;
  const link = entry('reminders', 'reminder', seed.reminders.tasks[0].id);
  link.destination = { kind: 'reminder', get recordId() { reads++; throw new Error('Getter'); } };
  expect(resolveNotificationDestination(link, state, profile)).toBeNull(); expect(reads).toBe(0);
  const file = seed.files.files.find(row => ['document', 'image'].includes(row.kind));
  const fileLink = entry(file.appId, 'file', file.id);
  expect(resolveNotificationDestination(fileLink, state, profile)?.record).toBe(file);
  seed.files.files.find(row => row.id === file.parentId).deleted = true;
  expect(resolveNotificationDestination(fileLink, state, profile)).toBeNull();
});

for (const installed of listOSProfiles()) {
  test(`${installed.id}: delivered native sources survive seed validation and preserve original records and ledgers`, () => {
    const seed = createDefaultSceneSeed(installed, { createFiles: createDefaultApplicationFiles });
    const state = sources(seed), at = seed.files.sceneTime, notifications = seed.system.notifications;
    expect(receiveLocalCall(seed.calls, { contactId: 'authored-person', name: 'Authored Person', address: 'person@example.test', kind: 'audio' }, at, () => true).status).toBe('applied');
    const call = seed.calls.calls[0], quote = seed.stocks.quotes.find(row => seed.stocks.watchlist.includes(row.id));
    const business = seed.stocks.stories[0], story = seed.news.articles.find(row => row.regions.includes(seed.news.preferences.region) && !row.explicit);
    const alarm = seed.clockApp.alarms[0];
    const alert = { id: 'clock-alert-consumer', sourceId: alarm.id, kind: 'alarm', label: alarm.name, dueAt: at,
      cycles: 1, status: 'pending', notificationId: null, snoozeAt: null };
    seed.clockApp.alerts.push(alert);
    const bridges = createDomainNotificationBridges({ profile: installed, getState: () => notifications,
      alive: () => true, getSceneTime: () => at, canCommit: () => true, reserve: (_, commit) => commit(),
      retainDestination: value => retainNotificationDestination(value, () => state, installed, () => true) });
    const originals = [
      [callsCapabilities(installed).appId, 'call', call], ['stocks', 'stocks-price', quote],
      ['stocks', 'stocks-story', business], ['news', 'news-story', story], ['clock', 'clock', alert],
    ];
    for (const [appId, kind, record] of originals) {
      const result = bridges.notify({ id: `delivery-${kind}`, appId, title: 'Authored notification', body: '',
        source: { kind, recordId: record.id, ...(kind === 'clock' ? {} : { windowId: null }) }, onCommit(actualId) {
          if (kind === 'call') { call.notificationId = actualId; call.revision++; }
          else if (kind.startsWith('stocks-')) seed.stocks.alerts.push({ id: `stocks-alert-${seed.stocks.nextId++}`, kind,
            recordId: record.id, sourceRevision: record.revision, at: seed.stocks.runtime.refreshedAt, notificationId: actualId, active: true });
          else if (kind === 'news-story') seed.news.notifications.push({ id: 'news-alert-consumer', storyId: record.id,
            notificationId: actualId, deliveredAt: at, active: true });
          else { alert.status = 'delivered'; alert.notificationId = actualId; }
          return true;
        } }, () => true);
      expect(result.status).toBe('applied');
      const actual = notifications.entries.find(row => row.id === result.notificationId);
      const resolved = resolveNotificationDestination(actual, state, installed);
      expect(resolved.record).toBe(record);
      expect(resolved.recordId).toBe(record.id);
      expect(resolveNotificationDestination({ ...actual, appId: 'notes' }, state, installed)).toBeNull();
      expect(resolveNotificationDestination({ ...actual, id: 'notification-99' }, state, installed)).toBeNull();
      if (kind === 'call') expect(notificationDestinationActions(resolved)).toEqual(['open', 'accept', 'decline']);
      if (kind === 'clock') { expect(resolved.sourceRecord).toBe(alarm); expect(resolved.sourceId).toBe(alarm.id); }
    }
    expect(validateSceneSeed(seed, installed).ok).toBe(true);
    expect(validateNotificationDestinations(structuredClone(seed), installed).ok).toBe(true);
    const cold = rehydrateSceneSeed(projectSceneSeed(seed, installed), installed);
    expect(validateSceneSeed(cold, installed).ok).toBe(true);
    expect(cold.system.notifications).toEqual(notifications);
    const coldSources = sources(cold);
    for (const original of originals.map(([, , record]) => record)) {
      const retained = notifications.entries.find(row => row.destination.recordId === original.id);
      const restored = cold.system.notifications.entries.find(row => row.id === retained.id);
      expect(resolveNotificationDestination(restored, coldSources, installed).record).toEqual(original);
    }
    expect(cold.calls.calls).toEqual(seed.calls.calls);
    expect(cold.stocks.alerts).toEqual(seed.stocks.alerts);
    expect(cold.news.notifications).toEqual(seed.news.notifications);
    expect(cold.clockApp.alerts).toEqual(seed.clockApp.alerts);
    const callEntry = notifications.entries[0], callLease = retainNotificationDestination(callEntry, () => state, installed, () => true);
    seed.calls.calls[0] = { ...call };
    expect(callLease.current()).toBe(false);
    seed.calls.calls[0] = call;
    call.direction = 'outgoing';
    expect(resolveNotificationDestination(callEntry, state, installed)).toBeNull();
    call.direction = 'incoming';
    const priceEntry = notifications.entries.find(row => row.destination.kind === 'stocks-price');
    const priceLease = retainNotificationDestination(priceEntry, () => state, installed, () => true);
    seed.stocks.alerts[0] = { ...seed.stocks.alerts[0] };
    expect(priceLease.current()).toBe(false);
    seed.stocks.alerts[0].active = false;
    expect(resolveNotificationDestination(priceEntry, state, installed)).toBeNull();
    const newsEntry = notifications.entries.find(row => row.destination.kind === 'news-story');
    seed.news.notifications[0].active = false;
    expect(resolveNotificationDestination(newsEntry, state, installed)).toBeNull();
    const clockEntry = notifications.entries.find(row => row.destination.kind === 'clock');
    const clockLease = retainNotificationDestination(clockEntry, () => state, installed, () => true);
    seed.clockApp.alarms[0] = { ...alarm };
    expect(clockLease.current()).toBe(false);
    seed.clockApp.alarms.splice(0, 1);
    expect(resolveNotificationDestination(clockEntry, state, installed)).toBeNull();
    call.status = 'ended';
    expect(resolveNotificationDestination(notifications.entries[0], state, installed)).toBeNull();
    expect(validateNotificationDestinations(seed, installed).ok).toBe(false);
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarCommands } from '../frontend/src/calendar-commands.js';
import { CALENDAR_PROFILES, createCalendarState, validateCalendarState, calendarOccurrences, calendarTimestamp, createCalendarInvitation } from '../frontend/src/calendar-state.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createDomainNotificationBridges } from '../frontend/src/notification-commands.js';
import { notificationsDefaults } from '../frontend/src/notification-model.js';
import { canonicalStringUnits } from '../frontend/src/canonical-data.js';
import { exportCalendarICS, parseCalendarICS } from '../frontend/src/calendar-ics.js';
import { calendarMenuProvider } from '../frontend/src/calendar-menus.js';

function fixture(profileId = CALENDAR_PROFILES[0]) {
  const profile = { id: profileId, family: profileId.startsWith('windows') ? 'windows' : 'macos', defaults: { sceneTime: '2023-10-31T09:00:00Z' } };
  const state = createCalendarState(profile), windows = new Map(), views = new Map(), notifications = new Map();
  let clock = Date.parse(profile.defaults.sceneTime), counter = 0, quota = true;
  const guard = ownership => typeof ownership === 'function' ? ownership() : ownership.guard();
  const context = { profile, getState: () => state, alive: () => true, getSceneTime: () => clock,
    getWindows: () => [...windows.values()], getWindow: id => windows.get(id), getView: id => views.get(id), available: window => windows.get(window.id) === window,
    canCommit: () => quota,
    planNotification: ownership => {
      const originalCounter = counter;
      return { notificationId: `actual-${counter + 1}`, current: () => counter === originalCounter && guard(ownership) };
    },
    notify: (spec, ownership) => {
      const notificationId = `actual-${counter + 1}`;
      if (!guard(ownership) || spec.onCommit(notificationId) !== true) return { status: 'rejected', error: { code: 'stale_target' } };
      counter++; notifications.set(notificationId, { id: notificationId, dismissed: false });
      return { status: 'applied', notificationId };
    },
    updateNotification: (id, patch, ownership) => {
      if (!notifications.has(id) || !guard(ownership) || patch.onCommit(id) !== true) return { status: 'rejected', error: { code: 'stale_target' } };
      notifications.get(id).dismissed = true;
      return { status: 'applied', notificationId: id };
    },
    updateNotifications: (ids, patch, ownership) => {
      if (!ids.every(id => notifications.has(id)) || !guard(ownership) || patch.onCommit(ids) !== true) return { status: 'rejected', error: { code: 'stale_target' } };
      for (const id of ids) notifications.get(id).dismissed = true;
      return { status: 'applied', notificationIds: ids };
    },
  };
  const controller = createCalendarCommands(context);
  const open = () => {
    const window = { id: 'calendar-a', appId: 'calendar' }, view = { available: () => views.get(window.id) === view };
    windows.set(window.id, window); views.set(window.id, view); assert.equal(controller.windowOpened(window), true);
  };
  const advance = async value => { clock = value; return controller.clockChanged(value); };
  const due = state.events[0].start - 15 * 60000;
  return { profile, state, context, controller, windows, views, notifications, open, due, advance, setQuota: value => quota = value,
    call: (name, payload) => controller.handlers[`calendar.${name}`]({ windowId: 'calendar-a' }, payload) };
}

for (const profile of CALENDAR_PROFILES) {
  test(`${profile}: authored clock delivers while Calendar has no running window`, async () => {
    const f = fixture(profile), events = f.state.events, alerts = f.state.alertDeliveries, event = events[0];
    const result = await f.advance(f.due);
    assert.equal(result.ok, true); assert.equal(result.delivered.length, 1);
    assert.equal(f.state.alertDeliveries[0].notificationId, 'actual-1');
    assert.equal(f.state.events, events); assert.equal(f.state.events[0], event); assert.equal(f.state.alertDeliveries, alerts);
    assert.equal((await f.advance(f.due)).delivered.length, 0);
  });
}

for (const change of [
  f => { f.state.events[0].title = 'Changed without revision'; },
  f => { f.state.events[0].alerts = [...f.state.events[0].alerts]; },
  f => { f.state.calendars = [...f.state.calendars]; },
  f => { f.state.accounts[0] = { ...f.state.accounts[0] }; },
  f => { f.state.alertDeliveries = [...f.state.alertDeliveries]; },
]) {
  test('final Calendar notification lease rejects original source replacement or mutation', async () => {
    const f = fixture();
    f.context.notify = (spec, ownership) => {
      change(f); assert.equal(typeof ownership === 'function' ? ownership() : ownership.guard(), false);
      assert.equal(spec.onCommit('actual-1'), false); return { status: 'rejected' };
    };
    assert.equal((await f.advance(f.due)).ok, false); assert.equal(f.state.alertDeliveries.length, 0);
  });
}

test('descriptor replacement never executes an authored-source getter at final acknowledgment', async () => {
  const f = fixture(); let calls = 0;
  f.context.notify = spec => {
    Object.defineProperty(f.state.events[0], 'title', { enumerable: true, configurable: true, get() { calls++; return 'unsafe'; } });
    assert.equal(spec.onCommit('actual-1'), false); return { status: 'rejected' };
  };
  assert.equal((await f.advance(f.due)).ok, false); assert.equal(calls, 0);
});

test('exact synchronous Calendar acknowledgment survives owner mutation and bridge exception', async () => {
  const f = fixture();
  f.context.notify = spec => {
    assert.equal(spec.onCommit('actual-1'), true); f.notifications.set('actual-1', { dismissed: false });
    f.state.events[0].title = 'After commit'; throw new Error('view retired after actual transaction');
  };
  const result = await f.advance(f.due);
  assert.equal(result.ok, true); assert.equal(result.delivered.length, 1); assert.equal(f.state.alertDeliveries[0].notificationId, 'actual-1');
});

test('false successful bridge result cannot invent a Calendar delivery', async () => {
  const f = fixture(); f.context.notify = () => ({ status: 'applied', notificationId: 'phantom' });
  assert.equal((await f.advance(f.due)).ok, false); assert.equal(f.state.alertDeliveries.length, 0);
});

for (const [name, payload] of [
  ['event.move', f => ({ eventId: 'event-1', start: f.state.events[0].start + 60000, end: f.state.events[0].end + 60000 })],
  ['event.delete', () => ({ eventId: 'event-1' })],
  ['calendar.color', () => ({ calendarId: 'trail-crew', color: '#123456' })],
  ['account.save', () => ({ id: 'calendar-local', name: 'Local calendars', type: 'local', email: '', enabled: false })],
  ['preferences.set', () => ({ values: { alertsEnabled: false } })],
]) {
  test(`${name}: direct source transition dismisses exact live notification atomically`, async () => {
    const f = fixture(); f.open(); await f.advance(f.due);
    const originalArrays = [f.state.events, f.state.calendars, f.state.accounts, f.state.alertDeliveries];
    assert.equal((await f.call(name, payload(f))).status, 'applied');
    assert.equal(f.notifications.get('actual-1').dismissed, true);
    assert.deepEqual([f.state.events, f.state.calendars, f.state.accounts, f.state.alertDeliveries].map((row, index) => row === originalArrays[index]), [true, true, true, true]);
    assert.equal(validateCalendarState(f.state, f.profile).ok, true);
  });
}

test('failed atomic batch leaves direct event edit and live ledger untouched', async () => {
  const f = fixture(); f.open(); await f.advance(f.due); const before = JSON.stringify(f.state);
  f.context.updateNotifications = () => ({ status: 'rejected', error: { code: 'unavailable' } });
  assert.equal((await f.call('event.delete', { eventId: 'event-1' })).status, 'rejected');
  assert.equal(JSON.stringify(f.state), before); assert.equal(f.notifications.get('actual-1').dismissed, false);
});

test('Center dismissal preparation stages exact original Calendar ledger without mutation', async () => {
  const f = fixture(); await f.advance(f.due); const row = f.state.alertDeliveries[0];
  const prepared = f.controller.prepareNotificationDismissals(['irrelevant-id', 'actual-1'], () => true);
  assert.equal(prepared.current(), true); assert.equal(row.status, 'delivered'); assert.equal(Number.isSafeInteger(prepared.delta), true);
  assert.equal(prepared.commit(), true); assert.equal(row.status, 'dismissed'); assert.equal(row.notificationId, 'actual-1');
  assert.equal(prepared.commit(), false);
});

test('Center dismissal preparation rejects same-ID ledger replacement and quota rejection without mutation', async () => {
  const f = fixture(); await f.advance(f.due);
  const prepared = f.controller.prepareNotificationDismissals(['actual-1'], () => true);
  f.state.alertDeliveries[0] = { ...f.state.alertDeliveries[0] };
  assert.equal(prepared.current(), false); assert.equal(prepared.commit(), false); assert.equal(f.state.alertDeliveries[0].status, 'delivered');
  const next = f.controller.prepareNotificationDismissals(['actual-1'], () => true); f.setQuota(false);
  assert.equal(next.commit(), false); assert.equal(f.state.alertDeliveries[0].status, 'delivered');
});

test('Calendar snooze removes the actual notification and redelivers at authored time with the same ledger row', async () => {
  const f = fixture(); f.open(); await f.advance(f.due);
  const row = f.state.alertDeliveries[0], id = row.id;
  assert.equal((await f.call('alert.action', { deliveryId: id, action: 'snooze', minutes: 5 })).status, 'applied');
  assert.equal(f.notifications.get('actual-1').dismissed, true);
  assert.equal((await f.advance(f.due + 299999)).delivered.length, 0);
  assert.equal((await f.advance(f.due + 300000)).delivered.length, 1);
  assert.equal(f.state.alertDeliveries[0], row); assert.equal(row.id, id); assert.equal(row.notificationId, 'actual-2');
  assert.equal((await f.advance(f.due + 300000)).delivered.length, 0);
});

test('a post-acknowledgment source mutation cannot rebase remaining Calendar deliveries', async () => {
  const f = fixture(), original = f.context.notify;
  f.context.notify = (spec, ownership) => {
    const result = original(spec, ownership); f.state.events[1].title = 'Changed after first actual notification'; return result;
  };
  const result = await f.advance(f.state.events[1].start);
  assert.equal(result.ok, false); assert.equal(result.delivered.length, 1);
  assert.equal(f.state.alertDeliveries.length, 1); assert.equal(f.state.alertDeliveries[0].notificationId, 'actual-1');
});

for (const profileId of CALENDAR_PROFILES) {
  test(`${profileId}: real notification graph and Calendar graph commit together under full-root reservation`, async () => {
    const profile = getOSProfile(profileId), calendar = createCalendarState(profile), notifications = notificationsDefaults();
    const windows = new Map(), views = new Map(), root = { calendar, notifications };
    let clock = Date.parse(profile.defaults.sceneTime), held = 0, limit = Infinity;
    const canCommit = delta => Number.isSafeInteger(delta) && canonicalStringUnits(root) + held + delta <= limit;
    const reserve = (delta, commit) => { held += delta; try { return commit(); } finally { held -= delta; } };
    const notificationBridges = createDomainNotificationBridges({ profile, getState: () => notifications, alive: () => true,
      getSceneTime: () => clock, canCommit, reserve });
    const controller = createCalendarCommands({ profile, getState: () => calendar, alive: () => true, getSceneTime: () => clock, canCommit,
      getWindows: () => [...windows.values()], getWindow: id => windows.get(id), getView: id => views.get(id), available: window => windows.get(window.id) === window,
      ...notificationBridges });
    clock = calendar.events[0].start - 15 * 60000;
    assert.equal((await controller.clockChanged(clock)).ok, true);
    assert.equal(notifications.entries.length, 1); assert.equal(calendar.alertDeliveries[0].notificationId, notifications.entries[0].id);
    assert.deepEqual(notifications.entries[0].destination, { kind: 'event', recordId: 'event-1' });
    const window = { id: 'calendar-real', appId: 'calendar' }; windows.set(window.id, window); views.set(window.id, { available: () => true });
    assert.equal(controller.windowOpened(window), true);
    const entry = notifications.entries[0], ledger = calendar.alertDeliveries[0], event = calendar.events[0];
    limit = canonicalStringUnits(root) - 1;
    const before = JSON.stringify(root);
    assert.equal((await controller.handlers['calendar.event.save']({ windowId: window.id }, { eventId: event.id,
      event: { title: 'x'.repeat(512), calendarId: event.calendarId, start: event.start, end: event.end } })).status, 'rejected');
    assert.equal(JSON.stringify(root), before); assert.equal(notifications.entries[0], entry); assert.equal(calendar.alertDeliveries[0], ledger);
    limit = Infinity;
    assert.equal((await controller.handlers['calendar.event.delete']({ windowId: window.id }, { eventId: event.id })).status, 'applied');
    assert.equal(notifications.entries.length, 0); assert.equal(calendar.events.includes(event), false); assert.equal(calendar.alertDeliveries.length, 0);
    assert.equal(validateCalendarState(calendar, profile).ok, true); assert.equal(held, 0);
  });
}

test('authored clock changes during delivery invalidate the final Calendar lease', async () => {
  const f = fixture();
  f.context.notify = async spec => {
    await f.advance(f.due - 1);
    assert.equal(spec.onCommit('actual-stale'), false); return { status: 'rejected' };
  };
  assert.equal((await f.advance(f.due)).ok, false); assert.equal(f.state.alertDeliveries.length, 0);
});

test('acknowledged direct source retirement stays applied when presentation retires and batch bridge throws', async () => {
  const f = fixture(); f.open(); await f.advance(f.due);
  const original = f.context.updateNotifications;
  f.context.updateNotifications = (ids, patch, ownership) => {
    original(ids, patch, ownership); f.windows.delete('calendar-a'); throw new Error('presentation retired');
  };
  assert.equal((await f.call('event.delete', { eventId: 'event-1' })).status, 'applied');
  assert.equal(f.notifications.get('actual-1').dismissed, true); assert.equal(f.state.alertDeliveries.length, 0);
});

test('acknowledged single alert dismissal stays applied after a post-commit bridge exception', async () => {
  const f = fixture(); f.open(); await f.advance(f.due);
  const row = f.state.alertDeliveries[0], original = f.context.updateNotification;
  f.context.updateNotification = (id, patch, ownership) => {
    original(id, patch, ownership); f.windows.delete('calendar-a'); throw new Error('presentation retired');
  };
  assert.equal((await f.call('alert.action', { deliveryId: row.id, action: 'dismiss' })).status, 'applied');
  assert.equal(row.status, 'dismissed'); assert.equal(row.notificationId, 'actual-1'); assert.equal(f.notifications.get('actual-1').dismissed, true);
});

test('Calendar plans the exact actual ID at the four-MiB domain boundary rather than reserving a 128-character surrogate', async () => {
  const f = fixture(), originalEvent = f.state.events[0];
  for (let index = 0; index < 70; index++) f.state.events.push({ ...structuredClone(originalEvent), id: `boundary-event-${index}`,
    icalUid: `boundary-${index}@jester.local`, alerts: [], notes: '' });
  const expectedDelivery = { id: 'calendar-alert-1', eventId: 'event-1', occurrenceStart: originalEvent.start, minutes: 15,
    status: 'delivered', snoozeUntil: null, notificationId: 'actual-1' };
  const limit = 4 * 1024 * 1024, ledgerGrowth = JSON.stringify(expectedDelivery).length;
  let remaining = limit - ledgerGrowth - JSON.stringify(f.state).length;
  for (const event of f.state.events) {
    const count = Math.min(remaining, 65536); event.notes = 'x'.repeat(count); remaining -= count;
  }
  assert.equal(remaining, 0); assert.equal(validateCalendarState(f.state, f.profile).ok, true);
  const before = canonicalStringUnits(f.state), originalNotify = f.context.notify;
  f.context.notify = (spec, ownership) => {
    assert.equal(spec.reserveTextUnits, canonicalStringUnits({ 0: expectedDelivery }));
    return originalNotify(spec, ownership);
  };
  const result = await f.advance(f.due);
  assert.equal(result.ok, true); assert.equal(result.delivered.length, 1);
  assert.deepEqual(f.state.alertDeliveries[0], expectedDelivery);
  assert.equal(JSON.stringify(f.state).length, limit); assert.equal(canonicalStringUnits(f.state) - before, canonicalStringUnits({ 0: expectedDelivery }));
});

test('an actual notification ID different from the exact allocation plan cannot acknowledge a Calendar delivery', async () => {
  const f = fixture();
  f.context.notify = spec => {
    assert.equal(spec.onCommit('wrong-actual-id'), false); return { status: 'applied', notificationId: 'wrong-actual-id' };
  };
  assert.equal((await f.advance(f.due)).ok, false); assert.equal(f.state.alertDeliveries.length, 0);
});

test('retiring an exact allocation plan rejects Calendar delivery without allocating a ledger row', async () => {
  const f = fixture(); let valid = true;
  f.context.planNotification = () => ({ notificationId: 'actual-1', current: () => valid });
  f.context.notify = spec => { valid = false; assert.equal(spec.onCommit('actual-1'), false); return { status: 'rejected' }; };
  assert.equal((await f.advance(f.due)).ok, false); assert.equal(f.state.alertDeliveries.length, 0);
});

for (const profileId of CALENDAR_PROFILES) {
  test(`${profileId}: canonical Files import retains bytes and identity and rejects replaced original files`, async () => {
    const f = fixture(profileId); f.open();
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:files-import@example.test\r\nDTSTART:20231101T090000Z\r\nDTEND:20231101T100000Z\r\nSUMMARY:Actual Files import\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
    let file = { id: 'calendar-document', name: 'actual.ics', content: ics, mime: 'text/calendar; charset=utf-8', encoding: 'utf8', revision: 1 };
    f.context.getFile = id => id === file.id ? file : null;
    f.context.readFile = async (_, ownership) => {
      assert.equal(ownership.guard(), true);
      return { status: 'applied', file, text: file.content, mime: file.mime, name: file.name };
    };
    const result = await f.call('import.file', { fileId: file.id, calendarId: 'trail-crew' });
    assert.equal(result.status, 'applied'); assert.equal(file.content, ics);
    assert.equal(f.state.events.find(event => event.id === result.eventIds[0]).title, 'Actual Files import');
    const before = JSON.stringify(f.state);
    f.context.readFile = async () => {
      const original = file; file = { ...file };
      return { status: 'applied', file: original, text: original.content, mime: original.mime };
    };
    assert.equal((await f.call('import.file', { fileId: file.id, calendarId: 'trail-crew' })).status, 'rejected');
    assert.equal(JSON.stringify(f.state), before);
  });

  test(`${profileId}: recurring occurrence/future/series moves project real consumers and keep bounded counts`, async () => {
    const f = fixture(profileId); f.open();
    const start = calendarTimestamp('2023-11-01T09:00', 'UTC');
    const created = await f.call('event.save', { event: { calendarId: 'trail-crew', title: 'Series', start, end: start + 3600000,
      recurrence: { frequency: 'daily', interval: 1, count: 4, until: null, weekdays: [] } } });
    const eventId = created.eventId, second = start + 86400000;
    assert.equal(created.status, 'applied');
    assert.equal((await f.call('event.move', { eventId, occurrenceStart: second, scope: 'occurrence', start: second - 3600000, end: second })).status, 'applied');
    let rows = calendarOccurrences(f.state, start - 1, start + 5 * 86400000).filter(row => row.eventId === eventId);
    assert.equal(rows.length, 4); assert.equal(rows[1].originalStart, second); assert.equal(rows[1].start, second - 3600000);
    const third = start + 2 * 86400000;
    const moved = await f.call('event.move', { eventId, occurrenceStart: third, scope: 'future', start: third + 3600000, end: third + 7200000 });
    assert.equal(moved.status, 'applied'); assert.notEqual(moved.eventId, eventId);
    rows = calendarOccurrences(f.state, start - 1, start + 6 * 86400000).filter(row => row.title === 'Series');
    assert.equal(rows.length, 4); assert.equal(rows.filter(row => row.eventId === eventId).length, 2);
    const future = f.state.events.find(row => row.id === moved.eventId);
    assert.equal(future.recurrence.count, 2);
    assert.equal((await f.call('event.delete', { eventId: future.id, scope: 'series' })).status, 'applied');
    assert.equal(calendarOccurrences(f.state, start - 1, start + 6 * 86400000).filter(row => row.title === 'Series').length, 2);
    assert.equal(validateCalendarState(f.state, f.profile).ok, true);
  });

  test(`${profileId}: organizer updates retain actual event UID and exact local Mail acknowledgment`, async () => {
    const f = fixture(profileId); f.open();
    const first = createCalendarInvitation(f.state, { sender: 'organizer@example.test', icalUid: 'invitation@example.test',
      event: { title: 'Invitation', start: f.state.events[0].start, end: f.state.events[0].end }, sequence: 0 });
    assert.equal(first.ok, true);
    const event = f.state.events.find(row => row.id === first.eventId);
    const update = createCalendarInvitation(f.state, { sender: 'organizer@example.test', eventId: event.id, icalUid: event.icalUid,
      event: { title: 'Updated invitation', start: event.start, end: event.end }, sequence: 1 });
    assert.equal(update.ok, true); assert.equal(f.state.events.find(row => row.id === event.id), event);
    f.context.createMailDraft = async (spec, guard) => {
      assert.equal(guard(), true); assert.equal(spec.onCommit('actual-mail-response'), true);
      return { status: 'applied', draftId: 'actual-mail-response' };
    };
    assert.equal((await f.call('invitation.respond', { invitationId: first.invitationId, response: 'accepted' })).status, 'rejected');
    const reply = await f.call('invitation.respond', { invitationId: update.invitationId, response: 'tentative' });
    assert.equal(reply.status, 'applied'); assert.equal(reply.draftId, 'actual-mail-response');
    assert.equal(f.state.invitations.find(row => row.id === update.invitationId).status, 'tentative');
    const menu = calendarMenuProvider({ state: f.state, profile: getOSProfile(profileId), windowId: 'calendar-a',
      edits: { cut: true, copy: true, paste: true, selectAll: true, undo: false, redo: false } });
    const leaves = menu.flatMap(group => group.items);
    assert.equal(leaves.find(row => row.id === 'preferences' || row.id === 'preferences-General').request.command, 'calendar.sheet.open');
  });
}

test('folded detached recurrence fields export once and parse without introducing literal line breaks', () => {
  const state = createCalendarState(getOSProfile(CALENDAR_PROFILES[0])), event = state.events[0];
  event.recurrence = { frequency: 'daily', interval: 1, count: 2, until: null, weekdays: [] };
  event.exceptions = [{ originalStart: event.start + 86400000, start: event.start + 86400000, end: event.end + 86400000,
    cancelled: false, fields: { notes: 'Detached recurrence notes '.repeat(80) } }];
  const parsed = parseCalendarICS(exportCalendarICS(state));
  assert.equal(parsed.records.find(row => row.originalStart !== null).event.notes, event.exceptions[0].fields.notes);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemindersState, REMINDERS_PROFILES, validateRemindersState, importReminderWidgetSources, reminderWidgetProjection, reminderCalendarProjection, reminderWindow, reminderSpec, nextReminderDue, visibleReminders, remindersTextUnits } from '../frontend/src/reminders-state.js';
import { createRemindersCommands } from '../frontend/src/reminders-commands.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createDomainNotificationBridges } from '../frontend/src/notification-commands.js';
import { notificationsDefaults } from '../frontend/src/notification-model.js';
import { canonicalStringUnits } from '../frontend/src/canonical-data.js';

const profileFor = id => ({ id, defaults: { sceneTime: '2023-10-31T09:00:00Z' } });
function fixture(profileId = REMINDERS_PROFILES[0]) {
  const profile = { ...getOSProfile(profileId), ...profileFor(profileId) }, state = createRemindersState(profile), windows = new Map(), views = new Map(), notifications = new Map();
  const plannerState = notificationsDefaults();
  let clock = Date.parse(profile.defaults.sceneTime), quota = true, held = 0;
  const planner = createDomainNotificationBridges({ profile, getState: () => plannerState, alive: () => true,
    getSceneTime: () => clock, canCommit: () => quota, reserve: (delta, commit) => { held += delta; try { return commit(); } finally { held -= delta; } } });
  const context = { profile, getState: () => state, getWindow: id => windows.get(id), getWindows: () => [...windows.values()], getView: id => views.get(id), available: window => windows.get(window.id) === window, alive: () => true, getSceneTime: () => clock, canCommit: () => quota, tick: async () => {}, focusWindow: () => {},
    reserve: (delta, commit) => { held += delta; try { return commit(); } finally { held -= delta; } },
    planNotification: ownership => planner.planNotification(ownership),
    notify: async (spec, ownership) => { assert.equal(typeof spec.onCommit, 'function'); assert.ok(Number.isSafeInteger(spec.reserveTextUnits)); if (!ownership.guard()) return { status: 'rejected', error: { code: 'stale_target', message: 'retired' } }; const notificationId = `notification-${plannerState.nextId}`; if (!spec.onCommit(notificationId)) return { status: 'rejected', error: { code: 'stale_target', message: 'not acknowledged' } }; plannerState.nextId++; notifications.set(notificationId, { notificationId, title: spec.title, dismissed: false, source: spec.source }); return { status: 'applied', notificationId }; },
    updateNotification: async (id, patch, ownership) => { const notification = notifications.get(id); if (!notification || !ownership.guard() || !patch.onCommit(id)) return { status: 'rejected', error: { code: 'stale_target', message: 'not acknowledged' } }; notifications.delete(id); return { status: 'applied', notificationId: id }; },
    updateNotifications: async (ids, patch, ownership) => { if (!Array.isArray(ids) || ids.some(id => !notifications.has(id)) || new Set(ids).size !== ids.length || !ownership.guard?.() || !patch.onCommit(ids)) return { status: 'rejected', error: { code: 'stale_target', message: 'not acknowledged' } }; for (const id of ids) notifications.delete(id); return { status: 'applied', notificationIds: [...ids] }; },
  };
  const controller = createRemindersCommands(context);
  function open(id) { const managed = { id, appId: 'reminders' }, view = { available: () => views.get(id) === view, focus: async (_, guard) => guard(), scroll: async (payload, guard) => guard() ? payload : null }; windows.set(id, managed); assert.equal(controller.windowOpened(managed), true); views.set(id, view); return managed; }
  open('reminders-a');
  return { profile, state, context, controller, notifications, windows, views, open, call: (name, payload = {}, windowId = 'reminders-a') => controller.handlers[`reminders.${name}`]({ windowId }, payload), setClock: value => clock = value, setQuota: value => quota = value };
}
for (const profileId of REMINDERS_PROFILES) {
  test(`${profileId}: independent sessions share canonical tasks, CRUD and read-only projections`, async () => {
    const f = fixture(profileId); f.open('reminders-b');
    assert.equal((await f.call('view.set', { listId: 'maintenance' }, 'reminders-b')).status, 'applied');
    assert.equal(reminderWindow(f.state, 'reminders-a').listId, 'packing');
    assert.equal((await f.call('task.edit', { reminderId: 'reminder-2' })).status, 'applied');
    const spec = { ...reminderSpec(f.state.tasks.find(row => row.id === 'reminder-2')), title: 'Updated water', notes: 'Literal <b>notes</b>' };
    assert.equal((await f.call('editor.set', { spec })).status, 'applied');
    spec.notes = 'caller changed';
    assert.equal(reminderWindow(f.state, 'reminders-a').editor.notes, 'Literal <b>notes</b>');
    assert.equal(f.controller.windowClosed('reminders-a'), false);
    assert.equal((await f.call('editor.save')).status, 'applied');
    assert.equal((await f.call('task.move', { reminderId: 'reminder-2', listId: 'maintenance', index: 0 })).status, 'applied');
    assert.equal(f.state.tasks.find(row => row.id === 'reminder-2').notes, 'Literal <b>notes</b>');
    const projection = reminderWidgetProjection(f.state); assert.ok(Object.isFrozen(projection.reminders)); assert.ok(Object.isFrozen(projection.reminders[0]));
    assert.equal(projection.reminders.find(row => row.id === 'reminder-2').listId, 'maintenance');
    assert.equal((await f.call('view.set', { query: '<b>notes' }, 'reminders-b')).status, 'applied');
    assert.equal(visibleReminders(f.state, 'reminders-b', f.context.getSceneTime())[0].id, 'reminder-2');
    assert.equal(validateRemindersState(f.state, f.profile).ok, true);
  });
  test(`${profileId}: whole-scene quota rejects without graph or notification insertion`, async () => {
    const f = fixture(profileId); f.setClock(Date.parse('2023-11-03T09:00:00Z')); f.setQuota(false);
    const before = JSON.stringify(f.state);
    assert.equal((await f.call('alerts.process')).error.code, 'limit_exceeded');
    assert.equal(JSON.stringify(f.state), before); assert.equal(f.notifications.size, 0);
  });
}

test('old widget-source import preserves literal list and reminder IDs without mutating old sources', () => {
  const profile = profileFor(REMINDERS_PROFILES[3]), state = createRemindersState(profile), original = { reminderLists: [{ id: 'old-list', name: 'Old list', color: '#c47f17' }], reminders: [{ id: 'original-task-19', listId: 'old-list', title: 'Keep my identity', dueAt: null, completed: false }] };
  const migrated = importReminderWidgetSources(state, original, profile);
  assert.equal(migrated.ok, true); assert.equal(migrated.state.tasks[0].id, 'original-task-19'); assert.equal(migrated.state.lists[0].id, 'old-list');
  original.reminders[0].title = 'old-source write'; assert.equal(migrated.state.tasks[0].title, 'Keep my identity');
  assert.deepEqual(reminderCalendarProjection(migrated.state), []);
});

test('descriptor-safe state rejects accessor, sparse-array, foreign-prototype and orphan records without getter invocation', () => {
  const profile = profileFor(REMINDERS_PROFILES[0]); let getterCalls = 0;
  const getter = createRemindersState(profile); Object.defineProperty(getter.tasks[0], 'title', { enumerable: true, get() { getterCalls++; return 'bad'; } });
  assert.equal(validateRemindersState(getter, profile).ok, false); assert.equal(getterCalls, 0);
  const sparse = createRemindersState(profile); delete sparse.tasks[1]; assert.equal(validateRemindersState(sparse, profile).ok, false);
  const foreign = createRemindersState(profile); Object.setPrototypeOf(foreign.tasks[0], { surprise: true }); assert.equal(validateRemindersState(foreign, profile).ok, false);
  const orphan = createRemindersState(profile); orphan.tasks[0].listId = 'missing'; assert.equal(validateRemindersState(orphan, profile).ok, false);
});

test('notification onCommit retires exact original owner atomically, rejects replacements with same public ID', async () => {
  const f = fixture(); f.setClock(Date.parse('2023-11-03T09:00:00Z'));
  let release, entered; const entering = new Promise(resolve => entered = resolve);
  f.context.notify = async (spec, ownership) => { entered(); await new Promise(resolve => release = resolve); const id = 'notification-1'; if (!ownership.guard() || !spec.onCommit(id)) return { status: 'rejected', error: { code: 'stale_target', message: 'owner changed' } }; f.notifications.set(id, { id }); return { status: 'applied', notificationId: id }; };
  const pending = f.call('alerts.process'); await entering;
  f.windows.set('reminders-a', { id: 'reminders-a', appId: 'reminders' }); release();
  assert.equal((await pending).error.code, 'stale_target'); assert.equal(f.notifications.size, 0); assert.equal(f.state.alerts.length, 0);
});

test('same-value canonical record replacement invalidates original notification transaction', async () => {
  const f = fixture(); f.setClock(Date.parse('2023-11-03T09:00:00Z'));
  f.context.notify = async (spec) => { f.state.tasks[0] = { ...f.state.tasks[0] }; return spec.onCommit('notification-1') ? { status: 'applied', notificationId: 'notification-1' } : { status: 'rejected', error: { code: 'stale_target', message: 'record changed' } }; };
  assert.equal((await f.call('alerts.process')).error.code, 'stale_target'); assert.equal(f.state.alerts.length, 0);
});

test('applied atomic notification transaction remains applied after owner retirement and bridge throw', async () => {
  const f = fixture(); f.setClock(Date.parse('2023-11-03T09:00:00Z'));
  f.context.notify = async spec => { assert.equal(spec.onCommit('notification-1'), true); f.notifications.set('notification-1', { id: 'notification-1' }); f.windows.delete('reminders-a'); throw new Error('presentation retired'); };
  const result = await f.call('alerts.process'); assert.equal(result.status, 'applied'); assert.equal(result.deliveries[0].notificationId, 'notification-1'); assert.equal(f.state.alerts[0].notificationId, 'notification-1');
});

test('authored-time snooze dismisses exact actual notification and redelivers once with same canonical task ID', async () => {
  const f = fixture(); f.state.tasks = [f.state.tasks[0]]; f.setClock(f.state.tasks[0].dueAt);
  assert.equal((await f.call('alerts.process')).status, 'applied'); const first = f.state.alerts[0], id = first.id, actual = first.notificationId;
  assert.equal((await f.call('alert.snooze', { alertId: id, minutes: 5 })).status, 'applied'); assert.equal(f.notifications.has(actual), false);
  assert.equal((await f.call('alerts.process')).deliveries.length, 0);
  f.setClock(first.snoozeAt); assert.equal((await f.call('alerts.process')).deliveries.length, 1); assert.equal(f.state.alerts[0].id, id); assert.notEqual(f.state.alerts[0].notificationId, actual); assert.equal(f.state.alerts[0].reminderId, 'reminder-1');
  assert.equal((await f.call('alerts.process')).deliveries.length, 0);
  assert.equal((await f.call('alert.complete', { alertId: id })).status, 'applied'); assert.equal(f.state.tasks[0].completed, true); assert.equal(f.state.alerts[0].status, 'completed');
});

test('false notification bridge acknowledgement never fabricates delivered success', async () => {
  const f = fixture(); f.setClock(Date.parse('2023-11-03T09:00:00Z')); f.context.notify = async () => ({ status: 'applied', notificationId: 'phantom' });
  assert.equal((await f.call('alerts.process')).error.code, 'unavailable'); assert.equal(f.state.alerts.length, 0);
});

test('Calendar bridge passes date-only verbatim and timed epochs, never creates duplicate events', async () => {
  const f = fixture(); const calls = []; f.context.openCalendar = async (spec, owner) => { assert.equal(owner.guard(), true); calls.push(spec); return { status: 'applied', target: { windowId: 'actual-calendar', date: '2023-11-01' } }; };
  const task = f.state.tasks[0]; task.dueAt = Date.parse('2023-11-01T00:00:00Z'); task.hasTime = false;
  assert.equal((await f.call('calendar.open', { reminderId: task.id })).status, 'applied'); assert.equal(calls[0].due, '2023-11-01');
  task.hasTime = true; await f.call('calendar.open', { reminderId: task.id }); assert.equal(calls[1].due, task.dueAt);
});

test('monthly recurrence clamps month end; completion advances only same canonical task and stops at end', async () => {
  const f = fixture(), task = f.state.tasks[0]; task.dueAt = Date.parse('2024-01-31T09:00:00Z'); task.recurrence = { frequency: 'monthly', interval: 1, until: Date.parse('2024-02-29T23:59:59Z') };
  assert.equal(nextReminderDue(task), Date.parse('2024-02-29T09:00:00Z'));
  assert.equal((await f.call('task.setCompleted', { reminderId: task.id, completed: true })).status, 'applied'); assert.equal(task.id, 'reminder-1'); assert.equal(task.completed, false); assert.equal(task.dueAt, Date.parse('2024-02-29T09:00:00Z'));
  await f.call('task.setCompleted', { reminderId: task.id, completed: true }); assert.equal(task.completed, true); assert.equal(nextReminderDue(task), null);
});

test('whole-scene string unit projection includes keys and array indices', () => { assert.equal(remindersTextUnits({ list: ['x'] }), 6); });

test('independent inspector revision cannot overwrite another native session edits', async () => {
  const f = fixture(); f.open('reminders-b');
  await f.call('task.edit',{reminderId:'reminder-2'});
  await f.call('task.edit',{reminderId:'reminder-2'},'reminders-b');
  const first = reminderWindow(f.state,'reminders-a').editor;
  await f.call('editor.set',{spec:{...first,title:'Original draft'}});
  const second = reminderWindow(f.state,'reminders-b').editor;
  await f.call('editor.set',{spec:{...second,title:'Other session saved'}},'reminders-b');
  assert.equal((await f.call('editor.save',{},'reminders-b')).status,'applied');
  assert.equal((await f.call('editor.save')).error.code,'stale_target');
  assert.equal(f.state.tasks.find(row=>row.id==='reminder-2').title,'Other session saved');
  assert.equal(reminderWindow(f.state,'reminders-a').editor.title,'Original draft');
});

test('explicit fictional location transition uses actual ledger and can re-trigger after dismissal', async () => {
  const f = fixture(); f.state.tasks = [f.state.tasks[1]]; const task=f.state.tasks[0];
  task.location={label:'Fictional trailhead',transition:'arriving',radius:100};
  assert.equal((await f.call('location.trigger',{reminderId:task.id,transition:'leaving'})).error.code,'invalid_arguments');
  assert.equal((await f.call('location.trigger',{reminderId:task.id,transition:'arriving'})).status,'applied');
  const alert=f.state.alerts[0], first=alert.notificationId;
  assert.equal((await f.call('alert.dismiss',{alertId:alert.id})).status,'applied');
  assert.equal(f.notifications.has(first),false);
  assert.equal((await f.call('location.trigger',{reminderId:task.id,transition:'arriving'})).status,'applied');
  assert.notEqual(f.state.alerts[0].notificationId,first);
  assert.equal(f.state.alerts[0].reminderId,task.id);
});

test('direct task deletion retires the active actual notification atomically without an orphan status', async () => {
  const f = fixture(); f.state.tasks = [f.state.tasks[0]]; f.setClock(f.state.tasks[0].dueAt);
  await f.call('alerts.process'); const alert = f.state.alerts[0], actual = alert.notificationId;
  assert.equal((await f.call('task.delete', { reminderId: 'reminder-1', confirmed: true })).status, 'applied');
  assert.equal(f.notifications.has(actual), false);
  assert.equal(f.state.tasks.length, 0); assert.equal(f.state.alerts.length, 0);
  assert.equal(validateRemindersState(f.state, f.profile).ok, true);
});

test('direct list deletion retires every active actual notification in one exact atomic batch', async () => {
  const f = fixture(); f.setClock(Date.parse('2023-11-03T09:00:00Z'));
  await f.call('alerts.process');
  const packing = f.state.alerts.filter(row => f.state.tasks.find(task => task.id === row.reminderId)?.listId === 'packing');
  assert.ok(packing.length >= 1);
  const actuals = packing.map(row => row.notificationId), batches = [], original = f.context.updateNotifications;
  f.context.updateNotifications = async (ids, patch, ownership) => { batches.push([...ids]); return original(ids, patch, ownership); };
  assert.equal((await f.call('list.delete', { listId: 'packing', confirmed: true })).status, 'applied');
  assert.equal(batches.length, 1); assert.deepEqual([...batches[0]].sort(), [...actuals].sort());
  for (const id of actuals) assert.equal(f.notifications.has(id), false);
  assert.equal(f.state.alerts.some(row => row.reminderId === 'reminder-1'), false);
  assert.equal(f.state.alerts.some(row => row.status === 'delivered'), true);
  assert.equal(validateRemindersState(f.state, f.profile).ok, true);
});

test('direct reminder re-revision retires its active actual notification and keeps the historic ledger row', async () => {
  const f = fixture(); f.state.tasks = [f.state.tasks[0]]; f.setClock(f.state.tasks[0].dueAt);
  await f.call('alerts.process');
  const alert = f.state.alerts[0], actual = alert.notificationId, rowId = alert.id;
  assert.equal((await f.call('task.edit', { reminderId: 'reminder-1' })).status, 'applied');
  assert.equal((await f.call('editor.set', { spec: { ...reminderSpec(f.state.tasks[0]), title: 'Retitled pouch' } })).status, 'applied');
  assert.equal((await f.call('editor.save')).status, 'applied');
  assert.equal(f.notifications.has(actual), false);
  const row = f.state.alerts.find(item => item.id === rowId);
  assert.equal(row.status, 'dismissed'); assert.equal(row.notificationId, actual); assert.equal(row.snoozeAt, null);
  assert.equal(f.state.tasks[0].title, 'Retitled pouch');
  assert.equal(validateRemindersState(f.state, f.profile).ok, true);
});

test('same-ID task replacement rejects the atomic batch dismissal without committing', async () => {
  const f = fixture(); f.state.tasks = [f.state.tasks[0]]; f.setClock(f.state.tasks[0].dueAt);
  await f.call('alerts.process'); const actual = f.state.alerts[0].notificationId;
  f.context.updateNotifications = async (ids, patch) => { const row = f.state.tasks[0]; f.state.tasks[0] = { ...row }; return patch.onCommit(ids) ? { status: 'applied', notificationIds: ids } : { status: 'rejected', error: { code: 'stale_target', message: 'record changed' } }; };
  const result = await f.call('task.delete', { reminderId: 'reminder-1', confirmed: true });
  assert.equal(result.error.code, 'stale_target');
  assert.equal(f.state.tasks.length, 1); assert.equal(f.state.alerts.length, 1);
  assert.equal(f.state.alerts[0].status, 'delivered'); assert.equal(f.notifications.get(actual)?.dismissed, false);
});

test('clockChanged is the window-independent authored pump and never fabricates a window', async () => {
  const f = fixture(); f.setClock(Date.parse('2023-11-03T09:00:00Z'));
  assert.equal((await f.controller.clockChanged(Date.parse('2023-11-03T09:00:00Z'))).ok, true);
  assert.equal(f.state.alerts.filter(row => row.status === 'delivered').length, 2);
  const alert = f.state.alerts.find(row => row.reminderId === 'reminder-1'), actual = alert.notificationId;
  assert.equal((await f.call('alert.snooze', { alertId: alert.id, minutes: 5 })).status, 'applied');
  assert.equal(f.controller.windowClosed('reminders-a'), true);
  assert.equal(f.state.windows.length, 0);
  f.setClock(alert.snoozeAt);
  const redelivered = await f.controller.clockChanged(alert.snoozeAt);
  assert.equal(redelivered.ok, true); assert.equal(redelivered.delivered.length, 1);
  assert.notEqual(f.state.alerts.find(row => row.id === alert.id).notificationId, actual);
  for (const entry of f.notifications.values()) assert.equal(entry.source.windowId, null);
  assert.equal(f.state.windows.length, 0);
  assert.equal(validateRemindersState(f.state, f.profile).ok, true);
});

test('prepareNotificationDismissals stages exact ledger rows for the Root atomic batch clear', async () => {
  const f = fixture(); f.setClock(Date.parse('2023-11-03T09:00:00Z'));
  await f.call('alerts.process');
  const active = f.state.alerts.filter(row => row.status === 'delivered'), ids = active.map(row => row.notificationId);
  const staged = f.controller.prepareNotificationDismissals([...ids, 'notification-unrelated'], () => true);
  assert.equal(staged.current(), true);
  assert.equal(Number.isSafeInteger(staged.delta), true);
  assert.equal(staged.commit(), true);
  for (const row of f.state.alerts.filter(item => ids.includes(item.notificationId))) assert.equal(row.status, 'dismissed');
  assert.equal(staged.current(), false);
  assert.equal(staged.commit(), false);
  const empty = f.controller.prepareNotificationDismissals([], () => true);
  assert.equal(empty.current(), true); assert.equal(empty.delta, 0); assert.equal(empty.commit(), true);
  assert.equal(validateRemindersState(f.state, f.profile).ok, true);
});

test('prepareNotificationDismissals rejects a stale source without staging', async () => {
  const f = fixture();
  f.context.updateNotifications = undefined;
  assert.equal(f.controller.prepareNotificationDismissals('notification-1').error.code, 'stale_target');
});

for (const profileId of REMINDERS_PROFILES) {
  for (const operation of ['edit', 'task.delete', 'list.delete', 'account.delete']) {
    test(`${profileId}: snoozed ${operation} never targets its historic notification ID`, async () => {
      const f = fixture(profileId), task = f.state.tasks[0], tasks = f.state.tasks, alerts = f.state.alerts;
      f.state.tasks.splice(1);
      f.setClock(task.dueAt);
      await f.call('alerts.process');
      const alert = f.state.alerts[0], actual = alert.notificationId;
      assert.equal((await f.call('alert.snooze', { alertId: alert.id, minutes: 5 })).status, 'applied');
      assert.equal(f.notifications.has(actual), false);
      f.context.updateNotification = f.context.updateNotifications = () => { assert.fail('Historic snooze IDs must not reach a notification bridge.'); };
      if (operation === 'edit') {
        await f.call('task.edit', { reminderId: task.id });
        await f.call('editor.set', { spec: { ...reminderSpec(task), title: 'Edited snoozed reminder' } });
        assert.equal((await f.call('editor.save')).status, 'applied');
        assert.equal(f.state.tasks[0], task); assert.equal(f.state.alerts[0], alert);
        assert.equal(alert.status, 'dismissed'); assert.equal(alert.snoozeAt, null); assert.equal(alert.notificationId, actual);
      } else {
        const payload = operation === 'task.delete' ? { reminderId: task.id, confirmed: true }
          : operation === 'list.delete' ? { listId: task.listId, confirmed: true } : { accountId: 'reminders-local', confirmed: true };
        assert.equal((await f.call(operation, payload)).status, 'applied');
        assert.equal(f.state.tasks.includes(task), false); assert.equal(f.state.alerts.includes(alert), false);
      }
      assert.equal(f.state.tasks, tasks); assert.equal(f.state.alerts, alerts);
      assert.equal(validateRemindersState(f.state, f.profile).ok, true);
    });
  }
  for (const action of ['snooze', 'dismiss', 'complete']) {
    test(`${profileId}: ${action} of an already snoozed alert is a guarded domain-only commit`, async () => {
      const f = fixture(profileId), task = f.state.tasks[0];
      f.state.tasks.splice(1); f.setClock(task.dueAt);
      await f.call('alerts.process');
      const alert = f.state.alerts[0], actual = alert.notificationId;
      await f.call('alert.snooze', { alertId: alert.id, minutes: 5 });
      assert.equal(f.notifications.has(actual), false);
      f.context.updateNotification = () => { assert.fail('Already snoozed transitions have no live notification.'); };
      const result = await f.call(`alert.${action}`, { alertId: alert.id, ...(action === 'snooze' ? { minutes: 10 } : {}) });
      assert.equal(result.status, 'applied'); assert.equal(f.state.alerts[0], alert);
      assert.equal(alert.notificationId, actual);
      assert.equal(alert.status, action === 'snooze' ? 'snoozed' : action === 'complete' ? 'completed' : 'dismissed');
      assert.equal(alert.snoozeAt, action === 'snooze' ? task.dueAt + 10 * 60000 : null);
      assert.equal(task.completed, action === 'complete');
      assert.equal(validateRemindersState(f.state, f.profile).ok, true);
    });
  }
}

for (const profileId of REMINDERS_PROFILES) {
  test(`${profileId}: actual Root notifications and historical snooze IDs stay coherent under full-root reservation`, async () => {
    const profile = getOSProfile(profileId), state = createRemindersState(profile), notifications = notificationsDefaults();
    state.tasks.splice(1);
    const root = { reminders: state, notifications }, windows = new Map(), views = new Map();
    const tasks = state.tasks, alerts = state.alerts, task = tasks[0];
    let clock = task.dueAt, held = 0, limit = Infinity;
    const canCommit = delta => Number.isSafeInteger(delta) && canonicalStringUnits(root) + held + delta <= limit;
    const reserve = (delta, commit) => { held += delta; try { return commit(); } finally { held -= delta; } };
    const bridges = createDomainNotificationBridges({ profile, getState: () => notifications, alive: () => true,
      getSceneTime: () => clock, canCommit, reserve });
    const controller = createRemindersCommands({ profile, getState: () => state, alive: () => true, getSceneTime: () => clock, canCommit,
      getWindow: id => windows.get(id), getView: id => views.get(id), available: window => windows.get(window.id) === window,
      tick: async () => {}, focusWindow: () => {}, ...bridges });
    const window = { id: 'reminders-real', appId: 'reminders' };
    const target = { windowId: window.id }, call = (name, payload = {}) => controller.handlers[`reminders.${name}`](target, payload);
    assert.equal((await controller.clockChanged(clock)).ok, true);
    assert.equal(notifications.entries.length, 1); assert.equal(state.windows.length, 0);
    const alert = alerts[0], actual = notifications.entries[0].id;
    assert.equal(alert.notificationId, actual); assert.deepEqual(notifications.entries[0].destination, { kind: 'reminder', recordId: task.id });
    windows.set(window.id, window); views.set(window.id, { available: () => true });
    assert.equal(controller.windowOpened(window), true);
    assert.equal((await call('alert.snooze', { alertId: alert.id, minutes: 5 })).status, 'applied');
    assert.equal(notifications.entries.length, 0); assert.equal(alert.notificationId, actual);
    assert.equal((await call('alert.snooze', { alertId: alert.id, minutes: 10 })).status, 'applied');
    await call('task.edit', { reminderId: task.id });
    await call('editor.set', { spec: { ...reminderSpec(task), title: 'Edited after real snooze retirement' } });
    const before = JSON.stringify(root);
    limit = 0;
    assert.equal((await call('editor.save')).status, 'rejected'); assert.equal(JSON.stringify(root), before);
    limit = Infinity;
    assert.equal((await call('editor.save')).status, 'applied');
    assert.equal(alerts[0], alert); assert.equal(alert.status, 'dismissed'); assert.equal(alert.notificationId, actual);
    assert.equal((await controller.clockChanged(clock)).ok, true);
    const next = alerts.find(row => row.revision === task.revision);
    assert.equal(notifications.entries.length, 1); assert.notEqual(next.notificationId, actual);
    assert.equal((await call('alert.snooze', { alertId: next.id, minutes: 5 })).status, 'applied');
    assert.equal(notifications.entries.length, 0);
    assert.equal((await call('task.delete', { reminderId: task.id, confirmed: true })).status, 'applied');
    assert.equal(state.tasks, tasks); assert.equal(state.alerts, alerts);
    assert.equal(tasks.length, 0); assert.equal(alerts.length, 0); assert.equal(held, 0);
    assert.equal(validateRemindersState(state, profile).ok, true);
  });
}

test('authored pump does not adopt a post-acknowledgment same-value source replacement', async () => {
  const f = fixture(), original = f.context.notify;
  f.setClock(Date.parse('2023-11-03T09:00:00Z'));
  let inserted = 0;
  f.context.notify = async (spec, ownership) => {
    const result = await original(spec, ownership);
    inserted++;
    f.state.tasks[0] = { ...f.state.tasks[0] };
    return result;
  };
  const result = await f.controller.clockChanged(f.context.getSceneTime());
  assert.equal(result.ok, true); assert.equal(result.delivered.length, 1); assert.equal(inserted, 1);
  assert.equal(f.state.alerts.length, 1); assert.equal(f.state.alerts[0].notificationId, result.delivered[0]);
});

test('mixed delivered and snoozed list deletion submits only the still-live actual IDs', async () => {
  const f = fixture();
  f.state.tasks.find(row => row.id === 'reminder-4').listId = 'packing';
  f.setClock(Date.parse('2023-11-03T09:00:00Z'));
  await f.call('alerts.process');
  const snoozed = f.state.alerts.find(row => row.reminderId === 'reminder-1');
  const delivered = f.state.alerts.find(row => row.reminderId === 'reminder-4'), liveId = delivered.notificationId;
  await f.call('alert.snooze', { alertId: snoozed.id, minutes: 5 });
  const batches = [], original = f.context.updateNotifications;
  f.context.updateNotifications = async (ids, patch, owner) => { batches.push([...ids]); return original(ids, patch, owner); };
  assert.equal((await f.call('list.delete', { listId: 'packing', confirmed: true })).status, 'applied');
  assert.deepEqual(batches, [[liveId]]); assert.equal(f.notifications.size, 0);
  assert.equal(f.state.alerts.length, 0); assert.equal(validateRemindersState(f.state, f.profile).ok, true);
});


for (const profileId of REMINDERS_PROFILES) {
  test(`${profileId}: exact planned notification ID fits the complete-scene 4 Mi-unit boundary`, async () => {
    const make = () => {
      const profile = getOSProfile(profileId), state = createRemindersState(profile), notifications = notificationsDefaults();
      state.tasks.splice(1);
      const root = { reminders: state, notifications, padding: '' }, clock = state.tasks[0].dueAt;
      let held = 0, limit = Infinity, reserved = null;
      const canCommit = delta => Number.isSafeInteger(delta) && canonicalStringUnits(root) + held + delta <= limit;
      const reserve = (delta, commit) => { held += delta; try { return commit(); } finally { held -= delta; } };
      const bridges = createDomainNotificationBridges({ profile, getState: () => notifications, alive: () => true,
        getSceneTime: () => clock, canCommit, reserve });
      const controller = createRemindersCommands({ profile, getState: () => state, alive: () => true, getSceneTime: () => clock, canCommit,
        ...bridges, notify: (spec, ownership) => { reserved = spec.reserveTextUnits; return bridges.notify(spec, ownership); } });
      return { state, notifications, root, clock, controller, bridges, setLimit: value => limit = value,
        reserved: () => reserved, held: () => held };
    };
    const probe = make(), initial = canonicalStringUnits(probe.root);
    assert.equal((await probe.controller.clockChanged(probe.clock)).ok, true);
    const growth = canonicalStringUnits(probe.root) - initial, maximum = 4 * 1024 * 1024;
    const exact = make(), beforeReminderUnits = remindersTextUnits(exact.state);
    const beforePlan = JSON.stringify(exact.root), planned = exact.bridges.planNotification(() => true);
    assert.equal(planned.notificationId, 'notification-1'); assert.equal(planned.current(), true);
    assert.equal(JSON.stringify(exact.root), beforePlan);
    exact.root.padding = 'x'.repeat(maximum - canonicalStringUnits(exact.root) - growth);
    exact.setLimit(maximum);
    const result = await exact.controller.clockChanged(exact.clock);
    assert.equal(result.ok, true); assert.deepEqual(result.delivered, ['notification-1']);
    assert.equal(canonicalStringUnits(exact.root), maximum);
    assert.equal(exact.reserved(), remindersTextUnits(exact.state) - beforeReminderUnits);
    assert.equal(exact.state.alerts[0].notificationId, planned.notificationId);
    assert.equal(exact.notifications.entries[0].id, planned.notificationId); assert.equal(exact.held(), 0);
    const over = make();
    over.root.padding = 'x'.repeat(maximum - canonicalStringUnits(over.root) - growth + 1);
    over.setLimit(maximum);
    const beforeRejected = JSON.stringify(over.root);
    assert.equal((await over.controller.clockChanged(over.clock)).ok, false);
    assert.equal(JSON.stringify(over.root), beforeRejected); assert.equal(over.notifications.nextId, 1);
    assert.equal(over.notifications.entries.length, 0); assert.equal(over.state.alerts.length, 0); assert.equal(over.held(), 0);
  });
}

test('delivery requires the planned actual notification ID and never accepts a substituted acknowledgment', async () => {
  const f = fixture();
  f.state.tasks.splice(1); f.setClock(f.state.tasks[0].dueAt);
  const before = JSON.stringify(f.state);
  f.context.notify = async spec => {
    assert.equal(spec.onCommit('notification-2'), false);
    return { status: 'applied', notificationId: 'notification-2' };
  };
  assert.equal((await f.call('alerts.process')).error.code, 'unavailable');
  assert.equal(JSON.stringify(f.state), before); assert.equal(f.notifications.size, 0);
  delete f.context.planNotification;
  assert.equal((await f.call('alerts.process')).error.code, 'unavailable');
  assert.equal(JSON.stringify(f.state), before);
});

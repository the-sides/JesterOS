import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { goldenGateProfile as profile } from '../frontend/src/golden-gate-profile.js';
import {
  notificationsDefaults, validateNotificationsState, notificationGroups, postNotification,
  dismissNotification, clearNotifications, notificationAppSettings, notificationPreviewVisible,
  notificationDesktopStyle, configureNotificationApp, configureNotificationGlobals, snoozeNotification,
} from '../frontend/src/notification-model.js';
import { createNotificationCommands } from '../frontend/src/notification-commands.js';
import { createPreferencesState, preferencesSession, validatePreferencesState } from '../frontend/src/preferences-state.js';
import { createPreferencesCommands } from '../frontend/src/preferences-commands.js';

const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const { proxy } = await import(frontendRequire.resolve('svelte/internal/client'));

const TIME = Date.UTC(2026, 8, 28, 9, 41), MAX_TEXT = 1024 * 1024;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1, MAX_TIME = 8_640_000_000_000_000 - 1;
const event = (state, appId, title, createdAt = TIME, body = '') =>
  postNotification(state, profile, appId, { title, body, createdAt }, TIME, () => true);
const snapshot = value => JSON.parse(JSON.stringify(value));
const stringUnits = value => typeof value === 'string' ? value.length
  : value && typeof value === 'object' ? Object.entries(value).reduce((total, [key, item]) => total + key.length + stringUnits(item), 0) : 0;
function unchanged(state, operation, code) {
  const before = snapshot(state), result = operation();
  expect(result.status).toBe('rejected');
  if (code) expect(result.error.code).toBe(code);
  expect(snapshot(state)).toEqual(before);
  return result;
}

test('posted scene events retain literal text and sort by timestamp, then numeric allocation across app stacks', () => {
  const state = notificationsDefaults();
  event(state, 'mail', 'Older arrival', TIME + 20);
  event(state, 'notes', 'Newest date', TIME + 30);
  event(state, 'mail', 'Out-of-order cue', TIME + 10);
  for (let index = 4; index <= 10; index++) event(state, index === 9 ? 'messages' : 'mail', `Tie ${index}`, TIME + 30);
  const groups = notificationGroups(state, profile);
  expect(groups.map(group => group.groupId)).toEqual(['mail', 'messages', 'notes']);
  expect(groups[0].entries.map(entry => entry.id)).toEqual([
    'notification-10', 'notification-8', 'notification-7', 'notification-6', 'notification-5',
    'notification-4', 'notification-1', 'notification-3',
  ]);
  expect(groups[0].entries[0]).toBe(state.entries[9]);
  const literal = '\ufeff  café\r\n\u{1D11E}\u0000 tail  ';
  const result = postNotification(state, profile, 'notes', { title: '  Literal title  ', body: literal }, TIME + 99, () => true);
  expect(result.target.createdAt).toBe(TIME + 99);
  expect(state.entries.at(-1).title).toBe('  Literal title  ');
  expect(state.entries.at(-1).body).toBe(literal);
  expect(notificationGroups(state, profile)[0].groupId).toBe('notes');
});

test('dismissal and per-app/all clearing never recycle allocations, including after serialization', () => {
  let state = notificationsDefaults();
  event(state, 'mail', 'One'); event(state, 'notes', 'Two'); event(state, 'mail', 'Three');
  expect(dismissNotification(state, 'notification-1').target).toEqual({ notificationId: 'notification-1', dismissed: true });
  expect(clearNotifications(state, 'mail').target.removedIds).toEqual(['notification-3']);
  state = snapshot(state);
  expect(validateNotificationsState(state, profile).ok).toBe(true);
  expect(clearNotifications(state).target.removedIds).toEqual(['notification-2']);
  expect(event(state, 'mail', 'After clearing').target.notificationId).toBe('notification-4');
  expect(state.nextId).toBe(5);
  unchanged(state, () => dismissNotification(state, 'notification-1'), 'not_found');
});

test('delivery preferences silence presentation without dropping explicit operator events or borrowing app overrides', () => {
  const state = notificationsDefaults();
  expect(notificationDesktopStyle(state, 'mail')).toBe('temporary');
  expect(notificationPreviewVisible(state, 'mail', false)).toBe(false);
  configureNotificationApp(state, profile, 'mail', { style: 'persistent', previews: 'always' });
  configureNotificationGlobals(state, profile, { doNotDisturb: true, showPreviews: 'never' });
  expect(event(state, 'mail', 'DND retains center record').status).toBe('applied');
  expect(notificationDesktopStyle(state, 'mail')).toBeNull();
  expect(notificationGroups(state, profile).map(group => group.appId)).toEqual(['mail']);
  expect(notificationPreviewVisible(state, 'mail', false)).toBe(true);
  expect(notificationPreviewVisible(state, 'notes')).toBe(false);
  configureNotificationGlobals(state, profile, { doNotDisturb: false, showPreviews: 'always' });
  expect(notificationDesktopStyle(state, 'mail')).toBe('persistent');
  configureNotificationApp(state, profile, 'mail', { desktop: false });
  expect(notificationDesktopStyle(state, 'mail')).toBeNull();
  expect(notificationGroups(state, profile)).toHaveLength(1);
  configureNotificationApp(state, profile, 'mail', { desktop: true, center: false });
  expect(notificationDesktopStyle(state, 'mail')).toBe('persistent');
  expect(notificationGroups(state, profile)).toEqual([]);
  configureNotificationApp(state, profile, 'mail', { allow: false, center: true });
  expect(event(state, 'mail', 'Disabled delivery still records the cue').status).toBe('applied');
  expect(state.entries.map(entry => entry.title)).toEqual(['DND retains center record', 'Disabled delivery still records the cue']);
  expect(notificationDesktopStyle(state, 'mail')).toBeNull();
  expect(notificationPreviewVisible(state, 'mail')).toBe(false);
  expect(notificationGroups(state, profile)).toEqual([]);
  configureNotificationApp(state, profile, 'mail', { allow: true, previews: 'when-unlocked' });
  expect(notificationPreviewVisible(state, 'mail', false)).toBe(false);
  expect(notificationPreviewVisible(state, 'mail', true)).toBe(true);
  configureNotificationApp(state, profile, 'mail', { previews: 'never' });
  expect(notificationPreviewVisible(state, 'mail')).toBe(false);
  configureNotificationApp(state, profile, 'mail', { previews: 'default' });
  expect(notificationPreviewVisible(state, 'mail', false)).toBe(true);
});

test('resolved app settings and configuration results are detached and default app policies cost no saved rows', () => {
  const state = notificationsDefaults(), resolved = notificationAppSettings(state, 'mail');
  resolved.allow = false; resolved.style = 'persistent';
  expect(notificationDesktopStyle(state, 'mail')).toBe('temporary');
  for (const appId of Object.keys(profile.applications)) {
    expect(configureNotificationApp(state, profile, appId, { allow: true }).status).toBe('applied');
  }
  expect(state.preferences.applications).toHaveLength(0);
  const configured = configureNotificationApp(state, profile, 'mail', { style: 'persistent', previews: 'never' });
  configured.target.settings.style = 'temporary';
  expect(notificationDesktopStyle(state, 'mail')).toBe('persistent');
  expect(notificationPreviewVisible(state, 'mail')).toBe(false);
  const global = configureNotificationGlobals(state, profile, { showPreviews: 'always' });
  global.target.preferences.applications[0].allow = false;
  global.target.preferences.showPreviews = 'never';
  expect(notificationDesktopStyle(state, 'mail')).toBe('persistent');
  expect(notificationPreviewVisible(state, 'notes', false)).toBe(true);
  const restored = snapshot(state);
  expect(notificationDesktopStyle(restored, 'mail')).toBe('persistent');
  expect(notificationPreviewVisible(restored, 'mail')).toBe(false);
  configureNotificationApp(state, profile, 'mail', { style: 'temporary', previews: 'default' });
  expect(state.preferences.applications).toHaveLength(0);
});

test('snoozed linked events retain their original identity and source and rejoin the app stack exactly at scene due time', () => {
  const state = proxy(notificationsDefaults());
  postNotification(state, profile, 'calendar', { title: 'Original event', body: '',
    destination: { kind: 'event', recordId: 'event-1' } }, TIME);
  event(state, 'mail', 'Other app', TIME + 1);
  const original = state.entries[0], destination = original.destination;
  for (const minutes of [5, 15, 60, 1440]) {
    const due = TIME + minutes * 60_000;
    expect(snoozeNotification(state, original.id, minutes, TIME)).toEqual({
      status: 'applied', target: { notificationId: original.id, snoozedUntil: due },
    });
    expect(state.entries[0]).toBe(original);
    expect(original.destination).toBe(destination);
    expect(notificationGroups(state, profile, due - 1).map(group => group.appId)).toEqual(['mail']);
    expect(notificationGroups(state, profile, due).map(group => group.appId)).toEqual(['mail', 'calendar']);
    expect(notificationGroups(state, profile, due)[1].entries[0]).toBe(original);
    expect(original.createdAt).toBe(TIME);
  }
  const restored = snapshot(state), due = restored.entries[0].snoozedUntil;
  expect(notificationGroups(restored, profile, due - 1)).toHaveLength(1);
  expect(notificationGroups(restored, profile, due)).toHaveLength(2);
  for (const [id, minutes, time] of [
    [original.id, 10, TIME], [original.id, 5, -1], [original.id, 5, 1.5],
    [original.id, 5, MAX_TIME - 5 * 60_000 + 1], ['notification-01', 5, TIME],
  ]) unchanged(state, () => snoozeNotification(state, id, minutes, time), 'invalid_arguments');
  unchanged(state, () => snoozeNotification(state, 'notification-99', 5, TIME), 'not_found');
  expect(snoozeNotification(state, original.id, 5, MAX_TIME - 5 * 60_000).target.snoozedUntil).toBe(MAX_TIME);
  expect(notificationGroups(state, profile, MAX_TIME - 1)).toHaveLength(1);
  expect(notificationGroups(state, profile)).toHaveLength(2);
  expect(state.nextId).toBe(3);
});

test('registered destination kinds clone literal intent before quota and reject foreign source syntax without invoking quota', () => {
  const state = notificationsDefaults();
  for (const [kind, appId] of [['message', 'messages'], ['mail', 'mail'], ['event', 'calendar'],
    ['reminder', 'reminders'], ['note', 'notes'], ['file', 'finder']]) {
    const destination = { kind, recordId: `${kind}-1` }, payload = { title: 'Linked event', body: '', destination };
    expect(postNotification(state, profile, appId, payload, TIME, () => {
      destination.kind = 'foreign'; destination.recordId = 'changed';
      payload.destination = null; return true;
    }).status).toBe('applied');
    expect(state.entries.at(-1).destination).toEqual({ kind, recordId: `${kind}-1` });
    expect(state.entries.at(-1).destination).not.toBe(destination);
  }
  let calls = 0, reads = 0;
  const accessor = { kind: 'mail' };
  Object.defineProperty(accessor, 'recordId', { enumerable: true, get() { reads++; throw Error('must not read'); } });
  for (const destination of [
    undefined, { kind: 'message', recordId: 'message-1' }, { kind: 'unknown', recordId: 'mail-1' },
    { kind: 'mail', recordId: '' }, { kind: 'mail', recordId: 'with space' },
    { kind: 'mail', recordId: 'x'.repeat(129) }, { kind: 'mail', recordId: '__proto__' },
    { kind: 'mail', recordId: 'mail-1', extra: true }, accessor,
    Object.defineProperty({ kind: 'mail', recordId: 'mail-1' }, 'hidden', { value: true }),
    { kind: 'mail', recordId: 'mail-1', [Symbol('actor')]: true },
  ]) unchanged(state, () => postNotification(state, profile, 'mail', { title: 'Rejected source', body: '', destination },
    TIME, () => { calls++; return true; }), 'invalid_arguments');
  expect(calls).toBe(0); expect(reads).toBe(0);
});

test('app and global patches are closed descriptor-only intent and reject unknown apps before quota', () => {
  const state = notificationsDefaults();
  let calls = 0, reads = 0;
  const quota = () => { calls++; return true; };
  const appAccessor = Object.defineProperty({}, 'style', { enumerable: true, get() { reads++; return 'persistent'; } });
  for (const patch of [
    {}, appAccessor, { appId: 'mail' }, { allow: 1 }, { badges: 'true' }, { sound: 1 }, { style: 'alert' }, { previews: 'sometimes' },
    { desktop: true, foreign: true }, { center: false, [Symbol('actor')]: true },
    Object.defineProperty({ allow: false }, 'previews', { value: 'never' }),
  ]) unchanged(state, () => configureNotificationApp(state, profile, 'mail', patch, quota), 'invalid_arguments');
  unchanged(state, () => configureNotificationApp(state, profile, 'foreign-app', { allow: false }, quota), 'invalid_arguments');
  const globalAccessor = Object.defineProperty({}, 'showPreviews', { enumerable: true, get() { reads++; return 'never'; } });
  for (const patch of [{}, globalAccessor, { showPreviews: 'default' }, { doNotDisturb: 'true' }, { applications: [] }])
    unchanged(state, () => configureNotificationGlobals(state, profile, patch, quota), 'invalid_arguments');
  expect(calls).toBe(0); expect(reads).toBe(0);
  const appPatch = { style: 'persistent' }, globalPatch = { doNotDisturb: true, showPreviews: 'never' };
  configureNotificationApp(state, profile, 'mail', appPatch, () => { appPatch.style = 'temporary'; return true; });
  configureNotificationGlobals(state, profile, globalPatch, () => {
    globalPatch.doNotDisturb = false; globalPatch.showPreviews = 'always'; return true;
  });
  expect(notificationAppSettings(state, 'mail').style).toBe('persistent');
  expect(notificationDesktopStyle(state, 'mail')).toBeNull();
  expect(notificationPreviewVisible(state, 'notes')).toBe(false);
});

test('every nested canonical descriptor is validated without executing accessors or asking quota', () => {
  let reads = 0, calls = 0;
  for (const ownerOf of [
    state => [state, 'preferences'],
    state => [state.preferences, 'doNotDisturb'],
    state => [state.preferences, 'applications'],
    state => [state.preferences.applications, '0'],
    state => [state.preferences.applications[0], 'allow'],
    state => [state.entries[0], 'destination'],
    state => [state.entries[0].destination, 'recordId'],
    state => [state.entries[0], 'snoozedUntil'],
  ]) {
    const state = notificationsDefaults();
    configureNotificationApp(state, profile, 'mail', { style: 'persistent' });
    postNotification(state, profile, 'mail', { title: 'Original', body: '',
      destination: { kind: 'mail', recordId: 'mail-1' } }, TIME);
    const [owner, key] = ownerOf(state);
    Object.defineProperty(owner, key, { enumerable: true, get() { reads++; throw Error('must not read'); } });
    expect(validateNotificationsState(state, profile).ok).toBe(false);
    expect(configureNotificationGlobals(state, profile, { doNotDisturb: true }, () => { calls++; return true; }).error.code).toBe('invalid_arguments');
    expect(postNotification(state, profile, 'notes', { title: 'Rejected', body: '' }, TIME,
      () => { calls++; return true; }).error.code).toBe('invalid_arguments');
  }
  expect(reads).toBe(0); expect(calls).toBe(0);
});

test('preference capacity counts only saved overrides and rejects duplicate or foreign rows without compatibility merging', () => {
  const applications = { ...profile.applications };
  for (let index = 0; index < 129; index++) applications[`fixture-app-${index}`] = { name: `App ${index}` };
  const selected = { ...profile, applications }, state = notificationsDefaults();
  for (let index = 0; index < 128; index++)
    expect(configureNotificationApp(state, selected, `fixture-app-${index}`, { desktop: false }).status).toBe('applied');
  expect(validateNotificationsState(state, selected).ok).toBe(true);
  unchanged(state, () => configureNotificationApp(state, selected, 'fixture-app-128', { desktop: false }), 'limit_exceeded');
  expect(configureNotificationApp(state, selected, 'fixture-app-128', { desktop: true }).status).toBe('applied');
  expect(state.preferences.applications).toHaveLength(128);
  configureNotificationApp(state, selected, 'fixture-app-0', { desktop: true });
  expect(configureNotificationApp(state, selected, 'fixture-app-128', { desktop: false }).status).toBe('applied');
  expect(postNotification(state, selected, 'mail', { title: 'Required complete saved shape', body: '' }, TIME).status).toBe('applied');
  for (const change of [
    value => { value.preferences.applications[1] = { ...value.preferences.applications[0] }; },
    value => { value.preferences.applications[0].appId = 'foreign-app'; },
    value => { delete value.preferences.applications[0]; },
    value => { value.preferences.applications[0].previews = 'unknown'; },
    value => { delete value.preferences; },
    value => { delete value.entries[0].destination; },
  ]) {
    const candidate = snapshot(state); change(candidate);
    expect(validateNotificationsState(candidate, selected).ok).toBe(false);
  }
});

test('configuration quota counts the whole leaf including row insertion, replacement, removal and shifted indices', () => {
  const state = notificationsDefaults();
  event(state, 'mail', 'Surviving original');
  for (const appId of Object.keys(profile.applications).slice(0, 11))
    configureNotificationApp(state, profile, appId, { desktop: false });
  const removedApp = state.preferences.applications[0].appId;
  const newApp = Object.keys(profile.applications).find(appId => !state.preferences.applications.some(row => row.appId === appId));
  for (const operation of [
    (leaf, quota) => configureNotificationApp(leaf, profile, newApp, { style: 'persistent', previews: 'when-unlocked' }, quota),
    (leaf, quota) => configureNotificationApp(leaf, profile, removedApp, { previews: 'when-unlocked' }, quota),
    (leaf, quota) => configureNotificationApp(leaf, profile, removedApp, { desktop: true }, quota),
    (leaf, quota) => configureNotificationGlobals(leaf, profile, { showPreviews: 'always' }, quota),
  ]) {
    const candidate = snapshot(state);
    expect(operation(candidate).status).toBe('applied');
    const growth = stringUnits(candidate) - stringUnits(state), limit = 4 * MAX_TEXT;
    const unrelated = limit - stringUnits(candidate), exact = snapshot(state), short = snapshot(state);
    const survivor = exact.entries[0];
    let observed;
    expect(operation(exact, delta => {
      observed = delta; return unrelated + stringUnits(exact) + delta <= limit;
    }).status).toBe('applied');
    expect(observed).toBe(growth);
    expect(unrelated + stringUnits(exact)).toBe(limit);
    expect(exact.entries[0]).toBe(survivor);
    unchanged(short, () => operation(short, delta => unrelated + 1 + stringUnits(short) + delta <= limit), 'limit_exceeded');
  }
});

test('post and configuration quotas lease the deep original graph and never overwrite reentrant changes', () => {
  for (const mutate of [
    state => { state.entries[0].destination.recordId = 'mail-2'; },
    state => { state.entries[0].snoozedUntil = TIME + 60_000; },
    state => { state.preferences.doNotDisturb = true; },
    state => { state.preferences.applications[0].previews = 'never'; },
    state => { Object.defineProperty(state.preferences.applications, '0', { writable: false }); },
    state => { Object.setPrototypeOf(state.entries[0].destination, null); },
  ]) for (const operation of [
    (state, quota) => postNotification(state, profile, 'notes', { title: 'Outer post', body: '' }, TIME, quota),
    (state, quota) => configureNotificationApp(state, profile, 'notes', { style: 'persistent' }, quota),
    (state, quota) => configureNotificationGlobals(state, profile, { showPreviews: 'always' }, quota),
  ]) {
    const state = notificationsDefaults();
    configureNotificationApp(state, profile, 'mail', { style: 'persistent' });
    postNotification(state, profile, 'mail', { title: 'Original', body: '', destination: { kind: 'mail', recordId: 'mail-1' } }, TIME);
    const entry = state.entries[0];
    expect(operation(state, () => { mutate(state); return true; }).error.code).toBe('stale_target');
    expect(state.entries).toHaveLength(1); expect(state.entries[0]).toBe(entry); expect(state.nextId).toBe(2);
    expect(notificationAppSettings(state, 'notes').style).toBe('temporary');
    expect(state.preferences.showPreviews).toBe('when-unlocked');
  }
  const state = notificationsDefaults();
  const outer = configureNotificationApp(state, profile, 'mail', { allow: false }, () => {
    expect(configureNotificationGlobals(state, profile, { doNotDisturb: true }).status).toBe('applied');
    return true;
  });
  expect(outer.error.code).toBe('stale_target');
  expect(notificationAppSettings(state, 'mail').allow).toBe(true);
  expect(notificationDesktopStyle(state, 'mail')).toBeNull();
});

test('a callback-installed nested accessor retires every mutation lease without evaluating the replacement', () => {
  let reads = 0;
  for (const operation of [
    (state, quota) => postNotification(state, profile, 'notes', { title: 'Outer', body: '' }, TIME, quota),
    (state, quota) => configureNotificationApp(state, profile, 'mail', { style: 'persistent' }, quota),
    (state, quota) => configureNotificationGlobals(state, profile, { doNotDisturb: true }, quota),
  ]) {
    const state = notificationsDefaults();
    const result = operation(state, () => {
      Object.defineProperty(state.preferences, 'showPreviews', { enumerable: true, get() { reads++; throw Error('must not read'); } });
      return true;
    });
    expect(result.error.code).toBe('stale_target');
    expect(state.entries).toEqual([]); expect(state.nextId).toBe(1);
  }
  expect(reads).toBe(0);
});

test('preference growth participates in the complete four-Mi leaf budget before the external scene decision', () => {
  const state = notificationsDefaults();
  for (let index = 0; index < 3; index++) event(state, 'mail', 'Large retained cue', TIME, 'x'.repeat(MAX_TEXT));
  event(state, 'mail', 'Remaining capacity');
  const candidate = snapshot(state);
  configureNotificationApp(candidate, profile, 'notes', { style: 'persistent' });
  const growth = stringUnits(candidate) - stringUnits(state), limit = 4 * MAX_TEXT;
  state.entries.at(-1).body = 'x'.repeat(limit - stringUnits(state) - growth);
  const over = snapshot(state); over.entries.at(-1).body += 'x';
  let calls = 0;
  unchanged(over, () => configureNotificationApp(over, profile, 'notes', { style: 'persistent' },
    () => { calls++; return true; }), 'limit_exceeded');
  expect(calls).toBe(0);
  expect(configureNotificationApp(state, profile, 'notes', { style: 'persistent' }).status).toBe('applied');
  expect(stringUnits(state)).toBe(limit);
  expect(validateNotificationsState(state, profile).ok).toBe(true);
});

test('read-only canonical writers reject before quota and leave the original event and source untouched', () => {
  const state = notificationsDefaults();
  postNotification(state, profile, 'mail', { title: 'Original', body: '', destination: { kind: 'mail', recordId: 'mail-1' } }, TIME);
  const original = state.entries[0];
  Object.defineProperty(state, 'preferences', { writable: false });
  let calls = 0;
  unchanged(state, () => configureNotificationApp(state, profile, 'mail', { allow: false },
    () => { calls++; return true; }), 'invalid_arguments');
  unchanged(state, () => configureNotificationGlobals(state, profile, { doNotDisturb: true },
    () => { calls++; return true; }), 'invalid_arguments');
  Object.defineProperty(original, 'snoozedUntil', { writable: false });
  unchanged(state, () => snoozeNotification(state, original.id, 5, TIME), 'invalid_arguments');
  expect(calls).toBe(0); expect(state.entries[0]).toBe(original);
});

test('cold reactive source and preference graphs survive quota inspection while retaining entry and destination identities', () => {
  const initial = notificationsDefaults();
  configureNotificationApp(initial, profile, 'mail', { style: 'persistent' });
  postNotification(initial, profile, 'mail', { title: 'Retained', body: '', destination: { kind: 'mail', recordId: 'mail-1' } }, TIME);
  const state = proxy(snapshot(initial));
  const quota = delta => stringUnits(state) + delta <= 4 * MAX_TEXT;
  expect(configureNotificationApp(state, profile, 'notes', { previews: 'never' }, quota).status).toBe('applied');
  const entry = state.entries[0], destination = entry.destination;
  expect(configureNotificationGlobals(state, profile, { doNotDisturb: true }, quota).status).toBe('applied');
  expect(postNotification(state, profile, 'notes', { title: 'Another event', body: '', destination: { kind: 'note', recordId: 'note-1' } }, TIME, quota).status).toBe('applied');
  expect(state.entries[0]).toBe(entry); expect(entry.destination).toBe(destination);
  expect(notificationGroups(state, profile)[1].entries[0]).toBe(entry);
  expect(notificationDesktopStyle(state, 'mail')).toBeNull();
});

test('closed descriptors reject accessors, hidden fields, symbols, sparse arrays and unknown apps without evaluating them', () => {
  let reads = 0;
  const state = notificationsDefaults();
  const accessor = { body: '' };
  Object.defineProperty(accessor, 'title', { enumerable: true, get() { reads++; return 'Actor accessor'; } });
  for (const payload of [
    accessor, { title: 'Known', body: '', extra: true }, { title: 'Known', body: '', [Symbol('hidden')]: true },
    Object.defineProperty({ title: 'Known', body: '' }, 'createdAt', { value: TIME }),
    { title: 'Known', body: '', createdAt: undefined }, Object.assign(Object.create({}), { title: 'Known', body: '' }),
  ]) unchanged(state, () => postNotification(state, profile, 'mail', payload, TIME, () => true), 'invalid_arguments');
  unchanged(state, () => event(state, 'not-installed', 'Unknown'), 'invalid_arguments');
  const good = { id: 'notification-1', appId: 'mail', title: 'Original', body: '', createdAt: TIME, destination: null, snoozedUntil: null };
  const malformed = [
    { ...notificationsDefaults(), nextId: 2, entries: [good], extra: true },
    { ...notificationsDefaults(), nextId: 2, entries: [good, good] }, { ...notificationsDefaults(), nextId: 1, entries: [good] },
    { ...notificationsDefaults(), nextId: 2, entries: Array(1) },
    { ...notificationsDefaults(), nextId: 2, entries: Object.assign([good], { extra: true }) },
    { ...notificationsDefaults(), nextId: 2, entries: [Object.defineProperty({ ...good }, 'title', { enumerable: true, get() { reads++; return 'Getter'; } })] },
    { ...notificationsDefaults(), nextId: 2, entries: [{ ...good, id: 'notification-01' }] },
    { ...notificationsDefaults(), nextId: 2, entries: [{ ...good, appId: 'not-installed' }] },
    Object.defineProperty({ ...notificationsDefaults(), nextId: 2 }, 'entries', { enumerable: true, get() { reads++; return [good]; } }),
  ];
  for (const input of malformed) {
    expect(validateNotificationsState(input, profile).ok).toBe(false);
    expect(postNotification(input, profile, 'mail', { title: 'New', body: '' }, TIME, () => true).status).toBe('rejected');
  }
  expect(reads).toBe(0);
});

test('UTF-16 text, event time, capacity and allocation boundaries reject atomically and leave future IDs intact', () => {
  const state = notificationsDefaults();
  expect(event(state, 'mail', '😀'.repeat(128), 0, '😀'.repeat(MAX_TEXT / 2)).status).toBe('applied');
  expect(state.entries[0].createdAt).toBe(0);
  for (const [title, body, time] of [
    ['😀'.repeat(129), '', TIME], ['Title', '😀'.repeat(MAX_TEXT / 2 + 1), TIME],
    [' \t ', '', TIME], ['First\nSecond', '', TIME], ['First\u2028Second', '', TIME],
    ['Title', '', -1], ['Title', '', 1.5], ['Title', '', MAX_TIME + 1],
  ]) unchanged(state, () => event(state, 'mail', title, time, body), 'invalid_arguments');
  expect(event(state, 'notes', 'Last date', MAX_TIME).target.createdAt).toBe(MAX_TIME);
  const crowded = notificationsDefaults();
  for (let index = 0; index < 256; index++) event(crowded, 'mail', `Cue ${index}`);
  expect(notificationGroups(crowded, profile)[0].entries).toHaveLength(256);
  unchanged(crowded, () => event(crowded, 'mail', 'Over capacity'), 'limit_exceeded');
  dismissNotification(crowded, 'notification-1');
  expect(event(crowded, 'mail', 'Available again').target.notificationId).toBe('notification-257');
  const counter = { ...notificationsDefaults(), nextId: MAX_COUNTER - 1 };
  expect(event(counter, 'mail', 'Last allocation').target.notificationId).toBe('notification-9007199254740989');
  clearNotifications(counter);
  unchanged(counter, () => event(counter, 'mail', 'No reuse after exhaustion'), 'limit_exceeded');
});

test('fresh and cold reactive events survive a quota read of the complete canonical graph', () => {
  const fresh = proxy(notificationsDefaults());
  const budget = state => delta => JSON.stringify({ system: { notifications: state } }).length + delta <= 4 * MAX_TEXT;
  const first = postNotification(fresh, profile, 'mail', { title: 'First arrival', body: 'Retain this event' }, TIME, budget(fresh));
  expect(first).toEqual({ status: 'applied', target: { notificationId: 'notification-1', appId: 'mail', createdAt: TIME } });
  const cold = proxy(snapshot(fresh));
  const second = postNotification(cold, profile, 'notes', { title: 'Cold arrival', body: '' }, TIME + 1, budget(cold));
  expect(second).toEqual({ status: 'applied', target: { notificationId: 'notification-2', appId: 'notes', createdAt: TIME + 1 } });
  expect(cold.entries.map(entry => entry.id)).toEqual(['notification-1', 'notification-2']);
  expect(cold.entries[0].body).toBe('Retain this event');
  expect(cold.nextId).toBe(3);
});

test('exact whole-scene quota admits a linked event at the boundary and rejects one UTF-16 unit less without allocating', () => {
  for (const count of [0, 10]) {
    const original = notificationsDefaults();
    for (let index = 0; index < count; index++) event(original, 'mail', 'Retained');
    const payload = { title: 'Linked 🎬 cue', body: 'Literal body', destination: { kind: 'mail', recordId: 'sent-mail-1' } };
    const admitted = snapshot(original);
    expect(postNotification(admitted, profile, 'mail', payload, TIME).status).toBe('applied');
    const expectedGrowth = stringUnits(admitted) - stringUnits(original);
    const limit = 4 * MAX_TEXT, unrelated = limit - stringUnits(admitted);
    const exact = snapshot(original), short = snapshot(original);
    expect(postNotification(exact, profile, 'mail', payload, TIME,
      delta => unrelated + stringUnits(exact) + delta <= limit).status).toBe('applied');
    expect(unrelated + stringUnits(exact)).toBe(limit);
    unchanged(short, () => postNotification(short, profile, 'mail', payload, TIME,
      delta => unrelated + 1 + stringUnits(short) + delta <= limit), 'limit_exceeded');
    let observedGrowth;
    expect(postNotification(snapshot(original), profile, 'mail', payload, TIME,
      delta => { observedGrowth = delta; return true; }).status).toBe('applied');
    expect(observedGrowth).toBe(expectedGrowth);
  }
  const state = notificationsDefaults();
  for (const decision of [() => false, () => { throw Error('quota failed'); }, () => Promise.resolve(true)])
    unchanged(state, () => postNotification(state, profile, 'mail', { title: 'No allocation', body: '' }, TIME, decision), 'limit_exceeded');
  const large = notificationsDefaults();
  for (let index = 0; index < 3; index++) event(large, 'notes', 'Large', TIME, 'x'.repeat(MAX_TEXT));
  unchanged(large, () => event(large, 'notes', 'Fourth', TIME, 'x'.repeat(MAX_TEXT)), 'limit_exceeded');
});

test('quota callbacks cannot redirect literal payloads, overwrite reentrant events or accept changed descriptors', () => {
  const state = notificationsDefaults(), payload = { title: 'Original title', body: 'Original body' };
  expect(postNotification(state, profile, 'mail', payload, TIME, () => {
    payload.title = 'Changed by callback'; payload.body = 'Changed'; return true;
  }).status).toBe('applied');
  expect(state.entries[0].title).toBe('Original title'); expect(state.entries[0].body).toBe('Original body');
  const result = postNotification(state, profile, 'notes', { title: 'Outer', body: '' }, TIME, () => {
    expect(event(state, 'messages', 'Inner').target.notificationId).toBe('notification-2'); return true;
  });
  expect(result.error.code).toBe('stale_target');
  expect(state.entries.map(entry => entry.title)).toEqual(['Original title', 'Inner']);
  expect(state.nextId).toBe(3);
  let reads = 0;
  const descriptorResult = postNotification(state, profile, 'notes', { title: 'Not accepted', body: '' }, TIME, () => {
    Object.defineProperty(state.entries[0], 'title', { enumerable: true, get() { reads++; return 'Trapped'; } }); return true;
  });
  expect(descriptorResult.error.code).toBe('stale_target'); expect(state.nextId).toBe(3); expect(reads).toBe(0);
  const readonly = notificationsDefaults();
  Object.defineProperty(readonly, 'nextId', { writable: false });
  unchanged(readonly, () => event(readonly, 'mail', 'Readonly counter'), 'invalid_arguments');
});

test('historical profiles validate registered saved events but cannot post or operate Notification Center', async () => {
  const historical = { ...profile, id: 'macos-sonoma-14.8.3' }, state = notificationsDefaults();
  event(state, 'mail', 'Saved event');
  expect(validateNotificationsState(state, historical).ok).toBe(true);
  unchanged(state, () => postNotification(state, historical, 'mail', { title: 'Unsupported', body: '' }, TIME, () => true), 'unsupported_profile');
  unchanged(state, () => configureNotificationApp(state, historical, 'mail', { style: 'persistent' }), 'unsupported_profile');
  unchanged(state, () => configureNotificationGlobals(state, historical, { doNotDisturb: true }), 'unsupported_profile');
  const model = centerFixture(state, historical);
  expect((await model.run('open')).error.code).toBe('unsupported_profile');
  expect(model.pane()).toBeNull();
  expect((await model.run('post', { appId: 'notes' }, { title: 'Unsupported', body: '' })).error.code).toBe('unsupported_profile');
  expect(state.entries.map(entry => entry.title)).toEqual(['Saved event']);
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function centerFixture(initial = notificationsDefaults(), selectedProfile = profile) {
  let state = initial, pane = null, view = null, foreground = true, root = true, sceneTime = TIME;
  let outsideFocus = { connected: true, label: 'original editor' }, focus = outsideFocus;
  const ui = { banners: [], items: {} };
  const ctx = { profile: selectedProfile, namespace: 'scene-test', getState: () => state, getSceneTime: () => sceneTime,
    getUi: () => ui, getBannerView: () => null, alive: () => root, available: () => foreground,
    canCommit: () => true, getPane: () => pane, getView: () => view,
    setPane(value) { pane = value; view = value ? makeView(value) : null; },
    settle: async () => { view?.sync(); }, beforeOpen: async () => true,
    captureFocus: () => outsideFocus,
    restoreFocus: async (token, guard) => { if (guard() && token?.connected) focus = token; },
  };
  // A retained viewport, not an echo facade: controls have native identity and
  // disappear with their original records; physical scrolling clamps to extent.
  function makeView(owner) {
    const nodes = new Map(), viewport = { top: 0, left: 0, prepareGate: null, focusGate: null, scrollGate: null,
      blockedFocus: false, dishonestScroll: false };
    let currentFocus = null;
    function sync() {
      const definitions = new Map([['center', null], ['close', null]]);
      if (state.entries.length) definitions.set('clear-all', null);
      const apps = new Set(state.entries.map(entry => entry.appId));
      for (const appId of apps) {
        const entries = state.entries.filter(entry => entry.appId === appId)
          .sort((a, b) => b.createdAt - a.createdAt || Number(b.id.slice(13)) - Number(a.id.slice(13)));
        if (owner.expandedGroupIds.includes(appId)) {
          definitions.set(`collapse:${appId}`, null); definitions.set(`clear:${appId}`, null);
          for (const entry of entries) definitions.set(`dismiss:${entry.id}`, entry);
        } else { definitions.set(`group:${appId}`, null); definitions.set(`dismiss:${entries[0].id}`, entries[0]); }
      }
      for (const [id, node] of nodes) if (!definitions.has(id) || definitions.get(id) !== node.entry) {
        node.connected = false; nodes.delete(id);
      }
      for (const [id, entry] of definitions) if (!nodes.has(id)) nodes.set(id, { id, entry, connected: true });
      if (currentFocus && !currentFocus.connected) currentFocus = null;
    }
    const available = () => root && foreground && pane === owner && view === facade;
    const retained = (node, controlId, guard) => guard() && available() && node?.connected && nodes.get(controlId) === node;
    async function pause(kind) {
      const gate = viewport[`${kind}Gate`];
      if (gate) { gate.started.resolve(); await gate.promise; }
      sync();
    }
    const facade = { viewport, nodes, sync, available,
      describe() { sync(); return { controlIds: [...nodes.keys()], focusedControl: currentFocus?.id ?? null,
        scroll: { top: viewport.top, left: viewport.left } }; },
      async prepare(controlId, guard) {
        sync(); const node = nodes.get(controlId);
        if (!retained(node, controlId, guard)) return false;
        await pause('prepare'); return retained(node, controlId, guard);
      },
      async focus(controlId, guard) {
        sync(); const node = nodes.get(controlId);
        if (!retained(node, controlId, guard)) return false;
        await pause('focus'); if (!retained(node, controlId, guard)) return false;
        if (!viewport.blockedFocus) { currentFocus = node; focus = node; }
        return true;
      },
      async scroll(requested, guard) {
        sync(); const node = nodes.get('center');
        if (!retained(node, 'center', guard)) return null;
        await pause('scroll'); if (!retained(node, 'center', guard)) return null;
        viewport.top = Math.min(400, requested.top); viewport.left = Math.min(60, requested.left);
        return viewport.dishonestScroll ? { ...requested } : { top: viewport.top, left: viewport.left };
      },
    };
    sync(); return facade;
  }
  const commands = createNotificationCommands(ctx);
  return { commands, ctx, pane: () => pane, view: () => view, state: () => state, focus: () => focus,
    target: extra => ({ centerId: pane.centerId, ...extra }),
    run: (name, target = {}, payload = {}) => commands.handlers[`notifications.${name}`](target, payload),
    gate(kind = 'prepare') {
      const gate = { ...deferred(), started: deferred() }; view.viewport[`${kind}Gate`] = gate; return gate;
    },
    foreground(value) { foreground = value; commands.reconcile(); },
    root(value) { root = value; commands.reconcile(); },
    replaceState(value) { state = value; commands.reconcile(); },
    replaceView() { view = makeView(pane); return view; },
    replacePane(value) { ctx.setPane(value); commands.reconcile(); },
    sceneTime(value) { sceneTime = value; },
    outside(value) { outsideFocus = value; focus = value; },
  };
}

test('one-item expansion exposes full-body controls and removal recovers focus to the same surviving center', async () => {
  const model = centerFixture();
  await model.run('post', { appId: 'mail' }, { title: 'One', body: 'Full body\r\nSecond line' });
  await model.run('post', { appId: 'notes' }, { title: 'Two', body: '' });
  expect((await model.run('open')).target.reused).toBe(false);
  const center = model.pane().centerId;
  await model.run('focus', model.target({ controlId: 'group:mail' }));
  expect((await model.run('group.setExpanded', model.target({ groupId: 'mail' }), { expanded: true })).status).toBe('applied');
  expect(model.commands.summary().expandedGroupIds).toEqual(['mail']);
  expect(model.commands.targets().controlIds).toContain('clear:mail');
  expect(model.commands.targets().controlIds).not.toContain('group:mail');
  expect(model.commands.summary().focusedControl).toBe('center');
  await model.run('focus', model.target({ controlId: 'dismiss:notification-1' }));
  expect((await model.run('dismiss', model.target({ notificationId: 'notification-1' }))).target)
    .toEqual({ centerId: center, notificationId: 'notification-1', dismissed: true });
  expect(model.commands.summary().focusedControl).toBe('center');
  expect(model.commands.summary().expandedGroupIds).toEqual([]);
  expect(model.commands.groups().map(group => group.groupId)).toEqual(['notes']);
  expect((await model.run('clear', model.target({ groupId: 'notes' }))).target.removedIds).toEqual(['notification-2']);
  expect(model.commands.summary().centerId).toBe(center);
  expect(model.commands.targets().controlIds).toEqual(['center', 'close']);
  expect(model.state().nextId).toBe(3);
});

test('collapse and clear-all recover removed header/item focus without restoring an unrelated editor', async () => {
  const state = notificationsDefaults(); event(state, 'mail', 'Older'); event(state, 'mail', 'Newer');
  const model = centerFixture(state); await model.run('open');
  await model.run('group.setExpanded', model.target({ groupId: 'mail' }), { expanded: true });
  await model.run('focus', model.target({ controlId: 'dismiss:notification-1' }));
  expect((await model.run('group.setExpanded', model.target({ groupId: 'mail' }), { expanded: false })).status).toBe('applied');
  expect(model.commands.summary().focusedControl).toBe('center');
  expect(model.commands.targets().controlIds).not.toContain('dismiss:notification-1');
  await model.run('focus', model.target({ controlId: 'clear-all' }));
  expect((await model.run('clear', model.target())).target.removedIds).toEqual(['notification-1', 'notification-2']);
  expect(model.focus().id).toBe('center'); expect(model.commands.summary().focusedControl).toBe('center');
  expect(model.commands.targets().controlIds).not.toContain('clear-all');
});

test('scroll reports achieved retained offsets and rejects native claims not observed in the same viewport', async () => {
  const model = centerFixture(); await model.run('open');
  expect((await model.run('scroll', model.target(), { top: 900, left: 200 })).target)
    .toEqual({ ...model.target(), top: 400, left: 60 });
  const copy = model.commands.summary(); copy.scroll.top = 10000;
  expect(model.commands.summary().scroll.top).toBe(400);
  model.view().viewport.dishonestScroll = true;
  expect((await model.run('scroll', model.target(), { top: 900, left: 200 })).status).toBe('rejected');
  model.view().viewport.blockedFocus = true;
  expect((await model.run('focus', model.target({ controlId: 'close' }))).status).toBe('rejected');
  expect(model.commands.summary().focusedControl).toBe('center');
});

test('original entry and group leases reject same-ID replacement or a newly arrived group member across preparation', async () => {
  for (const operation of ['dismiss', 'group.setExpanded', 'clear']) {
    const state = notificationsDefaults(); event(state, 'mail', 'Original');
    const model = centerFixture(state); await model.run('open'); const gate = model.gate();
    const target = operation === 'dismiss' ? model.target({ notificationId: 'notification-1' }) : model.target({ groupId: 'mail' });
    const pending = model.run(operation, target, operation === 'group.setExpanded' ? { expanded: true } : {});
    await gate.started.promise;
    state.entries[0] = { ...state.entries[0], title: 'Replacement' };
    model.commands.reconcile(); gate.resolve();
    expect((await pending).status).toBe('rejected');
    expect(state.entries[0].title).toBe('Replacement'); expect(state.nextId).toBe(2);
    expect(model.commands.summary().expandedGroupIds).toEqual([]);
  }
  const state = notificationsDefaults(); event(state, 'mail', 'Existing');
  const model = centerFixture(state); await model.run('open'); const gate = model.gate();
  const pending = model.run('clear', model.target({ groupId: 'mail' })); await gate.started.promise;
  event(state, 'mail', 'Arrived during native preparation'); gate.resolve();
  expect((await pending).status).toBe('rejected');
  expect(state.entries.map(entry => entry.title)).toEqual(['Existing', 'Arrived during native preparation']);
});

test('suspension cancels pending native leases permanently while retaining the original center for fresh resumed commands', async () => {
  const state = notificationsDefaults(); event(state, 'mail', 'Original');
  const model = centerFixture(state); await model.run('open'); const center = model.pane();
  const gate = model.gate('focus'), pending = model.run('focus', model.target({ controlId: 'close' }));
  await gate.started.promise;
  model.foreground(false); expect(model.commands.targets().controlIds).toEqual([]);
  model.foreground(true); gate.resolve();
  expect((await pending).status).toBe('rejected');
  expect(model.pane()).toBe(center); expect(model.commands.summary().focusedControl).toBe('center');
  expect((await model.run('focus', model.target({ controlId: 'close' }))).status).toBe('applied');
  expect(model.commands.summary().focusedControl).toBe('close');
});

test('native view replacement, same-ID pane replacement, clearing and Root disposal never retarget pending operations', async () => {
  for (const replace of ['view', 'pane', 'clear', 'dispose', 'state', 'root']) {
    const state = notificationsDefaults(); event(state, 'mail', 'Original');
    const model = centerFixture(state); await model.run('open');
    const old = model.target(), gate = model.gate(), pending = model.run('dismiss', { ...old, notificationId: 'notification-1' });
    await gate.started.promise;
    if (replace === 'view') model.replaceView();
    if (replace === 'pane') model.replacePane({ ...model.pane(), expandedGroupIds: [], scroll: { top: 0, left: 0 } });
    if (replace === 'clear') { model.commands.clear(); await model.run('open'); }
    if (replace === 'dispose') model.commands.dispose();
    if (replace === 'state') model.replaceState(snapshot(state));
    if (replace === 'root') { model.root(false); model.root(true); }
    gate.resolve();
    expect((await pending).status).toBe('rejected');
    expect(model.state().entries[0].title).toBe('Original');
    expect(model.state().nextId).toBe(2);
    if (replace === 'dispose' || replace === 'state' || replace === 'root') {
      expect(model.commands.summary()).toBeNull();
      expect((await model.run('open')).status).toBe('rejected');
    }
  }
});

test('opening captures focus after incompatible surfaces close; close restores only that original connected capture', async () => {
  const model = centerFixture(), original = { connected: true, label: 'restored Notes editor' };
  model.ctx.beforeOpen = async () => { model.outside(original); return true; };
  await model.run('open');
  model.ctx.beforeOpen = async () => { throw Error('Reused center must not rerun the compatibility transition'); };
  expect((await model.run('open')).target.reused).toBe(true);
  expect((await model.run('close', model.target())).target.closed).toBe(true);
  expect(model.focus()).toBe(original);
  model.ctx.beforeOpen = async () => true; await model.run('open');
  const destination = { connected: true, label: 'clicked destination' }; model.outside(destination);
  await model.run('close', model.target(), { restoreFocus: false }); expect(model.focus()).toBe(destination);
  await model.run('open'); destination.connected = false;
  const unrelated = { connected: true, label: 'unrelated focus' }; model.outside(unrelated);
  await model.run('close', model.target()); expect(model.focus()).toBe(unrelated);
});

test('pending compatibility transitions cannot publish a center after disposal, suspension or a competing original open', async () => {
  for (const interruption of ['dispose', 'suspend', 'compete']) {
    const model = centerFixture(), gate = deferred(), started = deferred();
    model.ctx.beforeOpen = async () => { started.resolve(); await gate.promise; return true; };
    const pending = model.run('open'); await started.promise;
    if (interruption === 'dispose') model.commands.dispose();
    if (interruption === 'suspend') { model.foreground(false); model.foreground(true); }
    if (interruption === 'compete') { model.ctx.beforeOpen = async () => true; await model.run('open'); }
    const retained = model.pane(); gate.resolve();
    expect((await pending).status).toBe('rejected'); expect(model.pane()).toBe(retained);
  }
});

test('posts use the original scene clock and quota ownership cannot write a replacement or suspended Root', async () => {
  const model = centerFixture(); model.sceneTime(TIME + 60000);
  expect((await model.run('post', { appId: 'mail' }, { title: 'Scene event', body: '' })).target.createdAt).toBe(TIME + 60000);
  const original = model.state();
  model.ctx.canCommit = () => { model.replaceState(snapshot(original)); return true; };
  expect((await model.run('post', { appId: 'notes' }, { title: 'No replacement write', body: '' })).status).toBe('rejected');
  expect(original.entries.map(entry => entry.title)).toEqual(['Scene event']);
  expect(model.state().entries.map(entry => entry.title)).toEqual(['Scene event']);
  const suspended = centerFixture();
  suspended.ctx.canCommit = () => { suspended.foreground(false); suspended.foreground(true); return true; };
  expect((await suspended.run('post', { appId: 'mail' }, { title: 'No resumed write', body: '' })).status).toBe('rejected');
  expect(suspended.state().nextId).toBe(1);
});

test('reactive canonical transitions retain surviving original identities and serialized IDs across real center operations', async () => {
  const state = proxy(notificationsDefaults()), model = centerFixture(state);
  await model.run('post', { appId: 'mail' }, { title: 'Original mail', body: '' });
  const original = state.entries[0];
  await model.run('post', { appId: 'notes' }, { title: 'Original note', body: '' });
  expect(notificationGroups(state, profile).find(group => group.groupId === 'mail').entries[0]).toBe(original);
  await model.run('open');
  await model.run('clear', model.target({ groupId: 'notes' }));
  expect(state.entries[0]).toBe(original);
  await model.run('close', model.target());
  const restored = snapshot(state);
  expect(validateNotificationsState(restored, profile).ok).toBe(true);
  expect(event(restored, 'mail', 'Restored continuation').target.notificationId).toBe('notification-3');
  expect(restored.entries.map(entry => entry.title)).toEqual(['Original mail', 'Restored continuation']);
});

test('a reused open retains the existing native facade across its flush rather than focusing a replacement view', async () => {
  const model = centerFixture(); await model.run('open');
  const gate = deferred(), started = deferred();
  model.ctx.settle = async () => { started.resolve(); await gate.promise; };
  const pending = model.run('open'); await started.promise;
  model.replaceView(); gate.resolve();
  expect((await pending).status).toBe('rejected');
  expect(model.commands.summary().focusedControl).toBeNull();
});

test('async actor targets remain literal even when their caller changes them during native preparation', async () => {
  const state = notificationsDefaults(); event(state, 'mail', 'Mail'); event(state, 'notes', 'Notes');
  const model = centerFixture(state); await model.run('open');
  const gate = model.gate(), target = model.target({ groupId: 'mail' }), payload = { expanded: true };
  const pending = model.run('group.setExpanded', target, payload); await gate.started.promise;
  target.groupId = 'notes'; payload.expanded = false; gate.resolve();
  expect((await pending).target).toEqual({ centerId: model.pane().centerId, groupId: 'mail', expanded: true });
  expect(model.commands.summary().expandedGroupIds).toEqual(['mail']);
});

test('final authored clock changes retire original native center leases and reject quota-time arrival rebasing', async () => {
  const state = notificationsDefaults(); event(state, 'mail', 'Original');
  const model = centerFixture(state); await model.run('open'); const gate = model.gate();
  const pending = model.run('dismiss', model.target({ notificationId: 'notification-1' }));
  await gate.started.promise; model.sceneTime(TIME + 1); gate.resolve();
  expect((await pending).status).toBe('rejected'); expect(state.entries).toHaveLength(1);
  const arrival = centerFixture();
  arrival.ctx.canCommit = () => { arrival.sceneTime(TIME + 1); return true; };
  expect((await arrival.run('post', { appId: 'mail' }, { title: 'Not rebased', body: '' })).status).toBe('rejected');
  expect(arrival.state().entries).toEqual([]); expect(arrival.state().nextId).toBe(1);
});

function embeddedSettingsFixture() {
  const model = centerFixture();
  const window = { id: 'preferences-window-1', appId: 'settings' };
  const preferences = createPreferencesState(profile, { sceneTime: TIME });
  const inventory = { hardware: {} };
  let owner = null;
  const view = { available: () => owner?.view === view, focus: async () => true };
  const preferencesView = { available: () => owner?.session === preferencesSession(preferences, window.id) };
  const preferencesController = createPreferencesCommands(preferences, {
    profile, getState: () => preferences, alive: () => true, getSceneTime: () => TIME,
    getShared: name => name === 'notifications' ? model.state() : undefined,
    getInventory: () => inventory, getWindow: id => id === window.id ? window : null,
    getView: () => preferencesView, available: actual => actual === window && owner !== null,
    canCommit: delta => model.ctx.canCommit(delta),
  });
  expect(preferencesController.windowOpened(window, { pane: 'notifications' })).toBe(true);
  const session = preferencesSession(preferences, window.id);
  owner = { window, view, session };
  expect(preferencesController.selectNotificationApp(window.id, 'mail', () => true).status).toBe('applied');
  model.ctx.getSettingsOwner = id => id === window.id ? owner : null;
  model.ctx.getSettingsSelection = retained => retained.session.selectedId;
  model.ctx.prepareSettings = async (_retained, _control, guard) => guard();
  model.ctx.selectSettingsApp = (retained, appId, guard) =>
    preferencesController.selectNotificationApp(retained.window.id, appId, guard);
  return { ...model, window, session, preferences, preferencesController, inventory,
    replaceOwner: value => { owner = value; }, owner: () => owner };
}

test('embedded Preferences selection retains the original hardware source and strict final supplied guard', () => {
  const replaced = embeddedSettingsFixture(), originalPreferences = snapshot(replaced.preferences);
  const originalPolicy = snapshot(replaced.state());
  replaced.ctx.canCommit = () => { replaced.inventory.hardware = {}; return true; };
  expect(replaced.preferencesController.selectNotificationApp(replaced.window.id, 'notes', () => true).error.code).toBe('stale_target');
  expect(replaced.preferences).toEqual(originalPreferences);
  expect(replaced.state()).toEqual(originalPolicy);
  for (const retired of [false, 1, Promise.resolve(true)]) {
    const model = embeddedSettingsFixture(), before = snapshot(model.preferences);
    let supplied = true;
    model.ctx.canCommit = () => { supplied = retired; return true; };
    expect(model.preferencesController.selectNotificationApp(model.window.id, 'notes', () => supplied).error.code).toBe('stale_target');
    expect(model.preferences).toEqual(before);
    expect(model.session.selectedId).toBe('mail');
    expect(model.state().preferences.applications).toEqual([]);
  }
});

test('embedded Preferences selection uses the original canonical session, never copied window authority', async () => {
  const model = embeddedSettingsFixture();
  expect((await model.run('settings.select', { windowId: model.window.id, appId: 'notes' })).status).toBe('applied');
  expect(model.session.selectedId).toBe('notes');
  expect(Object.hasOwn(model.window, 'notificationAppId')).toBe(false);
  expect((await model.run('settings.configure', { windowId: model.window.id, appId: 'notes' },
    { configuration: { allow: false } })).status).toBe('applied');
  expect(notificationAppSettings(model.state(), 'notes').allow).toBe(false);
  expect((await model.run('settings.configure', { windowId: model.window.id, appId: 'mail' },
    { configuration: { allow: false } })).status).toBe('rejected');
  expect(preferencesSession(model.preferences, model.window.id)).toBe(model.session);
  expect(validatePreferencesState(structuredClone(model.preferences), profile).ok).toBe(true);
});

test('same-ID Preferences session replacement during native preparation cannot authorize notification policy writes', async () => {
  const model = embeddedSettingsFixture(), gate = deferred(), started = deferred();
  model.ctx.prepareSettings = async () => { started.resolve(); await gate.promise; return true; };
  const pending = model.run('settings.configure', { windowId: model.window.id, appId: 'mail' },
    { configuration: { desktop: false } });
  await started.promise;
  model.replaceOwner({ ...model.owner(), session: { ...model.session } });
  gate.resolve();
  expect((await pending).status).toBe('rejected');
  expect(model.state().preferences.applications).toEqual([]);
});

test('original embedded Settings retirement during quota cannot commit a Preferences selection or notification policy', async () => {
  const selecting = embeddedSettingsFixture(), before = snapshot(selecting.preferences);
  selecting.ctx.canCommit = () => { selecting.replaceOwner(null); return true; };
  expect((await selecting.run('settings.select', { windowId: selecting.window.id, appId: 'notes' })).status).toBe('rejected');
  expect(selecting.preferences).toEqual(before);
  const configuring = embeddedSettingsFixture(), originalPolicy = snapshot(configuring.state());
  configuring.ctx.canCommit = () => { configuring.replaceOwner(null); return true; };
  expect((await configuring.run('settings.configure', { windowId: configuring.window.id, appId: 'mail' },
    { configuration: { badges: false, sound: false } })).status).toBe('rejected');
  expect(configuring.state()).toEqual(originalPolicy);
});

test('committed embedded notification policy survives presentation retirement without rewriting its Preferences session', async () => {
  const model = embeddedSettingsFixture(), originalPreferences = snapshot(model.preferences);
  model.ctx.settle = async () => { model.replaceOwner(null); };
  expect((await model.run('settings.configure', { windowId: model.window.id, appId: 'mail' },
    { configuration: { sound: false } })).status).toBe('applied');
  expect(notificationAppSettings(model.state(), 'mail').sound).toBe(false);
  expect(model.preferences).toEqual(originalPreferences);
  expect(preferencesSession(model.preferences, model.window.id)).toBe(model.session);
});

test('embedded selection requires genuine source callbacks and retains acknowledged changes after presentation retires', async () => {
  const missing = embeddedSettingsFixture();
  delete missing.ctx.selectSettingsApp;
  expect((await missing.run('settings.select', { windowId: missing.window.id, appId: 'notes' })).status).toBe('rejected');
  expect(missing.session.selectedId).toBe('mail');
  const unacknowledged = embeddedSettingsFixture();
  unacknowledged.ctx.selectSettingsApp = () => ({ status: 'applied' });
  expect((await unacknowledged.run('settings.select', { windowId: unacknowledged.window.id, appId: 'notes' })).status).toBe('rejected');
  expect(unacknowledged.session.selectedId).toBe('mail');
  const acknowledged = embeddedSettingsFixture();
  const commit = acknowledged.ctx.selectSettingsApp;
  acknowledged.ctx.selectSettingsApp = (...args) => {
    const result = commit(...args);
    acknowledged.replaceOwner(null);
    return result;
  };
  expect((await acknowledged.run('settings.select', { windowId: acknowledged.window.id, appId: 'notes' })).status).toBe('applied');
  expect(acknowledged.session.selectedId).toBe('notes');
  expect(validatePreferencesState(structuredClone(acknowledged.preferences), profile).ok).toBe(true);
});

test('native settings badge and sound controls commit only the canonical per-app policies', async () => {
  const model = embeddedSettingsFixture();
  const otherPolicy = snapshot(notificationAppSettings(model.state(), 'notes'));
  expect((await model.run('settings.configure', { windowId: model.window.id, appId: 'mail' },
    { configuration: { badges: false, sound: false } })).status).toBe('applied');
  const policy = notificationAppSettings(model.state(), 'mail');
  expect(policy.badges).toBe(false); expect(policy.sound).toBe(false);
  expect(notificationAppSettings(model.state(), 'notes')).toEqual(otherPolicy);
  expect(model.state().entries).toEqual([]);
});

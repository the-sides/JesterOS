import { expect, test } from 'bun:test';
import { listOSProfiles } from '../frontend/src/os-profiles.js';
import { notificationsDefaults, postNotification, validateNotificationsState, notificationAppSettings, configureNotificationApp } from '../frontend/src/notification-model.js';
import { createDomainNotificationBridges, createNotificationCommands } from '../frontend/src/notification-commands.js';

const TIME = Date.UTC(2026, 9, 7, 9, 41);
const units = value => typeof value === 'string' ? value.length : value && typeof value === 'object'
  ? Object.entries(value).reduce((total, [key, item]) => total + key.length + units(item), 0) : 0;
const profiles = listOSProfiles();
function fixture(profile) {
  let state = notificationsDefaults(), time = TIME, live = true, pending = 0, quota = Infinity;
  const domain = { ledger: '' }, events = [{ id: 'event-1' }], tasks = [{ id: 'reminder-1' }], posted = [], removed = [];
  const ctx = {
    profile, getState: () => state, alive: () => live, getSceneTime: () => time,
    canCommit: delta => units(state) + units(domain) + pending + delta <= quota,
    reserve(delta, commit) { pending += delta; try { return commit(); } finally { pending -= delta; } },
    retainDestination(entry) {
      const rows = entry.destination.kind === 'event' ? events : tasks;
      const original = rows.find(row => row.id === entry.destination.recordId);
      return original ? { current: () => rows.includes(original) } : null;
    },
    onPosted: entry => posted.push(entry), onRemoved: entries => removed.push(...entries),
  };
  const bridges = createDomainNotificationBridges(ctx);
  const ownership = () => live;
  function notify(onCommit = () => true, extra = {}) {
    return bridges.notify({ id: 'calendar-alert-request-1', title: 'Due event', body: 'Literal details',
      eventId: 'event-1', occurrenceStart: TIME, windowId: null, reserveTextUnits: 0, onCommit, ...extra }, ownership);
  }
  return { ctx, bridges, domain, events, tasks, posted, removed, ownership, notify,
    state: () => state, setState: value => { state = value; }, setTime: value => { time = value; },
    setLive: value => { live = value; }, setQuota: value => { quota = value; }, pending: () => pending };
}

for (const profile of profiles) {
  test(`${profile.id}: closed-app Calendar and Reminders delivery acknowledge actual canonical allocations`, () => {
    const f = fixture(profile), ledger = [];
    const first = f.notify(actualId => { ledger.push(actualId); return true; });
    expect(first.status).toBe('applied'); expect(first.notificationId).toBe('notification-1');
    const second = f.bridges.notify({ id: 'reminder-notify-request-1', title: 'Due reminder', body: '',
      source: { appId: 'reminders', reminderId: 'reminder-1', listId: 'list-1', windowId: null, alertId: 'reminder-alert-1' },
      actions: ['complete', 'snooze', 'dismiss'], reserveTextUnits: 0,
      onCommit: actualId => { ledger.push(actualId); return true; } }, { guard: f.ownership, windowId: null });
    expect(second.notificationId).toBe('notification-2');
    expect(ledger).toEqual(['notification-1', 'notification-2']);
    expect(f.posted[0]).toBe(f.state().entries[0]); expect(f.posted[1]).toBe(f.state().entries[1]);
    expect(f.state().entries.map(entry => entry.destination)).toEqual([
      { kind: 'event', recordId: 'event-1' }, { kind: 'reminder', recordId: 'reminder-1' },
    ]);
    expect(validateNotificationsState(f.state(), profile).ok).toBe(true);
  });
}

const profile = profiles.find(row => row.id === 'macos-golden-gate-27.0.1');
test('a strict false acknowledgement inserts neither notification nor allocation, and never announces', () => {
  for (const answer of [false, undefined, Promise.resolve(true)]) {
    const f = fixture(profile), before = JSON.stringify(f.state());
    const result = f.notify(() => answer);
    expect(result.status).toBe('rejected'); expect(JSON.stringify(f.state())).toBe(before);
    expect(f.posted).toEqual([]); expect(f.pending()).toBe(0);
  }
});

test('notification plus signed domain reservation uses the exact complete-root boundary without double counting', () => {
  const measured = fixture(profile); let observed;
  measured.ctx.canCommit = delta => { observed = delta; return true; };
  measured.notify(() => true, { reserveTextUnits: 4 });
  for (const extra of [0, 1]) {
    const f = fixture(profile), before = units(f.state()) + units(f.domain);
    f.setQuota(before + observed - extra);
    const result = f.notify(() => {
      if (!f.ctx.canCommit(4)) return false;
      f.domain.ledger = 'done'; return true;
    }, { reserveTextUnits: 4 });
    expect(result.status).toBe(extra ? 'rejected' : 'applied');
    expect(f.domain.ledger).toBe(extra ? '' : 'done');
    expect(f.state().entries.length).toBe(extra ? 0 : 1); expect(f.pending()).toBe(0);
    if (!extra) expect(units(f.state()) + units(f.domain)).toBe(before + observed);
  }
  const f = fixture(profile); f.domain.ledger = 'x'.repeat(200);
  const result = f.notify(() => { f.domain.ledger = ''; return true; }, { reserveTextUnits: -200 });
  expect(result.status).toBe('applied'); expect(f.domain.ledger).toBe('');
});

test('final authored time and original destination checks precede acknowledgement even inside quota and reservation callbacks', () => {
  for (const changeAt of ['quota', 'reserve']) for (const mutation of ['time', 'source', 'root']) {
    const f = fixture(profile); let acknowledged = false;
    const mutate = () => {
      if (mutation === 'time') f.setTime(TIME + 1);
      else if (mutation === 'source') f.events.splice(0, 1, { id: 'event-1' });
      else f.setState(notificationsDefaults());
    };
    if (changeAt === 'quota') f.ctx.canCommit = () => { mutate(); return true; };
    else f.ctx.reserve = (_, commit) => { mutate(); return commit(); };
    const result = f.notify(() => { acknowledged = true; return true; });
    expect(result.status).toBe('rejected'); expect(acknowledged).toBe(false);
    expect(f.state().entries).toEqual([]); expect(f.posted).toEqual([]);
  }
});

test('own acknowledged domain mutation is final even when its owner retires and presentation callback throws', () => {
  const f = fixture(profile);
  f.ctx.onPosted = () => { throw Error('presentation retired'); };
  const result = f.notify(actualId => { f.domain.ledger = actualId; f.setLive(false); return true; });
  expect(result.status).toBe('applied'); expect(result.notificationId).toBe('notification-1');
  expect(f.state().entries[0].id).toBe(f.domain.ledger);
});

test('dismissal callback sees the actual original ID and failed callback leaves both source and notification intact', () => {
  const f = fixture(profile); f.notify(); const original = f.state().entries[0];
  let called;
  const rejected = f.bridges.updateNotification(original.id, { dismissed: true, onCommit: id => { called = id; return false; } }, f.ownership);
  expect(rejected.status).toBe('rejected'); expect(called).toBe(original.id); expect(f.state().entries[0]).toBe(original);
  const applied = f.bridges.updateNotification(original.id, { dismissed: true, onCommit: id => { f.domain.ledger = id; return true; } }, f.ownership);
  expect(applied.notificationId).toBe(original.id); expect(f.state().entries).toEqual([]);
  expect(f.removed).toEqual([original]); expect(f.removed[0]).toBe(original); expect(f.state().nextId).toBe(2);
});

test('same-ID replacement during dismissal quota cannot inherit original notification authority', () => {
  const f = fixture(profile); f.notify(); const original = f.state().entries[0]; let acknowledged = false;
  f.ctx.canCommit = () => { f.state().entries = [{ ...original, destination: { ...original.destination } }]; return true; };
  const result = f.bridges.updateNotification(original.id, { dismissed: true, onCommit: () => { acknowledged = true; return true; } }, f.ownership);
  expect(result.status).toBe('rejected'); expect(acknowledged).toBe(false);
  expect(f.state().entries).toHaveLength(1); expect(f.state().entries[0]).not.toBe(original); expect(f.removed).toEqual([]);
});

test('batch domain changes are acknowledged once, remove only their exact originals, and preserve survivor identity', () => {
  const f = fixture(profile); f.notify(); f.notify(); f.notify();
  const originals = f.state().entries.slice(), ids = [originals[0].id, originals[2].id]; let calls = 0;
  const rejected = f.bridges.updateNotifications(ids, { dismissed: true, onCommit: () => false }, f.ownership);
  expect(rejected.status).toBe('rejected'); expect(f.state().entries).toEqual(originals);
  const result = f.bridges.updateNotifications(ids, { dismissed: true, onCommit: actualIds => {
    calls++; expect(actualIds).toEqual(ids); f.domain.ledger = actualIds.join(','); return true;
  } }, f.ownership);
  expect(result.notificationIds).toEqual(ids); expect(calls).toBe(1);
  expect(f.state().entries).toEqual([originals[1]]); expect(f.state().entries[0]).toBe(originals[1]);
  expect(f.removed[0]).toBe(originals[0]); expect(f.removed[1]).toBe(originals[2]); expect(f.state().nextId).toBe(4);
});

test('native banners use authored-time expiry and cannot transfer to same-ID replacements', () => {
  const state = notificationsDefaults(); let time = TIME, pane = null;
  const ui = { banners: [], items: {} }, view = { available: () => true };
  const commands = createNotificationCommands({ profile, namespace: 'authored-notification', getState: () => state,
    getSceneTime: () => time, getUi: () => ui, getPane: () => pane, setPane: value => { pane = value; },
    getView: () => null, getBannerView: () => view, alive: () => true, available: () => true });
  const first = postNotification(state, profile, 'mail', { title: 'Due', body: '' }, time);
  commands.notificationPosted(state.entries[0]); expect(ui.banners).toHaveLength(1);
  time += 5999; commands.reconcile(); expect(ui.banners[0].remainingMs).toBe(1);
  time++; commands.reconcile(); expect(ui.banners).toEqual([]); expect(state.entries[0].id).toBe(first.target.notificationId);
  postNotification(state, profile, 'mail', { title: 'Other', body: '' }, time);
  commands.reconcile(); const oldBanner = ui.banners[0], oldEntry = state.entries[1];
  state.entries[1] = { ...oldEntry }; commands.reconcile();
  expect(ui.banners.some(banner => banner === oldBanner)).toBe(false);
  expect(ui.banners).toHaveLength(1); expect(ui.banners[0].bannerId).not.toBe(oldBanner.bannerId);
});

for (const profile of profiles) {
  test(`${profile.id}: incoming call and message destinations retain the registered native application`, () => {
    const f = fixture(profile), call = { id: 'call-1', notificationId: null }, thread = { id: 'conversation-1', notificationId: null };
    const appId = profile.family === 'windows' ? 'teams' : 'facetime';
    f.ctx.retainDestination = entry => {
      const original = entry.destination.kind === 'call' ? call : thread;
      return entry.destination.recordId === original.id ? { current: () => true } : null;
    };
    const incomingCall = f.bridges.notify({ id: 'incoming-call-1', appId, title: 'Incoming call', body: 'Fictional caller',
      source: { kind: 'call', recordId: call.id, windowId: null }, actions: ['accept', 'decline', 'open'],
      onCommit: actualId => { call.notificationId = actualId; return true; } }, f.ownership);
    expect(incomingCall.status).toBe('applied'); expect(f.state().entries[0].appId).toBe(appId);
    expect(f.state().entries[0].id).toBe(call.notificationId);
    const messagingAppId = profile.family === 'windows' ? 'teams' : 'messages';
    const incomingMessage = f.bridges.notify({ id: 'incoming-message-1', appId: messagingAppId, title: 'Incoming message', body: 'Literal message',
      source: { kind: 'message', recordId: thread.id, windowId: null }, actions: ['open', 'reply'],
      onCommit: actualId => { thread.notificationId = actualId; return true; } }, f.ownership);
    expect(incomingMessage.status).toBe('applied'); expect(f.state().entries[1].appId).toBe(messagingAppId);
    expect(f.state().entries[1].id).toBe(thread.notificationId);
    expect(validateNotificationsState(f.state(), profile).ok).toBe(true);
    const before = f.state().nextId;
    const wrong = f.bridges.notify({ id: 'invalid-app-call', appId: 'notes', title: 'Wrong source', body: '',
      source: { kind: 'call', recordId: call.id, windowId: null }, onCommit: () => { throw Error('must not acknowledge'); } }, f.ownership);
    expect(wrong.status).toBe('rejected'); expect(f.state().nextId).toBe(before);
  });
}

test('a rejected native call action preserves the actual alert and a successful action returns actual utility identity', async () => {
  const state = notificationsDefaults(), ui = { banners: [], items: {} };
  const call = { id: 'call-1', status: 'ringing' };
  postNotification(state, profile, 'facetime', { title: 'Incoming call', body: '',
    destination: { kind: 'call', recordId: call.id } }, TIME);
  let focused = null, succeed = false;
  const view = { available: () => true,
    describe: () => ({ controlIds: ['banner', 'dismiss', 'open:notification-1', 'accept:notification-1', 'decline:notification-1'],
      focusedControl: focused, scroll: { top: 0, left: 0 } }),
    prepare: async (_, guard) => guard(), focus: async (control, guard) => { if (!guard()) return false; focused = control; return true; },
  };
  const commands = createNotificationCommands({ profile, namespace: 'actual-call', getState: () => state,
    getSceneTime: () => TIME, getUi: () => ui, getPane: () => null, setPane() {}, getView: () => null,
    getBannerView: () => view, alive: () => true, available: () => true, settle: async () => {},
    actions: () => call.status === 'ringing' ? ['open', 'accept', 'decline'] : ['open'],
    retainDestination: () => ({ source: { kind: 'call', recordId: call.id, record: call }, current: () => call.status === 'ringing' }),
    callDestination: async (source, action, guard) => {
      expect(source.source.record).toBe(call); expect(action).toBe('accept');
      if (!succeed || !guard()) return { status: 'rejected', error: { code: 'unavailable', message: 'Actual call declined transaction.' } };
      call.status = 'connecting';
      return { status: 'applied', target: { windowId: 'facetime-original-utility' }, callId: call.id, callStatus: call.status };
    },
    canCommit: () => true, reserve: (_, commit) => commit(),
    prepareNotificationDismissals: (ids, ownership) => ({
      current: ownership.guard, delta: 0,
      commit: () => ownership.guard() === true && ids.every(id => state.entries.some(entry => entry.id === id)),
    }),
  });
  commands.notificationPosted(state.entries[0]); const original = state.entries[0];
  const target = { bannerId: ui.banners[0].bannerId, notificationId: original.id };
  const rejected = await commands.handlers['notifications.item.accept'](target, {});
  expect(rejected.status).toBe('rejected'); expect(state.entries[0]).toBe(original); expect(call.status).toBe('ringing');
  succeed = true; const result = await commands.handlers['notifications.item.accept'](target, {});
  expect(result.status).toBe('applied'); expect(result.target.callId).toBe(call.id);
  expect(result.target.windowId).toBe('facetime-original-utility'); expect(result.target.callStatus).toBe('connecting');
  expect(state.entries).toEqual([]); expect(ui.banners).toEqual([]);
});

test('sound is bounded snapshotted delivery intent, never implicit playback or a post-commit rejection', () => {
  const f = fixture(profile), intents = [];
  f.ctx.onPosted = (_, intent) => { intents.push(intent.sound); throw Error('autoplay unavailable'); };
  const first = f.notify(); expect(first.status).toBe('applied'); expect(intents).toEqual(['none']);
  const spec = { id: 'sound-request', title: 'Incoming', body: '', eventId: 'event-1', occurrenceStart: TIME,
    sound: 'default', onCommit: () => true };
  f.ctx.canCommit = () => { spec.sound = 'unsafe'; return true; };
  expect(f.bridges.notify(spec, f.ownership).status).toBe('applied'); expect(intents).toEqual(['none', 'default']);
  let acknowledged = false;
  const result = f.notify(() => { acknowledged = true; return true; }, { sound: 'unknown' });
  expect(result.status).toBe('rejected'); expect(acknowledged).toBe(false); expect(f.state().entries).toHaveLength(2);
});

test('source privacy and unlock policies combine instead of overriding locked source privacy', () => {
  const state = notificationsDefaults(), ui = { banners: [], items: {} }; let unlocked = false, sourceVisible = true;
  postNotification(state, profile, 'notes', { title: 'Private title', body: 'Private body' }, TIME);
  const commands = createNotificationCommands({ profile, namespace: 'privacy', getState: () => state,
    getSceneTime: () => TIME, getUi: () => ui, getPane: () => null, setPane() {}, getView: () => null,
    getBannerView: () => null, alive: () => true, available: () => true,
    isUnlocked: () => unlocked, previewAllowed: () => sourceVisible });
  expect(commands.preview(state.entries[0])).toBe(false);
  unlocked = true; expect(commands.preview(state.entries[0])).toBe(true);
  sourceVisible = false; expect(commands.preview(state.entries[0])).toBe(false);
  state.preferences.showPreviews = 'always'; expect(commands.preview(state.entries[0])).toBe(false);
});

test('missing atomic root reservation cannot acknowledge a domain or silently cross independent graph quotas', () => {
  const f = fixture(profile); delete f.ctx.reserve; let acknowledged = false;
  const result = f.notify(() => { acknowledged = true; f.domain.ledger = 'must not commit'; return true; });
  expect(result.status).toBe('rejected'); expect(result.error.code).toBe('unavailable');
  expect(acknowledged).toBe(false); expect(f.state().entries).toEqual([]); expect(f.domain.ledger).toBe('');
});

test('batch IDs are descriptor-validated before reads, and a missing member never partially removes survivors', () => {
  const f = fixture(profile); f.notify(); f.notify(); const originals = f.state().entries.slice(); let reads = 0, acknowledged = false;
  const ids = [originals[0].id];
  Object.defineProperty(ids, '0', { enumerable: true, get() { reads++; throw Error('must not execute'); } });
  const patch = { dismissed: true, onCommit: () => { acknowledged = true; return true; } };
  expect(f.bridges.updateNotifications(ids, patch, f.ownership).status).toBe('rejected');
  expect(reads).toBe(0); expect(acknowledged).toBe(false);
  expect(f.bridges.updateNotifications([originals[0].id, 'notification-999'], patch, f.ownership).status).toBe('rejected');
  expect(f.state().entries).toEqual(originals); expect(f.state().entries[0]).toBe(originals[0]);
});

for (const profile of profiles.filter(row => ['macos-high-sierra-10.13', 'macos-mojave-10.14'].includes(row.id))) {
  test(`${profile.id}: Today/Notifications uses the original pane tab and actual mounted controls`, async () => {
    const state = notificationsDefaults(), ui = { banners: [], items: {} }; let pane = null, focused = null;
    postNotification(state, profile, 'mail', { title: 'Actual alert', body: '' }, TIME);
    const controls = () => ['center', 'close', 'tab:today', 'tab:notifications', 'dnd', 'settings',
      ...(pane?.tab === 'notifications' ? ['clear-all', 'dismiss:notification-1', 'open:notification-1'] : [])];
    const view = { available: () => pane !== null,
      describe: () => ({ controlIds: controls(), focusedControl: focused, scroll: { top: 0, left: 0 } }),
      prepare: async (control, guard) => guard() && controls().includes(control),
      focus: async (control, guard) => { if (!guard() || !controls().includes(control)) return false; focused = control; return true; },
    };
    const commands = createNotificationCommands({ profile, namespace: profile.id, getState: () => state,
      getSceneTime: () => TIME, getUi: () => ui, getPane: () => pane, setPane: value => { pane = value; },
      getView: () => view, getBannerView: () => null, alive: () => true, available: () => true,
      beforeOpen: async () => true, settle: async () => {}, captureFocus: () => null });
    expect((await commands.handlers['notifications.open']({}, {})).status).toBe('applied'); const originalPane = pane;
    expect(pane.tab).toBe('notifications'); expect(commands.targets().controlIds).toContain('open:notification-1');
    const target = { centerId: pane.centerId };
    const result = await commands.handlers['notifications.tab.select'](target, { tab: 'today' });
    expect(result.status).toBe('applied'); expect(pane).toBe(originalPane); expect(pane.tab).toBe('today');
    expect(focused).toBe('tab:today'); expect(commands.targets().controlIds).not.toContain('open:notification-1');
    expect((await commands.handlers['notifications.dismiss']({ ...target, notificationId: 'notification-1' }, {})).status).toBe('rejected');
    expect(state.entries).toHaveLength(1);
    expect((await commands.handlers['notifications.tab.select'](target, { tab: 'notifications' })).status).toBe('applied');
    expect(commands.targets().controlIds).toContain('open:notification-1'); expect(pane).toBe(originalPane);
  });
}

for (const profile of profiles) {
  test(`${profile.id}: publisher notifications use actual Stocks/News record identities and registered native app IDs`, () => {
    const f = fixture(profile), originals = {
      'stocks-price': { id: 'quote-1', symbol: 'JEST', revision: 1 },
      'stocks-story': { id: 'stocks-story-1', revision: 1 },
      'news-story': { id: 'news-story-1', revision: 1 },
    }, ledger = [];
    f.ctx.retainDestination = entry => {
      const record = originals[entry.destination.kind], revision = record?.revision;
      return record?.id === entry.destination.recordId
        ? { source: { record, ...entry.destination }, current: () => originals[entry.destination.kind] === record && record.revision === revision } : null;
    };
    for (const kind of ['stocks-price', 'stocks-story', 'news-story']) {
      const appId = kind === 'news-story' ? 'news' : 'stocks', record = originals[kind];
      const result = f.bridges.notify({ id: `publisher-${kind}`, appId, title: 'Authored source update', body: '',
        source: { kind, recordId: record.id, windowId: null }, actions: ['open'],
        onCommit: actualId => { ledger.push({ id: actualId, record }); return true; } }, f.ownership);
      expect(result.status).toBe('applied'); expect(f.state().entries.at(-1).id).toBe(ledger.at(-1).id);
      expect(f.state().entries.at(-1).destination.recordId).toBe(record.id); expect(ledger.at(-1).record).toBe(record);
    }
    expect(validateNotificationsState(f.state(), profile).ok).toBe(true);
    let acknowledged = false;
    f.ctx.canCommit = () => { originals['news-story'] = { ...originals['news-story'] }; return true; };
    const result = f.bridges.notify({ id: 'stale-publisher', appId: 'news', title: 'Not substituted', body: '',
      source: { kind: 'news-story', recordId: 'news-story-1', windowId: null },
      onCommit: () => { acknowledged = true; return true; } }, f.ownership);
    expect(result.status).toBe('rejected'); expect(acknowledged).toBe(false); expect(f.state().entries).toHaveLength(3);
  });
}

test('prospective allocation plans enable exact ledger quota without consuming or borrowing notification identity', () => {
  const measured = fixture(profile), measuredPlan = measured.bridges.planNotification(measured.ownership); let combinedDelta;
  measured.ctx.canCommit = delta => { combinedDelta = delta; return true; };
  measured.notify(() => true, { reserveTextUnits: measuredPlan.notificationId.length });
  const f = fixture(profile), plan = f.bridges.planNotification(f.ownership), before = units(f.state()) + units(f.domain);
  expect(plan.notificationId).toBe('notification-1'); expect(plan.current()).toBe(true);
  expect(f.state().entries).toEqual([]); expect(f.state().nextId).toBe(1);
  f.setQuota(before + combinedDelta);
  const result = f.bridges.notify({ id: 'exact-ledger', title: 'Due event', body: 'Literal details', eventId: 'event-1', occurrenceStart: TIME,
    reserveTextUnits: plan.notificationId.length, onCommit: actualId => {
      if (!plan.current() || actualId !== plan.notificationId || !f.ctx.canCommit(actualId.length)) return false;
      f.domain.ledger = actualId; return true;
    } }, () => f.ownership() && plan.current());
  expect(result.status).toBe('applied'); expect(result.notificationId).toBe(plan.notificationId);
  expect(f.domain.ledger).toBe(plan.notificationId); expect(units(f.state()) + units(f.domain)).toBe(before + combinedDelta);
  expect(plan.current()).toBe(false);
});

test('reentrant allocation and final authored time changes invalidate plans before source ledger commits', () => {
  for (const kind of ['allocation', 'time']) {
    const f = fixture(profile), plan = f.bridges.planNotification(f.ownership); let acknowledged = false;
    f.ctx.canCommit = () => {
      if (kind === 'allocation') postNotification(f.state(), profile, 'mail', { title: 'Concurrent actual arrival', body: '' }, TIME);
      else f.setTime(TIME + 1);
      return true;
    };
    const result = f.bridges.notify({ id: 'original-plan', title: 'Due event', body: 'Literal details', eventId: 'event-1', occurrenceStart: TIME,
      reserveTextUnits: plan.notificationId.length, onCommit: actualId => { acknowledged = true; f.domain.ledger = actualId; return true; },
    }, () => f.ownership() && plan.current());
    expect(result.status).toBe('rejected'); expect(acknowledged).toBe(false); expect(f.domain.ledger).toBe('');
    expect(plan.current()).toBe(false); expect(f.state().entries.length).toBe(kind === 'allocation' ? 1 : 0);
    if (kind === 'allocation') expect(f.state().entries[0].title).toBe('Concurrent actual arrival');
  }
});

for (const profile of profiles) {
  test(`${profile.id}: canonical app badge and sound policies persist, default compactly, and respect exact shared text quota`, () => {
    const f = fixture(profile), original = f.state();
    expect(notificationAppSettings(original, 'calendar').badges).toBe(true);
    expect(notificationAppSettings(original, 'calendar').sound).toBe(true);
    expect(configureNotificationApp(original, profile, 'calendar', { badges: true, sound: true }).status).toBe('applied');
    expect(original.preferences.applications).toEqual([]);
    const candidate = notificationsDefaults();
    expect(configureNotificationApp(candidate, profile, 'calendar', { badges: false, sound: false }).status).toBe('applied');
    const delta = units(candidate) - units(original), fullRoot = units(original) + units(f.domain);
    f.setQuota(fullRoot + delta - 1);
    expect(configureNotificationApp(original, profile, 'calendar', { badges: false, sound: false }, f.ctx.canCommit).status).toBe('rejected');
    expect(original.preferences.applications).toEqual([]);
    f.setQuota(fullRoot + delta);
    expect(configureNotificationApp(original, profile, 'calendar', { badges: false, sound: false }, f.ctx.canCommit).status).toBe('applied');
    expect(units(original) + units(f.domain)).toBe(fullRoot + delta);
    const restored = JSON.parse(JSON.stringify(original));
    expect(validateNotificationsState(restored, profile).ok).toBe(true);
    expect(notificationAppSettings(restored, 'calendar').badges).toBe(false);
    expect(notificationAppSettings(restored, 'calendar').sound).toBe(false);
    for (const field of ['badges', 'sound']) {
      const missing = JSON.parse(JSON.stringify(restored));
      delete missing.preferences.applications[0][field];
      expect(validateNotificationsState(missing, profile).ok).toBe(false);
      const invalid = JSON.parse(JSON.stringify(restored));
      invalid.preferences.applications[0][field] = 'false';
      expect(validateNotificationsState(invalid, profile).ok).toBe(false);
    }
    expect(configureNotificationApp(original, profile, 'calendar', { badges: true, sound: true }, f.ctx.canCommit).status).toBe('applied');
    expect(original.preferences.applications).toEqual([]);
  });
}

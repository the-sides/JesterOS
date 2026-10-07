import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { goldenGateProfile as profile } from '../frontend/src/golden-gate-profile.js';
import {
  notificationsDefaults, validateNotificationsState, notificationGroups, postNotification,
  dismissNotification, clearNotifications,
} from '../frontend/src/notification-model.js';
import { createNotificationCommands } from '../frontend/src/notification-commands.js';

const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const { proxy } = await import(frontendRequire.resolve('svelte/internal/client'));

const TIME = Date.UTC(2026, 8, 28, 9, 41), MAX_TEXT = 1024 * 1024;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1, MAX_TIME = 8_640_000_000_000_000 - 1;
const event = (state, appId, title, createdAt = TIME, body = '') =>
  postNotification(state, profile, appId, { title, body, createdAt }, TIME, () => true);
const snapshot = value => JSON.parse(JSON.stringify(value));
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
  const good = { id: 'notification-1', appId: 'mail', title: 'Original', body: '', createdAt: TIME };
  const malformed = [
    { nextId: 2, entries: [good], extra: true },
    { nextId: 2, entries: [good, good] }, { nextId: 1, entries: [good] },
    { nextId: 2, entries: Array(1) },
    { nextId: 2, entries: Object.assign([good], { extra: true }) },
    { nextId: 2, entries: [Object.defineProperty({ ...good }, 'title', { enumerable: true, get() { reads++; return 'Getter'; } })] },
    { nextId: 2, entries: [{ ...good, id: 'notification-01' }] },
    { nextId: 2, entries: [{ ...good, appId: 'not-installed' }] },
    Object.defineProperty({ nextId: 2 }, 'entries', { enumerable: true, get() { reads++; return [good]; } }),
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
  const counter = { nextId: MAX_COUNTER - 1, entries: [] };
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

test('quota deltas include entry field keys and numeric array keys; failed decisions allocate nothing', () => {
  const state = notificationsDefaults();
  let sceneUnits = 4 * MAX_TEXT - 45;
  const budget = delta => {
    if (sceneUnits + delta > 4 * MAX_TEXT) return false;
    sceneUnits += delta; return true;
  };
  expect(postNotification(state, profile, 'mail', { title: 'A', body: '' }, TIME, budget).status).toBe('applied');
  expect(sceneUnits).toBe(4 * MAX_TEXT);
  unchanged(state, () => postNotification(state, profile, 'mail', { title: 'B', body: '' }, TIME, budget), 'limit_exceeded');
  unchanged(state, () => postNotification(state, profile, 'mail', { title: 'B', body: '' }, TIME, () => { throw Error('quota failed'); }), 'limit_exceeded');
  unchanged(state, () => postNotification(state, profile, 'mail', { title: 'B', body: '' }, TIME, () => Promise.resolve(true)), 'limit_exceeded');
  for (let index = 1; index < 10; index++) event(state, 'mail', 'A');
  expect(postNotification(state, profile, 'mail', { title: 'A', body: '' }, TIME, delta => delta === 47).status).toBe('applied');
  expect(state.entries.at(-1).id).toBe('notification-11');
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
  const ctx = { profile: selectedProfile, namespace: 'scene-test', getState: () => state, getSceneTime: () => sceneTime,
    alive: () => root, available: () => foreground, canCommit: () => true, getPane: () => pane, getView: () => view,
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

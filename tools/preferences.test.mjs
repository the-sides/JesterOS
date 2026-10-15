import test from 'node:test';
import assert from 'node:assert/strict';
import { listOSProfiles } from '../frontend/src/os-profiles.js';
import { createPreferencesState, validatePreferencesState, preferencesFormat, preferencesAuthenticate } from '../frontend/src/preferences-state.js';
import { createPreferencesCommands, PREFERENCES_SCENE_PASSCODE } from '../frontend/src/preferences-commands.js';
import { preferencesPanes, preferencesControls, preferencesControlValue } from '../frontend/src/preferences-panes.js';
import { soundDefaults, soundSummary, validateSoundState } from '../frontend/src/sound-model.js';
import { appearanceDefaults, appearancePalette } from '../frontend/src/appearance.js';
import { clockDefaults, clockSummary, validateClockState } from '../frontend/src/clock-model.js';
import { copyCanonicalData, applyCanonicalData, canonicalStringUnits } from '../frontend/src/canonical-data.js';
import { fictionalSessionDefaults, signOutFictionalSessions } from '../frontend/src/fictional-session.js';
import { createFilesystemTransactions } from '../frontend/src/filesystem-transactions.js';
import { createStoreState } from '../frontend/src/store-state.js';
import { createStoreCommands } from '../frontend/src/store-commands.js';
import { decodeSceneUpdate } from '../frontend/src/preferences-effects.js';

const profiles = listOSProfiles();
const SCENE_TIME = Date.UTC(2024, 1, 29, 13, 45, 6);
const SCENE_LIMIT = 4 * 1024 * 1024;
const rejected = code => ({ status: 'rejected', error: { code } });

// This is a retained-scene integration harness, not a successful endpoint echo.
// Shared writes validate a candidate, reserve the combined graph and publish to
// the original master only after the controller's synchronous domain callback.
function graphLease(root) {
  const entries = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    entries.push({ value, prototype: Object.getPrototypeOf(value), descriptors });
    for (const descriptor of Object.values(descriptors)) if (Object.hasOwn(descriptor, 'value')) visit(descriptor.value);
  };
  visit(root);
  return () => entries.every(({ value, prototype, descriptors }) =>
    Object.getPrototypeOf(value) === prototype && Reflect.ownKeys(value).length === Reflect.ownKeys(descriptors).length &&
    Reflect.ownKeys(descriptors).every(key => {
      const before = descriptors[key], now = Object.getOwnPropertyDescriptor(value, key);
      return now && ['enumerable', 'configurable', 'writable', 'value', 'get', 'set'].every(field => before[field] === now[field]);
    }));
}
function fixture(profile = profiles.find(row => row.renderer === 'mojave')) {
  const state = createPreferencesState(profile, { sceneTime: SCENE_TIME });
  const shared = { sound: soundDefaults(), appearance: appearanceDefaults(), clock: clockDefaults(), session: fictionalSessionDefaults(profile) };
  const inventory = { hardware: { touchId: false, tablet: false, mouse: true, trackpad: true } };
  const files = { files: [{ id: 'disk', parentId: null, name: 'Scene HD', kind: 'folder', content: '', deleted: false, revision: 1 }, { id: 'downloads', parentId: 'disk', name: 'Downloads', kind: 'folder', content: '', deleted: false, revision: 1 }], nextFileId: 1 };
  const store = createStoreState(profile, { sceneTime: SCENE_TIME });
  inventory.files = files;
  const scene = { preferences: state, shared, files, store, dirtyFileIds: [], padding: '', sceneTime: SCENE_TIME };
  const windows = new Map(), views = new Map(), decisions = [];
  let limit = SCENE_LIMIT, pending = 0;
  const session = id => state.sessions.find(row => row.windowId === id);
  const ctx = {
    profile, getState: () => state, getShared: name => name === 'preferences' ? state : shared[name],
    getInventory: () => inventory, getSceneTime: () => scene.sceneTime,
    getWindow: id => windows.get(id), getView: id => views.get(id),
    alive: () => true, available: window => windows.get(window.id) === window,
    tick: async () => {},
    canCommit: delta => {
      decisions.push(delta);
      return Number.isSafeInteger(delta) && canonicalStringUnits(scene) + pending + delta <= limit;
    },
  };
  ctx.mutateShared = (name, mutate, owner) => {
    const original = shared[name];
    if (!original || typeof mutate !== 'function' || owner.guard() !== true) return rejected('stale_target');
    const current = graphLease(original), candidate = copyCanonicalData(original);
    mutate(candidate);
    const valid = name === 'sound' ? validateSoundState(candidate).ok : name === 'clock'
      ? validateClockState(candidate).ok : name === 'appearance' &&
        ['light', 'dark'].includes(candidate.mode) && typeof candidate.accent === 'string' && typeof candidate.highlight === 'string';
    if (!valid) return rejected('invalid_arguments');
    const delta = canonicalStringUnits(candidate) - canonicalStringUnits(original);
    const credit = owner.reserveTextUnits ?? 0;
    const allowed = ctx.canCommit(delta + credit) === true;
    if (shared[name] !== original || !current() || owner.guard() !== true) return rejected('stale_target');
    if (!allowed) return rejected('limit_exceeded');
    pending = delta;
    let committed = false;
    try { committed = typeof owner.onCommit === 'function' && owner.onCommit() === true; }
    finally { pending = 0; }
    if (!committed) return rejected('atomic_rejected');
    applyCanonicalData(original, candidate);
    return { status: 'applied' };
  };
  ctx.setSceneTime = (instant, owner) => {
    if (!Number.isSafeInteger(instant) || instant < 0 || instant >= 8640000000000000) return rejected('invalid_arguments');
    const originalTime = scene.sceneTime;
    if (owner.guard() !== true) return rejected('stale_target');
    const allowed = ctx.canCommit(owner.reserveTextUnits ?? 0) === true;
    if (scene.sceneTime !== originalTime || owner.guard() !== true) return rejected('stale_target');
    if (!allowed) return rejected('limit_exceeded');
    if (typeof owner.onCommit !== 'function' || owner.onCommit() !== true) return rejected('atomic_rejected');
    scene.sceneTime = instant;
    return { status: 'applied', sceneTime: instant };
  };
  const filesystem = createFilesystemTransactions({
    profile, alive: ctx.alive, getStore: () => files, getSceneTime: ctx.getSceneTime, canCommit: ctx.canCommit,
    makeRecord: record => record,
    reserve: (delta, callback) => { pending = delta; try { return callback() === true; } finally { pending = 0; } },
  });
  ctx.getFile = filesystem.getFile;
  ctx.createFile = (request, owner) => filesystem.mutateFiles({
    operations: [{ type: 'write', parentId: request.parentId, name: request.name, mime: request.mime, content: request.content }],
    reserveTextUnits: request.reserveTextUnits,
    onCommit: (results, metadata) => request.onCommit(results[0].fileId, results[0].file, metadata.find(row => row.id === results[0].fileId)),
  }, owner);
  ctx.readFile = async ({ fileId }, owner) => {
    const file = filesystem.getFile(fileId);
    return file && owner.guard() === true ? { status: 'applied', file, text: file.content } : rejected('stale_target');
  };
  ctx.effectPreferences = (packet, owner) => {
    if (packet.actionId !== 'update.install' || owner.guard() !== true) return rejected('stale_target');
    if (scene.dirtyFileIds.length) return rejected('confirmation_required');
    const futureStore = copyCanonicalData(store), futureSession = copyCanonicalData(shared.session);
    futureStore.sessions.splice(0); signOutFictionalSessions(futureSession);
    const delta = canonicalStringUnits(futureStore) - canonicalStringUnits(store) + canonicalStringUnits(futureSession) - canonicalStringUnits(shared.session);
    const allowed = ctx.canCommit(delta + owner.reserveTextUnits) === true;
    if (!allowed || owner.guard() !== true) return rejected(allowed ? 'stale_target' : 'limit_exceeded');
    pending = delta;
    let acknowledged;
    try { acknowledged = owner.onCommit() === true; } finally { pending = 0; }
    if (!acknowledged) return rejected('atomic_rejected');
    applyCanonicalData(store, futureStore); applyCanonicalData(shared.session, futureSession);
    state.sessions.splice(0); windows.clear(); views.clear();
    return { status: 'applied', restarted: true };
  };
  const controller = createPreferencesCommands(state, ctx);
  const storeController = createStoreCommands(store, { ...ctx, getState: () => store });
  ctx.getPreferencesUpdateHost = id => storeController.getSystemUpdateHost(id);
  ctx.getPreferencesUpdateSettingsHost = id => storeController.getSystemUpdateSettingsHost(id);
  function open(id = `settings-${windows.size + 1}`, options = {}) {
    const window = { id, appId: 'settings' };
    const presentation = { focused: null, scrollTop: 0 };
    const view = {
      available: () => windows.get(id) === window,
      controlIds: () => preferencesPanes(profile, inventory, state).flatMap(pane =>
        pane.tabs.flatMap(tab => preferencesControls(pane.id, typeof tab === 'string' ? tab : tab.id, profile).map(control => control.id))),
      focus: controlId => { presentation.focused = controlId; return true; },
      scroll: top => { presentation.scrollTop = top; return true; },
    };
    windows.set(id, window); views.set(id, view);
    assert.equal(controller.windowOpened(window, options), true);
    return { window, view, presentation, session: () => session(id),
      run: (name, payload = {}) => controller.handlers[`preferences.${name}`]({ windowId: id }, payload) };
  }
  return { state, shared, inventory, scene, files, filesystem, store, storeController, windows, views, ctx, controller, decisions, open,
    limit: value => { limit = value; } };
}

async function applied(window, name, payload = {}) {
  const result = await window.run(name, payload);
  assert.equal(result.status, 'applied', JSON.stringify(result));
  return result;
}

function controls(profile, pane) {
  const metadata = preferencesPanes(profile, {}, createPreferencesState(profile, { sceneTime: SCENE_TIME })).find(row => row.id === pane);
  assert.ok(metadata, `Missing pane ${pane}`);
  return metadata.tabs.flatMap(tab => preferencesControls(pane, typeof tab === 'string' ? tab : tab.id, profile));
}

function control(profile, pane, predicate) {
  const result = controls(profile, pane).find(predicate);
  assert.ok(result, `Missing behavioral control in ${pane}`);
  return result;
}

function snapshot(f) { return copyCanonicalData(f.scene); }

test('all five profiles retain independent search, pane, tab and history in the original window sessions', async () => {
  for (const profile of profiles) {
    const f = fixture(profile), first = f.open(), second = f.open();
    const original = first.session(), history = original.history;
    const panes = preferencesPanes(profile, f.inventory, f.state).filter(row => row.available);
    const sound = panes.find(row => row.id === 'sound');
    const other = panes.find(row => row.id !== 'sound' && row.tabs.length > 0);
    assert.ok(sound && other);
    const secondBefore = copyCanonicalData(second.session());

    await applied(first, 'navigate', { pane: sound.id });
    const tab = sound.tabs.at(-1);
    const tabId = typeof tab === 'string' ? tab : tab.id;
    await applied(first, 'tab', { tab: tabId });
    await applied(first, 'search', { query: 'volume' });
    assert.equal(first.session(), original);
    assert.equal(original.history, history);
    assert.equal(original.pane, sound.id);
    assert.equal(original.tab, tabId);
    assert.equal(original.query, 'volume');
    assert.deepEqual(second.session(), secondBefore);
    const projection = (await f.controller.targets()).preferences.find(row => row.windowId === first.window.id);
    const matchedSound = projection.searchResults.find(row => row.id === 'sound');
    assert.ok(matchedSound.matchedControls.includes('sound.volume'));
    assert.equal(projection.searchResults.some(row => row.id === 'language-region'), false);

    await applied(first, 'navigate', { pane: other.id });
    await applied(first, 'history', { direction: 'back' });
    assert.equal(original.pane, sound.id);
    await applied(first, 'history', { direction: 'forward' });
    assert.equal(original.pane, other.id);
    await applied(first, 'history', { direction: 'back' });
    await applied(first, 'navigate', { pane: panes.find(row => row.id !== sound.id && row.id !== other.id).id });
    const retained = original.pane;
    assert.equal((await first.run('history', { direction: 'forward' })).status, 'rejected');
    assert.equal(original.pane, retained);

    assert.equal(f.controller.windowClosed(second.window), true);
    assert.equal(f.state.sessions.includes(original), true);
    assert.equal(f.state.sessions.some(row => row.windowId === second.window.id), false);
    assert.equal(original.query, 'volume');
    assert.equal(validatePreferencesState(f.state, profile).ok, true);
  }
});

test('a reentrant copied window, mounted view or session cannot receive a pending preference write', async () => {
  for (const replace of [
    (f, w) => f.windows.set(w.window.id, { ...w.window }),
    (f, w) => f.views.set(w.window.id, { ...w.view }),
    (f, w) => { f.state.sessions.splice(f.state.sessions.indexOf(w.session()), 1, copyCanonicalData(w.session())); },
  ]) {
    const f = fixture(), w = f.open(), original = w.session();
    const before = copyCanonicalData(original);
    f.ctx.canCommit = () => { replace(f, w); return true; };
    const result = await w.run('search', { query: 'a different retained query' });
    assert.equal(result.status, 'rejected');
    assert.equal(result.error.code, 'stale_target');
    assert.deepEqual(original, before);
    assert.equal(w.session().query, before.query);
  }
});

test('whole-scene search quota counts keys and indices, accepts signed shrinkage and refuses growth atomically', async () => {
  const f = fixture(), w = f.open(), original = w.session();
  await applied(w, 'search', { query: 'retained long search text' });
  const baseline = canonicalStringUnits(f.scene);
  f.scene.padding = 'p'.repeat(SCENE_LIMIT - baseline);
  assert.equal(canonicalStringUnits(f.scene), SCENE_LIMIT);
  const before = snapshot(f);
  f.decisions.length = 0;
  assert.equal((await w.run('search', { query: 'retained long search text plus additional growth' })).status, 'rejected');
  assert.deepEqual(f.scene, before);
  assert.ok(f.decisions.some(delta => delta > 0));

  f.decisions.length = 0;
  await applied(w, 'search', { query: 'short' });
  const freed = canonicalStringUnits(before) - canonicalStringUnits(f.scene);
  assert.ok(freed > 0);
  assert.ok(f.decisions.includes(-freed));
  assert.equal(w.session(), original);
  assert.equal(original.query, 'short');
});

test('conditional Touch ID and Ink panes follow the live scene hardware, never a copied default inventory', async () => {
  for (const profile of profiles.filter(row => row.family === 'macos')) {
    const f = fixture(profile), w = f.open();
    const available = id => preferencesPanes(profile, f.inventory, f.state).some(row => row.id === id && row.available);
    assert.equal(available('touch-id'), false);
    assert.equal(available('ink'), false);
    for (const pane of ['touch-id', 'ink']) {
      assert.equal((await w.run('navigate', { pane })).status, 'rejected');
      assert.notEqual(w.session().pane, pane);
    }
    f.inventory.hardware.touchId = true;
    assert.equal(available('touch-id'), true);
    await applied(w, 'navigate', { pane: 'touch-id' });
    f.inventory.hardware.touchId = false;
    const before = snapshot(f);
    assert.equal((await w.run('set', { controlId: 'touchId.unlock', value: false })).status, 'rejected');
    assert.deepEqual(f.scene, before);

    f.inventory.hardware.tablet = true;
    if (['high-sierra', 'mojave'].includes(profile.renderer)) {
      assert.equal(available('ink'), true);
      await applied(w, 'navigate', { pane: 'ink' });
      f.inventory.hardware.tablet = false;
      const inkBefore = snapshot(f);
      assert.equal((await w.run('set', { controlId: 'ink.enabled', value: true })).status, 'rejected');
      assert.deepEqual(f.scene, inkBefore);
    } else {
      assert.equal(available('ink'), false, 'Ink must not be backported into modern System Settings');
    }
  }
});

test('Sound and General read and mutate the inherited canonical masters without duplicating output gain or appearance', async () => {
  for (const profile of profiles) {
    const f = fixture(profile), w = f.open();
    const sound = f.shared.sound, outputs = sound.outputs, selected = outputs.find(row => row.id === sound.outputDeviceId);
    const appearance = f.shared.appearance;
    const volume = control(profile, 'sound', row => row.id === 'sound.volume');
    assert.equal(volume.source, 'sound');
    await applied(w, 'navigate', { pane: 'sound' });
    await applied(w, 'set', { controlId: volume.id, value: 25 });
    assert.equal(f.shared.sound, sound);
    assert.equal(sound.outputs, outputs);
    assert.equal(sound.outputs.find(row => row.id === sound.outputDeviceId), selected);
    assert.equal(selected.volume, 25);
    assert.equal(soundSummary(sound).volume, 25);
    assert.equal(preferencesControlValue(f.state, f.shared, volume), 25);
    assert.equal(Object.hasOwn(f.state.configuration.sound, 'volume'), false);
    assert.equal(Object.hasOwn(f.state.configuration.sound, 'outputs'), false);

    // A different canonical consumer's retained route change is immediately
    // visible in Preferences, with no source snapshot copied into its state.
    sound.outputDeviceId = 'headphones';
    assert.equal(preferencesControlValue(f.state, f.shared, volume), 35);
    await applied(w, 'set', { controlId: volume.id, value: 60 });
    assert.equal(outputs.find(row => row.id === 'headphones').volume, 60);
    assert.equal(selected.volume, 25);
    assert.equal(soundSummary(sound).volume, 60);

    await applied(w, 'navigate', { pane: 'general' });
    await applied(w, 'set', { controlId: 'appearance.mode', value: 'dark' });
    assert.equal(f.shared.appearance, appearance);
    assert.equal(appearance.mode, 'dark');
    assert.equal(Object.hasOwn(f.state.configuration, 'appearance'), false);
    if (profile.family === 'macos') assert.equal(appearancePalette(profile, appearance)['--appearance-menu-ink'], '#f5f5f7');
    assert.equal(validatePreferencesState(f.state, profile).ok, true);
    assert.equal(validateSoundState(sound).ok, true);
  }
});

test('copied shared roots and output rows invalidate the original source lease before paired publication', async () => {
  for (const replace of [
    f => { f.shared.sound = copyCanonicalData(f.shared.sound); },
    f => { f.shared.sound.outputs = copyCanonicalData(f.shared.sound.outputs); },
    f => { f.shared.sound.outputs.splice(0, 1, copyCanonicalData(f.shared.sound.outputs[0])); },
  ]) {
    const f = fixture(), w = f.open();
    await applied(w, 'navigate', { pane: 'sound' });
    const original = f.shared.sound, selected = original.outputs[0], stateBefore = copyCanonicalData(f.state);
    let sourceGuard = null;
    const endpoint = f.ctx.mutateShared;
    f.ctx.mutateShared = (name, mutate, owner) => {
      replace(f);
      sourceGuard = owner.guard();
      return endpoint(name, mutate, owner);
    };
    const result = await w.run('set', { controlId: 'sound.volume', value: 11 });
    assert.equal(sourceGuard, false, 'Controller must lease the actual inherited source, including nested original rows');
    assert.equal(result.status, 'rejected');
    assert.equal(result.error.code, 'stale_target');
    assert.equal(selected.volume, 50);
    assert.equal(f.shared.sound.outputs[0].volume, 50);
    assert.deepEqual(f.state, stateBefore);
  }
});

test('combined shared and preferences quota refuses both halves, including callback-time refusal', async () => {
  for (const denyDuringCallback of [false, true]) {
    const f = fixture(), w = f.open();
    await applied(w, 'navigate', { pane: 'general' });
    const before = snapshot(f), root = f.shared.appearance, session = w.session();
    if (denyDuringCallback) {
      let calls = 0;
      f.ctx.canCommit = () => ++calls === 1;
    } else {
      f.limit(canonicalStringUnits(f.scene));
    }
    const result = await w.run('set', { controlId: 'appearance.accent', value: 'graphite' });
    assert.equal(result.status, 'rejected');
    assert.deepEqual(f.scene, before);
    assert.equal(f.shared.appearance, root);
    assert.equal(w.session(), session);
  }
});

test('Date & Time applies the chosen global scene instant and leaves no competing preferences clock', async () => {
  for (const profile of profiles) {
    const f = fixture(profile), w = f.open();
    await applied(w, 'navigate', { pane: 'date-time' });
    await applied(w, 'authenticate', { passcode: PREFERENCES_SCENE_PASSCODE });
    await applied(w, 'set', { controlId: 'dateTime.automatic', value: false });
    const clock = f.shared.clock, dateTime = f.state.configuration.dateTime;
    const chosen = Date.UTC(2031, 6, 8, 9, 10, 11);
    await applied(w, 'action', { actionId: 'date-time.set', values: { instant: chosen } });
    assert.equal(f.scene.sceneTime, chosen);
    assert.equal(clockSummary(clock, f.scene.sceneTime).iso, '2031-07-08T09:10:11.000Z');
    assert.equal(f.shared.clock, clock);
    assert.equal(f.state.configuration.dateTime, dateTime);
    assert.equal(Object.hasOwn(dateTime, 'sceneTime'), false);
    assert.equal(Object.hasOwn(dateTime, 'instant'), false);
    assert.equal(preferencesFormat(f.state, clock, f.scene.sceneTime), 'Jul 8, 2031');

    const before = snapshot(f);
    f.ctx.canCommit = () => false;
    assert.equal((await w.run('action', { actionId: 'date-time.set', values: { instant: chosen + 1000 } })).status, 'rejected');
    assert.deepEqual(f.scene, before);
  }
});

test('a global time endpoint cannot apply after the original Preferences window is replaced during its scene preflight', async () => {
  const f = fixture(), w = f.open();
  await applied(w, 'navigate', { pane: 'date-time' });
  await applied(w, 'authenticate', { passcode: PREFERENCES_SCENE_PASSCODE });
  await applied(w, 'set', { controlId: 'dateTime.automatic', value: false });
  const before = snapshot(f);
  f.ctx.canCommit = () => { f.windows.set(w.window.id, { ...w.window }); return true; };
  const result = await w.run('action', { actionId: 'date-time.set', values: { instant: SCENE_TIME + 60000 } });
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.code, 'stale_target');
  assert.deepEqual(f.scene, before);
});

test('locale date and temperature formatting and inherited clock format change observable examples', async () => {
  for (const profile of profiles) {
    const f = fixture(profile), w = f.open(), clock = f.shared.clock;
    await applied(w, 'navigate', { pane: 'language-region' });
    const dateBefore = preferencesFormat(f.state, clock, SCENE_TIME);
    await applied(w, 'set', { controlId: 'locale.dateStyle', value: 'short' });
    assert.equal(preferencesFormat(f.state, clock, SCENE_TIME), '2/29/24');
    assert.notEqual(preferencesFormat(f.state, clock, SCENE_TIME), dateBefore);
    const temperatureBefore = preferencesFormat(f.state, clock, SCENE_TIME, 'temperature', 20);
    await applied(w, 'set', { controlId: 'locale.temperature', value: 'celsius' });
    const temperatureAfter = preferencesFormat(f.state, clock, SCENE_TIME, 'temperature', 20);
    assert.match(temperatureAfter, /20.*°C/u);
    assert.notEqual(temperatureAfter, temperatureBefore);

    await applied(w, 'navigate', { pane: 'date-time' });
    await applied(w, 'authenticate', { passcode: PREFERENCES_SCENE_PASSCODE });
    await applied(w, 'set', { controlId: 'clock.use24Hour', value: true });
    assert.equal(preferencesFormat(f.state, clock, SCENE_TIME, 'time'), '13:45');
    await applied(w, 'set', { controlId: 'clock.timeZone', value: 'Asia/Tokyo' });
    assert.equal(preferencesFormat(f.state, clock, SCENE_TIME, 'time'), '22:45');
    assert.equal(clockSummary(clock, SCENE_TIME).time24, '22:45:06');
  }
});

test('protected Date & Time confirmation consumes the original sheet draft, not replacement action values', async () => {
  const f = fixture(), w = f.open();
  await applied(w, 'navigate', { pane: 'date-time' });
  const locked = snapshot(f);
  assert.equal((await w.run('action', { actionId: 'date-time.set', values: { instant: SCENE_TIME + 1000 } })).status, 'rejected');
  assert.deepEqual(f.scene, locked);
  assert.equal(f.scene.sceneTime, SCENE_TIME);

  await applied(w, 'authenticate', { passcode: PREFERENCES_SCENE_PASSCODE });
  await applied(w, 'set', { controlId: 'dateTime.automatic', value: false });
  const chosen = Date.UTC(1999, 11, 31, 23, 59, 58);
  await applied(w, 'sheet', { kind: 'date-time.set', values: { instant: chosen } });
  const sheet = w.session().sheet;
  await applied(w, 'draft', { field: 'instant', value: chosen + 1000 });
  assert.equal(w.session().sheet, sheet);
  assert.equal(f.scene.sceneTime, SCENE_TIME, 'Editing a sheet is not applying its protected effect');
  await applied(w, 'action', { actionId: 'date-time.set', values: { instant: Date.UTC(2099, 0, 1) } });
  assert.equal(f.scene.sceneTime, chosen + 1000);
  assert.equal(w.session().sheet, null);
  assert.equal(clockSummary(f.shared.clock, f.scene.sceneTime).iso, '1999-12-31T23:59:59.000Z');
});

test('real fictional passcode authentication authorizes only its original window and never persists the supplied passcode', async () => {
  const f = fixture(), first = f.open(), second = f.open();
  await applied(first, 'navigate', { pane: 'security-privacy' });
  await applied(second, 'navigate', { pane: 'security-privacy' });
  const security = f.state.configuration.security, protectedBefore = copyCanonicalData(security);
  assert.equal((await first.run('authenticate', { passcode: `${PREFERENCES_SCENE_PASSCODE}-incorrect` })).status, 'rejected');
  assert.equal(first.session().unlocked, false);
  assert.equal(second.session().unlocked, false);
  assert.deepEqual(security, protectedBefore);
  await applied(first, 'authenticate', { passcode: PREFERENCES_SCENE_PASSCODE });
  assert.equal(first.session().unlocked, true);
  assert.equal(second.session().unlocked, false);
  assert.equal((await second.run('set', { controlId: 'security.requirePassword', value: false })).status, 'rejected');
  assert.deepEqual(security, protectedBefore);
  await applied(first, 'set', { controlId: 'security.requirePassword', value: false });
  assert.equal(security.requirePassword, false);
  const containsPasscode = value => typeof value === 'string' ? value === PREFERENCES_SCENE_PASSCODE
    : value !== null && typeof value === 'object' && Object.values(value).some(containsPasscode);
  assert.equal(containsPasscode(f.state), false);

  assert.equal(f.controller.windowClosed(first.window), true);
  const reopened = f.open(first.window.id, { pane: 'security-privacy' });
  assert.equal(reopened.session().unlocked, false, 'Authentication must not survive window retirement');
  assert.equal((await reopened.run('set', { controlId: 'security.requirePassword', value: true })).status, 'rejected');
  assert.equal(security.requirePassword, false);
});

test('authentication cannot unlock a same-ID copied window created during its quota callback', async () => {
  const f = fixture(), w = f.open(), original = w.session();
  await applied(w, 'navigate', { pane: 'date-time' });
  f.ctx.canCommit = () => { f.windows.set(w.window.id, { ...w.window }); return true; };
  const result = await w.run('authenticate', { passcode: PREFERENCES_SCENE_PASSCODE });
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.code, 'stale_target');
  assert.equal(original.unlocked, false);
});

test('region, number separators and reordered preferred language change actual locale formatting', async () => {
  const f = fixture(), w = f.open(), clock = f.shared.clock;
  await applied(w, 'navigate', { pane: 'language-region' });
  await applied(w, 'tab', { tab: 'advanced' });
  await applied(w, 'set', { controlId: 'locale.dateStyle', value: 'short' });
  assert.equal(preferencesFormat(f.state, clock, SCENE_TIME), '2/29/24');
  await applied(w, 'set', { controlId: 'locale.region', value: 'GB' });
  assert.equal(preferencesFormat(f.state, clock, SCENE_TIME), '29/02/2024');

  await applied(w, 'set', { controlId: 'locale.numberStyle', value: '1.234,56' });
  assert.equal(preferencesFormat(f.state, clock, SCENE_TIME, 'number', 1234.56), '1.234,56');
  await applied(w, 'set', { controlId: 'locale.numberStyle', value: '1 234,56' });
  assert.equal(preferencesFormat(f.state, clock, SCENE_TIME, 'number', 1234.56), '1 234,56');

  await applied(w, 'action', { actionId: 'language.add', values: { language: 'fr-FR' } });
  await applied(w, 'select', { controlId: 'locale.languages', selectedId: 'fr-FR' });
  await applied(w, 'action', { actionId: 'language.reorder', values: {} });
  await applied(w, 'set', { controlId: 'locale.region', value: 'FR' });
  await applied(w, 'set', { controlId: 'locale.dateStyle', value: 'long' });
  assert.match(preferencesFormat(f.state, clock, SCENE_TIME), /29 février 2024/u);
  assert.equal(validatePreferencesState(f.state, f.ctx.profile).ok, true);
});

test('authored local update publishes genuine bytes through staged original Files and installs only after confirmation', async () => {
  const f = fixture(profiles.find(profile => profile.renderer === 'sonoma')), w = f.open();
  await applied(w, 'navigate', { pane: 'software-update' });
  await applied(w, 'action', { actionId: 'update.check' });
  await applied(w, 'action', { actionId: 'update.download' });
  const updates = f.state.configuration.updates, file = f.filesystem.getFile(updates.packageFileId);
  assert.equal(updates.status, 'ready'); assert.equal(file.revision, updates.packageRevision);
  const decoded = decodeSceneUpdate(file.content, f.ctx.profile);
  assert.equal(decoded.ok, true); assert.equal(decoded.document.release.version, '14.1');
  assert.equal((await w.run('action', { actionId: 'update.install' })).error.code, 'confirmation_required');
  await applied(w, 'sheet', { kind: 'update.install' });
  f.scene.dirtyFileIds.push(file.id);
  assert.equal((await w.run('action', { actionId: 'update.install' })).error.code, 'confirmation_required');
  assert.equal(updates.status, 'ready'); assert.equal(f.windows.get(w.window.id), w.window);
  f.scene.dirtyFileIds.splice(0);
  await applied(w, 'action', { actionId: 'update.install' });
  assert.equal(f.state.configuration.accessibility.reduceMotion, true);
  assert.equal(f.state.configuration.general.scrollbars, 'always');
  assert.equal(f.shared.session.phase, 'login'); assert.equal(f.windows.size, 0);
  assert.equal(f.state.profileId, f.ctx.profile.id);
});

test('High Sierra system updates and policies use the real Store controller host without a Preferences session', async () => {
  const f = fixture(profiles.find(profile => profile.renderer === 'high-sierra')), id = 'appstore-1', window = { id, appId: 'appstore' };
  f.windows.set(id, window); f.views.set(id, { available: () => f.windows.get(id) === window });
  assert.equal(f.storeController.windowOpened(window), true);
  const store = (name, payload) => f.storeController.handlers[name]({ windowId: id }, payload);
  assert.equal((await store('store.sheet', { sheet: 'settings' })).status, 'applied');
  assert.equal((await f.controller.handlers['preferences.systemUpdatePolicy']({ windowId: id }, { setting: 'automaticDownload', value: true })).status, 'applied');
  assert.equal(f.state.configuration.updates.automaticDownload, true);
  assert.equal((await store('store.sheet', { sheet: 'none' })).status, 'applied');
  assert.equal((await store('store.navigate', { section: 'updates' })).status, 'applied');
  assert.equal((await f.controller.handlers['preferences.systemUpdate']({ windowId: id }, { operation: 'check' })).status, 'applied');
  assert.equal(f.state.configuration.updates.status, 'ready');
  assert.equal(f.state.sessions.length, 0);
  const file = f.filesystem.getFile(f.state.configuration.updates.packageFileId);
  assert.equal(decodeSceneUpdate(file.content, f.ctx.profile).ok, true);
  assert.equal((await store('store.sheet', { sheet: 'system-update' })).status, 'applied');
  assert.equal((await f.controller.handlers['preferences.systemUpdate']({ windowId: id }, { operation: 'install' })).status, 'applied');
  assert.equal(f.shared.session.phase, 'login'); assert.equal(f.windows.size, 0);
});

test('native XML profile installs typed enforced configuration and restores original values on removal', async () => {
  const f = fixture(), xml = '<?xml version="1.0"?><plist version="1.0"><dict><key>PayloadType</key><string>Configuration</string><key>PayloadVersion</key><integer>1</integer><key>PayloadIdentifier</key><string>com.example.scene</string><key>PayloadUUID</key><string>11111111-1111-4111-8111-111111111111</string><key>PayloadScope</key><string>System</string><key>PayloadContent</key><array><dict><key>PayloadType</key><string>com.apple.applicationaccess</string><key>PayloadVersion</key><integer>1</integer><key>PayloadIdentifier</key><string>com.example.scene.camera</string><key>PayloadUUID</key><string>22222222-2222-4222-8222-222222222222</string><key>allowCamera</key><false/></dict></array></dict></plist>';
  const created = f.filesystem.mutateFiles({ operations: [{ type: 'write', parentId: 'downloads', name: 'Native.mobileconfig', mime: 'application/x-apple-aspen-config', content: xml }] }, { guard: () => true });
  assert.equal(created.status, 'applied');
  const w = f.open('settings-profile', { profileFileId: created.results[0].fileId });
  await applied(w, 'authenticate', { passcode: 'scene' });
  await applied(w, 'action', { actionId: 'profile.install' });
  assert.equal(f.state.configuration.profiles.rows.length, 0);
  assert.equal(w.session().sheet.kind, 'profile.confirm');
  assert.equal((await w.run('draft', { field: 'fileId', value: 'replacement' })).error.code, 'invalid_arguments');
  await applied(w, 'action', { actionId: 'profile.confirm' });
  assert.equal(f.state.configuration.parental.allowCamera, false);
  assert.equal(validatePreferencesState(f.state, f.ctx.profile).ok, true);
  await applied(w, 'navigate', { pane: 'parental-controls' });
  assert.equal((await w.run('set', { controlId: 'parental.allowCamera', value: true })).error.code, 'managed_setting');
  await applied(w, 'navigate', { pane: 'profiles' });
  await applied(w, 'select', { controlId: 'profiles.rows', selectedId: 'com.example.scene' });
  await applied(w, 'sheet', { kind: 'profile.remove' });
  await applied(w, 'action', { actionId: 'profile.remove' });
  assert.equal(f.state.configuration.parental.allowCamera, true);
  assert.deepEqual(f.state.configuration.profiles.previousValues, []);
});

test('canonical preset credentials reject unknown users and changed passwords have no constant fallback', async () => {
  const f = fixture(), w = f.open();
  assert.equal(await preferencesAuthenticate(f.state, 'local-alex', 'scene'), true);
  assert.equal(await preferencesAuthenticate(f.state, 'local-casey', 'scene'), true);
  assert.equal(await preferencesAuthenticate(f.state, 'unknown-user', 'scene'), false);
  assert.equal(await preferencesAuthenticate(f.state, 'guest', 'scene'), false);
  await applied(w, 'navigate', { pane: 'users-groups' });
  await applied(w, 'authenticate', { passcode: 'scene' });
  await applied(w, 'sheet', { kind: 'user.password' });
  await applied(w, 'action', { actionId: 'user.password', values: { current: 'scene', next: 'authored-alternative-passcode' } });
  assert.equal(await preferencesAuthenticate(f.state, 'local-alex', 'scene'), false);
  assert.equal(await preferencesAuthenticate(f.state, 'local-alex', 'authored-alternative-passcode'), true);
  assert.equal(JSON.stringify(f.state).includes('authored-alternative-passcode'), false);
  assert.equal(w.session().unlocked, false);
});

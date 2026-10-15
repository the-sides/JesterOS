import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeState, HOME_PROFILES, homeWindow, homeStatus, validateHomeState, emptyHomeAutomation } from '../frontend/src/home-state.js';
import { createHomeCommands } from '../frontend/src/home-commands.js';
import { canonicalStringUnits } from '../frontend/src/canonical-data.js';

function fixture(profileId = HOME_PROFILES[2]) {
  const profile = { id: profileId }, state = createHomeState(profile, { sceneTime: 0 });
  const window = { id: 'home-test', appId: 'home' }, view = { available: () => true };
  const windows = new Map([[window.id, window]]), views = new Map([[window.id, view]]); let time = 0;
  const ctx = { profile, getState: () => state, alive: () => true, getWindow: id => windows.get(id), getView: id => views.get(id), available: () => true, getSceneTime: () => time, canCommit: () => true, tick: async () => {} };
  const controller = createHomeCommands(state, ctx); assert.equal(controller.windowOpened(window), true);
  const run = (name, payload = {}, id = window.id) => controller.handlers[`home.${name}`]({ windowId: id }, payload);
  return { profile, state, window, view, windows, views, ctx, controller, run, setTime: value => { time = value; }, device: id => state.accessories.find(a => a.id === id) };
}
async function automation(f, changes = {}) {
  assert.equal((await f.run('automation.edit', { automationId: null })).status, 'applied');
  assert.equal((await f.run('automation.draft', { ...emptyHomeAutomation(), minute: 1, sceneIds: ['reading'], ...changes })).status, 'applied');
  const result = await f.run('automation.save'); assert.equal(result.status, 'applied'); return f.state.automations.find(a => a.id === result.automationId);
}
for (const profileId of HOME_PROFILES) test(`lights, thermostat, locks, favorites and rooms visibly retain real local state: ${profileId}`, async () => {
  const f = fixture(profileId), original = f.device('reading-light'), array = f.state.accessories;
  assert.equal((await f.run('accessory.set', { accessoryId: original.id, values: { on: true, brightness: 43, color: 'blue' } })).status, 'applied');
  assert.equal(homeStatus(original), '43% · blue'); assert.equal(f.state.accessories, array); assert.equal(f.device(original.id), original);
  await f.run('accessory.set', { accessoryId: 'hall-thermostat', values: { target: 24, mode: 'cool' } }); assert.equal(homeStatus(f.device('hall-thermostat')), '24° · cool');
  await f.run('accessory.toggle', { accessoryId: 'front-lock' }); assert.equal(homeStatus(f.device('front-lock')), 'Unlocked');
  await f.run('accessory.settings', { accessoryId: original.id, name: 'River Lamp', roomId: 'bedroom', favorite: false });
  assert.equal(original.name, 'River Lamp'); assert.equal(original.roomId, 'bedroom'); assert.equal(original.favorite, false);
  assert.equal(validateHomeState(f.state, f.profile).ok, true);
});
test('No Response rejects all device controls but remains editable and recoverable by local owner', async () => {
  const f = fixture(), row = f.device('bedside-light'), before = structuredClone(row);
  assert.equal(homeStatus(row), 'No Response'); assert.equal((await f.run('accessory.toggle', { accessoryId: row.id })).error.code, 'device_unavailable'); assert.deepEqual(row, before);
  await f.run('local.device', { accessoryId: row.id, available: true }); await f.run('accessory.toggle', { accessoryId: row.id }); assert.equal(row.values.on, true);
  assert.equal((await f.run('accessory.set', { accessoryId: 'porch-camera', values: { on: true } })).error.code, 'unsupported_control');
});
test('scene editor is isolated until save; actual values then apply together with original identities', async () => {
  const f = fixture(), original = f.device('reading-light'), baseline = structuredClone(original.values);
  await f.run('scene.edit', { sceneId: null });
  await f.run('scene.draft', { name: 'Warm Evening', favorite: false, actions: [{ accessoryId: original.id, values: { ...baseline, on: true, brightness: 26, color: 'red' } }] });
  assert.deepEqual(original.values, baseline); const saved = await f.run('scene.save'); assert.equal(saved.status, 'applied');
  assert.equal((await f.run('scene.run', { sceneId: saved.sceneId })).status, 'applied'); assert.equal(homeStatus(original), '26% · red');
  assert.equal(f.device(original.id), original); assert.equal(homeWindow(f.state, f.window.id).sceneDraft, null);
});
test('scene transaction with an unavailable accessory applies no partial state', async () => {
  const f = fixture(), values = { ...f.device('reading-light').values, on: false };
  await f.run('scene.edit', { sceneId: null }); await f.run('scene.draft', { name: 'Both Lamps', actions: [{ accessoryId: 'reading-light', values }, { accessoryId: 'bedside-light', values: { ...values } }] });
  const saved = await f.run('scene.save'), before = structuredClone(f.state);
  assert.equal((await f.run('scene.run', { sceneId: saved.sceneId })).error.code, 'device_unavailable'); assert.deepEqual(f.state, before);
});
test('same-ID scene changed by another original window cannot overwrite a newer saved edit', async () => {
  const f = fixture(), second = { id: 'second-home', appId: 'home' }; f.windows.set(second.id, second); f.views.set(second.id, { available: () => true }); assert.equal(f.controller.windowOpened(second), true);
  await f.run('scene.edit', { sceneId: 'reading' }); await f.run('scene.edit', { sceneId: 'reading' }, second.id);
  await f.run('scene.draft', { name: 'Second Window Name' }, second.id); assert.equal((await f.run('scene.save', {}, second.id)).status, 'applied');
  await f.run('scene.draft', { name: 'Stale First Window Name' }); assert.equal((await f.run('scene.save')).error.code, 'stale_target'); assert.equal(f.state.scenes.find(s => s.id === 'reading').name, 'Second Window Name');
});
test('Done cancels unsaved scene values without modifying another saved scene', async () => {
  const f = fixture(), before = structuredClone(f.state.scenes); await f.run('scene.edit', { sceneId: 'good-night' }); await f.run('scene.draft', { name: 'Discard This Name' }); await f.run('sheet', { sheet: 'none' }); assert.deepEqual(f.state.scenes, before); assert.equal(homeWindow(f.state, f.window.id).sceneDraft, null);
});
test('authored clock triggers once at selected UTC time and turn-off expires without real timers', async () => {
  const f = fixture(); await f.run('accessory.set', { accessoryId: 'reading-light', values: { on: false } });
  const row = await automation(f, { turnOffMinutes: 2 });
  f.setTime(59000); assert.equal(f.controller.clockChanged(59000).status, 'applied'); assert.equal(f.device('reading-light').values.on, false);
  f.setTime(60000); assert.deepEqual(f.controller.clockChanged(60000).automationIds, [row.id]); assert.equal(f.device('reading-light').values.on, true); assert.equal(row.lastFiredAt, 60000); assert.equal(row.pendingOffAt, 180000);
  assert.deepEqual(f.controller.clockChanged(60000).automationIds, []);
  f.setTime(180000); assert.equal(f.controller.clockChanged(180000).status, 'applied'); assert.equal(f.device('reading-light').values.on, false); assert.equal(row.pendingOffAt, null);
});
test('disabled, absent hub, selected weekdays and presence conditions govern scheduled actions', async () => {
  const f = fixture(); await f.run('accessory.set', { accessoryId: 'reading-light', values: { on: false } }); const row = await automation(f, { days: [4], presence: 'away' });
  f.setTime(60000); assert.equal(f.controller.clockChanged(60000).automationIds.length, 0);
  await f.run('local.presence', { home: false }); await f.run('local.hub', { available: false }); f.setTime(86460000); f.controller.clockChanged(86460000); assert.equal(f.device('reading-light').values.on, false);
  await f.run('local.hub', { available: true }); f.setTime(7*86400000+60000); assert.deepEqual(f.controller.clockChanged(7*86400000+60000).automationIds, [row.id]);
  await f.run('automation.enabled', { automationId: row.id, enabled: false }); await f.run('accessory.set', { accessoryId: 'reading-light', values: { on: false } }); f.setTime(14*86400000+60000); assert.equal(f.controller.clockChanged(14*86400000+60000).automationIds.length, 0); assert.equal(f.device('reading-light').values.on, false);
});
test('large authored-time jumps apply only latest eligible occurrence and expire bounded light-off ledger', async () => {
  const f = fixture(); const row = await automation(f, { turnOffMinutes: 1 }); f.setTime(100*86400000+120000); const result = f.controller.clockChanged(100*86400000+120000);
  assert.deepEqual(result.automationIds, [row.id]); assert.equal(row.lastFiredAt, 100*86400000+60000); assert.equal(row.pendingOffAt, null); assert.equal(f.device('reading-light').values.on, false);
});
test('arrival, departure, accessory and sensor events are local, explicit and nonrecursive', async () => {
  const f = fixture(); const arrive = await automation(f, { type: 'arrive', sourceId: null }); const leave = await automation(f, { type: 'leave', sourceId: null, sceneIds: ['good-night'] });
  await f.run('local.presence', { home: false }); assert.equal(leave.lastResult, 'applied'); assert.equal(f.device('reading-light').values.on, false);
  await f.run('local.presence', { home: true }); assert.equal(arrive.lastResult, 'applied'); assert.equal(f.device('reading-light').values.on, true);
  const sensor = await automation(f, { type: 'sensor', sourceId: 'hall-motion', trigger: true, sceneIds: ['good-night'] }); await f.run('local.sensor', { accessoryId: 'hall-motion', motion: true }); assert.equal(sensor.lastResult, 'applied'); assert.equal(f.device('reading-light').values.on, false);
  const control = await automation(f, { type: 'accessory', sourceId: 'ceiling-light', trigger: true }); await f.run('accessory.set', { accessoryId: 'ceiling-light', values: { on: true } }); assert.equal(control.lastResult, 'applied'); assert.equal(f.device('reading-light').values.on, true);
});
test('unattended unlocking is refused visibly without partial automation accessory writes', async () => {
  const f = fixture(); await f.run('accessory.set', { accessoryId: 'reading-light', values: { on: false } });
  const row = await automation(f, { sceneIds: ['reading'], actions: [{ accessoryId: 'front-lock', values: { ...f.device('front-lock').values, locked: false } }] });
  f.setTime(60000); f.controller.clockChanged(60000); assert.equal(row.lastResult, 'confirmation-required'); assert.equal(f.device('front-lock').values.locked, true); assert.equal(f.device('reading-light').values.on, false);
});
test('fictional invitation remains pending until explicit local acceptance, then becomes real local resident', async () => {
  const f = fixture(); const result = await f.run('invite', { name: 'Terry Moss', email: 'terry@example.test', edit: false, remote: false, cameras: 'none' }); assert.equal(result.delivery, 'local-only-not-sent');
  assert.equal(f.state.users.some(u => u.email === 'terry@example.test'), false); assert.equal(f.state.invitations[0].id, result.invitationId);
  assert.equal((await f.run('local.invitation.accept', { invitationId: result.invitationId })).status, 'applied'); assert.equal(f.state.invitations.length, 0); assert.equal(f.state.users.find(u => u.id === result.invitationId).email, 'terry@example.test');
  const before = structuredClone(f.state); assert.equal((await f.run('invite', { name: 'Duplicate', email: 'TERRY@example.test', edit: false, remote: false, cameras: 'none' })).status, 'rejected'); assert.deepEqual(f.state, before);
});
test('resident may control devices but cannot edit settings, scenes, users or hub; local actor can return to owner', async () => {
  const f = fixture(); await f.run('local.user', { userId: 'resident' }); assert.equal((await f.run('accessory.toggle', { accessoryId: 'reading-light' })).status, 'applied');
  assert.equal((await f.run('scene.edit', { sceneId: null })).error.code, 'permission_denied'); assert.equal((await f.run('local.hub', { available: false })).error.code, 'permission_denied'); assert.equal((await f.run('user.set', { userId: 'owner', values: { edit: false } })).error.code, 'permission_denied');
  await f.run('local.user', { userId: 'owner' }); assert.equal((await f.run('user.set', { userId: 'resident', values: { edit: true } })).status, 'applied'); await f.run('local.user', { userId: 'resident' }); assert.equal((await f.run('scene.edit', { sceneId: 'reading' })).status, 'applied');
});
test('removing a room moves original devices and every original native session to retained room', async () => {
  const f = fixture(), row = f.device('reading-light'); await f.run('navigate', { section: 'rooms', roomId: 'living' }); assert.equal((await f.run('room.delete', { roomId: 'living', confirm: true })).status, 'applied'); assert.equal(f.device(row.id), row); assert.equal(row.roomId, 'entry'); assert.equal(homeWindow(f.state, f.window.id).roomId, 'entry');
});
test('complete budget includes full canonical property names and array indices on invitation growth', async () => {
  const f = fixture(), beforeUnits = canonicalStringUnits(f.state); let offered;
  f.ctx.canCommit = delta => { offered = delta; return false; }; const before = structuredClone(f.state);
  assert.equal((await f.run('invite', { name: 'Terry', email: 'terry@example.test', edit: false, remote: false, cameras: 'none' })).error.code, 'scene_quota'); assert.deepEqual(f.state, before);
  const candidate = structuredClone(before); candidate.nextId++; candidate.invitations.push({ id: 'invitation-1', name: 'Terry', email: 'terry@example.test', edit: false, remote: false, cameras: 'none' }); assert.equal(offered, canonicalStringUnits(candidate) - beforeUnits);
});
test('reentrant quota callback cannot transfer ownership to an equal replacement original graph, record, window or facade', async () => {
  for (const kind of ['array', 'record', 'values', 'session', 'window', 'view']) {
    const f = fixture(), before = structuredClone(f.state);
    f.ctx.canCommit = () => { if (kind === 'array') f.state.accessories = [...f.state.accessories]; if (kind === 'record') f.state.accessories[0] = { ...f.state.accessories[0] }; if (kind === 'values') f.state.accessories[0].values = { ...f.state.accessories[0].values }; if (kind === 'session') f.state.windows[0] = { ...f.state.windows[0] }; if (kind === 'window') f.windows.set(f.window.id, { ...f.window }); if (kind === 'view') f.views.set(f.window.id, { ...f.view }); return true; };
    assert.equal((await f.run('accessory.toggle', { accessoryId: 'reading-light' })).error.code, 'stale_target'); assert.deepEqual(f.state, before);
  }
});
test('state-only clock lease rejects reentrant equal graph replacement and invalid original owner', async () => {
  const f = fixture(); await automation(f); const before = structuredClone(f.state); f.ctx.canCommit = () => { f.state.scenes = [...f.state.scenes]; return true; };
  assert.equal(f.controller.clockChanged(60000, { guard: () => true }).status, 'rejected'); assert.deepEqual(f.state, before); assert.equal(f.controller.clockChanged(60000, { guard: () => false }).status, 'rejected');
});
test('nested quota-authorized Home edit survives while outer operation rejects stale generation', async () => {
  const f = fixture(); let nested; f.ctx.canCommit = () => { f.ctx.canCommit = () => true; nested = f.run('accessory.set', { accessoryId: 'ceiling-light', values: { on: true } }); return true; };
  assert.equal((await f.run('accessory.toggle', { accessoryId: 'reading-light' })).error.code, 'stale_target'); assert.equal((await nested).status, 'applied'); assert.equal(f.device('ceiling-light').values.on, true); assert.equal(f.device('reading-light').values.on, true);
});
test('closed schemas reject getters, sparse arrays, unknown keys and incompatible accessory fields without effects', async () => {
  const f = fixture(), before = structuredClone(f.state); let getterRead = false; const getter = {}; Object.defineProperty(getter, 'accessoryId', { enumerable: true, get: () => { getterRead = true; return 'reading-light'; } });
  assert.equal((await f.run('accessory.toggle', getter)).status, 'rejected'); assert.equal(getterRead, false);
  assert.equal((await f.run('accessory.toggle', { accessoryId: 'reading-light', extra: true })).status, 'rejected'); assert.equal((await f.run('accessory.set', { accessoryId: 'reading-light', values: { locked: false } })).status, 'rejected'); assert.equal((await f.run('accessory.set', { accessoryId: 'hall-thermostat', values: { target: 100 } })).status, 'rejected'); assert.deepEqual(f.state, before);
  const corrupted = structuredClone(f.state); corrupted.accessories.length++; assert.equal(validateHomeState(corrupted, f.profile).ok, false);
});
test('closing original native windows retires sessions but authored automations keep operating state-only', async () => {
  const f = fixture(), row = await automation(f); assert.equal(f.controller.windowClosed({ ...f.window }), false); assert.equal(f.controller.windowClosed(f.window), true); f.windows.delete(f.window.id); f.views.delete(f.window.id); assert.equal(f.state.windows.length, 0);
  f.setTime(60000); assert.deepEqual(f.controller.clockChanged(60000).automationIds, [row.id]); assert.equal(row.lastResult, 'applied'); f.controller.dispose(); assert.equal(f.controller.clockChanged(120000).status, 'rejected');
});
test('successful canonical control keeps applied acknowledgement when original facade retires during DOM flush', async () => {
  const f = fixture(); f.ctx.tick = async () => { f.views.delete(f.window.id); }; const result = await f.run('accessory.toggle', { accessoryId: 'reading-light' }); assert.equal(result.status, 'applied'); assert.equal(result.presentationAvailable, false); assert.equal(f.device('reading-light').values.on, false);
});
test('Mojave native commands do not backport later camera-recording permissions', async () => {
  const f = fixture(HOME_PROFILES[1]), before = structuredClone(f.state);
  assert.equal((await f.run('invite', { name: 'Later Recording Resident', email: 'later@example.test', edit: false, remote: false, cameras: 'recordings' })).status, 'rejected');
  assert.equal((await f.run('user.set', { userId: 'resident', values: { cameras: 'recordings' } })).error.code, 'unsupported_profile');
  assert.deepEqual(f.state, before);
  assert.equal((await f.run('user.set', { userId: 'resident', values: { edit: true } })).status, 'applied');
});
test('manual scenes emit changed accessory events while resulting automation writes never recurse', async () => {
  const f = fixture(); const row = await automation(f, { type: 'accessory', sourceId: 'reading-light', trigger: false, sceneIds: ['reading'] });
  const result = await f.run('scene.run', { sceneId: 'good-night' }); assert.equal(result.status, 'applied'); assert.deepEqual(result.automationIds, [row.id]);
  assert.equal(f.device('reading-light').values.on, true); assert.equal(row.lastResult, 'applied'); assert.equal(f.device('ceiling-light').values.on, false);
});
test('removing a scene clears actual unsaved automation references rather than retaining dangling IDs', async () => {
  const f = fixture(); await f.run('automation.edit', { automationId: null }); await f.run('automation.draft', { sceneIds: ['reading'] });
  assert.equal((await f.run('scene.delete', { sceneId: 'reading', confirm: true })).status, 'applied'); assert.deepEqual(homeWindow(f.state, f.window.id).automationDraft.sceneIds, []);
  assert.equal(validateHomeState(f.state, f.profile).ok, true);
});
test('authored time cannot rewind or use invalid instants to reset automation firing ledgers', async () => {
  const f = fixture(), row = await automation(f); f.setTime(60000); f.controller.clockChanged(60000); const before = structuredClone(f.state);
  assert.equal(f.controller.clockChanged(59999).status, 'rejected'); assert.equal(f.controller.clockChanged(NaN).status, 'rejected'); assert.equal(f.controller.clockChanged('not-a-time').status, 'rejected');
  assert.deepEqual(f.state, before); assert.equal(row.lastFiredAt, 60000);
});

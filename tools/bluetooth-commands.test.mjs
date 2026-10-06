import { test, expect } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { bluetoothDefaults } from '../frontend/src/bluetooth-model.js';
import { createBluetoothCommands } from '../frontend/src/bluetooth-commands.js';
import { soundDefaults } from '../frontend/src/sound-model.js';

const device = (state, id) => state.devices.find(entry => entry.id === id);

function root(overrides = {}) {
  const profile = getOSProfile('macos-golden-gate-27.0.1');
  let state = bluetoothDefaults(), sound = soundDefaults();
  const presentation = { pair: null };
  let pin = '', focused = null;
  const controls = () => presentation.pair === null ? []
    : presentation.pair.mode === 'pin' ? ['pin', 'cancel', 'pair'] : ['cancel', 'pair'];
  const view = {
    element: () => null,
    available: control => controls().includes(control),
    controlIds: () => controls(),
    focusedControl: () => focused,
    focus: async control => { focused = control; return true; },
    draft: async () => ({ pin }),
    setDraft: async next => { pin = next.pin; return true; },
    scrollTop: () => 4,
    scrollTo: async top => top,
  };
  const controller = createBluetoothCommands({
    profile, presentation,
    getState: () => state, getSound: () => sound, getView: () => view,
    available: () => typeof overrides.available === 'function' ? overrides.available() : overrides.available ?? true,
    canBegin: () => typeof overrides.canBegin === 'function' ? overrides.canBegin() : overrides.canBegin ?? true,
    canCommit: overrides.canCommit ?? (() => true),
    capture: () => null,
    restore: async () => {},
    settle: async () => {},
    notifySound: () => {},
    retireMenu: async () => {},
  });
  return { profile, controller, presentation, view,
    state: () => state, sound: () => sound, swap: (nextBt, nextSound) => { state = nextBt; sound = nextSound; },
    get pin() { return pin; }, get focused() { return focused; },
    get pair() { return presentation.pair; },
    run: (name, target = {}, payload = {}) => controller.handlers[name](target, payload) };
}

test('power off clears connections, detaches linked routes and atomically falls back selected routes', async () => {
  const scene = root();
  expect(scene.run('bluetooth.device.connect', { deviceId: 'number-pad' }).error.code).toBe('disabled');
  const begun = await scene.run('bluetooth.pair.begin', { deviceId: 'trail-headphones' });
  expect(scene.pair.mode).toBe('none');
  const paired = await scene.run('bluetooth.pair.submit', { pairId: begun.target.pairId }, {});
  expect(paired).toEqual({ status: 'applied', target: { pairId: begun.target.pairId, deviceId: 'trail-headphones', connected: true } });
  const exposed = scene.sound().outputs.find(route => route.id === 'bt-headphones');
  expect(exposed.available).toBe(true);
  expect(scene.sound().outputDeviceId).toBe('builtin-output');
  expect(device(scene.state(), 'trail-headphones').paired).toBe(true);
  scene.swap(scene.state(), { ...scene.sound(), outputDeviceId: 'bt-headphones' });
  const result = scene.run('bluetooth.power.set', {}, { powered: false });
  expect(result.status).toBe('applied');
  expect(result.target).toEqual({ powered: false });
  expect(scene.state().powered).toBe(false);
  expect(scene.state().devices.every(entry => !entry.connected)).toBe(true);
  expect(device(scene.state(), 'trail-headphones').paired).toBe(true);
  expect(scene.sound().outputs.find(route => route.id === 'bt-headphones').available).toBe(false);
  expect(scene.sound().outputDeviceId).toBe('builtin-output');
  // Power on stays disconnected and keeps the exposed route unavailable.
  const on = scene.run('bluetooth.power.set', {}, { powered: true });
  expect(on.target).toEqual({ powered: true });
  expect(device(scene.state(), 'trail-headphones').connected).toBe(false);
  expect(scene.sound().outputs.find(route => route.id === 'bt-headphones').available).toBe(false);
});

test('readonly canonical data and failed budgets reject before any domain write', () => {
  const scene = root();
  Object.defineProperty(device(scene.state(), 'studio-keyboard'), 'connected',
    { value: true, writable: false, enumerable: true, configurable: true });
  const result = scene.run('bluetooth.power.set', {}, { powered: false });
  expect(result.status).toBe('rejected');
  expect(result.error.code).toBe('invalid_arguments');
  expect(scene.state().powered).toBe(true);
  expect(device(scene.state(), 'offline-mouse').connected).toBe(false);
  const budgeted = root({ canCommit: () => false });
  const before = structuredClone({ bt: budgeted.state(), sound: budgeted.sound() });
  const denied = budgeted.run('bluetooth.device.disconnect', { deviceId: 'studio-keyboard' });
  expect(denied.status).toBe('rejected');
  expect(denied.error.code).toBe('limit_exceeded');
  expect(structuredClone({ bt: budgeted.state(), sound: budgeted.sound() })).toEqual(before);
});

test('wrong fictional PIN keeps the live sheet, error and draft with unchanged canonical state', async () => {
  const scene = root();
  const begun = await scene.run('bluetooth.pair.begin', { deviceId: 'number-pad' });
  expect(begun.status).toBe('applied');
  expect(scene.pair.mode).toBe('pin');
  expect(await scene.run('bluetooth.pair.draft', { pairId: scene.pair.pairId }, { pin: '111111' })).toEqual({ status: 'applied', target: { pairId: scene.pair.pairId } });
  const before = structuredClone({ bt: scene.state(), sound: scene.sound() });
  const failed = await scene.run('bluetooth.pair.submit', { pairId: scene.pair.pairId }, { pin: '111111' });
  expect(failed.status).toBe('applied');
  expect(failed.target).toEqual({ pairId: scene.pair.pairId, deviceId: 'number-pad', connected: false });
  expect(scene.pair).not.toBeNull();
  expect(scene.pin).toBe('111111');
  expect(structuredClone({ bt: scene.state(), sound: scene.sound() })).toEqual(before);
});

test('correct PIN pairs and connects atomically, closes the sheet and restores the original editor', async () => {
  const scene = root();
  const begun = await scene.run('bluetooth.pair.begin', { deviceId: 'number-pad' });
  const pairId = begun.target.pairId;
  await scene.run('bluetooth.pair.draft', { pairId }, { pin: '482316' });
  const result = await scene.run('bluetooth.pair.submit', { pairId }, { pin: '482316' });
  expect(result.status).toBe('applied');
  expect(result.target).toEqual({ pairId, deviceId: 'number-pad', connected: true });
  expect(scene.pair).toBeNull();
  expect(device(scene.state(), 'number-pad').paired).toBe(true);
  expect(device(scene.state(), 'number-pad').connected).toBe(true);
  // Discovering the now paired device in the menu no longer offers pairing again.
  const again = await scene.run('bluetooth.pair.begin', { deviceId: 'number-pad' });
  expect(again.status).toBe('rejected');
  expect(again.error.code).toBe('stale_target');
});

test('pair sheets are private to their Root lease and reject stale, foreign and cancelled IDs', async () => {
  const alex = root(), casey = root();
  const first = await alex.run('bluetooth.pair.begin', { deviceId: 'number-pad' });
  const second = await casey.run('bluetooth.pair.begin', { deviceId: 'studio-presenter' });
  expect(second.target.pairId).not.toBe(first.target.pairId);
  expect(casey.pair.mode).toBe('confirm');
  const before = structuredClone({ bt: casey.state(), sound: casey.sound() });
  for (const [name, payload] of [
    ['bluetooth.pair.submit', {}], ['bluetooth.pair.cancel', {}],
    ['bluetooth.pair.focus', { observe: true }], ['bluetooth.pair.scroll', { top: 2 }],
  ]) {
    const target = { pairId: first.target.pairId, ...(name === 'bluetooth.pair.focus' ? { control: 'pair' } : {}) };
    const result = await casey.run(name, target, payload);
    expect(result.status).toBe('rejected');
    expect(result.error.code).toBe('stale_target');
    expect(structuredClone({ bt: casey.state(), sound: casey.sound() })).toEqual(before);
  }
  const cancelledId = casey.pair.pairId;
  expect(await casey.run('bluetooth.pair.cancel', { pairId: cancelledId }))
    .toEqual({ status: 'applied', target: { pairId: cancelledId, cancelled: true } });
  expect(casey.pair).toBeNull();
  const stale = await casey.run('bluetooth.pair.cancel', { pairId: cancelledId });
  expect(stale.status).toBe('rejected');
  expect(stale.error.code).toBe('stale_target');
});

test('confirm-mode Accept connects a presenter directly and an owned sheet blocks competing operations', async () => {
  const scene = root();
  const begun = await scene.run('bluetooth.pair.begin', { deviceId: 'studio-presenter' });
  const pairId = begun.target.pairId;
  for (const [name, target, payload] of [
    ['bluetooth.power.set', {}, { powered: false }],
    ['bluetooth.device.disconnect', { deviceId: 'studio-keyboard' }, {}],
    ['bluetooth.device.configure', { deviceId: 'offline-mouse' }, { available: true, batteryPercent: 41 }],
    ['bluetooth.menu.configure', {}, { showInMenuBar: false }],
    ['bluetooth.pair.begin', { deviceId: 'trail-headphones' }, {}],
  ]) {
    const denied = await scene.run(name, target, payload);
    expect(denied.status).toBe('rejected');
    expect(denied.error.code).toBe('unavailable');
  }
  const submitted = await scene.run('bluetooth.pair.submit', { pairId }, {});
  expect(submitted.status).toBe('applied');
  expect(submitted.target).toEqual({ pairId, deviceId: 'studio-presenter', connected: true });
  expect(device(scene.state(), 'studio-presenter').paired).toBe(true);
  expect(scene.pair).toBeNull();
});

test('typed submits reconcile the real field, and sheet replaced state is rejected without mutation', async () => {
  const scene = root();
  const begun = await scene.run('bluetooth.pair.begin', { deviceId: 'number-pad' });
  const pairId = begun.target.pairId;
  await scene.run('bluetooth.pair.draft', { pairId }, { pin: '999999' });
  const result = await scene.run('bluetooth.pair.submit', { pairId }, { pin: '482316' });
  expect(result.status).toBe('applied');
  expect(result.target.connected).toBe(true);
  // A replaced Root state/Sound identity is no longer this sheet's lease.
  const other = root();
  const begun2 = await other.run('bluetooth.pair.begin', { deviceId: 'number-pad' });
  other.swap(structuredClone(other.state()));
  const stale = await other.run('bluetooth.pair.submit', { pairId: begun2.target.pairId }, { pin: '482316' });
  expect(stale.status).toBe('rejected');
  expect(stale.error.code).toBe('unavailable');
  expect(device(other.state(), 'number-pad').paired).toBe(false);
});

test('budget failures during pairing retain the sheet with a live error and connected:false', async () => {
  const scene = root({ canCommit: () => false });
  const begun = await scene.run('bluetooth.pair.begin', { deviceId: 'number-pad' });
  const pairId = begun.target.pairId;
  const before = structuredClone({ bt: scene.state(), sound: scene.sound() });
  const result = await scene.run('bluetooth.pair.submit', { pairId }, { pin: '482316' });
  expect(result.status).toBe('applied');
  expect(result.target).toEqual({ pairId, deviceId: 'number-pad', connected: false });
  expect(scene.pair).not.toBeNull();
  expect(structuredClone({ bt: scene.state(), sound: scene.sound() })).toEqual(before);
});


test('pairing at a full text budget reuses existing device and route names without charging them twice', async () => {
  const scene = root({ canCommit: delta => delta <= 0 });
  const begun = await scene.run('bluetooth.pair.begin', { deviceId: 'trail-headphones' });
  const result = await scene.run('bluetooth.pair.submit', { pairId: begun.target.pairId }, {});
  expect(result.status).toBe('applied');
  expect(result.target.connected).toBe(true);
  expect(scene.pair).toBeNull();
  expect(device(scene.state(), 'trail-headphones').paired).toBe(true);
  expect(device(scene.state(), 'trail-headphones').connected).toBe(true);
  expect(scene.sound().outputs.find(route => route.id === 'bt-headphones').available).toBe(true);
  expect(scene.sound().outputDeviceId).toBe('builtin-output');
});

test('pairing loses its foreground lease during an awaited native focus or draft without publishing a mutation', async () => {
  let foreground = true;
  const beginning = root({ available: () => foreground });
  const initial = structuredClone({ bt: beginning.state(), sound: beginning.sound() });
  beginning.view.focus = async () => { foreground = false; return true; };
  const unavailableBegin = await beginning.run('bluetooth.pair.begin', { deviceId: 'number-pad' });
  expect(unavailableBegin.status).toBe('rejected');
  expect(beginning.pair).toBeNull();
  expect({ bt: beginning.state(), sound: beginning.sound() }).toEqual(initial);

  foreground = true;
  const drafting = root({ available: () => foreground });
  const begun = await drafting.run('bluetooth.pair.begin', { deviceId: 'number-pad' });
  const beforeDraft = structuredClone({ bt: drafting.state(), sound: drafting.sound() });
  drafting.view.setDraft = async () => { foreground = false; return true; };
  const unavailableDraft = await drafting.run('bluetooth.pair.draft', { pairId: begun.target.pairId }, { pin: '482316' });
  expect(unavailableDraft.status).toBe('rejected');
  expect({ bt: drafting.state(), sound: drafting.sound() }).toEqual(beforeDraft);
});

test('a replaced canonical Root during the budget decision rejects before touching either retained domain', () => {
  let scene;
  scene = root({ canCommit: () => {
    scene.swap(structuredClone(scene.state()), structuredClone(scene.sound()));
    return true;
  } });
  const originalBluetooth = scene.state(), originalSound = scene.sound();
  const before = structuredClone({ bt: originalBluetooth, sound: originalSound });
  const result = scene.run('bluetooth.power.set', {}, { powered: false });
  expect(result.status).toBe('rejected');
  expect({ bt: scene.state(), sound: scene.sound() }).toEqual(before);
  expect({ bt: originalBluetooth, sound: originalSound }).toEqual(before);
});

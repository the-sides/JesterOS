import { test, expect } from 'bun:test';
import { bluetoothDefaults, validateBluetoothState, bluetoothSummary,
  planBluetoothPower, planBluetoothConnect, planBluetoothDisconnect, planBluetoothConfigure, planBluetoothPair } from '../frontend/src/bluetooth-model.js';
import { soundDefaults } from '../frontend/src/sound-model.js';
const device = (state, id) => state.devices.find(entry => entry.id === id);

test('descriptor-first validation rejects getters, symbols, sparse lists and exotic prototypes without reads', () => {
  const live = () => { throw new Error('read'); };
  for (const mutate of [
    state => Object.defineProperty(state, 'powered', { enumerable: true, get: live }),
    state => { state.marker = Symbol('extra'); },
    state => { state.devices[0].extra = true; },
    state => { Object.setPrototypeOf(state, { powered: true }); },
    state => { Object.setPrototypeOf(state.devices, { length: 6 }); },
    state => { state.devices[0].batteryPercent = -1; },
    state => { device(state, 'number-pad').passkey = '48231a'; },
  ]) {
    const candidate = structuredClone(bluetoothDefaults());
    mutate(candidate);
    expect(validateBluetoothState(candidate, soundDefaults()).ok).toBe(false);
  }
  const sparse = bluetoothDefaults();
  delete sparse.devices[2];
  expect(validateBluetoothState(sparse, soundDefaults()).ok).toBe(false);
  let reads = 0;
  const borrowed = bluetoothDefaults();
  const devices = borrowed.devices;
  Object.defineProperty(borrowed, 'devices', { enumerable: true, get() { reads++; return devices; } });
  expect(validateBluetoothState(borrowed, soundDefaults()).ok).toBe(false);
  expect(reads).toBe(0);
});

test('connected devices require power, availability and pairing, and passkeys match the pairing mode', () => {
  const sound = soundDefaults();
  for (const mutate of [
    state => { state.powered = false; },
    state => { device(state, 'studio-keyboard').available = false; },
    state => { device(state, 'studio-keyboard').paired = false; },
    state => { device(state, 'number-pad').pairing = 'none'; },
    state => { device(state, 'studio-presenter').passkey = null; },
    state => { device(state, 'number-pad').passkey = '48231'; },
    state => { device(state, 'number-pad').passkey = '48231a'; },
    state => { device(state, 'number-pad').passkey = '48 236'; },
    state => { device(state, 'offline-mouse').connected = true; },
    state => { device(state, 'trail-headphones').soundInputId = 'builtin-input'; },
  ]) {
    const candidate = structuredClone(bluetoothDefaults());
    mutate(candidate);
    expect(validateBluetoothState(candidate, sound).ok).toBe(false);
  }
});

test('linked Sound routes must exist, have one owner and match the device connection cue', () => {
  for (const mutate of [
    (state, sound) => { device(state, 'trail-headphones').soundOutputId = 'missing-output'; },
    (state, sound) => { sound.outputs = sound.outputs.filter(route => route.id !== 'bt-headphones'); },
    (state, sound) => { device(state, 'number-pad').soundOutputId = 'bt-headphones'; },
    (state, sound) => { device(state, 'trail-headphones').soundOutputId = 'builtin-input'; },
    (state, sound) => { sound.outputs.find(route => route.id === 'bt-headphones').available = true; },
  ]) {
    const state = structuredClone(bluetoothDefaults()), sound = structuredClone(soundDefaults());
    mutate(state, sound);
    expect(validateBluetoothState(state, sound).ok).toBe(false);
  }
});

test('planners never mutate their canonical inputs', () => {
  const state = bluetoothDefaults(), sound = soundDefaults();
  const before = structuredClone({ state, sound });
  planBluetoothPower(state, sound, false);
  planBluetoothConnect(state, sound, 'offline-mouse');
  planBluetoothDisconnect(state, sound, 'studio-keyboard');
  planBluetoothConfigure(state, sound, 'number-pad', { available: false });
  planBluetoothPair(state, sound, 'trail-headphones');
  expect(structuredClone({ state, sound })).toEqual(before);
});

test('powering off clears connections, detaches linked routes and falls back selected routes atomically', () => {
  const state = bluetoothDefaults(), sound = soundDefaults();
  const connected = planBluetoothPair(state, sound, 'trail-headphones');
  expect(connected.error).toBeUndefined();
  connected.sound.outputDeviceId = 'bt-headphones';
  expect(validateBluetoothState(connected.bt, connected.sound)).toEqual({ ok: true });
  const poweredOff = planBluetoothPower(connected.bt, connected.sound, false);
  expect(poweredOff.error).toBeUndefined();
  expect(poweredOff.bt.powered).toBe(false);
  expect(poweredOff.bt.devices.every(entry => !entry.connected)).toBe(true);
  expect(poweredOff.sound.outputs.find(route => route.id === 'bt-headphones').available).toBe(false);
  expect(poweredOff.sound.outputDeviceId).toBe('builtin-output');
  expect(validateBluetoothState(poweredOff.bt, poweredOff.sound)).toEqual({ ok: true });
});

test('powering on never reconnects or exposes routes', () => {
  const state = structuredClone(bluetoothDefaults());
  state.powered = false;
  device(state, 'studio-keyboard').connected = false;
  const sound = soundDefaults();
  const result = planBluetoothPower(state, sound, true);
  expect(result.error).toBeUndefined();
  expect(result.bt.powered).toBe(true);
  expect(result.bt.devices.every(entry => !entry.connected)).toBe(true);
  expect(result.sound.outputs.find(route => route.id === 'bt-headphones').available).toBe(false);
  expect(result.sound.outputDeviceId).toBe('builtin-output');
  expect(validateBluetoothState(result.bt, result.sound)).toEqual({ ok: true });
});

test('losing the only available unlinked Sound output rejects the whole transition without writes', () => {
  const state = structuredClone(bluetoothDefaults()), sound = structuredClone(soundDefaults());
  sound.outputDeviceId = 'headphones';
  const connected = planBluetoothPair(state, sound, 'trail-headphones');
  expect(connected.error).toBeUndefined();
  connected.sound.outputDeviceId = 'bt-headphones';
  for (const route of connected.sound.outputs) if (route.id !== 'bt-headphones') route.available = false;
  const before = structuredClone({ bt: connected.bt, sound: connected.sound });
  const result = planBluetoothDisconnect(connected.bt, connected.sound, 'trail-headphones');
  expect(result.error.status).toBe('rejected');
  expect(result.error.error.code).toBe('unavailable');
  expect(structuredClone({ bt: connected.bt, sound: connected.sound })).toEqual(before);
});

test('connecting exposes linked routes without selecting them; configure keeps per-route levels', () => {
  const state = structuredClone(bluetoothDefaults()), sound = structuredClone(soundDefaults());
  const route = sound.outputs.find(entry => entry.id === 'bt-headphones');
  route.volume = 64;
  device(state, 'trail-headphones').paired = true;
  const result = planBluetoothConnect(state, sound, 'trail-headphones');
  expect(result.error).toBeUndefined();
  const exposed = result.sound.outputs.find(entry => entry.id === 'bt-headphones');
  expect(exposed.available).toBe(true);
  expect(exposed.volume).toBe(64);
  expect(result.sound.outputDeviceId).toBe('builtin-output');
  expect(validateBluetoothState(result.bt, result.sound)).toEqual({ ok: true });
});

test('making a connected device unavailable disconnects it atomically with route fallback', () => {
  const state = structuredClone(bluetoothDefaults()), sound = structuredClone(soundDefaults());
  const connected = planBluetoothPair(state, sound, 'trail-headphones');
  connected.sound.outputDeviceId = 'bt-headphones';
  const configured = planBluetoothConfigure(connected.bt, connected.sound, 'trail-headphones', { available: false, batteryPercent: null });
  expect(configured.error).toBeUndefined();
  expect(configured.bt.devices.find(entry => entry.id === 'trail-headphones').connected).toBe(false);
  expect(configured.bt.devices.find(entry => entry.id === 'trail-headphones').paired).toBe(true);
  expect(configured.sound.outputs.find(route => route.id === 'bt-headphones').available).toBe(false);
  expect(configured.sound.outputDeviceId).toBe('builtin-output');
  expect(validateBluetoothState(configured.bt, configured.sound)).toEqual({ ok: true });
});

test('pairing succeeds only for available unpaired devices and connects with exposed routes', () => {
  const state = structuredClone(bluetoothDefaults()), sound = structuredClone(soundDefaults());
  expect(planBluetoothPair(state, sound, 'studio-keyboard').error.status).toBe('rejected');
  expect(planBluetoothPair(state, sound, 'offline-mouse').error.error.code).toBe('disabled');
  const result = planBluetoothPair(state, sound, 'number-pad');
  expect(result.error).toBeUndefined();
  const paired = result.bt.devices.find(entry => entry.id === 'number-pad');
  expect(paired.paired).toBe(true);
  expect(paired.connected).toBe(true);
  expect(validateBluetoothState(result.bt, result.sound)).toEqual({ ok: true });
});

test('summary inspection cannot expose pairing codes or alias canonical device records', () => {
  const state = bluetoothDefaults(), sound = soundDefaults();
  const summary = bluetoothSummary(state, sound);
  expect(summary.devices.every(entry => !Object.hasOwn(entry, 'passkey'))).toBe(true);
  const before = structuredClone(state);
  summary.devices[0].name = 'Changed by a description consumer';
  summary.devices[0].connected = false;
  summary.devices.splice(1, 1);
  expect(state).toEqual(before);
  expect(() => bluetoothSummary(structuredClone(state), { ...sound, outputs: [] })).toThrow(TypeError);
  expect(validateBluetoothState({ ...state, marker: true }, sound).ok).toBe(false);
});

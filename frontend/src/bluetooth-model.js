import { object, flag, choice } from './command-schema.js';
import { isRecord, rejected } from './feature-commands.js';
import { validateSoundState } from './sound-model.js';

// system.bluetooth is a closed canonical shape validated descriptor-first before every
// state or Sound domain transition; cues never touch host Bluetooth hardware.
const forbiddenIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const identity = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...forbiddenIds] } };
const deviceName = { type: 'string', minLength: 1, maxLength: 256, pattern: '^(?=[\\s\\S]*\\S)(?![\\s\\S]*[\\r\\n])[\\s\\S]+$' };
const percent = { type: 'integer', minimum: 0, maximum: 100 };
const nullablePercent = { anyOf: [percent, { type: 'null' }] };
const passkeySchema = { anyOf: [{ type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' }, { type: 'null' }] };
const nullableIdentity = { anyOf: [identity, { type: 'null' }] };
const deviceSchema = object({ id: identity, name: deviceName,
  kind: choice('keyboard', 'mouse', 'trackpad', 'headphones', 'headset', 'speaker', 'other'),
  available: flag, paired: flag, connected: flag, batteryPercent: nullablePercent,
  pairing: choice('none', 'confirm', 'pin'), passkey: passkeySchema,
  soundOutputId: nullableIdentity, soundInputId: nullableIdentity });
export const bluetoothSchema = object({ powered: flag, showInMenuBar: flag,
  devices: { type: 'array', minItems: 0, maxItems: 128, items: deviceSchema } });

const stateKeys = Object.keys(bluetoothSchema.properties);
const deviceKeys = Object.keys(deviceSchema.properties);
const closedData = (value, keys) => isRecord(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
const validIdentity = value => typeof value === 'string' && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !forbiddenIds.has(value);
const validName = value => typeof value === 'string' && value.length > 0 && value.length <= 256
  && /\S/u.test(value) && !/[\r\n]/u.test(value);
const validPasskey = value => typeof value === 'string' && value.length === 6 && /^[0-9]{6}$/.test(value);
const validPercent = value => Number.isInteger(value) && value >= 0 && value <= 100;
const invalid = message => rejected('invalid_arguments', message);
const validationFailure = () => ({ ok: false, message: 'Bluetooth requires closed fictional device records, distinct literal bounded names and safe IDs, exact pairing cues, a passkey only while pairing expects one, connected only while powered/available/paired, and each linked Sound route owned by exactly one device.' });
const invalidSound = () => ({ ok: false, message: 'Bluetooth routes require a closed canonical fictional Sound domain.' });
const kinds = ['keyboard', 'mouse', 'trackpad', 'headphones', 'headset', 'speaker', 'other'];
// Every non-null Sound reference is a real link: it must exist, be owned by exactly
// one device and match that device's connection cue. Keyboards/mice default to null.
const routeKeysOf = device => ['soundOutputId', 'soundInputId'].filter(key => typeof device[key] === 'string');

// Authored fixture devices with deterministic fictional pairing cues, never host hardware.
export function bluetoothDefaults() {
  return { powered: true, showInMenuBar: true, devices: [
    { id: 'studio-keyboard', name: 'Studio Keyboard', kind: 'keyboard', available: true, paired: true, connected: true,
      batteryPercent: 92, pairing: 'pin', passkey: '482316', soundOutputId: null, soundInputId: null },
    { id: 'studio-trackpad', name: 'Studio Trackpad', kind: 'trackpad', available: true, paired: true, connected: false,
      batteryPercent: 67, pairing: 'none', passkey: null, soundOutputId: null, soundInputId: null },
    { id: 'offline-mouse', name: 'Travel Mouse', kind: 'mouse', available: false, paired: true, connected: false,
      batteryPercent: 40, pairing: 'none', passkey: null, soundOutputId: null, soundInputId: null },
    { id: 'number-pad', name: 'Number Pad', kind: 'keyboard', available: true, paired: false, connected: false,
      batteryPercent: 85, pairing: 'pin', passkey: '482316', soundOutputId: null, soundInputId: null },
    { id: 'studio-presenter', name: 'Studio Presenter', kind: 'other', available: true, paired: false, connected: false,
      batteryPercent: 63, pairing: 'confirm', passkey: '731204', soundOutputId: null, soundInputId: null },
    { id: 'trail-headphones', name: 'Trail Headphones', kind: 'headphones', available: true, paired: false, connected: false,
      batteryPercent: 78, pairing: 'none', passkey: null, soundOutputId: 'bt-headphones', soundInputId: null },
  ] };
}

function validDevices(entries) {
  if (!Array.isArray(entries) || Object.getPrototypeOf(entries) !== Array.prototype
    || entries.length > 128 || Reflect.ownKeys(entries).length !== entries.length + 1) return false;
  const ids = new Set();
  for (let index = 0; index < entries.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(entries, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    const device = descriptor.value;
    if (!closedData(device, deviceKeys) || !validIdentity(device.id) || ids.has(device.id) || !validName(device.name)
      || !kinds.includes(device.kind) || typeof device.available !== 'boolean'
      || typeof device.paired !== 'boolean' || typeof device.connected !== 'boolean'
      || !(device.batteryPercent === null || validPercent(device.batteryPercent))
      || !['none', 'confirm', 'pin'].includes(device.pairing)
      || !(device.pairing === 'none' ? device.passkey === null : validPasskey(device.passkey))
      || !(device.soundOutputId === null || validIdentity(device.soundOutputId))
      || !(device.soundInputId === null || validIdentity(device.soundInputId))) return false;
    ids.add(device.id);
  }
  return true;
}

/** Canonical Bluetooth plus exact Sound cross-reference validation; no host Bluetooth access. */
export function validateBluetoothState(state, sound) {
  try {
    if (!closedData(state, stateKeys) || typeof state.powered !== 'boolean' || typeof state.showInMenuBar !== 'boolean'
      || !validDevices(state.devices)) return validationFailure();
    for (const device of state.devices) {
      if (device.connected && !(state.powered && device.available && device.paired)) return validationFailure();
      if (device.soundOutputId !== null && device.soundOutputId === device.soundInputId) return validationFailure();
    }
    if (sound === undefined) return { ok: true };
    if (!isRecord(sound) || !validateSoundState(sound).ok) return invalidSound();
    // Each referenced route belongs to exactly one device and matches its connected cue.
    const owners = new Map();
    for (const device of state.devices)
      for (const key of routeKeysOf(device)) {
        const routeId = device[key];
        if (routeId === null) continue;
        const token = `${key}:${routeId}`;
        if (owners.has(token)) return validationFailure();
        owners.set(token, device);
      }
    for (const [token, device] of owners) {
      const separator = token.indexOf(':');
      const key = token.slice(0, separator), routeId = token.slice(separator + 1);
      const routes = key === 'soundOutputId' ? sound.outputs : sound.inputs;
      const route = routes.find(entry => entry.id === routeId);
      if (!route || route.available !== device.connected) return validationFailure();
    }
    return { ok: true };
  } catch { return validationFailure(); }
}

export function bluetoothSummary(state, sound) {
  const validation = validateBluetoothState(state, sound);
  if (!validation.ok) throw new TypeError(validation.message);
  return { powered: state.powered, showInMenuBar: state.showInMenuBar,
    connectedCount: state.devices.filter(device => device.connected).length,
    devices: state.devices.map(({ passkey, ...device }) => device) };
}

const planState = state => ({ ...state, devices: state.devices.map(device => ({ ...device })) });
const planSound = sound => ({ ...sound, outputs: sound.outputs.map(route => ({ ...route })),
  inputs: sound.inputs.map(route => ({ ...route })), appVolumes: { ...sound.appVolumes } });
const linkedRouteIds = devices => {
  const ids = new Set();
  for (const device of devices) for (const key of routeKeysOf(device)) if (device[key] !== null) ids.add(device[key]);
  return ids;
};

// A selected route that just became unavailable falls back to the first available
// unlinked route; no fallback means the whole transition rejects before any write.
function selectFallback(soundPlan, linkedIds, direction) {
  const key = direction === 'output' ? 'outputDeviceId' : 'inputDeviceId';
  const routes = direction === 'output' ? soundPlan.outputs : soundPlan.inputs;
  const selected = routes.find(route => route.id === soundPlan[key]);
  if (selected && selected.available) return null;
  const candidate = routes.find(route => route.available && !linkedIds.has(route.id));
  if (!candidate) return rejected('unavailable', `Losing this fictional device would leave no available unlinked Sound ${direction}.`);
  soundPlan[key] = candidate.id;
  return null;
}

function detachRoutes(btPlan, soundPlan, devices) {
  const linkedIds = linkedRouteIds(btPlan.devices);
  for (const device of devices)
    for (const key of routeKeysOf(device)) {
      const routeId = device[key];
      if (routeId === null) continue;
      const routes = key === 'soundOutputId' ? soundPlan.outputs : soundPlan.inputs;
      const route = routes.find(entry => entry.id === routeId);
      if (route) route.available = false;
    }
  return selectFallback(soundPlan, linkedIds, 'output') ?? selectFallback(soundPlan, linkedIds, 'input');
}

const checked = (btPlan, soundPlan) => validateBluetoothState(btPlan, soundPlan).ok
  && validateSoundState(soundPlan).ok ? null : invalid(validationFailure().message);
const findDevice = (state, deviceId) => state.devices.find(device => device.id === deviceId);
const staleDevice = () => rejected('stale_target', 'The fictional device is no longer present.');
const planResult = (btPlan, soundPlan, error = null) => error ? { error } : { bt: btPlan, sound: soundPlan };

export function planBluetoothPower(state, sound, powered) {
  const validation = validateBluetoothState(state, sound);
  if (!validation.ok) return { error: invalid(validation.message) };
  if (typeof powered !== 'boolean') return { error: invalid('Use an exact boolean Bluetooth power value.') };
  const btPlan = planState(state);
  btPlan.powered = powered;
  if (powered) return planResult(btPlan, sound, checked(btPlan, sound));
  // Off clears every connection and detaches linked routes atomically; pairing is retained.
  const affected = btPlan.devices.filter(device => device.connected);
  for (const device of affected) device.connected = false;
  const soundPlan = planSound(sound);
  return planResult(btPlan, soundPlan, detachRoutes(btPlan, soundPlan, affected) ?? checked(btPlan, soundPlan));
}

export function planBluetoothConnect(state, sound, deviceId) {
  const validation = validateBluetoothState(state, sound);
  if (!validation.ok) return { error: invalid(validation.message) };
  const device = findDevice(state, deviceId);
  if (!device) return { error: staleDevice() };
  if (!state.powered || !device.available || !device.paired)
    return { error: rejected('disabled', 'Paired devices connect only while Bluetooth is powered and the fictional device is available.') };
  const btPlan = planState(state), soundPlan = planSound(sound);
  const planDevice = findDevice(btPlan, deviceId);
  planDevice.connected = true;
  for (const key of routeKeysOf(planDevice)) {
    const routeId = planDevice[key];
    if (routeId === null) continue;
    const routes = key === 'soundOutputId' ? soundPlan.outputs : soundPlan.inputs;
    const route = routes.find(entry => entry.id === routeId);
    if (route) route.available = true;
  }
  return planResult(btPlan, soundPlan, checked(btPlan, soundPlan));
}

export function planBluetoothDisconnect(state, sound, deviceId) {
  const validation = validateBluetoothState(state, sound);
  if (!validation.ok) return { error: invalid(validation.message) };
  const device = findDevice(state, deviceId);
  if (!device) return { error: staleDevice() };
  const btPlan = planState(state);
  const planDevice = findDevice(btPlan, deviceId);
  if (!planDevice.connected) return planResult(btPlan, sound, checked(btPlan, sound));
  planDevice.connected = false;
  const soundPlan = planSound(sound);
  return planResult(btPlan, soundPlan, detachRoutes(btPlan, soundPlan, [planDevice]) ?? checked(btPlan, soundPlan));
}

export function planBluetoothConfigure(state, sound, deviceId, payload) {
  const validation = validateBluetoothState(state, sound);
  if (!validation.ok) return { error: invalid(validation.message) };
  const device = findDevice(state, deviceId);
  if (!device) return { error: staleDevice() };
  const btPlan = planState(state);
  const planDevice = findDevice(btPlan, deviceId);
  if (Object.hasOwn(payload, 'available')) planDevice.available = payload.available;
  if (Object.hasOwn(payload, 'batteryPercent')) planDevice.batteryPercent = payload.batteryPercent;
  if (planDevice.connected && !planDevice.available) {
    planDevice.connected = false;
    const soundPlan = planSound(sound);
    return planResult(btPlan, soundPlan, detachRoutes(btPlan, soundPlan, [planDevice]) ?? checked(btPlan, soundPlan));
  }
  return planResult(btPlan, sound, checked(btPlan, sound));
}

export function planBluetoothMenu(state, sound, showInMenuBar) {
  const validation = validateBluetoothState(state, sound);
  if (!validation.ok) return { error: invalid(validation.message) };
  const btPlan = planState(state);
  btPlan.showInMenuBar = showInMenuBar;
  return planResult(btPlan, sound, checked(btPlan, sound));
}

export function planBluetoothPair(state, sound, deviceId) {
  const validation = validateBluetoothState(state, sound);
  if (!validation.ok) return { error: invalid(validation.message) };
  const device = findDevice(state, deviceId);
  if (!device) return { error: staleDevice() };
  if (!state.powered || !device.available || device.paired)
    return { error: rejected('disabled', 'Pairing needs Bluetooth power and an available unpaired fictional device.') };
  const btPlan = planState(state), soundPlan = planSound(sound);
  const planDevice = findDevice(btPlan, deviceId);
  planDevice.paired = true;
  planDevice.connected = true;
  for (const key of routeKeysOf(planDevice)) {
    const routeId = planDevice[key];
    if (routeId === null) continue;
    const routes = key === 'soundOutputId' ? soundPlan.outputs : soundPlan.inputs;
    const route = routes.find(entry => entry.id === routeId);
    if (route) route.available = true;
  }
  return planResult(btPlan, soundPlan, checked(btPlan, soundPlan));
}

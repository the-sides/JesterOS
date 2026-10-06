import { object, flag, choice } from './command-schema.js';
import { isRecord } from './feature-commands.js';

const forbiddenIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const identity = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...forbiddenIds] } };
const percent = { type: 'integer', minimum: 0, maximum: 100 };
const name = { type: 'string', minLength: 1, maxLength: 256, pattern: '^(?=[\\s\\S]*\\S)(?![\\s\\S]*[\\r\\n])[\\s\\S]+$' };
const outputKeys = ['id', 'name', 'kind', 'available', 'adjustable', 'volume', 'muted'];
const inputKeys = ['id', 'name', 'kind', 'available', 'adjustable', 'gain', 'level'];
export const soundSchema = object({ outputDeviceId: identity, inputDeviceId: identity,
  outputs: { type: 'array', minItems: 1, maxItems: 128, items: object({ id: identity, name,
    kind: choice('built-in', 'headphones', 'usb', 'display'), available: flag, adjustable: flag, volume: percent, muted: flag }) },
  inputs: { type: 'array', minItems: 1, maxItems: 128, items: object({ id: identity, name,
    kind: choice('built-in', 'headset', 'usb'), available: flag, adjustable: flag, gain: percent, level: percent }) },
  showInMenuBar: flag, showWhen: choice('always', 'when-active'), appVolumes: object({ music: percent, quicktime: percent }) });
const stateKeys = Object.keys(soundSchema.properties);
const closedData = (value, keys) => isRecord(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
const validIdentity = value => typeof value === 'string' && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !forbiddenIds.has(value);
const validName = value => typeof value === 'string' && value.length > 0 && value.length <= 256
  && /\S/u.test(value) && !/[\r\n]/u.test(value);
const boundedPercent = value => Number.isInteger(value) && value >= 0 && value <= 100;
const validAppVolumes = value => closedData(value, ['music', 'quicktime'])
  && boundedPercent(value.music) && boundedPercent(value.quicktime);
function validDevices(entries, output) {
  if (!Array.isArray(entries) || Object.getPrototypeOf(entries) !== Array.prototype || entries.length < 1
    || entries.length > 128 || Reflect.ownKeys(entries).length !== entries.length + 1) return false;
  const ids = new Set(), keys = output ? outputKeys : inputKeys;
  for (let index = 0; index < entries.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(entries, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    const device = descriptor.value;
    if (!closedData(device, keys) || !validIdentity(device.id) || ids.has(device.id) || !validName(device.name)
      || !(output ? ['built-in', 'headphones', 'usb', 'display'] : ['built-in', 'headset', 'usb']).includes(device.kind)
      || typeof device.available !== 'boolean' || typeof device.adjustable !== 'boolean'
      || (output ? !boundedPercent(device.volume) || typeof device.muted !== 'boolean'
        || (!device.adjustable && (device.volume !== 100 || device.muted))
        : !boundedPercent(device.gain) || !boundedPercent(device.level) || (!device.adjustable && device.gain !== 100))) return false;
    ids.add(device.id);
  }
  return true;
}
const failure = () => ({ ok: false, message: 'Sound requires closed literal preferences, distinct bounded fictional devices, available selected routes, fixed nonadjustable controls and bounded per-app gains.' });

// Authored routes and meter fixtures only: never enumerate or configure host hardware.
export function soundDefaults() {
  return { outputDeviceId: 'builtin-output', inputDeviceId: 'builtin-input', outputs: [
    { id: 'builtin-output', name: 'MacBook Air Speakers', kind: 'built-in', available: true, adjustable: true, volume: 50, muted: false },
    { id: 'headphones', name: 'Studio Headphones', kind: 'headphones', available: true, adjustable: true, volume: 35, muted: false },
    { id: 'studio-display', name: 'Studio Display', kind: 'display', available: true, adjustable: false, volume: 100, muted: false },
  ], inputs: [
    { id: 'builtin-input', name: 'MacBook Air Microphone', kind: 'built-in', available: true, adjustable: true, gain: 50, level: 35 },
    { id: 'studio-mic', name: 'Studio Microphone', kind: 'usb', available: true, adjustable: true, gain: 70, level: 45 },
    { id: 'offline-mic', name: 'Offline Microphone', kind: 'usb', available: false, adjustable: true, gain: 50, level: 0 },
  ], showInMenuBar: true, showWhen: 'always', appVolumes: { music: 80, quicktime: 80 } };
}
export function validateSoundState(state) {
  try {
    if (!closedData(state, stateKeys) || !validIdentity(state.outputDeviceId) || !validIdentity(state.inputDeviceId)
      || !validDevices(state.outputs, true) || !validDevices(state.inputs, false)
      || typeof state.showInMenuBar !== 'boolean' || !['always', 'when-active'].includes(state.showWhen)
      || !validAppVolumes(state.appVolumes)
      || !state.outputs.some(device => device.id === state.outputDeviceId && device.available)
      || !state.inputs.some(device => device.id === state.inputDeviceId && device.available)) return failure();
    return { ok: true };
  } catch { return failure(); }
}
export function soundSummary(state) {
  const validation = validateSoundState(state);
  if (!validation.ok) throw new TypeError(validation.message);
  const outputs = state.outputs.map(device => ({ ...device })), inputs = state.inputs.map(device => ({ ...device }));
  const output = { ...outputs.find(device => device.id === state.outputDeviceId) }, input = { ...inputs.find(device => device.id === state.inputDeviceId) };
  return { outputDeviceId: state.outputDeviceId, inputDeviceId: state.inputDeviceId,
    outputName: output.name, inputName: input.name, outputs, inputs, output, input,
    showInMenuBar: state.showInMenuBar, showWhen: state.showWhen, volume: output.volume, muted: output.muted,
    effectiveMuted: output.muted || output.volume === 0, adjustable: output.adjustable,
    inputGain: input.gain, inputLevel: Math.round(input.level * input.gain / 100), appVolumes: { ...state.appVolumes } };
}
export function soundGain(state, appId) {
  // Canonical state and the detached native summary share these exact gain fields.
  try {
    if (!isRecord(state) || !['outputDeviceId', 'outputs', 'appVolumes'].every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(state, key);
      return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
    }) || !validIdentity(state.outputDeviceId) || !validDevices(state.outputs, true)
      || !validAppVolumes(state.appVolumes) || !['music', 'quicktime'].includes(appId)) throw new TypeError();
    const output = state.outputs.find(device => device.id === state.outputDeviceId && device.available);
    if (!output) throw new TypeError();
    return output.muted ? 0 : output.volume / 100 * state.appVolumes[appId] / 100;
  } catch { throw new TypeError('Sound gain requires an available selected authored output and a literal Music or QuickTime volume.'); }
}

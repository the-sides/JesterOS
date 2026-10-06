import { expect, test } from 'bun:test';
import { soundDefaults, validateSoundState, soundSummary, soundGain } from '../frontend/src/sound-model.js';
import { createSoundCommands } from '../frontend/src/sound-commands.js';
import { systemDefaults, validateSystemState } from '../frontend/src/system-state.js';
import { getOSProfile, listOSProfiles } from '../frontend/src/os-profiles.js';

const currentProfile = getOSProfile('macos-golden-gate-27.0.1');
const profile = { ...currentProfile, capabilities: [...new Set([...currentProfile.capabilities, 'status.sound'])] };
const clone = value => structuredClone(value);
function consumer(overrides = {}) {
  let state = soundDefaults(), live = true, foreground = true, media = [];
  const presentation = { inputsExpanded: false }, gains = [], retirements = [];
  const originalFocus = { windowId: 'notes-window', control: 'editor', start: 4, end: 17, direction: 'backward' };
  const context = { profile, presentation, getState: () => state, available: () => live, canBegin: () => foreground,
    canCommit: () => true, getMedia: () => media,
    notifyMedia: () => gains.push({ music: soundGain(state, 'music'), quicktime: soundGain(state, 'quicktime') }),
    getMenuReturnFocus: () => originalFocus, retireSoundMenu: async token => { retirements.push(token); },
    setSettingsTab: async () => ({ status: 'rejected', error: { code: 'unavailable', message: 'No Settings owner.' } }),
    ...overrides };
  const controller = createSoundCommands(context);
  return { controller, context, presentation, gains, retirements, originalFocus, get state() { return state; },
    replace: next => { state = next; }, live: next => { live = next; }, foreground: next => { foreground = next; },
    media: next => { media = next; }, call: (name, target = {}, payload = {}) => controller.handlers[`sound.${name}`](target, payload) };
}
async function unchanged(s, name, target = {}, payload = {}, code = 'invalid_arguments') {
  const before = clone(s.state), notifications = s.gains.length;
  const result = await s.call(name, target, payload);
  expect(result.status).toBe('rejected'); expect(result.error.code).toBe(code);
  expect(s.state).toEqual(before); expect(s.gains.length).toBe(notifications);
}

test('device selection restores each output volume and mute and each input gain without changing their peers', async () => {
  const s = consumer();
  await s.call('volume.set', {}, { volume: 24 }); await s.call('mute.set', {}, { muted: true });
  await s.call('inputGain.set', {}, { gain: 20 });
  expect(await s.call('output.set', { deviceId: 'headphones' })).toEqual({ status: 'applied', target: { outputDeviceId: 'headphones' } });
  await s.call('volume.set', {}, { volume: 76 });
  await s.call('input.set', { deviceId: 'studio-mic' }); await s.call('inputGain.set', {}, { gain: 90 });
  await s.call('inputLevel.set', { deviceId: 'builtin-input' }, { level: 81 });
  await s.call('output.set', { deviceId: 'builtin-output' }); await s.call('input.set', { deviceId: 'builtin-input' });
  expect(s.controller.summary()).toMatchObject({ volume: 24, muted: true, inputGain: 20, inputLevel: 16 });
  await s.call('output.set', { deviceId: 'headphones' }); await s.call('input.set', { deviceId: 'studio-mic' });
  expect(s.controller.summary()).toMatchObject({ volume: 76, muted: false, inputGain: 90, inputLevel: 41 });
  expect(s.state.inputs.find(input => input.id === 'builtin-input')).toMatchObject({ gain: 20, level: 81 });
});

test('missing or unavailable devices cannot be selected and supplied-device controls are honestly disabled', async () => {
  const s = consumer();
  s.state.outputs.push({ id: 'offline-output', name: 'Offline Speakers', kind: 'usb', available: false, adjustable: true, volume: 42, muted: false });
  await unchanged(s, 'input.set', { deviceId: 'offline-mic' }, {}, 'unavailable');
  await unchanged(s, 'output.set', { deviceId: 'offline-output' }, {}, 'unavailable');
  await unchanged(s, 'output.set', { deviceId: 'missing' }, {}, 'stale_target');
  await s.call('output.set', { deviceId: 'studio-display' });
  await unchanged(s, 'volume.set', {}, { volume: 25 }, 'disabled');
  await unchanged(s, 'mute.set', {}, { muted: true }, 'disabled');
  const menu = s.controller.menuProvider(true);
  expect(menu.items.find(item => item.id === 'sound-volume').enabled).toBe(false);
  expect(menu.items.find(item => item.id === 'sound-mute').enabled).toBe(false);
  expect(menu.items.find(item => item.id === 'output:offline-output').enabled).toBe(false);
  s.state.inputs.push({ id: 'fixed-input', name: 'Supplied Input', kind: 'usb', available: true, adjustable: false, gain: 100, level: 40 });
  await s.call('input.set', { deviceId: 'fixed-input' });
  await unchanged(s, 'inputGain.set', {}, { gain: 20 }, 'disabled');
  expect(s.controller.summary()).toMatchObject({ inputGain: 100, inputLevel: 40 });
});

test('app and master gain multiply, zero or mute silences every app, and unmute restores retained gains', async () => {
  const s = consumer();
  await s.call('volume.set', {}, { volume: 40 });
  expect(await s.call('appVolume.set', { appId: 'music' }, { volume: 25 })).toEqual({ status: 'applied', target: { appId: 'music', volume: 25, effectiveVolume: 10 } });
  await s.call('appVolume.set', { appId: 'quicktime' }, { volume: 100 });
  expect(soundGain(s.state, 'music')).toBeCloseTo(0.1, 10);
  expect(soundGain(s.controller.summary(), 'quicktime')).toBeCloseTo(0.4, 10);
  await s.call('mute.set', {}, { muted: true });
  expect(s.gains.at(-1)).toEqual({ music: 0, quicktime: 0 });
  await s.call('mute.set', {}, { muted: false });
  expect(s.gains.at(-1)).toEqual({ music: 0.1, quicktime: 0.4 });
  await s.call('volume.set', {}, { volume: 0 });
  expect(s.controller.summary()).toMatchObject({ muted: false, effectiveMuted: true });
  expect(s.gains.at(-1)).toEqual({ music: 0, quicktime: 0 });
  const mute = () => s.controller.menuProvider(true).items.find(item => item.id === 'sound-mute');
  expect(mute().checked).toBe(false);
  await s.call('mute.set', {}, mute().request.payload);
  expect(mute().checked).toBe(true);
  expect(s.controller.summary()).toMatchObject({ volume: 0, muted: true, effectiveMuted: true });
  await s.call('mute.set', {}, mute().request.payload);
  expect(mute().checked).toBe(false);
  expect(s.controller.summary()).toMatchObject({ volume: 0, muted: false, effectiveMuted: true });
  await unchanged(s, 'appVolume.set', { appId: 'safari' }, { volume: 40 });
});

test('literal closed requests reject getters and coercion before budget or ownership callbacks', async () => {
  let reads = 0, budgets = 0, owners = 0;
  const s = consumer({ canCommit: () => { budgets++; return true; }, setSettingsTab: () => { owners++; throw Error('not an owned tab'); } });
  const coercible = { valueOf() { reads++; return 30; }, toString() { reads++; return 'headphones'; } };
  for (const [name, target, payload] of [
    ['volume.set', {}, { volume: '30' }], ['volume.set', {}, { volume: coercible }],
    ['volume.set', {}, { volume: 30.5 }], ['volume.set', {}, { volume: NaN }],
    ['volume.set', {}, { volume: Infinity }], ['volume.set', {}, { volume: -1 }],
    ['volume.set', {}, { volume: 101 }], ['volume.set', {}, { volume: 30, extra: true }],
    ['mute.set', {}, { muted: 1 }], ['mute.set', { deviceId: 'headphones' }, { muted: true }],
    ['inputGain.set', {}, { gain: null }], ['inputLevel.set', { deviceId: 'builtin-input' }, { level: 101 }],
    ['output.set', { deviceId: coercible }, {}], ['output.set', { deviceId: '__proto__' }, {}],
    ['input.set', { deviceId: 'offline-mic', extra: true }, {}],
    ['appVolume.set', { appId: 'music' }, { volume: 20, [Symbol('extra')]: true }],
    ['menu.configure', {}, {}], ['menu.configure', {}, { showWhen: 'sometimes' }],
    ['menu.configure', {}, { showInMenuBar: 'false' }], ['menu.inputs.set', {}, { expanded: 1 }],
    ['settings.tab.set', { windowId: 'settings-window' }, { tab: 'advanced' }],
    ['settings.tab.set', { windowId: '' }, { tab: 'input' }],
  ]) await unchanged(s, name, target, payload);
  for (const [name, target, key] of [['volume.set', {}, 'volume'], ['menu.configure', {}, 'showWhen'],
    ['menu.inputs.set', {}, 'expanded'], ['settings.tab.set', { windowId: 'settings-window' }, 'tab']]) {
    const payload = {};
    Object.defineProperty(payload, key, { enumerable: true, get() { reads++; return 30; } });
    await unchanged(s, name, target, payload);
  }
  const target = {};
  Object.defineProperty(target, 'deviceId', { enumerable: true, get() { reads++; return 'headphones'; } });
  await unchanged(s, 'output.set', target);
  expect(reads).toBe(0); expect(budgets).toBe(0); expect(owners).toBe(0);
});

test('complete sound validation protects saved roots from malformed, unavailable and nonliteral device inventories', async () => {
  for (const alter of [
    state => { delete state.inputDeviceId; }, state => { state.extra = true; },
    state => { state.outputDeviceId = 'missing'; }, state => { state.inputDeviceId = 'offline-mic'; },
    state => { state.outputs[0].available = false; }, state => { state.outputs[0].volume = 50.5; },
    state => { state.outputs[0].muted = 1; }, state => { state.outputs[0].kind = 'bluetooth'; },
    state => { state.outputs[2].volume = 99; }, state => { state.outputs[2].muted = true; },
    state => { state.inputs[0].adjustable = false; }, state => { state.inputs[0].level = 101; },
    state => { state.outputs[0].name = '   '; }, state => { state.inputs[0].name = 'Microphone\nSecond line'; },
    state => { state.inputs[0].name = 'x'.repeat(257); }, state => { state.outputs[0].id = 'constructor'; },
    state => { state.inputs[1].id = state.inputs[0].id; }, state => { state.inputs[0].hostCapture = false; },
    state => { state.outputs = []; }, state => { state.inputs.length = 129; },
    state => { delete state.outputs[1]; }, state => { state.inputs.extra = true; },
    state => { state.appVolumes.music = 101; },
    state => { state.appVolumes.safari = 80; }, state => { state.showInMenuBar = 1; },
  ]) {
    const s = consumer({ canCommit: () => { throw Error('invalid roots cannot request budget'); } });
    alter(s.state);
    expect(validateSoundState(s.state).ok).toBe(false);
    await unchanged(s, 'volume.set', {}, { volume: 10 });
    const system = systemDefaults(profile); system.sound = s.state;
    expect(validateSystemState(system, profile).ok).toBe(false);
  }
  // structuredClone omits symbol properties; assert this nonliteral fixture in place.
  const symbolic = consumer(), marker = Symbol('extra'), outputs = symbolic.state.outputs;
  outputs[marker] = true;
  const volume = outputs[0].volume;
  expect(validateSoundState(symbolic.state).ok).toBe(false);
  expect((await symbolic.call('volume.set', {}, { volume: 10 })).error.code).toBe('invalid_arguments');
  expect(symbolic.state.outputs).toBe(outputs);
  expect(outputs[marker]).toBe(true); expect(outputs[0].volume).toBe(volume);
  expect(symbolic.gains).toEqual([]);
  const symbolicSystem = systemDefaults(profile); symbolicSystem.sound = symbolic.state;
  expect(validateSystemState(symbolicSystem, profile).ok).toBe(false);
  let reads = 0;
  for (const alter of [
    state => Object.defineProperty(state, 'outputs', { enumerable: true, get() { reads++; return []; } }),
    state => Object.defineProperty(state.outputs, '0', { enumerable: true, get() { reads++; return {}; } }),
    state => Object.defineProperty(state.inputs[0], 'gain', { enumerable: true, get() { reads++; return 50; } }),
    state => Object.defineProperty(state.appVolumes, 'music', { enumerable: true, get() { reads++; return 80; } }),
  ]) {
    const s = consumer(); alter(s.state);
    expect(validateSoundState(s.state).ok).toBe(false);
    expect((await s.call('volume.set', {}, { volume: 20 })).error.code).toBe('invalid_arguments');
  }
  const missing = systemDefaults(profile); delete missing.sound;
  expect(validateSystemState(missing, profile).ok).toBe(false);
  const system = systemDefaults(profile);
  Object.defineProperty(system, 'sound', { enumerable: true, get() { reads++; return soundDefaults(); } });
  expect(validateSystemState(system, profile).ok).toBe(false);
  expect(reads).toBe(0);
});

test('readonly root, per-device and per-app destinations cannot partially apply or consume a budget decision', async () => {
  for (const [alter, name, target, payload] of [
    [state => Object.defineProperty(state, 'outputDeviceId', { writable: false }), 'output.set', { deviceId: 'headphones' }, {}],
    [state => Object.defineProperty(state.outputs[0], 'volume', { writable: false }), 'volume.set', {}, { volume: 20 }],
    [state => Object.defineProperty(state.outputs[0], 'muted', { writable: false }), 'mute.set', {}, { muted: true }],
    [state => Object.freeze(state.inputs[0]), 'inputGain.set', {}, { gain: 20 }],
    [state => Object.freeze(state.inputs[1]), 'inputLevel.set', { deviceId: 'studio-mic' }, { level: 20 }],
    [state => Object.freeze(state.appVolumes), 'appVolume.set', { appId: 'music' }, { volume: 20 }],
    [state => Object.defineProperty(state, 'showWhen', { writable: false }), 'menu.configure', {}, { showInMenuBar: false, showWhen: 'when-active' }],
  ]) {
    let calls = 0; const s = consumer({ canCommit: () => { calls++; return true; } }); alter(s.state);
    await unchanged(s, name, target, payload);
    expect(calls).toBe(0);
  }
  const noOp = consumer(); Object.freeze(noOp.state.outputs[0]);
  expect((await noOp.call('volume.set', {}, { volume: 50 })).status).toBe('applied');
});

test('complete-root budgets receive exact changed string deltas before writes and denied or throwing decisions preserve sound', async () => {
  const s = consumer();
  for (const [name, target, payload, delta] of [
    ['output.set', { deviceId: 'headphones' }, {}, 'headphones'.length - 'builtin-output'.length],
    ['input.set', { deviceId: 'studio-mic' }, {}, 'studio-mic'.length - 'builtin-input'.length],
    ['volume.set', {}, { volume: 20 }, 0], ['mute.set', {}, { muted: true }, 0],
    ['inputGain.set', {}, { gain: 20 }, 0], ['inputLevel.set', { deviceId: 'studio-mic' }, { level: 20 }, 0],
    ['appVolume.set', { appId: 'music' }, { volume: 20 }, 0],
    ['menu.configure', {}, { showInMenuBar: false, showWhen: 'when-active' }, 'when-active'.length - 'always'.length],
  ]) {
    const before = clone(s.state); let calls = 0;
    s.context.canCommit = actual => { calls++; expect(actual).toBe(delta); expect(s.state).toEqual(before); return false; };
    await unchanged(s, name, target, payload, 'limit_exceeded');
    expect(calls).toBe(1);
  }
  s.context.canCommit = () => { throw Error('budget unavailable'); };
  await unchanged(s, 'volume.set', {}, { volume: 20 }, 'limit_exceeded');
  s.context.canCommit = () => Promise.resolve(true);
  await unchanged(s, 'volume.set', {}, { volume: 20 }, 'limit_exceeded');
  s.context.canCommit = null;
  await unchanged(s, 'volume.set', {}, { volume: 20 });
  s.context.canCommit = () => true;
  await s.call('menu.configure', {}, { showWhen: 'when-active' });
  s.context.canCommit = delta => { expect(delta).toBe(-5); return true; };
  expect((await s.call('menu.configure', {}, { showWhen: 'always' })).status).toBe('applied');
});

test('callback changes cannot retarget a validated plan or overwrite stale root, nested or descriptor ownership', async () => {
  const s = consumer(), payload = { volume: 20 };
  s.context.canCommit = () => { payload.volume = 99; return true; };
  expect((await s.call('volume.set', {}, payload)).target.volume).toBe(20);
  for (const mutate of [
    current => { current.state.inputs[1].gain = 88; },
    current => { current.state.outputs = clone(current.state.outputs); },
    current => { Object.defineProperty(current.state.outputs[0], 'volume', { writable: false }); },
    current => { current.replace(soundDefaults()); },
  ]) {
    const current = consumer(), original = current.state;
    current.context.canCommit = () => { mutate(current); return true; };
    expect((await current.call('mute.set', {}, { muted: true })).error.code).toBe('stale_target');
    expect(original.outputs[0].muted).toBe(false); expect(current.state.outputs[0].muted).toBe(false);
    expect(current.gains).toEqual([]);
  }
  let reads = 0;
  const accessor = consumer();
  accessor.context.canCommit = () => {
    Object.defineProperty(accessor.state.inputs[0], 'gain', { enumerable: true, get() { reads++; return 50; } });
    return true;
  };
  expect((await accessor.call('volume.set', {}, { volume: 20 })).error.code).toBe('stale_target');
  expect(accessor.state.outputs[0].volume).toBe(50); expect(reads).toBe(0);
  const lost = consumer();
  lost.context.canCommit = () => { lost.foreground(false); return true; };
  await unchanged(lost, 'mute.set', {}, { muted: true }, 'unavailable');
  const duringGuard = consumer();
  duringGuard.context.canBegin = () => { duringGuard.state.appVolumes.quicktime = 10; return true; };
  expect((await duringGuard.call('volume.set', {}, { volume: 20 })).error.code).toBe('stale_target');
  expect(duringGuard.state.outputs[0].volume).toBe(50);
});

test('private input expansion never consumes saved-state budget or synchronizes media and obeys foreground ownership', async () => {
  const s = consumer({ canCommit: () => { throw Error('private presentation has no budget'); } }), before = clone(s.state);
  expect((await s.call('menu.inputs.set', {}, { expanded: true })).target).toEqual({ expanded: true });
  expect(s.controller.menuProvider(true).items.find(item => item.id === 'input:offline-mic').enabled).toBe(false);
  expect(s.controller.targets().inputsExpanded).toBe(true);
  expect(s.state).toEqual(before); expect(s.gains).toEqual([]);
  s.live(false); await unchanged(s, 'menu.inputs.set', {}, { expanded: false }, 'unavailable');
  expect(s.presentation.inputsExpanded).toBe(true);
  s.live(true); s.controller.clear();
  expect(s.controller.menuProvider(true).items.some(item => item.id === 'input-heading')).toBe(false);
  expect(s.presentation.inputsExpanded).toBe(false);
  Object.defineProperty(s.presentation, 'inputsExpanded', { writable: false });
  await unchanged(s, 'menu.inputs.set', {}, { expanded: true });
});

test('only actual active player state shows an activity-only menu and hiding retires the captured original editor token', async () => {
  const s = consumer();
  await s.call('menu.configure', {}, { showWhen: 'when-active' });
  expect(s.controller.menuProvider(true).showInMenuBar).toBe(false);
  expect(s.retirements).toEqual([s.originalFocus]);
  s.media([{ windowId: 'music-window', appId: 'music', paused: true, playing: false }]);
  await s.call('inputLevel.set', { deviceId: 'builtin-input' }, { level: 100 });
  expect(s.controller.menuProvider(true).showInMenuBar).toBe(false);
  s.media([{ windowId: 'music-window', appId: 'music', paused: false, playing: true }]);
  await s.call('mute.set', {}, { muted: true });
  expect(s.controller.menuProvider(true)).toMatchObject({ showInMenuBar: true, enabled: true });
  expect(s.controller.menuProvider(false).enabled).toBe(false);
  s.context.retireSoundMenu = async token => { s.retirements.push(token); throw Error('root disappeared after commit'); };
  expect((await s.call('menu.configure', {}, { showInMenuBar: false })).status).toBe('applied');
  expect(s.controller.menuProvider(true).showInMenuBar).toBe(false);
  expect(s.retirements.at(-1)).toBe(s.originalFocus);
  const detached = s.controller.targets(); detached.media[0].paused = true;
  detached.outputs[0].volume = 0; detached.output.volume = 0; detached.appVolumes.music = 0;
  expect(s.controller.targets().media[0].paused).toBe(false);
  expect(s.state.outputs[0].volume).toBe(50); expect(s.state.appVolumes.music).toBe(80);
});

test('canonical sound survives detached local account round trips without sharing private presentation or other roots', async () => {
  const alex = consumer(), casey = consumer(), guest = consumer(), other = clone(casey.state);
  await alex.call('output.set', { deviceId: 'headphones' }); await alex.call('volume.set', {}, { volume: 61 });
  await alex.call('mute.set', {}, { muted: true }); await alex.call('inputGain.set', {}, { gain: 73 });
  await alex.call('menu.inputs.set', {}, { expanded: true });
  const saved = systemDefaults(profile); saved.sound = clone(alex.state);
  const restored = JSON.parse(JSON.stringify(saved));
  expect(validateSystemState(restored, profile).ok).toBe(true);
  expect(soundSummary(restored.sound)).toMatchObject({ outputDeviceId: 'headphones', volume: 61, muted: true, inputGain: 73 });
  const cold = consumer(); cold.replace(restored.sound);
  expect(cold.presentation.inputsExpanded).toBe(false);
  await cold.call('volume.set', {}, { volume: 15 });
  expect(alex.controller.summary().volume).toBe(61); expect(casey.state).toEqual(other); expect(guest.state).toEqual(other);
});

test('unsupported historical profiles and unavailable foreground roots reject every sound action without side effects', async () => {
  const operations = [['output.set', { deviceId: 'headphones' }, {}], ['input.set', { deviceId: 'studio-mic' }, {}],
    ['volume.set', {}, { volume: 20 }], ['mute.set', {}, { muted: true }], ['inputGain.set', {}, { gain: 20 }],
    ['inputLevel.set', { deviceId: 'studio-mic' }, { level: 20 }], ['appVolume.set', { appId: 'music' }, { volume: 20 }],
    ['menu.configure', {}, { showInMenuBar: false }], ['menu.inputs.set', {}, { expanded: true }],
    ['settings.tab.set', { windowId: 'settings-window' }, { tab: 'input' }]];
  for (const historical of listOSProfiles().filter(entry => entry.id !== profile.id)) {
    const s = consumer({ profile: historical });
    for (const [name, target, payload] of operations) await unchanged(s, name, target, payload, 'unsupported_profile');
  }
  const s = consumer(); s.foreground(false);
  for (const [name, target, payload] of operations) await unchanged(s, name, target, payload, 'unavailable');
  expect(s.presentation.inputsExpanded).toBe(false); expect(s.retirements).toEqual([]);
});

test('media gain reads the selected device rather than convenient summary scalars and rejects malformed routes without getters', () => {
  const state = soundDefaults(), projection = soundSummary(state);
  projection.volume = 100; projection.output.volume = 100;
  expect(soundGain(projection, 'music')).toBeCloseTo(0.4, 10);
  projection.outputDeviceId = 'missing';
  expect(() => soundGain(projection, 'music')).toThrow();
  expect(() => soundGain(state, 'safari')).toThrow();
  let reads = 0;
  const getter = soundDefaults();
  Object.defineProperty(getter.outputs[0], 'muted', { enumerable: true, get() { reads++; return false; } });
  expect(() => soundGain(getter, 'music')).toThrow();
  const appGetter = soundDefaults();
  Object.defineProperty(appGetter.appVolumes, 'music', { enumerable: true, get() { reads++; return 100; } });
  expect(() => soundGain(appGetter, 'music')).toThrow();
  expect(reads).toBe(0);
});

test('a disappearing media view cannot turn an accepted canonical volume into a rejected or rolled-back mutation', async () => {
  const s = consumer({ notifyMedia: () => { throw Error('original media view was destroyed'); } });
  expect((await s.call('volume.set', {}, { volume: 30 })).target).toMatchObject({ volume: 30, effectiveVolume: 30 });
  expect(s.controller.summary().volume).toBe(30);
  expect(soundGain(s.state, 'music')).toBeCloseTo(0.24, 10);
});

import { isRecord, rejected } from './feature-commands.js';
import { soundSummary, soundGain, validateSoundState } from './sound-model.js';

const forbiddenIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const identity = value => typeof value === 'string' && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !forbiddenIds.has(value);
const windowIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const percent = value => Number.isInteger(value) && value >= 0 && value <= 100;
const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => {
    if (typeof key !== 'string' || !allowed.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  })
  && required.every(key => Object.hasOwn(value, key));
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the closed documented literal fictional Sound target and payload.');
const unavailable = () => rejected('unavailable', 'The matching foreground native Sound surface or fictional device is not available.');
const stale = () => rejected('stale_target', 'The original retained Sound state changed before this transition could commit.');
const disabled = () => rejected('disabled', 'This supplied fictional device does not expose adjustable controls.');
const descriptorSame = (a, b) => a && b && a.enumerable === b.enumerable && a.configurable === b.configurable
  && a.writable === b.writable && a.value === b.value && a.get === b.get && a.set === b.set;
const snapshot = object => ({ object, prototype: Object.getPrototypeOf(object), descriptors: Object.getOwnPropertyDescriptors(object) });
const unchanged = entry => Object.getPrototypeOf(entry.object) === entry.prototype
  && Reflect.ownKeys(entry.object).length === Reflect.ownKeys(entry.descriptors).length
  && Reflect.ownKeys(entry.descriptors).every(key => descriptorSame(Object.getOwnPropertyDescriptor(entry.object, key), entry.descriptors[key]));

/** Canonical per-device routing/gain, with only menu input expansion kept private. */
export function createSoundCommands(ctx) {
  const { presentation } = ctx;
  const summary = () => soundSummary(ctx.getState());
  const media = () => ctx.getMedia().map(entry => ({ ...entry }));
  const visible = (current, players) => current.showInMenuBar
    && (current.showWhen === 'always' || players.some(player => player.paused === false));
  const clear = () => { presentation.inputsExpanded = false; };
  function current(lease) {
    try { return ctx.getState() === lease.state && lease.snapshots.every(unchanged); }
    catch { return false; }
  }
  function allowed() {
    try { return ctx.available() === true && ctx.canBegin() === true; }
    catch { return false; }
  }
  function begin() {
    const state = ctx.getState(), validation = validateSoundState(state);
    if (!validation.ok) return { error: invalid() };
    const plan = { ...state, outputs: state.outputs.map(device => ({ ...device })),
      inputs: state.inputs.map(device => ({ ...device })), appVolumes: { ...state.appVolumes } };
    const nodes = [{ object: state, plan, keys: ['outputDeviceId', 'inputDeviceId', 'showInMenuBar', 'showWhen'] },
      { object: state.appVolumes, plan: plan.appVolumes, keys: ['music', 'quicktime'] },
      ...state.outputs.map((device, index) => ({ object: device, plan: plan.outputs[index], keys: Object.keys(device) })),
      ...state.inputs.map((device, index) => ({ object: device, plan: plan.inputs[index], keys: Object.keys(device) }))];
    const lease = { state, plan, nodes, snapshots: [...nodes.map(node => snapshot(node.object)), snapshot(state.outputs), snapshot(state.inputs)] };
    const available = allowed();
    if (!current(lease)) return { error: stale() };
    return available ? lease : { error: unavailable() };
  }
  function mutate(edit, resultTarget, beforeCommit) {
    const lease = begin(); if (lease.error) return lease.error;
    const denied = edit(lease.plan); if (denied) return denied;
    if (!validateSoundState(lease.plan).ok) return invalid();
    const changes = lease.nodes.flatMap(node => node.keys.filter(key => node.object[key] !== node.plan[key])
      .map(key => ({ object: node.object, key, previous: node.object[key], value: node.plan[key] })));
    if (changes.some(change => Object.getOwnPropertyDescriptor(change.object, change.key).writable !== true)) return invalid();
    if (typeof ctx.canCommit !== 'function') return invalid();
    if (beforeCommit) beforeCommit();
    if (!current(lease)) return stale();
    const delta = changes.reduce((total, change) => total + (typeof change.value === 'string' ? change.value.length - change.previous.length : 0), 0);
    let accepted = false;
    try { accepted = ctx.canCommit(delta) === true; } catch { /* A failed budget decision never authorizes writes. */ }
    if (!current(lease)) return stale();
    if (!accepted) return rejected('limit_exceeded', 'The Sound change exceeds the complete-scene text budget.');
    const available = allowed();
    if (!current(lease)) return stale();
    if (!available) return unavailable();
    for (const change of changes) change.object[change.key] = change.value;
    const result = applied(resultTarget(lease.plan));
    try { ctx.notifyMedia(); } catch { /* A disappeared view cannot reject an already committed canonical gain. */ }
    return result;
  }
  const output = state => state.outputs.find(device => device.id === state.outputDeviceId);
  const input = state => state.inputs.find(device => device.id === state.inputDeviceId);
  const effectiveVolume = device => device.muted ? 0 : device.volume;
  const select = (direction, deviceId) => mutate(plan => {
    const device = plan[direction === 'output' ? 'outputs' : 'inputs'].find(entry => entry.id === deviceId);
    if (!device) return rejected('stale_target', 'The requested fictional Sound device does not exist in this retained desktop.');
    if (!device.available) return unavailable();
    plan[`${direction}DeviceId`] = deviceId;
  }, plan => ({ [`${direction}DeviceId`]: plan[`${direction}DeviceId`] }));
  const handlers = {
    'sound.output.set': (target, payload) => fields(target, ['deviceId']) && identity(target.deviceId) && fields(payload, [])
      ? select('output', target.deviceId) : invalid(),
    'sound.input.set': (target, payload) => fields(target, ['deviceId']) && identity(target.deviceId) && fields(payload, [])
      ? select('input', target.deviceId) : invalid(),
    'sound.volume.set': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['volume']) || !percent(payload.volume)) return invalid();
      const volume = payload.volume;
      return mutate(plan => { const device = output(plan); if (!device.adjustable) return disabled(); device.volume = volume; },
        plan => ({ outputDeviceId: plan.outputDeviceId, volume: output(plan).volume, muted: output(plan).muted, effectiveVolume: effectiveVolume(output(plan)) }));
    },
    'sound.mute.set': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['muted']) || typeof payload.muted !== 'boolean') return invalid();
      const muted = payload.muted;
      return mutate(plan => { const device = output(plan); if (!device.adjustable) return disabled(); device.muted = muted; },
        plan => ({ outputDeviceId: plan.outputDeviceId, muted: output(plan).muted, effectiveVolume: effectiveVolume(output(plan)) }));
    },
    'sound.inputGain.set': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['gain']) || !percent(payload.gain)) return invalid();
      const gain = payload.gain;
      return mutate(plan => { const device = input(plan); if (!device.adjustable) return disabled(); device.gain = gain; },
        plan => ({ inputDeviceId: plan.inputDeviceId, gain: input(plan).gain, inputLevel: Math.round(input(plan).level * input(plan).gain / 100) }));
    },
    'sound.inputLevel.set': (target, payload) => {
      if (!fields(target, ['deviceId']) || !identity(target.deviceId) || !fields(payload, ['level']) || !percent(payload.level)) return invalid();
      const deviceId = target.deviceId, level = payload.level;
      return mutate(plan => {
        const device = plan.inputs.find(entry => entry.id === deviceId);
        if (!device) return rejected('stale_target', 'The authored input-level fixture device is no longer registered.');
        device.level = level;
      }, () => ({ deviceId, level }));
    },
    'sound.appVolume.set': (target, payload) => {
      if (!fields(target, ['appId']) || !['music', 'quicktime'].includes(target.appId)
        || !fields(payload, ['volume']) || !percent(payload.volume)) return invalid();
      const appId = target.appId, volume = payload.volume;
      return mutate(plan => { plan.appVolumes[appId] = volume; },
        plan => ({ appId, volume: plan.appVolumes[appId], effectiveVolume: soundGain(plan, appId) * 100 }));
    },
    'sound.menu.configure': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['showInMenuBar', 'showWhen'], []) || Reflect.ownKeys(payload).length === 0
        || Object.hasOwn(payload, 'showInMenuBar') && typeof payload.showInMenuBar !== 'boolean'
        || Object.hasOwn(payload, 'showWhen') && !['always', 'when-active'].includes(payload.showWhen)) return invalid();
      const changes = { ...payload }; let original;
      const result = mutate(plan => { Object.assign(plan, changes); },
        plan => ({ showInMenuBar: plan.showInMenuBar, showWhen: plan.showWhen }), () => { original = ctx.getMenuReturnFocus(); });
      if (result.status === 'applied') {
        try { if (!visible(result.target, media())) await ctx.retireSoundMenu(original); }
        catch { /* Menu/root disappearance after the canonical commit is not a rejected preference change. */ }
      }
      return result;
    },
    'sound.menu.inputs.set': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['expanded']) || typeof payload.expanded !== 'boolean') return invalid();
      const expanded = payload.expanded;
      const descriptor = Object.getOwnPropertyDescriptor(presentation, 'inputsExpanded');
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'boolean'
        || descriptor.value !== expanded && descriptor.writable !== true) return invalid();
      const lease = begin(); if (lease.error) return lease.error;
      if (!descriptorSame(descriptor, Object.getOwnPropertyDescriptor(presentation, 'inputsExpanded'))) return stale();
      if (descriptor.value !== expanded) presentation.inputsExpanded = expanded;
      return applied({ expanded });
    },
    'sound.settings.tab.set': async (target, payload) => {
      if (!fields(target, ['windowId']) || !windowIdentity(target.windowId) || !fields(payload, ['tab'])
        || !['output', 'input'].includes(payload.tab)) return invalid();
      const windowId = target.windowId, tab = payload.tab;
      const lease = begin(); if (lease.error) return lease.error;
      // The root callback owns the exact ordinary Settings window and native pane lease.
      const result = await ctx.setSettingsTab(windowId, tab);
      return result.status === 'applied' ? applied({ windowId, tab }) : result;
    },
  };
  return {
    handlers: Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (target, payload) => {
      if (ctx.profile.id !== 'macos-golden-gate-27.0.1' || !ctx.profile.capabilities.includes('status.sound'))
        return rejected('unsupported_profile', 'Only Golden Gate represents shared fictional Sound controls.');
      try {
        const result = handler(target, payload);
        return result instanceof Promise ? result.catch(() => invalid()) : result;
      } catch { return invalid(); }
    }])),
    clear, summary,
    targets() {
      return { ...summary(), media: media(), inputsExpanded: presentation.inputsExpanded,
        boundaries: { hostDevices: false, hostInputCapture: false, hostOutputRouting: false,
          inputLevel: 'authored-fictional-fixture', playbackGain: 'master-times-app',
          scope: 'retained-desktop', privateInputsExpandedSaved: false, playbackSaved: false } };
    },
    menuProvider(enabled) {
      const current = summary(), showInMenuBar = visible(current, media()), active = enabled && showInMenuBar;
      return { menuId: 'sound', kind: 'sound', label: 'Sound', ...current, showInMenuBar, enabled: active,
        inputsExpanded: presentation.inputsExpanded, items: [
          { id: 'sound-heading', heading: true, label: 'Sound', enabled: false },
          { id: 'sound-volume', type: 'sound-volume', label: 'Output volume', value: current.volume,
            min: 0, max: 100, enabled: active && current.adjustable },
          { id: 'sound-mute', label: 'Mute', checked: current.muted, enabled: active && current.adjustable, keepOpen: true,
            request: { command: 'sound.mute.set', payload: { muted: !current.muted } } },
          { id: 'output-heading', heading: true, label: 'Output', enabled: false },
          ...current.outputs.map(device => ({ id: `output:${device.id}`, label: device.name, radio: true,
            checked: device.id === current.outputDeviceId, enabled: active && device.available, keepOpen: true,
            request: { command: 'sound.output.set', target: { deviceId: device.id } } })),
          ...(presentation.inputsExpanded ? [
            { id: 'input-heading', heading: true, label: 'Input', enabled: false },
            ...current.inputs.map(device => ({ id: `input:${device.id}`, label: device.name, radio: true,
              checked: device.id === current.inputDeviceId, enabled: active && device.available, keepOpen: true,
              request: { command: 'sound.input.set', target: { deviceId: device.id } } })),
          ] : []),
          { id: 'sound-footer-separator', separator: true, enabled: false },
          { id: 'sound-settings', label: 'Sound Settings…', enabled: active,
            request: { command: 'system.settings.open', payload: { pane: 'sound' } } },
        ] };
    },
  };
}

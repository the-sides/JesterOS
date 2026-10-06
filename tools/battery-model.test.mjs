import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { batteryDefaults, validateBatteryState, batterySummary, setBatteryStatus, setBatteryEnergy,
  configureBatteryMenu, setBatteryLowPower, chargeBatteryToFull } from '../frontend/src/battery-model.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');
const status = (percent, powerSource = 'battery', charging = false, minutesToFull = null) => ({ percent, powerSource, charging, minutesToFull });
const applied = target => ({ status: 'applied', target });
const summary = (state, running = ['notes', 'messages', 'safari']) => batterySummary(state, running, profile);
function unchanged(state, operation, code = 'invalid_arguments') {
  const before = structuredClone(state), result = operation();
  expect(result.status).toBe('rejected');
  expect(result.error.code).toBe(code);
  expect(state).toEqual(before);
}
const operations = state => [
  () => setBatteryStatus(state, status(50), profile),
  () => setBatteryEnergy(state, 'notes', 80, profile),
  () => configureBatteryMenu(state, { showPercentage: true }, profile),
  () => setBatteryLowPower(state, 'always', profile),
  () => chargeBatteryToFull(state, profile),
];

test('authored source, charging, unavailable/available estimates and full states project without invented progress', () => {
  const state = batteryDefaults(profile), preferences = { showPercentage: true, showEnergyMode: 'when-low-power' };
  configureBatteryMenu(state, preferences, profile);
  const energy = structuredClone(state.energyApps);
  for (const [next, label] of [
    [status(0), 'On Battery Power'], [status(45, 'adapter'), 'Not Charging'],
    [status(45, 'adapter', true), 'Charging'], [status(45, 'adapter', true, 1), 'Charging'],
    [status(99, 'adapter', true, 2880), 'Charging'], [status(100, 'adapter'), 'Fully Charged'],
    [status(100), 'On Battery Power'],
  ]) {
    expect(setBatteryStatus(state, next, profile)).toEqual(applied(next));
    const view = summary(state);
    expect(view.statusLabel).toBe(label);
    expect(view.powerSourceLabel).toBe(next.powerSource === 'battery' ? 'Battery' : 'Power Adapter');
    expect(view.minutesToFull).toBe(next.minutesToFull);
    expect(view.charging).toBe(next.charging);
    expect(view.percent).toBe(next.percent);
    expect(view.showPercentage).toBe(true);
    expect(view.showEnergyMode).toBe('when-low-power');
    expect(state.energyApps).toEqual(energy);
    expect(validateBatteryState(state, profile)).toEqual({ ok: true });
  }
});

test('simulation low and critical thresholds depend on source and include their exact boundaries', () => {
  const state = batteryDefaults(profile);
  for (const [percent, low, critical] of [[0, true, true], [10, true, true], [11, true, false], [20, true, false], [21, false, false], [100, false, false]]) {
    setBatteryStatus(state, status(percent), profile);
    expect(summary(state).lowBattery).toBe(low);
    expect(summary(state).criticalBattery).toBe(critical);
    setBatteryStatus(state, status(percent, 'adapter'), profile);
    expect(summary(state).lowBattery).toBe(false);
    expect(summary(state).criticalBattery).toBe(false);
  }
});

test('charge limits stop normal charging, override permits authored full charging, and unplug/full clear it', () => {
  const state = batteryDefaults(profile); state.chargeLimit = 80;
  expect(setBatteryStatus(state, status(79, 'adapter', true), profile).status).toBe('applied');
  expect(summary(state).chargeToFullAvailable).toBe(true);
  unchanged(state, () => setBatteryStatus(state, status(79, 'adapter', true, 60), profile));
  unchanged(state, () => setBatteryStatus(state, status(80, 'adapter', true), profile));
  setBatteryStatus(state, status(80, 'adapter'), profile);
  expect(chargeBatteryToFull(state, profile)).toEqual(applied({ charging: true, chargeToFull: true }));
  expect(state.minutesToFull).toBeNull();
  expect(summary(state).chargeToFullAvailable).toBe(false);
  unchanged(state, () => chargeBatteryToFull(state, profile), 'disabled');
  unchanged(state, () => setBatteryStatus(state, status(90, 'adapter'), profile));
  expect(setBatteryStatus(state, status(99, 'adapter', true, 5), profile).status).toBe('applied');
  expect(setBatteryStatus(state, status(100, 'adapter'), profile)).toEqual(applied(status(100, 'adapter')));
  expect(state.chargeToFull).toBe(false);
  expect(state.chargeLimit).toBe(80);
  unchanged(state, () => chargeBatteryToFull(state, profile), 'disabled');
  setBatteryStatus(state, status(85, 'adapter'), profile);
  chargeBatteryToFull(state, profile);
  expect(setBatteryStatus(state, status(85), profile).status).toBe('applied');
  expect(state.chargeToFull).toBe(false);
  unchanged(state, () => chargeBatteryToFull(state, profile), 'disabled');
  state.chargeLimit = 100;
  setBatteryStatus(state, status(85, 'adapter'), profile);
  unchanged(state, () => chargeBatteryToFull(state, profile), 'disabled');
});

test('all Low Power policies follow the current source and energy-mode visibility is independent of percentage/visibility', () => {
  const state = batteryDefaults(profile);
  for (const source of ['battery', 'adapter']) {
    setBatteryStatus(state, status(50, source), profile);
    for (const mode of ['never', 'always', 'battery', 'adapter']) {
      const active = mode === 'always' || mode === source;
      expect(setBatteryLowPower(state, mode, profile)).toEqual(applied({ mode, active }));
      for (const showEnergyMode of ['always', 'when-low-power', 'never']) {
        expect(configureBatteryMenu(state, { showInMenuBar: false, showPercentage: true, showEnergyMode }, profile))
          .toEqual(applied({ showInMenuBar: false, showPercentage: true, showEnergyMode }));
        const view = summary(state);
        expect(view.lowPowerActive).toBe(active);
        expect(view.showLowPowerControl).toBe(showEnergyMode === 'always' || (showEnergyMode === 'when-low-power' && active));
        expect(view.showPercentage).toBe(true);
        expect(view.showInMenuBar).toBe(false);
      }
    }
  }
});

test('significant energy uses actual running IDs, retains hidden/minimized apps and authored fixtures after quit', () => {
  const state = batteryDefaults(profile);
  const runningApps = [{ appId: 'notes', hidden: true }, { appId: 'safari', minimized: true }, { appId: 'messages' }];
  expect(summary(state, runningApps.map(app => app.appId)).energyApps).toEqual([
    { appId: 'safari', name: profile.applications.safari.name, icon: profile.applications.safari.icon, impact: 48 },
    { appId: 'notes', name: profile.applications.notes.name, icon: profile.applications.notes.icon, impact: 32 },
  ]);
  expect(setBatteryEnergy(state, 'messages', 20, profile)).toEqual(applied({ appId: 'messages', impact: 20 }));
  expect(setBatteryEnergy(state, 'mail', 100, profile)).toEqual(applied({ appId: 'mail', impact: 100 }));
  expect(summary(state).energyApps.map(app => app.appId)).toEqual(['safari', 'notes', 'messages']);
  expect(summary(state, ['mail', 'notes']).energyApps.map(app => app.appId)).toEqual(['mail', 'notes']);
  expect(summary(state, new Set(['notes', 'notes'])).energyApps.map(app => app.appId)).toEqual(['notes']);
  expect(summary(state, []).energyApps).toEqual([]);
  setBatteryEnergy(state, 'notes', 19, profile);
  expect(summary(state, ['notes']).energyApps).toEqual([]);
  setBatteryEnergy(state, 'notes', 100, profile);
  setBatteryEnergy(state, 'safari', 100, profile);
  // Fixture order and caller running order cannot destabilize equal-impact rows.
  state.energyApps.reverse();
  expect(summary(state, ['notes', 'safari']).energyApps.map(app => app.appId)).toEqual(['safari', 'notes']);
  const view = summary(state, ['mail']); view.energyApps[0].impact = 0; view.energyApps.length = 0;
  expect(state.energyApps.find(app => app.appId === 'mail').impact).toBe(100);
});

test('fresh and cloned retained Battery roots never share preference or energy mutations', () => {
  const alex = batteryDefaults(profile), casey = batteryDefaults(profile), guest = batteryDefaults(profile);
  const saved = structuredClone(alex), before = structuredClone(casey);
  setBatteryEnergy(alex, 'notes', 100, profile);
  configureBatteryMenu(alex, { showInMenuBar: false, showPercentage: true }, profile);
  setBatteryLowPower(alex, 'always', profile);
  setBatteryStatus(alex, status(9), profile);
  expect(casey).toEqual(before);
  expect(saved).toEqual(before);
  expect(guest).toEqual(before);
  setBatteryEnergy(saved, 'mail', 20, profile);
  expect(alex.energyApps.some(app => app.appId === 'mail')).toBe(false);
  expect(validateBatteryState(saved, profile)).toEqual({ ok: true });
});

test('text budget sees exact enum and insertion deltas against unchanged state before any write', () => {
  const state = batteryDefaults(profile);
  for (const [operation, delta] of [
    [callback => setBatteryStatus(state, status(40, 'adapter', true), profile, callback), 0],
    [callback => configureBatteryMenu(state, { showPercentage: true, showEnergyMode: 'when-low-power' }, profile, callback), 'when-low-power'.length - 'always'.length],
    [callback => setBatteryLowPower(state, 'battery', profile, callback), 'battery'.length - 'never'.length],
    [callback => setBatteryEnergy(state, 'mail', 80, profile, callback), 'mail'.length + 'appId'.length + 'impact'.length + '3'.length],
    [callback => setBatteryEnergy(state, 'notes', 100, profile, callback), 0],
  ]) {
    const before = structuredClone(state); let calls = 0;
    unchanged(state, () => operation(value => { calls++; expect(value).toBe(delta); expect(state).toEqual(before); return false; }), 'limit_exceeded');
    expect(calls).toBe(1);
    expect(operation(value => { expect(value).toBe(delta); expect(state).toEqual(before); return true; }).status).toBe('applied');
  }
  expect(configureBatteryMenu(state, { showEnergyMode: 'never' }, profile, delta => delta === 'never'.length - 'when-low-power'.length).status).toBe('applied');
  for (const decision of [() => 1, () => 'true', () => undefined, () => Promise.resolve(true), () => { throw new Error('denied'); }]) {
    for (const operation of [
      callback => setBatteryStatus(state, status(50), profile, callback),
      callback => setBatteryEnergy(state, 'notes', 1, profile, callback),
      callback => configureBatteryMenu(state, { showInMenuBar: false }, profile, callback),
      callback => setBatteryLowPower(state, 'never', profile, callback),
    ]) unchanged(state, () => operation(decision), 'limit_exceeded');
  }
  for (const operation of [
    () => setBatteryStatus(state, status(50), profile, null),
    () => setBatteryEnergy(state, 'notes', 1, profile, false),
    () => configureBatteryMenu(state, { showInMenuBar: false }, profile, {}),
    () => setBatteryLowPower(state, 'never', profile, 1),
  ]) unchanged(state, operation);
});

test('literal, closed and coherent inputs reject before writes or budget callbacks, without coercion', () => {
  const state = batteryDefaults(profile); let reads = 0;
  const coercible = { toString() { reads++; return 'adapter'; }, valueOf() { reads++; return 50; } };
  const deniedBudget = () => { throw new Error('invalid input must not reach budget'); };
  for (const next of [null, {}, { ...status(50), extra: true }, { ...status(50), [Symbol('extra')]: true },
    status('50'), status(coercible), status(1.5), status(-1), status(101), status(NaN), status(Infinity),
    status(50, coercible), status(50, 'battery', true), status(100, 'adapter', true),
    status(50, 'adapter', 'true'), status(50, 'adapter', false, 10), status(50, 'adapter', true, 0),
    status(50, 'adapter', true, 2881), status(50, 'adapter', true, '10'),
  ]) unchanged(state, () => setBatteryStatus(state, next, profile, deniedBudget));
  for (const changes of [null, {}, { showPercentage: 1 }, { showInMenuBar: 'false' }, { showEnergyMode: 'sometimes' },
    { percent: 1 }, { showPercentage: true, lowPowerMode: 'always' }, { [Symbol('extra')]: true },
  ]) unchanged(state, () => configureBatteryMenu(state, changes, profile, deniedBudget));
  for (const mode of [null, 1, coercible, 'battery ', 'sometimes']) unchanged(state, () => setBatteryLowPower(state, mode, profile, deniedBudget));
  for (const [id, impact] of [['constructor', 50], ['__proto__', 50], ['prototype', 50], ['', 50], ['x'.repeat(129), 50],
    [coercible, 50], ['notes', coercible], ['notes', '50'], ['notes', -1], ['notes', 101], ['notes', 1.5], ['notes', NaN],
  ]) unchanged(state, () => setBatteryEnergy(state, id, impact, profile, deniedBudget));
  unchanged(state, () => setBatteryEnergy(state, 'foreign-profile-app', 50, profile, deniedBudget), 'stale_target');
  expect(reads).toBe(0);
});

test('invalid saved snapshots reject all mutations atomically, including sparse/extended arrays and inconsistent override/estimates', () => {
  for (const alter of [
    state => { delete state.percent; }, state => { state.extra = true; }, state => { state[Symbol('extra')] = true; },
    state => { state.percent = '87'; }, state => { state.powerSource = 'ac'; }, state => { state.charging = true; },
    state => { state.minutesToFull = 10; }, state => { state.chargeLimit = 79; }, state => { state.chargeLimit = 101; },
    state => { state.chargeLimit = '80'; }, state => { state.chargeLimit = 80.5; }, state => { state.chargeToFull = true; },
    state => { state.chargeToFull = 'false'; }, state => { state.showInMenuBar = 1; }, state => { state.showPercentage = 'true'; },
    state => { state.showEnergyMode = 'auto'; }, state => { state.lowPowerMode = 'on'; },
    state => { state.energyApps[0].appId = 'missing'; }, state => { state.energyApps[0].impact = '32'; },
    state => { state.energyApps[0].impact = -1; }, state => { state.energyApps[0].impact = 101; },
    state => { state.energyApps[0].extra = true; }, state => { delete state.energyApps[0].impact; },
    state => { state.energyApps[1].appId = state.energyApps[0].appId; }, state => { delete state.energyApps[0]; },
    state => { state.energyApps.extra = true; }, state => { state.energyApps[Symbol('extra')] = true; },
    state => { state.energyApps.length = 129; }, state => { state.energyApps = null; },
    state => { Object.assign(state, status(80, 'adapter', true), { chargeLimit: 80 }); },
    state => { Object.assign(state, status(70, 'adapter', true, 20), { chargeLimit: 80 }); },
    state => { Object.assign(state, status(70, 'adapter'), { chargeLimit: 80, chargeToFull: true }); },
    state => { Object.assign(state, status(70, 'adapter', true), { chargeToFull: true }); },
  ]) {
    const state = batteryDefaults(profile); alter(state);
    expect(validateBatteryState(state, profile).ok).toBe(false);
    const descriptors = Object.getOwnPropertyDescriptors(state), before = structuredClone(state);
    for (const operation of operations(state)) {
      expect(operation().error.code).toBe('invalid_arguments');
      expect(Object.getOwnPropertyDescriptors(state)).toEqual(descriptors);
      expect(structuredClone(state)).toEqual(before);
    }
  }
});

test('descriptor-first validation and argument boundaries never evaluate getters or inherited data', () => {
  let reads = 0;
  const getter = () => { reads++; throw new Error('getter must not execute'); };
  for (const alter of [
    state => Object.defineProperty(state, 'percent', { enumerable: true, get: getter }),
    state => Object.defineProperty(state, 'energyApps', { enumerable: true, get: getter }),
    state => Object.defineProperty(state.energyApps, '0', { enumerable: true, get: getter }),
    state => Object.defineProperty(state.energyApps[0], 'appId', { enumerable: true, get: getter }),
    state => Object.defineProperty(state.energyApps[0], 'impact', { enumerable: true, get: getter }),
    state => Object.defineProperty(state, 'charging', { enumerable: false, value: false }),
    state => { Object.setPrototypeOf(state, { percent: 87 }); },
    state => { Object.setPrototypeOf(state.energyApps, {}); },
    state => { Object.setPrototypeOf(state.energyApps[0], { appId: 'notes' }); },
  ]) {
    const state = batteryDefaults(profile); alter(state);
    expect(validateBatteryState(state, profile).ok).toBe(false);
    const before = Object.getOwnPropertyDescriptors(state);
    for (const operation of operations(state)) expect(operation().error.code).toBe('invalid_arguments');
    expect(Object.getOwnPropertyDescriptors(state)).toEqual(before);
  }
  const state = batteryDefaults(profile);
  for (const [input, operation] of [
    [status(50), input => setBatteryStatus(state, input, profile)],
    [{ showPercentage: true }, input => configureBatteryMenu(state, input, profile)],
  ]) {
    const key = Object.keys(input)[0];
    Object.defineProperty(input, key, { enumerable: true, get: getter });
    unchanged(state, () => operation(input));
  }
  const inheritedStatus = Object.create(status(50));
  unchanged(state, () => setBatteryStatus(state, inheritedStatus, profile));
  const inheritedMenu = Object.create({ showPercentage: true });
  unchanged(state, () => configureBatteryMenu(state, inheritedMenu, profile));
  const hiddenStatus = status(50);
  Object.defineProperty(hiddenStatus, 'percent', { enumerable: false, value: 50 });
  unchanged(state, () => setBatteryStatus(state, hiddenStatus, profile));
  const hiddenMenu = { showPercentage: true };
  Object.defineProperty(hiddenMenu, 'showPercentage', { enumerable: false, value: true });
  unchanged(state, () => configureBatteryMenu(state, hiddenMenu, profile));
  expect(reads).toBe(0);
});

test('readonly targets reject multi-field transitions atomically while truly idempotent operations need no writes', () => {
  for (const key of ['percent', 'powerSource', 'charging', 'minutesToFull']) {
    const state = batteryDefaults(profile);
    Object.defineProperty(state, key, { writable: false });
    unchanged(state, () => setBatteryStatus(state, status(50, 'adapter', true, 10), profile));
  }
  const override = batteryDefaults(profile);
  Object.assign(override, status(80, 'adapter'), { chargeLimit: 80 });
  Object.defineProperty(override, 'chargeToFull', { writable: false });
  unchanged(override, () => chargeBatteryToFull(override, profile));
  const active = batteryDefaults(profile);
  Object.assign(active, status(80, 'adapter', true, 20), { chargeLimit: 80, chargeToFull: true });
  Object.defineProperty(active, 'chargeToFull', { writable: false });
  unchanged(active, () => setBatteryStatus(active, status(100, 'adapter'), profile));
  unchanged(active, () => setBatteryStatus(active, status(80), profile));
  const charging = batteryDefaults(profile);
  Object.assign(charging, status(80, 'adapter'), { chargeLimit: 80 });
  Object.defineProperty(charging, 'charging', { writable: false });
  unchanged(charging, () => chargeBatteryToFull(charging, profile));
  const preferences = batteryDefaults(profile);
  Object.defineProperty(preferences, 'showEnergyMode', { writable: false });
  unchanged(preferences, () => configureBatteryMenu(preferences, { showPercentage: true, showInMenuBar: false, showEnergyMode: 'never' }, profile));
  Object.defineProperty(preferences, 'lowPowerMode', { writable: false });
  unchanged(preferences, () => setBatteryLowPower(preferences, 'always', profile));
  const energy = batteryDefaults(profile); Object.freeze(energy.energyApps[0]);
  unchanged(energy, () => setBatteryEnergy(energy, 'notes', 100, profile));
  for (const freeze of [array => Object.freeze(array), array => Object.preventExtensions(array),
    array => Object.defineProperty(array, 'length', { writable: false })]) {
    const state = batteryDefaults(profile); freeze(state.energyApps);
    unchanged(state, () => setBatteryEnergy(state, 'mail', 80, profile));
  }
  const frozen = batteryDefaults(profile); Object.freeze(frozen); Object.freeze(frozen.energyApps[0]);
  expect(setBatteryStatus(frozen, status(frozen.percent), profile).status).toBe('applied');
  expect(configureBatteryMenu(frozen, { showPercentage: false }, profile).status).toBe('applied');
  expect(setBatteryLowPower(frozen, 'never', profile).status).toBe('applied');
  expect(setBatteryEnergy(frozen, 'notes', 32, profile).status).toBe('applied');
});

test('registered energy capacity and numeric boundaries are enforced independently of current running apps', () => {
  const apps = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`fixture-${index}`, { name: `Fixture ${index}`, icon: 'notes' }]));
  const fixtureProfile = { ...profile, applications: { ...profile.applications, ...apps } };
  const state = batteryDefaults(profile);
  state.energyApps = Array.from({ length: 127 }, (_, index) => ({ appId: `fixture-${index}`, impact: index % 101 }));
  Object.setPrototypeOf(state, null); Object.setPrototypeOf(state.energyApps[0], null);
  expect(validateBatteryState(state, fixtureProfile)).toEqual({ ok: true });
  expect(setBatteryEnergy(state, 'fixture-127', 100, fixtureProfile, delta => delta === 'fixture-127'.length + 5 + 6 + 3).status).toBe('applied');
  expect(state.energyApps.length).toBe(128);
  unchanged(state, () => setBatteryEnergy(state, 'fixture-128', 0, fixtureProfile), 'limit_exceeded');
  expect(setBatteryEnergy(state, 'fixture-127', 0, fixtureProfile).status).toBe('applied');
  expect(batterySummary(state, ['fixture-127'], fixtureProfile).energyApps).toEqual([]);
  expect(validateBatteryState(state, fixtureProfile)).toEqual({ ok: true });
});

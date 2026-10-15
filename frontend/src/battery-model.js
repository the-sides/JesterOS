import { object, flag, choice } from './command-schema.js';
import { isRecord, rejected } from './feature-commands.js';

const forbiddenIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const identity = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...forbiddenIds] } };
const percentSchema = { type: 'integer', minimum: 0, maximum: 100 };
const estimateSchema = { anyOf: [{ type: 'null' }, { type: 'integer', minimum: 1, maximum: 2880 }] };
const energyModes = ['always', 'when-low-power', 'never'];
const lowPowerModes = ['never', 'always', 'battery', 'adapter'];
export const batterySchema = object({ percent: percentSchema, powerSource: choice('battery', 'adapter'),
  charging: flag, minutesToFull: estimateSchema, chargeLimit: { type: 'integer', minimum: 80, maximum: 100 },
  chargeToFull: flag, showInMenuBar: flag, showPercentage: flag, showEnergyMode: choice(...energyModes),
  lowPowerMode: choice(...lowPowerModes), energyApps: { type: 'array', maxItems: 128,
    items: object({ appId: identity, impact: percentSchema }) } });

// Authored simulation fixtures: no hardware measurements, host processes or timers.
export function batteryDefaults(profile) {
  return { percent: profile.defaults.batteryPercent ?? 87, powerSource: 'battery', charging: false,
    minutesToFull: null, chargeLimit: 100, chargeToFull: false, showInMenuBar: true,
    showPercentage: false, showEnergyMode: 'always', lowPowerMode: 'never',
    energyApps: [{ appId: 'notes', impact: 32 }, { appId: profile.family === 'windows' ? 'edge' : 'safari', impact: 48 },
      { appId: profile.family === 'windows' ? 'teams' : 'messages', impact: 8 }] };
}

const stateKeys = Object.keys(batterySchema.properties);
const statusKeys = ['percent', 'powerSource', 'charging', 'minutesToFull'];
const menuKeys = ['showInMenuBar', 'showPercentage', 'showEnergyMode'];
const closedData = (value, keys) => isRecord(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
const validIdentity = value => typeof value === 'string' && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !forbiddenIds.has(value);
const boundedInteger = (value, minimum, maximum) => Number.isInteger(value) && value >= minimum && value <= maximum;
const invalid = message => rejected('invalid_arguments', message);
const applied = target => ({ status: 'applied', target });
const validationFailure = () => ({ ok: false, message: 'Battery requires closed authored data, bounded charge and estimates, consistent source/charging/limit/override, exact preferences, and distinct registered app energy fixtures.' });
const lowPowerActive = state => state.lowPowerMode === 'always' || state.lowPowerMode === state.powerSource;
const chargeToFullAvailable = state => state.powerSource === 'adapter' && state.chargeLimit < 100
  && !state.chargeToFull && state.percent < 100;

export function validateBatteryState(state, profile) {
  if (!closedData(state, stateKeys) || !boundedInteger(state.percent, 0, 100)
    || !['battery', 'adapter'].includes(state.powerSource) || typeof state.charging !== 'boolean'
    || (state.minutesToFull !== null && !boundedInteger(state.minutesToFull, 1, 2880))
    || !boundedInteger(state.chargeLimit, 80, 100) || typeof state.chargeToFull !== 'boolean'
    || typeof state.showInMenuBar !== 'boolean' || typeof state.showPercentage !== 'boolean'
    || !energyModes.includes(state.showEnergyMode) || !lowPowerModes.includes(state.lowPowerMode)) return validationFailure();
  const effectiveLimit = state.chargeToFull ? 100 : state.chargeLimit;
  if (((state.powerSource === 'battery' || state.percent === 100)
      && (state.charging || state.minutesToFull !== null || state.chargeToFull))
    || (state.charging && (state.powerSource !== 'adapter' || state.percent >= effectiveLimit))
    || (state.minutesToFull !== null && (!state.charging || effectiveLimit !== 100))
    || (state.chargeToFull && (state.powerSource !== 'adapter' || state.chargeLimit === 100
      || state.percent === 100 || !state.charging))) return validationFailure();
  const entries = state.energyApps;
  if (!Array.isArray(entries) || Object.getPrototypeOf(entries) !== Array.prototype || entries.length > 128
    || Reflect.ownKeys(entries).length !== entries.length + 1) return validationFailure();
  const ids = new Set();
  for (let index = 0; index < entries.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(entries, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return validationFailure();
    const entry = descriptor.value;
    if (!closedData(entry, ['appId', 'impact']) || !validIdentity(entry.appId)
      || !Object.hasOwn(profile.applications, entry.appId) || !boundedInteger(entry.impact, 0, 100)
      || ids.has(entry.appId)) return validationFailure();
    ids.add(entry.appId);
  }
  return { ok: true };
}

export function batterySummary(state, runningAppIds, profile) {
  const active = lowPowerActive(state), running = new Set(runningAppIds);
  const registryOrder = new Map(Object.keys(profile.applications).map((id, index) => [id, index]));
  const energyApps = state.energyApps.filter(entry => running.has(entry.appId) && entry.impact >= 20)
    .map(({ appId, impact }) => ({ appId, name: profile.applications[appId].name,
      icon: profile.applications[appId].icon, impact }))
    .sort((a, b) => b.impact - a.impact || registryOrder.get(a.appId) - registryOrder.get(b.appId));
  return { percent: state.percent, powerSource: state.powerSource, charging: state.charging,
    minutesToFull: state.minutesToFull, chargeLimit: state.chargeLimit, chargeToFull: state.chargeToFull,
    showInMenuBar: state.showInMenuBar, showPercentage: state.showPercentage, showEnergyMode: state.showEnergyMode,
    lowPowerMode: state.lowPowerMode, lowPowerActive: active,
    showLowPowerControl: state.showEnergyMode === 'always' || (state.showEnergyMode === 'when-low-power' && active),
    // These thresholds are simulation policy, not a prediction of host battery life.
    lowBattery: state.powerSource === 'battery' && state.percent <= 20,
    criticalBattery: state.powerSource === 'battery' && state.percent <= 10,
    statusLabel: state.powerSource === 'battery' ? 'On Battery Power' : state.charging ? 'Charging'
      : state.percent === 100 ? 'Fully Charged' : 'Not Charging',
    powerSourceLabel: state.powerSource === 'battery' ? 'Battery' : 'Power Adapter',
    chargeToFullAvailable: chargeToFullAvailable(state), energyApps };
}

function stateError(state, profile) {
  const validation = validateBatteryState(state, profile);
  return validation.ok ? null : invalid(validation.message);
}
function mutableChanges(state, changes) {
  return Object.keys(changes).every(key => state[key] === changes[key]
    || Object.getOwnPropertyDescriptor(state, key).writable === true);
}
function budgetError(canCommit, delta) {
  if (typeof canCommit !== 'function') return invalid('Expected a synchronous text-budget callback.');
  try {
    if (canCommit(delta) === true) return null;
  } catch { /* A failed budget decision cannot authorize writes. */ }
  return rejected('limit_exceeded', 'The Battery change exceeds the scene text budget.');
}
function commitChanges(state, changes) {
  for (const key of Object.keys(changes)) if (state[key] !== changes[key]) state[key] = changes[key];
}
function changeError(state, changes, profile) {
  const validation = validateBatteryState({ ...state, ...changes }, profile);
  if (!validation.ok) return invalid(validation.message);
  if (!mutableChanges(state, changes)) return invalid('Battery changes require mutable data properties.');
  return null;
}

export function setBatteryStatus(state, status, profile, canCommit = () => true) {
  const error = stateError(state, profile); if (error) return error;
  if (!closedData(status, statusKeys)) return invalid('Use the exact four authored Battery status fields.');
  const changes = { percent: status.percent, powerSource: status.powerSource, charging: status.charging,
    minutesToFull: status.minutesToFull,
    chargeToFull: status.powerSource === 'battery' || status.percent === 100 ? false : state.chargeToFull };
  const denied = changeError(state, changes, profile)
    || budgetError(canCommit, status.powerSource.length - state.powerSource.length);
  if (denied) return denied;
  commitChanges(state, changes);
  return applied({ percent: state.percent, powerSource: state.powerSource, charging: state.charging, minutesToFull: state.minutesToFull });
}

export function setBatteryEnergy(state, appId, impact, profile, canCommit = () => true) {
  const error = stateError(state, profile); if (error) return error;
  if (!validIdentity(appId) || !boundedInteger(impact, 0, 100)) return invalid('Use a safe registered app ID and an integer impact from 0 through 100.');
  if (!Object.hasOwn(profile.applications, appId)) return rejected('stale_target', 'The authored energy app is not registered in this profile.');
  const entry = state.energyApps.find(item => item.appId === appId), index = state.energyApps.length;
  if (!entry && index === 128) return rejected('limit_exceeded', 'The authored energy fixture capacity is exhausted.');
  if (entry ? !mutableChanges(entry, { impact })
    : !Object.isExtensible(state.energyApps) || !Object.getOwnPropertyDescriptor(state.energyApps, 'length').writable)
    return invalid('Battery energy changes require mutable data properties and array capacity.');
  const denied = budgetError(canCommit, entry ? 0 : appId.length + 'appId'.length + 'impact'.length + String(index).length);
  if (denied) return denied;
  if (entry) commitChanges(entry, { impact });
  else Object.defineProperty(state.energyApps, String(index), { value: { appId, impact }, writable: true, enumerable: true, configurable: true });
  return applied({ appId, impact });
}

export function configureBatteryMenu(state, changes, profile, canCommit = () => true) {
  const error = stateError(state, profile); if (error) return error;
  if (!isRecord(changes)) return invalid('Use a nonempty closed subset of Battery menu preferences.');
  const keys = Reflect.ownKeys(changes);
  if (!keys.length || keys.some(key => !menuKeys.includes(key)) || !closedData(changes, keys))
    return invalid('Use a nonempty closed subset of Battery menu preferences.');
  const denied = changeError(state, changes, profile)
    || budgetError(canCommit, Object.hasOwn(changes, 'showEnergyMode') ? changes.showEnergyMode.length - state.showEnergyMode.length : 0);
  if (denied) return denied;
  commitChanges(state, changes);
  return applied({ showInMenuBar: state.showInMenuBar, showPercentage: state.showPercentage, showEnergyMode: state.showEnergyMode });
}

export function setBatteryLowPower(state, mode, profile, canCommit = () => true) {
  const error = stateError(state, profile); if (error) return error;
  if (!lowPowerModes.includes(mode)) return invalid('Use an exact Battery Low Power Mode policy.');
  const denied = changeError(state, { lowPowerMode: mode }, profile)
    || budgetError(canCommit, mode.length - state.lowPowerMode.length);
  if (denied) return denied;
  commitChanges(state, { lowPowerMode: mode });
  return applied({ mode, active: lowPowerActive(state) });
}

export function chargeBatteryToFull(state, profile) {
  const error = stateError(state, profile); if (error) return error;
  if (!chargeToFullAvailable(state)) return rejected('disabled', 'Charge to Full Now requires an adapter, a charge limit below 100, and a not-full battery without an active override.');
  const changes = { charging: true, chargeToFull: true, minutesToFull: null };
  const denied = changeError(state, changes, profile); if (denied) return denied;
  commitChanges(state, changes);
  return applied({ charging: true, chargeToFull: true });
}

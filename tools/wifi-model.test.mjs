import { expect, test } from 'bun:test';
import { wifiDefaults, validateWifiState, setWifiPower, connectWifiNetwork, disconnectWifiNetwork } from '../frontend/src/wifi-model.js';

const network = (state, id) => state.networks.find(item => item.id === id);
const joined = networkId => ({ status: 'applied', target: { networkId, connected: true, passwordRequired: false, error: null } });
const prompt = (networkId, error = null) => ({ status: 'applied', target: { networkId, connected: false, passwordRequired: true, error } });
function unchanged(state, operation, code) {
  const before = structuredClone(state), result = operation();
  expect(result.status).toBe('rejected');
  if (code) expect(result.error.code).toBe(code);
  expect(state).toEqual(before);
}

test('turning Wi-Fi off disconnects but preserves remembered networks; on never silently reconnects', () => {
  const state = wifiDefaults(), records = structuredClone(state.networks);
  expect(validateWifiState(state)).toEqual({ ok: true });
  expect(state.connectedNetworkId).toBe('studio-wifi');
  expect(setWifiPower(state, false)).toEqual({ status: 'applied', target: { powered: false, connectedNetworkId: null } });
  unchanged(state, () => connectWifiNetwork(state, 'studio-wifi'), 'disabled');
  expect(setWifiPower(state, true)).toEqual({ status: 'applied', target: { powered: true, connectedNetworkId: null } });
  expect(state.networks).toEqual(records);
  expect(connectWifiNetwork(state, 'studio-wifi')).toEqual(joined('studio-wifi'));
  expect(setWifiPower(state, true).target.connectedNetworkId).toBe('studio-wifi');
  expect(validateWifiState(state)).toEqual({ ok: true });
});

test('protected joins prompt without losing the current connection and retain it after wrong passwords', () => {
  const state = wifiDefaults(), before = structuredClone(state);
  expect(connectWifiNetwork(state, 'location-wifi')).toEqual(prompt('location-wifi'));
  expect(state).toEqual(before);
  for (const password of ['', 'wrong', ' scene', 'SCENE', 'x'.repeat(63)]) {
    expect(connectWifiNetwork(state, 'location-wifi', password)).toEqual(prompt('location-wifi', 'incorrect_password'));
    expect(state).toEqual(before);
  }
  expect(connectWifiNetwork(state, 'location-wifi', 'scene')).toEqual(joined('location-wifi'));
  expect(network(state, 'location-wifi').known).toBe(true);
  expect(state.connectedNetworkId).toBe('location-wifi');
  expect(disconnectWifiNetwork(state, 'location-wifi')).toEqual({ status: 'applied', target: { powered: true, connectedNetworkId: null } });
  expect(connectWifiNetwork(state, 'location-wifi')).toEqual(joined('location-wifi'));
  expect(validateWifiState(state)).toEqual({ ok: true });
});

test('open joins remember the network and disconnect rejects a stale selection without forgetting it', () => {
  const state = wifiDefaults();
  expect(connectWifiNetwork(state, 'guest-wifi')).toEqual(joined('guest-wifi'));
  expect(network(state, 'guest-wifi').known).toBe(true);
  unchanged(state, () => disconnectWifiNetwork(state, 'studio-wifi'), 'stale_target');
  expect(disconnectWifiNetwork(state, 'guest-wifi').target).toEqual({ powered: true, connectedNetworkId: null });
  expect(network(state, 'guest-wifi').known).toBe(true);
  unchanged(state, () => disconnectWifiNetwork(state, 'guest-wifi'), 'stale_target');
  expect(connectWifiNetwork(state, 'guest-wifi')).toEqual(joined('guest-wifi'));
});

test('unavailable and missing networks reject before any remembered connection changes', () => {
  const state = wifiDefaults();
  unchanged(state, () => connectWifiNetwork(state, 'offline-wifi', 'scene'), 'disabled');
  unchanged(state, () => connectWifiNetwork(state, 'missing'), 'stale_target');
  unchanged(state, () => disconnectWifiNetwork(state, 'missing'), 'stale_target');
});

test('hidden fixtures join literally without inventing networks or changing their hidden identity', () => {
  const state = wifiDefaults(), hidden = network(state, 'hidden-studio');
  expect(hidden.name).toBe('Hidden Studio');
  expect(hidden.hidden).toBe(true);
  expect(connectWifiNetwork(state, hidden.id)).toEqual(prompt(hidden.id));
  expect(connectWifiNetwork(state, hidden.id, 'scene')).toEqual(joined(hidden.id));
  expect(hidden.hidden).toBe(true);
  expect(state.networks).toHaveLength(5);
  expect(validateWifiState(JSON.parse(JSON.stringify(state)))).toEqual({ ok: true });
  hidden.name = '  Studio 🎬 — <literal>  ';
  expect(validateWifiState(state)).toEqual({ ok: true });
  expect(hidden.name).toBe('  Studio 🎬 — <literal>  ');
});

test('argument coercion and out-of-bound passwords never change valid state or invoke conversion hooks', () => {
  const state = wifiDefaults();
  let conversions = 0;
  const coercion = { toString() { conversions++; return 'scene'; }, valueOf() { conversions++; return true; } };
  for (const value of [null, 0, 'true', undefined, coercion]) unchanged(state, () => setWifiPower(state, value), 'invalid_arguments');
  for (const value of [null, 3, '', '__proto__', 'a'.repeat(129), coercion]) {
    unchanged(state, () => connectWifiNetwork(state, value), 'invalid_arguments');
    unchanged(state, () => disconnectWifiNetwork(state, value), 'invalid_arguments');
  }
  for (const value of [null, 4, coercion, 'x'.repeat(64)]) unchanged(state, () => connectWifiNetwork(state, 'location-wifi', value), 'invalid_arguments');
  expect(conversions).toBe(0);
});

test('inconsistent, duplicate, coerced, sparse and extended snapshots reject atomically for every transition', () => {
  const valid = wifiDefaults();
  for (const mutate of [
    state => { delete state.powered; },
    state => { state.extra = true; },
    state => { state[Symbol('extra')] = true; },
    state => { state.powered = 'true'; },
    state => { state.powered = false; },
    state => { state.connectedNetworkId = 'missing'; },
    state => { state.networks[0].known = false; },
    state => { state.networks[0].available = false; state.networks[0].strength = 0; },
    state => { state.networks[0].extra = true; },
    state => { delete state.networks[0].hidden; },
    state => { state.networks[0].known = 1; },
    state => { state.networks[0].available = 'true'; },
    state => { state.networks[0].hidden = 0; },
    state => { state.networks[0].id = 'constructor'; },
    state => { state.networks[0].id = 'x'.repeat(129); },
    state => { state.networks[0].name = ''; },
    state => { state.networks[0].name = '   '; },
    state => { state.networks[0].name = 'Two\nlines'; },
    state => { state.networks[0].name = 'Two\rlines'; },
    state => { state.networks[0].name = 'x'.repeat(257); },
    state => { state.networks[0].security = 'wpa'; },
    state => { state.networks[0].password = ''; },
    state => { state.networks[0].password = 'x'.repeat(64); },
    state => { state.networks[1].password = 'scene'; },
    state => { state.networks[0].strength = 0; },
    state => { state.networks[0].strength = 4; },
    state => { state.networks[0].strength = 1.5; },
    state => { state.networks[0].strength = '3'; },
    state => { state.networks[3].strength = 1; },
    state => { state.networks[1].id = state.networks[0].id; },
    state => { state.networks[1].name = state.networks[0].name; },
    state => { state.networks.length = 6; },
    state => { state.networks.extra = true; },
    state => { state.networks = Array.from({ length: 129 }, (_, i) => ({ ...state.networks[1], id: `network-${i}`, name: `Network ${i}` })); state.connectedNetworkId = null; },
  ]) {
    const state = structuredClone(valid); mutate(state);
    expect(validateWifiState(state).ok).toBe(false);
    // Descriptors also preserve symbols/holes, which structuredClone omits.
    const before = Object.getOwnPropertyDescriptors(state);
    const dataBefore = structuredClone(state);
    expect(setWifiPower(state, false).status).toBe('rejected');
    expect(connectWifiNetwork(state, 'guest-wifi').status).toBe('rejected');
    expect(disconnectWifiNetwork(state, 'studio-wifi').status).toBe('rejected');
    expect(Object.getOwnPropertyDescriptors(state)).toEqual(before);
    expect(structuredClone(state)).toEqual(dataBefore);
  }
});

test('closed snapshots accept boundary sizes and null-prototype data records without normalizing literal text', () => {
  const state = wifiDefaults();
  state.connectedNetworkId = null;
  state.networks = Array.from({ length: 128 }, (_, i) => ({ ...state.networks[1], id: `network-${i}`, name: `Network ${i}` }));
  state.networks[0].name = 'x'.repeat(256);
  state.networks[0].id = 'x'.repeat(128);
  state.networks[0].security = 'password'; state.networks[0].password = 'x'.repeat(63);
  Object.setPrototypeOf(state, null); Object.setPrototypeOf(state.networks[0], null);
  expect(validateWifiState(state)).toEqual({ ok: true });
  expect(connectWifiNetwork(state, state.networks[0].id, 'x'.repeat(63))).toEqual(joined(state.networks[0].id));
  state.connectedNetworkId = null; state.networks = [];
  expect(validateWifiState(state)).toEqual({ ok: true });
});

test('accessors at every snapshot boundary reject without invoking getters or conversion hooks', () => {
  let reads = 0;
  const getter = () => { reads++; throw new Error('must not read'); };
  for (const alter of [
    state => Object.defineProperty(state, 'powered', { enumerable: true, get: getter }),
    state => Object.defineProperty(state, 'networks', { enumerable: true, get: getter }),
    state => Object.defineProperty(state.networks, '0', { enumerable: true, get: getter }),
    state => Object.defineProperty(state.networks[0], 'password', { enumerable: true, get: getter }),
    state => Object.defineProperty(state.networks[0], 'id', { enumerable: true, get: getter }),
    state => { state.networks[0].name = { toString: getter }; },
    state => { Object.setPrototypeOf(state.networks, {}); },
    state => { Object.setPrototypeOf(state.networks[0], { inherited: true }); },
  ]) {
    const state = wifiDefaults(); alter(state);
    expect(validateWifiState(state).ok).toBe(false);
    expect(setWifiPower(state, false).status).toBe('rejected');
    expect(connectWifiNetwork(state, 'guest-wifi').status).toBe('rejected');
    expect(disconnectWifiNetwork(state, 'studio-wifi').status).toBe('rejected');
  }
  expect(reads).toBe(0);
});

test('readonly fields cannot cause a partial power or join commit; idempotent operations need no writes', () => {
  const state = wifiDefaults();
  Object.defineProperty(state, 'connectedNetworkId', { writable: false });
  unchanged(state, () => setWifiPower(state, false), 'invalid_arguments');
  unchanged(state, () => connectWifiNetwork(state, 'guest-wifi'), 'invalid_arguments');
  unchanged(state, () => disconnectWifiNetwork(state, 'studio-wifi'), 'invalid_arguments');
  expect(state.powered).toBe(true);
  expect(network(state, 'guest-wifi').known).toBe(false);
  expect(connectWifiNetwork(state, 'studio-wifi')).toEqual(joined('studio-wifi'));
  expect(setWifiPower(state, true).status).toBe('applied');
  const other = wifiDefaults(); Object.freeze(network(other, 'guest-wifi'));
  unchanged(other, () => connectWifiNetwork(other, 'guest-wifi'), 'invalid_arguments');
});

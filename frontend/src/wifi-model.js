import { object, flag, choice } from './command-schema.js';
import { isRecord, rejected } from './feature-commands.js';

const forbiddenIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const identity = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...forbiddenIds] } };
const networkName = { type: 'string', minLength: 1, maxLength: 256, pattern: '^(?=[\\s\\S]*\\S)(?![\\s\\S]*[\\r\\n])[\\s\\S]+$' };
const networkSchema = object({ id: identity, name: networkName, security: choice('open', 'password'),
  password: { type: 'string', maxLength: 63 }, known: flag, available: flag, hidden: flag,
  strength: { type: 'integer', minimum: 0, maximum: 3 } });
export const wifiSchema = object({ powered: flag, connectedNetworkId: { anyOf: [identity, { type: 'null' }] },
  networks: { type: 'array', maxItems: 128, items: networkSchema } });

// These are scene fixtures, never discovered networks or real credentials.
export function wifiDefaults() {
  return { powered: true, connectedNetworkId: 'studio-wifi', networks: [
    { id: 'studio-wifi', name: 'Studio Wi-Fi', security: 'password', password: 'scene', known: true, available: true, hidden: false, strength: 3 },
    { id: 'guest-wifi', name: 'Guest Wi-Fi', security: 'open', password: '', known: false, available: true, hidden: false, strength: 2 },
    { id: 'location-wifi', name: 'Location Wi-Fi', security: 'password', password: 'scene', known: false, available: true, hidden: false, strength: 1 },
    { id: 'offline-wifi', name: 'Offline Wi-Fi', security: 'password', password: 'scene', known: true, available: false, hidden: false, strength: 0 },
    { id: 'hidden-studio', name: 'Hidden Studio', security: 'password', password: 'scene', known: false, available: true, hidden: true, strength: 3 },
  ] };
}

const closedData = (value, keys) => isRecord(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
const validIdentity = value => typeof value === 'string' && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !forbiddenIds.has(value);
const validName = value => typeof value === 'string' && value.length <= 256 && /\S/u.test(value) && !/[\r\n]/u.test(value);
const validPassword = value => typeof value === 'string' && value.length <= 63;
const stateKeys = ['powered', 'connectedNetworkId', 'networks'];
const networkKeys = ['id', 'name', 'security', 'password', 'known', 'available', 'hidden', 'strength'];
const invalid = message => rejected('invalid_arguments', message);
const applied = target => ({ status: 'applied', target });
const writable = (value, key) => Object.getOwnPropertyDescriptor(value, key).writable;
const validationFailure = () => ({ ok: false, message: 'Wi-Fi requires closed fictional network records, unique literal names and safe IDs, consistent signal availability, and a known available connection only while powered.' });

export function validateWifiState(value) {
  if (!closedData(value, stateKeys) || typeof value.powered !== 'boolean'
    || (value.connectedNetworkId !== null && !validIdentity(value.connectedNetworkId))) return validationFailure();
  const networks = value.networks;
  if (!Array.isArray(networks) || Object.getPrototypeOf(networks) !== Array.prototype || networks.length > 128
    || Reflect.ownKeys(networks).length !== networks.length + 1) return validationFailure();
  const ids = new Set(), names = new Set();
  let connected = value.connectedNetworkId === null;
  for (let index = 0; index < networks.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(networks, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return validationFailure();
    const network = descriptor.value;
    if (!closedData(network, networkKeys) || !validIdentity(network.id) || !validName(network.name)
      || !validPassword(network.password) || !['open', 'password'].includes(network.security)
      || (network.security === 'open' ? network.password !== '' : network.password.length === 0)
      || typeof network.known !== 'boolean' || typeof network.available !== 'boolean' || typeof network.hidden !== 'boolean'
      || !Number.isInteger(network.strength) || network.strength < 0 || network.strength > 3
      || (network.available ? network.strength === 0 : network.strength !== 0)
      || ids.has(network.id) || names.has(network.name)) return validationFailure();
    ids.add(network.id); names.add(network.name);
    if (network.id === value.connectedNetworkId) {
      if (!value.powered || !network.available || !network.known) return validationFailure();
      connected = true;
    }
  }
  return connected ? { ok: true } : validationFailure();
}

export function setWifiPower(state, powered) {
  const validation = validateWifiState(state);
  if (!validation.ok) return invalid(validation.message);
  if (typeof powered !== 'boolean') return invalid('Use an exact boolean Wi-Fi power value.');
  if ((state.powered !== powered && !writable(state, 'powered'))
    || (!powered && state.connectedNetworkId !== null && !writable(state, 'connectedNetworkId')))
    return invalid('Wi-Fi changes require mutable data properties.');
  if (state.powered !== powered) state.powered = powered;
  // Powering on deliberately does not reconnect a remembered network.
  if (!powered && state.connectedNetworkId !== null) state.connectedNetworkId = null;
  return applied({ powered: state.powered, connectedNetworkId: state.connectedNetworkId });
}

export function connectWifiNetwork(state, networkId, password = undefined) {
  const validation = validateWifiState(state);
  if (!validation.ok) return invalid(validation.message);
  if (!validIdentity(networkId) || (password !== undefined && !validPassword(password)))
    return invalid('Use a safe network ID and an optional literal password of at most 63 characters.');
  const network = state.networks.find(item => item.id === networkId);
  if (!network) return rejected('stale_target', 'The fictional network is no longer present.');
  if (!state.powered || !network.available) return rejected('disabled', 'Wi-Fi must be powered and the fictional network available.');
  if (!network.known && network.security === 'password' && password !== network.password)
    return applied({ networkId, connected: false, passwordRequired: true, error: password === undefined ? null : 'incorrect_password' });
  if ((!network.known && !writable(network, 'known'))
    || (state.connectedNetworkId !== networkId && !writable(state, 'connectedNetworkId')))
    return invalid('Wi-Fi changes require mutable data properties.');
  if (!network.known) network.known = true;
  if (state.connectedNetworkId !== networkId) state.connectedNetworkId = networkId;
  return applied({ networkId, connected: true, passwordRequired: false, error: null });
}

export function disconnectWifiNetwork(state, networkId) {
  const validation = validateWifiState(state);
  if (!validation.ok) return invalid(validation.message);
  if (!validIdentity(networkId)) return invalid('Use a safe network ID.');
  if (state.connectedNetworkId !== networkId) return rejected('stale_target', 'Only the currently connected fictional network can be disconnected.');
  if (!writable(state, 'connectedNetworkId')) return invalid('Wi-Fi changes require mutable data properties.');
  state.connectedNetworkId = null;
  return applied({ powered: state.powered, connectedNetworkId: null });
}

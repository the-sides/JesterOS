import { test, expect } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { wifiDefaults } from '../frontend/src/wifi-model.js';
import { createWifiCommands } from '../frontend/src/wifi-commands.js';

function root(canCommit = () => true) {
  const wifi = wifiDefaults(), presentation = { otherNetworks: false, join: null };
  const view = { available: () => true, focus: async () => true, setDraft: async () => true };
  const controller = createWifiCommands({
    profile: getOSProfile('macos-golden-gate-27.0.1'), presentation,
    getState: () => wifi, getView: () => view, available: () => true, canBegin: () => true,
    canCommit, capture: () => null, restore: async () => true, settle: async () => {},
  });
  return { wifi, presentation, run: (name, target = {}, payload = {}) => controller.handlers[name](target, payload) };
}

test('a protected Join commit limit retains its current sheet and prior connection as a failed attempt', async () => {
  const scene = root(() => false), before = structuredClone(scene.wifi);
  const requested = await scene.run('wifi.connect', { networkId: 'location-wifi' });
  const joinId = requested.target.joinId;
  const result = await scene.run('wifi.join.submit', { joinId }, { password: 'scene' });
  expect(result.status).toBe('applied');
  expect(result.target.connected).toBe(false);
  expect(result.target.networkId).toBe('location-wifi');
  expect(scene.presentation.join.joinId).toBe(joinId);
  expect(scene.wifi).toEqual(before);
  await scene.run('wifi.join.cancel', { joinId });
  expect(scene.presentation.join).toBeNull();
  expect(scene.wifi).toEqual(before);
});

test('a real Join lease from another retained Root cannot submit or cancel this Root’s sheet', async () => {
  const alex = root(), casey = root();
  const first = await alex.run('wifi.connect', { networkId: 'location-wifi' });
  const second = await casey.run('wifi.connect', { networkId: 'location-wifi' });
  const before = structuredClone(casey.wifi), currentJoinId = second.target.joinId;
  for (const [name, payload] of [['wifi.join.submit', { password: 'scene' }], ['wifi.join.cancel', {}]]) {
    const result = await casey.run(name, { joinId: first.target.joinId }, payload);
    expect(result.status).toBe('rejected');
    expect(result.error.code).toBe('stale_target');
    expect(casey.presentation.join.joinId).toBe(currentJoinId);
    expect(casey.wifi).toEqual(before);
  }
});

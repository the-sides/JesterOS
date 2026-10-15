import test from 'node:test';
import assert from 'node:assert/strict';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createApplicationSceneState } from '../frontend/src/application-scene-state.js';
import { createDefaultApplicationFiles } from '../frontend/src/default-application-files.js';
import { createBrowserWindow } from '../frontend/src/browser-state.js';
import { calculatorDisplay } from '../frontend/src/calculator-state.js';
import {
  NATIVE_PROFILE_IDS, nativeDomainDefinitions, nativeDomainSchemas, nativeDomainCatalog,
  nativeAppMetadata, nativeInstalledAppMetadata, nativeDomainForWindow,
  validateNativeDomains, validateNativeDomainWindows, projectNativeDomain, rehydrateNativeDomain,
} from '../frontend/src/native-domain-registry.js';

function scene(profile) {
  const graph = createApplicationSceneState(profile);
  graph.files = createDefaultApplicationFiles(profile);
  return graph;
}

for (const profileId of NATIVE_PROFILE_IDS) {
  test(`${profileId}: one complete graph and genuine registered metadata per native domain`, () => {
    const profile = getOSProfile(profileId), graph = scene(profile);
    assert.equal(validateNativeDomains(graph, profile).ok, true);
    for (const [key, row] of Object.entries(nativeDomainDefinitions)) {
      assert.equal(row.key, key);
      assert.equal(nativeDomainSchemas[key], row.schema);
      assert.ok(graph[key] && typeof graph[key] === 'object', key);
      if (!row.shared) assert.equal(typeof row.createCommands, 'function', key);
      const projected = projectNativeDomain(key, graph[key], profile);
      const restored = rehydrateNativeDomain(key, projected, profile);
      assert.notEqual(projected, graph[key], key);
      assert.notEqual(restored, projected, key);
      assert.deepEqual(restored, projected, key);
    }
    const descriptors = nativeAppMetadata(profile);
    for (const [appId, descriptor] of Object.entries(descriptors)) {
      assert.equal(descriptor.id, appId);
      assert.ok(descriptor.name.length > 0);
      assert.ok(descriptor.width >= descriptor.minimumSize.width, appId);
      assert.ok(descriptor.height >= descriptor.minimumSize.height, appId);
      assert.equal(descriptor.launchOptions.width, undefined, appId);
      assert.equal(descriptor.launchOptions.component, undefined, appId);
      assert.equal(profile.applications[appId].domainKey, descriptor.domainKey, appId);
    }
    assert.equal(descriptors['local-calculator'], undefined);
    assert.equal(descriptors['local-radix-lab'], undefined);
    assert.deepEqual(nativeInstalledAppMetadata(graph.store, profile), {});
    assert.equal(validateNativeDomainWindows(graph, profile, []).ok, true);
  });

  test(`${profileId}: registered Calculator controller publishes exact originals and refuses substitutes`, async () => {
    const profile = getOSProfile(profileId), graph = scene(profile), row = nativeDomainDefinitions.calculator;
    const actual = { id: 'registry-calculator-1', appId: 'calculator', title: 'Calculator' };
    let rootWindow = actual, remaining = Infinity;
    const context = { profile, getState: () => graph.calculator, getWindow: id => id === actual.id ? rootWindow : null,
      getView: () => undefined, available: () => true, alive: () => true,
      getSceneTime: () => Date.parse(profile.defaults.sceneTime), canCommit: delta => typeof delta === 'number' && delta <= remaining };
    const controller = row.createCommands(context);
    assert.equal(controller.windowOpened(actual, { mode: 'scientific' }), true);
    const original = graph.calculator.windows[0], target = { windowId: actual.id };
    assert.equal(nativeDomainForWindow(profile, actual), row);
    assert.equal(validateNativeDomainWindows(graph, profile, [actual]).ok, true);
    assert.equal((await controller.handlers['calculator.expression'](target, { text: '2+3*4' })).status, 'applied');
    assert.equal((await controller.handlers['calculator.evaluate'](target, {})).status, 'applied');
    assert.equal(graph.calculator.windows[0], original);
    assert.equal(calculatorDisplay(original), '14');
    const before = JSON.stringify(graph.calculator);
    remaining = -Infinity;
    assert.equal((await controller.handlers['calculator.expression'](target, { text: '17' })).error.code, 'limit_exceeded');
    assert.equal(JSON.stringify(graph.calculator), before);
    remaining = Infinity;
    rootWindow = { ...actual };
    const substituted = await controller.handlers['calculator.expression'](target, { text: '19' });
    assert.equal(substituted.status, 'rejected');
    assert.equal(JSON.stringify(graph.calculator), before);
    rootWindow = actual;
    assert.equal(validateNativeDomainWindows(graph, profile, []).ok, false);
    assert.equal(validateNativeDomainWindows(graph, profile, [actual, actual]).ok, false);
    assert.equal(validateNativeDomainWindows(graph, profile, [{ ...actual, appId: 'dictionary' }]).ok, false);
    assert.equal(controller.windowClosed(actual), true);
    assert.equal(validateNativeDomainWindows(graph, profile, []).ok, true);
    controller.dispose();
  });

  test(`${profileId}: primary Browser and Chrome share authority, private rows never persist`, () => {
    const profile = getOSProfile(profileId), state = nativeDomainDefinitions.browser.createState(profile);
    const primary = profile.id.startsWith('windows11') ? 'edge' : 'safari';
    state.windows.push(createBrowserWindow(state, 'registry-browser-1', false, primary));
    state.windows.push(createBrowserWindow(state, 'registry-chrome-1', false, 'chrome'));
    state.windows.push(createBrowserWindow(state, 'registry-private-1', true, 'chrome'));
    assert.equal(nativeDomainForWindow(profile, { id: 'registry-browser-1', appId: primary }), nativeDomainDefinitions.browser);
    assert.equal(nativeDomainForWindow(profile, { id: 'registry-chrome-1', appId: 'chrome' }), nativeDomainDefinitions.browser);
    const saved = projectNativeDomain('browser', state, profile);
    assert.deepEqual(saved.windows.map(window => window.nativeAppId), [primary, 'chrome']);
    assert.equal(state.windows.length, 3);
    assert.equal(saved.windows.some(window => window.private), false);
    if (primary === 'edge') assert.equal(nativeDomainForWindow(profile, { appId: 'edge', utilityKind: 'edge-pdf' }), nativeDomainDefinitions.preview);
    assert.ok(nativeDomainCatalog['browser.navigate']);
    assert.equal(Object.keys(nativeDomainCatalog).some(name => name.startsWith('chrome.')), false);
  });
}


for (const profileId of NATIVE_PROFILE_IDS) {
  test(`${profileId}: original Find My registry identity, source props and canonical windows`, () => {
    const profile = getOSProfile(profileId), graph = scene(profile), row = nativeDomainDefinitions.findmy;
    assert.equal(row.key, 'findmy');
    assert.deepEqual(row.appIds(profile), ['findmy']);
    assert.equal(nativeAppMetadata(profile).findmy.component, 'FindMyApp.svelte');
    assert.equal(profile.applications.findmy.domainKey, 'findmy');
    assert.equal(nativeDomainForWindow(profile, { id: 'findmy-original', appId: 'findmy' }), row);
    assert.ok(nativeDomainCatalog['findmy.location.share']);
    assert.deepEqual(nativeDomainCatalog['findmy.sound'].profiles, NATIVE_PROFILE_IDS);
    const sources = Object.fromEntries(['bluetooth', 'contacts', 'messages', 'preferences', 'maps', 'sound'].map(name => [name, graph[name]]));
    const props = row.extraProps({ context: { getShared: name => sources[name] } });
    for (const [name, original] of Object.entries(sources)) assert.equal(props.sources[name], original);
    const actual = { id: 'findmy-original', appId: 'findmy' }, facade = { available: () => true };
    const context = { profile, getState: () => graph.findmy, getWindow: id => id === actual.id ? actual : null, getView: () => facade,
      available: () => true, alive: () => true, canCommit: () => true, getSceneTime: () => Date.parse(profile.defaults.sceneTime),
      getShared: name => sources[name] };
    const controller = row.createCommands(context);
    assert.equal(controller.windowOpened(actual), true);
    assert.equal(row.sessions(graph.findmy)[0], graph.findmy.windows[0]);
    assert.equal(validateNativeDomainWindows(graph, profile, [actual]).ok, true);
    assert.equal(controller.windowClosed({ ...actual }), false);
    assert.equal(controller.windowClosed(actual), true);
    controller.dispose();
  });
}

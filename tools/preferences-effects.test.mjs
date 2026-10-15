import test from 'node:test';
import assert from 'node:assert/strict';
import { listOSProfiles } from '../frontend/src/os-profiles.js';
import { createPreferencesState } from '../frontend/src/preferences-state.js';
import {
  permission, extensionEnabled, sharingDiscovery, replacePreferenceText, preferenceShortcut,
  transformPreferencePointing, preferenceScrollbarPosition, projectPreferencesSceneEffects,
  scheduledPowerDecisions, createPreferencesSceneEffects, preferencesUpdateManifests,
  SCENE_UPDATE_MIME, SCENE_UPDATE_EXTENSION, SCENE_UPDATE_MAX_BYTES,
  encodeSceneUpdate, decodeSceneUpdate, sceneUpdatePatch, prepareSceneUpdate, parsePreferencesSiri,
} from '../frontend/src/preferences-effects.js';

const profiles = listOSProfiles();
const profile = profiles.find(row => row.renderer === 'mojave');
const instant = Date.UTC(2024, 0, 10, 21, 0);
const clock = { timeZone: 'UTC' };
const create = () => createPreferencesState(profile, { sceneTime: instant });

// These are behavior tests against pure consumers and actual serialized update
// bytes. The actual Root DOM/scoped stylesheet smoke belongs to browser checks.
test('explicit app capability is denied by an installed camera restriction even with parental controls off', () => {
  const state = create();
  state.configuration.security.permissions.push({ id: 'grant', appId: 'capture', category: 'camera', allowed: true });
  assert.equal(permission(state, 'capture', 'camera'), true);
  assert.equal(permission(state, 'other', 'camera'), false);
  state.configuration.parental.enabled = false;
  state.configuration.profiles.rows.push({ id: 'restrict', name: 'Camera policy', organization: '', description: '', settings: [{ id: 'restrict.camera', controlId: 'parental.allowCamera', value: false }] });
  assert.equal(permission(state, 'capture', 'camera'), false);
  state.configuration.profiles.rows.splice(0);
  assert.equal(permission(state, 'capture', 'camera'), true);
  assert.equal(permission(state, 'capture', '__proto__'), false);
});

test('disabled extensions stop matching their real extension identity and category', () => {
  const state = create();
  assert.equal(extensionEnabled(state, 'mail', 'share'), true);
  state.configuration.extensions.rows.find(row => row.id === 'mail').enabled = false;
  assert.equal(extensionEnabled(state, 'mail', 'share'), false);
  assert.equal(extensionEnabled(state, 'markup', 'share'), false);
  assert.equal(extensionEnabled(state, 'unknown'), false);
});

test('sharing exposes only live authorized scene folders, including ancestor trash and cycles', () => {
  const state = create(), sharing = state.configuration.sharing;
  sharing.services.file = true;
  sharing.allowedUserIds.push('casey');
  sharing.folders.push(...['live', 'nested', 'cycle', 'missing'].map(id => ({ id: 'share-' + id, fileId: id, permission: 'write' })));
  const files = [
    { id: 'live', name: 'Work', kind: 'folder', parentId: 'documents' },
    { id: 'trashed-parent', name: 'Old', kind: 'folder', parentId: 'trash' },
    { id: 'nested', name: 'Hidden', kind: 'folder', parentId: 'trashed-parent' },
    { id: 'cycle', name: 'Cycle', kind: 'folder', parentId: 'cycle' },
    { id: 'missing', name: 'Orphan', kind: 'folder', parentId: 'unmounted' },
  ];
  const discovery = () => sharingDiscovery(state, { userId: 'casey', listFiles: () => files });
  assert.deepEqual(discovery().folders, [{ fileId: 'live', name: 'Work', permission: 'write' }]);
  assert.deepEqual(discovery().protocols, ['smb']);
  assert.deepEqual(sharingDiscovery(state, { userId: 'unauthorized', listFiles: () => files }).folders, []);
  files[0].parentId = 'trash';
  assert.deepEqual(discovery().folders, []);
});

test('text replacements use completed token boundaries and actual caret, never password, paste or composing text', () => {
  const state = create();
  state.configuration.keyboard.replacements.push({ id: 'r', from: 'omw', to: 'On my way!' });
  assert.deepEqual(replacePreferenceText(state, { text: 'omw next', start: 4 }), { text: 'On my way! next', start: 11, end: 11, replaced: true });
  assert.equal(replacePreferenceText(state, { text: 'somw ', start: 5 }).replaced, false);
  assert.equal(replacePreferenceText(state, { text: 'omw', start: 3 }).replaced, false);
  for (const extra of [{ privateInput: true }, { composing: true }, { inputType: 'insertFromPaste' }, { end: 2 }]) {
    assert.equal(replacePreferenceText(state, { text: 'omw ', start: 4, ...extra }).replaced, false);
  }
  state.configuration.keyboard.replacements[0].to = 'omw omw';
  assert.equal(replacePreferenceText(state, { text: 'omw ', start: 4 }).text, 'omw omw ');
});

test('longest text replacement wins without cascading into another configured replacement', () => {
  const state = create();
  state.configuration.keyboard.replacements.push({ id: 'a', from: 'way', to: 'wrong' }, { id: 'b', from: 'on way', to: 'way' });
  assert.equal(replacePreferenceText(state, { text: 'on way ', start: 7 }).text, 'way ');
});

test('shortcut mappings honor remapped modifiers, explicit disable and nonmatching extra modifiers', () => {
  const state = create();
  assert.equal(preferenceShortcut(state, { key: 'ArrowUp', ctrlKey: true }), 'mission-control');
  assert.equal(preferenceShortcut(state, { key: 'ArrowUp', ctrlKey: true, shiftKey: true }), null);
  state.configuration.keyboard.shortcuts.push({ id: 'disable', action: 'mission-control', key: 'Control+ArrowUp', enabled: false });
  assert.equal(preferenceShortcut(state, { key: 'ArrowUp', ctrlKey: true }), null);
  state.configuration.keyboard.modifierKeys.command = 'control';
  state.configuration.keyboard.shortcuts[0].enabled = true;
  assert.equal(preferenceShortcut(state, { key: 'ArrowUp', metaKey: true }), 'mission-control');
  assert.equal(preferenceShortcut(state, { key: 'ArrowUp', metaKey: true, isComposing: true }), null);
  state.configuration.keyboard.shortcuts.push({ id: 'spotlight', action: 'spotlight', key: 'Command+Space', enabled: true });
  state.configuration.keyboard.modifierKeys.command = 'command';
  assert.equal(preferenceShortcut(state, { key: ' ', metaKey: true }), 'spotlight');
});

test('local pointing transforms preserve wheel units and reflect primary button, natural scrolling and tracking', () => {
  const state = create();
  state.configuration.mouse.tracking = 100;
  state.configuration.mouse.scrolling = 100;
  state.configuration.mouse.primaryButton = 'right';
  state.configuration.mouse.naturalScroll = true;
  let result = transformPreferencePointing(state, { movementX: 4, movementY: -8, deltaY: 12, deltaMode: 1, button: 0 });
  assert.equal(result.movementX, 9);
  assert.equal(result.movementY, -18);
  assert.equal(result.deltaY, -27);
  assert.equal(result.deltaMode, 1);
  assert.equal(result.button, 2);
  state.configuration.trackpad.naturalScroll = false;
  state.configuration.trackpad.tapToClick = true;
  result = transformPreferencePointing(state, { device: 'trackpad', deltaY: 12, button: 0 });
  assert.equal(result.deltaY, 12);
  assert.equal(result.button, 0);
  assert.equal(result.tapToClick, true);
});

test('scrollbar track clicks page or jump to the actual clicked spot with bounded native metrics', () => {
  const state = create();
  const metrics = { position: 85, trackStart: 0, trackLength: 100, thumbLength: 10, current: 0, viewport: 100, scrollExtent: 1000 };
  assert.equal(preferenceScrollbarPosition(state, metrics), 100);
  state.configuration.general.clickScroll = 'spot';
  assert.equal(preferenceScrollbarPosition(state, metrics), 800);
  assert.equal(preferenceScrollbarPosition(state, { ...metrics, position: 1000 }), 900);
  assert.equal(preferenceScrollbarPosition(state, { ...metrics, trackLength: 0 }), null);
});

test('scene display projection uses authored zone/schedule and accessibility magnification, not host time', () => {
  const state = create(), c = state.configuration;
  c.displays.scale = 125;
  c.accessibility.zoom = true;
  c.accessibility.zoomScale = 2;
  c.accessibility.invertColors = true;
  c.accessibility.increaseContrast = true;
  c.accessibility.reduceMotion = true;
  c.accessibility.cursorSize = 3;
  c.general.sidebarSize = 'large';
  c.displays.nightShift = true;
  c.displays.nightShiftStart = 1200;
  c.displays.nightShiftEnd = 420;
  c.displays.colorTemperature = 80;
  const get = (time, zone = 'UTC') => projectPreferencesSceneEffects(state, { getSceneTime: () => time, clock: { timeZone: zone } });
  let effect = get(instant);
  assert.equal(effect.scale, 2.5);
  assert.equal(effect.nightShift, true);
  assert.equal(effect.warmth, 0.8);
  assert.equal(effect.invert, true);
  assert.equal(effect.contrast, true);
  assert.equal(effect.reduceMotion, true);
  assert.equal(effect.cursorSize, 3);
  assert.equal(effect.sidebarSize, 'large');
  assert.equal(get(Date.UTC(2024, 0, 11, 7)).nightShift, false);
  assert.equal(get(Date.UTC(2024, 0, 11, 6, 59)).nightShift, true);
  assert.equal(get(instant, 'America/Los_Angeles').nightShift, false);
  assert.throws(() => projectPreferencesSceneEffects(state), /authored/);
  assert.throws(() => createPreferencesSceneEffects({ style: {}, isConnected: true }, {}), /actual original Root/);
});

test('scheduled power decisions cross authored local minutes once and never mutate the power master', () => {
  const state = create();
  const energy = state.configuration.energy;
  energy.scheduleEnabled = true;
  energy.wakeMinute = 480;
  energy.sleepMinute = 1320;
  const start = Date.UTC(2024, 0, 10, 7, 59), now = Date.UTC(2024, 0, 10, 22, 1);
  const before = JSON.stringify(state);
  const decision = scheduledPowerDecisions(state, { getSceneTime: () => now, previousTime: start, lastActivityTime: now, clock });
  assert.deepEqual(decision.events, [{ action: 'wake', at: Date.UTC(2024, 0, 10, 8), reason: 'schedule' }, { action: 'sleep', at: Date.UTC(2024, 0, 10, 22), reason: 'schedule' }]);
  assert.equal(decision.latestScheduled.action, 'sleep');
  assert.equal(decision.systemSleep, false);
  assert.deepEqual(scheduledPowerDecisions(state, { getSceneTime: () => now, previousTime: now, lastActivityTime: now, clock }).events, []);
  assert.equal(JSON.stringify(state), before);
  energy.preventSleep = true;
  const idle = scheduledPowerDecisions(state, { getSceneTime: () => now, previousTime: now, lastActivityTime: now - 7200000, clock, onBattery: true });
  assert.equal(idle.displaySleep, true);
  assert.equal(idle.systemSleep, false);
  assert.equal(scheduledPowerDecisions(state, { getSceneTime: () => now, previousTime: now + 1, lastActivityTime: now, clock }).status, 'rejected');
});

test('power schedule uses configured zone across a daylight-saving boundary and handles epoch start', () => {
  const state = create();
  state.configuration.energy.scheduleEnabled = true;
  state.configuration.energy.wakeMinute = 480;
  const now = Date.UTC(2024, 2, 10, 15, 1);
  const decisions = scheduledPowerDecisions(state, { getSceneTime: () => now, previousTime: Date.UTC(2024, 2, 10, 14, 59), lastActivityTime: now, clock: { timeZone: 'America/Los_Angeles' } });
  assert.deepEqual(decisions.events, [{ action: 'wake', at: Date.UTC(2024, 2, 10, 15), reason: 'schedule' }]);
  assert.equal(scheduledPowerDecisions(state, { getSceneTime: () => 1000, previousTime: 0, lastActivityTime: 0, clock }).status, 'applied');
});

for (const installed of profiles) test(`${installed.renderer}: real custom scene-update bytes prepare, decode and apply only scene preferences`, async () => {
  const state = createPreferencesState(installed, { sceneTime: instant });
  const manifest = preferencesUpdateManifests(installed)[0];
  const progress = [];
  const packageResult = await prepareSceneUpdate(installed, manifest.id, { getSceneTime: () => instant, guard: () => true, onProgress: record => progress.push(record) });
  assert.equal(packageResult.status, 'applied');
  const artifact = packageResult.artifact;
  assert.equal(artifact.mime, SCENE_UPDATE_MIME);
  assert.equal(artifact.name.endsWith(SCENE_UPDATE_EXTENSION), true);
  assert.equal(artifact.byteLength, new TextEncoder().encode(artifact.content).byteLength);
  assert.equal(progress.at(-1).bytesPrepared, artifact.byteLength);
  assert.equal(progress.at(-1).progress, 100);
  for (let i = 0; i < progress.length; i++) {
    assert.equal(progress[i].bytesPrepared, Math.min(artifact.byteLength, 256 * (i + 1)));
    assert.equal(progress[i].progress, Math.floor(progress[i].bytesPrepared * 100 / artifact.byteLength));
  }
  const decoded = decodeSceneUpdate(artifact.content, installed);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.document.createdAt, instant);
  const candidate = sceneUpdatePatch(decoded.document, state, installed);
  assert.equal(candidate.ok, true);
  assert.equal(candidate.configuration.accessibility.reduceMotion, true);
  assert.equal(candidate.configuration.general.scrollbars, 'always');
  assert.equal(state.configuration.accessibility.reduceMotion, false);
  assert.equal(state.profileId, installed.id);
  assert.deepEqual(candidate.configuration.network, state.configuration.network);
  assert.deepEqual(candidate.configuration.security, state.configuration.security);
  assert.deepEqual(candidate.configuration.updates, state.configuration.updates);
  const other = profiles.find(row => row.id !== installed.id);
  assert.equal(decodeSceneUpdate(artifact.content, other).ok, false);
});

test('release references honestly distinguish High Sierra App Store, Sonoma authored revision and Windows preview versus enablement', () => {
  const get = renderer => preferencesUpdateManifests(profiles.find(row => row.renderer === renderer))[0];
  assert.equal(get('high-sierra').entryPoint, 'app-store');
  assert.equal(get('mojave').release.version, '10.14.1');
  assert.equal(get('sonoma').release.version, '14.1');
  assert.match(get('sonoma').release.qualification, /not an Apple installer/);
  assert.match(get('golden-gate').release.qualification, /Nearest macOS 26/);
  assert.match(get('windows11').release.qualification, /KB5027397/);
  assert.match(get('windows11').release.qualification, /preview/i);
});

test('scene update decoder rejects OS/shared patches, duplicates, malformed types and oversized actual bytes', () => {
  const manifest = preferencesUpdateManifests(profile)[0];
  const artifact = encodeSceneUpdate(profile, manifest.id, { getSceneTime: () => instant });
  const base = JSON.parse(artifact.content);
  for (const patch of [[{ path: 'profileId', value: 'other' }], [{ path: 'sound.volume', value: 100 }], [{ path: 'security.firewall', value: false }], [{ path: '__proto__.polluted', value: true }], [{ path: 'accessibility.reduceMotion', value: 'true' }], [{ path: 'general.scrollbars', value: 'always' }, { path: 'general.scrollbars', value: 'automatic' }]]) {
    assert.equal(decodeSceneUpdate(JSON.stringify({ ...base, patch }), profile).ok, false);
  }
  assert.equal(decodeSceneUpdate(JSON.stringify({ ...base, scope: 'host-os' }), profile).ok, false);
  assert.equal(decodeSceneUpdate(JSON.stringify({ ...base, unexpected: true }), profile).ok, false);
  assert.equal(decodeSceneUpdate('{broken', profile).ok, false);
  assert.equal(decodeSceneUpdate('é'.repeat(SCENE_UPDATE_MAX_BYTES / 2 + 1), profile).ok, false);
  const reordered = { ...base, release: Object.fromEntries(Object.entries(base.release).reverse()) };
  assert.equal(decodeSceneUpdate(JSON.stringify(reordered), profile).ok, true);
});

test('actual byte preparation stops on stale ownership or authored time after progress, without a prepared artifact', async () => {
  const id = preferencesUpdateManifests(profile)[0].id;
  let active = true, time = instant, calls = 0;
  const result = await prepareSceneUpdate(profile, id, { getSceneTime: () => time, guard: () => active, onProgress: () => { calls++; active = false; } });
  assert.equal(result.status, 'rejected');
  assert.equal(result.error.code, 'stale_target');
  assert.equal(calls, 1);
  assert.equal(result.artifact, undefined);
  active = true;
  const changedTime = await prepareSceneUpdate(profile, id, { getSceneTime: () => time, guard: () => true, onProgress: () => { time++; } });
  assert.equal(changedTime.error.code, 'stale_target');
  assert.equal((await prepareSceneUpdate(profile, id, { getSceneTime: () => instant, guard: () => 1 })).status, 'rejected');
});

test('rejected progress acknowledgement never publishes a ready package', async () => {
  const id = preferencesUpdateManifests(profile)[0].id;
  const denied = await prepareSceneUpdate(profile, id, { getSceneTime: () => instant, guard: () => true, onProgress: () => ({ status: 'rejected', error: { code: 'limit_exceeded', message: 'Scene budget' } }) });
  assert.equal(denied.error.code, 'limit_exceeded');
  assert.equal(denied.artifact, undefined);
  const failed = await prepareSceneUpdate(profile, id, { getSceneTime: () => instant, guard: () => true, onProgress: () => { throw new Error('Original owner retired'); } });
  assert.equal(failed.error.code, 'preparation_failed');
  assert.equal(failed.artifact, undefined);
});

test('typed offline Siri produces actual registered command packets, not assistant answers or guessed apps', () => {
  const state = create();
  const parse = request => parsePreferencesSiri(state, request, { profile, commandAvailable: command => ['app.open', 'desktop.focus', 'sound.volume.set', 'sound.mute.set', 'spotlight.open'].includes(command) });
  assert.deepEqual(parse('Open Notes').packet, { command: 'app.open', target: { appId: 'notes' } });
  assert.deepEqual(parse(' Set volume to 37% ').packet, { command: 'sound.volume.set', payload: { volume: 37 } });
  assert.deepEqual(parse('Mute sound').packet, { command: 'sound.mute.set', payload: { muted: true } });
  assert.deepEqual(parse('Unmute sound').packet, { command: 'sound.mute.set', payload: { muted: false } });
  assert.deepEqual(parse('Show desktop').packet, { command: 'desktop.focus' });
  assert.equal(parse('Lock screen').error.code, 'unavailable');
  for (const request of ['Open unknown app', 'Set volume to 101', 'What is the weather?', 'Run rm -rf /', 'Buy an app']) assert.equal(parse(request).error.code, 'unrecognized_request');
  state.configuration.siri.enabled = false;
  assert.equal(parse('Open Notes').error.code, 'disabled');
});

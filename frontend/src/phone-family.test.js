import test from 'node:test';
import assert from 'node:assert/strict';
import { PHONE_PROFILES, createPhoneState, createMirroringState, createPhoneSession, phoneSession, phoneEndpoint, phoneSavedState, validatePhoneState, phoneAvailability } from './phone-family-state.js';
import { createPhoneCommands, createMirroringCommands, phoneCatalog, mirroringCatalog } from './phone-family-commands.js';
import { createContactsState, createContact } from './contacts-state.js';
import { createCallsState, startLocalCall } from './calls-state.js';
import { bluetoothDefaults } from './bluetooth-model.js';
import { createPhotoItem } from './photos-state.js';
import { MEDIA_VIDEO_FIXTURE } from './media-fixtures.js';
function harness(profileId = PHONE_PROFILES[3], mirror = false) {
 const profile = { id: profileId }, state = mirror ? createMirroringState(profile) : createPhoneState(profile);
 const contacts = createContactsState(profile), calls = createCallsState(profile), messages = { account: { name: 'Local Person', initials: 'LP', address: 'person@example.test', signedIn: true, status: 'Available' }, blockedAddresses: [], conversations: [] }, photos = { items: [] }, bluetooth = bluetoothDefaults();
 createContact(contacts, { name: 'Source Person', phone: '+1 555 0101' }, { time: 1 });
 const card = contacts.contacts.at(-1); card.phones.push({ label: 'work', value: '+1 555 0202' });
 const phone = { id: 'studio-phone', name: 'Studio iPhone', kind: 'other', available: true, paired: true, connected: true, batteryPercent: 84, pairing: 'confirm', passkey: '731204', soundOutputId: null, soundInputId: null }; bluetooth.devices.push(phone);
 const graphs = { contacts, calls, messages, photos, bluetooth };
 let actualWindow = { id: 'device-window', appId: mirror ? 'iphonemirroring' : 'phone' }, actualView = { available: () => true, focus: async (_id, guard) => guard() }, currentState = state;
 const nativeWindows = new Map(), forwarded = [];
 const ctx = { profile, getState: () => currentState, alive: () => true, getWindow: id => id === 'device-window' ? actualWindow : nativeWindows.get(id), getView: () => actualView, available: () => true, getShared: name => graphs[name], canCommit: () => true, tick: async () => {}, getSceneTime: () => 100,
  startCall: async (spec, ownership) => { if (!ownership.guard()) return { status: 'rejected', error: { code: 'stale_target' } }; return startLocalCall(calls, spec, 100, () => true, ownership.guard); },
  createWindow: async (appId, options) => { if (!options.isCurrent()) return null; const id = 'native-' + (nativeWindows.size + 1); nativeWindows.set(id, { id, appId }); calls.windows.push({ windowId: id, callId: options.callId ?? null }); return id; },
  forwardCall: async (name, target, payload, ownership) => { if (!ownership.guard()) return { status: 'rejected', error: { code: 'stale_target' } }; forwarded.push({ name, target, payload }); return { status: 'applied', target }; },
  executeOwned: async (packet, ownership) => { if (!ownership.guard()) return { status: 'rejected', error: { code: 'stale_target' } }; forwarded.push(packet); return { status: 'applied', target: packet.target }; },
 };
 const controller = mirror ? createMirroringCommands(ctx) : createPhoneCommands(ctx); controller.windowOpened(actualWindow);
 return { profile, state, graphs, ctx, controller, card, phone, forwarded, get session() { return phoneSession(state, 'device-window'); }, command: (suffix, payload = {}) => controller.handlers[`${mirror ? 'mirroring' : 'phone'}.${suffix}`]({ windowId: 'device-window' }, payload), replaceWindow: () => { actualWindow = { ...actualWindow }; }, replaceView: () => { actualView = { ...actualView }; }, replaceState: () => { currentState = { ...state }; } };
}
for (const profileId of PHONE_PROFILES) test('qualified all-profile state and exact secondary phone routing ' + profileId, async () => {
 const h = harness(profileId), original = h.session, calls = h.graphs.calls.calls;
 assert.equal(validatePhoneState(h.state, h.profile).ok, true); assert.ok(phoneAvailability(h.profile).disclosure);
 await h.command('contact.select', { contactId: h.card.id, endpointIndex: 1 });
 const endpoint = phoneEndpoint(h.graphs.contacts, h.session); assert.equal(endpoint.card, h.card); assert.equal(endpoint.endpoint, h.card.phones[1]);
 const result = await h.command('dial'); assert.equal(result.status, 'applied'); assert.equal(h.graphs.calls.calls, calls); assert.equal(calls.length, 1); assert.equal(calls[0].participants[0].address, '+1 555 0202'); assert.equal(calls[0].participants[0].contactId, h.card.id); assert.equal(h.session, original); assert.equal(Object.hasOwn(h.state, 'calls'), false);
});
test('favorites retain only source identity/literal selection, deletion makes projection unavailable', async () => {
 const h = harness(); await h.command('contact.select', { contactId: h.card.id, endpointIndex: 1 }); await h.command('favorite.toggle');
 assert.deepEqual(h.session.favorites, [{ contactId: h.card.id, address: '+1 555 0202' }]); await h.command('favorite.toggle'); assert.deepEqual(h.session.favorites, []);
 h.card.phones.splice(1, 1); assert.equal((await h.command('dial')).error.code, 'invalid_arguments'); assert.equal(h.graphs.calls.calls.length, 0);
});
test('quota/reentrant ownership refuses both UI publication and copied shadow authority', async () => {
 for (const mutate of [h => h.replaceWindow(), h => h.replaceView(), h => h.replaceState(), h => { h.graphs.contacts.contacts = [...h.graphs.contacts.contacts]; }, h => { h.graphs.messages.account.signedIn = false; }]) {
  const h = harness(), before = JSON.stringify(h.state); h.ctx.canCommit = () => { mutate(h); return true; }; assert.equal((await h.command('search', { query: 'Changed' })).error.code, 'stale_target'); assert.equal(JSON.stringify(h.state), before);
 }
 const h = harness(), before = JSON.stringify(h.state); h.ctx.canCommit = () => false; assert.equal((await h.command('search', { query: 'Changed' })).error.code, 'limit_exceeded'); assert.equal(JSON.stringify(h.state), before);
});
test('async original endpoint replacement cancels genuine Calls broker before any call', async () => {
 const h = harness(); await h.command('contact.select', { contactId: h.card.id, endpointIndex: 1 });
 h.ctx.startCall = async (spec, ownership) => { await Promise.resolve(); h.card.phones[1] = { ...h.card.phones[1] }; return ownership.guard() ? startLocalCall(h.graphs.calls, spec, 100, () => true) : { status: 'rejected', error: { code: 'stale_target' } }; };
 assert.equal((await h.command('dial')).error.code, 'stale_target'); assert.equal(h.graphs.calls.calls.length, 0);
});
test('mirroring auth is scene-local, source availability enforced and persistence discards auth/body', async () => {
 const h = harness(PHONE_PROFILES[3], true); assert.equal((await h.command('tab.set', { tab: 'photos' })).error.code, 'device_locked');
 assert.equal((await h.command('authenticate', { code: '000000' })).error.code, 'authentication_failed'); assert.equal((await h.command('authenticate', { code: '482316' })).status, 'applied');
 assert.equal((await h.command('tab.set', { tab: 'photos' })).status, 'applied'); h.session.body = 'Ephemeral'; const saved = phoneSavedState(h.state); assert.equal(saved.windows[0].authenticated, false); assert.equal(saved.windows[0].body, ''); assert.equal(h.session.authenticated, true);
 h.phone.connected = false; assert.equal((await h.command('tab.set', { tab: 'contacts' })).error.code, 'device_locked'); assert.equal((await h.command('lock')).status, 'applied'); assert.equal(h.session.authenticated, false);
});
test('only one virtual phone window authorizes; secondary windows cannot borrow authorization', async () => {
 const h = harness(PHONE_PROFILES[3], true); h.state.windows.push(createPhoneSession('second', 'iphonemirroring')); h.state.windows[1].authenticated = true;
 assert.equal((await h.command('authenticate', { code: '482316' })).error.code, 'device_busy'); assert.equal(h.session.authenticated, false);
});
test('Calls preferences/block route through actual native session and original source guard', async () => {
 const h = harness(); await h.command('contact.select', { contactId: h.card.id, endpointIndex: 1 });
 assert.equal((await h.command('block')).status, 'applied'); assert.equal(h.forwarded[0].name, 'calls.block'); assert.equal(h.forwarded[0].payload.address, h.card.phones[1].value); assert.equal(h.forwarded[0].target.callId, null);
});
test('genuine scene raster refuses stale sources rather than publishing fake clipboard pixels', async () => {
 const h = harness(), clipboard = [];
 h.ctx.captureFrame = async ({ guard }) => { await Promise.resolve(); h.replaceWindow(); return { canvas: { width: 10, height: 10, toDataURL: () => 'data:image/png;base64,aA==' }, bounds: { x: 0, y: 0, width: 10, height: 10 }, imageRect: { x: 0, y: 0, width: 10, height: 10 } }; };
 h.ctx.setImageClipboard = spec => { clipboard.push(spec); return { status: 'applied' }; };
 assert.equal((await h.command('capture.copy')).error.code, 'stale_target'); assert.deepEqual(clipboard, []);
});
test('catalog entries are actual definitions and actor rejects open payload aliases', async () => {
 for (const catalog of [phoneCatalog, mirroringCatalog]) for (const definition of Object.values(catalog)) { assert.ok(Array.isArray(definition.profiles)); assert.equal(definition.requestSchema.additionalProperties, false); }
 const h = harness(); assert.equal((await h.command('digits.set', { digits: '123', hostDial: true })).error.code, 'invalid_arguments'); assert.equal((await h.command('digits.set', { digits: 'not a phone' })).error.code, 'invalid_arguments');
 h.controller.dispose(); assert.equal((await h.command('search', { query: '' })).error.code, 'stale_target');
});
test('reentrant source-card/member changes refuse UI source-reference publication', async () => {
 const h = harness(), before = JSON.stringify(h.state);
 h.ctx.canCommit = () => { h.card.phones[1] = { ...h.card.phones[1] }; return true; };
 assert.equal((await h.command('contact.select', { contactId: h.card.id, endpointIndex: 1 })).error.code, 'stale_target'); assert.equal(JSON.stringify(h.state), before);
});
test('reentrant virtual phone replacement cancels scene authorization', async () => {
 const h = harness(PHONE_PROFILES[3], true);
 h.ctx.canCommit = () => { const index = h.graphs.bluetooth.devices.indexOf(h.phone); h.graphs.bluetooth.devices[index] = { ...h.phone }; return true; };
 assert.equal((await h.command('authenticate', { code: '482316' })).error.code, 'stale_target'); assert.equal(h.session.authenticated, false);
});
test('native media acknowledgement rejects a replaced original Photos item after await', async () => {
 const h = harness(PHONE_PROFILES[3], true);
 await h.command('authenticate', { code: '482316' });
 const photo = createPhotoItem('movie', { ...MEDIA_VIDEO_FIXTURE, title: 'Authored test movie', takenAt: '2026-01-01T12:00:00.000Z', inLibrary: true, authored: true });
 h.graphs.photos.items.push(photo); await h.command('photo.select', { photoId: photo.id });
 const view = h.ctx.getView(); view.photoPlayback = async () => { await Promise.resolve(); h.graphs.photos.items[0] = { ...photo }; return { playing: true, position: 0, duration: 1 }; };
 assert.equal((await h.command('photo.playback', { action: 'play' })).error.code, 'stale_target');
 assert.equal((await h.command('photo.playback', { action: 'play', position: 0 })).error.code, 'invalid_arguments');
});

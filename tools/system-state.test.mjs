import { expect, test } from 'bun:test';
import { systemDefaults, recordSystemRecent, clearSystemRecents, validateSystemState, systemStorageSummary } from '../frontend/src/system-state.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { setWifiPower, connectWifiNetwork, disconnectWifiNetwork } from '../frontend/src/wifi-model.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');

test('reusing an item moves it to the front once without changing the other category', () => {
  const state = systemDefaults(profile);
  recordSystemRecent(state, 'applications', 'notes');
  recordSystemRecent(state, 'documents', 'file-7');
  recordSystemRecent(state, 'applications', 'safari');
  recordSystemRecent(state, 'applications', 'notes');
  expect(state.recentItems.applications).toEqual(['notes', 'safari']);
  expect(state.recentItems.documents).toEqual(['file-7']);
});

test('each recent category evicts only its oldest entry at its documented capacity', () => {
  const state = systemDefaults(profile);
  recordSystemRecent(state, 'applications', 'notes');
  for (let index = 1; index <= 12; index++) recordSystemRecent(state, 'documents', `file-${index}`);
  expect(state.recentItems.documents).toEqual(Array.from({ length: 10 }, (_, index) => `file-${12 - index}`));
  expect(state.recentItems.applications).toEqual(['notes']);
  recordSystemRecent(state, 'documents', 'file-6');
  expect(state.recentItems.documents).toEqual(['file-6', 'file-12', 'file-11', 'file-10', 'file-9', 'file-8', 'file-7', 'file-5', 'file-4', 'file-3']);
});

test('clearing and later reopening never revives old or another account’s history', () => {
  const alex = systemDefaults(profile), casey = systemDefaults(profile);
  alex.servers.push({ id: 'studio', name: 'Studio 🎬', folderId: 'personal', available: true });
  casey.servers.push({ id: 'archive', name: 'Archive', folderId: 'casey-files', available: false });
  recordSystemRecent(alex, 'servers', 'studio');
  recordSystemRecent(casey, 'servers', 'archive');
  const definitions = structuredClone([alex.servers, casey.servers]);
  recordSystemRecent(alex, 'applications', 'notes');
  recordSystemRecent(alex, 'documents', 'file-7');
  recordSystemRecent(casey, 'applications', 'mail');
  recordSystemRecent(casey, 'documents', 'file-8');
  clearSystemRecents(alex);
  recordSystemRecent(alex, 'applications', 'safari');
  expect(alex.recentItems).toEqual({ applications: ['safari'], documents: [], servers: [] });
  expect(casey.recentItems).toEqual({ applications: ['mail'], documents: ['file-8'], servers: ['archive'] });
  expect([alex.servers, casey.servers]).toEqual(definitions);
});

test('unrecognized applications, duplicate/overflow history and non-data properties cannot become saved account state', () => {
  const valid = systemDefaults(profile);
  recordSystemRecent(valid, 'applications', 'notes');
  recordSystemRecent(valid, 'documents', 'file-7');
  expect(validateSystemState(valid, profile)).toEqual({ ok: true });
  for (const mutate of [
    state => state.recentItems.applications.push('another-profile-app'),
    state => state.recentItems.applications.push('notes'),
    state => state.recentItems.documents.push(...Array.from({ length: 10 }, (_, i) => `extra-${i}`)),
    state => state.recentItems.documents.push(''),
    state => state.recentItems.documents.push('__proto__'),
    state => { state.recentItems.unknown = []; },
  ]) {
    const state = structuredClone(valid); mutate(state);
    expect(validateSystemState(state, profile).ok).toBe(false);
  }
  let reads = 0;
  const actor = { computerName: valid.computerName, reopenWindows: valid.reopenWindows, storage: valid.storage, wifi: valid.wifi, servers: valid.servers,
    recentItems: { applications: ['notes'], servers: [] } };
  Object.defineProperty(actor.recentItems, 'documents', { enumerable: true, get() { reads++; return []; } });
  expect(validateSystemState(actor, profile).ok).toBe(false);
  expect(reads).toBe(0);
});

test('a saved computer name retains literal Unicode without accepting empty, multiline or accessor data', () => {
  const state = systemDefaults(profile);
  state.computerName = 'Studio 🎬 — Mac';
  recordSystemRecent(state, 'applications', 'notes');
  expect(validateSystemState(state, profile).ok).toBe(true);
  for (const name of ['', '   ', 'Mac\nSecond line', 'Mac\rName', 'x'.repeat(257), null, 42]) {
    const candidate = { ...state, computerName: name };
    expect(validateSystemState(candidate, profile).ok).toBe(false);
  }
  let reads = 0;
  const candidate = { reopenWindows: state.reopenWindows, recentItems: state.recentItems, servers: state.servers, storage: state.storage, wifi: state.wifi };
  Object.defineProperty(candidate, 'computerName', { enumerable: true, get() { reads++; return 'Borrowed name'; } });
  expect(validateSystemState(candidate, profile).ok).toBe(false);
  expect(reads).toBe(0);
  expect(state.computerName).toBe('Studio 🎬 — Mac');
  expect(state.recentItems.applications).toEqual(['notes']);
});

test('reopen-window preferences preserve explicit false and reject missing, coerced or accessor saved data', () => {
  const state = systemDefaults(profile);
  state.reopenWindows = false;
  expect(validateSystemState(JSON.parse(JSON.stringify(state)), profile).ok).toBe(true);
  for (const value of ['false', 0, null, undefined]) {
    expect(validateSystemState({ ...state, reopenWindows: value }, profile).ok).toBe(false);
  }
  const missing = { ...state }; delete missing.reopenWindows;
  expect(validateSystemState(missing, profile).ok).toBe(false);
  let reads = 0;
  const actor = { ...state };
  Object.defineProperty(actor, 'reopenWindows', { enumerable: true, get() { reads++; return false; } });
  expect(validateSystemState(actor, profile).ok).toBe(false);
  expect(reads).toBe(0);
});

test('storage counts real UTF-8 and decoded PDF payloads once and retains nested Trash until deletion', () => {
  const folder = { id: 'old-folder', parentId: 'disk', kind: 'folder', content: 'not file payload', deleted: true };
  const store = { files: [
    { id: 'disk', parentId: null, kind: 'folder', content: '', deleted: false },
    folder,
    { id: 'text', parentId: 'disk', kind: 'document', content: 'Aé🎬', deleted: false },
    { id: 'pdf', parentId: 'old-folder', kind: 'document', content: 'data:application/pdf;base64,JVBERg==', deleted: false },
    { id: 'discard', parentId: 'disk', kind: 'document', content: 'xy', deleted: true },
    { id: 'generated', parentId: 'disk', kind: 'document', content: 'not user disk allocation', readOnly: true, deleted: false },
  ] };
  const initial = systemStorageSummary(profile, store);
  expect(initial.documentsBytes).toBe(7);
  expect(initial.trashBytes).toBe(6);
  expect(initial.virtualFileBytes).toBe(13);
  expect(initial.virtualFileCount).toBe(3);
  expect(initial.usedBytes).toBe(initial.systemBytes + initial.applicationsBytes + 13);
  expect(initial.usedBytes + initial.availableBytes).toBe(initial.capacityBytes);
  folder.deleted = false;
  const restored = systemStorageSummary(profile, store);
  expect(restored.documentsBytes).toBe(11);
  expect(restored.trashBytes).toBe(2);
  expect(restored.usedBytes).toBe(initial.usedBytes);
  store.files = store.files.filter(file => file.id !== 'discard');
  const emptied = systemStorageSummary(profile, store);
  expect(emptied.trashBytes).toBe(0);
  expect(emptied.virtualFileCount).toBe(2);
  expect(emptied.availableBytes).toBe(initial.availableBytes + 2);
});

test('server reuse deduplicates and evicts only old server history, retaining real definitions and other categories', () => {
  const state = systemDefaults(profile);
  state.servers = Array.from({ length: 12 }, (_, index) => ({
    id: `server-${index}`, name: `Share ${index}`, folderId: 'personal', available: true,
  }));
  recordSystemRecent(state, 'applications', 'notes');
  recordSystemRecent(state, 'documents', 'file-7');
  for (const server of state.servers) recordSystemRecent(state, 'servers', server.id);
  recordSystemRecent(state, 'servers', 'server-6');
  expect(state.recentItems.servers).toEqual(['server-6', 'server-11', 'server-10', 'server-9', 'server-8',
    'server-7', 'server-5', 'server-4', 'server-3', 'server-2']);
  expect(state.recentItems.applications).toEqual(['notes']);
  expect(state.recentItems.documents).toEqual(['file-7']);
  expect(validateSystemState(state, profile)).toEqual({ ok: true });
});

test('only closed unique bounded server definitions and registered history enter saved account state', () => {
  const valid = systemDefaults(profile);
  valid.servers = [{ id: 'studio', name: 'Studio 🎬', folderId: 'personal', available: false }];
  recordSystemRecent(valid, 'servers', 'studio');
  expect(validateSystemState(valid, profile)).toEqual({ ok: true });
  for (const mutate of [
    state => { delete state.servers; },
    state => { delete state.recentItems.servers; },
    state => { state.recentItems.servers.push('missing'); },
    state => { state.recentItems.servers.push('studio'); },
    state => { state.servers.push({ ...state.servers[0] }); },
    state => { state.servers[0].folderId = '__proto__'; },
    state => { state.servers[0].name = 'Two\nlines'; },
    state => { state.servers[0].available = 'yes'; },
    state => { state.servers[0].hostCredentials = 'forbidden'; },
    state => { state.servers.length = 128; },
    state => { state.servers = Array.from({ length: 129 }, (_, index) => ({ ...state.servers[0], id: `share-${index}` })); },
  ]) {
    const state = structuredClone(valid); mutate(state);
    expect(validateSystemState(state, profile).ok).toBe(false);
  }
  let reads = 0;
  const candidate = structuredClone(valid);
  Object.defineProperty(candidate.servers[0], 'name', { enumerable: true, get() { reads++; return 'Borrowed'; } });
  expect(validateSystemState(candidate, profile).ok).toBe(false);
  expect(reads).toBe(0);
  const arrayCandidate = structuredClone(valid);
  Object.defineProperty(arrayCandidate.servers, '0', { enumerable: true, get() { reads++; return valid.servers[0]; } });
  expect(validateSystemState(arrayCandidate, profile).ok).toBe(false);
  expect(reads).toBe(0);
});

test('account Wi-Fi stays isolated and valid across joins, disconnects and power cycles', () => {
  const alex = systemDefaults(profile), casey = systemDefaults(profile);
  const other = structuredClone(casey), unrelated = structuredClone(alex);
  connectWifiNetwork(alex.wifi, 'guest-wifi');
  expect(alex.wifi.connectedNetworkId).toBe('guest-wifi');
  expect(validateSystemState(alex, profile)).toEqual({ ok: true });
  disconnectWifiNetwork(alex.wifi, 'guest-wifi');
  setWifiPower(alex.wifi, false);
  setWifiPower(alex.wifi, true);
  expect(alex.wifi.connectedNetworkId).toBeNull();
  expect(validateSystemState(alex, profile)).toEqual({ ok: true });
  expect(casey).toEqual(other);
  expect({ ...alex, wifi: unrelated.wifi }).toEqual(unrelated);
});

test('saved accounts require complete Wi-Fi and reject inconsistent or accessor data without upgrading it', () => {
  const state = systemDefaults(profile), before = structuredClone(state);
  for (const mutate of [
    value => { delete value.wifi; },
    value => { value.wifi = null; },
    value => { value.wifi.powered = false; },
    value => { value.wifi.networks[0].known = false; },
    value => { value.wifi.connectedNetworkId = 'missing'; },
    value => { value.wifi.extra = true; },
  ]) {
    const candidate = structuredClone(state); mutate(candidate);
    const invalid = structuredClone(candidate);
    expect(validateSystemState(candidate, profile).ok).toBe(false);
    expect(candidate).toEqual(invalid);
  }
  let reads = 0;
  const candidate = { ...state };
  Object.defineProperty(candidate, 'wifi', { enumerable: true, get() { reads++; return state.wifi; } });
  expect(validateSystemState(candidate, profile).ok).toBe(false);
  expect(reads).toBe(0);
  expect(state).toEqual(before);
});

import { expect, test } from 'bun:test';
import { systemDefaults, recordSystemRecent, clearSystemRecents, validateSystemState, systemStorageSummary } from '../frontend/src/system-state.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');

test('reusing an item moves it to the front once without changing the other category', () => {
  const state = systemDefaults(profile);
  recordSystemRecent(state, 'applications', 'notes');
  recordSystemRecent(state, 'documents', 'file-7');
  recordSystemRecent(state, 'applications', 'safari');
  recordSystemRecent(state, 'applications', 'notes');
  expect(state.recentItems).toEqual({ applications: ['notes', 'safari'], documents: ['file-7'] });
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
  recordSystemRecent(alex, 'applications', 'notes');
  recordSystemRecent(alex, 'documents', 'file-7');
  recordSystemRecent(casey, 'applications', 'mail');
  recordSystemRecent(casey, 'documents', 'file-8');
  clearSystemRecents(alex);
  recordSystemRecent(alex, 'applications', 'safari');
  expect(alex.recentItems).toEqual({ applications: ['safari'], documents: [] });
  expect(casey.recentItems).toEqual({ applications: ['mail'], documents: ['file-8'] });
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
    state => { state.recentItems.servers = []; },
  ]) {
    const state = structuredClone(valid); mutate(state);
    expect(validateSystemState(state, profile).ok).toBe(false);
  }
  let reads = 0;
  const actor = { computerName: valid.computerName, recentItems: { applications: ['notes'] } };
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
  const candidate = { recentItems: state.recentItems };
  Object.defineProperty(candidate, 'computerName', { enumerable: true, get() { reads++; return 'Borrowed name'; } });
  expect(validateSystemState(candidate, profile).ok).toBe(false);
  expect(reads).toBe(0);
  expect(state.computerName).toBe('Studio 🎬 — Mac');
  expect(state.recentItems.applications).toEqual(['notes']);
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

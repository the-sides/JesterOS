import { expect, test } from 'bun:test';
import { systemDefaults, recordSystemRecent, clearSystemRecents, validateSystemState } from '../frontend/src/system-state.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');

test('reusing an item moves it to the front once without changing the other category', () => {
  const state = systemDefaults();
  recordSystemRecent(state, 'applications', 'notes');
  recordSystemRecent(state, 'documents', 'file-7');
  recordSystemRecent(state, 'applications', 'safari');
  recordSystemRecent(state, 'applications', 'notes');
  expect(state.recentItems).toEqual({ applications: ['notes', 'safari'], documents: ['file-7'] });
});

test('each recent category evicts only its oldest entry at its documented capacity', () => {
  const state = systemDefaults();
  recordSystemRecent(state, 'applications', 'notes');
  for (let index = 1; index <= 12; index++) recordSystemRecent(state, 'documents', `file-${index}`);
  expect(state.recentItems.documents).toEqual(Array.from({ length: 10 }, (_, index) => `file-${12 - index}`));
  expect(state.recentItems.applications).toEqual(['notes']);
  recordSystemRecent(state, 'documents', 'file-6');
  expect(state.recentItems.documents).toEqual(['file-6', 'file-12', 'file-11', 'file-10', 'file-9', 'file-8', 'file-7', 'file-5', 'file-4', 'file-3']);
});

test('clearing and later reopening never revives old or another account’s history', () => {
  const alex = systemDefaults(), casey = systemDefaults();
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
  const valid = systemDefaults();
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
  const actor = { recentItems: { applications: ['notes'] } };
  Object.defineProperty(actor.recentItems, 'documents', { enumerable: true, get() { reads++; return []; } });
  expect(validateSystemState(actor, profile).ok).toBe(false);
  expect(reads).toBe(0);
});

import { test, expect } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createDefaultSceneSeed, validateSceneSeed } from '../frontend/src/scene-seed.js';
import { createMacApplicationFiles } from '../frontend/src/mac-application-files.js';
import { spotlightPreferencesDefaults, validateSpotlightPreferences, spotlightPreferencesSummary, spotlightFileExcluded } from '../frontend/src/spotlight-preferences.js';
import { createSpotlightPreferencesCommands } from '../frontend/src/spotlight-preferences-commands.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');
function root() {
  const seed = createDefaultSceneSeed(profile);
  let state = seed.system.spotlight, foreground = true, budget = Infinity, changed = 0;
  const deltas = [];
  const context = { profile, getState: () => state, available: () => foreground,
    getFolders: () => [...seed.files.files, ...createMacApplicationFiles(profile, seed.files.sceneTime)]
      .filter(file => file.kind === 'folder').map(file => ({ fileId: file.id, label: file.name, deleted: file.deleted })),
    canCommit: delta => { deltas.push(delta); return delta <= budget; }, onChanged: () => { changed++; } };
  const controller = createSpotlightPreferencesCommands(context);
  return { seed, context, controller, state: () => state, deltas, changes: () => changed,
    replace: value => { state = value; }, lock: () => { foreground = false; }, budget: value => { budget = value; },
    configure: (payload, target = {}) => controller.handlers['spotlight.preferences.configure'](target, payload) };
}

test('privacy follows exact identity and actual ancestors through retained and readonly folders, with cycles bounded', () => {
  const seed = createDefaultSceneSeed(profile);
  const files = [...seed.files.files, ...createMacApplicationFiles(profile, seed.files.sceneTime)];
  const document = files.find(file => file.kind === 'document' && file.parentId === 'desktop');
  expect(spotlightFileExcluded(document.id, files, ['desktop'])).toBe(true);
  expect(spotlightFileExcluded(document.id, files, ['downloads'])).toBe(false);
  expect(spotlightFileExcluded('desktop', files, ['desktop'])).toBe(true);
  const bundle = files.find(file => file.kind === 'application' && file.appId === 'notes');
  expect(spotlightFileExcluded(bundle.id, files, ['mac-application-folder:System/Applications'])).toBe(true);
  expect(spotlightFileExcluded(bundle.id, files, ['mac-application-folder:Applications'])).toBe(false);
  expect(spotlightFileExcluded(bundle.id, files, ['disk'])).toBe(true);
  const cycle = [{ id: 'folder-a', parentId: 'folder-b' }, { id: 'folder-b', parentId: 'folder-a' }];
  expect(spotlightFileExcluded('folder-a', cycle, ['downloads'])).toBe(false);
  expect(spotlightFileExcluded('folder-a', new Map(cycle.map(file => [file.id, file])), ['folder-b'])).toBe(true);
  expect(spotlightFileExcluded('missing', files, ['disk'])).toBe(false);
});

test('descriptor-first preferences reject getters, sparse/duplicate/foreign categories and bounded identity violations', () => {
  let reads = 0;
  const accessor = spotlightPreferencesDefaults();
  Object.defineProperty(accessor, 'indexingEnabled', { enumerable: true, get() { reads++; return true; } });
  expect(validateSpotlightPreferences(accessor).ok).toBe(false);
  const arrayAccessor = spotlightPreferencesDefaults();
  Object.defineProperty(arrayAccessor.enabledCategories, '0', { enumerable: true, get() { reads++; return 'apps'; } });
  expect(validateSpotlightPreferences(arrayAccessor).ok).toBe(false);
  expect(reads).toBe(0);
  for (const change of [
    state => { state.enabledCategories = ['apps', 'apps']; },
    state => { state.enabledCategories = ['host-web']; },
    state => { state.enabledCategories = new Array(1); },
    state => { state.excludedFolderIds = ['disk', 'disk']; },
    state => { state.excludedFolderIds = ['constructor']; },
    state => { state.excludedFolderIds = ['folder\nname']; },
    state => { state.excludedFolderIds = ['a'.repeat(257)]; },
    state => { state.excludedFolderIds = Array.from({ length: 129 }, (_, index) => `folder-${index}`); },
    state => { state.privateQuery = 'secret'; },
    state => { state.indexingEnabled = 1; },
  ]) {
    const state = spotlightPreferencesDefaults(); change(state);
    expect(validateSpotlightPreferences(state).ok).toBe(false);
  }
});

test('category and index switches are independent, allow no categories, and results/summaries detach from callers', () => {
  const alex = root(), casey = root(), requested = ['calculator', 'dictionary'];
  const result = alex.configure({ enabledCategories: requested, indexingEnabled: false });
  expect(result.status).toBe('applied');
  requested.push('mail'); result.target.preferences.enabledCategories.push('contacts');
  const summary = alex.controller.summary(); summary.excludedFolderIds.push('disk');
  expect(alex.state().enabledCategories).toEqual(['calculator', 'dictionary']);
  expect(alex.state().excludedFolderIds).toEqual([]);
  expect(alex.state().indexingEnabled).toBe(false);
  expect(casey.state().indexingEnabled).toBe(true);
  expect(casey.state().enabledCategories.includes('mail')).toBe(true);
  expect(alex.configure({ enabledCategories: [] }).status).toBe('applied');
  expect(alex.state().enabledCategories).toEqual([]);
  expect(alex.state().indexingEnabled).toBe(false);
  expect(validateSceneSeed(alex.seed, profile).ok).toBe(true);
  expect(spotlightPreferencesSummary(alex.state()).enabledCategories).toEqual([]);
});

test('configure requires real canonical folders including trashed retained and generated readonly folders', () => {
  const scene = root(), downloads = scene.seed.files.files.find(file => file.id === 'downloads');
  scene.seed.files.files.push({ ...structuredClone(downloads), id: 'file-100', name: 'Private folder', deleted: true });
  scene.seed.files.nextFileId = Math.max(101, scene.seed.files.nextFileId);
  const folders = ['file-100', 'mac-application-folder:System/Applications'];
  expect(scene.configure({ excludedFolderIds: folders }).status).toBe('applied');
  expect(validateSceneSeed(scene.seed, profile).ok).toBe(true);
  const before = structuredClone(scene.state());
  for (const id of ['missing', 'itinerary', 'mac-application:notes']) {
    expect(scene.configure({ excludedFolderIds: [id], indexingEnabled: false }).error.code).toBe('invalid_arguments');
    expect(scene.state()).toEqual(before);
  }
});

test('growth includes decimal array keys and complete-scene quota rejection leaves every supplied field unchanged', () => {
  const scene = root(), folder = scene.seed.files.files.find(file => file.id === 'downloads');
  for (let index = 0; index < 11; index++) scene.seed.files.files.push({ ...structuredClone(folder), id: `f${index}`, name: `Folder ${index}` });
  const requested = Array.from({ length: 11 }, (_, index) => `f${index}`);
  // f0..f9: 20 value units + 10 key units; f10: 3 value + 2 key units.
  scene.budget(34);
  const before = structuredClone(scene.state());
  expect(scene.configure({ excludedFolderIds: requested, indexingEnabled: false }).error.code).toBe('limit_exceeded');
  expect(scene.deltas).toEqual([35]); expect(scene.state()).toEqual(before); expect(scene.changes()).toBe(0);
  scene.budget(35);
  expect(scene.configure({ excludedFolderIds: requested, indexingEnabled: false }).status).toBe('applied');
  expect(scene.state().excludedFolderIds).toEqual(requested); expect(scene.state().indexingEnabled).toBe(false);
  scene.budget(0);
  expect(scene.configure({ excludedFolderIds: [] }).status).toBe('applied');
  expect(scene.deltas.at(-1)).toBe(-35);
});

test('writability is checked across the complete planned transition before any mutation', () => {
  for (const freeze of [
    state => Object.freeze(state.excludedFolderIds),
    state => Object.defineProperty(state, 'indexingEnabled', { writable: false }),
    state => Object.defineProperty(state.enabledCategories, '0', { writable: false }),
    state => Object.defineProperty(state.enabledCategories, '7', { configurable: false }),
  ]) {
    const scene = root(); freeze(scene.state()); const before = structuredClone(scene.state());
    expect(scene.configure({ enabledCategories: ['dictionary'], excludedFolderIds: ['disk'], indexingEnabled: false }).error.code).toBe('invalid_arguments');
    expect(scene.state()).toEqual(before); expect(scene.changes()).toBe(0);
  }
});

test('budget callbacks cannot redirect original state, alter its descriptors, drop folders or lose foreground and still commit', () => {
  const replacement = root(), original = replacement.state();
  replacement.context.canCommit = () => { replacement.replace(spotlightPreferencesDefaults()); return true; };
  expect(replacement.configure({ indexingEnabled: false }).error.code).toBe('stale_target');
  expect(original.indexingEnabled).toBe(true); expect(replacement.state().indexingEnabled).toBe(true);
  const descriptors = root();
  descriptors.context.canCommit = () => { Object.defineProperty(descriptors.state(), 'indexingEnabled', { writable: false }); return true; };
  expect(descriptors.configure({ excludedFolderIds: ['disk'], indexingEnabled: false }).error.code).toBe('stale_target');
  expect(descriptors.state().excludedFolderIds).toEqual([]);
  const folders = root();
  folders.context.canCommit = () => { folders.context.getFolders = () => []; return true; };
  expect(folders.configure({ excludedFolderIds: ['disk'], indexingEnabled: false }).error.code).toBe('stale_target');
  expect(folders.state().indexingEnabled).toBe(true);
  const foreground = root();
  foreground.context.canCommit = () => { foreground.lock(); return true; };
  expect(foreground.configure({ indexingEnabled: false }).error.code).toBe('unavailable');
  expect(foreground.state().indexingEnabled).toBe(true);
});

test('closed command input does not execute getter payloads or authorize malformed live state', () => {
  const scene = root(); let reads = 0;
  const payload = {};
  Object.defineProperty(payload, 'indexingEnabled', { enumerable: true, get() { reads++; return false; } });
  expect(scene.configure(payload).error.code).toBe('invalid_arguments');
  expect(scene.configure({}).error.code).toBe('invalid_arguments');
  expect(scene.configure({ indexingEnabled: false, query: 'secret' }).error.code).toBe('invalid_arguments');
  expect(scene.configure({ indexingEnabled: false }, { windowId: 'foreign' }).error.code).toBe('invalid_arguments');
  expect(reads).toBe(0); expect(scene.state().indexingEnabled).toBe(true);
  delete scene.state().excludedFolderIds;
  expect(scene.configure({ excludedFolderIds: [] }).error.code).toBe('invalid_arguments');
});

test('canonical privacy accepts exactly 128 folders and rejects the 129th without changing prior exclusions', () => {
  const scene = root(), folder = scene.seed.files.files.find(file => file.id === 'downloads');
  const ids = Array.from({ length: 129 }, (_, index) => `private-${index}`);
  for (const id of ids) scene.seed.files.files.push({ ...structuredClone(folder), id, name: id });
  expect(scene.configure({ excludedFolderIds: ids.slice(0, 128) }).status).toBe('applied');
  expect(validateSceneSeed(scene.seed, profile).ok).toBe(true);
  const before = structuredClone(scene.state());
  expect(scene.configure({ excludedFolderIds: ids, indexingEnabled: false }).error.code).toBe('invalid_arguments');
  expect(scene.state()).toEqual(before);
  expect(scene.configure({ excludedFolderIds: [ids[0], ids[0]] }).error.code).toBe('invalid_arguments');
  expect(scene.state()).toEqual(before);
  expect(scene.configure({ excludedFolderIds: [] }).status).toBe('applied');
  expect(scene.state().excludedFolderIds).toEqual([]);
});

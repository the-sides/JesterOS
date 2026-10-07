import { isRecord, rejected } from './feature-commands.js';
import { defineCommand, object, empty, identity, match } from './command-schema.js';
import { spotlightPreferencesSchema, validateSpotlightPreferences, spotlightPreferencesSummary } from './spotlight-preferences.js';

const keys = ['enabledCategories', 'excludedFolderIds', 'indexingEnabled'];
const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && allowed.includes(key) && descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
  }) && required.every(key => Object.hasOwn(value, key));
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use closed literal Spotlight preferences and current canonical folder identities.');
const stale = () => rejected('stale_target', 'The original retained Spotlight preferences or canonical folders changed.');
const unavailable = () => rejected('unavailable', 'The original foreground Golden Gate desktop is unavailable.');
const descriptorSame = (a, b) => a && b && a.enumerable === b.enumerable && a.configurable === b.configurable
  && a.writable === b.writable && a.value === b.value && a.get === b.get && a.set === b.set;
const snapshot = object => ({ object, prototype: Object.getPrototypeOf(object), extensible: Object.isExtensible(object), descriptors: Object.getOwnPropertyDescriptors(object) });
const unchanged = entry => Object.getPrototypeOf(entry.object) === entry.prototype && Object.isExtensible(entry.object) === entry.extensible
  && Reflect.ownKeys(entry.object).length === Reflect.ownKeys(entry.descriptors).length
  && Reflect.ownKeys(entry.descriptors).every(key => descriptorSame(Object.getOwnPropertyDescriptor(entry.object, key), entry.descriptors[key]));
const listText = values => values.reduce((total, value, index) => total + value.length + String(index).length, 0);
const sameList = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
function foldersFrom(ctx) {
  const folders = ctx.getFolders();
  if (!Array.isArray(folders) || Object.getPrototypeOf(folders) !== Array.prototype
    || Reflect.ownKeys(folders).length !== folders.length + 1) return null;
  const result = [], seen = new Set();
  for (let index = 0; index < folders.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(folders, String(index));
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return null;
    const folder = descriptor.value;
    if (!fields(folder, ['fileId', 'label', 'deleted']) || typeof folder.label !== 'string' || !folder.label.length
      || typeof folder.deleted !== 'boolean' || !validateSpotlightPreferences({ enabledCategories: [], excludedFolderIds: [folder.fileId], indexingEnabled: true }).ok
      || seen.has(folder.fileId)) return null;
    seen.add(folder.fileId);
    result.push({ fileId: folder.fileId, label: folder.label, deleted: folder.deleted });
  }
  return result;
}
const sameFolders = (a, b) => b !== null && a.length === b.length && a.every((folder, index) =>
  folder.fileId === b[index].fileId && folder.label === b[index].label && folder.deleted === b[index].deleted);
function writableList(array, plan) {
  if (array.length !== plan.length && Object.getOwnPropertyDescriptor(array, 'length').writable !== true
    || plan.length > array.length && !Object.isExtensible(array)) return false;
  for (let index = 0; index < array.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(array, String(index));
    if (index >= plan.length ? descriptor.configurable !== true : array[index] !== plan[index] && descriptor.writable !== true) return false;
  }
  return true;
}

export function createSpotlightPreferencesCommands(ctx) {
  const summary = () => spotlightPreferencesSummary(ctx.getState());
  function supported() { return ctx.profile?.id === 'macos-golden-gate-27.0.1' && ctx.profile.capabilities?.includes('shell.spotlight'); }
  function available() { try { return supported() && ctx.available() === true; } catch { return false; } }
  function current(root) {
    try { return ctx.getState() === root.state && root.snapshots.every(unchanged); } catch { return false; }
  }
  function begin() {
    try {
      if (!supported()) return { error: rejected('unsupported_profile', 'Only Golden Gate supports Spotlight preferences.') };
      const state = ctx.getState();
      if (!validateSpotlightPreferences(state).ok) return { error: invalid() };
      const root = { state, snapshots: [snapshot(state), snapshot(state.enabledCategories), snapshot(state.excludedFolderIds)] };
      const allowed = available();
      if (!current(root)) return { error: stale() };
      return allowed ? root : { error: unavailable() };
    } catch { return { error: invalid() }; }
  }
  function configure(target, payload) {
    try {
      if (!fields(target, []) || !fields(payload, keys, []) || !Reflect.ownKeys(payload).length) return invalid();
      const root = begin(); if (root.error) return root.error;
      const state = root.state, plan = { ...state, ...payload };
      if (!validateSpotlightPreferences(plan).ok) return invalid();
      // Clone caller arrays before running any Root callbacks.
      plan.enabledCategories = [...plan.enabledCategories]; plan.excludedFolderIds = [...plan.excludedFolderIds];
      const folders = foldersFrom(ctx);
      if (!current(root)) return stale();
      if (!folders || plan.excludedFolderIds.some(id => !folders.some(folder => folder.fileId === id))) return invalid();
      const changes = keys.filter(key => key === 'indexingEnabled' ? state[key] !== plan[key] : !sameList(state[key], plan[key]));
      if (changes.some(key => Object.getOwnPropertyDescriptor(state, key).writable !== true
        || key !== 'indexingEnabled' && !writableList(state[key], plan[key]))) return invalid();
      if (typeof ctx.canCommit !== 'function') return invalid();
      const delta = ['enabledCategories', 'excludedFolderIds'].reduce((total, key) => total + listText(plan[key]) - listText(state[key]), 0);
      let accepted = false;
      try { accepted = ctx.canCommit(delta) === true; } catch { /* A failed quota callback cannot authorize mutation. */ }
      if (!current(root)) return stale();
      if (!accepted) return rejected('limit_exceeded', 'Spotlight preferences exceed the complete-scene text budget.');
      if (!sameFolders(folders, foldersFrom(ctx)) || !current(root)) return stale();
      const allowed = available();
      if (!current(root)) return stale();
      if (!allowed) return unavailable();
      const result = applied({ preferences: spotlightPreferencesSummary(plan) });
      // No callbacks or awaits between the final checks and the complete commit.
      for (const key of changes) {
        if (key === 'indexingEnabled') state[key] = plan[key];
        else {
          for (let index = 0; index < plan[key].length; index++) if (state[key][index] !== plan[key][index]) state[key][index] = plan[key][index];
          if (state[key].length !== plan[key].length) state[key].length = plan[key].length;
        }
      }
      try { ctx.onChanged?.(); } catch { /* Notification failure cannot turn an already committed transition into rejection. */ }
      return result;
    } catch { return invalid(); }
  }
  async function openSettings(target, payload) {
    if (!fields(target, []) || !fields(payload, [])) return invalid();
    const root = begin(); if (root.error) return root.error;
    if (!current(root)) return stale();
    // The existing Root writer owns window budget, native mount and focus;
    // unexpected writer/renderer errors must not be disguised as unavailable.
    return await ctx.openSettings();
  }
  return { handlers: { 'spotlight.preferences.configure': configure, 'spotlight.settings.open': openSettings }, summary };
}

const partial = { ...object(spotlightPreferencesSchema.properties, []), anyOf: keys.map(key => match({ [key]: true })) };
const define = (name, payload, presentation, data, result) => {
  const entry = defineCommand(['macos-golden-gate-27.0.1'], name, 'shell.spotlight', empty, payload,
    ['Original live foreground retained Golden Gate desktop with no competing modal/private preparation.', 'Descriptor-first closed literal input; canonical retained and generated readonly folder identities.'],
    presentation, data, [], result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};
export const spotlightPreferencesCatalog = Object.fromEntries([
  define('spotlight.preferences.configure', partial,
    ['Reconcile native categories, indexing and privacy controls; invalidate stale private results/previews.'],
    ['Atomically commit only supplied per-local preferences after writability, identity, availability and complete-scene quota checks. Numeric array keys count toward text growth. Trashed retained folders remain valid exclusions. No host indexing or network access.'],
    object({ preferences: spotlightPreferencesSchema })),
  define('spotlight.settings.open', empty,
    ['Open and focus the real ordinary System Settings Spotlight pane using the existing Root panel writer.'],
    ['Retain only the ordinary pane and semantic scroll; private query, results, answers and preview leases never serialize.'],
    object({ appId: { const: 'settings' }, windowId: identity })),
]);

import { object, flag, choice } from './command-schema.js';
import { isRecord } from './feature-commands.js';

export const SPOTLIGHT_CATEGORIES = Object.freeze([
  ['apps', 'Applications'], ['documents', 'Documents'], ['contacts', 'Contacts'], ['mail', 'Mail'],
  ['calculator', 'Calculator'], ['conversions', 'Conversions'], ['dictionary', 'Dictionary'], ['suggestions', 'Suggestions'],
].map(([id, label]) => Object.freeze({ id, label })));
const categoryIds = SPOTLIGHT_CATEGORIES.map(category => category.id);
const forbiddenIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const folderId = { type: 'string', minLength: 1, maxLength: 256, pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$', not: { enum: [...forbiddenIds] } };
export const spotlightPreferencesSchema = object({
  enabledCategories: { type: 'array', maxItems: 8, uniqueItems: true, items: choice(...categoryIds) },
  excludedFolderIds: { type: 'array', maxItems: 128, uniqueItems: true, items: folderId },
  indexingEnabled: flag,
});
export const spotlightPreferencesDefaults = () => ({ enabledCategories: [...categoryIds], excludedFolderIds: [], indexingEnabled: true });
const validFolderId = value => typeof value === 'string' && value.length > 0 && value.length <= 256
  && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) && !forbiddenIds.has(value);
function validList(value, limit, valid) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value') || length.value > limit || Reflect.ownKeys(value).length !== length.value + 1) return false;
  const seen = new Set();
  for (let index = 0; index < length.value; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value') || !valid(descriptor.value) || seen.has(descriptor.value)) return false;
    seen.add(descriptor.value);
  }
  return true;
}
export function validateSpotlightPreferences(value) {
  try {
    const keys = ['enabledCategories', 'excludedFolderIds', 'indexingEnabled'];
    if (isRecord(value) && Reflect.ownKeys(value).length === keys.length && keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    }) && validList(value.enabledCategories, 8, id => categoryIds.includes(id))
      && validList(value.excludedFolderIds, 128, validFolderId) && typeof value.indexingEnabled === 'boolean') return { ok: true };
  } catch { /* Descriptor/prototype traps never authorize preferences. */ }
  return { ok: false, message: 'Spotlight requires closed literal indexing preferences, distinct authored categories and at most 128 distinct safe canonical folder identities.' };
}
export function spotlightPreferencesSummary(value) {
  const validation = validateSpotlightPreferences(value);
  if (!validation.ok) throw new TypeError(validation.message);
  return { enabledCategories: [...value.enabledCategories], excludedFolderIds: [...value.excludedFolderIds], indexingEnabled: value.indexingEnabled };
}

/** Includes the node itself and actual parents; deleted folders still own privacy.
 * Accept a canonical descriptor array or its existing identity Map, never a path/name guess. */
export function spotlightFileExcluded(fileId, files, excludedFolderIds) {
  if (!validFolderId(fileId) || !validList(excludedFolderIds, 128, validFolderId)) return false;
  const lookup = files instanceof Map ? id => files.get(id)
    : Array.isArray(files) ? id => files.find(file => Object.getOwnPropertyDescriptor(file, 'id')?.value === id) : null;
  if (!lookup) return false;
  const visited = new Set(), limit = files instanceof Map ? files.size : files.length;
  let id = fileId;
  while (id !== null && visited.size <= limit) {
    if (excludedFolderIds.includes(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    const node = lookup(id);
    if (!node) return false;
    const parent = Object.getOwnPropertyDescriptor(node, 'parentId');
    if (!parent || !Object.hasOwn(parent, 'value') || parent.value !== null && !validFolderId(parent.value)) return false;
    id = parent.value;
  }
  return false;
}

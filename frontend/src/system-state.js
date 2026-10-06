import { object } from './command-schema.js';
import { isRecord } from './feature-commands.js';
import { desktopFileSize } from './desktop-context-model.js';
import { liveMacFileRecords } from './desktop-file-state.js';

const RECENT_LIMIT = 10;
const forbiddenIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const identity = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...forbiddenIds] } };
const recentList = { type: 'array', items: identity, uniqueItems: true, maxItems: RECENT_LIMIT };
export const computerNameSchema = { type: 'string', minLength: 1, maxLength: 256, pattern: '^(?=[\\s\\S]*\\S)(?![\\s\\S]*[\\r\\n])[\\s\\S]+$' };
export const validComputerName = name => typeof name === 'string' && name.length > 0 && name.length <= 256
  && /\S/u.test(name) && !/[\r\n]/u.test(name);
export const systemStateSchema = object({ computerName: computerNameSchema,
  recentItems: object({ applications: recentList, documents: recentList }) });
export const systemDefaults = profile => ({ computerName: profile.defaults.machine.computerName,
  recentItems: { applications: [], documents: [] } });

// Apple-menu history is independent of Dock usage and filesystem metadata.
// Clearing it must not reset either of those domains or remove their records.
export function recordSystemRecent(state, category, id) {
  const list = state.recentItems[category], index = list.indexOf(id);
  if (index === 0) return;
  if (index >= 0) list.splice(index, 1);
  list.unshift(id);
  if (list.length > RECENT_LIMIT) list.length = RECENT_LIMIT;
}
export function clearSystemRecents(state) {
  state.recentItems.applications.length = 0;
  state.recentItems.documents.length = 0;
}

const closedData = (value, keys) => isRecord(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
function validList(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > RECENT_LIMIT
    || Reflect.ownKeys(value).length !== value.length + 1) return false;
  const ids = new Set();
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
    const id = descriptor.value;
    if (typeof id !== 'string' || id.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
      || forbiddenIds.has(id) || ids.has(id)) return false;
    ids.add(id);
  }
  return true;
}
export function validateSystemState(state, profile) {
  if (!closedData(state, ['computerName', 'recentItems']) || !validComputerName(state.computerName)
    || !closedData(state.recentItems, ['applications', 'documents'])
    || !validList(state.recentItems.applications) || !validList(state.recentItems.documents)
    || state.recentItems.applications.some(id => !Object.hasOwn(profile.applications, id))) {
    return { ok: false, message: 'System state requires a bounded single-line computer name and distinct bounded Apple-menu application/document history belonging to this profile.' };
  }
  return { ok: true };
}

// Disk capacity/system/app allocation are explicit fictional machine fixtures.
// Writable payload sizes reuse Finder's byte semantics; Trash still occupies space.
export function systemStorageSummary(profile, store) {
  const allocation = profile.defaults.machine.storage;
  const live = new Set(liveMacFileRecords(store).map(file => file.id));
  let documentsBytes = 0, trashBytes = 0, virtualFileCount = 0;
  for (const file of store.files) {
    if (file.readOnly || file.kind !== 'document' && file.kind !== 'image') continue;
    const bytes = desktopFileSize(file);
    if (live.has(file.id)) documentsBytes += bytes;
    else trashBytes += bytes;
    virtualFileCount++;
  }
  const virtualFileBytes = documentsBytes + trashBytes;
  const usedBytes = allocation.systemBytes + allocation.applicationsBytes + virtualFileBytes;
  return { ...allocation, usedBytes, availableBytes: allocation.capacityBytes - usedBytes,
    documentsBytes, trashBytes, virtualFileBytes, virtualFileCount,
    applicationCount: Object.keys(profile.applications).length };
}

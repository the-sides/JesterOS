import { desktopFileSize } from './desktop-context-model.js';
import { liveMacFileRecords, nextMacFileTimestamp } from './desktop-file-state.js';
import { applied, invalid, stale } from './windows11-app-helpers.js';
import { rejected } from './feature-commands.js';

export const STORAGE_CATEGORIES = Object.freeze(['applications', 'documents', 'icloud', 'mail', 'trash']);
export const STORAGE_RECOMMENDATIONS = Object.freeze(['storeInCloud', 'optimizeStorage', 'emptyTrashAutomatically']);
const LABELS = ['Applications', 'Documents', 'iCloud Drive', 'Mail', 'Trash'];
const PROTECTED = new Set(['disk', 'desktop', 'downloads', 'trash', 'applications', 'documents', 'icloud-drive', 'mail-cache']);
const THIRTY_DAYS = 30 * 86_400_000;
const MAX_TIME = 8_640_000_000_000_000 - 1;
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME;
const disabled = message => rejected('disabled', message);
const limited = () => rejected('limit_exceeded', 'The operation exceeds the virtual scene clock or revision budget.');
const compareLiteral = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const compareName = (a, b) => a.localeCompare(b, 'en-US', { numeric: true, sensitivity: 'base' });

export const storagePreferencesSchema = {
  type: 'object', additionalProperties: false, required: [...STORAGE_RECOMMENDATIONS],
  properties: Object.fromEntries(STORAGE_RECOMMENDATIONS.map(id => [id, { type: 'boolean' }])),
};

export function storagePreferencesDefaults() {
  return { storeInCloud: false, optimizeStorage: false, emptyTrashAutomatically: false };
}

export function validateStoragePreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    return { ok: false, message: 'Storage preferences must be a plain record.' };
  const keys = Reflect.ownKeys(value);
  if (keys.length !== STORAGE_RECOMMENDATIONS.length || keys.some(key => !STORAGE_RECOMMENDATIONS.includes(key)))
    return { ok: false, message: 'Use exactly the three documented storage preferences.' };
  for (const key of STORAGE_RECOMMENDATIONS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'boolean')
      return { ok: false, message: 'Storage preferences must contain boolean data properties.' };
  }
  return { ok: true };
}

export function storageViewDefaults(category) {
  return { category, scope: 'large-files', sort: 'size', direction: 'descending', folderId: 'disk', selectedFileIds: [] };
}

// Every parent is indexed once. The metadata pass resolves ancestor chains before
// their children; no filesystem lookup walks the mutable array repeatedly.
function fileIndex(store) {
  const byId = new Map(), children = new Map(), parentIds = new Map();
  for (const file of store.files) {
    byId.set(file.id, file); parentIds.set(file.id, file.parentId);
    if (!children.has(file.parentId)) children.set(file.parentId, []);
    children.get(file.parentId).push(file);
  }
  const live = new Set(liveMacFileRecords(store).map(file => file.id));
  const metadata = new Map(), order = [];
  for (const file of store.files) {
    if (metadata.has(file.id)) continue;
    const chain = [], seen = new Set();
    let current = file;
    while (current && !metadata.has(current.id) && !seen.has(current.id)) {
      seen.add(current.id); chain.push(current);
      current = byId.get(parentIds.get(current.id));
    }
    let parent = current ? metadata.get(current.id) : null;
    const cycle = Boolean(current && !parent);
    while (chain.length) {
      const item = chain.pop(), parentId = parentIds.get(item.id);
      const valid = !cycle && (item.id === 'disk' && parentId === null
        || Boolean(parent?.valid && byId.get(parentId)?.kind === 'folder'));
      const meta = {
        valid, live: valid && live.has(item.id), trashed: !live.has(item.id),
        ancestorIds: parent ? [...parent.ancestorIds, parentId] : [],
        path: parent ? `${parent.path}/${item.name}` : `/${item.name}`,
        cloudAnchor: item.id === 'icloud-drive' || Boolean(parent?.cloudAnchor),
        mailAnchor: item.id === 'mail-cache' || Boolean(parent?.mailAnchor),
        cloudEligible: ['desktop', 'documents', 'icloud-drive'].includes(item.id) || Boolean(parent?.cloudEligible),
        system: parentId === 'disk' && (item.id === 'mac-application-folder:System' || item.name === 'System') || Boolean(parent?.system),
      };
      metadata.set(item.id, meta); order.push(item); parent = meta;
    }
  }
  const removable = new Map();
  for (let index = order.length - 1; index >= 0; index--) {
    const file = order[index];
    removable.set(file.id, Boolean(metadata.get(file.id).valid && !file.readOnly && !PROTECTED.has(file.id)
      && (children.get(file.id) ?? []).every(child => removable.get(child.id))));
  }
  return { byId, children, parentIds, metadata, order, removable };
}

function categoryId(file, meta) {
  if (meta.trashed) return file.readOnly || PROTECTED.has(file.id) ? null : 'trash';
  if (file.kind === 'application') return meta.system ? null : 'applications';
  if (file.readOnly || PROTECTED.has(file.id)) return null;
  if (meta.mailAnchor) return 'mail';
  if (file.inCloud === true || meta.cloudAnchor) return 'icloud';
  return 'documents';
}

export function storageInventory(profile, store) {
  const index = fileIndex(store), sizes = new Map();
  const categories = STORAGE_CATEGORIES.map((id, position) => ({ id, label: LABELS[position], residentBytes: 0, payloadBytes: 0, rows: [] }));
  const byCategory = new Map(categories.map(item => [item.id, item]));
  const applications = byCategory.get('applications');
  applications.residentBytes = profile.defaults.machine.storage.applicationsBytes;
  applications.payloadBytes = null;
  for (let position = index.order.length - 1; position >= 0; position--) {
    const file = index.order[position], meta = index.metadata.get(file.id);
    if (!meta.valid) continue;
    if (file.kind === 'folder') {
      let bytes = 0, payloadBytes = 0;
      for (const child of index.children.get(file.id) ?? []) {
        const childMeta = index.metadata.get(child.id), size = sizes.get(child.id);
        if (!childMeta?.valid || childMeta.trashed !== meta.trashed || !size) continue;
        bytes = bytes === null || size.bytes === null ? null : bytes + size.bytes;
        payloadBytes = payloadBytes === null || size.payloadBytes === null ? null : payloadBytes + size.payloadBytes;
      }
      sizes.set(file.id, { bytes, payloadBytes });
    } else {
      const payloadBytes = file.kind === 'application' && file.readOnly ? null : desktopFileSize(file);
      sizes.set(file.id, { payloadBytes, bytes: file.localResident === false ? 0 : payloadBytes });
    }
  }
  const browserRows = [];
  for (const file of store.files) {
    const meta = index.metadata.get(file.id);
    if (!meta.valid) continue;
    const partition = categoryId(file, meta), size = sizes.get(file.id);
    const parentTrashed = index.metadata.get(file.parentId)?.trashed === true;
    const result = {
      fileId: file.id, name: file.name, kind: file.kind, parentId: file.parentId, path: meta.path,
      ...size, lastAccessedAt: validTime(file.lastOpenedAt) ? file.lastOpenedAt : null,
      readOnly: file.readOnly === true, inCloud: file.inCloud === true, localResident: file.localResident !== false,
      deleted: meta.trashed, directlyDeleted: file.deleted === true,
      canDelete: index.removable.get(file.id) === true,
      canRestore: meta.trashed && file.deleted === true && !parentTrashed && index.removable.get(file.id) === true,
      canDownload: meta.live && !file.readOnly && file.kind !== 'folder' && file.kind !== 'application'
        && !PROTECTED.has(file.id) && file.localResident === false,
      ancestorIds: meta.ancestorIds, categoryId: partition, canNavigate: meta.live && file.kind === 'folder',
    };
    if (meta.live) browserRows.push(result);
    if (!partition) continue;
    const category = byCategory.get(partition);
    category.rows.push(result);
    // Folder rows summarize payloads, but category totals account leaf records only.
    if (file.kind !== 'folder' && partition !== 'applications') {
      category.residentBytes += size.bytes;
      category.payloadBytes += size.payloadBytes;
    }
  }
  return { categories, browserRows, sceneTime: store.sceneTime };
}

export function storageRows(inventory, view) {
  if (!view || !STORAGE_CATEGORIES.includes(view.category)) return [];
  const category = inventory.categories.find(item => item.id === view.category);
  if (!category) return [];
  let rows = category.rows;
  if (view.category === 'documents' && view.scope === 'downloads')
    rows = rows.filter(row => row.ancestorIds.includes('downloads'));
  else if (view.category === 'documents' && view.scope === 'file-browser') {
    if (!inventory.browserRows.some(row => row.fileId === view.folderId && row.canNavigate)) return [];
    rows = inventory.browserRows.filter(row => row.parentId === view.folderId).map(row =>
      row.categoryId === 'documents' ? row : { ...row, readOnly: true, canDelete: false });
  }
  const key = view.sort === 'size' ? 'bytes' : view.sort === 'last-accessed' ? 'lastAccessedAt'
    : view.sort === 'kind' ? 'kind' : 'name';
  const direction = view.direction === 'ascending' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a[key], right = b[key];
    // Unknown values remain last in both directions, never a fabricated zero.
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    const comparison = left === null ? 0 : typeof left === 'number' ? compareLiteral(left, right) : compareName(left, right);
    return direction * comparison || compareLiteral(a.fileId, b.fileId);
  });
}

function batchSelection(store, fileIds, operation) {
  if (!Array.isArray(fileIds) || !fileIds.length || !fileIds.every(id => typeof id === 'string' && id.length > 0)
    || new Set(fileIds).size !== fileIds.length) return { error: invalid('Select a nonempty list of unique real file IDs.') };
  const index = fileIndex(store), selected = new Set(fileIds);
  const files = [];
  for (const id of fileIds) {
    const file = index.byId.get(id), meta = index.metadata.get(id);
    if (!file) return { error: stale('A selected file no longer exists in this store.') };
    if (!meta.valid) return { error: disabled('The selected file has a missing or cyclic filesystem ancestry.') };
    if (!index.removable.get(id)) return { error: disabled('Protected locations and readonly catalog records cannot be changed.') };
    if (operation === 'trash' ? !meta.live : !meta.trashed)
      return { error: disabled(operation === 'trash' ? 'Only live files can be moved to Trash.' : 'Only files in Trash can be restored or purged.') };
    files.push(file);
  }
  const roots = files.filter(file => !index.metadata.get(file.id).ancestorIds.some(id => selected.has(id)));
  return { index, files, roots, selected };
}

function subtreeIds(index, roots) {
  const ids = new Set(), pending = [...roots];
  while (pending.length) {
    const file = pending.pop();
    if (ids.has(file.id)) continue;
    ids.add(file.id); pending.push(...(index.children.get(file.id) ?? []));
  }
  return ids;
}

function canTouch(store, files) {
  return validTime(store.sceneTime) && store.sceneTime + files.length <= MAX_TIME
    && files.every(file => file.revision === undefined || Number.isSafeInteger(file.revision)
      && file.revision >= 0 && file.revision < Number.MAX_SAFE_INTEGER - 1);
}

function touch(store, file) {
  const timestamp = nextMacFileTimestamp(store);
  file.revision = (file.revision ?? 0) + 1;
  file.modifiedAt = timestamp;
  return timestamp;
}

export function trashStorageFiles(store, fileIds) {
  const plan = batchSelection(store, fileIds, 'trash');
  if (plan.error) return plan.error;
  if (!canTouch(store, plan.roots)) return limited();
  for (const file of plan.roots) {
    file.deleted = true;
    file.deletedAt = touch(store, file);
  }
  return applied({ fileIds: plan.roots.map(file => file.id) });
}

export function restoreStorageFiles(store, fileIds) {
  const plan = batchSelection(store, fileIds, 'restore');
  if (plan.error) return plan.error;
  const { index, files, selected } = plan;
  for (const file of files) {
    if (!file.deleted && !index.metadata.get(file.id).ancestorIds.some(id => selected.has(id) && index.byId.get(id).deleted))
      return disabled('Restore the deleted ancestor instead of an implicitly trashed child.');
  }
  const restoring = new Set(files.filter(file => file.deleted).map(file => file.id));
  const afterLive = new Set();
  // The index order is parent-first, independent of the incoming selection order.
  for (const file of index.order) {
    if (index.metadata.get(file.id).valid && (!file.deleted || restoring.has(file.id))
      && (file.id === 'disk' || afterLive.has(index.parentIds.get(file.id)))) afterLive.add(file.id);
  }
  for (const id of restoring) {
    if (!afterLive.has(id)) return disabled('The original parent must be live or restored in the same batch.');
  }
  const namesByParent = new Map();
  function reserve(file) {
    const parentId = index.parentIds.get(file.id);
    if (!namesByParent.has(parentId)) namesByParent.set(parentId, new Set());
    const names = namesByParent.get(parentId), key = file.name.toLowerCase();
    if (names.has(key)) return false;
    names.add(key); return true;
  }
  for (const file of index.order) if (index.metadata.get(file.id).live) reserve(file);
  for (const file of index.order) {
    if (afterLive.has(file.id) && !index.metadata.get(file.id).live && !reserve(file))
      return rejected('collision', 'Restoring this batch would overwrite an item with the same name.');
  }
  const changed = index.order.filter(file => restoring.has(file.id));
  if (!canTouch(store, changed)) return limited();
  for (const file of changed) {
    file.deleted = false;
    delete file.deletedAt;
    touch(store, file);
  }
  return applied({ fileIds: changed.map(file => file.id) });
}

export function purgeStorageFiles(store, fileIds) {
  const plan = batchSelection(store, fileIds, 'purge');
  if (plan.error) return plan.error;
  const removed = subtreeIds(plan.index, plan.roots);
  const removedIds = store.files.filter(file => removed.has(file.id)).map(file => file.id);
  store.files = store.files.filter(file => !removed.has(file.id));
  return applied({ fileIds: removedIds });
}

function inactivityReference(file) {
  for (const timestamp of [file.lastOpenedAt, file.createdAt, file.addedAt, file.modifiedAt])
    if (validTime(timestamp)) return timestamp;
  return null;
}

function maintenancePlan(store, preferences) {
  const index = fileIndex(store), changes = [];
  for (const file of store.files) {
    const meta = index.metadata.get(file.id);
    if (!meta.live || file.readOnly || PROTECTED.has(file.id) || !['document', 'image', 'text'].includes(file.kind)) continue;
    const cloud = preferences.storeInCloud && meta.cloudEligible;
    const mail = preferences.optimizeStorage && meta.mailAnchor;
    const updates = {};
    if (cloud && file.inCloud !== true) updates.inCloud = true;
    const reference = inactivityReference(file);
    if ((cloud || mail) && file.localResident !== false && reference !== null && store.sceneTime - reference > THIRTY_DAYS)
      updates.localResident = false;
    if (Object.keys(updates).length) changes.push({ file, updates });
  }
  const expired = preferences.emptyTrashAutomatically ? store.files.filter(file => {
    const meta = index.metadata.get(file.id);
    return meta.valid && meta.trashed && file.deleted === true && index.removable.get(file.id)
      && validTime(file.deletedAt) && store.sceneTime - file.deletedAt > THIRTY_DAYS;
  }) : [];
  const removed = subtreeIds(index, expired);
  const removedFileIds = store.files.filter(file => removed.has(file.id)).map(file => file.id);
  if (!canTouch(store, changes.map(change => change.file))) return { error: limited() };
  return { changes, removed, removedFileIds };
}

function applyMaintenance(store, plan) {
  for (const { file, updates } of plan.changes) {
    Object.assign(file, updates);
    touch(store, file);
  }
  if (plan.removed.size) store.files = store.files.filter(file => !plan.removed.has(file.id));
  return { changedFileIds: plan.changes.map(change => change.file.id), removedFileIds: plan.removedFileIds };
}

export function maintainStorage(store, preferences) {
  const validation = validateStoragePreferences(preferences);
  if (!validation.ok) throw new TypeError(validation.message);
  const plan = maintenancePlan(store, preferences);
  if (plan.error) throw new RangeError('Storage maintenance exceeds the virtual scene clock or revision budget.');
  return applyMaintenance(store, plan);
}

export function setStorageRecommendation(store, preferences, recommendation, enabled) {
  const validation = validateStoragePreferences(preferences);
  if (!validation.ok) return invalid(validation.message);
  if (!STORAGE_RECOMMENDATIONS.includes(recommendation) || typeof enabled !== 'boolean')
    return invalid('Use a documented recommendation and an exact boolean enabled value.');
  if (preferences[recommendation] !== enabled && !Object.getOwnPropertyDescriptor(preferences, recommendation).writable)
    return invalid('Storage preferences must be mutable data properties.');
  const next = { ...preferences, [recommendation]: enabled };
  const plan = maintenancePlan(store, next);
  if (plan.error) return plan.error;
  if (preferences[recommendation] !== enabled) preferences[recommendation] = enabled;
  const result = applyMaintenance(store, plan);
  return applied({ recommendation, enabled, ...result });
}

export function downloadStorageFile(store, fileId) {
  if (typeof fileId !== 'string' || !fileId.length) return invalid('Select one real evicted file.');
  const index = fileIndex(store), file = index.byId.get(fileId), meta = index.metadata.get(fileId);
  if (!file) return stale('The requested file no longer exists in this store.');
  if (!meta.live || file.readOnly || PROTECTED.has(fileId) || file.kind === 'folder' || file.kind === 'application'
    || file.localResident !== false) return disabled('Only live writable evicted payloads can be downloaded.');
  if (!canTouch(store, [file])) return limited();
  file.localResident = true;
  file.lastOpenedAt = touch(store, file);
  return applied({ fileId, localResident: true });
}

import { isRecord, rejected } from './feature-commands.js';
import { liveMacFileRecords, validMacDesktopName } from './desktop-file-state.js';
import { defineCommand, NONE, identity, object, empty } from './command-schema.js';

const MAX_FILES = 1024, MAX_TEXT = 1024 * 1024, MAX_HISTORY_TEXT = 8 * MAX_TEXT;
const MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1, MAX_TIME = 8_640_000_000_000_000 - 1;
const anchors = new Set(['disk', 'desktop', 'downloads', 'trash', 'applications', 'documents', 'icloud-drive', 'mail-cache']);
const reserved = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !reserved.has(value);
const integer = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  && required.every(key => Object.hasOwn(value, key));
const validIds = ids => Array.isArray(ids) && ids.length <= MAX_FILES && ids.every(validId) && new Set(ids).size === ids.length;
const invalid = () => rejected('invalid_arguments', 'Use the closed Finder editing target and empty payload.');
const stale = () => rejected('stale_target', 'The original owner, source records or destination changed.');
const disabled = () => rejected('disabled', 'This selection, location or history transaction cannot be edited safely.');
const limited = () => rejected('limit_exceeded', 'The operation exceeds the virtual file, content, allocator or clock budget.');
const applied = (owner, fileIds) => ({ status: 'applied', target: { windowId: owner.windowId, fileIds: [...fileIds] } });
const copyRecord = file => ({ ...file, ...(file.tags !== undefined ? { tags: [...file.tags] } : {}) });
function stringUnits(value) {
  if (typeof value === 'string') return value.length;
  if (!value || typeof value !== 'object') return 0;
  let total = 0;
  for (const key of Object.keys(value)) total += key.length + stringUnits(value[key]);
  return total;
}
function sameRecord(current, original) {
  const keys = Object.keys(current).filter(key => key !== 'lastOpenedAt');
  const expected = Object.keys(original).filter(key => key !== 'lastOpenedAt');
  return keys.length === expected.length && expected.every(key => Object.hasOwn(current, key)
    && (key === 'tags' ? Array.isArray(current.tags) && current.tags.length === original.tags.length
      && current.tags.every((tag, index) => tag === original.tags[index]) : current[key] === original[key]));
}
function copyName(name, names, kind) {
  const dot = name.lastIndexOf('.'), extended = kind === 'document' && dot > 0;
  const stem = extended ? name.slice(0, dot) : name, extension = extended ? name.slice(dot) : '';
  for (let number = 1; number <= MAX_FILES + 1; number++) {
    const suffix = number === 1 ? ' copy' : ` copy ${number}`, room = 255 - suffix.length - extension.length;
    if (room < 1) return null;
    const candidate = `${stem.slice(0, room)}${suffix}${extension}`;
    if (validMacDesktopName(candidate) && !names.has(candidate.toLowerCase())) return candidate;
  }
  return null;
}

/** Private per-root history; neither snapshots nor clipboard belong to saved scene data. */
export function createFinderEditing(ctx) {
  const undo = [], redo = [];
  let historyUnits = 0;
  // Versioned leases distinguish our own history settlement from unrelated writes.
  // Restoring old names/content never rewinds per-file revisions or the scene clock.
  const leases = new Map();
  function owner(target) {
    if (!fields(target, ['windowId'], []) || (Object.hasOwn(target, 'windowId') && !validId(target.windowId))) return { error: invalid() };
    if (!ctx.available()) return { error: rejected('unavailable', 'Finder editing is unavailable in the current scene.') };
    const window = Object.hasOwn(target, 'windowId') ? ctx.getWindow(target.windowId) : null;
    const selected = Object.hasOwn(target, 'windowId') ? window?.finderSelectedFileIds ?? [] : ctx.getDesktopSelection?.();
    if ((Object.hasOwn(target, 'windowId') && !window) || !selected) return { error: stale() };
    const byId = new Map();
    for (const file of ctx.files.files) {
      if ((file.readOnly === true ? typeof file.id !== 'string' || !file.id : !validId(file.id)) || byId.has(file.id)) return { error: stale() };
      byId.set(file.id, file);
    }
    if (!Array.isArray(selected) || selected.length > MAX_FILES || new Set(selected).size !== selected.length
      || selected.some(id => !validId(id) && byId.get(id)?.readOnly !== true)) return { error: stale() };
    const folderId = window ? window.folderId : 'desktop', folder = byId.get(folderId);
    if (!folder || !location(folder, byId, false)) return { error: stale() };
    return { window, windowId: window?.id ?? null, folderId, folder, byId, selected: [...selected], live: liveMacFileRecords(ctx.files) };
  }
  function location(folder, byId, writable) {
    const seen = new Set();
    for (let current = folder; current; current = byId.get(current.parentId)) {
      if (seen.has(current.id) || current.deleted || current.kind !== 'folder'
        || (writable && (current.readOnly || current.id === 'trash'))) return false;
      seen.add(current.id);
      if (current.parentId === null) return current.id === 'disk';
      if (!byId.has(current.parentId)) return false;
    }
    return false;
  }
  function sourceRecords(value, ids, owned) {
    if (!validIds(ids) || !ids.length) return { error: disabled() };
    const liveIds = new Set(value.live.map(file => file.id)), children = new Map();
    for (const file of value.live) {
      if (!children.has(file.parentId)) children.set(file.parentId, []);
      children.get(file.parentId).push(file);
    }
    const records = [], parents = [], roots = [], seen = new Set();
    for (const id of ids) {
      const root = value.byId.get(id);
      if (!root || !liveIds.has(id) || (owned && root.parentId !== value.folderId
        && !(value.windowId === null && root.id === 'disk'))) return { error: stale() };
      if (!location(value.byId.get(root.parentId), value.byId, true)) return { error: disabled() };
      const pending = [{ file: root, parent: -1 }];
      while (pending.length) {
        const { file, parent } = pending.pop();
        if (seen.has(file.id) || file.readOnly || anchors.has(file.id) || !['folder', 'document'].includes(file.kind)) return { error: disabled() };
        if (!validMacDesktopName(file.name) || typeof file.content !== 'string' || file.content.length > MAX_TEXT
          || !validId(file.appId) || typeof file.icon !== 'string' || !file.icon.length || file.icon.length > 128
          || !integer(file.revision, 1, MAX_COUNTER) || file.deleted !== false
          || (file.tags !== undefined && (!Array.isArray(file.tags) || file.tags.length > 64
            || !file.tags.every(tag => typeof tag === 'string' && tag.length <= 256)))) return { error: limited() };
        if (['createdAt', 'modifiedAt', 'addedAt'].some(key => file[key] !== undefined && !integer(file[key], 0, MAX_TIME))
          || (file.lastOpenedAt !== undefined && file.lastOpenedAt !== null && !integer(file.lastOpenedAt, 0, MAX_TIME))) return { error: limited() };
        seen.add(file.id); const index = records.length; records.push(file); parents.push(parent);
        if (parent === -1) roots.push(index);
        const descendants = children.get(file.id) ?? [];
        if (file.kind !== 'folder' && descendants.length) return { error: disabled() };
        const names = new Set();
        for (const child of descendants) {
          if (!validMacDesktopName(child.name)) return { error: limited() };
          if (names.has(child.name.toLowerCase())) return { error: disabled() };
          names.add(child.name.toLowerCase());
        }
        for (let child = descendants.length - 1; child >= 0; child--) pending.push({ file: descendants[child], parent: index });
      }
    }
    return { records, parents, roots };
  }
  function allocation(records) {
    const count = ctx.files.files.reduce((total, file) => total + (file.readOnly ? 0 : 1), 0);
    if (count + records.length > MAX_FILES || !integer(ctx.files.nextFileId, 1, MAX_COUNTER)
      || !integer(ctx.files.sceneTime, 0, MAX_TIME) || ctx.files.sceneTime + records.length > MAX_TIME) return null;
    const ids = new Set(ctx.files.files.map(file => file.id));
    let number = ctx.files.nextFileId, timestamp = ctx.files.sceneTime;
    for (const record of records) {
      while (ids.has(`file-${number}`) && number < MAX_COUNTER) number++;
      if (number >= MAX_COUNTER) return null;
      record.id = `file-${number++}`; ids.add(record.id);
      record.revision = 1; record.createdAt = record.modifiedAt = record.addedAt = ++timestamp; record.lastOpenedAt = null;
    }
    return { number, timestamp };
  }
  function pastePlan(value) {
    if (!location(value.folder, value.byId, true)) return { error: disabled() };
    if (ctx.clipboard.kind !== 'files') return { error: disabled() };
    const source = sourceRecords(value, ctx.clipboard.fileIds, false);
    if (source.error) return source;
    const names = new Set(value.live.filter(file => file.parentId === value.folderId).map(file => file.name.toLowerCase()));
    const records = source.records.map(copyRecord);
    for (const index of source.roots) {
      const sourceRoot = source.records[index];
      if (sourceRoot.parentId === value.folderId || names.has(sourceRoot.name.toLowerCase())) {
        const name = copyName(sourceRoot.name, names, sourceRoot.kind);
        if (!name) return { error: limited() };
        records[index].name = name;
      }
      names.add(records[index].name.toLowerCase());
    }
    const allocated = allocation(records);
    if (!allocated) return { error: limited() };
    for (let index = 0; index < records.length; index++) records[index].parentId = source.parents[index] < 0
      ? value.folderId : records[source.parents[index]].id;
    if (!ctx.canAddFiles(records)) return { error: limited() };
    return { records, allocated, rootIds: source.roots.map(index => records[index].id) };
  }
  function notify() {
    // DOM/menu outcomes are not allowed to reject an already-committed data edit.
    try { ctx.onChanged?.(); } catch { /* data remains committed */ }
  }
  function select(value, ids) {
    const current = value.windowId === null ? ctx.getDesktopSelection?.() : ctx.getWindow(value.windowId);
    if (value.windowId !== null && current !== value.window) return;
    if (value.windowId !== null && current.folderId !== value.folderId) return;
    if (value.windowId === null && !current) return;
    try {
      if (value.window) value.window.finderSelectedFileIds = [...ids];
      else ctx.selectDesktop([...ids]);
    } catch { /* selection settlement cannot roll back the file transaction */ }
  }
  function sameContents(current, expected) {
    const withoutVersions = record => {
      const { revision, modifiedAt, lastOpenedAt, ...rest } = record;
      return rest;
    };
    return sameRecord(withoutVersions(current), withoutVersions(expected));
  }
  function append(transaction) {
    for (const previous of redo) historyUnits -= previous.units;
    redo.length = 0;
    transaction.units = stringUnits(transaction);
    undo.push(transaction); historyUnits += transaction.units;
    for (const file of transaction.after) leases.set(file.id, copyRecord(file));
    while (undo.length + redo.length > 64 || historyUnits > MAX_HISTORY_TEXT) {
      const oldest = undo.shift();
      historyUnits -= oldest.units;
    }
    const retainedIds = new Set();
    for (const previous of [...undo, ...redo]) for (const file of [...previous.before, ...previous.after]) retainedIds.add(file.id);
    for (const id of leases.keys()) if (!retainedIds.has(id)) leases.delete(id);
    notify();
  }
  function recordCreated(label, records, rootIds, originalOwner) {
    append({ label, before: [], after: records.map(copyRecord), rootIds: [...rootIds],
      owner: { windowId: originalOwner.windowId, folderId: originalOwner.folderId, selectionBefore: [...originalOwner.selectionBefore] } });
  }
  function capture() { return ctx.files.files.map(copyRecord); }
  function recordChanged(label, before, originalOwner, rootIds) {
    const old = new Map(before.map(file => [file.id, file]));
    const current = new Map(ctx.files.files.map(file => [file.id, file]));
    const changed = new Set();
    for (const file of before) if (!current.has(file.id) || !sameRecord(current.get(file.id), file)) changed.add(file.id);
    for (const file of ctx.files.files) if (!old.has(file.id)) changed.add(file.id);
    if (!changed.size) return;
    append({ label, before: before.filter(file => changed.has(file.id)), after: ctx.files.files.filter(file => changed.has(file.id)).map(copyRecord),
      rootIds: [...(rootIds ?? changed)],
      owner: { windowId: originalOwner.windowId, folderId: originalOwner.folderId, selectionBefore: [...originalOwner.selectionBefore] } });
  }
  function invalidateFiles(fileIds) {
    const removed = new Set(fileIds);
    for (const stack of [undo, redo]) for (let index = stack.length - 1; index >= 0; index--) {
      const transaction = stack[index];
      if (removed.has(transaction.owner.folderId) || transaction.before.some(file => removed.has(file.id) || removed.has(file.parentId))
        || transaction.after.some(file => removed.has(file.id) || removed.has(file.parentId))) {
        historyUnits -= transaction.units; stack.splice(index, 1);
      }
    }
    const retained = new Set();
    for (const transaction of [...undo, ...redo]) for (const file of [...transaction.before, ...transaction.after]) retained.add(file.id);
    for (const fileId of leases.keys()) if (!retained.has(fileId)) leases.delete(fileId);
    notify();
  }
  function historyPlan(value, transaction, restoring) {
    if (!transaction || !location(value.byId.get(transaction.owner.folderId), value.byId, true)) return { error: disabled() };
    const expected = restoring ? transaction.before : transaction.after;
    const desired = restoring ? transaction.after : transaction.before;
    const ids = new Set([...transaction.before, ...transaction.after].map(file => file.id));
    const expectedById = new Map(expected.map(file => [file.id, file]));
    for (const id of ids) {
      const current = value.byId.get(id), original = expectedById.get(id), lease = leases.get(id);
      if (original ? !current || !lease || !sameRecord(current, lease) || !sameContents(current, original) : Boolean(current)) return { error: stale() };
      if (current?.readOnly || anchors.has(id)) return { error: disabled() };
    }
    if (!integer(ctx.files.nextFileId, 1, MAX_COUNTER) || !integer(ctx.files.sceneTime, 0, MAX_TIME)) return { error: limited() };
    let number = ctx.files.nextFileId, timestamp = ctx.files.sceneTime;
    const records = desired.map(copyRecord);
    for (const file of records) {
      const revision = Math.max(file.revision, leases.get(file.id)?.revision ?? 0);
      if (revision >= MAX_COUNTER || timestamp >= MAX_TIME) return { error: limited() };
      file.revision = revision + 1; file.modifiedAt = ++timestamp;
      file.lastOpenedAt = value.byId.get(file.id)?.lastOpenedAt ?? file.lastOpenedAt;
      const match = /^file-([0-9]+)$/.exec(file.id);
      if (match) number = Math.max(number, Number(match[1]) + 1);
    }
    if (!integer(number, 1, MAX_COUNTER)) return { error: limited() };
    const candidate = [...ctx.files.files.filter(file => !ids.has(file.id)), ...records];
    if (candidate.reduce((count, file) => count + !file.readOnly, 0) > MAX_FILES) return { error: limited() };
    if (ctx.canReplaceFiles ? !ctx.canReplaceFiles(candidate) : !ctx.canAddFiles(records.filter(file => !value.byId.has(file.id)))) return { error: limited() };
    const byId = new Map(candidate.map(file => [file.id, file])), names = new Set();
    for (const file of candidate) {
      if (file.parentId !== null && !byId.has(file.parentId)) return { error: stale() };
      if (!file.deleted) {
        const name = `${file.parentId}\u0000${file.name.toLowerCase()}`;
        if (names.has(name)) return { error: rejected('collision', 'An existing item has the reserved destination name.') };
        names.add(name);
        if (file.parentId !== null && !location(byId.get(file.parentId), byId, false)) return { error: stale() };
      }
    }
    return { candidate, records, number, timestamp };
  }
  function settleHistory(value, transaction, plan, restoring) {
    const previous = ctx.files.files;
    ctx.files.files = plan.candidate; ctx.files.nextFileId = plan.number; ctx.files.sceneTime = plan.timestamp;
    for (const file of plan.records) leases.set(file.id, copyRecord(file));
    try { ctx.filesChanged?.(previous); } catch { /* File data is committed; navigation settlement cannot undo it. */ }
    const live = new Set(liveMacFileRecords(ctx.files).filter(file => file.parentId === value.folderId
      || (value.windowId === null && file.id === 'disk')).map(file => file.id));
    const selected = transaction.owner.folderId === value.folderId ? restoring ? transaction.rootIds : transaction.owner.selectionBefore : value.selected;
    select(value, selected.filter(id => live.has(id)));
    notify(); return applied(value, transaction.rootIds);
  }
  function targets(target = {}) {
    const value = owner(target), lastUndo = undo.at(-1), lastRedo = redo.at(-1);
    return { windowId: value.windowId ?? null, folderId: value.folderId ?? null,
      copy: !value.error && !sourceRecords(value, value.selected, true).error,
      paste: !value.error && !pastePlan(value).error,
      undo: !value.error && !historyPlan(value, lastUndo, false).error,
      redo: !value.error && !historyPlan(value, lastRedo, true).error,
      undoLabel: lastUndo ? `Undo ${lastUndo.label}` : 'Undo', redoLabel: lastRedo ? `Redo ${lastRedo.label}` : 'Redo' };
  }
  function run(target, payload, operation) {
    if (!fields(payload, [])) return invalid();
    const value = owner(target);
    return value.error ?? operation(value);
  }
  const handlers = {
    'finder.clipboard.copy': (target, payload) => run(target, payload, value => {
      const source = sourceRecords(value, value.selected, true);
      if (source.error) return source.error;
      ctx.clipboard.kind = 'files'; ctx.clipboard.text = ''; ctx.clipboard.fileIds = [...value.selected];
      notify(); return applied(value, value.selected);
    }),
    'finder.clipboard.paste': (target, payload) => run(target, payload, value => {
      const plan = pastePlan(value);
      if (plan.error) return plan.error;
      ctx.files.files.push(...plan.records); ctx.files.nextFileId = plan.allocated.number; ctx.files.sceneTime = plan.allocated.timestamp;
      select(value, plan.rootIds);
      recordCreated('Paste Items', plan.records, plan.rootIds, { windowId: value.windowId, folderId: value.folderId, selectionBefore: value.selected });
      return applied(value, plan.rootIds);
    }),
    'finder.edit.undo': (target, payload) => run(target, payload, value => {
      const transaction = undo.at(-1), plan = historyPlan(value, transaction, false);
      if (plan.error) return plan.error;
      undo.pop(); redo.push(transaction);
      return settleHistory(value, transaction, plan, false);
    }),
    'finder.edit.redo': (target, payload) => run(target, payload, value => {
      const transaction = redo.at(-1), plan = historyPlan(value, transaction, true);
      if (plan.error) return plan.error;
      redo.pop(); undo.push(transaction);
      return settleHistory(value, transaction, plan, true);
    }),
  };
  return { handlers, targets, recordCreated, capture, recordChanged, invalidateFiles };
}

const profiles = ['macos-golden-gate-27.0.1'];
const target = object({ windowId: identity }, []);
const result = object({ windowId: { anyOf: [identity, { type: 'null' }] },
  fileIds: { type: 'array', maxItems: 1024, uniqueItems: true, items: identity } });
const define = (name, effect) => {
  const entry = defineCommand(profiles, name, 'shell.edit-workflows', target, empty,
    ['Exact active visible ordinary Finder window; an omitted windowId means the actual windowless foreground Desktop, never another window selection.',
      'Copy requires current live owned mutable user subtrees; Paste requires the actual writable destination. Undo/Redo validate complete global file-delta leases, surviving original parents, identities, collisions and budgets before data changes.'],
    [effect], ['files', 'windows.finderSelectedFileIds', 'private per-root clipboard and 64-transaction/8-Mi-UTF-16 global file history'], NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};
export const finderEditingCatalog = Object.fromEntries([
  define('finder.clipboard.copy', 'Capture exact selected live user subtree root IDs in the page-local file clipboard; clear text and retain current source records.'),
  define('finder.clipboard.paste', 'Atomically clone the clipboard’s current complete live subtrees into the actual writable location with independent identities and native copy names; retain clipboard.'),
  define('finder.edit.undo', 'Atomically reverse only this intact global file delta, including creation, rename, move and trash; preserve unrelated records and valid current-location selection, never rewind allocators or clocks.'),
  define('finder.edit.redo', 'Atomically replay this intact global file delta with reserved independent identities, safe original parents, collision and capacity checks; preserve unrelated records and keep clocks, allocators and restored revisions monotonic.'),
]);

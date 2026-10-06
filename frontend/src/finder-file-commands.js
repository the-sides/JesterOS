import { isRecord, rejected } from './feature-commands.js';
import { liveMacFileRecords, validMacDesktopName } from './desktop-file-state.js';
import { defineCommand, NONE, identity, object, empty } from './command-schema.js';

const MAX_FILES = 1024, MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1, MAX_TIME = 8_640_000_000_000_000 - 1;
const protectedIds = new Set(['disk', 'desktop', 'downloads', 'trash', 'applications']);
const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  && required.every(key => Object.hasOwn(value, key));
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const invalid = () => rejected('invalid_arguments', 'Use a live ordinary Finder window and the documented closed arguments.');
const unavailable = () => rejected('unavailable', 'The requested Finder File surface is unavailable.');
const stale = () => rejected('stale_target', 'The Finder window, location or owned selection changed.');
const limited = () => rejected('limit_exceeded', 'The operation exceeds the bounded virtual file, name, clock or content budget.');
const applied = target => ({ status: 'applied', target });

export function createFinderFileCommands(ctx) {
  function owner(target, explicit = true) {
    if (!fields(target, explicit ? ['windowId', 'fileId'] : ['windowId'], ['windowId']) || !validId(target.windowId)
      || (Object.hasOwn(target, 'fileId') && !validId(target.fileId))) return { error: invalid() };
    if (!ctx.available()) return { error: unavailable() };
    const window = ctx.getWindow(target.windowId);
    const live = liveMacFileRecords(ctx.files);
    const folder = window && live.find(file => file.id === window.folderId && file.kind === 'folder');
    if (!window || !folder) return { error: stale() };
    return { window, folder, live };
  }
  function item(target) {
    const value = owner(target);
    if (value.error) return value;
    const ids = target.fileId === undefined ? value.window.finderSelectedFileIds ?? [] : [target.fileId];
    if (ids.length !== 1) return { error: rejected('disabled', 'Select one real item in this Finder location.') };
    const file = value.live.find(file => file.id === ids[0] && file.parentId === value.folder.id);
    return file ? { ...value, file } : { error: stale() };
  }
  function desktopItem(target) {
    if (!fields(target, ['fileId'], []) || (Object.hasOwn(target, 'fileId') && !validId(target.fileId))) return { error: invalid() };
    if (!ctx.available()) return { error: unavailable() };
    const selected = ctx.getDesktopSelection?.();
    if (!selected) return { error: unavailable() };
    const ids = target.fileId === undefined ? selected : [target.fileId];
    if (ids.length !== 1) return { error: rejected('disabled', 'Select one real Desktop item.') };
    const live = liveMacFileRecords(ctx.files), folder = live.find(file => file.id === 'desktop');
    const file = live.find(file => file.id === ids[0] && (file.parentId === 'desktop' || file.id === 'disk'));
    return folder && file ? { window: null, folder, live, file } : { error: stale() };
  }
  function allocate(records) {
    const userCount = ctx.files.files.reduce((count, file) => count + (file.readOnly ? 0 : 1), 0);
    if (userCount + records.length > MAX_FILES || !Number.isSafeInteger(ctx.files.nextFileId)
      || ctx.files.nextFileId < 1 || ctx.files.nextFileId + records.length >= MAX_COUNTER
      || !Number.isSafeInteger(ctx.files.sceneTime) || ctx.files.sceneTime < 0
      || ctx.files.sceneTime + records.length > MAX_TIME) return null;
    const ids = new Set(ctx.files.files.map(file => file.id));
    let number = ctx.files.nextFileId, timestamp = ctx.files.sceneTime;
    for (const record of records) {
      while (ids.has(`file-${number}`) && number < MAX_COUNTER) number++;
      if (number >= MAX_COUNTER) return null;
      record.id = `file-${number++}`; ids.add(record.id);
      record.revision = 1; record.createdAt = record.modifiedAt = record.addedAt = ++timestamp;
      record.lastOpenedAt = null;
    }
    return { number, timestamp };
  }
  const collisionNames = (live, parentId) => new Set(live.filter(file => file.parentId === parentId).map(file => file.name.toLowerCase()));
  function uniqueCopyName(name, names, kind) {
    const dot = name.lastIndexOf('.'), hasExtension = kind === 'document' && dot > 0;
    const stem = hasExtension ? name.slice(0, dot) : name, extension = hasExtension ? name.slice(dot) : '';
    for (let number = 1; number <= MAX_FILES + 1; number++) {
      const suffix = number === 1 ? ' copy' : ` copy ${number}`;
      const available = 255 - suffix.length - extension.length;
      if (available < 1) return null;
      const candidate = `${stem.slice(0, available)}${suffix}${extension}`;
      if (validMacDesktopName(candidate) && !names.has(candidate.toLowerCase())) return candidate;
    }
    return null;
  }
  return {
    'finder.selection.set': (target, payload) => {
      if (!fields(payload, ['fileIds']) || !Array.isArray(payload.fileIds) || payload.fileIds.length > MAX_FILES
        || !payload.fileIds.every(validId) || new Set(payload.fileIds).size !== payload.fileIds.length) return invalid();
      const value = owner(target, false);
      if (value.error) return value.error;
      if (payload.fileIds.some(id => !value.live.some(file => file.id === id && file.parentId === value.folder.id))) return stale();
      value.window.finderSelectedFileIds = [...payload.fileIds];
      return applied({ windowId: value.window.id });
    },
    'finder.file.open': async (target, payload) => {
      if (!fields(payload, [])) return invalid();
      const value = item(target);
      if (value.error) return value.error;
      if (value.folder.id === 'trash') return rejected('disabled', 'Restore items before opening them.');
      if (ctx.files.sceneTime >= MAX_TIME) return limited();
      const result = value.file.kind === 'folder'
        ? await ctx.navigate(value.window.id, value.file.id) : await ctx.openFile(value.file.id);
      return result.status === 'applied' ? applied({ windowId: value.window.id, fileId: value.file.id }) : result;
    },
    'finder.folder.create': (target, payload) => {
      if (!fields(payload, ['name'], []) || (Object.hasOwn(payload, 'name') && !validMacDesktopName(payload.name))) return invalid();
      const value = owner(target, false);
      if (value.error) return value.error;
      if (value.folder.readOnly || value.folder.id === 'trash') return rejected('disabled', 'This location is read-only.');
      const names = collisionNames(value.live, value.folder.id);
      let name = payload.name ?? 'untitled folder';
      if (Object.hasOwn(payload, 'name') && names.has(name.toLowerCase())) return rejected('collision', 'A live item already has that name.');
      for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `untitled folder ${suffix}`;
      const records = [{ parentId: value.folder.id, name, kind: 'folder', appId: 'finder', icon: 'folder', content: '', deleted: false, tags: [] }];
      const allocation = allocate(records);
      if (!allocation || !ctx.canAddFiles(records)) return limited();
      const historyOwner = ctx.editingHistory ? { windowId: value.window.id, folderId: value.folder.id,
        selectionBefore: [...(value.window.finderSelectedFileIds ?? [])] } : null;
      ctx.files.files.push(...records); ctx.files.nextFileId = allocation.number; ctx.files.sceneTime = allocation.timestamp;
      value.window.finderSelectedFileIds = [records[0].id];
      ctx.editingHistory?.recordCreated('New Folder', records, [records[0].id], historyOwner);
      return applied({ windowId: value.window.id, fileId: records[0].id });
    },
    'finder.file.duplicate': (target, payload) => {
      if (!fields(payload, [])) return invalid();
      const value = Object.hasOwn(target, 'windowId') ? item(target) : desktopItem(target);
      if (value.error) return value.error;
      if (value.folder.readOnly || value.folder.id === 'trash' || protectedIds.has(value.file.id) || value.file.readOnly)
        return rejected('disabled', 'Protected locations and application catalog records cannot be duplicated.');
      const name = uniqueCopyName(value.file.name, collisionNames(value.live, value.folder.id), value.file.kind);
      if (!name) return limited();
      const children = new Map();
      for (const file of value.live) {
        if (!children.has(file.parentId)) children.set(file.parentId, []);
        children.get(file.parentId).push(file);
      }
      const originals = [], parents = [], seen = new Set(), pending = [{ file: value.file, parentIndex: -1 }];
      while (pending.length) {
        const { file, parentIndex } = pending.pop();
        if (seen.has(file.id) || file.readOnly || protectedIds.has(file.id) || !['folder', 'document'].includes(file.kind))
          return rejected('disabled', 'The source contains a protected, cyclic or unsupported record.');
        seen.add(file.id); const index = originals.length; originals.push(file); parents.push(parentIndex);
        if (file.kind === 'folder') {
          const descendants = children.get(file.id) ?? [];
          for (let child = descendants.length - 1; child >= 0; child--) pending.push({ file: descendants[child], parentIndex: index });
        }
      }
      const records = originals.map((file, index) => ({ ...file, parentId: index ? '' : value.folder.id,
        name: index ? file.name : name, deleted: false, tags: [...(file.tags ?? [])] }));
      const allocation = allocate(records);
      if (!allocation) return limited();
      for (let index = 1; index < records.length; index++) records[index].parentId = records[parents[index]].id;
      if (!ctx.canAddFiles(records)) return limited();
      const historyOwner = ctx.editingHistory ? { windowId: value.window?.id ?? null, folderId: value.folder.id,
        selectionBefore: [...(value.window ? value.window.finderSelectedFileIds ?? [] : ctx.getDesktopSelection?.() ?? [])] } : null;
      ctx.files.files.push(...records); ctx.files.nextFileId = allocation.number; ctx.files.sceneTime = allocation.timestamp;
      if (value.window) value.window.finderSelectedFileIds = [records[0].id];
      else ctx.selectDesktop(records[0].id);
      ctx.editingHistory?.recordCreated('Duplicate', records, [records[0].id], historyOwner);
      return applied({ windowId: value.window?.id ?? null, fileId: records[0].id });
    },
    'finder.info.open': async (target, payload) => {
      if (!fields(payload, [])) return invalid();
      const value = item(target);
      if (value.error) return value.error;
      const result = await ctx.openInfo(value.file.id);
      return result.status === 'applied' ? applied({ windowId: value.window.id, fileId: value.file.id, infoWindowId: result.target.windowId }) : result;
    },
  };
}

const profiles = ['macos-golden-gate-27.0.1'];
const windowTarget = object({ windowId: identity });
const itemTarget = object({ windowId: identity, fileId: identity }, ['windowId']);
const fileResult = object({ windowId: identity, fileId: identity });
const define = (name, target, payload, effect, result = fileResult) => {
  const entry = defineCommand(profiles, name, 'shell.file-workflows', target, payload,
    ['Exact active visible ordinary Finder window and live current folder; no lock/login/global modal or competing presentation.',
      'Implicit item targets require exactly one window-owned selected live child, never the desktop selection. Explicit fileId must be a current child.'],
    [effect], ['windows.finderSelectedFileIds', 'files'], NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};
export const finderFileCatalog = Object.fromEntries([
  define('finder.selection.set', windowTarget, object({ fileIds: { type: 'array', maxItems: 1024, uniqueItems: true, items: identity } }),
    'Set this Finder window’s exact owned selection; validate the complete ID batch before mutation. Empty selection is valid.', windowTarget),
  define('finder.file.open', itemTarget, empty, 'Open one current child through existing folder navigation or associated application shell; launch-only coverage remains honest.'),
  define('finder.folder.create', windowTarget, object({ name: { type: 'string', minLength: 1, maxLength: 255 } }, []),
    'Create one real uniquely named native untitled folder in this current writable location and select it; never silently create on Desktop.'),
  define('finder.file.duplicate', object({ windowId: identity, fileId: identity }, []), empty,
    'Copy one document or complete live user-folder subtree with independent IDs/revisions/tags and deterministic timestamps; select the copy, retain source and unrelated records unchanged. Missing windowId means the real foreground Desktop only when no Finder window is active. Protected/cyclic descendants and all counter/content/name limits reject before allocation.',
    object({ windowId: { anyOf: [identity, { type: 'null' }] }, fileId: identity })),
  define('finder.info.open', itemTarget, empty, 'Open actual bounded Get Info for the selected nested file/folder through existing utility ownership.',
    object({ windowId: identity, fileId: identity, infoWindowId: identity })),
]);

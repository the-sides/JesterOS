import { isRecord, rejected } from './feature-commands.js';
import { liveFile, children } from './windows11-app-helpers.js';

const VIEWS = ['fan', 'grid', 'list', 'automatic'];
const DISPLAYS = ['folder', 'stack'];
const SORTS = ['name', 'date-added', 'date-created', 'date-modified', 'kind'];
const DATE_FIELDS = { 'date-added': 'addedAt', 'date-created': 'createdAt', 'date-modified': 'modifiedAt' };
const LABELS = { name: 'Name', 'date-added': 'Date Added', 'date-created': 'Date Created', 'date-modified': 'Date Modified',
  kind: 'Kind', folder: 'Folder', stack: 'Stack', fan: 'Fan', grid: 'Grid', list: 'List', automatic: 'Automatic' };
const compare = (a, b) => a.localeCompare(b, 'en-US', { numeric: true, sensitivity: 'base' });
const tie = (a, b) => compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const defaults = fileId => ({ view: 'automatic', display: 'stack', sortBy: fileId === 'downloads' ? 'date-added' : 'name' });
const preferences = (state, fileId) => ({ ...defaults(fileId), ...(Object.hasOwn(state.folderPreferences ?? {}, fileId) ? state.folderPreferences[fileId] : {}) });
const directory = (store, fileId) => {
  const file = liveFile(store, fileId);
  return file?.kind === 'folder' && file.id !== 'trash' && file.id !== 'disk' ? file : null;
};
// Match the native Get Info Kind labels; application bundles are not documents.
const kind = file => file.kind === 'application' ? 'Application' : file.kind === 'folder' ? 'Folder'
  : file.kind === 'image' ? 'Image document' : /\.pdf$/i.test(file.name) ? 'PDF document' : 'Text document';
function sortedChildren(store, folderId, sortBy) {
  const field = DATE_FIELDS[sortBy];
  return children(store, folderId).slice().sort((a, b) => {
    let primary = 0;
    if (field) {
      const first = Number.isFinite(a[field]), second = Number.isFinite(b[field]);
      primary = first && second ? b[field] - a[field] : first ? -1 : second ? 1 : 0;
    } else if (sortBy === 'kind') primary = compare(kind(a), kind(b));
    return primary || tie(a, b);
  });
}
export function macDockFolderDefaults() {
  return { folderFileIds: ['downloads'], folderPreferences: { downloads: defaults('downloads') }, folderStack: null };
}
export const dockFolderItemId = fileId => fileId === 'downloads' ? 'downloads' : `folder:${fileId}`;
export function folderSource(store, itemId) {
  if (typeof itemId !== 'string') return null;
  const fileId = itemId === 'downloads' ? 'downloads' : itemId.startsWith('folder:') ? itemId.slice(7) : null;
  return fileId && dockFolderItemId(fileId) === itemId ? directory(store, fileId) : null;
}
export function macDockFolders(state, store) {
  return [...new Set(state.folderFileIds ?? [])].flatMap(fileId => {
    const file = directory(store, fileId);
    if (!file) return [];
    const settings = preferences(state, fileId);
    return [{ itemId: dockFolderItemId(fileId), fileId, name: file.name, icon: file.icon ?? 'folder',
      preferences: settings, entries: sortedChildren(store, fileId, settings.sortBy) }];
  });
}
// Rebuild from current physical parents, not the historical navigation array.
function rootPath(store, rootFileId, folderId) {
  const path = [], seen = new Set();
  let file = directory(store, folderId);
  while (file && !seen.has(file.id)) {
    seen.add(file.id); path.unshift(file.id);
    if (file.id === rootFileId) return path;
    file = directory(store, file.parentId);
  }
  return null;
}
function liveStack(state, store) {
  const stack = state.folderStack;
  if (!stack || !(state.folderFileIds ?? []).includes(stack.rootFileId)
    || !rootPath(store, stack.rootFileId, stack.folderId)) return null;
  return stack;
}
export function macDockStackItems(state, store) {
  const stack = liveStack(state, store);
  return stack ? sortedChildren(store, stack.folderId, preferences(state, stack.rootFileId).sortBy) : [];
}
export function macDockStackView(state, store) {
  const stack = liveStack(state, store);
  if (!stack) return 'grid';
  if (stack.overrideView === 'grid') return 'grid';
  const view = preferences(state, stack.rootFileId).view;
  return view === 'automatic' ? (macDockStackItems(state, store).length <= 7 ? 'fan' : 'grid') : view;
}
export function macDockFolderContextItems(state, store, itemId) {
  const alias = macDockFolders(state, store).find(item => item.itemId === itemId);
  if (!alias) return [];
  const branch = (id, label, values, setting) => ({ id, label, enabled: true,
    children: values.map(value => ({ id: `${id}:${value}`, label: LABELS[value], enabled: true, checked: alias.preferences[setting] === value })) });
  return [{ id: 'folder-open-finder', label: 'Open in Finder', enabled: true },
    branch('folder-sort', 'Sort by', SORTS, 'sortBy'),
    branch('folder-display', 'Display as', DISPLAYS, 'display'),
    branch('folder-view', 'View content as', VIEWS, 'view'),
    { id: 'folder-remove', label: 'Remove from Dock', enabled: true, separatorBefore: true }];
}
export function reconcileMacDockFolders(state, store) {
  const folderFileIds = [...new Set(state.folderFileIds ?? [])].filter(fileId => directory(store, fileId));
  if (folderFileIds.length !== state.folderFileIds?.length
    || folderFileIds.some((fileId, index) => fileId !== state.folderFileIds[index])) state.folderFileIds = folderFileIds;
  const folderPreferences = Object.fromEntries(folderFileIds.map(fileId => [fileId, preferences(state, fileId)]));
  const previousPreferences = state.folderPreferences ?? {};
  if (Object.keys(previousPreferences).length !== folderFileIds.length || folderFileIds.some(fileId => {
    const previous = Object.hasOwn(previousPreferences, fileId) ? previousPreferences[fileId] : null;
    return !previous || Object.keys(previous).length !== 3
      || ['view', 'display', 'sortBy'].some(key => previous[key] !== folderPreferences[fileId][key]);
  })) state.folderPreferences = folderPreferences;
  const stack = state.folderStack;
  if (!stack) return;
  if (!state.folderFileIds.includes(stack.rootFileId)) { state.folderStack = null; return; }
  let path = rootPath(store, stack.rootFileId, stack.folderId);
  if (!path) {
    for (const fileId of [...new Set([stack.rootFileId, ...(stack.pathFileIds ?? [])])].reverse()) {
      path = rootPath(store, stack.rootFileId, fileId);
      if (path) break;
    }
  }
  if (!path) { state.folderStack = null; return; }
  const changed = stack.folderId !== path.at(-1) || path.length !== stack.pathFileIds?.length
    || path.some((id, index) => id !== stack.pathFileIds[index]);
  if (changed) {
    if (stack.folderId !== path.at(-1)) stack.folderId = path.at(-1);
    stack.pathFileIds = path;
    if (stack.scroll.top !== 0 || stack.scroll.left !== 0) stack.scroll = { top: 0, left: 0 };
    if (stack.overrideView !== null) stack.overrideView = null;
    if (stack.focusedItemId !== null) stack.focusedItemId = null;
  }
  const focus = stack.focusedItemId;
  if (focus?.startsWith('file:') && !macDockStackItems(state, store).some(file => `file:${file.id}` === focus)
    || focus === 'back' && path.length === 1 || focus === 'more' && macDockStackView(state, store) !== 'fan') stack.focusedItemId = null;
}

const fields = (value, names, required = names) => isRecord(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && names.includes(key))
  && required.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const optional = (value, key, validate) => !Object.hasOwn(value, key) || validate(value[key]);
const flag = value => typeof value === 'boolean';
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented folder-stack target and payload.');
const stale = () => rejected('stale_target', 'The actual folder, path, alias or child is no longer available.');
const unavailable = () => rejected('unavailable', 'The native Dock stack or requested control is not mounted or is blocked.');
const position = value => value && finite(value.top) && finite(value.left);

export function createMacDockFolderCommands(desktop, context) {
  const state = desktop.dock;
  const store = () => context.getStore();
  const view = () => context.getView();
  const available = () => context.available() && view()?.dockAvailable();
  const stack = () => liveStack(state, store());
  const aliases = () => macDockFolders(state, store());
  const controls = () => view()?.dockStackItemIds() ?? [];
  const liveControl = itemId => {
    const current = stack();
    if (!current || !controls().includes(itemId)) return false;
    if (itemId === 'open-finder') return true;
    if (itemId === 'back') return rootPath(store(), current.rootFileId, current.folderId).length > 1;
    if (itemId === 'more') return macDockStackView(state, store()) === 'fan';
    const file = itemId.startsWith('file:') && liveFile(store(), itemId.slice(5));
    return Boolean(file && file.parentId === current.folderId);
  };
  const release = () => {
    if (state.preferences.autoHide && !state.context && !state.appWindows && !state.folderStack
      && !state.drag && !state.hover && !state.focusedItemId) state.revealed = false;
  };
  async function focusFirst(resetScroll = false) {
    await view().prepareDock();
    if (resetScroll && !position(await view().scrollDockStack(0, 0))) return false;
    const ids = controls(), first = ids.find(itemId => itemId.startsWith('file:') && liveControl(itemId))
      ?? (liveControl('open-finder') ? 'open-finder' : null);
    if (!first || !await view().focusDockStackItem(first)) return false;
    if (!liveControl(first)) return false;
    state.folderStack.focusedItemId = first;
    const actual = view().dockStackScrollPosition();
    if (!position(actual)) return false;
    state.folderStack.scroll = { top: actual.top, left: actual.left };
    return true;
  }
  function makeStack(rootFileId, folderId, pathFileIds) {
    return { rootFileId, folderId, pathFileIds, focusedItemId: null, scroll: { top: 0, left: 0 }, overrideView: null };
  }
  async function navigate(folderId) {
    const current = stack();
    if (!current) return stale();
    const destination = directory(store(), folderId), path = destination && rootPath(store(), current.rootFileId, folderId);
    const actualCurrentPath = rootPath(store(), current.rootFileId, current.folderId);
    if (!path || !(destination.parentId === current.folderId || actualCurrentPath.includes(folderId))) return stale();
    state.folderStack = makeStack(current.rootFileId, folderId, path);
    if (!await focusFirst(true)) { state.folderStack = current; return unavailable(); }
    return applied({ folderId });
  }
  async function openFile(fileId) {
    const result = await context.invoke('desktop.open', { fileId }, {});
    if (result.status === 'applied') { state.folderStack = null; release(); }
    return result;
  }
  const commands = {
    'dock.folder.pin': (target, payload) => {
      if (!fields(target, ['fileId']) || !id(target.fileId) || !fields(payload, ['pinned']) || !flag(payload.pinned)) return invalid();
      if (!available()) return unavailable();
      if (!directory(store(), target.fileId)) return stale();
      const fileId = target.fileId, itemId = dockFolderItemId(fileId);
      if (payload.pinned) {
        if (!state.folderFileIds.includes(fileId)) state.folderFileIds = [...state.folderFileIds, fileId];
        if (!Object.hasOwn(state.folderPreferences, fileId)) state.folderPreferences = { ...state.folderPreferences, [fileId]: defaults(fileId) };
        if (!state.secondaryOrderItemIds.includes(itemId)) state.secondaryOrderItemIds = [...state.secondaryOrderItemIds, itemId];
      } else {
        state.folderFileIds = state.folderFileIds.filter(id => id !== fileId);
        state.folderPreferences = Object.fromEntries(Object.entries(state.folderPreferences).filter(([id]) => id !== fileId));
        state.secondaryOrderItemIds = state.secondaryOrderItemIds.filter(id => id !== itemId);
        if (state.folderStack?.rootFileId === fileId) state.folderStack = null;
        if (state.focusedItemId === itemId) state.focusedItemId = null;
        if (state.hover?.itemId === itemId) state.hover = null;
        release();
      }
      return applied({ fileId, itemId, pinned: payload.pinned });
    },
    'dock.folder.preferences.set': async (target, payload) => {
      if (!fields(target, ['fileId']) || !id(target.fileId) || !fields(payload, ['view', 'display', 'sortBy'], [])
        || !Reflect.ownKeys(payload).length || !optional(payload, 'view', value => VIEWS.includes(value))
        || !optional(payload, 'display', value => DISPLAYS.includes(value)) || !optional(payload, 'sortBy', value => SORTS.includes(value))) return invalid();
      if (!available()) return unavailable();
      const alias = aliases().find(item => item.fileId === target.fileId);
      if (!alias) return stale();
      const before = state.folderPreferences, previousStack = state.folderStack && { ...state.folderStack, scroll: { ...state.folderStack.scroll } };
      const settings = { ...alias.preferences };
      for (const key of ['view', 'display', 'sortBy']) if (Object.hasOwn(payload, key)) settings[key] = payload[key];
      state.folderPreferences = { ...before, [target.fileId]: settings };
      if (stack()?.rootFileId === target.fileId) {
        if (Object.hasOwn(payload, 'view')) state.folderStack.overrideView = null;
        await view().prepareDock();
        const focused = state.folderStack.focusedItemId;
        if (focused && controls().includes(focused)) {
          if (!await view().focusDockStackItem(focused)) { state.folderPreferences = before; state.folderStack = previousStack; return unavailable(); }
          const actual = view().dockStackScrollPosition();
          if (!position(actual)) { state.folderPreferences = before; state.folderStack = previousStack; return unavailable(); }
          state.folderStack.scroll = { top: actual.top, left: actual.left };
        } else if (!await focusFirst()) { state.folderPreferences = before; state.folderStack = previousStack; return unavailable(); }
      }
      return applied({ fileId: target.fileId, preferences: settings });
    },
    'dock.stack.open': async (target, payload) => {
      if (!fields(target, ['itemId']) || !id(target.itemId) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      const alias = aliases().find(item => item.itemId === target.itemId);
      if (!alias) return stale();
      const revealed = state.revealed;
      state.revealed = true; await view().prepareDock();
      if (!view().dockItemAnchor(target.itemId)) { state.revealed = revealed; return unavailable(); }
      if (!aliases().some(item => item.itemId === target.itemId)) { state.revealed = revealed; return stale(); }
      const prior = { stack: state.folderStack, context: state.context, appWindows: state.appWindows, focus: state.focusedItemId };
      context.dismissMenus(); state.context = null; state.appWindows = null;
      state.folderStack = makeStack(alias.fileId, alias.fileId, [alias.fileId]); state.focusedItemId = alias.itemId;
      if (!await focusFirst(true)) {
        state.folderStack = prior.stack; state.context = prior.context; state.appWindows = prior.appWindows;
        state.focusedItemId = prior.focus; state.revealed = revealed; return unavailable();
      }
      return applied({ itemId: alias.itemId, folderId: alias.fileId });
    },
    'dock.stack.close': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['restoreFocus'], []) || !optional(payload, 'restoreFocus', flag)) return invalid();
      if (!available()) return unavailable();
      const previous = state.folderStack;
      state.folderStack = null;
      if (previous && payload.restoreFocus !== false && aliases().some(item => item.fileId === previous.rootFileId)) {
        const result = await context.invoke('dock.focus', { itemId: dockFolderItemId(previous.rootFileId) }, {});
        if (result.status !== 'applied') { state.folderStack = previous; return result; }
      } else {
        if (previous && state.focusedItemId === dockFolderItemId(previous.rootFileId)) state.focusedItemId = null;
        release();
      }
      await view().prepareDock();
      return applied({});
    },
    'dock.stack.select': async (target, payload) => {
      if (!fields(target, ['itemId']) || !id(target.itemId) || !fields(payload, ['observe'], []) || !optional(payload, 'observe', flag)) return invalid();
      if (!available()) return unavailable();
      const current = stack();
      if (!current) return stale();
      if (!liveControl(target.itemId)) return stale();
      if (!payload.observe && !await view().focusDockStackItem(target.itemId)) return unavailable();
      if (stack() !== current || !liveControl(target.itemId)) return stale();
      const actual = view().dockStackScrollPosition();
      if (!position(actual)) return unavailable();
      current.focusedItemId = target.itemId; current.scroll = { top: actual.top, left: actual.left };
      return applied({ itemId: target.itemId });
    },
    'dock.stack.activate': async (target, payload) => {
      if (!fields(target, ['fileId']) || !id(target.fileId) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      const current = stack(), file = liveFile(store(), target.fileId);
      if (!current || !file || file.parentId !== current.folderId) return stale();
      if (file.kind === 'folder') {
        const result = await navigate(file.id);
        return result.status === 'applied' ? applied({ fileId: file.id, folderId: file.id }) : result;
      }
      const result = await openFile(file.id);
      if (result.status !== 'applied') return result;
      const destination = { fileId: file.id, folderId: current.folderId };
      if (id(result.target.appId)) destination.appId = result.target.appId;
      if (id(result.target.windowId)) destination.windowId = result.target.windowId;
      return applied(destination);
    },
    'dock.stack.navigate': async (target, payload) => {
      if (!fields(target, ['folderId']) || !id(target.folderId) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      return navigate(target.folderId);
    },
    'dock.stack.openInFinder': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      const current = stack();
      if (!current) return stale();
      const result = await openFile(current.folderId);
      if (result.status !== 'applied') return result;
      return applied({ fileId: current.folderId, appId: result.target.appId, windowId: result.target.windowId });
    },
    'dock.stack.scroll': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['top', 'left', 'observe'], ['top']) || !finite(payload.top)
        || !optional(payload, 'left', finite) || !optional(payload, 'observe', flag)) return invalid();
      if (!available()) return unavailable();
      const current = stack();
      if (!current) return stale();
      if (!position(view().dockStackScrollPosition())) return unavailable();
      const actual = payload.observe ? view().dockStackScrollPosition() : await view().scrollDockStack(payload.top, payload.left ?? 0);
      if (!position(actual)) return unavailable();
      if (stack() !== current) return stale();
      current.scroll = { top: actual.top, left: actual.left };
      return applied({ top: actual.top, left: actual.left });
    },
    'dock.stack.showMore': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      const current = stack();
      if (!current) return stale();
      if (macDockStackView(state, store()) !== 'fan' || !controls().includes('more')) return rejected('disabled', 'Only a rendered overflowing fan has More.');
      state.folderStack = { ...current, overrideView: 'grid', focusedItemId: null, scroll: { top: 0, left: 0 } };
      if (!await focusFirst(true)) { state.folderStack = current; return unavailable(); }
      return applied({ view: 'grid' });
    },
  };
  return commands;
}

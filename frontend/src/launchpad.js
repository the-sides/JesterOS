import { isRecord, rejected } from './feature-commands.js';

export const PAGE_SIZE = 35;
export const FOLDER_PAGE_SIZE = 21;

const macProfiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0'];
const supported = profile => profile?.family === 'macos' && macProfiles.includes(profile.id)
  && profile.capabilities.includes('shell.launchpad');
const identity = value => typeof value === 'string' && value.length > 0;
const fields = (value, names, required = names) => isRecord(value)
  && Object.keys(value).every(key => names.includes(key)) && required.every(key => Object.hasOwn(value, key));
const pageValid = value => Number.isInteger(value) && value >= 0;
const offsetValid = value => Number.isFinite(value) && value >= 0;
const scrollValid = value => value && offsetValid(value.top) && offsetValid(value.left);
const nameValid = value => typeof value === 'string' && value.trim().length > 0 && !/[\0\r\n]/.test(value);
const nameError = 'Enter a nonempty folder name without a line break or NUL character.';
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented closed Launchpad arguments.');
const unavailable = () => rejected('unavailable', 'The actual native Launchpad scene, control or focus is unavailable or blocked by a global modal.');
const disabled = () => rejected('disabled', 'This Launchpad transition is not enabled in the current arrangement or presentation.');
const notFound = () => rejected('not_found', 'The requested installed application, Launchpad folder or enabled control no longer exists.');
const copy = value => Array.isArray(value) ? value.map(copy)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)])) : value;
const folderItemId = id => `folder:${id}`;
const appItemId = id => `app:${id}`;
const folderPages = folder => Math.max(1, Math.ceil(folder.appIds.length / FOLDER_PAGE_SIZE));
const rootPage = (state, page) => Math.max(0, Math.min(page, state.pages.length - 1));

export function launchpadAppIds(profile) {
  return Object.keys(profile?.applications ?? {}).filter(id => id !== profile.defaults?.desktopAppId
    && !profile.applications[id].presentation);
}

export function launchpadDefaults(profile) {
  const appIds = launchpadAppIds(profile);
  const otherIds = new Set(profile?.launchpad?.otherAppIds ?? []);
  const other = appIds.filter(id => otherIds.has(id));
  const folders = other.length ? [{ id: 'launchpad-folder-1', name: 'Other', appIds: other }] : [];
  const items = [];
  let otherAdded = false;
  for (const id of appIds) {
    if (!otherIds.has(id)) items.push(appItemId(id));
    else if (!otherAdded) {
      items.push(folderItemId(folders[0].id));
      otherAdded = true;
    }
  }
  const pages = [];
  for (let index = 0; index < items.length; index += PAGE_SIZE) pages.push(items.slice(index, index + PAGE_SIZE));
  return { pages: pages.length ? pages : [[]], folders, nextFolderId: other.length ? 2 : 1, view: null };
}

function appRow(profile, appId) {
  const app = profile.applications[appId];
  return app ? { itemId: appItemId(appId), type: 'app', appId, name: app.name, icon: app.icon } : null;
}

function rootRow(profile, state, itemId) {
  if (itemId.startsWith('app:')) return appRow(profile, itemId.slice(4));
  const folder = state.folders.find(record => folderItemId(record.id) === itemId);
  return folder ? { itemId, type: 'folder', folderId: folder.id, name: folder.name, appIds: [...folder.appIds] } : null;
}

export function launchpadItems(profile, state, region = 'main') {
  const current = state.view;
  if (!current) return [];
  if (region === 'folder') {
    const folder = state.folders.find(record => record.id === current.folderId);
    return folder ? folder.appIds.slice(current.folderPage * FOLDER_PAGE_SIZE, (current.folderPage + 1) * FOLDER_PAGE_SIZE)
      .map(id => appRow(profile, id)).filter(Boolean) : [];
  }
  if (region !== 'main') return [];
  if (current.query) {
    const query = current.query.toLowerCase();
    const rows = [];
    for (const page of state.pages) for (const itemId of page) {
      const row = rootRow(profile, state, itemId);
      if (row?.type === 'app') rows.push(row);
      else if (row) rows.push(...row.appIds.map(id => appRow(profile, id)).filter(Boolean));
    }
    return rows.filter(row => row.name.toLowerCase().includes(query));
  }
  return (state.pages[current.page] ?? []).map(id => rootRow(profile, state, id)).filter(Boolean);
}

export function launchpadControlIds(profile, state) {
  const current = state.view;
  if (!current) return [];
  if (current.folderId) {
    const folder = state.folders.find(record => record.id === current.folderId);
    if (!folder) return [];
    return [current.rename ? 'folder-name-input' : 'folder-name', ...launchpadItems(profile, state, 'folder').map(row => row.itemId),
      ...Array.from({ length: folderPages(folder) }, (_, page) => `folder-page:${page}`), 'folder-close'];
  }
  return ['search', ...launchpadItems(profile, state).map(row => row.itemId),
    ...(current.query ? [] : Array.from({ length: state.pages.length + (current.editing ? 1 : 0) }, (_, page) => `main-page:${page}`))];
}

export function launchpadLocation(profile, state, itemId) {
  if (!identity(itemId)) return null;
  for (let page = 0; page < state.pages.length; page += 1) {
    const index = state.pages[page].indexOf(itemId);
    if (index !== -1) return { folderId: null, page, index };
  }
  for (const folder of state.folders) {
    const index = folder.appIds.findIndex(id => appItemId(id) === itemId);
    if (index !== -1 && Object.hasOwn(profile.applications, folder.appIds[index])) {
      return { folderId: folder.id, page: Math.floor(index / FOLDER_PAGE_SIZE), index: index % FOLDER_PAGE_SIZE };
    }
  }
  return null;
}

export function createLaunchpadCommands(ctx) {
  const { profile, state } = ctx;
  const eligibleApps = new Set(launchpadAppIds(profile));
  const native = () => ctx.getView();
  const controls = () => launchpadControlIds(profile, state);
  const available = () => ctx.available() === true;
  const activeRegion = () => state.view?.folderId ? 'folder' : 'main';
  const mounted = () => {
    if (!available() || !state.view || native()?.available() !== true) return false;
    const bounds = native().bounds();
    return bounds && Number.isFinite(bounds.width) && bounds.width > 0 && Number.isFinite(bounds.height) && bounds.height > 0
      && scrollValid(native().scrollPosition(activeRegion()));
  };
  const folderById = id => state.folders.find(folder => folder.id === id);
  const arrangementError = () => !mounted() ? unavailable() : state.view.query || state.view.rename ? disabled() : null;
  let returnFocus = null;
  let focusOwner = null;

  function snapshot() {
    const current = state.view;
    return { pages: copy(state.pages), folders: copy(state.folders), nextFolderId: state.nextFolderId,
      view: current, viewValues: copy(current), scene: ctx.captureScene(), focus: ctx.captureFocus(), returnFocus, focusOwner,
      itemId: mounted() ? native().focusedItemId() : null,
      region: current ? activeRegion() : null,
      position: mounted() ? { ...native().scrollPosition(activeRegion()) } : null };
  }

  async function restore(previous) {
    state.pages = previous.pages;
    state.folders = previous.folders;
    state.nextFolderId = previous.nextFolderId;
    state.view = previous.view;
    if (state.view) {
      for (const key of Object.keys(state.view)) if (!Object.hasOwn(previous.viewValues, key)) delete state.view[key];
      for (const [key, value] of Object.entries(previous.viewValues)) state.view[key] = value;
    }
    returnFocus = previous.returnFocus;
    focusOwner = previous.focusOwner === previous.view && previous.view !== null ? state.view : null;
    try {
      await ctx.restoreScene(previous.scene);
      await ctx.settle();
      if (state.view) {
        await native()?.prepare();
        if (mounted()) {
          if (previous.itemId && controls().includes(previous.itemId)) await native().focus(previous.itemId);
          if (previous.position) await native().scroll(previous.region, previous.position.top, previous.position.left);
        }
      }
      await ctx.restoreFocus(previous.focus);
    } catch {
      // A failed transition remains rejected even if its old physical scene has
      // itself become unavailable; canonical records/ownership are already back.
      try { await ctx.restoreFocus(previous.focus); } catch { /* The original may have unmounted. */ }
    }
  }

  async function atomic(change) {
    let previous;
    try { previous = snapshot(); } catch { return unavailable(); }
    try {
      const result = await change();
      if (result.status !== 'applied') await restore(previous);
      return result;
    } catch {
      await restore(previous);
      return unavailable();
    }
  }

  function retainScroll(current) {
    if (state.view !== current || !mounted()) return false;
    const region = activeRegion(), position = native().scrollPosition(region);
    if (!scrollValid(position)) return false;
    current.scroll[region] = { ...position };
    return true;
  }

  async function select(itemId) {
    if (!mounted()) return unavailable();
    if (!controls().includes(itemId)) return notFound();
    if (!native().itemIds().includes(itemId)) return unavailable();
    const current = state.view;
    if (!await native().focus(itemId)) return unavailable();
    if (state.view !== current || !mounted() || native().focusedItemId() !== itemId
      || !controls().includes(itemId) || !native().itemIds().includes(itemId) || !retainScroll(current)) return unavailable();
    current.selectedItemId = itemId;
    return applied({ itemId });
  }

  async function prepare(current, itemId = current.selectedItemId) {
    await ctx.settle();
    if (state.view !== current) return unavailable();
    await native()?.prepare();
    if (state.view !== current || !mounted()) return unavailable();
    const region = activeRegion(), position = current.scroll[region];
    const actual = await native().scroll(region, position.top, position.left);
    if (state.view !== current || !mounted() || !scrollValid(actual)) return unavailable();
    return select(itemId);
  }

  function clearView() {
    state.view = null;
    returnFocus = null;
    focusOwner = null;
  }

  function dissolveEmptyFolders() {
    const emptyIds = new Set(state.folders.filter(folder => folder.appIds.length === 0).map(folder => folderItemId(folder.id)));
    state.folders = state.folders.filter(folder => folder.appIds.length > 0);
    for (const page of state.pages) for (let index = page.length - 1; index >= 0; index -= 1) {
      if (emptyIds.has(page[index])) page.splice(index, 1);
    }
  }

  function compact() {
    dissolveEmptyFolders();
    state.pages = state.pages.filter(page => page.length > 0);
    if (!state.pages.length) state.pages = [[]];
  }

  function removeItem(itemId, location) {
    if (location.folderId) {
      const folder = folderById(location.folderId);
      folder.appIds.splice(location.page * FOLDER_PAGE_SIZE + location.index, 1);
    } else state.pages[location.page].splice(location.index, 1);
  }

  function showLocation(current, itemId, location) {
    current.rename = null;
    current.selectedItemId = itemId;
    if (location.folderId) {
      const parent = launchpadLocation(profile, state, folderItemId(location.folderId));
      current.page = parent.page;
      current.folderId = location.folderId;
      current.folderPage = location.page;
      current.scroll.folder = { top: 0, left: 0 };
    } else {
      current.page = location.page;
      current.folderId = null;
      current.folderPage = 0;
      current.scroll.main = { top: 0, left: 0 };
    }
    current.searchReturnPage = current.page;
  }

  function folderVisible(folderId) {
    return state.view.folderId === folderId || !state.view.folderId && !state.view.query
      && controls().includes(folderItemId(folderId)) && native().itemIds().includes(folderItemId(folderId));
  }

  async function presentNameError() {
    const current = state.view, draft = current.rename;
    let previous;
    try { previous = snapshot(); } catch { return unavailable(); }
    try {
      draft.error = nameError;
      await ctx.settle();
      if (state.view !== current || current.rename !== draft || !mounted()
        || !native().itemIds().includes('folder-name-input')) {
        await restore(previous);
        return unavailable();
      }
      return rejected('invalid_arguments', nameError);
    } catch {
      await restore(previous);
      return unavailable();
    }
  }

  const commands = {
    'shell.launchpad.open': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!available() || state.view && !mounted()) return unavailable();
      return atomic(async () => {
        if (!state.view) {
          const focus = ctx.captureFocus();
          await ctx.dismissPresentations();
          state.view = { page: 0, query: '', folderId: null, folderPage: 0, editing: false, rename: null,
            selectedItemId: 'search', searchReturnPage: 0, scroll: { main: { top: 0, left: 0 }, folder: { top: 0, left: 0 } } };
          returnFocus = focus;
          focusOwner = state.view; // Svelte's assigned proxy, never the preassignment raw object.
        }
        const current = state.view, result = await prepare(current);
        return result.status === 'applied' ? applied({ page: current.page, folderId: current.folderId, itemId: current.selectedItemId }) : result;
      });
    },
    'shell.launchpad.close': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['restoreFocus'], [])
        || Object.hasOwn(payload, 'restoreFocus') && typeof payload.restoreFocus !== 'boolean') return invalid();
      if (!available()) return unavailable();
      if (!state.view) return applied({ closed: false });
      if (!mounted()) return unavailable();
      return atomic(async () => {
        const focus = focusOwner === state.view ? returnFocus : null;
        clearView();
        await ctx.settle();
        if (!available() || state.view !== null) return unavailable();
        if (payload.restoreFocus !== false && !(focus !== null && await ctx.restoreFocus(focus) === true)) return unavailable();
        return applied({ closed: true });
      });
    },
    'shell.launchpad.select': async (target, payload) => {
      if (!fields(target, ['itemId']) || !identity(target.itemId) || !fields(payload, [])) return invalid();
      if (!mounted()) return unavailable();
      if (!controls().includes(target.itemId)) return notFound();
      return atomic(() => select(target.itemId));
    },
    'shell.launchpad.search': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['query']) || typeof payload.query !== 'string') return invalid();
      if (!mounted()) return unavailable();
      return atomic(async () => {
        const current = state.view, changed = current.query !== payload.query;
        if (!current.query && payload.query) current.searchReturnPage = current.page;
        if (current.query && !payload.query) current.page = Math.max(0,
          Math.min(current.searchReturnPage, state.pages.length - (current.editing ? 0 : 1)));
        else if (payload.query) current.page = 0;
        current.query = payload.query;
        current.folderId = null;
        current.folderPage = 0;
        current.rename = null;
        current.selectedItemId = 'search';
        if (changed) current.scroll.main = { top: 0, left: 0 };
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ query: current.query, itemIds: launchpadItems(profile, state).map(row => row.itemId) }) : result;
      });
    },
    'shell.launchpad.setPage': async (target, payload) => {
      if (!fields(target, ['region']) || !['main', 'folder'].includes(target.region)
        || !fields(payload, ['page']) || !pageValid(payload.page)) return invalid();
      if (!mounted()) return unavailable();
      const current = state.view, region = target.region;
      if (region !== activeRegion() || current.query) return disabled();
      const count = region === 'main' ? state.pages.length + (current.editing ? 1 : 0) : folderPages(folderById(current.folderId));
      if (payload.page >= count) return disabled();
      return atomic(async () => {
        const key = region === 'main' ? 'page' : 'folderPage';
        if (current[key] !== payload.page) current.scroll[region] = { top: 0, left: 0 };
        current[key] = payload.page;
        if (region === 'main') current.searchReturnPage = current.page;
        const preserved = ['search', 'folder-name', 'folder-name-input'].includes(current.selectedItemId) ? current.selectedItemId : null;
        current.selectedItemId = preserved ?? launchpadItems(profile, state, region)[0]?.itemId
          ?? (region === 'main' ? 'search' : current.rename ? 'folder-name-input' : 'folder-name');
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ region, page: current[key] }) : result;
      });
    },
    'shell.launchpad.setEditing': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['editing']) || typeof payload.editing !== 'boolean') return invalid();
      if (!mounted()) return unavailable();
      return atomic(async () => {
        const current = state.view;
        current.editing = payload.editing;
        if (!current.editing && current.page >= state.pages.length) {
          current.page = rootPage(state, current.page);
          current.scroll.main = { top: 0, left: 0 };
        }
        if (!controls().includes(current.selectedItemId)) current.selectedItemId = current.folderId
          ? current.rename ? 'folder-name-input' : 'folder-name' : 'search';
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ editing: current.editing }) : result;
      });
    },
    'shell.launchpad.scroll': async (target, payload) => {
      if (!fields(target, ['region']) || !['main', 'folder'].includes(target.region)
        || !fields(payload, ['top', 'left']) || !offsetValid(payload.top) || !offsetValid(payload.left)) return invalid();
      if (!mounted()) return unavailable();
      if (target.region !== activeRegion()) return disabled();
      return atomic(async () => {
        const current = state.view, position = await native().scroll(target.region, payload.top, payload.left);
        if (state.view !== current || !mounted()) return unavailable();
        const actual = native().scrollPosition(target.region);
        if (!scrollValid(position) || !scrollValid(actual) || actual.top !== position.top || actual.left !== position.left) return unavailable();
        current.scroll[target.region] = { ...actual };
        return applied({ region: target.region, ...actual });
      });
    },
    'shell.launchpad.activate': async (target, payload) => {
      if (!fields(target, ['appId']) || !identity(target.appId) || !fields(payload, [])) return invalid();
      if (!mounted()) return unavailable();
      if (!eligibleApps.has(target.appId) || !launchpadLocation(profile, state, appItemId(target.appId))) return notFound();
      if (state.view.editing || state.view.rename || !controls().includes(appItemId(target.appId))) return disabled();
      if (!native().itemIds().includes(appItemId(target.appId))) return unavailable();
      return atomic(async () => {
        clearView();
        await ctx.settle();
        if (!available() || state.view !== null) return unavailable();
        const result = await ctx.invoke('app.open', { appId: target.appId }, {});
        if (result?.status !== 'applied') return result?.status === 'rejected' ? result : unavailable();
        await ctx.settle();
        const id = result.target?.windowId;
        const original = identity(id) ? ctx.getWindows().find(window => window.id === id && window.appId === target.appId) : null;
        if (!available() || state.view !== null || result.target?.appId !== target.appId || !original || original.minimized
          || original.hidden || original.pendingQuit || ctx.getActiveWindowId() !== id || ctx.getActiveAppId() !== target.appId
          || ctx.isOriginalFocused(id) !== true) return unavailable();
        return applied({ appId: target.appId, windowId: id });
      });
    },
    'shell.launchpad.folder.open': async (target, payload) => {
      if (!fields(target, ['folderId']) || !identity(target.folderId) || !fields(payload, [])) return invalid();
      if (!mounted()) return unavailable();
      if (!folderById(target.folderId)) return notFound();
      if (state.view.folderId || state.view.query || !controls().includes(folderItemId(target.folderId))) return disabled();
      if (!native().itemIds().includes(folderItemId(target.folderId))) return unavailable();
      return atomic(async () => {
        const current = state.view;
        current.folderId = target.folderId;
        current.folderPage = 0;
        current.rename = null;
        current.scroll.folder = { top: 0, left: 0 };
        current.selectedItemId = launchpadItems(profile, state, 'folder')[0]?.itemId ?? 'folder-name';
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ folderId: current.folderId, page: current.folderPage, itemId: current.selectedItemId }) : result;
      });
    },
    'shell.launchpad.folder.close': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!mounted()) return unavailable();
      if (!state.view.folderId) return applied({ closed: false });
      return atomic(async () => {
        const current = state.view, itemId = folderItemId(current.folderId);
        const location = launchpadLocation(profile, state, itemId);
        if (!location) return notFound();
        current.page = location.page;
        current.folderId = null;
        current.folderPage = 0;
        current.rename = null;
        current.selectedItemId = itemId;
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ closed: true }) : result;
      });
    },
    'launchpad.move': async (target, payload) => {
      if (!fields(target, ['itemId']) || !identity(target.itemId)
        || !fields(payload, ['folderId', 'page', 'beforeItemId']) || !(payload.folderId === null || identity(payload.folderId))
        || !pageValid(payload.page) || !(payload.beforeItemId === null || identity(payload.beforeItemId))) return invalid();
      const error = arrangementError();
      if (error) return error;
      const source = launchpadLocation(profile, state, target.itemId);
      if (!source) return notFound();
      const destination = payload.folderId === null ? null : folderById(payload.folderId);
      if (payload.folderId !== null && !destination) return notFound();
      if (payload.beforeItemId === target.itemId || destination && !target.itemId.startsWith('app:')) return disabled();
      if (destination ? payload.page >= folderPages(destination)
        : payload.page >= state.pages.length + (state.view.editing ? 1 : 0)) return disabled();
      if (payload.beforeItemId !== null) {
        const before = launchpadLocation(profile, state, payload.beforeItemId);
        if (!before || before.folderId !== payload.folderId || before.page !== payload.page) return disabled();
      }
      return atomic(async () => {
        const current = state.view;
        if (!destination && payload.page === state.pages.length) state.pages.push([]);
        const destinationPage = destination ? null : state.pages[payload.page];
        removeItem(target.itemId, source);
        if (source.folderId !== payload.folderId) dissolveEmptyFolders();
        if (destination) {
          const before = payload.beforeItemId === null ? Math.min((payload.page + 1) * FOLDER_PAGE_SIZE, destination.appIds.length)
            : destination.appIds.indexOf(payload.beforeItemId.slice(4));
          if (before < 0) return disabled();
          destination.appIds.splice(before, 0, target.itemId.slice(4));
        } else {
          const before = payload.beforeItemId === null ? destinationPage.length : destinationPage.indexOf(payload.beforeItemId);
          if (before < 0) return disabled();
          destinationPage.splice(before, 0, target.itemId);
          for (let page = payload.page; page < state.pages.length; page += 1) {
            if (state.pages[page].length <= PAGE_SIZE) continue;
            const overflow = state.pages[page].splice(PAGE_SIZE);
            if (!state.pages[page + 1]) state.pages.push([]);
            state.pages[page + 1].unshift(...overflow);
          }
        }
        compact();
        const location = launchpadLocation(profile, state, target.itemId);
        showLocation(current, target.itemId, location);
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ itemId: target.itemId, ...location }) : result;
      });
    },
    'launchpad.folder.create': async (target, payload) => {
      if (!fields(target, ['appId', 'overAppId']) || !identity(target.appId) || !identity(target.overAppId)
        || !fields(payload, ['name'], []) || Object.hasOwn(payload, 'name') && !nameValid(payload.name)) return invalid();
      const error = arrangementError();
      if (error) return error;
      const source = launchpadLocation(profile, state, appItemId(target.appId));
      const over = launchpadLocation(profile, state, appItemId(target.overAppId));
      if (!eligibleApps.has(target.appId) || !eligibleApps.has(target.overAppId) || !source || !over) return notFound();
      if (target.appId === target.overAppId || over.folderId !== null) return disabled();
      return atomic(async () => {
        const current = state.view;
        removeItem(appItemId(target.appId), source);
        const location = launchpadLocation(profile, state, appItemId(target.overAppId));
        const folder = { id: `launchpad-folder-${state.nextFolderId}`, name: payload.name?.trim() ?? 'Folder', appIds: [target.overAppId, target.appId] };
        state.nextFolderId += 1;
        state.folders.push(folder);
        state.pages[location.page].splice(location.index, 1, folderItemId(folder.id));
        compact();
        showLocation(current, folderItemId(folder.id), launchpadLocation(profile, state, folderItemId(folder.id)));
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ folderId: folder.id, appIds: [...folder.appIds] }) : result;
      });
    },
    'launchpad.folder.rename': async (target, payload) => {
      if (!fields(target, ['folderId']) || !identity(target.folderId) || !fields(payload, ['name']) || typeof payload.name !== 'string') return invalid();
      if (!mounted()) return unavailable();
      const folder = folderById(target.folderId);
      if (!folder) return notFound();
      if (!folderVisible(folder.id)) return disabled();
      if (!nameValid(payload.name)) return state.view.rename?.folderId === folder.id ? presentNameError() : rejected('invalid_arguments', nameError);
      return atomic(async () => {
        const current = state.view;
        folder.name = payload.name.trim();
        if (current.rename?.folderId === folder.id) current.rename = null;
        current.selectedItemId = current.folderId === folder.id ? 'folder-name' : folderItemId(folder.id);
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ folderId: folder.id, name: folder.name }) : result;
      });
    },
    'launchpad.folder.rename.begin': async (target, payload) => {
      if (!fields(target, ['folderId']) || !identity(target.folderId) || !fields(payload, [])) return invalid();
      if (!mounted()) return unavailable();
      const folder = folderById(target.folderId);
      if (!folder) return notFound();
      if (state.view.folderId !== folder.id || state.view.query) return disabled();
      return atomic(async () => {
        const current = state.view;
        current.rename = { folderId: folder.id, name: folder.name, error: null };
        current.selectedItemId = 'folder-name-input';
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ folderId: folder.id }) : result;
      });
    },
    'launchpad.folder.rename.change': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['name']) || typeof payload.name !== 'string') return invalid();
      if (!mounted()) return unavailable();
      if (!state.view.rename || state.view.rename.folderId !== state.view.folderId) return disabled();
      return atomic(async () => {
        const current = state.view;
        current.rename.name = payload.name;
        current.rename.error = null;
        current.selectedItemId = 'folder-name-input';
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ folderId: current.rename.folderId, name: current.rename.name }) : result;
      });
    },
    'launchpad.folder.rename.commit': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!mounted()) return unavailable();
      const draft = state.view.rename;
      if (!draft || draft.folderId !== state.view.folderId) return disabled();
      const folder = folderById(draft.folderId);
      if (!folder) return notFound();
      if (!nameValid(draft.name)) return presentNameError();
      return atomic(async () => {
        const current = state.view;
        folder.name = draft.name.trim();
        current.rename = null;
        current.selectedItemId = 'folder-name';
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ folderId: folder.id, name: folder.name }) : result;
      });
    },
    'launchpad.folder.rename.cancel': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!mounted()) return unavailable();
      if (!state.view.rename || state.view.rename.folderId !== state.view.folderId) return disabled();
      return atomic(async () => {
        const current = state.view, folderId = current.rename.folderId;
        current.rename = null;
        current.selectedItemId = 'folder-name';
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ folderId }) : result;
      });
    },
  };
  for (const name of Object.keys(commands)) {
    const handler = commands[name];
    commands[name] = (target, payload) => supported(profile) ? handler(target, payload)
      : rejected('unsupported_profile', `The active OS profile does not support command: ${name}`);
  }
  return commands;
}

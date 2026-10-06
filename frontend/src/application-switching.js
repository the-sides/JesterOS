import { isRecord, rejected } from './feature-commands.js';

const identity = value => typeof value === 'string' && value.length > 0;
const fields = (value, names, required = names) => isRecord(value)
  && Object.keys(value).every(key => names.includes(key)) && required.every(key => Object.hasOwn(value, key));
const sameOrder = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
const unique = values => [...new Set(values)];
const applied = (target = {}) => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented closed application switching arguments.');
const unavailable = () => rejected('unavailable', 'The native scene or requested switching control is unavailable or blocked by a global modal.');
const directionValid = value => value === 'next' || value === 'previous';
const finiteOffset = value => Number.isFinite(value) && value >= 0;
const scrollValid = value => value && finiteOffset(value.top) && finiteOffset(value.left);
const switcherKind = profile => profile.family === 'macos' ? 'applications' : 'windows';

function replaceOrder(state, key, values) {
  if (!sameOrder(state[key], values)) state[key] = values;
}

function liveApplications(profile, runningAppIds) {
  return unique(runningAppIds.filter(appId => identity(appId) && Object.hasOwn(profile.applications, appId)));
}

function liveWindows(profile, runningAppIds, windows) {
  const running = new Set(liveApplications(profile, runningAppIds)), seen = new Set();
  return windows.filter(window => identity(window.id) && running.has(window.appId)
    && !seen.has(window.id) && seen.add(window.id));
}

function orderedIds(preferred, liveIds) {
  const live = new Set(liveIds);
  return unique([...preferred.filter(id => live.has(id)), ...liveIds]);
}

function liveSwitcherItems(state, profile, runningAppIds, windows, pendingQuitAppIds) {
  const pending = new Set(pendingQuitAppIds);
  const running = liveApplications(profile, runningAppIds).filter(appId => !pending.has(appId));
  const managed = liveWindows(profile, running, windows);
  if (profile.family === 'macos') {
    return orderedIds(state.activationAppIds, running).map(appId => {
      const app = profile.applications[appId], appWindows = managed.filter(window => window.appId === appId);
      return { itemId: `app:${appId}`, appId, name: app.name, icon: app.icon,
        hidden: state.hiddenAppIds.includes(appId), minimized: appWindows.length > 0 && appWindows.every(window => window.minimized),
        windowIds: appWindows.map(window => window.id) };
    });
  }
  const byId = new Map(managed.map(window => [window.id, window]));
  // The managed array is also the native stacking order: its last entry is foreground.
  return orderedIds(state.activationWindowIds, managed.map(window => window.id).reverse()).map(windowId => {
    const window = byId.get(windowId), app = profile.applications[window.appId];
    return { itemId: `window:${windowId}`, appId: window.appId, windowId, name: app.name,
      title: window.title, icon: app.icon, minimized: Boolean(window.minimized) };
  });
}

export function applicationSwitchingDefaults(profile) {
  return { activationAppIds: [], activationWindowIds: [], creationWindowIds: [], hiddenAppIds: [], switcher: null,
    ...(!profile.capabilities.includes('shell.menu-bar') ? { appMenu: null } : {}) };
}

export function recordApplicationActivation(state, appId, windowId = null, created = false) {
  if (!identity(appId)) return;
  replaceOrder(state, 'activationAppIds', unique([appId, ...state.activationAppIds]));
  if (!identity(windowId)) return;
  replaceOrder(state, 'activationWindowIds', unique([windowId, ...state.activationWindowIds]));
  if (created && !state.creationWindowIds.includes(windowId)) state.creationWindowIds = [...state.creationWindowIds, windowId];
}

export function applicationSwitcherItems(state, profile, runningAppIds, windows, pendingQuitAppIds = []) {
  const items = liveSwitcherItems(state, profile, runningAppIds, windows, pendingQuitAppIds);
  if (!state.switcher || state.switcher.kind !== switcherKind(profile)) return items;
  const byId = new Map(items.map(item => [item.itemId, item]));
  return orderedIds(state.switcher.itemIds, items.map(item => item.itemId)).map(itemId => byId.get(itemId));
}

export function applicationMenuItems(state, profile, appId, runningAppIds, pendingQuitAppIds = []) {
  if (profile.family !== 'macos' || !Object.hasOwn(profile.applications, appId)) return [];
  const app = profile.applications[appId], running = liveApplications(profile, runningAppIds);
  const pending = new Set(pendingQuitAppIds), live = running.includes(appId) && !pending.has(appId);
  const hidden = new Set(state.hiddenAppIds.filter(id => running.includes(id)));
  const wholeRunningBatch = runningAppIds.every(id => Object.hasOwn(profile.applications, id) && !pending.has(id));
  const hiddenBatchReady = state.hiddenAppIds.every(id => running.includes(id) && !pending.has(id));
  return [
    { id: 'about', label: `About ${app.name}`, enabled: false },
    { id: 'separator-about', label: '', enabled: false, separator: true },
    { id: 'preferences', label: profile.capabilities.includes('shell.window-green-menu') ? 'Settings…' : 'Preferences…', shortcut: '⌘,', enabled: false },
    { id: 'separator-preferences', label: '', enabled: false, separator: true },
    { id: 'services', label: 'Services', enabled: false, submenu: true },
    { id: 'separator-services', label: '', enabled: false, separator: true },
    { id: 'hide', label: `Hide ${app.name}`, shortcut: '⌘H', enabled: live && !hidden.has(appId)
      && running.some(id => id !== appId && !pending.has(id)) },
    { id: 'hide-others', label: 'Hide Others', shortcut: '⌥⌘H', enabled: live && wholeRunningBatch
      && (hidden.has(appId) || running.some(id => id !== appId && !hidden.has(id))) },
    { id: 'show-all', label: 'Show All', enabled: live && hidden.size > 0 && hiddenBatchReady },
    { id: 'separator-quit', label: '', enabled: false, separator: true },
    { id: 'quit', label: `Quit ${app.name}`, shortcut: '⌘Q', enabled: live && app.quitAllowed === true },
  ];
}

function nearestSurvivor(oldIds, selectedId, newIds) {
  if (newIds.includes(selectedId)) return selectedId;
  const oldIndex = oldIds.indexOf(selectedId), live = new Set(newIds);
  if (oldIndex >= 0) {
    for (let distance = 1; distance < oldIds.length; distance += 1) {
      if (live.has(oldIds[oldIndex + distance])) return oldIds[oldIndex + distance];
      if (live.has(oldIds[oldIndex - distance])) return oldIds[oldIndex - distance];
    }
  }
  return newIds[0] ?? null;
}

export function reconcileApplicationSwitching(state, profile, runningAppIds, windows, pendingQuitAppIds = []) {
  const running = liveApplications(profile, runningAppIds), runningSet = new Set(running);
  const managed = liveWindows(profile, running, windows), windowIds = managed.map(window => window.id), windowSet = new Set(windowIds);
  replaceOrder(state, 'activationAppIds', unique(state.activationAppIds.filter(id => runningSet.has(id))));
  replaceOrder(state, 'activationWindowIds', unique(state.activationWindowIds.filter(id => windowSet.has(id))));
  replaceOrder(state, 'creationWindowIds', orderedIds(state.creationWindowIds, windowIds));
  replaceOrder(state, 'hiddenAppIds', profile.family === 'macos' ? unique(state.hiddenAppIds.filter(id => runningSet.has(id))) : []);
  if (state.switcher) {
    if (state.switcher.kind !== switcherKind(profile)) state.switcher = null;
    else {
      const itemIds = applicationSwitcherItems(state, profile, running, managed, pendingQuitAppIds).map(item => item.itemId);
      if (!itemIds.length) state.switcher = null;
      else {
        const selectedItemId = nearestSurvivor(state.switcher.itemIds, state.switcher.selectedItemId, itemIds);
        replaceOrder(state.switcher, 'itemIds', itemIds);
        if (state.switcher.selectedItemId !== selectedItemId) state.switcher.selectedItemId = selectedItemId;
      }
    }
  }
  if (state.appMenu) {
    const appId = state.appMenu.appId;
    if (profile.family !== 'macos' || !runningSet.has(appId) || state.hiddenAppIds.includes(appId) || pendingQuitAppIds.includes(appId)) state.appMenu = null;
    else {
      const items = applicationMenuItems(state, profile, appId, running, pendingQuitAppIds);
      const enabled = items.filter(item => item.enabled && !item.separator && !item.submenu).map(item => item.id);
      const itemId = nearestSurvivor(items.map(item => item.id), state.appMenu.itemId, enabled);
      if (state.appMenu.itemId !== itemId) state.appMenu.itemId = itemId;
    }
  }
}

function presentationSnapshot(state) {
  return {
    switcher: state.switcher ? { ...state.switcher, itemIds: [...state.switcher.itemIds], scroll: { ...state.switcher.scroll } } : null,
    ...(Object.hasOwn(state, 'appMenu') ? { appMenu: state.appMenu ? { ...state.appMenu } : null } : {}),
  };
}

export function createApplicationSwitchingCommands(switching, ctx) {
  const profile = ctx.profile;
  const legacyMenu = !profile.capabilities.includes('shell.menu-bar');
  const view = () => ctx.getView();
  const liveItems = () => applicationSwitcherItems(switching, profile, ctx.getRunningAppIds(), ctx.getWindows(), ctx.getPendingQuitAppIds());
  const available = () => ctx.available() && view();
  const menuItems = () => applicationMenuItems(switching, profile, switching.appMenu?.appId, ctx.getRunningAppIds(), ctx.getPendingQuitAppIds());
  const liveApp = appId => {
    if (!Object.hasOwn(profile.applications, appId) || !ctx.getRunningAppIds().includes(appId)) return rejected('not_found', 'The application is not installed and running.');
    if (ctx.getPendingQuitAppIds().includes(appId)) return rejected('unavailable', 'Resolve the pending application quit first.');
    return null;
  };
  const validateBatch = appIds => {
    for (const appId of appIds) {
      const error = liveApp(appId);
      if (error) return error;
    }
    return null;
  };
  const switcherMounted = () => available() && switching.switcher && switching.switcher.kind === switcherKind(profile)
    && view().available() && view().bounds() && scrollValid(view().scrollPosition());
  const menuMounted = () => available() && switching.appMenu && switching.appMenu.appId === ctx.getActiveAppId()
    && !liveApp(switching.appMenu.appId) && !switching.hiddenAppIds.includes(switching.appMenu.appId)
    && view().appMenuAnchor(switching.appMenu.appId) && view().appMenuBounds() && finiteOffset(view().appMenuScrollPosition());
  async function restorePresentation(previous, competing) {
    switching.switcher = previous.switcher;
    if (legacyMenu) switching.appMenu = previous.appMenu;
    reconcileApplicationSwitching(switching, profile, ctx.getRunningAppIds(), ctx.getWindows(), ctx.getPendingQuitAppIds());
    if (competing !== undefined) await ctx.restorePresentations(competing);
    if (!ctx.available()) return;
    await view()?.prepare();
    if (switching.switcher && view()?.available() && view().bounds()) {
      await view().focus(switching.switcher.selectedItemId);
      await view().scroll(switching.switcher.scroll.top, switching.switcher.scroll.left);
    } else if (switching.appMenu && view()?.appMenuBounds()) {
      await view().appMenuFocus(switching.appMenu.itemId);
      await view().appMenuScroll(switching.appMenu.scrollTop);
    } else await ctx.restoreFocus();
  }
  async function selectSwitcher(itemId, observe = false, restoreOnFailure = true) {
    if (!switcherMounted()) return unavailable();
    if (!switching.switcher.itemIds.includes(itemId) || !liveItems().some(item => item.itemId === itemId)
      || !view().itemIds().includes(itemId)) return rejected('not_found', 'The switcher item is no longer live and rendered.');
    if (observe && view().focusedItemId() !== itemId) return unavailable();
    const previous = restoreOnFailure ? presentationSnapshot(switching) : null, current = switching.switcher;
    if (!observe && !await view().focus(itemId)) {
      if (restoreOnFailure) await restorePresentation(previous);
      return unavailable();
    }
    const scroll = view()?.scrollPosition();
    if (switching.switcher !== current || !switcherMounted() || view().focusedItemId() !== itemId || !scrollValid(scroll)
      || !liveItems().some(item => item.itemId === itemId)) {
      if (restoreOnFailure && switching.switcher === current) await restorePresentation(previous);
      return unavailable();
    }
    current.selectedItemId = itemId;
    if (current.scroll.top !== scroll.top || current.scroll.left !== scroll.left) current.scroll = { top: scroll.top, left: scroll.left };
    return applied({ itemId });
  }
  async function selectMenu(itemId, observe = false, restoreOnFailure = true) {
    if (!menuMounted()) return unavailable();
    const item = menuItems().find(item => item.id === itemId);
    if (!item) return rejected('not_found', 'The application menu item no longer exists.');
    if (!item.enabled || item.separator || item.submenu) return rejected('disabled', 'Choose an enabled native application menu leaf.');
    if (!view().appMenuItemIds().includes(itemId)) return unavailable();
    if (observe && view().appMenuFocusedItemId() !== itemId) return unavailable();
    const previous = restoreOnFailure ? presentationSnapshot(switching) : null, current = switching.appMenu;
    if (!observe && !await view().appMenuFocus(itemId)) {
      if (restoreOnFailure) await restorePresentation(previous);
      return unavailable();
    }
    const top = view()?.appMenuScrollPosition();
    if (switching.appMenu !== current || !menuMounted() || view().appMenuFocusedItemId() !== itemId || !finiteOffset(top)
      || !menuItems().some(item => item.id === itemId && item.enabled)) {
      if (restoreOnFailure && switching.appMenu === current) await restorePresentation(previous);
      return unavailable();
    }
    current.itemId = itemId;
    if (current.scrollTop !== top) current.scrollTop = top;
    return applied({ itemId });
  }
  const commands = {
    'shell.switcher.open': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['direction', 'commitOnRelease'], [])
        || (Object.hasOwn(payload, 'direction') && !directionValid(payload.direction))
        || (Object.hasOwn(payload, 'commitOnRelease') && payload.commitOnRelease !== null
          && payload.commitOnRelease !== (profile.family === 'macos' ? 'Meta' : 'Alt'))) return invalid();
      if (!available()) return unavailable();
      const items = liveSwitcherItems(switching, profile, ctx.getRunningAppIds(), ctx.getWindows(), ctx.getPendingQuitAppIds());
      if (!items.length) return rejected('disabled', 'There are no eligible running applications or managed windows.');
      const activeId = profile.family === 'macos' ? `app:${ctx.getActiveAppId()}` : `window:${ctx.getActiveWindowId()}`;
      const activeIndex = items.findIndex(item => item.itemId === activeId), step = payload.direction === 'previous' ? -1 : 1;
      const selected = activeIndex < 0 ? (step < 0 ? items.length - 1 : 0) : (activeIndex + step + items.length) % items.length;
      const previous = presentationSnapshot(switching);
      ctx.captureFocus();
      const competing = ctx.clearPresentations();
      if (legacyMenu) switching.appMenu = null;
      switching.switcher = { kind: switcherKind(profile), itemIds: items.map(item => item.itemId), selectedItemId: items[selected].itemId,
        commitOnRelease: payload.commitOnRelease ?? null, scroll: { top: 0, left: 0 } };
      const current = switching.switcher;
      await view()?.prepare();
      if (switching.switcher !== current) return unavailable();
      const result = await selectSwitcher(current.selectedItemId, false, false);
      if (result.status !== 'applied') {
        if (switching.switcher === current) await restorePresentation(previous, competing);
        return result;
      }
      return applied({ kind: current.kind, itemId: current.selectedItemId });
    },
    'shell.switcher.close': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['restoreFocus'], [])
        || (Object.hasOwn(payload, 'restoreFocus') && typeof payload.restoreFocus !== 'boolean')) return invalid();
      if (!ctx.available()) return unavailable();
      if (!switching.switcher) return applied();
      const previous = presentationSnapshot(switching);
      switching.switcher = null;
      if (payload.restoreFocus !== false && !await ctx.restoreFocus()) {
        await restorePresentation(previous);
        return unavailable();
      }
      return applied();
    },
    'shell.switcher.select': async (target, payload) => {
      if (!fields(target, ['itemId']) || !identity(target.itemId) || !fields(payload, ['observe'], [])
        || (Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean')) return invalid();
      return selectSwitcher(target.itemId, payload.observe === true);
    },
    'shell.switcher.step': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['direction']) || !directionValid(payload.direction)) return invalid();
      if (!switcherMounted()) return unavailable();
      const items = liveItems().filter(item => switching.switcher.itemIds.includes(item.itemId));
      const index = items.findIndex(item => item.itemId === switching.switcher.selectedItemId);
      if (index < 0) return rejected('not_found', 'The selected switcher item no longer exists.');
      return selectSwitcher(items[(index + (payload.direction === 'previous' ? -1 : 1) + items.length) % items.length].itemId);
    },
    'shell.switcher.activate': async (target, payload) => {
      if (!fields(target, ['itemId'], []) || (Object.hasOwn(target, 'itemId') && !identity(target.itemId)) || !fields(payload, [])) return invalid();
      if (!switcherMounted()) return unavailable();
      const itemId = target.itemId ?? switching.switcher.selectedItemId;
      const item = liveItems().find(item => item.itemId === itemId);
      if (!item || !switching.switcher.itemIds.includes(itemId) || !view().itemIds().includes(itemId)) return rejected('not_found', 'The selected switcher item is stale or belongs to the wrong switcher kind.');
      const error = liveApp(item.appId);
      if (error) return error;
      const previous = presentationSnapshot(switching);
      switching.switcher = null;
      if (legacyMenu) switching.appMenu = null;
      const result = profile.family === 'macos' ? await ctx.activateApp(item.appId)
        : await ctx.invoke('window.focus', { windowId: item.windowId }, {});
      if (result.status !== 'applied') {
        await restorePresentation(previous);
        return result;
      }
      return applied(result.target);
    },
    'shell.switcher.scroll': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['top', 'left', 'observe'], ['top']) || !finiteOffset(payload.top)
        || (Object.hasOwn(payload, 'left') && !finiteOffset(payload.left))
        || (Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean')) return invalid();
      if (!switcherMounted()) return unavailable();
      const current = switching.switcher, previous = presentationSnapshot(switching);
      const scroll = payload.observe === true ? view().scrollPosition() : await view().scroll(payload.top, payload.left ?? current.scroll.left);
      if (!scrollValid(scroll) || switching.switcher !== current || !switcherMounted()) {
        if (switching.switcher === current) await restorePresentation(previous);
        return unavailable();
      }
      if (current.scroll.top !== scroll.top || current.scroll.left !== scroll.left) current.scroll = { top: scroll.top, left: scroll.left };
      return applied({ top: scroll.top, left: scroll.left });
    },
    'window.cycle': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['direction'], [])
        || (Object.hasOwn(payload, 'direction') && !directionValid(payload.direction))) return invalid();
      if (!ctx.available()) return unavailable();
      const managed = liveWindows(profile, ctx.getRunningAppIds(), ctx.getWindows());
      const byId = new Map(managed.map(window => [window.id, window]));
      const eligible = orderedIds(switching.creationWindowIds, managed.map(window => window.id)).filter(id => {
        const window = byId.get(id);
        return !window.minimized && !ctx.getPendingQuitAppIds().includes(window.appId)
          && (!profile.capabilities.includes('shell.window-extensions') || !window.utilityKind)
          && (profile.family !== 'macos' || (window.appId === ctx.getActiveAppId() && !switching.hiddenAppIds.includes(window.appId)));
      });
      if (!eligible.length) return rejected('disabled', 'There are no eligible visible, nonminimized windows to cycle.');
      const index = eligible.indexOf(ctx.getActiveWindowId()), step = payload.direction === 'previous' ? -1 : 1;
      const windowId = eligible[index < 0 ? (step < 0 ? eligible.length - 1 : 0) : (index + step + eligible.length) % eligible.length];
      const previous = presentationSnapshot(switching), competing = ctx.clearPresentations();
      switching.switcher = null;
      if (legacyMenu) switching.appMenu = null;
      const result = await ctx.invoke('window.focus', { windowId }, {});
      if (result.status !== 'applied') {
        await restorePresentation(previous, competing);
        return result;
      }
      return applied(result.target);
    },
    'app.setHidden': async (target, payload) => {
      if (!fields(target, ['appId']) || !identity(target.appId) || !fields(payload, ['hidden']) || typeof payload.hidden !== 'boolean') return invalid();
      if (!ctx.available()) return unavailable();
      const error = liveApp(target.appId);
      if (error) return error;
      if (payload.hidden && !liveApplications(profile, ctx.getRunningAppIds()).some(appId => appId !== target.appId
        && !ctx.getPendingQuitAppIds().includes(appId))) {
        return rejected('disabled', 'Keep one running application visible when no other application can receive foreground.');
      }
      const hidden = payload.hidden ? unique([...switching.hiddenAppIds, target.appId])
        : switching.hiddenAppIds.filter(appId => appId !== target.appId);
      replaceOrder(switching, 'hiddenAppIds', hidden);
      if (payload.hidden && switching.appMenu?.appId === target.appId) switching.appMenu = null;
      await ctx.visibilityChanged({ kind: 'set', appId: target.appId, hidden: payload.hidden });
      return applied({ appId: target.appId, hidden: payload.hidden });
    },
    'app.hideOthers': async (target, payload) => {
      if (!fields(target, ['appId']) || !identity(target.appId) || !fields(payload, [])) return invalid();
      if (!ctx.available()) return unavailable();
      const error = liveApp(target.appId) ?? validateBatch(ctx.getRunningAppIds());
      if (error) return error;
      const hidden = unique(ctx.getRunningAppIds().filter(appId => appId !== target.appId));
      replaceOrder(switching, 'hiddenAppIds', hidden);
      if (switching.appMenu && hidden.includes(switching.appMenu.appId)) switching.appMenu = null;
      await ctx.visibilityChanged({ kind: 'others', appId: target.appId });
      return applied({ appId: target.appId, hiddenAppIds: [...switching.hiddenAppIds] });
    },
    'app.showAll': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!ctx.available()) return unavailable();
      const error = validateBatch(switching.hiddenAppIds);
      if (error) return error;
      replaceOrder(switching, 'hiddenAppIds', []);
      await ctx.visibilityChanged({ kind: 'all' });
      return applied({ hiddenAppIds: [] });
    },
    ...(legacyMenu ? {
    'app.menu.open': async (target, payload) => {
      if (!fields(target, ['appId'], []) || (Object.hasOwn(target, 'appId') && !identity(target.appId))
        || !fields(payload, ['position', 'itemId'], []) || (Object.hasOwn(payload, 'position') && !['first', 'last'].includes(payload.position))
        || (Object.hasOwn(payload, 'itemId') && !identity(payload.itemId))
        || (Object.hasOwn(payload, 'position') && Object.hasOwn(payload, 'itemId'))) return invalid();
      if (!available()) return unavailable();
      const appId = target.appId ?? ctx.getActiveAppId(), error = liveApp(appId);
      if (error) return error;
      if (appId !== ctx.getActiveAppId() || switching.hiddenAppIds.includes(appId)) return rejected('disabled', 'Only the actual visible active application owns the native application menu.');
      if (!view().appMenuAnchor(appId)) return unavailable();
      const items = applicationMenuItems(switching, profile, appId, ctx.getRunningAppIds(), ctx.getPendingQuitAppIds());
      const enabled = items.filter(item => item.enabled && !item.separator && !item.submenu);
      const selected = Object.hasOwn(payload, 'itemId') ? items.find(item => item.id === payload.itemId)
        : payload.position === 'last' ? enabled.at(-1) : enabled[0];
      if (Object.hasOwn(payload, 'itemId') && !selected) return rejected('not_found', 'The application menu item does not exist.');
      if (selected && (!selected.enabled || selected.separator || selected.submenu)) return rejected('disabled', 'Choose an enabled native application menu leaf.');
      const previous = presentationSnapshot(switching);
      ctx.captureFocus();
      const competing = ctx.clearPresentations();
      switching.switcher = null;
      switching.appMenu = { appId, itemId: selected?.id ?? null, scrollTop: 0 };
      const current = switching.appMenu;
      await view()?.prepare();
      if (switching.appMenu !== current) return unavailable();
      let result;
      if (current.itemId !== null) result = await selectMenu(current.itemId, false, false);
      else {
        const focused = menuMounted() && await view().appMenuFocus(null);
        const top = view()?.appMenuScrollPosition();
        result = focused && switching.appMenu === current && menuMounted() && finiteOffset(top) ? applied({ itemId: null }) : unavailable();
        if (result.status === 'applied') current.scrollTop = top;
      }
      if (result.status !== 'applied') {
        if (switching.appMenu === current) await restorePresentation(previous, competing);
        return result;
      }
      return applied({ appId, itemId: current.itemId });
    },
    'app.menu.close': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['restoreFocus'], [])
        || (Object.hasOwn(payload, 'restoreFocus') && typeof payload.restoreFocus !== 'boolean')) return invalid();
      if (!ctx.available()) return unavailable();
      if (!switching.appMenu) return applied();
      const previous = presentationSnapshot(switching), appId = switching.appMenu.appId;
      if (payload.restoreFocus !== false && (!view() || !view().appMenuAnchor(appId))) return unavailable();
      switching.appMenu = null;
      if (payload.restoreFocus !== false && !await view().appMenuReturnFocus(appId)) {
        await restorePresentation(previous);
        return unavailable();
      }
      return applied();
    },
    'app.menu.select': async (target, payload) => {
      if (!fields(target, ['itemId']) || !identity(target.itemId) || !fields(payload, ['observe'], [])
        || (Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean')) return invalid();
      return selectMenu(target.itemId, payload.observe === true);
    },
    'app.menu.execute': async (target, payload) => {
      if (!fields(target, ['itemId']) || !identity(target.itemId) || !fields(payload, [])) return invalid();
      if (!menuMounted()) return unavailable();
      const item = menuItems().find(item => item.id === target.itemId);
      if (!item) return rejected('not_found', 'The application menu item does not exist.');
      if (!item.enabled || item.separator || item.submenu) return rejected('disabled', 'Choose an enabled native application menu leaf.');
      if (!view().appMenuItemIds().includes(item.id)) return unavailable();
      const current = switching.appMenu, appId = current.appId, activeWindowId = ctx.getActiveWindowId();
      const action = {
        hide: ['app.setHidden', { appId }, { hidden: true }],
        'hide-others': ['app.hideOthers', { appId }, {}],
        'show-all': ['app.showAll', {}, {}],
        quit: ['app.quit', { appId }, {}],
      }[item.id];
      if (!action) return rejected('disabled', 'This application interior is not represented.');
      const result = await ctx.invoke(...action);
      if (result.status !== 'applied') return result;
      if (switching.appMenu === current) switching.appMenu = null;
      if (ctx.available() && ctx.getActiveAppId() === appId && ctx.getActiveWindowId() === activeWindowId
        && !liveApp(appId) && !switching.hiddenAppIds.includes(appId)) {
        if (!await view().appMenuReturnFocus(appId)) return unavailable();
      }
      return applied();
    },
    'app.menu.scroll': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['top', 'observe'], ['top']) || !finiteOffset(payload.top)
        || (Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean')) return invalid();
      if (!menuMounted()) return unavailable();
      const current = switching.appMenu, previous = presentationSnapshot(switching);
      const top = payload.observe === true ? view().appMenuScrollPosition() : await view().appMenuScroll(payload.top);
      if (!finiteOffset(top) || switching.appMenu !== current || !menuMounted()) {
        if (switching.appMenu === current) await restorePresentation(previous);
        return unavailable();
      }
      if (current.scrollTop !== top) current.scrollTop = top;
      return applied({ top });
    },
    } : {}),
  };
  return Object.fromEntries(Object.entries(commands).filter(([name]) => name.startsWith('app.')
    ? profile.family === 'macos' && profile.capabilities.includes('app.visibility')
    : ['macos', 'windows'].includes(profile.family) && profile.capabilities.includes('shell.switcher')));
}

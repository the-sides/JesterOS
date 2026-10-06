import { isRecord, rejected } from './feature-commands.js';

const fields = (value, names, required = names) => isRecord(value)
  && Object.keys(value).every(key => names.includes(key)) && required.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0;
const number = value => typeof value === 'number' && Number.isFinite(value);
const nullableId = value => value === null || id(value);
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented native Dock target and payload.');

export function createMacDockCommands(desktop, context) {
  const state = desktop.dock;
  const available = () => context.available() && context.getView()?.dockAvailable();
  const unavailable = () => rejected('unavailable', 'The native Dock is unmounted or blocked.');
  const app = appId => Object.hasOwn(context.profile.applications, appId) ? context.profile.applications[appId] : null;
  const items = () => context.getItems();
  const findItem = itemId => items().flatMap(item => [item, ...(item.children ?? [])]).find(item => item.id === itemId);
  const ownedWindow = windowId => state.appWindows && context.getWindows().find(window => window.id === windowId && window.appId === state.appWindows.appId);
  const appTarget = (target, payload, names = [], required = names) => fields(target, ['appId']) && id(target.appId) && fields(payload, names, required);
  const appError = appId => !app(appId) ? rejected('not_found', 'The installed application no longer exists.') : !available() ? unavailable() : null;
  const clearMenus = appId => { state.context = null; state.folderStack = null; desktop.context = null; desktop.rename = null;
    desktop.windowMenuOpen = false; desktop.windowMenuItem = null;
    if (desktop.stacks) desktop.stacks.focusedStackId = null;
    context.dismissAppMenus(appId);
  };
  const dockItems = () => context.getDockItems();
  const applicationId = itemId => typeof itemId === 'string' && itemId.startsWith('app:') && app(itemId.slice(4)) ? itemId.slice(4) : null;
  const liveDockItem = itemId => dockItems().find(item => item.itemId === itemId);
  function placementError(itemId, beforeItemId) {
    if (itemId === 'app:finder' || itemId === 'trash' || itemId === 'separator' || beforeItemId === 'app:finder')
      return rejected('disabled', 'Finder remains first and Trash remains last; sections cannot be crossed.');
    const appId = applicationId(itemId);
    if (appId) {
      if (beforeItemId !== null
        && !context.getDockSections().main.some(app => `app:${app.id}` === beforeItemId))
        return rejected('disabled', 'Application aliases can only be placed on the main app side.');
    } else {
      const item = liveDockItem(itemId) ?? context.getFolderSource(itemId), before = beforeItemId && liveDockItem(beforeItemId);
      if (!item) return rejected('not_found', 'The actual movable Dock item or folder source no longer exists.');
      if (beforeItemId !== null && (!before || before.kind === 'app' || before.kind === 'separator'))
        return rejected('disabled', 'Folder and minimized-window items remain on the file side.');
    }
    return null;
  }
  async function revealDock() {
    state.revealed = true;
    await context.getView().prepareDock();
  }
  function dismissUnusedDock() {
    if (state.preferences.autoHide && !state.context && !state.folderStack && !state.drag && !state.hover && !state.focusedItemId) state.revealed = false;
  }
  const commands = {
    'dock.place': async (target, payload) => {
      if (!fields(target, ['itemId']) || !id(target.itemId) || !fields(payload, ['beforeItemId']) || !nullableId(payload.beforeItemId)) return invalid();
      if (!available()) return unavailable();
      const error = placementError(target.itemId, payload.beforeItemId); if (error) return error;
      const appId = applicationId(target.itemId);
      const folder = !appId && context.getFolderSource(target.itemId);
      if (folder) {
        const result = await context.invoke('dock.folder.pin', { fileId: folder.id }, { pinned: true });
        if (result.status !== 'applied') return result;
      }
      const order = appId ? context.getDockSections().main.map(app => `app:${app.id}`)
        : dockItems().filter(item => item.kind !== 'app' && !['trash', 'separator'].includes(item.itemId)).map(item => item.itemId);
      if (!order.includes(target.itemId)) order.push(target.itemId);
      if (payload.beforeItemId !== target.itemId) {
        order.splice(order.indexOf(target.itemId), 1);
        const before = payload.beforeItemId === null || payload.beforeItemId === 'trash' ? order.length : order.indexOf(payload.beforeItemId);
        order.splice(before, 0, target.itemId);
      }
      if (appId) {
        if (!state.pinnedAppIds.includes(appId)) state.pinnedAppIds.push(appId);
        state.mainOrderAppIds = order.map(itemId => itemId.slice(4));
      } else state.secondaryOrderItemIds = order;
      return applied({ itemId: target.itemId, beforeItemId: payload.beforeItemId, index: order.indexOf(target.itemId) });
    },
    'dock.drag.begin': async (target, payload) => {
      if (!fields(target, ['itemId']) || !id(target.itemId) || !fields(payload, ['x', 'y', 'source'], ['x', 'y'])
        || !number(payload.x) || !number(payload.y) || (payload.source !== undefined && !['dock', 'bundle', 'folder'].includes(payload.source))) return invalid();
      if (!available() || state.drag) return unavailable();
      const source = payload.source ?? 'dock', appId = applicationId(target.itemId);
      const sourceExists = source === 'bundle' ? appId && context.hasBundle(appId)
        : source === 'folder' ? context.getFolderSource(target.itemId) : liveDockItem(target.itemId);
      if (!sourceExists) return rejected('not_found', 'The drag source is not an actual Dock alias, bundle or folder.');
      if (['app:finder', 'trash', 'separator'].includes(target.itemId)) return rejected('disabled', 'This native Dock item is fixed.');
      clearMenus(); state.appWindows = null;
      state.drag = { itemId: target.itemId, source, startX: payload.x, startY: payload.y, x: payload.x, y: payload.y,
        beforeItemId: null, remove: false, valid: false };
      await revealDock();
      return applied({ itemId: target.itemId, source });
    },
    'dock.drag.update': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['x', 'y']) || !number(payload.x) || !number(payload.y)) return invalid();
      if (!available() || !state.drag) return unavailable();
      const drag = state.drag, plan = context.getView().dockDropPlan(drag.itemId, drag.source, payload.x, payload.y);
      if (!plan) return unavailable();
      const folder = context.getFolderSource(drag.itemId);
      const removable = drag.source === 'dock' && (applicationId(drag.itemId) && state.pinnedAppIds.includes(applicationId(drag.itemId))
        || folder && state.folderFileIds.includes(folder.id));
      const valid = plan.valid && (plan.remove ? Boolean(removable) : !placementError(drag.itemId, plan.beforeItemId));
      Object.assign(drag, { x: payload.x, y: payload.y, beforeItemId: plan.beforeItemId, remove: Boolean(plan.remove && removable), valid: Boolean(valid) });
      return applied({ itemId: drag.itemId, beforeItemId: drag.beforeItemId, remove: drag.remove, valid: drag.valid });
    },
    'dock.drag.end': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['cancel'], []) || (payload.cancel !== undefined && typeof payload.cancel !== 'boolean')) return invalid();
      if (!available() || !state.drag) return unavailable();
      const drag = state.drag;
      if (payload.cancel || !drag.valid) {
        state.drag = null; dismissUnusedDock();
        return applied({ itemId: drag.itemId, cancelled: true, removed: false });
      }
      const appId = applicationId(drag.itemId), folder = context.getFolderSource(drag.itemId);
      if (drag.remove && !appId && !folder) return rejected('stale_target', 'The dragged folder is no longer live.');
      const result = drag.remove
        ? await context.invoke(appId ? 'dock.pin' : 'dock.folder.pin', appId ? { appId } : { fileId: folder.id }, { pinned: false })
        : await commands['dock.place']({ itemId: drag.itemId }, { beforeItemId: drag.beforeItemId });
      if (result.status !== 'applied') return result;
      state.drag = null; state.hover = null; dismissUnusedDock();
      return applied({ itemId: drag.itemId, cancelled: false, removed: drag.remove });
    },
    'dock.focus': async (target, payload) => {
      if (!fields(target, ['itemId']) || !nullableId(target.itemId) || !fields(payload, ['observe'], [])
        || (payload.observe !== undefined && typeof payload.observe !== 'boolean')) return invalid();
      if (!available()) return unavailable();
      if (target.itemId !== null && !liveDockItem(target.itemId)) return rejected('not_found', 'This real Dock focus target no longer exists.');
      state.focusedItemId = target.itemId;
      if (target.itemId !== null) {
        state.revealed = true;
        if (!payload.observe) { await context.getView().prepareDock(); await context.getView().focusDockItem(target.itemId); }
      } else dismissUnusedDock();
      return applied({ itemId: target.itemId });
    },
    'dock.hover': async (target, payload) => {
      if (!fields(target, ['itemId']) || !nullableId(target.itemId) || !fields(payload, ['x'], [])
        || (payload.x !== undefined && !finite(payload.x)) || (target.itemId === null && Object.keys(payload).length)) return invalid();
      if (!available()) return unavailable();
      if (target.itemId === null) { state.hover = null; dismissUnusedDock(); return applied({ itemId: null }); }
      if (!liveDockItem(target.itemId)) return rejected('not_found', 'This real Dock hover target no longer exists.');
      let x = payload.x;
      if (x === undefined) {
        const revealed = state.revealed;
        await revealDock(); const point = context.getView().dockItemAnchor(target.itemId);
        if (!point) { state.revealed = revealed; return unavailable(); }
        x = point.x;
      }
      state.hover = { itemId: target.itemId, x }; state.revealed = true;
      return applied({ itemId: target.itemId });
    },
    'dock.visibility': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['visible']) || typeof payload.visible !== 'boolean') return invalid();
      if (!available()) return unavailable();
      if (!payload.visible && (!state.preferences.autoHide || state.context || state.folderStack || state.drag || state.hover || state.focusedItemId))
        return rejected('disabled', 'The Dock remains visible while not auto-hidden or while its controls are in use.');
      state.revealed = payload.visible;
      return applied({ visible: !state.preferences.autoHide || state.revealed });
    },
    'dock.preferences.open': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!available() || context.isQuitting('settings')) return unavailable();
      clearMenus(); state.appWindows = null;
      return context.openPreferences();
    },
    'dock.preferences.set': (target, payload) => {
      const allowed = ['size', 'magnification', 'magnificationSize', 'autoHide', 'minimizeIntoApp', 'showRecent'];
      if (!fields(target, []) || !fields(payload, allowed, []) || !Object.keys(payload).length
        || (payload.size !== undefined && (!number(payload.size) || payload.size < 16 || payload.size > 128))
        || (payload.magnificationSize !== undefined && (!number(payload.magnificationSize) || payload.magnificationSize < 32 || payload.magnificationSize > 192))
        || ['magnification', 'autoHide', 'minimizeIntoApp', 'showRecent'].some(key => payload[key] !== undefined && typeof payload[key] !== 'boolean')) return invalid();
      if (!available()) return unavailable();
      if (Object.hasOwn(payload, 'showRecent') && !context.profile.capabilities.includes('shell.dock-recents'))
        return rejected('unsupported_profile', 'High Sierra has no recent-app Dock preference.');
      Object.assign(state.preferences, payload);
      if (payload.autoHide !== undefined) state.revealed = !payload.autoHide || Boolean(state.context || state.folderStack || state.drag || state.hover || state.focusedItemId);
      return applied({ preferences: { ...state.preferences } });
    },
    'dock.activate': async (target, payload) => {
      if (!appTarget(target, payload)) return invalid();
      const error = appError(target.appId); if (error) return error;
      if (context.isQuitting(target.appId)) return unavailable();
      clearMenus(target.appId); state.appWindows = null;
      return context.invoke('app.open', target, {});
    },
    'dock.pin': (target, payload) => {
      if (!appTarget(target, payload, ['pinned']) || typeof payload.pinned !== 'boolean') return invalid();
      const error = appError(target.appId); if (error) return error;
      if (target.appId === 'finder' && !payload.pinned) return rejected('disabled', 'Finder remains in this native Dock.');
      const pinned = state.pinnedAppIds.includes(target.appId);
      if (pinned !== payload.pinned) {
        if (payload.pinned) {
          state.pinnedAppIds.push(target.appId);
          if (!state.mainOrderAppIds.includes(target.appId)) state.mainOrderAppIds.push(target.appId);
        } else state.pinnedAppIds = state.pinnedAppIds.filter(appId => appId !== target.appId);
      }
      return applied({ appId: target.appId, pinned: payload.pinned });
    },
    'dock.reveal': async (target, payload) => {
      if (!appTarget(target, payload)) return invalid();
      const error = appError(target.appId); if (error) return error;
      state.appWindows = null;
      return context.reveal(target.appId);
    },
    'dock.context.open': async (target, payload) => {
      const itemTarget = fields(target, ['itemId']) && id(target.itemId);
      const separator = itemTarget && target.itemId === 'separator';
      const folder = itemTarget && liveDockItem(target.itemId)?.kind === 'folder' && context.getFolderSource(target.itemId);
      if ((!itemTarget && !(fields(target, ['appId']) && id(target.appId))) || !fields(payload, ['x', 'y'], [])
        || Object.hasOwn(payload, 'x') !== Object.hasOwn(payload, 'y')
        || (Object.hasOwn(payload, 'x') && (!finite(payload.x) || !finite(payload.y)))) return invalid();
      if (itemTarget && !separator && !folder) return rejected('not_found', 'The actual folder Dock alias no longer exists.');
      const error = itemTarget ? (!available() ? unavailable() : null) : appError(target.appId); if (error) return error;
      if (!itemTarget && !context.getDockApps().some(entry => entry.id === target.appId)) return rejected('not_found', 'The application has no current Dock alias.');
      const dockItemId = itemTarget ? target.itemId : `app:${target.appId}`, revealed = state.revealed;
      await revealDock();
      const point = Object.hasOwn(payload, 'x') ? payload : context.getView().dockItemAnchor(dockItemId);
      if (!point) { state.revealed = revealed; return unavailable(); }
      clearMenus(); state.appWindows = null; state.focusedItemId = dockItemId;
      state.context = { kind: separator ? 'dock' : folder ? 'folder' : 'app', appId: itemTarget ? null : target.appId, dockItemId,
        x: point.x, y: point.y, itemId: null, submenuId: null, scroll: { main: 0, submenu: 0 } };
      const first = items().find(item => item.enabled);
      state.context.itemId = first?.id ?? null;
      if (first) await context.getView().focusDockMenuItem(first.id);
      return applied({ appId: state.context.appId, menuId: 'dock-context' });
    },
    'dock.context.close': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['restoreFocus'], [])
        || (payload.restoreFocus !== undefined && typeof payload.restoreFocus !== 'boolean')) return invalid();
      if (!available()) return unavailable();
      const menu = state.context;
      state.context = null;
      if (payload.restoreFocus !== false && menu) {
        if (menu.kind === 'dock') await commands['dock.focus']({ itemId: 'separator' }, {});
        else if (menu.kind === 'folder' && liveDockItem(menu.dockItemId)) await commands['dock.focus']({ itemId: menu.dockItemId }, {});
        else await context.focusDock(menu.appId);
      } else dismissUnusedDock();
      return applied({ menuId: 'dock-context' });
    },
    'dock.context.select': async (target, payload) => {
      if (!fields(target, ['itemId']) || !id(target.itemId) || !fields(payload, ['openSubmenu'], [])
        || (payload.openSubmenu !== undefined && typeof payload.openSubmenu !== 'boolean')) return invalid();
      if (!available() || !state.context) return unavailable();
      const entry = findItem(target.itemId);
      if (!entry) return rejected('not_found', 'The current native Dock entry no longer exists.');
      if (!entry.enabled) return rejected('disabled', 'This Dock action is not currently available.');
      const parent = items().find(item => item.children?.some(child => child.id === entry.id));
      if (parent && payload.openSubmenu === false) return invalid();
      const branch = parent?.id ?? (entry.children && payload.openSubmenu !== false ? entry.id : null);
      if (state.context.submenuId !== branch) state.context.scroll.submenu = 0;
      state.context.itemId = entry.id; state.context.submenuId = branch;
      await context.getView().focusDockMenuItem(entry.id);
      return applied({ menuId: 'dock-context', itemId: entry.id });
    },
    'dock.context.execute': async (target, payload) => {
      if (!fields(target, ['itemId']) || !id(target.itemId) || !fields(payload, [])) return invalid();
      if (!available() || !state.context) return unavailable();
      const entry = findItem(target.itemId);
      if (!entry) return rejected('not_found', 'The current native Dock entry no longer exists.');
      if (!entry.enabled || entry.children) return rejected('disabled', 'Choose an enabled native Dock leaf.');
      const menu = state.context, appId = menu.appId;
      let result;
      if (menu.kind === 'folder') {
        const folder = context.getFolderSource(menu.dockItemId);
        if (!folder) return rejected('stale_target', 'The folder shortcut no longer refers to a live directory.');
        if (entry.id === 'folder-open-finder') result = await context.invoke('desktop.open', { fileId: folder.id }, {});
        else if (entry.id === 'folder-remove') result = await context.invoke('dock.folder.pin', { fileId: folder.id }, { pinned: false });
        else if (entry.id.startsWith('folder-sort:')) result = await context.invoke('dock.folder.preferences.set', { fileId: folder.id }, { sortBy: entry.id.slice(12) });
        else if (entry.id.startsWith('folder-display:')) result = await context.invoke('dock.folder.preferences.set', { fileId: folder.id }, { display: entry.id.slice(15) });
        else if (entry.id.startsWith('folder-view:')) result = await context.invoke('dock.folder.preferences.set', { fileId: folder.id }, { view: entry.id.slice(12) });
        else return rejected('disabled', 'Choose a supported folder Dock leaf.');
      } else if (entry.id.startsWith('window:')) result = await context.invoke('window.focus', { windowId: entry.id.slice(7) }, {});
      else if (entry.id === 'show-windows') result = await commands['dock.windows.open']({ appId }, {});
      else if (entry.id === 'keep-in-dock') result = await commands['dock.pin']({ appId }, { pinned: !state.pinnedAppIds.includes(appId) });
      else if (entry.id === 'show-in-finder') result = await commands['dock.reveal']({ appId }, {});
      else if (entry.id === 'open') result = await commands['dock.activate']({ appId }, {});
      else if (entry.id === 'hide') result = await context.invoke('app.setHidden', { appId }, { hidden: !context.isHidden(appId) });
      else if (entry.id === 'quit') result = await context.invoke('app.quit', { appId }, {});
      else if (entry.id === 'auto-hide') result = await commands['dock.preferences.set']({}, { autoHide: !state.preferences.autoHide });
      else if (entry.id === 'magnification') result = await commands['dock.preferences.set']({}, { magnification: !state.preferences.magnification });
      else if (entry.id === 'dock-preferences') result = await commands['dock.preferences.open']({}, {});
      else return rejected('disabled', 'This native action belongs to a separate unimplemented slice.');
      if (result.status !== 'applied') return result;
      if (state.context === menu) state.context = null;
      if (entry.id === 'keep-in-dock' || entry.id === 'quit') await context.focusDock(appId);
      else if (menu.kind === 'dock' && entry.id !== 'dock-preferences') await commands['dock.focus']({ itemId: 'separator' }, {});
      else if (menu.kind === 'folder' && entry.id !== 'folder-open-finder') {
        if (liveDockItem(menu.dockItemId)) await commands['dock.focus']({ itemId: menu.dockItemId }, {});
        else await context.focusDock(null);
      }
      else dismissUnusedDock();
      return applied({ menuId: 'dock-context', itemId: entry.id, appId });
    },
    'dock.context.scroll': async (target, payload) => {
      if (!fields(target, ['region']) || !['main', 'submenu'].includes(target.region) || !fields(payload, ['top', 'observe'], ['top'])
        || !finite(payload.top) || (payload.observe !== undefined && typeof payload.observe !== 'boolean')) return invalid();
      if (!available() || !state.context || (target.region === 'submenu' && !state.context.submenuId)) return unavailable();
      const actual = payload.observe ? context.getView().dockMenuScrollTop(target.region)
        : await context.getView().scrollDockMenu(target.region, payload.top);
      if (actual === null) return unavailable();
      state.context.scroll[target.region] = actual;
      return applied({ region: target.region, top: actual });
    },
    'dock.windows.open': async (target, payload) => {
      if (!appTarget(target, payload)) return invalid();
      const error = appError(target.appId); if (error) return error;
      if (context.profile.applications[target.appId].presentation)
        return rejected('disabled', 'A shell presentation has no managed app windows.');
      const owned = context.getWindows().filter(window => window.appId === target.appId);
      clearMenus();
      state.revealed = true;
      state.appWindows = { appId: target.appId, selectedWindowId: owned.find(window => window.id === context.getActiveWindowId())?.id ?? owned[0]?.id ?? null };
      await context.getView().focusDockAppWindows(state.appWindows.selectedWindowId);
      return applied({ appId: target.appId, windowIds: owned.map(window => window.id) });
    },
    'dock.windows.close': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      const appId = state.appWindows?.appId;
      state.appWindows = null;
      if (appId) await context.restoreOverviewFocus(appId);
      return applied({});
    },
    'dock.windows.select': async (target, payload) => {
      if (!fields(target, ['windowId']) || !id(target.windowId) || !fields(payload, [])) return invalid();
      if (!available() || !state.appWindows) return unavailable();
      const window = ownedWindow(target.windowId);
      if (!window) return rejected('not_found', 'This real window is not in the current app overview.');
      state.appWindows.selectedWindowId = window.id;
      await context.getView().focusDockAppWindows(window.id);
      return applied({ appId: window.appId, windowId: window.id });
    },
    'dock.windows.activate': async (target, payload) => {
      if (!fields(target, ['windowId']) || !id(target.windowId) || !fields(payload, [])) return invalid();
      if (!available() || !state.appWindows) return unavailable();
      const window = ownedWindow(target.windowId);
      if (!window) return rejected('not_found', 'This real window is not in the current app overview.');
      state.appWindows = null;
      const result = await context.invoke('window.focus', { windowId: window.id }, {});
      return result.status === 'applied' ? applied({ appId: window.appId, windowId: window.id }) : result;
    },
  };
  return commands;
}

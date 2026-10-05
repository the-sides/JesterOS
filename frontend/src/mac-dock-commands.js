import { isRecord, rejected } from './feature-commands.js';

const fields = (value, names, required = names) => isRecord(value)
  && Object.keys(value).every(key => names.includes(key)) && required.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented native Dock target and payload.');

export function createMacDockCommands(desktop, context) {
  const state = desktop.dock;
  const available = () => context.available() && context.getView()?.dockAvailable();
  const unavailable = () => rejected('unavailable', 'The native Dock is hidden, unmounted, or blocked.');
  const app = appId => Object.hasOwn(context.profile.applications, appId) ? context.profile.applications[appId] : null;
  const items = () => context.getItems();
  const findItem = itemId => items().flatMap(item => [item, ...(item.children ?? [])]).find(item => item.id === itemId);
  const ownedWindow = windowId => state.appWindows && context.getWindows().find(window => window.id === windowId && window.appId === state.appWindows.appId);
  const appTarget = (target, payload, names = [], required = names) => fields(target, ['appId']) && id(target.appId) && fields(payload, names, required);
  const appError = appId => !app(appId) ? rejected('not_found', 'The installed application no longer exists.') : !available() ? unavailable() : null;
  const clearMenus = () => { state.context = null; desktop.context = null; desktop.rename = null;
    desktop.windowMenuOpen = false; desktop.windowMenuItem = null;
    if (desktop.stacks) desktop.stacks.focusedStackId = null;
    context.dismissAppMenus();
  };
  const commands = {
    'dock.activate': async (target, payload) => {
      if (!appTarget(target, payload)) return invalid();
      const error = appError(target.appId); if (error) return error;
      if (context.isQuitting(target.appId)) return unavailable();
      clearMenus(); state.appWindows = null;
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
      if (!appTarget(target, payload, ['x', 'y'], []) || Object.hasOwn(payload, 'x') !== Object.hasOwn(payload, 'y')
        || (Object.hasOwn(payload, 'x') && (!finite(payload.x) || !finite(payload.y)))) return invalid();
      const error = appError(target.appId); if (error) return error;
      if (!context.getDockApps().some(entry => entry.id === target.appId)) return rejected('not_found', 'The application has no current Dock alias.');
      const point = Object.hasOwn(payload, 'x') ? payload : context.getView().dockAnchor(target.appId);
      if (!point) return unavailable();
      clearMenus(); state.appWindows = null;
      state.context = { appId: target.appId, x: point.x, y: point.y, itemId: null, submenuId: null, scroll: { main: 0, submenu: 0 } };
      const first = items().find(item => item.enabled);
      state.context.itemId = first?.id ?? null;
      if (first) await context.getView().focusDockMenuItem(first.id);
      return applied({ appId: target.appId, menuId: 'dock-context' });
    },
    'dock.context.close': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['restoreFocus'], [])
        || (payload.restoreFocus !== undefined && typeof payload.restoreFocus !== 'boolean')) return invalid();
      if (!available()) return unavailable();
      const appId = state.context?.appId;
      state.context = null;
      if (payload.restoreFocus !== false && appId) await context.focusDock(appId);
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
      if (entry.id.startsWith('window:')) result = await context.invoke('window.focus', { windowId: entry.id.slice(7) }, {});
      else if (entry.id === 'show-windows') result = await commands['dock.windows.open']({ appId }, {});
      else if (entry.id === 'keep-in-dock') result = await commands['dock.pin']({ appId }, { pinned: !state.pinnedAppIds.includes(appId) });
      else if (entry.id === 'show-in-finder') result = await commands['dock.reveal']({ appId }, {});
      else if (entry.id === 'open') result = await commands['dock.activate']({ appId }, {});
      else if (entry.id === 'quit') result = await context.invoke('app.quit', { appId }, {});
      else return rejected('disabled', 'This native action belongs to a separate unimplemented slice.');
      if (result.status !== 'applied') return result;
      if (state.context === menu) state.context = null;
      if (entry.id === 'keep-in-dock' || entry.id === 'quit') await context.focusDock(appId);
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
      const owned = context.getWindows().filter(window => window.appId === target.appId);
      clearMenus();
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

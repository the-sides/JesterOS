import { isRecord, rejected } from './feature-commands.js';

const windowOperations = ['close', 'minimize', 'zoom'];
const dockItems = ['downloads', 'trash'];

function fields(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function applied(target) {
  return { status: 'applied', target };
}

/**
 * Desktop/menu handlers use stable fileId, appId, menuId:'window', and itemId
 * ('close'/'minimize'/'zoom'/'window:<windowId>') targets. Empty payloads are
 * required except menu.open {position?:'first'|'last', itemId?:string},
 * menu.close {restoreFocus?:boolean}, and desktop.scroll {top:number}.
 * desktop.focusControl targets control:'file' + fileId, 'dock' + appId/itemId,
 * 'window-menu', or null (an observed focus outside desktop controls).
 * menu.select also accepts itemId:null only when no enabled menu items remain.
 * The mounted view supplies placement, enabled IDs, focus and scroll helpers;
 * callbacks invoke shared app/window handlers directly, never global execute.
 */
export function createDesktopCommands(viewState, {
  getView,
  getProfile,
  getWindows,
  getActiveWindowId,
  focusDesktop,
  openApp,
  windowAction,
}) {
  function enabledMenuItemIds() {
    const windows = getWindows();
    const active = windows.find((window) => window.id === getActiveWindowId());
    return [...(active ? windowOperations : []), ...windows.map((window) => `window:${window.id}`)];
  }

  function menuTarget(target, withItem = false, nullableItem = false) {
    return fields(target, withItem ? ['menuId', 'itemId'] : ['menuId'])
      && target.menuId === 'window'
      && (!withItem || (typeof target.itemId === 'string' && target.itemId.length > 0)
        || (nullableItem && target.itemId === null));
  }

  function menuItemError(itemId) {
    if (windowOperations.includes(itemId)) {
      return getWindows().some((window) => window.id === getActiveWindowId())
        ? null
        : rejected('disabled', 'This Window menu action requires an active window.');
    }
    if (itemId.startsWith('window:') && itemId.length > 'window:'.length) {
      return getWindows().some((window) => `window:${window.id}` === itemId)
        ? null
        : rejected('not_found', 'The Window menu window no longer exists.');
    }
    return rejected('not_found', 'Window menu item does not exist.');
  }

  async function closeMenu(view, restoreFocus) {
    viewState.windowMenuOpen = false;
    viewState.windowMenuItem = null;
    viewState.windowMenuScrollTop = 0;
    if (restoreFocus) {
      viewState.focusedControl = { control: 'window-menu' };
      await view.focusControl({ control: 'window-menu' });
    } else if (viewState.focusedControl?.control === 'window-menu-item') {
      viewState.focusedControl = null;
    }
  }

  function fileTarget(target, nullable = false) {
    return fields(target, ['fileId'])
      && (typeof target.fileId === 'string' || (nullable && target.fileId === null));
  }

  return {
    'desktop.select': (target, payload) => {
      if (!fileTarget(target, true) || !fields(payload, [])) {
        return rejected('invalid_arguments', 'desktop.select requires target.fileId (a file ID or null) and an empty payload.');
      }
      if (target.fileId !== null && !getProfile().desktopFiles.some((file) => file.id === target.fileId)) {
        return rejected('not_found', 'Desktop file does not exist.');
      }
      if (!getView()) return rejected('unavailable', 'The desktop is not mounted.');
      if (target.fileId !== null) focusDesktop();
      viewState.selectedFileId = target.fileId;
      return applied({ fileId: target.fileId });
    },
    'desktop.open': async (target, payload) => {
      if (!fileTarget(target) || !fields(payload, [])) {
        return rejected('invalid_arguments', 'desktop.open requires target.fileId and an empty payload.');
      }
      const file = getProfile().desktopFiles.find((entry) => entry.id === target.fileId);
      if (!file) return rejected('not_found', 'Desktop file does not exist.');
      if (!getView()) return rejected('unavailable', 'The desktop is not mounted.');
      const result = await openApp({ appId: file.appId }, { title: file.name });
      return result.status === 'applied' ? applied({ ...result.target, fileId: file.id }) : result;
    },
    'desktop.focus': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) {
        return rejected('invalid_arguments', 'desktop.focus requires an empty target and payload.');
      }
      const view = getView();
      if (!view) return rejected('unavailable', 'The desktop is not mounted.');
      focusDesktop();
      viewState.selectedFileId = null;
      await closeMenu(view, false);
      return applied({});
    },
    'menu.open': async (target, payload) => {
      if (!menuTarget(target)
        || !fields(payload, ['position', 'itemId'])
        || (Object.hasOwn(payload, 'position') && !['first', 'last'].includes(payload.position))
        || (Object.hasOwn(payload, 'itemId') && (typeof payload.itemId !== 'string' || !payload.itemId))
        || (Object.hasOwn(payload, 'position') && Object.hasOwn(payload, 'itemId'))) {
        return rejected('invalid_arguments', "menu.open requires target.menuId:'window' and an optional first/last position or explicit itemId.");
      }
      if (payload.itemId !== undefined) {
        const error = menuItemError(payload.itemId);
        if (error) return error;
      }
      const view = getView();
      if (!view) return rejected('unavailable', 'The desktop is not mounted.');
      const items = enabledMenuItemIds();
      const itemId = payload.itemId ?? items[payload.position === 'last' ? items.length - 1 : 0] ?? null;
      view.prepareWindowMenu();
      viewState.windowMenuOpen = true;
      viewState.windowMenuItem = itemId;
      viewState.focusedControl = itemId === null
        ? { control: 'window-menu' }
        : { control: 'window-menu-item', itemId };
      if (itemId === null) await view.focusControl({ control: 'window-menu' });
      else await view.focusMenuItem(itemId);
      viewState.windowMenuScrollTop = view.windowMenuScrollTop();
      return applied({ menuId: 'window', itemId });
    },
    'menu.close': async (target, payload) => {
      if (!menuTarget(target)
        || !fields(payload, ['restoreFocus'])
        || (Object.hasOwn(payload, 'restoreFocus') && typeof payload.restoreFocus !== 'boolean')) {
        return rejected('invalid_arguments', "menu.close requires target.menuId:'window' and an optional boolean restoreFocus.");
      }
      const view = getView();
      if (!view) return rejected('unavailable', 'The desktop is not mounted.');
      await closeMenu(view, payload.restoreFocus !== false);
      return applied({ menuId: 'window' });
    },
    'menu.select': async (target, payload) => {
      if (!menuTarget(target, true, true) || !fields(payload, [])) {
        return rejected('invalid_arguments', "menu.select requires target.menuId:'window', target.itemId, and an empty payload.");
      }
      if (target.itemId === null && enabledMenuItemIds().length) {
        return rejected('invalid_arguments', 'An enabled Window menu item must be selected.');
      }
      const error = target.itemId === null ? null : menuItemError(target.itemId);
      if (error) return error;
      const view = getView();
      if (!view || !viewState.windowMenuOpen) return rejected('unavailable', 'The Window menu is not open.');
      viewState.windowMenuItem = target.itemId;
      viewState.focusedControl = target.itemId === null
        ? { control: 'window-menu' }
        : { control: 'window-menu-item', itemId: target.itemId };
      if (target.itemId === null) await view.focusControl({ control: 'window-menu' });
      else await view.focusMenuItem(target.itemId);
      viewState.windowMenuScrollTop = view.windowMenuScrollTop();
      return applied({ menuId: 'window', itemId: target.itemId });
    },
    'menu.execute': async (target, payload) => {
      if (!menuTarget(target, true) || !fields(payload, [])) {
        return rejected('invalid_arguments', "menu.execute requires target.menuId:'window', target.itemId, and an empty payload.");
      }
      const error = menuItemError(target.itemId);
      if (error) return error;
      const view = getView();
      if (!view) return rejected('unavailable', 'The desktop is not mounted.');
      let command;
      let windowId;
      let windowPayload = {};
      if (target.itemId.startsWith('window:')) {
        command = 'window.focus';
        windowId = target.itemId.slice('window:'.length);
      } else {
        windowId = getActiveWindowId();
        if (target.itemId === 'close') command = 'window.close';
        else if (target.itemId === 'minimize') {
          command = 'window.setMinimized';
          windowPayload = { minimized: true };
        } else {
          command = 'window.setZoomed';
          windowPayload = { zoomed: !getWindows().find((window) => window.id === windowId).zoomed };
        }
      }
      const result = await windowAction(command, { windowId }, windowPayload);
      if (result.status !== 'applied') return result;
      await closeMenu(view, true);
      return applied({ menuId: 'window', itemId: target.itemId, windowId });
    },
    'desktop.focusControl': async (target, payload) => {
      let valid = false;
      let exists = true;
      if (target?.control === null || target?.control === 'window-menu') {
        valid = fields(target, ['control']);
      } else if (target?.control === 'file') {
        valid = fields(target, ['control', 'fileId']) && typeof target.fileId === 'string';
        exists = getProfile().desktopFiles.some((file) => file.id === target.fileId);
      } else if (target?.control === 'dock') {
        if (Object.hasOwn(target, 'appId')) {
          valid = fields(target, ['control', 'appId']) && typeof target.appId === 'string';
          const applications = getProfile().applications;
          exists = Object.hasOwn(applications, target.appId) && ['main', 'recent'].includes(applications[target.appId].dock);
        } else {
          valid = fields(target, ['control', 'itemId']) && typeof target.itemId === 'string';
          exists = dockItems.includes(target.itemId);
        }
      }
      if (!valid || !fields(payload, [])) {
        return rejected('invalid_arguments', 'desktop.focusControl requires a file, Dock app/item, Window menu button, or null control target and an empty payload.');
      }
      if (!exists) return rejected('not_found', 'Desktop control does not exist.');
      const view = getView();
      if (!view) return rejected('unavailable', 'The desktop is not mounted.');
      if (target.control !== null) await view.focusControl(target);
      viewState.focusedControl = target.control === null ? null : { ...target };
      if (target.control === 'window-menu' && viewState.windowMenuOpen) viewState.windowMenuItem = null;
      return applied({ ...target });
    },
    'desktop.scroll': async (target, payload) => {
      if (!fields(target, ['region']) || target.region !== 'window-menu'
        || !fields(payload, ['top']) || typeof payload.top !== 'number'
        || !Number.isFinite(payload.top) || payload.top < 0) {
        return rejected('invalid_arguments', "desktop.scroll requires target.region:'window-menu' and a finite nonnegative payload.top.");
      }
      const view = getView();
      if (!view || !viewState.windowMenuOpen) return rejected('unavailable', 'The Window menu is not open.');
      viewState.windowMenuScrollTop = await view.scrollWindowMenu(payload.top);
      return applied({ region: 'window-menu' });
    },
  };
}

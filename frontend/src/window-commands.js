import { rejected } from './feature-commands.js';

// Window primitives remain owned by App; UI and direct callers share these checks.
export function createWindowCommands(getWindows, actions) {
  function withWindow(action, fields = []) {
    return async (target, payload) => {
      if (Object.keys(target).some((key) => key !== 'windowId')
        || typeof target.windowId !== 'string'
        || Object.keys(payload).some((key) => !fields.includes(key))) {
        return rejected('invalid_arguments', 'Expected target.windowId and the documented window payload.');
      }
      const window = getWindows().find((entry) => entry.id === target.windowId);
      if (!window) return rejected('not_found', 'Window does not exist.');
      return action(window, payload);
    };
  }

  function applied(window) {
    return { status: 'applied', target: { appId: window.appId, windowId: window.id } };
  }

  return {
    'window.focus': withWindow(async (window, payload) => {
      if (payload.keyboard !== undefined && typeof payload.keyboard !== 'boolean') {
        return rejected('invalid_arguments', 'keyboard must be a boolean.');
      }
      actions.focus(window.id);
      if (payload.keyboard !== false) await actions.focusKeyboard(window.id);
      return applied(window);
    }, ['keyboard']),
    'window.close': withWindow((window) => {
      actions.close(window.id);
      return applied(window);
    }),
    'window.setMinimized': withWindow(async (window, payload) => {
      if (typeof payload.minimized !== 'boolean') return rejected('invalid_arguments', 'minimized must be a boolean.');
      if (payload.minimized) actions.minimize(window.id);
      else {
        actions.focus(window.id);
        await actions.focusKeyboard(window.id);
      }
      return applied(window);
    }, ['minimized']),
    'window.setZoomed': withWindow(async (window, payload) => {
      if (typeof payload.zoomed !== 'boolean') return rejected('invalid_arguments', 'zoomed must be a boolean.');
      if (window.minimized) return rejected('unavailable', 'Restore the window before changing zoom.');
      if (window.zoomed !== payload.zoomed) actions.zoom(window.id);
      await actions.focusKeyboard(window.id);
      return applied(window);
    }, ['zoomed']),
    'window.move': withWindow((window, payload) => {
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) {
        return rejected('invalid_arguments', 'Window coordinates must be finite workspace pixels.');
      }
      if (window.minimized || window.zoomed) return rejected('unavailable', 'Only visible normal windows can be moved.');
      actions.move(window.id, payload.x, payload.y);
      return applied(window);
    }, ['x', 'y']),
  };
}

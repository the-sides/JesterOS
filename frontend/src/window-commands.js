import { rejected } from './feature-commands.js';
import { WINDOW_RESIZE_AXES } from './window-state.js';

// Window primitives remain owned by App; UI and direct callers share these checks.
export function createWindowCommands(getWindows, actions, expandedProperty) {
  function withWindow(action, fields = []) {
    return async (target, payload) => {
      if (Object.keys(target).some((key) => key !== 'windowId')
        || typeof target.windowId !== 'string'
        || Object.keys(payload).some((key) => !fields.includes(key))) {
        return rejected('invalid_arguments', 'Expected target.windowId and the documented window payload.');
      }
      const window = getWindows().find((entry) => entry.id === target.windowId);
      if (!window) return rejected('not_found', 'Window does not exist.');
      if (!actions.available()) return rejected('unavailable', 'Dismiss the native global modal before interacting with windows.');
      return action(window, payload);
    };
  }

  function applied(window) {
    return { status: 'applied', target: { appId: window.appId, windowId: window.id } };
  }

  function setExpanded(property) {
    return withWindow(async (window, payload) => {
      if (typeof payload[property] !== 'boolean') return rejected('invalid_arguments', `${property} must be a boolean.`);
      if (window.minimized) return rejected('unavailable', 'Restore the window before changing its expanded state.');
      if (window[property] !== payload[property]) actions.expand(window.id);
      await actions.focusKeyboard(window.id);
      return applied(window);
    }, [property]);
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
    'window.close': withWindow(async (window) => {
      return await actions.close(window.id) ?? applied(window);
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
    'window.setZoomed': setExpanded('zoomed'),
    'window.setMaximized': setExpanded('maximized'),
    'window.move': withWindow((window, payload) => {
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) {
        return rejected('invalid_arguments', 'Window coordinates must be finite workspace pixels.');
      }
      if (window.minimized || window[expandedProperty]) return rejected('unavailable', 'Only visible normal windows can be moved.');
      actions.move(window.id, payload.x, payload.y);
      return applied(window);
    }, ['x', 'y']),
    'window.resize': withWindow((window, payload) => {
      if (typeof payload.edge !== 'string' || !Object.hasOwn(WINDOW_RESIZE_AXES, payload.edge)) {
        return rejected('invalid_arguments', 'Use a documented window resize edge.');
      }
      const axes = WINDOW_RESIZE_AXES[payload.edge];
      if (Object.hasOwn(payload, 'x') !== axes.includes('x') || Object.hasOwn(payload, 'y') !== axes.includes('y')
        || (axes.includes('x') && !Number.isFinite(payload.x)) || (axes.includes('y') && !Number.isFinite(payload.y))) {
        return rejected('invalid_arguments', 'Supply finite workspace coordinates for exactly the resized axes.');
      }
      if (window.minimized || window[expandedProperty]) return rejected('unavailable', 'Only visible normal windows can be resized.');
      actions.resize(window.id, payload.edge, payload);
      return applied(window);
    }, ['edge', 'x', 'y']),
  };
}

import { rejected } from './feature-commands.js';

export function createApplicationCommands(applications, actions) {
  function applicationAction(action, titleAllowed = false) {
    return async (target, payload) => {
      if (Object.keys(target).some(key => key !== 'appId')
        || typeof target.appId !== 'string' || !target.appId
        || Object.keys(payload).some(key => !titleAllowed || key !== 'title')
        || (payload.title !== undefined && typeof payload.title !== 'string')) {
        return rejected('invalid_arguments', 'Expected target.appId and the documented application payload.');
      }
      if (!Object.hasOwn(applications, target.appId)) return rejected('not_found', 'Application does not exist.');
      if (!actions.available()) return rejected('unavailable', 'Dismiss the native global modal before interacting with applications.');
      return action(applications[target.appId], payload);
    };
  }

  async function open(app, payload, fresh) {
    if (!actions.hasWorkspace()) return rejected('unavailable', 'The desktop has not been laid out.');
    if (fresh && !app.multipleWindows) return rejected('disabled', 'This application has one represented primary window.');
    if (actions.isQuitting(app.id) && (fresh || !actions.hasWindow(app.id))) {
      return rejected('unavailable', 'Resolve the pending application quit before opening another window.');
    }
    if (fresh && !actions.canCreateWindow(app.id)) return rejected('unavailable', 'Resolve the application dialog before creating another window.');
    const windowId = actions.open(app.id, payload.title, fresh);
    await actions.focusKeyboard(windowId);
    return { status: 'applied', target: { appId: app.id, windowId } };
  }

  return {
    'app.open': applicationAction((app, payload) => open(app, payload, false), true),
    'window.create': applicationAction((app, payload) => open(app, payload, true), true),
    'app.quit': applicationAction(app => app.quitAllowed
      ? actions.quit(app.id)
      : rejected('disabled', 'This profile keeps its desktop application running.')),
  };
}

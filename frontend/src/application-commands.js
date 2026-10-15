import { rejected } from './feature-commands.js';

export function createApplicationCommands(getApplications, actions) {
  function applicationAction(action, titleAllowed = false) {
    return async (target, payload, ownership) => {
      if (Object.keys(target).some(key => key !== 'appId')
        || typeof target.appId !== 'string' || !target.appId
        || Object.keys(payload).some(key => !titleAllowed || key !== 'title')
        || (payload.title !== undefined && typeof payload.title !== 'string')) {
        return rejected('invalid_arguments', 'Expected target.appId and the documented application payload.');
      }
      if (ownership?.guard && !ownership.guard()) return rejected('stale_target', 'The original application action owner changed.');
      const applications = getApplications();
      if (!Object.hasOwn(applications, target.appId)) return rejected('not_found', 'Application does not exist.');
      if (!actions.available(applications[target.appId])) return rejected('unavailable', 'Dismiss the native global modal before interacting with applications.');
      return action(applications[target.appId], payload, ownership);
    };
  }

  async function open(app, payload, fresh, ownership) {
    if (!actions.hasWorkspace()) return rejected('unavailable', 'The desktop has not been laid out.');
    if (fresh && !app.multipleWindows) return rejected('disabled', 'This application has one represented primary window.');
    if (app.presentation) {
      if (payload.title !== undefined) return rejected('invalid_arguments', 'A shell presentation has no document window title.');
      const result = await actions.present(app.presentation, ownership);
      return result.status === 'applied'
        ? { status: 'applied', target: { appId: app.id, windowId: null } } : result;
    }
    if (actions.isQuitting(app.id) && (fresh || !actions.hasWindow(app.id))) {
      return rejected('unavailable', 'Resolve the pending application quit before opening another window.');
    }
    if (fresh && !actions.canCreateWindow(app.id)) return rejected('unavailable', 'Resolve the application dialog before creating another window.');
    const windowId = actions.open(app.id, payload.title, fresh, { ...app.launchOptions, ...(ownership ? { ownership } : {}) });
    if (!windowId) return rejected('unavailable', 'The original application window could not be admitted.');
    await actions.focusKeyboard(windowId);
    return { status: 'applied', target: { appId: app.id, windowId } };
  }

  return {
    'app.open': applicationAction((app, payload, ownership) => open(app, payload, false, ownership), true),
    'window.create': applicationAction((app, payload, ownership) => open(app, payload, true, ownership), true),
    'app.quit': applicationAction((app, _payload, ownership) => app.quitAllowed
      ? actions.quit(app.id, ownership)
      : rejected('disabled', 'This registered application cannot quit independently of the shell.')),
  };
}

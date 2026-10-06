import { isRecord, rejected } from './feature-commands.js';

const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key))
  && required.every(key => Object.hasOwn(value, key));
const identity = value => typeof value === 'string' && value.length > 0;
const empty = (target, payload) => fields(target, []) && fields(payload, []);
const invalid = () => rejected('invalid_arguments', 'Use the closed system-menu target and declared payload.');
const unavailable = () => rejected('unavailable', 'The owned local system surface is not currently interactive.');
const applied = target => ({ status: 'applied', target });

export function createAppleCommands(ctx) {
  const guard = () => !ctx.profile.capabilities.includes('shell.apple-menu')
    ? rejected('unsupported_profile', 'Only Golden Gate represents these local Apple-menu workflows.')
    : !ctx.available() ? unavailable() : null;
  const currentApp = appId => !Object.hasOwn(ctx.profile.applications, appId)
    ? rejected('not_found', 'The application is not registered.')
    : !ctx.getRunningAppIds().includes(appId) ? rejected('unavailable', 'The application is no longer running.') : null;
  const handlers = {
    'system.about.open': (target, payload) => empty(target, payload) ? ctx.openAbout() : invalid(),
    'system.information.open': (target, payload) => empty(target, payload) ? ctx.openInformation() : invalid(),
    'system.forceQuit.open': (target, payload) => empty(target, payload) ? ctx.openForceQuit() : invalid(),
    'system.forceQuit.select': async (target, payload) => {
      if (!fields(target, ['windowId', 'appId']) || !identity(target.windowId) || !identity(target.appId) || !fields(payload, [])) return invalid();
      const error = currentApp(target.appId); if (error) return error;
      const entry = ctx.getPanel(target.windowId);
      if (entry?.window.utilityKind !== 'system-force-quit') return unavailable();
      if (!await ctx.focusPanel(entry, `app:${target.appId}`) || !ctx.available()
        || !ctx.getPanel(target.windowId) || !ctx.getRunningAppIds().includes(target.appId)) return unavailable();
      entry.window.forceQuitSelectedAppId = target.appId;
      return applied({ windowId: target.windowId, appId: target.appId });
    },
    'app.forceQuit': async (target, payload) => {
      if (!fields(target, ['appId']) || !identity(target.appId) || !fields(payload, [])) return invalid();
      const error = currentApp(target.appId); if (error) return error;
      if (target.appId === ctx.profile.defaults.desktopAppId) return rejected('disabled', 'Finder remains running; use app.relaunch instead.');
      return ctx.forceQuit(target.appId);
    },
    'app.relaunch': (target, payload) => {
      if (!fields(target, ['appId']) || target.appId !== ctx.profile.defaults.desktopAppId || !fields(payload, [])) return invalid();
      const error = currentApp(target.appId); if (error) return error;
      return ctx.relaunchDesktop();
    },
    'system.recents.clear': (target, payload) => {
      if (!empty(target, payload)) return invalid();
      ctx.clearRecents();
      return applied({});
    },
    'system.panel.focus': async (target, payload) => {
      if (!fields(target, ['windowId', 'control']) || !identity(target.windowId) || !identity(target.control) || !fields(payload, [])) return invalid();
      const entry = ctx.getPanel(target.windowId); if (!entry) return unavailable();
      if (!ctx.controlIds(entry).includes(target.control)) return rejected('not_found', 'The control does not belong to this system panel.');
      return await ctx.focusPanel(entry, target.control) ? applied({ windowId: target.windowId, control: target.control }) : unavailable();
    },
    'system.panel.scroll': (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, ['top', 'left', 'observe'], ['top'])
        || !Number.isFinite(payload.top) || payload.top < 0 || payload.left !== undefined && (!Number.isFinite(payload.left) || payload.left < 0)
        || payload.observe !== undefined && typeof payload.observe !== 'boolean') return invalid();
      const entry = ctx.getPanel(target.windowId); if (!entry) return unavailable();
      if (!payload.observe) { entry.element.scrollTop = payload.top; if (payload.left !== undefined) entry.element.scrollLeft = payload.left; }
      return applied({ windowId: target.windowId, top: entry.element.scrollTop, left: entry.element.scrollLeft });
    },
  };
  return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (target, payload) => guard() ?? handler(target, payload)]));
}

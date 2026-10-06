import { isRecord, rejected } from './feature-commands.js';
import { validComputerName } from './system-state.js';

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
    'system.settings.open': (target, payload) => fields(target, []) && fields(payload, ['pane'])
      && ['about', 'displays', 'storage', 'wifi'].includes(payload.pane) ? ctx.openSettings(payload.pane) : invalid(),
    'system.machine.rename': (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, ['name']) || !validComputerName(payload.name)) return invalid();
      const entry = ctx.getPanel(target.windowId);
      if (entry?.window.appId !== 'settings' || entry.window.utilityKind || entry.window.settingsPane !== 'about'
        || !ctx.controlIds(entry).includes('computer-name')) return unavailable();
      return ctx.renameComputer(entry, payload.name);
    },
    'system.machine.select': async (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, ['start', 'end', 'direction'], ['start', 'end'])
        || !Number.isInteger(payload.start) || payload.start < 0 || !Number.isInteger(payload.end) || payload.end < payload.start
        || payload.direction !== undefined && !['forward', 'backward', 'none'].includes(payload.direction)) return invalid();
      const entry = ctx.getPanel(target.windowId);
      const node = entry?.window.appId === 'settings' && !entry.window.utilityKind && entry.window.settingsPane === 'about'
        ? entry.element.querySelector('[data-system-computer-name]') : null;
      if (!node || node.value !== ctx.getComputerName()) return unavailable();
      if (payload.end > node.value.length) return invalid();
      if (!await ctx.focusPanel(entry, 'computer-name') || !ctx.available()
        || ctx.getPanel(target.windowId)?.element.querySelector('[data-system-computer-name]') !== node
        || node.value !== ctx.getComputerName()) return unavailable();
      node.setSelectionRange(payload.start, payload.end, payload.direction ?? 'none');
      return applied({ windowId: target.windowId, start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection });
    },
    'system.about.version.set': (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, ['expanded']) || typeof payload.expanded !== 'boolean') return invalid();
      const entry = ctx.getPanel(target.windowId);
      if (!entry || !ctx.controlIds(entry).includes('version')) return unavailable();
      entry.window.aboutBuildVisible = payload.expanded;
      return applied({ windowId: target.windowId, expanded: payload.expanded });
    },
    'system.coverage.open': (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, [])) return invalid();
      const entry = ctx.getPanel(target.windowId);
      if (entry?.window.appId !== 'settings' || entry.window.utilityKind || entry.window.settingsPane !== 'about'
        || !ctx.controlIds(entry).includes('coverage-details')) return unavailable();
      return ctx.openCoverage();
    },
    'system.storage.volumes.set': (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, ['expanded']) || typeof payload.expanded !== 'boolean') return invalid();
      const entry = ctx.getPanel(target.windowId);
      if (entry?.window.appId !== 'settings' || entry.window.utilityKind || entry.window.settingsPane !== 'storage'
        || !ctx.controlIds(entry).includes('all-volumes')) return unavailable();
      entry.window.storageVolumesVisible = payload.expanded;
      return applied({ windowId: target.windowId, expanded: payload.expanded });
    },
    'system.information.open': (target, payload) => empty(target, payload) ? ctx.openInformation() : invalid(),
    'system.forceQuit.open': (target, payload) => empty(target, payload) ? ctx.openForceQuit() : invalid(),
    'system.forceQuit.select': async (target, payload) => {
      if (!fields(target, ['windowId', 'appId']) || !identity(target.windowId) || !identity(target.appId) || !fields(payload, [])) return invalid();
      const error = currentApp(target.appId); if (error) return error;
      const entry = ctx.getPanel(target.windowId);
      if (entry?.window.utilityKind !== 'system-force-quit' || !ctx.controlIds(entry).includes(`app:${target.appId}`)) return unavailable();
      if (!await ctx.focusPanel(entry, `app:${target.appId}`) || !ctx.available()
        || !ctx.getPanel(target.windowId) || !ctx.getRunningAppIds().includes(target.appId)) return unavailable();
      entry.window.forceQuitSelectedAppId = target.appId;
      return applied({ windowId: target.windowId, appId: target.appId });
    },
    'system.forceQuit.respond': (target, payload) => {
      if (!fields(target, ['windowId', 'confirmationId']) || !identity(target.windowId) || !identity(target.confirmationId)
        || !fields(payload, ['accept']) || typeof payload.accept !== 'boolean') return invalid();
      const entry = ctx.getPanel(target.windowId);
      if (entry?.window.appId !== ctx.profile.defaults.desktopAppId || entry.window.utilityKind !== 'system-force-quit') return unavailable();
      return ctx.respondForceQuit(target.windowId, target.confirmationId, payload.accept);
    },
    'app.forceQuit': async (target, payload) => {
      if (!fields(target, ['appId']) || !identity(target.appId) || !fields(payload, [])) return invalid();
      const error = currentApp(target.appId); if (error) return error;
      if (target.appId === ctx.profile.defaults.desktopAppId) return rejected('disabled', 'Finder remains running; use app.relaunch instead.');
      return ctx.requestForceQuit(target.appId);
    },
    'app.relaunch': (target, payload) => {
      if (!fields(target, ['appId']) || target.appId !== ctx.profile.defaults.desktopAppId || !fields(payload, [])) return invalid();
      const error = currentApp(target.appId); if (error) return error;
      return ctx.requestFinderRelaunch();
    },
    'system.recents.open': (target, payload) => {
      if (!fields(target, ['category', 'itemId']) || !['applications', 'documents', 'servers'].includes(target.category)
        || !identity(target.itemId) || !fields(payload, [])) return invalid();
      return ctx.openRecent(target.category, target.itemId);
    },
    'system.server.open': (target, payload) => {
      if (!fields(target, ['serverId']) || !identity(target.serverId) || !fields(payload, [])) return invalid();
      return ctx.openServer(target.serverId);
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

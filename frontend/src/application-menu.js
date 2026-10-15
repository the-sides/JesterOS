import { isRecord, rejected } from './feature-commands.js';
import { applicationMenuItems } from './application-switching.js';

export const APPLICATION_MENU_UTILITY_SIZES = {
  'application-about': { width: 360, height: 360, minimumSize: { width: 280, height: 240 } },
};
const supported = profile => profile.family === 'macos' && profile.capabilities.includes('messages.conversations');
const fields = (value, keys) => isRecord(value) && Object.keys(value).every(key => keys.includes(key));
const identity = value => typeof value === 'string' && value.length > 0;
const invalid = () => rejected('invalid_arguments', 'Use the closed application-menu target and documented payload.');
const unavailable = () => rejected('unavailable', 'The native application presentation is unavailable.');
const applied = target => ({ status: 'applied', target });

export function goldenApplicationMenuItems({ state, profile, appId, runningAppIds, pendingQuitAppIds, services = [] }) {
  const live = runningAppIds.includes(appId) && !pendingQuitAppIds.includes(appId) && !state.hiddenAppIds.includes(appId);
  const request = command => ({ command, target: { appId } });
  const actions = {
    hide: { ...request('app.setHidden'), payload: { hidden: true } },
    'hide-others': request('app.hideOthers'), 'show-all': { command: 'app.showAll' }, quit: request('app.quit'),
  };
  return applicationMenuItems(state, profile, appId, runningAppIds, pendingQuitAppIds)
    .filter(item => appId !== 'finder' || !['separator-quit', 'quit'].includes(item.id))
    .map(item => {
      if (item.id === 'about') return { ...item, enabled: live, request: request('app.about.open') };
      if (item.id === 'preferences') return { ...item, enabled: live && appId === 'notes',
        ...(appId === 'notes' ? { request: request('app.settings.open') } : {}) };
      if (item.id === 'services') {
        const children = live && services.length ? services : [{ id: 'no-services', label: 'No Services Apply', enabled: false }];
        return { id: item.id, label: item.label, enabled: live, children };
      }
      return { ...item, ...(actions[item.id] ? { request: actions[item.id] } : {}) };
    });
}

/** About geometry remains in App; Notes preferences belong to its managed session. */
export function createApplicationMenuCommands(ctx) {
  const guard = () => !supported(ctx.profile)
    ? rejected('unsupported_profile', 'Application About panels require a supported Mac scene.')
    : !ctx.available() ? unavailable() : null;
  function currentApp(appId) {
    if (!Object.hasOwn(ctx.profile.applications, appId)) return rejected('not_found', 'The application is not registered.');
    if (ctx.profile.renderer !== 'golden-gate' && appId !== 'messages')
      return rejected('disabled', 'Only Messages has a represented About utility in this profile.');
    if (ctx.getActiveAppId() !== appId || !ctx.getRunningAppIds().includes(appId)
      || ctx.isHidden(appId) || ctx.isQuitting(appId)) return rejected('disabled', 'The current live visible application must own its app-menu utility.');
    return null;
  }
  function panel(windowId) {
    const entry = ctx.getPanel(windowId);
    return entry && !entry.window.minimized && !ctx.isHidden(entry.window.appId) && !ctx.isQuitting(entry.window.appId)
      ? entry : null;
  }
  async function open(target, payload, kind) {
    const error = guard(); if (error) return error;
    if (!fields(target, ['appId']) || !identity(target.appId) || !fields(payload, [])) return invalid();
    const ownerError = currentApp(target.appId); if (ownerError) return ownerError;
    if (kind === 'application-settings') {
      if (!ctx.profile.capabilities.includes('shell.application-menu')) return rejected('unsupported_profile', 'Native application Settings utilities are not supported in this profile.');
      if (target.appId !== 'notes') return rejected('disabled', 'This application has no represented working Settings panel.');
      if (typeof ctx.openNotesPreferences !== 'function') return unavailable();
      return ctx.openNotesPreferences({ appId: target.appId });
    }
    return ctx.openPanel(target.appId, kind);
  }
  return {
    'app.about.open': (target, payload) => open(target, payload, 'application-about'),
    'app.settings.open': (target, payload) => open(target, payload, 'application-settings'),
    'app.panel.focus': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!fields(target, ['windowId', 'control']) || !identity(target.windowId)
        || target.control !== 'panel' || !fields(payload, [])) return invalid();
      const entry = panel(target.windowId); if (!entry) return unavailable();
      if (entry.window.utilityKind !== 'application-about') return unavailable();
      return await ctx.focusPanel(entry, target.control) ? applied({ windowId: target.windowId, control: target.control }) : unavailable();
    },
    'app.panel.scroll': (target, payload) => {
      const error = guard(); if (error) return error;
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, ['top', 'left', 'observe'])
        || !Number.isFinite(payload.top) || payload.top < 0
        || (payload.left !== undefined && (!Number.isFinite(payload.left) || payload.left < 0))
        || (payload.observe !== undefined && typeof payload.observe !== 'boolean')) return invalid();
      const entry = panel(target.windowId); if (!entry) return unavailable();
      if (!payload.observe) {
        entry.element.scrollTop = payload.top;
        if (payload.left !== undefined) entry.element.scrollLeft = payload.left;
      }
      return applied({ windowId: target.windowId, top: entry.element.scrollTop, left: entry.element.scrollLeft });
    },
  };
}

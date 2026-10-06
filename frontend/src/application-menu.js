import { isRecord, rejected } from './feature-commands.js';
import { applicationMenuItems } from './application-switching.js';
import { createNote } from './notes-state.js';
import { notesPreferencesSchema } from './notes-preferences.js';

export const APPLICATION_MENU_UTILITY_SIZES = {
  'application-about': { width: 360, height: 360, minimumSize: { width: 280, height: 240 } },
  'application-settings': { width: 480, height: 360, minimumSize: { width: 300, height: 240 } },
};
const supported = profile => profile.renderer === 'golden-gate' && profile.capabilities.includes('shell.application-menu');
const fields = (value, keys) => isRecord(value) && Object.keys(value).every(key => keys.includes(key));
const identity = value => typeof value === 'string' && value.length > 0;
const position = value => Number.isSafeInteger(value) && value >= 0;
const invalid = () => rejected('invalid_arguments', 'Use the closed application-menu target and documented payload.');
const unavailable = () => rejected('unavailable', 'The native application presentation is unavailable.');
const stale = () => rejected('stale_target', 'The selected source document or text changed before the service could run.');
const applied = target => ({ status: 'applied', target });

export function goldenApplicationMenuItems({ state, profile, appId, runningAppIds, pendingQuitAppIds, selection }) {
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
        const children = selection && live ? [{
          id: `service-create-note:${selection.windowId}:${selection.noteId}:${selection.revision}:${selection.control}:${selection.start}:${selection.end}`,
          label: 'Create Note from Selection', enabled: true,
          request: { command: 'app.service.perform', target: { appId, serviceId: 'create-note', windowId: selection.windowId,
            noteId: selection.noteId, control: selection.control }, payload: { start: selection.start, end: selection.end } },
        }] : [{ id: 'no-services', label: 'No Services Apply', enabled: false }];
        return { id: item.id, label: item.label, enabled: live, children };
      }
      return { ...item, ...(actions[item.id] ? { request: actions[item.id] } : {}) };
    });
}

/** Panel geometry/lifetime remains in App. Preferences are seeded data; service
 * focus preparation precedes creation so a failed/stale source creates no note. */
export function createApplicationMenuCommands(ctx) {
  const guard = () => !supported(ctx.profile)
    ? rejected('unsupported_profile', 'Only Golden Gate supports application-menu panels and local services.')
    : !ctx.available() ? unavailable() : null;
  function currentApp(appId) {
    if (!Object.hasOwn(ctx.profile.applications, appId)) return rejected('not_found', 'The application is not registered.');
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
    if (kind === 'application-settings' && target.appId !== 'notes') return rejected('disabled', 'This application has no represented working Settings panel.');
    return ctx.openPanel(target.appId, kind);
  }
  return {
    'app.about.open': (target, payload) => open(target, payload, 'application-about'),
    'app.settings.open': (target, payload) => open(target, payload, 'application-settings'),
    'app.settings.set': (target, payload) => {
      const error = guard(); if (error) return error;
      const properties = notesPreferencesSchema.properties;
      if (!fields(target, ['appId']) || target.appId !== 'notes' || !fields(payload, Object.keys(properties))
        || Object.keys(payload).length === 0
        || (Object.hasOwn(payload, 'sortBy') && !properties.sortBy.enum.includes(payload.sortBy))
        || (Object.hasOwn(payload, 'groupByDate') && typeof payload.groupByDate !== 'boolean')
        || (Object.hasOwn(payload, 'textSize') && (!Number.isInteger(payload.textSize)
          || payload.textSize < properties.textSize.minimum || payload.textSize > properties.textSize.maximum))) return invalid();
      Object.assign(ctx.notes.preferences, payload);
      return applied({ appId: 'notes' });
    },
    'app.panel.focus': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!fields(target, ['windowId', 'control']) || !identity(target.windowId)
        || !['panel', 'sort-by', 'group-by-date', 'text-size'].includes(target.control) || !fields(payload, [])) return invalid();
      const entry = panel(target.windowId); if (!entry) return unavailable();
      if (target.control !== 'panel' && entry.window.utilityKind !== 'application-settings')
        return rejected('not_found', 'This About utility has no preference controls.');
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
    'app.service.perform': async (target, payload) => {
      const error = guard(); if (error) return error;
      if (!fields(target, ['appId', 'serviceId', 'windowId', 'noteId', 'control']) || target.appId !== 'notes'
        || target.serviceId !== 'create-note' || !identity(target.windowId) || !identity(target.noteId)
        || !['title', 'body'].includes(target.control) || !fields(payload, ['start', 'end'])
        || !position(payload.start) || !position(payload.end) || payload.end <= payload.start) return invalid();
      const ownerError = currentApp(target.appId); if (ownerError) return ownerError;
      const source = ctx.getSource(target); if (!source) return stale();
      if (payload.end > source.value.length || payload.end - payload.start > 1024 * 1024) return invalid();
      const value = source.value, revision = source.note.updatedAt, token = ctx.captureFocus();
      let focused;
      try { focused = await ctx.focusServiceBody(target.windowId); }
      catch (error) { await ctx.restoreFocus(token, target.windowId); throw error; }
      const current = ctx.getSource(target);
      if (!focused || !ctx.available() || !current || current.value !== value || current.note.updatedAt !== revision) {
        await ctx.restoreFocus(token, target.windowId);
        return !focused || !ctx.available() ? unavailable() : stale();
      }
      // The already-focused native body is retained across the nonempty selected
      // record change; no fallible focus work or second edit follows creation.
      const noteId = createNote(ctx.notes, value.slice(payload.start, payload.end));
      ctx.noteCreated();
      return applied({ appId: 'notes', serviceId: 'create-note', windowId: target.windowId, sourceNoteId: target.noteId, noteId });
    },
  };
}

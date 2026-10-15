import { tick } from 'svelte';
import { appModules, windows11AppsForWindow, readWindows11AppWindows } from './windows11-app-state.js';
import { windows11AppSpecs } from './windows11-app-catalog.js';
import { applied,invalid,stale,unavailable,liveFile,conforms } from './windows11-app-helpers.js';
import { documentFileMime } from './document-destination-commands.js';
export { windows11AppCatalog } from './windows11-app-catalog.js';
export function readWindows11AppTargets(apps, context) {
  const ownedWindowIds = new Set(readWindows11AppWindows(apps).map(window => window.windowId));
  const describe = (id, scoped, windowId = null) => {
    const state = scoped[id], module = appModules[id];
    const view = windowId ? context.getApplicationView(windowId) : null;
    return { appId: id, ...(windowId ? { windowId } : {}), ...module.readTargets(scoped), menu: state.ui.menu, dialog: state.ui.dialog,
      menus: [...module.menus], focused: state.ui.focused, scroll: state.ui.scroll, textSelection: state.ui.selection || null,
      ...(id === 'snipping' ? { captureSources: context.getWindows().filter(window => window.appId === 'paint').map(window =>
        ({ sourceWindowId: window.id, appId: window.appId, minimized: window.minimized, available: Boolean(context.getApplicationView(window.id)?.hasCaptureSurface()) })) } : {}),
      presentation: { mounted: Boolean(view), controls: view?.controls() || [], areas: view?.areas() || [], captureAvailable: Boolean(view?.hasCaptureSurface()) } };
  };
  const targets = { files: apps.files.map(file => ({ id: file.id, parentId: file.parentId, name: file.name, kind: file.kind, deleted: file.deleted, revision: file.revision })),
    applications: Object.fromEntries(Object.keys(appModules).map(id => {
      const windows = context.getWindows().filter(window => window.appId === id
        && (!window.utilityKind || id === 'photos' && window.utilityKind === 'photos-svg')
        && ownedWindowIds.has(window.id)).map(window =>
        describe(id, windows11AppsForWindow(apps, window.id), window.id));
      return [id, { appId: id, windows, retained: windows.length ? null : describe(id, apps) }];
    })) };
  return JSON.parse(JSON.stringify(targets));
}

function createScopedCommands(apps, context, appId) {
  const viewFor = () => {
    const window = context.getWindow();
    return window && !window.minimized ? context.getApplicationView(window.id) : null;
  };
  const validControl = (view,control) => view?.controls().find(item => item.id === control && !item.disabled);
  const focusWindow = () => { const window = context.getWindow(); if (window) context.focusWindow(window.id); };
  const base = {
    'win11.apps.menu':async (target,payload) => {
      const state = apps[target.appId], module = appModules[target.appId];
      if(payload.menu !== null && !module.menus.includes(payload.menu)) return stale('This application has no such menu.');
      const view = viewFor();
      if(!view) return unavailable();
      if(state.ui.dialog && payload.menu !== null) return unavailable('Close the modal dialog before opening a menu.');
      state.ui.menu = payload.menu;
      await tick();
      if(viewFor() !== view) return stale('The original native application view is no longer available.');
      return applied(target);
    },
    'win11.apps.focus':async target => {
      const view = viewFor();
      if(!view) return unavailable();
      if(!validControl(view,target.control)) return stale('The requested control is not currently visible and enabled.');
      focusWindow();
      await tick();
      if(viewFor() !== view) return stale('The original native application view is no longer available.');
      if(!view.focus(target.control)) return unavailable('The control could not receive focus.');
      apps[target.appId].ui.focused = target.control;
      return applied(target);
    },
    'win11.apps.focus.observe':target => {
      const view = viewFor();
      if(!view) return unavailable();
      if(target.control !== null && (!validControl(view,target.control) || view.focusedControl() !== target.control)) return stale('Observed focus does not match the current native control.');
      if(target.control === null && view.focusedControl() !== null) return stale('A native control still has focus.');
      apps[target.appId].ui.focused = target.control;
      return applied(target);
    },
    'win11.apps.scroll':async (target,payload) => {
      const view = viewFor();
      if(!view) return unavailable();
      if(!view.areas().includes(target.area)) return stale('The scroll area is not currently rendered.');
      await tick();
      if(viewFor() !== view) return stale('The original native application view is no longer available.');
      const offsets = view.scroll(target.area,payload.top,payload.left);
      if(!offsets) return unavailable();
      apps[target.appId].ui.scroll[target.area] = offsets;
      return applied(target,{offsets});
    },
    'win11.apps.scroll.observe':(target,payload) => {
      const view = viewFor();
      if(!view) return unavailable();
      const actual = view.readScroll(target.area);
      if(!actual) return stale();
      if(Math.abs(actual.top-payload.top)>1 || Math.abs(actual.left-payload.left)>1) return invalid('Observed scroll must match real element offsets.');
      apps[target.appId].ui.scroll[target.area] = actual;
      return applied(target,{offsets:actual});
    },
  };
  for(const name of ['win11.apps.selection','win11.apps.selection.observe']) base[name] = async (target,payload) => {
    const view = viewFor();
    if(!view) return unavailable();
    const control = validControl(view,target.control);
    if(!control?.editable) return stale('This current control does not support text selection.');
    if(payload.start>payload.end || payload.end>control.length) return invalid('Selection offsets exceed the current text.');
    if(name.endsWith('.observe')) { const actual = view.readSelection(target.control); if(!actual || actual.start!==payload.start || actual.end!==payload.end) return invalid('Observed selection must match real editable text.'); }
    else {
      focusWindow(); await tick();
      if(viewFor() !== view) return stale('The original native application view is no longer available.');
      if(!view.select(target.control,payload.start,payload.end)) return unavailable();
    }
    apps[target.appId].ui.selection = {...target,...payload};
    return applied(target);
  };
  return { ...base, ...appModules[appId].createCommands(apps, context) };
}

const commandAppId = (name, target) => name.startsWith('win11.apps.') ? target.appId : name.split('.')[1];

export function createWindows11AppCommands(apps, context) {
  const fileCommands = appModules.explorer.createFileCommands(apps);
  const openFile = async (target, ownership = {}) => {
    const file = liveFile(apps, target.fileId);
    if (!file) return stale('The virtual file is missing or in the Recycle Bin.');
    const sourceWindow = target.windowId ? context.getWindows().find(window => window.id === target.windowId) : null;
    if (target.windowId && !sourceWindow) return stale('The original file-opening window no longer exists.');
    const scope = target.windowId ? { windowId: target.windowId } : {};
    if (file.kind === 'folder') return context.invoke('win11.explorer.navigate', { ...scope, folderId: file.id }, {});
    const mime = documentFileMime(file);
    if (mime === 'image/svg+xml' || !mime && file.kind === 'image' && /^\s*<svg[\s>]/.test(file.content)) {
      if (typeof file.content !== 'string' || !/^\s*<svg[\s>]/.test(file.content))
        return stale('This standalone SVG image is unavailable.');
      if (typeof context.openLegacySvgFile !== 'function') return unavailable('The genuine SVG Photos bridge is unavailable.');
      const signature = JSON.stringify(file);
      const guard = () => (!ownership.guard || ownership.guard())
        && liveFile(apps, file.id) === file && JSON.stringify(file) === signature
        && (!sourceWindow || context.getWindows().find(window => window.id === target.windowId) === sourceWindow);
      return context.openLegacySvgFile(file.id, { ...scope, guard });
    }
    if (mime === 'application/pdf' || ['image/png', 'image/jpeg', 'image/webp'].includes(mime)
      || mime === 'text/plain' || mime === 'application/rtf' || mime === 'text/rtf') {
      if (typeof context.openAssociatedFile !== 'function') return unavailable('The genuine associated document bridge is unavailable.');
      const signature = JSON.stringify(file);
      const guard = () => liveFile(apps, file.id) === file && JSON.stringify(file) === signature
        && (!sourceWindow || context.getWindows().find(window => window.id === target.windowId) === sourceWindow);
      const result = await context.openAssociatedFile(file.id, { ...scope, guard });
      if (result.status !== 'applied') return result;
      const destinationId = result.windowId ?? result.target?.windowId;
      const destination = context.getWindows().find(window => window.id === destinationId);
      if (!destination) return stale('The genuine associated document window is no longer available.');
      return { ...result, target: { ...result.target, appId: destination.appId, windowId: destination.id } };
    }
    return invalid('This virtual file MIME has no represented application.');
  };
  return Object.fromEntries(Object.entries(windows11AppSpecs).map(([name, spec]) => [name, async (target, payload, ownership = {}) => {
    if (!conforms(target, spec[0]) || !conforms(payload, spec[1]) || (spec[4] && !conforms({ target, payload }, { allOf: spec[4] }))) return invalid();
    if (ownership.guard && !ownership.guard()) return stale('The original file-opening owner changed.');
    if (name === 'win11.files.open') return openFile(target, ownership);
    if (name === 'win11.photos.open' && !target.windowId) {
      const file = liveFile(apps, target.fileId);
      if (file?.kind !== 'image' || typeof file.content !== 'string' || !/^\s*<svg[\s>]/.test(file.content))
        return stale('This SVG image is unavailable.');
      return openFile(target, ownership);
    }
    if (fileCommands[name]) return fileCommands[name](target, payload);
    const appId = commandAppId(name, target);
    if (!appModules[appId]) return stale('This application is not represented.');
    const windows = context.getWindows().filter(window => window.appId === appId
      && (appId !== 'photos' || (!window.utilityKind || window.utilityKind === 'photos-svg')
        && windows11AppsForWindow(apps, window.id)));
    if (target.windowId && !windows.some(window => window.id === target.windowId)) return stale('This window does not belong to the requested application.');
    if (!target.windowId && windows.length > 1) return invalid('Specify windowId: this application has multiple windows.');
    let windowId = target.windowId || windows[0]?.id || null;
    const scoped = windowId ? windows11AppsForWindow(apps, windowId) : apps;
    if (!scoped) return stale('This native window session no longer exists.');
    const originalWindow = windows.find(window => window.id === windowId);
    const scopedContext = {
      ...context,
      getWindow: () => context.getWindows().find(window => window.id === windowId && window.appId === appId) || null,
      guard: () => (!ownership.guard || ownership.guard())
        && (!windowId || windows11AppsForWindow(apps, windowId) === scoped
          && context.getWindows().find(window => window.id === windowId) === originalWindow
          && (appId !== 'photos' || apps.windowSessions?.[windowId] === scoped.photos)),
      invoke: async (command, nextTarget = {}, nextPayload = {}) => {
        if (command === 'app.open' && nextTarget.appId === appId) {
          if (windowId) return context.invoke('window.focus', { windowId }, {});
          const result = await context.invoke(command, nextTarget, nextPayload);
          if (result.status === 'applied') windowId = result.target.windowId;
          return result;
        }
        const nextAppId = commandAppId(command, nextTarget);
        if (command.startsWith('win11.') && nextAppId === appId && windowId && !nextTarget.windowId)
          nextTarget = { ...nextTarget, windowId };
        return context.invoke(command, nextTarget, nextPayload);
      },
    };
    const handler = createScopedCommands(scoped, scopedContext, appId)[name];
    if (!handler) return unavailable('This native command is unavailable.');
    const result = await handler(target, payload);
    if (result.status !== 'applied') return result;
    return { ...result, target: { ...result.target, appId, ...(windowId ? { windowId } : {}) } };
  }]));
}

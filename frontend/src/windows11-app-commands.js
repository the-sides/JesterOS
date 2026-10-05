import { tick } from 'svelte';
import { appModules, windows11AppsForWindow } from './windows11-app-state.js';
import { windows11AppSpecs } from './windows11-app-catalog.js';
import { applied,invalid,stale,unavailable,liveFile,conforms } from './windows11-app-helpers.js';
export { windows11AppCatalog } from './windows11-app-catalog.js';
export function readWindows11AppTargets(apps, context) {
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
      const windows = context.getWindows().filter(window => window.appId === id).map(window =>
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
      if(!viewFor()) return unavailable();
      if(state.ui.dialog && payload.menu !== null) return unavailable('Close the modal dialog before opening a menu.');
      state.ui.menu = payload.menu;
      await tick();
      return applied(target);
    },
    'win11.apps.focus':async target => {
      const view = viewFor();
      if(!view) return unavailable();
      if(!validControl(view,target.control)) return stale('The requested control is not currently visible and enabled.');
      focusWindow();
      await tick();
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
    else { focusWindow(); await tick(); if(!view.select(target.control,payload.start,payload.end)) return unavailable(); }
    apps[target.appId].ui.selection = {...target,...payload};
    return applied(target);
  };
  return { ...base, ...appModules[appId].createCommands(apps, context) };
}

const commandAppId = (name, target) => name.startsWith('win11.apps.') ? target.appId : name.split('.')[1];

export function createWindows11AppCommands(apps, context) {
  const fileCommands = appModules.explorer.createFileCommands(apps);
  const openFile = target => {
    const file = liveFile(apps, target.fileId);
    if (!file) return stale('The virtual file is missing or in the Recycle Bin.');
    const scope = target.windowId ? { windowId: target.windowId } : {};
    if (file.kind === 'folder') return context.invoke('win11.explorer.navigate', { ...scope, folderId: file.id }, {});
    if (file.kind === 'text') return context.invoke('win11.notepad.open', { ...scope, fileId: file.id }, {});
    if (file.kind === 'image') return context.invoke('win11.photos.open', { ...scope, fileId: file.id }, {});
    return invalid('This virtual file type has no represented application.');
  };
  return Object.fromEntries(Object.entries(windows11AppSpecs).map(([name, spec]) => [name, async (target, payload) => {
    if (!conforms(target, spec[0]) || !conforms(payload, spec[1]) || (spec[4] && !conforms({ target, payload }, { allOf: spec[4] }))) return invalid();
    if (name === 'win11.files.open') return openFile(target);
    if (fileCommands[name]) return fileCommands[name](target, payload);
    const appId = commandAppId(name, target);
    if (!appModules[appId]) return stale('This application is not represented.');
    const windows = context.getWindows().filter(window => window.appId === appId);
    if (target.windowId && !windows.some(window => window.id === target.windowId)) return stale('This window does not belong to the requested application.');
    if (!target.windowId && windows.length > 1) return invalid('Specify windowId: this application has multiple windows.');
    let windowId = target.windowId || windows[0]?.id || null;
    const scoped = windowId ? windows11AppsForWindow(apps, windowId) : apps;
    if (!scoped) return stale('This native window session no longer exists.');
    const scopedContext = {
      ...context,
      getWindow: () => context.getWindows().find(window => window.id === windowId && window.appId === appId) || null,
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

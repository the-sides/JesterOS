import { tick } from 'svelte';
import { appModules } from './windows11-app-state.js';
import { windows11AppSpecs } from './windows11-app-catalog.js';
import { applied,invalid,stale,unavailable,liveFile,conforms } from './windows11-app-helpers.js';
export { windows11AppCatalog } from './windows11-app-catalog.js';
export function readWindows11AppTargets(apps,getView = () => null) {
  const targets = { files:apps.files.map(file => ({id:file.id,parentId:file.parentId,name:file.name,kind:file.kind,deleted:file.deleted,revision:file.revision})), applications:Object.fromEntries(Object.entries(appModules).map(([id,module]) => {
    const view = getView(id);
    return [id,{...module.readTargets(apps),menu:apps[id].ui.menu,dialog:apps[id].ui.dialog,menus:[...module.menus],focused:apps[id].ui.focused,scroll:apps[id].ui.scroll,selection:apps[id].ui.selection || null,presentation:{mounted:Boolean(view),controls:view?.controls() || [],areas:view?.areas() || [],captureAvailable:Boolean(view?.hasCaptureSurface())}}];
  })) };
  return JSON.parse(JSON.stringify(targets));
}
export function createWindows11AppCommands(apps,context) {
  const viewFor = id => {
    const window = context.getWindows().find(item => item.appId === id && !item.minimized);
    return window ? context.getApplicationView(id) : null;
  };
  const validControl = (view,control) => view?.controls().find(item => item.id === control && !item.disabled);
  const focusWindow = id => { const window = context.getWindows().find(item => item.appId === id); if(window) context.focusWindow(window.id); };
  const base = {
    'win11.files.open':async target => {
      const file = liveFile(apps,target.fileId);
      if(!file) return stale('The virtual file is missing or in the Recycle Bin.');
      if(file.kind === 'folder') return context.invoke('win11.explorer.navigate',{folderId:file.id},{});
      if(file.kind === 'text') return context.invoke('win11.notepad.open',{fileId:file.id},{});
      if(file.kind === 'image') return context.invoke('win11.photos.open',{fileId:file.id},{});
      return invalid('This virtual file type has no represented application.');
    },
    'win11.apps.menu':async (target,payload) => {
      const state = apps[target.appId], module = appModules[target.appId];
      if(payload.menu !== null && !module.menus.includes(payload.menu)) return stale('This application has no such menu.');
      if(!viewFor(target.appId)) return unavailable();
      if(state.ui.dialog && payload.menu !== null) return unavailable('Close the modal dialog before opening a menu.');
      state.ui.menu = payload.menu;
      await tick();
      return applied(target);
    },
    'win11.apps.focus':async target => {
      const view = viewFor(target.appId);
      if(!view) return unavailable();
      if(!validControl(view,target.control)) return stale('The requested control is not currently visible and enabled.');
      focusWindow(target.appId);
      await tick();
      if(!view.focus(target.control)) return unavailable('The control could not receive focus.');
      apps[target.appId].ui.focused = target.control;
      return applied(target);
    },
    'win11.apps.focus.observe':target => {
      const view = viewFor(target.appId);
      if(!view) return unavailable();
      if(target.control !== null && (!validControl(view,target.control) || view.focusedControl() !== target.control)) return stale('Observed focus does not match the current native control.');
      if(target.control === null && view.focusedControl() !== null) return stale('A native control still has focus.');
      apps[target.appId].ui.focused = target.control;
      return applied(target);
    },
    'win11.apps.scroll':async (target,payload) => {
      const view = viewFor(target.appId);
      if(!view) return unavailable();
      if(!view.areas().includes(target.area)) return stale('The scroll area is not currently rendered.');
      await tick();
      const offsets = view.scroll(target.area,payload.top,payload.left);
      if(!offsets) return unavailable();
      apps[target.appId].ui.scroll[target.area] = offsets;
      return applied(target,{offsets});
    },
    'win11.apps.scroll.observe':(target,payload) => {
      const view = viewFor(target.appId);
      if(!view) return unavailable();
      const actual = view.readScroll(target.area);
      if(!actual) return stale();
      if(Math.abs(actual.top-payload.top)>1 || Math.abs(actual.left-payload.left)>1) return invalid('Observed scroll must match real element offsets.');
      apps[target.appId].ui.scroll[target.area] = actual;
      return applied(target,{offsets:actual});
    },
  };
  for(const name of ['win11.apps.selection','win11.apps.selection.observe']) base[name] = async (target,payload) => {
    const view = viewFor(target.appId);
    if(!view) return unavailable();
    const control = validControl(view,target.control);
    if(!control?.editable) return stale('This current control does not support text selection.');
    if(payload.start>payload.end || payload.end>control.length) return invalid('Selection offsets exceed the current text.');
    if(name.endsWith('.observe')) { const actual = view.readSelection(target.control); if(!actual || actual.start!==payload.start || actual.end!==payload.end) return invalid('Observed selection must match real editable text.'); }
    else { focusWindow(target.appId); await tick(); if(!view.select(target.control,payload.start,payload.end)) return unavailable(); }
    apps[target.appId].ui.selection = {...target,...payload};
    return applied(target);
  };
  const handlers = {...base,...Object.assign({},...Object.values(appModules).map(module => module.createCommands(apps,context)))};
  // The schemas used for discovery are also the schemas enforced before reducers.
  return Object.fromEntries(Object.entries(handlers).map(([name,handler]) => [name,(target,payload) => {
    const spec = windows11AppSpecs[name];
    if(!spec || !conforms(target,spec[0]) || !conforms(payload,spec[1]) || (spec[4] && !conforms({target,payload},{allOf:spec[4]}))) return invalid();
    return handler(target,payload);
  }]));
}

import Desktop from './Windows11Desktop.svelte';
import Window from './Windows11Window.svelte';
import Applications from './Windows11Applications.svelte';
import { createWindows11ShellState } from './windows11-shell-state.js';
import { createWindows11ShellCommands, readWindows11ShellTargets } from './windows11-shell-commands.js';
import { createWindows11AppState, startWindows11AppClock, createWindows11AppWindow, releaseWindows11AppWindow, windows11AppsForWindow, canCreateWindows11AppWindow, readWindows11AppWindows } from './windows11-app-state.js';
import { createWindows11AppCommands, readWindows11AppTargets } from './windows11-app-commands.js';
import { fitNormalBounds as fitBounds } from './window-state.js';

function windowScale(app, area) {
  const gutter = area.width <= 520 ? 24 : 48;
  return Math.min(1, Math.max(1, area.width - gutter) / app.width, Math.max(1, area.height - 32) / app.height);
}

function fitNormalBounds(bounds, app, area) {
  return fitBounds(bounds, app, area, bounds.scale ? 1 : windowScale(app, area));
}

function initialBounds(app, area, windowCount = 0) {
  const offset = (windowCount % 6) * 24;
  return fitNormalBounds({ x: 80 + offset, y: 56 + offset }, app, area);
}

function prepareDocument() {
  document.documentElement.classList.remove('native-apple-font');
  document.documentElement.classList.toggle('native-windows-font', /Win/.test(navigator.platform));
}

function createSceneData() {
  return { native: { shell: createWindows11ShellState(), apps: createWindows11AppState() } };
}

function createCommands(native, context) {
  return {
    ...createWindows11ShellCommands(native.shell, context),
    ...createWindows11AppCommands(native.apps, context),
  };
}

function readTargets(native, context) {
  const shell = readWindows11ShellTargets(native.shell, context);
  return {
    desktopFiles: shell.desktop.files.map(({ id, name, appId }) => ({ fileId: id, name, appId })),
    native: { shell, apps: readWindows11AppTargets(native.apps, context) },
  };
}

async function requestClose(windowId, { window, invoke, closeWindow }) {
  if (window.appId === 'notepad') return invoke('win11.notepad.requestWindowClose', { windowId });
  await closeWindow(windowId);
  return { status: 'applied', target: { windowId } };
}

const nativeWindows = new WeakMap();
function nativeForWindow(native, windowId) {
  const apps = windows11AppsForWindow(native.apps, windowId);
  if (!apps) return null;
  let windows = nativeWindows.get(native);
  if (!windows) { windows = new Map(); nativeWindows.set(native, windows); }
  if (!windows.has(windowId)) windows.set(windowId, { shell: native.shell, apps, get applicationWindows() { return readWindows11AppWindows(native.apps); } });
  return windows.get(windowId);
}

function releaseWindow(native, windowId, appId) {
  releaseWindows11AppWindow(native.apps, windowId, appId);
  nativeWindows.get(native)?.delete(windowId);
}

function startScene(native, execute) {
  return startWindows11AppClock(native.apps, (command, target = {}, payload = {}) => execute({ command, target, payload }));
}

export const windows11Adapter = Object.freeze({
  Desktop, Window, Applications,
  expandedProperty: 'maximized',
  closeKeepsRunning: false,
  windowInteractionsAvailable: native => native.shell.dialog === null,
  prepareDocument, createSceneData, createCommands, readTargets,
  initialBounds, fitNormalBounds, requestClose, startScene,
  createWindow: (native, windowId, appId, options) => createWindows11AppWindow(native.apps, windowId, appId, options),
  releaseWindow, nativeForWindow,
  canCreateWindow: (native, appId) => canCreateWindows11AppWindow(native.apps, appId),
});

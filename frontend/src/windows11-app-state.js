import { createWindows11FileStore } from './windows11-files.js';
import * as explorer from './windows11-explorer.js';
import * as notepad from './windows11-notepad.js';
import * as calculator from './windows11-calculator.js';
import * as settings from './windows11-settings.js';
import * as edge from './windows11-edge.js';
import * as paint from './windows11-paint.js';
import * as photos from './windows11-photos.js';
import * as clock from './windows11-clock.js';
import * as snipping from './windows11-snipping.js';
import * as terminal from './windows11-terminal.js';
import * as teams from './windows11-teams.js';
export const appModules = { explorer, notepad, calculator, settings, edge, paint, photos, clock, snipping, terminal, teams };
export function createWindows11AppState(profile, completeSeed) {
  return { ...(completeSeed?.files ?? createWindows11FileStore()),
    ...Object.fromEntries(Object.entries(appModules).map(([id, module]) => [id, module.createState()])) };
}
const sharedAppIds = new Set(['settings', 'clock', 'snipping', 'teams']);
const windowSessions = new WeakMap();

function sessionsFor(apps) {
  let sessions = windowSessions.get(apps);
  if (!sessions) { sessions = new Map(); windowSessions.set(apps, sessions); }
  return sessions;
}

// Authorities are forwarded, not copied: replacements and file IDs remain shared.
function scopedApps(apps, appId, state) {
  const scoped = {};
  for (const key of ['files', 'nextFileId', ...Object.keys(appModules)]) {
    Object.defineProperty(scoped, key, {
      enumerable: true,
      get: () => key === appId ? state : apps[key],
      set: value => { if (key === appId) throw new Error('Window sessions cannot be replaced.'); apps[key] = value; },
    });
  }
  return scoped;
}

export function createWindows11AppWindow(apps, windowId, appId, { fresh = false } = {}) {
  const sessions = sessionsFor(apps);
  if (sessions.has(windowId)) throw new Error(`Window session already allocated: ${windowId}`);
  apps.windowSessions ||= {};
  apps.windowSessions[windowId] = sharedAppIds.has(appId) || !fresh ? apps[appId] : appModules[appId].createState();
  sessions.set(windowId, { appId, apps: scopedApps(apps, appId, apps.windowSessions[windowId]) });
}

export function releaseWindows11AppWindow(apps, windowId, appId) {
  const sessions = sessionsFor(apps), session = sessions.get(windowId);
  if (!session || session.appId !== appId) return false;
  const state = session.apps[appId];
  state.ui.menu = null; state.ui.dialog = null; state.ui.focused = null; state.ui.selection = null;
  if ('activeStrokeId' in state) state.activeStrokeId = null;
  if ('pointerId' in state) state.pointerId = null;
  if ('selectionAnchor' in state) state.selectionAnchor = null;
  apps[appId] = session.apps[appId];
  sessions.delete(windowId);
  delete apps.windowSessions[windowId];
  return true;
}

export function windows11AppsForWindow(apps, windowId) {
  return sessionsFor(apps).get(windowId)?.apps || null;
}

export function readWindows11AppWindows(apps) {
  const sessions = sessionsFor(apps);
  return Object.keys(apps.windowSessions || {}).map(windowId => ({ windowId, appId: sessions.get(windowId).appId }));
}

export function canCreateWindows11AppWindow(apps, appId) {
  return ![...sessionsFor(apps).values()].some(session => session.appId === appId &&
    (session.apps[appId].ui.dialog || session.apps[appId].pendingClose));
}
const savedSdkAppIds = new Set(['explorer', 'paint', 'teams']);
const isSavedSdkWindow = window => window.utilityKind
  ? window.appId === 'photos' && window.utilityKind === 'photos-svg'
  : savedSdkAppIds.has(window.appId);


export function snapshotWindows11SdkWindows(apps, windows) {
  const windows11SvgPhotos = {}, windows11SdkWindows = {};
  for (const window of windows) {
    if (!isSavedSdkWindow(window)) continue;
    const scoped = windows11AppsForWindow(apps, window.id);
    if (!scoped) throw new Error('The original SDK window has no owned model.');
    if (window.appId === 'photos' && window.utilityKind === 'photos-svg')
      windows11SvgPhotos[window.id] = scoped.photos;
    else windows11SdkWindows[window.id] = { appId: window.appId, state: scoped[window.appId] };
  }
  return { windows11SvgPhotos, windows11SdkWindows };
}

export function restoreWindows11SdkWindows(apps, windows, savedScene) {
  if (!savedScene) return;
  for (const window of windows) {
    if (!isSavedSdkWindow(window)) continue;
    const svg = window.appId === 'photos' && window.utilityKind === 'photos-svg';
    const entry = savedScene.windows11SdkWindows?.[window.id];
    const state = svg ? savedScene.windows11SvgPhotos?.[window.id] : entry?.appId === window.appId ? entry.state : null;
    if (!state) throw new Error('The saved SDK window has no original model.');
    createWindows11AppWindow(apps, window.id, window.appId, { fresh: true });
    Object.assign(windows11AppsForWindow(apps, window.id)[window.appId], state);
  }
}

// Scheduling supplies only deterministic single-second inputs; no host clock is read.
export function startWindows11AppClock(apps, invoke) {
  let disposed = false, pending = false;
  const timer = setInterval(async () => { if(disposed || pending || !clock.needsTicks(apps)) return; pending = true; try { await invoke('win11.clock.tick',{}, {seconds:1}); } finally { pending = false; } },1000);
  return () => { disposed = true; clearInterval(timer); };
}

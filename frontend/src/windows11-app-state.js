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
export const appModules = { explorer, notepad, calculator, settings, edge, paint, photos, clock, snipping, terminal };
const studio = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><defs><linearGradient id="wall" x2="0" y2="1"><stop stop-color="#d4dee8"/><stop offset="1" stop-color="#91a4bb"/></linearGradient></defs><rect width="640" height="400" fill="url(#wall)"/><rect y="290" width="640" height="110" fill="#69747e"/><rect x="92" y="55" width="202" height="171" fill="#edf7ff"/><path d="M193 55v171M92 140h202" stroke="#56677b" stroke-width="8"/><rect x="334" y="242" width="205" height="20" rx="3" fill="#755749"/><path d="M348 262v84m172-84v84" stroke="#4a3530" stroke-width="12"/><rect x="382" y="188" width="76" height="53" rx="4" fill="#1b2a3e"/><rect x="389" y="194" width="62" height="39" fill="#65a7cf"/><path d="M420 241v8" stroke="#1b2a3e" stroke-width="6"/><circle cx="565" cy="227" r="29" fill="#46766b"/><path d="M548 245h35l-8 49h-20z" fill="#af7959"/></svg>';
const coast = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#74b7d8"/><stop offset="1" stop-color="#e5eced"/></linearGradient></defs><rect width="640" height="400" fill="url(#sky)"/><circle cx="500" cy="78" r="35" fill="#fff7d7"/><path d="M0 178h640v222H0z" fill="#367995"/><path d="M0 282Q145 226 267 312T640 323v77H0z" fill="#dbc7a0"/><path d="M0 283Q145 227 267 313T640 324" stroke="#eff5ec" stroke-width="17" fill="none"/><path d="M0 151l85-41 89 68-174 65z" fill="#627c76"/><path d="M374 210h104m-310 26h81m234 38h124" stroke="#82b3c4" stroke-width="4" stroke-linecap="round"/></svg>';
export function createWindows11AppState() {
  const file = (id,parentId,name,kind,content='') => ({id,parentId,name,kind,content,deleted:false,revision:1});
  return { nextFileId:1, files:[file('root',null,'C:','folder'),file('desktop','root','Desktop','folder'),file('documents','root','Documents','folder'),file('pictures','root','Pictures','folder'),file('call-sheet','desktop','Call sheet.txt','text','CALL SHEET — TUESDAY, OCTOBER 31, 2023\n\nProduction: Northlight / Scene 06\nCrew call: 09:00\nLocation: Studio B\n\n09:41 — Desktop insert\n10:15 — Camera rehearsal\n11:00 — First take\n\nAll names and schedules in this scene are fictional.\n'),file('readme','documents','Welcome.txt','text','Welcome to this fictional Windows scene.\nFiles live only in this browser session.\nUse File Explorer, Notepad, Paint, Photos, Snipping Tool and Terminal with the same virtual folders.\n'),file('studio-photo','pictures','Studio.svg','image',studio),file('coast-photo','pictures','Coast.svg','image',coast)], ...Object.fromEntries(Object.entries(appModules).map(([id,module]) => [id,module.createState()])) };
}
const sharedAppIds = new Set(['settings', 'clock', 'snipping']);
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
  if (!session || session.appId !== appId) return;
  const state = session.apps[appId];
  state.ui.menu = null; state.ui.dialog = null; state.ui.focused = null; state.ui.selection = null;
  if ('activeStrokeId' in state) state.activeStrokeId = null;
  if ('pointerId' in state) state.pointerId = null;
  if ('selectionAnchor' in state) state.selectionAnchor = null;
  apps[appId] = session.apps[appId];
  sessions.delete(windowId);
  delete apps.windowSessions[windowId];
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

// Scheduling supplies only deterministic single-second inputs; no host clock is read.
export function startWindows11AppClock(apps, invoke) {
  let disposed = false, pending = false;
  const timer = setInterval(async () => { if(disposed || pending || !clock.needsTicks(apps)) return; pending = true; try { await invoke('win11.clock.tick',{}, {seconds:1}); } finally { pending = false; } },1000);
  return () => { disposed = true; clearInterval(timer); };
}

import { macDockFolderDefaults } from './mac-dock-folders.js';

export function macDockDefaults(profile) {
  const main = Object.values(profile.applications).filter(app => app.dock === 'main').map(app => app.id);
  const recent = Object.values(profile.applications).filter(app => app.dock === 'recent').map(app => app.id);
  const supportsRecent = profile.capabilities.includes('shell.dock-recents');
  return {
    pinnedAppIds: [...main], mainOrderAppIds: main,
    recentHistory: recent.map((appId, index) => ({ appId, sequence: recent.length - index })),
    usageSequence: recent.length, secondaryOrderItemIds: ['downloads'],
    preferences: { size: profile.renderer === 'sonoma' ? 53 : 55, magnification: false,
      magnificationSize: 96, autoHide: false, minimizeIntoApp: false, showRecent: supportsRecent },
    hover: null, focusedItemId: null, revealed: true, drag: null,
    context: null, appWindows: null,
    ...macDockFolderDefaults(),
  };
}

export function macDockApps(profile, state, runningAppIds) {
  const pinned = new Set(state.pinnedAppIds), running = new Set(runningAppIds);
  const recentIds = profile.capabilities.includes('shell.dock-recents') && state.preferences.showRecent
    ? state.recentHistory.filter(entry => Object.hasOwn(profile.applications, entry.appId) && !pinned.has(entry.appId)).slice(0, 3).map(entry => entry.appId) : [];
  const mainIds = state.mainOrderAppIds.filter(id => Object.hasOwn(profile.applications, id)
    && (pinned.has(id) || (running.has(id) && !recentIds.includes(id))));
  for (const id of runningAppIds) {
    if (Object.hasOwn(profile.applications, id) && !mainIds.includes(id) && !recentIds.includes(id)) mainIds.push(id);
  }
  return { main: mainIds.map(id => profile.applications[id]), recent: recentIds.map(id => profile.applications[id]) };
}

export function recordMacAppUse(state, appId) {
  state.usageSequence++;
  state.recentHistory = [{ appId, sequence: state.usageSequence }, ...state.recentHistory.filter(entry => entry.appId !== appId)];
}

export function macDockTiles(state, windows) {
  if (state.preferences.minimizeIntoApp || state.appWindows) return [];
  const minimized = windows.filter(window => window.minimized), byId = new Map(minimized.map(window => [`window:${window.id}`, window]));
  const result = state.secondaryOrderItemIds.filter(id => byId.has(id)).map(id => byId.get(id));
  for (const window of minimized) if (!state.secondaryOrderItemIds.includes(`window:${window.id}`)) result.push(window);
  return result;
}

export function macDockItems(profile, state, runningAppIds, windows, folders) {
  const apps = macDockApps(profile, state, runningAppIds), tiles = macDockTiles(state, windows);
  const applicationItems = [...apps.main, ...apps.recent].map(app => ({ itemId: `app:${app.id}`, appId: app.id, name: app.name, kind: 'app' }));
  const secondary = [...folders.map(folder => ({ itemId: folder.itemId, fileId: folder.fileId, name: folder.name, kind: 'folder' })),
    ...tiles.map(window => ({ itemId: `window:${window.id}`, windowId: window.id, appId: window.appId, name: window.title, kind: 'window' }))];
  const ordered = state.secondaryOrderItemIds.filter(id => secondary.some(item => item.itemId === id)).map(id => secondary.find(item => item.itemId === id));
  for (const item of secondary) if (!ordered.some(entry => entry.itemId === item.itemId)) ordered.push(item);
  return [...applicationItems, { itemId: 'separator', name: 'Dock options', kind: 'separator' }, ...ordered,
    { itemId: 'trash', name: 'Trash', kind: 'folder' }];
}

export function macDockContextItems(profile, state, windows, runningAppIds, activeWindowId, quittingAppIds, hiddenAppIds) {
  if (state.context?.kind === 'dock') return [
    { id: 'auto-hide', label: state.preferences.autoHide ? 'Turn Hiding Off' : 'Turn Hiding On', enabled: true },
    { id: 'magnification', label: state.preferences.magnification ? 'Turn Magnification Off' : 'Turn Magnification On', enabled: true },
    { id: 'dock-preferences', label: profile.renderer === 'sonoma' ? 'Dock Settings…' : 'Dock Preferences…', enabled: true, separatorBefore: true },
  ];
  const appId = state.context?.appId;
  if (!appId || !Object.hasOwn(profile.applications, appId)) return [];
  const app = profile.applications[appId], running = runningAppIds.includes(appId);
  const quitting = quittingAppIds.includes(appId), pinned = state.pinnedAppIds.includes(appId);
  const owned = windows.filter(window => window.appId === appId);
  const items = owned.map(window => ({ id: `window:${window.id}`, label: window.title,
    enabled: !quitting, checked: window.id === activeWindowId, minimized: window.minimized }));
  if (running || owned.length) items.push({ id: 'show-windows', label: 'Show All Windows', enabled: !quitting, separatorBefore: owned.length > 0 });
  items.push({ id: 'options', label: 'Options', enabled: !quitting, separatorBefore: items.length > 0, children: [
    { id: 'keep-in-dock', label: pinned ? 'Remove from Dock' : 'Keep in Dock', enabled: appId !== 'finder' && !quitting },
    { id: 'open-at-login', label: 'Open at Login', enabled: false },
    { id: 'show-in-finder', label: 'Show in Finder', enabled: !quitting, separatorBefore: true },
  ] });
  if (running) items.push({ id: 'hide', label: hiddenAppIds.includes(appId) ? 'Show' : 'Hide',
    enabled: !quitting && (hiddenAppIds.includes(appId)
      || runningAppIds.some(id => id !== appId && !quittingAppIds.includes(id))), separatorBefore: true },
    { id: 'quit', label: 'Quit', enabled: app.quitAllowed && !quitting });
  else items.push({ id: 'open', label: 'Open', enabled: !quitting, separatorBefore: true });
  return items;
}

// App Expose uses the original live window surfaces. Projection never mutates
// normal/minimized/restore geometry or creates another application view.
export function macDockWindowCards(windows, appId, area) {
  const owned = windows.filter(window => window.appId === appId);
  if (!owned.length) return [];
  const margin = Math.min(12, area.width / 20, area.height / 20);
  const header = Math.min(76, area.height / 3);
  const width = Math.max(1, area.width - margin * 2), height = Math.max(1, area.height - header - margin);
  const columns = Math.min(owned.length, Math.max(1, Math.ceil(Math.sqrt(owned.length * width / height))));
  const rows = Math.ceil(owned.length / columns), cellWidth = width / columns, cellHeight = height / rows;
  const gap = Math.min(12, cellWidth / 8, cellHeight / 8), labelHeight = Math.min(26, cellHeight / 3);
  return owned.map((window, index) => {
    const logicalWidth = window.bounds.width / window.bounds.scale, logicalHeight = window.bounds.height / window.bounds.scale;
    const scale = Math.min(window.bounds.scale, Math.max(1, cellWidth - gap * 2) / logicalWidth,
      Math.max(1, cellHeight - labelHeight - gap * 2) / logicalHeight);
    const cardWidth = logicalWidth * scale, cardHeight = logicalHeight * scale;
    const x = margin + (index % columns) * cellWidth, y = header + Math.floor(index / columns) * cellHeight;
    return { windowId: window.id, title: window.title, minimized: window.minimized,
      label: { x: x + gap, y: y + cellHeight - labelHeight - gap, width: cellWidth - gap * 2, height: labelHeight },
      rect: { x: x + (cellWidth - cardWidth) / 2, y: y + (cellHeight - labelHeight - gap - cardHeight) / 2,
        width: cardWidth, height: cardHeight, scale,
      },
    };
  });
}

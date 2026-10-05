<script>
  import { onMount, tick, untrack } from 'svelte';
  import { createFeatureCommands, rejected } from './feature-commands.js';
  import { createWindowCommands } from './window-commands.js';
  import { createApplicationCommands } from './application-commands.js';
  import { createDesktopCommands } from './desktop-commands.js';
  import { createDesktopItemCommands } from './desktop-item-commands.js';
  import { createMacDesktopFileStore, macDesktopItems, validMacDesktopName } from './desktop-file-state.js';
  import { createFileCommands, moveVirtualFiles } from './windows11-explorer.js';
  import { windows11DesktopFiles } from './windows11-shell-state.js';
  import { liveFile, isTrashed } from './windows11-app-helpers.js';
  import MacDesktopFolder from './MacDesktopFolder.svelte';
  import { createNotesCommands } from './notes-commands.js';
  import { commandCatalog } from './command-catalog.js';
  import { visibleNotes } from './notes-state.js';
  import { clampPosition, expandedBounds, resizeBounds, WINDOW_RESIZE_AXES } from './window-state.js';
  import { getOSProfile, listOSProfiles } from './os-profiles.js';

  let { profile: profileInput, adapter: adapterInput, registerCommands, selectProfile } = $props();
  // One immutable profile per scene instance. A profile change mounts a fresh
  // instance instead of relabeling incompatible application/view state.
  const profile = untrack(() => profileInput);
  const adapter = untrack(() => adapterInput);
  const { Desktop, Window, MessagesWindow, NotesWindow, Applications } = adapter;
  const { applications } = profile;
  const macDesktop = profile.family === 'macos';
  const expandedProperty = adapter.expandedProperty;
  const hasWindowMenu = profile.capabilities.includes('shell.window-menu');
  const hasWindowResize = profile.capabilities.includes('shell.window-resize');
  const resizeEdges = Object.keys(WINDOW_RESIZE_AXES);

  let windows = $state([]);
  let activeWindowId = $state(null);
  let activeAppId = $state(profile.defaults.desktopAppId);
  let runningAppIds = $state(adapter.closeKeepsRunning ? [profile.defaults.desktopAppId] : []);
  let pendingQuitAppIds = $state([]);
  const quitInFlight = new Set();
  let nextWindowId = 1;
  let disposed = false;
  let area = $state({ width: 0, height: 0 });
  // Application data outlives its window; close/minimize must not erase edits.
  const initialData = adapter.createSceneData();
  let notesState = $state(initialData.notes);
  let nativeState = $state(initialData.native);
  let macFiles = $state(macDesktop ? createMacDesktopFileStore(profile) : undefined);
  const desktopFileStore = macDesktop ? macFiles : nativeState.apps;
  const desktopFilePolicy = macDesktop ? { validateName: validMacDesktopName } : {};
  const desktopFileCommands = createFileCommands(desktopFileStore, desktopFilePolicy);
  let desktopState = $state({ selectedFileIds: [], selectionAnchorId: null, rename: null, marquee: null, positions: {}, focusedControl: null, ...(hasWindowMenu ? { windowMenuOpen: false, windowMenuItem: null, windowMenuScrollTop: 0 } : {}) });
  const desktopItems = $derived(getDesktopItems());
  let notesViewState = $state(initialData.notes ? { context: null, contextItem: null, focusedControl: null, scroll: { list: { top: 0, left: 0 }, editor: { top: 0, left: 0 } } } : undefined);
  let desktopView = null;
  let notesView = null;
  const applicationViews = new Map();
  let initialized = false;
  const activeApp = $derived(applications[activeAppId]);
  $effect(() => {
    const live = new Set(desktopItems.map(item => item.id));
    const state = macDesktop ? desktopState : nativeState.shell;
    if (state.selectedFileIds.some(id => !live.has(id))) state.selectedFileIds = state.selectedFileIds.filter(id => live.has(id));
    if (state.selectionAnchorId !== null && !live.has(state.selectionAnchorId)) state.selectionAnchorId = state.selectedFileIds.at(-1) ?? null;
    if (state.rename && !live.has(state.rename.fileId)) state.rename = null;
    for (const id of Object.keys(state.positions)) if (!live.has(id)) delete state.positions[id];
  });

  let handlers = {
    'scene.selectProfile': async (target, payload) => {
      if (Object.keys(target).some((key) => key !== 'profileId')
        || typeof target.profileId !== 'string' || !target.profileId
        || Object.keys(payload).length) {
        return rejected('invalid_arguments', 'scene.selectProfile requires target.profileId and no payload fields.');
      }
      const nextProfile = getOSProfile(target.profileId);
      if (!nextProfile) return rejected('unsupported_profile', 'The requested OS profile is not installed.');
      if (nextProfile.id !== profile.id) await selectProfile(nextProfile);
      return { status: 'applied', target: { profileId: nextProfile.id } };
    },
    ...createApplicationCommands(applications, {
      available: windowInteractionsAvailable,
      hasWorkspace: () => area.width > 0 && area.height > 0,
      hasWindow: appId => windows.some(window => window.appId === appId),
      isQuitting: appId => pendingQuitAppIds.includes(appId),
      canCreateWindow: appId => adapter.canCreateWindow?.(nativeState, appId) ?? true,
      open: openWindow, focusKeyboard: focusKeyboardWindow, quit: quitApplication,
    }),
    'desktop.refreshLayout': (target, payload) => {
      if (Object.keys(target).length || Object.keys(payload).length) {
        return rejected('invalid_arguments', 'desktop.refreshLayout takes no target or payload fields.');
      }
      if (!desktopView) return rejected('unavailable', 'The desktop is not mounted.');
      const bounds = desktopView.measureWorkspace();
      if (!bounds.width || !bounds.height) return rejected('unavailable', 'The workspace has no visible area.');
      layoutWindows(bounds);
      reconcileDesktopPositions(bounds);
      return { status: 'applied', target: {} };
    },
  };
  if (macDesktop) Object.assign(handlers, createDesktopItemCommands(desktopState, {
    getItems: getDesktopItems, getView: () => desktopView, available: windowInteractionsAvailable,
    focusDesktop, rename: renameDesktopItem, move: moveDesktopItems,
  }), {
    'desktop.folder.navigate': async (target, payload) => {
      if (Object.keys(target).some(key => !['windowId', 'folderId'].includes(key))
        || typeof target.windowId !== 'string' || typeof target.folderId !== 'string' || Object.keys(payload).length)
        return rejected('invalid_arguments', 'Use a live Finder windowId and folderId.');
      if (!windowInteractionsAvailable()) return rejected('unavailable', 'The desktop scene is unavailable.');
      const window = windows.find(entry => entry.id === target.windowId && entry.appId === 'finder');
      const folder = liveFile(macFiles, target.folderId);
      if (!window || !folder || folder.kind !== 'folder') return rejected('not_found', 'The Finder window or folder no longer exists.');
      window.folderId = folder.id; window.title = folder.name;
      const result = await handlers['window.focus']({ windowId: window.id }, {});
      return result.status === 'applied' ? { status: 'applied', target: { windowId: window.id, folderId: folder.id } } : result;
    },
  });
  Object.assign(handlers,
    createWindowCommands(() => windows, {
      focus: focusWindow, close: requestCloseWindow, minimize: minimizeWindow, expand: expandWindow, move: moveWindow,
      focusKeyboard: focusKeyboardWindow,
      available: windowInteractionsAvailable,
      resize: resizeWindow,
    }, expandedProperty),
    createDesktopCommands(desktopState, {
      getView: () => desktopView, getWindows: () => windows, getActiveWindowId: () => activeWindowId,
      getProfile: () => profile,
      getFiles: () => macDesktop ? macFiles.files.filter(file => !isTrashed(macFiles, file)) : getDesktopItems(),
      getItems: getDesktopItems,
      openedFile: (windowId, file) => {
        if (!macDesktop) return;
        const window = windows.find(window => window.id === windowId);
        if (file.kind === 'folder') window.folderId = file.id;
        else window.fileId = file.id;
      },
      focusDesktop,
      openApp: (target, payload) => handlers['app.open'](target, payload),
      windowAction: (command, target, payload) => handlers[command](target, payload),
    }),
  );
  if (notesState) Object.assign(handlers, createNotesCommands(notesState, notesViewState, {
    getView: () => notesView, focusWindow: () => focusWindow(windows.find(window => window.appId === 'notes').id),
    isVisible: () => windows.some((window) => window.appId === 'notes' && !window.minimized),
  }));
  if (adapter.createCommands) Object.assign(handlers, adapter.createCommands(nativeState, {
    native: nativeState,
    getDesktopView: () => desktopView,
    getApplicationView,
    getWindows: () => windows, getActiveWindowId: () => activeWindowId,
    getProfile: () => profile, focusDesktop, focusWindow, closeWindow, cancelAppQuit,
    getDesktopItems, renameDesktopItem, moveDesktopItems, windowInteractionsAvailable,
    invoke: (command, target = {}, payload = {}) => handlers[command](target, payload),
  }));
  for (const name of Object.keys(handlers)) {
    if (!Object.hasOwn(commandCatalog, name)) throw new Error(`Missing native command descriptor: ${name}`);
  }
  const sceneCatalog = Object.fromEntries(Object.entries(commandCatalog).filter(([, descriptor]) => descriptor.profiles.includes(profile.id)));
  // Composite callbacks capture this binding, so they use the same sealed,
  // capability-guarded registry after native profile selection.
  handlers = Object.fromEntries(Object.entries(handlers).filter(([name]) => Object.hasOwn(sceneCatalog, name)));
  const commands = createFeatureCommands(handlers,
    () => $state.snapshot({ profile, windows, activeWindowId, activeAppId, runningAppIds, pendingQuitAppIds, area, desktop: desktopState,
      ...(notesState ? { notes: notesState, notesView: notesViewState } : {}),
      ...(macFiles ? { files: macFiles.files } : {}),
      ...(nativeState ? { native: nativeState } : {}),
    }),
    settleCommands, sceneCatalog, () => ({
      profiles: listOSProfiles().map(({ id, name, family, version }) => ({ profileId: id, name, family, version })),
      applications: Object.values(applications).map(({ id, name, dock, taskbar, coverage, minimumSize, multipleWindows, quitAllowed }) => ({
        appId: id, name, coverage, minimumSize, multipleWindows, quitAllowed,
        running: runningAppIds.includes(id), active: activeAppId === id, quitting: pendingQuitAppIds.includes(id),
        windowIds: windows.filter(window => window.appId === id).map(window => window.id),
        ...(dock ? { dock } : {}), ...(taskbar ? { taskbar } : {}),
      })),
      desktopFiles: getDesktopItems().map(({ id, name, appId, folderId, renameable, movable }) => ({ fileId: id, name, appId, folderId, renameable, movable })),
      ...(macFiles ? { desktop: {
        selectedFileIds: [...desktopState.selectedFileIds], selectionAnchorId: desktopState.selectionAnchorId,
        rename: desktopState.rename ? { ...desktopState.rename } : null, marquee: desktopState.marquee ? { ...desktopState.marquee } : null,
        positions: Object.fromEntries(Object.entries(desktopState.positions).map(([id, value]) => [id, { ...value }])),
        locations: macFiles.files.filter(file => file.kind === 'folder' && !isTrashed(macFiles, file)).map(({ id, name, parentId }) => ({ folderId: id, name, parentId, dropAllowed: id !== 'trash' })),
        files: macFiles.files.filter(file => !isTrashed(macFiles, file)).map(({ id, name, parentId, kind }) => ({ fileId: id, name, parentId, kind })),
        itemBounds: desktopView?.itemRects() ?? [],
      } } : {}),
      windows: windows.map((window) => ({
        windowId: window.id, appId: window.appId, minimized: window.minimized, [expandedProperty]: window[expandedProperty],
        bounds: { ...window.bounds },
        ...(window.folderId ? { folderId: window.folderId } : {}),
        ...(window.fileId ? { fileId: window.fileId } : {}),
        resize: { available: hasWindowResize && !window.minimized && !window[expandedProperty] && windowInteractionsAvailable(), edges: resizeEdges, minimumSize: applications[window.appId].minimumSize },
      })),
      ...(hasWindowMenu ? { menus: [{ menuId: 'window', itemIds: ['close', 'minimize', 'zoom', ...windows.map(({ id }) => `window:${id}`)] }] } : {}),
      ...(notesState ? { notes: {
        records: notesState.notes.map(({ id, deleted }) => ({ noteId: id, deleted })),
        eligibleIds: visibleNotes(notesState).map(({ id }) => id),
      } } : {}),
      ...(adapter.readTargets ? adapter.readTargets(nativeState, { native: nativeState, getApplicationView, getDesktopView: () => desktopView, getDesktopItems, getWindows: () => windows, getProfile: () => profile }) : {}),
    }), () => profile, commandCatalog);

  async function settleCommands() {
    await tick();
    if (!disposed && desktopView && area.width && area.height && reconcileDesktopPositions(area)) await tick();
    // Focus, anchoring, editing and resizing can scroll before native scroll
    // events arrive. A completed command's snapshot must describe the live view.
    if (notesView) {
      for (const area of ['list', 'editor']) {
        const actual = notesView.scrollPosition(area);
        const previous = notesViewState.scroll[area];
        if (actual.top !== previous.top || actual.left !== previous.left) notesViewState.scroll[area] = actual;
      }
    }
    if (desktopView && hasWindowMenu) desktopState.windowMenuScrollTop = desktopView.windowMenuScrollTop();
  }

  function registerDesktopView(view) {
    desktopView = view;
    return () => { if (desktopView === view) desktopView = null; };
  }

  function registerNotesView(view) {
    notesView = view;
    return () => { if (notesView === view) notesView = null; };
  }

  function registerApplicationView(windowId, view) {
    applicationViews.set(windowId, view);
    return () => { if (applicationViews.get(windowId) === view) applicationViews.delete(windowId); };
  }

  function windowInteractionsAvailable() {
    return !disposed && (adapter.windowInteractionsAvailable?.(nativeState) ?? true);
  }

  function getApplicationView(windowId) {
    if (!windowInteractionsAvailable()) return undefined;
    return windows.some(window => window.id === windowId && !window.minimized)
      ? applicationViews.get(windowId)
      : undefined;
  }

  async function focusKeyboardWindow(id) {
    await tick();
    [...document.querySelectorAll('[data-window-id]')].find((element) => element.dataset.windowId === id)?.focus({ preventScroll: true });
  }

  function getDesktopItems() {
    if (macDesktop) return macDesktopItems(macFiles);
    const items = windows11DesktopFiles(profile, nativeState.apps);
    return nativeState.shell.sortByName ? items.sort((a, b) => a.name.localeCompare(b.name)) : items;
  }

  // A native layout slot can shift when a preceding file leaves the desktop.
  // Keep explicitly placed icons at their physical point, not at the new slot.
  function reconcileDesktopPositions(bounds) {
    const positions = macDesktop ? desktopState.positions : nativeState.shell.positions;
    let placed = false;
    for (const fileId in positions) { placed = true; break; }
    if (!placed) return false;
    let changed = false;
    for (const rect of desktopView.itemRects()) {
      const previous = positions[rect.fileId];
      if (!previous) continue;
      const originX = rect.x - previous.x, originY = rect.y - previous.y;
      const desiredX = Math.max(0, Math.min(previous.originX + previous.x, Math.max(0, bounds.width - rect.width)));
      const desiredY = Math.max(0, Math.min(previous.originY + previous.y, Math.max(0, bounds.height - rect.height)));
      const x = desiredX - originX, y = desiredY - originY;
      if (Math.abs(x - previous.x) > .01 || Math.abs(y - previous.y) > .01
        || Math.abs(originX - previous.originX) > .01 || Math.abs(originY - previous.originY) > .01) {
        positions[rect.fileId] = { x, y, originX, originY };
        changed = true;
      }
    }
    return changed;
  }

  function renameDesktopItem(fileId, name) {
    const result = desktopFileCommands['win11.files.rename']({ fileId }, { name });
    if (result.status === 'applied' && macDesktop)
      for (const window of windows) if (window.folderId === fileId || window.fileId === fileId) window.title = liveFile(macFiles, fileId).name;
    return result;
  }

  function moveDesktopItems(fileIds, folderId) {
    if (macDesktop && folderId === 'trash') return rejected('disabled', 'Trash deletion and restoration belong to the simulated filesystem lifecycle; this desktop slice moves to ordinary folders only.');
    const moves = fileIds.map(fileId => ({ fileId, name: liveFile(desktopFileStore, fileId)?.name }));
    return moveVirtualFiles(desktopFileStore, moves, folderId, desktopFilePolicy.validateName);
  }
  function focusDesktop() {
    activeWindowId = null;
    activeAppId = profile.defaults.desktopAppId;
    if (hasWindowMenu) {
      desktopState.windowMenuOpen = false;
      desktopState.windowMenuItem = null;
    }
    if (notesViewState) clearNotesPresentation();
    if (document.activeElement?.closest('[data-window-id]')) document.activeElement.blur();
  }

  function windowCommand(command, id, payload = {}) {
    return commands.execute({ command, target: { windowId: id }, payload });
  }

  function toggleWindowZoom(id) {
    const window = windows.find((entry) => entry.id === id);
    return windowCommand('window.setZoomed', id, { zoomed: !window?.zoomed });
  }

  function toggleWindowMaximize(id) {
    const window = windows.find((entry) => entry.id === id);
    return windowCommand('window.setMaximized', id, { maximized: !window?.maximized });
  }

  onMount(() => {
    const unregister = registerCommands(commands);
    const stopScene = adapter.startScene?.(nativeState, commands.execute);
    return () => { disposed = true; stopScene?.(); unregister(); };
  });


  function focusWindow(id) {
    const index = windows.findIndex((window) => window.id === id);
    if (index < 0) return;
    const window = windows[index];
    window.minimized = false;
    if (index !== windows.length - 1) {
      windows.splice(index, 1);
      windows.push(window);
    }
    activeWindowId = id;
    activeAppId = window.appId;
    if (hasWindowMenu) {
      desktopState.windowMenuOpen = false;
      desktopState.windowMenuItem = null;
      desktopState.focusedControl = null;
    }
    if (window.appId !== 'notes' && notesViewState) clearNotesPresentation();
  }

  function openWindow(appId, title, fresh = false) {
    const app = applications[appId];
    const existing = !fresh && windows.findLast(window => window.appId === appId);
    if (existing) {
      if (title !== undefined) existing.title = title;
      focusWindow(existing.id);
      return existing.id;
    }
    const id = nextWindowId === 1 && appId === profile.defaults.startupAppId
      ? appId : `${appId}-window-${nextWindowId}`;
    nextWindowId++;
    adapter.createWindow?.(nativeState, id, appId, { fresh });
    windows.push({
      id, appId, title: title ?? app.name,
      minimized: false, [expandedProperty]: false,
      bounds: adapter.initialBounds(app, area, windows.length, globalThis.innerHeight),
      restoreBounds: null,
      ...(macDesktop && appId === 'finder' ? { folderId: 'desktop' } : {}),
    });
    if (!runningAppIds.includes(appId)) runningAppIds.push(appId);
    activeWindowId = id;
    activeAppId = appId;
    return id;
  }

  function focusRemaining() {
    const remaining = windows.findLast(window => !window.minimized
      && (!adapter.closeKeepsRunning || window.appId === activeAppId));
    activeWindowId = remaining?.id ?? null;
    if (remaining) activeAppId = remaining.appId;
    else if (!runningAppIds.includes(activeAppId)) activeAppId = profile.defaults.desktopAppId;
  }


  async function requestCloseWindow(id) {
    const window = windows.find(entry => entry.id === id);
    if (adapter.requestClose) {
      const result = await adapter.requestClose(id, {
        window, invoke: (command, target = {}, payload = {}) => handlers[command](target, payload),
        closeWindow,
      });
      return result.status === 'applied'
        ? { ...result, target: { windowId: id, appId: window.appId } }
        : result;
    }
    await closeWindow(id);
  }

  async function closeWindow(id) {
    const index = windows.findIndex(window => window.id === id);
    if (index < 0) return;
    const appId = windows[index].appId;
    windows.splice(index, 1);
    adapter.releaseWindow?.(nativeState, id, appId);
    if (!adapter.closeKeepsRunning && !windows.some(window => window.appId === appId)) {
      runningAppIds = runningAppIds.filter(entry => entry !== appId);
    }
    if (activeWindowId === id) focusRemaining();
    if (hasWindowMenu) {
      desktopState.windowMenuOpen = false;
      desktopState.windowMenuItem = null;
    }
    if (appId === 'notes') clearNotesPresentation();
    if (!disposed && pendingQuitAppIds.includes(appId) && !quitInFlight.has(appId)) {
      await handlers['app.quit']({ appId }, {});
    }
  }

  function cancelAppQuit(appId) {
    pendingQuitAppIds = pendingQuitAppIds.filter(entry => entry !== appId);
  }

  async function quitApplication(appId) {
    if (quitInFlight.has(appId)) return rejected('unavailable', 'Application quit is already being processed.');
    if (!pendingQuitAppIds.includes(appId)) pendingQuitAppIds.push(appId);
    quitInFlight.add(appId);
    try {
      let window;
      while (!disposed && (window = windows.findLast(entry => entry.appId === appId))) {
        const result = await handlers['window.close']({ windowId: window.id }, {});
        if (result?.status === 'rejected') {
          cancelAppQuit(appId);
          return result;
        }
        if (windows.some(entry => entry.id === window.id)) {
          if (result.confirmationRequired !== true) throw new Error('Native close applied without removing its window or presenting confirmation.');
          return { status: 'applied', target: { appId }, quit: false, confirmationRequired: true };
        }
      }
      if (disposed) return rejected('unavailable', 'The outgoing scene has been disposed.');
      runningAppIds = runningAppIds.filter(entry => entry !== appId);
      if (activeAppId === appId) {
        const remaining = windows.findLast(window => !window.minimized);
        activeWindowId = remaining?.id ?? null;
        activeAppId = remaining?.appId ?? profile.defaults.desktopAppId;
      }
      cancelAppQuit(appId);
      return { status: 'applied', target: { appId }, quit: true, confirmationRequired: false };
    } finally {
      quitInFlight.delete(appId);
    }
  }

  function minimizeWindow(id) {
    const window = windows.find((window) => window.id === id);
    if (!window) return;
    window.minimized = true;
    if (activeWindowId === id) focusRemaining();
    if (hasWindowMenu) {
      desktopState.windowMenuOpen = false;
      desktopState.windowMenuItem = null;
    }
    if (window.appId === 'notes') clearNotesPresentation();
  }

  function expandWindow(id) {
    const window = windows.find((window) => window.id === id);
    if (!window) return;
    focusWindow(id);
    if (window[expandedProperty]) {
      // Viewport changes already refit restoreBounds; restore the user's geometry.
      window.bounds = window.restoreBounds;
      window.restoreBounds = null;
      window[expandedProperty] = false;
    } else {
      window.restoreBounds = window.bounds;
      window.bounds = expandedBounds(window.restoreBounds, area);
      window[expandedProperty] = true;
    }
  }

  function moveWindow(id, x, y) {
    const window = windows.find((window) => window.id === id);
    if (window && !window[expandedProperty]) window.bounds = clampPosition({ ...window.bounds, x, y }, area);
  }

  function resizeWindow(id, edge, coordinates) {
    const window = windows.find((entry) => entry.id === id);
    window.bounds = resizeBounds(window.bounds, edge, coordinates, applications[window.appId].minimumSize, area);
  }

  function clearNotesPresentation() {
    notesViewState.context = null;
    notesViewState.contextItem = null;
    notesViewState.focusedControl = null;
  }

  function layoutWindows(nextArea) {
    if (nextArea.width <= 0 || nextArea.height <= 0) return;
    if (initialized && nextArea.width === area.width && nextArea.height === area.height) return;
    area = nextArea;
    for (const window of windows) {
      const normal = adapter.fitNormalBounds(window[expandedProperty] ? window.restoreBounds : window.bounds, applications[window.appId], area);
      if (window[expandedProperty]) {
        window.restoreBounds = normal;
        window.bounds = expandedBounds(normal, area);
      } else {
        window.bounds = normal;
      }
    }
    if (!initialized) {
      initialized = true;
      handlers['app.open']({ appId: profile.defaults.startupAppId }, {});
    }
  }
</script>

<Desktop
  {profile}
  {windows}
  {runningAppIds}
  {activeWindowId}
  {activeApp}
  viewState={desktopState}
  {desktopItems}
  native={nativeState}
  execute={commands.execute}
  registerView={registerDesktopView}
  onlayout={() => commands.execute({ command: 'desktop.refreshLayout' })}
>
  {#each windows as window, index (window.id)}
    {#if !window.minimized}
      <Window
        {window}
        active={activeWindowId === window.id}
        zIndex={index + 1}
        onfocus={() => windowCommand('window.focus', window.id, { keyboard: false })}
        onclose={() => windowCommand('window.close', window.id)}
        onminimize={() => windowCommand('window.setMinimized', window.id, { minimized: true })}
        onzoom={() => toggleWindowZoom(window.id)}
        onmaximize={() => toggleWindowMaximize(window.id)}
        onmove={(x, y) => windowCommand('window.move', window.id, { x, y })}
        resizable={hasWindowResize && !window[expandedProperty] && windowInteractionsAvailable()}
        onresize={(edge, coordinates) => windowCommand('window.resize', window.id, { edge, ...coordinates })}
      >
        {#if Applications}
          <Applications appId={window.appId} windowId={window.id} {profile} native={adapter.nativeForWindow(nativeState, window.id)} execute={commands.execute} registerView={registerApplicationView} />
        {:else if window.appId === 'messages'}
          <MessagesWindow
            assets={profile.assets}
            active={activeWindowId === window.id}
            zoomed={window.zoomed}
            onclose={() => windowCommand('window.close', window.id)}
            onminimize={() => windowCommand('window.setMinimized', window.id, { minimized: true })}
            onzoom={() => toggleWindowZoom(window.id)}
          />
        {:else if window.appId === 'notes'}
          <NotesWindow
            state={notesState}
            viewState={notesViewState}
            execute={commands.execute}
            registerView={registerNotesView}
            active={activeWindowId === window.id}
            zoomed={window.zoomed}
            onclose={() => windowCommand('window.close', window.id)}
            onminimize={() => windowCommand('window.setMinimized', window.id, { minimized: true })}
            onzoom={() => toggleWindowZoom(window.id)}
          />
        {:else if macDesktop && window.appId === 'finder'}
          <MacDesktopFolder {profile} windowId={window.id} folderId={window.folderId} files={macFiles.files} execute={commands.execute} />
        {/if}
      </Window>
    {/if}
  {/each}
</Desktop>

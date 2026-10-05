<script>
  import { onMount, tick, untrack } from 'svelte';
  import { createFeatureCommands, rejected } from './feature-commands.js';
  import { createWindowCommands } from './window-commands.js';
  import { createApplicationCommands } from './application-commands.js';
  import { applicationSwitchingDefaults, recordApplicationActivation, reconcileApplicationSwitching,
    applicationSwitcherItems, applicationMenuItems, createApplicationSwitchingCommands } from './application-switching.js';
  import ApplicationSwitcher from './ApplicationSwitcher.svelte';
  import MacApplicationMenu from './MacApplicationMenu.svelte';
  import { createDesktopCommands } from './desktop-commands.js';
  import { createDesktopItemCommands } from './desktop-item-commands.js';
  import { createDesktopContextCommands } from './desktop-context-commands.js';
  import { createDesktopStacksCommands } from './desktop-stacks-commands.js';
  import { desktopStacks as buildDesktopStacks, desktopStackLayout, desktopStacksDefaults, reconcileDesktopStacks } from './desktop-stacks-model.js';
  import { desktopViewDefaults, desktopContextItems, sortDesktopItems, readDesktopFileInfo, desktopFileSize } from './desktop-context-model.js';
  import { createMacDesktopFileStore, macDesktopItems, validMacDesktopName, nextMacFileTimestamp } from './desktop-file-state.js';
  import { createMacDockCommands } from './mac-dock-commands.js';
  import { macDockDefaults, macDockApps, macDockContextItems, macDockWindowCards, macDockItems, macDockTiles, recordMacAppUse } from './mac-dock-model.js';
  import { createMacApplicationFiles, applicationBundleId } from './mac-application-files.js';
  import MacDockAppWindows from './MacDockAppWindows.svelte';
  import MacDockPreferences from './MacDockPreferences.svelte';
  import MacDockStack from './MacDockStack.svelte';
  import { createMacDockFolderCommands, dockFolderItemId, folderSource, macDockFolders, macDockFolderContextItems,
    macDockStackItems, macDockStackView, reconcileMacDockFolders } from './mac-dock-folders.js';
  import { createFileCommands, moveVirtualFiles, trashVirtualFiles } from './windows11-explorer.js';
  import { windows11DesktopFiles } from './windows11-shell-state.js';
  import { liveFile, isTrashed } from './windows11-app-helpers.js';
  import MacDesktopFolder from './MacDesktopFolder.svelte';
  import MacDesktopInfo from './MacDesktopInfo.svelte';
  import MacDesktopViewOptions from './MacDesktopViewOptions.svelte';
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
  const hasDesktopStacks = profile.capabilities.includes('shell.desktop-stacks');
  const hasDockContext = profile.capabilities.includes('shell.dock-context');
  const resizeEdges = Object.keys(WINDOW_RESIZE_AXES);
  const desktopUtilityApps = macDesktop ? {
    'desktop-info': { ...applications.finder, width: 360, height: 560, minimumSize: { width: 300, height: 300 } },
    'desktop-view-options': { ...applications.finder, width: 384, height: 500, minimumSize: { width: 360, height: 340 } },
  } : {};

  let windows = $state([]);
  let activeWindowId = $state(null);
  let activeAppId = $state(profile.defaults.desktopAppId);
  let runningAppIds = $state(adapter.closeKeepsRunning ? [profile.defaults.desktopAppId] : []);
  let pendingQuitAppIds = $state([]);
  const quitInFlight = new Set();
  let switching = $state(applicationSwitchingDefaults());
  let switcherControls = $state();
  let applicationMenuControls = $state();
  let switcherPreviewSlots = $state({});
  let applicationMenuAnchor = $state(null);
  let switchingReturnFocus = null;
  let switchingReturnFocusIdentity = null;
  const switcherItems = $derived(applicationSwitcherItems(switching, profile, runningAppIds, windows, pendingQuitAppIds));
  const appMenuItems = $derived(switching.appMenu
    ? applicationMenuItems(switching, profile, switching.appMenu.appId, runningAppIds, pendingQuitAppIds) : []);
  const switcherWindowBounds = $derived.by(() => {
    if (switching.switcher?.kind !== 'windows') return {};
    const projections = {};
    for (const item of switcherItems) {
      const slot = switcherPreviewSlots[item.windowId];
      const window = windows.find(window => window.id === item.windowId);
      if (!slot || !window || slot.width <= 0 || slot.height <= 0) continue;
      const logicalWidth = window.bounds.width / window.bounds.scale;
      const logicalHeight = window.bounds.height / window.bounds.scale;
      const scale = Math.min(window.bounds.scale, slot.width / logicalWidth, slot.height / logicalHeight);
      const width = logicalWidth * scale, height = logicalHeight * scale;
      projections[window.id] = { x: slot.x + (slot.width - width) / 2, y: slot.y + (slot.height - height) / 2, width, height, scale };
    }
    return projections;
  });
  $effect(() => {
    reconcileApplicationSwitching(switching, profile, runningAppIds, windows, pendingQuitAppIds);
  });
  $effect(() => {
    const menu = switching.appMenu;
    activeAppId; area.width; area.height;
    if (!menu) { applicationMenuAnchor = null; return; }
    let cancelled = false;
    tick().then(() => {
      if (cancelled || switching.appMenu !== menu) return;
      applicationMenuAnchor = applicationHeaderRect(menu.appId);
    });
    return () => { cancelled = true; };
  });
  let nextWindowId = 1;
  let disposed = false;
  let area = $state({ width: 0, height: 0 });
  // Application data outlives its window; close/minimize must not erase edits.
  const initialData = adapter.createSceneData();
  let notesState = $state(initialData.notes);
  let nativeState = $state(initialData.native);
  let macFiles = $state(macDesktop ? createMacSceneFiles() : undefined);
  const desktopFileStore = macDesktop ? macFiles : nativeState.apps;
  const desktopFilePolicy = macDesktop ? { validateName: validMacDesktopName } : {};
  const desktopFileCommands = createFileCommands(desktopFileStore, desktopFilePolicy);
  let desktopState = $state({ selectedFileIds: [], selectionAnchorId: null, rename: null, marquee: null, positions: {},
    context: null, sortBy: 'none', viewOptions: desktopViewDefaults(profile.family, profile.renderer),
    focusedControl: null, ...(hasDesktopStacks ? { stacks: desktopStacksDefaults() } : {}),
    ...(hasDockContext ? { dock: macDockDefaults(profile) } : {}),
    ...(hasWindowMenu ? { windowMenuOpen: false, windowMenuItem: null, windowMenuScrollTop: 0 } : {}) });
  const desktopItems = $derived(getDesktopItems());
  const desktopDetails = $derived(getDesktopDetails());
  const desktopStacks = $derived(getDesktopStacks());
  const dockApplications = $derived(hasDockContext ? macDockApps(profile, desktopState.dock, runningAppIds) : undefined);
  const dockMenuItems = $derived(hasDockContext ? getDockMenuItems() : []);
  const dockWindowCards = $derived(desktopState.dock?.appWindows ? macDockWindowCards(windows, desktopState.dock.appWindows.appId, area) : []);
  const dockWindowBounds = $derived(Object.fromEntries(dockWindowCards.map(card => [card.windowId, card.rect])));
  const dockTiles = $derived(hasDockContext ? macDockTiles(desktopState.dock, windows) : []);
  const dockFolders = $derived(hasDockContext ? macDockFolders(desktopState.dock, macFiles) : []);
  const dockStackItems = $derived(hasDockContext ? macDockStackItems(desktopState.dock, macFiles) : []);
  const dockStackView = $derived(desktopState.dock?.folderStack ? macDockStackView(desktopState.dock, macFiles) : null);
  const dockStackFolder = $derived(desktopState.dock?.folderStack ? liveFile(macFiles, desktopState.dock.folderStack.folderId) : null);
  const dockTrash = $derived.by(() => {
    const fileIds = macDesktop ? macFiles.files.filter(file => file.deleted).map(file => file.id) : [];
    return { empty: fileIds.length === 0, count: fileIds.length, fileIds };
  });
  $effect(() => {
    if (!hasDockContext) return;
    const dock = desktopState.dock, mainIds = new Set(dockApplications.main.map(app => app.id));
    reconcileMacDockFolders(dock, macFiles);
    const order = dock.mainOrderAppIds.filter(id => mainIds.has(id));
    for (const app of dockApplications.main) if (!order.includes(app.id)) order.push(app.id);
    if (order.length !== dock.mainOrderAppIds.length || order.some((id, index) => id !== dock.mainOrderAppIds[index]))
      dock.mainOrderAppIds = order;
    const secondaryIds = [...dockFolders.map(folder => folder.itemId), ...windows.filter(window => window.minimized).map(window => `window:${window.id}`)];
    const secondaryOrder = dock.secondaryOrderItemIds.filter(id => secondaryIds.includes(id));
    for (const id of secondaryIds) if (!secondaryOrder.includes(id)) secondaryOrder.push(id);
    if (secondaryOrder.length !== dock.secondaryOrderItemIds.length || secondaryOrder.some((id, index) => id !== dock.secondaryOrderItemIds[index]))
      dock.secondaryOrderItemIds = secondaryOrder;
    const itemIds = new Set(macDockItems(profile, dock, runningAppIds, windows, dockFolders).map(item => item.itemId));
    if (dock.hover && !itemIds.has(dock.hover.itemId)) dock.hover = null;
    if (dock.focusedItemId && !itemIds.has(dock.focusedItemId)) dock.focusedItemId = null;
    if (dock.context?.kind === 'app' && ![...dockApplications.main, ...dockApplications.recent].some(app => app.id === dock.context.appId)) dock.context = null;
    if (dock.context?.kind === 'folder' && !dockFolders.some(folder => folder.itemId === dock.context.dockItemId)) dock.context = null;
    const menu = dock.context;
    if (menu && menu.itemId && !getDockMenuItems().flatMap(item => [item, ...(item.children ?? [])]).some(item => item.id === menu.itemId && item.enabled)) {
      const entry = getDockMenuItems().find(item => item.enabled);
      menu.itemId = entry?.id ?? null; menu.submenuId = null;
      tick().then(() => { if (dock.context === menu) desktopView?.focusDockMenuItem(menu.itemId); });
    }
    if (dock.appWindows?.selectedWindowId && !windows.some(window => window.id === dock.appWindows.selectedWindowId && window.appId === dock.appWindows.appId)) {
      dock.appWindows.selectedWindowId = windows.find(window => window.appId === dock.appWindows.appId)?.id ?? null;
    }
  });
  let notesViewState = $state(initialData.notes ? { context: null, contextItem: null, focusedControl: null, scroll: { list: { top: 0, left: 0 }, editor: { top: 0, left: 0 } } } : undefined);
  let desktopView = null;
  let dockStackControls = $state();
  let dockStackAnchor = $state(null);
  const dockFolderView = {
    dockAvailable: () => desktopView?.dockAvailable() ?? false,
    prepareDock: () => desktopView?.prepareDock(),
    dockItemAnchor: itemId => desktopView?.dockItemAnchor(itemId) ?? null,
    focusDockStackItem: async itemId => { await tick(); return dockStackControls?.focus(itemId) ?? false; },
    dockStackItemIds: () => dockStackControls?.itemIds() ?? [],
    dockStackBounds: () => dockStackControls?.bounds() ?? null,
    scrollDockStack: (top, left) => dockStackControls?.scroll(top, left) ?? null,
    dockStackScrollPosition: () => dockStackControls?.scrollPosition() ?? null,
  };
  $effect(() => {
    const stack = desktopState.dock?.folderStack;
    if (!stack) { dockStackAnchor = null; return; }
    area.width; area.height; dockFolders; dockTiles; dockApplications;
    desktopState.dock.preferences.size; desktopState.dock.preferences.magnification;
    desktopState.dock.preferences.magnificationSize; desktopState.dock.hover;
    tick().then(() => {
      if (disposed || desktopState.dock?.folderStack !== stack) return;
      const point = desktopView?.dockItemAnchor(dockFolderItemId(stack.rootFileId));
      if (point && (dockStackAnchor?.x !== point.x || dockStackAnchor?.y !== point.y)) dockStackAnchor = point;
    });
  });
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
    if (state.context?.fileId && !live.has(state.context.fileId)) state.context = null;
    if (hasDesktopStacks) reconcileDesktopStacks(desktopState.stacks, desktopStacks);
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
      reconcileDesktopContext();
      return { status: 'applied', target: {} };
    },
  };
  if (macDesktop) Object.assign(handlers, createDesktopItemCommands(desktopState, {
    getItems: getDesktopItems, getView: () => desktopView, available: windowInteractionsAvailable,
    getRangeItems: () => desktopState.stacks?.enabled ? getVisibleDesktopItems(true) : getDesktopItems(),
    getSelectionRects: getDesktopSelectionRects,
    focusDesktop, revealItem: revealDesktopFile, rename: renameDesktopItem, move: moveDesktopItems,
  }), createDesktopContextCommands(desktopState, {
    getItems: getDesktopItems, getView: () => desktopView, available: windowInteractionsAvailable,
    focusDesktop, invoke: (command, target, payload) => handlers[command](target, payload),
    createFolder: createDesktopFolder, trash: trashDesktopItems,
    openInfo: fileId => openDesktopUtility('desktop-info', fileId),
    openView: () => openDesktopUtility('desktop-view-options'),
  }), {
    'desktop.info.section': (target, payload) => {
      if (Object.keys(target).some(key => !['windowId', 'sectionId'].includes(key))
        || typeof target.windowId !== 'string' || !['general', 'name'].includes(target.sectionId)
        || Object.keys(payload).some(key => key !== 'open') || typeof payload.open !== 'boolean')
        return rejected('invalid_arguments', 'Use a live Get Info window, sectionId and boolean open.');
      if (!windowInteractionsAvailable()) return rejected('unavailable', 'The scene is unavailable.');
      const window = windows.find(window => window.id === target.windowId && window.utilityKind === 'desktop-info');
      if (!window) return rejected('not_found', 'The Get Info window no longer exists.');
      window.infoSections[target.sectionId] = payload.open;
      return { status: 'applied', target: { windowId: window.id, sectionId: target.sectionId } };
    },
    'desktop.folder.navigate': async (target, payload) => {
      if (Object.keys(target).some(key => !['windowId', 'folderId'].includes(key))
        || typeof target.windowId !== 'string' || typeof target.folderId !== 'string' || Object.keys(payload).length)
        return rejected('invalid_arguments', 'Use a live Finder windowId and folderId.');
      if (!windowInteractionsAvailable()) return rejected('unavailable', 'The desktop scene is unavailable.');
      const window = windows.find(entry => entry.id === target.windowId && entry.appId === 'finder' && !entry.utilityKind);
      const folder = liveFile(macFiles, target.folderId);
      if (!window || !folder || folder.kind !== 'folder') return rejected('not_found', 'The Finder window or folder no longer exists.');
      window.folderId = folder.id; window.title = folder.name;
      window.finderSelectedFileIds = [];
      const result = await handlers['window.focus']({ windowId: window.id }, {});
      return result.status === 'applied' ? { status: 'applied', target: { windowId: window.id, folderId: folder.id } } : result;
    },
  });
  if (hasDesktopStacks) Object.assign(handlers, createDesktopStacksCommands(desktopState, {
    getGroups: getDesktopStacks, getView: () => desktopView, available: windowInteractionsAvailable,
    focusDesktop, invoke: (command, target, payload) => handlers[command](target, payload),
  }));
  if (hasDockContext) Object.assign(handlers, createMacDockCommands(desktopState, {
    profile, available: sceneInteractionsAvailable, getView: () => desktopView,
    getItems: getDockMenuItems, getDockApps: () => [...dockApplications.main, ...dockApplications.recent],
    getWindows: () => windows, getActiveWindowId: () => activeWindowId,
    getDockItems: () => macDockItems(profile, desktopState.dock, runningAppIds, windows, dockFolders),
    getDockSections: () => dockApplications,
    hasBundle: appId => !!liveFile(macFiles, applicationBundleId(appId)),
    getFolderSource: itemId => folderSource(macFiles, itemId),
    openPreferences: openDockPreferences,
    invoke: (command, target, payload) => handlers[command](target, payload),
    reveal: revealMacApplication, focusDock, restoreOverviewFocus,
    isQuitting: appId => pendingQuitAppIds.includes(appId), isHidden: isAppHidden,
    dismissAppMenus: clearNotesPresentation,
  }));
  if (hasDockContext) Object.assign(handlers, createMacDockFolderCommands(desktopState, {
    getStore: () => macFiles, available: sceneInteractionsAvailable, getView: () => dockFolderView,
    invoke: (command, target, payload) => handlers[command](target, payload),
    dismissMenus: () => {
      desktopState.context = null; desktopState.rename = null;
      desktopState.windowMenuOpen = false; desktopState.windowMenuItem = null;
      desktopState.dock.context = null; desktopState.dock.appWindows = null;
      if (desktopState.stacks) desktopState.stacks.focusedStackId = null;
      clearNotesPresentation();
    },
  }));
  const switchingView = {
    prepare: async () => { await tick(); await tick(); },
    available: () => Boolean(desktopView && sceneInteractionsAvailable() && area.width > 0 && area.height > 0),
    focus: itemId => switcherControls?.focus(itemId) ?? false,
    focusedItemId: () => document.activeElement?.closest('[data-shell-switcher]') ? document.activeElement.dataset.switcherItemKey ?? null : null,
    itemIds: () => switcherControls?.itemIds() ?? [],
    bounds: () => switcherControls?.bounds() ?? null,
    scroll: (top, left) => switcherControls?.scroll(top, left) ?? null,
    scrollPosition: () => switcherControls?.scrollPosition() ?? null,
    appMenuAnchor: applicationHeaderRect,
    appMenuFocus: itemId => applicationMenuControls?.focus(itemId) ?? false,
    appMenuFocusedItemId: () => document.activeElement?.closest('[data-application-menu]') ? document.activeElement.dataset.applicationMenuItem ?? null : null,
    appMenuItemIds: () => applicationMenuControls?.itemIds() ?? [],
    appMenuScroll: top => applicationMenuControls?.scroll(top) ?? null,
    appMenuScrollPosition: () => applicationMenuControls?.scrollPosition() ?? null,
    appMenuBounds: () => applicationMenuControls?.bounds() ?? null,
    appMenuReturnFocus: focusApplicationHeader,
  };
  Object.assign(handlers, createApplicationSwitchingCommands(switching, {
    profile, getWindows: () => windows, getRunningAppIds: () => runningAppIds,
    getActiveWindowId: () => activeWindowId, getActiveAppId: () => activeAppId,
    getPendingQuitAppIds: () => pendingQuitAppIds,
    available: () => switchingView.available(), getView: () => switchingView,
    captureFocus: captureSwitchingFocus,
    restoreFocus: restoreSwitchingFocus, clearPresentations: clearSwitchingPresentations,
    restorePresentations: restoreSwitchingPresentations,
    activateApp: activateSwitcherApplication, visibilityChanged: settleApplicationVisibility,
    invoke: (command, target = {}, payload = {}) => handlers[command](target, payload),
  }));
  Object.assign(handlers,
    createWindowCommands(() => windows, {
      focus: focusWindow, close: requestCloseWindow, minimize: minimizeWindow, expand: expandWindow, move: moveWindow,
      focusKeyboard: focusKeyboardWindow,
      available: windowInteractionsAvailable, isHidden: isAppHidden,
      resize: resizeWindow,
    }, expandedProperty),
    createDesktopCommands(desktopState, {
      getView: () => desktopView, getWindows: () => windows, getActiveWindowId: () => activeWindowId,
      getFiles: () => macDesktop ? macFiles.files.filter(file => !isTrashed(macFiles, file))
        .map(file => ({ ...file, appId: file.appId ?? (file.kind === 'folder' ? 'finder' : 'preview') })) : getDesktopItems(),
      getItems: getDesktopItems,
      openedFile: (windowId, file) => {
        if (!macDesktop) return;
        const window = windows.find(window => window.id === windowId);
        liveFile(macFiles, file.id).lastOpenedAt = nextMacFileTimestamp(macFiles);
        if (file.kind === 'application') return;
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
    isVisible: () => !desktopState.dock?.appWindows && !switching.switcher && !isAppHidden('notes')
      && windows.some((window) => window.appId === 'notes' && !window.minimized),
  }));
  if (adapter.createCommands) Object.assign(handlers, adapter.createCommands(nativeState, {
    native: nativeState,
    getDesktopView: () => desktopView,
    getApplicationView,
    getWindows: () => windows, getActiveWindowId: () => activeWindowId,
    getProfile: () => profile, focusDesktop, focusWindow, closeWindow, cancelAppQuit,
    getDesktopItems, renameDesktopItem, moveDesktopItems, windowInteractionsAvailable,
    createDesktopFolder, trashDesktopItems, getDesktopFileInfo,
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
    () => $state.snapshot({ profile, windows, activeWindowId, activeAppId, runningAppIds, pendingQuitAppIds, switching, area, desktop: desktopState,
      ...(notesState ? { notes: notesState, notesView: notesViewState } : {}),
      ...(macFiles ? { files: macFiles.files } : {}),
      ...(nativeState ? { native: nativeState } : {}),
    }),
    settleCommands, sceneCatalog, () => ({
      profiles: listOSProfiles().map(({ id, name, family, version }) => ({ profileId: id, name, family, version })),
      applications: Object.values(applications).map(({ id, name, dock, taskbar, coverage, minimumSize, multipleWindows, quitAllowed }) => ({
        appId: id, name, coverage, minimumSize, multipleWindows, quitAllowed,
        running: runningAppIds.includes(id), active: activeAppId === id, quitting: pendingQuitAppIds.includes(id),
        ...(macDesktop ? { hidden: isAppHidden(id) } : {}),
        windowIds: windows.filter(window => window.appId === id).map(window => window.id),
        ...(hasDockContext ? {
          ...(dockApplications.main.some(app => app.id === id) ? { dock: 'main' }
            : dockApplications.recent.some(app => app.id === id) ? { dock: 'recent' } : {}),
          dockPinned: desktopState.dock.pinnedAppIds.includes(id),
        } : dock ? { dock } : {}), ...(taskbar ? { taskbar } : {}),
      })),
      desktopFiles: getVisibleDesktopItems().map(({ id, name, appId, folderId, renameable, movable }) => ({ fileId: id, name, appId, folderId, renameable, movable })),
      ...(macFiles ? { desktop: {
        selectedFileIds: [...desktopState.selectedFileIds], selectionAnchorId: desktopState.selectionAnchorId,
        rename: desktopState.rename ? { ...desktopState.rename } : null, marquee: desktopState.marquee ? { ...desktopState.marquee } : null,
        positions: Object.fromEntries(Object.entries(desktopState.positions).map(([id, value]) => [id, { ...value }])),
        context: desktopState.context ? { ...desktopState.context } : null,
        sortBy: desktopState.sortBy, viewOptions: { ...desktopState.viewOptions },
        menuItems: desktopContextItems(desktopState, getDesktopItems(), profile.family),
        ...(hasDesktopStacks ? { stacks: {
          ...desktopState.stacks, expandedStackIds: [...desktopState.stacks.expandedStackIds],
          topFileIds: { ...desktopState.stacks.topFileIds },
          groups: getDesktopStacks().map(({ id, name, fileIds, topFileId, topIndex, expanded, browsing }) =>
            ({ stackId: id, name, fileIds: [...fileIds], topFileId, topIndex, expanded, browsing })),
          itemBounds: desktopView?.stackRects() ?? [],
        } } : {}),
        locations: macFiles.files.filter(file => file.kind === 'folder' && !isTrashed(macFiles, file)).map(({ id, name, parentId, readOnly }) => ({ folderId: id, name, parentId, dropAllowed: id !== 'trash' && !readOnly })),
        files: macFiles.files.filter(file => !isTrashed(macFiles, file)).map(({ id, name, parentId, kind, createdAt, modifiedAt, addedAt, lastOpenedAt, tags }) =>
          ({ fileId: id, name, parentId, kind, createdAt: createdAt ?? null, modifiedAt: modifiedAt ?? null,
            addedAt: addedAt ?? null, lastOpenedAt: lastOpenedAt ?? null, tags: [...(tags ?? [])] })),
        itemBounds: desktopView?.itemRects() ?? [],
      } } : {}),
      ...(hasDockContext ? { dock: {
        pinnedAppIds: [...desktopState.dock.pinnedAppIds], mainOrderAppIds: [...desktopState.dock.mainOrderAppIds],
        mainAppIds: dockApplications.main.map(app => app.id), recentAppIds: dockApplications.recent.map(app => app.id),
        recentHistory: desktopState.dock.recentHistory.map(entry => ({ ...entry })), usageSequence: desktopState.dock.usageSequence,
        secondaryOrderItemIds: [...desktopState.dock.secondaryOrderItemIds], preferences: { ...desktopState.dock.preferences },
        hover: desktopState.dock.hover ? { ...desktopState.dock.hover } : null, focusedItemId: desktopState.dock.focusedItemId,
        revealed: desktopState.dock.revealed, drag: desktopState.dock.drag ? { ...desktopState.dock.drag } : null,
        items: macDockItems(profile, desktopState.dock, runningAppIds, windows, dockFolders), itemBounds: desktopView?.dockItemBounds() ?? [],
        folderFileIds: [...desktopState.dock.folderFileIds],
        folderPreferences: Object.fromEntries(Object.entries(desktopState.dock.folderPreferences).map(([fileId, preferences]) => [fileId, { ...preferences }])),
        folders: dockFolders.map(folder => ({ itemId: folder.itemId, fileId: folder.fileId, name: folder.name,
          preferences: { ...folder.preferences }, fileIds: folder.entries.map(file => file.id) })),
        folderStack: desktopState.dock.folderStack ? { ...desktopState.dock.folderStack,
          pathFileIds: [...desktopState.dock.folderStack.pathFileIds], scroll: { ...desktopState.dock.folderStack.scroll },
          view: dockStackView, items: dockStackItems.map(file => ({ fileId: file.id, name: file.name, kind: file.kind, icon: file.icon })),
          renderedItemIds: dockStackControls?.itemIds() ?? [], bounds: dockStackControls?.bounds() ?? null } : null,
        trash: { ...dockTrash, fileIds: [...dockTrash.fileIds] },
        context: desktopState.dock.context ? { ...desktopState.dock.context, scroll: { ...desktopState.dock.context.scroll } } : null,
        menuItems: getDockMenuItems(), menuBounds: desktopView?.dockMenuBounds() ?? [],
        appWindows: desktopState.dock.appWindows ? { ...desktopState.dock.appWindows, cards: dockWindowCards.map(card => ({ ...card, rect: { ...card.rect } })) } : null,
        bundles: macFiles.files.filter(file => file.bundleAppId).map(file => ({ appId: file.bundleAppId, fileId: file.id, folderId: file.parentId })),
      } } : {}),
      ...(profile.capabilities.includes('shell.switcher') ? { switching: {
        activationAppIds: [...switching.activationAppIds], activationWindowIds: [...switching.activationWindowIds],
        creationWindowIds: [...switching.creationWindowIds],
        ...(macDesktop ? { hiddenAppIds: [...switching.hiddenAppIds] } : {}),
        switcher: switching.switcher ? { ...switching.switcher, itemIds: [...switching.switcher.itemIds],
          scroll: { ...switching.switcher.scroll }, items: switcherItems.map(item => ({ ...item })),
          renderedItemIds: switcherControls?.itemIds() ?? [], bounds: switcherControls?.bounds() ?? null } : null,
        applicationMenu: switching.appMenu ? { ...switching.appMenu, items: appMenuItems.map(item => ({ ...item })),
          bounds: applicationMenuControls?.bounds() ?? null } : null,
        shortcuts: { switcher: macDesktop ? 'Command+Tab' : 'Alt+Tab', sticky: 'Control+Shift+F3',
          cycle: macDesktop ? 'Command+`' : 'Alt+Escape', cycleAlias: 'Control+Shift+F8',
          nativeDelivery: 'Host/browser may intercept reserved chords; aliases require delivered page events. Ctrl+Tab/Ctrl+Shift+Tab are never intercepted.' },
      } } : {}),
      windows: windows.map((window) => ({
        windowId: window.id, appId: window.appId, minimized: window.minimized, [expandedProperty]: window[expandedProperty],
        ...(macDesktop ? { hidden: isAppHidden(window.appId) } : {}),
        bounds: { ...window.bounds },
        ...(window.folderId ? { folderId: window.folderId } : {}),
        ...(window.fileId ? { fileId: window.fileId } : {}),
        ...(window.utilityKind ? { utilityKind: window.utilityKind } : {}),
        ...(window.infoSections ? { infoSections: { ...window.infoSections } } : {}),
        ...(window.finderSelectedFileIds ? { selectedFileIds: [...window.finderSelectedFileIds] } : {}),
        ...(window.settingsPane ? { settingsPane: window.settingsPane } : {}),
        ...(desktopState.dock?.appWindows ? { presentationVisible: Boolean(dockWindowBounds[window.id]),
          ...(dockWindowBounds[window.id] ? { overviewBounds: { ...dockWindowBounds[window.id] } } : {}) } : {}),
        ...(switching.switcher?.kind === 'windows' ? { presentationVisible: Boolean(switcherWindowBounds[window.id]),
          ...(switcherWindowBounds[window.id] ? { switcherBounds: { ...switcherWindowBounds[window.id] } } : {}) } : {}),
        presentationInteractive: !switching.switcher && !desktopState.dock?.appWindows && !window.minimized && !isAppHidden(window.appId),
        resize: { available: hasWindowResize && !switching.switcher && !isAppHidden(window.appId)
          && !window.minimized && !window[expandedProperty] && windowInteractionsAvailable(), edges: resizeEdges, minimumSize: windowApplication(window).minimumSize },
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
    if (!disposed && desktopView && area.width && area.height) {
      const positionsChanged = reconcileDesktopPositions(area);
      if (reconcileDesktopContext() || positionsChanged) await tick();
    }
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
    if (desktopView && desktopState.dock?.context) {
      for (const region of ['main', 'submenu']) {
        const top = desktopView.dockMenuScrollTop(region);
        if (top !== null) desktopState.dock.context.scroll[region] = top;
      }
    }
    if (switching.switcher) {
      const offsets = switcherControls?.scrollPosition();
      if (offsets && (offsets.top !== switching.switcher.scroll.top || offsets.left !== switching.switcher.scroll.left)) switching.switcher.scroll = offsets;
    }
    if (switching.appMenu) {
      const top = applicationMenuControls?.scrollPosition();
      if (top !== null && top !== undefined && top !== switching.appMenu.scrollTop) switching.appMenu.scrollTop = top;
    }
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

  function sceneInteractionsAvailable() {
    return !disposed && (adapter.windowInteractionsAvailable?.(nativeState) ?? true);
  }
  function windowInteractionsAvailable() {
    return sceneInteractionsAvailable() && !desktopState.dock?.appWindows;
  }

  function getApplicationView(windowId) {
    if (!windowInteractionsAvailable() || switching.switcher) return undefined;
    return windows.some(window => window.id === windowId && !window.minimized && !isAppHidden(window.appId))
      ? applicationViews.get(windowId)
      : undefined;
  }

  async function focusKeyboardWindow(id) {
    await tick();
    [...document.querySelectorAll('[data-window-id]')].find((element) => element.dataset.windowId === id)?.focus({ preventScroll: true });
  }
  function createMacSceneFiles() {
    const store = createMacDesktopFileStore(profile, initialData.notes.timeBase + 42 * 60_000);
    store.files.push(...createMacApplicationFiles(profile, initialData.notes.timeBase + 42 * 60_000));
    return store;
  }
  function getDockMenuItems() {
    if (desktopState.dock.context?.kind === 'folder')
      return macDockFolderContextItems(desktopState.dock, macFiles, desktopState.dock.context.dockItemId);
    return macDockContextItems(profile, desktopState.dock, windows, runningAppIds, activeWindowId, pendingQuitAppIds, switching.hiddenAppIds);
  }
  async function focusDock(appId) {
    const current = [...dockApplications.main, ...dockApplications.recent].find(app => app.id === appId)
      ?? dockApplications.main[0];
    if (current) await handlers['dock.focus']({ itemId: `app:${current.id}` }, {});
    else await handlers['desktop.focus']({}, {});
  }
  async function restoreOverviewFocus(appId) {
    const window = windows.find(window => window.id === activeWindowId && !window.minimized);
    if (window) await focusKeyboardWindow(window.id);
    else await focusDock(appId);
  }
  async function openDockPreferences() {
    const result = await handlers['app.open']({ appId: 'settings' }, {});
    if (result.status !== 'applied') return result;
    const window = windows.find(window => window.id === result.target.windowId);
    window.settingsPane = 'dock';
    window.title = profile.renderer === 'sonoma' ? 'Desktop & Dock' : 'Dock';
    await tick();
    return { status: 'applied', target: { appId: 'settings', windowId: window.id } };
  }
  async function revealMacApplication(appId) {
    const file = liveFile(macFiles, applicationBundleId(appId));
    const folder = file && liveFile(macFiles, file.parentId);
    if (!file || !folder) return rejected('not_found', 'The simulated application bundle or containing directory no longer exists.');
    let window = windows.findLast(window => window.appId === 'finder' && !window.utilityKind && window.folderId === folder.id);
    if (!window) {
      const created = await handlers['window.create']({ appId: 'finder' }, { title: folder.name });
      if (created.status !== 'applied') return created;
      window = windows.find(window => window.id === created.target.windowId);
    }
    window.folderId = folder.id; window.title = folder.name; window.finderSelectedFileIds = [file.id];
    const focused = await handlers['window.focus']({ windowId: window.id }, {});
    if (focused.status !== 'applied') return focused;
    await tick();
    const root = [...document.querySelectorAll('[data-window-id]')].find(element => element.dataset.windowId === window.id);
    const target = [...(root?.querySelectorAll('[data-folder-item-id]') ?? [])].find(element => element.dataset.folderItemId === file.id);
    if (!target) throw new Error('The real Finder application bundle did not render after reveal.');
    const pane = target.closest('.folder-contents'), bounds = target.getBoundingClientRect(), area = pane.getBoundingClientRect();
    if (bounds.top < area.top) pane.scrollTop += bounds.top - area.top;
    else if (bounds.bottom > area.bottom) pane.scrollTop += bounds.bottom - area.bottom;
    return { status: 'applied', target: { appId, fileId: file.id, folderId: folder.id, windowId: window.id } };
  }

  function nativeDesktopItems() {
    return macDesktop ? macDesktopItems(macFiles) : windows11DesktopFiles(profile, nativeState.apps);
  }
  function getDesktopItems() {
    const items = nativeDesktopItems();
    for (const item of items) {
      const file = desktopFileStore.files.find(file => file.id === item.id);
      if (file) {
        item.kind = file.kind;
        item.size = desktopFileSize(file);
      }
    }
    return sortDesktopItems(items, macDesktop ? desktopState : nativeState.shell);
  }
  function getDesktopStacks() {
    return hasDesktopStacks ? buildDesktopStacks(getDesktopItems(), desktopState.stacks, macFiles.sceneTime) : [];
  }
  function getDesktopSelectionRects() {
    const rectangles = desktopView.itemRects();
    if (!desktopState.stacks?.enabled) return rectangles;
    const groups = getDesktopStacks();
    for (const rectangle of desktopView.stackRects()) {
      const group = groups.find(group => group.id === rectangle.stackId);
      if (group) for (const fileId of group.fileIds) rectangles.push({
        fileId, x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height,
      });
    }
    return rectangles;
  }
  function getVisibleDesktopItems(includeCollapsed = false) {
    return desktopStackLayout(getDesktopItems(), getDesktopStacks(), Boolean(desktopState.stacks?.enabled), includeCollapsed)
      .filter(item => item.type !== 'stack');
  }
  function revealDesktopFile(fileId) {
    if (!desktopState.stacks?.enabled) return;
    const group = getDesktopStacks().find(group => group.fileIds.includes(fileId));
    if (group && !group.expanded) desktopState.stacks.expandedStackIds = [...desktopState.stacks.expandedStackIds, group.id];
    desktopState.stacks.focusedStackId = null;
  }
  function getDesktopFileInfo(fileId) {
    return readDesktopFileInfo(desktopFileStore, fileId, nativeDesktopItems());
  }
  function getDesktopDetails() {
    const items = nativeDesktopItems();
    const ids = new Set([...desktopFileStore.files.map(file => file.id), ...items.map(item => item.id)]);
    return Object.fromEntries([...ids].map(fileId => [fileId, readDesktopFileInfo(desktopFileStore, fileId, items)]));
  }

  function reconcileDesktopContext() {
    const context = (macDesktop ? desktopState : nativeState.shell).context;
    if (!context) return false;
    const area = desktopView.contextArea(), bounds = desktopView.contextBounds();
    const x = Math.max(area.left, Math.min(context.x, area.left + Math.max(0, area.width - bounds.width)));
    const y = Math.max(area.top, Math.min(context.y, area.top + Math.max(0, area.height - bounds.height)));
    if (x === context.x && y === context.y) return false;
    context.x = x; context.y = y;
    return true;
  }

  // A native layout slot can shift when a preceding file leaves the desktop.
  // Keep explicitly placed icons at their physical point, not at the new slot.
  function reconcileDesktopPositions(bounds) {
    if (desktopState.stacks?.enabled) return false;
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
      for (const window of windows) if (window.folderId === fileId || window.fileId === fileId) {
        const name = liveFile(macFiles, fileId).name;
        window.title = window.utilityKind === 'desktop-info' ? `${name} Info` : name;
      }
    return result;
  }

  function moveDesktopItems(fileIds, folderId) {
    if (macDesktop && liveFile(macFiles, folderId)?.readOnly)
      return rejected('disabled', 'The simulated installed-application location is read-only.');
    if (macDesktop && folderId === 'trash') return rejected('disabled', 'Trash deletion and restoration belong to the simulated filesystem lifecycle; this desktop slice moves to ordinary folders only.');
    const moves = fileIds.map(fileId => {
      const file = liveFile(desktopFileStore, fileId);
      return { fileId, name: file?.name, parentId: file?.parentId };
    });
    const result = moveVirtualFiles(desktopFileStore, moves, folderId, desktopFilePolicy.validateName);
    if (result.status === 'applied' && macDesktop)
      for (const move of moves) if (move.parentId !== folderId)
        liveFile(macFiles, move.fileId).addedAt = nextMacFileTimestamp(macFiles);
    return result;
  }
  function createDesktopFolder(name, fileIds = []) {
    const items = getDesktopItems();
    if (fileIds.some(fileId => !items.some(item => item.id === fileId))) return rejected('not_found', 'A grouping source no longer exists.');
    if (fileIds.some(fileId => !items.find(item => item.id === fileId).movable)) return rejected('disabled', 'Protected system entries cannot be grouped.');
    if (!macDesktop && fileIds.length) return rejected('disabled', 'Windows New Folder does not group a selection.');
    if (name === undefined) {
      const base = macDesktop ? 'untitled folder' : 'New folder';
      const names = new Set(items.map(item => item.name.toLowerCase()));
      name = base;
      for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = macDesktop ? `${base} ${suffix}` : `${base} (${suffix})`;
    }
    const previousCounter = desktopFileStore.nextFileId;
    const result = desktopFileCommands['win11.files.create']({ folderId: 'desktop' }, { name, kind: 'folder' });
    if (result.status !== 'applied') return result;
    if (fileIds.length) {
      const moved = moveDesktopItems(fileIds, result.target.fileId);
      if (moved.status !== 'applied') {
        desktopFileStore.files.splice(desktopFileStore.files.findIndex(file => file.id === result.target.fileId), 1);
        desktopFileStore.nextFileId = previousCounter;
        return moved;
      }
    }
    if (macDesktop) {
      const timestamp = nextMacFileTimestamp(macFiles);
      Object.assign(liveFile(macFiles, result.target.fileId), {
        createdAt: timestamp, modifiedAt: timestamp, addedAt: timestamp, lastOpenedAt: null, tags: [],
      });
    }
    return result;
  }
  function trashDesktopItems(fileIds) {
    const items = getDesktopItems();
    if (fileIds.some(fileId => !items.some(item => item.id === fileId))) return rejected('not_found', 'A trash source no longer exists.');
    if (fileIds.some(fileId => !items.find(item => item.id === fileId).movable)) return rejected('disabled', 'Protected system entries cannot be trashed.');
    return trashVirtualFiles(desktopFileStore, fileIds, macDesktop ? ['disk', 'desktop', 'downloads', 'trash'] : undefined);
  }
  function windowApplication(window) {
    return desktopUtilityApps[window.utilityKind] ?? applications[window.appId];
  }
  async function openDesktopUtility(utilityKind, fileId) {
    const info = fileId ? getDesktopFileInfo(fileId) : null;
    if (fileId && !info) return rejected('not_found', 'The information record no longer exists.');
    let window = windows.find(entry => entry.utilityKind === utilityKind && entry.fileId === fileId);
    if (!window) {
      const title = utilityKind === 'desktop-info' ? `${info.name} Info` : 'Desktop';
      const id = openWindow('finder', title, true);
      window = windows.find(entry => entry.id === id);
      window.utilityKind = utilityKind;
      delete window.folderId;
      if (fileId) window.fileId = fileId;
      if (utilityKind === 'desktop-info') window.infoSections = { general: true, name: true };
      window.bounds = adapter.initialBounds(windowApplication(window), area, windows.length - 1, globalThis.innerHeight);
    } else focusWindow(window.id);
    await focusKeyboardWindow(window.id);
    return { status: 'applied', target: { windowId: window.id, ...(fileId ? { fileId } : {}) } };
  }
  function dismissDockPresentation() {
    if (!hasDockContext) return;
    const dock = desktopState.dock;
    dock.context = null; dock.appWindows = null; dock.folderStack = null; dock.focusedItemId = null;
    if (dock.preferences.autoHide && !dock.hover && !dock.drag) dock.revealed = false;
  }
  function focusDesktop() {
    switching.switcher = null; switching.appMenu = null;
    unhideApplication(profile.defaults.desktopAppId);
    activeWindowId = null;
    activeAppId = profile.defaults.desktopAppId;
    if (macDesktop) recordApplicationActivation(switching, activeAppId);
    dismissDockPresentation();
    if (hasDesktopStacks) desktopState.stacks.focusedStackId = null;
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

  function isAppHidden(appId) {
    return macDesktop && switching.hiddenAppIds.includes(appId);
  }
  function unhideApplication(appId) {
    if (isAppHidden(appId)) switching.hiddenAppIds = switching.hiddenAppIds.filter(id => id !== appId);
  }
  function applicationHeader(appId) {
    return [...document.querySelectorAll('[data-application-menu-button]')]
      .find(node => node.dataset.appId === appId && node.isConnected);
  }
  function applicationHeaderRect(appId) {
    const node = applicationHeader(appId);
    if (!node || !node.getClientRects().length) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, left: rect.left, top: rect.top, right: rect.right,
      bottom: rect.bottom, width: rect.width, height: rect.height };
  }
  async function focusApplicationHeader(appId) {
    await tick(); await tick();
    const node = applicationHeader(appId);
    if (!node || !node.getClientRects().length || node.closest('[inert]')) return false;
    node.focus({ preventScroll: true });
    return document.activeElement === node;
  }
  async function focusSceneWorkspace() {
    await tick();
    const workspace = document.querySelector(macDesktop ? '.desktop-workspace, .sonoma-workspace' : '.win11-workspace');
    if (!workspace?.isConnected || workspace.closest('[inert]')) return false;
    workspace.focus({ preventScroll: true });
    return document.activeElement === workspace;
  }
  function captureSwitchingFocus() {
    const node = document.activeElement;
    switchingReturnFocus = node;
    const attributes = [...node.attributes].filter(attribute => attribute.name.startsWith('data-'));
    const selector = attributes.length
      ? node.localName + attributes.map(attribute => `[${attribute.name}="${CSS.escape(attribute.value)}"]`).join('')
      : node.id ? `#${CSS.escape(node.id)}` : null;
    switchingReturnFocusIdentity = selector ? { selector, windowId: node.closest('[data-window-id]')?.dataset.windowId } : null;
  }
  async function restoreSwitchingFocus() {
    await tick(); await tick();
    const identity = switchingReturnFocusIdentity;
    const scope = identity?.windowId
      ? document.querySelector(`.managed-window[data-window-id="${CSS.escape(identity.windowId)}"]`) : document;
    // Competing menus remount on failed preparation; return to their canonical
    // control, not a disconnected node or an outside focus that dismisses them.
    const original = switchingReturnFocus?.isConnected ? switchingReturnFocus
      : identity && scope ? scope.querySelector(identity.selector) : null;
    switchingReturnFocus = null; switchingReturnFocusIdentity = null;
    if (original?.isConnected && typeof original.focus === 'function' && !original.closest('[inert]')
      && original.getClientRects().length && getComputedStyle(original).visibility === 'visible') {
      original.focus({ preventScroll: true });
      if (document.activeElement === original) return true;
    }
    const current = windows.find(window => window.id === activeWindowId && !window.minimized && !isAppHidden(window.appId));
    if (current) {
      await focusKeyboardWindow(current.id);
      return document.activeElement?.dataset.windowId === current.id;
    }
    return focusSceneWorkspace();
  }
  function clearSwitchingPresentations() {
    const snapshot = $state.snapshot({
      desktop: { context: desktopState.context, focusedControl: desktopState.focusedControl,
        ...(hasWindowMenu ? { windowMenuOpen: desktopState.windowMenuOpen, windowMenuItem: desktopState.windowMenuItem,
          windowMenuScrollTop: desktopState.windowMenuScrollTop } : {}) },
      ...(hasDockContext ? { dock: { context: desktopState.dock.context, appWindows: desktopState.dock.appWindows,
        folderStack: desktopState.dock.folderStack, focusedItemId: desktopState.dock.focusedItemId, revealed: desktopState.dock.revealed } } : {}),
      ...(notesViewState ? { notes: { context: notesViewState.context, contextItem: notesViewState.contextItem,
        focusedControl: notesViewState.focusedControl } } : {}),
      ...(nativeState ? { shell: { panel: nativeState.shell.panel, context: nativeState.shell.context,
        focusedControl: nativeState.shell.focusedControl } } : {}),
    });
    desktopState.context = null; desktopState.focusedControl = null;
    if (hasWindowMenu) { desktopState.windowMenuOpen = false; desktopState.windowMenuItem = null; desktopState.windowMenuScrollTop = 0; }
    dismissDockPresentation();
    if (notesViewState) clearNotesPresentation();
    if (nativeState) { nativeState.shell.panel = null; nativeState.shell.context = null; nativeState.shell.focusedControl = null; }
    return snapshot;
  }
  async function restoreSwitchingPresentations(snapshot) {
    Object.assign(desktopState, snapshot.desktop);
    if (snapshot.dock) Object.assign(desktopState.dock, snapshot.dock);
    if (snapshot.notes) Object.assign(notesViewState, snapshot.notes);
    if (snapshot.shell) Object.assign(nativeState.shell, snapshot.shell);
    await tick(); await tick();
  }
  async function activateSwitcherApplication(appId, preserveSwitcher = false) {
    if (!runningAppIds.includes(appId) || pendingQuitAppIds.includes(appId))
      return rejected('stale_target', 'The selected application is no longer available.');
    const presentation = preserveSwitcher ? switching.switcher : null;
    unhideApplication(appId);
    const ownerWindows = windows.filter(window => window.appId === appId && !window.minimized);
    const window = switching.activationWindowIds.map(id => ownerWindows.find(window => window.id === id)).find(Boolean)
      ?? ownerWindows.at(-1);
    if (window) focusWindow(window.id);
    else {
      activeAppId = appId; activeWindowId = null;
      recordApplicationActivation(switching, appId);
      switching.switcher = null; switching.appMenu = null;
      clearSwitchingPresentations();
    }
    if (presentation) switching.switcher = presentation;
    await tick();
    if (!presentation) {
      if (window) await focusKeyboardWindow(window.id);
      else await focusSceneWorkspace();
    }
    return { status: 'applied', target: { appId, ...(window ? { windowId: window.id } : {}) } };
  }
  async function settleApplicationVisibility(change) {
    if (!macDesktop) return;
    const retainSwitcher = Boolean(switching.switcher);
    if (change.kind === 'all') { await tick(); return; }
    if (change.kind === 'others' || (change.kind === 'set' && change.hidden === false)) {
      await activateSwitcherApplication(change.appId, retainSwitcher);
      return;
    }
    if (!isAppHidden(activeAppId) && runningAppIds.includes(activeAppId)) { await tick(); return; }
    const eligible = runningAppIds.filter(id => !pendingQuitAppIds.includes(id));
    const order = [...switching.activationAppIds.filter(id => eligible.includes(id)),
      ...eligible.filter(id => !switching.activationAppIds.includes(id))];
    let next = order.find(id => !isAppHidden(id));
    if (!next) next = eligible.includes(profile.defaults.desktopAppId) ? profile.defaults.desktopAppId : order[0];
    if (next) await activateSwitcherApplication(next, retainSwitcher);
  }
  function consumeSwitchingKey(event) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
  function switchingKeydown(event) {
    if (event.defaultPrevented || event.isComposing || !profile.capabilities.includes('shell.switcher') || !switchingView.available()) return;
    const state = switching.switcher;
    if (macDesktop && event.target?.closest?.('[data-application-menu-button]')
      && !event.metaKey && !event.ctrlKey && !event.altKey && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      consumeSwitchingKey(event);
      commands.execute({ command: 'app.menu.open', target: { appId: activeAppId },
        payload: { position: event.key === 'ArrowUp' ? 'last' : 'first' } });
      return;
    }
    const nativeTab = event.key === 'Tab' && (macDesktop
      ? event.metaKey && !event.ctrlKey && !event.altKey
      : event.altKey && !event.metaKey);
    const fallbackTab = event.key === 'F3' && event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
    if (nativeTab || fallbackTab) {
      consumeSwitchingKey(event);
      const direction = nativeTab && event.shiftKey ? 'previous' : 'next';
      if (state) commands.execute({ command: 'shell.switcher.step', payload: { direction } });
      else commands.execute({ command: 'shell.switcher.open', payload: { direction,
        commitOnRelease: nativeTab && !(event.ctrlKey && !macDesktop) ? macDesktop ? 'Meta' : 'Alt' : null } });
      return;
    }
    // Browser tab traversal remains the browser's even while a switcher is open.
    if (event.key === 'Tab' && event.ctrlKey) return;
    if (state) {
      if (event.key === 'Escape' || (macDesktop && event.key === '.')) {
        consumeSwitchingKey(event); commands.execute({ command: 'shell.switcher.close' }); return;
      }
      if (macDesktop && state.commitOnRelease === 'Meta' && event.metaKey && !event.ctrlKey && !event.altKey
        && ['h', 'q'].includes(event.key.toLowerCase())) {
        consumeSwitchingKey(event);
        const selected = switcherItems.find(item => item.itemId === state.selectedItemId);
        if (selected && !event.repeat) commands.execute({ command: event.key.toLowerCase() === 'q' ? 'app.quit' : 'app.setHidden',
          target: { appId: selected.appId }, ...(event.key.toLowerCase() === 'h' ? { payload: { hidden: !isAppHidden(selected.appId) } } : {}) });
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
        if ((event.metaKey || event.altKey) && ['Enter', ' '].includes(event.key)) return;
        consumeSwitchingKey(event);
        if (event.key === 'Enter' || event.key === ' ') commands.execute({ command: 'shell.switcher.activate' });
        else if (event.key === 'Home' || event.key === 'End') commands.execute({ command: 'shell.switcher.select',
          target: { itemId: state.itemIds[event.key === 'Home' ? 0 : state.itemIds.length - 1] } });
        else commands.execute({ command: 'shell.switcher.step', payload: {
          direction: ['ArrowLeft', 'ArrowUp'].includes(event.key) || (event.key === 'Tab' && event.shiftKey) ? 'previous' : 'next' } });
        return;
      }
      return;
    }
    const nativeCycle = macDesktop ? event.metaKey && !event.ctrlKey && !event.altKey && event.code === 'Backquote'
      : event.altKey && !event.ctrlKey && !event.metaKey && event.key === 'Escape';
    const cycleAlias = event.key === 'F8' && event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
    if (nativeCycle || cycleAlias) {
      consumeSwitchingKey(event);
      commands.execute({ command: 'window.cycle', payload: { direction: nativeCycle && event.shiftKey ? 'previous' : 'next' } });
    } else if (macDesktop && event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'h') {
      consumeSwitchingKey(event);
      if (!event.repeat) commands.execute({ command: event.altKey ? 'app.hideOthers' : 'app.setHidden',
        target: { appId: activeAppId }, ...(event.altKey ? {} : { payload: { hidden: true } }) });
    }
  }
  function switchingKeyup(event) {
    if (switching.switcher?.commitOnRelease !== event.key) return;
    consumeSwitchingKey(event);
    commands.execute({ command: 'shell.switcher.activate' });
  }
  function switchingOutside(event) {
    const target = event.target;
    if (switching.switcher && !target?.closest?.('[data-shell-switcher]'))
      commands.execute({ command: 'shell.switcher.close', payload: { restoreFocus: false } });
    if (switching.appMenu && !target?.closest?.('[data-application-menu], [data-application-menu-button]'))
      commands.execute({ command: 'app.menu.close', payload: { restoreFocus: false } });
  }
  function cancelHeldSwitcher() {
    if (switching.switcher?.commitOnRelease) commands.execute({ command: 'shell.switcher.close', payload: { restoreFocus: false } });
  }
  function switchingVisibility() {
    if (document.hidden) cancelHeldSwitcher();
  }

  onMount(() => {
    const unregister = registerCommands(commands);
    const stopScene = adapter.startScene?.(nativeState, commands.execute);
    window.addEventListener('keydown', switchingKeydown, true);
    window.addEventListener('keyup', switchingKeyup, true);
    window.addEventListener('blur', cancelHeldSwitcher);
    document.addEventListener('visibilitychange', switchingVisibility);
    document.addEventListener('pointerdown', switchingOutside, true);
    document.addEventListener('focusin', switchingOutside, true);
    return () => {
      disposed = true; stopScene?.(); unregister();
      window.removeEventListener('keydown', switchingKeydown, true);
      window.removeEventListener('keyup', switchingKeyup, true);
      window.removeEventListener('blur', cancelHeldSwitcher);
      document.removeEventListener('visibilitychange', switchingVisibility);
      document.removeEventListener('pointerdown', switchingOutside, true);
      document.removeEventListener('focusin', switchingOutside, true);
    };
  });


  function focusWindow(id) {
    const index = windows.findIndex((window) => window.id === id);
    if (index < 0) return;
    const window = windows[index];
    unhideApplication(window.appId);
    switching.switcher = null; switching.appMenu = null;
    window.minimized = false;
    if (index !== windows.length - 1) {
      windows.splice(index, 1);
      windows.push(window);
    }
    activeWindowId = id;
    activeAppId = window.appId;
    recordApplicationActivation(switching, window.appId, id);
    desktopState.context = null;
    dismissDockPresentation();
    if (hasDesktopStacks) desktopState.stacks.focusedStackId = null;
    if (hasWindowMenu) {
      desktopState.windowMenuOpen = false;
      desktopState.windowMenuItem = null;
      desktopState.focusedControl = null;
    }
    if (window.appId !== 'notes' && notesViewState) clearNotesPresentation();
  }

  function openWindow(appId, title, fresh = false) {
    const app = applications[appId];
    unhideApplication(appId);
    switching.switcher = null; switching.appMenu = null;
    const existing = !fresh && windows.findLast(window => window.appId === appId && !window.utilityKind);
    if (existing) {
      if (title !== undefined) existing.title = title;
      focusWindow(existing.id);
      if (hasDockContext) recordMacAppUse(desktopState.dock, appId);
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
      ...(hasDockContext && appId === 'settings' ? { settingsPane: 'dock' } : {}),
    });
    if (!runningAppIds.includes(appId)) runningAppIds.push(appId);
    activeWindowId = id;
    activeAppId = appId;
    recordApplicationActivation(switching, appId, id, true);
    if (hasDockContext) {
      recordMacAppUse(desktopState.dock, appId);
      dismissDockPresentation();
    }
    if (hasDesktopStacks) desktopState.stacks.focusedStackId = null;
    return id;
  }

  function focusRemaining() {
    const remaining = windows.findLast(window => !window.minimized && !isAppHidden(window.appId)
      && (!adapter.closeKeepsRunning || window.appId === activeAppId));
    activeWindowId = remaining?.id ?? null;
    if (remaining) activeAppId = remaining.appId;
    else if (!runningAppIds.includes(activeAppId)) activeAppId = profile.defaults.desktopAppId;
  }


  async function requestCloseWindow(id) {
    const window = windows.find(entry => entry.id === id);
    if (switching.switcher && !(macDesktop && quitInFlight.has(window.appId))) {
      switching.switcher = null; await tick();
    }
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
      switching.hiddenAppIds = switching.hiddenAppIds.filter(id => id !== appId);
      switching.appMenu = null;
      if (activeAppId === appId) {
        const remaining = windows.findLast(window => !window.minimized && !isAppHidden(window.appId));
        activeWindowId = remaining?.id ?? null;
        activeAppId = remaining?.appId ?? profile.defaults.desktopAppId;
      }
      if (macDesktop) await settleApplicationVisibility({ kind: 'removed' });
      cancelAppQuit(appId);
      await tick();
      if (switching.switcher) await switcherControls?.focus(switching.switcher.selectedItemId);
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
    window.bounds = resizeBounds(window.bounds, edge, coordinates, windowApplication(window).minimumSize, area);
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
      const normal = adapter.fitNormalBounds(window[expandedProperty] ? window.restoreBounds : window.bounds, windowApplication(window), area);
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

{#snippet managedWindow(window, active, zIndex, presentationBounds, interactive, visible)}
      <Window
        {window}
        {active}
        {zIndex}
        {presentationBounds}
        {interactive}
        {visible}
        onfocus={() => windowCommand('window.focus', window.id, { keyboard: false })}
        onclose={() => windowCommand('window.close', window.id)}
        onminimize={() => windowCommand('window.setMinimized', window.id, { minimized: true })}
        onzoom={() => toggleWindowZoom(window.id)}
        onmaximize={() => toggleWindowMaximize(window.id)}
        onmove={(x, y) => windowCommand('window.move', window.id, { x, y })}
        resizable={interactive && hasWindowResize && !window[expandedProperty] && windowInteractionsAvailable()}
        onresize={(edge, coordinates) => windowCommand('window.resize', window.id, { edge, ...coordinates })}
      >
        {#if Applications}
          <Applications appId={window.appId} windowId={window.id} {profile} native={adapter.nativeForWindow(nativeState, window.id)} execute={commands.execute} registerView={registerApplicationView} />
        {:else if window.appId === 'messages'}
          <MessagesWindow
            assets={profile.assets}
            {active}
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
            {active}
            zoomed={window.zoomed}
            onclose={() => windowCommand('window.close', window.id)}
            onminimize={() => windowCommand('window.setMinimized', window.id, { minimized: true })}
            onzoom={() => toggleWindowZoom(window.id)}
          />
        {:else if hasDockContext && window.appId === 'settings'}
          <MacDockPreferences {profile} preferences={desktopState.dock.preferences} execute={commands.execute} />
        {:else if window.utilityKind === 'desktop-info'}
          <MacDesktopInfo {profile} info={desktopDetails[window.fileId]} windowId={window.id} sections={window.infoSections} execute={commands.execute} />
        {:else if window.utilityKind === 'desktop-view-options'}
          <MacDesktopViewOptions {profile} options={desktopState.viewOptions} sortBy={desktopState.sortBy} stacks={desktopState.stacks} execute={commands.execute} />
        {:else if macDesktop && window.appId === 'finder'}
          <MacDesktopFolder {profile} windowId={window.id} folderId={window.folderId} files={macFiles.files} selectedFileIds={window.finderSelectedFileIds ?? []} dockState={desktopState.dock} execute={commands.execute} />
        {/if}
      </Window>
{/snippet}

{#snippet renderWindowTile(windowId, width, height)}
  {@const window = windows.find(window => window.id === windowId)}
  {#if window}
    {@const scale = Math.min(width / window.bounds.width, height / window.bounds.height)}
    {@const tileWidth = window.bounds.width * scale}
    {@const tileHeight = window.bounds.height * scale}
    {@render managedWindow(window, false, 1, { x: (width - tileWidth) / 2, y: (height - tileHeight) / 2, width: tileWidth, height: tileHeight, scale: window.bounds.scale * scale }, false, true)}
  {/if}
{/snippet}

<Desktop
  {profile}
  {windows}
  switchingState={switching}
  {runningAppIds}
  {activeWindowId}
  {activeApp}
  viewState={desktopState}
  {desktopItems}
  {desktopDetails}
  {desktopStacks}
  {dockApplications}
  {dockMenuItems}
  {dockTiles}
  {dockFolders}
  {dockTrash}
  {renderWindowTile}
  native={nativeState}
  execute={commands.execute}
  registerView={registerDesktopView}
  onlayout={() => commands.execute({ command: 'desktop.refreshLayout' })}
>
  {#each windows as window, index (window.id)}
    {@const projection = switcherWindowBounds[window.id] ?? dockWindowBounds[window.id]}
    {#if !window.minimized || projection}
      {@render managedWindow(window, activeWindowId === window.id && !switching.switcher && !isAppHidden(window.appId),
        switcherWindowBounds[window.id] ? 11001 : dockWindowBounds[window.id] ? 7001 : index + 1,
        projection, !desktopState.dock?.appWindows && !switching.switcher && !isAppHidden(window.appId),
        !isAppHidden(window.appId) && (switching.switcher?.kind === 'windows'
          ? Boolean(switcherWindowBounds[window.id]) : !desktopState.dock?.appWindows || Boolean(dockWindowBounds[window.id])))}
    {/if}
  {/each}
  {#if desktopState.dock?.appWindows}
    <MacDockAppWindows {profile} app={applications[desktopState.dock.appWindows.appId]} state={desktopState.dock.appWindows} cards={dockWindowCards} {area} execute={commands.execute} />
  {/if}
  {#if desktopState.dock?.folderStack && dockStackFolder && dockStackAnchor}
    <MacDockStack {profile} state={desktopState.dock.folderStack} folder={dockStackFolder}
      items={dockStackItems} view={dockStackView} anchor={dockStackAnchor} execute={commands.execute} bind:this={dockStackControls} />
  {/if}
  {#if switching.switcher}
    <ApplicationSwitcher {profile} state={switching.switcher} items={switcherItems} execute={commands.execute}
      onlayout={slots => { switcherPreviewSlots = slots; }} bind:this={switcherControls} />
  {/if}
  {#if switching.appMenu && applicationMenuAnchor}
    <MacApplicationMenu {profile} app={applications[switching.appMenu.appId]} state={switching.appMenu}
      items={appMenuItems} anchor={applicationMenuAnchor} execute={commands.execute} bind:this={applicationMenuControls} />
  {/if}
</Desktop>

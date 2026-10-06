<script>
  import { onMount, tick, untrack } from 'svelte';
  import { createFeatureCommands, rejected } from './feature-commands.js';
  import { createWindowCommands } from './window-commands.js';
  import { createApplicationCommands } from './application-commands.js';
  import { applicationSwitchingDefaults, recordApplicationActivation, reconcileApplicationSwitching,
    applicationSwitcherItems, applicationMenuItems, createApplicationSwitchingCommands } from './application-switching.js';
  import ApplicationSwitcher from './ApplicationSwitcher.svelte';
  import MacApplicationMenu from './MacApplicationMenu.svelte';
  import { fullScreenDefaults, reconcileFullScreenWindowing, fullScreenStage as deriveFullScreenStage,
    splitViewItems, windowGreenMenuItems, createFullScreenCommands } from './full-screen-windowing.js';
  import SplitViewPicker from './SplitViewPicker.svelte';
  import WindowGreenMenu from './WindowGreenMenu.svelte';
  import { spacesDefaults, spacesItems, windowSpaceId, missionControlWindows, missionControlItems,
    reconcileSpaces, createSpacesCommands } from './spaces.js';
  import MissionControl from './MissionControl.svelte';
  import { launchpadDefaults, launchpadAppIds, launchpadItems, launchpadControlIds, createLaunchpadCommands } from './launchpad.js';
  import Launchpad from './Launchpad.svelte';
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
  const hasFullScreen = profile.capabilities.includes('shell.full-screen');
  const hasSpaces = profile.capabilities.includes('shell.mission-control');
  const hasLaunchpad = profile.capabilities.includes('shell.launchpad');
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
  let presentation = $state(fullScreenDefaults());
  let spaceState = $state(spacesDefaults());
  let missionControlControls = $state();
  let missionControlSlots = $state({});
  let launchpadState = $state(launchpadDefaults(profile));
  let launchpadControls = $state();
  const spaceItems = $derived(hasSpaces ? spacesItems(spaceState, presentation, windows, profile,
    switching.hiddenAppIds, pendingQuitAppIds) : []);
  const overviewWindows = $derived(hasSpaces ? missionControlWindows(spaceState, windows,
    switching.hiddenAppIds, pendingQuitAppIds).map(item => {
      const window = windows.find(window => window.id === item.windowId);
      return { ...item, aspectRatio: window.bounds.width / window.bounds.height,
        previewWidth: window.bounds.width, previewHeight: window.bounds.height };
    }) : []);
  const overviewItems = $derived(hasSpaces ? missionControlItems(spaceState, spaceItems, overviewWindows) : []);
  const missionControlBounds = $derived.by(() => {
    if (!spaceState.overview) return {};
    const projections = {};
    for (const [id, slot] of Object.entries(missionControlSlots)) {
      const window = windows.find(window => window.id === id);
      if (!window || slot.width <= 0 || slot.height <= 0) continue;
      if (window.fullScreen) {
        const minimum = windowApplication(window).minimumSize;
        const scale = Math.max(.001, Math.min(window.bounds.scale, slot.width / minimum.width, slot.height / minimum.height));
        projections[id] = { x: slot.x + stageArea.x, y: slot.y + stageArea.y, width: slot.width, height: slot.height, scale };
        continue;
      }
      const logicalWidth = window.bounds.width / window.bounds.scale;
      const logicalHeight = window.bounds.height / window.bounds.scale;
      const scale = Math.min(window.bounds.scale, slot.width / logicalWidth, slot.height / logicalHeight);
      const width = logicalWidth * scale, height = logicalHeight * scale;
      projections[id] = { x: slot.x + stageArea.x + (slot.width - width) / 2,
        y: slot.y + stageArea.y + (slot.height - height) / 2, width, height, scale };
    }
    return projections;
  });
  $effect(() => {
    reconcileFullScreenWindowing(presentation, windows, switching.hiddenAppIds, pendingQuitAppIds);
    if (!hasSpaces) return;
    reconcileSpaces(spaceState, presentation, windows, profile, switching.hiddenAppIds,
      pendingQuitAppIds, switching.creationWindowIds);
    const foreground = windows.find(window => window.id === activeWindowId && !window.minimized
      && !isAppHidden(window.appId) && !pendingQuitAppIds.includes(window.appId));
    if (!spaceState.overview && foreground) {
      const id = windowSpaceId(spaceState, presentation, foreground);
      if (spaceState.activeSpaceId !== id) spaceState.activeSpaceId = id;
      if (!foreground.fullScreen && spaceState.lastDesktopId !== foreground.spaceId)
        spaceState.lastDesktopId = foreground.spaceId;
    }
  });
  let stageArea = $state({ x: 0, y: 0, width: 0, height: 0, menuHeight: 0 });
  let pairingControls = $state();
  let greenMenuControls = $state();
  let pairingPreviewSlots = $state({});
  let greenMenuAnchor = $state(null);
  const fullScreenStage = $derived(deriveFullScreenStage(presentation, windows, activeWindowId, switching.hiddenAppIds));
  const pairingItems = $derived(splitViewItems(profile, presentation, windows, switching.hiddenAppIds, pendingQuitAppIds));
  const greenMenuWindow = $derived(windows.find(window => window.id === presentation.greenMenu?.windowId));
  const greenMenuItems = $derived(greenMenuWindow ? windowGreenMenuItems(profile, presentation, greenMenuWindow) : []);
  const stageRects = $derived.by(() => {
    if (fullScreenStage.mode === 'normal') return {};
    const top = macDesktop && fullScreenStage.topRevealed ? stageArea.menuHeight : 0;
    const rect = { x: stageArea.x, y: stageArea.y + top, width: stageArea.width, height: Math.max(1, stageArea.height - top) };
    if (fullScreenStage.mode === 'fullScreen') return { [fullScreenStage.windowIds[0]]: rect };
    const ratio = fullScreenStage.mode === 'split' ? fullScreenStage.ratio : .5;
    const left = { ...rect, width: Math.max(1, rect.width * ratio - 2) };
    const right = { ...rect, x: rect.x + left.width + 4, width: Math.max(1, rect.width - left.width - 4) };
    return fullScreenStage.mode === 'split'
      ? { [fullScreenStage.leftWindowId]: left, [fullScreenStage.rightWindowId]: right }
      : { [fullScreenStage.windowId]: fullScreenStage.side === 'left' ? left : right };
  });
  const pairingRect = $derived.by(() => {
    if (fullScreenStage.mode !== 'pairing') return null;
    const primary = stageRects[fullScreenStage.windowId];
    return { x: fullScreenStage.side === 'left' ? stageArea.width / 2 + 2 : 0,
      y: primary.y - stageArea.y, width: Math.max(1, stageArea.width / 2 - 2), height: primary.height };
  });
  const fullScreenWindowBounds = $derived.by(() => {
    const projections = {};
    for (const [windowId, rect] of Object.entries(stageRects)) {
      const window = windows.find(window => window.id === windowId);
      if (!window) continue;
      const minimum = windowApplication(window).minimumSize;
      const scale = Math.min(window.bounds.scale, rect.width / minimum.width, rect.height / minimum.height);
      projections[windowId] = { ...rect, scale: Math.max(.001, scale) };
    }
    return projections;
  });
  const pairingWindowBounds = $derived.by(() => {
    if (fullScreenStage.mode !== 'pairing') return {};
    const projections = {};
    for (const item of pairingItems) {
      const slot = pairingPreviewSlots[item.windowId];
      const window = windows.find(window => window.id === item.windowId);
      if (!slot || !window || slot.width <= 0 || slot.height <= 0) continue;
      const logicalWidth = window.bounds.width / window.bounds.scale;
      const logicalHeight = window.bounds.height / window.bounds.scale;
      const scale = Math.min(window.bounds.scale, slot.width / logicalWidth, slot.height / logicalHeight);
      const width = logicalWidth * scale, height = logicalHeight * scale;
      projections[window.id] = { x: slot.x + stageArea.x + (slot.width - width) / 2,
        y: slot.y + stageArea.y + (slot.height - height) / 2, width, height, scale };
    }
    return projections;
  });
  $effect(() => {
    const menu = presentation.greenMenu;
    stageArea; fullScreenStage; windows;
    if (!menu) { greenMenuAnchor = null; return; }
    let cancelled = false;
    tick().then(() => {
      if (cancelled || presentation.greenMenu !== menu) return;
      const button = managedWindowElement(menu.windowId)?.querySelector('.traffic-light.zoom');
      if (!button || button.closest('[inert]') || getComputedStyle(button).visibility !== 'visible') { greenMenuAnchor = null; return; }
      const rect = button.getBoundingClientRect();
      greenMenuAnchor = { x: rect.x, y: rect.y, left: rect.left, top: rect.top, right: rect.right,
        bottom: rect.bottom, width: rect.width, height: rect.height };
    });
    return () => { cancelled = true; };
  });
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
      available: app => app.presentation ? sceneInteractionsAvailable() : windowInteractionsAvailable(),
      hasWorkspace: () => area.width > 0 && area.height > 0,
      hasWindow: appId => windows.some(window => window.appId === appId),
      isQuitting: appId => pendingQuitAppIds.includes(appId),
      canCreateWindow: appId => adapter.canCreateWindow?.(nativeState, appId) ?? true,
      present: kind => handlers[`shell.${kind}.open`]({}, {}),
      open: openWindow, focusKeyboard: focusKeyboardWindow, quit: quitApplication,
    }),
    'desktop.refreshLayout': (target, payload) => {
      if (Object.keys(target).length || Object.keys(payload).length) {
        return rejected('invalid_arguments', 'desktop.refreshLayout takes no target or payload fields.');
      }
      if (!desktopView) return rejected('unavailable', 'The desktop is not mounted.');
      const bounds = desktopView.measureWorkspace();
      if (!bounds.width || !bounds.height) return rejected('unavailable', 'The workspace has no visible area.');
      measureStageArea();
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
    dismissAppMenus: appId => {
      spaceState.overview = null;
      if (!applications[appId]?.presentation) launchpadState.view = null;
      clearNotesPresentation();
    },
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
  if (hasSpaces) Object.assign(handlers, createSpacesCommands({
    profile, state: spaceState, presentation, getWindows: () => windows,
    getHiddenAppIds: () => switching.hiddenAppIds, getPendingQuitAppIds: () => pendingQuitAppIds,
    getCreationWindowIds: () => switching.creationWindowIds, getActiveWindowId: () => activeWindowId,
    available: () => sceneInteractionsAvailable() && Boolean(desktopView && stageArea.width > 0 && stageArea.height > 0),
    settle: async () => { await tick(); await tick(); }, getView: () => missionControlControls,
    captureScene: captureSpacesScene, restoreScene: restoreSpacesScene,
    dismissPresentations: () => {
      if (stageDrag) stagePointerUp({ pointerId: stageDrag.pointerId, type: 'pointercancel' });
      clearSwitchingPresentations(); switching.switcher = null; switching.appMenu = null;
      cancelPairingForActivation(null); presentation.greenMenu = null;
      presentation.revealed = { top: false, launcher: false };
    },
    captureFocus: captureNativeFocus, restoreFocus: restoreNativeFocus,
    activateSpace: activateManagedSpace, foregroundMembershipChanged: settleSpaceForeground,
    invoke: (command, target = {}, payload = {}) => handlers[command](target, payload),
  }));
  if (hasLaunchpad) Object.assign(handlers, createLaunchpadCommands({
    profile, state: launchpadState,
    available: () => sceneInteractionsAvailable() && Boolean(desktopView && stageArea.width > 0 && stageArea.height > 0),
    settle: async () => { await tick(); await tick(); }, getView: () => launchpadControls,
    captureScene: captureLaunchpadScene, restoreScene: restoreLaunchpadScene,
    captureFocus: captureNativeFocus, restoreFocus: restoreNativeFocus,
    dismissPresentations: () => {
      if (stageDrag) stagePointerUp({ pointerId: stageDrag.pointerId, type: 'pointercancel' });
      clearSwitchingPresentations(); switching.switcher = null; switching.appMenu = null;
      cancelPairingForActivation(null); presentation.greenMenu = null;
      presentation.revealed = { top: false, launcher: false };
    },
    invoke: (command, target = {}, payload = {}) => handlers[command](target, payload),
    getActiveWindowId: () => activeWindowId, getActiveAppId: () => activeAppId, getWindows: () => windows,
    isOriginalFocused: windowId => {
      const window = windows.find(entry => entry.id === windowId);
      const node = managedWindowElement(windowId);
      return Boolean(window && !window.minimized && windowPresented(window) && node?.contains(document.activeElement)
        && !node.closest('[inert]') && getComputedStyle(node).visibility === 'visible');
    },
  }));
  Object.assign(handlers,
    createFullScreenCommands({
      profile, state: presentation, getWindows: () => windows, getActiveWindowId: () => activeWindowId,
      getHiddenAppIds: () => switching.hiddenAppIds, getPendingQuitAppIds: () => pendingQuitAppIds,
      available: sceneInteractionsAvailable, settle: async () => { await tick(); await tick(); },
      focusWindow: focusFullScreenWindow,
      restoreFocus: restoreFullScreenFocus,
      clearPresentations: clearFullScreenPresentations, restorePresentations: restoreFullScreenPresentations,
      getStageView: () => ({ available: () => Boolean(desktopView && stageArea.width > 0 && stageArea.height > 0),
        canReveal: (edge, visible) => visible || (edge === 'top'
          ? !presentation.greenMenu && !switching.appMenu && !desktopState.windowMenuOpen
          : !desktopState.dock?.context && !desktopState.dock?.folderStack && !desktopState.dock?.appWindows
            && !desktopState.dock?.focusedItemId && !nativeState?.shell.panel
            && !document.activeElement?.closest('.dock, .sonoma-dock, .win11-taskbar')) }),
      getPairingView: () => pairingControls,
      getGreenMenuView: () => greenMenuControls,
    }),
    createWindowCommands(() => windows, {
      focus: focusWindow, close: requestCloseWindow, minimize: minimizeWindow, expand: expandWindow, move: moveWindow,
      focusKeyboard: focusKeyboardWindow,
      available: windowInteractionsAvailable, isHidden: isAppHidden, isPresented: windowPresented,
      resize: resizeWindow,
    }, expandedProperty),
    createDesktopCommands(desktopState, {
      getView: () => desktopView, getWindows: () => windows, getActiveWindowId: () => activeWindowId,
      windowMenuAvailable: () => !spaceState.overview && !launchpadState.view && (fullScreenStage.mode === 'normal' || fullScreenStage.topRevealed),
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
    isVisible: () => !spaceState.overview && !launchpadState.view && !desktopState.dock?.appWindows && !switching.switcher && !presentation.pairing
      && windows.some(window => window.appId === 'notes' && !window.minimized && windowPresented(window)),
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
    () => $state.snapshot({ profile, windows, activeWindowId, activeAppId, runningAppIds, pendingQuitAppIds, switching, presentation, area, desktop: desktopState,
      ...(hasSpaces ? { spaces: spaceState } : {}),
      ...(hasLaunchpad ? { launchpad: launchpadState } : {}),
      ...(notesState ? { notes: notesState, notesView: notesViewState } : {}),
      ...(macFiles ? { files: macFiles.files } : {}),
      ...(nativeState ? { native: nativeState } : {}),
    }),
    settleCommands, sceneCatalog, () => ({
      profiles: listOSProfiles().map(({ id, name, family, version }) => ({ profileId: id, name, family, version })),
      applications: Object.values(applications).map(({ id, name, dock, taskbar, coverage, minimumSize, multipleWindows, quitAllowed, presentation }) => ({
        appId: id, name, coverage, minimumSize, multipleWindows, quitAllowed, ...(presentation ? { presentation } : {}),
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
      ...(hasFullScreen ? { presentation: {
        splitViews: presentation.splitViews.map(pair => ({ ...pair })),
        stage: { ...fullScreenStage, windowIds: [...fullScreenStage.windowIds] },
        revealed: { ...presentation.revealed },
        pairing: presentation.pairing ? { ...presentation.pairing,
          windowIds: [...presentation.pairing.windowIds], scroll: { ...presentation.pairing.scroll },
          items: pairingItems.map(item => ({ ...item })), renderedWindowIds: pairingControls?.windowIds() ?? [],
          bounds: pairingRect ? { ...pairingRect } : null } : null,
        greenMenu: presentation.greenMenu ? { ...presentation.greenMenu, items: greenMenuItems.map(item => ({ ...item })) } : null,
        shortcuts: { fullScreen: macDesktop ? 'Control+Command+F' : 'F11', alias: 'Control+Shift+F9',
          nativeDelivery: 'Host/browser may intercept native chords; only delivered page events are handled. The simulation never requests host fullscreen.' },
      } } : {}),
      ...(hasSpaces ? { spaces: {
        activeSpaceId: spaceState.activeSpaceId, lastDesktopId: spaceState.lastDesktopId,
        items: spaceItems.map(item => ({ ...item, windowIds: [...item.windowIds] })),
        overview: spaceState.overview ? { ...spaceState.overview, windowIds: [...spaceState.overview.windowIds],
          scroll: { windows: { ...spaceState.overview.scroll.windows }, spaces: { ...spaceState.overview.scroll.spaces } },
          itemIds: [...overviewItems], windows: overviewWindows.map(item => ({ ...item })) } : null,
        shortcuts: { toggle: 'Control+ArrowUp', alias: 'Control+Shift+F10', previous: 'Control+ArrowLeft', next: 'Control+ArrowRight',
          nativeDelivery: 'Only delivered page events are handled; no host Spaces, gestures or settings are changed.' },
      } } : {}),
      ...(hasLaunchpad ? { launchpad: {
        appIds: launchpadAppIds(profile), pages: launchpadState.pages.map(items => [...items]),
        folders: launchpadState.folders.map(folder => ({ ...folder, appIds: [...folder.appIds] })),
        view: launchpadState.view ? { ...$state.snapshot(launchpadState.view),
          itemIds: launchpadControlIds(profile, launchpadState),
          items: launchpadItems(profile, launchpadState, launchpadState.view.folderId ? 'folder' : 'main'),
          bounds: launchpadControls?.bounds() ?? null } : null,
        shortcuts: { alias: 'Control+Shift+F11', previousPage: 'Command+ArrowLeft', nextPage: 'Command+ArrowRight',
          nativeDelivery: 'Only delivered page events are handled; no host Launchpad, applications, gestures or settings are changed.' },
      } } : {}),
      windows: windows.map((window) => ({
        windowId: window.id, appId: window.appId, minimized: window.minimized, fullScreen: window.fullScreen, [expandedProperty]: window[expandedProperty],
        ...(macDesktop ? { hidden: isAppHidden(window.appId) } : {}),
        ...(hasSpaces ? { spaceId: window.spaceId, presentationSpaceId: windowSpaceId(spaceState, presentation, window) } : {}),
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
        presentationVisible: windowVisible(window), presentationInteractive: windowInteractive(window),
        ...(fullScreenWindowBounds[window.id] ? { fullScreenBounds: { ...fullScreenWindowBounds[window.id] } } : {}),
        ...(pairingWindowBounds[window.id] ? { pairingBounds: { ...pairingWindowBounds[window.id] } } : {}),
        ...(missionControlBounds[window.id] ? { missionControlBounds: { ...missionControlBounds[window.id] } } : {}),
        resize: { available: hasWindowResize && windowInteractive(window) && !window.fullScreen
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
    if (presentation.pairing && pairingControls) {
      const actual = pairingControls.scrollPosition();
      if (actual && (actual.top !== presentation.pairing.scroll.top || actual.left !== presentation.pairing.scroll.left))
        presentation.pairing.scroll = actual;
    }
    if (presentation.greenMenu && greenMenuControls) {
      const top = greenMenuControls.scrollTop();
      if (top !== null && top !== presentation.greenMenu.scrollTop) presentation.greenMenu.scrollTop = top;
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
    return sceneInteractionsAvailable() && !desktopState.dock?.appWindows && !spaceState.overview && !launchpadState.view;
  }

  function getApplicationView(windowId) {
    if (!windowInteractionsAvailable() || switching.switcher || presentation.pairing) return undefined;
    return windows.some(window => window.id === windowId && !window.minimized && windowPresented(window))
      ? applicationViews.get(windowId)
      : undefined;
  }

  function managedWindowElement(id) {
    return [...document.querySelectorAll('.managed-window[data-window-id]')].find(element => element.dataset.windowId === id);
  }
  async function focusKeyboardWindow(id) {
    await tick();
    const element = managedWindowElement(id);
    if (!element || element.closest('[inert]') || getComputedStyle(element).visibility !== 'visible') return false;
    element.focus({ preventScroll: true });
    return document.activeElement === element;
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
    cancelPairingForActivation(null);
    spaceState.overview = null;
    launchpadState.view = null;
    if (hasSpaces) spaceState.activeSpaceId = spaceState.lastDesktopId;
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
    if (spaceState.overview || launchpadState.view) return;
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
  function toggleWindowFullScreen(id) {
    const window = windows.find(entry => entry.id === id);
    return windowCommand('window.setFullScreen', id, { fullScreen: !window.fullScreen });
  }
  function splitSide(event) {
    return Number.isFinite(event?.clientX) && event.clientX >= stageArea.width / 2 ? 'right' : 'left';
  }
  function beginSplitView(id, event) {
    return windowCommand('window.splitView.begin', id, { side: splitSide(event) });
  }
  function changeSplitSide(id, event) {
    const side = splitSide(event);
    if (presentation.pairing?.windowId === id && presentation.pairing.side !== side)
      return windowCommand('window.splitView.setSide', id, { side });
  }
  function revealFullScreen(edge, visible) {
    if (fullScreenStage.mode === 'normal' || presentation.revealed[edge] === visible) return;
    return commands.execute({ command: 'shell.fullScreen.reveal', target: { edge }, payload: { visible } });
  }
  function cancelPairingForActivation(id) {
    const pairing = presentation.pairing;
    if (!pairing || id === pairing.windowId) return;
    const initiator = windows.find(window => window.id === pairing.windowId);
    if (initiator) initiator.fullScreen = pairing.previousFullScreen;
    if (pairing.previousSplitView && windows.some(window => window.id === pairing.previousSplitView.leftWindowId)
      && windows.some(window => window.id === pairing.previousSplitView.rightWindowId))
      presentation.splitViews.push({ ...pairing.previousSplitView });
    presentation.pairing = null;
  }
  function windowPresented(window) {
    if (isAppHidden(window.appId)) return false;
    if (hasSpaces && windowSpaceId(spaceState, presentation, window) !== spaceState.activeSpaceId) return false;
    return fullScreenStage.mode === 'normal' ? !window.fullScreen : Boolean(fullScreenWindowBounds[window.id]);
  }
  function windowVisible(window) {
    if (window.minimized && !switcherWindowBounds[window.id] && !dockWindowBounds[window.id]) return false;
    if (launchpadState.view) return false;
    if (isAppHidden(window.appId)) return false;
    if (spaceState.overview) return Boolean(missionControlBounds[window.id]);
    if (switching.switcher?.kind === 'windows') return Boolean(switcherWindowBounds[window.id]);
    if (desktopState.dock?.appWindows) return Boolean(dockWindowBounds[window.id]);
    if (fullScreenStage.mode === 'pairing') return Boolean(fullScreenWindowBounds[window.id] || pairingWindowBounds[window.id]);
    return windowPresented(window);
  }
  function windowInteractive(window) {
    return !spaceState.overview && !launchpadState.view && !window.minimized && !switching.switcher && !desktopState.dock?.appWindows
      && fullScreenStage.mode !== 'pairing' && windowPresented(window);
  }
  function measureStageArea() {
    const workspace = document.querySelector(macDesktop ? '.desktop-workspace, .sonoma-workspace' : '.win11-workspace');
    const root = workspace?.parentElement;
    if (!root) return;
    const scene = root.getBoundingClientRect(), area = workspace.getBoundingClientRect();
    const next = { x: scene.left - area.left, y: scene.top - area.top, width: scene.width, height: scene.height,
      menuHeight: macDesktop ? area.top - scene.top : 0 };
    if (Object.keys(next).some(key => next[key] !== stageArea[key])) stageArea = next;
  }
  function clearFullScreenPresentations() {
    captureSwitchingFocus();
    const snapshot = { base: clearSwitchingPresentations(),
      switching: $state.snapshot({ switcher: switching.switcher, appMenu: switching.appMenu,
        activationAppIds: switching.activationAppIds, activationWindowIds: switching.activationWindowIds }),
      windowIds: windows.map(window => window.id), activeWindowId, activeAppId,
      ...(hasSpaces ? { spaces: $state.snapshot(spaceState) } : {}) };
    switching.switcher = null; switching.appMenu = null;
    return snapshot;
  }
  let ownedWindowFocus = 0;
  async function focusFullScreenWindow(windowId) {
    ownedWindowFocus++;
    try { focusWindow(windowId); return await focusKeyboardWindow(windowId); }
    finally { ownedWindowFocus--; }
  }
  async function restoreFullScreenFocus(windowId) {
    ownedWindowFocus++;
    try {
      if (windowId && switchingReturnFocus?.windowId && switchingReturnFocus.windowId !== windowId) {
        switchingReturnFocus = null;
        return await focusKeyboardWindow(windowId);
      }
      return await restoreSwitchingFocus();
    }
    finally { ownedWindowFocus--; }
  }
  async function restoreFullScreenPresentations(snapshot) {
    Object.assign(switching, snapshot.switching);
    if (snapshot.spaces) Object.assign(spaceState, snapshot.spaces);
    const order = new Map(snapshot.windowIds.map((id, index) => [id, index]));
    windows.sort((a, b) => order.get(a.id) - order.get(b.id));
    activeWindowId = snapshot.activeWindowId; activeAppId = snapshot.activeAppId;
    await restoreSwitchingPresentations(snapshot.base);
  }
  let stageDrag = null;
  function fullScreenKeydown(event) {
    if (!hasFullScreen || event.defaultPrevented || event.isComposing || !sceneInteractionsAvailable()
      || spaceState.overview || launchpadState.view || switching.switcher || !activeWindowId) return;
    const native = macDesktop ? event.metaKey && event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f'
      : event.key === 'F11' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    const alias = event.key === 'F9' && event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
    if (native || alias) {
      consumeSwitchingKey(event);
      if (!event.repeat) toggleWindowFullScreen(activeWindowId);
    }
  }
  function stagePointerDown(event) {
    if (spaceState.overview || launchpadState.view || fullScreenStage.mode !== 'split' || event.button !== 0 || !event.isPrimary) return;
    const target = event.target;
    if (!target?.closest?.('[data-window-drag]') || target.closest('button,input,textarea,select,a,[contenteditable],[data-window-no-drag]')) return;
    const id = target.closest('.managed-window')?.dataset.windowId;
    if (!fullScreenStage.windowIds.includes(id)) return;
    stageDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      side: fullScreenStage.leftWindowId === id ? 'left' : 'right', element: target.closest('[data-window-drag]') };
    stageDrag.element.setPointerCapture(event.pointerId);
  }
  function stagePointerUp(event) {
    const drag = stageDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    stageDrag = null;
    if (drag.element.hasPointerCapture(event.pointerId)) drag.element.releasePointerCapture(event.pointerId);
    if (spaceState.overview || launchpadState.view || event.type !== 'pointerup' || fullScreenStage.mode !== 'split' || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    const divider = stageArea.width * fullScreenStage.ratio;
    if (drag.side === 'left' ? event.clientX > divider : event.clientX < divider)
      commands.execute({ command: 'window.splitView.swap' });
  }
  function stagePointerMove(event) {
    if (spaceState.overview || launchpadState.view || fullScreenStage.mode === 'normal' || switching.switcher || !sceneInteractionsAvailable()) return;
    const topLocked = Boolean(presentation.greenMenu || switching.appMenu || desktopState.windowMenuOpen);
    const topLimit = presentation.revealed.top ? stageArea.menuHeight + 50 : 2;
    revealFullScreen('top', topLocked || event.clientY <= topLimit);
    const footer = document.querySelector(macDesktop ? '.dock, .sonoma-dock' : '.win11-taskbar');
    const bounds = footer?.getBoundingClientRect();
    const locked = Boolean(desktopState.dock?.context || desktopState.dock?.folderStack || desktopState.dock?.appWindows
      || desktopState.dock?.focusedItemId || nativeState?.shell.panel);
    const near = event.clientY >= (presentation.revealed.launcher ? (bounds?.top ?? stageArea.height - 80) - 8 : stageArea.height - 2);
    revealFullScreen('launcher', locked || near);
  }
  function resizeSplitView(event) {
    if (spaceState.overview || launchpadState.view || fullScreenStage.mode !== 'split') return;
    const ratio = Math.max(.2, Math.min(.8, event.clientX / stageArea.width));
    return commands.execute({ command: 'window.splitView.resize', payload: { ratio } });
  }
  function splitDividerDown(event) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    resizeSplitView(event);
  }
  function splitDividerMove(event) {
    if (event.currentTarget.hasPointerCapture(event.pointerId) && event.buttons) resizeSplitView(event);
  }
  function splitDividerUp(event) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function splitDividerKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || fullScreenStage.mode !== 'split') return;
    event.preventDefault(); event.stopPropagation();
    const ratio = event.key === 'Home' ? .2 : event.key === 'End' ? .8
      : Math.max(.2, Math.min(.8, fullScreenStage.ratio + (event.key === 'ArrowLeft' ? -.05 : .05)));
    commands.execute({ command: 'window.splitView.resize', payload: { ratio } });
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
    if (!node || !node.getClientRects().length || node.closest('[inert]') || getComputedStyle(node).visibility !== 'visible') return null;
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
  function captureNativeFocus() {
    const node = document.activeElement;
    const attributes = [...node.attributes].filter(attribute => attribute.name.startsWith('data-'));
    const selector = attributes.length
      ? node.localName + attributes.map(attribute => `[${attribute.name}="${CSS.escape(attribute.value)}"]`).join('')
      : node.id ? `#${CSS.escape(node.id)}` : null;
    return { node, selector, windowId: node.closest('[data-window-id]')?.dataset.windowId,
      selection: typeof node.selectionStart === 'number'
        ? { start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection } : null };
  }
  async function restoreNativeFocus(token) {
    await tick(); await tick();
    ownedWindowFocus++;
    try {
      const scope = token?.windowId ? managedWindowElement(token.windowId) : document;
      const original = token?.node?.isConnected ? token.node
        : token?.selector && scope ? scope.querySelector(token.selector) : null;
      if (original?.isConnected && typeof original.focus === 'function' && !original.closest('[inert]')
        && original.getClientRects().length && getComputedStyle(original).visibility === 'visible') {
        original.focus({ preventScroll: true });
        if (document.activeElement === original) {
          if (token.selection) original.setSelectionRange(token.selection.start, token.selection.end, token.selection.direction);
          return true;
        }
      }
      const current = windows.find(window => window.id === activeWindowId && !window.minimized && windowPresented(window));
      return current ? await focusKeyboardWindow(current.id) : await focusSceneWorkspace();
    } finally { ownedWindowFocus--; }
  }
  function captureSwitchingFocus() {
    switchingReturnFocus = captureNativeFocus();
  }
  async function restoreSwitchingFocus() {
    const token = switchingReturnFocus;
    switchingReturnFocus = null;
    return restoreNativeFocus(token);
  }
  function captureSpacesScene() {
    const scroll = [];
    for (const node of document.querySelectorAll('.managed-window, .managed-window *, [data-shell-switcher] *, [data-mission-control] *, [data-launchpad] *'))
      if (node.scrollTop || node.scrollLeft) scroll.push({ node, top: node.scrollTop, left: node.scrollLeft });
    return { state: $state.snapshot({ switching, presentation, desktop: desktopState, notesView: notesViewState, launchpad: launchpadState }),
      launchpadView: launchpadState.view,
      windowIds: windows.map(window => window.id), activeWindowId, activeAppId,
      focus: captureNativeFocus(), switchingReturnFocus, scroll };
  }
  async function restoreSpacesScene(snapshot) {
    Object.assign(switching, snapshot.state.switching);
    Object.assign(presentation, snapshot.state.presentation);
    Object.assign(desktopState, snapshot.state.desktop);
    if (notesViewState) Object.assign(notesViewState, snapshot.state.notesView);
    Object.assign(launchpadState, snapshot.state.launchpad);
    launchpadState.view = snapshot.launchpadView;
    if (snapshot.launchpadView) Object.assign(snapshot.launchpadView, snapshot.state.launchpad.view);
    const order = new Map(snapshot.windowIds.map((id, index) => [id, index]));
    windows.sort((a, b) => order.get(a.id) - order.get(b.id));
    activeWindowId = snapshot.activeWindowId; activeAppId = snapshot.activeAppId;
    switchingReturnFocus = snapshot.switchingReturnFocus;
    await tick(); await tick();
    await restoreNativeFocus(snapshot.focus);
    for (const { node, top, left } of snapshot.scroll) if (node.isConnected) node.scrollTo({ top, left, behavior: 'instant' });
    await tick();
  }
  function captureLaunchpadScene() {
    return { base: captureSpacesScene(), spaces: $state.snapshot(spaceState), overview: spaceState.overview,
      windows: windows.map(window => ({ reference: window, data: $state.snapshot(window) })),
      runningAppIds: [...runningAppIds], nextWindowId };
  }
  async function restoreLaunchpadScene(snapshot) {
    windows = snapshot.windows.map(({ reference, data }) => {
      for (const key of Object.keys(reference)) if (!Object.hasOwn(data, key)) delete reference[key];
      Object.assign(reference, data);
      return reference;
    });
    runningAppIds = [...snapshot.runningAppIds]; nextWindowId = snapshot.nextWindowId;
    Object.assign(spaceState, snapshot.spaces);
    spaceState.overview = snapshot.overview;
    if (snapshot.overview) Object.assign(snapshot.overview, snapshot.spaces.overview);
    await restoreSpacesScene(snapshot.base);
  }
  function launchpadKeydown(event) {
    if (!hasLaunchpad || event.defaultPrevented || event.isComposing || !sceneInteractionsAvailable()
      || event.key !== 'F11' || !event.ctrlKey || !event.shiftKey || event.metaKey || event.altKey) return;
    consumeSwitchingKey(event);
    if (!event.repeat) commands.execute({ command: launchpadState.view ? 'shell.launchpad.close' : 'shell.launchpad.open' });
  }
  async function activateManagedSpace(entry) {
    if (!hasSpaces || !sceneInteractionsAvailable()) return false;
    const candidates = windows.filter(window => entry.windowIds.includes(window.id) && !window.minimized
      && !isAppHidden(window.appId) && !pendingQuitAppIds.includes(window.appId));
    if (entry.type !== 'desktop' && !candidates.length) return false;
    spaceState.overview = null;
    spaceState.activeSpaceId = entry.spaceId;
    if (entry.type === 'desktop') spaceState.lastDesktopId = entry.spaceId;
    const foreground = switching.activationWindowIds.map(id => candidates.find(window => window.id === id)).find(Boolean)
      ?? candidates.at(-1);
    if (foreground) return focusFullScreenWindow(foreground.id);
    switching.switcher = null; switching.appMenu = null;
    activeWindowId = null; activeAppId = profile.defaults.desktopAppId;
    unhideApplication(activeAppId);
    recordApplicationActivation(switching, activeAppId);
    return focusSceneWorkspace();
  }
  async function settleSpaceForeground() {
    const current = windows.find(window => window.id === activeWindowId && !window.minimized
      && !isAppHidden(window.appId) && !pendingQuitAppIds.includes(window.appId)
      && windowSpaceId(spaceState, presentation, window) === spaceState.activeSpaceId);
    if (!current) {
      const candidates = windows.filter(window => !window.minimized && !isAppHidden(window.appId)
        && !pendingQuitAppIds.includes(window.appId)
        && windowSpaceId(spaceState, presentation, window) === spaceState.activeSpaceId);
      const foreground = switching.activationWindowIds.map(id => candidates.find(window => window.id === id)).find(Boolean)
        ?? candidates.at(-1);
      activeWindowId = foreground?.id ?? null;
      activeAppId = foreground?.appId ?? profile.defaults.desktopAppId;
    }
    await tick(); await tick();
    if (!sceneInteractionsAvailable()) return false;
    if (spaceState.overview) return missionControlControls?.available() === true;
    return activeWindowId ? focusFullScreenWindow(activeWindowId) : focusSceneWorkspace();
  }
  function spacesKeydown(event) {
    if (!hasSpaces || event.defaultPrevented || event.isComposing || !sceneInteractionsAvailable()
      || !event.ctrlKey || event.metaKey || event.altKey) return;
    const toggle = (!event.shiftKey && event.key === 'ArrowUp') || (event.shiftKey && event.key === 'F10');
    if (toggle) {
      consumeSwitchingKey(event);
      if (!event.repeat) commands.execute({ command: spaceState.overview ? 'shell.missionControl.close' : 'shell.missionControl.open' });
      return;
    }
    if (launchpadState.view || event.shiftKey || !['ArrowLeft', 'ArrowRight'].includes(event.key) || switching.switcher || presentation.pairing) return;
    consumeSwitchingKey(event);
    const index = spaceItems.findIndex(item => item.spaceId === spaceState.activeSpaceId);
    const destination = spaceItems[index + (event.key === 'ArrowLeft' ? -1 : 1)];
    if (destination && !event.repeat) commands.execute({ command: 'space.activate', target: { spaceId: destination.spaceId } });
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
      ...(hasSpaces ? { overview: spaceState.overview } : {}),
    });
    snapshot.overviewReference = spaceState.overview;
    snapshot.launchpadView = launchpadState.view;
    desktopState.context = null; desktopState.focusedControl = null;
    spaceState.overview = null;
    launchpadState.view = null;
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
    if (hasSpaces) {
      spaceState.overview = snapshot.overviewReference;
      if (snapshot.overviewReference) Object.assign(snapshot.overviewReference, snapshot.overview);
    }
    launchpadState.view = snapshot.launchpadView;
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
    cancelPairingForActivation(window?.id ?? null);
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
    if (event.type === 'focusin' && ownedWindowFocus) return;
    const target = event.target;
    if (launchpadState.view && event.type === 'pointerdown' && !target?.closest?.('[data-launchpad]'))
      commands.execute({ command: 'shell.launchpad.close', payload: { restoreFocus: false } });
    if (switching.switcher && !target?.closest?.('[data-shell-switcher]'))
      commands.execute({ command: 'shell.switcher.close', payload: { restoreFocus: false } });
    if (switching.appMenu && !target?.closest?.('[data-application-menu], [data-application-menu-button]'))
      commands.execute({ command: 'app.menu.close', payload: { restoreFocus: false } });
    if (presentation.greenMenu && !target?.closest?.('[data-window-green-menu], [data-window-green-control]'))
      commands.execute({ command: 'window.greenMenu.close', payload: { restoreFocus: false } });
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
    window.addEventListener('keydown', launchpadKeydown, true);
    window.addEventListener('keydown', spacesKeydown, true);
    window.addEventListener('keydown', fullScreenKeydown, true);
    document.addEventListener('pointermove', stagePointerMove, true);
    document.addEventListener('pointerdown', stagePointerDown, true);
    document.addEventListener('pointerup', stagePointerUp, true);
    document.addEventListener('pointercancel', stagePointerUp, true);
    window.addEventListener('keydown', switchingKeydown, true);
    window.addEventListener('keyup', switchingKeyup, true);
    window.addEventListener('blur', cancelHeldSwitcher);
    document.addEventListener('visibilitychange', switchingVisibility);
    document.addEventListener('pointerdown', switchingOutside, true);
    document.addEventListener('focusin', switchingOutside, true);
    return () => {
      disposed = true; stopScene?.(); unregister();
      window.removeEventListener('keydown', launchpadKeydown, true);
      window.removeEventListener('keydown', switchingKeydown, true);
      window.removeEventListener('keyup', switchingKeyup, true);
      window.removeEventListener('keydown', fullScreenKeydown, true);
      window.removeEventListener('keydown', spacesKeydown, true);
      document.removeEventListener('pointermove', stagePointerMove, true);
      document.removeEventListener('pointerdown', stagePointerDown, true);
      document.removeEventListener('pointerup', stagePointerUp, true);
      document.removeEventListener('pointercancel', stagePointerUp, true);
      if (stageDrag) stagePointerUp({ pointerId: stageDrag.pointerId, type: 'pointercancel' });
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
    if (presentation.greenMenu?.windowId !== id) presentation.greenMenu = null;
    cancelPairingForActivation(id);
    unhideApplication(window.appId);
    switching.switcher = null; switching.appMenu = null;
    window.minimized = false;
    spaceState.overview = null;
    launchpadState.view = null;
    if (hasSpaces) {
      reconcileFullScreenWindowing(presentation, windows, switching.hiddenAppIds, pendingQuitAppIds);
      reconcileSpaces(spaceState, presentation, windows, profile, switching.hiddenAppIds, pendingQuitAppIds, switching.creationWindowIds);
      spaceState.activeSpaceId = windowSpaceId(spaceState, presentation, window);
      if (!window.fullScreen) spaceState.lastDesktopId = window.spaceId;
    }
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
    if (fresh || !windows.some(window => window.appId === appId && !window.utilityKind)) cancelPairingForActivation(null);
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
      minimized: false, fullScreen: false, [expandedProperty]: false,
      bounds: adapter.initialBounds(app, area, windows.length, globalThis.innerHeight),
      restoreBounds: null,
      ...(hasSpaces ? { spaceId: spaceState.lastDesktopId } : {}),
      ...(macDesktop && appId === 'finder' ? { folderId: 'desktop' } : {}),
      ...(hasDockContext && appId === 'settings' ? { settingsPane: 'dock' } : {}),
    });
    if (!runningAppIds.includes(appId)) runningAppIds.push(appId);
    activeWindowId = id;
    activeAppId = appId;
    recordApplicationActivation(switching, appId, id, true);
    if (hasSpaces) spaceState.activeSpaceId = spaceState.lastDesktopId;
    if (hasDockContext) {
      recordMacAppUse(desktopState.dock, appId);
      dismissDockPresentation();
    }
    if (hasDesktopStacks) desktopState.stacks.focusedStackId = null;
    return id;
  }

  function focusRemaining() {
    const remaining = windows.findLast(window => !window.minimized && !isAppHidden(window.appId)
      && (!hasSpaces || windowSpaceId(spaceState, presentation, window) === spaceState.activeSpaceId)
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
    const pair = presentation.splitViews.find(entry => entry.leftWindowId === id || entry.rightWindowId === id);
    const partnerId = pair && (pair.leftWindowId === id ? pair.rightWindowId : pair.leftWindowId);
    const partner = windows.find(window => window.id === partnerId && window.fullScreen
      && !window.minimized && !isAppHidden(window.appId) && !pendingQuitAppIds.includes(window.appId));
    windows.splice(index, 1);
    adapter.releaseWindow?.(nativeState, id, appId);
    if (!adapter.closeKeepsRunning && !windows.some(window => window.appId === appId)) {
      runningAppIds = runningAppIds.filter(entry => entry !== appId);
    }
    if (activeWindowId === id) {
      if (partner) await focusFullScreenWindow(partner.id);
      else focusRemaining();
    }
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
        fullScreen={window.fullScreen}
        revealedTop={fullScreenStage.topRevealed}
        modernGreenMenu={profile.renderer === 'sonoma'}
        onfullscreen={() => toggleWindowFullScreen(window.id)}
        onsplitbegin={event => beginSplitView(window.id, event)}
        onsplitside={event => changeSplitSide(window.id, event)}
        ongreenmenu={() => windowCommand('window.greenMenu.open', window.id)}
        onfocus={() => { if (!ownedWindowFocus) windowCommand('window.focus', window.id, { keyboard: false }); }}
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
            fullScreen={window.fullScreen}
            revealedTop={fullScreenStage.topRevealed}
            modernGreenMenu={profile.renderer === 'sonoma'}
            onfullscreen={() => toggleWindowFullScreen(window.id)}
            onsplitbegin={event => beginSplitView(window.id, event)}
            onsplitside={event => changeSplitSide(window.id, event)}
            ongreenmenu={() => windowCommand('window.greenMenu.open', window.id)}
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
            fullScreen={window.fullScreen}
            revealedTop={fullScreenStage.topRevealed}
            modernGreenMenu={profile.renderer === 'sonoma'}
            onfullscreen={() => toggleWindowFullScreen(window.id)}
            onsplitbegin={event => beginSplitView(window.id, event)}
            onsplitside={event => changeSplitSide(window.id, event)}
            ongreenmenu={() => windowCommand('window.greenMenu.open', window.id)}
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
  {fullScreenStage}
  missionControlOpen={Boolean(spaceState.overview)}
  launchpadOpen={Boolean(launchpadState.view)}
  onfullscreenreveal={revealFullScreen}
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
  {#if !spaceState.overview && !launchpadState.view && fullScreenStage.mode !== 'normal'}
    <div class="stage-backdrop" aria-hidden="true" style:left="{stageArea.x}px" style:top="{stageArea.y}px"
      style:width="{stageArea.width}px" style:height="{stageArea.height}px"></div>
  {/if}
  {#each windows as window, index (window.id)}
    {@const projection = missionControlBounds[window.id] ?? switcherWindowBounds[window.id] ?? dockWindowBounds[window.id]
      ?? pairingWindowBounds[window.id] ?? fullScreenWindowBounds[window.id]}
    {#if !window.minimized || projection}
      {@render managedWindow(window, activeWindowId === window.id && !spaceState.overview && !launchpadState.view && !switching.switcher && !isAppHidden(window.appId),
        missionControlBounds[window.id] ? 12001 : switcherWindowBounds[window.id] ? 11001 : dockWindowBounds[window.id] ? 7001
          : pairingWindowBounds[window.id] ? 9101 : fullScreenWindowBounds[window.id] ? index + 2 : index + 1,
        projection, windowInteractive(window), windowVisible(window))}
    {/if}
  {/each}
  {#if spaceState.overview}
    <MissionControl {profile} state={spaceState.overview} spaces={spaceItems} windows={overviewWindows}
      activeSpaceId={spaceState.activeSpaceId} sceneRect={stageArea} execute={commands.execute}
      onlayout={slots => { missionControlSlots = slots; }} bind:this={missionControlControls} />
  {/if}
  {#if launchpadState.view}
    <Launchpad {profile} state={launchpadState} sceneRect={stageArea} execute={commands.execute} bind:this={launchpadControls} />
  {/if}
  {#if fullScreenStage.mode === 'pairing' && pairingRect}
    <SplitViewPicker {profile} state={presentation.pairing} items={pairingItems} rect={pairingRect}
      execute={commands.execute} onlayout={slots => { pairingPreviewSlots = slots; }} bind:this={pairingControls} />
  {/if}
  {#if !spaceState.overview && !launchpadState.view && fullScreenStage.mode === 'split'}
    <div class="split-divider" data-split-view-divider role="slider" aria-label="Resize Split View" aria-orientation="horizontal"
      aria-valuemin="20" aria-valuemax="80" aria-valuenow={Math.round(fullScreenStage.ratio * 100)} tabindex="0"
      style:left="{stageArea.x + stageArea.width * fullScreenStage.ratio - 2}px" style:top="{stageArea.y}px"
      style:height="{stageArea.height}px" onpointerdown={splitDividerDown} onpointermove={splitDividerMove}
      style:z-index={windows.length + 2}
      onpointerup={splitDividerUp} onpointercancel={splitDividerUp} onkeydown={splitDividerKey}
      ondblclick={() => commands.execute({ command: 'window.splitView.resize', payload: { ratio: .5 } })}></div>
  {/if}
  {#if presentation.greenMenu && greenMenuWindow && greenMenuAnchor}
    <WindowGreenMenu {profile} window={greenMenuWindow} state={presentation.greenMenu} items={greenMenuItems}
      anchor={greenMenuAnchor} execute={commands.execute} bind:this={greenMenuControls} />
  {/if}
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

<style>
  .stage-backdrop { position: absolute; z-index: 1; background: black; pointer-events: none; }
  .split-divider { position: absolute; width: 4px; background: #171717; cursor: col-resize; touch-action: none; outline: none; }
  .split-divider:focus-visible { background: #5797dc; }
</style>

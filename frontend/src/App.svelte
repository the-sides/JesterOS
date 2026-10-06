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
  import { dashboardDefaults, dashboardTargets, createDashboardCommands } from './dashboard.js';
  import Dashboard from './Dashboard.svelte';
  import DashboardPreferences from './DashboardPreferences.svelte';
  import { appearanceDefaults, appearanceTargets, createAppearanceCommands, applyAppearance } from './appearance.js';
  import MacAppearancePreferences from './MacAppearancePreferences.svelte';
  import { createDesktopCommands } from './desktop-commands.js';
  import { createDesktopItemCommands } from './desktop-item-commands.js';
  import { createDesktopContextCommands } from './desktop-context-commands.js';
  import { createDesktopStacksCommands } from './desktop-stacks-commands.js';
  import { desktopStacks as buildDesktopStacks, desktopStackLayout, desktopStacksDefaults, reconcileDesktopStacks } from './desktop-stacks-model.js';
  import { desktopViewDefaults, desktopContextItems, sortDesktopItems, readDesktopFileInfo, desktopFileSize } from './desktop-context-model.js';
  import { createMacDesktopFileStore, macDesktopItems, validMacDesktopName, nextMacFileTimestamp, liveMacFileRecords } from './desktop-file-state.js';
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
  import { appCommandMenuProviders } from './app-command-menus.js';
  import { APPLICATION_MENU_UTILITY_SIZES, goldenApplicationMenuItems, createApplicationMenuCommands } from './application-menu.js';
  import GoldenGateAboutApp from './GoldenGateAboutApp.svelte';
  import GoldenGateNotesSettings from './GoldenGateNotesSettings.svelte';
  import { createNotesFileCommands } from './notes-file-commands.js';
  import { createFileDialogCommands } from './file-dialog-commands.js';
  import GoldenGateFileSheet from './GoldenGateFileSheet.svelte';
  import GoldenGatePrintDialog from './GoldenGatePrintDialog.svelte';
  import GoldenGatePrintCenter from './GoldenGatePrintCenter.svelte';
  import { createFinderFileCommands } from './finder-file-commands.js';
  import { createTextEditingCommands, noteTextControlValue } from './text-editing-commands.js';
  import { createFinderEditing } from './finder-editing.js';
  import { createTextAssistance } from './text-assistance.js';
  import { createTextToolsCommands } from './text-tools-commands.js';
  import { selectNativeText, documentControlRange, controlDocumentOffset } from './text-native-selection.js';
  import { createNativeClipboardCommands } from './native-clipboard.js';
  import { validateViewing, notesViewProjection, finderPresentationDefaults, notesPresentationDefaults } from './viewing-state.js';
  import { createViewWorkflowCommands } from './view-workflow-commands.js';
  import { createWindowExtensionCommands } from './window-extension-commands.js';
  import { createHelpViewerCommands } from './help-viewer-commands.js';
  import GoldenGateHelpViewer from './GoldenGateHelpViewer.svelte';
  import { clampPosition, expandedBounds, resizeBounds, fitNormalBounds as fitRetainedBounds, WINDOW_RESIZE_AXES } from './window-state.js';
  import { getOSProfile, listOSProfiles } from './os-profiles.js';
  import { captureRetainedView, restoreRetainedView } from './retained-native-view.js';

  let { profile: profileInput, adapter: adapterInput, seed: seedInput, savedScene: savedSceneInput, registerCommands, selectProfile,
    registerSessionScene, registerSessionView, session, executeSession, menuBarState, menuBarMenus = [], dismissMenuBar, getMenuReturnFocus,
    foreground = true, appearanceOwner = true, windowNamespace = '' } = $props();
  let sceneRoot;
  // One immutable profile per scene instance. A profile change mounts a fresh
  // instance instead of relabeling incompatible application/view state.
  const profile = untrack(() => profileInput);
  const adapter = untrack(() => adapterInput);
  const seed = untrack(() => seedInput);
  const savedScene = untrack(() => savedSceneInput);
  const hasRetention = profile.capabilities.includes('scene.saved-session');
  const { Desktop, Window, MessagesWindow, NotesWindow, Applications } = adapter;
  const { applications } = profile;
  const macDesktop = profile.family === 'macos';
  const expandedProperty = adapter.expandedProperty;
  const hasMenuBar = profile.capabilities.includes('shell.menu-bar');
  const hasApplicationMenu = profile.capabilities.includes('shell.application-menu');
  const hasFileWorkflows = profile.capabilities.includes('shell.file-workflows');
  const hasEditWorkflows = profile.capabilities.includes('shell.edit-workflows');
  const hasViewWorkflows = profile.capabilities.includes('shell.view-workflows');
  const hasWindowExtensions = profile.capabilities.includes('shell.window-extensions');
  const hasHelpWorkflows = profile.capabilities.includes('shell.help-workflows');
  const hasWindowMenu = profile.capabilities.includes('shell.window-menu') && !hasMenuBar;
  const hasWindowResize = profile.capabilities.includes('shell.window-resize');
  const hasDesktopStacks = profile.capabilities.includes('shell.desktop-stacks');
  const hasDockContext = profile.capabilities.includes('shell.dock-context');
  const hasFullScreen = profile.capabilities.includes('shell.full-screen');
  const hasSpaces = profile.capabilities.includes('shell.mission-control');
  const hasLaunchpad = profile.capabilities.includes('shell.launchpad');
  const hasDashboard = profile.capabilities.includes('shell.dashboard');
  const hasAppearance = profile.capabilities.includes('shell.appearance');
  const modernMac = macDesktop && profile.capabilities.includes('shell.window-green-menu');
  const resizeEdges = Object.keys(WINDOW_RESIZE_AXES);
  const desktopUtilityApps = macDesktop ? {
    'desktop-info': { ...applications.finder, width: 360, height: 560, minimumSize: { width: 300, height: 300 } },
    'desktop-view-options': { ...applications.finder, width: 384, height: 500, minimumSize: { width: 360, height: 340 } },
  } : {};

  let windows = $state(savedScene?.windows ?? []);
  let activeWindowId = $state(savedScene?.activeWindowId ?? null);
  let activeAppId = $state(savedScene?.activeAppId ?? profile.defaults.desktopAppId);
  let runningAppIds = $state(savedScene?.runningAppIds ?? (adapter.closeKeepsRunning ? [profile.defaults.desktopAppId] : []));
  let pendingQuitAppIds = $state([]);
  const quitInFlight = new Set();
  let switching = $state({ ...applicationSwitchingDefaults(profile), ...savedScene?.switching });
  let closedWindows = $state(savedScene?.closedWindows ?? {});
  const pendingWindowViews = new Map(Object.entries(savedScene?.views ?? {}));
  const applicationUtilityReturnFocus = new Map();
  let fileDialogState = $state({ current: null });
  let fileDialogControls = $state();
  let fileDialogController = $state();
  let clipboardState = $state({ kind: 'empty', text: '', fileIds: [] });
  let textToolsState = $state({ find: null, panel: null, spelling: null, liveSpelling: null, error: null });
  let editingEpoch = $state(0), dictionaryStatus = $state('idle');
  let textEditing, finderEditing, nativeClipboard, windowExtensions;
  let textTools = $state.raw(null);
  let viewWorkflows = $state.raw(null);
  let viewPresentation = $state({ options: null, nextOptionsId: 1, error: null });
  let helpPane = $state(null), helpView = $state(null), helpViewer = $state.raw(null);
  $effect(() => { if (helpViewer) { foreground; activeAppId; switching.switcher; presentation.pairing; fileDialogState.current; helpViewer.reconcile(); } });
  let editingPreferenceRevision = 0, fileHistoryBatch = 0;
  const textAssistance = hasEditWorkflows ? createTextAssistance() : null;
  const textInputSelections = new WeakMap();
  $effect(() => {
    if (hasFileWorkflows && !foreground) fileDialogController?.suspend();
  });
  $effect(() => {
    const options = viewPresentation.options;
    if (!hasViewWorkflows || !options || !viewWorkflows) return;
    const window = windows.find(window => window.id === options.windowId);
    if (!foreground || !window || window.minimized || isAppHidden(window.appId)
      || pendingQuitAppIds.includes(window.appId) || window.folderId !== options.folderId
      || !liveFile(macFiles, options.folderId)) viewWorkflows.dismissOptions();
  });
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
  let nextWindowId = savedScene?.nextWindowId ?? 1;
  let disposed = false;
  let area = $state({ width: 0, height: 0 });
  let presentation = $state({ ...fullScreenDefaults(), ...(savedScene ? { splitViews: savedScene.splitViews } : {}) });
  let spaceState = $state({ ...spacesDefaults(), ...savedScene?.spaces });
  let missionControlControls = $state();
  let missionControlSlots = $state({});
  let launchpadState = $state(launchpadDefaults(profile));
  let launchpadControls = $state();
  let dashboardState = $state(dashboardDefaults(profile));
  let dashboardControls = $state();
  let dashboardReturnState = null;
  const dashboardOpen = $derived(Boolean(dashboardState.view));
  const spaceItems = $derived(hasSpaces ? spacesItems(spaceState, presentation, windows, profile,
    switching.hiddenAppIds, pendingQuitAppIds, dashboardState) : []);
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
      pendingQuitAppIds, switching.creationWindowIds, dashboardState);
    const foreground = windows.find(window => window.id === activeWindowId && !window.minimized
      && !isAppHidden(window.appId) && !pendingQuitAppIds.includes(window.appId));
    if (!spaceState.overview && !dashboardOpen && foreground) {
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
  const initialData = profile.renderer === 'golden-gate' ? adapter.createSceneData(savedScene?.seed ?? seed, profile) : adapter.createSceneData();
  let notesState = $state(initialData.notes);
  let nativeState = $state(initialData.native);
  let messagesState = $state(initialData.messages);
  let appearanceState = $state(macDesktop ? initialData.appearance ?? appearanceDefaults(profile) : undefined);
  let printingState = $state(hasFileWorkflows ? initialData.printing : undefined);
  let editingPreferences = $state(hasEditWorkflows ? initialData.editing : undefined);
  let viewing = $state(hasViewWorkflows ? initialData.viewing : undefined);
  const notesProjection = $derived(hasViewWorkflows ? notesViewProjection(notesState, viewing) : notesState);
  $effect(() => {
    if (appearanceOwner) return applyAppearance(document.documentElement, profile, macDesktop ? appearanceState
      : { mode: nativeState.apps.settings.theme, accent: nativeState.apps.settings.accent });
  });
  let macFiles = $state(macDesktop ? createMacSceneFiles() : undefined);
  const liveGoldenFiles = $derived(profile.renderer === 'golden-gate' ? liveMacFileRecords(macFiles) : null);
  const desktopFileStore = macDesktop ? macFiles : nativeState.apps;
  const desktopFilePolicy = macDesktop ? { validateName: validMacDesktopName } : {};
  const desktopFileCommands = createFileCommands(desktopFileStore, desktopFilePolicy);
  let desktopState = $state({ selectedFileIds: [], selectionAnchorId: null, rename: null, marquee: null, positions: {},
    context: null, sortBy: 'none', viewOptions: desktopViewDefaults(profile.family, profile.renderer),
    focusedControl: null, ...savedScene?.desktop,
    ...(hasDesktopStacks ? { stacks: { ...desktopStacksDefaults(), ...savedScene?.desktop.stacks } } : {}),
    ...(hasDockContext ? { dock: { ...macDockDefaults(profile), ...initialData.dock, ...savedScene?.dockOrder } } : {}),
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
  let notesViewState = $state(initialData.notes ? { context: null, contextItem: null, focusedControl: null,
    scroll: savedScene?.notesScroll ?? { list: { top: 0, left: 0 }, editor: { top: 0, left: 0 } } } : undefined);
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
  let notesView = $state.raw(null);
  const applicationViews = new Map();
  let initialized = $state(false);
  let starting = false;
  let startup = Promise.resolve(null);
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
      setFinderFolder(window, folder.id); window.title = folder.name;
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
      if (applications[appId]?.presentation !== 'dashboard') dismissDashboard();
      clearNotesPresentation();
    },
  }));
  if (hasDockContext) Object.assign(handlers, createMacDockFolderCommands(desktopState, {
    getStore: () => macFiles, available: sceneInteractionsAvailable, getView: () => dockFolderView,
    invoke: (command, target, payload) => handlers[command](target, payload),
    dismissMenus: () => {
      desktopState.context = null; desktopState.rename = null;
      dismissMenuBar?.();
      if (hasWindowMenu) { desktopState.windowMenuOpen = false; desktopState.windowMenuItem = null; }
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
    ...(!hasMenuBar ? {
    appMenuAnchor: applicationHeaderRect,
    appMenuFocus: itemId => applicationMenuControls?.focus(itemId) ?? false,
    appMenuFocusedItemId: () => document.activeElement?.closest('[data-application-menu]') ? document.activeElement.dataset.applicationMenuItem ?? null : null,
    appMenuItemIds: () => applicationMenuControls?.itemIds() ?? [],
    appMenuScroll: top => applicationMenuControls?.scroll(top) ?? null,
    appMenuScrollPosition: () => applicationMenuControls?.scrollPosition() ?? null,
    appMenuBounds: () => applicationMenuControls?.bounds() ?? null,
    appMenuReturnFocus: focusApplicationHeader,
    } : {}),
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
    getDashboard: () => dashboardState,
    available: () => sceneInteractionsAvailable() && Boolean(desktopView && stageArea.width > 0 && stageArea.height > 0),
    settle: async () => { await tick(); await tick(); }, getView: () => missionControlControls,
    captureScene: captureSpacesScene, restoreScene: restoreSpacesScene,
    dismissPresentations: () => {
      if (stageDrag) stagePointerUp({ pointerId: stageDrag.pointerId, type: 'pointercancel' });
      clearSwitchingPresentations(true); switching.switcher = null; if (!hasMenuBar) switching.appMenu = null;
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
      clearSwitchingPresentations(); switching.switcher = null; if (!hasMenuBar) switching.appMenu = null;
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
    isPresentationFocused: kind => kind === 'dashboard' && Boolean(dashboardState.view)
      && dashboardControls?.available() === true && Boolean(document.activeElement?.closest('[data-dashboard]')),
  }));
  if (hasDashboard) Object.assign(handlers, createDashboardCommands({
    profile, state: dashboardState,
    available: () => sceneInteractionsAvailable() && Boolean(desktopView && stageArea.width > 0 && stageArea.height > 0),
    settle: async () => { await tick(); await tick(); }, getView: () => dashboardControls,
    captureScene: captureLaunchpadScene, restoreScene: restoreLaunchpadScene,
    captureFocus: captureNativeFocus, restoreFocus: restoreNativeFocus,
    captureReturn: () => ({ spaceId: spaceState.activeSpaceId, windowId: activeWindowId, appId: activeAppId }),
    dismissPresentations: () => {
      clearSwitchingPresentations(); switching.switcher = null; if (!hasMenuBar) switching.appMenu = null;
      cancelPairingForActivation(null); presentation.greenMenu = null;
      presentation.revealed = { top: false, launcher: false };
    },
    enterSpace: async () => {
      dashboardReturnState = { spaceId: spaceState.activeSpaceId, windowId: activeWindowId, appId: activeAppId };
      spaceState.activeSpaceId = 'dashboard'; activeWindowId = null;
      await tick(); return sceneInteractionsAvailable();
    },
    leaveSpace: async prior => { restoreDashboardSpace(prior); await tick(); return sceneInteractionsAvailable(); },
    focusReturn: async prior => {
      if (prior?.windowId && windows.some(window => window.id === prior.windowId && !window.minimized && windowPresented(window)))
        return focusKeyboardWindow(prior.windowId);
      return focusSceneWorkspace();
    },
    modeChanged: () => reconcileSpaces(spaceState, presentation, windows, profile, switching.hiddenAppIds,
      pendingQuitAppIds, switching.creationWindowIds, dashboardState),
    openPreferences: openDashboardPreferences,
  }));
  if (hasAppearance) Object.assign(handlers, createAppearanceCommands({
    profile, state: appearanceState, available: sceneInteractionsAvailable,
    settle: async () => { await tick(); await tick(); }, openPreferences: openAppearancePreferences,
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
          ? !presentation.greenMenu && !switching.appMenu && !desktopState.windowMenuOpen && !menuBarState?.menuId
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
      includeWindowMenu: !hasMenuBar,
      windowMenuAvailable: () => !spaceState.overview && !launchpadState.view && !dashboardOpen && (fullScreenStage.mode === 'normal' || fullScreenStage.topRevealed),
      getFiles: () => macDesktop ? (liveGoldenFiles ?? macFiles.files.filter(file => !isTrashed(macFiles, file)))
        .map(file => ({ ...file, appId: file.appId ?? (file.kind === 'folder' ? 'finder' : 'preview') })) : getDesktopItems(),
      getItems: getDesktopItems,
      openedFile: (windowId, file) => {
        if (!macDesktop) return;
        const window = windows.find(window => window.id === windowId);
        liveFile(macFiles, file.id).lastOpenedAt = nextMacFileTimestamp(macFiles);
        if (file.kind === 'application') return;
        if (file.kind === 'folder') setFinderFolder(window, file.id);
        else window.fileId = file.id;
      },
      focusDesktop,
      openApp: (target, payload) => handlers['app.open'](target, payload),
      windowAction: (command, target, payload) => handlers[command](target, payload),
    }),
  );
  if (notesState) Object.assign(handlers, createNotesCommands(notesState, notesViewState, {
    getView: () => notesView, focusWindow: () => focusWindow(windows.find(window => window.appId === 'notes' && !window.utilityKind).id),
    prepareFocus: target => {
      if (!hasViewWorkflows || !['title', 'body'].includes(target.control)) return;
      const window = windows.find(window => window.appId === 'notes' && !window.utilityKind);
      if (window?.notesPresentation) window.notesPresentation.documentVisible = true;
    },
    isVisible: () => sceneInteractionsAvailable() && !spaceState.overview && !launchpadState.view && !dashboardOpen && !desktopState.dock?.appWindows && !switching.switcher && !presentation.pairing
      && windows.some(window => window.appId === 'notes' && !window.utilityKind && !window.minimized && windowPresented(window)),
  }));
  if (hasEditWorkflows) {
    textEditing = createTextEditingCommands(notesState, clipboardState, {
      available: windowInteractionsAvailable, dataAvailable: sceneCoreAvailable, getSource: ownedTextSource,
      prepare: target => prepareOwnedText(target),
      finishSelection: finishOwnedTextSelection,
      canCommitNote: (note, text) => workflowTextSize() - note.text.length + text.length - notesState.search.length <= 4 * 1024 * 1024,
      canCommitSearch: query => workflowTextSize() - notesState.search.length + query.length <= 4 * 1024 * 1024,
      onChanged: () => editingEpoch++,
    });
    Object.assign(handlers, textEditing.handlers);
    const ownedTextTools = createTextToolsCommands(textToolsState, editingPreferences, clipboardState, textAssistance, {
      available: windowInteractionsAvailable, getDocument: ownedTextDocument, getNotesWindow: ownedNotesWindow,
      getToolInput: ownedToolInput, focusTool: focusOwnedTool, finishToolSelection: finishToolSelection,
      prepareDocument: target => prepareOwnedText({ ...target, control: 'body' }),
      revealMatch: revealNoteMatch, invoke: (command, target, payload, label) => command === 'notes.edit'
        ? textEditing.editDocument(target.noteId, payload.text, label) : handlers[command](target, payload),
      captureReturn: () => captureNativeFocus(),
      isReturnCurrent: textToolReturnCurrent,
      getDocumentSelection: documentSelectionTarget,
      prepareAssistance: prepareTextDictionary, onPreferencesChanged: () => editingPreferenceRevision++,
      restoreReturn: restoreTextToolReturn,
      canCommitPreferences: next => workflowTextSize() - persistentStringUnits(editingPreferences) + persistentStringUnits(next) <= 4 * 1024 * 1024,
      onChanged: () => editingEpoch++,
    });
    textTools = ownedTextTools;
    Object.assign(handlers, ownedTextTools.handlers);
  }
  if (hasFileWorkflows) {
    let fontBytes;
    const fontLoader = () => fontBytes ??= (async () => {
      const response = await fetch(`${import.meta.env.BASE_URL}fonts/LiberationSans-Regular.ttf`);
      if (!response.ok) throw new Error('The bundled PDF font is unavailable.');
      return new Uint8Array(await response.arrayBuffer());
    })().catch(error => { fontBytes = undefined; throw error; });
    const fileCommands = createNotesFileCommands(notesState, macFiles, printingState, {
      available: fileWorkflowsAvailable, fontLoader,
      captureLease: () => fileDialogController.captureLease(),
      otherTextSize: fileWorkflowOtherTextSize,
      isNotesVisible: () => !fileDialogState.current && Boolean(notesView)
        && windows.some(window => window.appId === 'notes' && !window.utilityKind && !window.minimized && windowPresented(window)),
      prepareNotesFocus: async () => {
        const window = windows.find(window => window.appId === 'notes' && !window.utilityKind && !window.minimized && windowPresented(window));
        if (!window) return false;
        focusWindow(window.id);
        if (hasViewWorkflows) window.notesPresentation.documentVisible = true;
        return focusApplicationServiceBody(window.id);
      },
      notesCreated: async (noteId, focus) => {
        clearNotesPresentation();
        await tick(); await tick();
        if (focus && sceneInteractionsAvailable() && notesState.selectedId === noteId) {
          const window = windows.find(window => window.id === activeWindowId && window.appId === 'notes' && !window.utilityKind);
          if (window) await focusApplicationServiceBody(window.id, noteId);
        }
        const control = document.activeElement?.dataset?.notesControl;
        notesViewState.focusedControl = ['title', 'body', 'search'].includes(control) ? { control } : null;
      },
    });
    Object.assign(handlers, fileCommands);
    const fileDialog = createFileDialogCommands({
      state: fileDialogState, files: macFiles, getIdPrefix: () => windowNamespace, fontLoader,
      alive: () => !disposed, available: fileWorkflowsAvailable, getSource: fileDialogSource,
      getView: () => fileDialogControls, captureReturn: captureSessionDesktop,
      settle: async () => { await tick(); await tick(); },
      restoreReturn: async (snapshot, dialog) => {
        if (!sceneInteractionsAvailable() || activeWindowId !== dialog.windowId) return false;
        if (notesState.selectedId === dialog.noteId) return restoreSessionDesktop(snapshot);
        return focusKeyboardWindow(dialog.windowId);
      },
      invoke: (command, target, payload) => fileCommands[command](target, payload),
    });
    fileDialogController = fileDialog;
    Object.assign(handlers, fileDialog.handlers);
    const finderContext = {
      files: macFiles, available: windowInteractionsAvailable,
      getWindow: windowId => activeAppId === 'finder' && activeWindowId === windowId
        ? windows.find(window => window.id === windowId && window.appId === 'finder' && !window.utilityKind
          && !window.minimized && windowPresented(window)) : null,
      canAddFiles: canAddWorkflowFiles,
      canReplaceFiles: canReplaceWorkflowFiles,
      openFile: fileId => handlers['desktop.open']({ fileId }, {}),
      navigate: (windowId, folderId) => handlers['desktop.folder.navigate']({ windowId, folderId }, {}),
      openInfo: fileId => openDesktopUtility('desktop-info', fileId),
      getDesktopSelection: () => activeAppId === 'finder' && activeWindowId === null ? desktopState.selectedFileIds : null,
      selectDesktop: fileId => { desktopState.selectedFileIds = [fileId]; desktopState.selectionAnchorId = fileId; },
    };
    if (hasEditWorkflows) {
      finderEditing = createFinderEditing({ ...finderContext, clipboard: clipboardState, onChanged: () => editingEpoch++,
        filesChanged: reconcileFinderLocations,
        selectDesktop: fileIds => { desktopState.selectedFileIds = [...fileIds]; desktopState.selectionAnchorId = fileIds[0] ?? null; } });
      finderContext.editingHistory = finderEditing;
      Object.assign(handlers, finderEditing.handlers);
    }
    Object.assign(handlers, createFinderFileCommands(finderContext));
    handlers['notes.document.create'] = async (target, payload) => {
      if (Object.keys(target).length || Object.keys(payload).length)
        return rejected('invalid_arguments', 'Use an empty New Note target and payload.');
      if (!windowInteractionsAvailable()) return rejected('unavailable', 'New Note is unavailable.');
      const time = notesState.notes.reduce((latest, note) => Math.max(latest, note.createdAt, note.updatedAt), notesState.timeBase);
      let number = notesState.notes.length + 1;
      while (notesState.notes.some(note => note.id === `note-${number}`) && number < Number.MAX_SAFE_INTEGER - 1) number++;
      const noteId = `note-${number}`;
      const record = { id: noteId, text: '', pinned: false, deleted: false, createdAt: time + 1, updatedAt: time + 1 };
      const delta = persistentStringUnits(record) + String(notesState.notes.length).length
        + noteId.length - (notesState.selectedId?.length ?? 0) + 'notes'.length - notesState.folder.length - notesState.search.length;
      if (notesState.notes.length >= 1024 || time >= 8_640_000_000_000_000 - 1 || number >= Number.MAX_SAFE_INTEGER - 1
        || workflowTextSize() + delta > 4 * 1024 * 1024)
        return rejected('limit_exceeded', 'New Note exceeds the bounded scene record, clock or content budget.');
      const opened = await handlers['app.open']({ appId: 'notes' }, {});
      if (opened.status !== 'applied') return opened;
      const created = await handlers['notes.create']({}, { focus: true });
      return created.status === 'applied'
        ? { status: 'applied', target: { noteId: created.target.noteId, windowId: opened.target.windowId } } : created;
    };
  }
  if (hasEditWorkflows) {
    nativeClipboard = createNativeClipboardCommands(clipboardState, {
      getControl: ownedDraftControl, prepare: prepareOwnedDraft, finish: finishOwnedDraft,
      onChanged: () => editingEpoch++,
    });
    Object.assign(handlers, nativeClipboard.handlers);
  }
  if (hasViewWorkflows) {
    const ownedViewWorkflows = createViewWorkflowCommands(viewing, viewPresentation, {
      available: windowInteractionsAvailable,
      windowAvailable: viewWindowAvailable,
      getWindow: id => windows.find(window => window.id === id) ?? null,
      getNotes: () => notesState, getFiles: () => macFiles,
      prepare: async windowId => {
        if (!viewWindowAvailable(windowId)) return false;
        await tick(); await tick();
        return viewWindowAvailable(windowId);
      },
      selectNote: (_windowId, noteId) => handlers['notes.select']({ noteId }, {}),
      finishNotes: finishNotesView, finishFinder: finishFinderView,
      captureFocus: captureNativeFocus,
      restoreFocus: (token, guard) => (!guard || guard()) && sceneInteractionsAvailable()
        ? restoreNativeFocus(token) : false,
      focusOptions: focusFinderViewOptions, scrollOptions: scrollFinderViewOptions,
      getOptionsControls: finderViewOptionsControls,
      validateCandidate: next => validateViewing(next, { notes: notesState, files: macFiles }, profile).ok
        && workflowTextSize() - persistentStringUnits(viewing) + persistentStringUnits(next) <= 4 * 1024 * 1024,
      changed: () => editingEpoch++,
    });
    viewWorkflows = ownedViewWorkflows;
    Object.assign(handlers, ownedViewWorkflows.handlers);
  }
  if (hasWindowExtensions) {
    windowExtensions = createWindowExtensionCommands({
      available: () => windowInteractionsAvailable() && !switching.switcher && !presentation.pairing,
      getWindows: () => windows, getActiveAppId: () => activeAppId,
      getActiveWindowId: () => activeWindowId, getActiveSpaceId: () => spaceState.activeSpaceId,
      isRegistered: appId => Boolean(applications[appId] && runningAppIds.includes(appId)),
      isHidden: isAppHidden, isQuitting: appId => pendingQuitAppIds.includes(appId), isPresented: windowPresented,
      captureFocus: captureNativeFocus,
      prepare: async () => { await tick(); await tick(); return windowInteractionsAvailable(); },
      setWindows: next => { dismissMenuBar?.(); windows = next; },
      activate: focusWindow,
      finish: async (windowId, focus) => {
        await tick(); await tick();
        if (!windowInteractionsAvailable() || activeWindowId !== windowId) return;
        const element = managedWindowElement(windowId);
        if (element && focus?.node?.isConnected && element.contains(focus.node))
          await restoreNativeFocus(focus);
        else await focusKeyboardWindow(windowId);
      },
    });
    Object.assign(handlers, windowExtensions.handlers);
  }
  if (hasHelpWorkflows) {
    const ownedHelpViewer = createHelpViewerCommands({
      profile, namespace: untrack(() => windowNamespace || 'local'),
      getPane: () => helpPane, setPane: pane => { helpPane = pane; },
      getActiveAppId: () => activeAppId,
      available: () => windowInteractionsAvailable() && !switching.switcher && !presentation.pairing,
      getView: () => helpView,
      captureFocus: captureNativeFocus, restoreFocus: (token, guard) => (!guard || guard()) && sceneInteractionsAvailable() ? restoreNativeFocus(token) : false,
      settle: async () => { await tick(); await tick(); },
    });
    helpViewer = ownedHelpViewer;
    Object.assign(handlers, ownedHelpViewer.handlers);
  }
  if (hasApplicationMenu) Object.assign(handlers, createApplicationMenuCommands({
    profile, notes: notesState,
    available: () => windowInteractionsAvailable() && !switching.switcher && !presentation.pairing,
    getActiveAppId: () => activeAppId, getRunningAppIds: () => runningAppIds,
    isHidden: isAppHidden, isQuitting: appId => pendingQuitAppIds.includes(appId),
    openPanel: openApplicationUtility, getPanel: getApplicationPanel, focusPanel: focusApplicationPanel,
    getSource: applicationServiceSource, captureFocus: captureNativeFocus,
    focusServiceBody: focusApplicationServiceBody,
    restoreFocus: (token, windowId) => sceneInteractionsAvailable() && activeWindowId === windowId
      ? restoreNativeFocus(token) : false,
    noteCreated: () => {
      clearNotesPresentation();
      notesViewState.focusedControl = { control: 'body' };
    },
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
  const sceneCatalog = Object.fromEntries(Object.entries(commandCatalog).filter(([name, descriptor]) =>
    descriptor.profiles.includes(profile.id) && !descriptor.capability.startsWith('session.')
    && !['scene.seed', 'scene.saved-session', 'shell.menu-bar'].includes(descriptor.capability)
    && !(hasMenuBar && (name.startsWith('menu.') || name.startsWith('app.menu.') || name === 'desktop.scroll'))));
  // Composite callbacks capture this binding, so they use the same sealed,
  // capability-guarded registry after native profile selection.
  handlers = Object.fromEntries(Object.entries(handlers).filter(([name]) => Object.hasOwn(sceneCatalog, name)));
  const commands = createFeatureCommands(handlers,
    () => $state.snapshot({ profile, windows, activeWindowId, activeAppId, runningAppIds, pendingQuitAppIds, switching, presentation, area, desktop: desktopState,
      ...(hasSpaces ? { spaces: spaceState } : {}),
      ...(hasLaunchpad ? { launchpad: launchpadState } : {}),
      ...(hasDashboard ? { dashboard: dashboardState } : {}),
      ...(hasAppearance ? { appearance: appearanceState } : {}),
      ...(notesState ? { notes: notesState, notesView: notesViewState } : {}),
      ...(messagesState ? { messages: messagesState } : {}),
      ...(macFiles ? { files: macFiles.files } : {}),
      ...(hasFileWorkflows ? { printing: printingState, fileDialog: fileDialogState.current } : {}),
      ...(hasEditWorkflows ? { editing: editingTargets(), textTools: textTools.targets() } : {}),
      ...(hasViewWorkflows ? { viewing, viewPresentation: viewingTargets() } : {}),
      ...(hasWindowExtensions ? { windowExtensions: windowExtensions.targets() } : {}),
      ...(hasHelpWorkflows ? { helpViewer: helpViewer.targets() } : {}),
      ...(nativeState ? { native: nativeState } : {}),
      ...(hasRetention ? { retention: { closedWindows, automaticPersistence: false, reopen: 'last-ordinary-window-current-desktop' } } : {}),
    }),
    settleCommands, sceneCatalog, () => ({
      profiles: listOSProfiles().map(({ id, name, family, version }) => ({ profileId: id, name, family, version })),
      ...(hasAppearance ? { appearance: appearanceTargets(profile, appearanceState) } : {
        appearance: { mode: nativeState.apps.settings.theme, accent: nativeState.apps.settings.accent,
          scope: 'full', highlight: null, customHighlight: false,
          commands: { preference: 'win11.settings.preference', preferences: 'win11.settings.navigate' },
          preferenceControls: { mode: 'theme', accent: 'accent' }, preferencesPage: 'colors' },
      }),
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
        locations: (liveGoldenFiles ? liveGoldenFiles.filter(file => file.kind === 'folder')
          : macFiles.files.filter(file => file.kind === 'folder' && !isTrashed(macFiles, file))).map(({ id, name, parentId, readOnly }) => ({ folderId: id, name, parentId, dropAllowed: id !== 'trash' && !readOnly })),
        files: (liveGoldenFiles ?? macFiles.files.filter(file => !isTrashed(macFiles, file))).map(({ id, name, parentId, kind, createdAt, modifiedAt, addedAt, lastOpenedAt, tags }) =>
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
        ...(!hasMenuBar ? { applicationMenu: switching.appMenu ? { ...switching.appMenu, items: appMenuItems.map(item => ({ ...item })),
          bounds: applicationMenuControls?.bounds() ?? null } : null } : {}),
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
      ...(hasDashboard ? { dashboard: {
        ...dashboardTargets(dashboardState),
        view: dashboardState.view ? { ...$state.snapshot(dashboardState.view),
          itemIds: dashboardControls?.itemIds() ?? [], bounds: dashboardControls?.bounds() ?? null } : null,
        shortcuts: { alias: 'Control+Shift+F12', nativeDelivery: 'Only delivered scene-local events; configurable native shortcut/Hot Corners are not installed on the host.' },
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
        ...(hasViewWorkflows && window.finderPresentation ? { finderPresentation: { ...window.finderPresentation } } : {}),
        ...(hasViewWorkflows && window.notesPresentation ? { notesPresentation: { ...window.notesPresentation } } : {}),
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
      ...(hasApplicationMenu ? { applicationMenu: applicationMenuTargets() } : {}),
      ...(hasFileWorkflows ? { fileDialog: $state.snapshot(fileDialogController.targets()), printing: {
        printerId: 'studio-printer', printerName: 'Studio Printer', fictional: true,
        jobs: printingState.jobs.map(({ id, title, status, copies, pageCount, pageFrom, pageTo, printedPages }) =>
          ({ jobId: id, title, status, copies, pageCount, pageFrom, pageTo, printedPages })),
      } } : {}),
      ...(hasEditWorkflows ? { editing: editingTargets() } : {}),
      ...(hasViewWorkflows ? { viewing: viewingTargets() } : {}),
      ...(hasWindowExtensions ? { windowExtensions: windowExtensions.targets() } : {}),
      ...(hasHelpWorkflows ? { helpViewer: helpViewer.targets() } : {}),
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
    if (dashboardState.view && dashboardControls?.available()) {
      const actual = dashboardControls.scrollPosition();
      if (actual && (actual.top !== dashboardState.view.scroll.top || actual.left !== dashboardState.view.scroll.left))
        dashboardState.view.scroll = { ...actual };
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

  function sceneCoreAvailable() {
    return !disposed && (foreground || starting || !initialized) && (adapter.windowInteractionsAvailable?.(nativeState) ?? true);
  }
  function sceneInteractionsAvailable() {
    return sceneCoreAvailable() && !fileDialogState.current;
  }
  function fileWorkflowsAvailable() {
    return sceneCoreAvailable() && !desktopState.dock?.appWindows && !spaceState.overview && !launchpadState.view
      && !dashboardOpen && !switching.switcher && !presentation.pairing;
  }
  function windowInteractionsAvailable() {
    return sceneInteractionsAvailable() && !desktopState.dock?.appWindows && !spaceState.overview && !launchpadState.view && !dashboardOpen;
  }

  function getApplicationView(windowId) {
    if (!windowInteractionsAvailable() || switching.switcher || presentation.pairing) return undefined;
    return windows.some(window => window.id === windowId && !window.minimized && windowPresented(window))
      ? applicationViews.get(windowId)
      : undefined;
  }

  function managedWindowElement(id) {
    return [...(sceneRoot?.querySelectorAll('.managed-window[data-window-id]') ?? [])].find(element => element.dataset.windowId === id);
  }
  async function focusKeyboardWindow(id) {
    await tick();
    const element = managedWindowElement(id);
    if (!element || element.closest('[inert]') || getComputedStyle(element).visibility !== 'visible') return false;
    element.focus({ preventScroll: true });
    if (hasRetention && pendingWindowViews.has(id)) {
      restoreRetainedView(element, pendingWindowViews.get(id), { noteId: notesState.selectedId, focus: foreground });
      pendingWindowViews.delete(id);
    }
    return hasRetention ? element.contains(document.activeElement) : document.activeElement === element;
  }
  function createMacSceneFiles() {
    const sceneTime = initialData.files?.sceneTime ?? initialData.notes.timeBase + 42 * 60_000;
    const store = initialData.files ?? createMacDesktopFileStore(profile, sceneTime);
    const catalog = createMacApplicationFiles(profile, sceneTime);
    if (savedScene) for (const file of catalog) Object.assign(file, savedScene.catalogTimes[file.id]);
    store.files.push(...catalog);
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
    window.title = modernMac ? 'Desktop & Dock' : 'Dock';
    await tick();
    return { status: 'applied', target: { appId: 'settings', windowId: window.id } };
  }
  async function openDashboardPreferences() {
    dismissDashboard();
    const result = await handlers['app.open']({ appId: 'settings' }, {});
    if (result.status !== 'applied') return result;
    const window = windows.find(window => window.id === result.target.windowId);
    window.settingsPane = 'mission-control'; window.title = 'Mission Control';
    await tick();
    return { status: 'applied', target: { appId: 'settings', windowId: window.id } };
  }
  async function openAppearancePreferences() {
    const result = await handlers['app.open']({ appId: 'settings' }, {});
    if (result.status !== 'applied') return result;
    const window = windows.find(window => window.id === result.target.windowId);
    window.settingsPane = 'appearance'; window.title = modernMac ? 'Appearance' : 'General';
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
    setFinderFolder(window, folder.id); window.title = folder.name; window.finderSelectedFileIds = [file.id];
    const focused = await handlers['window.focus']({ windowId: window.id }, {});
    if (focused.status !== 'applied') return focused;
    await tick();
    const root = managedWindowElement(window.id);
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
    const ids = new Set(profile.renderer === 'golden-gate'
      ? [...items.map(item => item.id), ...windows.filter(window => window.utilityKind === 'desktop-info').map(window => window.fileId)]
      : [...desktopFileStore.files.map(file => file.id), ...items.map(item => item.id)]);
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

  function finderRecordMutation(label, mutate) {
    if (!hasEditWorkflows || !finderEditing || fileHistoryBatch) return mutate();
    const before = finderEditing.capture();
    const window = activeAppId === 'finder' ? windows.find(window => window.id === activeWindowId
      && window.appId === 'finder' && !window.utilityKind && window.folderId) : null;
    const owner = { windowId: window?.id ?? null, folderId: window?.folderId ?? 'desktop',
      selectionBefore: [...(window?.finderSelectedFileIds ?? desktopState.selectedFileIds)] };
    let result;
    fileHistoryBatch++;
    try { result = mutate(); } finally { fileHistoryBatch--; }
    if (result.status === 'applied') {
      finderEditing.recordChanged(label, before, owner, result.target.fileIds ?? (result.target.fileId ? [result.target.fileId] : undefined));
      reconcileFinderLocations(before);
    }
    return result;
  }
  function reconcileFinderLocations(before) {
    const previous = new Map(before.map(file => [file.id, file]));
    const live = liveMacFileRecords(macFiles), byId = new Map(live.map(file => [file.id, file]));
    for (const window of windows) {
      if (window.appId === 'finder' && !window.utilityKind && window.folderId) {
        let folderId = window.folderId;
        const seen = new Set();
        while (folderId && !byId.has(folderId) && !seen.has(folderId)) {
          seen.add(folderId); folderId = previous.get(folderId)?.parentId;
        }
        if (folderId && byId.has(folderId) && folderId !== window.folderId) {
          setFinderFolder(window, folderId); window.finderSelectedFileIds = [];
        }
        if (byId.has(window.folderId)) {
          window.title = byId.get(window.folderId).name;
          window.finderSelectedFileIds = (window.finderSelectedFileIds ?? []).filter(id => byId.get(id)?.parentId === window.folderId);
        }
      }
      const file = byId.get(window.fileId);
      if (file) window.title = window.utilityKind === 'desktop-info' ? `${file.name} Info` : file.name;
    }
  }
  function renameDesktopItem(fileId, name) {
    return finderRecordMutation('Rename', () => {
    const result = desktopFileCommands['win11.files.rename']({ fileId }, { name });
    if (result.status === 'applied' && macDesktop)
      for (const window of windows) if (window.folderId === fileId || window.fileId === fileId) {
        const name = liveFile(macFiles, fileId).name;
        window.title = window.utilityKind === 'desktop-info' ? `${name} Info` : name;
      }
    return result;
    });
  }

  function moveDesktopItems(fileIds, folderId) {
    return finderRecordMutation('Move Items', () => {
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
    });
  }
  function createDesktopFolder(name, fileIds = []) {
    return finderRecordMutation(fileIds.length ? 'New Folder with Selection' : 'New Folder', () => {
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
    });
  }
  function trashDesktopItems(fileIds) {
    return finderRecordMutation('Move to Trash', () => {
    const items = getDesktopItems();
    if (fileIds.some(fileId => !items.some(item => item.id === fileId))) return rejected('not_found', 'A trash source no longer exists.');
    if (fileIds.some(fileId => !items.find(item => item.id === fileId).movable)) return rejected('disabled', 'Protected system entries cannot be trashed.');
    return trashVirtualFiles(desktopFileStore, fileIds, macDesktop ? ['disk', 'desktop', 'downloads', 'trash'] : undefined);
    });
  }
  function windowApplication(window) {
    const app = applications[window.appId], utility = APPLICATION_MENU_UTILITY_SIZES[window.utilityKind];
    return utility ? { ...app, ...utility } : desktopUtilityApps[window.utilityKind] ?? app;
  }
  async function openDesktopUtility(utilityKind, fileId) {
    const info = fileId ? getDesktopFileInfo(fileId) : null;
    if (fileId && !info) return rejected('not_found', 'The information record no longer exists.');
    let window = windows.find(entry => entry.utilityKind === utilityKind && entry.fileId === fileId);
    if (!window) {
      const title = utilityKind === 'desktop-info' ? `${info.name} Info` : 'Desktop';
      const id = openWindow('finder', title, true, utilityKind);
      window = windows.find(entry => entry.id === id);
      if (fileId) window.fileId = fileId;
      if (utilityKind === 'desktop-info') window.infoSections = { general: true, name: true };
      window.bounds = adapter.initialBounds(windowApplication(window), area, windows.length - 1, globalThis.innerHeight);
    } else focusWindow(window.id);
    await focusKeyboardWindow(window.id);
    return { status: 'applied', target: { windowId: window.id, ...(fileId ? { fileId } : {}) } };
  }
  function getApplicationPanel(windowId) {
    const window = windows.find(entry => entry.id === windowId && Object.hasOwn(APPLICATION_MENU_UTILITY_SIZES, entry.utilityKind));
    if (!window || window.minimized || !windowPresented(window) || !windowInteractionsAvailable()
      || switching.switcher || presentation.pairing || pendingQuitAppIds.includes(window.appId)) return null;
    const element = managedWindowElement(windowId)?.querySelector('[data-application-panel-scroll]');
    return element?.isConnected && !element.closest('[inert]') && element.getClientRects().length
      ? { window, element } : null;
  }
  async function focusApplicationPanel(entry, control) {
    const find = panel => control === 'panel' ? panel?.element
      : panel?.element.querySelector(`[data-application-settings-control="${control}"]`);
    let node = find(entry);
    if (!node?.isConnected || node.disabled || !node.getClientRects().length) return false;
    focusWindow(entry.window.id);
    await tick(); await tick();
    node = find(getApplicationPanel(entry.window.id));
    if (!node?.isConnected || node.disabled || node.closest('[inert]') || !node.getClientRects().length) return false;
    node.focus({ preventScroll: true });
    return document.activeElement === node;
  }
  async function openApplicationUtility(appId, utilityKind) {
    let window = windows.find(entry => entry.appId === appId && entry.utilityKind === utilityKind);
    if (!window) {
      const returnFocus = captureSessionDesktop();
      const title = utilityKind === 'application-about' ? `About ${applications[appId].name}` : `${applications[appId].name} Settings`;
      const id = openWindow(appId, title, true, utilityKind);
      applicationUtilityReturnFocus.set(id, returnFocus);
      window = windows.find(entry => entry.id === id);
    } else focusWindow(window.id);
    await tick(); await tick();
    const entry = getApplicationPanel(window.id);
    if (!entry || !await focusApplicationPanel(entry, utilityKind === 'application-settings' ? 'sort-by' : 'panel'))
      return rejected('unavailable', 'The application utility did not mount its native panel.');
    return { status: 'applied', target: { appId, windowId: window.id } };
  }
  function applicationServiceSource(target) {
    if (!hasApplicationMenu || !windowInteractionsAvailable() || switching.switcher || presentation.pairing
      || activeAppId !== 'notes' || activeWindowId !== target.windowId || isAppHidden('notes')
      || pendingQuitAppIds.includes('notes')) return null;
    const window = windows.find(entry => entry.id === target.windowId && entry.appId === 'notes' && !entry.utilityKind);
    const note = visibleNotes(notesState).find(entry => entry.id === target.noteId && entry.id === notesState.selectedId);
    if (!window || window.minimized || !windowPresented(window) || !note || !['title', 'body'].includes(target.control)) return null;
    const node = managedWindowElement(window.id)?.querySelector(`[data-notes-control="${target.control}"]`);
    if (!node?.isConnected || node.dataset.noteId !== note.id || node.disabled || node.closest('[inert]')
      || !node.getClientRects().length || typeof node.value !== 'string') return null;
    return { note, value: node.value };
  }
  function applicationServiceSelection() {
    const token = menuBarState?.menuId ? getMenuReturnFocus?.()?.focus : null;
    const node = token?.node ?? document.activeElement, control = node?.dataset?.notesControl;
    if (!['title', 'body'].includes(control)) return null;
    const windowId = node.closest('[data-window-id]')?.dataset.windowId;
    const noteId = token?.noteId ?? node.dataset.noteId;
    if (noteId !== node.dataset.noteId) return null;
    const source = applicationServiceSource({ windowId, noteId, control });
    const range = token?.selection ?? { start: node.selectionStart, end: node.selectionEnd };
    if (!source || !Number.isSafeInteger(range?.start) || !Number.isSafeInteger(range?.end)
      || range.start < 0 || range.end <= range.start || range.end > source.value.length
      || range.end - range.start > 1024 * 1024) return null;
    return { windowId, noteId, control, revision: source.note.updatedAt, start: range.start, end: range.end };
  }
  async function focusApplicationServiceBody(windowId, noteId = notesState.selectedId) {
    await tick(); await tick();
    if (!applicationServiceSource({ windowId, noteId, control: 'body' })) return false;
    const body = managedWindowElement(windowId).querySelector('[data-notes-control="body"]');
    body.focus({ preventScroll: true });
    return document.activeElement === body;
  }
  function setFinderFolder(window, folderId) {
    if (hasViewWorkflows) {
      const currentMode = viewWorkflows?.finderForWindow(window.id)?.view.mode ?? window.finderBrowseMode ?? 'icons';
      window.finderBrowseMode = viewing.finder.folderViews[folderId]?.mode ?? currentMode;
    }
    window.folderId = folderId;
  }
  function viewWindowAvailable(windowId) {
    if (!hasViewWorkflows || !windowInteractionsAvailable() || switching.switcher || presentation.pairing
      || activeWindowId !== windowId) return false;
    const window = windows.find(window => window.id === windowId);
    return Boolean(window && !window.utilityKind && !window.minimized && activeAppId === window.appId
      && !isAppHidden(window.appId) && !pendingQuitAppIds.includes(window.appId)
      && windowPresented(window) && windowInteractive(window));
  }
  async function finishNotesView(windowId, kind, noteId = notesState.selectedId, focus) {
    await tick(); await tick();
    if (!viewWindowAvailable(windowId) || notesState.selectedId !== noteId) return;
    if (kind === 'preserve') {
      if (focus && [document.body, document.documentElement].includes(document.activeElement)) await restoreNativeFocus(focus);
      return;
    }
    const root = managedWindowElement(windowId);
    const node = kind === 'body' ? root?.querySelector('[data-notes-control="body"]')
      : [...(root?.querySelectorAll('[data-notes-control="row"]') ?? [])].find(node => node.dataset.noteId === noteId);
    if (!node?.isConnected || !node.getClientRects().length || node.disabled || node.closest('[inert]')) return;
    node.focus({ preventScroll: true });
    if (kind === 'body') node.setSelectionRange(node.value.length, node.value.length);
    else node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    notesViewState.focusedControl = kind === 'body' ? { control: 'body' } : { control: 'row', noteId };
  }
  async function finishFinderView(windowId, focus) {
    await tick(); await tick();
    if (!viewWindowAvailable(windowId)) return;
    const root = managedWindowElement(windowId);
    const current = document.activeElement;
    if (root?.contains(current) && current.getClientRects().length && !current.disabled && !current.closest('[inert]')) return;
    const window = windows.find(window => window.id === windowId);
    const nodes = [...(root?.querySelectorAll('[data-finder-file-id]') ?? [])];
    const originalFileId = focus?.node?.dataset?.finderFileId;
    const node = nodes.find(node => node.dataset.finderFileId === originalFileId
      && window.finderSelectedFileIds?.includes(originalFileId) && node.getClientRects().length)
      ?? nodes.find(node => window.finderSelectedFileIds?.includes(node.dataset.finderFileId) && node.getClientRects().length)
      ?? root?.querySelector('.folder-contents');
    if (node?.getClientRects().length) node.focus({ preventScroll: true });
  }
  function finderViewOptionsPanel(windowId, optionsId) {
    const options = viewPresentation.options;
    if (!viewWindowAvailable(windowId) || options?.id !== optionsId || options.windowId !== windowId) return null;
    const window = windows.find(window => window.id === windowId);
    if (window.folderId !== options.folderId) return null;
    const panel = managedWindowElement(windowId)?.querySelector('[data-view-options-id]');
    return panel?.isConnected && panel.dataset.viewOptionsId === optionsId
      && panel.dataset.viewOptionsWindowId === windowId && panel.dataset.viewOptionsFolderId === options.folderId
      && panel.getClientRects().length && !panel.closest('[inert]') ? panel : null;
  }
  async function focusFinderViewOptions(windowId, optionsId, control) {
    await tick(); await tick();
    const panel = finderViewOptionsPanel(windowId, optionsId);
    const node = panel && (control === 'panel' ? panel : [...panel.querySelectorAll('[data-view-options-control]')]
      .find(node => node.dataset.viewOptionsControl === control));
    if (!node?.getClientRects().length || node.disabled) return false;
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return document.activeElement === node && Boolean(finderViewOptionsPanel(windowId, optionsId));
  }
  function finderViewOptionsControls(windowId, optionsId) {
    const panel = finderViewOptionsPanel(windowId, optionsId);
    if (!panel) return [];
    return [panel, ...panel.querySelectorAll('[data-view-options-control]')].map(node => ({
      control: node.dataset.viewOptionsControl,
      disabled: Boolean(node.disabled), focused: document.activeElement === node,
      ...(node.matches('input,select') ? { value: node.type === 'checkbox' ? node.checked : node.value } : {}),
      ...(node.type === 'range' ? { min: Number(node.min), max: Number(node.max), step: Number(node.step) } : {}),
    }));
  }
  function scrollFinderViewOptions(windowId, optionsId, offsets) {
    const panel = finderViewOptionsPanel(windowId, optionsId);
    if (!panel) return null;
    panel.scrollTop = offsets.top;
    if (offsets.left !== undefined) panel.scrollLeft = offsets.left;
    return { top: panel.scrollTop, left: panel.scrollLeft };
  }
  function ownedNotesWindow(windowId) {
    if (!hasEditWorkflows || !windowInteractionsAvailable() || activeAppId !== 'notes' || activeWindowId !== windowId
      || isAppHidden('notes') || pendingQuitAppIds.includes('notes')) return null;
    return windows.find(window => window.id === windowId && window.appId === 'notes' && !window.utilityKind
      && !window.minimized && windowPresented(window)) ?? null;
  }
  function ownedTextDocument(target) {
    const window = ownedNotesWindow(target.windowId);
    if (hasViewWorkflows && window?.notesPresentation?.mode === 'gallery' && !window.notesPresentation.documentVisible) return null;
    const note = window && visibleNotes(notesState).find(note => note.id === target.noteId && note.id === notesState.selectedId);
    return note ? { window, note } : null;
  }
  function ownedTextSource(target) {
    if (!ownedNotesWindow(target.windowId) || !['title', 'body', 'search'].includes(target.control)) return null;
    const note = target.control === 'search' ? null : ownedTextDocument(target)?.note;
    if (target.control !== 'search' && !note) return null;
    const node = managedWindowElement(target.windowId)?.querySelector(`[data-notes-control="${target.control}"]`);
    const value = target.control === 'search' ? notesState.search.replace(/[\r\n]/g, '') : noteTextControlValue(note, target.control);
    if (!node?.isConnected || node.disabled || node.closest('[inert]') || !node.getClientRects().length
      || node.value !== value || (note && node.dataset.noteId !== note.id)) return null;
    return { note: note ?? undefined, value, readOnly: Boolean(node.readOnly || note?.deleted),
      selection: { start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection ?? 'none' } };
  }
  async function prepareOwnedText(target) {
    if (!ownedTextSource(target)) return false;
    const node = managedWindowElement(target.windowId).querySelector(`[data-notes-control="${target.control}"]`);
    node.focus({ preventScroll: true });
    return document.activeElement === node && Boolean(ownedTextSource(target));
  }
  async function finishOwnedTextSelection(target, range, revision) {
    await tick(); await tick();
    const source = ownedTextSource(target);
    if (!source || (source.note ? source.note.updatedAt : textEditing.targets().searchRevision) !== revision) return false;
    const node = managedWindowElement(target.windowId).querySelector(`[data-notes-control="${target.control}"]`);
    return selectNativeText(node, range);
  }
  function textSelectionTarget() {
    const token = menuBarState?.menuId ? getMenuReturnFocus?.()?.focus : null;
    const node = token?.node ?? document.activeElement;
    const control = node?.dataset?.notesControl;
    if (!['title', 'body', 'search'].includes(control)) return null;
    const windowId = node.closest('[data-window-id]')?.dataset.windowId;
    const noteId = control === 'search' ? undefined : token?.noteId ?? node.dataset.noteId;
    if (control !== 'search' && noteId !== node.dataset.noteId) return null;
    const source = ownedTextSource({ windowId, control, ...(noteId ? { noteId } : {}) });
    if (!source) return null;
    if (token && (token.noteRevision !== (source.note?.updatedAt ?? textEditing.targets().searchRevision) || token.sourceValue !== source.value)) return null;
    const range = token?.selection ?? source.selection;
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0
      || range.start > range.end || range.end > source.value.length) return null;
    return { windowId, control, ...(noteId ? { noteId } : {}), revision: source.note?.updatedAt ?? textEditing.targets().searchRevision,
      start: range.start, end: range.end };
  }
  function ownedToolInput(target) {
    if (!ownedNotesWindow(target.windowId)) return null;
    const node = sceneRoot?.querySelector(`[data-text-tool-window="${target.windowId}"] [data-text-tool-control="${target.control}"]`);
    if (!node?.isConnected || node.disabled || node.readOnly || node.closest('[inert]') || !node.getClientRects().length
      || typeof node.value !== 'string' || typeof node.selectionStart !== 'number') return null;
    const before = textInputSelections.get(node);
    return { value: node.value, start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection ?? 'none',
      selection: { start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection ?? 'none' },
      before: before ? { value: before.value, selection: { start: before.start, end: before.end, direction: before.direction } } : null };
  }
  function nativeToolTarget() {
    const token = menuBarState?.menuId ? getMenuReturnFocus?.()?.focus : null;
    const node = token?.node ?? document.activeElement, control = node?.dataset?.textToolControl;
    if (!['query', 'replacement', 'word'].includes(control) || !node.isConnected || !sceneRoot?.contains(node)) return null;
    const windowId = node.closest('[data-text-tool-window]')?.dataset.textToolWindow;
    const model = control === 'word' ? textToolsState.spelling : textToolsState.find;
    const owner = model && ownedTextDocument({ windowId, noteId: model.noteId });
    if (!owner || model.windowId !== windowId || (control === 'word' ? model.revision !== owner.note.updatedAt : !model.open)) return null;
    const source = ownedToolInput({ windowId, control }), value = control === 'word' ? model.replacement : model[control];
    if (!source || source.value !== value || token && (token.toolId !== model.toolId || token.sourceValue !== value)) return null;
    const range = token?.selection ?? source.selection;
    return { windowId, control, toolId: model.toolId, value, start: range.start, end: range.end };
  }
  function textToolReturnCurrent(token) {
    const node = token?.node;
    return Boolean(node?.isConnected && sceneRoot?.contains(node) && document.activeElement === node
      && (token.sourceValue === undefined || token.sourceValue === node.value)
      && (!token.selection || token.selection.start === node.selectionStart && token.selection.end === node.selectionEnd));
  }
  async function focusOwnedTool(kind, control, returnToken) {
    await tick(); await tick();
    const windowId = kind === 'find' ? textToolsState.find?.windowId : textToolsState.panel?.windowId;
    if (!ownedNotesWindow(windowId)) return false;
    const pane = sceneRoot.querySelector(`[data-text-panel-kind="${kind}"][data-text-tool-window="${windowId}"]`);
    const node = control === 'panel' ? pane : pane?.querySelector(`[data-text-tool-control="${control}"]`);
    if (!node?.isConnected || node.disabled || node.closest('[inert]') || !node.getClientRects().length) return false;
    if (returnToken && !textToolReturnCurrent(returnToken)) return Boolean(pane?.contains(document.activeElement));
    node.focus({ preventScroll: true });
    return document.activeElement === node;
  }
  async function finishToolSelection(target, range) {
    await tick(); await tick();
    if (!ownedToolInput(target)) return false;
    const node = sceneRoot.querySelector(`[data-text-tool-window="${target.windowId}"] [data-text-tool-control="${target.control}"]`);
    return selectNativeText(node, range);
  }
  async function revealNoteMatch(target, range) {
    const source = ownedTextDocument(target);
    if (!source) return false;
    const revision = source.note.updatedAt;
    const field = documentControlRange(source.note.text, range.start, range.end);
    return finishOwnedTextSelection({ windowId: target.windowId, noteId: target.noteId, control: field.control }, field, revision);
  }
  function editingTargets() {
    editingEpoch;
    const selection = textSelectionTarget(), source = selection && ownedTextSource(selection);
    const finderWindow = activeAppId === 'finder' && activeWindowId !== null ? { windowId: activeWindowId } : {};
    const tools = textTools.targets(), tool = nativeToolTarget(), native = nativeDraftTarget();
    const draftKey = tool ? tool.control === 'word' ? 'spelling:replacement' : `find:${tool.control}` : null;
    const draft = draftKey && tools.drafts.find(history => history.key === draftKey);
    const body = ownedTextSource({ windowId: activeWindowId, noteId: notesState.selectedId, control: 'body' });
    return $state.snapshot({ preferences: editingPreferences, ...textEditing.targets(), selection,
      selectionValueLength: source?.value.length ?? 0, selectionReadOnly: source?.readOnly ?? true,
      documentReadOnly: body?.readOnly ?? true, documentAvailable: Boolean(body), dictionaryStatus,
      finder: finderEditing?.targets(finderWindow) ?? null, tools, tool, native,
      toolHistory: { undo: Boolean(draft?.undo), redo: Boolean(draft?.redo) }, nativeHistory: nativeClipboard?.targets(native) ?? null,
      nativeTools: [...(sceneRoot?.querySelectorAll('[data-text-tool-control]') ?? [])]
        .filter(node => node.isConnected && !node.disabled && !node.closest('[inert]') && node.getClientRects().length)
        .map(node => ({ windowId: node.closest('[data-text-tool-window]')?.dataset.textToolWindow, control: node.dataset.textToolControl })) });
  }
  function observeTextBeforeInput(event) {
    const node = event.target;
    if (!hasEditWorkflows || !foreground || !sceneRoot?.contains(node) || typeof node.selectionStart !== 'number'
      || !(node.dataset.notesControl || node.dataset.textToolControl || node.hasAttribute('data-desktop-rename')
        || ['name', 'tags'].includes(node.dataset.fileDialogControl))) return;
    textInputSelections.set(node, { value: node.value, start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection ?? 'none' });
  }
  function documentSelectionTarget(owner) {
    const selected = textSelectionTarget();
    if (!selected || !['title', 'body'].includes(selected.control) || selected.windowId !== owner.windowId || selected.noteId !== owner.noteId) return null;
    const source = ownedTextDocument(owner);
    return source ? { ...owner, revision: source.note.updatedAt,
      start: controlDocumentOffset(source.note.text, selected.control, selected.start),
      end: controlDocumentOffset(source.note.text, selected.control, selected.end) } : null;
  }
  async function restoreTextToolReturn(token, target, revision, guard = () => true) {
    await tick(); await tick();
    const source = ownedTextDocument(target), node = token?.node;
    if (!guard() || !source || !node?.isConnected || !sceneRoot.contains(node) || node.closest('[inert]') || !node.getClientRects().length) return false;
    if (token.toolId && token.toolId !== (node.dataset.textToolControl === 'word' ? textToolsState.spelling : textToolsState.find)?.toolId) return false;
    if (['title', 'body'].includes(node.dataset.notesControl) && node.dataset.noteId !== target.noteId) return false;
    if (token.selection && typeof node.setSelectionRange === 'function') {
      const range = source.note.updatedAt === revision && token.sourceValue === node.value ? token.selection
        : { start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection };
      return selectNativeText(node, range);
    }
    node.focus({ preventScroll: true });
    return document.activeElement === node;
  }
  async function prepareTextDictionary() {
    if (dictionaryStatus === 'ready') return true;
    dictionaryStatus = 'loading';
    try {
      await textAssistance.ready();
      if (disposed) return false;
      dictionaryStatus = 'ready'; textToolsState.error = null;
      return true;
    } catch {
      if (!disposed) {
        dictionaryStatus = 'failed';
        textToolsState.error = 'The bundled English spelling dictionary could not be loaded. Turn off automatic spelling correction to continue typing.';
      }
      return false;
    }
  }
  $effect(() => {
    if (hasEditWorkflows && foreground && dictionaryStatus === 'idle'
      && (editingPreferences.checkSpellingWhileTyping || editingPreferences.correctSpellingAutomatically)
      && ownedNotesWindow(activeWindowId)) void prepareTextDictionary();
  });
  $effect(() => {
    if (!hasEditWorkflows || dictionaryStatus !== 'ready' || !editingPreferences.checkSpellingWhileTyping || !ownedNotesWindow(activeWindowId)) return;
    const note = visibleNotes(notesState).find(note => note.id === notesState.selectedId);
    if (!note) return;
    const owner = { windowId: activeWindowId, noteId: note.id, revision: note.updatedAt };
    const learned = editingPreferences.learnedWords;
    learned.length;
    textToolsState.spellingEpoch;
    const timer = setTimeout(() => {
      if (!disposed && dictionaryStatus === 'ready' && editingPreferences.checkSpellingWhileTyping)
        void textTools.handlers['text.spelling.check'](owner, { maxIssues: 500, suggestions: false });
    }, 160);
    return () => clearTimeout(timer);
  });
  function ownedDraftControl(target) {
    if (!hasEditWorkflows || !foreground || disposed) return null;
    let node, maxLength, commit;
    if (target.surface === 'file-dialog') {
      const dialog = fileDialogState.current;
      if (!dialog || dialog.id !== target.ownerId || dialog.busy || !['pdf', 'markdown'].includes(dialog.format)
        || !['name', 'tags'].includes(target.control) || !fileWorkflowsAvailable()
        || activeAppId !== 'notes' || activeWindowId !== dialog.windowId) return null;
      node = sceneRoot?.querySelector(`[data-file-dialog-id="${CSS.escape(dialog.id)}"] input[data-file-dialog-control="${target.control}"]`);
      maxLength = target.control === 'name' ? 255 : 64 * 258;
      commit = value => handlers['fileDialog.configure']({ dialogId: dialog.id }, target.control === 'name' ? { name: value }
        : { tags: value.split(',').map(tag => tag.trim()).filter(Boolean) });
    } else if (target.surface === 'desktop-rename') {
      if (target.control !== 'name' || desktopState.rename?.fileId !== target.ownerId || !windowInteractionsAvailable()
        || activeAppId !== 'finder' || activeWindowId !== null) return null;
      node = sceneRoot?.querySelector('[data-desktop-rename]');
      maxLength = 255;
      commit = value => handlers['desktop.rename.change']({}, { name: value });
    } else return null;
    if (!node?.isConnected || node.disabled || node.readOnly || node.closest('[inert]') || !node.getClientRects().length
      || typeof node.value !== 'string' || typeof node.selectionStart !== 'number') return null;
    return { node, value: node.value, start: node.selectionStart, end: node.selectionEnd, maxLength, commit };
  }
  function nativeDraftTarget(node = menuBarState?.menuId ? getMenuReturnFocus?.()?.focus?.node : document.activeElement) {
    if (!node?.isConnected || !sceneRoot?.contains(node)) return null;
    const target = node.hasAttribute('data-desktop-rename') && desktopState.rename
      ? { surface: 'desktop-rename', ownerId: desktopState.rename.fileId, control: 'name' }
      : node.closest('[data-file-dialog-id]') && ['name', 'tags'].includes(node.dataset.fileDialogControl)
        ? { surface: 'file-dialog', ownerId: node.closest('[data-file-dialog-id]').dataset.fileDialogId, control: node.dataset.fileDialogControl } : null;
    const source = target && ownedDraftControl(target);
    const token = menuBarState?.menuId ? getMenuReturnFocus?.()?.focus : null;
    if (!source || source.node !== node || token?.node === node && (token.sourceValue !== source.value
      || token.nativeDraft?.ownerId !== target.ownerId || token.nativeDraft?.surface !== target.surface || token.nativeDraft?.control !== target.control)) return null;
    const range = token?.node === node ? token.selection : source;
    return { ...target, value: source.value, start: range.start, end: range.end };
  }
  async function prepareOwnedDraft(target) {
    const source = ownedDraftControl(target);
    if (!source) return false;
    source.node.focus({ preventScroll: true });
    return document.activeElement === source.node && ownedDraftControl(target)?.node === source.node;
  }
  async function finishOwnedDraft(target, range, value) {
    await tick(); await tick();
    const source = ownedDraftControl(target);
    if (!source) return false;
    // Tags are a CSV draft over the canonical array. Keep the user's equivalent
    // spelling/caret when the canonical setter commits equivalent tags.
    if (target.surface === 'file-dialog' && target.control === 'tags' && source.value !== value) {
      const tags = value.split(',').map(tag => tag.trim()).filter(Boolean);
      const actual = fileDialogState.current.tags;
      if (tags.length !== actual.length || tags.some((tag, index) => tag !== actual[index])) return false;
      source.node.value = value;
    } else if (source.value !== value) return false;
    return selectNativeText(source.node, range);
  }
  function observeDraftInput(event) {
    const target = nativeDraftTarget(event.target), before = textInputSelections.get(event.target);
    if (!target || !before) return;
    nativeClipboard.recordInput(target, before.value, target.value, { start: before.start, end: before.end, direction: before.direction },
      { start: target.start, end: target.end, direction: event.target.selectionDirection ?? 'none' });
  }
  function observeNativeSelection(event) {
    if (!hasEditWorkflows || !foreground || !sceneRoot?.contains(event.target)) return;
    editingEpoch++;
    const panel = textToolsState.panel;
    if (panel?.kind === 'substitutions' && ['title', 'body'].includes(event.target?.dataset?.notesControl)) {
      const selection = documentSelectionTarget({ windowId: panel.windowId, noteId: panel.noteId });
      if (selection) panel.selection = selection;
    }
  }
  async function editNativeText(event, windowId, control) {
    const node = event.currentTarget;
    if (!ownedNotesWindow(windowId) || !['title', 'body', 'search'].includes(control)) return;
    const noteId = control === 'search' ? undefined : node.dataset.noteId;
    const note = noteId && ownedTextDocument({ windowId, noteId })?.note;
    if (control !== 'search' && (!note || note.deleted)) return;
    const before = control === 'search' ? notesState.search.replace(/[\r\n]/g, '') : noteTextControlValue(note, control);
    const entered = node.value, cursor = node.selectionEnd;
    if (event.isComposing) {
      const first = note?.text.split('\n', 1)[0], newline = note?.text.indexOf('\n');
      const body = newline >= 0 ? note.text.slice(newline + 1) : '';
      if (control === 'search') await commands.execute({ command: 'notes.search', payload: { query: entered } });
      else {
        const previous = textInputSelections.get(node);
        const saved = previous?.value === before ? previous : { start: Math.min(cursor, before.length), end: Math.min(cursor, before.length), direction: 'none' };
        textEditing.editDocument(noteId, control === 'title' ? entered + (newline >= 0 ? `\n${body}` : '') : `${first}\n${entered}`, 'typing',
          { control, before: { start: saved.start, end: saved.end, direction: saved.direction },
            after: { start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection ?? 'none' } });
      }
      return;
    }
    const previous = textInputSelections.get(node);
    let start = 0, suffix = 0;
    while (start < before.length && start < entered.length && before[start] === entered[start]) start++;
    while (suffix < before.length - start && suffix < entered.length - start
      && before[before.length - suffix - 1] === entered[entered.length - suffix - 1]) suffix++;
    const oldRange = previous?.value === before ? previous : { start, end: before.length - suffix, direction: 'none' };
    node.value = before; node.setSelectionRange(oldRange.start, oldRange.end, oldRange.direction);
    if (entered === before) return;
    const revision = note?.updatedAt ?? textEditing.targets().searchRevision;
    const owner = { windowId, control, ...(noteId ? { noteId } : {}), revision };
    const preferences = { ...editingPreferences }, preferenceRevision = editingPreferenceRevision;
    let corrected;
    try { corrected = control === 'search' ? { text: entered, cursor, changed: false }
      : await textAssistance.correctInput(entered, cursor, preferences, preferences.learnedWords); }
    catch { textToolsState.error = 'The bundled English spelling dictionary could not be loaded. Your text was not changed.'; return; }
    if (control === 'body' ? corrected.text.includes('\r') : /[\r\n]/u.test(corrected.text)) {
      const normalize = value => control === 'body' ? value.replace(/\r\n?/g, '\n') : value.replace(/[\r\n]/g, '');
      corrected = { ...corrected, text: normalize(corrected.text), cursor: normalize(corrected.text.slice(0, corrected.cursor)).length };
    }
    const current = ownedTextSource(owner);
    if (!current || editingPreferenceRevision !== preferenceRevision || (current.note?.updatedAt ?? textEditing.targets().searchRevision) !== revision
      || current.value !== before || current.selection.start !== oldRange.start || current.selection.end !== oldRange.end) return;
    start = 0; suffix = 0;
    while (start < before.length && start < corrected.text.length && before[start] === corrected.text[start]) start++;
    while (suffix < before.length - start && suffix < corrected.text.length - start
      && before[before.length - suffix - 1] === corrected.text[corrected.text.length - suffix - 1]) suffix++;
    const result = await commands.execute({ command: 'text.replace', target: { ...owner, start, end: before.length - suffix },
      payload: { text: corrected.text.slice(start, corrected.text.length - suffix), label: 'typing', cursor: corrected.cursor } });
    textToolsState.error = result.status === 'rejected' ? result.error.message : null;
  }
  function applicationMenuTargets() {
    return { preferences: { notes: { ...notesState.preferences } }, selection: applicationServiceSelection(),
      panels: windows.filter(window => Object.hasOwn(APPLICATION_MENU_UTILITY_SIZES, window.utilityKind)).map(window => {
        const element = managedWindowElement(window.id)?.querySelector('[data-application-panel-scroll]');
        return { appId: window.appId, windowId: window.id, kind: window.utilityKind, available: Boolean(getApplicationPanel(window.id)),
          controlIds: ['panel', ...[...(element?.querySelectorAll('[data-application-settings-control]') ?? [])]
            .map(control => control.dataset.applicationSettingsControl)],
          focusedControl: element?.contains(document.activeElement)
            ? document.activeElement === element ? 'panel' : document.activeElement.dataset.applicationSettingsControl ?? null : null,
          scroll: element ? { top: element.scrollTop, left: element.scrollLeft } : null };
      }) };
  }
  function dismissDockPresentation() {
    if (!hasDockContext) return;
    const dock = desktopState.dock;
    dock.context = null; dock.appWindows = null; dock.folderStack = null; dock.focusedItemId = null;
    if (dock.preferences.autoHide && !dock.hover && !dock.drag) dock.revealed = false;
  }
  function focusDesktop() {
    dismissMenuBar?.();
    switching.switcher = null; if (!hasMenuBar) switching.appMenu = null;
    unhideApplication(profile.defaults.desktopAppId);
    cancelPairingForActivation(null);
    spaceState.overview = null;
    launchpadState.view = null;
    dismissDashboard();
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
    if (spaceState.overview || launchpadState.view || dashboardOpen) return;
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
    return foreground && !fileDialogState.current && !spaceState.overview && !launchpadState.view && !dashboardOpen && !window.minimized && !switching.switcher && !desktopState.dock?.appWindows
      && fullScreenStage.mode !== 'pairing' && windowPresented(window);
  }
  function measureStageArea() {
    const workspace = sceneRoot?.querySelector(macDesktop ? '.desktop-workspace, .sonoma-workspace, .golden-gate-workspace' : '.win11-workspace');
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
      switching: $state.snapshot({ switcher: switching.switcher, ...(!hasMenuBar ? { appMenu: switching.appMenu } : {}),
        activationAppIds: switching.activationAppIds, activationWindowIds: switching.activationWindowIds }),
      windowIds: windows.map(window => window.id), activeWindowId, activeAppId,
      ...(hasSpaces ? { spaces: $state.snapshot(spaceState) } : {}) };
    switching.switcher = null; if (!hasMenuBar) switching.appMenu = null;
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
      || spaceState.overview || launchpadState.view || dashboardOpen || switching.switcher || !activeWindowId) return;
    const native = macDesktop ? event.metaKey && event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f'
      : event.key === 'F11' && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    const alias = event.key === 'F9' && event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
    if (native || alias) {
      consumeSwitchingKey(event);
      if (!event.repeat) toggleWindowFullScreen(activeWindowId);
    }
  }
  function stagePointerDown(event) {
    if (spaceState.overview || launchpadState.view || dashboardOpen || fullScreenStage.mode !== 'split' || event.button !== 0 || !event.isPrimary) return;
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
    if (spaceState.overview || launchpadState.view || dashboardOpen || event.type !== 'pointerup' || fullScreenStage.mode !== 'split' || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
    const divider = stageArea.width * fullScreenStage.ratio;
    if (drag.side === 'left' ? event.clientX > divider : event.clientX < divider)
      commands.execute({ command: 'window.splitView.swap' });
  }
  function stagePointerMove(event) {
    if (spaceState.overview || launchpadState.view || dashboardOpen || fullScreenStage.mode === 'normal' || switching.switcher || !sceneInteractionsAvailable()) return;
    const topLocked = Boolean(presentation.greenMenu || switching.appMenu || desktopState.windowMenuOpen || menuBarState?.menuId);
    const topLimit = presentation.revealed.top ? stageArea.menuHeight + 50 : 2;
    revealFullScreen('top', topLocked || event.clientY <= topLimit);
    const footer = sceneRoot?.querySelector(macDesktop ? '.dock, .sonoma-dock, .golden-gate-dock' : '.win11-taskbar');
    const bounds = footer?.getBoundingClientRect();
    const locked = Boolean(desktopState.dock?.context || desktopState.dock?.folderStack || desktopState.dock?.appWindows
      || desktopState.dock?.focusedItemId || nativeState?.shell.panel);
    const near = event.clientY >= (presentation.revealed.launcher ? (bounds?.top ?? stageArea.height - 80) - 8 : stageArea.height - 2);
    revealFullScreen('launcher', locked || near);
  }
  function resizeSplitView(event) {
    if (spaceState.overview || launchpadState.view || dashboardOpen || fullScreenStage.mode !== 'split') return;
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
    return [...(sceneRoot?.querySelectorAll('[data-application-menu-button]') ?? [])]
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
    const workspace = sceneRoot?.querySelector(macDesktop ? '.desktop-workspace, .sonoma-workspace, .golden-gate-workspace' : '.win11-workspace');
    if (!workspace?.isConnected || workspace.closest('[inert]')) return false;
    workspace.focus({ preventScroll: true });
    return document.activeElement === workspace;
  }
  function captureNativeFocus() {
    const original = menuBarState?.menuId ? getMenuReturnFocus?.()?.focus : null;
    if (original?.node?.isConnected && sceneRoot?.contains(original.node)) return original;
    const node = document.activeElement;
    if (!sceneRoot?.contains(node)) return null;
    const attributes = [...node.attributes].filter(attribute => attribute.name.startsWith('data-'));
    const selector = attributes.length
      ? node.localName + attributes.map(attribute => `[${attribute.name}="${CSS.escape(attribute.value)}"]`).join('')
      : node.id ? `#${CSS.escape(node.id)}` : null;
    const draft = hasEditWorkflows ? nativeDraftTarget(node) : null;
    return { node, selector, windowId: node.closest('[data-window-id]')?.dataset.windowId,
      ...(['title', 'body'].includes(node.dataset?.notesControl) ? { noteId: node.dataset.noteId } : {}),
      ...(hasEditWorkflows ? { toolPanel: node.closest('[data-text-panel-kind]')?.dataset.textPanelKind } : {}),
      ...(draft ? { nativeDraft: { ownerId: draft.ownerId, surface: draft.surface, control: draft.control } } : {}),
      ...(hasEditWorkflows && typeof node.selectionStart === 'number' ? { sourceValue: node.value,
        ...(node.dataset.notesControl ? { noteRevision: node.dataset.notesControl === 'search' ? textEditing.targets().searchRevision
          : notesState.notes.find(note => note.id === node.dataset.noteId)?.updatedAt } : {}),
        ...(node.dataset.textToolControl ? { toolId: (node.dataset.textToolControl === 'word' ? textToolsState.spelling : textToolsState.find)?.toolId } : {}) } : {}),
      selection: typeof node.selectionStart === 'number'
        ? { start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection } : null };
  }
  async function restoreNativeFocus(token) {
    await tick(); await tick();
    ownedWindowFocus++;
    try {
      const scope = token?.windowId ? managedWindowElement(token.windowId) : sceneRoot;
      const original = token?.node?.isConnected && sceneRoot?.contains(token.node) ? token.node
        : token?.selector && scope ? scope.querySelector(token.selector) : null;
      if (token?.nativeDraft) {
        const draft = original && nativeDraftTarget(original);
        if (!draft || draft.ownerId !== token.nativeDraft.ownerId || draft.surface !== token.nativeDraft.surface
          || draft.control !== token.nativeDraft.control || draft.value !== token.sourceValue) return false;
      }
      if (original?.isConnected && typeof original.focus === 'function' && !original.closest('[inert]')
        && original.getClientRects().length && getComputedStyle(original).visibility === 'visible') {
        original.focus({ preventScroll: true });
        if (document.activeElement === original) {
          if (token.selection && (!token.noteId || token.noteId === original.dataset.noteId))
            original.setSelectionRange(token.selection.start, token.selection.end, token.selection.direction);
          return true;
        }
      }
      const current = windows.find(window => window.id === activeWindowId && !window.minimized && windowPresented(window));
      return current ? await focusKeyboardWindow(current.id) : await focusSceneWorkspace();
    } finally { ownedWindowFocus--; }
  }
  function captureSessionDesktop() {
    const scroll = [];
    for (const node of sceneRoot.querySelectorAll('*')) {
      if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)
        scroll.push({ node, top: node.scrollTop, left: node.scrollLeft });
    }
    return { focus: helpViewer?.getReturnFocus() ?? captureNativeFocus(), scroll };
  }
  async function restoreSessionDesktop(snapshot) {
    const focused = await restoreNativeFocus(snapshot?.focus);
    for (const { node, top, left } of snapshot?.scroll ?? [])
      if (node.isConnected && sceneRoot.contains(node)) node.scrollTo({ top, left, behavior: 'instant' });
    await tick();
    return focused;
  }
  function fileDialogSource(windowId) {
    if (!fileWorkflowsAvailable() || activeAppId !== 'notes' || activeWindowId !== windowId) return null;
    const window = windows.find(window => window.id === windowId && window.appId === 'notes' && !window.utilityKind
      && !window.minimized && windowPresented(window));
    const note = visibleNotes(notesState).find(note => note.id === notesState.selectedId);
    return window && note ? { noteId: note.id, text: note.text, createdAt: note.createdAt, updatedAt: note.updatedAt } : null;
  }
  function persistentDockData() {
    const dock = desktopState.dock;
    return { pinnedAppIds: dock.pinnedAppIds, recentHistory: dock.recentHistory, usageSequence: dock.usageSequence,
      preferences: dock.preferences, folderFileIds: dock.folderFileIds, folderPreferences: dock.folderPreferences,
      mainOrderAppIds: dock.mainOrderAppIds.filter(id => dock.pinnedAppIds.includes(id)),
      secondaryOrderItemIds: dock.secondaryOrderItemIds.filter(id => dock.folderFileIds.some(fileId => dockFolderItemId(fileId) === id)) };
  }
  function persistentStringUnits(value) {
    if (typeof value === 'string') return value.length;
    if (!value || typeof value !== 'object') return 0;
    let total = 0;
    for (const key of Object.keys(value)) total += key.length + persistentStringUnits(value[key]);
    return total;
  }
  function fileWorkflowOtherTextSize() {
    return persistentStringUnits({ version: 1, notes: null, files: null, printing: null,
      editing: editingPreferences, viewing, messages: messagesState, appearance: appearanceState, dock: persistentDockData() });
  }
  function workflowTextSize() {
    return fileWorkflowOtherTextSize() + persistentStringUnits(notesState) + persistentStringUnits(printingState)
      + persistentStringUnits({ files: macFiles.files.filter(file => !file.readOnly),
        nextFileId: macFiles.nextFileId, sceneTime: macFiles.sceneTime });
  }
  function canAddWorkflowFiles(records) {
    const count = macFiles.files.reduce((total, file) => total + (file.readOnly ? 0 : 1), 0);
    let extra = 0;
    for (let index = 0; index < records.length; index++)
      extra += persistentStringUnits(records[index]) + String(count + index).length;
    return workflowTextSize() + extra <= 4 * 1024 * 1024;
  }
  function canReplaceWorkflowFiles(files) {
    return fileWorkflowOtherTextSize() + persistentStringUnits(notesState) + persistentStringUnits(printingState)
      + persistentStringUnits({ files: files.filter(file => !file.readOnly), nextFileId: macFiles.nextFileId, sceneTime: macFiles.sceneTime }) <= 4 * 1024 * 1024;
  }
  function editMenuRequest(itemId) {
    const edit = sharedMenuProviders().find(menu => menu.menuId === 'edit');
    function find(items) {
      for (const item of items) {
        if (item.id === itemId) return item.enabled && item.request ? item.request : null;
        if (item.children) { const found = find(item.children); if (found) return found; }
      }
      return null;
    }
    return edit ? find(edit.items) : null;
  }
  async function performEditRequest(request) {
    if (!request) return;
    if (menuBarState?.menuId) await dismissMenuBar?.();
    const result = await commands.execute(request);
    if (result.status === 'rejected' && activeAppId === 'notes') textToolsState.error = result.error.message;
  }
  function viewingTargets() {
    return {
      ...viewWorkflows.targets(),
      notesWindows: windows.filter(window => window.appId === 'notes' && !window.utilityKind)
        .map(window => viewWorkflows.notesForWindow(window.id)),
      finderWindows: windows.filter(window => window.appId === 'finder' && !window.utilityKind)
        .map(window => viewWorkflows.finderForWindow(window.id)).filter(Boolean),
    };
  }
  async function performViewRequest(request) {
    if (!request) return;
    if (menuBarState?.menuId) await dismissMenuBar?.();
    await commands.execute(request);
  }
  function viewKeydown(event) {
    if (!hasViewWorkflows || !foreground || disposed || event.defaultPrevented || event.isComposing) return;
    const original = menuBarState?.menuId ? getMenuReturnFocus?.()?.focus?.node : null;
    if (!sceneRoot?.contains(event.target) && !sceneRoot?.contains(original)
      && event.target !== document.body && event.target !== document.documentElement) return;
    const window = windows.find(window => window.id === activeWindowId), key = event.key.toLowerCase();
    const pane = event.target?.closest?.('[data-view-options-id]');
    let request;
    if (pane && (key === 'escape' || event.metaKey && key === 'w') && !event.altKey) {
      request = { command: 'finder.view.options.close', target: { windowId: pane.dataset.viewOptionsWindowId,
        optionsId: pane.dataset.viewOptionsId }, payload: {} };
    } else if (!event.metaKey) return;
    else if (hasHelpWorkflows && event.shiftKey && !event.ctrlKey && !event.altKey && (event.code === 'Slash' || key === '?')) {
      event.preventDefault(); event.stopImmediatePropagation();
      void executeSession({ command: 'app.commandMenu.open', target: { appId: activeAppId, menuId: 'help' }, payload: {} });
      return;
    }
    else if (hasWindowExtensions && activeAppId === 'notes' && !event.altKey && !event.ctrlKey && !event.shiftKey
      && (event.code === 'Digit0' || key === '0'))
      request = { command: 'app.open', target: { appId: 'notes' }, payload: {} };
    else if (activeAppId === 'notes' && window && !window.utilityKind) {
      const source = viewWorkflows.notesForWindow(window.id);
      if (!source) return;
      if (!event.altKey && event.ctrlKey && !event.shiftKey && key === 's')
        request = { command: 'notes.setSidebarVisible', payload: { visible: !notesState.sidebarVisible } };
      else if (!event.altKey && !event.ctrlKey && !event.shiftKey && ['1', '2'].includes(key))
        request = { command: 'notes.view.set', target: { windowId: window.id, folder: notesState.folder },
          payload: { mode: key === '1' ? 'list' : 'gallery' } };
      else if (!event.altKey && !event.ctrlKey && event.shiftKey && source.noteId) {
        const action = event.code === 'Period' || key === '.' || key === '>' ? 'in'
          : event.code === 'Comma' || key === ',' || key === '<' ? 'out'
            : event.code === 'Digit0' || key === '0' || key === ')' ? 'reset' : null;
        if (action) request = { command: 'notes.view.zoom', target: { windowId: window.id, noteId: source.noteId }, payload: { action } };
      } else if (!event.altKey && !event.ctrlKey && !event.shiftKey && key === 'enter' && source.noteId)
        request = source.presentation.mode === 'gallery'
          ? { command: 'notes.view.return', target: { windowId: window.id } }
          : { command: 'notes.focus', target: { control: 'row', noteId: source.noteId } };
    } else if (activeAppId === 'finder' && !event.ctrlKey) {
      const source = window && !window.utilityKind ? viewWorkflows.finderForWindow(window.id) : null;
      if (!event.altKey && !event.shiftKey && key === 'j')
        request = window?.utilityKind === 'desktop-view-options' ? { command: 'window.close', target: { windowId: window.id } }
          : source?.options ? { command: 'finder.view.options.close', target: { windowId: window.id, optionsId: source.options.id } }
            : source ? { command: 'finder.view.options.open', target: { windowId: window.id, folderId: source.folderId } }
              : !window ? { command: 'desktop.view.open' } : null;
      else if (source && !event.altKey && !event.shiftKey && ['1', '2', '3', '4'].includes(key))
        request = { command: 'finder.view.set', target: { windowId: window.id, folderId: source.folderId },
          payload: { mode: ['icons', 'list', 'columns', 'gallery'][Number(key) - 1] } };
      else if (source) {
        const chrome = event.altKey && !event.shiftKey ? key === 't' ? 'toolbarVisible' : key === 's' ? 'sidebarVisible'
          : key === 'p' ? 'pathBarVisible' : null
          : !event.altKey && event.shiftKey && key === 'p' ? 'previewVisible'
            : !event.altKey && !event.shiftKey && key === '/' ? 'statusBarVisible' : null;
        if (chrome) request = { command: 'finder.chrome.set', target: { windowId: window.id },
          payload: { [chrome]: !source.chrome[chrome] } };
      }
    }
    if (!request) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) void performViewRequest(request);
  }
  function editingKeydown(event) {
    if (!hasEditWorkflows || !foreground || disposed || event.defaultPrevented || event.isComposing) return;
    const original = menuBarState?.menuId ? getMenuReturnFocus?.()?.focus?.node : null;
    if (!sceneRoot?.contains(event.target) && !sceneRoot?.contains(original)) return;
    const key = event.key.toLowerCase(), command = event.metaKey || event.ctrlKey;
    const pane = event.target?.closest?.('[data-text-panel-kind]');
    if (pane && (key === 'escape' || command && key === 'w') && !event.altKey) {
      const windowId = pane.dataset.textToolWindow;
      const request = pane.dataset.textPanelKind === 'find'
        ? { command: 'text.find.close', target: { windowId, noteId: textToolsState.find?.noteId } }
        : { command: 'text.tools.close', target: { windowId } };
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) void performEditRequest(request);
      return;
    }
    if (!command || event.metaKey && event.ctrlKey) return;
    const itemId = key === 'z' ? event.shiftKey ? 'redo' : 'undo' : key === 'x' ? 'cut' : key === 'c' ? 'copy'
      : key === 'v' ? event.shiftKey && event.altKey ? 'paste-match-style' : 'paste'
      : key === 'a' ? 'select-all' : key === 'f' ? event.altKey ? 'search-notes' : 'find-note'
      : key === 'g' ? event.shiftKey ? 'find-previous' : 'find-next' : key === 'e' ? 'use-selection-find'
      : key === 'j' ? 'jump-selection' : key === ':' || key === ';' ? key === ':' || event.shiftKey ? 'show-spelling' : 'check-spelling' : null;
    if (!itemId || event.altKey && !['search-notes', 'paste-match-style'].includes(itemId)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) void performEditRequest(editMenuRequest(itemId));
  }
  function editingClipboardEvent(event) {
    if (!hasEditWorkflows || !foreground || disposed || event.defaultPrevented || !sceneRoot?.contains(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void performEditRequest(editMenuRequest(event.type));
  }
  function fileWorkflowKeydown(event) {
    if (!hasFileWorkflows || event.defaultPrevented || event.isComposing || !(event.metaKey || event.ctrlKey)
      || event.altKey || !windowInteractionsAvailable()) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('[inert], [aria-modal="true"]')
      || (!sceneRoot.contains(target) && target !== document.body && target !== document.documentElement)) return;
    const key = event.key.toLowerCase();
    const window = windows.find(window => window.id === activeWindowId);
    let request;
    if (key === 'n' && !event.shiftKey && activeAppId === 'notes') request = { command: 'notes.document.create' };
    else if (key === 'n' && event.shiftKey && activeAppId === 'finder') request = window && !window.utilityKind
      ? { command: 'finder.folder.create', target: { windowId: window.id } } : activeWindowId === null ? { command: 'desktop.folder.create' } : null;
    else if (!event.shiftKey && key === 'd' && activeAppId === 'notes' && window?.appId === 'notes' && !window.utilityKind)
      request = { command: 'notes.duplicate', target: { noteId: notesState.selectedId }, payload: { focus: true } };
    else if (!event.shiftKey && ['d', 'o'].includes(key) && activeAppId === 'finder') request = window && !window.utilityKind
      ? { command: key === 'd' ? 'finder.file.duplicate' : 'finder.file.open', target: { windowId: window.id } }
      : key === 'd' && activeWindowId === null ? { command: 'finder.file.duplicate' }
        : key === 'o' && activeWindowId === null && desktopState.selectedFileIds.length === 1
          ? { command: 'desktop.open', target: { fileId: desktopState.selectedFileIds[0] } } : null;
    else if (!event.shiftKey && key === 'i' && activeAppId === 'finder') request = window && !window.utilityKind
      ? { command: 'finder.info.open', target: { windowId: window.id } }
      : activeWindowId === null && desktopState.selectedFileIds.length === 1
        ? { command: 'desktop.info.open', target: { fileId: desktopState.selectedFileIds[0] } } : null;
    else if (!event.shiftKey && key === 'p' && activeAppId === 'notes' && window?.appId === 'notes' && !window.utilityKind)
      request = { command: 'fileDialog.open', target: { windowId: window.id }, payload: { format: 'print' } };
    else if (!event.shiftKey && key === 'w' && window) request = { command: 'window.close', target: { windowId: window.id } };
    else if (!event.shiftKey && ['d', 'o', 'p', 's'].includes(key)) {
      // These belong to this simulated application, never Chrome's host file,
      // print or bookmark UI. Notes autosaves its existing local model.
      event.preventDefault(); event.stopPropagation(); return;
    }
    if (!request) return;
    event.preventDefault(); event.stopPropagation();
    if (!event.repeat) commands.execute(request);
  }
  function fileDraftMenusAvailable() {
    const dialog = fileDialogState.current;
    return Boolean(hasEditWorkflows && dialog && !dialog.busy && ['markdown', 'pdf'].includes(dialog.format)
      && activeAppId === 'notes' && activeWindowId === dialog.windowId && fileWorkflowsAvailable());
  }
  function sharedMenusAvailable() {
    return (sceneInteractionsAvailable() || fileDraftMenusAvailable()) && !spaceState.overview && !launchpadState.view && !dashboardOpen
      && !switching.switcher && !presentation.pairing && !desktopState.dock?.appWindows
      && (fullScreenStage.mode === 'normal' || fullScreenStage.topRevealed);
  }
  function sharedMenuProviders() {
    const appId = activeAppId, app = applications[appId];
    const active = windows.find(window => window.id === activeWindowId);
    const managedOrdinary = Boolean(active && !active.utilityKind && !active.minimized && !isAppHidden(active.appId));
    const ordinary = managedOrdinary && !active.fullScreen;
    const request = (command, window = active, payload = {}) => window
      ? { command, target: { windowId: window.id }, payload } : undefined;
    const running = Boolean(app && runningAppIds.includes(appId) && !pendingQuitAppIds.includes(appId));
    const enabled = running && !fileDialogState.current;
    const appWindows = windows.filter(window => window.appId === appId);
    const documentWindows = appWindows.filter(window => !window.utilityKind && !window.minimized && !isAppHidden(appId));
    const original = menuBarState?.menuId ? getMenuReturnFocus?.()?.focus?.node : document.activeElement;
    const control = original?.dataset?.notesControl;
    const textControl = ['title', 'body', 'search'].includes(control)
      && original.closest('[data-window-id]')?.dataset.windowId === appWindows.find(window => window.appId === 'notes' && !window.utilityKind)?.id
      ? control : null;
    const finderWindow = appId === 'finder' && active?.appId === 'finder' && !active.utilityKind ? active : null;
    const finderDesktop = appId === 'finder' && !active;
    const finderFolder = finderWindow ? liveFile(macFiles, finderWindow.folderId) : finderDesktop ? liveFile(macFiles, 'desktop') : null;
    const finderIds = finderWindow?.finderSelectedFileIds ?? (finderDesktop ? desktopState.selectedFileIds : []);
    const commandMenus = appCommandMenuProviders({ profile, appId, enabled, activeWindow: active,
      ...(hasEditWorkflows ? { editing: editingTargets() } : {}),
      ...(hasViewWorkflows ? { viewing: {
        notes: active?.appId === 'notes' && viewWindowAvailable(active.id) ? viewWorkflows.notesForWindow(active.id) : null,
        finder: finderWindow && viewWindowAvailable(finderWindow.id) ? viewWorkflows.finderForWindow(finderWindow.id) : null,
        desktop: { available: appId === 'finder' && (!active || active.utilityKind === 'desktop-view-options'),
          sortBy: desktopState.sortBy, stacks: desktopState.stacks,
          optionsWindowId: windows.find(window => window.utilityKind === 'desktop-view-options')?.id ?? null },
      } } : {}),
      notes: appId === 'notes' ? { available: Boolean(notesView && appWindows.some(window => !window.utilityKind && !window.minimized && windowPresented(window))),
        documentAvailable: Boolean(active?.appId === 'notes' && !active.utilityKind && !active.minimized && windowPresented(active)),
        selected: visibleNotes(notesState).find(note => note.id === notesState.selectedId),
        sidebarVisible: notesState.sidebarVisible, textControl, hasText: Boolean(textControl && original.value.length) } : null,
      finder: appId === 'finder' ? { windowId: finderWindow?.id ?? null, folderId: finderFolder?.id ?? null,
        writable: Boolean(finderFolder && !finderFolder.readOnly && finderFolder.id !== 'trash'),
        childIds: finderFolder ? liveMacFileRecords(macFiles).filter(file => file.parentId === finderFolder.id || finderDesktop && file.id === 'disk').map(file => file.id) : [],
        selected: finderFolder ? liveMacFileRecords(macFiles).filter(file => finderIds.includes(file.id)
          && (file.parentId === finderFolder.id || finderDesktop && file.id === 'disk')) : [] } : null });
    if (fileDraftMenusAvailable()) for (const menu of commandMenus) menu.enabled = menu.menuId === 'edit' && running;
    return [
      { menuId: 'application', kind: 'application', label: app?.name ?? '', appId,
        enabled,
        items: goldenApplicationMenuItems({ state: switching, profile, appId, runningAppIds, pendingQuitAppIds,
          selection: applicationServiceSelection() }) },
      ...commandMenus.filter(menu => menu.menuId !== 'help'),
      { menuId: 'window', kind: 'window', label: 'Window', appId, enabled, items: [
        { id: 'close', label: 'Close', shortcut: '⌘W', enabled: Boolean(active), request: request('window.close') },
        { id: 'minimize', label: 'Minimize', shortcut: '⌘M', enabled: ordinary,
          request: request('window.setMinimized', active, { minimized: true }) },
        { id: 'zoom', label: 'Zoom', enabled: ordinary,
          request: request('window.setZoomed', active, { zoomed: !active?.zoomed }) },
        { id: 'move-resize', label: 'Move & Resize', enabled: ordinary, children: [
          { id: 'fill', label: 'Fill', shortcut: 'fn ⌃F', enabled: ordinary && !active?.zoomed,
            request: request('window.setZoomed', active, { zoomed: true }) },
          { id: 'restore', label: 'Return to Previous Size', shortcut: 'fn ⌃R', enabled: ordinary && Boolean(active?.zoomed),
            request: request('window.setZoomed', active, { zoomed: false }) },
        ] },
        { id: 'full-screen-tile', label: 'Full Screen Tile', enabled: managedOrdinary, children: [
          { id: 'entire-screen', label: 'Entire Screen', enabled: ordinary,
            request: request('window.setFullScreen', active, { fullScreen: true }) },
          { id: 'left-screen', label: 'Left of Screen', enabled: managedOrdinary,
            request: request('window.splitView.begin', active, { side: 'left' }) },
          { id: 'right-screen', label: 'Right of Screen', enabled: managedOrdinary,
            request: request('window.splitView.begin', active, { side: 'right' }) },
          { id: 'exit-full-screen', label: 'Exit Full Screen', enabled: managedOrdinary && active.fullScreen,
            request: request('window.setFullScreen', active, { fullScreen: false }) },
        ] },
        ...(hasWindowExtensions ? [
          { id: 'next-document-window', label: 'Next Window', shortcut: '⌘`', enabled: documentWindows.length > 1,
            request: { command: 'window.cycle', target: {}, payload: { direction: 'next' } } },
          { id: 'previous-document-window', label: 'Previous Window', shortcut: '⇧⌘`', enabled: documentWindows.length > 1,
            request: { command: 'window.cycle', target: {}, payload: { direction: 'previous' } } },
          { id: 'bring-all-to-front', label: 'Bring All to Front', enabled: Boolean(windowExtensions.targets().windowIds.length),
            request: { command: 'app.bringAllToFront', target: { appId }, payload: {} } },
          ...(appId === 'notes' && !appWindows.some(window => !window.utilityKind)
            ? [{ id: 'notes-main-window', label: 'Notes', shortcut: '⌘0', enabled: running,
              request: { command: 'app.open', target: { appId: 'notes' }, payload: {} } }] : []),
        ] : []),
        ...(appWindows.length ? [{ id: 'separator-windows', label: '', enabled: false, separator: true }] : []),
        ...appWindows.map(window => ({ id: `window:${window.id}`, label: window.title,
          shortcut: window.minimized ? 'Minimized' : hasWindowExtensions && appId === 'notes' && !window.utilityKind ? '⌘0' : undefined,
          checked: window.id === activeWindowId, radio: true,
          enabled: !isAppHidden(window.appId) && !pendingQuitAppIds.includes(window.appId),
          request: request('window.focus', window) })),
      ] },
      ...commandMenus.filter(menu => menu.menuId === 'help'),
    ];
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
    for (const node of sceneRoot.querySelectorAll('.managed-window, .managed-window *, [data-shell-switcher] *, [data-mission-control] *, [data-launchpad] *, [data-dashboard] *'))
      if (node.scrollTop || node.scrollLeft) scroll.push({ node, top: node.scrollTop, left: node.scrollLeft });
    return { state: $state.snapshot({ switching, presentation, desktop: desktopState, notesView: notesViewState, launchpad: launchpadState, dashboard: dashboardState }),
      launchpadView: launchpadState.view, dashboardView: dashboardState.view, dashboardReturnState,
      windowIds: windows.map(window => window.id), activeWindowId, activeAppId,
      focus: captureNativeFocus(), switchingReturnFocus, scroll };
  }
  async function restoreSpacesScene(snapshot) {
    Object.assign(switching, snapshot.state.switching);
    Object.assign(presentation, snapshot.state.presentation);
    const dock = desktopState.dock;
    Object.assign(desktopState, snapshot.state.desktop);
    if (dock) {
      Object.assign(dock, snapshot.state.desktop.dock);
      desktopState.dock = dock;
    }
    if (notesViewState) Object.assign(notesViewState, snapshot.state.notesView);
    Object.assign(launchpadState, snapshot.state.launchpad);
    launchpadState.view = snapshot.launchpadView;
    if (snapshot.launchpadView) Object.assign(snapshot.launchpadView, snapshot.state.launchpad.view);
    Object.assign(dashboardState, snapshot.state.dashboard);
    dashboardState.view = snapshot.dashboardView;
    if (snapshot.dashboardView) Object.assign(snapshot.dashboardView, snapshot.state.dashboard.view);
    dashboardReturnState = snapshot.dashboardReturnState;
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
  function dashboardKeydown(event) {
    if (!hasDashboard || event.defaultPrevented || event.isComposing || !sceneInteractionsAvailable()
      || event.key !== 'F12' || !event.ctrlKey || !event.shiftKey || event.metaKey || event.altKey) return;
    consumeSwitchingKey(event);
    if (!event.repeat) commands.execute({ command: dashboardControls?.available() ? 'shell.dashboard.close' : 'shell.dashboard.open' });
  }
  function restoreDashboardSpace(prior = dashboardReturnState) {
    if (spaceState.activeSpaceId !== 'dashboard') { dashboardReturnState = null; return; }
    const entry = spaceItems.find(item => item.spaceId === prior?.spaceId && item.type !== 'dashboard')
      ?? spaceItems.find(item => item.spaceId === spaceState.lastDesktopId);
    spaceState.activeSpaceId = entry?.spaceId ?? spaceState.lastDesktopId;
    const original = windows.find(window => window.id === prior?.windowId && !window.minimized && !isAppHidden(window.appId)
      && windowSpaceId(spaceState, presentation, window) === spaceState.activeSpaceId);
    activeWindowId = original?.id ?? null; activeAppId = original?.appId ?? prior?.appId ?? profile.defaults.desktopAppId;
    dashboardReturnState = null;
  }
  function dismissDashboard() {
    dashboardState.view = null;
    restoreDashboardSpace();
  }
  async function activateManagedSpace(entry) {
    if (!hasSpaces || !sceneInteractionsAvailable()) return false;
    if (entry.type === 'dashboard') {
      const result = await handlers['shell.dashboard.open']({}, {});
      return result.status === 'applied';
    }
    if (dashboardState.view && entry.spaceId === dashboardReturnState?.spaceId) {
      // The Space controller has already assigned its destination. Close through
      // Dashboard's original owner so its saved editor/caret, not the dialog, returns.
      spaceState.activeSpaceId = 'dashboard';
      const result = await handlers['shell.dashboard.close']({}, {});
      if (result.status !== 'applied') return false;
      if (!entry.windowIds.length || entry.windowIds.includes(activeWindowId)) return true;
    }
    dismissDashboard();
    const candidates = windows.filter(window => entry.windowIds.includes(window.id) && !window.minimized
      && !isAppHidden(window.appId) && !pendingQuitAppIds.includes(window.appId));
    if (entry.type !== 'desktop' && !candidates.length) return false;
    spaceState.overview = null;
    spaceState.activeSpaceId = entry.spaceId;
    if (entry.type === 'desktop') spaceState.lastDesktopId = entry.spaceId;
    const foreground = switching.activationWindowIds.map(id => candidates.find(window => window.id === id)).find(Boolean)
      ?? candidates.at(-1);
    if (foreground) return focusFullScreenWindow(foreground.id);
    switching.switcher = null; if (!hasMenuBar) switching.appMenu = null;
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
  function clearSwitchingPresentations(keepDashboard = false, keepMenuBar = false) {
    if (!keepMenuBar) dismissMenuBar?.();
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
    snapshot.dashboardView = dashboardState.view;
    snapshot.dashboardReturnState = dashboardReturnState;
    snapshot.dashboardSpaceId = spaceState.activeSpaceId;
    snapshot.dashboardActiveWindowId = activeWindowId; snapshot.dashboardActiveAppId = activeAppId;
    if (!keepDashboard || dashboardState.mode !== 'space') dismissDashboard();
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
    dashboardState.view = snapshot.dashboardView;
    dashboardReturnState = snapshot.dashboardReturnState;
    if (snapshot.dashboardView) {
      spaceState.activeSpaceId = snapshot.dashboardSpaceId;
      activeWindowId = snapshot.dashboardActiveWindowId; activeAppId = snapshot.dashboardActiveAppId;
    }
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
      switching.switcher = null; if (!hasMenuBar) switching.appMenu = null;
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
    if (macDesktop && !hasMenuBar && event.target?.closest?.('[data-application-menu-button]')
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
    const unregisterSession = registerSessionScene?.({
      persist: captureSavedScene,
      canSave: () => !disposed && !presentation.pairing && !fileDialogState.current && pendingQuitAppIds.length === 0,
      capture: captureSessionDesktop, restore: restoreSessionDesktop,
      menuProviders: sharedMenuProviders, menusAvailable: sharedMenusAvailable,
      prepareMenus: () => clearSwitchingPresentations(false, true), restoreMenus: restoreSwitchingPresentations,
      ready: async () => { await tick(); const result = await startup; return !disposed && initialized && result?.status === 'applied'; },
    });
    const stopScene = adapter.startScene?.(nativeState, commands.execute);
    // Retained scenes keep their DOM, but only the foreground desktop receives
    // global input. Session-native controls have their own command/focus owner.
    function listen(target, type, handler, capture = false) {
      const listener = event => {
        if (foreground && !event.target?.closest?.('[data-session-control], [data-session-control-root], [data-session-menu], [data-session-surface]')) handler(event);
      };
      target.addEventListener(type, listener, capture);
      return () => target.removeEventListener(type, listener, capture);
    }
    const stopListeners = [
      listen(window, 'keydown', event => helpView?.keydown(event), true),
      listen(window, 'keydown', launchpadKeydown, true),
      listen(window, 'keydown', dashboardKeydown, true),
      listen(window, 'keydown', spacesKeydown, true),
      listen(window, 'keydown', fullScreenKeydown, true),
      listen(window, 'keydown', viewKeydown, true),
      listen(window, 'keydown', editingKeydown, true),
      listen(sceneRoot, 'beforeinput', observeTextBeforeInput, true),
      listen(sceneRoot, 'input', observeDraftInput, true),
      listen(sceneRoot, 'select', observeNativeSelection, true),
      listen(sceneRoot, 'focusin', observeNativeSelection, true),
      listen(sceneRoot, 'copy', editingClipboardEvent, true),
      listen(sceneRoot, 'cut', editingClipboardEvent, true),
      listen(sceneRoot, 'paste', editingClipboardEvent, true),
      listen(window, 'keydown', fileWorkflowKeydown, true),
      listen(document, 'pointermove', stagePointerMove, true),
      listen(document, 'pointerdown', stagePointerDown, true),
      listen(document, 'pointerup', stagePointerUp, true),
      listen(document, 'pointercancel', stagePointerUp, true),
      listen(window, 'keydown', switchingKeydown, true),
      listen(window, 'keyup', switchingKeyup, true),
      listen(window, 'blur', cancelHeldSwitcher),
      listen(document, 'visibilitychange', switchingVisibility),
      listen(document, 'pointerdown', switchingOutside, true),
      listen(document, 'focusin', switchingOutside, true),
    ];
    const dashboardTimer = hasDashboard ? setInterval(() => {
      if (!disposed && foreground && dashboardState.view && dashboardControls?.available())
        commands.execute({ command: 'dashboard.clock.advance', payload: { seconds: 1 } });
    }, 1000) : null;
    const printingTimer = hasFileWorkflows ? setInterval(() => {
      if (fileWorkflowsAvailable() && printingState.jobs.some(job => job.status === 'queued' || job.status === 'printing'))
        commands.execute({ command: 'printing.advance', payload: { pages: 1 } });
    }, 1000) : null;
    return () => {
      disposed = true; stopScene?.(); unregister(); unregisterSession?.();
      viewWorkflows?.dismissOptions();
      helpViewer?.dispose();
      for (const stop of stopListeners) stop();
      if (dashboardTimer !== null) clearInterval(dashboardTimer);
      if (printingTimer !== null) clearInterval(printingTimer);
      if (stageDrag) stagePointerUp({ pointerId: stageDrag.pointerId, type: 'pointercancel' });
    };
  });


  function focusWindow(id) {
    const index = windows.findIndex((window) => window.id === id);
    if (index < 0) return;
    const window = windows[index];
    if (presentation.greenMenu?.windowId !== id) presentation.greenMenu = null;
    cancelPairingForActivation(id);
    unhideApplication(window.appId);
    switching.switcher = null; if (!hasMenuBar) switching.appMenu = null;
    window.minimized = false;
    spaceState.overview = null;
    launchpadState.view = null;
    dismissDashboard();
    if (hasSpaces) {
      reconcileFullScreenWindowing(presentation, windows, switching.hiddenAppIds, pendingQuitAppIds);
      reconcileSpaces(spaceState, presentation, windows, profile, switching.hiddenAppIds, pendingQuitAppIds, switching.creationWindowIds, dashboardState);
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
    if ((window.appId !== 'notes' || window.utilityKind) && notesViewState) clearNotesPresentation();
  }

  function openWindow(appId, title, fresh = false, utilityKind) {
    const app = utilityKind && Object.hasOwn(APPLICATION_MENU_UTILITY_SIZES, utilityKind)
      ? { ...applications[appId], ...APPLICATION_MENU_UTILITY_SIZES[utilityKind] } : applications[appId];
    unhideApplication(appId);
    if (fresh || !windows.some(window => window.appId === appId && !window.utilityKind)) cancelPairingForActivation(null);
    switching.switcher = null; if (!hasMenuBar) switching.appMenu = null;
    const existing = !fresh && !utilityKind && windows.findLast(window => window.appId === appId && !window.utilityKind);
    if (existing) {
      if (title !== undefined) existing.title = title;
      focusWindow(existing.id);
      if (hasDockContext) recordMacAppUse(desktopState.dock, appId);
      return existing.id;
    }
    const id = windowNamespace + (nextWindowId === 1 && appId === profile.defaults.startupAppId
      ? appId : `${appId}-window-${nextWindowId}`);
    nextWindowId++;
    adapter.createWindow?.(nativeState, id, appId, { fresh });
    const remembered = hasRetention && !fresh && !utilityKind ? closedWindows[appId] : null;
    if (hasRetention && !utilityKind) delete closedWindows[appId];
    const retainedBounds = remembered && (remembered.window.restoreBounds ?? remembered.window.bounds);
    const normal = retainedBounds ? fitRetainedBounds(retainedBounds, app, area, Math.min(.9, retainedBounds.scale)) : null;
    windows.push({
      ...(remembered?.window ?? {}),
      id, appId, title: title ?? remembered?.window.title ?? app.name,
      ...(utilityKind ? { utilityKind } : {}),
      minimized: false, fullScreen: false, [expandedProperty]: remembered?.window[expandedProperty] ?? false,
      bounds: normal ? remembered.window[expandedProperty] ? expandedBounds(normal, area) : normal
        : adapter.initialBounds(app, area, windows.length, globalThis.innerHeight),
      restoreBounds: remembered?.window[expandedProperty] ? normal : null,
      ...(hasSpaces ? { spaceId: spaceState.lastDesktopId } : {}),
      ...(macDesktop && appId === 'finder' && !utilityKind ? { folderId: remembered?.window.folderId ?? 'desktop' } : {}),
      ...(hasDockContext && appId === 'settings' && !utilityKind ? { settingsPane: remembered?.window.settingsPane ?? 'dock' } : {}),
      ...(hasViewWorkflows && !utilityKind && appId === 'finder'
        ? { finderPresentation: remembered?.window.finderPresentation ?? finderPresentationDefaults(),
          finderBrowseMode: remembered?.window.finderBrowseMode
            ?? viewing.finder.folderViews[remembered?.window.folderId ?? 'desktop']?.mode ?? 'icons' } : {}),
      ...(hasViewWorkflows && !utilityKind && appId === 'notes'
        ? { notesPresentation: remembered?.window.notesPresentation ?? notesPresentationDefaults(viewing.notes.mode) } : {}),
    });
    if (remembered) pendingWindowViews.set(id, remembered.view);
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
    const wasActive = activeWindowId === id, returnFocus = applicationUtilityReturnFocus.get(id);
    const appUtility = Object.hasOwn(APPLICATION_MENU_UTILITY_SIZES, windows[index].utilityKind);
    applicationUtilityReturnFocus.delete(id);
    if (hasRetention) {
      const closed = windows[index];
      if (!closed.utilityKind && !windows.some(window => window.id !== id && window.appId === appId && !window.utilityKind)) {
        closedWindows[appId] = {
          window: { ...$state.snapshot(closed), minimized: false, fullScreen: false },
          view: captureRetainedView(managedWindowElement(id), { noteId: notesState.selectedId }),
        };
      }
      pendingWindowViews.delete(id);
    }
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
    if (wasActive && appUtility && sceneInteractionsAvailable() && !pendingQuitAppIds.includes(appId)) {
      const sourceWindow = returnFocus?.focus?.windowId;
      const sameNote = !returnFocus?.focus?.noteId || returnFocus.focus.noteId === notesState.selectedId;
      if (returnFocus && sameNote && (!sourceWindow || sourceWindow === activeWindowId)) await restoreSessionDesktop(returnFocus);
      else if (activeWindowId) await focusKeyboardWindow(activeWindowId);
      else await focusSceneWorkspace();
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
      if (!hasMenuBar) switching.appMenu = null;
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
      const previous = window[expandedProperty] ? window.restoreBounds : window.bounds;
      const normal = savedScene && !initialized
        ? fitRetainedBounds(previous, windowApplication(window), area, Math.min(.9, previous.scale))
        : adapter.fitNormalBounds(previous, windowApplication(window), area);
      if (window[expandedProperty]) {
        window.restoreBounds = normal;
        window.bounds = expandedBounds(normal, area);
      } else {
        window.bounds = normal;
      }
    }
    if (!initialized) {
      initialized = true; starting = true;
      startup = (savedScene ? restoreSavedViews() : Promise.resolve(handlers['app.open']({ appId: profile.defaults.startupAppId }, {})))
        .finally(() => { starting = false; });
    }
  }

  async function restoreSavedViews() {
    await tick();
    for (const window of windows) restoreRetainedView(managedWindowElement(window.id), pendingWindowViews.get(window.id),
      { noteId: notesState.selectedId });
    return { status: 'applied', target: {} };
  }

  async function captureSavedScene(previousFocus) {
    await settleCommands();
    const focusElement = sceneRoot.contains(document.activeElement) ? document.activeElement : previousFocus;
    const dock = desktopState.dock;
    const { activationAppIds, activationWindowIds, creationWindowIds, hiddenAppIds } = switching;
    const { desktops, order, activeSpaceId, lastDesktopId, nextDesktopId } = spaceState;
    const { selectedFileIds, selectionAnchorId, positions, sortBy, viewOptions } = desktopState;
    const { enabled, groupBy, sortBy: stackSort, expandedStackIds, topFileIds } = desktopState.stacks;
    return $state.snapshot({
      seed: { version: 1, notes: notesState, files: { files: macFiles.files.filter(file => !file.readOnly),
        nextFileId: macFiles.nextFileId, sceneTime: macFiles.sceneTime }, messages: messagesState, appearance: appearanceState,
        printing: printingState, editing: editingPreferences, viewing, dock: persistentDockData() },
      catalogTimes: Object.fromEntries(macFiles.files.filter(file => file.readOnly).map(file =>
        [file.id, { createdAt: file.createdAt, modifiedAt: file.modifiedAt, addedAt: file.addedAt, lastOpenedAt: file.lastOpenedAt }])),
      dockOrder: { mainOrderAppIds: dock.mainOrderAppIds, secondaryOrderItemIds: dock.secondaryOrderItemIds },
      windows, closedWindows,
      views: Object.fromEntries(windows.map(window => [window.id, captureRetainedView(managedWindowElement(window.id),
        { noteId: notesState.selectedId, focusElement })])),
      nextWindowId, activeWindowId, activeAppId, runningAppIds,
      switching: { activationAppIds, activationWindowIds, creationWindowIds, hiddenAppIds },
      spaces: { desktops, order, activeSpaceId, lastDesktopId, nextDesktopId }, splitViews: presentation.splitViews,
      desktop: { selectedFileIds, selectionAnchorId, positions, sortBy, viewOptions,
        stacks: { enabled, groupBy, sortBy: stackSort, expandedStackIds, topFileIds } },
      notesScroll: notesViewState.scroll,
    });
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
        modernGreenMenu={modernMac}
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
        {#if window.utilityKind === 'application-about'}
          <GoldenGateAboutApp application={applications[window.appId]} {profile} windowId={window.id} execute={commands.execute} />
        {:else if window.utilityKind === 'application-settings'}
          <GoldenGateNotesSettings preferences={notesState.preferences} windowId={window.id} execute={commands.execute} />
        {:else if hasFileWorkflows && window.appId === 'printcenter'}
          <GoldenGatePrintCenter printing={printingState} execute={commands.execute} />
        {:else if Applications}
          <Applications appId={window.appId} windowId={window.id} {profile} native={adapter.nativeForWindow(nativeState, window.id)} execute={commands.execute} registerView={registerApplicationView} />
        {:else if window.appId === 'messages'}
          <MessagesWindow
            {...(messagesState ? { scene: messagesState } : {})}
            assets={profile.assets}
            active={active && interactive}
            zoomed={window.zoomed}
            fullScreen={window.fullScreen}
            revealedTop={fullScreenStage.topRevealed}
            modernGreenMenu={modernMac}
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
            {...(hasEditWorkflows ? { windowId: window.id, editing: editingPreferences, dictionaryStatus,
              textTools: textTools.targets(), ontextinput: editNativeText, ontextbeforeinput: observeTextBeforeInput } : {})}
            {...(hasViewWorkflows ? { workflowView: viewWorkflows.notesForWindow(window.id), sortedState: notesProjection,
              onviewoptions: () => executeSession({ command: 'app.commandMenu.open', target: { menuId: 'view', appId: 'notes' }, payload: {} }) } : {})}
            active={active && interactive}
            zoomed={window.zoomed}
            fullScreen={window.fullScreen}
            revealedTop={fullScreenStage.topRevealed}
            modernGreenMenu={modernMac}
            onfullscreen={() => toggleWindowFullScreen(window.id)}
            onsplitbegin={event => beginSplitView(window.id, event)}
            onsplitside={event => changeSplitSide(window.id, event)}
            ongreenmenu={() => windowCommand('window.greenMenu.open', window.id)}
            onclose={() => windowCommand('window.close', window.id)}
            onminimize={() => windowCommand('window.setMinimized', window.id, { minimized: true })}
            onzoom={() => toggleWindowZoom(window.id)}
          />
        {:else if hasDockContext && window.appId === 'settings'}
          {#if hasAppearance && window.settingsPane === 'appearance'}
            <MacAppearancePreferences {profile} state={appearanceState} execute={commands.execute} />
          {:else if hasDashboard && window.settingsPane === 'mission-control'}
            <DashboardPreferences mode={dashboardState.mode} execute={commands.execute} />
            <div class="settings-pane-links">
              <button type="button" class="settings-pane-link" onclick={() => commands.execute({ command: 'appearance.preferences.open' })}>General…</button>
            </div>
          {:else}
            <MacDockPreferences {profile} preferences={desktopState.dock.preferences} execute={commands.execute} />
            <div class="settings-pane-links">
              {#if hasAppearance}
                <button type="button" class="settings-pane-link" onclick={() => commands.execute({ command: 'appearance.preferences.open' })}>{modernMac ? 'Appearance…' : 'General…'}</button>
              {/if}
              {#if hasDashboard}
                <button type="button" class="settings-pane-link" onclick={() => commands.execute({ command: 'dashboard.preferences.open' })}>Mission Control…</button>
              {/if}
            </div>
          {/if}
        {:else if window.utilityKind === 'desktop-info'}
          <MacDesktopInfo {profile} info={desktopDetails[window.fileId]} windowId={window.id} sections={window.infoSections} execute={commands.execute} />
        {:else if window.utilityKind === 'desktop-view-options'}
          <MacDesktopViewOptions {profile} options={desktopState.viewOptions} sortBy={desktopState.sortBy} stacks={desktopState.stacks} execute={commands.execute} />
        {:else if macDesktop && window.appId === 'finder'}
          <MacDesktopFolder {profile} windowId={window.id} folderId={window.folderId} files={macFiles.files}
            selectedFileIds={window.finderSelectedFileIds ?? []} dockState={desktopState.dock} execute={commands.execute}
            {...(hasViewWorkflows ? { viewing, viewPresentation, viewState: viewWorkflows.finderForWindow(window.id), sceneTime: macFiles.sceneTime } : {})} />
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

<div class="scene-root" data-session-scene data-profile-id={profile.id} bind:this={sceneRoot}>
<Desktop
  {profile}
  {session}
  {executeSession}
  {registerSessionView}
  {menuBarState}
  {menuBarMenus}
  foreground={foreground || !initialized}
  {windows}
  switchingState={switching}
  {fullScreenStage}
  missionControlOpen={Boolean(spaceState.overview)}
  launchpadOpen={Boolean(launchpadState.view)}
  {dashboardOpen}
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
  {#if dashboardState.view && !spaceState.overview && !switching.switcher}
    <Dashboard {profile} state={dashboardState} sceneRect={stageArea} execute={commands.execute} bind:this={dashboardControls} />
  {/if}
  {#if fullScreenStage.mode === 'pairing' && pairingRect}
    <SplitViewPicker {profile} state={presentation.pairing} items={pairingItems} rect={pairingRect}
      execute={commands.execute} onlayout={slots => { pairingPreviewSlots = slots; }} bind:this={pairingControls} />
  {/if}
  {#if !spaceState.overview && !launchpadState.view && !dashboardOpen && fullScreenStage.mode === 'split'}
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
  {#if !hasMenuBar && switching.appMenu && applicationMenuAnchor}
    <MacApplicationMenu {profile} app={applications[switching.appMenu.appId]} state={switching.appMenu}
      items={appMenuItems} anchor={applicationMenuAnchor} execute={commands.execute} bind:this={applicationMenuControls} />
  {/if}
  {#if fileDialogState.current}
    <div class="file-dialog-backdrop">
      {#if fileDialogState.current.format === 'print'}
        <GoldenGatePrintDialog dialog={fileDialogState.current} files={macFiles.files}
          execute={commands.execute} bind:this={fileDialogControls} />
      {:else}
        <GoldenGateFileSheet dialog={fileDialogState.current} files={macFiles.files}
          execute={commands.execute} bind:this={fileDialogControls} />
      {/if}
    </div>
  {/if}
  {#if helpPane}
    <div class="help-placement" style:top="4px" style:height={`${Math.max(1, Math.min(500, area.height - 8))}px`}>
      <GoldenGateHelpViewer {profile} pane={helpPane} execute={commands.execute} {foreground} bind:this={helpView} />
    </div>
  {/if}
</Desktop>
</div>

<style>
  .scene-root { position: absolute; inset: 0; }
  .help-placement { position:absolute; left:50%; transform:translateX(-50%); width:min(700px,calc(100% - 8px)); max-height:calc(100% - 8px); z-index:11500; display:flex; justify-content:center; }
  .file-dialog-backdrop { position: absolute; inset: 0; z-index: 20000; display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 8px; background: #0002; overflow: hidden; }
  .stage-backdrop { position: absolute; z-index: 1; background: black; pointer-events: none; }
  .split-divider { position: absolute; width: 4px; background: #171717; cursor: col-resize; touch-action: none; outline: none; }
  .split-divider:focus-visible { background: var(--appearance-focus, #5797dc); }
  .settings-pane-links { position: absolute; right: 20px; bottom: 12px; display: flex; gap: 8px; }
  .settings-pane-link { padding: 3px 12px; border: 1px solid var(--appearance-border, #aaa); border-radius: 4px; background: var(--appearance-card, #fafafa); color: var(--appearance-ink, #222); font: 12px var(--system-font); }
  .settings-pane-link:focus-visible { outline: 2px solid var(--appearance-focus, #2478d7); outline-offset: 2px; }
</style>

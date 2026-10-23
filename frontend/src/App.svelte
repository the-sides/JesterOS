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
  import NotesApp from './NotesApp.svelte';
  import { createNotesWorkspaceCommands } from './notes-workspace-commands.js';
  import { notesWorkspaceWindow, visibleWorkspaceNotes, noteWorkspaceText, noteWorkspaceTitle, notesWorkspacePublicProjection } from './notes-workspace-state.js';
  import { notesWorkspaceTextSource, notesPlaintextNativeSelection } from './notes-workspace-projections.js';
  import { createMessagesCommands } from './messages-commands.js';
  import { attachmentContent } from './messages-rich-commands.js';
  import { selectedMessageConversation, messagesHistoryCutoff, validateMessagesState, expireMessages, messageOutgoingProfile } from './messages-state.js';
  import Windows11Teams from './Windows11Teams.svelte';
  import BrowserApp from './BrowserApp.svelte';
  import MailApp from './MailApp.svelte';
  import ContactsApp from './ContactsApp.svelte';
  import CalendarApp from './CalendarApp.svelte';
  import { createBrowserCommands } from './browser-commands.js';
  import { browserSessionSnapshot } from './browser-state.js';
  import { browserMenuProvider } from './browser-menus.js';
  import { createMailCommands, createMailServiceDraft } from './mail-commands.js';
  import { mailWindow, createMailWindow, mailNewId, validateMailState } from './mail-state.js';
  import { mailMenuProvider } from './mail-menus.js';
  import { createContactsCommands, contactsMenuProvider } from './contacts-commands.js';
  import { resolveContacts as resolveCanonicalContacts, linkedContact, contactName, contactsWindow, createContact, validateContactsState } from './contacts-state.js';
  import { createCalendarCommands } from './calendar-commands.js';
  import { calendarMenuProvider } from './calendar-menus.js';
  import CallsApp from './CallsApp.svelte';
  import RemindersApp from './RemindersApp.svelte';
  import { createCallsCommands } from './calls-commands.js';
  import { createRemindersCommands } from './reminders-commands.js';
  import { reminderCalendarProjection } from './reminders-state.js';
  import { calendarWidgetProjection, calendarDateString, calendarLocalString, calendarTimestamp, createCalendarInvitation, acceptCalendarInvitation, validateCalendarState } from './calendar-state.js';
  import { reminderWidgetProjection } from './reminders-state.js';
  import { canonicalStringUnits, copyCanonicalData, applyCanonicalData } from './canonical-data.js';
  import { createApplicationFileBridges } from './application-file-bridges.js';
  import { createMessageDraft } from './messages-composition.js';
  import { createDocumentDestinationPresentation, createDocumentDestinationCommands, documentFileMime } from './document-destination-commands.js';
  import { printingDefaults } from './printing-state.js';
  import NativeDocumentDestination from './NativeDocumentDestination.svelte';
  import { recipientFold, recipientIdentity } from './messages-recipients.js';
  import { commandCatalog } from './command-catalog.js';
  import { visibleNotes, createNote, nextNoteTimestamp, noteTitle } from './notes-state.js';
  import { appCommandMenuProviders } from './app-command-menus.js';
  import { messagesAppMenuProviders, messagesMenuShortcut } from './messages-app-menus.js';
  import { menuBarDefaults, createMenuBarCommands } from './menu-bar.js';
  import GoldenGateMenuBar from './GoldenGateMenuBar.svelte';
  import { APPLICATION_MENU_UTILITY_SIZES, goldenApplicationMenuItems, createApplicationMenuCommands } from './application-menu.js';
  import { SYSTEM_UTILITY_SIZES } from './apple-menu.js';
  import { createAppleCommands } from './apple-commands.js';
  import { recordSystemRecent, clearSystemRecents, systemRecentTextDelta, systemStorageSummary, validateSystemState } from './system-state.js';
  import { createStorageCommands } from './storage-commands.js';
  import { storageInventory, storageRows, trashStorageFiles, restoreStorageFiles, purgeStorageFiles,
    setStorageRecommendation, maintainStorage, downloadStorageFile } from './storage-model.js';
  import GoldenGateAboutThisMac from './GoldenGateAboutThisMac.svelte';
  import GoldenGateSystemInformation from './GoldenGateSystemInformation.svelte';
  import GoldenGateForceQuit from './GoldenGateForceQuit.svelte';
  import { captureForceQuitLease, forceQuitLeaseCurrent, forceQuitWindowTarget } from './force-quit-model.js';
  import GoldenGateSystemAboutSettings from './GoldenGateSystemAboutSettings.svelte';
  import GoldenGateSystemCoverage from './GoldenGateSystemCoverage.svelte';
  import { createWifiCommands } from './wifi-commands.js';
  import GoldenGateWifiSettings from './GoldenGateWifiSettings.svelte';
  import GoldenGateWifiJoin from './GoldenGateWifiJoin.svelte';
  import { createBatteryCommands } from './battery-commands.js';
  import GoldenGateBatterySettings from './GoldenGateBatterySettings.svelte';
  import GoldenGateMenuBarSettings from './GoldenGateMenuBarSettings.svelte';
  import GoldenGateBatteryOptions from './GoldenGateBatteryOptions.svelte';
  import { createClockCommands } from './clock-commands.js';
  import GoldenGateClockOptions from './GoldenGateClockOptions.svelte';
  import GoldenGateClockTimeEdit from './GoldenGateClockTimeEdit.svelte';
  import GoldenGateDateTimeSettings from './GoldenGateDateTimeSettings.svelte';
  import { createSoundCommands } from './sound-commands.js';
  import GoldenGateSoundSettings from './GoldenGateSoundSettings.svelte';
  import { createBluetoothCommands } from './bluetooth-commands.js';
  import GoldenGateBluetoothSettings from './GoldenGateBluetoothSettings.svelte';
  import GoldenGateBluetoothPair from './GoldenGateBluetoothPair.svelte';
  import { createInputCommands } from './input-commands.js';
  import GoldenGateInputSettings from './GoldenGateInputSettings.svelte';
  import GoldenGateInputViewer from './GoldenGateInputViewer.svelte';
  import { createSpotlightCommands } from './spotlight-commands.js';
  import GoldenGateSpotlight from './GoldenGateSpotlight.svelte';
  import { createSpotlightPreferencesCommands } from './spotlight-preferences-commands.js';
  import { spotlightFileExcluded } from './spotlight-preferences.js';
  import { prepareSpotlightPreview } from './spotlight-preview.js';
  import GoldenGateSpotlightSettings from './GoldenGateSpotlightSettings.svelte';
  import { createDomainNotificationBridges, createNotificationCommands } from './notification-commands.js';
  import GoldenGateNotificationCenter from './GoldenGateNotificationCenter.svelte';
  import GoldenGateNotificationBanner from './GoldenGateNotificationBanner.svelte';
  import GoldenGateNotificationSettings from './GoldenGateNotificationSettings.svelte';
  import { dismissNotification } from './notification-model.js';
  import { resolveNotificationDestination, retainNotificationDestination, notificationDestinationActions } from './notification-destinations.js';
  import { createNotificationWidgetCommands } from './notification-widget-commands.js';
  import GoldenGateWidgetGallery from './GoldenGateWidgetGallery.svelte';
  import GoldenGateWidgetData from './GoldenGateWidgetData.svelte';
  import { widgetDataApps, widgetDataScope, validateWidgetsState } from './notification-widget-model.js';
  import GoldenGateAboutApp from './GoldenGateAboutApp.svelte';
  import GoldenGateNotesSettings from './GoldenGateNotesSettings.svelte';
  import { createFinderFileCommands } from './finder-file-commands.js';
  import { createTextEditingCommands } from './text-editing-commands.js';
  import { createFinderEditing } from './finder-editing.js';
  import { createTextAssistance } from './text-assistance.js';
  import { createTextToolsCommands } from './text-tools-commands.js';
  import { selectNativeText, documentControlRange, controlDocumentOffset } from './text-native-selection.js';
  import { createNativeClipboardCommands } from './native-clipboard.js';
  import { validateViewing, finderPresentationDefaults } from './viewing-state.js';
  import { createViewWorkflowCommands } from './view-workflow-commands.js';
  import { createWindowExtensionCommands } from './window-extension-commands.js';
  import { createHelpViewerCommands } from './help-viewer-commands.js';
  import { helpMenuProviders } from './help-menu-model.js';
  import { helpArticles } from './help-content.js';
  import GoldenGateHelpViewer from './GoldenGateHelpViewer.svelte';
  import { createServiceCommands } from './service-commands.js';
  import { createServiceSources } from './service-sources.js';
  import { serviceMenuItems } from './service-registry.js';
  import { communicationEntries, communicationEntry, replyToCommunication } from './communication-state.js';
  import GoldenGateServiceProvider from './GoldenGateServiceProvider.svelte';
  import GoldenGateServiceLookup from './GoldenGateServiceLookup.svelte';
  import GoldenGateServicesContext from './GoldenGateServicesContext.svelte';
  import WindowControls from './WindowControls.svelte';
  import { clampPosition, expandedBounds, resizeBounds, fitNormalBounds as fitRetainedBounds, WINDOW_RESIZE_AXES } from './window-state.js';
  import { getOSProfile, listOSProfiles } from './os-profiles.js';
  import { captureRetainedView, restoreRetainedView } from './retained-native-view.js';
  import { nativeDomainDefinitions, nativeDomainForWindow, nativeInstalledAppMetadata } from './native-domain-registry.js';
  import { nativeDomainComponents } from './native-domain-components.js';
  import { createDefaultApplicationFiles } from './default-application-files.js';
  import { createDesktopFrameCapture } from './desktop-frame-capture.js';
  import { fictionalSessionDefaults } from './fictional-session.js';
  import { createSceneRuntimeInventory } from './scene-runtime-inventory.js';

  let { profile: profileInput, adapter: adapterInput, seed: seedInput, savedScene: savedSceneInput, registerCommands, selectProfile,
    registerSessionScene, registerSessionView, session, executeSession, menuBarState: sharedMenuBarState, menuBarMenus = [], dismissMenuBar: dismissSharedMenuBar, getMenuReturnFocus: getSharedMenuReturnFocus,
    foreground = true, appearanceOwner = true, windowNamespace = '' } = $props();
  let sceneRoot;
  // One immutable profile per scene instance. A profile change mounts a fresh
  // instance instead of relabeling incompatible application/view state.
  const profile = untrack(() => profileInput);
  const adapter = untrack(() => adapterInput);
  const seed = untrack(() => seedInput);
  const savedScene = untrack(() => savedSceneInput);
  const initialData = adapter.createSceneData(savedScene?.seed ?? seed, profile);
  let nativeApplications = $state(Object.fromEntries(Object.keys(nativeDomainDefinitions)
    .filter(key => key !== 'browser').map(key => [key, initialData[key]])));
  const hasRetention = profile.capabilities.includes('scene.saved-session');
  const { Desktop, Window, MessagesWindow, NotesWindow, Applications } = adapter;
  const applications = $derived({ ...profile.applications, ...nativeInstalledAppMetadata(nativeApplications.store, profile) });
  const macDesktop = profile.family === 'macos';
  const expandedProperty = adapter.expandedProperty;
  const hasMenuBar = profile.capabilities.includes('shell.menu-bar');
  const legacyMessagesMenu = $state(menuBarDefaults());
  const legacyMenuViews = new Map();
  let legacyMenuLifecycle;
  const menuBarState = $derived(sharedMenuBarState ?? legacyMessagesMenu);
  const dismissMenuBar = () => hasMenuBar ? dismissSharedMenuBar?.() : legacyMenuLifecycle?.clear();
  const getMenuReturnFocus = () => hasMenuBar ? getSharedMenuReturnFocus?.() : legacyMenuLifecycle?.getReturnFocus();
  const hasWifi = profile.capabilities.includes('status.wifi');
  const hasBattery = profile.capabilities.includes('status.battery');
  const hasClock = profile.capabilities.includes('status.clock');
  const hasSound = profile.capabilities.includes('status.sound');
  const hasBluetooth = profile.capabilities.includes('status.bluetooth');
  const hasInput = profile.capabilities.includes('status.input');
  const hasSpotlight = profile.capabilities.includes('shell.spotlight');
  const hasNotifications = profile.capabilities.includes('shell.notification-center');
  const hasWidgets = profile.capabilities.includes('shell.notification-widgets');
  const hasMessages = profile.capabilities.includes('messages.conversations');
  const hasApplicationMenu = profile.capabilities.includes('shell.application-menu');
  const hasFileWorkflows = profile.capabilities.includes('shell.file-workflows');
  const hasEditWorkflows = profile.capabilities.includes('shell.edit-workflows') || profile.capabilities.includes('notes.workspace');
  const hasViewWorkflows = profile.capabilities.includes('shell.view-workflows');
  const hasWindowExtensions = profile.capabilities.includes('shell.window-extensions');
  const hasHelpWorkflows = profile.capabilities.includes('shell.help-workflows');
  const hasHelpViewer = hasHelpWorkflows && Object.keys(profile.applications).some(appId => helpArticles(profile, appId).length > 0);
  const hasServices = profile.capabilities.includes('shell.services-workflows');
  const hasAppleMenu = profile.capabilities.includes('shell.apple-menu');
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
  const WINDOW_UTILITY_SIZES = { ...APPLICATION_MENU_UTILITY_SIZES, ...SYSTEM_UTILITY_SIZES,
    'teams-call': { width: 960, height: 680, minimumSize: { width: 640, height: 480 } },
    'document-print': { width: macDesktop ? 740 : 900, height: macDesktop ? 620 : 650, minimumSize: { width: 560, height: 440 } },
    'document-picker': { width: macDesktop ? 760 : 820, height: 550, minimumSize: { width: 540, height: 400 } },
    'document-share': { width: macDesktop ? 450 : 620, height: macDesktop ? 390 : 460, minimumSize: { width: 360, height: 300 } } };
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
  const switching = $state({ ...applicationSwitchingDefaults(profile), ...savedScene?.switching });
  let closedWindows = $state(savedScene?.closedWindows ?? {});
  const pendingWindowViews = new Map(Object.entries(savedScene?.views ?? {}));
  const utilityReturnFocus = new Map();
  let utilityPreparation = $state.raw(null);
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
  let spotlightPane = $state(null), spotlightController = $state.raw(null);
  const spotlightViews = new Map();
  $effect(() => { if (spotlightController) spotlightController.reconcile(); });
  let spotlightPreferencesController;
  let notificationPane = $state(null), notificationController = $state.raw(null);
  const notificationViews = new Map();
  const notificationUi = $state({ banners: [], items: {} });
  const notificationBannerViews = new Map();
  $effect(() => { if (notificationController) notificationController.reconcile(); });
  const widgetUi = $state({ editor: null, editingWidgetId: null, contextWidgetId: null, scrolls: {} });
  let widgetController = $state.raw(null), widgetOpening = $state.raw(null);
  const widgetEditorViews = new Map(), widgetDataViews = new Map();
  $effect(() => { if (widgetController) widgetController.reconcile(); });
  $effect(() => { if (helpViewer) { foreground; activeAppId; switching.switcher; presentation.pairing; fileDialogState.current; helpViewer.reconcile(); } });
  let services = $state.raw(null), serviceSources;
  let serviceLookup = $state.raw(null), serviceContext = $state.raw(null), servicePending = $state.raw(null), servicePreparation = $state.raw(null);
  let serviceLookupView = $state.raw(null), serviceContextView = $state.raw(null), serviceEpoch = $state(0);
  const serviceViews = new Map(), sampleServiceViews = new Map();
  let serviceErrors = $state({});
  $effect(() => { if (services) { foreground; activeAppId; activeWindowId; switching.switcher; presentation.pairing;
    fileDialogState.current; communicationsState; notesState.selectedId; serviceEpoch; services.reconcile(); } });
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
  const spaceState = $state({ ...spacesDefaults(), ...savedScene?.spaces });
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
  let notesState = $state(initialData.notes);
  let nativeState = $state(initialData.native);
  adapter.restoreWindows?.(nativeState, windows, savedScene, profile);
  let messagesState = $state(initialData.messages);
  let browserState = $state(initialData.browser);
  let mailState = $state(initialData.mail);
  let contactsState = $state(initialData.contacts);
  let calendarState = $state(initialData.calendar);
  let callsState = $state(initialData.calls);
  let remindersState = $state(initialData.reminders);
  let sharedMutationReserve = 0;
  const domainViews = new Map();
  const domainControllers = new Map();
  const nativeContexts = new Map(), nativeControllers = new Map();
  const ownedNativeTargets = new Map();
  let standaloneSession = $state(session ? null : fictionalSessionDefaults(profile));
  const nativeHardware = { touchId: !['macos-high-sierra-10.13', 'macos-mojave-10.14'].includes(profile.id),
    tablet: false, mouse: true, trackpad: true, camera: true, microphone: true };
  const messagesViews = new Map();
  let messagesViewEpoch = $state(0);
  let messagesController;
  let communicationsState = $state(hasServices ? initialData.communications : undefined);
  const systemState = $state(initialData.system);
  const notificationBridges = createDomainNotificationBridges({
    profile, getState: () => systemState.notifications, alive: () => !disposed,
    getSceneTime: () => sharedClockWriter.getSceneTime(),
    canCommit: delta => completeSceneStringUnits() + delta <= 4 * 1024 * 1024,
    reserve: (delta, commit) => {
      sharedMutationReserve += delta;
      try { return commit(); } finally { sharedMutationReserve -= delta; }
    },
    onPosted: entry => notificationController?.notificationPosted(entry),
    onRemoved: () => notificationController?.notificationRemoved(),
  });
  const notificationPorts = {
    notify: notificationBridges.notify, planNotification: notificationBridges.planNotification,
    updateNotification: notificationBridges.updateNotification,
    updateNotifications: notificationBridges.updateNotifications,
  };
  const spotlightFileIndex = $derived(new Map((macFiles?.files ?? []).map(file => [file.id, file])));
  const wifiPresentation = $state({ otherNetworks: false, join: null });
  let wifiJoinView = $state(null), wifiController;
  const batteryPresentation = $state({ options: null });
  let batteryOptionsView = $state(null);
  const clockPresentation = $state({ options: null, editor: null });
  let clockOptionsView = $state(null), clockTimeView = $state(null);
  const soundPresentation = $state({ inputsExpanded: false });
  let soundMediaRevision = $state(0);
  const bluetoothPresentation = $state({ pair: null });
  let bluetoothPairView = $state(null);
  const inputPresentation = $state({ keyboard: null, characters: null, activeKind: null });
  let inputLeaseRevision = $state(0);
  const inputViewerViews = $state({ keyboard: null, characters: null });
  const inputGraphemes = hasInput ? new Intl.Segmenter('und', { granularity: 'grapheme' }) : null;
  let storageConfirmation = $state(null);
  let storageConfirmationLease = null;
  let nextStorageConfirmation = 1;
  let forceQuitConfirmation = $state(null);
  let forceQuitConfirmationLease = null;
  let forceQuitReturnControl = null;
  const applicationLifetimes = hasAppleMenu ? new Map() : null;
  const forceQuitScope = hasAppleMenu ? crypto.randomUUID() : null;
  let nextForceQuitConfirmation = 1;
  let storageMaintenanceError = $state(null);
  let storageMaintenanceClock = null;
  let appearanceState = $state(macDesktop ? initialData.appearance ?? appearanceDefaults(profile) : undefined);
  let printingState = $state(initialData.printing ?? printingDefaults());
  let documentDestinations = $state(createDocumentDestinationPresentation());
  let editingPreferences = $state(hasEditWorkflows ? initialData.editing : undefined);
  let viewing = $state(hasViewWorkflows ? initialData.viewing : undefined);
  $effect(() => {
    if (appearanceOwner) return applyAppearance(document.documentElement, profile, macDesktop ? appearanceState
      : { mode: nativeState.apps.settings.theme, accent: nativeState.apps.settings.accent });
  });
  let macFiles = $state(macDesktop ? createMacSceneFiles() : undefined);
  let windowsSceneTime = $state(macDesktop ? null : initialData.files.sceneTime);
  const clockContext = $derived({ sceneTime: macDesktop ? macFiles.sceneTime : windowsSceneTime,
    timeZone: systemState.clock.timeZone, use24Hour: systemState.clock.use24Hour });
  let clockPumpWork = Promise.resolve();
  const sharedClockWriter = { getSceneTime: () => macDesktop ? macFiles.sceneTime : windowsSceneTime,
    onTimeChanged: time => setClockSceneTime(Math.max(sharedClockWriter.getSceneTime(), time)) };
  const storageManagement = $derived(hasAppleMenu ? storageInventory(profile, macFiles) : null);
  const systemStorage = $derived(hasAppleMenu ? systemStorageSummary(profile, macFiles, storageManagement) : null);
  let recentDocumentCursor = hasAppleMenu ? macFiles.files.reduce((latest, file) =>
    recentDocument(file) && Number.isFinite(file.lastOpenedAt) ? Math.max(latest, file.lastOpenedAt) : latest, 0) : 0;
  $effect(() => {
    if (!hasAppleMenu) return;
    // All actual document-open workflows advance this existing file clock.
    // Start beyond restored timestamps so a previously cleared menu stays clear.
    const opened = macFiles.files.filter(file => recentDocument(file)
      && Number.isFinite(file.lastOpenedAt) && file.lastOpenedAt > recentDocumentCursor)
      .sort((left, right) => left.lastOpenedAt - right.lastOpenedAt);
    for (const file of opened) {
      recentDocumentCursor = file.lastOpenedAt;
      recordSystemRecent(systemState, 'documents', file.id);
    }
  });
  $effect(() => {
    if (!hasAppleMenu) return;
    for (const window of windows) {
      if (window.utilityKind === 'system-force-quit' && !runningAppIds.includes(window.forceQuitSelectedAppId)) {
        window.forceQuitSelectedAppId = runningAppIds.includes(activeAppId) ? activeAppId : runningAppIds[0] ?? null;
      }
    }
  });
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
    scroll: { list: { top: 0, left: 0 }, editor: { top: 0, left: 0 } } } : undefined);
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
    ...createApplicationCommands(() => applications, {
      available: app => app.presentation ? sceneInteractionsAvailable() : windowInteractionsAvailable(),
      hasWorkspace: () => area.width > 0 && area.height > 0,
      hasWindow: appId => windows.some(window => window.appId === appId),
      isQuitting: appId => pendingQuitAppIds.includes(appId),
      canCreateWindow: appId => adapter.canCreateWindow?.(nativeState, appId) ?? true,
      present: (kind, ownership) => handlers[`shell.${kind}.open`]({}, {}, ownership),
      open: (appId, title, fresh, options) => openWindow(appId, title, fresh, options.utilityKind, options),
      focusKeyboard: focusKeyboardWindow,
      quit: (appId, ownership) => quitApplication(appId, false, ownership),
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
    getMenuItems: getDesktopContextMenuItems,
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
      prepareOpen: file => {
        if (!hasAppleMenu) return null;
        const record = liveFile(macFiles, file.id);
        if (!record) return rejected('stale_target', 'The file is no longer live.');
        if (macFiles.sceneTime >= 8_640_000_000_000_000 - 1
          || record.localResident === false && record.revision >= Number.MAX_SAFE_INTEGER - 1)
          return rejected('limit_exceeded', 'Opening this file exceeds the scene clock or residency revision budget.');
        const historyUnits = systemRecentTextDelta(systemState, 'applications', file.appId)
          + (recentDocument(file) ? systemRecentTextDelta(systemState, 'documents', file.id) : 0);
        const metadataUnits = !record.readOnly && !Object.hasOwn(record, 'lastOpenedAt') ? 'lastOpenedAt'.length : 0;
        if (workflowTextSize() + historyUnits + metadataUnits > 4 * 1024 * 1024)
          return rejected('limit_exceeded', 'Opening this file exceeds the complete-scene history and text budget.');
        return null;
      },
      openedFile: (windowId, file) => {
        if (!macDesktop) return;
        const window = windows.find(window => window.id === windowId);
        const record = liveFile(macFiles, file.id);
        record.lastOpenedAt = nextMacFileTimestamp(macFiles);
        if (hasAppleMenu && record.localResident === false) {
          record.localResident = true; record.revision++;
          finderEditing?.invalidateFiles([record.id]);
        }
        if (hasAppleMenu && recentDocument(file)) recordSystemRecent(systemState, 'documents', file.id);
        if (file.kind === 'application') return;
        if (file.kind === 'folder') setFinderFolder(window, file.id);
        else window.fileId = file.id;
      },
      focusDesktop,
      openFile: file => {
        const record = applicationFiles.getFile(file.id);
        const mime = record && documentFileMime(record);
        if (record && (['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'application/pdf', 'application/rtf'].includes(mime)
          || typeof mime === 'string' && mime.startsWith('text/'))) {
          const sourceWindow = windows.find(window => window.id === activeWindowId);
          return openAssociatedVirtualFile(record.id, {}, {
            windowId: sourceWindow?.id,
            guard: () => !disposed && windowInteractionsAvailable()
              && (!sourceWindow || windows.find(window => window.id === sourceWindow.id) === sourceWindow),
          });
        }
        return handlers['app.open']({ appId: file.appId }, file.kind === 'application' ? {} : { title: file.name });
      },
      windowAction: (command, target, payload) => handlers[command](target, payload),
    }),
  );
  if (hasMessages && messagesState) {
    messagesController = createMessagesCommands({
      profile, getState: () => messagesState, alive: () => !disposed,
      ...sharedClockWriter,
      ...notificationPorts,
      notifyMessage: notificationBridges.notify,
      getWindow: messageWindow, getWindows: () => windows, getView: id => messagesViews.get(id),
      available: messageWindowAvailable, focusWindow,
      getActiveWindowId: () => activeWindowId,
      resolveRecipient: resolveMessageRecipient,
      getContacts: () => contactsState,
      getContactEndpoints: () => captureMessageContactEndpoints()?.endpoints ?? [],
      captureContactEndpoints: captureMessageContactEndpoints,
      getReceivedFileFolders: () => desktopFileStore.files.filter(file => file.kind === 'folder' && !file.readOnly
        && file.id !== 'trash' && applicationFiles.getFile(file.id) === file).map(file => ({ id: file.id, name: file.name })),
      captureOutgoingProfile: conversation => {
        const contacts = captureMessageContactEndpoints();
        if (!contacts) return null;
        const endpoints = new Set(contacts.endpoints.map(recipientIdentity));
        return { profile: messageOutgoingProfile(messagesState, conversation,
          conversation.participants.every(address => endpoints.has(recipientIdentity(address)))), current: contacts.current };
      },
      setBlockedAddresses: setCanonicalBlockedAddresses,
      getClipboard: () => clipboardState,
      setClipboard: (spec, owner) => applicationFiles.setClipboard(spec, owner),
      getFile: id => applicationFiles.getFile(id),
      createFile: (spec, owner) => applicationFiles.createFile(spec, owner),
      planFile: (spec, owner) => applicationFiles.planFile(spec, owner),
      saveAttachmentFile: (spec, owner) => destinationCommands.saveFile(spec, owner),
      openFile: openAssociatedVirtualFile,
      openSharedMessageContent,
      chooseFile: (spec, owner) => destinationCommands.chooseFile(spec, owner),
      printDocument: (spec, owner) => destinationCommands.printDocument(spec, owner),
      ...(profile.family === 'windows' ? {
        getSearchOptions: () => nativeState.apps.teams.ui.searchMode === 'history'
          ? { scope: 'history', conversationId: messagesState.selectedConversationId,
            historySince: messagesHistoryCutoff(sharedClockWriter.getSceneTime()) } : { scope: 'names' },
        showThread: async (window, guard) => {
          if (!guard()) return false;
          const result = await handlers['win11.teams.surface.set']({ windowId: window.id }, { surface: 'full' });
          return result.status === 'applied' && messageWindow(window.id) === window;
        },
      } : {}),
      canCommitQuery: delta => completeSceneStringUnits() + delta <= 4 * 1024 * 1024,
      canCommit: candidate => completeSceneStringUnits() - persistentStringUnits(messagesState)
        + persistentStringUnits(candidate) <= 4 * 1024 * 1024,
      settle: async () => { await tick(); await tick(); },
    });
    Object.assign(handlers, messagesController.handlers);
  }
  if (hasEditWorkflows) {
    textEditing = createTextEditingCommands(notesState, clipboardState, {
      ...sharedClockWriter,
      available: windowInteractionsAvailable, dataAvailable: sceneCoreAvailable,
      getView: id => domainViews.get(id),
      prepare: prepareOwnedText,
      invoke: (command, target, payload) => handlers[command](target, payload),
    });
    Object.assign(handlers, textEditing.handlers);
    const ownedTextTools = createTextToolsCommands(textToolsState, editingPreferences, clipboardState, textAssistance, {
      available: windowInteractionsAvailable, getDocument: ownedTextDocument, getNotesWindow: ownedNotesWindow,
      getToolInput: ownedToolInput, focusTool: focusOwnedTool, finishToolSelection: finishToolSelection,
      prepareDocument: target => prepareOwnedText({ ...target, control: 'editor' }),
      revealMatch: revealNoteMatch, invoke: (command, target, payload) => handlers[command](target, payload),
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
  if (macDesktop) {
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
    if (hasFileWorkflows && hasEditWorkflows) {
      finderEditing = createFinderEditing({ ...finderContext, clipboard: clipboardState, onChanged: () => editingEpoch++,
        filesChanged: reconcileFinderLocations,
        selectDesktop: fileIds => { desktopState.selectedFileIds = [...fileIds]; desktopState.selectionAnchorId = fileIds[0] ?? null; } });
      finderContext.editingHistory = finderEditing;
      Object.assign(handlers, finderEditing.handlers);
    }
    const finderCommands = createFinderFileCommands(finderContext);
    if (hasFileWorkflows) Object.assign(handlers, finderCommands);
    else handlers['finder.selection.set'] = finderCommands['finder.selection.set'];
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
  if (hasHelpViewer) {
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
  if (hasServices) {
    serviceSources = createServiceSources({
      namespace: () => windowNamespace, available: servicesAvailable,
      getPhysicalSource: getPhysicalServiceSource, getContactSource: getContactServiceSource,
      ownsPresentation: source => source.windowId === null ? source.appId === 'finder' && desktopView?.itemsAvailable() === true
        : getServiceFrame(source.windowId, false)?.window === source.window,
      retainedSource: () => services?.retainedSource(),
    });
    const serviceCommands = createServiceCommands({
      ...sharedClockWriter, profile, namespace: () => windowNamespace, getNotesState: () => notesState,
      ui: { get lookup() { return serviceLookup; }, set lookup(value) { serviceLookup = value; },
        get context() { return serviceContext; }, set context(value) { serviceContext = value; } },
      available: servicesAvailable, getSource: serviceSources.getSource, sourceCurrent: serviceSources.current,
      ownsSourcePresentation: serviceSources.owns, describeSource: serviceSources.describe,
      captureReturn: () => ({ ...captureSessionDesktop(), focus: services?.getReturnFocus() ?? captureNativeFocus() }),
      restoreReturn: (snapshot, source) => serviceSources.owns(source) ? restoreSessionDesktop(snapshot) : false,
      settle: async () => { await tick(); await tick(); }, getLookupView: () => serviceLookupView, getContextView: () => serviceContextView,
      getProvider: getServiceProvider, describeProviders: describeServiceProviders,
      prepareServiceDestination, serviceDestinationCurrent, rollbackServiceDestination, commitServiceTransition,
      setProviderSelection, setClipboard: (spec, owner) => applicationFiles.setClipboard(spec, owner),
      prepareSource: prepareServiceSource, showFileInfo: showServiceFileInfo,
      changed: () => serviceEpoch++,
    });
    services = serviceCommands;
    Object.assign(handlers, serviceCommands.handlers);
  }
  if (hasApplicationMenu || macDesktop && hasMessages) Object.assign(handlers, createApplicationMenuCommands({
    profile, notes: notesState,
    available: () => windowInteractionsAvailable() && !switching.switcher && !presentation.pairing,
    getActiveAppId: () => activeAppId, getRunningAppIds: () => runningAppIds,
    isHidden: isAppHidden, isQuitting: appId => pendingQuitAppIds.includes(appId),
    openNotesPreferences: async () => {
      const window = await prepareDomainWindow('notes', windowInteractionsAvailable);
      return window ? handlers['notes.sheet.open']({ windowId: window.id }, { sheet: 'preferences' })
        : rejected('unavailable', 'The original Notes preferences window is unavailable.');
    },
    openPanel: (appId, kind) => openWindowPanel(appId, kind,
      kind === 'application-about' ? `About ${applications[appId].name}` : `${applications[appId].name} Settings`),
    getPanel: id => {
      const entry = getWindowPanel(id);
      return entry && Object.hasOwn(APPLICATION_MENU_UTILITY_SIZES, entry.window.utilityKind) ? entry : null;
    },
    focusPanel: focusWindowPanel,
  }));
  if (hasWifi) {
    wifiController = createWifiCommands({
      profile, presentation: wifiPresentation, getState: () => systemState.wifi, getView: () => wifiJoinView,
      available: () => sceneCoreAvailable() && !fileDialogState.current && !clockPresentation.options && !clockPresentation.editor && !bluetoothPresentation.pair && !utilityPreparation && !servicePreparation
        && !servicePending && !switching.switcher && !presentation.pairing && !spaceState.overview
        && !launchpadState.view && !dashboardOpen && !desktopState.dock?.appWindows,
      canBegin: () => windowInteractionsAvailable() && !utilityPreparation && !servicePreparation
        && !servicePending && !switching.switcher && !presentation.pairing,
      menuAvailable: () => menuBarState?.menuId === 'wifi' && sharedMenusAvailable()
        && Boolean(sceneRoot?.querySelector('[data-menu-provider="wifi"][data-menu-popup="0"]')),
      canCommit: networkId => workflowTextSize() + networkId.length - (systemState.wifi.connectedNetworkId?.length ?? 0) <= 4 * 1024 * 1024,
      capture: captureSessionDesktop, restore: restoreSessionDesktop,
      settle: async () => { await tick(); await tick(); },
    });
    Object.assign(handlers, wifiController.handlers);
  }
  const batteryController = hasBattery ? createBatteryCommands({
      profile, presentation: batteryPresentation, getState: () => systemState.battery,
      getRunningAppIds: () => runningAppIds, getView: () => batteryOptionsView,
      available: () => sceneCoreAvailable() && !fileDialogState.current && !wifiPresentation.join && !clockPresentation.options && !clockPresentation.editor && !bluetoothPresentation.pair
        && !utilityPreparation && !servicePreparation && !servicePending && !switching.switcher
        && !presentation.pairing && !spaceState.overview && !launchpadState.view && !dashboardOpen && !desktopState.dock?.appWindows,
      canBegin: () => windowInteractionsAvailable() && !utilityPreparation && !servicePreparation
        && !servicePending && !switching.switcher && !presentation.pairing,
      canCommit: delta => workflowTextSize() + delta <= 4 * 1024 * 1024,
      getOwner: windowId => {
        const entry = getSystemPanel(windowId);
        if (entry?.window.appId !== 'settings' || entry.window.utilityKind || entry.window.settingsPane !== 'menu-bar'
          || activeWindowId !== windowId || activeAppId !== 'settings') return null;
        const node = entry.element.querySelector('[data-application-settings-control="battery-options"]');
        if (!node?.isConnected || node.disabled || node.closest('[inert]') || !node.getClientRects().length) return null;
        const rect = node.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit && (hit === node || node.contains(hit)) ? entry.window : null;
      },
      ownerCurrent: owner => Boolean(owner && windows.find(window => window.id === owner.id) === owner
        && owner.appId === 'settings' && !owner.utilityKind && owner.settingsPane === 'menu-bar'
        && !owner.minimized && windowPresented(owner) && !isAppHidden('settings')
        && activeWindowId === owner.id && activeAppId === 'settings'),
      capture: captureSessionDesktop, restore: restoreSessionDesktop,
      settle: async () => { await tick(); await tick(); },
      getMenuReturnFocus: () => menuBarState?.menuId === 'battery' ? getMenuReturnFocus?.() : undefined,
      retireBatteryMenu: async original => {
        if (menuBarState?.menuId !== 'battery') return;
        dismissMenuBar?.(); await tick(); await tick();
        if (original) await restoreSessionDesktop(original);
      },
  }) : null;
  if (batteryController) Object.assign(handlers, batteryController.handlers);
  const clockController = hasClock ? createClockCommands({
    profile, presentation: clockPresentation, getState: () => systemState.clock,
    getSceneTime: () => macFiles.sceneTime, setTime: setClockSceneTime,
    getView: kind => kind === 'options' ? clockOptionsView : clockTimeView,
    available: () => sceneCoreAvailable() && !fileDialogState.current && !wifiPresentation.join && !batteryPresentation.options && !bluetoothPresentation.pair
      && !utilityPreparation && !servicePreparation && !servicePending && !switching.switcher
      && !presentation.pairing && !spaceState.overview && !launchpadState.view && !dashboardOpen && !desktopState.dock?.appWindows,
    canBegin: () => windowInteractionsAvailable() && !utilityPreparation && !servicePreparation
      && !servicePending && !switching.switcher && !presentation.pairing,
    canCommit: delta => workflowTextSize() + delta <= 4 * 1024 * 1024,
    getOwner: (windowId, kind) => {
      const entry = getSystemPanel(windowId), pane = kind === 'options' ? 'menu-bar' : 'date-time';
      if (entry?.window.appId !== 'settings' || entry.window.utilityKind || entry.window.settingsPane !== pane
        || activeWindowId !== windowId || activeAppId !== 'settings') return null;
      const node = entry.element.querySelector(`[data-application-settings-control="${kind === 'options' ? 'clock-options' : 'clock-time-set'}"]`);
      if (!node?.isConnected || node.disabled || node.closest('[inert]') || !node.getClientRects().length) return null;
      const rect = node.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit && (hit === node || node.contains(hit)) ? entry.window : null;
    },
    ownerCurrent: (owner, kind) => Boolean(owner && windows.find(window => window.id === owner.id) === owner
      && owner.appId === 'settings' && !owner.utilityKind && owner.settingsPane === (kind === 'options' ? 'menu-bar' : 'date-time')
      && !owner.minimized && windowPresented(owner) && !isAppHidden('settings')
      && activeWindowId === owner.id && activeAppId === 'settings'),
    capture: captureSessionDesktop, restore: restoreSessionDesktop,
    settle: async () => { await tick(); await tick(); },
    dateShown: () => sceneRoot?.querySelector('[data-menu-invoker="clock"]')?.dataset.dateShown === 'true',
  }) : null;
  if (clockController) Object.assign(handlers, clockController.handlers);
  const soundController = hasSound ? createSoundCommands({
    profile, presentation: soundPresentation, getState: () => systemState.sound,
    getMedia: getNativeSoundPlayers,
    notifyMedia: syncNativeSound,
    available: () => sceneCoreAvailable() && !fileDialogState.current && !wifiPresentation.join && !batteryPresentation.options && !bluetoothPresentation.pair
      && !clockPresentation.options && !clockPresentation.editor && !utilityPreparation && !servicePreparation
      && !servicePending && !switching.switcher && !presentation.pairing && !spaceState.overview
      && !launchpadState.view && !dashboardOpen && !desktopState.dock?.appWindows,
    canBegin: () => windowInteractionsAvailable() && !utilityPreparation && !servicePreparation
      && !servicePending && !switching.switcher && !presentation.pairing,
    canCommit: delta => workflowTextSize() + delta <= 4 * 1024 * 1024,
    getMenuReturnFocus: () => menuBarState?.menuId === 'sound' ? getMenuReturnFocus?.() : undefined,
    retireSoundMenu: original => retireStatusMenu('sound', original), setSettingsTab: setSoundSettingsTab,
  }) : null;
  if (soundController) Object.assign(handlers, soundController.handlers);
  const bluetoothController = hasBluetooth ? createBluetoothCommands({
    profile, presentation: bluetoothPresentation, getState: () => systemState.bluetooth,
    getSound: () => systemState.sound, getView: () => bluetoothPairView,
    available: () => sceneCoreAvailable() && !fileDialogState.current && !wifiPresentation.join && !batteryPresentation.options
      && !clockPresentation.options && !clockPresentation.editor && !utilityPreparation && !servicePreparation
      && !servicePending && !switching.switcher && !presentation.pairing && !spaceState.overview
      && !launchpadState.view && !dashboardOpen && !desktopState.dock?.appWindows,
    canBegin: () => windowInteractionsAvailable() && !utilityPreparation && !servicePreparation
      && !servicePending && !switching.switcher && !presentation.pairing,
    canCommit: delta => workflowTextSize() + delta <= 4 * 1024 * 1024,
    capture: () => menuBarState?.menuId ? getMenuReturnFocus?.() ?? captureSessionDesktop() : captureSessionDesktop(),
    restore: snapshot => !disposed && foreground ? restoreSessionDesktop(snapshot) : false,
    settle: async () => { await tick(); await tick(); },
    notifySound: syncNativeSound,
    retireMenu: original => retireStatusMenu('bluetooth', original),
  }) : null;
  if (bluetoothController) Object.assign(handlers, bluetoothController.handlers);
  const inputController = hasInput ? createInputCommands({
    profile, presentation: inputPresentation, getState: () => systemState.input,
    getView: kind => inputViewerViews[kind],
    available: inputInteractionsAvailable, canBegin: inputInteractionsAvailable,
    canCommit: delta => workflowTextSize() + delta <= 4 * 1024 * 1024,
    capture: captureInputOwner, ownerCurrent: inputOwnerCurrent,
    sameEditor: sameInputEditor,
    captureEditor: captureInputEditor, editorCurrent: inputEditorCurrent, insert: insertInputText,
    onChanged: () => { if (!disposed) inputLeaseRevision++; },
    restore: (original, guard) => guard() && inputInteractionsAvailable() && inputOwnerCurrent(original)
      ? restoreSessionDesktop(original) : false,
    settle: async () => { await tick(); await tick(); },
    retireMenu: original => retireStatusMenu('input', original),
  }) : null;
  if (inputController) Object.assign(handlers, inputController.handlers);
  $effect(() => {
    if (inputController) { activeAppId; activeWindowId; windows.length; inputController.reconcile(); }
  });
  if (hasSpotlight) {
    const ownedSpotlight = createSpotlightCommands({
      profile, namespace: untrack(() => `${windowNamespace || 'local'}-${crypto.randomUUID()}`),
      getPane: () => spotlightPane, setPane: pane => { spotlightPane = pane; },
      getView: () => spotlightViews.get(spotlightPane?.spotlightId),
      alive: () => !disposed, available: spotlightInteractionsAvailable,
      getSources: getSpotlightSources, isSourceCurrent: spotlightSourceCurrent,
      getPreferences: () => systemState.spotlight, preparePreview: prepareSpotlightPreview,
      activate: activateSpotlightSource,
      captureReturn: () => ({ snapshot: captureSessionDesktop(), appId: activeAppId,
        windowId: activeWindowId, window: windows.find(window => window.id === activeWindowId) ?? null }),
      restoreReturn: restoreTransientReturn, dismissMenus: () => dismissMenuBar?.(),
      settle: async () => { await tick(); await tick(); },
      beforeOpen: async () => {
        if (notificationPane) {
          const result = await notificationController.handlers['notifications.close']({ centerId: notificationPane.centerId }, {});
          if (result.status !== 'applied') return false;
        }
        return !disposed && spotlightInteractionsAvailable();
      },
    });
    spotlightController = ownedSpotlight;
    Object.assign(handlers, ownedSpotlight.handlers);
    spotlightPreferencesController = createSpotlightPreferencesCommands({
      profile, getState: () => systemState.spotlight, available: spotlightInteractionsAvailable,
      getFolders: spotlightPrivacyFolders, canCommit: delta => workflowTextSize() + delta <= 4 * 1024 * 1024,
      onChanged: () => ownedSpotlight.preferencesChanged(),
      openSettings: async () => {
        const result = await openWindowPanel('settings', undefined, 'Spotlight', 'spotlight');
        if (result.status === 'applied') ownedSpotlight.clear();
        return result;
      },
    });
    Object.assign(handlers, spotlightPreferencesController.handlers);
  }
  if (hasNotifications) {
    const ownedNotifications = createNotificationCommands({
      profile, namespace: untrack(() => `${windowNamespace || 'local'}-${crypto.randomUUID()}`),
      alive: () => !disposed, available: notificationInteractionsAvailable,
      getState: () => systemState.notifications, getSceneTime: sharedClockWriter.getSceneTime,
      canCommit: delta => workflowTextSize() + delta <= 4 * 1024 * 1024,
      reserve: (delta, commit) => {
        sharedMutationReserve += delta;
        try { return commit(); } finally { sharedMutationReserve -= delta; }
      },
      prepareNotificationDismissals: prepareCanonicalNotificationDismissals,
      getPane: () => notificationPane, setPane: pane => { notificationPane = pane; },
      getView: () => notificationViews.get(notificationPane?.centerId),
      getUi: () => notificationUi, getBannerView: id => notificationBannerViews.get(id),
      actions: entry => notificationDestinationActions(resolveNotificationDestination(entry, notificationSources(), profile)),
      retainDestination: entry => retainNotificationDestination(entry, notificationSources, profile, () => !disposed),
      openDestination: openNotificationDestination, completeDestination: completeNotificationDestination,
      snoozeDestination: snoozeNotificationDestination,
      snoozeChoices: entry => entry.destination?.kind === 'clock'
        ? [nativeApplications.clockApp.preferences.snoozeMinutes] : [5, 15, 60],
      replyDestination: replyNotificationDestination, openSettings: openNotificationSettings,
      callDestination: (lease, action, guard) => domainControllers.get(macDesktop ? 'facetime' : 'teams-call')
        .notificationAction(lease.source.recordId, action, { guard }),
      getSettingsOwner: notificationSettingsOwner,
      prepareSettings: async (owner, controlId, guard) => {
        if (!guard() || !owner.view.controlIds().includes(controlId)) return false;
        await tick(); await tick();
        if (!guard() || owner.view.focus(controlId) !== true) return false;
        return guard() && owner.view.focusedControl() === controlId;
      },
      captureFocus: () => ({ snapshot: captureSessionDesktop(), appId: activeAppId,
        windowId: activeWindowId, window: windows.find(window => window.id === activeWindowId) ?? null }),
      restoreFocus: restoreTransientReturn, settle: async () => { await tick(); await tick(); },
      beforeOpen: async () => {
        if (spotlightPane) {
          const result = await spotlightController.handlers['spotlight.close']({ spotlightId: spotlightPane.spotlightId }, {});
          if (result.status !== 'applied') return false;
        }
        dismissMenuBar?.();
        return !disposed && notificationInteractionsAvailable();
      },
    });
    notificationController = ownedNotifications;
    Object.assign(handlers, ownedNotifications.handlers);
  }
  if (hasWidgets) {
    const ownedWidgets = createNotificationWidgetCommands({
      profile, namespace: untrack(() => `${windowNamespace || 'local'}-${crypto.randomUUID()}`),
      alive: () => !disposed, available: notificationNativeAvailable,
      getState: () => systemState.widgets, getUi: () => widgetUi,
      getCenter: () => notificationPane, getCenterView: () => notificationViews.get(notificationPane?.centerId),
      getEditorView: editorId => widgetEditorViews.get(editorId),
      getDataOwner: widgetDataOwner, getDataView: windowId => widgetDataViews.get(windowId),
      getDataTargets: widgetDataTargets, openData: openSelectedSceneData,
      getReminders: () => remindersState, getCalendar: () => calendarState,
      getReminderWidgetProjection: () => reminderWidgetProjection(remindersState),
      getCalendarWidgetProjection: () => calendarWidgetProjection(calendarState),
      setReminderCompleted: setCanonicalReminderCompleted,
      closeCenter: pane => { if (notificationPane === pane) notificationController.clear(); },
      canCommit: delta => workflowTextSize() + delta <= 4 * 1024 * 1024,
      settle: async () => { await tick(); await tick(); },
    });
    widgetController = ownedWidgets;
    Object.assign(handlers, ownedWidgets.handlers);
  }
  if (hasAppleMenu) Object.assign(handlers, createAppleCommands({
    profile, available: () => windowInteractionsAvailable() && !utilityPreparation && !switching.switcher && !presentation.pairing,
    getRunningAppIds: () => runningAppIds,
    openAbout: () => openWindowPanel('finder', 'system-about', 'About This Mac'),
    openSettings: async pane => {
      const title = { about: 'About', displays: 'Displays', storage: 'Storage', wifi: 'Wi-Fi', battery: 'Battery', 'menu-bar': 'Menu Bar', sound: 'Sound', bluetooth: 'Bluetooth', keyboard: 'Keyboard — Text Input' }[pane];
      const result = await openWindowPanel('settings', undefined, title, pane);
      return result.status === 'applied' ? { status: 'applied', target: { ...result.target, pane } } : result;
    },
    renameComputer: (entry, name) => {
      if (workflowTextSize() + name.length - systemState.computerName.length > 4 * 1024 * 1024)
        return rejected('invalid_arguments', 'The computer name exceeds the shared complete-scene text budget.');
      systemState.computerName = name;
      applicationViews.get(entry.window.id)?.setComputerName(name);
      return { status: 'applied', target: { windowId: entry.window.id, computerName: name } };
    },
    openCoverage: () => openWindowPanel('settings', 'system-coverage', 'Warranty and Coverage'),
    openInformation: () => openWindowPanel('systeminformation', undefined, 'System Information'),
    openForceQuit: () => openWindowPanel('finder', 'system-force-quit', 'Force Quit Applications'),
    getPanel: getSystemPanel, controlIds: systemPanelControls, focusPanel: focusWindowPanel,
    getComputerName: () => systemState.computerName,
    requestForceQuit: appId => requestForceQuit(appId, 'quit'),
    requestFinderRelaunch: () => requestForceQuit('finder', 'relaunch'), respondForceQuit,
    clearRecents: () => clearSystemRecents(systemState),
    openRecent: openRecentItem, openServer: openFictionalServer,
  }));
  if (adapter.createCommands) Object.assign(handlers, adapter.createCommands(nativeState, {
    native: nativeState,
    getDesktopView: () => desktopView,
    getApplicationView,
    getWindows: () => windows, getActiveWindowId: () => activeWindowId,
    getProfile: () => profile, focusDesktop, focusWindow, closeWindow, cancelAppQuit,
    getDesktopItems, renameDesktopItem, moveDesktopItems, windowInteractionsAvailable,
    createDesktopFolder, trashDesktopItems, getDesktopFileInfo,
    openAssociatedFile: (fileId, ownership) => openAssociatedVirtualFile(fileId, {}, ownership),
    openLegacySvgFile,
    invoke: (command, target = {}, payload = {}) => handlers[command](target, payload),
  }));
  if (hasAppleMenu) Object.assign(handlers, createStorageCommands({
    profile, available: () => windowInteractionsAvailable() && !utilityPreparation && !switching.switcher && !presentation.pairing,
    getPanel: getSystemPanel, inventory: () => storageManagement, file: fileId => macFiles.files.find(file => file.id === fileId),
    confirmation: () => storageConfirmation, cancelConfirmation: cancelStorageConfirmation,
    requestConfirmation: requestStorageConfirmation, respondConfirmation: respondStorageConfirmation,
    restore: (windowId, fileIds) => {
      const result = storageTransaction(store => restoreStorageFiles(store, fileIds));
      return result.status === 'applied' ? { status: 'applied', target: { windowId, ...result.target } } : result;
    },
    setRecommendation: (windowId, recommendation, enabled) => {
      const result = storageTransaction((store, preferences) => setStorageRecommendation(store, preferences, recommendation, enabled), true);
      return result.status === 'applied' ? { status: 'applied', target: { windowId, ...result.target } } : result;
    },
    advanceClock: milliseconds => storageTransaction((store, preferences) => {
      if (store.sceneTime + milliseconds > 8_640_000_000_000_000 - 1) return rejected('limit_exceeded', 'The virtual clock would exceed its timestamp budget.');
      store.sceneTime += milliseconds;
      const changes = maintainStorage(store, preferences);
      return { status: 'applied', target: { sceneTime: store.sceneTime, ...changes } };
    }, true),
    download: (windowId, fileId) => {
      const result = storageTransaction(store => downloadStorageFile(store, fileId));
      return result.status === 'applied' ? { status: 'applied', target: { windowId, ...result.target } } : result;
    },
    open: async (windowId, fileId) => {
      const result = await handlers['desktop.open']({ fileId }, {});
      return result.status === 'applied' ? { status: 'applied', target: { windowId, fileId, openedWindowId: result.target.windowId } } : result;
    },
    reveal: revealStorageFile,
    scroll: (entry, area, payload) => {
      const node = entry.element.querySelector(area === 'list' ? '[data-storage-file-list]' : '[data-storage-confirmation-list]');
      if (!node?.isConnected) return rejected('unavailable', 'The exact native storage scroll area is not present.');
      if (!payload.observe) { node.scrollTop = payload.top; node.scrollLeft = payload.left ?? 0; }
      return { status: 'applied', target: { windowId: entry.window.id, top: node.scrollTop, left: node.scrollLeft } };
    },
  }));
  const domainGraphs = { browser: browserState, mail: mailState, contacts: contactsState, calendar: calendarState,
    calls: callsState, reminders: remindersState, notes: notesState };
  const applicationFiles = createApplicationFileBridges({
    profile, getStore: () => desktopFileStore, alive: () => !disposed,
    getSceneTime: sharedClockWriter.getSceneTime, getClipboard: () => clipboardState,
    canCommit: delta => completeSceneStringUnits() + delta <= 4 * 1024 * 1024,
    makeRecord: record => { let value = $state(record); return value; },
    reserve: (delta, commit) => {
      sharedMutationReserve += delta;
      try { return commit(); } finally { sharedMutationReserve -= delta; }
    },
  });
  const destinationCommands = createDocumentDestinationCommands({
    profile, getPrinting: () => printingState, getPresentation: () => documentDestinations,
    getFilesStore: () => desktopFileStore, alive: () => !disposed,
    canCommit: delta => completeSceneStringUnits() + delta <= 4 * 1024 * 1024,
    getSceneTime: sharedClockWriter.getSceneTime,
    getWindow: id => windows.find(window => window.id === id),
    getActiveWindowId: () => activeWindowId,
    focusWindow: (id, { guard }) => {
      if (guard() !== true || !destinationWindowAvailable(windows.find(window => window.id === id))) return false;
      focusWindow(id);
      return activeWindowId === id;
    },
    getView: id => domainViews.get(id) ?? messagesViews.get(id),
    available: domainWindowAvailable,
    tick: async () => { await tick(); await tick(); },
    createWindow: (appId, options) => openWindow(appId, options.title, true, options.utilityKind, options),
    closeWindow: (id, ownership) => closeWindow(id, ownership),
    createFile: applicationFiles.createFile,
    setClipboard: (spec, owner) => applicationFiles.setClipboard({ ...spec, kind: 'text', fileIds: [] }, owner),
    composeMail: composeCanonicalMail, composeMessage: composeCanonicalMessage,
  });
  Object.assign(handlers, destinationCommands.handlers);
  const sceneRuntime = createSceneRuntimeInventory({
    profile, hardware: nativeHardware, getShared: getNativeShared,
    makeRecord: value => { let original = $state(value); return original; },
    canCommit: delta => completeSceneStringUnits() + delta <= 4 * 1024 * 1024,
    getRunningAppIds: () => runningAppIds, getWindows: () => windows,
    getFiles: () => desktopFileStore, getSceneTime: sharedClockWriter.getSceneTime,
    getApplications: () => applications, getCatalog: () => sceneCatalog,
    getApplicationGraph: appId => {
      const definition = nativeDomainForWindow(profile, { appId });
      return definition ? definition.key === 'browser' ? browserState : nativeApplications[definition.key]
        : domainGraphs[appId] ?? nativeState?.apps?.[appId];
    },
  });
  $effect(() => {
    runningAppIds.length;
    applications;
    getNativeShared('session')?.users;
    untrack(() => sceneRuntime.synchronize());
  });
  const captureNativeFrame = createDesktopFrameCapture({ getRoot: () => sceneRoot,
    getGeneration: () => `${area.width}:${area.height}`, alive: () => !disposed && foreground });
  const domainClipboard = {
    read: () => clipboardState.text,
    write: text => applicationFiles.setClipboard({ kind: 'text', text, fileIds: [] }).status === 'applied',
  };
  const browserMergeRetirements = new WeakSet();
  for (const [kind, factory] of [['browser', createBrowserCommands], ['mail', createMailCommands],
    ['contacts', createContactsCommands], ['calendar', createCalendarCommands], ['calls', createCallsCommands], ['reminders', createRemindersCommands], ['notes', createNotesWorkspaceCommands]]) {
    const appId = kind === 'browser' ? macDesktop ? 'safari' : 'edge' : kind === 'calls' ? macDesktop ? 'facetime' : 'teams' : kind;
    const utilityKind = kind === 'calls' && !macDesktop ? 'teams-call' : null;
    const matches = window => kind === 'browser' ? ['safari', 'edge', 'chrome'].includes(window.appId) && !window.utilityKind
      : window.appId === appId && (utilityKind ? window.utilityKind === utilityKind : !window.utilityKind);
    const context = {
      profile, getState: () => domainGraphs[kind], alive: () => !disposed,
      ...notificationPorts,
      getShared: getNativeShared, executeOwned: executeNativeOwned,
      getWindow: id => windows.find(window => window.id === id) ?? null,
      getWindows: () => windows.filter(matches),
      getView: id => domainViews.get(id),
      available: domainWindowAvailable, tick, getSceneTime: sharedClockWriter.getSceneTime,
      setSceneDate: setCanonicalSceneDate,
      focusWindow: id => focusWindow(id),
      createWindow: (destination, options = {}) => {
        if (options.isCurrent && options.isCurrent() !== true) return null;
        return openWindow(destination, options.title, true, options.utilityKind, options);
      },
      closeWindow: (id, options = {}) => {
        if (options.isCurrent && options.isCurrent() !== true) return false;
        return closeWindow(id, options);
      },
      canCommit: delta => completeSceneStringUnits() + delta <= 4 * 1024 * 1024,
      clipboard: kind === 'mail' ? clipboardState : domainClipboard, getClipboard: () => clipboardState,
      composeMail: composeCanonicalMail, composeMessage: composeCanonicalMessage,
      printDocument: destinationCommands.printDocument, share: destinationCommands.share,
      chooseFile: destinationCommands.chooseFile,
      startCall: startCanonicalCall,
      getAccount: () => messagesState.account,
      getBlockedAddresses: () => messagesState.blockedAddresses,
      setBlockedAddresses: setCanonicalBlockedAddresses,
      setAccount: setCanonicalAccount,
      resolveContacts: kind === 'browser' ? query => resolveCanonicalContacts(contactsState, query) : resolveNativeContacts,
      ...applicationFiles,
      openFile: kind === 'browser' ? spec => openAssociatedVirtualFile(spec.fileId, null, { guard: spec.isCurrent, windowId: spec.windowId }) : openAssociatedVirtualFile,
      revealFile: kind === 'browser' ? spec => revealCanonicalFile(spec.fileId, { guard: spec.isCurrent, windowId: spec.windowId }) : revealCanonicalFile,
      createContact: createCanonicalContact, acceptInvitation: respondCanonicalInvitation,
      playSound: playCanonicalMailSound,
      mergeBrowserWindows: mergeCanonicalBrowserWindows,
      createMailDraft: createCanonicalMailDraft,
    };
    const controller = factory(context);
    if (kind === 'browser') { nativeContexts.set(kind, context); nativeControllers.set(kind, controller); }
    domainControllers.set(utilityKind ?? appId, controller);
    Object.assign(handlers, controller.handlers);
  }
  for (const definition of Object.values(nativeDomainDefinitions)) {
    if (!definition.createCommands || definition.key === 'browser') continue;
    const context = createNativeContext(definition);
    const controller = definition.createCommands(context);
    nativeContexts.set(definition.key, context);
    nativeControllers.set(definition.key, controller);
    for (const appId of definition.appIds(profile)) domainControllers.set(appId, controller);
    for (const utilityKind of definition.utilityKinds ?? []) domainControllers.set(utilityKind, controller);
    Object.assign(handlers, controller.handlers);
  }
  function representedMacMenuOwner() {
    return macDesktop && ['messages', 'safari', 'mail', 'contacts', 'calendar'].includes(activeAppId);
  }
  if (macDesktop && !hasMenuBar) {
    const menuHandlers = createMenuBarCommands({
      profile, state: legacyMessagesMenu,
      getMenus: () => representedMacMenuOwner() ? sharedMenuProviders().filter(menu => !['wifi', 'battery', 'clock', 'sound', 'bluetooth', 'input'].includes(menu.menuId)) : [],
      getView: id => legacyMenuViews.get(id),
      available: () => foreground && representedMacMenuOwner() && sharedMenusAvailable(),
      settle: async () => { await tick(); await tick(); },
      captureFocus: captureSessionDesktop, restoreFocus: restoreSessionDesktop,
      preparePresentation: () => clearSwitchingPresentations(false, true), restorePresentation: restoreSwitchingPresentations,
      captureAction: captureMenuAction,
      invoke: ({ command, target = {}, payload = {} }) => handlers[command](target, payload),
      registerLifecycle: lifecycle => { legacyMenuLifecycle = lifecycle; },
    });
    for (const [name, operation] of Object.entries(menuHandlers)) {
      const fallback = handlers[name];
      handlers[name] = (target, payload) => representedMacMenuOwner() || legacyMessagesMenu.menuId
        ? operation(target, payload)
        : fallback ? fallback(target, payload) : rejected('unavailable', 'An installed represented Mac application owns these native menus.');
    }
  }
  $effect(() => {
    if (!hasMenuBar && legacyMessagesMenu.menuId && (!representedMacMenuOwner() || !foreground || !sharedMenusAvailable())) legacyMenuLifecycle?.clear();
    if (hasWindowMenu && activeAppId === 'messages' && desktopState.windowMenuOpen) {
      desktopState.windowMenuOpen = false; desktopState.windowMenuItem = null; desktopState.windowMenuScrollTop = 0;
    }
  });
  for (const name of Object.keys(handlers)) {
    if (!Object.hasOwn(commandCatalog, name)) throw new Error(`Missing native command descriptor: ${name}`);
  }
  const sceneCatalog = Object.fromEntries(Object.entries(commandCatalog).filter(([name, descriptor]) =>
    descriptor.profiles.includes(profile.id) && !descriptor.capability.startsWith('session.')
    && !['scene.seed', 'scene.saved-session', 'shell.menu-bar'].includes(descriptor.capability)
    && !(hasMenuBar && (name.startsWith('menu.') || name.startsWith('app.menu.') || name.startsWith('app.commandMenu.') || name === 'desktop.scroll'))));
  // Composite callbacks capture this binding, so they use the same sealed,
  // capability-guarded registry after native profile selection.
  handlers = Object.fromEntries(Object.entries(handlers).filter(([name]) => Object.hasOwn(sceneCatalog, name)));
  const commands = createFeatureCommands(handlers,
    () => $state.snapshot({ profile, windows, activeWindowId, activeAppId, runningAppIds, pendingQuitAppIds, switching, presentation, area, desktop: desktopState,
      ...(hasSpaces ? { spaces: spaceState } : {}),
      ...(hasLaunchpad ? { launchpad: launchpadState } : {}),
      ...(hasDashboard ? { dashboard: dashboardState } : {}),
      ...(hasAppearance ? { appearance: appearanceState } : {}),
      notes: notesWorkspacePublicProjection(notesState),
      ...(messagesState ? { messages: messagesState } : {}),
      browser: browserState, mail: mailState, contacts: contactsState, calendar: calendarState,
      calls: callsState, reminders: remindersState, ...nativeApplications,
      sceneTime: sharedClockWriter.getSceneTime(),
      ...(hasMessages ? { messagesBrowsing: messagesController.targets() } : {}),
      ...(hasServices ? { communications: communicationsState, services: services.targets() } : {}),
      system: systemState,
      ...(hasAppleMenu ? { storageManagement: { inventory: storageManagement, confirmation: storageConfirmation, error: storageMaintenanceError } } : {}),
      ...(hasWifi ? { wifi: wifiController.targets() } : {}),
      ...(hasBattery ? { battery: batteryController.targets() } : {}),
      ...(hasClock ? { clock: clockController.targets() } : {}),
      ...(hasSound ? { sound: soundController.targets() } : {}),
      ...(hasBluetooth ? { bluetooth: bluetoothController.targets() } : {}),
      ...(hasInput ? { input: inputController.targets() } : {}),
      ...(hasSpotlight ? { spotlight: spotlightController.summary() } : {}),
      ...(hasNotifications ? { notifications: notificationController.summary() } : {}),
      ...(hasWidgets ? { widgets: widgetController.summary() } : {}),
      files: desktopFileStore.files,
      ...(hasFileWorkflows ? { printing: printingState, fileDialog: fileDialogState.current } : {}),
      ...(hasEditWorkflows ? { editing: editingTargets(), textTools: textTools.targets() } : {}),
      ...(hasViewWorkflows ? { viewing, viewPresentation: viewingTargets() } : {}),
      ...(hasWindowExtensions ? { windowExtensions: windowExtensions.targets() } : {}),
      ...(hasHelpViewer ? { helpViewer: helpViewer.targets() } : {}),
      ...(nativeState ? { native: nativeState } : {}),
      ...(hasRetention ? { retention: { closedWindows, automaticPersistence: false, reopen: 'last-ordinary-window-current-desktop' } } : {}),
    }),
    settleCommands, sceneCatalog, () => ({
      profiles: listOSProfiles().map(({ id, name, family, version }) => ({ profileId: id, name, family, version })),
      ...(hasWifi ? { wifi: wifiController.targets() } : {}),
      ...(hasBattery ? { battery: batteryController.targets() } : {}),
      ...(hasClock ? { clock: clockController.targets() } : {}),
      ...(hasSound ? { sound: soundController.targets() } : {}),
      ...(hasBluetooth ? { bluetooth: bluetoothController.targets() } : {}),
      ...(hasNotifications ? { notifications: notificationController.targets() } : {}),
      ...(hasWidgets ? { widgets: widgetController.targets() } : {}),
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
        menuItems: getDesktopContextMenuItems(),
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
        ...(window.soundTab ? { soundTab: window.soundTab } : {}),
        ...(window.notificationAppId ? { notificationAppId: window.notificationAppId } : {}),
        ...(Object.hasOwn(window, 'aboutBuildVisible') ? { aboutBuildVisible: window.aboutBuildVisible } : {}),
        ...(Object.hasOwn(window, 'storageVolumesVisible') ? { storageVolumesVisible: window.storageVolumesVisible } : {}),
        ...(window.storageView ? { storageView: $state.snapshot(window.storageView) } : {}),
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
      notes: domainControllers.get('notes').targets(),
      ...(hasApplicationMenu || macDesktop && hasMessages ? { applicationMenu: applicationMenuTargets() } : {}),
      ...(hasFileWorkflows ? { printing: {
        printerId: 'studio-printer', printerName: 'Studio Printer', fictional: true,
        jobs: printingState.jobs.map(({ id, title, status, copies, pageCount, pageFrom, pageTo, printedPages }) =>
          ({ jobId: id, title, status, copies, pageCount, pageFrom, pageTo, printedPages })),
      } } : {}),
      ...(hasEditWorkflows ? { editing: editingTargets() } : {}),
      ...(hasViewWorkflows ? { viewing: viewingTargets() } : {}),
      ...(hasWindowExtensions ? { windowExtensions: windowExtensions.targets() } : {}),
      ...(hasHelpViewer ? { helpViewer: helpViewer.targets() } : {}),
      ...(hasServices ? { services: services.targets() } : {}),
      ...(hasMessages ? { messages: messagesController.targets() } : {}),
      ...(hasSpotlight ? { spotlight: { ...spotlightController.targets(),
        preferences: spotlightPreferencesController.summary(), folders: spotlightPrivacyFolders() } } : {}),
      ...(hasAppleMenu ? { system: systemTargets() } : {}),
      ...(adapter.readTargets ? adapter.readTargets(nativeState, { native: nativeState, getApplicationView, getDesktopView: () => desktopView, getDesktopItems, getWindows: () => windows, getProfile: () => profile }) : {}),
    }), () => profile, commandCatalog);

  async function settleCommands() {
    await clockPumpWork;
    if (hasAppleMenu) { runStorageMaintenance(); reconcileStorageViews(); }
    if (hasNotifications) retireUnavailableNotificationSources();
    sceneRuntime.synchronize();
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
    // Child desktop mount can report layout before the scene root binding exists.
    void tick().then(() => { if (!disposed && desktopView === view && sceneRoot?.isConnected) measureStageArea(); });
    return () => { if (desktopView === view) desktopView = null; };
  }

  function registerNotesView(view) {
    notesView = view;
    return () => { if (notesView === view) notesView = null; };
  }

  function registerMessagesView(windowId, view, original) {
    if (view) messagesViews.set(windowId, view);
    else if (messagesViews.get(windowId) === original) messagesViews.delete(windowId);
    messagesViewEpoch++;
  }
  function registerApplicationView(windowId, view) {
    applicationViews.set(windowId, view);
    return () => { if (applicationViews.get(windowId) === view) applicationViews.delete(windowId); };
  }
  function getNativeSoundPlayers() {
    soundMediaRevision;
    return ['media', 'dvd'].flatMap(key => nativeDomainDefinitions[key].sessions(nativeApplications[key])
      .map(session => ({ windowId: session.windowId, appId: session.nativeAppId ?? 'dvd-player', paused: !session.playing })));
  }
  function syncNativeSound() {
    soundMediaRevision++;
    for (const [id, view] of domainViews) {
      const original = windows.find(window => window.id === id);
      if (nativeDomainForWindow(profile, original)?.key === 'media') view.setSound(systemState.sound);
    }
    if (menuBarState?.menuId === 'sound' && systemState.sound.showWhen === 'when-active'
      && !getNativeSoundPlayers().some(player => player.paused === false))
      void retireStatusMenu('sound', getMenuReturnFocus?.());
  }
  async function retireStatusMenu(menuId, original) {
    if (menuBarState?.menuId !== menuId) return;
    const ownerWindowId = activeWindowId, ownerAppId = activeAppId;
    dismissMenuBar?.(); await tick(); await tick();
    if (original && !disposed && foreground && !menuBarState?.menuId
      && activeWindowId === ownerWindowId && activeAppId === ownerAppId) await restoreSessionDesktop(original);
  }
  async function setSoundSettingsTab(windowId, tab) {
    const entry = getSystemPanel(windowId), control = `sound-${tab}-tab`;
    if (entry?.window.appId !== 'settings' || entry.window.utilityKind || entry.window.settingsPane !== 'sound'
      || activeWindowId !== windowId || activeAppId !== 'settings' || !systemPanelControls(entry).includes(control))
      return rejected('unavailable', 'Use the current active native Sound Settings tab.');
    const owner = entry.window;
    if (!await focusWindowPanel(entry, control) || getSystemPanel(windowId)?.window !== owner
      || owner.settingsPane !== 'sound' || activeWindowId !== windowId || activeAppId !== 'settings')
      return rejected('unavailable', 'The original Sound Settings tab is no longer available.');
    owner.soundTab = tab;
    return { status: 'applied', target: { windowId, tab } };
  }

  function sceneCoreAvailable() {
    return !disposed && (foreground || starting || !initialized) && (adapter.windowInteractionsAvailable?.(nativeState) ?? true);
  }
  function sceneInteractionsAvailable() {
    return sceneCoreAvailable() && !fileDialogState.current && !wifiPresentation.join && !batteryPresentation.options && !clockPresentation.options && !clockPresentation.editor && !bluetoothPresentation.pair;
  }
  function fileWorkflowsAvailable() {
    return sceneCoreAvailable() && !desktopState.dock?.appWindows && !spaceState.overview && !launchpadState.view
      && !dashboardOpen && !switching.switcher && !presentation.pairing && !wifiPresentation.join && !batteryPresentation.options && !clockPresentation.options && !clockPresentation.editor && !bluetoothPresentation.pair;
  }
  function windowInteractionsAvailable() {
    return sceneInteractionsAvailable() && !desktopState.dock?.appWindows && !spaceState.overview && !launchpadState.view && !dashboardOpen;
  }
  function domainControllerForWindow(window) {
    return window ? ['document-print', 'document-picker', 'document-share'].includes(window.utilityKind)
      ? destinationCommands : nativeControllers.get(nativeDomainForWindow(profile, window)?.key)
        ?? domainControllers.get(window.utilityKind ?? window.appId) : null;
  }
  function getNativeShared(name) {
    if (name === 'system') return systemState;
    if (name === 'session') return session ?? standaloneSession;
    if (name === 'appearance') return appearanceState;
    if (name === 'dock') return desktopState.dock;
    if (name === 'messages') return messagesState;
    if (name === 'browser') return browserState;
    if (name === 'files') return desktopFileStore;
    if (name === 'power') return systemState.battery;
    if (name === 'accessibility') return nativeApplications.preferences.configuration.accessibility;
    if (name === 'audiomidi') return systemState.sound.audioMidi;
    return nativeApplications[name] ?? domainGraphs[name] ?? systemState[name];
  }
  function nativeSharedSources() {
    return Object.fromEntries(['system', 'appearance', 'dock', 'session', 'notifications', 'widgets',
      'sound', 'wifi', 'bluetooth', 'input', 'power', 'clock', 'preferences', 'accessibility', 'fonts',
      'fontbook', 'audiomidi', 'backup'].map(name => [name, getNativeShared(name)]));
  }
  function resolveNativeContacts(query, ownership = {}) {
    const source = contactsState, cards = source.contacts, accounts = source.accounts, preferences = source.preferences;
    const guard = ownership.guard ?? (() => !disposed);
    if (!guard()) return rejected('stale_target', 'The original contact request is unavailable.');
    const originalCards = cards.map(card => [card, JSON.stringify(card)]);
    const originalAccounts = accounts.map(account => [account, JSON.stringify(account)]);
    const preferenceSignature = JSON.stringify(preferences);
    const isCurrent = () => guard() && contactsState === source && source.contacts === cards && source.accounts === accounts
      && source.preferences === preferences && JSON.stringify(preferences) === preferenceSignature
      && cards.length === originalCards.length && originalCards.every(([card, signature], index) => cards[index] === card && JSON.stringify(card) === signature)
      && accounts.length === originalAccounts.length && originalAccounts.every(([account, signature], index) => accounts[index] === account && JSON.stringify(account) === signature);
    const rows = resolveCanonicalContacts(source, query);
    if (ownership.selectedEndpoint) {
      const { contactId, address } = ownership.selectedEndpoint;
      const row = rows.find(row => row.id === contactId), card = linkedContact(source, contactId);
      const identity = recipientIdentity(address);
      const phone = card?.phones.find(endpoint => recipientIdentity(endpoint.value) === identity);
      const email = card?.emails.find(endpoint => recipientIdentity(endpoint.value) === identity);
      if (!row || !identity || !phone && !email || !isCurrent())
        return rejected('stale_target', 'The selected address no longer belongs to the original enabled contact.');
      if (phone) row.phone = phone.value;
      else row.email = email.value;
    }
    return isCurrent() ? { status: 'applied', contacts: rows, isCurrent }
      : rejected('stale_target', 'The original Contacts records or endpoint changed.');
  }
  function captureMessageContactEndpoints() {
    const original = resolveNativeContacts('', { guard: () => !disposed });
    if (original.status !== 'applied') return null;
    const endpoints = messageRecipientChoices().map(row => row.address);
    return original.isCurrent() ? { endpoints, current: original.isCurrent } : null;
  }
  function setCanonicalAccount(values, ownership) {
    return mutateNativeShared('messages', candidate => { Object.assign(candidate.account, values); }, ownership);
  }
  function setCanonicalBlockedAddresses(addresses, ownership) {
    if (!Array.isArray(addresses) || typeof ownership?.guard !== 'function'
      || ownership.guard() !== true || disposed) return rejected('stale_target', 'The original blocked-endpoint owner is unavailable.');
    const original = messagesState, before = JSON.stringify(original), candidate = copyCanonicalData(original);
    candidate.blockedAddresses = addresses.map(recipientIdentity);
    const validation = validateMessagesState(candidate, profile);
    if (!validation.ok) return rejected('invalid_arguments', validation.message);
    const current = () => !disposed && messagesState === original && JSON.stringify(original) === before
      && ownership.guard() === true;
    const calls = domainControllers.get(macDesktop ? 'facetime' : 'teams-call');
    const callPlan = ownership.onCommit ? null : calls.prepareBlockedAddressEffects(candidate.blockedAddresses, { guard: current });
    if (!ownership.onCommit && (!callPlan || !callPlan.current()))
      return rejected('stale_target', 'The original incoming-call block effects could not be prepared.');
    const actorDelta = callPlan?.delta ?? ownership.reserveTextUnits ?? 0;
    const delta = canonicalStringUnits(candidate) - canonicalStringUnits(original);
    if (!Number.isSafeInteger(actorDelta) || completeSceneStringUnits() + delta + actorDelta > 4 * 1024 * 1024)
      return rejected('limit_exceeded', 'The complete blocked-endpoint transaction exceeds the scene string budget.');
    const ids = callPlan?.notificationsToDismiss ?? ownership.notificationsToDismiss ?? [];
    const commit = () => {
      if (!current() || callPlan && !callPlan.current()) return false;
      sharedMutationReserve += delta;
      let accepted;
      try { accepted = callPlan ? callPlan.commit() === true : ownership.onCommit() === true; }
      finally { sharedMutationReserve -= delta; }
      if (!accepted || messagesState !== original || JSON.stringify(original) !== before) return false;
      applyCanonicalData(original, candidate);
      return true;
    };
    if (ids.length) {
      return notificationBridges.updateNotifications(ids, {
        dismissed: true, reserveTextUnits: delta + actorDelta,
        onCommit: actualIds => actualIds.length === ids.length && actualIds.every((id, index) => id === ids[index]) && commit(),
      }, { guard: current, ...(ownership.windowId ? { windowId: ownership.windowId } : {}) });
    }
    return commit() ? { status: 'applied' }
      : rejected('stale_target', 'The original Messages and Calls owners refused the paired blocked-endpoint mutation.');
  }
  function startCanonicalCall(spec, ownership) {
    return domainControllers.get(macDesktop ? 'facetime' : 'teams-call').startCall(spec, ownership);
  }
  function mutateNativeShared(name, mutator, ownership = {}) {
    const original = getNativeShared(name), guard = ownership.guard ?? (() => !disposed);
    if (!original || typeof mutator !== 'function' || guard() !== true)
      return rejected('stale_target', 'Use the original canonical shared source.');
    const systemKey = name === 'power' ? 'battery' : name === 'audiomidi' ? 'sound' : name;
    const owner = name === 'accessibility' ? nativeApplications.preferences
      : name === 'audiomidi' || Object.hasOwn(systemState, systemKey) && name !== 'system' ? systemState : original;
    const before = JSON.stringify(owner), candidate = copyCanonicalData(owner);
    const part = name === 'accessibility' ? candidate.configuration.accessibility
      : name === 'audiomidi' ? candidate.sound.audioMidi
        : owner === systemState && name !== 'system' ? candidate[systemKey] : candidate;
    const mutation = mutator(part);
    if (mutation?.status === 'rejected') return mutation;
    if (mutation === false) return rejected('invalid_arguments', 'The shared mutation was refused.');
    const validation = owner === systemState ? validateSystemState(candidate, profile)
      : name === 'messages' ? validateMessagesState(candidate, profile)
        : name === 'contacts' ? validateContactsState(candidate, profile)
          : name === 'mail' ? validateMailState(candidate, profile)
            : name === 'calendar' ? validateCalendarState(candidate, profile)
              : nativeDomainDefinitions[name === 'accessibility' ? 'preferences' : name]?.validate?.(candidate, profile);
    if (validation !== undefined && validation !== true && validation?.ok !== true)
      return rejected('invalid_arguments', validation?.message ?? `The canonical ${name} graph is invalid.`);
    const delta = canonicalStringUnits(candidate) - canonicalStringUnits(owner);
    const reserve = ownership.reserveTextUnits ?? 0;
    if (!Number.isSafeInteger(reserve) || completeSceneStringUnits() + delta + reserve > 4 * 1024 * 1024)
      return rejected('limit_exceeded', 'The complete scene string budget would be exceeded.');
    if (getNativeShared(name) !== original || JSON.stringify(owner) !== before || guard() !== true)
      return rejected('stale_target', 'The original canonical shared source changed.');
    sharedMutationReserve += delta;
    let accepted;
    try { accepted = ownership.onCommit ? ownership.onCommit(part) === true : true; }
    finally { sharedMutationReserve -= delta; }
    if (!accepted || getNativeShared(name) !== original || JSON.stringify(owner) !== before)
      return rejected('stale_target', 'The paired actor or original shared source refused publication.');
    applyCanonicalData(owner, candidate);
    return { status: 'applied' };
  }
  async function executeNativeOwned(packet, ownership = {}) {
    if (ownership.guard && !ownership.guard()) return rejected('stale_target', 'The original native command source changed.');
    const id = packet?.target?.windowId;
    const original = typeof id === 'string' ? windows.find(window => window.id === id) : null;
    const lease = original && typeof ownership.guard === 'function' && ownership.windowId !== id
      ? { original, guard: ownership.guard } : null;
    if (lease) {
      let leases = ownedNativeTargets.get(id);
      if (!leases) ownedNativeTargets.set(id, leases = new Set());
      leases.add(lease);
    }
    try {
      return await commands.execute(packet, ownership);
    } finally {
      if (lease) {
        const leases = ownedNativeTargets.get(id);
        leases?.delete(lease);
        if (leases?.size === 0) ownedNativeTargets.delete(id);
      }
    }
  }
  function nativeOwnedTargetCurrent(window) {
    const leases = ownedNativeTargets.get(window.id);
    if (leases) for (const lease of leases) if (lease.original !== window || !lease.guard()) return false;
    return true;
  }
  async function mergeCanonicalBrowserWindows(spec) {
    const destination = windows.find(window => window.id === spec.destinationWindowId);
    const ids = spec.sourceWindowIds;
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length
      || ids.includes(destination?.id) || typeof spec.isCurrent !== 'function' || typeof spec.onCommit !== 'function')
      return rejected('invalid_arguments', 'Use distinct original browser windows and an owned canonical merge commit.');
    const sources = ids.map(id => windows.find(window => window.id === id));
    const originals = [destination, ...sources];
    const views = originals.map(window => window && domainViews.get(window.id));
    const current = () => !disposed && activeWindowId === destination?.id && sharedMenusAvailable()
      && originals.every((window, index) => window && window.appId === 'safari' && !window.utilityKind
        && !window.fullScreen && !window.minimized && !isAppHidden(window.appId)
        && !pendingQuitAppIds.includes(window.appId) && windows.find(row => row.id === window.id) === window
        && domainViews.get(window.id) === views[index] && views[index]?.available() === true);
    if (!current() || spec.isCurrent() !== true) return rejected('stale_target', 'The original browser merge actors are unavailable.');
    if (spec.onCommit() !== true) return rejected('stale_target', 'The canonical browser merge refused publication.');
    // The synchronous canonical commit has already consumed these exact domain
    // records. Only its original Roots may bypass duplicate domain retirement.
    for (const window of sources) browserMergeRetirements.add(window);
    for (const window of sources) await closeWindow(window.id, {
      guard: () => !disposed && windows.find(row => row.id === window.id) === window });
    return { status: 'applied', target: { windowId: destination.id }, windowId: destination.id, droppedWindowIds: ids };
  }
  async function createCanonicalMailDraft(spec, ownership) {
    const guard = typeof ownership === 'function' ? ownership : ownership?.guard;
    if (typeof guard !== 'function' || guard() !== true) return rejected('stale_target', 'The original Mail draft producer retired.');
    let draftId;
    const result = mutateNativeShared('mail', candidate => {
      const draft = createMailServiceDraft(candidate, {
        to: Array.isArray(spec.to) ? spec.to.join(', ') : spec.to ?? '',
        subject: spec.subject ?? '', body: spec.body ?? '',
      });
      if (!draft) return rejected('limit_exceeded', 'The actual Mail draft exceeds its bound.');
      for (const source of spec.attachments ?? []) {
        const id = mailNewId(candidate, 'mail-attachment');
        if (!id) return rejected('limit_exceeded', 'Mail attachment identities are exhausted.');
        draft.attachments.push({ id, fileId: null, name: source.name,
          mime: source.mimeType ?? source.mime, text: source.content ?? source.text });
      }
      draftId = draft.id;
      return true;
    }, { guard, reserveTextUnits: spec.reserveTextUnits ?? 0,
      ...(spec.onCommit ? { onCommit: () => spec.onCommit(draftId) === true } : {}) });
    if (result.status !== 'applied') return result;
    const draft = mailState.drafts.find(row => row.id === draftId);
    const signature = JSON.stringify({ ...draft, windowId: null });
    const current = () => !disposed && mailState.drafts.find(row => row.id === draftId) === draft
      && JSON.stringify({ ...draft, windowId: null }) === signature;
    const windowId = openWindow('mail', draft.subject || 'New Message', true, undefined,
      { mailKind: 'compose', mailDraftId: draftId, isCurrent: current });
    await tick(); await tick();
    return { status: 'applied', draftId, target: { appId: 'mail', recordId: draftId, ...(windowId ? { windowId } : {}) },
      presentationAvailable: Boolean(windowId && current() && domainViews.get(windowId)?.available()) };
  }
  function createCanonicalContact(spec, ownership) {
    let contactId;
    const result = mutateNativeShared('contacts', candidate => {
      const created = createContact(candidate, { name: spec.name, email: spec.email }, { time: sharedClockWriter.getSceneTime() });
      if (created.status !== 'applied') return rejected(created.code, created.message);
      contactId = created.contactId;
      return true;
    }, ownership);
    return result.status === 'applied' ? { ...result, contactId } : result;
  }
  function respondCanonicalInvitation(spec, ownership) {
    const message = mailState.messages.find(row => row.id === spec.source?.messageId);
    if (!message || message.invitation?.id !== spec.invitationId || ownership.guard() !== true)
      return rejected('stale_target', 'The original Mail invitation is unavailable.');
    let eventId;
    const result = mutateNativeShared('calendar', candidate => {
      let invitation = candidate.invitations.find(row => row.eventId === spec.eventId);
      if (!invitation) {
        if (spec.eventId) return rejected('stale_target', 'The original Calendar invitation retired.');
        const created = createCalendarInvitation(candidate, { sender: message.from.email,
          event: { title: spec.title, start: spec.start, end: spec.end, location: spec.location },
          icalUid: `${spec.invitationId}@jester.local` });
        if (!created.ok) return rejected('invalid_arguments', created.message);
        invitation = candidate.invitations.find(row => row.id === created.invitationId);
      }
      const response = acceptCalendarInvitation(candidate, { invitationId: invitation.id, response: spec.response });
      if (!response.ok) return rejected('stale_target', response.message);
      eventId = response.eventId;
      return true;
    }, ownership);
    return result.status === 'applied' ? { ...result, eventId } : result;
  }
  async function playCanonicalMailSound(spec, ownership) {
    const view = domainViews.get(ownership.windowId);
    if (ownership.guard() !== true || typeof view?.playSound !== 'function')
      return rejected('unavailable', 'The original mounted Mail sound preview is unavailable.');
    const played = await view.playSound(spec, ownership.guard);
    return played === true && ownership.guard() === true
      ? { status: 'applied' } : rejected('unavailable', 'The original authored Mail sound could not play.');
  }
  async function revealCanonicalFile(fileId, ownership) {
    const file = applicationFiles.getFile(fileId), signature = file && JSON.stringify(file);
    const guard = () => !disposed && ownership.guard() === true
      && applicationFiles.getFile(fileId) === file && JSON.stringify(file) === signature;
    if (!file || !guard()) return rejected('stale_target', 'The original Files reveal source retired.');
    const result = await handlers['desktop.open']({ fileId: file.parentId }, {});
    if (result.status !== 'applied' || !guard()) return result.status === 'rejected' ? result : rejected('stale_target', 'The original Files reveal changed.');
    const windowId = result.target.windowId;
    const selected = await executeNativeOwned(macDesktop
      ? { command: 'finder.selection.set', target: { windowId }, payload: { fileIds: [fileId] } }
      : { command: 'win11.explorer.select', target: { windowId, fileId }, payload: {} },
      { ...ownership, guard });
    return selected.status === 'applied' ? { ...selected, fileId, target: { windowId, fileId } } : selected;
  }
  function createNativeContext(definition) {
    return {
      profile, getState: () => nativeApplications[definition.key], alive: () => !disposed,
      ...notificationPorts,
      getShared: getNativeShared, mutateShared: mutateNativeShared,
      executeOwned: executeNativeOwned,
      getWindow: id => windows.find(window => window.id === id) ?? null,
      getWindows: () => windows.filter(window => nativeDomainForWindow(profile, window) === definition),
      getView: id => domainViews.get(id),
      available: value => domainWindowAvailable(typeof value === 'string' ? windows.find(window => window.id === value) : value),
      setSceneTime: setClockSceneTime,
      tick, getSceneTime: sharedClockWriter.getSceneTime, focusWindow,
      resolveContacts: resolveNativeContacts,
      startCall: startCanonicalCall,
      forwardCall: (name, target, payload, ownership) => domainControllers.get(macDesktop ? 'facetime' : 'teams-call')
        .forwardCommand(name, target, payload, ownership),
      setAccount: setCanonicalAccount,
      getBlockedAddresses: () => messagesState.blockedAddresses,
      setBlockedAddresses: setCanonicalBlockedAddresses,
      canCommit: delta => completeSceneStringUnits() + delta <= 4 * 1024 * 1024,
      reserve: (delta, callback) => { sharedMutationReserve += delta; try { return callback(); } finally { sharedMutationReserve -= delta; } },
      createWindow: (appId, options = {}) => {
        if (options.isCurrent && options.isCurrent() !== true
          || options.ownership?.guard && options.ownership.guard() !== true) return null;
        return openWindow(appId, options.title, true, options.utilityKind, options);
      },
      closeWindow: (id, ownership) => closeWindow(id, ownership),
      appQuit: (appId, ownership = {}) => ownership.guard && ownership.guard() !== true
        ? rejected('stale_target', 'The original application quit source changed.') : quitApplication(appId, false, ownership),
      quitApplication: (appId, ownership = {}) => ownership.guard && ownership.guard() !== true
        ? rejected('stale_target', 'The original process quit source changed.') : quitApplication(appId, ownership.force === true, ownership),
      getInventory: sceneRuntime.getInventory, getSceneEvents: sceneRuntime.getSceneEvents,
      getFilesStore: () => desktopFileStore, getClipboard: () => clipboardState, clipboard: clipboardState,
      makeRecord: record => { let original = $state(record); return original; },
      getRoot: () => sceneRoot,
      getWindowBounds: id => {
        const original = windows.find(window => window.id === id);
        const element = original && managedWindowElement(id);
        if (!element?.isConnected) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height };
      },
      captureFrame: definition.key === 'media' ? async options => (await captureNativeFrame(options)).canvas : captureNativeFrame,
      printDocument: destinationCommands.printDocument, share: destinationCommands.share,
      chooseFile: destinationCommands.chooseFile,
      composeMail: composeCanonicalMail, composeMessage: composeCanonicalMessage,
      getAccount: () => messagesState.account,
      getDiskController: () => nativeControllers.get('disk'),
      getBackupController: () => nativeControllers.get('backup'),
      getMigrationController: () => nativeControllers.get('migration'),
      getPreferencesUpdateHost: id => nativeControllers.get('store')?.getSystemUpdateHost(id),
      getPreferencesUpdateSettingsHost: id => nativeControllers.get('store')?.getSystemUpdateSettingsHost(id),
      ...applicationFiles,
    };
  }
  function domainWindowAvailable(window) {
    return Boolean(window && !disposed && windows.includes(window)
      && nativeOwnedTargetCurrent(window)
      && domainControllerForWindow(window) && windowInteractionsAvailable()
      && !window.minimized && !isAppHidden(window.appId) && !pendingQuitAppIds.includes(window.appId)
      && windowPresented(window) && !switching.switcher && !presentation.pairing);
  }
  function registerDomainView(windowId, view, original) {
    if (view) domainViews.set(windowId, view);
    else if (domainViews.get(windowId) === original) domainViews.delete(windowId);
  }
  async function prepareDomainWindow(appId, guard = () => true) {
    if (!guard() || disposed) return null;
    const id = openWindow(appId, undefined, false, undefined, { isCurrent: guard });
    if (!id) return null;
    const original = windows.find(window => window.id === id);
    await tick(); await tick();
    return guard() && windows.includes(original) && domainWindowAvailable(original)
      && domainViews.get(id)?.available() ? original : null;
  }
  async function setCanonicalReminderCompleted(reminderId, completed, owner) {
    const original = remindersState.tasks.find(task => task.id === reminderId), revision = original?.revision;
    const guard = () => owner.guard() && remindersState.tasks.find(task => task.id === reminderId) === original && original?.revision === revision;
    const window = await prepareDomainWindow('reminders', guard);
    if (!window || !guard()) return rejected('stale_target', 'The original reminder or native destination changed.');
    return executeNativeOwned({ command: 'reminders.task.setCompleted', target: { windowId: window.id },
      payload: { reminderId, completed } }, { guard });
  }
  async function composeCanonicalMail(spec, ownership = spec) {
    const guard = typeof ownership === 'function' ? ownership : ownership.guard;
    if (typeof guard !== 'function' || !guard()) return rejected('stale_target', 'The original Mail source changed.');
    const to = typeof spec.to === 'string' ? spec.to : (spec.to ?? []).map(row => typeof row === 'string' ? row : row.name ? `${row.name} <${row.email}>` : row.email).join(', ');
    const id = openWindow('mail', 'New Message', true, undefined, {
      isCurrent: guard, mailDraftFields: { to, subject: spec.subject ?? '', body: spec.body ?? '' },
    });
    if (!id) return rejected('limit_exceeded', 'The native composer could not be committed within the complete scene budget.');
    const original = windows.find(window => window.id === id);
    const draft = mailState.drafts.find(row => row.windowId === id);
    await tick(); await tick();
    return { status: 'applied', target: { appId: 'mail', windowId: id, recordId: draft.id },
      draftId: draft.id, presentationAvailable: windows.includes(original) && domainViews.get(id)?.available() === true };
  }
  async function composeCanonicalMessage(spec) {
    const guard = spec.guard;
    if (typeof guard !== 'function' || !guard()) return rejected('stale_target', 'The original message source changed.');
    const appId = macDesktop ? 'messages' : 'teams';
    const id = openWindow(appId, undefined, false, undefined, { isCurrent: guard });
    if (!id) return rejected('unavailable', 'The native Messages destination is unavailable.');
    const original = windows.find(window => window.id === id);
    await tick(); await tick();
    if (!guard() || !windows.includes(original) || !messagesViews.get(id)?.available()) return rejected('stale_target', 'The original message destination changed.');
    if (!macDesktop) {
      const result = await handlers['win11.teams.surface.set']({ windowId: id }, { surface: 'full' });
      if (result.status !== 'applied') return result;
    }
    if (!guard()) return rejected('stale_target', 'The original contact source changed.');
    const recipient = spec.recipient;
    const result = createMessageDraft(messagesState, { to: recipient.name ? `${recipient.name} <${recipient.address}>` : recipient.address, body: spec.text ?? '' }, {
      time: sharedClockWriter.getSceneTime(), canCommit: candidate => guard()
        && completeSceneStringUnits() - canonicalStringUnits(messagesState) + canonicalStringUnits(candidate) <= 4 * 1024 * 1024 && guard(),
    });
    if (result.status !== 'applied') return result;
    sharedClockWriter.onTimeChanged(messagesState.timeBase);
    await tick();
    const presentationAvailable = windows.includes(original) && messagesViews.get(id)?.available() === true;
    if (presentationAvailable) await handlers['messages.focus']({ windowId: id, controlId: 'draft-body' }, {});
    return { ...result, target: { ...result.target, appId, windowId: id, recordId: result.target.draftId }, presentationAvailable };
  }
  function domainWindowControls(window) {
    return {
      sceneTime: sharedClockWriter.getSceneTime(),
      getAccount: () => messagesState.account,
      getReminders: () => reminderCalendarProjection(remindersState),
      onclose: () => windowCommand('window.close', window.id),
      onminimize: () => windowCommand('window.setMinimized', window.id, { minimized: true }),
      onzoom: () => toggleWindowZoom(window.id),
      onfullscreen: () => toggleWindowFullScreen(window.id),
      onsplitbegin: event => beginSplitView(window.id, event),
      onsplitside: event => changeSplitSide(window.id, event),
      ongreenmenu: () => windowCommand('window.greenMenu.open', window.id),
      fullScreen: window.fullScreen, revealedTop: fullScreenStage.topRevealed,
      modernGreenMenu: modernMac, zoomed: window[expandedProperty],
    };
  }
  function messageRecipientChoices(query = '') {
    if (disposed || typeof query !== 'string' || query.length > 4096) return [];
    const needle = recipientFold(query), rows = [];
    for (const resolved of resolveCanonicalContacts(contactsState, '')) {
      const contact = linkedContact(contactsState, resolved.id);
      if (!contact) continue;
      const name = contactName(contact), nameMatches = !needle || recipientFold(name).includes(needle);
      const seen = new Set();
      for (const [kind, entries] of [['phone', contact.phones], ['email', contact.emails]]) {
        for (const entry of entries) {
          const identity = recipientIdentity(entry.value);
          if (seen.has(identity) || !nameMatches && !recipientFold(entry.value).includes(needle)) continue;
          seen.add(identity);
          rows.push({ contactId: contact.id, name, address: entry.value, label: entry.label, kind });
        }
      }
    }
    return rows;
  }
  function resolveMessageRecipient(recipient) {
    const all = messageRecipientChoices(), identity = recipientIdentity(recipient.address);
    const addressed = all.filter(row => recipientIdentity(row.address) === identity);
    if (addressed.length) return { name: recipient.name === recipient.address ? addressed[0].name : recipient.name, address: addressed[0].address };
    const named = all.filter(row => recipientFold(row.name) === recipientFold(recipient.address));
    if (!named.length) return undefined;
    if (new Set(named.map(row => row.contactId)).size !== 1) return null;
    const choice = named.find(row => row.kind === 'phone') ?? named[0];
    return { name: choice.name, address: choice.address };
  }
  async function openLegacySvgFile(fileId, ownership) {
    const stale = () => rejected('stale_target', 'The original SVG source or native Photos destination retired.');
    const file = applicationFiles.getFile(fileId);
    if (profile.family !== 'windows' || !file || ownership?.guard?.() !== true) return stale();
    const signature = JSON.stringify(file);
    const sourceCurrent = () => !disposed && ownership.guard() === true
      && applicationFiles.getFile(fileId) === file && JSON.stringify(file) === signature;
    const existing = windows.find(entry => entry.appId === 'photos' && entry.utilityKind === 'photos-svg'
      && adapter.nativeForWindow(nativeState, entry.id)?.apps.photos.selectedId === fileId);
    const returnWindow = windows.find(entry => entry.id === activeWindowId);
    const windowId = existing?.id ?? openWindow('photos', file.name, true, 'photos-svg', { isCurrent: sourceCurrent });
    if (!windowId) return sourceCurrent() ? rejected('unavailable', 'The actual SVG Photos window could not open.') : stale();
    const window = windows.find(entry => entry.id === windowId);
    const native = adapter.nativeForWindow(nativeState, windowId);
    let committed = false;
    try {
      await tick(); await tick();
      const view = applicationViews.get(windowId);
      const current = () => sourceCurrent() && windows.find(entry => entry.id === windowId) === window
        && adapter.nativeForWindow(nativeState, windowId) === native && native !== null
        && view && applicationViews.get(windowId) === view;
      if (!current()) return stale();
      const result = await handlers['win11.photos.open']({ fileId, windowId }, {}, { guard: current });
      committed = result.status === 'applied';
      return result;
    } finally {
      const originalDestination = () => !disposed && windows.find(entry => entry.id === windowId) === window
        && adapter.nativeForWindow(nativeState, windowId) === native;
      if (!existing && !committed && originalDestination()) {
        const restoreFocus = activeWindowId === windowId;
        await closeWindow(windowId, { guard: originalDestination, discard: true });
        if (restoreFocus && returnWindow && windows.find(entry => entry.id === returnWindow.id) === returnWindow)
          focusWindow(returnWindow.id);
      }
    }
  }
  async function openAssociatedVirtualFile(fileId, _options, ownership) {
    const stale = () => rejected('stale_target', 'The original source or canonical File retired.');
    const file = applicationFiles.getFile(fileId);
    if (!file || ownership?.guard?.() !== true) return stale();
    const fingerprint = JSON.stringify(file);
    const guard = () => !disposed && ownership.guard() === true
      && applicationFiles.getFile(fileId) === file && JSON.stringify(file) === fingerprint;
    const mime = documentFileMime(file);
    if (!macDesktop && mime === 'image/svg+xml')
      return openLegacySvgFile(fileId, { ...ownership, guard });
    if (macDesktop && mime === 'image/svg+xml') {
      const destination = await prepareDomainWindow('safari', guard);
      if (!destination || !guard()) return stale();
      const result = await executeNativeOwned({ command: 'browser.file.open',
        target: { windowId: destination.id }, payload: { fileId } }, { ...ownership, guard });
      return result.status === 'applied'
        ? { ...result, fileId, windowId: destination.id, target: { ...result.target, appId: 'safari' } } : result;
    }
    const image = ['image/png', 'image/jpeg', 'image/webp'].includes(mime);
    if (image && (!macDesktop || file.appId === 'photos'))
      return nativeControllers.get('photos').openFile(fileId, { ...ownership, guard });
    const pdf = mime === 'application/pdf', preview = pdf || image;
    const text = typeof mime === 'string' && (mime.startsWith('text/') || mime === 'application/rtf');
    if (!preview && !text) return rejected('unsupported_content', 'This original File MIME has no registered native document destination.');
    if (text) return nativeControllers.get('textedit').openFile(fileId, { ...ownership, guard });
    const appId = macDesktop ? 'preview' : 'edge', utilityKind = pdf && !macDesktop ? 'edge-pdf' : undefined;
    const previewState = nativeApplications.preview;
    const existingDocument = previewState.documents.find(document => document.fileId === file.id
      && document.fileRevision === file.revision && document.content === file.content && document.mime === mime);
    const existingSession = existingDocument && previewState.windows.find(session => session.selectedId === existingDocument.id);
    const existingWindow = existingSession && windows.find(entry => entry.id === existingSession.windowId
      && entry.appId === appId && entry.utilityKind === utilityKind);
    if (existingWindow && guard()) {
      focusWindow(existingWindow.id);
      await tick();
      if (!guard() || windows.find(entry => entry.id === existingWindow.id) !== existingWindow
        || previewState.documents.find(document => document.id === existingDocument.id) !== existingDocument
        || previewState.windows.find(session => session.windowId === existingWindow.id) !== existingSession
        || existingSession.selectedId !== existingDocument.id) return stale();
      return { status: 'applied', target: { windowId: existingWindow.id }, windowId: existingWindow.id,
        documentId: existingDocument.id, fileId, appId };
    }
    const returnWindow = windows.find(entry => entry.id === activeWindowId);
    const windowId = openWindow(appId, file.name, true, utilityKind, { isCurrent: guard });
    if (!windowId) return guard() ? rejected('unavailable', 'The actual native document window could not open.') : stale();
    const window = windows.find(entry => entry.id === windowId);
    const session = previewState.windows.find(entry => entry.windowId === windowId);
    const current = () => guard() && windows.find(entry => entry.id === windowId) === window;
    let committed = false;
    try {
      await tick();
      if (!current()) return stale();
      const result = await executeNativeOwned({ command: 'preview.open',
        target: { windowId }, payload: { fileId } }, { ...ownership, guard: current });
      committed = result.status === 'applied';
      return committed ? { ...result, windowId, fileId, appId } : result;
    } finally {
      const emptyDestination = () => !disposed && windows.find(entry => entry.id === windowId) === window
        && previewState.windows.find(entry => entry.windowId === windowId) === session
        && session?.documentIds.length === 0;
      if (!committed && emptyDestination()) {
        const restoreFocus = activeWindowId === windowId;
        await closeWindow(windowId, { guard: emptyDestination, discard: true });
        if (restoreFocus && returnWindow && windows.find(entry => entry.id === returnWindow.id) === returnWindow)
          focusWindow(returnWindow.id);
      }
    }
  }
  async function openSharedMessageContent(spec, ownership) {
    const stale = () => rejected('stale_target', 'The original shared Messages content or destination changed.');
    const guard = () => !disposed && ownership?.guard?.() === true;
    if (!guard()) return stale();
    if (spec.appId === 'safari' && typeof spec.url === 'string') {
      const windowId = openWindow('safari', applications.safari.name, true, undefined, { isCurrent: guard });
      if (!windowId) return guard() ? rejected('unavailable', 'The original native Safari window could not open.') : stale();
      const window = windows.find(row => row.id === windowId);
      await tick();
      if (!guard() || windows.find(row => row.id === windowId) !== window) return stale();
      const session = browserState.windows.find(row => row.id === windowId);
      const tab = session?.tabs.find(row => row.id === session.activeTabId);
      if (!tab) return rejected('unavailable', 'The original shared local Safari tab is unavailable.');
      return handlers['browser.navigate']({ windowId, tabId: tab.id }, { address: spec.url });
    }
    const attachment = spec.attachment;
    if (!attachment || !['photos', 'finder'].includes(spec.appId))
      return rejected('unsupported_content', 'Choose original locally supported shared content.');
    const content = attachmentContent(attachment);
    if (content === null) return rejected('unsupported_content', 'The original attachment bytes cannot be saved losslessly.');
    let file = attachment.originalFileId && applicationFiles.getFile(attachment.originalFileId);
    if (!file || file.revision !== attachment.originalRevision || file.content !== content
      || (file.mime ?? documentFileMime(file)) !== attachment.mime || file.name !== attachment.name) {
      const saved = await destinationCommands.saveFile({ name: attachment.name, mime: attachment.mime, text: content },
        { ...ownership, guard });
      if (saved.status !== 'applied') return saved;
      if (!guard()) return stale();
      file = applicationFiles.getFile(saved.fileId);
    }
    if (!file || file.content !== content || (file.mime ?? documentFileMime(file)) !== attachment.mime || !guard()) return stale();
    const original = file, signature = JSON.stringify(file);
    const current = () => guard() && applicationFiles.getFile(original.id) === original && JSON.stringify(original) === signature;
    if (ownership?.windowId && activeWindowId !== ownership.windowId)
      return { status: 'applied', fileId: original.id, presentation: { opened: false, reason: 'focus_changed' } };
    if (spec.appId === 'photos')
      return nativeControllers.get('photos').openFile(original.id, { ...ownership, guard: current });
    const opened = await handlers['desktop.open']({ fileId: original.parentId }, {});
    if (opened.status !== 'applied') return opened;
    const destination = windows.find(window => window.id === opened.target.windowId);
    if (!current() || !destination || destination.appId !== 'finder' || destination.utilityKind
      || destination.folderId !== original.parentId) return stale();
    const selected = await handlers['finder.selection.set']({ windowId: destination.id }, { fileIds: [original.id] });
    return selected.status === 'applied' && current() && windows.find(window => window.id === destination.id) === destination
      ? { status: 'applied', fileId: original.id, windowId: destination.id, appId: 'finder' } : selected.status === 'applied' ? stale() : selected;
  }
  function messageWindow(windowId) {
    return disposed ? null : windows.find(window => window.id === windowId && !window.utilityKind
      && (window.appId === 'messages' || applications[window.appId]?.messaging === true)) ?? null;
  }
  function messageWindowAvailable(window) {
    return hasMessages && messageWindow(window?.id) === window && windowInteractionsAvailable()
      && !window.minimized && !isAppHidden(window.appId) && !pendingQuitAppIds.includes(window.appId)
      && windowPresented(window) && !switching.switcher && !presentation.pairing
      && !(hasServices && window.appId === 'messages'
        && (servicePending?.windowId === window.id || communicationsState.selected.messages !== null));
  }
  function destinationWindowAvailable(window) {
    return messageWindow(window?.id) === window
      ? messageWindowAvailable(window) : domainWindowAvailable(window);
  }
  function captureMenuAction(request) {
    const windowId = request?.target?.windowId;
    if (typeof windowId !== 'string') return () => !disposed && foreground;
    const window = windows.find(entry => entry.id === windowId);
    const messageAction = request.command.startsWith('messages.');
    const sourceState = messagesState, sourceView = messagesViews.get(windowId);
    return () => !disposed && foreground && Boolean(window)
      && windows.find(entry => entry.id === windowId) === window
      && (!messageAction || messagesState === sourceState && messagesViews.get(windowId) === sourceView
        && messageWindowAvailable(window) && sourceView?.available() === true);
  }
  function sampleMessageRevision() {
    const conversation = selectedMessageConversation(messagesState);
    return conversation ? `${conversation.id}:${conversation.timestamp}` : '';
  }

  function transientInteractionsAvailable() {
    return windowInteractionsAvailable() && !utilityPreparation && !servicePreparation
      && !servicePending && !switching.switcher && !presentation.pairing && !forceQuitConfirmation && !storageConfirmation;
  }
  function spotlightInteractionsAvailable() { return hasSpotlight && transientInteractionsAvailable(); }
  function notificationInteractionsAvailable() { return hasNotifications && transientInteractionsAvailable(); }
  function notificationNativeAvailable() {
    return notificationInteractionsAvailable() && !spotlightPane && !menuBarState?.menuId;
  }
  function spotlightPrivacyFolders() {
    return macFiles.files.filter(file => file.kind === 'folder').map(file => {
      const names = [file.name];
      for (let parent = spotlightFileIndex.get(file.parentId); parent && names.length <= macFiles.files.length;
        parent = spotlightFileIndex.get(parent.parentId)) names.unshift(parent.name);
      return { fileId: file.id, label: names.join(' / '), deleted: file.deleted === true };
    });
  }
  function spotlightSourceAllowed(kind, fileId) {
    const preferences = systemState.spotlight;
    if (!preferences.indexingEnabled || preferences.excludedFolderIds.includes('disk')) return false;
    const category = kind === 'app' ? 'apps' : kind === 'file' || kind === 'note' ? 'documents'
      : kind === 'contact' ? 'contacts' : 'mail';
    return preferences.enabledCategories.includes(category)
      && (!fileId || !spotlightFileExcluded(fileId, spotlightFileIndex, preferences.excludedFolderIds));
  }
  function getSpotlightSources() {
    const live = liveMacFileRecords(macFiles), byId = new Map(live.map(file => [file.id, file])), sources = [];
    for (const app of Object.values(applications)) {
      const bundle = byId.get(applicationBundleId(app.id));
      if (!bundle || !spotlightSourceAllowed('app', bundle.id)) continue;
      sources.push({ kind: 'app', id: app.id, label: app.name, secondary: 'Application',
        icon: app.icon, terms: [app.id], canReveal: Boolean(byId.get(bundle.parentId)),
        token: { app, bundle } });
    }
    for (const file of live) {
      if (!['document', 'image'].includes(file.kind) || !spotlightSourceAllowed('file', file.id)) continue;
      sources.push({ kind: 'file', id: file.id, label: file.name,
        secondary: byId.get(file.parentId)?.name ?? 'Document', icon: file.icon ?? 'document',
        terms: [...(file.tags ?? []), ...(!/^data:/i.test(file.content ?? '') ? [file.content ?? ''] : [])],
        canReveal: Boolean(byId.get(file.parentId)), token: { record: file, kind: file.kind, name: file.name,
          parentId: file.parentId, content: file.content, appId: file.appId, tags: [...(file.tags ?? [])] } });
    }
    for (const note of notesState.notes) {
      if (note.deleted || !spotlightSourceAllowed('note')) continue;
      sources.push({ kind: 'note', id: note.id, label: noteTitle(note), secondary: 'Notes',
        icon: 'notes', terms: [note.text], canReveal: true,
        token: { record: note, updatedAt: note.updatedAt, text: note.text } });
    }
    for (const collection of [communicationsState.contacts, communicationsState.drafts, communicationsState.outbox]) {
      for (const entry of collection) {
        if (!['contact', 'mail'].includes(entry.kind) || !spotlightSourceAllowed(entry.kind)) continue;
        const contact = entry.kind === 'contact', fields = entry.fields;
        sources.push({ kind: entry.kind, id: entry.id,
          label: (contact ? fields.name : fields.subject) || (contact ? 'Untitled Contact' : '(No Subject)'),
          secondary: (contact ? fields.email || fields.phone : fields.to) || (contact ? 'Contacts' : 'Mail'),
          icon: contact ? 'contacts' : 'mail', terms: Object.values(fields), canReveal: true,
          token: { revision: entry.revision, updatedAt: entry.updatedAt, fields: { ...fields } } });
      }
    }
    return sources;
  }
  function spotlightSourceCurrent(source) {
    if (!hasSpotlight || disposed || !source?.token) return false;
    if (!spotlightSourceAllowed(source.kind, source.kind === 'app' ? applicationBundleId(source.id)
      : source.kind === 'file' ? source.id : null)) return false;
    const token = source.token;
    if (source.kind === 'app') return applications[source.id] === token.app
      && liveFile(macFiles, applicationBundleId(source.id)) === token.bundle;
    if (source.kind === 'file') {
      const file = liveFile(macFiles, source.id);
      // Residency/access timestamps may change during our own open without
      // changing the exact document or its searchable content.
      return file === token.record && file.kind === token.kind && file.name === token.name
        && file.parentId === token.parentId && file.content === token.content && file.appId === token.appId
        && (file.tags ?? []).length === token.tags.length
        && token.tags.every((tag, index) => file.tags[index] === tag);
    }
    if (source.kind === 'note') {
      const note = notesState.notes.find(note => note.id === source.id);
      return note === token.record && !note.deleted && note.updatedAt === token.updatedAt && note.text === token.text;
    }
    if (source.kind === 'contact' || source.kind === 'mail') {
      const entry = communicationEntry(communicationsState, source.kind === 'contact' ? 'contacts' : 'mail', source.id);
      return Boolean(entry && entry.revision === token.revision && entry.updatedAt === token.updatedAt
        && Object.entries(token.fields).every(([key, value]) => entry.fields[key] === value));
    }
    return false;
  }
  async function activateSpotlightSource(source, action, guard) {
    const stale = () => rejected('stale_target', 'The original Spotlight destination is no longer current.');
    const invoke = async (command, target, payload = {}) => {
      if (!guard()) return stale();
      const result = await handlers[command](target, payload);
      return guard() ? result : stale();
    };
    let result, appId, windowId;
    if (source.kind === 'app' || source.kind === 'file') {
      const fileId = source.kind === 'app' ? applicationBundleId(source.id) : source.id;
      if (!guard()) return stale();
      if (action === 'reveal') {
        result = await revealStorageFile(null, fileId);
        appId = 'finder'; windowId = result.target?.finderWindowId;
      } else {
        result = await invoke('desktop.open', { fileId });
        appId = result.target?.appId; windowId = result.target?.windowId;
      }
    } else {
      appId = source.kind === 'note' ? 'notes' : source.kind === 'contact' ? 'contacts' : 'mail';
      result = await invoke('app.open', { appId });
      if (result.status !== 'applied') return result;
      windowId = result.target.windowId;
      await tick(); await tick();
      if (!guard()) return stale();
      if (source.kind === 'note') {
        result = await invoke('notes.search', {}, { query: '' });
        if (result.status !== 'applied') return result;
        result = await invoke('notes.selectFolder', { folder: 'notes' });
        if (result.status !== 'applied') return result;
        if (action === 'open') result = await invoke('notes.view.openNote', { windowId, noteId: source.id });
        else {
          result = await invoke('notes.select', { noteId: source.id });
          if (result.status !== 'applied') return result;
          const window = windows.find(window => window.id === windowId);
          if (window.notesPresentation?.mode === 'gallery' && window.notesPresentation.documentVisible) {
            result = await invoke('notes.view.return', { windowId });
            if (result.status !== 'applied') return result;
          }
          result = await invoke('notes.focus', { control: 'row', noteId: source.id });
        }
      } else {
        result = await invoke('services.provider.select', { appId, windowId }, { entryId: source.id });
        if (result.status === 'applied') result = await invoke('services.panel.focus', { appId, windowId, control: 'panel' });
      }
    }
    if (!guard()) return stale();
    return result.status === 'applied'
      ? { status: 'applied', target: { appId, windowId: windowId ?? null, itemId: source.id } } : result;
  }
  async function restoreTransientReturn(original, guard) {
    await tick(); await tick();
    const token = original?.snapshot?.focus, node = token?.node;
    if (!guard() || !transientInteractionsAvailable() || activeAppId !== original.appId
      || activeWindowId !== original.windowId || (windows.find(window => window.id === original.windowId) ?? null) !== original.window
      || !node?.isConnected || !sceneRoot?.contains(node) || node.closest('[inert]')
      || !node.getClientRects().length || getComputedStyle(node).visibility !== 'visible'
      || Object.hasOwn(token, 'sourceValue') && node.value !== token.sourceValue) return false;
    if (node.dataset.notesControl === 'search' && textEditing.targets().searchRevision !== token.noteRevision) return false;
    if (token.noteId && (node.dataset.noteId !== token.noteId || notesState.selectedId !== token.noteId
      || notesState.notes.find(note => note.id === token.noteId)?.updatedAt !== token.noteRevision)) return false;
    if (token.serviceEntryId) {
      const entry = communicationEntry(communicationsState, token.serviceAppId);
      if (entry?.id !== token.serviceEntryId || entry.revision !== token.serviceRevision
        || node.dataset.serviceEntryId !== token.serviceEntryId) return false;
    }
    ownedWindowFocus++;
    try {
      node.focus({ preventScroll: true });
      if (!guard() || document.activeElement !== node) return false;
      if (token.selection) node.setSelectionRange(token.selection.start, token.selection.end, token.selection.direction);
      return guard() && document.activeElement === node;
    } finally { ownedWindowFocus--; }
  }
  function spotlightBounds() {
    const width = Math.max(1, Math.min(680, stageArea.width - 16));
    const height = Math.max(1, Math.min(440, stageArea.height - 16));
    return { width, height, left: stageArea.width / 2,
      top: Math.min(Math.max(stageArea.menuHeight + 24, stageArea.height * .17), Math.max(8, stageArea.height - height - 8)) };
  }
  function toggleSpotlight() {
    if (!spotlightInteractionsAvailable()) return;
    void commands.execute(spotlightPane
      ? { command: 'spotlight.close', target: { spotlightId: spotlightPane.spotlightId } }
      : { command: 'spotlight.open' });
  }
  function spotlightKeydown(event) {
    if (!spotlightInteractionsAvailable() || event.defaultPrevented || event.isComposing
      || !event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || ![' ', 'Spacebar'].includes(event.key)
      || !sceneRoot?.contains(event.target) && ![document.body, document.documentElement].includes(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) toggleSpotlight();
  }
  function spotlightOutside(event) {
    if (!spotlightPane || !spotlightInteractionsAvailable() || spotlightPane.busy
      || event.target?.closest?.('[data-spotlight-id], [data-spotlight-invoker]')) return;
    void commands.execute({ command: 'spotlight.close', target: { spotlightId: spotlightPane.spotlightId }, payload: { restoreFocus: false } });
  }
  function toggleNotifications(event) {
    if (!notificationInteractionsAvailable()) return;
    if (event?.altKey) {
      void commands.execute({ command: 'notifications.dnd.set', payload: { enabled: !systemState.notifications.preferences.doNotDisturb } });
      return;
    }
    void commands.execute(notificationPane
      ? { command: 'notifications.close', target: { centerId: notificationPane.centerId } }
      : { command: 'notifications.open' });
  }
  function notificationOutside(event) {
    if (!notificationPane || !notificationNativeAvailable()
      || event.target?.closest?.('[data-notification-center-id], [data-notification-invoker], [data-widget-editor-id], [data-notification-banner-id]')) return;
    void commands.execute({ command: 'notifications.close', target: { centerId: notificationPane.centerId },
      payload: { restoreFocus: false } });
  }
  function widgetGalleryBounds() {
    const width = Math.max(1, Math.min(860, stageArea.width - 16));
    const height = Math.max(1, Math.min(440, stageArea.height - stageArea.menuHeight - 16));
    return { left: 8, top: Math.max(stageArea.menuHeight + 8, stageArea.height - height - 8), width, height };
  }
  function widgetDataAvailable(window) {
    return hasWidgets && notificationNativeAvailable() && !spotlightPane
      && (!notificationPane || Boolean(widgetOpening)) && activeWindowId === window.id
      && activeAppId === window.appId && windowInteractive(window) && !pendingQuitAppIds.includes(window.appId);
  }
  function widgetDataOwner(windowId) {
    const window = windows.find(entry => entry.id === windowId && !entry.utilityKind && widgetDataApps.includes(entry.appId));
    return window && widgetDataAvailable(window) ? { window, windowId, appId: window.appId } : null;
  }
  function widgetDataTargets() {
    return windows.filter(window => !window.utilityKind && widgetDataApps.includes(window.appId)).map(window => {
      const view = widgetDataViews.get(window.id), available = Boolean(widgetDataOwner(window.id) && view?.available());
      const actual = available ? view.describe() : null;
      return { appId: window.appId, windowId: window.id, available,
        controlIds: actual?.controlIds ?? [], focusedControl: actual?.focusedControl ?? null, scroll: actual?.scroll ?? null };
    });
  }
  async function openSelectedSceneData(selection, guard, commitSelection) {
    const stale = () => rejected('stale_target', 'The original scene-data source or destination has retired.');
    if (widgetOpening || !guard()) return stale();
    if (workflowTextSize() + systemRecentTextDelta(systemState, 'applications', selection.appId) > 4 * 1024 * 1024)
      return rejected('limit_exceeded', 'Opening the original scene-data source exceeds the complete-scene history budget.');
    const snapshot = captureWindowPreparation();
    // A destination rollback owns its windows, not asynchronously arriving
    // notifications or other system records. Keep canonical leaf identities.
    snapshot.system = null;
    const originalSelected = systemState.widgets.selected, previousSelected = $state.snapshot(originalSelected);
    const preparation = { appId: selection.appId, windowId: null, snapshot, createdIds: [] };
    widgetOpening = preparation;
    let committedSelection = null, completed = false;
    try {
      const result = await handlers['app.open']({ appId: selection.appId }, {});
      if (result.status !== 'applied') return result;
      preparation.windowId = result.target.windowId;
      if (!snapshot.windows.some(window => window.id === preparation.windowId)) preparation.createdIds.push(preparation.windowId);
      await tick(); await tick();
      const owner = widgetDataOwner(preparation.windowId), view = widgetDataViews.get(preparation.windowId);
      const current = () => guard() && widgetOpening === preparation
        && widgetDataOwner(preparation.windowId)?.window === owner?.window && widgetDataViews.get(preparation.windowId) === view;
      if (!owner || !view?.available() || !current() || await view.prepare('panel', current) !== true || !current()) return stale();
      const selected = commitSelection();
      if (selected.status !== 'applied') return selected;
      committedSelection = systemState.widgets.selected;
      await tick(); await tick();
      // Canonical selection is our commit, so the precommit source snapshot is
      // intentionally spent. Destination identity/foreground remain required.
      const destinationCurrent = () => !disposed && widgetOpening === preparation && notificationNativeAvailable()
        && widgetDataOwner(preparation.windowId)?.window === owner.window && widgetDataViews.get(preparation.windowId) === view;
      ownedWindowFocus++;
      try {
        if (!destinationCurrent() || !view.available() || await view.focus('panel', destinationCurrent) !== true
          || !destinationCurrent() || view.describe().focusedControl !== 'panel') return stale();
      } finally { ownedWindowFocus--; }
      completed = true;
      return { status: 'applied', target: { appId: selection.appId, windowId: preparation.windowId } };
    } finally {
      if (!completed) {
        if (committedSelection && systemState.widgets.selected === committedSelection) {
          Object.assign(originalSelected, previousSelected); systemState.widgets.selected = originalSelected;
        }
        await rollbackWindowPreparation(preparation, guard);
      }
      if (widgetOpening === preparation) widgetOpening = null;
    }
  }

  function notificationSources() {
    return { notes: notesState, files: desktopFileStore, messages: messagesState, mail: mailState,
      contacts: contactsState, calendar: calendarState, reminders: remindersState, calls: callsState,
      stocks: nativeApplications.stocks, news: nativeApplications.news, clockApp: nativeApplications.clockApp };
  }
  function prepareCanonicalNotificationDismissals(notificationIds, ownership) {
    if (disposed || ownership?.guard?.() !== true) return null;
    const entries = notificationIds.map(id => systemState.notifications.entries.find(entry => entry.id === id));
    if (entries.some(entry => !entry)) return null;
    const controllers = new Set();
    for (const entry of entries) {
      const kind = entry.destination?.kind;
      const controller = kind === 'call' ? domainControllers.get(macDesktop ? 'facetime' : 'teams-call')
        : kind === 'event' ? domainControllers.get('calendar')
          : kind === 'reminder' ? domainControllers.get('reminders')
            : kind?.startsWith('stocks-') ? nativeControllers.get('stocks')
              : kind === 'news-story' ? nativeControllers.get('news')
                : kind === 'clock' ? nativeControllers.get('clockApp') : null;
      if (controller) controllers.add(controller);
    }
    const plans = [];
    let delta = 0, committed = false;
    for (const controller of controllers) {
      const plan = controller.prepareNotificationDismissals?.(notificationIds, ownership);
      if (!plan || typeof plan.current !== 'function' || typeof plan.commit !== 'function'
        || !Number.isSafeInteger(plan.delta) || plan.current() !== true) return null;
      plans.push(plan); delta += plan.delta;
    }
    if (!Number.isSafeInteger(delta)) return null;
    const current = () => !committed && !disposed && ownership.guard() === true
      && entries.every(entry => systemState.notifications.entries.includes(entry))
      && plans.every(plan => plan.current() === true);
    return { current, delta, commit() {
      if (!current() || completeSceneStringUnits() + delta > 4 * 1024 * 1024 || !current()) return false;
      for (const plan of plans) if (plan.commit() !== true) return false;
      committed = true;
      return true;
    } };
  }
  function retireUnavailableNotificationSources() {
    if (disposed) return;
    for (const entry of [...systemState.notifications.entries])
      if (!resolveNotificationDestination(entry, notificationSources(), profile)) dismissNotification(systemState.notifications, entry.id);
  }
  function notificationSettingsOwner(windowId) {
    const window = windows.find(entry => entry.id === windowId && entry.appId === 'settings' && !entry.utilityKind
      && entry.settingsPane === 'notifications');
    const view = window && applicationViews.get(windowId);
    return window && activeWindowId === windowId && activeAppId === 'settings' && notificationNativeAvailable()
      && windowInteractive(window) && view?.available() ? { window, view } : null;
  }
  async function openNotificationSettings(appId) {
    const result = await openWindowPanel('settings', null, 'Notifications', 'notifications');
    if (result.status !== 'applied') return result;
    const owner = notificationSettingsOwner(result.target.windowId);
    if (!owner) return rejected('unavailable', 'The original Notifications Settings window did not remain foreground.');
    owner.window.notificationAppId = appId ?? owner.window.notificationAppId ?? 'messages';
    await tick(); await tick();
    if (appId && !disposed && notificationSettingsOwner(owner.window.id)?.view === owner.view)
      owner.view.focus('notifications-allow');
    return { status: 'applied', target: { ...result.target, selectedAppId: owner.window.notificationAppId } };
  }
  async function openNotificationDestination(lease, guard) {
    const { source } = lease;
    const stale = () => rejected('stale_target', 'The original notification source or native app destination has retired.');
    if (!guard()) return stale();
    if (source.kind === 'call') {
      const result = await domainControllers.get(macDesktop ? 'facetime' : 'teams-call')
        .notificationAction(source.recordId, 'show', { guard });
      return result.status === 'applied' ? { ...result,
        target: { ...result.target, appId: source.appId, recordId: source.recordId } } : result;
    }
    if (source.kind === 'file') {
      const result = await executeNativeOwned({ command: 'desktop.open', target: { fileId: source.recordId } }, { guard });
      return result.status === 'applied' ? { status: 'applied', target: {
        appId: source.appId, windowId: result.target.windowId ?? null, recordId: source.recordId,
      } } : result;
    }
    if (source.kind === 'app') {
      const result = await executeNativeOwned({ command: 'app.open', target: { appId: source.appId } }, { guard });
      return result.status === 'applied' ? { status: 'applied', target: {
        appId: source.appId, windowId: result.target.windowId ?? null, recordId: null,
      } } : result;
    }
    const invoke = async (command, target, payload = {}) => {
      if (!guard()) return stale();
      return executeNativeOwned({ command, target, payload }, { guard });
    };
    let result = await invoke('app.open', { appId: source.appId });
    if (result.status !== 'applied') return result;
    const windowId = result.target.windowId;
    await tick(); await tick();
    if (source.kind === 'note') {
      result = await invoke('notes.search', {}, { query: '' });
      if (result.status !== 'applied') return result;
      result = await invoke('notes.selectFolder', { folder: 'notes' });
      if (result.status !== 'applied') return result;
      result = await invoke('notes.view.openNote', { windowId, noteId: source.recordId });
    } else if (source.kind === 'event') {
      result = await invoke('calendar.view.set', { windowId }, { view: 'day',
        date: calendarDateString(source.record.start, source.record.timeZone === 'floating'
          ? calendarState.preferences.timeZone : source.record.timeZone) });
      if (result.status === 'applied') result = await invoke('calendar.event.select', { windowId }, { eventId: source.recordId });
    } else if (source.kind === 'reminder') {
      result = await invoke('reminders.view.set', { windowId }, { listId: source.record.listId, view: 'list', query: '' });
      if (result.status === 'applied') result = await invoke('reminders.task.select', { windowId }, { reminderId: source.recordId });
    } else if (source.kind === 'message') {
      result = await invoke('messages.search', { windowId }, { query: '' });
      if (result.status === 'applied') result = await invoke('messages.conversation.select',
        { windowId, conversationId: source.recordId });
    } else if (source.kind === 'mail') {
      result = await invoke('mail.mailbox.select', { windowId }, { mailboxId: source.record.mailboxId });
      if (result.status === 'applied') result = await invoke('mail.message.select', { windowId }, { messageId: source.recordId });
    } else if (source.kind === 'contact') {
      result = await invoke('contacts.search', { windowId }, { query: '' });
      if (result.status === 'applied') result = await invoke('contacts.group.select', { windowId }, { groupId: null });
      if (result.status === 'applied') result = await invoke('contacts.select', { windowId }, { contactIds: [source.recordId] });
    } else if (source.kind === 'stocks-price' || source.kind === 'stocks-story' || source.kind === 'news-story') {
      const controller = nativeControllers.get(source.kind === 'news-story' ? 'news' : 'stocks');
      const plan = controller.prepareNotificationOpen(source.kind, source.recordId, { windowId, guard });
      if (!plan?.current() || completeSceneStringUnits() + plan.delta > 4 * 1024 * 1024 || !plan.current()) return stale();
      result = plan.commit() === true ? { status: 'applied' } : stale();
    } else if (source.kind === 'clock') {
      result = await invoke('clockApp.page', { windowId }, { page: source.record.kind === 'alarm' ? 'alarms' : 'timers' });
    } else {
      return rejected('unsupported_destination', 'This original notification has no native application selection route.');
    }
    return result.status === 'applied' ? { status: 'applied', target: { appId: source.appId, windowId, recordId: source.recordId } } : result;
  }
  function completeNotificationDestination(lease, guard) {
    if (!guard() || lease.source.kind !== 'reminder') return rejected('stale_target', 'The original reminder source is unavailable.');
    return setCanonicalReminderCompleted(lease.source.recordId, true, { guard });
  }
  async function snoozeNotificationDestination(lease, minutes, guard, entry) {
    if (!guard()) return rejected('stale_target', 'The original notification snooze source changed.');
    const { source } = lease;
    const window = await prepareDomainWindow(source.appId, guard);
    if (!window || !guard()) return rejected('stale_target', 'The original native alert window is unavailable.');
    let command, target = { windowId: window.id }, payload, delivery;
    if (source.kind === 'event') {
      delivery = calendarState.alertDeliveries.find(row => row.notificationId === entry.id && row.eventId === source.recordId);
      command = 'calendar.alert.action'; payload = { deliveryId: delivery?.id, action: 'snooze', minutes };
    } else if (source.kind === 'reminder') {
      delivery = remindersState.alerts.find(row => row.notificationId === entry.id && row.reminderId === source.recordId);
      command = 'reminders.alert.snooze'; payload = { alertId: delivery?.id, minutes };
    } else if (source.kind === 'clock') {
      delivery = source.record;
      if (minutes !== nativeApplications.clockApp.preferences.snoozeMinutes)
        return rejected('stale_target', 'The original configured Clock snooze duration changed.');
      command = 'clockApp.alert'; target.recordId = source.recordId; payload = { action: 'snooze' };
    } else return rejected('unsupported_destination', 'Only original Calendar, Reminders and Clock alerts can be snoozed.');
    if (!delivery) return rejected('stale_target', 'The exact original delivery ledger retired.');
    const result = await executeNativeOwned({ command, target, payload }, { guard });
    return result.status === 'applied' ? { ...result,
      snoozedUntil: delivery.snoozeUntil ?? delivery.snoozeAt } : result;
  }
  function replyNotificationDestination(lease, body, guard) {
    if (!guard() || !['message', 'mail'].includes(lease.source.kind))
      return rejected('stale_target', 'The original fictional local reply source is unavailable.');
    const result = replyToCommunication(communicationsState, lease.source.recordId, body,
      candidate => guard() && canCommitServiceCommunications(candidate) && guard(), macFiles.sceneTime);
    if (result.status === 'applied') { sharedClockWriter.onTimeChanged?.(communicationsState.timeBase); serviceEpoch++; }
    return result;
  }
  function registerNotificationBannerView(bannerId, view, original) {
    if (view) { notificationBannerViews.set(bannerId, view); return; }
    if (!original || notificationBannerViews.get(bannerId) === original) notificationBannerViews.delete(bannerId);
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
      restoreRetainedView(element, pendingWindowViews.get(id), retainedWindowOptions(windows.find(window => window.id === id), { focus: foreground }));
      pendingWindowViews.delete(id);
    }
    return hasRetention ? element.contains(document.activeElement) : document.activeElement === element;
  }
  function createMacSceneFiles() {
    const sceneTime = initialData.files?.sceneTime ?? Math.max(Date.parse(profile.defaults.sceneTime), ...initialData.notes.notes.map(note => note.updatedAt));
    const store = initialData.files ?? createMacDesktopFileStore(profile, sceneTime);
    const catalog = createMacApplicationFiles(profile, sceneTime);
    if (savedScene) for (const file of catalog) Object.assign(file, savedScene.catalogTimes[file.id]);
    store.files.push(...catalog);
    if (savedScene) {
      const records = new Map(store.files.map(file => [file.id, file]));
      store.files.splice(0, store.files.length, ...savedScene.fileOrder.map(id => records.get(id)));
    }
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
    return hasAppleMenu ? trashStorageFiles(macFiles, fileIds)
      : trashVirtualFiles(desktopFileStore, fileIds, macDesktop ? ['disk', 'desktop', 'downloads', 'trash'] : undefined);
    });
  }
  function windowApplication(window) {
    const app = applications[window.appId], utility = WINDOW_UTILITY_SIZES[window.utilityKind];
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
  function getWindowPanel(windowId) {
    const window = windows.find(entry => entry.id === windowId);
    if (!window || window.minimized || !windowPresented(window) || !windowInteractionsAvailable()
      || switching.switcher || presentation.pairing || pendingQuitAppIds.includes(window.appId)) return null;
    const element = managedWindowElement(windowId)?.querySelector('[data-application-panel-scroll]');
    return element?.isConnected && !element.closest('[inert]') && element.getClientRects().length
      ? { window, element } : null;
  }
  async function focusWindowPanel(entry, control) {
    const find = panel => control === 'panel' ? panel?.element
      : panel?.element.querySelector(`[data-application-settings-control="${CSS.escape(control)}"]`);
    let node = find(entry);
    if (!node?.isConnected || node.disabled || node.closest('[inert]') || !node.getClientRects().length) return false;
    focusWindow(entry.window.id);
    await tick(); await tick();
    node = find(getWindowPanel(entry.window.id));
    if (!node?.isConnected || node.disabled || node.closest('[inert]') || !node.getClientRects().length) return false;
    const native = applicationViews.get(entry.window.id);
    if (control !== 'panel' && entry.window.appId === 'settings' && ['sound', 'menu-bar', 'bluetooth', 'keyboard', 'spotlight', 'notifications'].includes(entry.window.settingsPane)
      && native?.focus) return native.focus(control);
    node.focus();
    await tick();
    return document.activeElement === node && getWindowPanel(entry.window.id)?.element.contains(node) === true;
  }
  async function openWindowPanel(appId, utilityKind, title, settingsPane, forceQuitRequest) {
    if (utilityPreparation) return rejected('unavailable', 'Wait for the current native panel preparation.');
    if (pendingQuitAppIds.includes(appId)) return rejected('unavailable', 'Resolve the pending application quit before opening its panel.');
    const snapshot = captureWindowPreparation();
    // Delivery controllers retain original canonical leaves across native panel
    // preparation. A window rollback must not replace those identities.
    if (settingsPane === 'notifications') snapshot.system = null;
    const preparation = { appId, windowId: null, snapshot, createdIds: [] };
    utilityPreparation = preparation;
    try {
      let window = utilityKind && windows.find(entry => entry.appId === appId && entry.utilityKind === utilityKind);
      if (window) focusWindow(window.id);
      else {
        const id = openWindow(appId, title, Boolean(utilityKind), utilityKind);
        window = windows.find(entry => entry.id === id);
        if (!snapshot.windows.some(entry => entry.id === id)) preparation.createdIds.push(id);
        if (utilityKind) utilityReturnFocus.set(id, snapshot.returnFocus);
      }
      preparation.windowId = window.id;
      if (settingsPane) { window.settingsPane = settingsPane; window.title = title; }
      if (utilityKind === 'system-force-quit' && !Object.hasOwn(window, 'forceQuitSelectedAppId')) {
        window.forceQuitSelectedAppId = runningAppIds.includes(snapshot.activeAppId)
          ? snapshot.activeAppId : runningAppIds[0] ?? null;
      }
      if (forceQuitRequest) {
        window.forceQuitSelectedAppId = forceQuitRequest.presentation.appId;
        forceQuitConfirmationLease = forceQuitRequest.lease;
        forceQuitReturnControl = forceQuitRequest.returnControl;
        forceQuitConfirmation = { ...forceQuitRequest.presentation, windowId: window.id };
      }
      await tick(); await tick();
      const entry = getWindowPanel(window.id);
      const control = utilityKind === 'application-settings' ? 'sort-by'
        : utilityKind === 'system-force-quit' && forceQuitConfirmation?.windowId === window.id ? 'confirmation-cancel'
        : utilityKind === 'system-force-quit' && window.forceQuitSelectedAppId ? `app:${window.forceQuitSelectedAppId}` : 'panel';
      if (!entry || !await focusWindowPanel(entry, control) || !sceneCoreAvailable()
        || activeWindowId !== window.id || activeAppId !== appId || forceQuitRequest && !currentForceQuitLease()) {
        if (forceQuitRequest) cancelForceQuitConfirmation(window.id);
        await rollbackWindowPreparation(preparation);
        return rejected('unavailable', 'The owned system/application panel did not finish native preparation.');
      }
      return { status: 'applied', target: { appId, windowId: window.id } };
    } catch (error) {
      if (forceQuitRequest) cancelForceQuitConfirmation(preparation.windowId);
      await rollbackWindowPreparation(preparation);
      throw error;
    } finally {
      if (utilityPreparation === preparation) utilityPreparation = null;
    }
  }
  function getSystemPanel(windowId) {
    const entry = getWindowPanel(windowId);
    return entry?.element.hasAttribute('data-system-panel') ? entry : null;
  }
  function systemPanelControls(entry) {
    return entry ? ['panel', ...[...entry.element.querySelectorAll('[data-application-settings-control]')]
      .filter(node => !node.disabled && !node.closest('[inert]') && node.getClientRects().length).map(node => node.dataset.applicationSettingsControl)] : [];
  }
  function servicesAvailable() {
    return hasServices && windowInteractionsAvailable() && !switching.switcher && !presentation.pairing;
  }
  function getDesktopContextMenuItems() {
    const items = desktopContextItems(desktopState, getDesktopItems(), profile.family);
    if (!hasServices || !desktopState.context?.fileId || activeAppId !== 'finder' || activeWindowId !== null) return items;
    serviceEpoch;
    const source = serviceSources?.physicalSource(), children = source?.kind === 'files' ? serviceMenuItems(source, profile) : [];
    return children.length ? [...items, { id: 'local-services', label: 'Services', enabled: true, children }] : items;
  }
  function getServiceFrame(windowId, requireForeground = true) {
    if (!servicesAvailable() || windowId === null) return null;
    const window = windows.find(entry => entry.id === windowId && !entry.utilityKind && !entry.minimized
      && !isAppHidden(entry.appId) && !pendingQuitAppIds.includes(entry.appId));
    const element = window && managedWindowElement(windowId);
    if (!window || !windowPresented(window) || !element?.isConnected || element.closest('[inert]') || !element.getClientRects().length
      || requireForeground && (activeWindowId !== windowId || activeAppId !== window.appId)) return null;
    return { window, element };
  }
  function serviceSampleAvailable(windowId) {
    return Boolean(hasServices && getServiceFrame(windowId, false)?.window.appId === 'messages'
      && communicationsState.selected.messages === null && selectedMessageConversation(messagesState));
  }
  function sampleServiceView(windowId) {
    const history = () => getServiceFrame(windowId, true)?.element.querySelector('.golden-gate-messages-history');
    if (!sampleServiceViews.has(windowId)) sampleServiceViews.set(windowId, {
      prepare: async () => Boolean(getServiceFrame(windowId, true)),
      focus: async control => control === 'panel' && serviceSampleAvailable(windowId) && await focusKeyboardWindow(windowId),
      fieldNode: () => null, contains: node => Boolean(getServiceFrame(windowId, true)?.element.contains(node)),
      describe: () => ({ controlIds: ['panel'], focusedControl: document.activeElement === managedWindowElement(windowId) ? 'panel' : null,
        scroll: { top: history()?.scrollTop ?? 0, left: history()?.scrollLeft ?? 0 } }),
      scroll: ({ top, left, observe }) => {
        const node = history(); if (!node) return null;
        if (!observe) node.scrollTo({ top, left, behavior: 'instant' });
        return { top: node.scrollTop, left: node.scrollLeft };
      },
    });
    return sampleServiceViews.get(windowId);
  }
  function getServiceProvider(windowId) {
    const frame = getServiceFrame(windowId, false);
    if (!frame || !['contacts', 'mail', 'messages'].includes(frame.window.appId)) return null;
    const appId = frame.window.appId, view = appId === 'messages' ? messagesViews.get(windowId) : domainViews.get(windowId);
    const state = appId === 'contacts' ? contactsState : appId === 'mail' ? mailState : messagesState;
    const session = appId === 'contacts' ? contactsWindow(state, windowId) : appId === 'mail' ? mailWindow(state, windowId) : null;
    const recordFor = () => appId === 'contacts' ? state.contacts.find(row => row.id === session?.selectedIds[0]) ?? null
      : appId === 'mail' ? state.drafts.find(row => row.id === session?.draftId) ?? state.messages.find(row => row.id === session?.selectedIds[0]) ?? null
        : state.drafts.find(row => row.id === state.selectedDraftId) ?? selectedMessageConversation(state);
    const record = recordFor(), recordValue = JSON.stringify(record), sessionValue = JSON.stringify(session);
    if (!view?.available()) return null;
    return { appId, windowId, window: frame.window, session, record, view,
      isCurrent: () => getServiceFrame(windowId, false)?.window === frame.window
        && (appId === 'messages' ? messagesViews.get(windowId) : domainViews.get(windowId)) === view && view.available()
        && (appId === 'contacts' ? contactsWindow(state, windowId) : appId === 'mail' ? mailWindow(state, windowId) : null) === session
        && recordFor() === record && JSON.stringify(record) === recordValue && JSON.stringify(session) === sessionValue };
  }
  function registerServiceView(windowId, view, original) {
    if (view) { serviceViews.set(windowId, view); serviceEpoch++; return () => {
      if (serviceViews.get(windowId) === view) { serviceViews.delete(windowId); serviceEpoch++; }
    }; }
    if (!original || serviceViews.get(windowId) === original) { serviceViews.delete(windowId); serviceEpoch++; }
  }
  function registerServiceLookupView(view, original) {
    if (view) { serviceLookupView = view; return () => { if (serviceLookupView === view) serviceLookupView = null; }; }
    if (!original || serviceLookupView === original) serviceLookupView = null;
  }
  function registerServiceContextView(view, original) {
    if (view) { serviceContextView = view; return () => { if (serviceContextView === view) serviceContextView = null; }; }
    if (!original || serviceContextView === original) serviceContextView = null;
  }
  function serviceProviderModel(appId, windowId) {
    serviceEpoch;
    const pending = servicePending?.windowId === windowId ? servicePending : null;
    const entry = pending?.entry ?? communicationEntry(communicationsState, appId);
    return { entry, pending: Boolean(pending), editable: Boolean(pending || entry && communicationsState.drafts.some(draft => draft.id === entry.id)),
      error: serviceErrors[windowId] ?? null,
      entries: communicationEntries(communicationsState, appId).map(item => ({ id: item.id, kind: item.kind,
        label: item.kind === 'contact' ? item.fields.name || item.fields.email || item.fields.phone
          : item.kind === 'mail' ? item.fields.subject || item.fields.to || 'New email' : item.fields.to || 'New message',
        draft: communicationsState.drafts.some(draft => draft.id === item.id) })),
      contactSourceId: entry?.kind === 'contact' && !pending && activeWindowId === windowId ? serviceSources.contactSource(false)?.sourceId : null };
  }
  function describeServiceProviders() {
    return windows.filter(window => ['contacts', 'mail', 'messages'].includes(window.appId) && !window.utilityKind).map(window => {
      const provider = getServiceProvider(window.id);
      return { appId: window.appId, windowId: window.id, available: Boolean(provider), recordId: provider?.record?.id ?? null };
    });
  }
  function serviceSelectedFiles(windowId, requireForeground = true) {
    if (!servicesAvailable() || requireForeground && (activeAppId !== 'finder' || activeWindowId !== windowId)) return null;
    const frame = windowId === null ? null : getServiceFrame(windowId, requireForeground);
    if (windowId !== null && frame?.window.appId !== 'finder') return null;
    const ids = windowId === null ? desktopState.selectedFileIds : frame.window.finderSelectedFileIds ?? [];
    const available = windowId === null ? getDesktopItems().map(item => item.id)
      : macFiles.files.filter(file => file.parentId === frame.window.folderId && !file.deleted).map(file => file.id);
    if (!ids.length || ids.some(id => !available.includes(id))) return null;
    const values = ids.map(fileId => {
      const file = liveFile(macFiles, fileId), info = getDesktopFileInfo(fileId);
      return file && info && !info.deleted ? { fileId, name: file.name, kind: file.kind, revision: file.revision,
        path: `${info.path} / ${file.name}` } : null;
    });
    return values.every(Boolean) ? values : null;
  }
  function getContactServiceSource() {
    if (activeAppId !== 'contacts') return null;
    const provider = getServiceProvider(activeWindowId), record = provider?.record;
    if (!record || provider.session.editor) return null;
    const projection = () => {
      const unified = linkedContact(contactsState, record.id);
      return unified ? { id: record.id, name: contactName(unified, contactsState.preferences),
        email: unified.emails[0]?.value ?? '', phone: unified.phones[0]?.value ?? '' } : null;
    };
    const contact = projection(), value = JSON.stringify(contact);
    return { kind: 'contact', appId: 'contacts', windowId: provider.windowId, window: provider.window,
      recordId: record.id, revision: record.revision, contact,
      isCurrent: () => provider.isCurrent() && JSON.stringify(projection()) === value };
  }
  function getPhysicalServiceSource() {
    const appId = activeAppId, windowId = activeWindowId;
    if (appId === 'finder') {
      const files = serviceSelectedFiles(windowId), frame = windowId === null ? null : getServiceFrame(windowId, false);
      if (!files?.length) return null;
      const signature = JSON.stringify(files), originals = files.map(file => applicationFiles.getFile(file.fileId)), originalDesktop = desktopView;
      return { kind: 'files', appId, windowId, window: frame?.window, files,
        isCurrent: () => (windowId !== null || desktopView === originalDesktop) && originals.every((file, index) => applicationFiles.getFile(files[index].fileId) === file)
          && JSON.stringify(serviceSelectedFiles(windowId, false)) === signature };
    }
    const frame = getServiceFrame(windowId, false);
    if (!frame) return null;
    const token = menuBarState?.menuId ? getMenuReturnFocus?.()?.focus : null, node = token?.node ?? document.activeElement;
    if (appId === 'notes') {
      const view = domainViews.get(windowId), source = notesWorkspaceTextSource(notesState, windowId, view);
      if (!source || source.selection.start === source.selection.end) return null;
      const native = view.captureSelection(), session = notesWorkspaceWindow(notesState, windowId);
      const sessionValue = JSON.stringify(session), revision = source.revision, value = source.value;
      const selection = document.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : token?.domSelection;
      if (!range) return null;
      const text = value.slice(source.selection.start, source.selection.end);
      return { kind: 'text', appId, windowId, window: frame.window, node, noteId: source.note.id,
        control: 'editor', revision, value, start: source.selection.start, end: source.selection.end, text,
        isCurrent: () => domainViews.get(windowId) === view && view.available() && view.ownsNote(source.note)
          && source.note.revision === revision && noteWorkspaceText(source.note) === value
          && notesWorkspaceWindow(notesState, windowId) === session && JSON.stringify(session) === sessionValue
          && range?.startContainer.isConnected && range.endContainer.isConnected && range.toString() === text
          && (activeWindowId !== windowId || !frame.element.contains(document.activeElement)
            || JSON.stringify(view.captureSelection()) === JSON.stringify(native)) };
    }
    const provider = getServiceProvider(windowId);
    if (provider && node?.isConnected && frame.element.contains(node) && typeof node.value === 'string' && typeof node.selectionStart === 'number') {
      const selected = token?.node === node ? token.selection : { start: node.selectionStart, end: node.selectionEnd };
      if (selected && selected.start < selected.end) {
        const value = node.value;
        return { kind: 'text', appId, windowId, window: frame.window, node, recordId: provider.record?.id,
          control: node.dataset.mailControl ?? node.dataset.contactsControl ?? node.dataset.messagesControl,
          revision: provider.record?.revision, value, start: selected.start, end: selected.end, text: value.slice(selected.start, selected.end),
          isCurrent: () => provider.isCurrent() && node.isConnected && node.value === value
            && node.selectionStart === selected.start && node.selectionEnd === selected.end };
      }
    }
    if (appId === 'messages') {
      const selected = document.getSelection(), anchor = selected?.anchorNode;
      const element = (anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement)?.closest('p[data-messages-control^="message:"]');
      const conversation = selectedMessageConversation(messagesState), item = conversation?.items.find(row => `message:${row.id}` === element?.dataset.messagesControl);
      if (item?.kind === 'text' && element && frame.element.contains(element) && selected.rangeCount === 1 && element.contains(selected.focusNode)) {
        const originalRange = selected.getRangeAt(0).cloneRange(), prefix = originalRange.cloneRange();
        prefix.selectNodeContents(element); prefix.setEnd(originalRange.startContainer, originalRange.startOffset);
        const start = prefix.toString().length, text = originalRange.toString(), fingerprint = JSON.stringify(item);
        if (text.length) return { kind: 'text', appId, windowId, window: frame.window, node: element, recordId: item.id,
          control: element.dataset.messagesControl, value: item.text, start, end: start + text.length, text,
          isCurrent: () => messagesViews.get(windowId)?.available() && selectedMessageConversation(messagesState) === conversation
            && conversation.items.includes(item) && JSON.stringify(item) === fingerprint && element.isConnected
            && element.textContent === item.text && originalRange.startContainer.isConnected && originalRange.endContainer.isConnected && originalRange.toString() === text };
      }
    }
    return getContactServiceSource();
  }
  async function setProviderSelection(provider, control, range, owner) {
    if (!owner.guard() || !provider.isCurrent()) return false;
    if (provider.appId === 'mail') return provider.view.setSelection(control, range.start, range.end, owner.guard);
    if (provider.appId === 'contacts') return provider.view.setSelection(control, range, owner.guard);
    if (control === 'draft-body' && provider.record?.kind === 'message')
      return provider.view.restoreDraftSelection(provider.record.id, { ...range, direction: range.direction ?? 'none' }, owner.guard);
    if (await provider.view.focus(control, owner.guard) !== true || !owner.guard()) return false;
    const node = Array.from(managedWindowElement(provider.windowId)?.querySelectorAll('[data-messages-control]') ?? [])
      .find(node => node.dataset.messagesControl === control);
    if (!node || typeof node.setSelectionRange !== 'function' || range.end > node.value.length) return false;
    return selectNativeText(node, range) && owner.guard();
  }
  function captureWindowPreparation() {
    return { windows: $state.snapshot(windows), switching: $state.snapshot(switching), running: [...runningAppIds],
      activeAppId, activeWindowId, nextWindowId, closed: $state.snapshot(closedWindows),
      dock: $state.snapshot(desktopState.dock), spaces: $state.snapshot(spaceState), returnFocus: captureSessionDesktop(),
      system: hasAppleMenu ? $state.snapshot(systemState) : null };
  }
  async function prepareServiceDestination(appId, spec, ownership) {
    if (!ownership.guard()) return rejected('stale_target', 'The original Services source changed.');
    const previous = new Set(windows.map(window => window.id)), snapshot = captureSessionDesktop();
    const id = openWindow(appId, appId === 'mail' ? 'New Message' : undefined, appId === 'mail', undefined, { isCurrent: ownership.guard });
    const window = windows.find(window => window.id === id);
    if (!window) return rejected('unavailable', 'The actual native Services destination could not open.');
    await tick(); await tick();
    const view = appId === 'messages' ? messagesViews.get(id) : domainViews.get(id);
    if (!ownership.guard() || !windows.includes(window) || !view?.available()) return rejected('stale_target', 'The original Services preparation changed.');
    const state = appId === 'notes' ? notesState : appId === 'contacts' ? contactsState : appId === 'mail' ? mailState : messagesState;
    const session = appId === 'notes' ? notesWorkspaceWindow(state, id) : appId === 'contacts' ? contactsWindow(state, id)
      : appId === 'mail' ? mailWindow(state, id) : null;
    const preparation = { appId, windowId: id, window, view, state, session, snapshot, created: !previous.has(id),
      baseline: JSON.stringify(state), time: sharedClockWriter.getSceneTime(), committed: false };
    if (appId === 'notes') return preparation;
    const candidate = copyCanonicalData(state);
    let recordId, timestamp = preparation.time;
    if (appId === 'contacts') {
      const result = createContact(candidate, spec.fields, { time: timestamp });
      if (result.status !== 'applied') return rejected(result.code, result.message);
      recordId = result.contactId;
      const destination = contactsWindow(candidate, id);
      destination.selectedIds = [recordId]; destination.query = ''; destination.groupId = null; destination.editor = null; destination.editingId = null;
    } else if (appId === 'mail') {
      const draft = createMailServiceDraft(candidate, { to: spec.to.map(row => row.name ? `${row.name} <${row.email}>` : row.email).join(', '), subject: spec.subject, body: spec.body });
      if (!draft) return rejected('limit_exceeded', 'The canonical Mail draft exceeds a bound.');
      for (const reference of spec.attachments) {
        const file = applicationFiles.getFile(reference.fileId), content = applicationFiles.readFile(reference.fileId, ownership);
        if (!file || file.revision !== reference.revision || content.status !== 'applied') return rejected('stale_target', 'An original attachment file changed.');
        const attachmentId = mailNewId(candidate, 'mail-attachment');
        if (!attachmentId) return rejected('limit_exceeded', 'Mail attachment identity capacity is exhausted.');
        draft.attachments.push({ id: attachmentId, fileId: file.id, name: file.name, mime: content.mime, text: content.text });
      }
      const at = candidate.windows.findIndex(row => row.windowId === id);
      candidate.windows[at] = createMailWindow(candidate, id, 'compose', draft.id); draft.windowId = id;
      if (!validateMailState(candidate, profile)) return rejected('invalid_arguments', 'The requested real Mail draft or attachments violate its bounded schema.');
      recordId = draft.id;
    } else {
      const recipient = spec.recipient;
      const result = createMessageDraft(candidate, { to: recipient ? recipient.name ? `${recipient.name} <${recipient.address}>` : recipient.address : '', body: spec.text }, { time: timestamp });
      if (result.status !== 'applied') return result;
      recordId = result.target.draftId; timestamp = candidate.timeBase;
    }
    preparation.transition = { status: 'prepared', candidate, recordId, timestamp,
      deltaTextUnits: canonicalStringUnits(candidate) - canonicalStringUnits(state) };
    return preparation;
  }
  function serviceDestinationCurrent(preparation) {
    return Boolean(preparation && !preparation.committed && windows.includes(preparation.window)
      && getServiceFrame(preparation.windowId, false)?.window === preparation.window
      && (preparation.appId === 'messages' ? messagesViews.get(preparation.windowId) : domainViews.get(preparation.windowId)) === preparation.view
      && preparation.view.available() && sharedClockWriter.getSceneTime() === preparation.time
      && JSON.stringify(preparation.state) === preparation.baseline);
  }
  function commitServiceTransition(spec, ownership) {
    const { preparation } = spec, transition = spec.transition;
    const delta = spec.provider === 'notes' ? spec.deltaTextUnits : transition.deltaTextUnits;
    const timestamp = spec.provider === 'notes' ? spec.timestamp : transition.timestamp;
    if (!ownership.guard() || !serviceDestinationCurrent(preparation)) return rejected('stale_target', 'The original Services domain, source or clock changed.');
    if (completeSceneStringUnits() + delta > 4 * 1024 * 1024) return rejected('limit_exceeded', 'The complete scene text budget is exhausted.');
    if (!ownership.guard() || !serviceDestinationCurrent(preparation)) return rejected('stale_target', 'The original Services commit changed.');
    if (spec.provider === 'notes') {
      if (spec.onCommit() !== true) return rejected('stale_target', 'The original Notes creation refused the shared commit.');
    } else applyCanonicalData(preparation.state, transition.candidate);
    preparation.committed = true;
    sharedClockWriter.onTimeChanged(timestamp);
    serviceEpoch++;
    return { status: 'applied', target: { recordId: transition?.recordId } };
  }
  async function rollbackServiceDestination(preparation, source) {
    if (!preparation || preparation.committed || !serviceDestinationCurrent(preparation)) return;
    const ownedFocus = activeWindowId === preparation.windowId;
    if (preparation.created) closeWindow(preparation.windowId);
    if (ownedFocus && serviceSources.current(source)) await restoreSessionDesktop(preparation.snapshot);
  }
  async function rollbackWindowPreparation(preparation, sourceCurrent = null) {
    if (disposed) return;
    const owned = activeWindowId === preparation.windowId && activeAppId === preparation.appId;
    for (const id of preparation.createdIds) {
      const index = windows.findIndex(window => window.id === id);
      if (index >= 0) windows.splice(index, 1);
      serviceViews.delete(id); pendingWindowViews.delete(id); utilityReturnFocus.delete(id);
    }
    if (owned) {
      const snapshot = preparation.snapshot, byId = new Map(windows.map(window => [window.id, window]));
      windows = snapshot.windows.filter(window => byId.has(window.id)).map(window => Object.assign(byId.get(window.id), window));
      Object.assign(switching, snapshot.switching); runningAppIds = snapshot.running; activeAppId = snapshot.activeAppId;
      activeWindowId = snapshot.activeWindowId; nextWindowId = snapshot.nextWindowId; closedWindows = snapshot.closed;
      desktopState.dock = snapshot.dock; Object.assign(spaceState, snapshot.spaces);
      if (hasAppleMenu && snapshot.system) Object.assign(systemState, snapshot.system);
      await tick(); await tick();
      if (sceneCoreAvailable() && (!sourceCurrent || sourceCurrent())) await restoreSessionDesktop(snapshot.returnFocus);
      else if (sceneCoreAvailable() && activeWindowId) await focusKeyboardWindow(activeWindowId);
    } else if (activeWindowId && !windows.some(window => window.id === activeWindowId)) focusRemaining();
  }
  async function prepareServiceSource(source) {
    if (!serviceSources.owns(source) || !serviceSources.current(source)) return false;
    if (source.windowId === null) { focusDesktop(); return serviceSources.owns(source); }
    return await focusKeyboardWindow(source.windowId) && serviceSources.current(source);
  }
  async function showServiceFileInfo(source) {
    const snapshot = captureWindowPreparation(), before = new Set(windows.map(window => window.id)), windowIds = [];
    const preparation = { appId: 'finder', windowId: null, snapshot, createdIds: [], source };
    servicePreparation = preparation;
    for (const file of source.files) {
      if (!serviceSources.current(source)) break;
      const result = await openDesktopUtility('desktop-info', file.fileId);
      const current = windows.find(window => window.id === activeWindowId && window.utilityKind === 'desktop-info' && window.fileId === file.fileId);
      if (current) preparation.windowId = current.id;
      preparation.createdIds = windows.filter(window => !before.has(window.id)).map(window => window.id);
      if (result.status !== 'applied') break;
      windowIds.push(result.target.windowId);
    }
    if (windowIds.length === source.files.length && serviceSources.current(source)
      && activeWindowId === windowIds.at(-1) && sceneCoreAvailable()) {
      finishServiceDestination(preparation);
      return { status: 'applied', target: { windowIds } };
    }
    await rollbackServiceDestination(preparation, source);
    return rejected('unavailable', 'The original file selection or native information utility changed during preparation.');
  }
  function serviceProviderValuesCurrent(provider) {
    return Boolean(provider.entry && Object.entries(provider.entry.fields).every(([field, value]) => {
      const node = provider.view.fieldNode(field);
      return node?.dataset.serviceEntryId === provider.entry.id && node.value === value;
    }));
  }
  async function executeServicePresentation(request) {
    const result = await commands.execute(request), windowId = request.target?.windowId;
    if (windowId) {
      serviceErrors[windowId] = result.status === 'rejected' ? result.error.message : null;
      if (result.status === 'rejected' && request.command === 'services.draft.set') {
        const provider = getServiceProvider(windowId), node = provider?.view.fieldNode(request.target.field);
        if (provider?.entry?.id === request.target.draftId && node?.dataset.serviceEntryId === request.target.draftId)
          node.value = provider.entry.fields[request.target.field];
      }
    }
    return result;
  }
  async function selectServiceSampleMessage(target, payload) {
    const frame = getServiceFrame(target.windowId, true), conversation = selectedMessageConversation(messagesState),
      item = conversation?.items[target.itemIndex], revision = sampleMessageRevision();
    if (frame?.window.appId !== 'messages' || !serviceSampleAvailable(target.windowId) || servicePending?.appId === 'messages')
      return rejected('stale_target', 'The requested sample text is not in the original foreground Messages window.');
    if (item?.kind !== 'text' || payload.end > item.text.length) return rejected('invalid_arguments', 'Use the actual sample text UTF-16 range.');
    await tick();
    const node = frame.element.querySelector(`[data-service-message-index="${target.itemIndex}"]`);
    if (!node?.isConnected || node.textContent !== item.text || !getServiceFrame(target.windowId, true)
      || selectedMessageConversation(messagesState) !== conversation || sampleMessageRevision() !== revision)
      return rejected('unavailable', 'The original sample text is not rendered.');
    node.focus({ preventScroll: true });
    const selection = globalThis.getSelection(), text = node.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) return rejected('unavailable', 'The sample text has no native text node.');
    selection.setBaseAndExtent(text, payload.direction === 'backward' ? payload.end : payload.start,
      text, payload.direction === 'backward' ? payload.start : payload.end);
    return { status: 'applied', target: { windowId: target.windowId, itemIndex: target.itemIndex, start: payload.start, end: payload.end } };
  }
  function retainedWindowOptions(window, extra = {}) {
    const entry = hasServices && !window.utilityKind && ['contacts', 'mail', 'messages'].includes(window.appId)
      ? communicationEntry(communicationsState, window.appId) : null;
    const messageWindow = hasMessages && !window.utilityKind && ['messages', 'teams'].includes(window.appId);
    return { recordId: entry?.id ?? null, fields: entry?.fields ?? null,
      messageConversationId: messageWindow ? messagesState.selectedConversationId : null,
      messageQuery: messageWindow ? messagesState.query : null,
      messageDraft: messageWindow ? messagesState.drafts.find(draft => draft.id === messagesState.selectedDraftId) ?? null : null,
      widgetScope: hasWidgets && !window.utilityKind && widgetDataApps.includes(window.appId)
        ? widgetDataScope(window.appId, systemState.widgets.selected) : null,
      computerName: hasAppleMenu && !window.utilityKind && window.appId === 'settings' && window.settingsPane === 'about'
        ? systemState.computerName : null, ...extra };
  }
  function serviceContextArea() { return desktopView?.contextArea() ?? { left: 0, top: 28, width: globalThis.innerWidth, height: Math.max(0, globalThis.innerHeight - 28) }; }
  function serviceContextMenu(event) {
    if (!servicesAvailable()) return;
    const node = event.target.closest?.('[data-notes-control],[data-service-field],[data-service-message-index]');
    if (!node) return;
    const source = serviceSources.physicalSource();
    if (source?.node !== node || !services.menuItems().length) return;
    event.preventDefault(); event.stopPropagation();
    commands.execute({ command: 'services.context.open', target: { appId: source.appId, sourceId: source.sourceId },
      payload: { x: event.clientX, y: event.clientY } });
  }
  function serviceOutside(event) {
    if (!hasServices || !foreground || disposed) return;
    if (serviceContext && !serviceContextView?.contains(event.target)) commands.execute({ command: 'services.context.close',
      target: { contextId: serviceContext.contextId }, payload: { restoreFocus: false } });
    if (serviceLookup && !serviceLookupView?.contains(event.target)) commands.execute({ command: 'services.lookup.close',
      target: { lookupId: serviceLookup.lookupId }, payload: { restoreFocus: false } });
  }
  function serviceKeydown(event) {
    if (!hasServices || event.defaultPrevented || event.isComposing) return;
    const lookup = serviceLookupView?.contains(event.target), context = serviceContextView?.contains(event.target);
    const provider = activeWindowId && serviceViews.get(activeWindowId)?.contains(event.target);
    if (!lookup && !context && !provider) return;
    const command = event.metaKey && !event.ctrlKey && !event.altKey;
    if (lookup && (event.key === 'Escape' || command && event.key.toLowerCase() === 'w')) {
      event.preventDefault(); event.stopImmediatePropagation();
      commands.execute({ command: 'services.lookup.close', target: { lookupId: serviceLookup.lookupId } }); return;
    }
    if (lookup && command && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopImmediatePropagation();
      commands.execute({ command: 'services.lookup.focus', target: { lookupId: serviceLookup.lookupId, control: 'query' } }); return;
    }
    if (provider && command && event.key.toLowerCase() === 'w') {
      event.preventDefault(); event.stopImmediatePropagation();
      commands.execute({ command: 'window.close', target: { windowId: activeWindowId } }); return;
    }
    if (provider && command && ['f', 'g', 'z', 'a', 'c', 'x', 'v'].includes(event.key.toLowerCase())) event.stopImmediatePropagation();
  }
  async function focusApplicationServiceBody(windowId, noteId = notesState.selectedId) {
    await tick(); await tick();
    if (!ownedTextSource({ windowId, noteId, control: 'body' })) return false;
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
  function ownedNotesWindow(windowId, requireForeground = true) {
    if (!hasEditWorkflows || !windowInteractionsAvailable() || requireForeground && (activeAppId !== 'notes' || activeWindowId !== windowId)
      || isAppHidden('notes') || pendingQuitAppIds.includes('notes')) return null;
    return windows.find(window => window.id === windowId && window.appId === 'notes' && !window.utilityKind
      && !window.minimized && (!requireForeground || windowPresented(window))) ?? null;
  }
  function ownedTextDocument(target, requireForeground = true) {
    const window = ownedNotesWindow(target.windowId, requireForeground), session = notesWorkspaceWindow(notesState, target.windowId);
    const note = window && session && visibleWorkspaceNotes(notesState, session).find(note => note.id === target.noteId && note.id === session.selectedId);
    const view = domainViews.get(target.windowId);
    return note && view?.available() && view.ownsNote(note) ? { window, note, session, view,
      revision: note.revision, value: noteWorkspaceText(note),
      readOnly: note.deletedAt !== null || note.lock && !note.lock.unlocked || note.collaboration.enabled && note.collaboration.permission === 'view' } : null;
  }
  function inputInteractionsAvailable() {
    return hasInput && windowInteractionsAvailable() && !utilityPreparation && !servicePreparation
      && !servicePending && !switching.switcher && !presentation.pairing;
  }
  function captureInputOwner() {
    const captured = menuBarState?.menuId ? getMenuReturnFocus?.() ?? captureSessionDesktop() : captureSessionDesktop();
    const original = inputController.getReturnFocus(captured.focus?.node) ?? captured;
    return { ...original, appId: activeAppId, windowId: activeWindowId,
      window: windows.find(window => window.id === activeWindowId) ?? null };
  }
  function inputOwnerCurrent(original) {
    if (!original || disposed || activeAppId !== original.appId || activeWindowId !== original.windowId) return false;
    if (original.windowId === null) return original.window === null;
    const window = windows.find(window => window.id === original.windowId);
    return window === original.window && !window.minimized && !isAppHidden(window.appId)
      && !pendingQuitAppIds.includes(window.appId);
  }
  function captureInputEditor(original) {
    const node = original?.focus?.node, selection = original?.focus?.selection;
    if (!inputInteractionsAvailable() || !inputOwnerCurrent(original) || !node?.isConnected
      || !sceneRoot.contains(node) || node.disabled || node.readOnly || node.closest('[inert]')
      || !node.getClientRects().length || typeof node.selectionStart !== 'number'
      || !selection || selection.start < 0 || selection.start > selection.end || selection.end > node.value.length
      || original.focus.sourceValue !== node.value) return null;
    const control = node.dataset.notesControl, windowId = original.windowId;
    if (['title', 'body', 'search'].includes(control)) {
      const target = { windowId, control, ...(control !== 'search' ? { noteId: node.dataset.noteId } : {}) };
      const source = ownedTextSource(target);
      const revision = source?.note?.updatedAt ?? textEditing.targets().searchRevision;
      if (!source || source.readOnly || source.value !== node.value || original.focus.noteRevision !== revision) return null;
      return { kind: 'notes', original, node, target: { ...target, revision }, note: source.note,
        value: source.value, selection: { ...selection } };
    }
    const field = node.dataset.serviceField, provider = field && getServiceProvider(windowId);
    if (!provider?.editable || provider.pending || !provider.entry || provider.view.fieldNode(field) !== node
      || node.dataset.serviceEntryId !== provider.entry.id || provider.entry.fields[field] !== node.value
      || original.focus.serviceRevision !== provider.entry.revision) return null;
    return { kind: 'draft', original, node, entry: provider.entry, view: provider.view, field,
      revision: provider.entry.revision, value: node.value, selection: { ...selection } };
  }
  function inputEditorCurrent(editor) {
    if (!editor || !inputInteractionsAvailable() || !inputOwnerCurrent(editor.original)) return false;
    const node = editor.node, selected = editor.selection;
    if (!node?.isConnected || !sceneRoot.contains(node) || node.disabled || node.readOnly || node.closest('[inert]')
      || !node.getClientRects().length || node.value !== editor.value
      || node.selectionStart !== selected.start || node.selectionEnd !== selected.end
      || node.selectionDirection !== selected.direction) return false;
    if (editor.kind === 'notes') {
      const source = ownedTextSource(editor.target);
      return Boolean(source && !source.readOnly && source.note === editor.note && source.value === editor.value
        && (source.note?.updatedAt ?? textEditing.targets().searchRevision) === editor.target.revision);
    }
    const provider = getServiceProvider(editor.original.windowId);
    return Boolean(provider?.editable && !provider.pending && provider.entry === editor.entry
      && provider.view === editor.view && provider.entry.revision === editor.revision
      && provider.entry.fields[editor.field] === editor.value && provider.view.fieldNode(editor.field) === node);
  }
  function inputCanInsert(viewerId) {
    inputLeaseRevision;
    return inputController.targets().viewers.find(viewer => viewer.viewerId === viewerId)?.canInsert ?? false;
  }
  function inputViewerBounds(kind) {
    const width = Math.max(1, Math.min(kind === 'keyboard' ? 680 : 440, stageArea.width - 16));
    const height = Math.max(1, Math.min(kind === 'keyboard' ? 300 : 420, stageArea.height - 16));
    return { left: stageArea.width / 2,
      top: Math.min(stageArea.menuHeight + 8, Math.max(8, stageArea.height - height - 8)), width, height };
  }
  function sameInputEditor(left, right) {
    if (!left || !right || left.node !== right.node || left.kind !== right.kind || left.value !== right.value
      || left.original.window !== right.original.window || left.selection.start !== right.selection.start
      || left.selection.end !== right.selection.end || left.selection.direction !== right.selection.direction) return false;
    return left.kind === 'notes'
      ? left.note === right.note && left.target.windowId === right.target.windowId && left.target.noteId === right.target.noteId
        && left.target.control === right.target.control && left.target.revision === right.target.revision
      : left.entry === right.entry && left.view === right.view && left.field === right.field && left.revision === right.revision;
  }
  function inputDraftWritten(editor, revision, value) {
    const provider = getServiceProvider(editor.original.windowId);
    return inputInteractionsAvailable() && inputOwnerCurrent(editor.original)
      && provider?.entry?.id === editor.entry.id && provider.entry.revision === revision
      && provider.entry.fields[editor.field] === value && provider.view === editor.view
      && provider.view.fieldNode(editor.field) === editor.node && editor.node.value === value;
  }
  async function insertInputText(editor, { action, text }) {
    if (!inputEditorCurrent(editor)) return { result: rejected('stale_target', 'The original input viewer editor changed.') };
    let { start, end } = editor.selection;
    let inserted = action === 'newline' ? '\n' : action === 'backspace' ? '' : text;
    if (action === 'backspace' && start === end && start > 0) {
      const preceding = inputGraphemes.segment(editor.value).containing(start - 1);
      start = preceding.index;
      end = Math.max(end, preceding.index + preceding.segment.length);
    }
    let result;
    if (editor.kind === 'notes') {
      result = await textEditing.handlers['text.replace']({ ...editor.target, start, end }, { text: inserted, label: 'typing' });
    } else {
      const multiline = ['body', 'notes'].includes(editor.field);
      if (!multiline) inserted = inserted.replace(/[\r\n]/g, '');
      const value = editor.value.slice(0, start) + inserted + editor.value.slice(end);
      result = await handlers['services.draft.set']({ appId: editor.original.appId, windowId: editor.original.windowId,
        draftId: editor.entry.id, field: editor.field }, { value });
      if (result.status === 'applied') {
        await tick(); await tick();
        const revision = result.target.revision, caret = start + inserted.length;
        // The canonical draft writer replaces entities; its returned revision,
        // original facade and exact native node own this post-write selection.
        if (!inputDraftWritten(editor, revision, value)
          || !await editor.view.focus(editor.field, { start: caret, end: caret, direction: 'none' })
          || !inputDraftWritten(editor, revision, value)
          || editor.node.selectionStart !== caret || editor.node.selectionEnd !== caret)
          return { result, editor: null };
      }
    }
    if (result.status !== 'applied') return { result };
    // Notes records real undo; drafts commit their canonical revision. Both finish the native caret.
    // Refresh only that same node/owner, never whichever editor now has focus.
    if (!inputOwnerCurrent(editor.original) || document.activeElement !== editor.node) return { result, editor: null };
    const original = { ...editor.original, focus: captureNativeFocus() };
    return { result, original, editor: captureInputEditor(original) };
  }
  function ownedTextSource(target, requireForeground = true) {
    if (!ownedNotesWindow(target.windowId, requireForeground) || target.control !== 'editor') return null;
    const source = notesWorkspaceTextSource(notesState, target.windowId, domainViews.get(target.windowId));
    return source && (!target.noteId || source.note.id === target.noteId) ? source : null;
  }
  async function prepareOwnedText(target) {
    if (!ownedTextSource(target)) return false;
    const view = domainViews.get(target.windowId);
    return view.focus('editor') === true && Boolean(ownedTextSource(target));
  }
  async function finishOwnedTextSelection(target, range, revision) {
    await tick(); await tick();
    const source = ownedTextSource(target);
    if (!source || source.revision !== revision) return false;
    const native = notesPlaintextNativeSelection(source.note.document, range.start, range.end);
    return Boolean(native && domainViews.get(target.windowId).restoreSelection({ ...native, direction: range.direction ?? 'none' }));
  }
  function textSelectionTarget() {
    const token = menuBarState?.menuId ? getMenuReturnFocus?.()?.focus : null;
    const node = token?.node ?? document.activeElement;
    const windowId = node?.closest('[data-window-id]')?.dataset.windowId;
    if (!node?.isContentEditable) return null;
    const source = ownedTextSource({ windowId, control: 'editor' });
    if (!source || token && token.noteRevision !== source.revision) return null;
    const range = source.selection;
    if (!range || !Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)) return null;
    return { windowId, control: 'editor', noteId: source.note.id, revision: source.revision, start: range.start, end: range.end };
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
    return finishOwnedTextSelection({ windowId: target.windowId, noteId: target.noteId, control: 'editor' }, range, source.revision);
  }
  function editingTargets() {
    editingEpoch;
    const selection = textSelectionTarget(), source = selection && ownedTextSource(selection);
    const finderWindow = activeAppId === 'finder' && activeWindowId !== null ? { windowId: activeWindowId } : {};
    const tools = textTools.targets(), tool = nativeToolTarget(), native = nativeDraftTarget();
    const draftKey = tool ? tool.control === 'word' ? 'spelling:replacement' : `find:${tool.control}` : null;
    const draft = draftKey && tools.drafts.find(history => history.key === draftKey);
    const body = ownedTextSource({ windowId: activeWindowId, control: 'editor' });
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
    if (!selected || selected.control !== 'editor' || selected.windowId !== owner.windowId || selected.noteId !== owner.noteId) return null;
    return { ...owner, revision: selected.revision, start: selected.start, end: selected.end };
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
    const session = notesWorkspaceWindow(notesState, activeWindowId);
    const note = session && notesState.notes.find(note => note.id === session.selectedId);
    if (!note || note.lock && !note.lock.unlocked) return;
    const owner = { windowId: activeWindowId, noteId: note.id, revision: note.revision };
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
  function applicationMenuTargets() {
    return { preferences: { notes: { ...notesState.preferences } },
      panels: windows.filter(window => Object.hasOwn(APPLICATION_MENU_UTILITY_SIZES, window.utilityKind)).map(window => {
        const element = managedWindowElement(window.id)?.querySelector('[data-application-panel-scroll]');
        return { appId: window.appId, windowId: window.id, kind: window.utilityKind, available: Boolean(getWindowPanel(window.id)),
          controlIds: ['panel', ...[...(element?.querySelectorAll('[data-application-settings-control]') ?? [])]
            .map(control => control.dataset.applicationSettingsControl)],
          focusedControl: element?.contains(document.activeElement)
            ? document.activeElement === element ? 'panel' : document.activeElement.dataset.applicationSettingsControl ?? null : null,
          scroll: element ? { top: element.scrollTop, left: element.scrollLeft } : null };
      }) };
  }
  function recentDocument(file) { return file?.kind === 'document' || file?.kind === 'image'; }
  function availableServerFolder(server) {
    const folder = liveFile(macFiles, server.folderId);
    return server.available && folder?.kind === 'folder' && !isTrashed(macFiles, folder) ? folder : null;
  }
  async function openFictionalServer(serverId) {
    const server = systemState.servers.find(server => server.id === serverId);
    if (!server) return rejected('not_found', 'This account has no such fictional server.');
    const folder = availableServerFolder(server);
    if (!folder) return rejected('unavailable', 'This fictional server is offline or its backing virtual folder is missing or in Trash.');
    const historyUnits = systemRecentTextDelta(systemState, 'servers', serverId)
      + systemRecentTextDelta(systemState, 'applications', 'finder');
    const metadataUnits = !folder.readOnly && !Object.hasOwn(folder, 'lastOpenedAt') ? 'lastOpenedAt'.length : 0;
    if (workflowTextSize() + historyUnits + metadataUnits > 4 * 1024 * 1024)
      return rejected('limit_exceeded', 'Opening this fictional server exceeds the complete-scene history and text budget.');
    const result = await handlers['desktop.open']({ fileId: folder.id }, {});
    if (result.status !== 'applied') return result;
    recordSystemRecent(systemState, 'servers', serverId);
    return { status: 'applied', target: { serverId, folderId: folder.id, appId: 'finder', windowId: result.target.windowId } };
  }
  async function openRecentItem(category, itemId) {
    if (!systemState.recentItems[category].includes(itemId))
      return rejected('not_found', 'The item does not belong to this account’s current Recent Items history.');
    let result;
    if (category === 'applications') {
      if (workflowTextSize() + systemRecentTextDelta(systemState, 'applications', itemId) > 4 * 1024 * 1024)
        return rejected('limit_exceeded', 'Opening this application exceeds the complete-scene history and text budget.');
      result = await handlers['app.open']({ appId: itemId }, {});
    } else if (category === 'servers') result = await openFictionalServer(itemId);
    else {
      const file = liveFile(macFiles, itemId);
      if (!recentDocument(file) || isTrashed(macFiles, file))
        return rejected('unavailable', 'The recent document is no longer a live virtual document.');
      result = await handlers['desktop.open']({ fileId: itemId }, {});
    }
    return result.status === 'applied' ? { status: 'applied',
      target: { category, itemId, appId: result.target.appId, windowId: result.target.windowId } } : result;
  }
  function appleMenuContext() {
    const desktopAvailable = windowInteractionsAvailable() && !switching.switcher && !presentation.pairing;
    const heading = (id, label) => ({ id, label, heading: true, enabled: false });
    const applicationItems = systemState.recentItems.applications.map(appId => ({ id: `recent-app:${appId}`,
      label: applications[appId].name, enabled: desktopAvailable && !pendingQuitAppIds.includes(appId),
      request: { command: 'system.recents.open', target: { category: 'applications', itemId: appId } } }));
    const documentItems = systemState.recentItems.documents.map(id => liveFile(macFiles, id))
      .filter(file => recentDocument(file) && !isTrashed(macFiles, file)).map(file => ({
        id: `recent-document:${file.id}`, label: file.name, enabled: desktopAvailable,
        request: { command: 'system.recents.open', target: { category: 'documents', itemId: file.id } },
      }));
    const serverItems = systemState.recentItems.servers.map(id => systemState.servers.find(server => server.id === id))
      .filter(Boolean).map(server => ({ id: `recent-server:${server.id}`, label: server.name,
        enabled: desktopAvailable && Boolean(availableServerFolder(server)),
        request: { command: 'system.recents.open', target: { category: 'servers', itemId: server.id } } }));
    return { desktopAvailable, recentItems: [
      heading('recent-applications', 'Applications'),
      ...(applicationItems.length ? applicationItems : [{ id: 'no-recent-applications', label: 'No Recent Applications', enabled: false }]),
      { ...heading('recent-documents', 'Documents'), separatorBefore: true },
      ...(documentItems.length ? documentItems : [{ id: 'no-recent-documents', label: 'No Recent Documents', enabled: false }]),
      { ...heading('recent-servers', 'Servers'), separatorBefore: true },
      ...(serverItems.length ? serverItems : [{ id: 'no-recent-servers', label: 'No Recent Servers', enabled: false }]),
      { id: 'clear-recent-items', label: 'Clear Menu', separatorBefore: true,
        enabled: desktopAvailable && Object.values(systemState.recentItems).some(items => items.length),
        request: { command: 'system.recents.clear' } },
    ] };
  }
  function systemTargets() {
    return { machine: { ...profile.defaults.machine, computerName: systemState.computerName,
      profileId: profile.id, version: profile.version }, storage: systemStorage, runningAppIds: [...runningAppIds],
      reopenWindows: systemState.reopenWindows,
      storageManagement: $state.snapshot({ preferences: systemState.storage, inventory: storageManagement,
        confirmation: storageConfirmation, maintenanceError: storageMaintenanceError }),
      recentItems: $state.snapshot(systemState.recentItems),
      servers: systemState.servers.map(server => ({ ...server, available: Boolean(availableServerFolder(server)) })),
      forceQuitConfirmation: forceQuitPresentation(),
      panels: windows.filter(window => Object.hasOwn(SYSTEM_UTILITY_SIZES, window.utilityKind)
        || window.appId === 'systeminformation' && !window.utilityKind
        || window.appId === 'settings' && !window.utilityKind
          && ['about', 'displays', 'storage', 'wifi', 'battery', 'menu-bar', 'date-time', 'sound', 'bluetooth', 'keyboard', 'notifications'].includes(window.settingsPane)).map(window => {
        const entry = getSystemPanel(window.id), element = managedWindowElement(window.id)?.querySelector('[data-system-panel]');
        const controlIds = systemPanelControls(entry);
        return { windowId: window.id, appId: window.appId,
          kind: window.utilityKind ?? (window.appId === 'settings' ? `system-settings-${window.settingsPane}` : 'system-information'),
          available: Boolean(entry) && !utilityPreparation, controlIds,
          ...(controlIds.includes('version') ? { aboutBuildVisible: Boolean(window.aboutBuildVisible) } : {}),
          ...(window.appId === 'settings' && window.settingsPane === 'storage' ? { storageVolumesVisible: Boolean(window.storageVolumesVisible) } : {}),
          ...(window.appId === 'settings' && window.settingsPane === 'sound' ? { soundTab: window.soundTab } : {}),
          ...(window.appId === 'settings' && window.settingsPane === 'notifications' ? { selectedAppId: window.notificationAppId ?? 'messages' } : {}),
          ...(window.utilityKind === 'system-force-quit' ? { selectedAppId: window.forceQuitSelectedAppId } : {}),
          focusedControl: element?.contains(document.activeElement)
            ? document.activeElement === element ? 'panel' : document.activeElement.dataset.applicationSettingsControl ?? null : null,
          scroll: element ? { top: element.scrollTop, left: element.scrollLeft } : null };
      }), boundaries: { hostHardware: false, hostProcesses: false, localDocumentRecovery: true, fictionalServers: true,
        hostDisplayConfiguration: false, hostDiskInspection: false, warrantyLookup: false, repairBooking: false } };
  }
  function cancelStorageConfirmation(windowId) {
    if (storageConfirmation?.windowId === windowId) { storageConfirmation = null; storageConfirmationLease = null; }
  }
  function storageFingerprint(fileIds) {
    const wanted = new Set(fileIds), byId = new Map(macFiles.files.map(file => [file.id, file]));
    const rows = [...storageManagement.browserRows, ...storageManagement.categories.find(category => category.id === 'trash').rows];
    return JSON.stringify(rows.filter(row => wanted.has(row.fileId) || row.ancestorIds.some(id => wanted.has(id))).map(row => {
      const file = byId.get(row.fileId);
      return [file.id, file.parentId, file.name, file.revision, file.deleted, file.inCloud ?? false, file.localResident ?? true];
    }).sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
  }
  function requestStorageConfirmation(window, action, fileIds) {
    const rows = new Map([...storageManagement.browserRows,
      ...storageManagement.categories.find(category => category.id === 'trash').rows].map(row => [row.fileId, row]));
    const selected = new Set(fileIds), roots = fileIds.filter(id => !rows.get(id).ancestorIds.some(parent => selected.has(parent)));
    const candidate = { ...macFiles, files: macFiles.files.map(file => file.readOnly ? file : { ...file }) };
    const result = action === 'trash' ? trashStorageFiles(candidate, roots) : purgeStorageFiles(candidate, roots);
    if (result.status !== 'applied') return result;
    if (!Number.isSafeInteger(nextStorageConfirmation) || nextStorageConfirmation >= Number.MAX_SAFE_INTEGER - 1)
      return rejected('limit_exceeded', 'The private confirmation identity budget is exhausted.');
    storageConfirmationLease = storageFingerprint(roots);
    storageConfirmation = { confirmationId: `storage-confirmation-${window.id}-${nextStorageConfirmation++}`,
      windowId: window.id, action, fileIds: roots, names: roots.map(id => rows.get(id).name) };
    return { status: 'applied', target: { confirmationId: storageConfirmation.confirmationId,
      windowId: window.id, action, fileIds: [...roots] } };
  }
  function respondStorageConfirmation(accept) {
    const pending = storageConfirmation;
    if (!accept) {
      cancelStorageConfirmation(pending.windowId);
      return { status: 'applied', target: { confirmationId: pending.confirmationId, windowId: pending.windowId, accepted: false, fileIds: [] } };
    }
    if (storageFingerprint(pending.fileIds) !== storageConfirmationLease)
      return rejected('stale_target', 'The exact confirmed subtree changed; cancel and review the current files.');
    const result = storageTransaction(store => pending.action === 'trash'
      ? trashStorageFiles(store, pending.fileIds) : purgeStorageFiles(store, pending.fileIds));
    if (result.status !== 'applied') return result;
    cancelStorageConfirmation(pending.windowId);
    return { status: 'applied', target: { confirmationId: pending.confirmationId, windowId: pending.windowId,
      accepted: true, fileIds: result.target.fileIds } };
  }
  function queueClockPumps(sceneTime) {
    clockPumpWork = clockPumpWork.then(async () => {
      if (disposed || sharedClockWriter.getSceneTime() !== sceneTime) return;
      const run = async (key, controller, method) => {
        if (typeof controller?.[method] !== 'function' || disposed) return;
        let result;
        try {
          const actual = await controller[method](sceneTime);
          result = actual?.status ? actual : { status: actual?.ok === false ? 'rejected' : 'applied' };
        } catch (cause) {
          result = rejected('unavailable', cause?.message ?? 'The original authored clock source failed.');
        }
        if (!disposed) sceneRuntime.record(`${key}.${method}`, result, { appId: key === 'calls'
          ? macDesktop ? 'facetime' : 'teams' : nativeDomainDefinitions[key]?.appIds(profile)[0] ?? key });
      };
      await run('calls', domainControllers.get(macDesktop ? 'facetime' : 'teams-call'), 'advance');
      await run('calendar', domainControllers.get('calendar'), 'clockChanged');
      await run('reminders', domainControllers.get('reminders'), 'clockChanged');
      await run('mail', domainControllers.get('mail'), 'pulse');
      for (const key of ['clockApp', 'stocks', 'home']) await run(key, nativeControllers.get(key), 'clockChanged');
      await run('backup', nativeControllers.get('backup'), 'onTimeChanged');
    });
  }
  function setCanonicalSceneDate(date, guard) {
    const now = sharedClockWriter.getSceneTime(), zone = calendarState.preferences.timeZone;
    const sceneTime = calendarTimestamp(`${date}T${calendarLocalString(now, zone).slice(11)}`, zone) + now % 60000;
    return setClockSceneTime(sceneTime, { guard }).status === 'applied';
  }
  function setClockSceneTime(sceneTime, ownership = {}) {
    if (!Number.isSafeInteger(sceneTime) || sceneTime < 0 || sceneTime > 8_640_000_000_000_000 - 1)
      return rejected('invalid_arguments', 'Use a bounded explicit authored scene timestamp.');
    const guard = ownership.guard ?? (() => !disposed), original = sharedClockWriter.getSceneTime();
    const reserve = ownership.reserveTextUnits ?? 0;
    if (guard() !== true) return rejected('stale_target', 'The original scene clock owner changed.');
    if (sceneTime < original) return rejected('stale_time', 'The authored application timeline cannot rewind.');
    if (!Number.isSafeInteger(reserve) || completeSceneStringUnits() + reserve > 4 * 1024 * 1024)
      return rejected('limit_exceeded', 'The paired clock transaction exceeds the complete scene budget.');
    if (sharedClockWriter.getSceneTime() !== original || guard() !== true)
      return rejected('stale_target', 'The original authored scene time changed.');
    if (ownership.onCommit && ownership.onCommit(sceneTime) !== true)
      return rejected('stale_target', 'The paired actor refused the authored clock update.');
    if (messagesState && profile.family !== 'windows' && messagesState.preferences.keepMessages !== 'forever') {
      const candidate = copyCanonicalData(messagesState);
      expireMessages(candidate, sceneTime);
      const validation = validateMessagesState(candidate, profile);
      if (!validation.ok) throw new Error(`The authored Messages expiry produced invalid state: ${validation.message}`);
      applyCanonicalData(messagesState, candidate);
    }
    if (macDesktop) macFiles.sceneTime = sceneTime;
    else { windowsSceneTime = sceneTime; desktopFileStore.sceneTime = sceneTime; }
    queueClockPumps(sceneTime);
    return { status: 'applied', target: { sceneTime } };
  }
  function storageTransaction(operation, maintenanceIncluded = false) {
    const before = macFiles.files, originalIds = new Set(before.map(file => file.id));
    const candidate = { files: before.map(file => file.readOnly ? file : { ...file }), nextFileId: macFiles.nextFileId, sceneTime: macFiles.sceneTime };
    const preferences = { ...systemState.storage };
    let result;
    try { result = operation(candidate, preferences); }
    catch (error) {
      if (error instanceof RangeError) return rejected('limit_exceeded', error.message);
      throw error;
    }
    if (result.status !== 'applied') return result;
    if (!canReplaceWorkflowFiles(candidate.files)) return rejected('limit_exceeded', 'The complete scene text budget cannot hold this storage metadata.');
    const retainedIds = new Set(candidate.files.map(file => file.id));
    const removedIds = [...originalIds].filter(id => !retainedIds.has(id));
    const current = new Map(before.map(file => [file.id, file]));
    const changedIds = candidate.files.filter(file => {
      const original = current.get(file.id);
      return original && (file.revision !== original.revision || file.deleted !== original.deleted
        || file.inCloud !== original.inCloud || file.localResident !== original.localResident);
    }).map(file => file.id);
    if (removedIds.length || changedIds.length) finderEditing?.invalidateFiles([...removedIds, ...changedIds]);
    const next = candidate.files.map(file => {
      const original = current.get(file.id);
      if (!original || file.readOnly) return file;
      if (!Object.hasOwn(file, 'deletedAt')) delete original.deletedAt;
      Object.assign(original, file); return original;
    });
    macFiles.files = next; macFiles.sceneTime = candidate.sceneTime;
    Object.assign(systemState.storage, preferences);
    if (removedIds.length) {
      const removed = new Set(removedIds);
      for (const window of [...windows]) if (removed.has(window.fileId)) closeWindow(window.id);
      for (const entry of Object.values(closedWindows)) if (removed.has(entry.window.fileId)) {
        delete entry.window.fileId; entry.window.title = applications[entry.window.appId].name;
      }
      for (const fileId of removedIds) delete desktopState.positions[fileId];
      clipboardState.fileIds = clipboardState.fileIds.filter(fileId => !removed.has(fileId));
      if (hasSpotlight) systemState.spotlight.excludedFolderIds = systemState.spotlight.excludedFolderIds.filter(id => !removed.has(id));
    }
    reconcileFinderLocations(before);
    const liveIds = new Set(liveMacFileRecords(macFiles).map(file => file.id));
    desktopState.selectedFileIds = desktopState.selectedFileIds.filter(id => liveIds.has(id));
    if (!liveIds.has(desktopState.selectionAnchorId)) desktopState.selectionAnchorId = desktopState.selectedFileIds[0] ?? null;
    if (desktopState.rename && !liveIds.has(desktopState.rename.fileId)) desktopState.rename = null;
    editingEpoch++; storageMaintenanceClock = maintenanceIncluded ? macFiles.sceneTime : null;
    reconcileStorageViews();
    return result;
  }
  function runStorageMaintenance() {
    const preferences = systemState.storage;
    if (!preferences.storeInCloud && !preferences.optimizeStorage && !preferences.emptyTrashAutomatically) { storageMaintenanceError = null; return; }
    if (storageMaintenanceClock === macFiles.sceneTime) return;
    const result = storageTransaction((store, prefs) => ({ status: 'applied', target: maintainStorage(store, prefs) }));
    storageMaintenanceClock = macFiles.sceneTime;
    storageMaintenanceError = result.status === 'rejected' ? result.error.message : null;
  }
  function reconcileStorageViews() {
    for (const window of [...windows, ...Object.values(closedWindows).map(entry => entry.window)]) if (window.storageView) {
      const view = window.storageView;
      if (view.scope === 'file-browser' && !storageManagement.browserRows.some(row => row.fileId === view.folderId && row.canNavigate)) view.folderId = 'disk';
      const visible = new Set(storageRows(storageManagement, view).map(row => row.fileId));
      view.selectedFileIds = view.selectedFileIds.filter(id => visible.has(id));
    }
    if (storageConfirmation && (!windows.some(window => window.id === storageConfirmation.windowId && window.settingsPane === 'storage')
      || storageConfirmation.fileIds.some(id => !macFiles.files.some(file => file.id === id)))) cancelStorageConfirmation(storageConfirmation.windowId);
  }
  async function revealStorageFile(windowId, fileId) {
    const file = liveFile(macFiles, fileId);
    if (!file) return rejected('not_found', 'The exact storage record is no longer live.');
    const result = await handlers['desktop.open']({ fileId: file.parentId }, {});
    if (result.status !== 'applied') return result;
    const selected = await handlers['finder.selection.set']({ windowId: result.target.windowId }, { fileIds: [fileId] });
    return selected.status === 'applied' ? { status: 'applied', target: { windowId, fileId, finderWindowId: result.target.windowId } } : selected;
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
    return foreground && !fileDialogState.current && !wifiPresentation.join && !batteryPresentation.options && !clockPresentation.options && !clockPresentation.editor && !bluetoothPresentation.pair && !spaceState.overview && !launchpadState.view && !dashboardOpen && !window.minimized && !switching.switcher && !desktopState.dock?.appWindows
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
    const serviceSource = hasServices ? serviceSources.physicalSource() : null;
    const serviceEntry = node.dataset?.serviceEntryId && communicationEntry(communicationsState, activeAppId, node.dataset.serviceEntryId);
    return { node, selector, windowId: node.closest('[data-window-id]')?.dataset.windowId,
      ...(['title', 'body'].includes(node.dataset?.notesControl) ? { noteId: node.dataset.noteId } : {}),
      ...(hasEditWorkflows ? { toolPanel: node.closest('[data-text-panel-kind]')?.dataset.textPanelKind } : {}),
      ...(draft ? { nativeDraft: { ownerId: draft.ownerId, surface: draft.surface, control: draft.control } } : {}),
      ...(serviceEntry ? { serviceEntryId: serviceEntry.id, serviceAppId: activeAppId, serviceRevision: serviceEntry.revision } : {}),
      ...(serviceSource?.itemIndex !== undefined ? { serviceSample: { itemIndex: serviceSource.itemIndex, start: serviceSource.start,
        end: serviceSource.end, value: serviceSource.value, revision: serviceSource.revision,
        direction: serviceSources.sampleRange(serviceSource.node)?.direction ?? 'forward' } } : {}),
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
      if (token?.serviceEntryId) {
        const entry = communicationEntry(communicationsState, token.serviceAppId);
        if (entry?.id !== token.serviceEntryId || entry.revision !== token.serviceRevision
          || original?.dataset.serviceEntryId !== token.serviceEntryId || original.value !== token.sourceValue) return false;
      }
      if (token?.serviceSample) {
        const saved = token.serviceSample, item = selectedMessageConversation(messagesState)?.items[saved.itemIndex];
        if (!hasServices || activeWindowId !== token.windowId || item?.kind !== 'text' || item.text !== saved.value
          || sampleMessageRevision() !== saved.revision) return false;
        const result = await selectServiceSampleMessage({ windowId: token.windowId, itemIndex: saved.itemIndex },
          { start: saved.start, end: saved.end, direction: saved.direction });
        return result.status === 'applied';
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
    // Session Lock/fast switching can interrupt a root-native service queue.
    // Capture the committed source presentation, never its private candidate.
    if (servicePreparation) return servicePreparation.snapshot.returnFocus;
    if (utilityPreparation) return utilityPreparation.snapshot.returnFocus;
    const scroll = [];
    for (const node of sceneRoot.querySelectorAll('*')) {
      if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)
        scroll.push({ node, top: node.scrollTop, left: node.scrollLeft });
    }
    return { focus: services?.getReturnFocus() ?? helpViewer?.getReturnFocus() ?? captureNativeFocus(), scroll };
  }
  async function restoreSessionDesktop(snapshot) {
    const focused = await restoreNativeFocus(snapshot?.focus);
    for (const { node, top, left } of snapshot?.scroll ?? [])
      if (node.isConnected && sceneRoot.contains(node)) node.scrollTo({ top, left, behavior: 'instant' });
    await tick();
    return focused;
  }
  // Notes and Services commit edits into their canonical scene records. A
  // rejected/pending native edit or export must be resolved before sign-out.
  function canLeaveScene() {
    if (disposed || !initialized || utilityPreparation || servicePreparation || servicePending || widgetOpening
      || presentation.pairing || bluetoothPresentation.pair || fileDialogState.current || pendingQuitAppIds.length) return false;
    if (hasBattery) {
      const percentage = sceneRoot.querySelector('[data-battery-control="show-percentage"]');
      const energyMode = sceneRoot.querySelector('[data-battery-control="show-energy-mode"]');
      const lowPower = sceneRoot.querySelector('[data-application-settings-control="low-power-mode"]');
      const visible = sceneRoot.querySelector('[data-application-settings-control="battery-visible"]');
      if (percentage && percentage.checked !== systemState.battery.showPercentage
        || energyMode && energyMode.value !== systemState.battery.showEnergyMode
        || lowPower && lowPower.value !== systemState.battery.lowPowerMode
        || visible && visible.checked !== systemState.battery.showInMenuBar) return false;
    }
    if (hasClock) {
      for (const [control, key] of [['show-date', 'showDate'], ['show-day-of-week', 'showDayOfWeek'], ['show-ampm', 'showAMPM'], ['show-seconds', 'showSeconds']]) {
        const node = sceneRoot.querySelector(`[data-clock-control="${control}"]`);
        if (node && (typeof systemState.clock[key] === 'boolean' ? node.checked : node.value) !== systemState.clock[key]) return false;
      }
      for (const style of ['digital', 'analog']) {
        const node = sceneRoot.querySelector(`[data-clock-control="style-${style}"]`);
        if (node && node.checked !== (systemState.clock.style === style)) return false;
      }
      const hour = sceneRoot.querySelector('[data-application-settings-control="clock-24-hour"]');
      const zone = sceneRoot.querySelector('[data-application-settings-control="clock-time-zone"]');
      const local = sceneRoot.querySelector('[data-clock-time-control="local-datetime"]');
      if (hour && hour.checked !== systemState.clock.use24Hour
        || zone && zone.value !== systemState.clock.timeZone
        || local && local.value !== clockPresentation.editor?.localDateTime) return false;
    }
    if (hasSound) {
      const summary = soundController.summary();
      for (const node of sceneRoot.querySelectorAll('[data-application-settings-control="sound-volume"], [data-menu-item-id="sound-volume"]'))
        if (!node.disabled && Number(node.value) !== summary.volume) return false;
      const mute = sceneRoot.querySelector('[data-application-settings-control="sound-mute"]');
      const gain = sceneRoot.querySelector('[data-application-settings-control="sound-input-gain"]');
      const visible = sceneRoot.querySelector('[data-application-settings-control="sound-visible"]');
      const mode = sceneRoot.querySelector('[data-application-settings-control="sound-show-when"]');
      if (mute && !mute.disabled && mute.checked !== summary.muted || gain && !gain.disabled && Number(gain.value) !== summary.inputGain
        || visible && visible.checked !== summary.showInMenuBar || mode && mode.value !== summary.showWhen) return false;
      for (const node of sceneRoot.querySelectorAll('[data-sound-media-control="volume"]')) {
        const player = node.closest('[data-sound-player]');
        const window = windows.find(window => window.id === player?.dataset.windowId);
        if (window && !node.disabled && Number(node.value) !== systemState.sound.appVolumes[window.appId]) return false;
      }
    }
    if (hasBluetooth) {
      const power = sceneRoot.querySelector('[data-application-settings-control="bluetooth-power"]');
      const visible = sceneRoot.querySelector('[data-application-settings-control="bluetooth-show-in-menu-bar"]');
      if (power && power.checked !== systemState.bluetooth.powered
        || visible && visible.checked !== systemState.bluetooth.showInMenuBar) return false;
    }
    for (const node of sceneRoot.querySelectorAll('[data-system-computer-name], [data-service-field]')) {
      if (node.disabled || node.readOnly) continue;
      if (node.hasAttribute('data-system-computer-name')) {
        if (node.value !== systemState.computerName) return false;
      } else {
        const entry = communicationsState.drafts.find(entry => entry.id === node.dataset.serviceEntryId);
        if (!entry) return false;
        const value = entry.fields[node.dataset.serviceField];
        if (node.value === value) continue;
        const rendered = node.tagName === 'TEXTAREA' ? value.replace(/\r\n?/g, '\n') : value.replace(/[\r\n]/g, '');
        if (node.value !== rendered) return false;
      }
    }
    return true;
  }
  async function leaveScene(reopenWindows) {
    if (!canLeaveScene()) return rejected('unavailable', 'Finish or cancel pending exports, application quit/window pairing, or uncommitted native input before leaving this scene.');
    clearSwitchingPresentations();
    if (forceQuitConfirmation) cancelForceQuitConfirmation(forceQuitConfirmation.windowId);
    storageConfirmation = null;
    wifiController?.clear();
    batteryController?.clear();
    clockController?.clear();
    soundController?.clear();
    bluetoothController?.clear();
    inputController?.clear();
    spotlightController?.clear();
    notificationController?.clear();
    widgetController?.clear();
    if (!reopenWindows) {
      // Close real native views using their existing lifecycle; never replace
      // the document/files/communications models with startup seed data.
      while (windows.length) await closeWindow(windows[windows.length - 1].id);
      for (const appId of runningAppIds) applicationLifetimes.set(appId, null);
      runningAppIds = [profile.defaults.desktopAppId];
      switching.activationAppIds = [profile.defaults.desktopAppId];
      switching.activationWindowIds = [];
      switching.creationWindowIds = [];
      switching.hiddenAppIds = [];
      activeWindowId = null; activeAppId = profile.defaults.desktopAppId;
    }
    systemState.reopenWindows = reopenWindows;
    await settleCommands();
    return { status: 'applied' };
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
    if (!hasDockContext) return initialData.dock;
    return { pinnedAppIds: dock.pinnedAppIds, recentHistory: dock.recentHistory, usageSequence: dock.usageSequence,
      preferences: dock.preferences, folderFileIds: dock.folderFileIds, folderPreferences: dock.folderPreferences,
      mainOrderAppIds: dock.mainOrderAppIds.filter(id => dock.pinnedAppIds.includes(id)),
      secondaryOrderItemIds: dock.secondaryOrderItemIds.filter(id => dock.folderFileIds.some(fileId => dockFolderItemId(fileId) === id)) };
  }
  const persistentStringUnits = canonicalStringUnits;
  function completeSceneStringUnits() {
    return sharedMutationReserve + persistentStringUnits({ notes: notesState, messages: messagesState, browser: browserState,
      mail: mailState, contacts: contactsState, calendar: calendarState,
      calls: callsState, reminders: remindersState, nativeApplications,
      files: { files: desktopFileStore.files.filter(file => !file.readOnly), nextFileId: desktopFileStore.nextFileId,
        sceneTime: sharedClockWriter.getSceneTime() },
      clipboard: clipboardState, printing: printingState, editing: editingPreferences, viewing, communications: communicationsState,
      system: systemState, appearance: appearanceState, dock: desktopState.dock ?? null,
      windows, runningAppIds, pendingQuitAppIds, activeWindowId, activeAppId, switching, presentation,
      desktop: { ...desktopState, dock: null }, spaces: spaceState, closedWindows,
      documentDestinations, sceneEvents: sceneRuntime?.getSceneEvents() });
  }
  function fileWorkflowOtherTextSize() {
    return persistentStringUnits({ version: 1, notes: null, files: null, printing: null,
      editing: editingPreferences, viewing, messages: messagesState, ...(hasServices ? { communications: communicationsState } : {}),
      browser: browserState, mail: mailState, contacts: contactsState, calendar: calendarState,
      calls: callsState, reminders: remindersState,
      ...(hasAppleMenu ? { system: systemState } : {}),
      appearance: appearanceState, dock: persistentDockData() });
  }
  function workflowTextSize() {
    return completeSceneStringUnits();
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
      finderWindows: windows.filter(window => window.appId === 'finder' && !window.utilityKind)
        .map(window => viewWorkflows.finderForWindow(window.id)).filter(Boolean),
    };
  }
  async function performViewRequest(request) {
    if (!request) return;
    if (menuBarState?.menuId) await dismissMenuBar?.();
    await commands.execute(request);
  }
  function inputSourceKeydown(event) {
    if (!inputInteractionsAvailable() || event.defaultPrevented || event.isComposing
      || !event.ctrlKey || event.metaKey || event.shiftKey || ![' ', 'Spacebar'].includes(event.key)
      || !sceneRoot?.contains(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) commands.execute({ command: 'input.source.cycle', payload: { direction: event.altKey ? 'next' : 'last' } });
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
  function messagesMenuKeydown(event) {
    if (!macDesktop || !hasMessages || activeAppId !== 'messages' || !foreground || disposed
      || event.defaultPrevented || event.isComposing || !event.metaKey) return;
    if ((event.key === 'a' || event.key === 'A') && !event.shiftKey && !event.altKey && !event.ctrlKey
      && selectNativeEditableAll(event)) return;
    const key = event.key.toLowerCase();
    if (key === '0' && !event.altKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) void performEditRequest({ command: 'app.open', target: { appId: 'messages' }, payload: {} });
      return;
    }
    const window = messageWindow(activeWindowId);
    if (!window || !messageWindowAvailable(window)) return;
    const node = event.target;
    if (node?.closest?.('.messages-rich-panel, .messages-rich-confirmation')) return;
    const request = messagesMenuShortcut(event, sharedMenuProviders());
    if (!request) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) void performEditRequest(request);
  }
  function selectNativeEditableAll(event) {
    const node = event.target;
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)
      || document.activeElement !== node || node.disabled || node.readOnly
      || typeof node.selectionStart !== 'number' || !sceneRoot?.contains(node)) return false;
    event.preventDefault(); event.stopImmediatePropagation();
    node.setSelectionRange(0, node.value.length, 'forward');
    return true;
  }
  function editingKeydown(event) {
    if (!hasEditWorkflows || !foreground || disposed || event.defaultPrevented || event.isComposing) return;
    const original = menuBarState?.menuId ? getMenuReturnFocus?.()?.focus?.node : null;
    if (!sceneRoot?.contains(event.target) && !sceneRoot?.contains(original)) return;
    if (event.target?.closest?.('.notes-workspace') && !event.target.closest('[data-text-panel-kind]')) return;
    if (event.target?.closest?.('.messages-rich-panel, .messages-rich-confirmation')) return;
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
    if (itemId === 'select-all' && selectNativeEditableAll(event)) return;
    const request = editMenuRequest(itemId);
    if (!request) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) void performEditRequest(request);
  }
  function editingClipboardEvent(event) {
    if (!hasEditWorkflows || !foreground || disposed || event.defaultPrevented || !sceneRoot?.contains(event.target)) return;
    if (event.target.closest('.notes-workspace')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void performEditRequest(editMenuRequest(event.type));
  }
  function fileWorkflowKeydown(event) {
    if (event.defaultPrevented || event.isComposing || !(event.metaKey || event.ctrlKey)
      || event.altKey || !windowInteractionsAvailable()) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('[inert], [aria-modal="true"]')
      || (!sceneRoot.contains(target) && target !== document.body && target !== document.documentElement)) return;
    const key = event.key.toLowerCase();
    const window = windows.find(window => window.id === activeWindowId);
    let request;
    if (window?.appId === 'preview' && !window.utilityKind && !event.shiftKey && ['o', 'p', 's'].includes(key)) {
      request = { command: `preview.${key === 'o' ? 'open.picker' : key === 'p' ? 'print' : 'save'}`,
        target: { windowId: window.id }, payload: {} };
    }
    else if (window?.appId === 'notes' && !window.utilityKind) return;
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
    else if (!request && !event.shiftKey && ['d', 'o', 'p', 's'].includes(key)) {
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
    messagesViewEpoch;
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
    const nativeMenuGroups = appId === 'safari' && active && !active.utilityKind
      ? browserMenuProvider({ state: browserState, profile, windowId: active.id, view: domainViews.get(active.id) })
      : appId === 'mail' && active
        ? mailMenuProvider({ state: mailState, profile, windowId: active.id, services: services?.menuItems() ?? [] })
        : appId === 'contacts' && active
          ? [['contacts', 'Contacts'], ['file', 'File'], ['edit', 'Edit'], ['view', 'View'], ['card', 'Card'], ['window', 'Window'], ['help', 'Help']]
            .map(([id, label]) => ({ id, label, items: contactsMenuProvider({ state: contactsState, profile, windowId: active.id, menuId: id }) }))
          : appId === 'calendar' && active
            ? calendarMenuProvider({ state: calendarState, profile, windowId: active.id, services: services?.menuItems() ?? [],
              edits: domainViews.get(active.id)?.editAvailability?.(), history: domainViews.get(active.id)?.editAvailability?.() })
            : null;
    const nativeMenus = nativeMenuGroups?.map(group => {
      const menuId = ['app', 'mail', 'contacts', 'calendar'].includes(group.id) ? 'application' : group.id;
      return { menuId, kind: menuId, label: group.label, appId, enabled, items: group.items };
    });
    const commandMenus = appId === 'messages' && hasMessages ? messagesAppMenuProviders({
      profile, state: messagesState, windowId: active?.id,
      available: Boolean(enabled && active && messageWindowAvailable(active) && messagesViews.get(active.id)?.available()),
      editing: active ? messagesController.editingAvailability(active.id) : null, clipboard: clipboardState,
    }) : nativeMenus ?? appCommandMenuProviders({ profile, appId, enabled, activeWindow: active,
      ...(hasEditWorkflows ? { editing: editingTargets() } : {}),
      ...(hasViewWorkflows ? { viewing: {
        finder: finderWindow && viewWindowAvailable(finderWindow.id) ? viewWorkflows.finderForWindow(finderWindow.id) : null,
        desktop: { available: appId === 'finder' && (!active || active.utilityKind === 'desktop-view-options'),
          sortBy: desktopState.sortBy, stacks: desktopState.stacks,
          optionsWindowId: windows.find(window => window.utilityKind === 'desktop-view-options')?.id ?? null },
      } } : {}),
      notes: appId === 'notes' ? notesState : null,
      finder: appId === 'finder' ? { windowId: finderWindow?.id ?? null, folderId: finderFolder?.id ?? null,
        writable: Boolean(finderFolder && !finderFolder.readOnly && finderFolder.id !== 'trash'),
        childIds: finderFolder ? liveMacFileRecords(macFiles).filter(file => file.parentId === finderFolder.id || finderDesktop && file.id === 'disk').map(file => file.id) : [],
        selected: finderFolder ? liveMacFileRecords(macFiles).filter(file => finderIds.includes(file.id)
          && (file.parentId === finderFolder.id || finderDesktop && file.id === 'disk')) : [] } : null });
    if (fileDraftMenusAvailable()) for (const menu of commandMenus) menu.enabled = menu.menuId === 'edit' && running;
    const representedApplicationMenu = commandMenus.find(menu => menu.menuId === 'application' || menu.menuId === appId);
    const applicationItems = goldenApplicationMenuItems({ state: switching, profile, appId, runningAppIds, pendingQuitAppIds,
      services: services?.menuItems() ?? [] });
    const representedWindowItems = commandMenus.find(menu => menu.menuId === 'window')?.items ?? [];
    const representedWindowItem = id => representedWindowItems.find(item => item.id === id);
    const providers = [
      { menuId: 'application', kind: 'application', label: app?.name ?? '', appId,
        enabled,
        items: representedApplicationMenu?.enabled
          ? appId === 'messages'
            ? [...representedApplicationMenu.items,
              ...applicationItems.filter(item => !['about', 'preferences'].includes(item.id))]
            : [...representedApplicationMenu.items, ...applicationItems.filter(item =>
              (appId === 'safari' ? !['about', 'preferences', 'quit', 'separator-quit'].includes(item.id)
                : appId === 'contacts' ? !['about', 'preferences'].includes(item.id) : item.id === 'services')
              && !representedApplicationMenu.items.some(row => row.id === item.id))]
          : applicationItems },
      ...commandMenus.filter(menu => !['application', 'help', 'window', appId].includes(menu.menuId)),
      { menuId: 'window', kind: 'window', label: 'Window', appId, enabled, items: [
        ...representedWindowItems.filter(item => !['close', 'minimize', 'zoom'].includes(item.id) && item.request?.command !== 'window.focus'),
        representedWindowItem('close') ?? { id: 'close', label: 'Close', shortcut: '⌘W', enabled: Boolean(active), request: request('window.close') },
        representedWindowItem('minimize') ?? { id: 'minimize', label: 'Minimize', shortcut: '⌘M', enabled: ordinary,
          request: request('window.setMinimized', active, { minimized: true }) },
        representedWindowItem('zoom') ?? { id: 'zoom', label: 'Zoom', enabled: ordinary,
          request: request('window.setZoomed', active, { zoomed: !active?.zoomed }) },
        ...(profile.renderer === 'golden-gate' ? [{ id: 'move-resize', label: 'Move & Resize', enabled: ordinary, children: [
          { id: 'fill', label: 'Fill', shortcut: 'fn ⌃F', enabled: ordinary && !active?.zoomed,
            request: request('window.setZoomed', active, { zoomed: true }) },
          { id: 'restore', label: 'Return to Previous Size', shortcut: 'fn ⌃R', enabled: ordinary && Boolean(active?.zoomed),
            request: request('window.setZoomed', active, { zoomed: false }) },
        ] }] : []),
        ...(profile.renderer === 'golden-gate' ? [{ id: 'full-screen-tile', label: 'Full Screen Tile', enabled: managedOrdinary, children: [
          { id: 'entire-screen', label: 'Entire Screen', enabled: ordinary,
            request: request('window.setFullScreen', active, { fullScreen: true }) },
          { id: 'left-screen', label: 'Left of Screen', enabled: managedOrdinary,
            request: request('window.splitView.begin', active, { side: 'left' }) },
          { id: 'right-screen', label: 'Right of Screen', enabled: managedOrdinary,
            request: request('window.splitView.begin', active, { side: 'right' }) },
          { id: 'exit-full-screen', label: 'Exit Full Screen', enabled: managedOrdinary && active.fullScreen,
            request: request('window.setFullScreen', active, { fullScreen: false }) },
        ] }] : []),
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
      ...(hasWifi ? [wifiController.menuProvider(windowInteractionsAvailable() && !utilityPreparation
        && !servicePreparation && !servicePending && !switching.switcher && !presentation.pairing)] : []),
      ...(hasBattery ? [batteryController.menuProvider(windowInteractionsAvailable() && !utilityPreparation
        && !servicePreparation && !servicePending && !switching.switcher && !presentation.pairing)] : []),
      ...(hasClock ? [clockController.menuProvider(windowInteractionsAvailable() && !utilityPreparation
        && !servicePreparation && !servicePending && !switching.switcher && !presentation.pairing)] : []),
      ...(hasSound ? [soundController.menuProvider(windowInteractionsAvailable() && !utilityPreparation
        && !servicePreparation && !servicePending && !switching.switcher && !presentation.pairing)] : []),
      ...(hasBluetooth ? [bluetoothController.menuProvider(windowInteractionsAvailable() && !utilityPreparation
        && !servicePreparation && !servicePending && !switching.switcher && !presentation.pairing)] : []),
      ...(hasInput ? [inputController.menuProvider(inputInteractionsAvailable())] : []),
    ];
    return hasMenuBar ? providers : helpMenuProviders(providers, legacyMessagesMenu, profile);
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
    if (hasAppleMenu) { runStorageMaintenance(); reconcileStorageViews(); }
    async function sceneReady() {
      await tick();
      const result = await startup;
      return !disposed && initialized && result?.status === 'applied';
    }
    const unregister = registerCommands({ ...commands, ready: sceneReady });
    const unregisterSession = registerSessionScene?.({
      persist: captureSavedScene,
      canSave: () => !disposed && !presentation.pairing && !fileDialogState.current && pendingQuitAppIds.length === 0,
      canLeave: canLeaveScene, leave: leaveScene, reopenWindows: () => systemState.reopenWindows,
      clock: () => clockContext,
      capture: captureSessionDesktop, restore: restoreSessionDesktop,
      menuProviders: sharedMenuProviders, menusAvailable: sharedMenusAvailable, appleMenuContext,
      captureMenuAction,
      prepareMenus: () => clearSwitchingPresentations(false, true), restoreMenus: restoreSwitchingPresentations,
      ready: sceneReady,
    });
    const stopScene = adapter.startScene?.(nativeState, commands.execute);
    // Retained scenes keep their DOM, but only the foreground desktop receives
    // global input. Session-native controls have their own command/focus owner.
    function listen(target, type, handler, capture = false) {
      const listener = event => {
        // Private overlays own their keyboard controls, not app accelerators.
        // Keep the existing global input-source and application-switching keys.
        if (type === 'keydown' && event.target?.closest?.('[data-spotlight-id], [data-notification-center-id], [data-widget-editor-id]')
          && ![spotlightKeydown, inputSourceKeydown, switchingKeydown].includes(handler)) return;
        if (foreground && !event.target?.closest?.('[data-session-control], [data-session-control-root], [data-session-menu], [data-session-surface]')) handler(event);
      };
      target.addEventListener(type, listener, capture);
      return () => target.removeEventListener(type, listener, capture);
    }
    const stopListeners = [
      listen(window, 'keydown', messagesMenuKeydown, true),
      listen(window, 'keydown', spotlightKeydown, true),
      listen(document, 'pointerdown', spotlightOutside, true),
      listen(document, 'pointerdown', notificationOutside, true),
      listen(window, 'keydown', serviceKeydown, true),
      listen(window, 'keydown', event => helpView?.keydown(event), true),
      listen(sceneRoot, 'contextmenu', serviceContextMenu, true),
      listen(document, 'pointerdown', serviceOutside, true),
      listen(window, 'keydown', launchpadKeydown, true),
      listen(window, 'keydown', dashboardKeydown, true),
      listen(window, 'keydown', spacesKeydown, true),
      listen(window, 'keydown', fullScreenKeydown, true),
      listen(window, 'keydown', inputSourceKeydown, true),
      listen(window, 'keydown', viewKeydown, true),
      listen(window, 'keydown', editingKeydown, true),
      listen(sceneRoot, 'beforeinput', observeTextBeforeInput, true),
      listen(sceneRoot, 'input', observeDraftInput, true),
      listen(sceneRoot, 'select', observeNativeSelection, true),
      listen(sceneRoot, 'focusin', observeNativeSelection, true),
      listen(sceneRoot, 'copy', editingClipboardEvent, true),
      listen(sceneRoot, 'cut', editingClipboardEvent, true),
      listen(sceneRoot, 'paste', editingClipboardEvent, true),
      // Application handlers consume their own Save/Open/Print chords first.
      listen(window, 'keydown', fileWorkflowKeydown),
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
    const notificationTimer = hasNotifications ? setInterval(() => {
      if (notificationNativeAvailable() && !notificationPane && notificationUi.banners.length)
        void commands.execute({ command: 'notifications.banner.advance', payload: { milliseconds: 250 } });
    }, 250) : null;
    return () => {
      disposed = true; stopScene?.(); unregister(); unregisterSession?.();
      viewWorkflows?.dismissOptions();
      helpViewer?.dispose();
      services?.dispose(); serviceSources?.dispose();
      wifiController?.clear();
      batteryController?.clear();
      clockController?.clear();
      soundController?.clear();
      bluetoothController?.clear();
      inputController?.dispose();
      spotlightController?.dispose(); spotlightViews.clear();
      notificationController?.dispose(); notificationViews.clear(); notificationBannerViews.clear();
      widgetController?.dispose(); widgetEditorViews.clear(); widgetDataViews.clear();
      for (const stop of stopListeners) stop();
      if (dashboardTimer !== null) clearInterval(dashboardTimer);
      if (printingTimer !== null) clearInterval(printingTimer);
      if (notificationTimer !== null) clearInterval(notificationTimer);
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

  function openWindow(appId, title, fresh = false, utilityKind, options = {}) {
    const app = utilityKind && Object.hasOwn(WINDOW_UTILITY_SIZES, utilityKind)
      ? { ...applications[appId], ...WINDOW_UTILITY_SIZES[utilityKind] } : applications[appId];
    if (!app || options.isCurrent && options.isCurrent() !== true) return null;
    const existing = !fresh && !utilityKind && windows.findLast(window => window.appId === appId && !window.utilityKind);
    if (existing) {
      unhideApplication(appId);
      if (fresh || !windows.some(window => window.appId === appId && !window.utilityKind)) cancelPairingForActivation(null);
      switching.switcher = null; if (!hasMenuBar) switching.appMenu = null;
      if (title !== undefined) existing.title = title;
      focusWindow(existing.id);
      if (hasDockContext) recordMacAppUse(desktopState.dock, appId);
      if (hasAppleMenu) recordSystemRecent(systemState, 'applications', appId);
      return existing.id;
    }
    if (options.isCurrent && options.isCurrent() !== true) return null;
    const id = options.restoreWindowId ?? windowNamespace + (nextWindowId === 1 && appId === profile.defaults.startupAppId
      ? appId : `${appId}-window-${nextWindowId}`);
    if (windows.some(window => window.id === id)) return null;
    const remembered = hasRetention && !fresh && !utilityKind ? closedWindows[appId] : null;
    const retainedBounds = remembered && (remembered.window.restoreBounds ?? remembered.window.bounds);
    const normal = retainedBounds ? fitRetainedBounds(retainedBounds, app, area, retainedBounds.scale) : null;
    let newWindow = $state({
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
      ...(hasSound && appId === 'settings' && !utilityKind ? { soundTab: remembered?.window.soundTab ?? 'output' } : {}),
      ...(hasNotifications && appId === 'settings' && !utilityKind ? { notificationAppId: remembered?.window.notificationAppId ?? 'messages' } : {}),
      ...(hasViewWorkflows && !utilityKind && appId === 'finder'
        ? { finderPresentation: remembered?.window.finderPresentation ?? finderPresentationDefaults(),
          finderBrowseMode: remembered?.window.finderBrowseMode
            ?? viewing.finder.folderViews[remembered?.window.folderId ?? 'desktop']?.mode ?? 'icons' } : {}),
    });
    const controller = domainControllerForWindow(newWindow);
    windows.push(newWindow);
    if (controller && controller.windowOpened(newWindow, options) === false) {
      const ownedIndex = windows.indexOf(newWindow);
      if (ownedIndex >= 0) windows.splice(ownedIndex, 1);
      return null;
    }
    unhideApplication(appId);
    cancelPairingForActivation(null);
    switching.switcher = null; if (!hasMenuBar) switching.appMenu = null;
    if (!options.restoreWindowId) nextWindowId++;
    if (!controller) adapter.createWindow?.(nativeState, id, appId, { fresh });
    if (hasRetention && !utilityKind) delete closedWindows[appId];
    if (remembered) pendingWindowViews.set(id, remembered.view);
    if (!runningAppIds.includes(appId)) {
      runningAppIds.push(appId);
      if (hasAppleMenu) applicationLifetimes.set(appId, id);
    }
    activeWindowId = id;
    activeAppId = appId;
    recordApplicationActivation(switching, appId, id, true);
    if (hasSpaces) spaceState.activeSpaceId = spaceState.lastDesktopId;
    if (hasDockContext) {
      recordMacAppUse(desktopState.dock, appId);
      dismissDockPresentation();
    }
    if (hasAppleMenu && !utilityKind) recordSystemRecent(systemState, 'applications', appId);
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

  async function closeWindow(id, ownership = {}) {
    const index = windows.findIndex(window => window.id === id);
    if (index < 0) return;
    const guard = ownership.guard ?? ownership.isCurrent;
    if (guard && guard() !== true) return false;
    const originalWindow = windows[index];
    const appId = windows[index].appId;
    const controller = domainControllerForWindow(windows[index]);
    const mergedBrowser = browserMergeRetirements.delete(originalWindow);
    if (!mergedBrowser && controller !== destinationCommands && controller?.windowClosed(originalWindow, ownership) === false) return false;
    const wasActive = activeWindowId === id, returnFocus = utilityReturnFocus.get(id);
    cancelForceQuitConfirmation(id);
    const appUtility = Object.hasOwn(WINDOW_UTILITY_SIZES, windows[index].utilityKind);
    utilityReturnFocus.delete(id);
    if (hasRetention) {
      const closed = windows[index];
      if (!closed.utilityKind && !windows.some(window => window.id !== id && window.appId === appId && !window.utilityKind)) {
        closedWindows[appId] = {
          window: { ...$state.snapshot(closed), minimized: false, fullScreen: false },
          view: captureRetainedView(managedWindowElement(id), retainedWindowOptions(closed, {
            focusElement: messagesViews.get(id)?.editSelection?.()?.node ?? document.activeElement,
          })),
        };
      }
      pendingWindowViews.delete(id);
    }
    const pair = presentation.splitViews.find(entry => entry.leftWindowId === id || entry.rightWindowId === id);
    const partnerId = pair && (pair.leftWindowId === id ? pair.rightWindowId : pair.leftWindowId);
    const partner = windows.find(window => window.id === partnerId && window.fullScreen
      && !window.minimized && !isAppHidden(window.appId) && !pendingQuitAppIds.includes(window.appId));
    windows.splice(index, 1);
    const destinationReturnFocus = destinationCommands.windowClosed(originalWindow);
    adapter.releaseWindow?.(nativeState, id, appId);
    if (!adapter.closeKeepsRunning && !windows.some(window => window.appId === appId)) {
      const runningIndex = runningAppIds.indexOf(appId);
      if (runningIndex >= 0) runningAppIds.splice(runningIndex, 1);
    }
    if (activeWindowId === id) {
      const sourceFocus = ownership.returnFocus ?? destinationReturnFocus;
      const sourceWindow = sourceFocus?.window;
      if (sourceWindow && typeof sourceFocus.guard === 'function' && sourceFocus.guard() === true
        && windows.find(window => window.id === sourceWindow.id) === sourceWindow && destinationWindowAvailable(sourceWindow))
        focusWindow(sourceWindow.id);
      else if (partner) await focusFullScreenWindow(partner.id);
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
    if (wasActive && appUtility && controller !== destinationCommands && sceneInteractionsAvailable() && !pendingQuitAppIds.includes(appId)) {
      const sourceWindow = returnFocus?.focus?.windowId;
      const sameNote = !returnFocus?.focus?.noteId || returnFocus.focus.noteId === notesState.selectedId;
      if (returnFocus && sameNote && (!sourceWindow || sourceWindow === activeWindowId)) await restoreSessionDesktop(returnFocus);
      else if (activeWindowId) await focusKeyboardWindow(activeWindowId);
      else await focusSceneWorkspace();
    }
    return true;
  }

  function cancelAppQuit(appId) {
    pendingQuitAppIds = pendingQuitAppIds.filter(entry => entry !== appId);
  }

  function currentForceQuitLease() {
    return forceQuitConfirmationLease !== null && forceQuitLeaseCurrent(forceQuitConfirmationLease,
      windows, applicationLifetimes.get(forceQuitConfirmationLease.appId), runningAppIds);
  }
  function forceQuitPresentation() {
    const pending = forceQuitConfirmation;
    return pending ? { confirmationId: pending.confirmationId, windowId: pending.windowId,
      appId: pending.appId, name: pending.name, action: pending.action, busy: pending.busy,
      stale: !currentForceQuitLease() } : null;
  }
  function cancelForceQuitConfirmation(windowId) {
    if (forceQuitConfirmation?.windowId !== windowId) return;
    forceQuitConfirmation = null;
    forceQuitConfirmationLease = null;
    forceQuitReturnControl = null;
  }
  async function requestForceQuit(appId, action) {
    if (forceQuitConfirmation) return rejected('unavailable', 'Resolve the existing Force Quit confirmation first.');
    if (!Number.isSafeInteger(nextForceQuitConfirmation) || nextForceQuitConfirmation >= Number.MAX_SAFE_INTEGER - 1)
      return rejected('limit_exceeded', 'The private confirmation identity budget is exhausted.');
    const lease = captureForceQuitLease(appId, action, windows, applicationLifetimes.get(appId));
    const chooser = windows.find(window => window.utilityKind === 'system-force-quit');
    const focused = document.activeElement;
    const returnControl = chooser && managedWindowElement(chooser.id)?.contains(focused)
      ? focused.dataset.applicationSettingsControl ?? `app:${appId}` : `app:${appId}`;
    const presentation = { confirmationId: `force-quit-confirmation-${forceQuitScope}-${nextForceQuitConfirmation++}`,
      appId, name: applications[appId].name, action, busy: false };
    const result = await openWindowPanel('finder', 'system-force-quit', 'Force Quit Applications', undefined,
      { lease, returnControl, presentation });
    if (result.status !== 'applied') return result;
    return { status: 'applied', target: { appId, windowId: result.target.windowId,
      confirmationId: presentation.confirmationId, confirmationRequired: true,
      ...(action === 'quit' ? { quit: false } : { relaunched: false }) } };
  }
  async function respondForceQuit(windowId, confirmationId, accept) {
    const pending = forceQuitConfirmation;
    if (!pending || pending.windowId !== windowId || pending.confirmationId !== confirmationId)
      return rejected('stale_target', 'The owned Force Quit confirmation no longer exists.');
    if (pending.busy || !getSystemPanel(windowId)) return rejected('unavailable', 'The owned Force Quit confirmation is not interactive.');
    if (accept && !currentForceQuitLease())
      return rejected('stale_target', 'The confirmed application lifetime or windows changed; cancel and review the current application.');
    const outcome = { windowId, confirmationId, appId: pending.appId, action: pending.action,
      accepted: accept, performed: false, openedWindowId: null };
    const returnControl = forceQuitReturnControl;
    if (accept) {
      pending.busy = true;
      const result = pending.action === 'relaunch' ? await relaunchFinder() : await quitApplication(pending.appId, true);
      if (result.status !== 'applied') {
        if (forceQuitConfirmation === pending) pending.busy = false;
        return result;
      }
      outcome.performed = true;
      if (pending.action === 'relaunch') outcome.openedWindowId = result.target.windowId;
    }
    cancelForceQuitConfirmation(windowId);
    await tick(); await tick();
    const entry = getSystemPanel(windowId);
    if (entry && activeWindowId === windowId) {
      const control = accept ? `app:${entry.window.forceQuitSelectedAppId}` : returnControl;
      if (systemPanelControls(entry).includes(control)) await focusWindowPanel(entry, control);
      else await focusWindowPanel(entry, 'panel');
    }
    return { status: 'applied', target: outcome };
  }

  async function quitApplication(appId, force = false, ownership = {}) {
    if (ownership.guard && ownership.guard() !== true)
      return rejected('stale_target', 'The original application quit owner changed.');
    if (quitInFlight.has(appId)) return rejected('unavailable', 'Application quit is already being processed.');
    if (!pendingQuitAppIds.includes(appId)) pendingQuitAppIds.push(appId);
    quitInFlight.add(appId);
    try {
      const forceAction = force && appId === profile.defaults.desktopAppId ? 'relaunch' : 'quit';
      let window;
      while (!disposed && (window = windows.findLast(entry => force
        ? forceQuitWindowTarget(entry, appId, forceAction) : entry.appId === appId))) {
        if (ownership.guard && ownership.guard() !== true)
          return rejected('stale_target', 'The original application quit owner changed.');
        const result = force ? (await closeWindow(window.id, { ...ownership, discard: true }), { status: 'applied' })
          : await handlers['window.close']({ windowId: window.id }, {});
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
      if (!(force && appId === profile.defaults.desktopAppId)) {
        const runningIndex = runningAppIds.indexOf(appId);
        if (runningIndex >= 0) runningAppIds.splice(runningIndex, 1);
        if (hasAppleMenu) applicationLifetimes.set(appId, null);
      }
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
      return force
        ? { status: 'applied', target: { appId, quit: true, confirmationRequired: false } }
        : { status: 'applied', target: { appId }, quit: true, confirmationRequired: false };
    } finally {
      quitInFlight.delete(appId);
    }
  }
  async function relaunchFinder() {
    const chooser = windows.find(window => window.utilityKind === 'system-force-quit');
    const result = await quitApplication('finder', true);
    if (result.status !== 'applied') return result;
    const windowId = openWindow('finder');
    applicationLifetimes.set('finder', windowId);
    await tick(); await tick();
    if (chooser && windows.includes(chooser)) {
      focusWindow(chooser.id);
      const entry = getSystemPanel(chooser.id);
      if (entry) await focusWindowPanel(entry, 'app:finder');
    } else if (sceneCoreAvailable()) await focusKeyboardWindow(windowId);
    return { status: 'applied', target: { appId: 'finder', relaunched: true, windowId } };
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
        ? fitRetainedBounds(previous, windowApplication(window), area, previous.scale)
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
      retainedWindowOptions(window, { focus: foreground && !disposed && window.id === activeWindowId
        && document.activeElement === document.body }));
    return { status: 'applied', target: {} };
  }

  async function captureSavedScene(previousFocus) {
    await settleCommands();
    const focusElement = sceneRoot.contains(document.activeElement) ? document.activeElement : previousFocus;
    const dock = desktopState.dock;
    const { activationAppIds, activationWindowIds, creationWindowIds, hiddenAppIds } = switching;
    const { desktops, order, activeSpaceId, lastDesktopId, nextDesktopId } = spaceState;
    const { selectedFileIds, selectionAnchorId, positions, sortBy, viewOptions } = desktopState;
    const stacks = desktopState.stacks;
    return $state.snapshot({
      seed: { ...nativeApplications, version: 1, notes: notesState,
        files: { files: desktopFileStore.files.filter(file => !file.readOnly),
          nextFileId: desktopFileStore.nextFileId, sceneTime: sharedClockWriter.getSceneTime() },
        messages: messagesState, appearance: appearanceState ?? initialData.appearance,
        browser: browserSessionSnapshot(browserState), mail: mailState, contacts: contactsState, calendar: calendarState,
        calls: callsState, reminders: remindersState,
        printing: printingState, editing: editingPreferences ?? initialData.editing, viewing: viewing ?? initialData.viewing,
        communications: communicationsState ?? initialData.communications, system: systemState, dock: persistentDockData() },
      catalogTimes: macDesktop ? Object.fromEntries(macFiles.files.filter(file => file.readOnly).map(file =>
        [file.id, { createdAt: file.createdAt, modifiedAt: file.modifiedAt, addedAt: file.addedAt, lastOpenedAt: file.lastOpenedAt }])) : {},
      fileOrder: desktopFileStore.files.map(file => file.id),
      dockOrder: { mainOrderAppIds: dock?.mainOrderAppIds ?? [], secondaryOrderItemIds: dock?.secondaryOrderItemIds ?? [] },
      windows, closedWindows,
      ...adapter.snapshotWindows?.(nativeState, windows, profile),
      views: Object.fromEntries(windows.map(window => [window.id, captureRetainedView(managedWindowElement(window.id),
        retainedWindowOptions(window, { focusElement }))])),
      nextWindowId, activeWindowId, activeAppId, runningAppIds,
      switching: { activationAppIds, activationWindowIds, creationWindowIds, hiddenAppIds },
      spaces: { desktops, order, activeSpaceId, lastDesktopId, nextDesktopId }, splitViews: presentation.splitViews,
      desktop: { selectedFileIds, selectionAnchorId, positions, sortBy, viewOptions,
        ...(stacks ? { stacks: { enabled: stacks.enabled, groupBy: stacks.groupBy, sortBy: stacks.sortBy,
          expandedStackIds: stacks.expandedStackIds, topFileIds: stacks.topFileIds } } : {}) },
    });
  }
</script>

{#snippet managedWindow(window, active, zIndex, presentationBounds, interactive, visible, preview = false)}
      <Window
        {window}
        {active}
        {zIndex}
        {presentationBounds}
        {interactive}
        {visible}
        nativeChrome={macDesktop && !window.utilityKind && domainControllers.has(window.appId) ? 'application'
          : profile.family === 'windows' && window.appId === 'teams' && !window.utilityKind && nativeState.apps.teams.ui.surface === 'mini' ? 'teams-mini' : 'standard'}
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
        onmaximize={() => profile.family === 'windows' && window.appId === 'teams' && nativeState.apps.teams.ui.surface === 'mini'
          ? commands.execute({ command: 'win11.teams.surface.set', target: { windowId: window.id }, payload: { surface: 'full' } })
          : toggleWindowMaximize(window.id)}
        onmove={(x, y) => windowCommand('window.move', window.id, { x, y })}
        resizable={interactive && hasWindowResize && !window[expandedProperty] && windowInteractionsAvailable()}
        onresize={(edge, coordinates) => windowCommand('window.resize', window.id, { edge, ...coordinates })}
      >
        {#if hasAppleMenu && window.utilityKind === 'system-about'}
          <GoldenGateAboutThisMac {profile} {window} execute={commands.execute} />
        {:else if hasAppleMenu && window.utilityKind === 'system-force-quit'}
          <GoldenGateForceQuit {profile} windowId={window.id} runningApps={runningAppIds.map(id => applications[id])}
            selectedAppId={window.forceQuitSelectedAppId}
            confirmation={forceQuitConfirmation?.windowId === window.id ? forceQuitPresentation() : null}
            execute={commands.execute} available={() => Boolean(getSystemPanel(window.id))} />
        {:else if hasAppleMenu && window.utilityKind === 'system-coverage'}
          <GoldenGateSystemCoverage {profile} windowId={window.id} sceneTime={macFiles.sceneTime} execute={commands.execute} />
        {:else if hasBattery && window.appId === 'settings' && !window.utilityKind && window.settingsPane === 'battery'}
          <GoldenGateBatterySettings {profile} {window} battery={systemState.battery} summary={batteryController.summary()}
            execute={commands.execute} registerView={registerApplicationView} />
        {:else if hasBattery && window.appId === 'settings' && !window.utilityKind && window.settingsPane === 'menu-bar'}
          <GoldenGateMenuBarSettings {profile} {window} battery={systemState.battery} summary={batteryController.summary()}
            clock={systemState.clock} clockSummary={clockController.summary()}
            {...(hasSound ? { sound: soundController.summary() } : {})}
            {...(hasBluetooth ? { bluetooth: bluetoothController.summary() } : {})}
            execute={commands.execute} registerView={registerApplicationView} />
        {:else if hasClock && window.appId === 'settings' && !window.utilityKind && window.settingsPane === 'date-time'}
          <GoldenGateDateTimeSettings {profile} {window} clock={systemState.clock} summary={clockController.summary()}
            execute={commands.execute} registerView={registerApplicationView} />
        {:else if hasSound && window.appId === 'settings' && !window.utilityKind && window.settingsPane === 'sound'}
          <GoldenGateSoundSettings {profile} {window} sound={soundController.summary()}
            execute={commands.execute} registerView={registerApplicationView} />
        {:else if hasBluetooth && window.appId === 'settings' && !window.utilityKind && window.settingsPane === 'bluetooth'}
          <GoldenGateBluetoothSettings {profile} {window} bluetooth={bluetoothController.summary()}
            execute={commands.execute} registerView={registerApplicationView} />
        {:else if hasInput && window.appId === 'settings' && !window.utilityKind && window.settingsPane === 'keyboard'}
          <GoldenGateInputSettings {profile} {window} input={inputController.summary()}
            execute={commands.execute} registerView={registerApplicationView} />
        {:else if hasSpotlight && window.appId === 'settings' && !window.utilityKind && window.settingsPane === 'spotlight'}
          <GoldenGateSpotlightSettings {profile} {window} preferences={systemState.spotlight} folders={spotlightPrivacyFolders()}
            execute={commands.execute} registerView={registerApplicationView} />
        {:else if hasNotifications && window.appId === 'settings' && !window.utilityKind && window.settingsPane === 'notifications'}
          <GoldenGateNotificationSettings {profile} {window} preferences={systemState.notifications.preferences}
            selectedAppId={window.notificationAppId ?? 'messages'} execute={commands.execute} registerView={registerApplicationView} />
        {:else if nativeDomainForWindow(profile, window)}
          {@const definition = nativeDomainForWindow(profile, window)}
          {@const NativeView = nativeDomainComponents[definition.componentForWindow?.(profile, window) ?? definition.component]}
          {@const context = nativeContexts.get(definition.key)}
          <NativeView state={definition.key === 'browser' ? browserState : nativeApplications[definition.key]}
            controller={nativeControllers.get(definition.key)}
            listFiles={context.listFiles} getFile={context.getFile} getShared={context.getShared}
            {profile} {window} windowId={window.id} available={!preview && domainWindowAvailable(window)}
            active={active && interactive} controls={domainWindowControls(window)}
            execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
            registerView={(id, view, original) => { if (!preview) registerDomainView(id, view, original); }}
            {...definition.extraProps?.({ context, controller: nativeControllers.get(definition.key),
              shared: nativeSharedSources(), executeEnvelope: commands.execute,
              registerView: (id, view, original) => { if (!preview) registerDomainView(id, view, original); } })} />
        {:else if hasWifi && window.appId === 'settings' && !window.utilityKind && window.settingsPane === 'wifi'}
          <GoldenGateWifiSettings {profile} {window} wifi={systemState.wifi}
            execute={commands.execute} registerView={registerApplicationView} />
        {:else if hasAppleMenu && window.appId === 'settings' && !window.utilityKind
          && (window.settingsPane === 'about' || window.settingsPane === 'displays' || window.settingsPane === 'storage')}
          <GoldenGateSystemAboutSettings {profile} {window} system={systemState} storage={systemStorage}
            inventory={storageManagement} confirmation={storageConfirmation} maintenanceError={storageMaintenanceError}
            execute={commands.execute} registerView={registerApplicationView} />
        {:else if hasAppleMenu && window.appId === 'systeminformation' && !window.utilityKind}
          <GoldenGateSystemInformation {profile} windowId={window.id} computerName={systemState.computerName} runningApps={runningAppIds.map(id => applications[id])} execute={commands.execute} />
        {:else if window.utilityKind === 'application-about'}
          <GoldenGateAboutApp application={applications[window.appId]} {profile} windowId={window.id} execute={commands.execute} />
        {:else if window.utilityKind === 'application-settings'}
          <GoldenGateNotesSettings preferences={notesState.preferences} windowId={window.id} execute={commands.execute} />
        {:else if ['document-print', 'document-picker', 'document-share'].includes(window.utilityKind)}
          <NativeDocumentDestination panel={documentDestinations.panels.find(panel => panel.windowId === window.id)}
            {profile} files={desktopFileStore.files} printing={printingState}
            execute={commands.execute}
            renderPage={destinationCommands.renderPage}
            registerView={(id, view, original) => { if (!preview) registerDomainView(id, view, original); }} />
        {:else if !window.utilityKind && window.appId === 'notes'}
          <NotesApp state={notesState} {profile} windowId={window.id} available={!preview && domainWindowAvailable(window)}
            getShared={getNativeShared} getFile={applicationFiles.getFile}
            active={active && interactive} controls={{ ...domainWindowControls(window), dark: appearanceState?.mode === 'dark', readFile: applicationFiles.readFile }}
            execute={commands.execute}
            registerView={(id, view, original) => { if (!preview) registerDomainView(id, view, original); }} />
        {:else if window.appId === 'facetime' && !window.utilityKind || window.utilityKind === 'teams-call'}
          <CallsApp state={callsState} {profile} windowId={window.id} available={!preview && domainWindowAvailable(window)}
            active={active && interactive} controls={domainWindowControls(window)}
            execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
            registerView={(id, view, original) => { if (!preview) registerDomainView(id, view, original); }} />
        {:else if !window.utilityKind && window.appId === 'reminders'}
          <RemindersApp state={remindersState} {profile} windowId={window.id} available={!preview && domainWindowAvailable(window)}
            active={active && interactive} controls={domainWindowControls(window)}
            execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
            registerView={(id, view, original) => { if (!preview) registerDomainView(id, view, original); }} />
        {:else if !window.utilityKind && (window.appId === 'safari' || window.appId === 'edge')}
          <BrowserApp state={browserState} {profile} windowId={window.id} getFile={applicationFiles.getFile} available={!preview && domainWindowAvailable(window)}
            active={active && interactive} controls={domainWindowControls(window)} embeddedMenus={!macDesktop}
            execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
            registerView={(id, view, original) => { if (!preview) registerDomainView(id, view, original); }}
            fullScreen={window.fullScreen} revealedTop={fullScreenStage.topRevealed} modernGreenMenu={modernMac} zoomed={window[expandedProperty]} />
        {:else if !window.utilityKind && window.appId === 'mail'}
          <MailApp state={mailState} {profile} windowId={window.id} available={!preview && domainWindowAvailable(window)}
            active={active && interactive} controls={domainWindowControls(window)} showLocalMenus={!macDesktop}
            execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
            registerView={(view, original) => { if (!preview) registerDomainView(window.id, view, original); }} />
        {:else if !window.utilityKind && window.appId === 'contacts'}
          <ContactsApp state={contactsState} {profile} windowId={window.id} available={!preview && domainWindowAvailable(window)}
            active={active && interactive} controls={domainWindowControls(window)} showLocalMenus={!macDesktop}
            execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
            registerView={(id, view, original) => { if (!preview) registerDomainView(id, view, original); }} />
        {:else if !window.utilityKind && window.appId === 'calendar'}
          <CalendarApp state={calendarState} {profile} windowId={window.id} available={!preview && domainWindowAvailable(window)}
            active={active && interactive} controls={domainWindowControls(window)} showLocalMenus={!macDesktop}
            execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
            registerView={(view, original) => { if (!preview) registerDomainView(window.id, view, original); }} />
        {:else if hasWidgets && !window.utilityKind && widgetDataApps.includes(window.appId)}
          <GoldenGateWidgetData windowId={window.id} appId={window.appId} state={systemState.widgets} clock={clockContext}
            foreground={!preview && widgetDataAvailable(window)} execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
            registerView={view => { if (!preview) { if (view) widgetDataViews.set(window.id, view); else widgetDataViews.delete(window.id); } }} />
        {:else if profile.family === 'windows' && window.appId === 'teams'}
          <Windows11Teams state={messagesState} native={nativeState.apps.teams} {profile} windowId={window.id}
            available={!preview && messageWindowAvailable(window)} active={active && interactive}
            resolveRecipients={messageRecipientChoices} resolveRecipient={resolveMessageRecipient}
            execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
            registerView={(view, original) => { if (!preview) registerMessagesView(window.id, view, original); }}
            registerApplicationView={(id, view) => preview ? undefined : registerApplicationView(id, view)} />
        {:else if Applications}
          <Applications appId={window.appId} windowId={window.id} {profile} native={adapter.nativeForWindow(nativeState, window.id)} execute={commands.execute} registerView={registerApplicationView} />
        {:else if window.appId === 'messages'}
          <MessagesWindow
            {clockContext}
            state={messagesState} {profile} windowId={window.id} available={!preview && messageWindowAvailable(window)}
            resolveRecipients={messageRecipientChoices} resolveRecipient={resolveMessageRecipient}
            execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
            registerView={(view, original) => { if (!preview) registerMessagesView(window.id, view, original); }}
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
        {:else if hasDockContext && window.appId === 'settings'}
          {#if hasAppearance && window.settingsPane === 'appearance'}
            <MacAppearancePreferences {profile} state={appearanceState} execute={commands.execute} />
            <div class="settings-pane-links">
              {#if hasAppleMenu}<button type="button" class="settings-pane-link" onclick={() => commands.execute({ command: 'system.settings.open', payload: { pane: 'about' } })}>General — About…</button>{/if}
              {#if hasNotifications}<button type="button" class="settings-pane-link" onclick={() => commands.execute({ command: 'notifications.settings.open' })}>Notifications…</button>{/if}
            </div>
          {:else if hasDashboard && window.settingsPane === 'mission-control'}
            <DashboardPreferences mode={dashboardState.mode} execute={commands.execute} />
            <div class="settings-pane-links">
              <button type="button" class="settings-pane-link" onclick={() => commands.execute({ command: 'appearance.preferences.open' })}>General…</button>
            </div>
          {:else}
            <MacDockPreferences {profile} preferences={desktopState.dock.preferences} execute={commands.execute} />
            <div class="settings-pane-links">
              {#if hasAppleMenu}<button type="button" class="settings-pane-link" onclick={() => commands.execute({ command: 'system.settings.open', payload: { pane: 'about' } })}>General — About…</button>{/if}
              {#if hasNotifications}<button type="button" class="settings-pane-link" onclick={() => commands.execute({ command: 'notifications.settings.open' })}>Notifications…</button>{/if}
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
    {@render managedWindow(window, false, 1, { x: (width - tileWidth) / 2, y: (height - tileHeight) / 2, width: tileWidth, height: tileHeight, scale: window.bounds.scale * scale }, false, true, true)}
  {/if}
{/snippet}

{#snippet legacyApplicationMenus()}
  {#if macDesktop && !hasMenuBar && representedMacMenuOwner()}
    <GoldenGateMenuBar {profile} menus={sharedMenuProviders()} state={legacyMessagesMenu} execute={commands.execute}
      {foreground} registerView={view => {
        for (const id of view.menuIds) legacyMenuViews.set(id, view);
        return () => { for (const id of view.menuIds) if (legacyMenuViews.get(id) === view) legacyMenuViews.delete(id); };
      }} />
  {/if}
{/snippet}

<div class="scene-root" data-session-scene data-profile-id={profile.id} bind:this={sceneRoot}>
<div class="desktop-interaction-root" inert={Boolean(wifiPresentation.join || batteryPresentation.options || clockPresentation.options || clockPresentation.editor || bluetoothPresentation.pair)}>
<Desktop
  {profile}
  {session}
  {executeSession}
  {registerSessionView}
  {menuBarState}
  {menuBarMenus}
  legacyApplicationMenus={representedMacMenuOwner() ? legacyApplicationMenus : undefined}
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
  {...(hasServices ? { contextMenuItems: getDesktopContextMenuItems() } : {})}
  {...(hasSpotlight ? { spotlightOpen: Boolean(spotlightPane), spotlightAvailable: spotlightInteractionsAvailable(), onspotlight: toggleSpotlight } : {})}
  {...(hasNotifications ? { notificationCenterId: notificationPane?.centerId ?? null,
    notificationCenterAvailable: notificationInteractionsAvailable(), onnotifications: toggleNotifications } : {})}
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
    {#if !window.minimized || projection || hasSound && !window.utilityKind && ['music', 'quicktime'].includes(window.appId)}
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
  {#if serviceLookup}
    <div class="service-lookup-placement">
      <GoldenGateServiceLookup pane={serviceLookup} execute={commands.execute} {area} registerView={registerServiceLookupView}
        available={id => services.lookupAvailable(id)} />
    </div>
  {/if}
  {#if serviceContext}
    <GoldenGateServicesContext context={serviceContext} items={services.contextItems()} execute={commands.execute}
      area={serviceContextArea()} registerView={registerServiceContextView} available={id => services.contextAvailable(id)} />
  {/if}
  {#if helpPane}
    <div class="help-placement" style:top="4px" style:height={`${Math.max(1, Math.min(500, area.height - 8))}px`}>
      <GoldenGateHelpViewer {profile} pane={helpPane} execute={commands.execute} {foreground} bind:this={helpView} />
    </div>
  {/if}
</Desktop>
</div>
  {#if hasInput}
    {@const viewerAvailable = inputInteractionsAvailable()}
    {@const keyboardBounds = inputPresentation.keyboard && inputViewerBounds('keyboard')}
    {@const characterBounds = inputPresentation.characters && inputViewerBounds('characters')}
    <!-- Short stages need reachable title controls above the bar, but never above an open menu/modal. -->
    {@const layer = viewerAvailable && !menuBarState?.menuId
      && (characterBounds || keyboardBounds)?.top < stageArea.menuHeight ? 22000 : 12000}
    {#each [inputPresentation.keyboard, inputPresentation.characters].filter(Boolean) as pane (pane.viewerId)}
      {@const bounds = pane.kind === 'keyboard' ? keyboardBounds : characterBounds}
      <div class="input-placement" style:left="{bounds.left}px" style:top="{bounds.top}px"
        style:width="{bounds.width}px" style:height="{bounds.height}px"
        style:z-index={layer + (inputPresentation.activeKind === pane.kind ? 200 : 100)}>
        <GoldenGateInputViewer {profile} {pane} input={inputController.summary()} execute={commands.execute}
          foreground={viewerAvailable} active={inputPresentation.activeKind === pane.kind}
          canInsert={inputCanInsert(pane.viewerId)} bind:this={inputViewerViews[pane.kind]} />
      </div>
    {/each}
  {/if}
  {#if hasSpotlight && spotlightPane}
    {@const spotlightId = spotlightPane.spotlightId}
    {@const bounds = spotlightBounds()}
    <div class="spotlight-placement" style:left={`${bounds.left}px`} style:top={`${bounds.top}px`}
      style:width={`${bounds.width}px`} style:height={`${bounds.height}px`}
      style:visibility={!spotlightInteractionsAvailable() || spotlightPane.busy ? 'hidden' : undefined}>
      <GoldenGateSpotlight pane={spotlightPane} foreground={spotlightInteractionsAvailable()}
        previewResource={spotlightController.previewResource(spotlightPane.preview?.previewId)}
        execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
        registerView={view => { if (view) spotlightViews.set(spotlightId, view); else spotlightViews.delete(spotlightId); }} />
    </div>
  {/if}
  {#if hasNotifications && notificationPane}
    {@const centerId = notificationPane.centerId}
    <div class="notification-placement" style:top={`${stageArea.menuHeight + 8}px`}
      style:width={`${Math.max(1, Math.min(360, stageArea.width - 16))}px`}
      style:height={`${Math.max(1, stageArea.height - stageArea.menuHeight - 16)}px`}
      style:visibility={!notificationNativeAvailable() ? 'hidden' : undefined}>
      <GoldenGateNotificationCenter {profile} pane={notificationPane} groups={notificationController.groups()} clock={clockContext}
        {...(hasWidgets ? { widgetState: systemState.widgets, widgetUi } : {})}
        reminderWidgetProjection={reminderWidgetProjection(remindersState)} calendarWidgetProjection={calendarWidgetProjection(calendarState)}
        actionsFor={notificationController.actions} previewFor={notificationController.preview} itemUiFor={notificationController.itemUi}
        snoozeChoicesFor={notificationController.snoozeChoices}
        foreground={notificationNativeAvailable()} execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
        registerView={view => { if (view) notificationViews.set(centerId, view); else notificationViews.delete(centerId); }} />
    </div>
  {/if}
  {#if hasNotifications}
    {#each notificationUi.banners.slice(0, 1) as banner (banner.bannerId)}
      {@const entry = systemState.notifications.entries.find(value => value.id === banner.notificationId)}
      {#if entry}
        <div class="notification-banner-placement" style:top={`${stageArea.menuHeight + 8}px`}
          style:width={`${Math.max(1, Math.min(360, stageArea.width - 16))}px`}
          style:max-height={`${Math.max(1, stageArea.height - stageArea.menuHeight - 16)}px`}
          style:visibility={!notificationNativeAvailable() || notificationPane ? 'hidden' : undefined}>
          <GoldenGateNotificationBanner {profile} {banner} {entry} app={profile.applications[entry.appId]}
            actions={notificationController.actions(entry)} showPreview={notificationController.preview(entry)}
            snoozeChoices={notificationController.snoozeChoices(entry)}
            itemUi={notificationController.itemUi(entry)} foreground={notificationNativeAvailable() && !notificationPane}
            execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
            registerView={(view, original) => registerNotificationBannerView(banner.bannerId, view, original)} />
        </div>
      {/if}
    {/each}
  {/if}
  {#if hasWidgets && widgetUi.editor && notificationPane}
    {@const editorId = widgetUi.editor.editorId}
    {@const bounds = widgetGalleryBounds()}
    <div class="widget-gallery-placement" style:left={`${bounds.left}px`} style:top={`${bounds.top}px`}
      style:width={`${bounds.width}px`} style:height={`${bounds.height}px`}
      style:visibility={!notificationNativeAvailable() ? 'hidden' : undefined}>
      <GoldenGateWidgetGallery editor={widgetUi.editor} state={systemState.widgets} clock={clockContext}
        reminderWidgetProjection={reminderWidgetProjection(remindersState)} calendarWidgetProjection={calendarWidgetProjection(calendarState)}
        foreground={notificationNativeAvailable()} execute={(command, target = {}, payload = {}) => commands.execute({ command, target, payload })}
        registerView={view => { if (view) widgetEditorViews.set(editorId, view); else widgetEditorViews.delete(editorId); }} />
    </div>
  {/if}
{#if hasWifi && wifiPresentation.join}
  <div class="status-sheet-backdrop">
    <GoldenGateWifiJoin pending={wifiPresentation.join} execute={commands.execute} {foreground} bind:this={wifiJoinView} />
  </div>
{/if}
{#if hasBluetooth && bluetoothPresentation.pair}
  <div class="status-sheet-backdrop">
    <GoldenGateBluetoothPair pending={bluetoothPresentation.pair} execute={commands.execute} {foreground} bind:this={bluetoothPairView} />
  </div>
{/if}
{#if hasBattery && batteryPresentation.options}
  <div class="status-sheet-backdrop">
    <GoldenGateBatteryOptions pending={batteryPresentation.options} battery={systemState.battery}
      execute={commands.execute} {foreground} bind:this={batteryOptionsView} />
  </div>
{/if}
{#if hasClock && clockPresentation.options}
  <div class="status-sheet-backdrop">
    <GoldenGateClockOptions window={windows.find(window => window.id === clockPresentation.options.windowId)}
      clock={systemState.clock} options={clockPresentation.options} execute={commands.execute} {foreground} bind:this={clockOptionsView} />
  </div>
{/if}
{#if hasClock && clockPresentation.editor}
  <div class="status-sheet-backdrop">
    <GoldenGateClockTimeEdit window={windows.find(window => window.id === clockPresentation.editor.windowId)}
      clock={systemState.clock} summary={clockController.summary()} editor={clockPresentation.editor}
      execute={commands.execute} {foreground} bind:this={clockTimeView} />
  </div>
{/if}
</div>

<style>
  .scene-root { position: absolute; inset: 0; }
  .spotlight-placement { position:absolute; z-index:25000; transform:translateX(-50%); }
  .notification-placement { position:absolute; right:8px; z-index:25000; }
  .notification-banner-placement { position:absolute; right:8px; z-index:25010; display:flex; overflow:hidden; border-radius:22px; }
  .widget-gallery-placement { position:absolute; z-index:25100; border-radius:24px; overflow:hidden; border:1px solid var(--appearance-light-edge,#ffffff80); box-shadow:0 12px 45px #0004; }
  .desktop-interaction-root { height:100%; }
  .status-sheet-backdrop { position:absolute; inset:0; z-index:30000; display:flex; align-items:center; justify-content:center; box-sizing:border-box; padding:8px; background:#0003; overflow:hidden; }
  .help-placement { position:absolute; left:50%; transform:translateX(-50%); width:min(700px,calc(100% - 8px)); max-height:calc(100% - 8px); z-index:11500; display:flex; justify-content:center; }
  .input-placement { position:absolute; transform:translateX(-50%); display:flex; }
  .service-lookup-placement { position:absolute; top:4px; left:50%; transform:translateX(-50%); width:min(390px,calc(100% - 8px)); max-height:calc(100% - 8px); z-index:12000; display:flex; }
  .file-dialog-backdrop { position: absolute; inset: 0; z-index: 20000; display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: 8px; background: #0002; overflow: hidden; }
  .stage-backdrop { position: absolute; z-index: 1; background: black; pointer-events: none; }
  .split-divider { position: absolute; width: 4px; background: #171717; cursor: col-resize; touch-action: none; outline: none; }
  .split-divider:focus-visible { background: var(--appearance-focus, #5797dc); }
  .settings-pane-links { position: absolute; right: 20px; bottom: 12px; display: flex; gap: 8px; }
  .settings-pane-link { padding: 3px 12px; border: 1px solid var(--appearance-border, #aaa); border-radius: 4px; background: var(--appearance-card, #fafafa); color: var(--appearance-ink, #222); font: 12px var(--system-font); }
  .settings-pane-link:focus-visible { outline: 2px solid var(--appearance-focus, #2478d7); outline-offset: 2px; }
</style>

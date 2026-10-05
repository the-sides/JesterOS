<script>
  import { onMount, tick, untrack } from 'svelte';
  import { createFeatureCommands, rejected } from './feature-commands.js';
  import { createWindowCommands } from './window-commands.js';
  import { createApplicationCommands } from './application-commands.js';
  import { createDesktopCommands } from './desktop-commands.js';
  import { createDesktopItemCommands } from './desktop-item-commands.js';
  import { createDesktopContextCommands } from './desktop-context-commands.js';
  import { createDesktopStacksCommands } from './desktop-stacks-commands.js';
  import { desktopStacks as buildDesktopStacks, desktopStackLayout, desktopStacksDefaults, reconcileDesktopStacks } from './desktop-stacks-model.js';
  import { desktopViewDefaults, desktopContextItems, sortDesktopItems, readDesktopFileInfo, desktopFileSize } from './desktop-context-model.js';
  import { createMacDesktopFileStore, macDesktopItems, validMacDesktopName, nextMacFileTimestamp } from './desktop-file-state.js';
  import { createMacDockCommands } from './mac-dock-commands.js';
  import { macDockDefaults, macDockApps, macDockContextItems, macDockWindowCards } from './mac-dock-model.js';
  import { createMacApplicationFiles, applicationBundleId } from './mac-application-files.js';
  import MacDockAppWindows from './MacDockAppWindows.svelte';
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
  $effect(() => {
    if (!hasDockContext) return;
    const dock = desktopState.dock, pinned = new Set(dock.pinnedAppIds), running = new Set(runningAppIds);
    const order = dock.mainOrderAppIds.filter(id => pinned.has(id) || running.has(id));
    for (const app of dockApplications.main) if (!order.includes(app.id)) order.push(app.id);
    if (order.length !== dock.mainOrderAppIds.length || order.some((id, index) => id !== dock.mainOrderAppIds[index]))
      dock.mainOrderAppIds = order;
    if (dock.context && ![...dockApplications.main, ...dockApplications.recent].some(app => app.id === dock.context.appId)) dock.context = null;
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
    invoke: (command, target, payload) => handlers[command](target, payload),
    reveal: revealMacApplication, focusDock, restoreOverviewFocus,
    isQuitting: appId => pendingQuitAppIds.includes(appId),
    dismissAppMenus: clearNotesPresentation,
  }));
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
    isVisible: () => !desktopState.dock?.appWindows && windows.some((window) => window.appId === 'notes' && !window.minimized),
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
        context: desktopState.dock.context ? { ...desktopState.dock.context, scroll: { ...desktopState.dock.context.scroll } } : null,
        menuItems: getDockMenuItems(), menuBounds: desktopView?.dockMenuBounds() ?? [],
        appWindows: desktopState.dock.appWindows ? { ...desktopState.dock.appWindows, cards: dockWindowCards.map(card => ({ ...card, rect: { ...card.rect } })) } : null,
        bundles: macFiles.files.filter(file => file.bundleAppId).map(file => ({ appId: file.bundleAppId, fileId: file.id, folderId: file.parentId })),
      } } : {}),
      windows: windows.map((window) => ({
        windowId: window.id, appId: window.appId, minimized: window.minimized, [expandedProperty]: window[expandedProperty],
        bounds: { ...window.bounds },
        ...(window.folderId ? { folderId: window.folderId } : {}),
        ...(window.fileId ? { fileId: window.fileId } : {}),
        ...(window.utilityKind ? { utilityKind: window.utilityKind } : {}),
        ...(window.infoSections ? { infoSections: { ...window.infoSections } } : {}),
        ...(window.finderSelectedFileIds ? { selectedFileIds: [...window.finderSelectedFileIds] } : {}),
        ...(desktopState.dock?.appWindows ? { presentationVisible: Boolean(dockWindowBounds[window.id]),
          ...(dockWindowBounds[window.id] ? { overviewBounds: { ...dockWindowBounds[window.id] } } : {}) } : {}),
        resize: { available: hasWindowResize && !window.minimized && !window[expandedProperty] && windowInteractionsAvailable(), edges: resizeEdges, minimumSize: windowApplication(window).minimumSize },
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
    if (!windowInteractionsAvailable()) return undefined;
    return windows.some(window => window.id === windowId && !window.minimized)
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
    return macDockContextItems(profile, desktopState.dock, windows, runningAppIds, activeWindowId, pendingQuitAppIds);
  }
  async function focusDock(appId) {
    const current = [...dockApplications.main, ...dockApplications.recent].find(app => app.id === appId)
      ?? dockApplications.main[0];
    if (current) await handlers['desktop.focusControl']({ control: 'dock', appId: current.id }, {});
    else await handlers['desktop.focus']({}, {});
  }
  async function restoreOverviewFocus(appId) {
    const window = windows.find(window => window.id === activeWindowId && !window.minimized);
    if (window) await focusKeyboardWindow(window.id);
    else await focusDock(appId);
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
  function focusDesktop() {
    activeWindowId = null;
    activeAppId = profile.defaults.desktopAppId;
    if (hasDockContext) { desktopState.dock.context = null; desktopState.dock.appWindows = null; }
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
    desktopState.context = null;
    if (hasDockContext) { desktopState.dock.context = null; desktopState.dock.appWindows = null; }
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
    const existing = !fresh && windows.findLast(window => window.appId === appId && !window.utilityKind);
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
    if (hasDockContext) { desktopState.dock.context = null; desktopState.dock.appWindows = null; }
    if (hasDesktopStacks) desktopState.stacks.focusedStackId = null;
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

<Desktop
  {profile}
  {windows}
  {runningAppIds}
  {activeWindowId}
  {activeApp}
  viewState={desktopState}
  {desktopItems}
  {desktopDetails}
  {desktopStacks}
  {dockApplications}
  {dockMenuItems}
  native={nativeState}
  execute={commands.execute}
  registerView={registerDesktopView}
  onlayout={() => commands.execute({ command: 'desktop.refreshLayout' })}
>
  {#each windows as window, index (window.id)}
    {#if !window.minimized || dockWindowBounds[window.id]}
      <Window
        {window}
        active={activeWindowId === window.id}
        zIndex={dockWindowBounds[window.id] ? 7001 : index + 1}
        presentationBounds={dockWindowBounds[window.id]}
        interactive={!desktopState.dock?.appWindows}
        visible={!desktopState.dock?.appWindows || Boolean(dockWindowBounds[window.id])}
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
        {:else if window.utilityKind === 'desktop-info'}
          <MacDesktopInfo {profile} info={desktopDetails[window.fileId]} windowId={window.id} sections={window.infoSections} execute={commands.execute} />
        {:else if window.utilityKind === 'desktop-view-options'}
          <MacDesktopViewOptions {profile} options={desktopState.viewOptions} sortBy={desktopState.sortBy} stacks={desktopState.stacks} execute={commands.execute} />
        {:else if macDesktop && window.appId === 'finder'}
          <MacDesktopFolder {profile} windowId={window.id} folderId={window.folderId} files={macFiles.files} selectedFileIds={window.finderSelectedFileIds ?? []} execute={commands.execute} />
        {/if}
      </Window>
    {/if}
  {/each}
  {#if desktopState.dock?.appWindows}
    <MacDockAppWindows {profile} app={applications[desktopState.dock.appWindows.appId]} state={desktopState.dock.appWindows} cards={dockWindowCards} {area} execute={commands.execute} />
  {/if}
</Desktop>

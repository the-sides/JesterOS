<script>
  import { onMount, tick } from 'svelte';
  import GoldenGateIcon from './GoldenGateIcon.svelte';
  import './golden-gate.css';
  import { createDesktopItemInteractions, revealDesktopItem } from './desktop-item-interactions.js';
  import MacDesktopContextMenu from './MacDesktopContextMenu.svelte';
  import { desktopContextItems } from './desktop-context-model.js';
  import MacDesktopStack from './MacDesktopStack.svelte';
  import { desktopStackLayout } from './desktop-stacks-model.js';
  import MacDockContextMenu from './MacDockContextMenu.svelte';
  import { createMacDockView } from './mac-dock-view.js';
  import MacDock from './MacDock.svelte';
  import GoldenGateMenuBar from './GoldenGateMenuBar.svelte';

  let {
    profile,
    session,
    executeSession,
    registerSessionView,
    menuBarState,
    menuBarMenus = [],
    foreground = true,
    children,
    desktopItems,
    desktopStacks = [],
    desktopDetails = {},
    dockApplications,
    dockMenuItems = [],
    contextMenuItems = null,
    dockTiles = [],
    dockFolders = [],
    dockTrash,
    renderWindowTile,
    windows = [],
    runningAppIds = [],
    activeWindowId = null,
    activeApp = profile.applications.finder,
    viewState,
    fullScreenStage = { mode: 'normal', topRevealed: false, launcherRevealed: false },
    missionControlOpen = false,
    onfullscreenreveal,
    execute,
    registerView,
    onlayout,
  } = $props();
  const primaryMenus = $derived(menuBarMenus.filter(menu => !['users', 'wifi', 'battery', 'clock', 'sound', 'bluetooth'].includes(menu.menuId)));
  const userMenus = $derived(menuBarMenus.filter(menu => menu.menuId === 'users'));
  const wifiMenus = $derived(menuBarMenus.filter(menu => menu.menuId === 'wifi'));
  const batteryMenus = $derived(menuBarMenus.filter(menu => menu.menuId === 'battery' && menu.showInMenuBar));
  const clockMenus = $derived(menuBarMenus.filter(menu => menu.menuId === 'clock'));
  const soundMenus = $derived(menuBarMenus.filter(menu => menu.menuId === 'sound' && menu.showInMenuBar));
  const bluetoothMenus = $derived(menuBarMenus.filter(menu => menu.menuId === 'bluetooth' && menu.showInMenuBar));

  const applications = $derived(profile.applications);
  const desktopFiles = $derived(desktopItems);
  const stacksEnabled = $derived(Boolean(viewState.stacks?.enabled));
  const desktopLayout = $derived(desktopStackLayout(desktopFiles, desktopStacks, stacksEnabled));
  const visibleFiles = $derived(stacksEnabled ? desktopLayout.filter((entry) => entry.type !== 'stack') : desktopFiles);
  const contextItems = $derived(contextMenuItems ?? desktopContextItems(viewState, desktopFiles, 'macos'));
  let filesPanel;
  let filesHeight = $state(undefined);
  let wrappedGrid = $state(null);
  let layoutWidth = $state(0);
  function updateWrappedGrid() {
    if (!foreground || !filesPanel?.isConnected || filesHeight === undefined) return;
    const gap = parseFloat(getComputedStyle(filesPanel).gap) || 0;
    let width = 0, height = 0, count = 0;
    for (const button of layoutButtons()) {
      const rect = button.getBoundingClientRect();
      width = Math.max(width, rect.width); height = Math.max(height, rect.height); count++;
    }
    if (count * (height + gap) - gap > filesHeight && height > 0) {
      const rows = Math.max(1, Math.floor((filesHeight + gap) / (height + gap)));
      if (!wrappedGrid || wrappedGrid.rows !== rows || wrappedGrid.width !== width || wrappedGrid.height !== height) wrappedGrid = { rows, width, height };
    } else if (wrappedGrid !== null) wrappedGrid = null;
  }
  $effect(() => {
    foreground;
    desktopLayout; desktopDetails; options.iconSize; options.gridSpacing; options.textSize; options.labelPosition; options.showItemInfo; filesHeight; layoutWidth;
    tick().then(updateWrappedGrid);
  });
  const options = $derived(viewState.viewOptions);
  const customView = $derived(options.iconSize !== 64 || options.gridSpacing !== 24 || options.textSize !== 12 || options.labelPosition !== 'bottom');
  // Retained popup state can precede workspace and Dock bindings during remount.
  let workspace = $state();
  let dock = $state();
  let dockControls;
  const dockView = createMacDockView({ getWorkspace: () => workspace, getDock: () => dock, getDockControls: () => dockControls,
    getState: () => viewState.dock, getActiveApp: () => activeApp, execute: command => execute(command) });
  $effect(() => {
    foreground; viewState.dock.preferences.autoHide;
    tick().then(() => { if (foreground && workspace?.isConnected && dock?.isConnected) { filesHeight = measureWorkspace().height; layoutWidth = measureWorkspace().width; onlayout?.(); } });
  });
  const activeWindow = $derived(windows.find((window) => window.id === activeWindowId));
  let renameBounds = $state(null);
  const interactions = createDesktopItemInteractions({
    getWorkspace: () => workspace,
    getArea: measureWorkspace,
    getItems: () => visibleFiles,
    getState: () => viewState,
    execute: (command) => execute(command),
    family: 'macos',
    openCommand: 'desktop.open',
    available: () => itemsAvailable(),
  });

  function desktopButtons() {
    return [...(workspace?.querySelectorAll(':scope > .golden-gate-files > button[data-file-id]') ?? [])]
      .filter((element) => !element.disabled && !element.closest('[inert]')
        && element.getClientRects().length);
  }

  function layoutButtons() {
    return [...(filesPanel?.querySelectorAll(':scope > button[data-file-id], :scope > button[data-stack-id]') ?? [])]
      .filter((element) => !element.disabled && !element.closest('[inert]')
        && element.getClientRects().length);
  }

  function itemsAvailable() {
    return Boolean(foreground && workspace?.isConnected && !workspace.closest('[inert]')
      && !workspace.parentElement.querySelector('[aria-modal="true"]')
      && workspace.querySelector(':scope > .golden-gate-files')?.getClientRects().length);
  }

  function itemRects() {
    if (!itemsAvailable()) return [];
    const origin = workspace.getBoundingClientRect();
    return desktopButtons().map((element) => {
      const rectangle = element.getBoundingClientRect();
      return { fileId: element.dataset.fileId, x: rectangle.left - origin.left,
        y: rectangle.top - origin.top, width: rectangle.width, height: rectangle.height };
    });
  }

  function stackRects() {
    if (!itemsAvailable()) return [];
    const origin = workspace.getBoundingClientRect();
    return layoutButtons().filter((element) => element.dataset.stackId).map((element) => {
      const rectangle = element.getBoundingClientRect();
      return { stackId: element.dataset.stackId, x: rectangle.left - origin.left,
        y: rectangle.top - origin.top, width: rectangle.width, height: rectangle.height };
    });
  }

  async function focusStack(stackId) {
    await tick();
    updateWrappedGrid(); await tick();
    if (!foreground || !itemsAvailable()) return;
    const element = layoutButtons().find((button) => button.dataset.stackId === stackId);
    revealDesktopItem(element, filesPanel);
    element?.focus({ preventScroll: true });
  }

  function adjacentLayoutButton(current, key, wrap = false) {
    const buttons = layoutButtons();
    if (key === 'Home' || key === 'End') return buttons[key === 'Home' ? 0 : buttons.length - 1];
    const index = buttons.indexOf(current);
    if (index < 0) return buttons[0];
    const origin = current.getBoundingClientRect();
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    const forward = key === 'ArrowRight' || key === 'ArrowDown';
    const primary = horizontal ? 'left' : 'top', secondary = horizontal ? 'top' : 'left';
    let nearest, distance = Infinity;
    for (const button of buttons) {
      if (button === current) continue;
      const rect = button.getBoundingClientRect();
      if (forward ? rect[primary] <= origin[primary] + 1 : rect[primary] >= origin[primary] - 1) continue;
      const score = Math.abs(rect[primary] - origin[primary]) + Math.abs(rect[secondary] - origin[secondary]) * 2;
      if (score < distance) { nearest = button; distance = score; }
    }
    return nearest ?? (wrap ? buttons[(index + (forward ? 1 : -1) + buttons.length) % buttons.length] : undefined);
  }

  async function navigateStack(stackId, direction) {
    const current = layoutButtons().find((button) => button.dataset.stackId === stackId);
    const next = adjacentLayoutButton(current, direction === 'previous' ? 'ArrowUp' : 'ArrowDown', true);
    if (!next) return;
    if (next.dataset.stackId) await request('desktop.stacks.focus', { stackId: next.dataset.stackId });
    else {
      await request('desktop.select', { fileId: next.dataset.fileId });
      await focusItem(next.dataset.fileId);
    }
  }

  async function navigateFile(event, fileId) {
    const current = layoutButtons().find((button) => button.dataset.fileId === fileId)
      ?? layoutButtons().find((button) => button.dataset.fileId === viewState.selectedFileIds.at(-1));
    const next = adjacentLayoutButton(current, event.key, event.key === 'ArrowUp' || event.key === 'ArrowDown');
    event.preventDefault();
    event.stopPropagation();
    if (!next) return;
    if (next.dataset.stackId) await request('desktop.stacks.focus', { stackId: next.dataset.stackId });
    else {
      const nextId = next.dataset.fileId;
      if (event.shiftKey) {
        await request('desktop.select.range', { from: viewState.selectionAnchorId ?? fileId ?? nextId, to: nextId });
      } else if (!event.metaKey) await request('desktop.select', { fileId: nextId });
      await focusItem(nextId);
    }
  }

  async function focusItem(fileId) {
    await tick();
    updateWrappedGrid(); await tick();
    if (!foreground || !itemsAvailable()) return;
    const element = desktopButtons().find((button) => button.dataset.fileId === fileId);
    if (wrappedGrid) revealDesktopItem(element, filesPanel);
    element?.focus({ preventScroll: true });
  }

  function measureRename() {
    const element = desktopButtons().find((button) => button.dataset.fileId === viewState.rename?.fileId);
    if (!element) { renameBounds = null; return; }
    if (wrappedGrid) revealDesktopItem(element, filesPanel);
    const origin = workspace.getBoundingClientRect();
    const rectangle = element.getBoundingClientRect();
    const label = element.querySelector('.golden-gate-file-label').getBoundingClientRect();
    renameBounds = { x: rectangle.left - origin.left, y: label.top - origin.top,
      width: rectangle.width, height: Math.max(20, label.height) };
  }

  async function focusRename() {
    await tick();
    updateWrappedGrid(); await tick();
    measureRename();
    await tick();
    if (!foreground || !itemsAvailable()) return;
    const input = workspace.querySelector('[data-desktop-rename]');
    input?.focus({ preventScroll: true });
    if (input) {
      const extension = input.value.lastIndexOf('.');
      input.setSelectionRange(0, extension > 0 ? extension : input.value.length);
    }
  }

  function reportRenameError(message) {
    const input = workspace?.querySelector('[data-desktop-rename]');
    input?.setCustomValidity(message);
    input?.reportValidity();
  }

  $effect(() => {
    const fileId = viewState.rename?.fileId;
    const position = fileId ? viewState.positions[fileId] : null;
    desktopLayout; desktopDetails; wrappedGrid; filesHeight; layoutWidth;
    options.iconSize; options.gridSpacing; options.textSize; options.labelPosition; options.showItemInfo;
    foreground;
    if (foreground && fileId) tick().then(() => {
      if (foreground && viewState.rename?.fileId === fileId && viewState.positions[fileId] === position) measureRename();
    });
    else renameBounds = null;
  });

  function renameKeydown(event) {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      request(event.key === 'Enter' ? 'desktop.rename.commit' : 'desktop.rename.cancel');
    }
  }

  function renameInput(event) {
    event.currentTarget.setCustomValidity('');
    request('desktop.rename.change', {}, { name: event.currentTarget.value });
  }

  function request(command, target = {}, payload = {}) {
    return execute({ command, target, payload });
  }

  function contextArea() {
    const rect = workspace.getBoundingClientRect();
    filesHeight;
    return { left: rect.left, top: rect.top, ...measureWorkspace(), width: layoutWidth || workspace.clientWidth };
  }
  function contextBounds() {
    const rect = workspace?.querySelector('[data-desktop-context-main]')?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }
  async function focusContextItem(itemId) {
    await tick();
    if (!foreground || !itemsAvailable()) return;
    const item = [...(workspace?.querySelectorAll('[data-desktop-context-item]') ?? [])]
      .find((item) => item.dataset.desktopContextItem === itemId && !item.disabled);
    revealDesktopItem(item, item?.closest('[data-desktop-context-menu]'));
    item?.focus({ preventScroll: true });
  }
  async function focusContextReturn(fileId) {
    await tick();
    const stack = stacksEnabled && desktopStacks.find((group) => group.fileIds.includes(fileId)
      && (group.id === viewState.stacks.focusedStackId || !group.expanded));
    if (stack) { await focusStack(stack.id); return; }
    const item = desktopButtons().find((button) => button.dataset.fileId === fileId);
    if (item) await focusItem(fileId);
    else workspace?.focus({ preventScroll: true });
  }
  function gridMetrics() {
    const origin = workspace.getBoundingClientRect();
    const panel = filesPanel.getBoundingClientRect();
    const rects = layoutButtons().map((button) => button.getBoundingClientRect());
    const style = getComputedStyle(filesPanel);
    const itemWidth = Math.max(0, ...rects.map((rect) => rect.width)) || parseFloat(style.width);
    const itemHeight = Math.max(0, ...rects.map((rect) => rect.height)) || 86;
    const gap = parseFloat(style.gap) || 0;
    return { startX: panel.right - origin.left - itemWidth, startY: panel.top - origin.top,
      stepX: itemWidth + gap, stepY: itemHeight + gap, itemWidth, itemHeight, reverseX: true };
  }
  function openContext(event, fileId = null) {
    if (!itemsAvailable()) return;
    event.preventDefault();
    event.stopPropagation();
    request('desktop.context.open', { fileId }, { x: event.clientX, y: event.clientY });
  }
  function filePointerdown(event, fileId) {
    if (event.button === 0 && event.ctrlKey) openContext(event, fileId);
    else interactions.pointerdown(event, fileId);
  }
  function fileClick(event, fileId) {
    if (event.ctrlKey || viewState.context) { event.preventDefault(); return; }
    interactions.click(event, fileId);
  }
  function desktopKeydown(event, fileId = null) {
    if (!foreground || event.target?.closest?.('[data-session-control], [data-session-control-root], [data-session-menu], [data-session-surface]')) return;
    if (event.target?.closest?.('[data-desktop-context-menu], input, textarea, select, [contenteditable], [data-window-id]')) return;
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      if (!itemsAvailable()) return;
      const rect = (fileId ? event.currentTarget : workspace).getBoundingClientRect();
      event.preventDefault();
      event.stopPropagation();
      request('desktop.context.open', { fileId }, { x: rect.left + 8, y: rect.top + 8 });
      return;
    }
    if (stacksEnabled && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey
      && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      navigateFile(event, fileId);
      return;
    }
    interactions.keydown(event, fileId);
  }
  function itemInfo(fileId) {
    const info = desktopDetails[fileId];
    if (!info) return '';
    if (info.itemCount !== null && info.itemCount !== undefined) return `${info.itemCount} ${info.itemCount === 1 ? 'item' : 'items'}`;
    return info.size !== null && info.size !== undefined ? `${info.size.toLocaleString()} bytes` : info.kind;
  }


  function focusControl(target) {
    if (!foreground) return;
    let element;
    if (target.control === 'window-menu') element = workspace?.parentElement?.querySelector('[data-menu-invoker="window"]');
    else if (target.control === 'file') {
      element = desktopButtons()
        .find((file) => file.dataset.fileId === target.fileId);
    }
    if (element?.isConnected && !element.closest('[inert]') && getComputedStyle(element).visibility !== 'hidden') element.focus();
  }


  function measureWorkspace() {
    const width = workspace.clientWidth;
    // Floating Dock bottom inset and fractional pixels belong to native geometry.
    const height = Math.max(0, workspace.clientHeight - (viewState.dock.preferences.autoHide ? 0
      : Math.ceil(dock.getBoundingClientRect().height) + 2 * (parseFloat(getComputedStyle(dock).bottom) || 0)));
    return { width, height };
  }

  onMount(() => {
    const unregisterView = registerView({
      ...dockView,
      focusControl,
      measureWorkspace,
      itemRects,
      focusItem,
      stackRects,
      focusStack,
      focusRename,
      reportRenameError,
      itemsAvailable,
      focusContextItem,
      focusContextReturn,
      contextBounds,
      contextArea,
      gridMetrics,
    });
    let previousWidth;
    let previousHeight;
    function reportLayout() {
      if (!foreground) return;
      const { width, height } = measureWorkspace();
      layoutWidth = width;
      if (viewState.rename) measureRename();
      filesHeight = Math.max(0, height - parseFloat(getComputedStyle(filesPanel).top));
      if (width !== previousWidth || height !== previousHeight) {
        previousWidth = width;
        previousHeight = height;
        onlayout({ width, height });
      }
    }
    function dismissOutside(event) {
      if (!foreground || event.target?.closest?.('[data-menu-bar], [data-menu-popup], [data-session-surface]')) return;
      if (event.target?.closest?.('[data-split-view-picker], [data-window-green-menu]')) return;
      dockView.dismissOutside(event);
      if (viewState.context && !event.target?.closest?.('[data-desktop-context-menu]')) {
        request('desktop.context.close', {}, { restoreFocus: false });
      }
    }
    function observeFocus(event) {
      if (!foreground || event.target?.closest?.('[data-menu-bar], [data-menu-popup], [data-session-surface]')) return;
      dismissOutside(event);
      const target = event.target;
      if (target?.closest?.('[data-desktop-context-menu], [data-dock-context-menu], [data-dock-stack], [data-shell-switcher], [data-application-menu], [data-application-menu-button], [data-split-view-picker], [data-window-green-menu], [data-split-view-divider]')) return;
      if (!dock.contains(target) && viewState.dock.focusedItemId) request('dock.focus', { itemId: null }, { observe: true });
      if (!dock.contains(target)
        && !(target instanceof Element && (target.matches('[data-desktop-rename]')
          || target.closest('[data-file-id], [data-stack-id]')?.closest('.golden-gate-files')))) {
        request('desktop.focusControl', { control: null });
      }
    }
    function dockShortcut(event) {
      if (foreground && !event.target?.closest?.('[data-session-control], [data-session-control-root], [data-session-menu], [data-session-surface]')) dockView.shortcut(event);
    }
    reportLayout();
    const observer = new ResizeObserver(reportLayout);
    observer.observe(workspace);
    observer.observe(dock);
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', observeFocus);
    document.addEventListener('keydown', dockShortcut, true);
    return () => {
      interactions.dispose();
      unregisterView();
      observer.disconnect();
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', observeFocus);
      document.removeEventListener('keydown', dockShortcut, true);
    };
  });

  function focusDesktop(event) {
    if (!foreground || event.button !== 0) return;
    if (event.target !== workspace && !event.target.classList.contains('golden-gate-files')) return;
    if (event.ctrlKey) { openContext(event); return; }
    request('desktop.focus');
    workspace.focus({ preventScroll: true });
    interactions.pointerdown(event);
  }

  function lifecycleKeydown(event) {
    if (event.defaultPrevented || event.isComposing || !(event.metaKey || event.ctrlKey)
      || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (!['n', 'q', ','].includes(key)) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('[inert], [aria-modal="true"]')) return;
    const focusedWindow = target.closest('[data-window-id]');
    if (focusedWindow) {
      if (!activeWindow || focusedWindow.dataset.windowId !== activeWindow.id
        || activeWindow.appId !== activeApp.id) return;
    } else if (!workspace?.parentElement.contains(target)
      && target !== document.body && target !== document.documentElement) return;
    if (key === ',') {
      if (activeApp.id !== 'notes') return;
      event.preventDefault();
      if (!event.repeat) request('app.settings.open', { appId: activeApp.id });
    } else if (key === 'n') {
      if (!activeApp.multipleWindows || target.isContentEditable
        || target.closest('input, textarea, select, [contenteditable], [role="textbox"]')) return;
      event.preventDefault();
      if (!event.repeat) request('window.create', { appId: activeApp.id });
    } else {
      // Finder cannot quit, and its shortcut must not quit the host browser.
      if (!activeApp.quitAllowed && activeApp.id !== 'finder') return;
      event.preventDefault();
      if (activeApp.quitAllowed && !event.repeat) request('app.quit', { appId: activeApp.id });
    }
  }

  function stacksShortcut(event) {
    if (event.defaultPrevented || event.isComposing || event.repeat || !event.ctrlKey || !event.metaKey
      || event.altKey || event.shiftKey || (event.key !== '0' && event.code !== 'Digit0')
      || !viewState.stacks || !itemsAvailable() || viewState.context || menuBarState?.menuId || viewState.rename) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('[data-window-id], input, textarea, select, [contenteditable], [data-desktop-context-menu]')) return;
    if (target !== workspace && target !== filesPanel && !target.closest('.golden-gate-files > button[data-file-id], .golden-gate-files > button[data-stack-id]')) return;
    event.preventDefault();
    event.stopPropagation();
    request('desktop.stacks.set', {}, { enabled: !stacksEnabled });
  }

  function escapeKey(event) {
    if (!foreground || event.target?.closest?.('[data-session-control], [data-session-control-root], [data-session-menu], [data-session-surface]')) return;
    // SessionHost alone owns the lock shortcut, including its queue ordering.
    if (event.ctrlKey && event.metaKey && event.key.toLowerCase() === 'q') return;
    if (event.defaultPrevented || event.target?.closest?.('[data-desktop-rename]')) return;
    stacksShortcut(event);
    if (event.defaultPrevented) return;
    lifecycleKeydown(event);
    if (event.target === workspace || event.target === document.body
      || event.target === document.documentElement) desktopKeydown(event);
  }

</script>

<svelte:window onkeydown={escapeKey} />
<div class="golden-gate-desktop" data-os-profile={profile.id} data-os-family={profile.family} style:background-image={`url("${profile.assets.wallpaper}")`}>
  <header class="golden-gate-menu-bar" aria-label="Desktop menu bar" inert={missionControlOpen || (fullScreenStage.mode !== 'normal' && !fullScreenStage.topRevealed)} style:visibility={missionControlOpen || (fullScreenStage.mode !== 'normal' && !fullScreenStage.topRevealed) ? 'hidden' : undefined} style:z-index={fullScreenStage.mode !== 'normal' ? 10000 : undefined}>
    <div class="golden-gate-menu-headings">
      <GoldenGateMenuBar {profile} menus={primaryMenus} state={menuBarState} execute={executeSession}
        registerView={registerSessionView} {foreground} />
    </div>
    <div class="golden-gate-status-items">
      {#if session?.fastUserSwitching}
        <GoldenGateMenuBar {profile} menus={userMenus} state={menuBarState} execute={executeSession}
          registerView={registerSessionView} {foreground} zone="users" />
      {/if}
      <GoldenGateMenuBar {profile} menus={batteryMenus} state={menuBarState} execute={executeSession}
        registerView={registerSessionView} {foreground} zone="battery" />
      <GoldenGateMenuBar {profile} menus={soundMenus} state={menuBarState} execute={executeSession}
        registerView={registerSessionView} {foreground} zone="sound" />
      <GoldenGateMenuBar {profile} menus={bluetoothMenus} state={menuBarState} execute={executeSession}
        registerView={registerSessionView} {foreground} zone="bluetooth" />
      <GoldenGateMenuBar {profile} menus={wifiMenus} state={menuBarState} execute={executeSession}
        registerView={registerSessionView} {foreground} zone="wifi" />
      <span class="golden-gate-spotlight" aria-label="Spotlight"><svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="8" r="5.5"/><path d="m12 12 5 5"/></svg></span>
      <span class="golden-gate-control-center" aria-label="Control Center"><svg viewBox="0 0 22 20" aria-hidden="true"><rect x="2" y="2" width="18" height="6" rx="3" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="6" cy="5" r="2" fill="currentColor"/><rect x="2" y="12" width="18" height="6" rx="3" fill="currentColor"/><circle cx="16" cy="15" r="2" fill="#707a54"/></svg></span>
      <GoldenGateMenuBar {profile} menus={clockMenus} state={menuBarState} execute={executeSession}
        registerView={registerSessionView} {foreground} zone="clock" />
    </div>
  </header>
  <main class="golden-gate-workspace" bind:this={workspace} tabindex="-1" aria-label="macOS Golden Gate desktop" onpointerdown={focusDesktop}
    oncontextmenu={(event) => { if (event.target === workspace || event.target === filesPanel) openContext(event); }}>
    <section class="golden-gate-files" bind:this={filesPanel} class:custom-view={customView} class:right-label={options.labelPosition === 'right'} class:wrapped-grid={wrappedGrid !== null} aria-label="Desktop files"
      inert={missionControlOpen || fullScreenStage.mode !== 'normal'}
      style:max-height={filesHeight !== undefined ? `${filesHeight}px` : undefined}
      style:--grid-height={filesHeight !== undefined ? `${filesHeight}px` : undefined} style:--grid-rows={wrappedGrid?.rows}
      style:--grid-item-height={wrappedGrid ? `${wrappedGrid.height}px` : undefined} style:--grid-item-width={wrappedGrid ? `${wrappedGrid.width}px` : undefined}
      onscroll={() => { if (viewState.rename) measureRename(); }}
      style:--desktop-icon-size={`${options.iconSize}px`} style:--desktop-text-size={`${options.textSize}px`} style:--desktop-spacing={`${options.gridSpacing}px`}>
      {#each desktopLayout as file (file.id)}
        {#if file.type === 'stack'}
          <MacDesktopStack {profile} {options} stack={file} {viewState} {execute} Icon={GoldenGateIcon}
            onnavigate={(direction) => navigateStack(file.id, direction)} />
        {:else}
        <button type="button" class="golden-gate-file" class:selected={viewState.selectedFileIds.includes(file.id)} aria-label={file.name} aria-pressed={viewState.selectedFileIds.includes(file.id)} data-file-id={file.id}
          style:translate={!stacksEnabled && viewState.positions[file.id] ? `${viewState.positions[file.id].x}px ${viewState.positions[file.id].y}px` : undefined}
          onfocus={() => request('desktop.focusControl', { control: 'file', fileId: file.id })}
          onclick={(event) => fileClick(event, file.id)} onpointerdown={(event) => filePointerdown(event, file.id)}
          oncontextmenu={(event) => openContext(event, file.id)}
          ondblclick={() => request('desktop.open', { fileId: file.id })} onkeydown={(event) => desktopKeydown(event, file.id)}
        >{#if options.showIconPreview || file.folderId || file.icon === 'drive' || file.icon === 'folder'}<GoldenGateIcon name={file.icon} assets={profile.assets}/>{:else}<svg class="golden-gate-icon generic-document" viewBox="0 0 64 64" aria-hidden="true"><path fill="#fafafa" stroke="#b4b4b4" d="M14 3h25l12 12v46H14z"/><path fill="#dedede" stroke="#b4b4b4" d="M39 3v12h12"/><path stroke="#b6c1cb" stroke-width="2" d="M22 27h21M22 34h21M22 41h21M22 48h15"/></svg>{/if}<span class="golden-gate-file-label" style:visibility={viewState.rename?.fileId === file.id ? 'hidden' : undefined}>{file.name}</span>{#if options.showItemInfo}<small class="desktop-item-info">{itemInfo(file.id)}</small>{/if}</button>
        {/if}
      {/each}
    </section>
    {#if viewState.rename && renameBounds}
      <input class="mac-desktop-rename" data-desktop-rename aria-label="Rename desktop item" value={viewState.rename.name}
        style:left={`${renameBounds.x}px`} style:top={`${renameBounds.y}px`} style:width={`${renameBounds.width}px`} style:min-height={`${renameBounds.height}px`}
        oninput={renameInput} onkeydown={renameKeydown} onpointerdown={(event) => event.stopPropagation()} />
    {/if}
    {#if viewState.marquee}
      <div class="mac-desktop-marquee" aria-hidden="true" style:left={`${viewState.marquee.x}px`} style:top={`${viewState.marquee.y}px`}
        style:width={`${viewState.marquee.width}px`} style:height={`${viewState.marquee.height}px`}></div>
    {/if}
    {#if viewState.context && workspace?.isConnected && dock?.isConnected}<MacDesktopContextMenu {profile} context={viewState.context} items={contextItems} area={contextArea()} {execute}/>{/if}
    {#if viewState.dock?.context && workspace?.isConnected && dock?.isConnected}<MacDockContextMenu {profile} context={viewState.dock.context} items={dockMenuItems} area={contextArea()} {execute}/>{/if}
    {@render children()}
  </main>
  <MacDock {profile} state={viewState.dock} applications={dockApplications} tiles={dockTiles} folders={dockFolders} trash={dockTrash} {runningAppIds}
    activeAppId={activeApp.id} {execute} {renderWindowTile} {missionControlOpen} presentationVisible={fullScreenStage.mode === 'normal' ? undefined : fullScreenStage.launcherRevealed} bind:element={dock} bind:this={dockControls} />
</div>

<style>
  .golden-gate-workspace { outline: none; }
  .golden-gate-file { touch-action: none; user-select: none; }
  @media (max-width: 745px) { .golden-gate-spotlight, .golden-gate-control-center { display: none; } }
  .mac-desktop-rename { position: absolute; z-index: 1; box-sizing: border-box; padding: 0 3px; border: 1px solid #7f9fca; border-radius: 3px; background: white; color: #111; font: inherit; font-size: 12px; line-height: 16px; text-align: center; outline: none; }
  .mac-desktop-rename:focus { box-shadow: 0 0 0 2px rgb(119 173 240 / 60%); }
  .mac-desktop-marquee { position: absolute; pointer-events: none; box-sizing: border-box; border: 1px solid rgb(255 255 255 / 70%); background: rgb(137 169 218 / 25%); }
  .golden-gate-file { flex-shrink: 0; }
  .custom-view { width: max(104px, calc(var(--desktop-icon-size) + 40px)); gap: var(--desktop-spacing); }
  .custom-view .golden-gate-file { font-size: var(--desktop-text-size); line-height: 1.3333; width: max(104px, calc(var(--desktop-icon-size) + 40px)); }
  .custom-view :global(.golden-gate-icon) { width: var(--desktop-icon-size); height: var(--desktop-icon-size); }
  .right-label { width: max(180px, calc(var(--desktop-icon-size) + 120px)); }
  .right-label .golden-gate-file { width: max(180px, calc(var(--desktop-icon-size) + 120px)); flex-direction: row; flex-wrap: wrap; text-align: left; }
  .right-label .golden-gate-file-label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .right-label .desktop-item-info { flex-basis: calc(100% - var(--desktop-icon-size) - 6px); margin-left: calc(var(--desktop-icon-size) + 6px); }
  .desktop-item-info { color: #c5defb; font-size: .9em; text-shadow: 0 1px 2px #000; max-width: 100%; }
  .generic-document { flex-shrink: 0; }
  .wrapped-grid { display: grid; left: 18px; width: auto; height: var(--grid-height); grid-auto-flow: column; grid-template-rows: repeat(var(--grid-rows), var(--grid-item-height)); grid-auto-columns: var(--grid-item-width); direction: rtl; justify-content: start; align-content: start; overflow: auto; scrollbar-width: thin; }
  .wrapped-grid .golden-gate-file { width: 104px; direction: ltr; }
  .wrapped-grid.custom-view .golden-gate-file { width: max(104px, calc(var(--desktop-icon-size) + 40px)); }
  .wrapped-grid.right-label .golden-gate-file { width: max(180px, calc(var(--desktop-icon-size) + 120px)); }
  .golden-gate-files > :global(button.desktop-stack) { flex-shrink: 0; }
  .custom-view > :global(button.desktop-stack) { font-size: var(--desktop-text-size); line-height: 1.3333; width: max(104px, calc(var(--desktop-icon-size) + 40px)); }
  .right-label > :global(button.desktop-stack) { width: max(180px, calc(var(--desktop-icon-size) + 120px)); }
  .wrapped-grid > :global(button.desktop-stack) { width: 104px; direction: ltr; }
  .wrapped-grid.custom-view > :global(button.desktop-stack) { width: max(104px, calc(var(--desktop-icon-size) + 40px)); }
  .wrapped-grid.right-label > :global(button.desktop-stack) { width: max(180px, calc(var(--desktop-icon-size) + 120px)); }
  @media (max-width: 760px) { .wrapped-grid:not(.custom-view) > :global(button.desktop-stack) { width: 86px; } }
  @media (max-width: 760px) { .wrapped-grid:not(.custom-view) .golden-gate-file { width: 86px; } .wrapped-grid { left: 9px; } }
  @media (max-width: 760px) { .mac-desktop-rename { font-size: 11px; } }
  .golden-gate-status-items { flex-shrink:0; }
  @media (max-width:520px) {
    .golden-gate-menu-bar { padding:0 6px; gap:6px; }
    .golden-gate-menu-headings { margin-right:0; }
    .golden-gate-status-items { gap:6px; }
    .golden-gate-control-center { display:none; }
  }
</style>

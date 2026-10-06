<script>
  import { onMount, tick } from 'svelte';
  import AppIcon from './AppIcon.svelte';
  import { createDesktopItemInteractions, revealDesktopItem } from './desktop-item-interactions.js';
  import MacDesktopContextMenu from './MacDesktopContextMenu.svelte';
  import { desktopContextItems } from './desktop-context-model.js';
  import MacDesktopStack from './MacDesktopStack.svelte';
  import { desktopStackLayout } from './desktop-stacks-model.js';
  import MacDockContextMenu from './MacDockContextMenu.svelte';
  import { createMacDockView } from './mac-dock-view.js';
  import MacDock from './MacDock.svelte';

  let {
    profile,
    children,
    desktopItems,
    desktopStacks = [],
    desktopDetails = {},
    dockApplications,
    dockMenuItems = [],
    dockTiles = [],
    dockFolders = [],
    dockTrash,
    renderWindowTile,
    windows = [],
    runningAppIds = [],
    activeWindowId = null,
    activeApp = profile.applications.finder,
    viewState,
    switchingState,
    fullScreenStage = { mode: 'normal', topRevealed: false, launcherRevealed: false },
    missionControlOpen = false,
    onfullscreenreveal,
    execute,
    registerView,
    onlayout,
  } = $props();

  const applications = $derived(profile.applications);
  const desktopFiles = $derived(desktopItems);
  const stacksEnabled = $derived(Boolean(viewState.stacks?.enabled));
  const desktopLayout = $derived(desktopStackLayout(desktopFiles, desktopStacks, stacksEnabled));
  const visibleFiles = $derived(stacksEnabled ? desktopLayout.filter((entry) => entry.type !== 'stack') : desktopFiles);
  const contextItems = $derived(desktopContextItems(viewState, desktopFiles, 'macos'));
  let filesPanel;
  let filesHeight = $state(undefined);
  let wrappedGrid = $state(null);
  let layoutWidth = $state(0);
  function updateWrappedGrid() {
    if (!filesPanel?.isConnected || filesHeight === undefined) return;
    const style = getComputedStyle(filesPanel), gap = parseFloat(style.gap) || 0;
    let width = 0, height = 0, count = 0;
    for (const button of layoutButtons()) {
      const rect = button.getBoundingClientRect();
      width = Math.max(width, rect.width); height = Math.max(height, rect.height); count++;
    }
    const overflow = style.flexDirection === 'row'
      ? count * (width + gap) - gap > measureWorkspace().width - parseFloat(style.right) * 2
      : count * (height + gap) - gap > filesHeight;
    if (overflow && height > 0) {
      const rows = Math.max(1, Math.floor((filesHeight + gap) / (height + gap)));
      if (!wrappedGrid || wrappedGrid.rows !== rows || wrappedGrid.width !== width || wrappedGrid.height !== height) wrappedGrid = { rows, width, height };
    } else if (wrappedGrid !== null) wrappedGrid = null;
  }
  $effect(() => {
    desktopLayout; desktopDetails; options.iconSize; options.gridSpacing; options.textSize; options.labelPosition; options.showItemInfo; filesHeight; layoutWidth;
    tick().then(updateWrappedGrid);
  });
  const options = $derived(viewState.viewOptions);
  const customView = $derived(options.iconSize !== 64 || options.gridSpacing !== 23 || options.textSize !== 12 || options.labelPosition !== 'bottom');
  let workspace = $state();
  let dock = $state();
  let dockControls;
  const dockView = createMacDockView({ getWorkspace: () => workspace, getDock: () => dock, getDockControls: () => dockControls,
    getState: () => viewState.dock, getActiveApp: () => activeApp, execute: command => execute(command) });
  $effect(() => {
    viewState.dock.preferences.autoHide;
    tick().then(() => { if (workspace?.isConnected && dock?.isConnected) { filesHeight = measureWorkspace().height; onlayout?.(); } });
  });
  let windowMenuContainer;
  let windowMenuButton;
  let windowMenuPanel = $state(null);
  let windowMenuLeft = $state(0);
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
    return [...(workspace?.querySelectorAll(':scope > .desktop-files > button[data-file-id]') ?? [])]
      .filter((element) => !element.disabled && !element.closest('[inert]')
        && element.getClientRects().length);
  }

  function layoutButtons() {
    return [...(filesPanel?.querySelectorAll(':scope > button[data-file-id], :scope > button[data-stack-id]') ?? [])]
      .filter((element) => !element.disabled && !element.closest('[inert]')
        && element.getClientRects().length);
  }

  function stackButtons() {
    return layoutButtons().filter((button) => button.hasAttribute('data-stack-id'));
  }

  function itemsAvailable() {
    return Boolean(workspace?.isConnected && !workspace.closest('[inert]')
      && !workspace.parentElement.querySelector('[aria-modal="true"]')
      && workspace.querySelector(':scope > .desktop-files')?.getClientRects().length);
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
    return stackButtons().map((element) => {
      const rectangle = element.getBoundingClientRect();
      return { stackId: element.dataset.stackId, x: rectangle.left - origin.left,
        y: rectangle.top - origin.top, width: rectangle.width, height: rectangle.height };
    });
  }

  async function focusStack(stackId) {
    await tick();
    updateWrappedGrid(); await tick();
    const element = stackButtons().find((button) => button.dataset.stackId === stackId);
    revealDesktopItem(element, filesPanel);
    element?.focus({ preventScroll: true });
  }

  function focusLayoutButton(element) {
    if (!element) return;
    if (element.dataset.stackId) request('desktop.stacks.focus', { stackId: element.dataset.stackId });
    else focusItem(element.dataset.fileId);
  }

  async function navigateStack(stackId, direction) {
    if (!itemsAvailable()) return;
    const buttons = layoutButtons();
    const index = buttons.findIndex((button) => button.dataset.stackId === stackId);
    if (index < 0) return;
    const next = buttons[(index + (direction === 'previous' ? -1 : 1) + buttons.length) % buttons.length];
    if (next.dataset.fileId) await request('desktop.select', { fileId: next.dataset.fileId });
    focusLayoutButton(next);
  }

  async function focusItem(fileId) {
    await tick();
    updateWrappedGrid(); await tick();
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
    const label = element.querySelector('.desktop-file-label').getBoundingClientRect();
    renameBounds = { x: rectangle.left - origin.left, y: label.top - origin.top,
      width: rectangle.width, height: Math.max(20, label.height) };
  }

  async function focusRename() {
    await tick();
    updateWrappedGrid(); await tick();
    measureRename();
    await tick();
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
    if (fileId) tick().then(() => {
      if (viewState.rename?.fileId === fileId && viewState.positions[fileId] === position) measureRename();
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
    if (item) { await focusItem(fileId); return; }
    workspace?.focus({ preventScroll: true });
  }
  function gridMetrics() {
    const origin = workspace.getBoundingClientRect();
    const panel = filesPanel.getBoundingClientRect();
    const rects = layoutButtons().map((button) => button.getBoundingClientRect());
    const style = getComputedStyle(filesPanel);
    const itemWidth = Math.max(0, ...rects.map((rect) => rect.width)) || parseFloat(style.width);
    const itemHeight = Math.max(0, ...rects.map((rect) => rect.height)) || 85;
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
    if (event.target?.closest?.('[data-desktop-context-menu], input, textarea, select, [contenteditable], [data-window-id]')) return;
    if (toggleStacksKeydown(event)) return;
    if (stacksEnabled && navigateLayoutKeydown(event, fileId)) return;
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      if (!itemsAvailable()) return;
      const rect = (fileId ? event.currentTarget : workspace).getBoundingClientRect();
      event.preventDefault();
      event.stopPropagation();
      request('desktop.context.open', { fileId }, { x: rect.left + 8, y: rect.top + 8 });
      return;
    }
    interactions.keydown(event, fileId);
  }

  function toggleStacksKeydown(event) {
    if (event.defaultPrevented || event.isComposing || !viewState.stacks
      || !event.ctrlKey || !event.metaKey || event.altKey || event.shiftKey || event.key !== '0'
      || viewState.rename || viewState.context || viewState.windowMenuOpen || !itemsAvailable()) return false;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('[inert], [aria-modal="true"], [data-window-id], input, textarea, select, [contenteditable]')
      || !(target === workspace || target === filesPanel
        || target.closest('[data-file-id], [data-stack-id]')?.parentElement === filesPanel)) return false;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) request('desktop.stacks.set', {}, { enabled: !stacksEnabled });
    return true;
  }

  function navigateLayoutKeydown(event, fileId) {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || !itemsAvailable() || viewState.rename
      || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
    const buttons = layoutButtons();
    const currentId = fileId ?? viewState.selectedFileIds.at(-1);
    const current = buttons.find((button) => button.dataset.fileId === currentId)
      ?? buttons.find((button) => button.dataset.stackId === viewState.stacks.focusedStackId)
      ?? buttons[0];
    let next;
    if (event.key === 'Home' || event.key === 'End') next = buttons[event.key === 'Home' ? 0 : buttons.length - 1];
    else if (current) {
      const origin = current.getBoundingClientRect();
      const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
      const primary = horizontal ? 'x' : 'y', secondary = horizontal ? 'y' : 'x';
      const candidates = buttons.filter((button) => button !== current).map((button) => ({ button, rect: button.getBoundingClientRect() }))
        .filter(({ rect }) => forward ? rect[primary] > origin[primary] + 1 : rect[primary] < origin[primary] - 1);
      candidates.sort((a, b) => (Math.abs(a.rect[primary] - origin[primary]) + Math.abs(a.rect[secondary] - origin[secondary]) * 2)
        - (Math.abs(b.rect[primary] - origin[primary]) + Math.abs(b.rect[secondary] - origin[secondary]) * 2));
      next = candidates[0]?.button ?? (!horizontal
        ? buttons[(buttons.indexOf(current) + (forward ? 1 : -1) + buttons.length) % buttons.length] : undefined);
    }
    event.preventDefault();
    event.stopPropagation();
    if (!next) return true;
    const nextId = next.dataset.fileId;
    if (nextId) {
      if (event.shiftKey && current?.dataset.fileId) request('desktop.select.range', { from: viewState.selectionAnchorId ?? current.dataset.fileId, to: nextId });
      else if (!event.metaKey) request('desktop.select', { fileId: nextId });
    }
    focusLayoutButton(next);
    return true;
  }
  function itemInfo(fileId) {
    const info = desktopDetails[fileId];
    if (!info) return '';
    if (info.itemCount !== null && info.itemCount !== undefined) return `${info.itemCount} ${info.itemCount === 1 ? 'item' : 'items'}`;
    return info.size !== null && info.size !== undefined ? `${info.size.toLocaleString()} bytes` : info.kind;
  }

  function enabledMenuItemIds() {
    return [
      ...(activeWindow ? activeWindow.fullScreen ? ['close'] : ['close', 'minimize', 'zoom'] : []),
      ...windows.map((window) => `window:${window.id}`),
    ];
  }

  // Window commands can remove or disable the currently focused menu item.
  $effect(() => {
    const items = enabledMenuItemIds();
    if (viewState.windowMenuOpen && viewState.windowMenuItem !== null
      && !items.includes(viewState.windowMenuItem)) {
      request('menu.select', { menuId: 'window', itemId: items[0] ?? null });
    }
  });

  function prepareWindowMenu() {
    windowMenuLeft = windowMenuButton.getBoundingClientRect().left;
  }

  async function focusMenuItem(itemId) {
    await tick();
    const item = [...(windowMenuPanel?.querySelectorAll('[data-menu-item-id]') ?? [])]
      .find((element) => element.dataset.menuItemId === itemId && !element.disabled);
    item?.focus();
  }

  function focusControl(target) {
    let element;
    if (target.control === 'window-menu') element = windowMenuButton;
    else if (target.control === 'file') {
      element = desktopButtons()
        .find((file) => file.dataset.fileId === target.fileId);
    }
    element?.focus();
  }

  function windowMenuScrollTop() {
    return windowMenuPanel?.scrollTop ?? 0;
  }

  async function scrollWindowMenu(top) {
    await tick();
    if (windowMenuPanel) windowMenuPanel.scrollTop = top;
    return windowMenuScrollTop();
  }

  function measureWorkspace() {
    const width = workspace.clientWidth;
    // Reserve fractional Dock pixels too; offsetHeight can round them down.
    const height = Math.max(0, workspace.clientHeight - (viewState.dock.preferences.autoHide ? 0 : Math.ceil(dock.getBoundingClientRect().height)));
    return { width, height };
  }

  onMount(() => {
    const unregisterView = registerView({
      ...dockView,
      prepareWindowMenu,
      enabledMenuItemIds,
      focusMenuItem,
      focusControl,
      windowMenuScrollTop,
      scrollWindowMenu,
      measureWorkspace,
      itemRects,
      stackRects,
      focusStack,
      focusItem,
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
      if (event.target?.closest?.('[data-split-view-picker], [data-window-green-menu]')) return;
      dockView.dismissOutside(event);
      if (viewState.context && !event.target?.closest?.('[data-desktop-context-menu]')) {
        request('desktop.context.close', {}, { restoreFocus: false });
      }
      if (viewState.windowMenuOpen && !windowMenuContainer.contains(event.target)) {
        request('menu.close', { menuId: 'window' }, { restoreFocus: false });
      }
    }
    function observeFocus(event) {
      dismissOutside(event);
      const target = event.target;
      if (target?.closest?.('[data-desktop-context-menu], [data-dock-context-menu], [data-dock-stack], [data-shell-switcher], [data-application-menu], [data-application-menu-button], [data-split-view-picker], [data-window-green-menu], [data-split-view-divider]')) return;
      if (!dock.contains(target) && viewState.dock.focusedItemId) request('dock.focus', { itemId: null }, { observe: true });
      if (!windowMenuContainer.contains(target)
        && !dock.contains(target)
        && !(target instanceof Element && (target.matches('[data-desktop-rename]')
          || target.closest('[data-file-id], [data-stack-id]')?.closest('.desktop-files')))) {
        request('desktop.focusControl', { control: null });
      }
    }
    reportLayout();
    const observer = new ResizeObserver(reportLayout);
    observer.observe(workspace);
    observer.observe(dock);
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', observeFocus);
    document.addEventListener('keydown', dockView.shortcut, true);
    return () => {
      interactions.dispose();
      unregisterView();
      observer.disconnect();
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', observeFocus);
      document.removeEventListener('keydown', dockView.shortcut, true);
    };
  });

  function focusDesktop(event) {
    if (event.button !== 0) return;
    if (event.target !== workspace && !event.target.classList.contains('desktop-files')) return;
    if (event.ctrlKey) { openContext(event); return; }
    request('desktop.focus');
    interactions.pointerdown(event);
  }

  function lifecycleKeydown(event) {
    if (event.defaultPrevented || event.isComposing || !(event.metaKey || event.ctrlKey)
      || event.altKey || event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'n' && key !== 'q') return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest('[inert], [aria-modal="true"]')) return;
    const focusedWindow = target.closest('[data-window-id]');
    if (focusedWindow) {
      if (!activeWindow || focusedWindow.dataset.windowId !== activeWindow.id
        || activeWindow.appId !== activeApp.id) return;
    } else if (!workspace?.parentElement.contains(target)
      && target !== document.body && target !== document.documentElement) return;
    if (key === 'n') {
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

  function escapeKey(event) {
    if (event.defaultPrevented || event.target?.closest?.('[data-desktop-rename]')) return;
    if (toggleStacksKeydown(event)) return;
    lifecycleKeydown(event);
    if (event.key === 'Escape' && viewState.windowMenuOpen) {
      event.preventDefault();
      request('menu.close', { menuId: 'window' });
      return;
    }
    if (event.target === workspace || event.target === document.body
      || event.target === document.documentElement) desktopKeydown(event);
  }

  function menuButtonKeydown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      request('menu.open', { menuId: 'window' }, { position: event.key === 'ArrowUp' ? 'last' : 'first' });
    }
  }

  function menuKeydown(event) {
    const items = enabledMenuItemIds();
    if (!items.length) return;
    const index = items.indexOf(viewState.windowMenuItem);
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    request('menu.select', { menuId: 'window', itemId: items[next] });
  }

  function observeMenuItem(itemId) {
    request('menu.select', { menuId: 'window', itemId });
  }

  function executeMenuItem(itemId) {
    request('menu.execute', { menuId: 'window', itemId });
  }

  function observeMenuScroll(event) {
    if (viewState.windowMenuOpen && event.currentTarget.scrollTop !== viewState.windowMenuScrollTop) {
      request('desktop.scroll', { region: 'window-menu' }, { top: event.currentTarget.scrollTop });
    }
  }
</script>

<svelte:window onkeydown={escapeKey} />

<div class="desktop" data-os-profile={profile.id} data-os-family={profile.family} style:background-image={`url("${profile.assets.wallpaper}")`}>
  <header class="menu-bar" aria-label="Desktop menu bar" inert={missionControlOpen || (fullScreenStage.mode !== 'normal' && !fullScreenStage.topRevealed)} style:visibility={missionControlOpen || (fullScreenStage.mode !== 'normal' && !fullScreenStage.topRevealed) ? 'hidden' : undefined} style:z-index={fullScreenStage.mode !== 'normal' ? 10000 : undefined}>
    <div class="menu-headings">
      <span class="apple-mark" aria-label="Apple menu"><svg viewBox="0 0 20 24" aria-hidden="true"><path fill="currentColor" d="M13.1 4.1c1-1.1 1.6-2.6 1.4-4.1-1.4.1-3 .9-4 2-1 1.1-1.7 2.6-1.5 4 1.6.1 3.1-.8 4.1-1.9ZM17 12.7c0-2.7 2.2-4 2.3-4.1-1.3-1.9-3.4-2.1-4.1-2.1-1.8-.2-3.5 1.1-4.4 1.1s-2.3-1.1-3.8-1.1C5 6.6 3 7.9 2 9.8c-2.1 3.8-.5 9.3 1.5 12.1 1 1.4 2.1 2.8 3.6 2.7 1.5-.1 2-1 3.8-1s2.3 1 3.9 1c1.6 0 2.6-1.4 3.5-2.8 1.1-1.6 1.6-3.1 1.6-3.2-.1 0-3-1.1-2.9-5.9Z" transform="translate(0 -1) scale(.9)"/></svg></span>
      <button type="button" class="window-menu-button app-menu"
        data-application-menu-button data-app-id={activeApp.id} aria-haspopup="menu" aria-expanded={Boolean(switchingState.appMenu)}
        onclick={() => request(switchingState.appMenu ? 'app.menu.close' : 'app.menu.open', switchingState.appMenu ? {} : { appId: activeApp.id })}>{activeApp.name}</button>
      <span class="static-menu">File</span><span class="static-menu">Edit</span><span class="static-menu">View</span>
      {#if activeApp.id === 'messages'}<span class="optional-menu">Buddies</span>{/if}
      <div class="window-menu-container" bind:this={windowMenuContainer}>
        <button
          type="button"
          class="window-menu-button"
          id="window-menu-button"
          bind:this={windowMenuButton}
          aria-haspopup="menu"
          aria-expanded={viewState.windowMenuOpen}
          aria-controls={viewState.windowMenuOpen ? 'window-menu' : undefined}
          onfocus={() => request('desktop.focusControl', { control: 'window-menu' })}
          onclick={() => request(viewState.windowMenuOpen ? 'menu.close' : 'menu.open', { menuId: 'window' })}
          onkeydown={menuButtonKeydown}
        >Window</button>
        {#if viewState.windowMenuOpen}
          <div class="window-menu-panel" id="window-menu" bind:this={windowMenuPanel} role="menu" tabindex="-1" aria-labelledby="window-menu-button" style:left={`clamp(4px, ${windowMenuLeft}px, calc(100vw - min(260px, calc(100vw - 8px)) - 4px))`} onkeydown={menuKeydown} onscroll={observeMenuScroll}>
            <button type="button" role="menuitem" data-menu-item-id="close" disabled={!activeWindow} onfocus={() => observeMenuItem('close')} onclick={() => executeMenuItem('close')}>Close</button>
            <button type="button" role="menuitem" data-menu-item-id="minimize" disabled={!activeWindow || activeWindow.fullScreen} onfocus={() => observeMenuItem('minimize')} onclick={() => executeMenuItem('minimize')}>Minimize</button>
            <button type="button" role="menuitem" data-menu-item-id="zoom" disabled={!activeWindow || activeWindow.fullScreen} onfocus={() => observeMenuItem('zoom')} onclick={() => executeMenuItem('zoom')}>Zoom</button>
            {#if windows.length}
              <div class="window-menu-separator" role="separator"></div>
              {#each windows as window (window.id)}
                <button type="button" role="menuitem" data-menu-item-id={`window:${window.id}`} aria-label={`${window.title}${window.minimized ? ', minimized' : ''}`} onfocus={() => observeMenuItem(`window:${window.id}`)} onclick={() => executeMenuItem(`window:${window.id}`)}>
                  <span class="window-menu-check" aria-hidden="true">{window.id === activeWindowId ? '✓' : ''}</span>
                  <span class="window-menu-title">{window.title}</span>
                  {#if window.minimized}<span class="window-menu-minimized" aria-hidden="true">Minimized</span>{/if}
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </div>
      <span class="optional-menu">Help</span>
    </div>
    <div class="status-items">
      <span class="wifi" aria-label="Wi-Fi connected"><svg viewBox="0 0 24 18" aria-hidden="true"><path fill="currentColor" d="M0 4.5a20 20 0 0 1 24 0l-2.2 2.7a16.5 16.5 0 0 0-19.6 0Zm4.2 5.1a13 13 0 0 1 15.6 0l-2.3 2.7a9.4 9.4 0 0 0-11 0Zm4.5 5.2a5.7 5.7 0 0 1 6.6 0L12 18Z"/></svg></span>
      <span class="battery-status" aria-label={`Battery: ${profile.defaults.batteryPercent} percent`}><span>{profile.defaults.batteryPercent}%</span><svg viewBox="0 0 28 14" aria-hidden="true"><rect x="1" y="2.5" width="23" height="9" rx="1.6" fill="none" stroke="currentColor"/><path fill="currentColor" d="M3 4.5h17v5H3zm22 0h2v5h-2z"/></svg></span>
      <time datetime="2018-09-24T17:42:00">{profile.defaults.clockLabel}</time>
      <span class="spotlight" aria-label="Spotlight"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m12 12 5 5" stroke="currentColor" stroke-width="1.6"/></svg></span>
      <span class="notification-center" aria-label="Notification Center"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 5h3m2 0h11M2 10h3m2 0h8M2 15h3m2 0h11" stroke="currentColor" stroke-width="1.7"/></svg></span>
    </div>
  </header>

  <main class="desktop-workspace" bind:this={workspace} tabindex="-1" aria-label="macOS Mojave-style desktop" onpointerdown={focusDesktop}
    oncontextmenu={(event) => { if (event.target === workspace || event.target === filesPanel) openContext(event); }}>
    <section class="desktop-files" bind:this={filesPanel} class:stacks-enabled={stacksEnabled} class:custom-view={customView} class:right-label={options.labelPosition === 'right'} class:wrapped-grid={wrappedGrid !== null} aria-label="Desktop files"
      inert={missionControlOpen || fullScreenStage.mode !== 'normal'}
      style:max-height={filesHeight !== undefined ? `${filesHeight}px` : undefined}
      style:--grid-height={filesHeight !== undefined ? `${filesHeight}px` : undefined} style:--grid-rows={wrappedGrid?.rows}
      style:--grid-item-height={wrappedGrid ? `${wrappedGrid.height}px` : undefined} style:--grid-item-width={wrappedGrid ? `${wrappedGrid.width}px` : undefined}
      onscroll={() => { if (viewState.rename) measureRename(); }}
      style:--desktop-icon-size={`${options.iconSize}px`} style:--desktop-text-size={`${options.textSize}px`} style:--desktop-spacing={`${options.gridSpacing}px`}>
      {#each desktopLayout as file (file.id)}
        {#if file.type === 'stack'}
          <MacDesktopStack {profile} {options} stack={file} {viewState} {execute} Icon={AppIcon}
            onnavigate={(direction) => navigateStack(file.id, direction)} />
        {:else}
        <button
          type="button"
          class="desktop-file"
          class:selected={viewState.selectedFileIds.includes(file.id)}
          aria-label={file.name}
          aria-pressed={viewState.selectedFileIds.includes(file.id)}
          data-file-id={file.id}
          style:translate={!stacksEnabled && viewState.positions[file.id] ? `${viewState.positions[file.id].x}px ${viewState.positions[file.id].y}px` : undefined}
          onfocus={() => request('desktop.focusControl', { control: 'file', fileId: file.id })}
          onclick={(event) => fileClick(event, file.id)}
          onpointerdown={(event) => filePointerdown(event, file.id)}
          oncontextmenu={(event) => openContext(event, file.id)}
          ondblclick={() => request('desktop.open', { fileId: file.id })}
          onkeydown={(event) => desktopKeydown(event, file.id)}
        >{#if options.showIconPreview || file.folderId || file.icon === 'drive' || file.icon === 'folder'}<AppIcon name={file.icon} assets={profile.assets}/>{:else}<svg class="app-icon generic-document" viewBox="0 0 64 64" aria-hidden="true"><path fill="#fafafa" stroke="#b4b4b4" d="M14 3h25l12 12v46H14z"/><path fill="#dedede" stroke="#b4b4b4" d="M39 3v12h12"/><path stroke="#b6c1cb" stroke-width="2" d="M22 27h21M22 34h21M22 41h21M22 48h15"/></svg>{/if}<span class="desktop-file-label" style:visibility={viewState.rename?.fileId === file.id ? 'hidden' : undefined}>{file.name}</span>{#if options.showItemInfo}<small class="desktop-item-info">{itemInfo(file.id)}</small>{/if}</button>
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
  .desktop-workspace { outline: none; }
  .desktop-file { touch-action: none; user-select: none; }
  .mac-desktop-rename { position: absolute; z-index: 1; box-sizing: border-box; padding: 0 2px; border: 1px solid #7f9fca; border-radius: 2px; background: white; color: #111; font: inherit; font-size: 12px; line-height: 16px; text-align: center; outline: none; }
  .mac-desktop-rename:focus { box-shadow: 0 0 0 2px rgb(119 173 240 / 60%); }
  .mac-desktop-marquee { position: absolute; pointer-events: none; box-sizing: border-box; border: 1px solid rgb(255 255 255 / 70%); background: rgb(137 169 218 / 25%); }
  .desktop-file { flex-shrink: 0; }
  .desktop-files.stacks-enabled { flex-direction: column; }
  .desktop-files > :global(.desktop-stack) { flex-shrink: 0; }
  .custom-view { width: max(102px, calc(var(--desktop-icon-size) + 38px)); gap: var(--desktop-spacing); }
  .custom-view .desktop-file { font-size: var(--desktop-text-size); line-height: 1.3333; width: max(102px, calc(var(--desktop-icon-size) + 38px)); }
  .custom-view > :global(.desktop-stack) { font-size: var(--desktop-text-size); line-height: 1.3333; width: max(102px, calc(var(--desktop-icon-size) + 38px)); }
  .custom-view :global(.app-icon) { width: var(--desktop-icon-size); height: var(--desktop-icon-size); }
  .right-label { width: max(180px, calc(var(--desktop-icon-size) + 120px)); }
  .right-label .desktop-file { width: max(180px, calc(var(--desktop-icon-size) + 120px)); flex-direction: row; flex-wrap: wrap; text-align: left; }
  .right-label > :global(.desktop-stack) { width: max(180px, calc(var(--desktop-icon-size) + 120px)); }
  .right-label .desktop-file-label { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .right-label .desktop-item-info { flex-basis: calc(100% - var(--desktop-icon-size) - 5px); margin-left: calc(var(--desktop-icon-size) + 5px); }
  .desktop-item-info { color: #c5defb; font-size: .9em; text-shadow: 0 1px 2px #000; max-width: 100%; }
  .generic-document { flex-shrink: 0; }
  .wrapped-grid { display: grid; left: 17px; width: auto; height: var(--grid-height); grid-auto-flow: column; grid-template-rows: repeat(var(--grid-rows), var(--grid-item-height)); grid-auto-columns: var(--grid-item-width); direction: rtl; justify-content: start; align-content: start; overflow: auto; scrollbar-width: thin; }
  .wrapped-grid .desktop-file { width: 102px; direction: ltr; }
  .wrapped-grid.custom-view .desktop-file { width: max(102px, calc(var(--desktop-icon-size) + 38px)); }
  .wrapped-grid.right-label .desktop-file { width: max(180px, calc(var(--desktop-icon-size) + 120px)); }
  .wrapped-grid > :global(.desktop-stack) { width: 102px; direction: ltr; }
  .wrapped-grid.custom-view > :global(.desktop-stack) { width: max(102px, calc(var(--desktop-icon-size) + 38px)); }
  .wrapped-grid.right-label > :global(.desktop-stack) { width: max(180px, calc(var(--desktop-icon-size) + 120px)); }
  @media (max-width: 760px) { .wrapped-grid:not(.custom-view) .desktop-file { width: 82px; } .wrapped-grid { left: 7px; } }
  @media (max-width: 520px) and (max-height: 650px) { .wrapped-grid:not(.custom-view) .desktop-file { width: 78px; } }
  @media (max-width: 760px) { .wrapped-grid:not(.custom-view) > :global(.desktop-stack) { width: 82px; } }
  @media (max-width: 520px) and (max-height: 650px) {
    .desktop-files.stacks-enabled:not(.custom-view):not(.right-label):not(.wrapped-grid) { width: 78px; }
    .wrapped-grid:not(.custom-view) > :global(.desktop-stack) { width: 78px; }
  }
  @media (max-width: 760px) { .mac-desktop-rename { font-size: 11px; } }
</style>

<script>
  import { onMount, tick } from 'svelte';
  import AppIcon from './AppIcon.svelte';

  let {
    profile,
    children,
    windows = [],
    runningAppIds = [],
    activeWindowId = null,
    activeApp = profile.applications.finder,
    viewState,
    execute,
    registerView,
    onlayout,
  } = $props();

  const applications = $derived(profile.applications);
  const desktopFiles = $derived(profile.desktopFiles);
  const dockApps = $derived(Object.values(applications).filter((app) => app.dock === 'main'));
  const recentApps = $derived(Object.values(applications).filter((app) => app.dock === 'recent'));
  let workspace;
  let dock;
  let windowMenuContainer;
  let windowMenuButton;
  let windowMenuPanel = $state(null);
  let windowMenuLeft = $state(0);
  const runningApps = $derived(new Set(runningAppIds));
  const activeWindow = $derived(windows.find((window) => window.id === activeWindowId));

  function request(command, target = {}, payload = {}) {
    return execute({ command, target, payload });
  }

  function enabledMenuItemIds() {
    return [
      ...(activeWindow ? ['close', 'minimize', 'zoom'] : []),
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
      element = [...workspace.querySelectorAll('[data-file-id]')]
        .find((file) => file.dataset.fileId === target.fileId);
    } else if (target.control === 'dock') {
      element = [...dock.querySelectorAll('[data-app-id], [data-dock-item-id]')]
        .find((item) => target.appId !== undefined
          ? item.dataset.appId === target.appId
          : item.dataset.dockItemId === target.itemId);
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
    const height = Math.max(0, workspace.clientHeight - Math.ceil(dock.getBoundingClientRect().height));
    return { width, height };
  }

  onMount(() => {
    const unregisterView = registerView({
      prepareWindowMenu,
      enabledMenuItemIds,
      focusMenuItem,
      focusControl,
      windowMenuScrollTop,
      scrollWindowMenu,
      measureWorkspace,
    });
    let previousWidth;
    let previousHeight;
    function reportLayout() {
      const { width, height } = measureWorkspace();
      if (width !== previousWidth || height !== previousHeight) {
        previousWidth = width;
        previousHeight = height;
        onlayout({ width, height });
      }
    }
    function dismissOutside(event) {
      if (viewState.windowMenuOpen && !windowMenuContainer.contains(event.target)) {
        request('menu.close', { menuId: 'window' }, { restoreFocus: false });
      }
    }
    function observeFocus(event) {
      dismissOutside(event);
      const target = event.target;
      if (!windowMenuContainer.contains(target)
        && !dock.contains(target)
        && !(target instanceof Element && target.closest('[data-file-id]')?.closest('.desktop-files'))) {
        request('desktop.focusControl', { control: null });
      }
    }
    reportLayout();
    const observer = new ResizeObserver(reportLayout);
    observer.observe(workspace);
    observer.observe(dock);
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', observeFocus);
    return () => {
      unregisterView();
      observer.disconnect();
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', observeFocus);
    };
  });

  function focusDesktop(event) {
    if (event.button !== 0) return;
    if (event.target !== workspace && !event.target.classList.contains('desktop-files')) return;
    request('desktop.focus');
  }

  function fileKeydown(event, file) {
    if (event.key === 'Enter') {
      event.preventDefault();
      request('desktop.open', { fileId: file.id });
    }
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
    lifecycleKeydown(event);
    if (event.key !== 'Escape') return;
    request('desktop.select', { fileId: null });
    if (viewState.windowMenuOpen) {
      event.preventDefault();
      request('menu.close', { menuId: 'window' });
    }
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
  <header class="menu-bar" aria-label="Desktop menu bar">
    <div class="menu-headings">
      <span class="apple-mark" aria-label="Apple menu"><svg viewBox="0 0 20 24" aria-hidden="true"><path fill="currentColor" d="M13.1 4.1c1-1.1 1.6-2.6 1.4-4.1-1.4.1-3 .9-4 2-1 1.1-1.7 2.6-1.5 4 1.6.1 3.1-.8 4.1-1.9ZM17 12.7c0-2.7 2.2-4 2.3-4.1-1.3-1.9-3.4-2.1-4.1-2.1-1.8-.2-3.5 1.1-4.4 1.1s-2.3-1.1-3.8-1.1C5 6.6 3 7.9 2 9.8c-2.1 3.8-.5 9.3 1.5 12.1 1 1.4 2.1 2.8 3.6 2.7 1.5-.1 2-1 3.8-1s2.3 1 3.9 1c1.6 0 2.6-1.4 3.5-2.8 1.1-1.6 1.6-3.1 1.6-3.2-.1 0-3-1.1-2.9-5.9Z" transform="translate(0 -1) scale(.9)"/></svg></span>
      <span class="app-menu">{activeApp.name}</span>
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
            <button type="button" role="menuitem" data-menu-item-id="minimize" disabled={!activeWindow} onfocus={() => observeMenuItem('minimize')} onclick={() => executeMenuItem('minimize')}>Minimize</button>
            <button type="button" role="menuitem" data-menu-item-id="zoom" disabled={!activeWindow} onfocus={() => observeMenuItem('zoom')} onclick={() => executeMenuItem('zoom')}>Zoom</button>
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

  <main class="desktop-workspace" bind:this={workspace} aria-label="macOS Mojave-style desktop" onpointerdown={focusDesktop}>
    <section class="desktop-files" aria-label="Desktop files">
      {#each desktopFiles as file (file.id)}
        <button
          type="button"
          class="desktop-file"
          class:selected={viewState.selectedFileId === file.id}
          aria-label={file.name}
          aria-pressed={viewState.selectedFileId === file.id}
          data-file-id={file.id}
          onfocus={() => request('desktop.focusControl', { control: 'file', fileId: file.id })}
          onclick={() => request('desktop.select', { fileId: file.id })}
          ondblclick={() => request('desktop.open', { fileId: file.id })}
          onkeydown={(event) => fileKeydown(event, file)}
        ><AppIcon name={file.icon} assets={profile.assets}/><span class="desktop-file-label">{file.name}</span></button>
      {/each}
    </section>
    {@render children()}
  </main>

  <footer class="dock" bind:this={dock} aria-label="Application dock">
    <ul class="dock-apps">
      {#each dockApps as app (app.id)}
        <li class="dock-item">
          <button
              type="button"
              class="dock-button"
              class:is-active={activeApp.id === app.id && (app.id === 'finder' || activeWindowId !== null)}
              aria-label={app.name}
              aria-describedby={app.id === 'finder' || runningApps.has(app.id) ? `app-running-${app.id}` : undefined}
              title={app.name}
              data-app-id={app.id}
              onfocus={() => request('desktop.focusControl', { control: 'dock', appId: app.id })}
              onclick={() => request('app.open', { appId: app.id })}
          ><AppIcon name={app.icon} assets={profile.assets}/>{#if app.id === 'finder' || runningApps.has(app.id)}<span class="active-dot" aria-hidden="true"></span><span class="sr-only" id={`app-running-${app.id}`}>Running</span>{/if}</button>
        </li>
      {/each}
    </ul>
    <div class="dock-separator" aria-hidden="true"></div>
    <ul class="dock-apps dock-recents" aria-label="Recent applications">
      {#each recentApps as app (app.id)}
        <li class="dock-item">
          <button type="button" class="dock-button" class:is-active={activeApp.id === app.id && activeWindowId !== null} aria-label={app.name} aria-describedby={runningApps.has(app.id) ? `app-running-${app.id}` : undefined} title={app.name} data-app-id={app.id} onfocus={() => request('desktop.focusControl', { control: 'dock', appId: app.id })} onclick={() => request('app.open', { appId: app.id })}>
            <AppIcon name={app.icon} assets={profile.assets}/>{#if runningApps.has(app.id)}<span class="active-dot" aria-hidden="true"></span><span class="sr-only" id={`app-running-${app.id}`}>Running</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
    <div class="dock-separator" aria-hidden="true"></div>
    <div class="dock-item"><button type="button" class="dock-button" aria-label="Downloads" title="Downloads" data-dock-item-id="downloads" onfocus={() => request('desktop.focusControl', { control: 'dock', itemId: 'downloads' })} onclick={() => request('app.open', { appId: 'finder' }, { title: 'Downloads' })}><AppIcon name="downloads" assets={profile.assets}/></button></div>
    <div class="dock-item"><button type="button" class="dock-button" aria-label="Trash" title="Trash" data-dock-item-id="trash" onfocus={() => request('desktop.focusControl', { control: 'dock', itemId: 'trash' })} onclick={() => request('app.open', { appId: 'finder' }, { title: 'Trash' })}><AppIcon name="trash" assets={profile.assets}/></button></div>
  </footer>
</div>

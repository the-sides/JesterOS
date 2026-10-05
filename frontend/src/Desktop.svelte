<script>
  import { onMount, tick } from 'svelte';
  import AppIcon from './AppIcon.svelte';
  import { applications, desktopFiles } from './applications.js';

  let {
    children,
    windows = [],
    activeWindowId = null,
    activeApp = applications.finder,
    onopen,
    onfocus,
    onclose,
    onminimize,
    onzoom,
    ondesktopfocus,
    onlayout,
  } = $props();

  const dockApps = Object.values(applications).filter((app) => app.dock === 'main');
  const recentApps = Object.values(applications).filter((app) => app.dock === 'recent');
  let workspace;
  let dock;
  let windowMenuContainer;
  let windowMenuButton;
  let windowMenuPanel = $state(null);
  let selectedFileId = $state(null);
  let windowMenuOpen = $state(false);
  let windowMenuLeft = $state(0);
  const runningApps = $derived(new Set(windows.map((window) => window.appId)));
  const activeWindow = $derived(windows.find((window) => window.id === activeWindowId));

  onMount(() => {
    let previousWidth;
    let previousHeight;
    function reportLayout() {
      const width = workspace.clientWidth;
      const height = Math.max(0, workspace.clientHeight - dock.offsetHeight);
      if (width !== previousWidth || height !== previousHeight) {
        previousWidth = width;
        previousHeight = height;
        onlayout({ width, height });
      }
    }
    function dismissOutside(event) {
      if (!windowMenuContainer.contains(event.target)) windowMenuOpen = false;
    }
    reportLayout();
    const observer = new ResizeObserver(reportLayout);
    observer.observe(workspace);
    observer.observe(dock);
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
    };
  });

  function focusDesktop(event) {
    if (event.button !== 0) return;
    if (event.target !== workspace && !event.target.classList.contains('desktop-files')) return;
    selectedFileId = null;
    ondesktopfocus();
  }

  function selectFile(file) {
    selectedFileId = file.id;
    ondesktopfocus();
  }

  function fileKeydown(event, file) {
    if (event.key === 'Enter') {
      event.preventDefault();
      onopen(file.appId, file.name);
    }
  }

  function escapeKey(event) {
    if (event.key !== 'Escape') return;
    selectedFileId = null;
    if (windowMenuOpen) {
      event.preventDefault();
      windowMenuOpen = false;
      windowMenuButton.focus();
    }
  }

  async function openWindowMenu(last = false) {
    windowMenuLeft = windowMenuButton.getBoundingClientRect().left;
    windowMenuOpen = true;
    await tick();
    const items = windowMenuPanel?.querySelectorAll('[role="menuitem"]:not(:disabled)');
    if (items?.length) items[last ? items.length - 1 : 0].focus();
  }

  function menuButtonKeydown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openWindowMenu(event.key === 'ArrowUp');
    }
  }

  function menuKeydown(event) {
    const items = [...windowMenuPanel.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    items[next].focus();
  }

  function activateWindow(id) {
    windowMenuOpen = false;
    onfocus(id);
    windowMenuButton.focus();
  }

  function operateWindow(action) {
    if (!activeWindow) return;
    const id = activeWindow.id;
    windowMenuOpen = false;
    action(id);
    windowMenuButton.focus();
  }
</script>

<svelte:window onkeydown={escapeKey} />

<div class="desktop">
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
          aria-expanded={windowMenuOpen}
          aria-controls={windowMenuOpen ? 'window-menu' : undefined}
          onclick={() => windowMenuOpen ? windowMenuOpen = false : openWindowMenu()}
          onkeydown={menuButtonKeydown}
        >Window</button>
        {#if windowMenuOpen}
          <div class="window-menu-panel" id="window-menu" bind:this={windowMenuPanel} role="menu" tabindex="-1" aria-labelledby="window-menu-button" style:left={`clamp(4px, ${windowMenuLeft}px, calc(100vw - min(260px, calc(100vw - 8px)) - 4px))`} onkeydown={menuKeydown}>
            <button type="button" role="menuitem" disabled={!activeWindow} onclick={() => operateWindow(onclose)}>Close</button>
            <button type="button" role="menuitem" disabled={!activeWindow} onclick={() => operateWindow(onminimize)}>Minimize</button>
            <button type="button" role="menuitem" disabled={!activeWindow} onclick={() => operateWindow(onzoom)}>Zoom</button>
            {#if windows.length}
              <div class="window-menu-separator" role="separator"></div>
              {#each windows as window (window.id)}
                <button type="button" role="menuitem" aria-label={`${window.title}${window.minimized ? ', minimized' : ''}`} onclick={() => activateWindow(window.id)}>
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
      <span class="battery-status" aria-label="Battery: 87 percent"><span>87%</span><svg viewBox="0 0 28 14" aria-hidden="true"><rect x="1" y="2.5" width="23" height="9" rx="1.6" fill="none" stroke="currentColor"/><path fill="currentColor" d="M3 4.5h17v5H3zm22 0h2v5h-2z"/></svg></span>
      <time datetime="2018-09-24T17:42:00">Mon 5:42 PM</time>
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
          class:selected={selectedFileId === file.id}
          aria-label={file.name}
          aria-pressed={selectedFileId === file.id}
          data-file-id={file.id}
          onclick={() => selectFile(file)}
          ondblclick={() => onopen(file.appId, file.name)}
          onkeydown={(event) => fileKeydown(event, file)}
        ><AppIcon name={file.icon}/><span class="desktop-file-label">{file.name}</span></button>
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
              onclick={() => onopen(app.id)}
          ><AppIcon name={app.icon}/>{#if app.id === 'finder' || runningApps.has(app.id)}<span class="active-dot" aria-hidden="true"></span><span class="sr-only" id={`app-running-${app.id}`}>Running</span>{/if}</button>
        </li>
      {/each}
    </ul>
    <div class="dock-separator" aria-hidden="true"></div>
    <ul class="dock-apps dock-recents" aria-label="Recent applications">
      {#each recentApps as app (app.id)}
        <li class="dock-item">
          <button type="button" class="dock-button" class:is-active={activeApp.id === app.id && activeWindowId !== null} aria-label={app.name} aria-describedby={runningApps.has(app.id) ? `app-running-${app.id}` : undefined} title={app.name} data-app-id={app.id} onclick={() => onopen(app.id)}>
            <AppIcon name={app.icon}/>{#if runningApps.has(app.id)}<span class="active-dot" aria-hidden="true"></span><span class="sr-only" id={`app-running-${app.id}`}>Running</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
    <div class="dock-separator" aria-hidden="true"></div>
    <div class="dock-item"><button type="button" class="dock-button" aria-label="Downloads" title="Downloads" onclick={() => onopen('finder', 'Downloads')}><AppIcon name="downloads"/></button></div>
    <div class="dock-item"><button type="button" class="dock-button" aria-label="Trash" title="Trash" onclick={() => onopen('finder', 'Trash')}><AppIcon name="trash"/></button></div>
  </footer>
</div>

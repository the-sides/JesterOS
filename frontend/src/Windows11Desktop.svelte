<script>
  import { onMount, tick } from 'svelte';
  import Windows11Icon from './Windows11Icon.svelte';
  import Windows11DesktopContextMenu from './Windows11DesktopContextMenu.svelte';
  import { desktopContextItems } from './desktop-context-model.js';
  import { createDesktopItemInteractions, revealDesktopItem } from './desktop-item-interactions.js';
  import './windows11.css';
  let { profile, desktopItems = [], desktopDetails = {}, children, windows = [], runningAppIds = [], activeWindowId = null, activeApp, viewState, native, execute, registerView, onlayout, fullScreenStage = { mode: 'normal', topRevealed: false, launcherRevealed: false }, onfullscreenreveal } = $props();
  const shell = $derived(native.shell);
  const apps = $derived(Object.values(profile.applications));
  const files = $derived(desktopItems);
  const contextItems = $derived(desktopContextItems(shell, files, 'windows'));
  const propertyInfo = $derived(shell.dialog ? desktopDetails[shell.dialog.fileId] : null);
  const taskbarApps = $derived(apps.filter((app) => app.taskbar === 'pinned' || runningAppIds.includes(app.id)));
  const results = $derived(apps.filter((app) => app.name.toLowerCase().includes(shell.query.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)));
  const fileResults = $derived(shell.query ? files.filter((file) => file.name.toLowerCase().includes(shell.query.toLowerCase())) : []);
  const monthLabel = $derived(new Date(Date.UTC(shell.calendar.year, shell.calendar.month, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }));
  const calendarDays = $derived.by(() => {
    const first = new Date(Date.UTC(shell.calendar.year, shell.calendar.month, 1)).getUTCDay();
    const count = new Date(Date.UTC(shell.calendar.year, shell.calendar.month + 1, 0)).getUTCDate();
    return [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  });
  let workspace, root, taskbar;
  let desktopSurface = $state();
  let panel = $state(), contextMenu = $state(), properties = $state();
  function request(command, target = {}, payload = {}) { return execute({ command, target, payload }); }
  function recentWindow(appId) { return windows.findLast(window => window.appId === appId); }
  function togglePanel(panelId) { return shell.panel === panelId ? request('win11.panel.close') : request('win11.panel.open', { panelId }); }
  const interactions = createDesktopItemInteractions({
    getWorkspace: () => workspace, getItems: () => files, getState: () => shell,
    getArea: measureWorkspace,
    execute: (command) => execute(command), family: 'windows',
    openCommand: 'win11.desktop.open', available: () => itemsAvailable(),
  });
  function itemsAvailable() { return Boolean(desktopSurface?.isConnected && shell.viewOptions.showIcons && !shell.dialog && !desktopSurface.closest('[inert]')); }
  function itemElements() { return itemsAvailable() ? [...desktopSurface.querySelectorAll('button.win11-desktop-file[data-file-id]')] : []; }
  function itemRects() {
    const area = workspace.getBoundingClientRect();
    return itemElements().map((element) => {
      const rect = element.getBoundingClientRect();
      return { fileId: element.dataset.fileId, x: rect.left - area.left, y: rect.top - area.top, width: rect.width, height: rect.height };
    });
  }
  async function focusItem(fileId) {
    await tick();
    const element = itemElements().find((button) => button.dataset.fileId === fileId);
    revealDesktopItem(element, desktopSurface);
    element?.focus({ preventScroll: true });
  }
  async function focusRename() {
    await tick();
    if (!itemsAvailable()) return;
    const input = desktopSurface.querySelector('[data-desktop-rename]');
    if (!input) return;
    revealDesktopItem(input.parentElement, desktopSurface);
    input.focus({ preventScroll: true });
    const entry = files.find((file) => file.id === shell.rename?.fileId);
    const dot = entry?.folderId ? -1 : input.value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
  }
  function reportRenameError(message) {
    const input = desktopSurface?.querySelector('[data-desktop-rename]');
    if (itemsAvailable() && input) { input.setCustomValidity(message); input.reportValidity(); }
  }
  function renameKey(event) {
    event.stopPropagation();
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      request(event.key === 'Enter' ? 'win11.desktop.rename.commit' : 'win11.desktop.rename.cancel');
    }
  }
  function workspacePointer(event) {
    if (event.target === workspace || event.target === desktopSurface) interactions.pointerdown(event);
  }
  function desktopKey(event, fileId) {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const bounds = event.currentTarget.getBoundingClientRect();
      event.preventDefault(); event.stopPropagation();
      desktopContext({ preventDefault() {}, stopPropagation() {}, clientX: bounds.right, clientY: bounds.top }, fileId);
      return;
    }
    if (event.ctrlKey && event.key === 'Escape') return;
    interactions.keydown(event, fileId);
  }
  function measureWorkspace() { return { width: workspace?.clientWidth ?? 0, height: workspace?.clientHeight ?? 0 }; }
  function contextArea() {
    const rect = workspace.getBoundingClientRect();
    return { left: rect.left, top: rect.top, ...measureWorkspace() };
  }
  async function focusContextReturn(fileId) {
    await tick();
    if (fileId && itemElements().some(element => element.dataset.fileId === fileId)) await focusItem(fileId);
    else workspace?.focus({ preventScroll: true });
  }
  async function focusContextItem(itemId) {
    await tick();
    const element = [...(contextMenu?.querySelectorAll('[data-desktop-context-item]') ?? [])].find((item) => item.dataset.desktopContextItem === itemId && !item.disabled);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function contextBounds() {
    const panel = contextMenu?.querySelector('[data-context-main]');
    return { width: panel?.offsetWidth ?? 0, height: panel?.offsetHeight ?? 0 };
  }
  function gridMetrics() {
    const area = workspace.getBoundingClientRect();
    const surface = desktopSurface?.getBoundingClientRect();
    const rectangles = itemRects();
    const style = desktopSurface ? getComputedStyle(desktopSurface) : null;
    const itemWidth = Math.max(0, ...rectangles.map(rect => rect.width));
    const itemHeight = Math.max(0, ...rectangles.map(rect => rect.height));
    return { startX: surface ? surface.left - area.left : 4, startY: surface ? surface.top - area.top : 10, stepX: itemWidth + (parseFloat(style?.columnGap) || 0), stepY: itemHeight + (parseFloat(style?.rowGap) || 8), itemWidth, itemHeight, reverseX: false };
  }
  function controls() { return [...(root?.querySelectorAll('[data-shell-control]') ?? [])].filter((element) => !element.disabled && !element.closest('[inert]') && (!shell.dialog || element.dataset.shellControl === 'properties-close')); }
  async function focusControl(controlId) {
    await tick();
    const element = controls().find((element) => element.dataset.shellControl === controlId);
    element?.focus({ preventScroll: true });
    if (element?.closest('[data-shell-scroll]')) element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  async function scrollPanel(area, top, left) {
    await tick();
    const element = root?.querySelector(`[data-shell-scroll="${area}"]`);
    if (!element) return 0;
    element.scrollTop = top; if (left !== undefined) element.scrollLeft = left; return element.scrollTop;
  }
  function scrollAreas() { return [...(root?.querySelectorAll('[data-shell-scroll]') ?? [])].filter((element) => !element.closest('[inert]')).map((element) => element.dataset.shellScroll); }
  async function scrollSnapshot() {
    await tick();
    return [...(root?.querySelectorAll('[data-shell-scroll]') ?? [])].map((element) => ({ area: element.dataset.shellScroll, top: element.scrollTop, left: element.scrollLeft }));
  }
  function observeScroll(event, area) {
    if (event.target !== event.currentTarget) return;
    if (shell.scroll[area] !== event.currentTarget.scrollTop || shell.scrollLeft[area] !== event.currentTarget.scrollLeft) request('win11.shell.scroll', { area }, { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft });
  }
  function controlKey(event) {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('.win11-desktop-files')) return;
    if (event.target.closest('[data-desktop-context-item]')) return;
    const container = event.target.closest('[data-keyboard-group]');
    if (!container || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.target.matches('input,textarea,select')) return;
    const items = [...container.querySelectorAll('[data-shell-control]')].filter((element) => !element.disabled);
    const current = items.indexOf(event.target.closest('[data-shell-control]'));
    if (!items.length) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) + items.length) % items.length;
    request('win11.shell.focus', { controlId: items[index].dataset.shellControl });
  }
  function desktopContext(event, fileId = null) {
    event.preventDefault(); event.stopPropagation();
    if (shell.dialog) return;
    request('win11.desktop.context.open', { fileId }, { x: Math.max(0, event.clientX), y: Math.max(0, event.clientY) });
  }
  function dateId(day) { return `${shell.calendar.year}-${String(shell.calendar.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
  onMount(() => {
    const cleanup = registerView({ measureWorkspace, contextArea, focusControl, focusContextReturn, focusContextItem, contextBounds, gridMetrics, itemRects, focusItem, focusRename, reportRenameError, itemsAvailable, controlIds: () => controls().map((element) => element.dataset.shellControl), scrollPanel, scrollAreas, scrollSnapshot });
    let previous = '';
    function reportLayout() {
      const area = measureWorkspace(), key = `${area.width}:${area.height}`;
      if (previous !== key) { previous = key; onlayout(area); }
    }
    const observer = new ResizeObserver(reportLayout); observer.observe(workspace); observer.observe(taskbar); reportLayout();
    function outside(event) {
      if (!(event.target instanceof Element)) return;
      if (shell.dialog && !properties?.contains(event.target)) return;
      if (shell.context && !contextMenu?.contains(event.target)) request('win11.desktop.context.close', {}, { restoreFocus: true });
      if (shell.panel && !panel?.contains(event.target) && !event.target.closest('[data-shell-trigger]')) request('win11.panel.close', {}, { restoreFocus: false });
    }
    function focus(event) {
      if (event.target?.closest?.('[data-shell-switcher], [data-split-view-picker], [data-window-green-menu]')) return;
      const controlId = event.target instanceof Element && event.target.hasAttribute('data-shell-control') ? event.target.dataset.shellControl : null;
      if (controlId !== (shell.focusedControl?.controlId ?? null)) request('win11.shell.focus', { controlId });
    }
    function context(event) {
      if (event.target === workspace || event.target.closest?.('.win11-desktop-files')) desktopContext(event);
    }
    function keyboard(event) {
      if (!root.contains(document.activeElement)) return;
      if (event.defaultPrevented || event.target.closest?.('[data-desktop-rename], [data-desktop-context-item]')) return;
      if ((event.target === workspace || event.target === desktopSurface) && !(event.ctrlKey && event.key === 'Escape')) interactions.keydown(event);
      if (event.defaultPrevented) return;
      controlKey(event);
      if (event.target === workspace && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
        event.preventDefault(); request('win11.desktop.context.open', { fileId: null }, { x: 24, y: 24 });
      }
      if (event.key === 'Escape' && (shell.panel || shell.context || shell.dialog)) {
        event.preventDefault();
        if (shell.dialog) request('win11.dialog.close', { dialogId: 'properties' });
        else if (shell.panel) request('win11.panel.close');
        else request('win11.desktop.context.close', {}, { restoreFocus: true });
      }
      else if ((event.ctrlKey && event.key === 'Escape') || (event.metaKey && event.key.toLowerCase() === 's')) {
        event.preventDefault(); togglePanel(event.ctrlKey ? 'start' : 'search');
      } else if (event.metaKey && event.key.toLowerCase() === 'a' && !event.target.closest?.('.win11-desktop-files') && event.target !== workspace) { event.preventDefault(); togglePanel('quick'); }
      else if (event.key === 'Tab' && (shell.panel || shell.context || shell.dialog)) {
        const surface = shell.dialog ? properties : shell.context ? contextMenu : panel;
        const items = [...surface.querySelectorAll('button,input,[tabindex="0"]')].filter((element) => !element.disabled);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); request('win11.shell.focus', { controlId: last.dataset.shellControl }); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); request('win11.shell.focus', { controlId: first.dataset.shellControl }); }
      }
    }
    document.addEventListener('pointerdown', outside); document.addEventListener('contextmenu', context); document.addEventListener('focusin', focus); document.addEventListener('keydown', keyboard);
    return () => { interactions.dispose(); cleanup?.(); observer.disconnect(); document.removeEventListener('pointerdown', outside); document.removeEventListener('contextmenu', context); document.removeEventListener('focusin', focus); document.removeEventListener('keydown', keyboard); };
  });
</script>
<div bind:this={root} class="win11-desktop" class:win11-dark={native.apps.settings.theme === 'dark'} class:win11-glow={native.apps.settings.wallpaper === 'glow'} class:win11-flow={native.apps.settings.wallpaper === 'flow'} style:--win11-accent={native.apps.settings.accent}>
  <div bind:this={workspace} class="win11-workspace" data-shell-control="desktop" tabindex="-1" role="group" aria-label="Windows desktop" style:overflow={fullScreenStage.mode !== 'normal' ? 'visible' : undefined} onpointerdown={workspacePointer}>
    {#if shell.viewOptions.showIcons}
      <div bind:this={desktopSurface} class="win11-desktop-files" data-shell-scroll="desktop" onscroll={(event) => observeScroll(event, 'desktop')} inert={Boolean(shell.dialog) || fullScreenStage.mode !== 'normal'} style:--desktop-icon-size="{shell.viewOptions.iconSize}px">
        {#each files as file (file.id)}
          <div class="win11-desktop-entry" style:transform={shell.positions[file.id] ? `translate(${shell.positions[file.id].x}px, ${shell.positions[file.id].y}px)` : undefined}>
            <button class="win11-desktop-file" class:selected={shell.selectedFileIds.includes(file.id)} aria-pressed={shell.selectedFileIds.includes(file.id)} data-file-id={file.id} data-folder-id={file.folderId} data-shell-control="file:{file.id}" onclick={(event) => interactions.click(event, file.id)} onpointerdown={(event) => interactions.pointerdown(event, file.id)} ondblclick={() => request('win11.desktop.open', { fileId: file.id })} oncontextmenu={(event) => desktopContext(event, file.id)} onkeydown={(event) => desktopKey(event, file.id)}>
              <Windows11Icon name={file.icon} size={shell.viewOptions.iconSize}/><span style:visibility={shell.rename?.fileId === file.id ? 'hidden' : undefined}>{file.name}</span>
            </button>
            {#if shell.rename?.fileId === file.id}
              <input class="win11-desktop-rename" data-desktop-rename aria-label="Rename {file.name}" value={shell.rename.name} onpointerdown={(event) => event.stopPropagation()} onclick={(event) => event.stopPropagation()} oncontextmenu={(event) => event.stopPropagation()} onkeydown={renameKey} oninput={(event) => { event.currentTarget.setCustomValidity(''); request('win11.desktop.rename.change', {}, { name: event.currentTarget.value }); }} onblur={() => { if (shell.rename?.fileId === file.id && itemsAvailable()) request('win11.desktop.rename.commit'); }}/>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if shell.marquee && shell.viewOptions.showIcons && !shell.dialog}
      <div class="win11-desktop-marquee" aria-hidden="true" style:left="{shell.marquee.x}px" style:top="{shell.marquee.y}px" style:width="{shell.marquee.width}px" style:height="{shell.marquee.height}px"></div>
    {/if}
    <div class="win11-window-layer" inert={Boolean(shell.dialog)}>{@render children()}</div>
    {#if shell.context}
      <div bind:this={contextMenu}>
        <Windows11DesktopContextMenu context={shell.context} items={contextItems} {execute} {measureWorkspace} {contextArea}/>
      </div>
    {/if}
    {#if shell.dialog}
      <div class="win11-dialog-backdrop"><div bind:this={properties} class="win11-properties win11-flyout" role="dialog" aria-modal="true" aria-label="Properties" data-shell-scroll="properties" onscroll={(event) => observeScroll(event, 'properties')}>
        {#if propertyInfo}
          <h2>{propertyInfo.name} Properties</h2><Windows11Icon name={propertyInfo.icon} size={48}/>
          <dl><dt>Type</dt><dd>{propertyInfo.kind}</dd><dt>Location</dt><dd>{propertyInfo.parentName}</dd><dt>Path</dt><dd>{propertyInfo.path}</dd>
            {#if propertyInfo.itemCount !== null && propertyInfo.itemCount !== undefined}<dt>Contains</dt><dd>{propertyInfo.itemCount} items</dd>{/if}
            {#if propertyInfo.size !== null && propertyInfo.size !== undefined}<dt>Size</dt><dd>{propertyInfo.size} bytes</dd>{/if}
            {#if propertyInfo.revision !== null && propertyInfo.revision !== undefined}<dt>Revision</dt><dd>{propertyInfo.revision}</dd>{/if}
            {#if propertyInfo.deleted}<dt>Status</dt><dd>In Recycle Bin</dd>{/if}
          </dl><p>This item belongs to the fictional scene, not your computer.</p>
        {:else}<h2>Properties</h2><p>This item is no longer available.</p>{/if}
        <button data-shell-control="properties-close" onclick={() => request('win11.dialog.close', { dialogId: 'properties' })}>OK</button>
      </div></div>
    {/if}
  </div>
  {#if shell.panel}
    <div bind:this={panel} class="win11-panel win11-flyout" class:win11-panel-centered={shell.panel === 'start' || shell.panel === 'search'} class:win11-panel-side={shell.panel === 'quick' || shell.panel === 'notifications'} role="dialog" aria-label={shell.panel === 'start' ? 'Start' : shell.panel === 'quick' ? 'Quick Settings' : shell.panel === 'notifications' ? 'Notification center and calendar' : 'Search'} tabindex="-1" data-shell-control="{shell.panel}-panel" data-shell-scroll="panel" onscroll={(event) => observeScroll(event, 'panel')}>
      {#if shell.panel === 'start' || shell.panel === 'search'}
        <div class="win11-search-field"><span aria-hidden="true">⌕</span><input data-shell-control="search-input" aria-label="Search for apps and local files" placeholder="Type here to search" value={shell.query} oninput={(event) => request('win11.search.set', {}, { query: event.currentTarget.value })} onkeydown={(event) => { if (event.key === 'Enter') { if (results[0]) request('win11.app.activate', { appId: results[0].id }); else if (fileResults[0]) request('win11.desktop.open', { fileId: fileResults[0].id }); } }}/></div>
        <div class="win11-start-scroll" data-shell-scroll={shell.panel} onscroll={(event) => { if (shell.scroll[shell.panel] !== event.currentTarget.scrollTop) request('win11.shell.scroll', { area: shell.panel }, { top: event.currentTarget.scrollTop }); }}>
          {#if shell.query || shell.panel === 'search'}
            <h3>{shell.query ? 'Best match' : 'Apps'}</h3><div class="win11-app-list" data-keyboard-group>{#each results as app}<button data-shell-control="search-app:{app.id}" onclick={() => request('win11.app.activate', { appId: app.id })}><Windows11Icon name={app.icon} size={32}/><span>{app.name}<small>App · local simulation</small></span></button>{/each}
              {#each fileResults as file}<button data-shell-control="search-file:{file.id}" onclick={() => request('win11.desktop.open', { fileId: file.id })}><Windows11Icon name={file.icon} size={32}/><span>{file.name}<small>Local file</small></span></button>{/each}
              {#if !results.length && !fileResults.length}<p>No local results. Web search is not connected.</p>{/if}</div>
          {:else if shell.startPage === 'all-apps'}
            <div class="win11-panel-heading"><h3>All apps</h3><button data-shell-control="start-back" onclick={() => request('win11.start.page', {}, { page: 'pinned' })}>‹ Back</button></div>
            <div class="win11-app-list" data-keyboard-group>{#each [...apps].sort((a,b) => a.name.localeCompare(b.name)) as app}<button data-shell-control="all-app:{app.id}" onclick={() => request('win11.app.activate', { appId: app.id })}><Windows11Icon name={app.icon} size={28}/>{app.name}</button>{/each}</div>
          {:else}
            <div class="win11-panel-heading"><h3>Pinned</h3><button data-shell-control="start-all-apps" onclick={() => request('win11.start.page', {}, { page: 'all-apps' })}>All apps ›</button></div>
            <div class="win11-pinned-grid" data-keyboard-group>{#each apps as app}<button data-shell-control="pinned:{app.id}" onclick={() => request('win11.app.activate', { appId: app.id })}><Windows11Icon name={app.icon} size={34}/><span>{app.name}</span></button>{/each}</div>
            <h3>Recommended</h3>
            {#if files.some((file) => file.id === 'call-sheet')}
              <button class="win11-recommended" data-shell-control="recommended:call-sheet" onclick={() => request('win11.desktop.open', { fileId: 'call-sheet' })}><Windows11Icon name="text-file" size={32}/><span>{files.find((file) => file.id === 'call-sheet').name}<small>Recently opened · Local scene</small></span></button>
            {:else}<p>No recent local desktop documents.</p>{/if}
          {/if}
        </div>
        <footer class="win11-start-footer"><span class="win11-account-avatar" aria-hidden="true">AM</span><span>{profile.defaults.accountName}</span><span class="win11-local-account">Local account</span><button disabled title="Host power and session actions are intentionally unavailable" aria-label="Power unavailable in local scene">⏻</button></footer>
      {:else if shell.panel === 'quick'}
        <div class="win11-quick-tiles" data-keyboard-group>{#each [['wifi','Wi-Fi','⌁'],['bluetooth','Bluetooth','ᛒ'],['airplane','Airplane mode','✈']] as item}<button class:enabled={shell.quick[item[0]]} data-shell-control="quick:{item[0]}" aria-pressed={shell.quick[item[0]]} onclick={() => request('win11.quick.set', { control: item[0] }, { value: !shell.quick[item[0]] })}><span aria-hidden="true">{item[2]}</span>{item[1]}</button>{/each}</div>
        <label class="win11-quick-slider"><span aria-hidden="true">☼</span><span class="win11-sr-only">Brightness</span><input data-shell-control="quick:brightness" aria-label="Fictional brightness" type="range" min="0" max="100" value={shell.quick.brightness} oninput={(event) => request('win11.quick.set', { control: 'brightness' }, { value: Number(event.currentTarget.value) })}/><output>{shell.quick.brightness}%</output></label>
        <label class="win11-quick-slider"><span aria-hidden="true">◖♪</span><span class="win11-sr-only">Volume</span><input data-shell-control="quick:volume" aria-label="Fictional volume" type="range" min="0" max="100" value={shell.quick.volume} oninput={(event) => request('win11.quick.set', { control: 'volume' }, { value: Number(event.currentTarget.value) })}/><output>{shell.quick.volume}%</output></label>
        <footer class="win11-quick-footer"><small>Local scene · no devices connected</small><button data-shell-control="quick-settings" aria-label="Open Settings" onclick={() => request('win11.app.activate', { appId: 'settings' })}><Windows11Icon name="settings" size={20}/></button></footer>
      {:else}
        <div class="win11-panel-heading"><h3>Notifications</h3><button data-shell-control="notification-dnd" aria-pressed={shell.doNotDisturb} title="Do not disturb (fictional)" onclick={() => request('win11.notification.doNotDisturb', {}, { enabled: !shell.doNotDisturb })}>{shell.doNotDisturb ? 'Do not disturb: On' : 'Do not disturb: Off'}</button></div>
        <div class="win11-notifications" data-shell-scroll="notifications" onscroll={(event) => observeScroll(event, 'notifications')}>{#each shell.notifications as notification}<article><button class="win11-notification-content" data-shell-control="notification:{notification.id}" onclick={() => request('win11.notification.open', { notificationId: notification.id })}><small>{profile.applications[notification.appId].name} · {notification.time}</small><strong>{notification.title}</strong><span>{notification.body}</span></button><button data-shell-control="notification-dismiss:{notification.id}" aria-label="Dismiss {notification.title}" onclick={() => request('win11.notification.dismiss', { notificationId: notification.id })}>×</button></article>{/each}{#if !shell.notifications.length}<p>No new notifications</p>{/if}</div>
        <button class="win11-clear-notifications" disabled={!shell.notifications.length} data-shell-control="notifications-clear" onclick={() => request('win11.notification.clear')}>Clear all</button>
        <div class="win11-calendar"><h3>Tuesday, October 31</h3><div class="win11-panel-heading"><strong>{monthLabel}</strong><button data-shell-control="calendar-prev" disabled={shell.calendar.year === 2020 && shell.calendar.month === 0} aria-label="Previous month" onclick={() => request('win11.calendar.move', {}, { direction: -1 })}>⌃</button><button data-shell-control="calendar-next" disabled={shell.calendar.year === 2030 && shell.calendar.month === 11} aria-label="Next month" onclick={() => request('win11.calendar.move', {}, { direction: 1 })}>⌄</button></div><div class="win11-calendar-grid" data-keyboard-group>{#each ['Su','Mo','Tu','We','Th','Fr','Sa'] as day}<span>{day}</span>{/each}{#each calendarDays as day}{#if day}<button class:today={dateId(day) === '2023-10-31'} class:selected={dateId(day) === shell.calendar.selectedDate} data-shell-control="date:{dateId(day)}" aria-label={dateId(day)} aria-pressed={dateId(day) === shell.calendar.selectedDate} onclick={() => request('win11.calendar.select', {}, { date: dateId(day) })}>{day}</button>{:else}<span></span>{/if}{/each}</div><small>Selected: {shell.calendar.selectedDate} · fictional date</small></div>
      {/if}
    </div>
  {/if}
  <footer bind:this={taskbar} class="win11-taskbar" aria-label="Taskbar" inert={Boolean(shell.dialog) || (fullScreenStage.mode !== 'normal' && !fullScreenStage.launcherRevealed)} style:visibility={fullScreenStage.mode !== 'normal' && !fullScreenStage.launcherRevealed ? 'hidden' : undefined} style:z-index={fullScreenStage.mode !== 'normal' ? 10000 : undefined} onpointerenter={() => { if (fullScreenStage.mode !== 'normal') onfullscreenreveal?.('launcher', true); }}>
    <div class="win11-taskbar-apps" data-keyboard-group data-shell-scroll="taskbar" onscroll={(event) => observeScroll(event, 'taskbar')}>
      <button data-shell-trigger data-shell-control="start-trigger" aria-label="Start" aria-expanded={shell.panel === 'start'} class:active={shell.panel === 'start'} onclick={() => togglePanel('start')}><Windows11Icon name="windows" size={26}/></button>
      <button class="win11-taskbar-search" data-shell-trigger data-shell-control="search-trigger" aria-label="Search" aria-expanded={shell.panel === 'search'} onclick={() => togglePanel('search')}><span aria-hidden="true">⌕</span><span class="win11-search-label">Search</span></button>
      {#each taskbarApps as app}{@const window = recentWindow(app.id)}<button class:running={runningAppIds.includes(app.id)} class:active={window?.id === activeWindowId && !window?.minimized} class:minimized={window?.minimized} data-app-id={app.id} data-shell-control="taskbar:{app.id}" aria-label="{app.name}{runningAppIds.includes(app.id) ? window?.minimized ? ' (minimized)' : ' (running)' : ''}" title={app.name} onclick={() => request('win11.taskbar.activate', { appId: app.id })}><Windows11Icon name={app.icon} size={26}/></button>{/each}
    </div>
    <div class="win11-system-tray"><button data-shell-trigger data-shell-control="quick-trigger" aria-label="Quick Settings" aria-expanded={shell.panel === 'quick'} onclick={() => togglePanel('quick')}><span aria-hidden="true">{shell.quick.airplane ? '✈' : shell.quick.wifi ? '⌁' : '⊗'} {shell.quick.volume ? '◖♪' : '◖×'}</span></button><button class="win11-clock-trigger" data-shell-trigger data-shell-control="notifications-trigger" aria-label="Notifications and calendar" aria-expanded={shell.panel === 'notifications'} onclick={() => togglePanel('notifications')}><span>{profile.defaults.clockLabel}</span><span>{profile.defaults.dateLabel}</span></button><button class="win11-show-desktop" data-shell-control="show-desktop" aria-label="Show desktop" title="Show desktop" onclick={() => request('win11.desktop.show')}></button></div>
  </footer>
</div>

<style>
  .win11-workspace { touch-action: none; }
  .win11-desktop-entry { position: relative; width: 86px; flex-shrink: 0; touch-action: none; user-select: none; }
  .win11-desktop-files { right: 4px; height: calc(100% - 20px); max-height: none; display: flex; flex-direction: column; flex-wrap: wrap; gap: 8px; align-content: flex-start; overflow: auto; }
  .win11-desktop-file { min-height: calc(var(--desktop-icon-size) + 40px); }
  .win11-desktop-rename { position: absolute; top: calc(var(--desktop-icon-size) + 11px); left: 2px; width: 82px; padding: 1px 2px; border: 1px solid #1565c0; background: white; color: #111 !important; text-align: center; font-size: 12px !important; z-index: 2; }
  .win11-properties dd { overflow-wrap: anywhere; }
  .win11-desktop-marquee { position: absolute; border: 1px solid #78b6ee; background: #4b9fe536; pointer-events: none; z-index: 1; }
</style>

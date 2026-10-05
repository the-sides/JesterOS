<script>
  import { onMount, tick } from 'svelte';
  import Windows11Icon from './Windows11Icon.svelte';
  import { windows11DesktopFiles } from './windows11-shell-state.js';
  import './windows11.css';
  let { profile, children, windows = [], runningAppIds = [], activeWindowId = null, activeApp, viewState, native, execute, registerView, onlayout } = $props();
  const shell = $derived(native.shell);
  const apps = $derived(Object.values(profile.applications));
  const desktopFiles = $derived(windows11DesktopFiles(profile, native.apps));
  const files = $derived(shell.sortByName ? [...desktopFiles].sort((a, b) => a.name.localeCompare(b.name)) : desktopFiles);
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
  let panel = $state(), contextMenu = $state(), properties = $state();
  function request(command, target = {}, payload = {}) { return execute({ command, target, payload }); }
  function recentWindow(appId) { return windows.findLast(window => window.appId === appId); }
  function togglePanel(panelId) { return shell.panel === panelId ? request('win11.panel.close') : request('win11.panel.open', { panelId }); }
  $effect(() => {
    if (shell.selectedFileId !== null && !files.some((file) => file.id === shell.selectedFileId)) request('win11.desktop.select', { fileId: null });
  });
  function measureWorkspace() { return { width: workspace?.clientWidth ?? 0, height: workspace?.clientHeight ?? 0 }; }
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
    const bounds = workspace.getBoundingClientRect();
    request('win11.desktop.context', { fileId }, { x: Math.max(0, event.clientX - bounds.left), y: Math.max(0, event.clientY - bounds.top) });
  }
  function dateId(day) { return `${shell.calendar.year}-${String(shell.calendar.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
  onMount(() => {
    const cleanup = registerView({ measureWorkspace, focusControl, controlIds: () => controls().map((element) => element.dataset.shellControl), scrollPanel, scrollAreas, scrollSnapshot });
    let previous = '';
    function reportLayout() {
      const area = measureWorkspace(), key = `${area.width}:${area.height}`;
      if (previous !== key) { previous = key; onlayout(area); }
    }
    const observer = new ResizeObserver(reportLayout); observer.observe(workspace); observer.observe(taskbar); reportLayout();
    function outside(event) {
      if (!(event.target instanceof Element)) return;
      if (shell.dialog && !properties?.contains(event.target)) return;
      if (event.button === 0 && event.target === workspace) request('win11.desktop.select', { fileId: null });
      if ((shell.context && !contextMenu?.contains(event.target)) || (shell.panel && !panel?.contains(event.target) && !event.target.closest('[data-shell-trigger]'))) request('win11.shell.dismiss');
    }
    function focus(event) {
      const controlId = event.target instanceof Element && event.target.hasAttribute('data-shell-control') ? event.target.dataset.shellControl : null;
      if (controlId !== (shell.focusedControl?.controlId ?? null)) request('win11.shell.focus', { controlId });
    }
    function context(event) {
      if (event.target === workspace || event.target.closest?.('.win11-desktop-files')) desktopContext(event);
    }
    function keyboard(event) {
      if (!root.contains(document.activeElement)) return;
      controlKey(event);
      if (event.target === workspace && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
        event.preventDefault(); request('win11.desktop.context', { fileId: null }, { x: 24, y: 24 });
      }
      if (event.key === 'Escape' && (shell.panel || shell.context || shell.dialog)) {
        event.preventDefault();
        if (shell.dialog) request('win11.dialog.close', { dialogId: 'properties' });
        else if (shell.panel) request('win11.panel.close');
        else request('win11.shell.dismiss', {}, { restoreFocus: true });
      } else if (event.key === 'Escape' && shell.selectedFileId) request('win11.desktop.select', { fileId: null });
      else if ((event.ctrlKey && event.key === 'Escape') || (event.metaKey && event.key.toLowerCase() === 's')) {
        event.preventDefault(); togglePanel(event.ctrlKey ? 'start' : 'search');
      } else if (event.metaKey && event.key.toLowerCase() === 'a') { event.preventDefault(); togglePanel('quick'); }
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
    return () => { cleanup?.(); observer.disconnect(); document.removeEventListener('pointerdown', outside); document.removeEventListener('contextmenu', context); document.removeEventListener('focusin', focus); document.removeEventListener('keydown', keyboard); };
  });
</script>
<div bind:this={root} class="win11-desktop" class:win11-dark={native.apps.settings.theme === 'dark'} class:win11-glow={native.apps.settings.wallpaper === 'glow'} class:win11-flow={native.apps.settings.wallpaper === 'flow'} style:--win11-accent={native.apps.settings.accent}>
  <div bind:this={workspace} class="win11-workspace" data-shell-control="desktop" tabindex="-1" role="group" aria-label="Windows desktop">
    {#if shell.showDesktopIcons}
      <div class="win11-desktop-files" data-keyboard-group data-shell-scroll="desktop" onscroll={(event) => observeScroll(event, 'desktop')} inert={Boolean(shell.dialog)}>
        {#each files as file (file.id)}
          <button class="win11-desktop-file" class:selected={shell.selectedFileId === file.id} data-file-id={file.id} data-shell-control="file:{file.id}" onclick={() => request('win11.desktop.select', { fileId: file.id })} ondblclick={() => request('win11.desktop.open', { fileId: file.id })} oncontextmenu={(event) => desktopContext(event, file.id)} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); request('win11.desktop.open', { fileId: file.id }); } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { const bounds = event.currentTarget.getBoundingClientRect(); desktopContext({ preventDefault() {}, stopPropagation() {}, clientX: bounds.right, clientY: bounds.top }, file.id); } }}>
            <Windows11Icon name={file.icon} size={44}/><span>{file.name}</span>
          </button>
        {/each}
      </div>
    {/if}
    <div class="win11-window-layer" inert={Boolean(shell.dialog)}>{@render children()}</div>
    {#if shell.context}
      <div bind:this={contextMenu} class="win11-context-menu win11-flyout" role="menu" aria-label="Desktop context menu" data-keyboard-group style:left="{shell.context.x}px" style:top="{shell.context.y}px">
        {#each (shell.context.fileId ? [['open','Open'],['properties','Properties']] : [['toggle-icons',shell.showDesktopIcons ? '✓ Show desktop icons' : 'Show desktop icons'],['sort-name','Sort by name'],['refresh','Refresh'],['personalize','Personalize']]) as item, i}
          <button role="menuitem" data-shell-control={i === 0 ? 'context-first' : `context:${item[0]}`} onclick={() => request('win11.desktop.action', { action: item[0] })}>{item[1]}</button>
        {/each}
      </div>
    {/if}
    {#if shell.dialog}
      {@const entry = files.find((file) => file.id === shell.dialog.fileId)}
      <div class="win11-dialog-backdrop"><div bind:this={properties} class="win11-properties win11-flyout" role="dialog" aria-modal="true" aria-label="Properties" data-shell-scroll="properties" onscroll={(event) => observeScroll(event, 'properties')}>
        {#if entry}
          <h2>{entry.name} Properties</h2><Windows11Icon name={entry.icon} size={48}/>
          <dl><dt>Type</dt><dd>{entry.folderId ? 'Virtual system folder' : entry.appId === 'photos' ? 'Image document' : 'Text document'}</dd><dt>Location</dt><dd>Local scene desktop</dd><dt>Opens with</dt><dd>{profile.applications[entry.appId].name}</dd></dl><p>This item belongs to the fictional scene, not your computer.</p>
        {:else}<h2>Properties</h2><p>This desktop entry is no longer available.</p>{/if}
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
  <footer bind:this={taskbar} class="win11-taskbar" aria-label="Taskbar" inert={Boolean(shell.dialog)}>
    <div class="win11-taskbar-apps" data-keyboard-group data-shell-scroll="taskbar" onscroll={(event) => observeScroll(event, 'taskbar')}>
      <button data-shell-trigger data-shell-control="start-trigger" aria-label="Start" aria-expanded={shell.panel === 'start'} class:active={shell.panel === 'start'} onclick={() => togglePanel('start')}><Windows11Icon name="windows" size={26}/></button>
      <button class="win11-taskbar-search" data-shell-trigger data-shell-control="search-trigger" aria-label="Search" aria-expanded={shell.panel === 'search'} onclick={() => togglePanel('search')}><span aria-hidden="true">⌕</span><span class="win11-search-label">Search</span></button>
      {#each taskbarApps as app}{@const window = recentWindow(app.id)}<button class:running={runningAppIds.includes(app.id)} class:active={window?.id === activeWindowId && !window?.minimized} class:minimized={window?.minimized} data-app-id={app.id} data-shell-control="taskbar:{app.id}" aria-label="{app.name}{runningAppIds.includes(app.id) ? window?.minimized ? ' (minimized)' : ' (running)' : ''}" title={app.name} onclick={() => request('win11.taskbar.activate', { appId: app.id })}><Windows11Icon name={app.icon} size={26}/></button>{/each}
    </div>
    <div class="win11-system-tray"><button data-shell-trigger data-shell-control="quick-trigger" aria-label="Quick Settings" aria-expanded={shell.panel === 'quick'} onclick={() => togglePanel('quick')}><span aria-hidden="true">{shell.quick.airplane ? '✈' : shell.quick.wifi ? '⌁' : '⊗'} {shell.quick.volume ? '◖♪' : '◖×'}</span></button><button class="win11-clock-trigger" data-shell-trigger data-shell-control="notifications-trigger" aria-label="Notifications and calendar" aria-expanded={shell.panel === 'notifications'} onclick={() => togglePanel('notifications')}><span>{profile.defaults.clockLabel}</span><span>{profile.defaults.dateLabel}</span></button><button class="win11-show-desktop" data-shell-control="show-desktop" aria-label="Show desktop" title="Show desktop" onclick={() => request('win11.desktop.show')}></button></div>
  </footer>
</div>

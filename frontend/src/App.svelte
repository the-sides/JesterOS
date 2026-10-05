<script>
  import Desktop from './Desktop.svelte';
  import MessagesWindow from './MessagesWindow.svelte';
  import NotesWindow from './NotesWindow.svelte';
  import { createNotesState } from './notes-state.js';
  import Window from './Window.svelte';
  import { applications } from './applications.js';
  import { clampPosition, fitNormalBounds, initialBounds, zoomBounds } from './window-state.js';

  let windows = $state([]);
  let activeWindowId = $state(null);
  let area = $state({ width: 0, height: 0 });
  // Application data outlives its window; close/minimize must not erase edits.
  let notesState = $state(createNotesState());
  let initialized = false;
  const activeApp = $derived(applications[windows.find((window) => window.id === activeWindowId)?.appId] ?? applications.finder);

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
  }

  function openWindow(appId, title) {
    const app = applications[appId];
    if (!app || !area.width || !area.height) return;
    const existing = windows.find((window) => window.appId === appId);
    if (existing) {
      if (title !== undefined) existing.title = title;
      focusWindow(existing.id);
      return;
    }
    windows.push({
      id: appId,
      appId,
      title: title ?? app.name,
      minimized: false,
      zoomed: false,
      bounds: initialBounds(app, area, (windows.length % 6) * 22, globalThis.innerHeight),
      restoreBounds: null,
    });
    activeWindowId = appId;
  }

  function focusRemaining() {
    activeWindowId = windows.findLast((window) => !window.minimized)?.id ?? null;
  }

  function closeWindow(id) {
    const index = windows.findIndex((window) => window.id === id);
    if (index < 0) return;
    windows.splice(index, 1);
    if (activeWindowId === id) focusRemaining();
  }

  function minimizeWindow(id) {
    const window = windows.find((window) => window.id === id);
    if (!window) return;
    window.minimized = true;
    if (activeWindowId === id) focusRemaining();
  }

  function zoomWindow(id) {
    const window = windows.find((window) => window.id === id);
    if (!window) return;
    focusWindow(id);
    if (window.zoomed) {
      window.bounds = fitNormalBounds(window.restoreBounds, applications[window.appId], area);
      window.restoreBounds = null;
      window.zoomed = false;
    } else {
      window.restoreBounds = window.bounds;
      window.bounds = zoomBounds(window.restoreBounds, area);
      window.zoomed = true;
    }
  }

  function moveWindow(id, x, y) {
    const window = windows.find((window) => window.id === id);
    if (window && !window.zoomed) window.bounds = clampPosition({ ...window.bounds, x, y }, area);
  }

  function layoutWindows(nextArea) {
    if (nextArea.width <= 0 || nextArea.height <= 0) return;
    area = nextArea;
    for (const window of windows) {
      const normal = fitNormalBounds(window.zoomed ? window.restoreBounds : window.bounds, applications[window.appId], area);
      if (window.zoomed) {
        window.restoreBounds = normal;
        window.bounds = zoomBounds(normal, area);
      } else {
        window.bounds = normal;
      }
    }
    if (!initialized) {
      initialized = true;
      openWindow('messages');
    }
  }
</script>

<Desktop
  {windows}
  {activeWindowId}
  {activeApp}
  onopen={openWindow}
  onfocus={focusWindow}
  onclose={closeWindow}
  onminimize={minimizeWindow}
  onzoom={zoomWindow}
  ondesktopfocus={() => { activeWindowId = null; }}
  onlayout={layoutWindows}
>
  {#each windows as window, index (window.id)}
    {#if !window.minimized}
      <Window
        {window}
        {area}
        active={activeWindowId === window.id}
        zIndex={index + 1}
        onfocus={() => focusWindow(window.id)}
        onclose={() => closeWindow(window.id)}
        onminimize={() => minimizeWindow(window.id)}
        onzoom={() => zoomWindow(window.id)}
        onmove={(x, y) => moveWindow(window.id, x, y)}
      >
        {#if window.appId === 'messages'}
          <MessagesWindow
            active={activeWindowId === window.id}
            zoomed={window.zoomed}
            onclose={() => closeWindow(window.id)}
            onminimize={() => minimizeWindow(window.id)}
            onzoom={() => zoomWindow(window.id)}
          />
        {:else if window.appId === 'notes'}
          <NotesWindow
            bind:state={notesState}
            active={activeWindowId === window.id}
            zoomed={window.zoomed}
            onclose={() => closeWindow(window.id)}
            onminimize={() => minimizeWindow(window.id)}
            onzoom={() => zoomWindow(window.id)}
          />
        {/if}
      </Window>
    {/if}
  {/each}
</Desktop>

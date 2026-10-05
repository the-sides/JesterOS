<script>
  import { onMount, tick } from 'svelte';
  import { createFeatureCommands, rejected } from './feature-commands.js';
  import { createWindowCommands } from './window-commands.js';
  import { createDesktopCommands } from './desktop-commands.js';
  import { createNotesCommands } from './notes-commands.js';
  import { commandCatalog } from './command-catalog.js';
  import Desktop from './Desktop.svelte';
  import MessagesWindow from './MessagesWindow.svelte';
  import NotesWindow from './NotesWindow.svelte';
  import { createNotesState, visibleNotes } from './notes-state.js';
  import Window from './Window.svelte';
  import { applications, desktopFiles } from './applications.js';
  import { clampPosition, fitNormalBounds, initialBounds, zoomBounds } from './window-state.js';

  let windows = $state([]);
  let activeWindowId = $state(null);
  let area = $state({ width: 0, height: 0 });
  // Application data outlives its window; close/minimize must not erase edits.
  let notesState = $state(createNotesState());
  let desktopState = $state({ selectedFileId: null, windowMenuOpen: false, windowMenuItem: null, windowMenuScrollTop: 0, focusedControl: null });
  let notesViewState = $state({ context: null, contextItem: null, focusedControl: null, scroll: { list: { top: 0, left: 0 }, editor: { top: 0, left: 0 } } });
  let desktopView = null;
  let notesView = null;
  let initialized = false;
  const activeApp = $derived(applications[windows.find((window) => window.id === activeWindowId)?.appId] ?? applications.finder);

  const handlers = {
    'app.open': async (target, payload) => {
      if (Object.keys(target).some((key) => key !== 'appId')
        || typeof target.appId !== 'string'
        || Object.keys(payload).some((key) => key !== 'title')
        || (payload.title !== undefined && typeof payload.title !== 'string')) {
        return rejected('invalid_arguments', 'app.open requires target.appId and an optional string payload.title.');
      }
      if (!Object.hasOwn(applications, target.appId)) return rejected('not_found', 'Application does not exist.');
      if (!area.width || !area.height) return rejected('unavailable', 'The desktop has not been laid out.');
      openWindow(target.appId, payload.title);
      await focusKeyboardWindow(target.appId);
      return { status: 'applied', target: { appId: target.appId, windowId: target.appId } };
    },
    'desktop.refreshLayout': (target, payload) => {
      if (Object.keys(target).length || Object.keys(payload).length) {
        return rejected('invalid_arguments', 'desktop.refreshLayout takes no target or payload fields.');
      }
      if (!desktopView) return rejected('unavailable', 'The desktop is not mounted.');
      const bounds = desktopView.measureWorkspace();
      if (!bounds.width || !bounds.height) return rejected('unavailable', 'The workspace has no visible area.');
      layoutWindows(bounds);
      return { status: 'applied', target: {} };
    },
  };
  Object.assign(handlers,
    createWindowCommands(() => windows, {
      focus: focusWindow, close: closeWindow, minimize: minimizeWindow, zoom: zoomWindow, move: moveWindow,
      focusKeyboard: focusKeyboardWindow,
    }),
    createDesktopCommands(desktopState, {
      getView: () => desktopView, getWindows: () => windows, getActiveWindowId: () => activeWindowId,
      focusDesktop,
      openApp: (target, payload) => handlers['app.open'](target, payload),
      windowAction: (command, target, payload) => handlers[command](target, payload),
    }),
    createNotesCommands(notesState, notesViewState, {
      getView: () => notesView, focusWindow: () => focusWindow('notes'),
      isVisible: () => windows.some((window) => window.appId === 'notes' && !window.minimized),
    }),
  );
  const commands = createFeatureCommands(handlers,
    () => $state.snapshot({ windows, activeWindowId, area, notes: notesState, desktop: desktopState, notesView: notesViewState }),
    settleCommands, commandCatalog, () => ({
      applications: Object.values(applications).map(({ id, name, dock }) => ({ appId: id, name, dock: dock ?? null })),
      desktopFiles: desktopFiles.map(({ id, name, appId }) => ({ fileId: id, name, appId })),
      windows: windows.map(({ id, appId, minimized, zoomed }) => ({ windowId: id, appId, minimized, zoomed })),
      menus: [{ menuId: 'window', itemIds: ['close', 'minimize', 'zoom', ...windows.map(({ id }) => `window:${id}`)] }],
      notes: {
        records: notesState.notes.map(({ id, deleted }) => ({ noteId: id, deleted })),
        eligibleIds: visibleNotes(notesState).map(({ id }) => id),
      },
    }));

  async function settleCommands() {
    await tick();
    // Focus, anchoring, editing and resizing can scroll before native scroll
    // events arrive. A completed command's snapshot must describe the live view.
    if (notesView) {
      for (const area of ['list', 'editor']) {
        const actual = notesView.scrollPosition(area);
        const previous = notesViewState.scroll[area];
        if (actual.top !== previous.top || actual.left !== previous.left) notesViewState.scroll[area] = actual;
      }
    }
    if (desktopView) desktopState.windowMenuScrollTop = desktopView.windowMenuScrollTop();
  }

  function registerDesktopView(view) {
    desktopView = view;
    return () => { if (desktopView === view) desktopView = null; };
  }

  function registerNotesView(view) {
    notesView = view;
    return () => { if (notesView === view) notesView = null; };
  }

  async function focusKeyboardWindow(id) {
    await tick();
    [...document.querySelectorAll('[data-window-id]')].find((element) => element.dataset.windowId === id)?.focus({ preventScroll: true });
  }

  function focusDesktop() {
    activeWindowId = null;
    desktopState.windowMenuOpen = false;
    desktopState.windowMenuItem = null;
    notesViewState.context = null;
    notesViewState.contextItem = null;
    notesViewState.focusedControl = null;
    if (document.activeElement?.closest('[data-window-id]')) document.activeElement.blur();
  }

  function windowCommand(command, id, payload = {}) {
    return commands.execute({ command, target: { windowId: id }, payload });
  }

  function toggleWindowZoom(id) {
    const window = windows.find((entry) => entry.id === id);
    return windowCommand('window.setZoomed', id, { zoomed: !window?.zoomed });
  }

  onMount(() => {
    globalThis.jesteros = commands;
    return () => {
      if (globalThis.jesteros === commands) delete globalThis.jesteros;
    };
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
    desktopState.windowMenuOpen = false;
    desktopState.windowMenuItem = null;
    desktopState.focusedControl = null;
    if (id !== 'notes') {
      notesViewState.context = null;
      notesViewState.contextItem = null;
      notesViewState.focusedControl = null;
    }
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
    desktopState.windowMenuOpen = false;
    desktopState.windowMenuItem = null;
    if (id === 'notes') clearNotesPresentation();
  }

  function minimizeWindow(id) {
    const window = windows.find((window) => window.id === id);
    if (!window) return;
    window.minimized = true;
    if (activeWindowId === id) focusRemaining();
    desktopState.windowMenuOpen = false;
    desktopState.windowMenuItem = null;
    if (id === 'notes') clearNotesPresentation();
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

  function clearNotesPresentation() {
    notesViewState.context = null;
    notesViewState.contextItem = null;
    notesViewState.focusedControl = null;
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
      handlers['app.open']({ appId: 'messages' }, {});
    }
  }
</script>

<Desktop
  {windows}
  {activeWindowId}
  {activeApp}
  viewState={desktopState}
  execute={commands.execute}
  registerView={registerDesktopView}
  onlayout={() => commands.execute({ command: 'desktop.refreshLayout' })}
>
  {#each windows as window, index (window.id)}
    {#if !window.minimized}
      <Window
        {window}
        active={activeWindowId === window.id}
        zIndex={index + 1}
        onfocus={() => windowCommand('window.focus', window.id, { keyboard: false })}
        onclose={() => windowCommand('window.close', window.id)}
        onminimize={() => windowCommand('window.setMinimized', window.id, { minimized: true })}
        onzoom={() => toggleWindowZoom(window.id)}
        onmove={(x, y) => windowCommand('window.move', window.id, { x, y })}
      >
        {#if window.appId === 'messages'}
          <MessagesWindow
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
        {/if}
      </Window>
    {/if}
  {/each}
</Desktop>

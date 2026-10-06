<script>
  import { onMount, tick, untrack } from 'svelte';
  import App from './App.svelte';
  import MacSessionSurface from './MacSessionSurface.svelte';
  import { createFeatureCommands, rejected } from './feature-commands.js';
  import { commandCatalog } from './command-catalog.js';
  import { fictionalSessionDefaults, createFictionalSessionCommands, sessionTargets } from './fictional-session.js';

  let { profile: profileInput, adapter: adapterInput, registerCommands, selectProfile } = $props();
  const profile = untrack(() => profileInput), adapter = untrack(() => adapterInput);
  let session = $state(fictionalSessionDefaults(profile));
  let retainedIds = $state(['local-alex']);
  let disposed = false;
  const controllers = new Map(), scenes = new Map(), menuViews = new Map(), desktopReturns = new Map(), menuReturns = new Map();
  let surfaceView = null;
  const interactive = () => session.phase === 'desktop' && !session.guestConfirmation;
  const activeController = () => controllers.get(session.activeUserId);
  const menuKey = (userId, menuId) => `${userId}/${menuId}`;
  function registerDesktop(userId, controller) {
    controllers.set(userId, controller);
    return () => { if (controllers.get(userId) === controller) controllers.delete(userId); };
  }
  function registerScene(userId, facade) {
    scenes.set(userId, facade);
    return () => { if (scenes.get(userId) === facade) scenes.delete(userId); };
  }
  function registerNativeView(userId, view) {
    if (view.kind === 'surface') {
      surfaceView = view;
      return () => { if (surfaceView === view) surfaceView = null; };
    }
    const key = menuKey(userId, view.menuId);
    menuViews.set(key, view);
    return () => { if (menuViews.get(key) === view) menuViews.delete(key); };
  }
  const settle = async () => { await tick(); await tick(); };
  async function ensureDesktop(userId) {
    if (!retainedIds.includes(userId)) retainedIds.push(userId);
    await settle();
    return await scenes.get(userId)?.ready() === true && controllers.has(userId);
  }
  async function discardDesktop(userId) {
    retainedIds = retainedIds.filter(id => id !== userId);
    desktopReturns.delete(userId);
    for (const key of menuReturns.keys()) if (key.startsWith(`${userId}/`)) menuReturns.delete(key);
    await settle();
  }
  const operations = createFictionalSessionCommands({ profile, session, available: () => !disposed, settle,
    captureDesktop: userId => { const scene = scenes.get(userId); if (scene) desktopReturns.set(userId, scene.capture()); },
    restoreDesktop: async userId => { await settle(); return await scenes.get(userId)?.restore(desktopReturns.get(userId)) === true; },
    ensureDesktop, discardDesktop,
    captureMenuFocus: menuId => { const scene = scenes.get(session.activeUserId); if (scene) menuReturns.set(menuKey(session.activeUserId, menuId), scene.capture()); },
    restoreMenuFocus: async menuId => {
      await settle();
      const key = menuKey(session.activeUserId, menuId), token = menuReturns.get(key);
      menuReturns.delete(key);
      if (token && await scenes.get(session.activeUserId)?.restore(token)) return true;
      return await menuViews.get(key)?.focus('invoker') === true;
    },
    getMenuView: menuId => menuViews.get(menuKey(session.activeUserId, menuId)), getSurfaceView: () => surfaceView,
  });
  const catalog = Object.fromEntries(Object.entries(commandCatalog).filter(([, descriptor]) => descriptor.profiles.includes(profile.id)));
  const handlers = Object.fromEntries(Object.keys(catalog).map(name => [name, operations[name] ?? ((target, payload) => {
    if (disposed || (!interactive() && name !== 'scene.selectProfile')) return rejected('unavailable', 'Unlock the fictional desktop before interacting with its apps or shell.');
    const controller = activeController();
    return controller ? controller.execute({ command: name, target, payload }) : rejected('unavailable', 'The retained desktop is being prepared.');
  })]));
  const commands = createFeatureCommands(handlers,
    () => ({ ...(activeController()?.inspect().state ?? { profile }), session: $state.snapshot(session) }), settle,
    catalog, () => {
      const targets = activeController()?.describe().targets ?? {};
      if (!interactive() && targets.windows) targets.windows = targets.windows.map(window => ({ ...window,
        presentationInteractive: false, ...(session.phase !== 'desktop' ? { presentationVisible: false } : {}),
        ...(window.resize ? { resize: { ...window.resize, available: false } } : {}) }));
      return { ...targets, session: sessionTargets(session, surfaceView,
        session.menu ? menuViews.get(menuKey(session.activeUserId, session.menu.menuId)) : null) };
    }, () => disposed ? null : profile, commandCatalog);
  let queue = Promise.resolve();
  function execute(request) {
    const result = queue.then(() => commands.execute(request));
    queue = result.catch(() => {});
    return result;
  }
  const publicCommands = Object.freeze({ execute, inspect: commands.inspect, describe: commands.describe });
  $effect(() => {
    document.documentElement.dataset.sessionPhase = session.phase;
    return () => { delete document.documentElement.dataset.sessionPhase; };
  });
  onMount(() => {
    const unregister = registerCommands(publicCommands);
    function keyboard(event) {
      if (event.defaultPrevented || event.isComposing || !interactive()) return;
      const key = event.key.toLowerCase();
      const alias = event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.key === 'F7';
      const native = event.ctrlKey && event.metaKey && !event.shiftKey && !event.altKey && key === 'q';
      if (!alias && !native) return;
      event.preventDefault(); event.stopImmediatePropagation(); void execute({ command: 'session.lock' });
    }
    window.addEventListener('keydown', keyboard, true);
    return () => { disposed = true; unregister(); window.removeEventListener('keydown', keyboard, true); };
  });
</script>

<div class="session-host" data-session-host>
  {#each retainedIds as userId (userId)}
    <div class="session-desktop" class:inactive={userId !== session.activeUserId}
      data-session-user={userId} inert={userId !== session.activeUserId || !interactive()} aria-hidden={userId !== session.activeUserId || !interactive()}>
      <App {profile} {adapter} {selectProfile} registerCommands={controller => registerDesktop(userId, controller)}
        registerSessionScene={facade => registerScene(userId, facade)}
        registerSessionView={view => registerNativeView(userId, view)}
        {session} executeSession={execute} user={session.users.find(user => user.id === userId)}
        foreground={userId === session.activeUserId && interactive()} appearanceOwner={userId === session.activeUserId}
        windowNamespace={userId === 'local-alex' ? '' : `${userId}--`} />
    </div>
  {/each}
  {#if session.phase !== 'desktop' || session.guestConfirmation}
    <MacSessionSurface {profile} {session} {execute} registerView={view => registerNativeView(null, view)} />
  {/if}
</div>

<style>
  .session-host, .session-desktop { position: absolute; inset: 0; }
  .session-host { overflow: clip; }
  .session-desktop.inactive { visibility: hidden; opacity: 0; pointer-events: none; }
</style>

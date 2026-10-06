<script>
  import { onMount, tick, untrack } from 'svelte';
  import App from './App.svelte';
  import MacSessionSurface from './MacSessionSurface.svelte';
  import MacPowerSurface from './MacPowerSurface.svelte';
  import { createFeatureCommands, rejected } from './feature-commands.js';
  import { commandCatalog } from './command-catalog.js';
  import { fictionalSessionDefaults, createFictionalSessionCommands, sessionTargets, signOutFictionalSessions } from './fictional-session.js';
  import { fictionalPowerDefaults, createFictionalPowerCommands, powerTargets } from './fictional-power.js';
  import { createSceneSeedCommands } from './scene-seed.js';
  import { createSavedSessionCommands, clearSavedSession, savedSessionStorageKey } from './saved-session.js';

  let { profile: profileInput, adapter: adapterInput, seed: seedInput, seedSource = 'default', savedSession: savedSessionInput,
    resetScene, restoreScene, registerCommands, selectProfile } = $props();
  const profile = untrack(() => profileInput), adapter = untrack(() => adapterInput);
  const seed = untrack(() => seedInput);
  const savedSession = untrack(() => savedSessionInput);
  const initialSession = fictionalSessionDefaults(profile);
  if (savedSession) signOutFictionalSessions(initialSession);
  let session = $state(initialSession);
  let power = $state(fictionalPowerDefaults(profile));
  let retainedIds = $state(savedSession?.locals.map(local => local.userId) ?? ['local-alex']);
  let disposed = false;
  const controllers = new Map(), scenes = new Map(), menuViews = new Map(), desktopReturns = new Map(), menuReturns = new Map();
  let surfaceView = null, powerView = null, powerReturn = null;
  const powerAvailable = () => !disposed && power.phase === 'awake' && !power.pending;
  const interactive = () => powerAvailable() && session.phase === 'desktop' && !session.guestConfirmation;
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
  function registerPowerView(view) {
    powerView = view;
    return () => { if (powerView === view) powerView = null; };
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
  function capturePowerReturn() {
    const userId = session.activeUserId;
    if (session.phase === 'desktop') {
      const token = scenes.get(userId)?.capture();
      if (token) desktopReturns.set(userId, token);
      powerReturn = { userId, desktop: token };
    } else powerReturn = { surface: surfaceView?.capture() };
  }
  async function restorePowerReturn() {
    await settle();
    const token = powerReturn; powerReturn = null;
    if (!token) return false;
    return token.desktop ? await scenes.get(token.userId)?.restore(token.desktop) === true
      : surfaceView?.restore(token.surface) === true;
  }
  async function signOutForBoot() {
    signOutFictionalSessions(session);
    if (retainedIds.includes('guest')) await discardDesktop('guest');
    powerReturn = null;
    await settle();
  }
  const operations = createFictionalSessionCommands({ profile, session, available: powerAvailable, settle,
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
    invokePower: name => powerOperations[name]({}, {}),
  });
  const powerOperations = createFictionalPowerCommands({ profile, power, session, available: () => !disposed,
    settle, getView: () => powerView, captureReturn: capturePowerReturn, restoreReturn: restorePowerReturn,
    lockSession: () => operations['session.lock']({}, {}), signOutForBoot });
  function clearStoredSession() {
    try {
      const result = clearSavedSession(globalThis.localStorage, profile);
      return result.ok ? { status: 'applied' } : rejected('unavailable', result.message);
    } catch {
      return rejected('unavailable', 'Browser-local saved-session storage is unavailable.');
    }
  }
  async function captureSavedSession() {
    const locals = [];
    for (const userId of retainedIds.filter(id => id !== 'guest')) {
      const scene = scenes.get(userId);
      if (!scene || await scene.ready() !== true) throw new Error('A retained local desktop did not finish startup.');
      locals.push({ userId, scene: await scene.persist(desktopReturns.get(userId)?.focus?.node) });
    }
    return { version: 1, profileId: profile.id, baseline: { source: seedSource, seed }, locals };
  }
  const savedOperations = createSavedSessionCommands({ profile, available: () => !disposed, storage: () => globalThis.localStorage,
    beforeCapture: () => retainedIds.filter(id => id !== 'guest').every(id => scenes.get(id)?.canSave())
      ? { status: 'applied' } : rejected('unavailable', 'Finish retained local window pairing or application quit before saving.'),
    capture: captureSavedSession, replace: value => restoreScene(value) });
  const seedOperations = createSceneSeedCommands({ profile, available: () => !disposed,
    beforeReset: clearStoredSession, replaceScene: (value, source) => resetScene(value, source) });
  const catalog = Object.fromEntries(Object.entries(commandCatalog).filter(([, descriptor]) => descriptor.profiles.includes(profile.id)));
  const handlers = Object.fromEntries(Object.keys(catalog).map(name => [name, operations[name] ?? powerOperations[name] ?? seedOperations[name] ?? savedOperations[name] ?? ((target, payload) => {
    if (disposed || (!interactive() && name !== 'scene.selectProfile')) return rejected('unavailable', 'Wake/start and sign in before interacting with the fictional desktop.');
    const controller = activeController();
    return controller ? controller.execute({ command: name, target, payload }) : rejected('unavailable', 'The retained desktop is being prepared.');
  })]));
  const commands = createFeatureCommands(handlers,
    () => ({ ...(activeController()?.inspect().state ?? { profile }), session: $state.snapshot(session), power: $state.snapshot(power),
      sceneSeed: { source: seedSource, seed: structuredClone(seed) } }), settle,
    catalog, () => {
      const targets = activeController()?.describe().targets ?? {};
      if (!interactive() && targets.windows) targets.windows = targets.windows.map(window => ({ ...window,
        presentationInteractive: false, ...(session.phase !== 'desktop' || power.phase !== 'awake' ? { presentationVisible: false } : {}),
        ...(window.resize ? { resize: { ...window.resize, available: false } } : {}) }));
      return { ...targets, session: { ...sessionTargets(session, surfaceView,
        session.menu ? menuViews.get(menuKey(session.activeUserId, session.menu.menuId)) : null), desktopAvailable: interactive(),
        boundaries: { ...sessionTargets(session).boundaries, savedSessions: true, guestSaved: false, credentialsSaved: false } },
        power: powerTargets(power, powerView),
        savedSession: { version: 1, storageKey: savedSessionStorageKey(profile), automaticSave: false, automaticRestore: false,
          localUsersOnly: true, guestSaved: false, credentialsSaved: false, restorePhase: 'login', reset: 'scene.reset',
          commands: ['scene.session.save', 'scene.session.restore', 'scene.session.clear'] },
        sceneSeed: { source: seedSource, seed, completeReplacement: true,
          boundaries: { operatorDesktopControls: false, persistence: false, hostServices: false, profileIdentityChange: false } } };
    }, () => disposed ? null : profile, commandCatalog);
  let queue = Promise.resolve();
  function execute(request) {
    const result = queue.then(() => disposed
      ? { ...rejected('unavailable', 'The fictional scene has been replaced.'),
        ...(typeof request?.requestId === 'string' ? { requestId: request.requestId } : {}) }
      : commands.execute(request));
    queue = result.catch(() => {});
    return result;
  }
  const publicCommands = Object.freeze({ execute, inspect: commands.inspect, describe: commands.describe,
    ready: async () => (await Promise.all(retainedIds.map(userId => scenes.get(userId)?.ready() ?? false))).every(Boolean) });
  $effect(() => {
    document.documentElement.dataset.sessionPhase = session.phase;
    return () => { delete document.documentElement.dataset.sessionPhase; };
  });
  $effect(() => {
    document.documentElement.dataset.powerPhase = power.phase;
    return () => { delete document.documentElement.dataset.powerPhase; };
  });
  $effect(() => {
    if (power.phase !== 'saver' && power.phase !== 'booting') return;
    const timer = window.setInterval(() => {
      if (!disposed && !document.hidden && (power.phase === 'saver' || power.phase === 'booting')) {
        void execute({ command: 'power.advance', payload: { seconds: 1 } });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  });
  onMount(() => {
    const unregister = registerCommands(publicCommands);
    function keyboard(event) {
      if (disposed || event.defaultPrevented || event.isComposing || power.pending) return;
      const key = event.key.toLowerCase();
      const alias = event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
      let command;
      if ((power.phase === 'saver' || power.phase === 'sleeping') && !['control', 'shift', 'alt', 'meta'].includes(key)) command = 'power.wake';
      else if (power.phase === 'off' && (alias && event.key === 'F4' || key === 'enter' || key === ' ')) command = 'power.start';
      else if (powerAvailable() && !session.guestConfirmation && alias && event.key === 'F5') command = 'power.screenSaver.start';
      else if (powerAvailable() && !session.guestConfirmation && alias && event.key === 'F6') command = 'power.sleep';
      else if (interactive() && (alias && event.key === 'F7'
        || event.ctrlKey && event.metaKey && !event.shiftKey && !event.altKey && key === 'q')) command = 'session.lock';
      if (!command) return;
      event.preventDefault(); event.stopImmediatePropagation(); void execute({ command });
    }
    window.addEventListener('keydown', keyboard, true);
    return () => { disposed = true; unregister(); window.removeEventListener('keydown', keyboard, true); };
  });
</script>

<div class="session-host" data-session-host>
  {#each retainedIds as userId (userId)}
    <div class="session-desktop" class:inactive={userId !== session.activeUserId}
      data-session-user={userId} inert={userId !== session.activeUserId || !interactive()} aria-hidden={userId !== session.activeUserId || !interactive()}>
      <App {profile} {adapter} {seed} savedScene={savedSession?.locals.find(local => local.userId === userId)?.scene}
        {selectProfile} registerCommands={controller => registerDesktop(userId, controller)}
        registerSessionScene={facade => registerScene(userId, facade)}
        registerSessionView={view => registerNativeView(userId, view)}
        {session} executeSession={execute} user={session.users.find(user => user.id === userId)}
        foreground={userId === session.activeUserId && interactive()} appearanceOwner={userId === session.activeUserId}
        windowNamespace={userId === 'local-alex' ? '' : `${userId}--`} />
    </div>
  {/each}
  {#if power.phase === 'awake' && (session.phase !== 'desktop' || session.guestConfirmation)}
    <div class="session-presentation" inert={Boolean(power.pending)} aria-hidden={Boolean(power.pending)}>
      <MacSessionSurface {profile} {session} {execute} registerView={view => registerNativeView(null, view)} />
    </div>
  {/if}
  {#if power.phase !== 'awake' || power.pending}
    <MacPowerSurface {profile} {power} {session} {execute} registerView={registerPowerView} />
  {/if}
</div>

<style>
  .session-host, .session-desktop, .session-presentation { position: absolute; inset: 0; }
  .session-host { overflow: clip; }
  .session-desktop.inactive { visibility: hidden; opacity: 0; pointer-events: none; }
</style>

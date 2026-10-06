<script>
  import { onMount, tick, untrack } from 'svelte';
  import App from './App.svelte';
  import MacSessionSurface from './MacSessionSurface.svelte';
  import MacPowerSurface from './MacPowerSurface.svelte';
  import { createFeatureCommands, isRecord, rejected } from './feature-commands.js';
  import { commandCatalog } from './command-catalog.js';
  import { fictionalSessionDefaults, createFictionalSessionCommands, sessionTargets, sessionMenuItems, signOutFictionalSessions } from './fictional-session.js';
  import { fictionalPowerDefaults, createFictionalPowerCommands, powerTargets } from './fictional-power.js';
  import { createSceneSeedCommands } from './scene-seed.js';
  import { createSavedSessionCommands, clearSavedSession, savedSessionStorageKey } from './saved-session.js';
  import { menuBarDefaults, createMenuBarCommands, menuBarTargets, menuBarRequest } from './menu-bar.js';
  import { helpMenuProviders } from './help-menu-model.js';
  import { appleMenuItems } from './apple-menu.js';

  let { profile: profileInput, adapter: adapterInput, seed: seedInput, seedSource = 'default', savedSession: savedSessionInput,
    resetScene, restoreScene, registerCommands, selectProfile } = $props();
  const profile = untrack(() => profileInput), adapter = untrack(() => adapterInput);
  const seed = untrack(() => seedInput);
  const savedSession = untrack(() => savedSessionInput);
  const initialSession = fictionalSessionDefaults(profile);
  if (savedSession) signOutFictionalSessions(initialSession);
  let session = $state(initialSession);
  let power = $state(fictionalPowerDefaults(profile));
  let menuBar = $state(menuBarDefaults());
  let sceneRevision = $state(0);
  let appleOption = $state(false);
  let menuLifecycle = null;
  const menuDefinitions = $derived.by(sharedMenuDefinitions);
  let retainedIds = $state(savedSession?.locals.map(local => local.userId) ?? ['local-alex']);
  let disposed = false;
  const controllers = new Map(), scenes = new Map(), menuViews = new Map(), desktopReturns = new Map();
  let surfaceView = null, powerView = null, powerReturn = null;
  const powerAvailable = () => !disposed && power.phase === 'awake' && !power.pending;
  const interactive = () => powerAvailable() && session.phase === 'desktop' && !session.logoutPending;
  const activeController = () => controllers.get(session.activeUserId);
  const menuKey = (userId, menuId) => `${userId}/${menuId}`;
  function registerDesktop(userId, controller) {
    controllers.set(userId, controller);
    return () => { if (controllers.get(userId) === controller) controllers.delete(userId); };
  }
  function registerScene(userId, facade) {
    scenes.set(userId, facade); sceneRevision++;
    return () => { if (scenes.get(userId) === facade) { scenes.delete(userId); sceneRevision++; } };
  }
  function registerNativeView(userId, view) {
    if (view.kind === 'surface') {
      surfaceView = view;
      return () => { if (surfaceView === view) surfaceView = null; };
    }
    const keys = view.menuIds.map(menuId => menuKey(userId, menuId));
    for (const key of keys) menuViews.set(key, view);
    return () => { for (const key of keys) if (menuViews.get(key) === view) menuViews.delete(key); };
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
    await settle();
  }
  function capturePowerReturn() {
    const userId = session.activeUserId;
    if (session.phase === 'desktop') {
      const token = menuLifecycle?.getReturnFocus() ?? scenes.get(userId)?.capture();
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
    captureDesktop: userId => {
      const token = menuLifecycle?.getReturnFocus() ?? scenes.get(userId)?.capture();
      if (token) desktopReturns.set(userId, token);
    },
    restoreDesktop: async userId => { await settle(); return await scenes.get(userId)?.restore(desktopReturns.get(userId)) === true; },
    ensureDesktop, discardDesktop,
    getSurfaceView: () => surfaceView,
  });
  const powerOperations = createFictionalPowerCommands({ profile, power, session, available: () => !disposed,
    settle, getView: () => powerView, captureReturn: capturePowerReturn, restoreReturn: restorePowerReturn,
    lockSession: () => operations['session.lock']({}, {}), signOutForBoot });
  function sharedMenuDefinitions() {
    sceneRevision;
    const local = scenes.get(session.activeUserId)?.menuProviders() ?? [];
    const activeName = session.users.find(user => user.id === session.activeUserId)?.name ?? '';
    const users = sessionMenuItems(profile, session, 'users').map(item => ({ ...item,
      ...(item.id.startsWith('user:') ? { radio: true } : {}),
      request: item.id === 'login' ? { command: 'session.login.open' }
        : { command: 'session.user.select', target: { userId: item.id.slice(5) } },
    }));
    const apple = appleMenuItems({ profile, session, option: appleOption,
      ...(scenes.get(session.activeUserId)?.appleMenuContext() ?? {}) });
    return helpMenuProviders([
      { menuId: 'apple', kind: 'apple', label: 'Apple menu', enabled: true, items: apple },
      ...local,
      { menuId: 'users', kind: 'users', label: activeName, enabled: session.fastUserSwitching, items: users },
    ], menuBar, profile);
  }
  async function invokeMenuRequest(request) {
    const { command, target = {}, payload = {} } = request;
    if (command === 'session.user.select') {
      const login = await operations['session.login.open']({}, {});
      if (login.status !== 'applied') return login;
    }
    const operation = appleOperations[command] ?? operations[command] ?? powerOperations[command];
    return operation ? operation(target, payload)
      : activeController()?.execute({ command, target, payload }) ?? rejected('unavailable', 'The retained desktop is being prepared.');
  }
  const appleOperations = {
    'menu.appleOption.set': (target, payload) => {
      if (!profile.capabilities.includes('shell.apple-menu')) return rejected('unsupported_profile', 'Only Golden Gate represents Apple-menu modifiers.');
      if (!isRecord(target) || Reflect.ownKeys(target).length || !isRecord(payload)
        || Reflect.ownKeys(payload).length !== 1 || typeof payload.enabled !== 'boolean') {
        return rejected('invalid_arguments', 'Use an empty target and {enabled:boolean}.');
      }
      if (disposed || payload.enabled && (!interactive() || scenes.get(session.activeUserId)?.menusAvailable() !== true)) {
        return rejected('unavailable', 'An interactive represented menu bar is required to hold Option.');
      }
      appleOption = payload.enabled;
      return { status: 'applied', target: { enabled: appleOption } };
    },
  };
  const menuOperations = createMenuBarCommands({
    profile, state: menuBar, getMenus: sharedMenuDefinitions,
    getView: menuId => menuViews.get(menuKey(session.activeUserId, menuId)),
    available: () => interactive() && scenes.get(session.activeUserId)?.menusAvailable() === true,
    settle, captureFocus: () => scenes.get(session.activeUserId)?.capture(),
    restoreFocus: token => scenes.get(session.activeUserId)?.restore(token),
    preparePresentation: () => scenes.get(session.activeUserId)?.prepareMenus(),
    restorePresentation: token => scenes.get(session.activeUserId)?.restoreMenus(token),
    invoke: invokeMenuRequest, registerLifecycle: lifecycle => { menuLifecycle = lifecycle; },
  });
  $effect(() => {
    const id = menuBar.menuId;
    if (!id) return;
    const provider = menuDefinitions.find(menu => menu.menuId === id);
    if (!interactive() || !provider?.enabled || scenes.get(session.activeUserId)?.menusAvailable() !== true
      || (provider.appId !== undefined && provider.appId !== menuBar.appId)) { menuLifecycle.clear(); return; }
    let items = provider.items;
    for (let level = 0; level < menuBar.levels.length; level++) {
      const selectedId = menuBar.levels[level].itemId;
      const selected = items.find(item => item.id === selectedId);
      const last = level === menuBar.levels.length - 1;
      const valid = selectedId === null ? !items.some(item => item.enabled && !item.separator)
        : selected?.enabled && !selected.separator && (last || selected.children);
      if (!valid) {
        const levels = menuBar.levels;
        const request = menuBarRequest(last ? 'navigate' : 'close', id, menuDefinitions, { key: 'Home' });
        // A disabled native button loses focus. Recover only this unchanged path;
        // never overwrite a later actor selection or revive a dismissed menu.
        queueMicrotask(() => { if (menuBar.menuId === id && menuBar.levels === levels) void execute(request); });
        return;
      }
      if (!last) items = selected.children;
    }
  });
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
      const focus = userId === session.activeUserId ? menuLifecycle?.getReturnFocus()?.focus : null;
      locals.push({ userId, scene: await scene.persist(focus?.node ?? desktopReturns.get(userId)?.focus?.node) });
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
  const handlers = Object.fromEntries(Object.keys(catalog).map(name => [name, appleOperations[name] ?? menuOperations[name] ?? operations[name] ?? powerOperations[name] ?? seedOperations[name] ?? savedOperations[name] ?? ((target, payload) => {
    if (disposed || (!interactive() && name !== 'scene.selectProfile')) return rejected('unavailable', 'Wake/start and sign in before interacting with the fictional desktop.');
    const controller = activeController();
    return controller ? controller.execute({ command: name, target, payload }) : rejected('unavailable', 'The retained desktop is being prepared.');
  })]));
  const commands = createFeatureCommands(handlers,
    () => ({ ...(activeController()?.inspect().state ?? { profile }), session: $state.snapshot(session), power: $state.snapshot(power),
      menuBar: { ...$state.snapshot(menuBar), appleOption },
      sceneSeed: { source: seedSource, seed: structuredClone(seed) } }), settle,
    catalog, () => {
      const targets = activeController()?.describe().targets ?? {};
      if (!interactive() && targets.windows) targets.windows = targets.windows.map(window => ({ ...window,
        presentationInteractive: false, ...(session.phase !== 'desktop' || power.phase !== 'awake' ? { presentationVisible: false } : {}),
        ...(window.resize ? { resize: { ...window.resize, available: false } } : {}) }));
      return { ...targets, menuBar: { ...menuBarTargets(menuBar, sharedMenuDefinitions(),
        menuId => menuViews.get(menuKey(session.activeUserId, menuId))), appleOption }, session: { ...sessionTargets(session, surfaceView), desktopAvailable: interactive(),
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
      if (disposed || event.defaultPrevented || event.isComposing) return;
      const key = event.key.toLowerCase();
      if (key === 'alt' && interactive()) {
        void execute({ command: 'menu.appleOption.set', payload: { enabled: true } });
        return;
      }
      if (power.pending) return;
      const alias = event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey;
      let command, payload;
      if ((power.phase === 'saver' || power.phase === 'sleeping') && !['control', 'shift', 'alt', 'meta'].includes(key)) command = 'power.wake';
      else if (power.phase === 'off' && (alias && event.key === 'F4' || key === 'enter' || key === ' ')) command = 'power.start';
      else if (powerAvailable() && !session.logoutPending && alias && event.key === 'F5') command = 'power.screenSaver.start';
      else if (powerAvailable() && !session.logoutPending && alias && event.key === 'F6') command = 'power.sleep';
      else if (interactive() && (alias && event.key === 'F7'
        || event.ctrlKey && event.metaKey && !event.shiftKey && !event.altKey && key === 'q')) command = 'session.lock';
      else if (interactive() && event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey && key === 'escape') command = 'system.forceQuit.open';
      else if (interactive() && event.metaKey && event.shiftKey && !event.ctrlKey && key === 'q') {
        command = 'session.logout'; payload = { confirm: !event.altKey };
      }
      if (!command) return;
      event.preventDefault(); event.stopImmediatePropagation(); void execute({ command, ...(payload ? { payload } : {}) });
    }
    function releaseOption(event) {
      if (appleOption && (event.type === 'blur' || !event.altKey)) {
        void execute({ command: 'menu.appleOption.set', payload: { enabled: false } });
      }
    }
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener('keyup', releaseOption, true);
    window.addEventListener('blur', releaseOption);
    return () => {
      disposed = true; menuLifecycle.clear(); unregister();
      window.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('keyup', releaseOption, true);
      window.removeEventListener('blur', releaseOption);
    };
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
        menuBarState={menuBar} menuBarMenus={menuDefinitions} dismissMenuBar={() => menuLifecycle.clear()}
        getMenuReturnFocus={() => menuLifecycle.getReturnFocus()}
        foreground={userId === session.activeUserId && interactive()} appearanceOwner={userId === session.activeUserId}
        windowNamespace={userId === 'local-alex' ? '' : `${userId}--`} />
    </div>
  {/each}
  {#if power.phase === 'awake' && (session.phase !== 'desktop' || session.logoutPending)}
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

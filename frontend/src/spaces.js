import { isRecord, rejected } from './feature-commands.js';

const macProfiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1'];
const supported = profile => profile?.family === 'macos' && macProfiles.includes(profile.id)
  && profile.capabilities.includes('shell.mission-control');
const identity = value => typeof value === 'string' && value.length > 0;
const fields = (value, names, required = names) => isRecord(value)
  && Object.keys(value).every(key => names.includes(key)) && required.every(key => Object.hasOwn(value, key));
const offsetValid = value => Number.isFinite(value) && value >= 0;
const scrollValid = value => value && offsetValid(value.top) && offsetValid(value.left);
const sameOrder = (left, right) => left.length === right.length && left.every((id, index) => id === right[index]);
const unique = values => [...new Set(values)];
const eligible = (window, hidden, pending) => window && !window.minimized
  && !hidden.includes(window.appId) && !pending.includes(window.appId);
const soloId = id => `full:${encodeURIComponent(id)}`;
const splitId = pair => `split:${JSON.stringify([pair.leftWindowId, pair.rightWindowId].sort())}`;
const pairFor = (presentation, id) => presentation.splitViews.find(pair => pair.leftWindowId !== pair.rightWindowId
  && Number.isFinite(pair.ratio) && pair.ratio >= 0.2 && pair.ratio <= 0.8
  && [pair.leftWindowId, pair.rightWindowId].includes(id));
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented closed Mission Control and Spaces arguments.');
const unavailable = () => rejected('unavailable', 'The actual native scene or Mission Control control is unavailable or blocked by a global modal.');
const disabled = () => rejected('disabled', 'This Space transition is not available in the current original-window state.');
const notFound = () => rejected('not_found', 'The requested live Space, original window or enabled overview control no longer exists.');
const copy = value => Array.isArray(value) ? value.map(copy)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)])) : value;

function nearestSurvivor(previous, selected, ids) {
  if (ids.includes(selected)) return selected;
  const index = previous.indexOf(selected);
  if (index >= 0) {
    for (let distance = 1; distance < previous.length; distance += 1) {
      if (ids.includes(previous[index + distance])) return previous[index + distance];
      if (ids.includes(previous[index - distance])) return previous[index - distance];
    }
  }
  return ids[0] ?? null;
}

function desktopIds(state) {
  const live = unique(state.desktops.map(desktop => desktop.id));
  return unique([...state.order.filter(id => live.includes(id)), ...live]);
}

function homeId(state, window) {
  const ids = desktopIds(state);
  return ids.includes(window?.spaceId) ? window.spaceId : ids.includes(state.lastDesktopId) ? state.lastDesktopId : ids[0];
}

export function spacesDefaults() {
  return { desktops: [{ id: 'desktop-1' }], order: ['desktop-1'], activeSpaceId: 'desktop-1',
    lastDesktopId: 'desktop-1', nextDesktopId: 2, overview: null };
}

export function windowSpaceId(state, presentation, window) {
  if (!window) return null;
  if (!window.fullScreen) return homeId(state, window);
  const pair = pairFor(presentation, window.id);
  return pair ? splitId(pair) : soloId(window.id);
}

export function spacesItems(state, presentation, windows, profile, hidden = [], pending = [], dashboard = null) {
  if (!supported(profile)) return [];
  const seen = new Set(), managed = windows.filter(window => identity(window.id)
    && Object.hasOwn(profile.applications, window.appId) && !seen.has(window.id) && seen.add(window.id));
  const available = managed.filter(window => eligible(window, hidden, pending));
  const byId = new Map(available.map(window => [window.id, window])), members = new Set();
  const desktops = desktopIds(state);
  const entries = desktops.map((spaceId, index) => ({ spaceId, type: 'desktop', label: `Desktop ${index + 1}`,
    windowIds: available.filter(window => !window.fullScreen && homeId(state, window) === spaceId).map(window => window.id) }));
  if (profile.capabilities.includes('shell.dashboard') && dashboard?.mode === 'space')
    entries.unshift({ spaceId: 'dashboard', type: 'dashboard', label: 'Dashboard', windowIds: [] });
  for (const pair of presentation.splitViews) {
    const left = byId.get(pair.leftWindowId), right = byId.get(pair.rightWindowId);
    if (left === right || !left?.fullScreen || !right?.fullScreen || members.has(left.id) || members.has(right.id)
      || !Number.isFinite(pair.ratio) || pair.ratio < 0.2 || pair.ratio > 0.8) continue;
    members.add(left.id);
    members.add(right.id);
    entries.push({ spaceId: splitId(pair), type: 'split',
      label: `${profile.applications[left.appId].name} & ${profile.applications[right.appId].name}`,
      windowIds: [left.id, right.id], ratio: pair.ratio });
  }
  for (const window of available) if (window.fullScreen && !members.has(window.id)) {
    entries.push({ spaceId: soloId(window.id), type: 'fullScreen', label: profile.applications[window.appId].name,
      windowIds: [window.id] });
  }
  const bySpace = new Map(entries.map(entry => [entry.spaceId, entry]));
  return unique([...(bySpace.has('dashboard') ? ['dashboard'] : []), ...state.order.filter(id => bySpace.has(id)),
    ...entries.map(entry => entry.spaceId)]).map(id => bySpace.get(id));
}

export function missionControlWindows(state, windows, hidden = [], pending = []) {
  const preview = state.overview?.previewSpaceId ?? (desktopIds(state).includes(state.activeSpaceId) ? state.activeSpaceId : state.lastDesktopId);
  const live = windows.filter(window => eligible(window, hidden, pending) && !window.fullScreen && homeId(state, window) === preview);
  const byId = new Map(live.map(window => [window.id, window]));
  const ids = state.overview ? state.overview.windowIds.filter(id => byId.has(id)) : live.map(window => window.id);
  return ids.map(id => { const window = byId.get(id); return { windowId: id, appId: window.appId, title: window.title }; });
}

export function missionControlItems(state, spaceItems, windowItems) {
  if (!state.overview) return [];
  const count = spaceItems.filter(item => item.type === 'desktop').length;
  const ids = spaceItems.flatMap(item => [`space:${item.spaceId}`, ...(state.overview.expanded
    ? item.type === 'desktop' ? count > 1 ? [`remove:${item.spaceId}`] : []
      : ['fullScreen', 'split'].includes(item.type) ? [`exit:${item.spaceId}`] : [] : [])]);
  if (count < 16) ids.push('add-space');
  ids.push(...windowItems.map(item => `window:${item.windowId}`), 'close');
  return ids;
}

// Reconstruct the old enabled order even after an original has closed or become
// ineligible. Selection repair must use its former position, not new stacking.
function previousItems(state) {
  const spaces = state.order.map(spaceId => ({ spaceId,
    type: spaceId === 'dashboard' ? 'dashboard' : state.desktops.some(desktop => desktop.id === spaceId) ? 'desktop' : spaceId.startsWith('split:') ? 'split' : 'fullScreen' }));
  return missionControlItems(state, spaces, (state.overview?.windowIds ?? []).map(windowId => ({ windowId })));
}

export function reconcileSpaces(state, presentation, windows, profile, hidden = [], pending = [], creationIds = [], dashboard = null) {
  if (!supported(profile)) return;
  const previous = previousItems(state), selected = state.overview?.selectedItemId;
  const desktops = desktopIds(state);
  if (!desktops.includes(state.lastDesktopId)) state.lastDesktopId = desktops[0];
  for (const window of windows) if (Object.hasOwn(profile.applications, window.appId) && !desktops.includes(window.spaceId)) {
    window.spaceId = state.lastDesktopId;
  }
  const items = spacesItems(state, presentation, windows, profile, hidden, pending, dashboard), order = items.map(item => item.spaceId);
  if (!sameOrder(state.order, order)) state.order = order;
  if (!order.includes(state.activeSpaceId)) state.activeSpaceId = state.lastDesktopId;
  if (desktops.includes(state.activeSpaceId) && state.lastDesktopId !== state.activeSpaceId) state.lastDesktopId = state.activeSpaceId;
  if (state.overview) {
    const current = state.overview;
    if (!desktops.includes(current.previewSpaceId)) current.previewSpaceId = state.lastDesktopId;
    const live = windows.filter(window => Object.hasOwn(profile.applications, window.appId)
      && eligible(window, hidden, pending) && !window.fullScreen && window.spaceId === current.previewSpaceId).map(window => window.id);
    const liveSet = new Set(live);
    const ids = unique([...current.windowIds.filter(id => liveSet.has(id)), ...creationIds.filter(id => liveSet.has(id)), ...live]);
    if (!sameOrder(current.windowIds, ids)) current.windowIds = ids;
    const enabled = missionControlItems(state, items, missionControlWindows(state, windows, hidden, pending));
    const next = nearestSurvivor(previous, selected, enabled);
    if (current.selectedItemId !== next) current.selectedItemId = next;
  }
}

export function createSpacesCommands(ctx) {
  const { profile, state, presentation } = ctx;
  const windows = () => ctx.getWindows();
  const hidden = () => ctx.getHiddenAppIds();
  const pending = () => ctx.getPendingQuitAppIds();
  const view = () => ctx.getView();
  const items = () => spacesItems(state, presentation, windows(), profile, hidden(), pending(), ctx.getDashboard?.());
  const windowItems = () => missionControlWindows(state, windows(), hidden(), pending());
  const controls = () => missionControlItems(state, items(), windowItems());
  const lookup = id => windows().find(window => window.id === id && Object.hasOwn(profile.applications, window.appId));
  const available = () => ctx.available() === true;
  const mounted = () => available() && Boolean(state.overview) && view()?.available() === true && Boolean(view().bounds())
    && scrollValid(view().scrollPosition('windows')) && scrollValid(view().scrollPosition('spaces'));
  const sceneError = () => !available() || state.overview && !mounted() ? unavailable() : null;
  const windowError = window => !window ? notFound() : !eligible(window, hidden(), pending()) ? disabled() : null;
  let returnFocus = null;
  let focusOwner = null;

  function snapshot() {
    return { spaces: copy(state), presentation: copy(presentation),
      membership: windows().map(window => ({ window, hasHome: Object.hasOwn(window, 'spaceId'), spaceId: window.spaceId,
        hasFullScreen: Object.hasOwn(window, 'fullScreen'), fullScreen: window.fullScreen })),
      scene: ctx.captureScene(), focus: ctx.captureFocus(), returnFocus, focusOwner,
      overviewFocus: mounted() ? view().focusedItemId() : null,
      scroll: mounted() ? { windows: { ...view().scrollPosition('windows') }, spaces: { ...view().scrollPosition('spaces') } } : null };
  }

  async function restore(previous) {
    const live = new Set(windows());
    for (const entry of previous.membership) if (live.has(entry.window)) {
      if (entry.hasHome) entry.window.spaceId = entry.spaceId;
      else delete entry.window.spaceId;
      if (entry.hasFullScreen) entry.window.fullScreen = entry.fullScreen;
      else delete entry.window.fullScreen;
    }
    for (const key of Object.keys(previous.spaces)) state[key] = previous.spaces[key];
    for (const key of Object.keys(previous.presentation)) presentation[key] = previous.presentation[key];
    returnFocus = previous.returnFocus;
    focusOwner = previous.focusOwner === null ? null : state.overview;
    try {
      await ctx.settle();
      await ctx.restoreScene(previous.scene);
      await ctx.settle();
      if (state.overview && previous.scroll) {
        await view()?.prepare();
        if (mounted()) {
          if (previous.overviewFocus && controls().includes(previous.overviewFocus)) await view().focus(previous.overviewFocus);
          for (const region of ['windows', 'spaces']) await view().scroll(region, previous.scroll[region].top, previous.scroll[region].left);
          return;
        }
      }
      await ctx.restoreFocus(previous.focus);
    } catch {
      // Canonical ownership is already restored. An unavailable old view cannot
      // provide physical focus, and must never turn the failed action into success.
      try { await ctx.restoreFocus(previous.focus); } catch { /* The scene itself can have unmounted. */ }
    }
  }

  async function atomic(change) {
    let previous;
    try { previous = snapshot(); } catch { return unavailable(); }
    try {
      const result = await change();
      if (result.status !== 'applied') await restore(previous);
      return result;
    } catch {
      await restore(previous);
      return unavailable();
    }
  }

  function reconcile(previous = previousItems(state), selected = state.overview?.selectedItemId) {
    reconcileSpaces(state, presentation, windows(), profile, hidden(), pending(), ctx.getCreationWindowIds(), ctx.getDashboard?.());
    if (state.overview) state.overview.selectedItemId = nearestSurvivor(previous, selected, controls());
  }

  function retainScroll(current) {
    const positions = { windows: view().scrollPosition('windows'), spaces: view().scrollPosition('spaces') };
    if (!scrollValid(positions.windows) || !scrollValid(positions.spaces)) return false;
    current.scroll = { windows: { ...positions.windows }, spaces: { ...positions.spaces } };
    return true;
  }

  async function select(itemId) {
    if (!mounted()) return unavailable();
    if (!controls().includes(itemId)) return notFound();
    if (!view().itemIds().includes(itemId)) return unavailable();
    const current = state.overview;
    if (!await view().focus(itemId)) return unavailable();
    if (state.overview !== current || !mounted() || view().focusedItemId() !== itemId
      || !controls().includes(itemId) || !view().itemIds().includes(itemId) || !retainScroll(current)) return unavailable();
    current.selectedItemId = itemId;
    return applied({ itemId });
  }

  async function prepare(current, itemId = current.selectedItemId) {
    await ctx.settle();
    await view()?.prepare();
    if (state.overview !== current || !mounted()) return unavailable();
    for (const region of ['windows', 'spaces']) {
      const position = current.scroll[region];
      if (!scrollValid(await view().scroll(region, position.top, position.left)) || state.overview !== current || !mounted()) return unavailable();
    }
    return select(itemId);
  }

  async function activate(entry, exactWindowId = null) {
    if (entry.type !== 'dashboard') {
      state.activeSpaceId = entry.spaceId;
      if (entry.type === 'desktop') state.lastDesktopId = entry.spaceId;
    }
    if (!await ctx.activateSpace(exactWindowId ? { ...entry, windowIds: [exactWindowId] } : entry)) return false;
    await ctx.settle();
    if (!available() || !items().some(item => item.spaceId === entry.spaceId) || state.activeSpaceId !== entry.spaceId) return false;
    const active = ctx.getActiveWindowId();
    return exactWindowId ? active === exactWindowId && !windowError(lookup(active))
      : entry.windowIds.length ? entry.windowIds.includes(active) && !windowError(lookup(active)) : active === null;
  }

  async function settleForeground() {
    const spaceId = state.activeSpaceId;
    if (!await ctx.foregroundMembershipChanged()) return false;
    await ctx.settle();
    const entry = items().find(item => item.spaceId === spaceId), active = ctx.getActiveWindowId();
    return available() && state.activeSpaceId === spaceId && Boolean(entry)
      && (entry.windowIds.length ? entry.windowIds.includes(active) && !windowError(lookup(active)) : active === null);
  }

  function clearOverview() {
    state.overview = null;
    returnFocus = null;
    focusOwner = null;
  }

  const commands = {
    'shell.missionControl.open': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      const error = sceneError();
      if (error) return error;
      return atomic(async () => {
        if (state.overview) {
          const result = await prepare(state.overview);
          return result.status === 'applied' ? applied({ spaceId: state.overview.previewSpaceId, itemId: state.overview.selectedItemId }) : result;
        }
        const focus = ctx.captureFocus();
        await ctx.dismissPresentations();
        reconcile();
        const previewSpaceId = desktopIds(state).includes(state.activeSpaceId) ? state.activeSpaceId : state.lastDesktopId;
        state.overview = { expanded: false, previewSpaceId, windowIds: [], selectedItemId: `space:${previewSpaceId}`,
          scroll: { windows: { top: 0, left: 0 }, spaces: { top: 0, left: 0 } } };
        const current = state.overview; // Assigned reactive identity, never the raw preassignment object.
        returnFocus = focus;
        focusOwner = current;
        reconcile();
        current.selectedItemId = current.windowIds.length ? `window:${current.windowIds[0]}` : `space:${previewSpaceId}`;
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ spaceId: current.previewSpaceId, itemId: current.selectedItemId }) : result;
      });
    },
    'shell.missionControl.close': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['restoreFocus'], [])
        || Object.hasOwn(payload, 'restoreFocus') && typeof payload.restoreFocus !== 'boolean') return invalid();
      if (!available()) return unavailable();
      if (!state.overview) return applied({ closed: false });
      if (!mounted()) return unavailable();
      return atomic(async () => {
        const focus = focusOwner === state.overview ? returnFocus : null;
        clearOverview();
        await ctx.settle();
        if (!available()) return unavailable();
        if (payload.restoreFocus !== false && !(focus !== null && await ctx.restoreFocus(focus))) {
          const entry = items().find(item => item.spaceId === state.activeSpaceId);
          if (!entry || !await activate(entry)) return unavailable();
        }
        return applied({ closed: true });
      });
    },
    'shell.missionControl.select': async (target, payload) => {
      if (!fields(target, ['itemId']) || !identity(target.itemId) || !fields(payload, [])) return invalid();
      if (!mounted()) return unavailable();
      if (!controls().includes(target.itemId)) return notFound();
      return atomic(() => select(target.itemId));
    },
    'shell.missionControl.setExpanded': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['expanded']) || typeof payload.expanded !== 'boolean') return invalid();
      if (!mounted()) return unavailable();
      return atomic(async () => {
        const previous = controls(), current = state.overview, selected = current.selectedItemId;
        current.expanded = payload.expanded;
        current.selectedItemId = nearestSurvivor(previous, selected, controls());
        const result = await prepare(current);
        return result.status === 'applied' ? applied({ expanded: current.expanded }) : result;
      });
    },
    'shell.missionControl.scroll': async (target, payload) => {
      if (!fields(target, ['region']) || !['windows', 'spaces'].includes(target.region)
        || !fields(payload, ['top', 'left']) || !offsetValid(payload.top) || !offsetValid(payload.left)) return invalid();
      if (!mounted()) return unavailable();
      return atomic(async () => {
        const current = state.overview, region = target.region;
        const position = await view().scroll(region, payload.top, payload.left);
        const actual = view()?.scrollPosition(region);
        if (state.overview !== current || !mounted() || !scrollValid(position) || !scrollValid(actual)
          || position.top !== actual.top || position.left !== actual.left) return unavailable();
        current.scroll[region] = { top: actual.top, left: actual.left };
        return applied({ region, top: actual.top, left: actual.left });
      });
    },
    'shell.missionControl.activate': async (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, [])) return invalid();
      if (!mounted()) return unavailable();
      const window = lookup(target.windowId), error = windowError(window);
      if (error) return error;
      if (window.fullScreen || !windowItems().some(item => item.windowId === window.id)) return disabled();
      if (!view().itemIds().includes(`window:${window.id}`)) return unavailable();
      return atomic(async () => {
        const entry = items().find(item => item.type === 'desktop' && item.spaceId === window.spaceId);
        clearOverview();
        await ctx.settle();
        if (!entry || lookup(window.id) !== window || !await activate(entry, window.id)) return unavailable();
        return applied({ windowId: window.id, spaceId: entry.spaceId });
      });
    },
    'space.create': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      const error = sceneError();
      if (error) return error;
      if (state.desktops.length >= 16) return disabled();
      return atomic(async () => {
        const spaceId = `desktop-${state.nextDesktopId}`;
        state.nextDesktopId += 1;
        state.desktops.push({ id: spaceId });
        state.order.push(spaceId);
        reconcile();
        if (state.overview) {
          const result = await prepare(state.overview, `space:${spaceId}`);
          if (result.status !== 'applied') return result;
        }
        await ctx.settle();
        if (!available() || !items().some(item => item.spaceId === spaceId)) return unavailable();
        return applied({ spaceId });
      });
    },
    'space.remove': async (target, payload) => {
      if (!fields(target, ['spaceId']) || !identity(target.spaceId) || !fields(payload, [])) return invalid();
      const error = sceneError();
      if (error) return error;
      const desktops = items().filter(item => item.type === 'desktop'), index = desktops.findIndex(item => item.spaceId === target.spaceId);
      if (index < 0) return notFound();
      if (desktops.length === 1) return disabled();
      const destinationSpaceId = desktops[index - 1]?.spaceId ?? desktops[index + 1].spaceId;
      return atomic(async () => {
        const previous = controls(), selected = state.overview?.selectedItemId;
        const migrated = windows().filter(window => Object.hasOwn(profile.applications, window.appId) && window.spaceId === target.spaceId);
        for (const window of migrated) window.spaceId = destinationSpaceId;
        state.desktops = state.desktops.filter(desktop => desktop.id !== target.spaceId);
        state.order = state.order.filter(id => id !== target.spaceId);
        const activeRemoved = state.activeSpaceId === target.spaceId;
        if (activeRemoved) state.activeSpaceId = destinationSpaceId;
        if (state.lastDesktopId === target.spaceId) state.lastDesktopId = destinationSpaceId;
        if (state.overview?.previewSpaceId === target.spaceId) state.overview.previewSpaceId = destinationSpaceId;
        reconcile(previous, selected);
        if (activeRemoved && !await settleForeground()) return unavailable();
        await ctx.settle();
        if (!available()) return unavailable();
        if (state.overview) {
          const result = await prepare(state.overview);
          if (result.status !== 'applied') return result;
        }
        return applied({ spaceId: target.spaceId, destinationSpaceId, windowIds: migrated.map(window => window.id) });
      });
    },
    'space.activate': async (target, payload) => {
      if (!fields(target, ['spaceId']) || !identity(target.spaceId) || !fields(payload, [])) return invalid();
      const error = sceneError();
      if (error) return error;
      const entry = items().find(item => item.spaceId === target.spaceId);
      if (!entry) return notFound();
      return atomic(async () => {
        clearOverview();
        await ctx.settle();
        if (!await activate(entry)) return unavailable();
        return applied({ spaceId: entry.spaceId, windowId: ctx.getActiveWindowId() });
      });
    },
    'window.moveToSpace': async (target, payload) => {
      if (!fields(target, ['windowId', 'spaceId']) || !identity(target.windowId) || !identity(target.spaceId) || !fields(payload, [])) return invalid();
      const error = sceneError() ?? windowError(lookup(target.windowId));
      if (error) return error;
      const window = lookup(target.windowId), destination = items().find(item => item.spaceId === target.spaceId);
      if (!destination) return notFound();
      if (window.fullScreen || destination.type !== 'desktop') return disabled();
      return atomic(async () => {
        const previous = controls(), selected = state.overview?.selectedItemId;
        const movedForeground = ctx.getActiveWindowId() === window.id && window.spaceId !== destination.spaceId;
        window.spaceId = destination.spaceId;
        reconcile(previous, selected);
        if (movedForeground && !await settleForeground()) return unavailable();
        await ctx.settle();
        if (!available() || lookup(window.id) !== window || windowError(window) || window.spaceId !== destination.spaceId) return unavailable();
        if (state.overview) {
          const result = await prepare(state.overview);
          if (result.status !== 'applied') return result;
        }
        return applied({ windowId: window.id, spaceId: destination.spaceId });
      });
    },
    'space.exitFullScreen': async (target, payload) => {
      if (!fields(target, ['spaceId']) || !identity(target.spaceId) || !fields(payload, [])) return invalid();
      const error = sceneError();
      if (error) return error;
      const entry = items().find(item => item.spaceId === target.spaceId);
      if (!entry) return notFound();
      if (!['fullScreen', 'split'].includes(entry.type)) return disabled();
      return atomic(async () => {
        const previous = controls(), current = state.overview, selected = current?.selectedItemId;
        const originals = entry.windowIds.map(lookup);
        if (originals.some(window => windowError(window))) return disabled();
        // Existing full-screen handlers dismiss competing views. Preserve our
        // assigned overview identity and return-focus owner across that cutover.
        const focus = returnFocus, owner = focusOwner;
        state.overview = null;
        await ctx.settle();
        for (const window of originals) {
          const result = await ctx.invoke('window.setFullScreen', { windowId: window.id }, { fullScreen: false });
          if (result.status !== 'applied') return result;
          if (lookup(window.id) !== window || window.fullScreen) return unavailable();
        }
        if (current) {
          state.overview = current;
          returnFocus = focus;
          focusOwner = owner === current ? state.overview : null;
          reconcile(previous, selected);
          const result = await prepare(state.overview);
          if (result.status !== 'applied') return result;
        } else {
          reconcile();
          const home = items().find(item => item.spaceId === homeId(state, originals[0]));
          if (!home || !await activate(home, originals[0].id)) return unavailable();
        }
        if (!available()) return unavailable();
        return applied({ spaceId: entry.spaceId, windowIds: [...entry.windowIds] });
      });
    },
    'space.pair': async (target, payload) => {
      if (!fields(target, ['windowId', 'spaceId']) || !identity(target.windowId) || !identity(target.spaceId) || !fields(payload, [])) return invalid();
      const error = sceneError() ?? windowError(lookup(target.windowId));
      if (error) return error;
      const source = lookup(target.windowId), entry = items().find(item => item.spaceId === target.spaceId);
      if (!entry) return notFound();
      if (entry.type !== 'fullScreen' || entry.windowIds[0] === source.id || pairFor(presentation, source.id) || presentation.pairing) return disabled();
      const owner = lookup(entry.windowIds[0]);
      if (windowError(owner)) return disabled();
      return atomic(async () => {
        const current = state.overview, focus = returnFocus, owned = focusOwner;
        state.overview = null;
        await ctx.settle();
        const began = await ctx.invoke('window.splitView.begin', { windowId: owner.id }, { side: 'left' });
        if (began.status !== 'applied') return began;
        const accepted = await ctx.invoke('window.splitView.accept', { windowId: source.id }, {});
        if (accepted.status !== 'applied') return accepted;
        const pair = presentation.splitViews.find(pair => pair.leftWindowId === owner.id && pair.rightWindowId === source.id);
        if (!pair || !source.fullScreen || !owner.fullScreen || lookup(source.id) !== source || lookup(owner.id) !== owner
          || windowError(source) || windowError(owner) || presentation.pairing) return unavailable();
        reconcile();
        const spaceId = splitId(pair);
        const pairedSpace = items().find(item => item.spaceId === spaceId);
        if (!pairedSpace || !await activate(pairedSpace, source.id)) return unavailable();
        if (current) {
          state.overview = current;
          returnFocus = focus;
          focusOwner = owned === current ? state.overview : null;
          reconcile();
          const result = await prepare(state.overview, `space:${spaceId}`);
          if (result.status !== 'applied') return result;
        }
        return applied({ spaceId, leftWindowId: pair.leftWindowId, rightWindowId: pair.rightWindowId });
      });
    },
  };
  for (const name of Object.keys(commands)) {
    const handler = commands[name];
    commands[name] = (target, payload) => supported(profile) ? handler(target, payload)
      : rejected('unsupported_profile', `The active OS profile does not support command: ${name}`);
  }
  return commands;
}

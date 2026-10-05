import { isRecord, rejected } from './feature-commands.js';

const identity = value => typeof value === 'string' && value.length > 0;
const fields = (value, names, required = names) => isRecord(value)
  && Object.keys(value).every(key => names.includes(key)) && required.every(key => Object.hasOwn(value, key));
const sideValid = value => value === 'left' || value === 'right';
const offsetValid = value => Number.isFinite(value) && value >= 0;
const scrollValid = value => isRecord(value) && offsetValid(value.top) && offsetValid(value.left);
const ratioValid = value => Number.isFinite(value) && value >= 0.2 && value <= 0.8;
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented closed full-screen arguments.');
const unavailable = () => rejected('unavailable', 'The native presentation is unavailable or blocked by a global modal.');
const disabled = () => rejected('disabled', 'This full-screen transition is not available in the current window state.');
const sameOrder = (a, b) => a.length === b.length && a.every((id, index) => id === b[index]);
const visible = (window, hidden, pending = []) => window && !window.minimized
  && !hidden.includes(window.appId) && !pending.includes(window.appId);
const paired = (state, id) => state.splitViews.find(pair => [pair.leftWindowId, pair.rightWindowId].includes(id));

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

function candidateIds(state, windows, hidden, pending) {
  return [...new Set(windows.filter(window => visible(window, hidden, pending)
    && window.id !== state.pairing?.windowId && window.id !== state.pairing?.replacingWindowId
    && !paired(state, window.id)).map(window => window.id))];
}

function cancelPairing(state, windows) {
  const pairing = state.pairing;
  if (!pairing) return;
  const window = windows.find(window => window.id === pairing.windowId);
  if (window) window.fullScreen = pairing.previousFullScreen;
  if (pairing.previousSplitView) state.splitViews.push({ ...pairing.previousSplitView });
  state.pairing = null;
}

export function fullScreenDefaults() {
  return { splitViews: [], pairing: null, greenMenu: null, revealed: { top: false, launcher: false } };
}

export function reconcileFullScreenWindowing(state, windows, hiddenAppIds = [], pendingQuitAppIds = []) {
  const byId = new Map(windows.map(window => [window.id, window]));
  const members = new Set();
  const pairs = state.splitViews.filter(pair => {
    const { leftWindowId, rightWindowId, ratio } = pair;
    const left = byId.get(leftWindowId), right = byId.get(rightWindowId);
    if (leftWindowId === rightWindowId || members.has(leftWindowId) || members.has(rightWindowId)
      || !left?.fullScreen || !right?.fullScreen || !ratioValid(ratio)
      || !visible(left, hiddenAppIds, pendingQuitAppIds) || !visible(right, hiddenAppIds, pendingQuitAppIds)) return false;
    members.add(leftWindowId);
    members.add(rightWindowId);
    return true;
  });
  if (!sameOrder(state.splitViews, pairs)) state.splitViews = pairs;
  if (state.pairing) {
    const current = state.pairing, owner = byId.get(current.windowId);
    if (!visible(owner, hiddenAppIds, pendingQuitAppIds) || !owner.fullScreen || !sideValid(current.side)
      || paired(state, current.windowId)
      || (current.replacingWindowId && !visible(byId.get(current.replacingWindowId), hiddenAppIds, pendingQuitAppIds))) {
      cancelPairing(state, windows);
      reconcileFullScreenWindowing(state, windows, hiddenAppIds, pendingQuitAppIds);
    }
    else {
      const live = candidateIds(state, windows, hiddenAppIds, pendingQuitAppIds), liveSet = new Set(live);
      const ids = [...new Set([...current.windowIds.filter(id => liveSet.has(id)), ...live])];
      const selected = nearestSurvivor(current.windowIds, current.selectedWindowId, ids);
      if (!sameOrder(current.windowIds, ids)) current.windowIds = ids;
      if (current.selectedWindowId !== selected) current.selectedWindowId = selected;
    }
  }
  if (state.greenMenu && (!visible(byId.get(state.greenMenu.windowId), hiddenAppIds, pendingQuitAppIds)
    || state.pairing)) state.greenMenu = null;
  else if (state.greenMenu) {
    const window = byId.get(state.greenMenu.windowId);
    const currentIds = paired(state, window.id) ? ['replace-tiled', 'move-to-desktop', 'make-full-screen']
      : window.fullScreen ? ['full-screen'] : ['full-screen', 'tile-left', 'tile-right'];
    const previousIds = ['replace-tiled', 'move-to-desktop', 'make-full-screen'].includes(state.greenMenu.itemId)
      ? ['replace-tiled', 'move-to-desktop', 'make-full-screen'] : ['full-screen', 'tile-left', 'tile-right'];
    const selected = nearestSurvivor(previousIds, state.greenMenu.itemId, currentIds);
    if (state.greenMenu.itemId !== selected) state.greenMenu.itemId = selected;
  }
}

export function fullScreenStage(state, windows, activeWindowId, hiddenAppIds = []) {
  const reveals = { topRevealed: state.revealed.top, launcherRevealed: state.revealed.launcher };
  const active = windows.find(window => window.id === activeWindowId);
  if (!visible(active, hiddenAppIds) || !active.fullScreen) return { mode: 'normal', windowIds: [], topRevealed: false, launcherRevealed: false };
  if (state.pairing?.windowId === activeWindowId) {
    const { windowId, side, selectedWindowId, windowIds } = state.pairing;
    const candidates = windowIds.filter(id => visible(windows.find(window => window.id === id), hiddenAppIds));
    return { mode: 'pairing', windowIds: [windowId, ...candidates], windowId, side, selectedWindowId, ...reveals };
  }
  if (paired(state, activeWindowId)) {
    const { leftWindowId, rightWindowId, ratio } = paired(state, activeWindowId);
    if ([leftWindowId, rightWindowId].every(id => {
      const window = windows.find(window => window.id === id);
      return window?.fullScreen && visible(window, hiddenAppIds);
    })) return { mode: 'split', windowIds: [leftWindowId, rightWindowId], leftWindowId, rightWindowId, ratio, ...reveals };
  }
  return { mode: 'fullScreen', windowIds: [activeWindowId], windowId: activeWindowId, ...reveals };
}

export function splitViewItems(profile, state, windows, hiddenAppIds = [], pendingQuitAppIds = []) {
  if (profile.family !== 'macos' || !profile.capabilities.includes('shell.split-view') || !state.pairing) return [];
  return state.pairing.windowIds.flatMap(id => {
    const window = windows.find(window => window.id === id);
    return visible(window, hiddenAppIds, pendingQuitAppIds) && window.id !== state.pairing.windowId
      && window.id !== state.pairing.replacingWindowId && !paired(state, id) && Object.hasOwn(profile.applications, window.appId)
      ? [{ windowId: id, appId: window.appId, title: window.title }] : [];
  });
}

export function windowGreenMenuItems(profile, state, window) {
  if (!window || !profile.capabilities.includes('shell.window-green-menu')) return [];
  if (paired(state, window.id)) return [
    { itemId: 'replace-tiled', label: 'Replace Tiled Window', disabled: Boolean(state.pairing) },
    { itemId: 'move-to-desktop', label: 'Move Window to Desktop', disabled: false },
    { itemId: 'make-full-screen', label: 'Make Window Full Screen', disabled: false },
  ];
  if (window.fullScreen) return [{ itemId: 'full-screen', label: 'Exit Full Screen', disabled: Boolean(window.minimized) }];
  return [
    { itemId: 'full-screen', label: 'Enter Full Screen', disabled: Boolean(window.minimized) },
    { itemId: 'tile-left', label: 'Tile Window to Left of Screen', disabled: Boolean(window.minimized || state.pairing) },
    { itemId: 'tile-right', label: 'Tile Window to Right of Screen', disabled: Boolean(window.minimized || state.pairing) },
  ];
}

function snapshot(state, windows, activeWindowId) {
  return {
    splitViews: state.splitViews.map(pair => ({ ...pair })),
    pairing: state.pairing ? { ...state.pairing, windowIds: [...state.pairing.windowIds], scroll: { ...state.pairing.scroll },
      ...(state.pairing.previousSplitView ? { previousSplitView: { ...state.pairing.previousSplitView } } : {}) } : null,
    greenMenu: state.greenMenu ? { ...state.greenMenu } : null,
    revealed: { ...state.revealed },
    membership: windows.map(window => ({ window, fullScreen: window.fullScreen })),
    activeWindowId,
  };
}

export function createFullScreenCommands(ctx) {
  const { profile, state } = ctx;
  const windows = () => ctx.getWindows();
  const hidden = () => ctx.getHiddenAppIds();
  const pending = () => ctx.getPendingQuitAppIds();
  const stage = () => fullScreenStage(state, windows(), ctx.getActiveWindowId(), [...hidden(), ...pending()]);
  const stageMounted = () => ctx.available() && ctx.getStageView()?.available() === true;
  const lookup = id => windows().find(window => window.id === id && Object.hasOwn(profile.applications, window.appId));
  const eligibility = window => !window ? rejected('not_found', 'The managed original window no longer exists.')
    : !visible(window, hidden(), pending()) ? disabled() : null;
  const pairingView = () => ctx.getPairingView();
  const menuView = () => ctx.getGreenMenuView();
  const items = () => splitViewItems(profile, state, windows(), hidden(), pending());
  const menuItems = () => windowGreenMenuItems(profile, state, lookup(state.greenMenu?.windowId));
  const pairingMounted = () => stageMounted() && state.pairing && !eligibility(lookup(state.pairing.windowId))
    && stage().mode === 'pairing' && pairingView()?.available() === true
    && scrollValid(pairingView().scrollPosition());
  const menuMounted = () => stageMounted() && state.greenMenu && !eligibility(lookup(state.greenMenu.windowId))
    && ctx.getActiveWindowId() === state.greenMenu.windowId && menuView()?.available() === true
    && offsetValid(menuView().scrollTop());
  const takeSnapshot = () => snapshot(state, windows(), ctx.getActiveWindowId());

  async function restore(previous, competing) {
    const live = new Set(windows());
    for (const entry of previous.membership) if (live.has(entry.window)) entry.window.fullScreen = entry.fullScreen;
    state.splitViews = previous.splitViews;
    state.pairing = previous.pairing;
    state.greenMenu = previous.greenMenu;
    state.revealed = previous.revealed;
    reconcileFullScreenWindowing(state, windows(), hidden(), pending());
    if (competing !== undefined) await ctx.restorePresentations(competing);
    await ctx.settle();
    await ctx.restoreFocus(previous.activeWindowId);
    try {
      if (state.pairing) {
        await pairingView()?.prepare();
        if (pairingMounted()) {
          await pairingView().focus(state.pairing.selectedWindowId);
          await pairingView().scrollTo(state.pairing.scroll);
        }
      } else if (state.greenMenu) {
        await menuView()?.prepare();
        if (menuMounted()) {
          await menuView().focus(state.greenMenu.itemId);
          await menuView().scrollTo(state.greenMenu.scrollTop);
        }
      }
    } catch {
      // Membership and competing presentations are restored even when the old
      // native view also cannot lay out. The command still rejects unavailable.
      return false;
    }
    return true;
  }

  async function atomic(change, clear = false) {
    const previous = takeSnapshot();
    let competing;
    try {
      if (clear) competing = ctx.clearPresentations();
      const result = await change();
      if (result.status !== 'applied') await restore(previous, competing);
      return result;
    } catch {
      await restore(previous, competing);
      return unavailable();
    }
  }

  async function focusOriginal(id) {
    if (!stageMounted() || eligibility(lookup(id)) || !await ctx.focusWindow(id)) return false;
    await ctx.settle();
    return stageMounted() && ctx.getActiveWindowId() === id && !eligibility(lookup(id));
  }

  function clearLocalPresentations() {
    cancelPairing(state, windows());
    state.greenMenu = null;
    state.revealed = { top: false, launcher: false };
  }

  function pairingSelectionError(id) {
    if (!pairingMounted()) return unavailable();
    return items().some(item => item.windowId === id) && pairingView().windowIds().includes(id) ? null
      : rejected('not_found', 'The candidate original window is no longer eligible and rendered.');
  }

  function menuSelectionError(id) {
    if (!menuMounted()) return unavailable();
    const item = menuItems().find(item => item.itemId === id);
    if (!item) return rejected('not_found', 'The native menu item does not exist.');
    if (item.disabled) return disabled();
    return menuView().itemIds().includes(id) ? null : unavailable();
  }

  async function selectPairing(id) {
    const error = pairingSelectionError(id);
    if (error) return error;
    const current = state.pairing;
    if (!await pairingView().focus(id)) return unavailable();
    const scroll = pairingView().scrollPosition();
    if (state.pairing !== current || !pairingMounted() || pairingView().focusedWindowId() !== id
      || !items().some(item => item.windowId === id) || !scrollValid(scroll)) return unavailable();
    current.selectedWindowId = id;
    current.scroll = { top: scroll.top, left: scroll.left };
    return applied({ windowId: id });
  }

  async function selectMenu(id) {
    const error = menuSelectionError(id);
    if (error) return error;
    const current = state.greenMenu;
    if (!await menuView().focus(id)) return unavailable();
    const top = menuView().scrollTop();
    if (state.greenMenu !== current || !menuMounted() || menuView().focusedItemId() !== id
      || !offsetValid(top) || !menuItems().some(item => item.itemId === id && !item.disabled)) return unavailable();
    current.itemId = id;
    current.scrollTop = top;
    return applied({ itemId: id });
  }

  async function setFullScreen(id, fullScreen) {
    const window = lookup(id), error = fullScreen ? eligibility(window) : !window
      ? rejected('not_found', 'The managed original window no longer exists.') : null;
    if (error) return error;
    if (!stageMounted()) return unavailable();
    return atomic(async () => {
      clearLocalPresentations();
      window.fullScreen = fullScreen;
      if (!fullScreen) state.splitViews = state.splitViews.filter(pair => ![pair.leftWindowId, pair.rightWindowId].includes(id));
      if (fullScreen && !await focusOriginal(id)) return unavailable();
      await ctx.settle();
      if (!stageMounted() || lookup(id) !== window || window.fullScreen !== fullScreen
        || (fullScreen && (eligibility(window) || stage().mode === 'normal'))) return unavailable();
      return applied({ windowId: id, appId: window.appId, fullScreen });
    }, true);
  }

  async function begin(id, side, replacement = null) {
    const window = lookup(id), error = eligibility(window);
    if (error) return error;
    if (!stageMounted()) return unavailable();
    if (paired(state, id) && !replacement || state.pairing) return disabled();
    return atomic(async () => {
      state.greenMenu = null;
      if (replacement) state.splitViews = state.splitViews.filter(pair => pair !== replacement.pair);
      const previousFullScreen = window.fullScreen;
      window.fullScreen = true;
      state.revealed = { top: false, launcher: false };
      const current = { windowId: id, side, previousFullScreen, windowIds: [], selectedWindowId: null, scroll: { top: 0, left: 0 } };
      if (replacement) {
        current.previousSplitView = { ...replacement.pair };
        current.replacingWindowId = replacement.windowId;
      }
      current.windowIds = candidateIds({ ...state, pairing: current }, windows(), hidden(), pending()).filter(candidate => lookup(candidate));
      current.selectedWindowId = current.windowIds[0] ?? null;
      // Original projected frames become inert once the actual picker owns focus.
      if (!await focusOriginal(id) || state.pairing) return unavailable();
      state.pairing = current;
      const mountedPairing = state.pairing;
      await ctx.settle();
      await pairingView()?.prepare();
      if (!pairingMounted()) return unavailable();
      if (mountedPairing.selectedWindowId !== null) {
        const selected = await selectPairing(mountedPairing.selectedWindowId);
        if (selected.status !== 'applied') return selected;
      } else {
        if (!await pairingView().focus(null) || state.pairing !== mountedPairing || !pairingMounted()
          || pairingView().focusedWindowId() !== null) return unavailable();
        mountedPairing.scroll = { ...pairingView().scrollPosition() };
      }
      return applied({ windowId: id, side, selectedWindowId: mountedPairing.selectedWindowId });
    }, true);
  }

  async function replace(id) {
    const error = eligibility(lookup(id));
    if (error) return error;
    if (!stageMounted()) return unavailable();
    const pair = paired(state, id);
    if (!pair || state.pairing) return disabled();
    const ownerId = pair.leftWindowId === id ? pair.rightWindowId : pair.leftWindowId;
    const side = pair.leftWindowId === ownerId ? 'left' : 'right';
    const result = await begin(ownerId, side, { pair, windowId: id });
    return result.status === 'applied' ? applied({ windowId: id, side, selectedWindowId: result.target.selectedWindowId }) : result;
  }

  async function makeFullScreen(id) {
    const window = lookup(id), error = eligibility(window);
    if (error) return error;
    if (!stageMounted()) return unavailable();
    if (!paired(state, id) || state.pairing) return disabled();
    return atomic(async () => {
      clearLocalPresentations();
      state.splitViews = state.splitViews.filter(pair => ![pair.leftWindowId, pair.rightWindowId].includes(id));
      if (!await focusOriginal(id) || !window.fullScreen || stage().mode !== 'fullScreen') return unavailable();
      return applied({ windowId: id, fullScreen: true });
    }, true);
  }

  const commands = {
    'window.setFullScreen': async (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, ['fullScreen'])
        || typeof payload.fullScreen !== 'boolean') return invalid();
      return setFullScreen(target.windowId, payload.fullScreen);
    },
    'shell.fullScreen.reveal': async (target, payload) => {
      if (!fields(target, ['edge']) || !['top', 'launcher'].includes(target.edge) || !fields(payload, ['visible'])
        || typeof payload.visible !== 'boolean') return invalid();
      if (!stageMounted() || stage().mode === 'normal') return unavailable();
      if (!ctx.getStageView().canReveal(target.edge, payload.visible)) return disabled();
      return atomic(async () => {
        state.revealed[target.edge] = payload.visible;
        await ctx.settle();
        if (!stageMounted() || stage().mode === 'normal') return unavailable();
        return applied({ edge: target.edge, visible: payload.visible });
      });
    },
    'window.splitView.begin': async (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, ['side']) || !sideValid(payload.side)) return invalid();
      return begin(target.windowId, payload.side);
    },
    'window.splitView.setSide': async (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, ['side']) || !sideValid(payload.side)) return invalid();
      if (!pairingMounted()) return unavailable();
      if (state.pairing.windowId !== target.windowId) return rejected('not_found', 'This window does not own the open picker.');
      return atomic(async () => {
        const current = state.pairing;
        current.side = payload.side;
        await ctx.settle();
        await pairingView()?.prepare();
        if (state.pairing !== current || !pairingMounted()) return unavailable();
        const result = current.selectedWindowId === null
          ? await pairingView().focus(null) ? applied({}) : unavailable()
          : await selectPairing(current.selectedWindowId);
        if (result.status !== 'applied') return result;
        if (state.pairing !== current || !pairingMounted()
          || pairingView().focusedWindowId() !== current.selectedWindowId) return unavailable();
        current.scroll = { ...pairingView().scrollPosition() };
        return applied({ windowId: current.windowId, side: current.side, selectedWindowId: current.selectedWindowId });
      });
    },
    'window.splitView.select': async (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, [])) return invalid();
      const error = pairingSelectionError(target.windowId);
      if (error) return error;
      return atomic(() => selectPairing(target.windowId));
    },
    'window.splitView.accept': async (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, [])) return invalid();
      if (!pairingMounted()) return unavailable();
      if (!items().some(item => item.windowId === target.windowId) || !pairingView().windowIds().includes(target.windowId))
        return rejected('not_found', 'The candidate original window is no longer eligible and rendered.');
      return atomic(async () => {
        const selected = await selectPairing(target.windowId);
        if (selected.status !== 'applied') return selected;
        const current = state.pairing, window = lookup(target.windowId);
        window.fullScreen = true;
        const ratio = current.previousSplitView?.ratio ?? 0.5;
        const pair = current.side === 'left'
          ? { leftWindowId: current.windowId, rightWindowId: window.id, ratio }
          : { leftWindowId: window.id, rightWindowId: current.windowId, ratio };
        if (current.replacingWindowId) {
          const removed = lookup(current.replacingWindowId);
          if (!removed || eligibility(removed)) return unavailable();
          removed.fullScreen = false;
        }
        state.splitViews.push(pair);
        state.pairing = null;
        state.revealed = { top: false, launcher: false };
        if (!await focusOriginal(window.id) || stage().mode !== 'split') return unavailable();
        return applied({ ...pair });
      });
    },
    'window.splitView.cancel': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['restoreFocus'], [])
        || (Object.hasOwn(payload, 'restoreFocus') && typeof payload.restoreFocus !== 'boolean')) return invalid();
      if (!stageMounted()) return unavailable();
      if (!state.pairing) return applied({ cancelled: false });
      return atomic(async () => {
        const id = state.pairing.windowId;
        cancelPairing(state, windows());
        state.revealed = { top: false, launcher: false };
        await ctx.settle();
        if (payload.restoreFocus !== false && !await ctx.restoreFocus(id)) return unavailable();
        return applied({ cancelled: true });
      });
    },
    'window.splitView.resize': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['ratio']) || !ratioValid(payload.ratio)) return invalid();
      if (!stageMounted() || stage().mode !== 'split') return unavailable();
      return atomic(async () => {
        const current = paired(state, ctx.getActiveWindowId());
        current.ratio = payload.ratio;
        await ctx.settle();
        if (paired(state, ctx.getActiveWindowId()) !== current || !stageMounted() || stage().mode !== 'split') return unavailable();
        return applied({ ratio: current.ratio });
      });
    },
    'window.splitView.swap': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!stageMounted() || stage().mode !== 'split') return unavailable();
      return atomic(async () => {
        const current = paired(state, ctx.getActiveWindowId());
        [current.leftWindowId, current.rightWindowId] = [current.rightWindowId, current.leftWindowId];
        await ctx.settle();
        if (paired(state, ctx.getActiveWindowId()) !== current || !stageMounted() || stage().mode !== 'split') return unavailable();
        return applied({ leftWindowId: current.leftWindowId, rightWindowId: current.rightWindowId });
      });
    },
    'window.splitView.replace': async (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, [])) return invalid();
      return replace(target.windowId);
    },
    'window.splitView.makeFullScreen': async (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, [])) return invalid();
      return makeFullScreen(target.windowId);
    },
    'window.splitView.scroll': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['top', 'left']) || !scrollValid(payload)) return invalid();
      if (!pairingMounted()) return unavailable();
      return atomic(async () => {
        const current = state.pairing, actual = await pairingView().scrollTo(payload);
        const measured = pairingView().scrollPosition();
        if (state.pairing !== current || !pairingMounted() || !scrollValid(actual)
          || actual.top !== measured.top || actual.left !== measured.left) return unavailable();
        current.scroll = { top: actual.top, left: actual.left };
        return applied({ ...current.scroll });
      });
    },
    'window.greenMenu.open': async (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, [])) return invalid();
      const window = lookup(target.windowId), error = eligibility(window);
      if (error) return error;
      if (!stageMounted()) return unavailable();
      return atomic(async () => {
        clearLocalPresentations();
        // A fullscreen menu must keep its real green-button anchor revealed.
        state.revealed.top = Boolean(window.fullScreen);
        const first = windowGreenMenuItems(profile, state, window).find(item => !item.disabled);
        if (!first) return disabled();
        state.greenMenu = { windowId: window.id, itemId: first.itemId, scrollTop: 0 };
        const current = state.greenMenu;
        if (!await focusOriginal(window.id) || state.greenMenu !== current) return unavailable();
        await menuView()?.prepare();
        const result = await selectMenu(current.itemId);
        return result.status === 'applied' ? applied({ windowId: window.id, itemId: current.itemId }) : result;
      }, true);
    },
    'window.greenMenu.close': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['restoreFocus'], [])
        || (Object.hasOwn(payload, 'restoreFocus') && typeof payload.restoreFocus !== 'boolean')) return invalid();
      if (!stageMounted()) return unavailable();
      if (!state.greenMenu) return applied({ closed: false });
      return atomic(async () => {
        const id = state.greenMenu.windowId;
        state.greenMenu = null;
        await ctx.settle();
        if (payload.restoreFocus !== false && !await ctx.restoreFocus(id)) return unavailable();
        return applied({ closed: true });
      });
    },
    'window.greenMenu.select': async (target, payload) => {
      if (!fields(target, ['itemId']) || !identity(target.itemId) || !fields(payload, [])) return invalid();
      const error = menuSelectionError(target.itemId);
      if (error) return error;
      return atomic(() => selectMenu(target.itemId));
    },
    'window.greenMenu.execute': async (target, payload) => {
      if (!fields(target, ['itemId']) || !identity(target.itemId) || !fields(payload, [])) return invalid();
      if (!menuMounted()) return unavailable();
      const item = menuItems().find(item => item.itemId === target.itemId);
      if (!item) return rejected('not_found', 'The native menu item does not exist.');
      if (item.disabled) return disabled();
      if (!menuView().itemIds().includes(item.itemId)) return unavailable();
      const window = lookup(state.greenMenu.windowId);
      const result = item.itemId === 'full-screen' ? await setFullScreen(window.id, !window.fullScreen)
        : item.itemId === 'move-to-desktop' ? await setFullScreen(window.id, false)
          : item.itemId === 'make-full-screen' ? await makeFullScreen(window.id)
            : item.itemId === 'replace-tiled' ? await replace(window.id)
              : await begin(window.id, item.itemId === 'tile-left' ? 'left' : 'right');
      return result.status === 'applied' ? applied({ windowId: window.id, action: item.itemId }) : result;
    },
    'window.greenMenu.scroll': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['top']) || !offsetValid(payload.top)) return invalid();
      if (!menuMounted()) return unavailable();
      return atomic(async () => {
        const current = state.greenMenu, actual = await menuView().scrollTo(payload.top);
        if (state.greenMenu !== current || !menuMounted() || !offsetValid(actual) || actual !== menuView().scrollTop()) return unavailable();
        current.scrollTop = actual;
        return applied({ top: actual });
      });
    },
  };
  return Object.fromEntries(Object.entries(commands).filter(([name]) => {
    const capability = ['window.splitView.replace', 'window.splitView.makeFullScreen'].includes(name)
      || name.startsWith('window.greenMenu.') ? 'shell.window-green-menu'
      : name.startsWith('window.splitView.') ? 'shell.split-view' : 'shell.full-screen';
    return profile.capabilities.includes(capability);
  }));
}

import { isRecord, rejected } from './feature-commands.js';
import { APP_COMMAND_MENU_IDS } from './app-command-menus.js';
import { helpMenuProviders, helpMenuResults, helpMenuLocation } from './help-menu-model.js';
import { searchHelpArticles } from './help-content.js';

const MENU_IDS = ['apple', 'application', 'window', 'users', 'wifi', 'battery', ...APP_COMMAND_MENU_IDS];
const KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Space', 'Escape', 'Tab'];
const MAX_LEVELS = 8;
const identity = value => typeof value === 'string' && value.length > 0;
const fields = (value, allowed, required = allowed) => isRecord(value)
  && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
const offset = value => Number.isFinite(value) && value >= 0;
const position = value => value === 'first' || value === 'last';
const enabled = item => item.enabled === true && !item.separator;
const applied = (target = {}) => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented closed menu target and payload.');
const unavailable = () => rejected('unavailable', 'The requested native menu, popup or focus is not currently available.');
const missing = () => rejected('not_found', 'The menu provider, owner, item or child path is no longer current.');
const disabled = () => rejected('disabled', 'Choose an enabled native menu provider or item.');
const cloneLevels = levels => levels.map(level => ({ parentId: level.parentId, itemId: level.itemId, scrollTop: level.scrollTop }));
const snapshot = state => ({ menuId: state.menuId, appId: state.appId, levels: cloneLevels(state.levels),
  helpSearch: state.helpSearch ? { ...state.helpSearch } : null });
const own = (object, key) => Object.hasOwn(object, key);

/** Host-owned transient state. Focus/presentation return tokens never enter it. */
export function menuBarDefaults() {
  return { menuId: null, appId: null, levels: [], helpSearch: null };
}

function checkedMenus(menus) {
  const providerIds = new Set();
  for (const menu of menus) {
    if (!MENU_IDS.includes(menu.menuId) || menu.kind !== menu.menuId || providerIds.has(menu.menuId)) {
      throw new TypeError('Menu definitions need unique canonical provider identities.');
    }
    providerIds.add(menu.menuId);
    const ids = new Set(), rows = new Set(), pending = [...menu.items];
    while (pending.length) {
      const item = pending.pop();
      if (!identity(item.id) || ids.has(item.id) || rows.has(item)) throw new TypeError('Menu item identities must be unique throughout their provider tree.');
      ids.add(item.id); rows.add(item);
      if (own(item, 'children')) {
        if (!Array.isArray(item.children)) throw new TypeError('Menu children must be an item array.');
        pending.push(...item.children);
      }
    }
  }
  return menus;
}

function findItem(items, itemId) {
  for (const item of items) {
    if (item.id === itemId) return item;
    const child = item.children && findItem(item.children, itemId);
    if (child) return child;
  }
  return null;
}

function pathItems(menu, levels, recoverSelection = false) {
  if (!levels.length || levels.length > MAX_LEVELS || levels[0].parentId !== null) return { error: missing() };
  const items = [menu.items];
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index];
    if (!offset(level.scrollTop)) return { error: unavailable() };
    const selected = level.itemId === null ? null : items[index].find(item => item.id === level.itemId);
    if (level.itemId !== null && !selected && !(recoverSelection && index === levels.length - 1)) return { error: missing() };
    if (selected && !enabled(selected) && !(recoverSelection && index === levels.length - 1)) return { error: disabled() };
    if (index + 1 < levels.length) {
      if (!selected?.children || levels[index + 1].parentId !== selected.id) return { error: missing() };
      items.push(selected.children);
    }
  }
  return { items };
}

const openPayload = payload => fields(payload, ['position', 'itemId'], [])
  && (!own(payload, 'position') || position(payload.position))
  && (!own(payload, 'itemId') || identity(payload.itemId))
  && !(own(payload, 'position') && own(payload, 'itemId'));
const closePayload = payload => fields(payload, ['restoreFocus'], [])
  && (!own(payload, 'restoreFocus') || typeof payload.restoreFocus === 'boolean');
const observePayload = payload => fields(payload, ['observe'], [])
  && (!own(payload, 'observe') || typeof payload.observe === 'boolean');
const menuTarget = (target, item = false, nullable = false) => fields(target, item ? ['menuId', 'itemId'] : ['menuId'])
  && MENU_IDS.includes(target.menuId) && (!item || identity(target.itemId) || (nullable && target.itemId === null));
const commandMenuTarget = (target, item = false) => fields(target, item ? ['menuId', 'appId', 'itemId'] : ['menuId', 'appId'])
  && APP_COMMAND_MENU_IDS.includes(target.menuId) && identity(target.appId) && (!item || identity(target.itemId));
const scrollPayload = (payload, withLevel) => fields(payload, withLevel ? ['top', 'observe', 'level'] : ['top', 'observe'], ['top'])
  && offset(payload.top) && (!own(payload, 'observe') || typeof payload.observe === 'boolean')
  && (!withLevel || !own(payload, 'level') || (Number.isInteger(payload.level) && payload.level >= 0 && payload.level < MAX_LEVELS));

/**
 * ctx.state is the menuBar object itself. getMenus supplies live provider trees;
 * getView(menuId) supplies the shared native facade. invoke takes ONE canonical
 * request, not Host.execute, so action dispatch cannot recursively queue itself.
 * Optional registerLifecycle receives internal clear/getReturnFocus hooks; these
 * are never part of public command/discovery state.
 */
export function createMenuBarCommands(ctx) {
  const { state, profile } = ctx;
  let returnFocus, hasReturnFocus = false, lifecycleVersion = 0;
  const menus = () => checkedMenus(ctx.getMenus());
  const view = menuId => ctx.getView(menuId);
  const writeState = value => {
    state.menuId = value.menuId; state.appId = value.appId; state.levels = cloneLevels(value.levels);
    state.helpSearch = value.helpSearch ? { ...value.helpSearch } : null;
    return state.levels;
  };
  ctx.registerLifecycle?.({
    clear() {
      lifecycleVersion += 1;
      writeState(menuBarDefaults());
      returnFocus = undefined; hasReturnFocus = false;
    },
    getReturnFocus: () => hasReturnFocus ? returnFocus : undefined,
  });
  const sameState = (next, levels) => state.menuId === next.menuId && state.appId === next.appId && state.levels === levels;
  const navigationTarget = () => ({ menuId: state.menuId, itemId: state.levels.at(-1)?.itemId ?? null,
    level: state.menuId === null ? null : state.levels.length - 1 });

  function provider(menuId, helpProjection = null) {
    const definitions = menus();
    const menu = (helpProjection ? helpMenuProviders(definitions, helpProjection, profile) : definitions)
      .find(menu => menu.menuId === menuId);
    if (!menu) return { error: missing() };
    if (!menu.enabled) return { error: disabled() };
    if (!ctx.available() || !view(menuId)?.available(menuId)) return { error: unavailable() };
    return { menu };
  }

  function current(menuId, recoverSelection = false) {
    if (state.menuId !== menuId) return { error: unavailable() };
    const result = provider(menuId);
    if (result.error) return result;
    if (result.menu.appId !== undefined && state.appId !== result.menu.appId) return { error: missing() };
    return { ...result, ...pathItems(result.menu, state.levels, recoverSelection) };
  }

  function mounted(menuId, level) {
    const native = view(menuId);
    return ctx.available() && state.menuId === menuId && !!state.levels[level] && native?.available(menuId)
      && native.bounds(menuId)?.popups.some(popup => popup.level === level && popup.available !== false && popup.popup)
      && offset(native.scrollTop(menuId, level));
  }

  function row(menuId, itemId, closedWindow = false, recoverSelection = false) {
    const result = state.menuId === null && closedWindow ? provider(menuId) : current(menuId, recoverSelection);
    if (result.error) return result;
    const item = itemId === null ? null : findItem(result.menu.items, itemId);
    if (itemId !== null && !item) return { error: missing() };
    if (item && !enabled(item)) return { error: disabled() };
    if (state.menuId === null) {
      if (!result.menu.items.includes(item)) return { error: unavailable() };
      return { ...result, item, level: 0 };
    }
    const level = itemId === null ? state.levels.length - 1 : result.items.findIndex(items => items.includes(item));
    if (level < 0 || !mounted(menuId, level)) return { error: unavailable() };
    const ids = view(menuId).itemIds(menuId, level);
    if (itemId === null) {
      if (result.items[level].some(enabled)) return { error: invalid() };
      if (ids.length) return { error: unavailable() };
    } else if (!ids.includes(itemId)) return { error: unavailable() };
    return { ...result, item, level };
  }

  async function restoreNative(previous, fallbackFocus) {
    if (previous.menuId === null) return await ctx.restoreFocus(fallbackFocus);
    const menuId = previous.menuId, level = previous.levels.length - 1;
    if (previous.helpSearch?.searchFocused) return await view(menuId).focusSearch();
    if (!mounted(menuId, level)) return false;
    if (!await view(menuId).focus(menuId, level, previous.levels[level].itemId)) return false;
    for (let index = 0; index < previous.levels.length; index += 1) {
      // Covered ancestor panes cannot receive physical writes until exposed.
      if (mounted(menuId, index)) await view(menuId).scroll(menuId, index, previous.levels[index].scrollTop);
    }
    return true;
  }

  async function transition(next, apply, prepare = false, capture = false) {
    const previous = snapshot(state), previousToken = returnFocus, previouslyCaptured = hasReturnFocus, version = lifecycleVersion;
    let competing, prepared = false, written, candidateToken = returnFocus;
    if (capture) candidateToken = await ctx.captureFocus();
    if (version !== lifecycleVersion) return unavailable();
    const rollback = async () => {
      if (version !== lifecycleVersion || (written && !sameState(next, written))) return;
      writeState(previous);
      returnFocus = previousToken; hasReturnFocus = previouslyCaptured;
      await ctx.settle();
      if (prepared) { await ctx.restorePresentation(competing); await ctx.settle(); }
      await restoreNative(previous, candidateToken);
    };
    try {
      if (prepare) { competing = await ctx.preparePresentation(); prepared = true; }
      if (version !== lifecycleVersion) return unavailable();
      written = writeState(next);
      if (capture) { returnFocus = candidateToken; hasReturnFocus = true; }
      await ctx.settle();
      const result = version === lifecycleVersion && sameState(next, written) ? await apply() : unavailable();
      if (result.status !== 'applied') await rollback();
      return result;
    } catch (error) {
      await rollback();
      throw error;
    }
  }

  async function focusLevel(menuId, level, itemId) {
    const expected = state.levels, owner = state.appId, native = view(menuId);
    const check = () => state.levels === expected && state.appId === owner && !row(menuId, itemId).error;
    if (!check() || !await native.focus(menuId, level, itemId) || !check()
      || native.focusedItem(menuId, level) !== itemId) return unavailable();
    const top = native.scrollTop(menuId, level);
    if (!offset(top) || !check()) return unavailable();
    expected[level].scrollTop = top;
    return applied();
  }

  async function open(menuId, payload, appId) {
    const result = provider(menuId);
    if (result.error) return result.error;
    const { menu } = result;
    if (menu.appId !== undefined && appId !== undefined && appId !== menu.appId) {
      return own(profile.applications ?? {}, appId) ? disabled() : missing();
    }
    const eligible = menu.items.filter(enabled);
    const selected = own(payload, 'itemId') ? menu.items.find(item => item.id === payload.itemId)
      : payload.position === 'last' ? eligible.at(-1) : eligible[0];
    if (own(payload, 'itemId') && !selected) return missing();
    if (selected && !enabled(selected)) return disabled();
    const next = { menuId, appId: menu.appId ?? null,
      levels: [{ parentId: null, itemId: selected?.id ?? null, scrollTop: 0 }],
      helpSearch: menu.search ? { query: menu.search.query, locationId: null, searchFocused: false } : null };
    const searchFocus = menu.search && !own(payload, 'itemId') && !own(payload, 'position');
    const opened = await transition(next, async () => {
      if (!searchFocus) return await focusLevel(menuId, 0, next.levels[0].itemId);
      if (!await view(menuId).focusSearch() || !view(menuId).searchFocused()) return unavailable();
      state.helpSearch.searchFocused = true;
      return applied();
    }, true, state.menuId === null);
    if (opened.status !== 'applied') return opened;
    if (menuId === 'application') return applied({ appId: menu.appId, itemId: state.levels[0].itemId });
    if (menuId === 'window') return applied({ menuId, itemId: state.levels[0].itemId });
    return applied({ menuId });
  }

  async function close(menuId, restoreFocus = true) {
    if (!ctx.available()) return unavailable();
    if (state.menuId !== null && state.menuId !== menuId) return unavailable();
    if (state.menuId === null) return applied();
    if (restoreFocus && !view(menuId)?.available(menuId)) return unavailable();
    const result = await transition(menuBarDefaults(), async () => !restoreFocus || await view(menuId).focusInvoker(menuId)
      ? applied() : unavailable());
    if (result.status === 'applied') { returnFocus = undefined; hasReturnFocus = false; }
    return result;
  }

  async function select(menuId, itemId, observe = false) {
    const result = row(menuId, itemId, false, true);
    if (result.error) return result.error;
    const { level } = result, native = view(menuId);
    if (observe && native.focusedItem(menuId, level) !== itemId) return unavailable();
    const next = snapshot(state);
    next.levels = next.levels.slice(0, level + 1); next.levels[level].itemId = itemId;
    if (next.helpSearch) {
      next.helpSearch.locationId = result.item?.helpResult?.resultId ?? null;
      next.helpSearch.searchFocused = false;
    }
    return transition(next, async () => {
      if (!observe) {
        const focused = await focusLevel(menuId, level, itemId);
        if (focused.status !== 'applied') return focused;
        return !next.helpSearch?.locationId || await native.prepareLocation(next.helpSearch.locationId) ? applied() : unavailable();
      }
      if (row(menuId, itemId).error || native.focusedItem(menuId, level) !== itemId) return unavailable();
      const top = native.scrollTop(menuId, level);
      if (!offset(top)) return unavailable();
      state.levels[level].scrollTop = top;
      return !next.helpSearch?.locationId || await native.prepareLocation(next.helpSearch.locationId) ? applied() : unavailable();
    });
  }

  async function submenu(menuId, itemId, requestedPosition) {
    const result = row(menuId, itemId);
    if (result.error) return result.error;
    const { item, level } = result;
    if (!item?.children) return disabled();
    if (level + 1 >= MAX_LEVELS) return disabled();
    const next = snapshot(state), existing = next.levels[level + 1];
    if (existing?.parentId === itemId && requestedPosition === undefined) {
      return transition(next, () => focusLevel(menuId, next.levels.length - 1, next.levels.at(-1).itemId));
    }
    const eligible = item.children.filter(enabled), selected = requestedPosition === 'last' ? eligible.at(-1) : eligible[0];
    next.levels = next.levels.slice(0, level + 1); next.levels[level].itemId = itemId;
    return transition(next, async () => {
      // Reveal/focus the owning row before its child can cover the parent pane.
      const parentFocused = await focusLevel(menuId, level, itemId);
      if (parentFocused.status !== 'applied') return parentFocused;
      const ownedLevels = state.levels;
      ownedLevels.push({ parentId: itemId, itemId: selected?.id ?? null, scrollTop: 0 });
      await ctx.settle();
      if (state.levels !== ownedLevels) return unavailable();
      return focusLevel(menuId, level + 1, selected?.id ?? null);
    });
  }

  async function pop(menuId) {
    const result = current(menuId, true);
    if (result.error) return result.error;
    const level = state.levels.length - 1;
    if (level === 0 || !mounted(menuId, level)) return unavailable();
    const next = snapshot(state); next.levels.pop();
    return transition(next, () => focusLevel(menuId, level - 1, next.levels[level - 1].itemId));
  }

  async function execute(menuId, itemId) {
    const result = row(menuId, itemId, menuId === 'window');
    if (result.error) return result.error;
    const { item } = result;
    if (!item || item.children || !item.request) return disabled();
    if (['wifi', 'battery'].includes(menuId) && item.keepOpen === true) {
      const next = snapshot(state);
      next.levels = [{ parentId: null, itemId, scrollTop: state.levels[0].scrollTop }];
      return transition(next, async () => {
        const focused = await focusLevel(menuId, 0, itemId);
        if (focused.status !== 'applied') return focused;
        const live = row(menuId, itemId);
        if (live.error) return live.error;
        const downstream = await ctx.invoke(live.item.request);
        if (downstream.status !== 'applied') return downstream;
        await ctx.settle();
        // A committed status change must never be reported rejected
        // merely because subsequent native geometry/focus changed.
        if (state.menuId === menuId && mounted(menuId, 0)) {
          const recovered = current(menuId, true);
          if (!recovered.error) {
            const items = recovered.items[0], level = state.levels[0];
            const retained = items.find(item => item.id === level.itemId && enabled(item));
            level.itemId = (retained ?? items.find(enabled))?.id ?? null;
            await focusLevel(menuId, 0, level.itemId);
          }
        }
        return applied({ menuId, itemId });
      });
    }
    const wasOpen = state.menuId !== null, version = lifecycleVersion, appId = result.menu.appId;
    const helpResult = item.helpResult;
    // Closing clears the search UI, not the query that produced this leased action.
    const helpProjection = menuId === 'help' && state.helpSearch ? snapshot(state) : null;
    const originalRequest = helpResult || helpProjection ? JSON.stringify(item.request) : null;
    // Apple actions lease the modifier variant chosen at activation. Releasing
    // Option during native return-focus must not replace that accepted intent.
    // Live ownership, existence and enablement are still checked below.
    const activationRequest = menuId === 'apple' && profile.capabilities.includes('shell.apple-menu') ? item.request : null;
    const invoke = async () => {
      if (wasOpen && (!hasReturnFocus || !await ctx.restoreFocus(returnFocus))) return unavailable();
      if (version !== lifecycleVersion) return unavailable();
      // Revalidate ownership and enablement after physical return focus settles.
      const live = provider(helpResult?.menuId ?? menuId, helpProjection);
      if (live.error) return live.error;
      const currentItem = findItem(live.menu.items, helpResult?.itemId ?? itemId);
      if (!currentItem) return missing();
      if (!enabled(currentItem) || currentItem.children || !currentItem.request) return disabled();
      if (live.menu.appId !== appId) return missing();
      if (originalRequest !== null && JSON.stringify(currentItem.request) !== originalRequest) return missing();
      if (helpResult && !helpMenuResults(menus(), appId, helpResult.label).some(entry =>
        entry.resultId === helpResult.resultId && entry.enabled)) return missing();
      const downstream = await ctx.invoke(activationRequest ?? currentItem.request);
      if (downstream.status !== 'applied') return downstream;
      return applied(menuId === 'window' ? { menuId, itemId, windowId: currentItem.request.target?.windowId ?? downstream.target?.windowId }
        : menuId === 'application' ? {} : { menuId, itemId });
    };
    let completed;
    if (wasOpen) completed = await transition(menuBarDefaults(), invoke);
    else {
      completed = await invoke();
      if (completed.status === 'applied') await view(menuId)?.focusInvoker(menuId);
    }
    if (completed.status === 'applied') { returnFocus = undefined; hasReturnFocus = false; }
    return completed;
  }

  async function scroll(menuId, payload) {
    const result = current(menuId, true);
    if (result.error) return result.error;
    const level = payload.level ?? state.levels.length - 1;
    if (!mounted(menuId, level)) return unavailable();
    const native = view(menuId), expected = state.levels;
    if (payload.observe === true) {
      const top = native.scrollTop(menuId, level);
      if (!offset(top)) return unavailable();
      expected[level].scrollTop = top; return applied({ menuId, level, top });
    }
    const next = snapshot(state);
    return transition(next, async () => {
      const ownedLevels = state.levels;
      const top = await native.scroll(menuId, level, payload.top);
      if (!offset(top) || state.levels !== ownedLevels || !mounted(menuId, level) || current(menuId).error) return unavailable();
      state.levels[level].scrollTop = top; return applied({ menuId, level, top });
    });
  }

  async function navigate(menuId, key) {
    if (state.menuId === null && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      const source = provider(menuId);
      if (source.error) return source.error;
      const providers = menus().filter(menu => menu.enabled && view(menu.menuId)?.available(menu.menuId));
      const index = providers.findIndex(menu => menu.menuId === menuId), step = key === 'ArrowLeft' ? -1 : 1;
      if (index < 0 || !providers.length) return unavailable();
      const opened = await open(providers[(index + step + providers.length) % providers.length].menuId, {});
      return opened.status === 'applied' ? applied(navigationTarget()) : opened;
    }
    const result = current(menuId, true);
    if (result.error) return result.error;
    const level = state.levels.length - 1;
    if (!mounted(menuId, level)) return unavailable();
    const itemId = state.levels[level].itemId, item = result.items[level].find(item => item.id === itemId);
    let moved;
    if (key === 'Escape') moved = level > 0 ? await pop(menuId) : await close(menuId);
    else if (key === 'Tab') moved = await close(menuId);
    else if (key === 'ArrowLeft' && level > 0) moved = await pop(menuId);
    else if ((key === 'ArrowRight' || key === 'Enter' || key === 'Space') && item?.children) moved = await submenu(menuId, itemId);
    else if (key === 'Enter' || key === 'Space') moved = item ? await execute(menuId, itemId) : itemId === null ? applied() : missing();
    else if ((key === 'ArrowLeft' || key === 'ArrowRight') && level === 0) {
      const providers = menus().filter(menu => menu.enabled && view(menu.menuId)?.available(menu.menuId));
      const index = providers.findIndex(menu => menu.menuId === menuId), step = key === 'ArrowLeft' ? -1 : 1;
      if (index < 0 || !providers.length) return unavailable();
      moved = await open(providers[(index + step + providers.length) % providers.length].menuId, {});
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) {
      const semantic = result.items[level].filter(enabled), ids = view(menuId).itemIds(menuId, level);
      const eligible = semantic.filter(item => ids.includes(item.id));
      if (!eligible.length) {
        if (semantic.length) return unavailable();
        moved = await select(menuId, null);
      } else {
        const index = eligible.findIndex(item => item.id === itemId);
        if (itemId !== null && index < 0 && semantic.some(item => item.id === itemId)) return unavailable();
        const selected = key === 'Home' ? eligible[0] : key === 'End' ? eligible.at(-1)
          : eligible[index < 0 ? (key === 'ArrowUp' ? eligible.length - 1 : 0)
            : (index + (key === 'ArrowUp' ? -1 : 1) + eligible.length) % eligible.length];
        moved = await select(menuId, selected.id);
      }
    } else moved = applied();
    return moved.status === 'applied' ? applied(navigationTarget()) : moved;
  }
  async function commandMenu(action, target, payload) {
    const item = action === 'select' || action === 'execute';
    if (!commandMenuTarget(target, item) || !(action === 'open' ? openPayload(payload) : action === 'close'
      ? closePayload(payload) : action === 'select' ? observePayload(payload) : fields(payload, []))) return invalid();
    const owned = provider(target.menuId);
    if (owned.error) return owned.error;
    if (owned.menu.appId !== target.appId) return own(profile.applications ?? {}, target.appId) ? disabled() : missing();
    const result = action === 'open' ? await open(target.menuId, payload, target.appId)
      : action === 'close' ? await close(target.menuId, payload.restoreFocus !== false)
      : action === 'select' ? await select(target.menuId, target.itemId, payload.observe === true)
      : await execute(target.menuId, target.itemId);
    return result.status === 'applied' ? applied({ menuId: target.menuId, appId: target.appId,
      itemId: action === 'execute' ? target.itemId : action === 'close' ? null : state.levels.at(-1)?.itemId ?? null }) : result;
  }

  function helpOwner(target) {
    if (!fields(target, ['appId']) || !identity(target.appId)) return { error: invalid() };
    if (!profile.capabilities.includes('shell.help-workflows')) return { error: rejected('unsupported_profile', 'Help search is available only in Golden Gate.') };
    const owned = current('help');
    if (owned.error) return owned;
    if (state.appId !== target.appId) return { error: missing() };
    if (!state.helpSearch || !mounted('help', 0)) return { error: unavailable() };
    return owned;
  }


  const handlers = {
    'menu.help.search': async (target, payload) => {
      if (!fields(payload, ['query']) || typeof payload.query !== 'string' || payload.query.length > 256) return invalid();
      const owned = helpOwner(target);
      if (owned.error) return owned.error;
      const next = snapshot(state);
      next.helpSearch.query = payload.query; next.helpSearch.locationId = null;
      next.levels = [{ parentId: null, itemId: 'app-help', scrollTop: 0 }];
      return await transition(next, () => {
        const live = helpOwner(target);
        if (live.error) return live.error;
        return applied({ appId: target.appId, query: payload.query,
          menuResultIds: helpMenuResults(menus(), target.appId, payload.query).map(result => result.resultId),
          articleIds: searchHelpArticles(profile, target.appId, payload.query).map(article => article.articleId) });
      });
    },
    'menu.help.focus': async (target, payload) => {
      if (!observePayload(payload)) return invalid();
      const owned = helpOwner(target);
      if (owned.error) return owned.error;
      const next = snapshot(state); next.helpSearch.locationId = null; next.helpSearch.searchFocused = true;
      return await transition(next, async () => {
        if (payload.observe !== true && !await view('help').focusSearch()) return unavailable();
        if (!helpOwner(target).error && view('help').searchFocused()) {
          state.levels[0].scrollTop = view('help').scrollTop('help', 0);
          return applied({ appId: target.appId });
        }
        return unavailable();
      });
    },
    'menu.help.locate': async (target, payload) => {
      if (!fields(target, ['appId', 'resultId']) || !identity(target.appId)
        || !(target.resultId === null || identity(target.resultId)) || !observePayload(payload)) return invalid();
      const owned = helpOwner({ appId: target.appId });
      if (owned.error) return owned.error;
      if (target.resultId === null) {
        const focused = await handlers['menu.help.focus']({ appId: target.appId }, {});
        return focused.status === 'applied' ? applied({ appId: target.appId, resultId: null, menuId: null, itemId: null, pathIds: [] }) : focused;
      }
      const result = helpMenuResults(menus(), target.appId, state.helpSearch.query).find(result => result.resultId === target.resultId);
      if (!result) return missing();
      const selected = await select('help', result.resultId, payload.observe === true);
      if (selected.status !== 'applied') return selected;
      return applied({ appId: target.appId, resultId: result.resultId, menuId: result.menuId,
        itemId: result.itemId, pathIds: result.pathIds });
    },
    'desktop.scroll': async (target, payload) => {
      if (!fields(target, ['region']) || target.region !== 'window-menu' || !fields(payload, ['top']) || !offset(payload.top)) return invalid();
      const result = await scroll('window', { top: payload.top, level: 0 });
      return result.status === 'applied' ? applied({ region: 'window-menu' }) : result;
    },
    'menu.open': (target, payload) => menuTarget(target) && target.menuId === 'window' && openPayload(payload) ? open('window', payload) : invalid(),
    'menu.close': async (target, payload) => {
      if (!menuTarget(target) || target.menuId !== 'window' || !closePayload(payload)) return invalid();
      const result = await close('window', payload.restoreFocus !== false);
      return result.status === 'applied' ? applied({ menuId: 'window' }) : result;
    },
    'menu.select': async (target, payload) => {
      if (!menuTarget(target, true, true) || target.menuId !== 'window' || !fields(payload, [])) return invalid();
      const result = await select('window', target.itemId);
      return result.status === 'applied' ? applied({ menuId: 'window', itemId: target.itemId }) : result;
    },
    'menu.execute': (target, payload) => menuTarget(target, true) && target.menuId === 'window' && fields(payload, []) ? execute('window', target.itemId) : invalid(),
    'app.menu.open': (target, payload) => fields(target, ['appId'], []) && (!own(target, 'appId') || identity(target.appId)) && openPayload(payload)
      ? open('application', payload, target.appId) : invalid(),
    'app.menu.close': (target, payload) => fields(target, []) && closePayload(payload) ? close('application', payload.restoreFocus !== false) : invalid(),
    'app.menu.select': async (target, payload) => {
      if (!fields(target, ['itemId']) || !identity(target.itemId) || !observePayload(payload)) return invalid();
      const result = await select('application', target.itemId, payload.observe === true);
      return result.status === 'applied' ? applied({ itemId: target.itemId }) : result;
    },
    'app.menu.execute': (target, payload) => fields(target, ['itemId']) && identity(target.itemId) && fields(payload, []) ? execute('application', target.itemId) : invalid(),
    'app.menu.scroll': async (target, payload) => {
      if (!fields(target, []) || !scrollPayload(payload, false)) return invalid();
      const result = await scroll('application', payload);
      return result.status === 'applied' ? applied({ top: result.target.top }) : result;
    },
    'app.commandMenu.open': (target, payload) => commandMenu('open', target, payload),
    'app.commandMenu.close': (target, payload) => commandMenu('close', target, payload),
    'app.commandMenu.select': (target, payload) => commandMenu('select', target, payload),
    'app.commandMenu.execute': (target, payload) => commandMenu('execute', target, payload),
    'status.menu.open': (target, payload) => menuTarget(target) && ['wifi', 'battery'].includes(target.menuId) && openPayload(payload)
      ? open(target.menuId, payload) : invalid(),
    'status.menu.close': async (target, payload) => {
      if (!menuTarget(target) || !['wifi', 'battery'].includes(target.menuId) || !closePayload(payload)) return invalid();
      const result = await close(target.menuId, payload.restoreFocus !== false);
      return result.status === 'applied' ? applied({ menuId: target.menuId }) : result;
    },
    'status.menu.select': async (target, payload) => {
      if (!menuTarget(target, true) || !['wifi', 'battery'].includes(target.menuId) || !observePayload(payload)) return invalid();
      const result = await select(target.menuId, target.itemId, payload.observe === true);
      return result.status === 'applied' ? applied({ menuId: target.menuId, itemId: target.itemId }) : result;
    },
    'status.menu.execute': (target, payload) => menuTarget(target, true) && ['wifi', 'battery'].includes(target.menuId) && fields(payload, [])
      ? execute(target.menuId, target.itemId) : invalid(),
    'session.menu.open': (target, payload) => menuTarget(target) && ['apple', 'users'].includes(target.menuId) && openPayload(payload) ? open(target.menuId, payload) : invalid(),
    'session.menu.close': async (target, payload) => {
      if (!fields(target, []) || !closePayload(payload)) return invalid();
      if (state.menuId !== null && !['apple', 'users'].includes(state.menuId)) return unavailable();
      const menuId = state.menuId, result = await close(menuId, payload.restoreFocus !== false);
      return result.status === 'applied' ? applied({ menuId }) : result;
    },
    'session.menu.focus': async (target, payload) => {
      if (!menuTarget(target, true) || !['apple', 'users'].includes(target.menuId) || !observePayload(payload)) return invalid();
      const result = await select(target.menuId, target.itemId, payload.observe === true);
      return result.status === 'applied' ? applied({ menuId: target.menuId, itemId: target.itemId }) : result;
    },
    'session.menu.select': (target, payload) => menuTarget(target, true) && ['apple', 'users'].includes(target.menuId) && fields(payload, []) ? execute(target.menuId, target.itemId) : invalid(),
    'menu.navigate': (target, payload) => menuTarget(target) && fields(payload, ['key']) && KEYS.includes(payload.key) ? navigate(target.menuId, payload.key) : invalid(),
    'menu.submenu.open': async (target, payload) => {
      if (!menuTarget(target, true) || !fields(payload, ['position'], []) || (own(payload, 'position') && !position(payload.position))) return invalid();
      const result = await submenu(target.menuId, target.itemId, payload.position);
      return result.status === 'applied' ? applied(navigationTarget()) : result;
    },
    'menu.submenu.close': async (target, payload) => {
      if (!menuTarget(target) || !fields(payload, [])) return invalid();
      const result = await pop(target.menuId);
      return result.status === 'applied' ? applied(navigationTarget()) : result;
    },
    'menu.scroll': (target, payload) => menuTarget(target) && scrollPayload(payload, true) ? scroll(target.menuId, payload) : invalid(),
  };
  return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, async (target, payload) => {
    const capability = name.startsWith('app.commandMenu.') ? 'shell.menu-bar' : name.startsWith('app.') ? 'app.visibility' : name.startsWith('session.') ? 'session.fictional'
      : ['menu.open', 'menu.close', 'menu.select', 'menu.execute', 'desktop.scroll'].includes(name) ? 'shell.window-menu' : 'shell.menu-bar';
    return profile.id !== 'macos-golden-gate-27.0.1' || !profile.capabilities.includes(capability)
      ? rejected('unsupported_profile', 'The shared menu controller is available only in Golden Gate.') : await handler(target, payload);
  }]));
}

function detached(value) {
  if (Array.isArray(value)) return value.map(detached);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, detached(entry)]));
  return value;
}

/** Detached semantic discovery; native availability/bounds are null-safe. */
export function menuBarTargets(state, menus, getView) {
  const location = helpMenuLocation(menus, state);
  return { ...snapshot(state), help: state.helpSearch ? {
    query: state.helpSearch.query, menuResults: helpMenuResults(menus, state.appId, state.helpSearch.query),
    location: location ? { resultId: location.resultId, menuId: location.menuId, itemId: location.itemId,
      pathIds: location.pathIds, pathLabels: location.pathLabels, enabled: location.enabled,
      bounds: getView?.('help')?.locationBounds?.() ?? null } : null,
  } : null, providers: checkedMenus(menus).map(menu => {
    const native = getView?.(menu.menuId), available = menu.enabled && native?.available(menu.menuId) === true;
    const bounds = available ? native.bounds(menu.menuId) : null;
    return { menuId: menu.menuId, kind: menu.kind, label: menu.label, enabled: menu.enabled,
      ...(menu.appId === undefined ? {} : { appId: menu.appId }), items: detached(menu.items), available,
      bounds: bounds ? detached(bounds) : null,
      levels: state.menuId === menu.menuId ? state.levels.map((entry, level) => ({ ...entry, level,
        available: !!(available && bounds?.popups.some(popup => popup.level === level && popup.available !== false && popup.popup)),
        itemIds: available ? [...native.itemIds(menu.menuId, level)] : [] })) : [] };
  }) };
}

const pick = (args, keys) => Object.fromEntries(keys.filter(key => own(args, key)).map(key => [key, args[key]]));

/** UI routing preserves provider API identities; generic actions need no tree. */
export function menuBarRequest(action, menuId, menus, args = {}) {
  if (!MENU_IDS.includes(menuId)) throw new RangeError('Unknown canonical menu provider.');
  if (action === 'navigate') return { command: 'menu.navigate', target: { menuId }, payload: pick(args, ['key']) };
  if (action === 'submenu') return { command: 'menu.submenu.open', target: { menuId, itemId: args.itemId }, payload: pick(args, ['position']) };
  if (action === 'scroll' && (menuId !== 'application' || own(args, 'level'))) {
    return { command: 'menu.scroll', target: { menuId }, payload: pick(args, ['top', 'observe', 'level']) };
  }
  if (!['open', 'close', 'select', 'execute', 'scroll'].includes(action)) throw new RangeError(`Unknown menu action: ${action}`);
  const menu = menus.find(menu => menu.menuId === menuId);
  if (action === 'open' && menuId === 'application' && !menu) throw new RangeError('The application menu needs its current owner definition.');
  if (APP_COMMAND_MENU_IDS.includes(menuId)) {
    if (!menu) throw new RangeError('The app command menu needs its current owner definition.');
    return { command: `app.commandMenu.${action}`, target: { menuId, appId: menu.appId,
      ...(['select', 'execute'].includes(action) ? { itemId: args.itemId } : {}) },
    payload: action === 'open' ? pick(args, ['position', 'itemId']) : action === 'close' ? pick(args, ['restoreFocus'])
      : action === 'select' ? pick(args, ['observe']) : {} };
  }
  if (menuId === 'application') {
    return { command: `app.menu.${action}`, target: action === 'open' ? { appId: menu.appId }
      : ['select', 'execute'].includes(action) ? { itemId: args.itemId } : {},
    payload: action === 'open' ? pick(args, ['position', 'itemId']) : action === 'close' ? pick(args, ['restoreFocus'])
      : action === 'select' ? pick(args, ['observe']) : action === 'scroll' ? pick(args, ['top', 'observe']) : {} };
  }
  if (menuId === 'window') return { command: `menu.${action}`, target: ['select', 'execute'].includes(action) ? { menuId, itemId: args.itemId } : { menuId },
    payload: action === 'open' ? pick(args, ['position', 'itemId']) : action === 'close' ? pick(args, ['restoreFocus']) : {} };
  if (['wifi', 'battery'].includes(menuId)) return { command: `status.menu.${action}`, target: { menuId,
    ...(['select', 'execute'].includes(action) ? { itemId: args.itemId } : {}) },
    payload: action === 'open' ? pick(args, ['position', 'itemId']) : action === 'close' ? pick(args, ['restoreFocus'])
      : action === 'select' ? pick(args, ['observe']) : {} };
  return { command: `session.menu.${action === 'select' ? 'focus' : action === 'execute' ? 'select' : action}`,
    target: action === 'close' ? {} : ['select', 'execute'].includes(action) ? { menuId, itemId: args.itemId } : { menuId },
    payload: action === 'open' ? pick(args, ['position', 'itemId']) : action === 'close' ? pick(args, ['restoreFocus'])
      : action === 'select' ? pick(args, ['observe']) : {} };
}

import { isRecord, rejected } from './feature-commands.js';
import { dashboardWidgetTypes, dashboardWidgetDefaults, createDashboardWidget, dashboardWidgetTargets,
  applyDashboardWidgetCommand } from './dashboard-widgets.js';

const supported = profile => ['macos-high-sierra-10.13', 'macos-mojave-10.14'].includes(profile?.id)
  && profile.capabilities.includes('shell.dashboard');
const fields = (value, names, required = names) => isRecord(value)
  && Object.keys(value).every(key => names.includes(key)) && required.every(key => Object.hasOwn(value, key));
const identity = value => typeof value === 'string' && value.length > 0;
const offset = value => Number.isFinite(value) && value >= 0;
const position = value => value && offset(value.top) && offset(value.left);
const copy = value => Array.isArray(value) ? value.map(copy) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)])) : value;
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented closed Dashboard arguments.');
const unavailable = () => rejected('unavailable', 'The actual Dashboard scene or control is unavailable.');
const disabled = () => rejected('disabled', 'Enable Dashboard in Mission Control preferences or leave the current editing/configuration state.');
const missing = () => rejected('not_found', 'The requested Dashboard widget or control no longer exists.');

export function dashboardDefaults(profile) {
  const sceneTime = profile.renderer === 'high-sierra' ? Date.UTC(2017, 8, 25, 9, 41) : Date.UTC(2018, 8, 24, 17, 42);
  return { mode: 'off', widgets: supported(profile) ? dashboardWidgetDefaults(profile) : [], nextWidgetId: 6, sceneTime, view: null };
}

export function createDashboardCommands(ctx) {
  const { profile, state } = ctx;
  const view = () => ctx.getView();
  const available = () => ctx.available() === true;
  const mounted = () => available() && Boolean(state.view) && view()?.available() === true
    && Boolean(view().bounds()) && position(view().scrollPosition());
  const widget = id => state.widgets.find(item => item.id === id);
  let returnFocus = null, returnState = null, focusOwner = null;

  function snapshot() {
    return { state: copy(state), view: state.view, scene: ctx.captureScene(), focus: ctx.captureFocus(),
      returnFocus, returnState, focusOwner };
  }
  async function restore(previous) {
    Object.assign(state, previous.state);
    state.view = previous.view;
    if (previous.view) Object.assign(previous.view, previous.state.view);
    returnFocus = previous.returnFocus; returnState = previous.returnState; focusOwner = previous.focusOwner;
    await ctx.restoreScene(previous.scene);
    await ctx.settle();
    if (state.view && mounted()) {
      await view().prepare();
      await view().scroll(state.view.scroll.top, state.view.scroll.left);
    }
    await ctx.restoreFocus(previous.focus);
  }
  async function atomic(change) {
    let previous;
    try { previous = snapshot(); } catch { return unavailable(); }
    try {
      const result = await change();
      if (result.status !== 'applied') await restore(previous);
      return result;
    } catch {
      try { await restore(previous); } catch { /* An unmounted scene cannot restore physical focus. */ }
      return unavailable();
    }
  }
  function retainScroll() {
    if (!mounted()) return false;
    state.view.scroll = { ...view().scrollPosition() };
    return true;
  }
  async function select(itemId) {
    if (!mounted()) return unavailable();
    if (!view().itemIds().includes(itemId)) return missing();
    const current = state.view;
    if (!await view().focus(itemId) || current !== state.view || !mounted()
      || view().focusedItemId() !== itemId || !retainScroll()) return unavailable();
    current.selectedItemId = itemId;
    return applied({ itemId });
  }
  async function prepare(itemId = state.view?.selectedItemId ?? 'close') {
    await ctx.settle();
    await view()?.prepare();
    if (!mounted()) return unavailable();
    const scroll = state.view.scroll;
    if (!position(await view().scroll(scroll.top, scroll.left))) return unavailable();
    const ids = view().itemIds();
    return select(ids.includes(itemId) ? itemId : ids.includes('close') ? 'close' : ids[0]);
  }
  async function close(restoreFocus = true) {
    if (!state.view) return applied({ closed: false });
    const owned = focusOwner === state.view, focus = returnFocus, prior = returnState;
    state.view = null;
    await ctx.settle();
    if (!await ctx.leaveSpace(prior, false)) return unavailable();
    if (restoreFocus && owned && !await ctx.restoreFocus(focus) && !await ctx.focusReturn(prior)) return unavailable();
    returnFocus = null; returnState = null; focusOwner = null;
    return applied({ closed: true });
  }
  const commands = {
    'shell.dashboard.open': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      if (state.mode === 'off') return disabled();
      return atomic(async () => {
        if (state.view && focusOwner === state.view) {
          if (!mounted()) {
            const current = state.view;
            await ctx.dismissPresentations();
            state.view = current;
            if (state.mode === 'space' && !await ctx.enterSpace()) return unavailable();
          }
          const result = await prepare();
          return result.status === 'applied' ? applied({ mode: state.mode }) : result;
        }
        const focus = ctx.captureFocus(), prior = ctx.captureReturn();
        await ctx.dismissPresentations();
        state.view = { editing: false, library: false, configWidgetId: null, selectedItemId: 'close', scroll: { top: 0, left: 0 } };
        returnFocus = focus; returnState = prior; focusOwner = state.view;
        if (state.mode === 'space' && !await ctx.enterSpace()) return unavailable();
        const result = await prepare('close');
        return result.status === 'applied' ? applied({ mode: state.mode }) : result;
      });
    },
    'shell.dashboard.close': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['restoreFocus'], [])
        || Object.hasOwn(payload, 'restoreFocus') && typeof payload.restoreFocus !== 'boolean') return invalid();
      if (!available()) return unavailable();
      return atomic(() => close(payload.restoreFocus !== false));
    },
    'shell.dashboard.select': async (target, payload) => {
      if (!fields(target, ['itemId']) || !identity(target.itemId) || !fields(payload, [])) return invalid();
      if (!mounted()) return unavailable();
      return atomic(() => select(target.itemId));
    },
    'shell.dashboard.scroll': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['top', 'left']) || !position(payload)) return invalid();
      if (!mounted()) return unavailable();
      return atomic(async () => {
        const current = state.view, actual = await view().scroll(payload.top, payload.left);
        if (state.view !== current || !position(actual) || !retainScroll()) return unavailable();
        return applied({ ...current.scroll });
      });
    },
    'shell.dashboard.setEditing': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['editing']) || typeof payload.editing !== 'boolean') return invalid();
      if (!mounted()) return unavailable();
      return atomic(async () => {
        state.view.editing = payload.editing; state.view.library = false; state.view.configWidgetId = null;
        const result = await prepare('remove');
        return result.status === 'applied' ? applied({ editing: payload.editing }) : result;
      });
    },
    'shell.dashboard.setLibrary': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['open']) || typeof payload.open !== 'boolean') return invalid();
      if (!mounted()) return unavailable();
      return atomic(async () => {
        state.view.library = payload.open; state.view.editing = false; state.view.configWidgetId = null;
        const result = await prepare(payload.open ? 'library:clock' : 'add');
        return result.status === 'applied' ? applied({ open: payload.open }) : result;
      });
    },
    'shell.dashboard.configure': async (target, payload) => {
      if (!fields(target, ['widgetId']) || !fields(payload, []) || target.widgetId !== null && !identity(target.widgetId)) return invalid();
      if (!mounted()) return unavailable();
      const item = target.widgetId === null ? null : widget(target.widgetId);
      if (target.widgetId !== null && !item) return missing();
      if (item && !['clock', 'weather'].includes(item.type)) return disabled();
      return atomic(async () => {
        const previous = state.view.configWidgetId;
        state.view.configWidgetId = target.widgetId; state.view.library = false; state.view.editing = false;
        const result = await prepare(item ? `control:${item.id}:city` : previous ? `configure:${previous}` : 'close');
        return result.status === 'applied' ? applied({ widgetId: target.widgetId }) : result;
      });
    },
    'dashboard.widget.add': async (target, payload) => {
      if (!fields(target, ['type']) || !dashboardWidgetTypes.includes(target.type) || !fields(payload, [])) return invalid();
      if (!mounted()) return unavailable();
      if (!state.view.library || state.widgets.length >= 16) return disabled();
      return atomic(async () => {
        const widgetId = `dashboard-widget-${state.nextWidgetId++}`;
        const item = createDashboardWidget(target.type, widgetId, state.sceneTime, 24 + (state.widgets.length % 5) * 24, 24 + (state.widgets.length % 5) * 24);
        state.widgets.push(item); state.view.library = false;
        const result = await prepare(`widget:${widgetId}`);
        return result.status === 'applied' ? applied({ widgetId, type: target.type }) : result;
      });
    },
    'dashboard.widget.remove': async (target, payload) => {
      if (!fields(target, ['widgetId']) || !identity(target.widgetId) || !fields(payload, [])) return invalid();
      if (!mounted()) return unavailable();
      if (!widget(target.widgetId)) return missing();
      if (!state.view.editing) return disabled();
      return atomic(async () => {
        state.widgets = state.widgets.filter(item => item.id !== target.widgetId);
        const result = await prepare('remove');
        return result.status === 'applied' ? applied({ widgetId: target.widgetId }) : result;
      });
    },
    'dashboard.widget.move': async (target, payload) => {
      if (!fields(target, ['widgetId']) || !identity(target.widgetId) || !fields(payload, ['x', 'y']) || !offset(payload.x) || !offset(payload.y)) return invalid();
      if (!mounted()) return unavailable();
      const item = widget(target.widgetId);
      if (!item) return missing();
      if (state.view.library || state.view.configWidgetId) return disabled();
      return atomic(async () => {
        const point = view().widgetPosition(item.id, payload.x, payload.y);
        if (!point || !offset(point.x) || !offset(point.y)) return unavailable();
        item.x = point.x; item.y = point.y;
        const result = await prepare(`widget:${item.id}`);
        return result.status === 'applied' ? applied({ widgetId: item.id, x: item.x, y: item.y }) : result;
      });
    },
    'dashboard.preferences.set': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['mode']) || !['off', 'overlay', 'space'].includes(payload.mode)) return invalid();
      if (!available()) return unavailable();
      return atomic(async () => {
        if (state.mode === payload.mode) return applied({ mode: state.mode });
        if (state.view) {
          const result = await close(true);
          if (result.status !== 'applied') return result;
        }
        state.mode = payload.mode;
        await ctx.modeChanged();
        await ctx.settle();
        return available() ? applied({ mode: state.mode }) : unavailable();
      });
    },
    'dashboard.preferences.open': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      if (!available()) return unavailable();
      return atomic(() => ctx.openPreferences());
    },
    'dashboard.clock.advance': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['seconds']) || !Number.isInteger(payload.seconds)
        || payload.seconds < 0 || payload.seconds > 86400) return invalid();
      if (!available()) return unavailable();
      const next = state.sceneTime + payload.seconds * 1000;
      if (!Number.isFinite(next) || next > Date.UTC(9999, 11, 31, 23, 59, 59)) return invalid();
      state.sceneTime = next;
      return applied({ sceneTime: next });
    },
  };
  const domain = ['dashboard.clock.configure', 'dashboard.calculator.key', 'dashboard.calendar.navigate',
    'dashboard.calendar.select', 'dashboard.calendar.today', 'dashboard.weather.configure', 'dashboard.weather.refresh',
    'dashboard.converter.change', 'dashboard.converter.swap'];
  for (const command of domain) commands[command] = async (target, payload) => {
    if (!fields(target, ['widgetId']) || !identity(target.widgetId) || !isRecord(payload)) return invalid();
    if (!mounted()) return unavailable();
    const item = widget(target.widgetId);
    if (!item) return missing();
    if (state.view.editing || state.view.library) return disabled();
    return atomic(async () => {
      const result = applyDashboardWidgetCommand(item, command, payload, state.sceneTime);
      if (result.status !== 'applied') return result;
      await ctx.settle();
      if (!mounted() || !retainScroll()) return unavailable();
      if (!view().itemIds().includes(state.view.selectedItemId)) {
        const focus = await select(`widget:${item.id}`);
        if (focus.status !== 'applied') return focus;
      }
      return result;
    });
  };
  for (const name of Object.keys(commands)) {
    const handler = commands[name];
    commands[name] = (target, payload) => supported(profile) ? handler(target, payload)
      : rejected('unsupported_profile', `The active OS profile does not support command: ${name}`);
  }
  return commands;
}

export function dashboardTargets(state) {
  return { mode: state.mode, sceneTime: state.sceneTime, types: [...dashboardWidgetTypes],
    widgets: state.widgets.map(item => ({ widgetId: item.id, type: item.type, x: item.x, y: item.y,
      ...dashboardWidgetTargets(item, state.sceneTime) })) };
}

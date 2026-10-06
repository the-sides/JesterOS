import { isRecord, rejected } from './feature-commands.js';
import { batterySummary, setBatteryStatus, setBatteryEnergy, configureBatteryMenu, setBatteryLowPower, chargeBatteryToFull } from './battery-model.js';

const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  && required.every(key => Object.hasOwn(value, key));
const identity = value => typeof value === 'string' && value.length > 0;
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the closed documented fictional Battery target and payload.');
const unavailable = () => rejected('unavailable', 'The matching native Battery surface is not available.');
const stale = () => rejected('stale_target', 'These Options no longer belong to the original retained desktop and Settings window.');
const controls = ['show-percentage', 'show-energy-mode', 'done'];

/** Persistent Battery actions and a private, native-owned Options lifetime. */
export function createBatteryCommands(ctx) {
  const { presentation } = ctx;
  const scope = crypto.randomUUID();
  let nextOptions = 1, returnFocus, ownerWindow;
  const summary = () => batterySummary(ctx.getState(), ctx.getRunningAppIds(), ctx.profile);
  const clear = () => { presentation.options = null; returnFocus = undefined; ownerWindow = undefined; };
  const ownOptions = (target, withControl = false) => {
    if (!fields(target, withControl ? ['windowId', 'optionsId', 'control'] : ['windowId', 'optionsId'])
      || !identity(target.windowId) || !identity(target.optionsId)) return { error: invalid() };
    const pending = presentation.options;
    if (!pending || pending.optionsId !== target.optionsId || pending.windowId !== target.windowId
      || !ctx.ownerCurrent(ownerWindow)) return { error: stale() };
    const view = ctx.getView();
    return ctx.available() && view?.available('done') ? { pending, view } : { error: unavailable() };
  };
  const preferences = payload => fields(payload, ['showInMenuBar', 'showPercentage', 'showEnergyMode'], [])
    && Reflect.ownKeys(payload).length > 0
    && (!Object.hasOwn(payload, 'showInMenuBar') || typeof payload.showInMenuBar === 'boolean')
    && (!Object.hasOwn(payload, 'showPercentage') || typeof payload.showPercentage === 'boolean')
    && (!Object.hasOwn(payload, 'showEnergyMode') || ['always', 'when-low-power', 'never'].includes(payload.showEnergyMode));
  const normal = () => ctx.canBegin() && !presentation.options;
  const handlers = {
    'battery.status.set': (target, payload) => {
      if (!fields(target, [])) return invalid();
      return ctx.available() ? setBatteryStatus(ctx.getState(), payload, ctx.profile, ctx.canCommit) : unavailable();
    },
    'battery.energy.set': (target, payload) => {
      if (!fields(target, ['appId']) || !identity(target.appId) || !fields(payload, ['impact'])) return invalid();
      return ctx.available() ? setBatteryEnergy(ctx.getState(), target.appId, payload.impact, ctx.profile, ctx.canCommit) : unavailable();
    },
    'battery.lowPower.set': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['mode'])) return invalid();
      return normal() ? setBatteryLowPower(ctx.getState(), payload.mode, ctx.profile, ctx.canCommit) : unavailable();
    },
    'battery.menu.configure': async (target, payload) => {
      if (!fields(target, []) || !preferences(payload)) return invalid();
      if (!normal()) return unavailable();
      const original = ctx.getMenuReturnFocus();
      const result = configureBatteryMenu(ctx.getState(), payload, ctx.profile, ctx.canCommit);
      if (result.status === 'applied' && !result.target.showInMenuBar) await ctx.retireBatteryMenu(original);
      return result;
    },
    'battery.chargeToFull': (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      return normal() ? chargeBatteryToFull(ctx.getState(), ctx.profile) : unavailable();
    },
    'battery.options.open': async (target, payload) => {
      if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, [])) return invalid();
      if (!normal()) return unavailable();
      const owner = ctx.getOwner(target.windowId);
      if (!owner) return unavailable();
      if (!Number.isSafeInteger(nextOptions) || nextOptions >= Number.MAX_SAFE_INTEGER)
        return rejected('limit_exceeded', 'The private Battery Options identity budget is exhausted.');
      const original = ctx.capture();
      returnFocus = original; ownerWindow = owner;
      presentation.options = { windowId: target.windowId, optionsId: `${scope}:${nextOptions++}` };
      const pending = presentation.options;
      await ctx.settle();
      const view = ctx.getView();
      if (presentation.options !== pending || !ctx.available() || !ctx.ownerCurrent(owner)
        || !view || !await view.focus('show-percentage') || presentation.options !== pending
        || !view.available('show-percentage') || !view.available('done')) {
        if (presentation.options === pending) { clear(); await ctx.settle(); await ctx.restore(original); }
        return unavailable();
      }
      return applied({ windowId: pending.windowId, optionsId: pending.optionsId });
    },
    'battery.options.configure': async (target, payload) => {
      if (!preferences(payload) || Object.hasOwn(payload, 'showInMenuBar')) return invalid();
      const owned = ownOptions(target); if (owned.error) return owned.error;
      const { pending, view } = owned;
      const delta = Object.hasOwn(payload, 'showEnergyMode') ? payload.showEnergyMode.length - ctx.getState().showEnergyMode.length : 0;
      if (!ctx.canCommit(delta)) return rejected('limit_exceeded', 'These Battery preferences exceed the complete-scene text budget.');
      const original = ctx.capture(), previousTop = view.scrollTop();
      const changedControls = [
        ...(Object.hasOwn(payload, 'showPercentage') ? ['show-percentage'] : []),
        ...(Object.hasOwn(payload, 'showEnergyMode') ? ['show-energy-mode'] : []),
      ];
      for (const control of changedControls) {
        if (!await view.focus(control) || presentation.options !== pending || !ctx.available()
          || !ctx.ownerCurrent(ownerWindow) || !view.available(control)) {
          if (presentation.options === pending) { await view.reconcile(); await ctx.restore(original); await view.scrollTo(previousTop); }
          return unavailable();
        }
      }
      const result = configureBatteryMenu(ctx.getState(), payload, ctx.profile, ctx.canCommit);
      await view.reconcile();
      if (result.status !== 'applied') { await ctx.restore(original); await view.scrollTo(previousTop); return result; }
      return applied({ windowId: target.windowId, optionsId: target.optionsId,
        showPercentage: result.target.showPercentage, showEnergyMode: result.target.showEnergyMode });
    },
    'battery.options.close': async (target, payload) => {
      if (!fields(payload, [])) return invalid();
      const owned = ownOptions(target); if (owned.error) return owned.error;
      const original = returnFocus;
      clear(); await ctx.settle(); await ctx.restore(original);
      return applied({ windowId: target.windowId, optionsId: target.optionsId });
    },
    'battery.options.focus': async (target, payload) => {
      if (!fields(payload, ['observe'], []) || Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean') return invalid();
      const owned = ownOptions(target, true); if (owned.error) return owned.error;
      if (!controls.includes(target.control)) return invalid();
      const { pending, view } = owned;
      if (payload.observe ? !view.available(target.control) || view.focusedControl() !== target.control : !await view.focus(target.control)) return unavailable();
      if (presentation.options !== pending || !ctx.available() || !ctx.ownerCurrent(ownerWindow)
        || !view.available(target.control) || view.focusedControl() !== target.control) return unavailable();
      return applied({ windowId: target.windowId, optionsId: target.optionsId, control: target.control });
    },
    'battery.options.scroll': async (target, payload) => {
      if (!fields(payload, ['top', 'observe'], ['top']) || !Number.isFinite(payload.top) || payload.top < 0
        || Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean') return invalid();
      const owned = ownOptions(target); if (owned.error) return owned.error;
      const { pending, view } = owned;
      const top = payload.observe ? view.scrollTop() : await view.scrollTo(payload.top);
      if (!Number.isFinite(top) || top < 0 || presentation.options !== pending || !ctx.available()
        || !ctx.ownerCurrent(ownerWindow) || !view.available('done')) return unavailable();
      return applied({ windowId: target.windowId, optionsId: target.optionsId, top });
    },
  };
  return {
    handlers: Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (target, payload) =>
      ctx.profile.id === 'macos-golden-gate-27.0.1' && ctx.profile.capabilities.includes('status.battery')
        ? handler(target, payload) : rejected('unsupported_profile', 'Only Golden Gate represents fictional Battery controls.')])),
    clear, summary,
    targets() {
      const pending = presentation.options, view = ctx.getView();
      return { ...summary(), authoredEnergyApps: ctx.getState().energyApps.map(entry => ({ ...entry })),
        options: pending ? { ...pending, controlIds: view?.controlIds() ?? [],
          focusedControl: view?.focusedControl() ?? null, scrollTop: view?.scrollTop() ?? null } : null,
        boundaries: { hostBattery: false, hostPower: false, automaticDrain: false,
          scope: 'retained-desktop', energyUnits: 'authored-fictional-impact', privateOptionsSaved: false } };
    },
    menuProvider(enabled) {
      const current = summary();
      return { menuId: 'battery', kind: 'battery', label: 'Battery', ...current,
        enabled: enabled && current.showInMenuBar, items: [
          { id: 'battery-status', type: 'battery-status', heading: true, label: 'Battery', ...current, enabled: false },
          ...(current.showLowPowerControl ? [{ id: 'low-power-mode', type: 'battery-mode', label: 'Low Power Mode',
            checked: current.lowPowerActive, enabled, keepOpen: true,
            request: { command: 'battery.lowPower.set', payload: { mode: current.lowPowerActive ? 'never' : 'always' } } }] : []),
          ...(current.chargeToFullAvailable ? [{ id: 'charge-to-full', label: 'Charge to Full Now', enabled,
            request: { command: 'battery.chargeToFull' } }] : []),
          { id: 'energy-heading', heading: true, label: current.energyApps.length ? 'Using Significant Energy' : 'No Apps Using Significant Energy', enabled: false },
          ...current.energyApps.map(entry => ({ id: `energy:${entry.appId}`, type: 'battery-energy', heading: true,
            label: entry.name, name: entry.name, icon: entry.icon, impact: entry.impact, enabled: false })),
          { id: 'battery-footer-separator', separator: true, enabled: false },
          { id: 'battery-settings', label: 'Battery Settings…', enabled,
            request: { command: 'system.settings.open', payload: { pane: 'battery' } } },
        ] };
    },
  };
}

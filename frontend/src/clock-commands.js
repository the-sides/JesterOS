import { isRecord, rejected } from './feature-commands.js';
import { clockSummary, configureClockMenu, setClockZone, setClockFormat, resolveClockLocalDateTime } from './clock-model.js';

const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => {
    if (typeof key !== 'string' || !allowed.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  }) && required.every(key => Object.hasOwn(value, key));
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the closed documented Clock target and literal payload.');
const unavailable = () => rejected('unavailable', 'The matching original native Clock surface is not available.');
const stale = () => rejected('stale_target', 'This private Clock sheet no longer belongs to the original retained desktop and Settings window.');
const menuKeys = ['style', 'showDate', 'showDayOfWeek', 'showAMPM', 'showSeconds'];
const optionsControls = ['show-date', 'show-day-of-week', 'style-digital', 'style-analog', 'show-ampm', 'show-seconds', 'done'];
const timeControls = ['local-datetime', 'cancel', 'set'];
const normalizeLocal = value => value.replace(/:00$/, '');
const preferences = payload => fields(payload, menuKeys, []) && Reflect.ownKeys(payload).length > 0
  && (!Object.hasOwn(payload, 'style') || ['digital', 'analog'].includes(payload.style))
  && (!Object.hasOwn(payload, 'showDate') || ['when-space-allows', 'always', 'never'].includes(payload.showDate))
  && ['showDayOfWeek', 'showAMPM', 'showSeconds'].every(key => !Object.hasOwn(payload, key) || typeof payload[key] === 'boolean');

/** One canonical instant with two mutually exclusive, unsaved native sheet leases. */
export function createClockCommands(ctx) {
  const { presentation } = ctx;
  const scope = crypto.randomUUID();
  let nextLease = 1, returnFocus, ownerWindow;
  const summary = () => clockSummary(ctx.getState(), ctx.getSceneTime());
  const clear = () => { presentation.options = null; presentation.editor = null; returnFocus = undefined; ownerWindow = undefined; };
  const normal = () => ctx.canBegin() && !presentation.options && !presentation.editor;
  const idKey = kind => kind === 'options' ? 'optionsId' : 'editId';
  const actionControl = kind => kind === 'options' ? 'done' : 'set';
  const ownerTarget = (kind, pending) => ({ windowId: pending.windowId, [idKey(kind)]: pending[idKey(kind)] });
  const own = (kind, target, withControl = false) => {
    const key = idKey(kind);
    if (!fields(target, ['windowId', key, ...(withControl ? ['control'] : [])])
      || !identity(target.windowId) || !identity(target[key])) return { error: invalid() };
    const pending = presentation[kind];
    if (!pending || pending.windowId !== target.windowId || pending[key] !== target[key]
      || !ctx.ownerCurrent(ownerWindow, kind)) return { error: stale() };
    const view = ctx.getView(kind);
    return ctx.available() && view?.available(actionControl(kind)) ? { pending, view } : { error: unavailable() };
  };
  async function open(kind, target, payload) {
    if (!fields(target, ['windowId']) || !identity(target.windowId) || !fields(payload, [])) return invalid();
    if (!normal()) return unavailable();
    const owner = ctx.getOwner(target.windowId, kind);
    if (!owner) return unavailable();
    const current = kind === 'editor' ? summary() : null;
    if (kind === 'editor' && current.localDateTime === null)
      return rejected('limit_exceeded', 'The native manual date editor supports years1970–9999; the authored clock remains valid.');
    if (!Number.isSafeInteger(nextLease) || nextLease >= Number.MAX_SAFE_INTEGER)
      return rejected('limit_exceeded', 'The private Clock identity budget is exhausted.');
    const original = ctx.capture();
    returnFocus = original; ownerWindow = owner;
    presentation[kind] = { windowId: target.windowId, [idKey(kind)]: `${scope}:${kind}:${nextLease++}`,
      ...(kind === 'editor' ? { localDateTime: normalizeLocal(current.localDateTime), error: null } : {}) };
    const pending = presentation[kind], first = kind === 'options' ? 'show-date' : 'local-datetime';
    await ctx.settle();
    const view = ctx.getView(kind);
    if (presentation[kind] !== pending || !ctx.available() || !ctx.ownerCurrent(owner, kind)
      || !view?.focus(first) || !view.available(first) || !view.available(actionControl(kind))) {
      if (presentation[kind] === pending) { clear(); await ctx.settle(); await ctx.restore(original); }
      return unavailable();
    }
    return applied(ownerTarget(kind, pending));
  }
  async function dismiss(kind, target, payload) {
    if (!fields(payload, [])) return invalid();
    const owned = own(kind, target); if (owned.error) return owned.error;
    const result = ownerTarget(kind, owned.pending), original = returnFocus;
    clear(); await ctx.settle(); await ctx.restore(original);
    return applied(result);
  }
  async function focus(kind, target, payload) {
    if (!fields(payload, ['observe'], []) || Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean') return invalid();
    const owned = own(kind, target, true); if (owned.error) return owned.error;
    if (!(kind === 'options' ? optionsControls : timeControls).includes(target.control)) return invalid();
    const { pending, view } = owned;
    if (payload.observe ? !view.available(target.control) || view.focusedControl() !== target.control : !view.focus(target.control)) return unavailable();
    if (presentation[kind] !== pending || !ctx.available() || !ctx.ownerCurrent(ownerWindow, kind)
      || !view.available(target.control) || view.focusedControl() !== target.control) return unavailable();
    return applied({ ...ownerTarget(kind, pending), control: target.control });
  }
  async function scroll(kind, target, payload) {
    if (!fields(payload, ['top', 'observe'], ['top']) || !Number.isFinite(payload.top) || payload.top < 0
      || Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean') return invalid();
    const owned = own(kind, target); if (owned.error) return owned.error;
    const { pending, view } = owned;
    const top = payload.observe ? view.scrollTop() : await view.scroll(payload.top);
    if (!Number.isFinite(top) || top < 0 || presentation[kind] !== pending || !ctx.available()
      || !ctx.ownerCurrent(ownerWindow, kind) || !view.available(actionControl(kind))) return unavailable();
    return applied({ ...ownerTarget(kind, pending), top });
  }
  const handlers = {
    'clock.menu.configure': (target, payload) => {
      if (!fields(target, []) || !preferences(payload)) return invalid();
      return normal() ? configureClockMenu(ctx.getState(), payload, ctx.canCommit) : unavailable();
    },
    'clock.zone.set': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['timeZone'])) return invalid();
      return normal() ? setClockZone(ctx.getState(), payload.timeZone, ctx.canCommit) : unavailable();
    },
    'clock.format.set': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['use24Hour'])) return invalid();
      return normal() ? setClockFormat(ctx.getState(), payload.use24Hour, ctx.canCommit) : unavailable();
    },
    'clock.time.set': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['sceneTime']) || !Number.isSafeInteger(payload.sceneTime)
        || payload.sceneTime < 0 || payload.sceneTime > 8_640_000_000_000_000 - 1) return invalid();
      return ctx.available() && !presentation.editor ? ctx.setTime(payload.sceneTime) : unavailable();
    },
    'clock.options.open': (target, payload) => open('options', target, payload),
    'clock.options.configure': async (target, payload) => {
      if (!preferences(payload)) return invalid();
      const owned = own('options', target); if (owned.error) return owned.error;
      const { pending, view } = owned, state = ctx.getState();
      const nextStyle = payload.style ?? state.style;
      if (nextStyle === 'analog' && (Object.hasOwn(payload, 'showAMPM') || Object.hasOwn(payload, 'showSeconds')))
        return rejected('disabled', 'AM/PM and seconds are unavailable in Analog Clock Options.');
      const delta = (Object.hasOwn(payload, 'style') ? payload.style.length - state.style.length : 0)
        + (Object.hasOwn(payload, 'showDate') ? payload.showDate.length - state.showDate.length : 0);
      if (!ctx.canCommit(delta)) return rejected('limit_exceeded', 'These Clock preferences exceed the complete-scene text budget.');
      const original = ctx.capture(), previousTop = view.scrollTop();
      const changedControls = [
        ...(Object.hasOwn(payload, 'style') ? [`style-${payload.style}`] : []),
        ...(Object.hasOwn(payload, 'showDate') ? ['show-date'] : []),
        ...(Object.hasOwn(payload, 'showDayOfWeek') ? ['show-day-of-week'] : []),
        ...(state.style === 'digital' && Object.hasOwn(payload, 'showAMPM') ? ['show-ampm'] : []),
        ...(state.style === 'digital' && Object.hasOwn(payload, 'showSeconds') ? ['show-seconds'] : []),
      ];
      // A style+digital-fields transaction prepares the enabled style radio;
      // its previously disabled fields become real controls only after commit.
      for (const control of changedControls) {
        if (!view.focus(control) || presentation.options !== pending || !ctx.available()
          || !ctx.ownerCurrent(ownerWindow, 'options') || !view.available(control)) {
          if (presentation.options === pending) { await view.reconcile(); await ctx.restore(original); await view.scroll(previousTop); }
          return unavailable();
        }
      }
      const result = configureClockMenu(state, payload, ctx.canCommit);
      await view.reconcile();
      if (result.status !== 'applied') { await ctx.restore(original); await view.scroll(previousTop); return result; }
      return applied({ ...ownerTarget('options', pending), ...result.target });
    },
    'clock.options.close': (target, payload) => dismiss('options', target, payload),
    'clock.options.focus': (target, payload) => focus('options', target, payload),
    'clock.options.scroll': (target, payload) => scroll('options', target, payload),
    'clock.time.open': (target, payload) => open('editor', target, payload),
    'clock.time.configure': async (target, payload) => {
      if (!fields(payload, ['localDateTime']) || typeof payload.localDateTime !== 'string'
        || payload.localDateTime.length > 19 || !/^(?:|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2})?)$/.test(payload.localDateTime)
        || payload.localDateTime && !resolveClockLocalDateTime(payload.localDateTime, 'UTC').ok) return invalid();
      const owned = own('editor', target); if (owned.error) return owned.error;
      const { pending, view } = owned;
      if (!view.focus('local-datetime') || presentation.editor !== pending || !ctx.available()
        || !ctx.ownerCurrent(ownerWindow, 'editor') || !view.available('local-datetime')) return unavailable();
      pending.localDateTime = normalizeLocal(payload.localDateTime); pending.error = null;
      await view.reconcile();
      return applied({ ...ownerTarget('editor', pending), localDateTime: pending.localDateTime });
    },
    'clock.time.submit': async (target, payload) => {
      if (!fields(payload, [])) return invalid();
      const owned = own('editor', target); if (owned.error) return owned.error;
      const { pending } = owned;
      const resolved = resolveClockLocalDateTime(pending.localDateTime, ctx.getState().timeZone);
      if (!resolved.ok) { pending.error = resolved.message; return rejected('invalid_arguments', resolved.message); }
      const currentTime = ctx.getSceneTime();
      // The native field has second precision. Holding its displayed second
      // must not rewind an existing millisecond-resolution file timestamp.
      const requestedTime = resolved.sceneTime === Math.floor(currentTime / 1000) * 1000 ? currentTime : resolved.sceneTime;
      const result = ctx.setTime(requestedTime);
      if (result.status !== 'applied') { pending.error = result.error.message; return result; }
      const committed = { ...ownerTarget('editor', pending), ...result.target }, original = returnFocus;
      clear(); await ctx.settle(); await ctx.restore(original);
      return applied(committed);
    },
    'clock.time.cancel': (target, payload) => dismiss('editor', target, payload),
    'clock.time.focus': (target, payload) => focus('editor', target, payload),
    'clock.time.scroll': (target, payload) => scroll('editor', target, payload),
  };
  return {
    handlers: Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (target, payload) =>
      ctx.profile.id === 'macos-golden-gate-27.0.1' && ctx.profile.capabilities.includes('status.clock')
        ? handler(target, payload) : rejected('unsupported_profile', 'Only Golden Gate represents this authored shared Clock.')])),
    clear, summary,
    targets() {
      const projected = {};
      for (const kind of ['options', 'editor']) {
        const pending = presentation[kind], view = ctx.getView(kind);
        projected[kind] = pending ? { ...pending, controlIds: view?.controlIds() ?? [],
          focusedControl: view?.focusedControl() ?? null, scrollTop: view?.scrollTop() ?? null } : null;
      }
      return { ...ctx.getState(), ...summary(), dateShown: ctx.dateShown(), ...projected,
        boundaries: { hostTime: false, automaticProgression: false, networkTime: false, geolocation: false,
          scope: 'retained-desktop', instantSource: 'files.sceneTime', forwardOnly: true, privateSheetsSaved: false,
          menu: 'fictional-clock-settings-shortcut', calendarFlyout: false } };
    },
    menuProvider(enabled) {
      const current = summary();
      return { ...ctx.getState(), ...current, menuId: 'clock', kind: 'clock', label: 'Clock', enabled, items: [
        { id: 'clock-date', heading: true, label: current.fullDate, enabled: false },
        { id: 'clock-time', heading: true, label: `${current.fullTime} · ${current.timeZone}`, enabled: false },
        { id: 'clock-separator', separator: true, enabled: false },
        { id: 'clock-date-time-settings', label: 'Date & Time Settings…', enabled,
          request: { command: 'system.settings.open', payload: { pane: 'date-time' } } },
        { id: 'clock-menu-bar-settings', label: 'Menu Bar Settings…', enabled,
          request: { command: 'system.settings.open', payload: { pane: 'menu-bar' } } },
      ] };
    },
  };
}

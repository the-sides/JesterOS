import { isRecord, rejected } from './feature-commands.js';
import { bluetoothSummary, validateBluetoothState,
  planBluetoothPower, planBluetoothConnect, planBluetoothDisconnect,
  planBluetoothConfigure, planBluetoothMenu, planBluetoothPair } from './bluetooth-model.js';

const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  && required.every(key => Object.hasOwn(value, key));
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const pinDraft = value => typeof value === 'string' && value.length <= 6;
const percent = value => Number.isInteger(value) && value >= 0 && value <= 100;
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented closed fictional Bluetooth target and payload.');
const unavailable = () => rejected('unavailable', 'The matching foreground fictional Bluetooth surface is not available.');
const stale = () => rejected('stale_target', 'This pair sheet no longer belongs to the current retained desktop.');
const staleTransition = () => rejected('stale_target', 'The original retained Bluetooth or Sound state changed before this transition could commit.');
const descriptorSame = (a, b) => a && b && a.enumerable === b.enumerable && a.configurable === b.configurable
  && a.writable === b.writable && a.value === b.value && a.get === b.get && a.set === b.set;
const snapshot = entry => ({ object: entry, prototype: Object.getPrototypeOf(entry), descriptors: Object.getOwnPropertyDescriptors(entry) });
const unchanged = entry => Object.getPrototypeOf(entry.object) === entry.prototype
  && Reflect.ownKeys(entry.object).length === Reflect.ownKeys(entry.descriptors).length
  && Reflect.ownKeys(entry.descriptors).every(key => descriptorSame(Object.getOwnPropertyDescriptor(entry.object, key), entry.descriptors[key]));
const configurePayload = payload => fields(payload, ['available', 'batteryPercent'], [])
  && Reflect.ownKeys(payload).length > 0
  && (!Object.hasOwn(payload, 'available') || typeof payload.available === 'boolean')
  && (!Object.hasOwn(payload, 'batteryPercent') || payload.batteryPercent === null || percent(payload.batteryPercent));
const pairControls = mode => mode === 'pin' ? ['pin', 'cancel', 'pair'] : ['cancel', 'pair'];

/** Canonical Bluetooth transitions plus a Root-owned private pair-sheet lease. */
export function createBluetoothCommands(ctx) {
  const { presentation } = ctx;
  const scope = crypto.randomUUID();
  let nextPair = 1, returnFocus, session;
  const summary = () => bluetoothSummary(ctx.getState(), ctx.getSound());
  const clear = () => { presentation.pair = null; returnFocus = undefined; session = undefined; };
  const ordinary = () => {
    try {
      return !presentation.pair && ctx.canBegin() === true && ctx.available() === true;
    } catch { return false; }
  };
  const nodesFor = (state, bt, sound, snd) => {
    const nodes = [
      { object: state, plan: bt, keys: ['powered', 'showInMenuBar'] },
      { object: sound, plan: snd, keys: ['outputDeviceId', 'inputDeviceId', 'showInMenuBar', 'showWhen'] },
      { object: sound.appVolumes, plan: snd.appVolumes, keys: ['music', 'quicktime'] },
    ];
    state.devices.forEach((device, index) => nodes.push({ object: device, plan: bt.devices[index], keys: Object.keys(device) }));
    sound.outputs.forEach((route, index) => nodes.push({ object: route, plan: snd.outputs[index], keys: Object.keys(route) }));
    sound.inputs.forEach((route, index) => nodes.push({ object: route, plan: snd.inputs[index], keys: Object.keys(route) }));
    return nodes;
  };
  const current = snapshots => snapshots.every(unchanged);
  // One atomic commit across canonical Bluetooth and referenced Sound; guarded
  // readonly/stale/budget before any domain write and rechecked around each await.
  // `owned` replaces the ordinary-interaction guard for the open pair sheet's own commit.
  function commit(planner, target, { owned = null } = {}) {
    const state = ctx.getState(), sound = ctx.getSound();
    if (!validateBluetoothState(state, sound).ok) return invalid();
    const planned = planner(state, sound);
    if (planned.error) return planned.error;
    const bt = planned.bt ?? state, snd = planned.sound ?? sound;
    const nodes = nodesFor(state, bt, sound, snd);
    const snapshots = [...nodes.map(node => snapshot(node.object)),
      snapshot(state.devices), snapshot(sound.outputs), snapshot(sound.inputs)];
    const changes = nodes.flatMap(node => node.keys.filter(key => node.object[key] !== node.plan[key])
      .map(key => ({ object: node.object, key, previous: node.object[key], value: node.plan[key] })));
    if (changes.some(change => Object.getOwnPropertyDescriptor(change.object, change.key).writable !== true)) return invalid();
    if (typeof ctx.canCommit !== 'function') return invalid();
    // The full root text delta includes newly selected fallback route IDs.
    const textDelta = changes.reduce((total, change) => total
      + (typeof change.value === 'string' ? change.value.length - change.previous.length : 0), 0);
    let accepted = false;
    try { accepted = ctx.canCommit(textDelta) === true; } catch { /* A failed budget decision never authorizes writes. */ }
    if (ctx.getState() !== state || ctx.getSound() !== sound || !current(snapshots)) return staleTransition();
    if (!accepted) return rejected('limit_exceeded', 'The Bluetooth change exceeds the complete-scene text budget.');
    let allowed = false;
    try { allowed = owned === null ? ordinary() : owned() === true; } catch { allowed = false; }
    if (!allowed) return unavailable();
    if (ctx.getState() !== state || ctx.getSound() !== sound || !current(snapshots)) return staleTransition();
    for (const change of changes) change.object[change.key] = change.value;
    const result = applied(typeof target === 'function' ? target(planned) : target);
    try { ctx.notifySound(); } catch { /* A disappeared view cannot reject an already committed canonical transition. */ }
    return result;
  }
  function sessionCurrent(pending) {
    try {
      return ctx.available() === true && Boolean(session) && session.pending === pending
        && ctx.getState() === session.state && ctx.getSound() === session.sound
        && unchanged(session.deviceSnapshot)
        && session.state.powered === true && session.device.available === true && session.device.paired === false
        && session.device.pairing === pending.mode
        && (pending.mode === 'none' || session.device.passkey === pending.code);
    } catch { return false; }
  }
  const ownPair = target => {
    if (!fields(target, ['pairId']) || !identity(target.pairId)) return { error: invalid() };
    const pending = presentation.pair;
    if (!pending || pending.pairId !== target.pairId) return { error: stale() };
    const view = ctx.getView();
    return ctx.available() === true && view && view === session?.view && sessionCurrent(pending)
      ? { pending, view } : { error: unavailable() };
  };
  async function begin(target, payload) {
    if (!fields(target, ['deviceId']) || !identity(target.deviceId) || !fields(payload, [])) return invalid();
    if (!ctx.canBegin() || presentation.pair) return unavailable();
    const state = ctx.getState(), sound = ctx.getSound();
    if (!validateBluetoothState(state, sound).ok) return invalid();
    if (!state.powered) return rejected('disabled', 'Bluetooth must be powered to pair a fictional device.');
    const device = state.devices.find(entry => entry.id === target.deviceId);
    if (!device) return stale();
    if (!device.available) return rejected('disabled', 'Only an available fictional device can pair.');
    if (device.paired) return rejected('stale_target', 'This fictional device is already paired.');
    if (!Number.isSafeInteger(nextPair) || nextPair >= Number.MAX_SAFE_INTEGER)
      return rejected('limit_exceeded', 'The private Bluetooth pair identity budget is exhausted.');
    const original = ctx.capture();
    returnFocus = original;
    const mode = device.pairing;
    presentation.pair = { pairId: `${scope}:${nextPair++}`, deviceId: device.id, name: device.name,
      kind: device.kind, mode, code: mode === 'none' ? null : device.passkey, error: null };
    const pending = presentation.pair;
    session = { state, sound, device, deviceSnapshot: snapshot(device), pending };
    await ctx.settle();
    const view = ctx.getView();
    const control = mode === 'pin' ? 'pin' : 'cancel';
    if (!ctx.available() || presentation.pair !== pending || !view
      || !await view.focus(control) || presentation.pair !== pending || ctx.getView() !== view
      || !sessionCurrent(pending) || !view.available(control)) {
      if (presentation.pair === pending) { clear(); await ctx.settle(); await ctx.restore(original); }
      return unavailable();
    }
    session.view = view;
    return applied({ pairId: pending.pairId, deviceId: pending.deviceId });
  }
  const handlers = {
    'bluetooth.power.set': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['powered']) || typeof payload.powered !== 'boolean') return invalid();
      if (!ordinary()) return unavailable();
      const powered = payload.powered;
      return commit((state, sound) => planBluetoothPower(state, sound, powered), plan => ({ powered: plan.bt.powered }));
    },
    'bluetooth.device.connect': (target, payload) => {
      if (!fields(target, ['deviceId']) || !identity(target.deviceId) || !fields(payload, [])) return invalid();
      if (!ordinary()) return unavailable();
      const deviceId = target.deviceId;
      return commit((state, sound) => planBluetoothConnect(state, sound, deviceId),
        plan => ({ deviceId, connected: plan.bt.devices.find(entry => entry.id === deviceId).connected }));
    },
    'bluetooth.device.disconnect': (target, payload) => {
      if (!fields(target, ['deviceId']) || !identity(target.deviceId) || !fields(payload, [])) return invalid();
      if (!ordinary()) return unavailable();
      const deviceId = target.deviceId;
      return commit((state, sound) => planBluetoothDisconnect(state, sound, deviceId),
        plan => ({ deviceId, connected: plan.bt.devices.find(entry => entry.id === deviceId).connected }));
    },
    'bluetooth.device.configure': (target, payload) => {
      if (!fields(target, ['deviceId']) || !identity(target.deviceId) || !configurePayload(payload)) return invalid();
      if (!ordinary()) return unavailable();
      const deviceId = target.deviceId, changes = { ...payload };
      return commit((state, sound) => planBluetoothConfigure(state, sound, deviceId, changes), plan => {
        const device = plan.bt.devices.find(entry => entry.id === deviceId);
        return { deviceId, available: device.available, batteryPercent: device.batteryPercent };
      });
    },
    'bluetooth.menu.configure': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['showInMenuBar']) || typeof payload.showInMenuBar !== 'boolean') return invalid();
      if (!ordinary()) return unavailable();
      const original = ctx.capture();
      const wasShown = ctx.getState().showInMenuBar;
      const showInMenuBar = payload.showInMenuBar;
      const result = commit((state, sound) => planBluetoothMenu(state, sound, showInMenuBar),
        plan => ({ showInMenuBar: plan.bt.showInMenuBar }));
      if (result.status === 'applied' && wasShown && !showInMenuBar) {
        try { await ctx.retireMenu(original); } catch { /* Menu/root disappearance after the canonical commit is not a rejected preference change. */ }
      }
      return result;
    },
    'bluetooth.pair.begin': (target, payload) => begin(target, payload),
    'bluetooth.pair.draft': async (target, payload) => {
      if (!fields(target, ['pairId']) || !identity(target.pairId)
        || !fields(payload, ['pin']) || !pinDraft(payload.pin)) return invalid();
      const owned = ownPair(target); if (owned.error) return owned.error;
      const { pending, view } = owned;
      if (pending.mode !== 'pin') return invalid();
      if (!await view.setDraft({ pin: payload.pin })) return unavailable();
      if (!sessionCurrent(pending) || ctx.getView() !== view) return unavailable();
      return applied({ pairId: pending.pairId });
    },
    'bluetooth.pair.submit': async (target, payload) => {
      if (!fields(target, ['pairId']) || !identity(target.pairId)
        || !fields(payload, ['pin'], []) || Object.hasOwn(payload, 'pin') && !pinDraft(payload.pin)) return invalid();
      const owned = ownPair(target); if (owned.error) return owned.error;
      const { pending, view } = owned;
      if (pending.mode === 'pin' ? !Object.hasOwn(payload, 'pin') : Object.hasOwn(payload, 'pin')) return invalid();
      // Typed submit reconciles the actual field compare-before-write via the facade.
      if (pending.mode === 'pin') {
        const draft = await view.draft();
        if (!isRecord(draft) || draft.pin !== payload.pin) {
          if (!await view.setDraft({ pin: payload.pin })) return unavailable();
          if (!sessionCurrent(pending) || ctx.getView() !== view) return unavailable();
        }
      }
      if (!sessionCurrent(pending) || ctx.getView() !== view) return unavailable();
      if (pending.mode === 'pin' && payload.pin !== pending.code) {
        pending.error = 'The fictional passkey is incorrect. Pairing codes are authored scene cues, never real credentials.';
        await ctx.settle();
        await view.focus('pin');
        return applied({ pairId: pending.pairId, deviceId: pending.deviceId, connected: false });
      }
      const original = returnFocus, deviceId = pending.deviceId;
      const result = commit((state, sound) => planBluetoothPair(state, sound, deviceId),
        () => ({ pairId: pending.pairId, deviceId, connected: true }),
        { owned: () => sessionCurrent(pending) && ctx.getView() === session.view });
      if (result.status === 'applied') {
        clear();
        await ctx.settle();
        await ctx.restore(original);
        return result;
      }
      if (result.status === 'rejected' && result.error.code === 'limit_exceeded') {
        pending.error = result.error.message;
        await ctx.settle();
        return applied({ pairId: pending.pairId, deviceId, connected: false });
      }
      return result;
    },
    'bluetooth.pair.cancel': async (target, payload) => {
      if (!fields(payload, [])) return invalid();
      const owned = ownPair(target); if (owned.error) return owned.error;
      const original = returnFocus, { pending } = owned;
      clear();
      await ctx.settle();
      await ctx.restore(original);
      return applied({ pairId: pending.pairId, cancelled: true });
    },
    'bluetooth.pair.focus': async (target, payload) => {
      if (!fields(target, ['pairId', 'control']) || !identity(target.pairId)
        || !fields(payload, ['observe'], []) || Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean') return invalid();
      const owned = ownPair({ pairId: target.pairId }); if (owned.error) return owned.error;
      const { pending, view } = owned;
      if (!pairControls(pending.mode).includes(target.control) || !view.controlIds().includes(target.control)) return unavailable();
      if (payload.observe === true ? view.focusedControl() !== target.control || !view.available(target.control)
        : !await view.focus(target.control)) return unavailable();
      if (!sessionCurrent(pending) || ctx.getView() !== view || !view.available(target.control)) return unavailable();
      return applied({ pairId: target.pairId, control: target.control });
    },
    'bluetooth.pair.select': async (target, payload) => {
      if (!fields(target, ['pairId']) || !identity(target.pairId)
        || !fields(payload, ['start', 'end', 'direction'], ['start', 'end'])
        || !Number.isSafeInteger(payload.start) || !Number.isSafeInteger(payload.end)
        || payload.start < 0 || payload.end < payload.start
        || Object.hasOwn(payload, 'direction') && !['none', 'forward', 'backward'].includes(payload.direction)) return invalid();
      const owned = ownPair({ pairId: target.pairId }); if (owned.error) return owned.error;
      const { pending, view } = owned;
      if (pending.mode !== 'pin' || !view.controlIds().includes('pin')) return unavailable();
      const node = view.element().querySelector('[data-bluetooth-control="pin"]');
      const draft = await view.draft();
      if (!node || !isRecord(draft) || payload.end > draft.pin.length) return invalid();
      if (!await view.focus('pin') || !view.available('pin')) return unavailable();
      if (!sessionCurrent(pending) || ctx.getView() !== view) return unavailable();
      node.setSelectionRange(payload.start, payload.end, payload.direction ?? 'none');
      return applied({ pairId: target.pairId, start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection });
    },
    'bluetooth.pair.scroll': async (target, payload) => {
      if (!fields(target, ['pairId']) || !identity(target.pairId)
        || !fields(payload, ['top', 'observe'], ['top']) || !Number.isFinite(payload.top) || payload.top < 0
        || Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean') return invalid();
      const owned = ownPair(target); if (owned.error) return owned.error;
      const { pending, view } = owned;
      const top = payload.observe === true ? view.scrollTop() : await view.scrollTo(payload.top);
      if (!Number.isFinite(top) || top < 0 || !sessionCurrent(pending) || ctx.getView() !== view) return unavailable();
      return applied({ pairId: target.pairId, top });
    },
  };
  return {
    handlers: Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (target, payload) => {
      if (ctx.profile.id !== 'macos-golden-gate-27.0.1' || !ctx.profile.capabilities.includes('status.bluetooth'))
        return rejected('unsupported_profile', 'Only Golden Gate represents fictional Bluetooth devices.');
      return handler(target, payload);
    }])),
    clear, summary,
    targets() {
      const pending = presentation.pair, view = ctx.getView();
      return { ...summary(),
        pair: pending ? { ...pending, controlIds: view?.controlIds() ?? [],
          focusedControl: view?.focusedControl() ?? null, scrollTop: view?.scrollTop() ?? null } : null,
        boundaries: { hostBluetooth: false, hostScan: false, realCredentials: false, automaticReconnect: false,
          scope: 'retained-desktop', pairDraftsSaved: false } };
    },
    menuProvider(enabled) {
      const current = summary();
      const row = device => ({ id: `device:${device.id}`, type: 'bluetooth-device', name: device.name,
        label: device.name, kind: device.kind, batteryPercent: device.batteryPercent,
        connected: device.connected, checked: device.connected, enabled: enabled && device.available,
        keepOpen: true, request: { command: device.connected ? 'bluetooth.device.disconnect' : 'bluetooth.device.connect',
          target: { deviceId: device.id }, payload: {} } });
      return { menuId: 'bluetooth', kind: 'bluetooth', label: 'Bluetooth', enabled,
        status: !current.powered ? 'off' : current.connectedCount > 0 ? 'connected' : 'on',
        powered: current.powered, showInMenuBar: current.showInMenuBar,
        connectedCount: current.connectedCount, items: [
          { id: 'bluetooth-power', type: 'bluetooth-power', label: 'Bluetooth', checked: current.powered,
            enabled, keepOpen: true, request: { command: 'bluetooth.power.set', payload: { powered: !current.powered } } },
          ...(current.powered ? [
            { id: 'bluetooth-devices', heading: true, label: 'My Devices', enabled: false },
            ...current.devices.filter(device => device.paired).map(row),
          ] : []),
          { id: 'bluetooth-footer-separator', separator: true, enabled: false },
          { id: 'bluetooth-settings', label: 'Bluetooth Settings…', enabled,
            request: { command: 'system.settings.open', payload: { pane: 'bluetooth' } } },
        ] };
    },
  };
}

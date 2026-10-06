import { isRecord, rejected } from './feature-commands.js';
import { setWifiPower, connectWifiNetwork, disconnectWifiNetwork } from './wifi-model.js';

const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  && required.every(key => Object.hasOwn(value, key));
const identity = value => typeof value === 'string' && value.length > 0;
const password = value => typeof value === 'string' && value.length <= 63;
const name = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\r\n\0]/.test(value);
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the documented closed fictional Wi-Fi target and payload.');
const unavailable = () => rejected('unavailable', 'The matching foreground fictional Wi-Fi surface is not available.');
const missing = () => rejected('stale_target', 'This Join sheet no longer belongs to the current retained desktop.');
const controls = ['network-name', 'security', 'password', 'cancel', 'join'];

/** Root-owned transient Join lease; native password drafts never enter snapshots. */
export function createWifiCommands(ctx) {
  const { presentation } = ctx;
  const scope = crypto.randomUUID();
  let nextJoin = 1, returnFocus;
  const ownJoin = target => {
    if (!fields(target, ['joinId']) || !identity(target.joinId)) return { error: invalid() };
    if (!presentation.join || presentation.join.joinId !== target.joinId) return { error: missing() };
    const view = ctx.getView();
    return ctx.available() && view?.available('cancel') && view.available('join')
      ? { pending: presentation.join, view } : { error: unavailable() };
  };
  const clear = () => { presentation.join = null; returnFocus = undefined; };
  function connect(networkId, password) {
    const state = ctx.getState(), network = state.networks.find(network => network.id === networkId);
    if (state.powered && network?.available && (network.known || network.security === 'open' || password === network.password)
      && !ctx.canCommit(networkId)) return rejected('limit_exceeded', 'Joining this network exceeds the existing complete-scene text budget.');
    return connectWifiNetwork(state, networkId, password);
  }
  async function begin(kind, network = null) {
    if (!ctx.canBegin() || presentation.join) return unavailable();
    const original = ctx.capture();
    returnFocus = original;
    presentation.join = { joinId: `${scope}:${nextJoin++}`, kind, networkId: network?.id ?? null,
      name: network?.name ?? null, error: null };
    const pending = presentation.join;
    await ctx.settle();
    const control = kind === 'hidden' ? 'network-name' : 'password';
    const view = ctx.getView();
    if (!ctx.available() || presentation.join !== pending || !view
      || !await view.focus(control) || presentation.join !== pending || !view.available(control)) {
      if (presentation.join === pending) { clear(); await ctx.settle(); await ctx.restore(original); }
      return unavailable();
    }
    return applied({ networkId: network?.id ?? null, connected: false, confirmationRequired: true, joinId: pending.joinId });
  }
  const handlers = {
    'wifi.power.set': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['powered']) || typeof payload.powered !== 'boolean') return invalid();
      if (!ctx.canBegin() || presentation.join) return unavailable();
      return setWifiPower(ctx.getState(), payload.powered);
    },
    'wifi.connect': async (target, payload) => {
      if (!fields(target, ['networkId']) || !identity(target.networkId) || !fields(payload, [])) return invalid();
      if (!ctx.canBegin() || presentation.join) return unavailable();
      const state = ctx.getState(), network = state.networks.find(network => network.id === target.networkId);
      const result = connect(target.networkId);
      if (result.status !== 'applied') return result;
      if (result.target.passwordRequired) return begin('network', network);
      return applied({ networkId: target.networkId, connected: true, confirmationRequired: false, joinId: null });
    },
    'wifi.disconnect': (target, payload) => {
      if (!fields(target, ['networkId']) || !identity(target.networkId) || !fields(payload, [])) return invalid();
      if (!ctx.canBegin() || presentation.join) return unavailable();
      return disconnectWifiNetwork(ctx.getState(), target.networkId);
    },
    'wifi.menu.otherNetworks.set': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['expanded']) || typeof payload.expanded !== 'boolean') return invalid();
      if (!ctx.canBegin() || !ctx.menuAvailable() || presentation.join || !ctx.getState().powered) return unavailable();
      presentation.otherNetworks = payload.expanded;
      return applied({ expanded: presentation.otherNetworks });
    },
    'wifi.join.hidden': (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      return ctx.getState().powered ? begin('hidden') : unavailable();
    },
    'wifi.join.submit': async (target, payload) => {
      const owned = ownJoin(target);
      if (owned.error) return owned.error;
      const { pending, view } = owned, hidden = pending.kind === 'hidden';
      if (!fields(payload, hidden ? ['networkName', 'security', 'password'] : ['password']) || !password(payload.password)
        || hidden && (!name(payload.networkName) || !['open', 'password'].includes(payload.security)
          || payload.security === 'open' && payload.password !== '')) return invalid();
      if (!ctx.getState().powered || !await view.setDraft(payload)
        || presentation.join !== pending || ownJoin(target).view !== view) return unavailable();
      const state = ctx.getState();
      const network = hidden ? state.networks.find(network => network.name === payload.networkName && network.security === payload.security)
        : state.networks.find(network => network.id === pending.networkId);
      if (!network || !network.available) {
        pending.error = 'That fictional network is not currently available.';
        return applied({ joinId: pending.joinId, networkId: network?.id ?? null, connected: false });
      }
      const result = connect(network.id, payload.password);
      if (result.status !== 'applied') {
        pending.error = result.error.message;
        return applied({ joinId: pending.joinId, networkId: network.id, connected: false });
      }
      if (!result.target.connected) {
        pending.error = 'The fictional password is incorrect. Use the password supplied by the scene author, not a real credential.';
        await ctx.settle();
        await view.focus('password');
        return applied({ joinId: pending.joinId, networkId: network.id, connected: false });
      }
      const original = returnFocus;
      clear();
      await ctx.settle();
      await ctx.restore(original);
      return applied({ joinId: pending.joinId, networkId: network.id, connected: true });
    },
    'wifi.join.cancel': async (target, payload) => {
      if (!fields(payload, [])) return invalid();
      const owned = ownJoin(target);
      if (owned.error) return owned.error;
      const original = returnFocus, { pending } = owned;
      clear();
      await ctx.settle();
      await ctx.restore(original);
      return applied({ joinId: pending.joinId, cancelled: true });
    },
    'wifi.join.focus': async (target, payload) => {
      if (!fields(target, ['joinId', 'control']) || !controls.includes(target.control)
        || !fields(payload, ['observe'], []) || Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean') return invalid();
      const owned = ownJoin({ joinId: target.joinId });
      if (owned.error) return owned.error;
      if (!owned.view.controlIds().includes(target.control)) return unavailable();
      if (payload.observe === true ? owned.view.focusedControl() !== target.control || !owned.view.available(target.control)
        : !await owned.view.focus(target.control) || !owned.view.available(target.control)) return unavailable();
      return applied({ joinId: target.joinId, control: target.control });
    },
    'wifi.join.select': async (target, payload) => {
      if (!fields(target, ['joinId', 'control']) || !['network-name', 'password'].includes(target.control)
        || !fields(payload, ['start', 'end', 'direction'], ['start', 'end'])
        || !Number.isSafeInteger(payload.start) || !Number.isSafeInteger(payload.end) || payload.start < 0 || payload.end < payload.start
        || Object.hasOwn(payload, 'direction') && !['none', 'forward', 'backward'].includes(payload.direction)) return invalid();
      const owned = ownJoin({ joinId: target.joinId });
      if (owned.error) return owned.error;
      if (!owned.view.controlIds().includes(target.control)) return unavailable();
      const node = owned.view.element().querySelector(`[data-wifi-control="${target.control}"]`);
      if (!node || payload.end > node.value.length) return invalid();
      if (!await owned.view.focus(target.control) || !owned.view.available(target.control)
        || ownJoin({ joinId: target.joinId }).view !== owned.view) return unavailable();
      node.setSelectionRange(payload.start, payload.end, payload.direction ?? 'none');
      return applied({ joinId: target.joinId, control: target.control, start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection });
    },
    'wifi.join.scroll': async (target, payload) => {
      if (!fields(payload, ['top', 'observe'], ['top']) || !Number.isFinite(payload.top) || payload.top < 0
        || Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean') return invalid();
      const owned = ownJoin(target);
      if (owned.error) return owned.error;
      const top = payload.observe === true ? owned.view.scrollTop() : await owned.view.scrollTo(payload.top);
      return Number.isFinite(top) && top >= 0 && presentation.join === owned.pending
        ? applied({ joinId: target.joinId, top }) : unavailable();
    },
  };
  return {
    handlers: Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (target, payload) =>
      ctx.profile.id === 'macos-golden-gate-27.0.1' && ctx.profile.capabilities.includes('status.wifi')
        ? handler(target, payload) : rejected('unsupported_profile', 'Only Golden Gate represents fictional Wi-Fi.')])),
    clear() { clear(); presentation.otherNetworks = false; },
    targets() {
      const pending = presentation.join, view = ctx.getView();
      return { powered: ctx.getState().powered, connectedNetworkId: ctx.getState().connectedNetworkId,
        networks: ctx.getState().networks.map(({ id, name, security, known, available, hidden, strength }) =>
          ({ networkId: id, name, security, known, available, hidden, strength })),
        otherNetworks: presentation.otherNetworks, join: pending ? { ...pending,
          controlIds: view?.controlIds() ?? [], focusedControl: view?.focusedControl() ?? null,
          scrollTop: view?.scrollTop() ?? null } : null,
        boundaries: { hostNetworking: false, realCredentials: false, automaticReconnect: false,
          scope: 'retained-desktop', passwordDraftsSaved: false } };
    },
    menuProvider(enabled) {
      const state = ctx.getState(), connected = state.networks.find(network => network.id === state.connectedNetworkId);
      const row = network => ({ id: `network:${network.id}`, type: 'wifi-network', name: network.name,
        label: network.name, security: network.security, strength: network.strength,
        connected: state.connectedNetworkId === network.id, enabled,
        request: { command: state.connectedNetworkId === network.id ? 'wifi.disconnect' : 'wifi.connect', target: { networkId: network.id } } });
      return { menuId: 'wifi', kind: 'wifi', label: 'Wi-Fi', enabled, status: !state.powered ? 'off' : connected ? 'connected' : 'disconnected',
        strength: connected?.strength ?? 0, connectedName: connected?.name ?? null, items: [
          { id: 'wifi-power', type: 'wifi-power', label: 'Wi-Fi', checked: state.powered, enabled, keepOpen: true,
            request: { command: 'wifi.power.set', payload: { powered: !state.powered } } },
          ...(state.powered ? [
            { id: 'known-networks', label: 'Known Networks', heading: true, enabled: false },
            ...state.networks.filter(network => network.known && network.available).map(row),
            { id: 'other-networks', type: 'wifi-disclosure', label: 'Other Networks', checked: presentation.otherNetworks,
              enabled, keepOpen: true, request: { command: 'wifi.menu.otherNetworks.set', payload: { expanded: !presentation.otherNetworks } } },
            ...(presentation.otherNetworks ? [
              ...state.networks.filter(network => !network.known && network.available && !network.hidden).map(row),
              { id: 'other-network', type: 'wifi-other', label: 'Other…', enabled, request: { command: 'wifi.join.hidden' } },
            ] : []),
          ] : []),
          { id: 'wifi-footer-separator', separator: true, enabled: false },
          { id: 'wifi-settings', label: 'Wi-Fi Settings…', enabled,
            request: { command: 'system.settings.open', payload: { pane: 'wifi' } } },
        ] };
    },
  };
}

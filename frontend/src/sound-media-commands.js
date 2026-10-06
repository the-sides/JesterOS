import { isRecord, rejected } from './feature-commands.js';
import { AUDIO_FIXTURES } from './audio-fixtures.js';

const controlIds = ['play-pause', 'position', 'volume', 'sound-settings'];
const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => {
    if (typeof key !== 'string' || !allowed.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  }) && required.every(key => Object.hasOwn(value, key));
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const offset = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Use the closed documented Sound media target and literal payload.');
const unavailable = message => rejected('unavailable', message ?? 'The original foreground native audio control is not available.');
const stale = () => rejected('stale_target', 'This audio player no longer belongs to the original retained desktop, window, and media node.');

/** Only retained real HTMLAudioElements participate; no persistent playback mirror. */
export function createSoundMediaCommands(ctx) {
  let epoch = 0;
  const registered = () => ctx.getViews();
  function owner(windowId) {
    const window = ctx.getWindow(windowId), view = ctx.getView(windowId);
    if (!window || window.id !== windowId || window.utilityKind || !Object.hasOwn(AUDIO_FIXTURES, window.appId)
      || !view || typeof view.audioElement !== 'function') return null;
    const audio = view.audioElement(), realm = audio?.ownerDocument?.defaultView;
    if (!realm?.HTMLAudioElement || !(audio instanceof realm.HTMLAudioElement) || !audio.isConnected
      || audio.getAttribute('src') !== AUDIO_FIXTURES[window.appId].src) return null;
    const panel = audio.closest('[data-sound-player]'), root = panel?.closest('[data-session-scene]');
    const frame = panel?.closest('.managed-window[data-window-id]');
    if (!panel?.isConnected || !root?.isConnected || !frame?.isConnected
      || panel.dataset.windowId !== windowId || panel.dataset.soundPlayer !== window.appId
      || frame.dataset.windowId !== windowId) return null;
    return { windowId, window, appId: window.appId, view, audio, panel, root, frame, epoch };
  }
  function current(original) {
    if (!original || original.epoch !== epoch || ctx.getWindow(original.windowId) !== original.window
      || ctx.getView(original.windowId) !== original.view || original.window.appId !== original.appId
      || original.window.utilityKind) return false;
    const next = owner(original.windowId);
    return Boolean(next && next.audio === original.audio && next.panel === original.panel
      && next.root === original.root && next.frame === original.frame);
  }
  function snapshot(original) {
    if (!current(original)) return null;
    const value = original.view.snapshot();
    if (!fields(value, ['windowId', 'appId', 'trackId', 'playing', 'paused', 'ended', 'position', 'duration', 'volume', 'muted', 'ready', 'error'])
      || value.windowId !== original.windowId || value.appId !== original.appId
      || value.trackId !== AUDIO_FIXTURES[original.appId].id
      || !['playing', 'paused', 'ended', 'muted', 'ready'].every(key => typeof value[key] === 'boolean')
      || !offset(value.position) || !(value.duration === null || offset(value.duration))
      || !offset(value.volume) || value.volume > 1 || !(value.error === null || typeof value.error === 'string')) return null;
    return { ...value };
  }
  function notify(original) {
    const actual = snapshot(original);
    if (actual) ctx.notify(original.windowId, actual);
    return actual;
  }
  function own(target, control = false, interaction = true) {
    if (!fields(target, control ? ['windowId', 'control'] : ['windowId']) || !identity(target.windowId)
      || control && !controlIds.includes(target.control)) return { error: invalid() };
    const original = owner(target.windowId);
    if (!original) return { error: stale() };
    if (!ctx.available() || interaction && original.view.available() !== true) return { error: unavailable() };
    return { original };
  }
  const failure = original => current(original) ? unavailable(snapshot(original)?.error ?? undefined) : stale();
  const observed = payload => fields(payload, ['observe'], [])
    && (!Object.hasOwn(payload, 'observe') || typeof payload.observe === 'boolean');
  const handlers = {
    'sound.media.play': async (target, payload) => {
      if (!fields(payload, [])) return invalid();
      const owned = own(target); if (owned.error) return owned.error;
      const { original } = owned;
      try { await original.view.play(); }
      catch { if (current(original)) notify(original); return failure(original); }
      if (!current(original) || !ctx.available() || original.view.available() !== true) {
        // Never leave an old lease playing after a root switch/replacement.
        original.audio.pause();
        return failure(original);
      }
      const actual = notify(original);
      return actual?.playing === true && actual.paused === false
        ? applied({ windowId: original.windowId, playing: true }) : failure(original);
    },
    'sound.media.pause': (target, payload) => {
      if (!fields(payload, [])) return invalid();
      const owned = own(target); if (owned.error) return owned.error;
      const { original } = owned;
      try { original.view.pause(); } catch { return failure(original); }
      const actual = notify(original);
      return ctx.available() && actual?.paused === true && actual.playing === false
        ? applied({ windowId: original.windowId, playing: false }) : failure(original);
    },
    'sound.media.seek': async (target, payload) => {
      if (!fields(payload, ['seconds']) || !offset(payload.seconds)) return invalid();
      const owned = own(target); if (owned.error) return owned.error;
      const { original } = owned, before = snapshot(original);
      if (!before?.ready || before.duration === null) return unavailable('Audio metadata is not available for seeking.');
      if (payload.seconds > before.duration) return rejected('invalid_arguments', 'The requested position is past the actual audio duration.');
      let position;
      try { position = await original.view.seek(payload.seconds); }
      catch { if (current(original)) notify(original); return failure(original); }
      if (!current(original) || !ctx.available() || original.view.available() !== true || !offset(position)) return failure(original);
      const actual = notify(original);
      return actual ? applied({ windowId: original.windowId, position: actual.position }) : failure(original);
    },
    'sound.media.focus': async (target, payload) => {
      if (!observed(payload)) return invalid();
      const owned = own(target, true); if (owned.error) return owned.error;
      const { original } = owned;
      let focused;
      try {
        focused = payload.observe ? original.view.available(target.control) === true
          && original.view.focusedControl() === target.control : await original.view.focus(target.control);
      } catch { return failure(original); }
      if (!focused || !current(original) || !ctx.available() || original.view.available(target.control) !== true
        || original.view.focusedControl() !== target.control) return failure(original);
      return applied({ windowId: original.windowId, control: target.control });
    },
    'sound.media.scroll': async (target, payload) => {
      if (!fields(payload, ['top', 'left', 'observe'], ['top']) || !offset(payload.top)
        || Object.hasOwn(payload, 'left') && !offset(payload.left)
        || Object.hasOwn(payload, 'observe') && typeof payload.observe !== 'boolean') return invalid();
      const owned = own(target); if (owned.error) return owned.error;
      const { original } = owned;
      let result;
      try {
        result = payload.observe ? { top: original.view.scrollTop(), left: original.view.scrollLeft() }
          : await original.view.scroll(payload.top, payload.left ?? 0);
      } catch { return failure(original); }
      if (!current(original) || !ctx.available() || original.view.available() !== true
        || !fields(result, ['top', 'left']) || !offset(result.top) || !offset(result.left)) return failure(original);
      const top = original.view.scrollTop(), left = original.view.scrollLeft();
      if (top !== result.top || left !== result.left || payload.observe
        && (top !== payload.top || Object.hasOwn(payload, 'left') && left !== payload.left)) return unavailable();
      return applied({ windowId: original.windowId, top, left });
    },
    'sound.media.observe': (target, payload) => {
      if (!fields(payload, [])) return invalid();
      // A hidden/minimized retained player can still generate real media events.
      const owned = own(target, false, false); if (owned.error) return owned.error;
      return notify(owned.original) ? applied({ windowId: owned.original.windowId }) : failure(owned.original);
    },
  };
  return {
    handlers: Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (target, payload) =>
      ctx.profile.id === 'macos-golden-gate-27.0.1' && ctx.profile.capabilities.includes('status.sound')
        ? handler(target, payload) : rejected('unsupported_profile', 'Only Golden Gate represents these bounded local audio players.')])),
    syncSound() {
      const state = ctx.getState();
      for (const [windowId] of registered()) {
        const original = owner(windowId);
        if (!original) continue;
        original.view.applySound(state);
        notify(original);
      }
    },
    clear() {
      epoch++;
      for (const [windowId] of registered()) {
        const original = owner(windowId);
        if (!original) continue;
        original.view.pause();
        notify(original);
      }
    },
    targets() {
      const players = [];
      for (const [windowId] of registered()) {
        const original = owner(windowId), actual = original && snapshot(original);
        if (!actual) continue;
        const controls = original.view.controlIds();
        players.push({ ...actual, controlIds: controls.filter(id => controlIds.includes(id)),
          focusedControl: original.view.focusedControl(), scrollTop: original.view.scrollTop(), scrollLeft: original.view.scrollLeft() });
      }
      return { players, boundaries: { source: 'original-local-pcm-wav', scope: 'retained-desktop',
        playbackSaved: false, autoplay: false, remoteMedia: false, hostDevices: false,
        gain: 'selected-output-times-app-volume', rootLoss: 'pause', hiddenWindowPlayback: 'retained' } };
    },
  };
}

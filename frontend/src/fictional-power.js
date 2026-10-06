import { isRecord, rejected } from './feature-commands.js';

export const POWER_STARTUP_SECONDS = 5;

export function fictionalPowerDefaults(profile) {
  return { phase: 'awake', pending: null, elapsedSeconds: 0, startupProgress: 0, focusedControl: null };
}

const fields = (value, names) => isRecord(value) && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name));
const empty = (target, payload) => fields(target, []) && fields(payload, []);
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Expected the declared fictional power target and payload.');
const unavailable = () => rejected('unavailable', 'This fictional power action is not currently available.');
const controlsFor = power => power.pending ? ['cancel', 'confirm', 'surface']
  : power.phase === 'saver' || power.phase === 'sleeping' ? ['wake', 'surface']
    : power.phase === 'off' ? ['start', 'surface'] : power.phase === 'booting' ? ['surface'] : [];

export function createFictionalPowerCommands(ctx) {
  const { profile, power, session } = ctx;
  const awake = () => power.phase === 'awake' && power.pending === null && !session.logoutPending;
  const activeUser = () => session.users.find(user => user.id === session.activeUserId);
  const canObscure = () => awake() && (session.phase === 'login' || (activeUser()?.signedIn
    && ((session.phase === 'desktop' && !activeUser().locked) || (session.phase === 'locked' && activeUser().locked))));
  const canConfirm = () => awake() && ['desktop', 'login', 'locked'].includes(session.phase)
    && (session.phase !== 'desktop' || (activeUser()?.signedIn && !activeUser().locked));
  const phase = value => {
    power.phase = value; power.elapsedSeconds = 0; power.startupProgress = 0; power.focusedControl = null;
  };
  async function focusSurface(controlId) {
    await ctx.settle();
    if (!ctx.available() || !controlsFor(power).includes(controlId)) return;
    const view = ctx.getView();
    if (view?.controlIds().includes(controlId) && await view.focus(controlId)
      && ctx.available() && ctx.getView() === view && view.controlIds().includes(controlId)
      && controlsFor(power).includes(controlId)) power.focusedControl = controlId;
  }
  async function obscure(nextPhase, target, payload) {
    if (!empty(target, payload)) return invalid();
    if (!canObscure()) return unavailable();
    if (session.phase === 'desktop') {
      const result = await ctx.lockSession();
      if (result.status !== 'applied') return result;
    }
    phase(nextPhase);
    await focusSurface('wake');
    return applied({ phase: nextPhase });
  }
  async function acceptPower(pending) {
    if (!ctx.available() || power.pending !== pending) return unavailable();
    // The host really discards Guest and signs users out; no fallback boot.
    await ctx.signOutForBoot();
    power.pending = null;
    phase(pending.action === 'restart' ? 'booting' : 'off');
    await focusSurface(pending.action === 'restart' ? 'surface' : 'start');
    return applied({ accepted: true, phase: power.phase });
  }
  async function confirm(action, target, payload) {
    if (!fields(target, []) || !(fields(payload, []) || fields(payload, ['confirm'])
      && typeof payload.confirm === 'boolean')) return invalid();
    if (!canConfirm()) return unavailable();
    ctx.captureReturn();
    power.pending = { action }; power.focusedControl = null;
    if (payload.confirm === false) {
      const result = await acceptPower(power.pending);
      return result.status === 'applied' ? applied({ confirmationRequired: false, action }) : result;
    }
    await focusSurface('cancel');
    return applied({ confirmationRequired: true, action });
  }
  const handlers = {
    'power.screenSaver.start': (target, payload) => obscure('saver', target, payload),
    'power.sleep': (target, payload) => obscure('sleeping', target, payload),
    'power.wake': async (target, payload) => {
      if (!empty(target, payload)) return invalid();
      if (power.pending || !['saver', 'sleeping'].includes(power.phase)) return unavailable();
      phase('awake');
      await ctx.settle();
      return applied({ phase: 'awake' });
    },
    'power.restart': (target, payload) => confirm('restart', target, payload),
    'power.shutdown': (target, payload) => confirm('shutdown', target, payload),
    'power.respond': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['accept']) || typeof payload.accept !== 'boolean') return invalid();
      const pending = power.pending;
      if (power.phase !== 'awake' || !pending || !['restart', 'shutdown'].includes(pending.action) || session.logoutPending) return unavailable();
      if (!payload.accept) {
        power.pending = null; power.focusedControl = null;
        await ctx.settle(); await ctx.restoreReturn();
      } else return acceptPower(pending);
      return applied({ accepted: payload.accept, phase: power.phase });
    },
    'power.start': async (target, payload) => {
      if (!empty(target, payload)) return invalid();
      if (power.phase !== 'off' || power.pending) return unavailable();
      phase('booting'); await focusSurface('surface');
      return applied({ phase: 'booting' });
    },
    'power.advance': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['seconds']) || !Number.isInteger(payload.seconds)
        || payload.seconds < 1 || payload.seconds > 300) return invalid();
      if (power.pending || !['saver', 'booting'].includes(power.phase)) return unavailable();
      if (power.phase === 'saver') power.elapsedSeconds += payload.seconds;
      else {
        power.elapsedSeconds = Math.min(POWER_STARTUP_SECONDS, power.elapsedSeconds + payload.seconds);
        power.startupProgress = power.elapsedSeconds / POWER_STARTUP_SECONDS;
        if (power.elapsedSeconds === POWER_STARTUP_SECONDS) {
          power.phase = 'awake'; power.focusedControl = null;
          await ctx.settle();
        }
      }
      if (power.phase !== 'awake' && !ctx.getView()?.controlIds().includes(power.focusedControl)) {
        await focusSurface(power.phase === 'saver' ? 'wake' : 'surface');
      }
      return applied({ phase: power.phase, elapsedSeconds: power.elapsedSeconds, startupProgress: power.startupProgress });
    },
    'power.focus': async (target, payload) => {
      if (!fields(target, ['controlId']) || typeof target.controlId !== 'string' || !target.controlId || !fields(payload, [])) return invalid();
      const view = ctx.getView(), currentPhase = power.phase, pending = power.pending;
      if (!controlsFor(power).includes(target.controlId) || !view?.controlIds().includes(target.controlId)
        || !await view.focus(target.controlId) || !ctx.available() || ctx.getView() !== view
        || !view.controlIds().includes(target.controlId) || power.phase !== currentPhase || power.pending !== pending) return unavailable();
      power.focusedControl = target.controlId;
      return applied({ controlId: target.controlId });
    },
  };
  return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, async (target, payload) => {
    if (profile.id !== 'macos-golden-gate-27.0.1' || !profile.capabilities.includes('session.power')) {
      return rejected('unsupported_profile', 'Fictional power is represented only by the current macOS profile.');
    }
    return ctx.available() ? handler(target, payload) : unavailable();
  }]));
}

export function powerTargets(power, view) {
  const visible = power.phase !== 'awake' || power.pending !== null;
  const bounds = visible ? view?.bounds() : null;
  return { phase: power.phase, pending: power.pending ? { ...power.pending } : null,
    elapsedSeconds: power.elapsedSeconds, startupProgress: power.startupProgress, focusedControl: power.focusedControl,
    controls: visible ? [...(view?.controlIds() ?? [])].filter(controlId => controlsFor(power).includes(controlId)) : [],
    bounds: bounds ? { ...bounds } : null,
    policy: { wakeRequiresSignIn: true, localDesktops: 'Retain original page-local documents and windows through power cycles.',
      guestData: 'Discard only after accepted restart or shutdown.', startupDurationSeconds: POWER_STARTUP_SECONDS,
      startupTiming: 'Deterministic fictional timing, not factory timing.', sceneClock: 'unchanged' },
    aliases: { screenSaver: 'Control+Shift+F5', sleep: 'Control+Shift+F6', wakeOrStart: 'Control+Shift+F4' },
    boundaries: { hostPower: false, hostAuthentication: false, hostSettings: false, hostFilesystem: false, hostNetwork: false,
      saveChangesDialog: false, reopenToggle: false, recovery: false, screenSaverPreferences: false } };
}

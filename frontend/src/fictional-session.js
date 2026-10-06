import { isRecord, rejected } from './feature-commands.js';

export function fictionalSessionDefaults(profile) {
  return { phase: 'desktop', activeUserId: 'local-alex', selectedUserId: 'local-alex', loginView: 'credential',
    loginError: null, focusedControl: null, fastUserSwitching: false, logoutPending: null,
    users: [
      { id: 'local-alex', name: profile.defaults.accountName ?? 'Alex Morgan', kind: 'local', signedIn: true, locked: false },
      { id: 'local-casey', name: 'Casey Rivera', kind: 'local', signedIn: false, locked: false },
      { id: 'guest', name: 'Guest User', kind: 'guest', signedIn: false, locked: false },
    ] };
}

export function sessionMenuItems(profile, session, menuId) {
  if (profile.renderer !== 'golden-gate' || menuId !== 'users') return [];
  const users = session.users.map(user => ({ id: `user:${user.id}`, label: user.name, enabled: true, checked: user.signedIn }));
  return [...users,
    { id: 'login', label: 'Login Window…', enabled: true, separatorBefore: true }];
}

const fields = (value, allowed, required = allowed) => isRecord(value)
  && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Expected the declared fictional session target and payload.');
const unavailable = () => rejected('unavailable', 'This fictional session action is not currently available.');

export function createFictionalSessionCommands(ctx) {
  const { profile, session } = ctx;
  const user = id => session.users.find(user => user.id === id);
  const desktop = () => session.phase === 'desktop' && !session.logoutPending;
  const empty = (target, payload) => fields(target, []) && fields(payload, []);
  const surfaceFocus = async controlId => {
    await ctx.settle();
    if (!ctx.available()) return false;
    const view = ctx.getSurfaceView();
    if (!view?.controlIds().includes(controlId) || !await view.focus(controlId) || !ctx.available()) return false;
    session.focusedControl = controlId;
    return true;
  };
  const capture = () => { if (desktop()) ctx.captureDesktop(session.activeUserId); };
  async function showLogin(target, payload) {
    if (!empty(target, payload)) return invalid();
    if (session.logoutPending) return unavailable();
    capture(); user(session.activeUserId).locked = true;
    session.phase = 'login'; session.selectedUserId = null; session.loginView = 'users';
    session.loginError = null; session.focusedControl = null;
    await surfaceFocus(`user:${session.users[0].id}`);
    return applied({ phase: 'login' });
  }
  async function chooseUser(target, payload) {
    if (!fields(target, ['userId']) || typeof target.userId !== 'string' || !user(target.userId) || !fields(payload, [])) return invalid();
    if (desktop() || session.logoutPending) return unavailable();
    session.phase = 'login'; session.selectedUserId = target.userId; session.loginView = 'credential';
    session.loginError = null; session.focusedControl = null;
    await surfaceFocus(user(target.userId).kind === 'guest' ? 'guest-acknowledge' : 'password');
    return applied({ userId: target.userId });
  }
  const handlers = {
    'session.lock': async (target, payload) => {
      if (!empty(target, payload)) return invalid();
      if (!desktop()) return unavailable();
      capture(); user(session.activeUserId).locked = true;
      session.phase = 'locked'; session.selectedUserId = session.activeUserId; session.loginView = 'credential';
      session.loginError = null; session.focusedControl = null;
      await surfaceFocus(user(session.activeUserId).kind === 'guest' ? 'guest-acknowledge' : 'password');
      return applied({ phase: 'locked', userId: session.activeUserId });
    },
    'session.login.open': showLogin,
    'session.user.select': chooseUser,
    'session.login.submit': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['passcode', 'acknowledgeGuest'], [])
        || (payload.passcode !== undefined && (typeof payload.passcode !== 'string' || payload.passcode.length > 5))
        || (payload.acknowledgeGuest !== undefined && typeof payload.acknowledgeGuest !== 'boolean')) return invalid();
      const selected = user(session.selectedUserId);
      if (!selected || session.phase === 'desktop' || session.logoutPending) return unavailable();
      if (selected.kind === 'guest') {
        if (payload.acknowledgeGuest !== true || Object.hasOwn(payload, 'passcode')) return invalid();
      } else {
        if (!Object.hasOwn(payload, 'passcode') || Object.hasOwn(payload, 'acknowledgeGuest')) return invalid();
        if (payload.passcode !== 'scene') {
          session.loginError = 'Incorrect fictional password. Use scene; never enter a real password.';
          await surfaceFocus('password');
          return applied({ userId: selected.id, accepted: false });
        }
      }
      const retained = selected.signedIn;
      if (!await ctx.ensureDesktop(selected.id) || !ctx.available()) {
        if (!retained) await ctx.discardDesktop(selected.id);
        return unavailable();
      }
      selected.signedIn = true; selected.locked = false;
      session.activeUserId = selected.id; session.phase = 'desktop';
      session.loginError = null; session.focusedControl = null;
      await ctx.settle(); await ctx.restoreDesktop(selected.id);
      return applied({ userId: selected.id, accepted: true });
    },
    'session.login.back': async (target, payload) => {
      if (!empty(target, payload)) return invalid();
      if (desktop() || session.logoutPending) return unavailable();
      session.phase = 'login'; session.selectedUserId = null; session.loginView = 'users'; session.loginError = null;
      await surfaceFocus(`user:${session.users[0].id}`);
      return applied({ phase: 'login' });
    },
    'session.focus': async (target, payload) => {
      if (!fields(target, ['controlId']) || typeof target.controlId !== 'string' || !fields(payload, [])) return invalid();
      const view = ctx.getSurfaceView();
      if (desktop() || !view?.controlIds().includes(target.controlId) || !await view.focus(target.controlId)) return unavailable();
      session.focusedControl = target.controlId;
      return applied({ controlId: target.controlId });
    },
    'session.fastUserSwitching.set': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['enabled']) || typeof payload.enabled !== 'boolean') return invalid();
      session.fastUserSwitching = payload.enabled;
      return applied({ enabled: payload.enabled });
    },
    'session.logout': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['confirm'], [])
        || (Object.hasOwn(payload, 'confirm') && typeof payload.confirm !== 'boolean')) return invalid();
      if (!desktop()) return unavailable();
      const departing = user(session.activeUserId);
      if (!departing?.signedIn || departing.locked) return unavailable();
      capture();
      if (payload.confirm === false) {
        await finishLogout(departing);
        return applied({ confirmationRequired: false, userId: departing.id, phase: session.phase });
      }
      const pending = { userId: departing.id, kind: departing.kind };
      session.logoutPending = pending; session.focusedControl = null;
      if (!await surfaceFocus('logout-cancel')) {
        session.logoutPending = null; session.focusedControl = null;
        await ctx.settle();
        if (ctx.available()) await ctx.restoreDesktop(departing.id);
        return unavailable();
      }
      return applied({ confirmationRequired: true, userId: departing.id, phase: session.phase });
    },
    'session.logout.respond': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['accept']) || typeof payload.accept !== 'boolean') return invalid();
      const pending = session.logoutPending, departing = user(pending?.userId);
      if (!pending || !departing || departing.id !== session.activeUserId || !departing.signedIn
        || session.phase !== 'desktop') return unavailable();
      session.logoutPending = null; session.focusedControl = null;
      if (payload.accept) await finishLogout(departing);
      else { await ctx.settle(); await ctx.restoreDesktop(departing.id); }
      return applied({ accepted: payload.accept, userId: departing.id, phase: session.phase });
    },
  };
  async function finishLogout(departing) {
    departing.signedIn = false; departing.locked = false;
    session.logoutPending = null; session.focusedControl = null;
    session.phase = 'login'; session.selectedUserId = null; session.loginView = 'users'; session.loginError = null;
    if (departing.kind === 'guest') {
      session.activeUserId = (session.users.find(entry => entry.kind === 'local' && entry.signedIn)
        ?? session.users.find(entry => entry.kind === 'local')).id;
      await ctx.discardDesktop(departing.id);
    }
    await surfaceFocus(`user:${session.users[0].id}`);
  }
  return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name,
    (target, payload) => !profile.capabilities.includes('session.fictional')
      ? rejected('unsupported_profile', 'Fictional sessions are represented only by the current macOS profile.')
      : ctx.available() ? handler(target, payload) : unavailable()]));
}

export function sessionTargets(session, surface) {
  return { phase: session.phase, desktopAvailable: session.phase === 'desktop' && !session.logoutPending,
    activeUserId: session.activeUserId, selectedUserId: session.selectedUserId,
    users: session.users.map(user => ({ ...user })),
    controls: surface?.controlIds() ?? [], bounds: surface?.bounds() ?? null,
    fictionalPasscode: 'scene', guestEphemeral: true, fileVault: 'fictional off; no host security state',
    shortcuts: { lock: 'Control+Command+Q', alias: 'Control+Shift+F7', logout: 'Shift+Command+Q',
      logoutWithoutConfirmation: 'Option+Shift+Command+Q', nativeDelivery: 'Only key events delivered to this page; no host keyboard or lock API.' },
    boundaries: { hostAuthentication: false, hostAccounts: false, savedSessions: false, userCreation: false,
      localLogout: true, passwordRecovery: false, biometrics: false } };
}

// A page-local power cycle signs users out without replacing retained local models.
export function signOutFictionalSessions(session) {
  for (const user of session.users) { user.signedIn = false; user.locked = false; }
  session.activeUserId = session.users.find(user => user.kind === 'local').id;
  session.selectedUserId = null; session.phase = 'login'; session.loginView = 'users';
  session.loginError = null; session.focusedControl = null; session.logoutPending = null;
}

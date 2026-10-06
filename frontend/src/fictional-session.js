import { isRecord, rejected } from './feature-commands.js';

export function fictionalSessionDefaults(profile) {
  return { phase: 'desktop', activeUserId: 'local-alex', selectedUserId: 'local-alex', loginView: 'credential',
    loginError: null, focusedControl: null, fastUserSwitching: false, menu: null, guestConfirmation: false,
    users: [
      { id: 'local-alex', name: profile.defaults.accountName ?? 'Alex Morgan', kind: 'local', signedIn: true, locked: false },
      { id: 'local-casey', name: 'Casey Rivera', kind: 'local', signedIn: false, locked: false },
      { id: 'guest', name: 'Guest User', kind: 'guest', signedIn: false, locked: false },
    ] };
}

export function sessionMenuItems(profile, session, menuId) {
  if (profile.renderer !== 'golden-gate') return [];
  const guest = session.activeUserId === 'guest';
  const users = session.users.map(user => ({ id: `user:${user.id}`, label: user.name, enabled: true, checked: user.signedIn }));
  if (menuId === 'apple') return [
    { id: 'lock', label: 'Lock Screen', enabled: true },
    { id: 'login', label: 'Login Window…', enabled: true },
    ...(guest ? [{ id: 'guest-end', label: 'Log Out Guest User…', enabled: true, separatorBefore: true }] : []),
  ];
  if (menuId === 'users') return [...users,
    { id: 'login', label: 'Login Window…', enabled: true, separatorBefore: true }];
  return [];
}

const fields = (value, allowed, required = allowed) => isRecord(value)
  && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
const applied = target => ({ status: 'applied', target });
const invalid = () => rejected('invalid_arguments', 'Expected the declared fictional session target and payload.');
const unavailable = () => rejected('unavailable', 'This fictional session action is not currently available.');

export function createFictionalSessionCommands(ctx) {
  const { profile, session } = ctx;
  const user = id => session.users.find(user => user.id === id);
  const desktop = () => session.phase === 'desktop' && !session.guestConfirmation;
  const empty = (target, payload) => fields(target, []) && fields(payload, []);
  const surfaceFocus = async controlId => {
    await ctx.settle();
    const view = ctx.getSurfaceView();
    if (view?.controlIds().includes(controlId) && await view.focus(controlId)) session.focusedControl = controlId;
  };
  const capture = () => { if (desktop()) ctx.captureDesktop(session.activeUserId); };
  async function showLogin(target, payload) {
    if (!empty(target, payload)) return invalid();
    if (session.guestConfirmation) return unavailable();
    capture(); user(session.activeUserId).locked = true;
    session.phase = 'login'; session.selectedUserId = null; session.loginView = 'users';
    session.menu = null; session.loginError = null; session.focusedControl = null;
    await surfaceFocus(`user:${session.users[0].id}`);
    return applied({ phase: 'login' });
  }
  async function chooseUser(target, payload) {
    if (!fields(target, ['userId']) || typeof target.userId !== 'string' || !user(target.userId) || !fields(payload, [])) return invalid();
    if (desktop() || session.guestConfirmation) return unavailable();
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
      session.menu = null; session.loginError = null; session.focusedControl = null;
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
      if (!selected || session.phase === 'desktop' || session.guestConfirmation) return unavailable();
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
      session.activeUserId = selected.id; session.phase = 'desktop'; session.menu = null;
      session.loginError = null; session.focusedControl = null;
      await ctx.settle(); await ctx.restoreDesktop(selected.id);
      return applied({ userId: selected.id, accepted: true });
    },
    'session.login.back': async (target, payload) => {
      if (!empty(target, payload)) return invalid();
      if (desktop() || session.guestConfirmation) return unavailable();
      session.phase = 'login'; session.selectedUserId = null; session.loginView = 'users'; session.loginError = null;
      await surfaceFocus(`user:${session.users[0].id}`);
      return applied({ phase: 'login' });
    },
    'session.menu.open': async (target, payload) => {
      if (!fields(target, ['menuId']) || !['apple', 'users'].includes(target.menuId) || !fields(payload, [])) return invalid();
      const { menuId } = target;
      if (menuId === 'users' && !session.fastUserSwitching) return rejected('disabled', 'The optional fast user switching menu is off.');
      if (!desktop()) return unavailable();
      const view = ctx.getMenuView(menuId);
      if (!view || !await view.focus('invoker')) return unavailable();
      ctx.captureMenuFocus(menuId);
      const before = session.menu;
      session.menu = { menuId, focusedItemId: null };
      await ctx.settle();
      const first = view.itemIds()[0];
      if (!first || !await view.focus(first)) { session.menu = before; await ctx.settle(); await ctx.restoreMenuFocus(menuId); return unavailable(); }
      session.menu.focusedItemId = first;
      return applied({ menuId });
    },
    'session.menu.close': async (target, payload) => {
      if (!empty(target, payload)) return invalid();
      if (!desktop()) return unavailable();
      const menuId = session.menu?.menuId ?? null;
      session.menu = null;
      await ctx.settle(); if (menuId) await ctx.restoreMenuFocus(menuId);
      return applied({ menuId });
    },
    'session.menu.focus': async (target, payload) => {
      if (!fields(target, ['menuId', 'itemId']) || typeof target.itemId !== 'string' || !fields(payload, [])) return invalid();
      const view = ctx.getMenuView(target.menuId);
      if (!desktop() || session.menu?.menuId !== target.menuId || !view?.itemIds().includes(target.itemId)) return unavailable();
      if (!await view.focus(target.itemId)) return unavailable();
      session.menu.focusedItemId = target.itemId;
      return applied({ menuId: target.menuId, itemId: target.itemId });
    },
    'session.menu.select': async (target, payload) => {
      if (!fields(target, ['menuId', 'itemId']) || typeof target.itemId !== 'string' || !fields(payload, [])) return invalid();
      if (!desktop() || session.menu?.menuId !== target.menuId) return unavailable();
      const item = sessionMenuItems(profile, session, target.menuId).find(item => item.id === target.itemId);
      if (!item) return invalid();
      if (!item.enabled) return rejected('disabled', 'This native session leaf is unavailable in the bounded simulation.');
      const closed = await handlers['session.menu.close']({}, {});
      if (closed.status !== 'applied') return closed;
      let result;
      if (item.id === 'lock') result = await handlers['session.lock']({}, {});
      else if (item.id === 'login') result = await showLogin({}, {});
      else if (item.id === 'guest-end') result = await handlers['session.guest.end']({}, {});
      else {
        result = await showLogin({}, {});
        if (result.status === 'applied') result = await chooseUser({ userId: item.id.slice(5) }, {});
      }
      return result.status === 'applied' ? applied({ menuId: target.menuId, itemId: target.itemId }) : result;
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
      if (!payload.enabled && session.menu?.menuId === 'users') await handlers['session.menu.close']({}, {});
      return applied({ enabled: payload.enabled });
    },
    'session.guest.end': async (target, payload) => {
      if (!empty(target, payload)) return invalid();
      if (!desktop() || session.activeUserId !== 'guest') return unavailable();
      capture(); session.menu = null; session.guestConfirmation = true; session.focusedControl = null;
      await surfaceFocus('guest-end-cancel');
      return applied({ confirmationRequired: true });
    },
    'session.guest.respond': async (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['accept']) || typeof payload.accept !== 'boolean') return invalid();
      if (!session.guestConfirmation || session.activeUserId !== 'guest') return unavailable();
      session.guestConfirmation = false; session.focusedControl = null;
      if (!payload.accept) { await ctx.settle(); await ctx.restoreDesktop('guest'); }
      else {
        const guest = user('guest'); guest.signedIn = false; guest.locked = false;
        session.activeUserId = session.users.find(user => user.kind === 'local' && user.signedIn).id;
        session.phase = 'login'; session.selectedUserId = null; session.loginView = 'users'; session.loginError = null;
        await ctx.discardDesktop('guest'); await surfaceFocus(`user:${session.users[0].id}`);
      }
      return applied({ accepted: payload.accept, phase: session.phase });
    },
  };
  return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name,
    (target, payload) => !profile.capabilities.includes('session.fictional')
      ? rejected('unsupported_profile', 'Fictional sessions are represented only by the current macOS profile.')
      : ctx.available() ? handler(target, payload) : unavailable()]));
}

export function sessionTargets(session, surface, menu) {
  return { phase: session.phase, desktopAvailable: session.phase === 'desktop' && !session.guestConfirmation,
    activeUserId: session.activeUserId, selectedUserId: session.selectedUserId,
    users: session.users.map(user => ({ ...user })),
    controls: surface?.controlIds() ?? [], bounds: surface?.bounds() ?? null,
    menu: session.menu ? { ...session.menu, itemIds: menu?.itemIds() ?? [], bounds: menu?.bounds() ?? null } : null,
    fictionalPasscode: 'scene', guestEphemeral: true, fileVault: 'fictional off; no host security state',
    shortcuts: { lock: 'Control+Command+Q', alias: 'Control+Shift+F7', nativeDelivery: 'Only key events delivered to this page; no host keyboard or lock API.' },
    boundaries: { hostAuthentication: false, hostAccounts: false, savedSessions: false, userCreation: false,
      localLogout: false, passwordRecovery: false, biometrics: false } };
}

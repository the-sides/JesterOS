import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { fictionalSessionDefaults, createFictionalSessionCommands, signOutFictionalSessions, sessionTargets } from '../frontend/src/fictional-session.js';

function scene(profileId = 'macos-golden-gate-27.0.1') {
  const profile = typeof profileId === 'string' ? getOSProfile(profileId) : profileId, session = fictionalSessionDefaults(profile);
  let available = true, ready = true, surfaceEnabled = true, exitAllowed = true, commitAllowed = true, reopenPreference = true;
  const disabled = new Set();
  const surface = {
    controlIds: () => surfaceEnabled ? (session.logoutPending
      ? ['logout-cancel', 'logout-confirm', ...(session.logoutPending.kind === 'local' ? ['logout-reopen-windows'] : [])]
      : session.phase === 'desktop' ? [] : ['password', 'sign-in', 'back', 'guest-acknowledge', 'user:local-alex', 'user:local-casey', 'user:guest'])
      .filter(id => !disabled.has(id)) : [],
    focus: id => surface.controlIds().includes(id),
    bounds: () => null,
  };
  const commands = createFictionalSessionCommands({ profile, session, available: () => available,
    settle: async () => {}, captureDesktop: () => {}, restoreDesktop: async () => true,
    ensureDesktop: async () => ready, discardDesktop: async () => {},
    getReopenWindows: () => reopenPreference, canExit: () => exitAllowed,
    exitDesktop: async () => commitAllowed ? { status: 'applied' }
      : { status: 'rejected', error: { code: 'unavailable', message: 'Pending desktop work.' } },
    getSurfaceView: () => surfaceEnabled ? surface : null,
  });
  return { session, targets: () => sessionTargets(session, surface),
    run: (name, target = {}, payload = {}) => commands[`session.${name}`](target, payload),
    setAvailable: value => { available = value; }, setReady: value => { ready = value; },
    setSurfaceEnabled: value => { surfaceEnabled = value; }, disable: id => disabled.add(id),
    setExitAllowed: value => { exitAllowed = value; }, setCommitAllowed: value => { commitAllowed = value; },
    setReopenPreference: value => { reopenPreference = value; } };
}
const unchanged = async (s, name, target, payload) => {
  const before = JSON.stringify(s.session), result = await s.run(name, target, payload);
  expect(result.status).toBe('rejected'); expect(JSON.stringify(s.session)).toBe(before); return result;
};

test('locking cannot be bypassed by Back or an incorrect fictional password', async () => {
  const s = scene();
  await s.run('lock'); expect(s.session.phase).toBe('locked'); expect(s.session.users[0].locked).toBe(true);
  const wrong = await s.run('login.submit', {}, { passcode: 'wrong' });
  expect(wrong.target.accepted).toBe(false); expect(s.session.phase).toBe('locked'); expect(s.session.loginError).not.toBeNull();
  await s.run('login.back'); expect(s.session.phase).toBe('login'); expect(s.session.loginView).toBe('users');
  await s.run('user.select', { userId: 'local-alex' });
  expect((await s.run('login.submit', {}, { passcode: 'scene' })).target.accepted).toBe(true);
  expect(s.session.phase).toBe('desktop'); expect(s.session.users[0].locked).toBe(false);
});

test('selecting another local user retains the first signed-in session until authenticated return', async () => {
  const s = scene(); await s.run('login.open'); await s.run('user.select', { userId: 'local-casey' });
  expect(s.session.activeUserId).toBe('local-alex'); expect(s.session.users[0].signedIn).toBe(true); expect(s.session.users[1].signedIn).toBe(false);
  await s.run('login.submit', {}, { passcode: 'scene' });
  expect(s.session.activeUserId).toBe('local-casey'); expect(s.session.users[0].locked).toBe(true); expect(s.session.users[1].signedIn).toBe(true);
  await s.run('login.open'); await s.run('user.select', { userId: 'local-alex' }); await s.run('login.submit', {}, { passcode: 'scene' });
  expect(s.session.activeUserId).toBe('local-alex'); expect(s.session.users[1].signedIn).toBe(true); expect(s.session.users[1].locked).toBe(true);
});

test('Guest acknowledgement and logout cancellation retain its session; acceptance signs out only Guest', async () => {
  const s = scene(); await s.run('login.open'); await s.run('user.select', { userId: 'guest' });
  await unchanged(s, 'login.submit', {}, {}); await unchanged(s, 'login.submit', {}, { passcode: 'scene', acknowledgeGuest: true });
  await s.run('login.submit', {}, { acknowledgeGuest: true }); expect(s.session.activeUserId).toBe('guest');
  await s.run('logout'); expect(s.session.users[2].signedIn).toBe(true);
  await s.run('logout.respond', {}, { accept: false }); expect(s.session.phase).toBe('desktop'); expect(s.session.users[2].signedIn).toBe(true);
  await s.run('logout'); await s.run('logout.respond', {}, { accept: true });
  expect(s.session.phase).toBe('login'); expect(s.session.selectedUserId).toBeNull(); expect(s.session.users[2].signedIn).toBe(false); expect(s.session.users[0].signedIn).toBe(true);
});

test('Guest logout after startup works when no local user remains signed in', async () => {
  const s = scene();
  signOutFictionalSessions(s.session);
  await s.run('user.select', { userId: 'guest' }); await s.run('login.submit', {}, { acknowledgeGuest: true });
  await s.run('logout'); const result = await s.run('logout.respond', {}, { accept: true });
  expect(result.status).toBe('applied'); expect(s.session.phase).toBe('login');
  expect(s.session.activeUserId).toBe('local-alex'); expect(s.session.users.every(user => !user.signedIn)).toBe(true);
});

test('historical/uninstalled/missing-capability profiles reject fictional session actions without changing state', async () => {
  const current = getOSProfile('macos-golden-gate-27.0.1');
  for (const profile of [getOSProfile('macos-mojave-10.14'), getOSProfile('macos-sonoma-14.0'), getOSProfile('macos-high-sierra-10.13'),
    getOSProfile('windows11-23h2-22631.2428'), { ...current, id: 'macos-future' },
    { ...current, capabilities: current.capabilities.filter(value => value !== 'session.fictional') }]) {
    const legacy = scene(profile);
    for (const [name, target, payload] of [['lock', {}, {}], ['logout', {}, { reopenWindows: true }],
      ['logout.configure', {}, { reopenWindows: false }], ['logout.respond', {}, { accept: true }]]) {
      expect((await unchanged(legacy, name, target, payload)).error.code).toBe('unsupported_profile');
    }
  }
});

test('malformed requests and stale modal/focus targets reject before canonical mutation', async () => {
  const s = scene(); await unchanged(s, 'lock', { userId: 'local-alex' }, {}); await unchanged(s, 'user.select', { userId: 'missing' }, {});
  await unchanged(s, 'logout.respond', {}, { accept: true });
  await s.run('login.open'); await unchanged(s, 'login.submit', {}, { passcode: 'scene', extra: true });
  await unchanged(s, 'focus', { controlId: 'hidden-control' }, {}); await unchanged(s, 'user.select', { userId: 'local-casey', extra: true }, {});
});

test('unavailable desktop preparation or lost scene cannot partially authenticate a user', async () => {
  const s = scene(); await s.run('login.open'); await s.run('user.select', { userId: 'local-casey' }); s.setReady(false);
  expect((await unchanged(s, 'login.submit', {}, { passcode: 'scene' })).error.code).toBe('unavailable');
  expect(s.session.activeUserId).toBe('local-alex'); expect(s.session.users[1].signedIn).toBe(false);
  s.setReady(true); s.setAvailable(false);
  expect((await unchanged(s, 'login.submit', {}, { passcode: 'scene' })).error.code).toBe('unavailable');
  expect((await unchanged(s, 'lock', {}, {})).error.code).toBe('unavailable');
});

test('local logout is not a lock: cancel preserves both users and acceptance signs out only the departing account', async () => {
  const s = scene();
  await s.run('login.open'); await s.run('user.select', { userId: 'local-casey' }); await s.run('login.submit', {}, { passcode: 'scene' });
  const signedIn = structuredClone(s.session), alex = structuredClone(s.session.users[0]);
  await s.run('logout');
  await unchanged(s, 'lock', {}, {}); await unchanged(s, 'login.open', {}, {}); await unchanged(s, 'user.select', { userId: 'local-alex' }, {});
  await s.run('logout.respond', {}, { accept: false });
  expect(s.session).toEqual(signedIn);
  await s.run('logout'); await s.run('logout.respond', {}, { accept: true });
  expect(s.session.users[1]).toMatchObject({ signedIn: false, locked: false });
  expect(s.session.users[0]).toEqual(alex);
  expect(s.session.phase).toBe('login'); expect(s.session.selectedUserId).toBeNull();
  await unchanged(s, 'logout', {}, {});
  await s.run('user.select', { userId: 'local-casey' });
  await s.run('login.submit', {}, { passcode: 'wrong' }); expect(s.session.users[1].signedIn).toBe(false);
  await s.run('login.submit', {}, { passcode: 'scene' }); expect(s.session.users[1].signedIn).toBe(true);
});

test('explicit confirmation bypass reaches the same local/Guest sign-out boundary without leaving a stale modal', async () => {
  for (const userId of ['local-casey', 'guest']) {
    const s = scene();
    await s.run('login.open'); await s.run('user.select', { userId });
    await s.run('login.submit', {}, userId === 'guest' ? { acknowledgeGuest: true } : { passcode: 'scene' });
    const alex = structuredClone(s.session.users[0]);
    const result = await s.run('logout', {}, { confirm: false });
    expect(result.target).toMatchObject({ confirmationRequired: false, userId, phase: 'login', reopenWindows: userId !== 'guest' });
    expect(s.session.users.find(user => user.id === userId)).toMatchObject({ signedIn: false, locked: false });
    expect(s.session.users[0]).toEqual(alex); expect(s.session.logoutPending).toBeNull();
    await unchanged(s, 'logout.respond', {}, { accept: true });
  }
});

test('invalid logout intent or a missing real confirmation surface cannot partially log out or block an account', async () => {
  const s = scene();
  await unchanged(s, 'logout', {}, { confirm: 'false' });
  await unchanged(s, 'logout', { userId: 'local-casey' }, {});
  await unchanged(s, 'logout', {}, { confirm: false, extra: true });
  s.setSurfaceEnabled(false);
  expect((await unchanged(s, 'logout', {}, {})).error.code).toBe('unavailable');
  expect(s.session.users[0].signedIn).toBe(true); expect(s.session.logoutPending).toBeNull();
});

test('local logout exposes the chosen reopen value and checkbox; configuration is transient through Cancel', async () => {
  const s = scene();
  expect((await s.run('logout')).target.reopenWindows).toBe(true);
  expect(s.session.focusedControl).toBe('logout-cancel');
  expect(s.targets().controls).toContain('logout-reopen-windows');
  await s.run('focus', { controlId: 'logout-reopen-windows' });
  expect(s.session.focusedControl).toBe('logout-reopen-windows');
  expect((await s.run('logout.configure', {}, { reopenWindows: false })).target.reopenWindows).toBe(false);
  expect(s.session.logoutPending.reopenWindows).toBe(false);
  expect((await s.run('logout.respond', {}, { accept: false })).target.reopenWindows).toBe(false);
  expect(s.session.phase).toBe('desktop'); expect(s.session.users[0].signedIn).toBe(true);
  expect((await s.run('logout')).target.reopenWindows).toBe(true);
  await s.run('logout.respond', {}, { accept: false });
  s.setReopenPreference(false);
  expect((await s.run('logout', {}, { reopenWindows: true })).target.reopenWindows).toBe(true);
  const accepted = await s.run('logout.respond', {}, { accept: true });
  expect(accepted.target).toMatchObject({ accepted: true, reopenWindows: true, phase: 'login' });
  expect(s.session.users[0].signedIn).toBe(false); expect(s.session.logoutPending).toBeNull();
});

test('Guest has no reopen checkbox, rejects true intent and cannot configure either choice', async () => {
  const s = scene(); await s.run('login.open'); await s.run('user.select', { userId: 'guest' });
  await s.run('login.submit', {}, { acknowledgeGuest: true });
  for (const confirm of [true, false]) {
    expect((await unchanged(s, 'logout', {}, { confirm, reopenWindows: true })).error.code).toBe('invalid_arguments');
  }
  expect((await s.run('logout', {}, { reopenWindows: false })).target.reopenWindows).toBe(false);
  expect(s.targets().controls).not.toContain('logout-reopen-windows');
  for (const reopenWindows of [true, false]) await unchanged(s, 'logout.configure', {}, { reopenWindows });
  await unchanged(s, 'focus', { controlId: 'logout-reopen-windows' }, {});
  const accepted = await s.run('logout.respond', {}, { accept: true });
  expect(accepted.target.reopenWindows).toBe(false); expect(s.session.users[2].signedIn).toBe(false);
});

test('logout and configure reject closed-input violations and hidden or stale owners atomically', async () => {
  const s = scene();
  for (const reopenWindows of [undefined, null, 'false', 0, []]) {
    await unchanged(s, 'logout', {}, { reopenWindows });
    await unchanged(s, 'logout.configure', {}, { reopenWindows });
  }
  await unchanged(s, 'logout.configure', {}, {});
  await unchanged(s, 'logout.configure', { userId: 'local-alex' }, { reopenWindows: false });
  await unchanged(s, 'logout.configure', {}, { reopenWindows: false, extra: true });
  await unchanged(s, 'logout.configure', {}, { reopenWindows: false });
  await s.run('logout');
  await unchanged(s, 'logout.respond', {}, { accept: true, reopenWindows: false });
  s.disable('logout-reopen-windows');
  await unchanged(s, 'logout.configure', {}, { reopenWindows: false });
  s.setSurfaceEnabled(false);
  await unchanged(s, 'logout.configure', {}, { reopenWindows: false });
  await unchanged(s, 'logout.respond', {}, { accept: true });
  s.setSurfaceEnabled(true); s.session.activeUserId = 'local-casey';
  await unchanged(s, 'logout.configure', {}, { reopenWindows: false });
  await unchanged(s, 'logout.respond', {}, { accept: true });
});

test('unfinished desktop work blocks logout requests and accepted responses without losing the pending choice or focus', async () => {
  const s = scene(); s.setExitAllowed(false);
  await unchanged(s, 'logout', {}, {}); await unchanged(s, 'logout', {}, { confirm: false, reopenWindows: false });
  s.setExitAllowed(true); await s.run('logout');
  await s.run('logout.configure', {}, { reopenWindows: false });
  await s.run('focus', { controlId: 'logout-reopen-windows' });
  s.setExitAllowed(false); await unchanged(s, 'logout.respond', {}, { accept: true });
  s.setExitAllowed(true); s.setCommitAllowed(false);
  await unchanged(s, 'logout.respond', {}, { accept: true });
  expect(s.session.users[0].signedIn).toBe(true); expect(s.session.phase).toBe('desktop');
  s.setCommitAllowed(true);
  expect((await s.run('logout.respond', {}, { accept: true })).target.reopenWindows).toBe(false);
  expect(s.session.phase).toBe('login');
  const bypass = scene(); bypass.setCommitAllowed(false);
  await unchanged(bypass, 'logout', {}, { confirm: false, reopenWindows: false });
});

test('Guest acceptance rechecks unfinished work and keeps its signed-in confirmation intact until exit is safe', async () => {
  const s = scene(); await s.run('login.open'); await s.run('user.select', { userId: 'guest' });
  await s.run('login.submit', {}, { acknowledgeGuest: true });
  await s.run('logout'); s.setExitAllowed(false);
  await unchanged(s, 'logout.respond', {}, { accept: true });
  expect(s.session.users[2].signedIn).toBe(true); expect(s.session.phase).toBe('desktop');
  expect(s.session.activeUserId).toBe('guest');
  await s.run('logout.respond', {}, { accept: false });
  expect(s.session.users[2].signedIn).toBe(true);
  s.setExitAllowed(true); await s.run('logout'); await s.run('logout.respond', {}, { accept: true });
  expect(s.session.users[2].signedIn).toBe(false); expect(s.session.phase).toBe('login');
});

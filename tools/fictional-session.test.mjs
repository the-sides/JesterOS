import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { fictionalSessionDefaults, createFictionalSessionCommands, signOutFictionalSessions } from '../frontend/src/fictional-session.js';

function scene(profileId = 'macos-golden-gate-27.0.1') {
  const profile = getOSProfile(profileId), session = fictionalSessionDefaults(profile);
  let available = true, ready = true, surfaceEnabled = true;
  const commands = createFictionalSessionCommands({ profile, session, available: () => available,
    settle: async () => {}, captureDesktop: () => {}, restoreDesktop: async () => true,
    ensureDesktop: async () => ready, discardDesktop: async () => {},
    getSurfaceView: () => surfaceEnabled ? { controlIds: () => ['password', 'sign-in', 'back', 'logout-cancel', 'logout-confirm', 'user:local-alex', 'user:local-casey', 'user:guest'], focus: () => true } : null,
  });
  return { session, run: (name, target = {}, payload = {}) => commands[`session.${name}`](target, payload),
    setAvailable: value => { available = value; }, setReady: value => { ready = value; },
    setSurfaceEnabled: value => { surfaceEnabled = value; } };
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
  await s.run('logout'); expect(s.session.logoutPending).toEqual({ userId: 'guest', kind: 'guest' }); expect(s.session.users[2].signedIn).toBe(true);
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

test('historical profiles reject fictional session actions without changing state', async () => {
  const legacy = scene('macos-mojave-10.14');
  expect((await unchanged(legacy, 'lock', {}, {})).error.code).toBe('unsupported_profile');
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
  expect(s.session.logoutPending).toEqual({ userId: 'local-casey', kind: 'local' });
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
    expect(result.target).toEqual({ confirmationRequired: false, userId, phase: 'login' });
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

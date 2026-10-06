import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { fictionalSessionDefaults, sessionMenuItems, createFictionalSessionCommands } from '../frontend/src/fictional-session.js';

function scene(profileId = 'macos-golden-gate-27.0.1') {
  const profile = getOSProfile(profileId), session = fictionalSessionDefaults(profile);
  let available = true, ready = true;
  const commands = createFictionalSessionCommands({ profile, session, available: () => available,
    settle: async () => {}, captureDesktop: () => {}, restoreDesktop: async () => true,
    ensureDesktop: async () => ready, discardDesktop: async () => {},
    captureMenuFocus: () => {}, restoreMenuFocus: async () => true,
    getMenuView: () => ({ itemIds: () => sessionMenuItems(profile, session, session.menu?.menuId).filter(item => item.enabled).map(item => item.id), focus: () => true }),
    getSurfaceView: () => ({ controlIds: () => ['password', 'sign-in', 'back'], focus: () => true }),
  });
  return { session, run: (name, target = {}, payload = {}) => commands[`session.${name}`](target, payload),
    setAvailable: value => { available = value; }, setReady: value => { ready = value; } };
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

test('Guest requires explicit ephemeral-data acknowledgement and only confirmed ending discards its session', async () => {
  const s = scene(); await s.run('login.open'); await s.run('user.select', { userId: 'guest' });
  await unchanged(s, 'login.submit', {}, {}); await unchanged(s, 'login.submit', {}, { passcode: 'scene', acknowledgeGuest: true });
  await s.run('login.submit', {}, { acknowledgeGuest: true }); expect(s.session.activeUserId).toBe('guest');
  await s.run('guest.end'); expect(s.session.guestConfirmation).toBe(true); expect(s.session.users[2].signedIn).toBe(true);
  await s.run('guest.respond', {}, { accept: false }); expect(s.session.phase).toBe('desktop'); expect(s.session.users[2].signedIn).toBe(true);
  await s.run('guest.end'); await s.run('guest.respond', {}, { accept: true });
  expect(s.session.phase).toBe('login'); expect(s.session.selectedUserId).toBeNull(); expect(s.session.users[2].signedIn).toBe(false); expect(s.session.users[0].signedIn).toBe(true);
});

test('native menus enforce profile and optional fast-switch boundaries without state writes', async () => {
  const mac = scene(); expect((await unchanged(mac, 'menu.open', { menuId: 'users' }, {})).error.code).toBe('disabled');
  await mac.run('fastUserSwitching.set', {}, { enabled: true }); await mac.run('menu.open', { menuId: 'users' });
  const items = sessionMenuItems(getOSProfile('macos-golden-gate-27.0.1'), mac.session, 'users');
  expect(items.find(item => item.id === 'user:local-alex').checked).toBe(true); expect(items.find(item => item.id === 'user:local-casey').checked).toBe(false);
  await unchanged(mac, 'menu.select', { menuId: 'users', itemId: 'guest-end' }, {});
  await mac.run('menu.select', { menuId: 'users', itemId: 'user:local-casey' }); expect(mac.session.phase).toBe('login'); expect(mac.session.users[1].signedIn).toBe(false);
  const legacy = scene('macos-mojave-10.14');
  expect((await unchanged(legacy, 'lock', {}, {})).error.code).toBe('unsupported_profile');
});

test('malformed requests and stale modal/focus targets reject before canonical mutation', async () => {
  const s = scene(); await unchanged(s, 'lock', { userId: 'local-alex' }, {}); await unchanged(s, 'user.select', { userId: 'missing' }, {});
  await unchanged(s, 'guest.respond', {}, { accept: true });
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

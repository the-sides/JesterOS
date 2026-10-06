import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { fictionalSessionDefaults, createFictionalSessionCommands, signOutFictionalSessions } from '../frontend/src/fictional-session.js';
import { fictionalPowerDefaults, createFictionalPowerCommands } from '../frontend/src/fictional-power.js';

// Real session/power transitions. DOM retention and actual focus are browser smoke,
// not pretend editor/window objects which no domain handler ever reads.
function scene(profile = getOSProfile('macos-golden-gate-27.0.1')) {
  const session = fictionalSessionDefaults(profile), power = fictionalPowerDefaults(profile);
  let available = true, mounted = true, visible = true, connected = true, focusable = true, lockAllowed = true, afterFocus = null;
  const disabled = new Set();
  const phaseControls = () => power.pending ? ['cancel', 'confirm'] : ['saver', 'sleeping'].includes(power.phase)
    ? ['wake'] : power.phase === 'off' ? ['start'] : power.phase === 'booting' ? ['surface'] : [];
  const facade = {
    controlIds: () => mounted && visible && connected ? phaseControls().filter(id => !disabled.has(id)) : [],
    focus: id => { if (!focusable || !facade.controlIds().includes(id)) return false; afterFocus?.(); return true; },
  };
  const sessionCommands = createFictionalSessionCommands({ profile, session, available: () => available,
    settle: async () => {}, captureDesktop: () => {}, restoreDesktop: async () => true,
    ensureDesktop: async () => true, discardDesktop: async () => {}, getSurfaceView: () => null,
  });
  const commands = createFictionalPowerCommands({ profile, power, session, available: () => available,
    settle: async () => {}, getView: () => mounted ? facade : null, captureReturn: () => {}, restoreReturn: async () => {},
    lockSession: () => lockAllowed ? sessionCommands['session.lock']({}, {})
      : { status: 'rejected', error: { code: 'unavailable', message: 'No interactive session.' } },
    signOutForBoot: async () => signOutFictionalSessions(session),
  });
  return { session, power,
    run: (name, target = {}, payload = {}) => commands[`power.${name}`](target, payload),
    sessionRun: (name, target = {}, payload = {}) => sessionCommands[`session.${name}`](target, payload),
    setAvailable: value => { available = value; }, setMounted: value => { mounted = value; },
    setVisible: value => { visible = value; }, setConnected: value => { connected = value; },
    setFocusable: value => { focusable = value; }, setLockAllowed: value => { lockAllowed = value; },
    disable: id => disabled.add(id), afterFocus: callback => { afterFocus = callback; },
  };
}

async function unchanged(s, name, target = {}, payload = {}, code = 'unavailable') {
  const before = structuredClone({ power: s.power, session: s.session });
  const result = await s.run(name, target, payload);
  expect(result.status).toBe('rejected'); expect(result.error.code).toBe(code);
  expect({ power: s.power, session: s.session }).toEqual(before);
}

for (const action of ['screenSaver.start', 'sleep']) {
  test(`${action} locks the user and wake cannot bypass fictional sign-in`, async () => {
    const s = scene(); await s.run(action);
    expect(s.power.phase).toBe(action === 'sleep' ? 'sleeping' : 'saver');
    expect(s.session.phase).toBe('locked'); expect(s.session.users[0].locked).toBe(true);
    if (action === 'screenSaver.start') {
      await s.run('advance', {}, { seconds: 3 }); await s.run('advance', {}, { seconds: 9 });
      expect(s.power.elapsedSeconds).toBe(12);
    }
    await s.run('wake'); expect(s.power.phase).toBe('awake'); expect(s.session.phase).toBe('locked');
    expect(s.session.users[0].signedIn).toBe(true); expect(s.session.users[0].locked).toBe(true);
    await s.sessionRun('login.submit', {}, { passcode: 'wrong' }); expect(s.session.phase).toBe('locked');
    await s.sessionRun('login.submit', {}, { passcode: 'scene' }); expect(s.session.phase).toBe('desktop');
  });
}

test('locked and signed-out login presentations survive saver/sleep wake without authentication', async () => {
  const s = scene(); await s.sessionRun('lock');
  for (const action of ['screenSaver.start', 'sleep']) {
    await s.run(action); await s.run('wake'); expect(s.session.phase).toBe('locked');
  }
  signOutFictionalSessions(s.session); const login = structuredClone(s.session);
  for (const action of ['sleep', 'screenSaver.start']) {
    await s.run(action); await s.run('wake'); expect(s.session).toEqual(login);
  }
});

for (const action of ['restart', 'shutdown']) {
  test(`${action} cancellation preserves all signed-in users and acceptance returns unauthenticated startup`, async () => {
    const s = scene(); await s.sessionRun('fastUserSwitching.set', {}, { enabled: true });
    await s.sessionRun('login.open'); await s.sessionRun('user.select', { userId: 'local-casey' });
    await s.sessionRun('login.submit', {}, { passcode: 'scene' });
    await s.sessionRun('login.open'); await s.sessionRun('user.select', { userId: 'guest' });
    await s.sessionRun('login.submit', {}, { acknowledgeGuest: true });
    const signedIn = structuredClone(s.session);
    await s.run(action); await unchanged(s, 'respond', {}, { accept: 'true' }, 'invalid_arguments');
    await unchanged(s, 'respond', {}, { accept: true, reopenWindows: true }, 'invalid_arguments');
    await s.run('respond', {}, { accept: false }); expect(s.session).toEqual(signedIn); expect(s.power.pending).toBeNull();
    await unchanged(s, 'respond', {}, { accept: true });
    await s.run(action); await s.run('respond', {}, { accept: true });
    expect(s.power.phase).toBe(action === 'restart' ? 'booting' : 'off');
    expect(s.session.phase).toBe('login'); expect(s.session.loginView).toBe('users');
    expect(s.session.selectedUserId).toBeNull(); expect(s.session.users.every(user => !user.signedIn && !user.locked)).toBe(true);
    expect(s.session.fastUserSwitching).toBe(true);
    await unchanged(s, 'wake');
    if (action === 'shutdown') { await unchanged(s, 'advance', {}, { seconds: 1 }); await s.run('start'); }
    await s.run('advance', {}, { seconds: 4 }); expect(s.power.phase).toBe('booting'); expect(s.power.startupProgress).toBe(0.8);
    await s.run('advance', {}, { seconds: 300 }); expect(s.power.phase).toBe('awake');
    expect(s.power.elapsedSeconds).toBe(5); expect(s.power.startupProgress).toBe(1);
    expect(s.session.users.every(user => !user.signedIn)).toBe(true);
    await unchanged(s, 'advance', {}, { seconds: 1 }); await unchanged(s, 'start');
    await s.sessionRun('user.select', { userId: 'local-casey' }); await s.sessionRun('login.submit', {}, { passcode: 'scene' });
    expect(s.session.activeUserId).toBe('local-casey'); expect(s.session.users[1].signedIn).toBe(true);
    expect(s.session.users[0].signedIn).toBe(false); expect(s.session.users[2].signedIn).toBe(false);
  });
}

test('restart/shutdown from lock or login do not authenticate, and subsequent boot resets progress', async () => {
  for (const entry of ['lock', 'login.open']) {
    const s = scene(); await s.sessionRun(entry); const before = structuredClone(s.session);
    await s.run('restart'); await s.run('respond', {}, { accept: false }); expect(s.session).toEqual(before);
    await s.run('shutdown'); await s.run('respond', {}, { accept: true }); await s.run('start');
    await s.run('advance', {}, { seconds: 5 }); expect(s.session.users.every(user => !user.signedIn)).toBe(true);
    await s.run('restart'); await s.run('respond', {}, { accept: true });
    expect(s.power.phase).toBe('booting'); expect(s.power.elapsedSeconds).toBe(0); expect(s.power.startupProgress).toBe(0);
  }
});

test('off, booting, sleep and pending confirmations reject incompatible transitions atomically', async () => {
  const s = scene();
  for (const [name, payload] of [['wake', {}], ['start', {}], ['respond', { accept: true }], ['advance', { seconds: 1 }]]) await unchanged(s, name, {}, payload);
  await s.run('restart');
  for (const name of ['restart', 'shutdown', 'sleep', 'screenSaver.start', 'wake', 'start']) await unchanged(s, name);
  await unchanged(s, 'advance', {}, { seconds: 1 }); await s.run('respond', {}, { accept: false }); await s.run('sleep');
  for (const name of ['restart', 'shutdown', 'sleep', 'screenSaver.start', 'start']) await unchanged(s, name);
  await s.run('wake'); await s.run('shutdown'); await s.run('respond', {}, { accept: true });
  for (const name of ['wake', 'restart', 'shutdown', 'sleep', 'screenSaver.start']) await unchanged(s, name);
  await s.run('start');
  for (const name of ['wake', 'restart', 'shutdown', 'sleep', 'screenSaver.start', 'start']) await unchanged(s, name);
});

test('Guest-ending and invalid unsigned desktops cannot enter a conflicting power presentation', async () => {
  const s = scene(); await s.sessionRun('login.open'); await s.sessionRun('user.select', { userId: 'guest' });
  await s.sessionRun('login.submit', {}, { acknowledgeGuest: true }); await s.sessionRun('guest.end');
  for (const name of ['sleep', 'screenSaver.start', 'restart', 'shutdown']) await unchanged(s, name);
  await s.sessionRun('guest.respond', {}, { accept: false }); s.session.users[2].signedIn = false;
  for (const name of ['sleep', 'screenSaver.start', 'restart', 'shutdown']) await unchanged(s, name);
});

test('closed arguments reject coercions, fractional/out-of-range ticks and undeclared controls before writes', async () => {
  const s = scene();
  for (const name of ['screenSaver.start', 'sleep', 'wake', 'restart', 'shutdown', 'start']) {
    await unchanged(s, name, { userId: 'local-alex' }, {}, 'invalid_arguments');
    await unchanged(s, name, {}, { force: true }, 'invalid_arguments');
  }
  for (const accept of [undefined, null, 0, 1, 'false', []]) await unchanged(s, 'respond', {}, accept === undefined ? {} : { accept }, 'invalid_arguments');
  await s.run('screenSaver.start');
  for (const seconds of [0, -1, 301, 1.5, '1', null, Infinity, NaN]) await unchanged(s, 'advance', {}, { seconds }, 'invalid_arguments');
  await unchanged(s, 'advance', { controlId: 'wake' }, { seconds: 1 }, 'invalid_arguments');
  await unchanged(s, 'advance', {}, { seconds: 1, clock: true }, 'invalid_arguments');
  for (const controlId of ['', null, 0, []]) await unchanged(s, 'focus', { controlId }, {}, 'invalid_arguments');
  await unchanged(s, 'focus', { controlId: 'wake', extra: true }, {}, 'invalid_arguments');
  await unchanged(s, 'focus', { controlId: 'wake' }, { enabled: true }, 'invalid_arguments');
});

test('missing/disabled/disconnected power controls cannot mutate canonical focus', async () => {
  const s = scene(); await unchanged(s, 'focus', { controlId: 'original-editor' }); await s.run('restart');
  for (const id of ['wake', 'start', 'password', 'missing']) await unchanged(s, 'focus', { controlId: id });
  s.disable('cancel'); await unchanged(s, 'focus', { controlId: 'cancel' });
  for (const setter of [s.setFocusable, s.setVisible, s.setConnected, s.setMounted]) {
    setter(false); await unchanged(s, 'focus', { controlId: 'confirm' }); setter(true);
  }
  s.afterFocus(() => s.setAvailable(false)); await unchanged(s, 'focus', { controlId: 'confirm' });
});

test('unavailable scenes and rejected locking cannot partially enter power or accept confirmation', async () => {
  const s = scene(); s.setLockAllowed(false); await unchanged(s, 'sleep'); await unchanged(s, 'screenSaver.start');
  s.setLockAllowed(true); s.setAvailable(false);
  for (const name of ['sleep', 'screenSaver.start', 'restart', 'shutdown']) await unchanged(s, name);
  s.setAvailable(true); await s.run('restart'); s.setAvailable(false);
  await unchanged(s, 'respond', {}, { accept: true }); await unchanged(s, 'respond', {}, { accept: false });
});

test('historical/uninstalled/missing-capability profiles reject every power path without writes', async () => {
  const current = getOSProfile('macos-golden-gate-27.0.1');
  for (const profile of [getOSProfile('macos-mojave-10.14'), getOSProfile('macos-sonoma-14.0'), getOSProfile('macos-high-sierra-10.13'),
    getOSProfile('windows11-23h2-22631.2428'), { ...current, id: 'macos-future' },
    { ...current, capabilities: current.capabilities.filter(value => value !== 'session.power') }]) {
    const s = scene(profile);
    for (const [name, target, payload] of [['screenSaver.start', {}, {}], ['sleep', {}, {}], ['wake', {}, {}], ['restart', {}, {}],
      ['shutdown', {}, {}], ['respond', {}, { accept: true }], ['start', {}, {}], ['advance', {}, { seconds: 1 }], ['focus', { controlId: 'surface' }, {}]]) {
      await unchanged(s, name, target, payload, 'unsupported_profile');
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationCommands } from '../frontend/src/application-commands.js';

function fixture() {
  let applications = {};
  const windows = [];
  let admit = true;
  const handlers = createApplicationCommands(() => applications, {
    available: () => true,
    hasWorkspace: () => true,
    isQuitting: () => false,
    hasWindow: appId => windows.some(window => window.appId === appId),
    canCreateWindow: () => true,
    open(appId, _title, fresh) {
      const existing = windows.find(window => window.appId === appId);
      if (existing && !fresh) return existing.id;
      if (!admit) return null;
      const original = { id: `window-${windows.length + 1}`, appId };
      windows.push(original);
      return original.id;
    },
    focusKeyboard: async () => true,
  });
  return {
    handlers, windows,
    install(appId) { applications = { ...applications, [appId]: { id: appId, multipleWindows: true } }; },
    uninstall(appId) { const { [appId]: _removed, ...remaining } = applications; applications = remaining; },
    refuse() { admit = false; },
  };
}

test('installed applications become launchable without recreating commands and removed apps cannot create new windows', async () => {
  const f = fixture();
  const target = { appId: 'local-radix-lab' };
  assert.equal((await f.handlers['app.open'](target, {})).error.code, 'not_found');
  f.install(target.appId);
  const opened = await f.handlers['app.open'](target, {});
  assert.equal(opened.status, 'applied');
  assert.equal(f.windows.find(window => window.id === opened.target.windowId)?.appId, target.appId);
  const original = f.windows[0];
  assert.equal((await f.handlers['app.open'](target, {})).target.windowId, original.id);
  f.uninstall(target.appId);
  assert.equal((await f.handlers['window.create'](target, {})).error.code, 'not_found');
  assert.deepEqual(f.windows, [original]);
});

test('refused admission and a retired action owner reject instead of reporting a nonexistent applied window', async () => {
  const f = fixture();
  const target = { appId: 'calculator' };
  f.install(target.appId);
  f.refuse();
  const refused = await f.handlers['app.open'](target, {});
  assert.equal(refused.status, 'rejected');
  assert.equal(refused.error.code, 'unavailable');
  assert.deepEqual(f.windows, []);
  const retired = await f.handlers['app.open'](target, {}, { guard: () => false });
  assert.equal(retired.error.code, 'stale_target');
  assert.deepEqual(f.windows, []);
});

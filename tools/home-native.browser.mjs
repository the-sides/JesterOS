// Execute against an actually mounted HomeApp and its actual canonical Root bridges.
// No DOM, service, controller or result mocks. Parent runs after global integration.
export async function runHomeNativeBrowserRegression({ root, state, windowId, execute, tick }) {
  const passed = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const node = id => [...root.querySelectorAll('[data-home-control]')].find(n => n.dataset.homeControl === id);
  const session = () => state.windows.find(w => w.windowId === windowId);
  const run = async (name, payload = {}) => { const result = await execute(`home.${name}`, { windowId }, payload); assert(result?.status === 'applied', result?.error?.message ?? `${name} was not applied`); await tick(); return result; };
  const until = async predicate => { for (let frame = 0; frame < 90; frame++) { await tick(); if (predicate()) return; await new Promise(resolve => requestAnimationFrame(resolve)); } throw new Error('Actual Home UI did not settle to its canonical operation.'); };
  const change = (element, value) => { assert(element, 'Expected actual Home control is absent'); if (element.type === 'checkbox') element.checked = value; else element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); };
  const check = async (name, operation) => { await operation(); passed.push(name); };
  assert(root?.isConnected, 'HomeApp must actually be mounted.');
  await run('local.user', { userId: 'owner' });
  await run('navigate', { section: 'home' });
  const light = state.accessories.find(a => a.id === 'reading-light');
  await check('actual detail brightness/color edits alter retained device and rendered tile', async () => {
    await run('accessory.open', { accessoryId: light.id });
    change(node('device:on'), true); await until(() => light.values.on);
    change(node('device:brightness'), 37); await until(() => light.values.brightness === 37);
    change(node('device:color'), 'blue'); await until(() => light.values.color === 'blue');
    node('sheet:done').click(); await until(() => session().sheet === 'none');
    assert(node(`accessory:${light.id}`).textContent.includes('37% · blue'), 'The actual tile does not show the chosen light state.');
  });
  await check('No Response is rendered and controls cannot mutate unavailable accessory', async () => {
    await run('local.device', { accessoryId: light.id, available: false });
    assert(node(`accessory:${light.id}`).textContent.includes('No Response'), 'Tile does not disclose unavailable device.');
    node(`accessory:details:${light.id}`).click(); await until(() => session().sheet === 'accessory');
    assert(node('device:brightness').disabled, 'Unavailable brightness slider is still enabled.');
    assert(root.querySelector('[role="dialog"]').textContent.includes('No Response'), 'Details do not disclose unavailable device.');
    await run('local.device', { accessoryId: light.id, available: true }); await run('sheet', { sheet: 'none' });
  });
  await check('real scene editing chooses actual accessory, saves and runs its visible state', async () => {
    await run('scene.edit', { sceneId: null }); change(node('scene:name'), 'Browser Evening'); await until(() => session().sceneDraft.name === 'Browser Evening');
    change(node(`scene:include:${light.id}`), true); await until(() => session().sceneDraft.actions.length === 1);
    change(node(`scene:brightness:${light.id}`), 61); await until(() => session().sceneDraft.actions[0].values.brightness === 61);
    node('scene:save').click(); await until(() => state.scenes.some(s => s.name === 'Browser Evening') && session().sheet === 'none');
    const scene = state.scenes.find(s => s.name === 'Browser Evening');
    node(`scene:${scene.id}`).click(); await until(() => light.values.brightness === 61);
    assert(node(`accessory:${light.id}`).textContent.includes('61%'), 'Saved scene did not change the actual light tile.');
  });
  await check('resident permission hides camera illustration and denies canonical editing', async () => {
    await run('local.user', { userId: 'resident' }); await run('accessory.open', { accessoryId: 'porch-camera' });
    assert(!root.querySelector('.home-camera-detail svg'), 'Camera preview leaked to resident without camera permission.');
    const denied = await execute('home.scene.edit', { windowId }, { sceneId: null }); assert(denied?.error?.code === 'permission_denied', 'Read-only resident edited actual scenes.');
    await run('local.user', { userId: 'owner' });
  });
  await check('local invitations visibly remain pending until explicit acceptance', async () => {
    await run('sheet', { sheet: 'settings' });
    const token = state.nextId, address = `browser-${token}@example.test`;
    const created = await run('invite', { name: 'Browser Resident', email: address, edit: false, remote: false, cameras: 'none' });
    assert(root.querySelector('[role="dialog"]').textContent.includes('Invitation Pending (local only)'), 'Invitation UI falsely claims cloud acceptance.');
    node(`invite:accept:${created.invitationId}`).click(); await until(() => state.users.some(u => u.id === created.invitationId));
    assert(!node(`invite:accept:${created.invitationId}`), 'Accepted invitation remains pending in actual UI.');
    assert(root.querySelector('[role="dialog"]').textContent.includes(address), 'Accepted local resident is absent from actual people list.');
  });
  await run('sheet', { sheet: 'none' });
  return { passed: passed.length, checks: passed };
}

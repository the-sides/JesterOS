import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallsState, callsWindow } from '../frontend/src/calls-state.js';
import { createCallsCommands } from '../frontend/src/calls-commands.js';
function fixture(profileId = 'macos-sonoma-14.0') {
  const state = createCallsState(profileId), account = { name: 'Alex Morgan', initials: 'AM', address: 'alex@example.test', signedIn: true, enabled: true, readReceipts: true, status: 'Available', photo: null };
  const blockedAddresses = [];
  const window = { id: 'native-calls', appId: profileId.startsWith('windows11') ? 'teams' : 'facetime', ...(profileId.startsWith('windows11') ? { utilityKind: 'teams-call' } : {}) };
  const view = { available: () => true, describe: () => ({ controlIds: ['search'], scrolls: { recents: { top: 0, left: 0 } } }) };
  const windows = new Map([[window.id, window]]), views = new Map([[window.id, view]]);
  let time = 1000;
  const ctx = { profile: { id: profileId }, getState: () => state, getWindow: id => windows.get(id), getWindows: () => [...windows.values()], getView: id => views.get(id), getAccount: () => account, getBlockedAddresses: () => blockedAddresses, available: () => true, alive: () => true, tick: async () => {}, getSceneTime: () => time, canCommit: () => true };
  const controller = createCallsCommands(ctx); assert.equal(controller.windowOpened(window), true);
  return { state, account, window, view, windows, views, ctx, controller, setTime: value => { time = value; }, run: (name, payload = {}) => controller.handlers[name]({ windowId: window.id }, payload) };
}
test('missing canonical contact bridge rejects rather than inventing a recipient or call', async () => {
  const f = fixture(); const before = structuredClone(f.state);
  assert.equal((await f.run('calls.start', { contactId: 'real-contact', kind: 'video' })).status, 'rejected'); assert.deepEqual(f.state, before);
});
test('Contacts resolver controls identity, not caller supplied replacement name/address', async () => {
  const f = fixture(); f.ctx.resolveContacts = async (_, ownership) => { assert.equal(ownership.guard(), true); return { status: 'applied', contacts: [{ id: 'real-contact', name: 'Actual Source Card', email: 'source@example.test', phone: '' }], isCurrent: ownership.guard }; };
  const result = await f.run('calls.start', { contactId: 'real-contact', name: 'Wrong', address: 'source@example.test', kind: 'video' });
  assert.equal(result.status, 'applied'); assert.equal(result.callId, f.state.calls[0].id); assert.equal(result.windowId, f.window.id);
  assert.deepEqual(f.state.calls[0].participants.map(row => [row.contactId, row.name, row.address]), [['real-contact', 'Actual Source Card', 'source@example.test']]);
  assert.equal(callsWindow(f.state, f.window.id).callId, result.callId);
});
test('a contact call preserves the explicitly selected canonical phone instead of replacing it with email', async () => {
  const f = fixture('windows11-23h2-22631.2428');
  f.ctx.resolveContacts = async (_, ownership) => ({ status: 'applied',
    contacts: [{ id: 'source', name: 'Actual Source', email: 'source@example.test', phone: '+1 555 010 2048' }], isCurrent: ownership.guard });
  const result = await f.run('calls.start', { contactId: 'source', address: '+1 555 010 2048', kind: 'audio' });
  assert.equal(result.status, 'applied');
  assert.equal(f.state.calls[0].participants[0].address, '+1 555 010 2048');
});
test('an address removed from the original contact cannot redirect a contact-originated call', async () => {
  const f = fixture(), before = structuredClone(f.state);
  f.ctx.resolveContacts = async (_, ownership) => ({ status: 'applied',
    contacts: [{ id: 'source', name: 'Actual Source', email: 'source@example.test', phone: '' }], isCurrent: ownership.guard });
  const result = await f.run('calls.start', { contactId: 'source', address: 'removed@example.test', kind: 'audio' });
  assert.equal(result.status, 'rejected');
  assert.deepEqual(f.state, before);
});
test('replacement window/view/account during awaiting Contacts cannot borrow original identity', async () => {
  for (const replace of ['window', 'view', 'account']) {
    const f = fixture(), before = structuredClone(f.state);
    f.ctx.resolveContacts = async () => { if (replace === 'window') f.windows.set(f.window.id, { ...f.window }); if (replace === 'view') f.views.set(f.window.id, { ...f.view }); if (replace === 'account') f.ctx.getAccount = () => ({ ...f.account }); return { status: 'applied', contacts: [{ id: 'original', name: 'Original', email: 'original@example.test', phone: '' }] }; };
    assert.equal((await f.run('calls.start', { contactId: 'original', kind: 'audio' })).status, 'rejected'); assert.deepEqual(f.state, before);
  }
});
test('native Teams SDK messaging window cannot own a call utility session', async () => {
  const f = fixture('windows11-23h2-22631.2428'); delete f.window.utilityKind;
  assert.equal((await f.run('calls.start', { name: 'Local', address: 'local@example.test', kind: 'audio' })).status, 'rejected'); assert.equal(f.state.calls.length, 0);
});
test('close synchronously ends canonical call before shell retirement and preserves recent', async () => {
  const f = fixture(); const result = await f.run('calls.start', { name: 'Local', address: 'local@example.test', kind: 'audio' }); assert.equal(result.status, 'applied');
  f.setTime(6000); assert.equal(f.controller.advance().status, 'applied'); assert.equal(f.state.calls[0].status, 'in-call');
  f.setTime(10000); assert.equal(f.controller.windowClosed(f.window), true); assert.equal(f.state.calls[0].status, 'ended'); assert.equal(f.state.calls[0].endedAt, 10000); assert.equal(f.state.windows.length, 0); assert.equal(f.state.calls.length, 1);
});
test('missing account setter rejects and signed out shared identity cannot initiate', async () => {
  const f = fixture(); assert.equal((await f.run('calls.account.set', { signedIn: false, status: 'Offline' })).status, 'rejected'); assert.equal(f.account.signedIn, true);
  f.account.signedIn = false; assert.equal((await f.run('calls.start', { name: 'Local', address: 'local@example.test', kind: 'audio' })).status, 'rejected'); assert.equal(f.state.calls.length, 0);
});
test('original account setter mutates canonical shared authority without creating an account graph', async () => {
  const f = fixture(); f.ctx.setAccount = async (patch, ownership) => { if (!ownership.guard()) return { status: 'rejected' }; Object.assign(f.account, patch); return { status: 'applied', accountAddress: f.account.address }; };
  const result = await f.run('calls.account.set', { signedIn: false, status: 'Offline' }); assert.equal(result.status, 'applied'); assert.equal(f.account.status, 'Offline'); assert.equal(Object.hasOwn(f.state, 'account'), false);
});
test('missing mounted destination prevents Contacts startCall from committing metadata-only success', async () => {
  const f = fixture(); f.ctx.createWindow = async (_, options) => { assert.equal(options.isCurrent(), true); const window = { id: 'new-native', appId: 'facetime' }; f.windows.set(window.id, window); f.controller.windowOpened(window); return window.id; };
  const result = await f.controller.startCall({ name: 'Local', address: 'local@example.test', kind: 'video' }, { windowId: 'contacts-origin', guard: () => true });
  assert.equal(result.status, 'rejected'); assert.equal(f.state.calls.length, 0);
});
test('Contacts startCall returns real mounted window and canonical call IDs only after guarded atomic insertion', async () => {
  const f = fixture(); f.ctx.createWindow = async (_, options) => { assert.equal(options.isCurrent(), true); const window = { id: 'new-native', appId: 'facetime' }; f.windows.set(window.id, window); f.views.set(window.id, { ...f.view }); assert.equal(f.controller.windowOpened(window), true); return window.id; };
  const result = await f.controller.startCall({ name: 'Local', address: 'local@example.test', kind: 'video' }, { windowId: 'contacts-origin', guard: () => true });
  assert.equal(result.status, 'applied'); assert.equal(result.windowId, 'new-native'); assert.equal(result.callId, f.state.calls[0].id); assert.equal(callsWindow(f.state, result.windowId).callId, result.callId); assert.equal(result.presentationAvailable, true);
});
test('presentation retirement after actual mutation preserves acknowledged canonical call identity', async () => {
  const f = fixture(); f.ctx.tick = async () => { f.views.delete(f.window.id); };
  const result = await f.run('calls.start', { name: 'Local', address: 'local@example.test', kind: 'audio' });
  assert.equal(result.status, 'applied'); assert.equal(result.callId, f.state.calls[0].id); assert.equal(result.presentationAvailable, false);
});
test('canonical contact revision lease fails if source changes after resolver acknowledgement', async () => {
  const f = fixture(), source = { id: 'original-contact', revision: 1 }, before = structuredClone(f.state);
  f.ctx.resolveContacts = async (_, ownership) => {
    const revision = source.revision;
    queueMicrotask(() => { source.revision++; });
    return { status: 'applied', contacts: [{ id: source.id, name: 'Original Source', email: 'original@example.test', phone: '' }], isCurrent: () => ownership.guard() && source.revision === revision };
  };
  const result = await f.run('calls.start', { contactId: source.id, kind: 'video' });
  assert.equal(result.status, 'rejected'); assert.deepEqual(f.state, before);
});

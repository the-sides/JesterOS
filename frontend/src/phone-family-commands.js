import { defineCommand, object, empty, choice, flag } from './command-schema.js';
import { canonicalStringUnits, copyCanonicalData, applyCanonicalData } from './canonical-data.js';
import { callsSchemaValid, callsCapabilities } from './calls-state.js';
import { PHONE_PROFILES, phoneId, phoneWindowSchema, phoneSession, createPhoneSession, validatePhoneState, phoneCards, phoneEndpoint, virtualPhoneDevice } from './phone-family-state.js';
const text = (maxLength = 4096, minLength = 0) => ({ type: 'string', maxLength, minLength });
const targetSchema = object({ windowId: phoneId });
const specs = {
 'tab.set': object({ tab: phoneWindowSchema.properties.tab }), search: object({ query: text() }), 'digits.set': object({ digits: { ...text(128), pattern: '^[+0-9*#() .-]*$' } }),
 'contact.select': object({ contactId: phoneId, endpointIndex: { type: 'integer', minimum: 0, maximum: 31 } }), 'recent.select': object({ callId: phoneId }), 'favorite.toggle': empty,
 dial: empty, end: empty, mute: object({ muted: flag }), block: empty, unblock: object({ address: text(320, 1) }),
 'preferences.set': object({ values: object({ notificationsEnabled: flag, defaultKind: choice('audio', 'video'), ringtone: choice('Opening', 'Reflection'), hideSelfView: flag }) }),
 'account.open': empty,
 'sheet.open': object({ sheet: choice('none', 'help', 'auth') }), 'menu.open': object({ menuId: choice('app', 'file', 'view', 'window', 'help') }), 'menu.close': empty,
 'native.focus': object({ controlId: text(256, 1) }), 'native.selection': object({ controlId: text(256, 1), start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 } }),
 'native.scroll': object({ areaId: choice('content', 'setup'), top: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, left: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } }),
 'window.new': empty, 'window.close': empty, 'device.pair': empty, 'device.connect': empty, authenticate: object({ code: { ...text(6, 6), pattern: '^[0-9]{6}$' } }), lock: empty,
 'conversation.select': object({ conversationId: phoneId }), 'message.set': object({ body: text(65536) }), 'message.send': empty, message: empty,
 'photo.select': object({ photoId: phoneId }), 'capture.copy': empty,
 'photo.playback': object({ action: choice('play', 'pause', 'seek'), position: { type: 'number', minimum: 0, maximum: 3600 } }, ['action']),
};
const catalog = prefix => Object.fromEntries(Object.entries(specs).map(([suffix, schema]) => { const name = `${prefix}.${suffix}`; return defineCommand(PHONE_PROFILES, name, `${prefix}.local`, targetSchema, schema, ['Original available native scene window/view and canonical shared graph identities.', 'Authored local devices and shared Calls/Messages only; no transport, host permission or duplicated account.'], [`Perform ${suffix} against the real scene model and mounted native actor.`], [prefix], [], targetSchema); }));
export const phoneCatalog = catalog('phone'), mirroringCatalog = catalog('mirroring');
const reject = (code, message) => ({ status: 'rejected', code, message, error: { code, message } });
export function createPhoneCommands(ctx) { return createController(ctx, 'phone', 'phone'); }
export function createMirroringCommands(ctx) { return createController(ctx, 'mirroring', 'iphonemirroring'); }
function createController(ctx, prefix, appId) {
 const state = ctx.getState(); let retired = false;
 const alive = () => !retired && ctx.getState() === state && validatePhoneState(state, ctx.profile).ok && (typeof ctx.alive !== 'function' || ctx.alive() === true);
 const shared = name => ctx.getShared?.(name);
 const stale = () => reject('stale_target', 'The original native device window, shared graph or account changed.');
 function owner(windowId) {
  const window = ctx.getWindow(windowId), session = phoneSession(state, windowId), view = ctx.getView(windowId);
  if (!alive() || !window || window.appId !== appId || !session || !view || ctx.available(window) !== true || view.available() !== true) return null;
  const sources = Object.fromEntries(['contacts', 'calls', 'messages', 'photos', 'bluetooth'].map(name => [name, shared(name)]));
  if (Object.values(sources).some(source => !source)) return null;
  const account = sources.messages.account, sessionFingerprint = JSON.stringify(session), accountFingerprint = JSON.stringify(account);
  const collections = [[sources.contacts, 'contacts'], [sources.contacts, 'accounts'], [sources.calls, 'calls'], [sources.calls, 'windows'], [sources.messages, 'conversations'], [sources.messages, 'blockedAddresses'], [sources.photos, 'items'], [sources.bluetooth, 'devices']].map(([source, key]) => [source, key, source[key]]);
  const device = virtualPhoneDevice(sources.bluetooth), deviceFingerprint = JSON.stringify(device), powered = sources.bluetooth.powered;
  const guard = () => alive() && ctx.getWindow(windowId) === window && phoneSession(state, windowId) === session && JSON.stringify(session) === sessionFingerprint && ctx.getView(windowId) === view && ctx.available(window) === true && view.available() === true && Object.entries(sources).every(([name, source]) => shared(name) === source) && collections.every(([source, key, original]) => source[key] === original) && sources.messages.account === account && JSON.stringify(account) === accountFingerprint && (appId !== 'iphonemirroring' || virtualPhoneDevice(sources.bluetooth) === device && JSON.stringify(device) === deviceFingerprint && sources.bluetooth.powered === powered);
  return { window, session, view, sources, account, guard, windowId };
 }
 function mutate(lease, change) {
  if (!lease.guard()) return stale(); const snapshot = JSON.stringify(state), next = copyCanonicalData(state), session = phoneSession(next, lease.windowId);
  const result = change(session); if (result?.status === 'rejected') return result;
  if (!validatePhoneState(next, ctx.profile).ok) return reject('invalid_arguments', 'The device UI candidate is invalid.');
  const delta = canonicalStringUnits(next) - canonicalStringUnits(state);
  if (typeof ctx.canCommit !== 'function' || ctx.canCommit(delta) !== true) return reject('limit_exceeded', 'The complete scene cannot retain this UI change.');
  if (!lease.guard() || JSON.stringify(state) !== snapshot) return stale(); applyCanonicalData(state, next); return { status: 'applied', target: { windowId: lease.windowId }, ...(result ?? {}) };
 }
 function authorized(lease) { const device = virtualPhoneDevice(lease.sources.bluetooth); return lease.session.authenticated && lease.account.signedIn && lease.sources.bluetooth.powered && device?.available && device.paired && device.connected; }
 function endpointLease(lease) {
  const endpoint = phoneEndpoint(lease.sources.contacts, lease.session); if (!endpoint) return null;
  const revision = endpoint.card.revision, literal = endpoint.endpoint.value, originalPhones = endpoint.card.phones, account = lease.sources.contacts.accounts.find(row => row.id === endpoint.card.accountId), originalGuard = lease.guard;
  return { ...endpoint, guard: () => originalGuard() && lease.sources.contacts.contacts.includes(endpoint.card) && endpoint.card.revision === revision && endpoint.card.phones === originalPhones && originalPhones[lease.session.endpointIndex] === endpoint.endpoint && endpoint.endpoint.value === literal && account?.enabled === true && lease.sources.contacts.accounts.includes(account) };
 }
 async function nativeCallWindow(lease, callId = null) {
  const capability = callsCapabilities(ctx.profile), existing = lease.sources.calls.windows.find(row => row.callId === callId && ctx.getWindow(row.windowId)?.appId === capability.appId);
  if (existing) {
   const originalWindow = ctx.getWindow(existing.windowId);
   if (!lease.guard() || typeof ctx.focusWindow !== 'function') return null;
   const focused = await ctx.focusWindow(existing.windowId);
   if (focused === false || !lease.guard() || ctx.getWindow(existing.windowId) !== originalWindow || !lease.sources.calls.windows.includes(existing) || existing.callId !== callId) return null;
   await ctx.tick(); return lease.guard() && ctx.getWindow(existing.windowId) === originalWindow && lease.sources.calls.windows.includes(existing) && existing.callId === callId ? existing.windowId : null;
  }
  if (!lease.guard() || typeof ctx.createWindow !== 'function') return null;
  const result = await ctx.createWindow(capability.appId, { utilityKind: capability.utilityKind, callId, isCurrent: lease.guard, ownership: { windowId: lease.windowId, guard: lease.guard } });
  if (!lease.guard()) return null; await ctx.tick(); if (!lease.guard()) return null;
  const id = typeof result === 'string' ? result : result?.windowId; return lease.sources.calls.windows.some(row => row.windowId === id) ? id : null;
 }
 async function forwardCall(lease, suffix, payload, callId = null) {
  const id = await nativeCallWindow(lease, callId); if (!id || !lease.guard()) return stale();
  if (callId && !lease.sources.calls.windows.some(row => row.windowId === id && row.callId === callId)) return stale();
  if (typeof ctx.forwardCall !== 'function') return reject('unavailable', 'The actual Root original Calls session forwarding broker is unavailable.');
  return ctx.forwardCall(`calls.${suffix}`, { windowId: id, callId }, payload, { windowId: lease.windowId, guard: lease.guard });
 }
 const handlers = Object.fromEntries(Object.entries(specs).map(([suffix, schema]) => [`${prefix}.${suffix}`, async (target, payload = {}) => {
  if (!callsSchemaValid(target, targetSchema) || !callsSchemaValid(payload, schema)) return reject('invalid_arguments', 'Use the closed device command target/payload.');
  const lease = owner(target.windowId); if (!lease) return stale();
  if (appId === 'iphonemirroring' && !['authenticate', 'device.pair', 'device.connect', 'lock', 'account.open', 'sheet.open', 'menu.open', 'menu.close', 'window.new', 'window.close', 'native.focus', 'native.selection', 'native.scroll'].includes(suffix) && !authorized(lease)) return reject('device_locked', 'Pair and connect the original Studio iPhone, sign in to the shared communications account, then authorize this local session.');
  if (suffix === 'native.focus' || suffix === 'native.selection') { const ok = suffix === 'native.focus' ? await lease.view.focus(payload.controlId, lease.guard) : await lease.view.setSelection(payload.controlId, payload, lease.guard); return ok ? { status: 'applied', target } : stale(); }
  if (suffix === 'native.scroll') { const offsets = await lease.view.scroll?.(payload.areaId, payload, lease.guard); return offsets && lease.guard() ? { status: 'applied', target, offsets } : stale(); }
  if (suffix === 'account.open') return forwardCall(lease, 'sheet.open', { sheet: 'account' });
  if (suffix === 'photo.playback') {
   if (payload.action === 'seek' && typeof payload.position !== 'number' || payload.action !== 'seek' && Object.hasOwn(payload, 'position')) return reject('invalid_arguments', 'Only Seek takes a bounded media position.');
   const photo = lease.sources.photos.items.find(row => row.id === lease.session.photoId && row.inLibrary && !row.hidden && !row.deletedAt && row.mime.startsWith('video/'));
   if (!photo || typeof lease.view.photoPlayback !== 'function') return reject('unavailable', 'Select an actual shared video with an available native media actor.');
   const revision = photo.revision, content = photo.content, guard = () => lease.guard() && lease.sources.photos.items.includes(photo) && photo.revision === revision && photo.content === content;
   const observed = await lease.view.photoPlayback(payload, guard); return observed && guard() ? { status: 'applied', target, playback: observed } : stale();
  }
  if (suffix === 'window.close') return ctx.closeWindow(target.windowId, { windowId: target.windowId, guard: lease.guard });
  if (suffix === 'window.new') { const result = await ctx.createWindow(appId, { isCurrent: lease.guard, ownership: { windowId: target.windowId, guard: lease.guard } }); return lease.guard() && result ? { status: 'applied', target: { windowId: typeof result === 'string' ? result : result.windowId } } : stale(); }
  if (suffix === 'device.pair' || suffix === 'device.connect') { const device = virtualPhoneDevice(lease.sources.bluetooth); if (!device) return reject('unavailable', 'The Root-authored Studio iPhone fixture is unavailable.'); return ctx.executeOwned({ command: suffix === 'device.pair' ? 'bluetooth.pair.begin' : 'bluetooth.device.connect', target: { deviceId: device.id }, payload: {} }, { windowId: target.windowId, guard: lease.guard }); }
  if (suffix === 'authenticate') {
   const device = virtualPhoneDevice(lease.sources.bluetooth);
   if (!lease.account.signedIn || !lease.sources.bluetooth.powered || !device?.available || !device.paired || !device.connected) return reject('device_unavailable', 'The shared identity must be signed in and the original Bluetooth phone paired, connected and available.');
   if (state.windows.some(row => row !== lease.session && row.authenticated)) return reject('device_busy', 'The one authored iPhone already has an authorized window. Lock that session first.');
   if (payload.code !== '482316') return reject('authentication_failed', 'Use the disclosed fictional scene passcode 482316; no real credentials.');
   const signature = JSON.stringify(device), originalGuard = lease.guard;
   lease.guard = () => originalGuard() && virtualPhoneDevice(lease.sources.bluetooth) === device && JSON.stringify(device) === signature && lease.sources.bluetooth.powered;
   return mutate(lease, session => { session.authenticated = true; session.sheet = 'none'; session.tab = 'home'; });
  }
  if (suffix === 'lock') return mutate(lease, session => { session.authenticated = false; session.body = ''; session.tab = 'home'; });
  if (suffix === 'dial' || suffix === 'message') {
   const endpoint = endpointLease(lease), recent = lease.session.callId ? lease.sources.calls.calls.find(row => row.id === lease.session.callId) : null, participant = recent?.participants[0];
   if (lease.session.callId && !participant) return stale();
   const address = endpoint?.address ?? participant?.address ?? lease.session.digits.trim(), name = endpoint?.name ?? participant?.name ?? address;
   if (!address) return reject('invalid_arguments', 'Select an original phone endpoint or enter a literal fictional number.');
   const signature = recent ? JSON.stringify(recent) : '', guard = endpoint?.guard ?? (() => lease.guard() && (!recent || lease.sources.calls.calls.includes(recent) && recent.participants[0] === participant && JSON.stringify(recent) === signature));
   if (suffix === 'message') return ctx.composeMessage({ recipient: { name, address }, text: '', guard, windowId: lease.windowId });
   if (typeof ctx.startCall !== 'function') return reject('unavailable', 'The actual Root Calls broker is unavailable.');
   return ctx.startCall({ ...(endpoint ? { contactId: endpoint.card.id } : {}), name, address, kind: 'audio' }, { guard, windowId: lease.windowId });
  }
  if (suffix === 'end' || suffix === 'mute') { const call = lease.sources.calls.calls.find(row => !['ended', 'failed'].includes(row.status)); if (!call) return reject('stale_target', 'No actual current call exists.'); return forwardCall(lease, suffix === 'end' ? 'end' : 'media.set', suffix === 'end' ? {} : payload, call.id); }
  if (suffix === 'preferences.set') return forwardCall(lease, suffix, payload);
  if (suffix === 'block') { const endpoint = endpointLease(lease); if (!endpoint || !endpoint.guard()) return stale(); const original = lease.guard; lease.guard = () => original() && endpoint.guard(); return forwardCall(lease, 'block', { address: endpoint.address }); }
  if (suffix === 'unblock') return forwardCall(lease, 'unblock', payload);
  if (suffix === 'capture.copy') {
   if (typeof ctx.captureFrame !== 'function' || typeof ctx.setImageClipboard !== 'function') return reject('unavailable', 'The genuine scene raster and image clipboard bridges are unavailable.');
   const device = virtualPhoneDevice(lease.sources.bluetooth), signature = JSON.stringify([lease.session, lease.sources.messages, lease.sources.contacts, lease.sources.photos, device]), originalGuard = lease.guard;
   const guard = () => originalGuard() && JSON.stringify([lease.session, lease.sources.messages, lease.sources.contacts, lease.sources.photos, device]) === signature;
   const frame = await ctx.captureFrame({ windowId: target.windowId, guard }); if (!guard() || !frame?.canvas) return stale();
   const content = frame.canvas.toDataURL('image/png'); if (!guard() || !content.startsWith('data:image/png;base64,')) return stale();
   return ctx.setImageClipboard({ content, mime: 'image/png', width: frame.canvas.width, height: frame.canvas.height }, { windowId: target.windowId, guard });
  }
  if (suffix === 'message.send') {
   const conversation = lease.sources.messages.conversations.find(row => row.id === lease.session.conversationId), endpoint = endpointLease(lease), address = conversation?.participants[0] ?? endpoint?.address;
   if (!address || !lease.session.body.trim()) return reject('invalid_arguments', 'Choose a shared conversation or contact and enter a nonempty message.');
   const body = lease.session.body, signature = conversation ? JSON.stringify(conversation) : '', originalGuard = endpoint?.guard ?? lease.guard;
   const guard = () => originalGuard() && lease.session.body === body && (!conversation || lease.sources.messages.conversations.includes(conversation) && JSON.stringify(conversation) === signature);
   const result = await ctx.composeMessage({ recipient: { name: conversation?.name ?? endpoint.name, address }, text: body, guard, windowId: target.windowId });
   if (result?.status !== 'applied') return result; if (!guard()) return stale();
   const draftId = result.draftId ?? result.target?.draftId ?? result.target?.recordId, windowId = result.target?.windowId;
   if (!draftId || !windowId) return reject('unavailable', 'The Root composer did not publish an actual canonical draft.');
   const sent = await ctx.executeOwned({ command: 'messages.draft.send', target: { windowId, draftId }, payload: {} }, { windowId: target.windowId, guard });
   if (sent?.status !== 'applied') return sent;
   if (lease.guard() && lease.session.body === body) mutate(lease, session => { session.body = ''; session.conversationId = sent.target?.conversationId ?? sent.conversationId ?? session.conversationId; });
   return sent;
  }
  if (suffix === 'favorite.toggle') { const endpoint = endpointLease(lease); if (!endpoint) return stale(); lease.guard = endpoint.guard; }
  if (suffix === 'contact.select') {
   const card = phoneCards(lease.sources.contacts).find(row => row.id === payload.contactId), endpoint = card?.phones[payload.endpointIndex];
   if (!card || !endpoint) return stale();
   const revision = card.revision, value = endpoint.value, phones = card.phones, account = lease.sources.contacts.accounts.find(row => row.id === card.accountId), originalGuard = lease.guard;
   lease.guard = () => originalGuard() && lease.sources.contacts.contacts.includes(card) && card.revision === revision && card.phones === phones && phones[payload.endpointIndex] === endpoint && endpoint.value === value && lease.sources.contacts.accounts.includes(account) && account.enabled;
  }
  if (suffix === 'recent.select' || suffix === 'conversation.select' || suffix === 'photo.select') {
   const collection = suffix === 'recent.select' ? lease.sources.calls.calls : suffix === 'conversation.select' ? lease.sources.messages.conversations : lease.sources.photos.items;
   const id = payload.callId ?? payload.conversationId ?? payload.photoId, original = collection.find(row => row.id === id);
   if (!original) return stale(); const signature = JSON.stringify(original), originalGuard = lease.guard;
   lease.guard = () => originalGuard() && collection.includes(original) && JSON.stringify(original) === signature;
  }
  return mutate(lease, session => {
   if (suffix === 'tab.set') { session.tab = payload.tab; session.query = ''; if (payload.tab === 'messages') session.conversationId = null; if (payload.tab === 'photos') session.photoId = null; }
   if (suffix === 'search') session.query = payload.query;
   if (suffix === 'digits.set') { session.digits = payload.digits; session.contactId = null; session.callId = null; }
   if (suffix === 'contact.select') { const card = phoneCards(lease.sources.contacts).find(row => row.id === payload.contactId); if (!card || !card.phones[payload.endpointIndex]) return stale(); session.contactId = card.id; session.endpointIndex = payload.endpointIndex; session.callId = null; }
   if (suffix === 'recent.select') { const call = lease.sources.calls.calls.find(row => row.id === payload.callId); if (!call) return stale(); session.callId = call.id; session.digits = ''; session.contactId = null; }
   if (suffix === 'favorite.toggle') { const endpoint = phoneEndpoint(lease.sources.contacts, session); if (!endpoint) return stale(); const index = session.favorites.findIndex(row => row.contactId === endpoint.card.id && row.address === endpoint.address); if (index >= 0) session.favorites.splice(index, 1); else session.favorites.push({ contactId: endpoint.card.id, address: endpoint.address }); }
   if (suffix === 'sheet.open') session.sheet = payload.sheet;
   if (suffix === 'menu.open') session.menu = payload.menuId;
   if (suffix === 'menu.close') session.menu = '';
   if (suffix === 'conversation.select') { if (!lease.sources.messages.conversations.some(row => row.id === payload.conversationId)) return stale(); session.conversationId = payload.conversationId; session.tab = 'messages'; }
   if (suffix === 'message.set') session.body = payload.body;
   if (suffix === 'photo.select') { if (!lease.sources.photos.items.some(row => row.id === payload.photoId && row.inLibrary && !row.hidden && !row.deletedAt)) return stale(); session.photoId = payload.photoId; session.tab = 'photos'; }
  });
 }]));
 function windowOpened(window) {
  if (!alive() || window.appId !== appId) return false;
  if (phoneSession(state, window.id)) return true;
  const snapshot = JSON.stringify(state), next = createPhoneSession(window.id, appId), delta = canonicalStringUnits(next) + String(state.windows.length).length;
  if (state.windows.length >= 32 || ctx.canCommit(delta) !== true || !alive() || JSON.stringify(state) !== snapshot) return false;
  state.windows.push(next); return true;
 }
 function windowClosed(window) { if (!alive() || window.appId !== appId) return false; const index = state.windows.findIndex(row => row.windowId === window.id); if (index >= 0) state.windows.splice(index, 1); return true; }
 return { handlers, targets: () => state.windows.filter(row => !!owner(row.windowId)).map(row => ({ windowId: row.windowId })), windowOpened, windowClosed, appQuit: id => { if (!alive() || id && id !== appId) return false; state.windows.splice(0); return true; }, dispose: () => { for (const session of state.windows) { session.authenticated = false; session.body = ''; } retired = true; } };
}
export function phoneMenus(profile, state, windowId, mirroring = false) {
 const prefix = mirroring ? 'mirroring' : 'phone', target = { windowId }, session = phoneSession(state, windowId);
 const item = (id, label, suffix, payload = {}, enabled = !!session) => ({ id, label, enabled, request: { command: `${prefix}.${suffix}`, target, payload } });
 return [{ id: 'app', label: mirroring ? 'iPhone Mirroring' : 'Phone', items: [item('help', 'About Local Device', 'sheet.open', { sheet: 'help' }), ...(mirroring ? [item('lock', 'Lock iPhone', 'lock')] : [])] }, { id: 'file', label: 'File', items: [item('new', 'New Window', 'window.new'), item('close', 'Close Window', 'window.close')] }, { id: 'view', label: 'View', items: (mirroring ? ['home', 'recents', 'contacts', 'messages', 'photos'] : ['recents', 'favorites', 'contacts', 'keypad', 'settings']).map(tab => item(tab, tab[0].toUpperCase() + tab.slice(1), 'tab.set', { tab })) }, { id: 'window', label: 'Window', items: [item('capture', 'Copy Scene Screenshot', 'capture.copy')] }, { id: 'help', label: 'Help', items: [item('help', 'Local Device Help', 'sheet.open', { sheet: 'help' })] }];
}
export const mirroringMenus = (profile, state, windowId) => phoneMenus(profile, state, windowId, true);

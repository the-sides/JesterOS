import { object } from './command-schema.js';
import { callsCommandPayloads, callsWindowTarget } from './calls-catalog.js';
import { canonicalStringUnits, copyCanonicalData } from './canonical-data.js';
import { CALLS_LIMITS, callsRecipientSchema, callsSchemaValid, validateCallsState, callsCapabilities, callsWindow, callById, createCallsWindow, commitCallsCandidate, startLocalCall, receiveLocalCall, transitionLocalCall, advanceLocalCalls } from './calls-state.js';
import { startLocalGroupCall } from './calls-group.js';
import { commitCallsWithNotificationCleanup, deliverIncomingCallNotification } from './calls-notifications.js';
import { recipientIdentity } from './messages-recipients.js';
import { messagesAccountSchema } from './messages-state.js';
const reject = (code, message) => ({ status: 'rejected', error: { code, message }, code, message });
const forwardedTargetSchema = object({ windowId: callsWindowTarget.properties.windowId, callId: { anyOf: [{ type: 'null' }, callsWindowTarget.properties.windowId] } });
const forwardedCommands = new Set(['calls.accept', 'calls.end', 'calls.media.set', 'calls.preferences.set', 'calls.block', 'calls.unblock', 'calls.sheet.open', 'calls.sheet.close', 'calls.window.expand']);
export function createCallsCommands(ctx) {
  const state = ctx.getState(); let generation = 0;
  const alive = () => ctx.getState() === state && validateCallsState(state, ctx.profile).ok && (typeof ctx.alive !== 'function' || ctx.alive() === true);
  const nativeWindow = window => { const capability = callsCapabilities(ctx.profile); return !!window && window.appId === capability.appId && (capability.windows ? window.utilityKind === 'teams-call' : !window.utilityKind); };
  const now = () => { const time = ctx.getSceneTime?.(); const number = typeof time === 'number' ? time : typeof time === 'string' ? Date.parse(time) : NaN; return Number.isSafeInteger(number) && number >= 0 && number <= CALLS_LIMITS.time ? number : null; };
  const getAccount = () => { if (typeof ctx.getAccount !== 'function') return null; try { const account = ctx.getAccount(); return callsSchemaValid(account, messagesAccountSchema) ? account : null; } catch { return null; } };
  function blockedOwner() {
    if (typeof ctx.getBlockedAddresses !== 'function') return null;
    const rows = ctx.getBlockedAddresses();
    if (!callsSchemaValid(rows, { type: 'array', items: { type: 'string', minLength: 1, maxLength: 320 }, maxItems: 128 }) || rows.some(address => !recipientIdentity(address)) || new Set(rows.map(recipientIdentity)).size !== rows.length) return null;
    const signature = JSON.stringify(rows);
    return { rows, current: () => ctx.getBlockedAddresses() === rows && JSON.stringify(rows) === signature };
  }
  function retainBlockedSource(lease, blocked) { const original = lease.guard; lease.guard = () => original() && blocked.current(); }
  async function commitBlockedAddresses(lease, target, addresses, mutate) {
    if (typeof ctx.setBlockedAddresses !== 'function') return reject('unavailable', 'The actual synchronous shared communications blocked-address mutation bridge is unavailable.');
    const prepared = copyCanonicalData(state), result = commitCallsCandidate(prepared, mutate, () => true);
    if (result.status !== 'applied') return result;
    const notificationsToDismiss = state.calls.filter(call => call.notificationId && callById(prepared, call.id)?.status !== 'ringing').map(call => call.notificationId);
    for (const call of prepared.calls) if (call.notificationId && notificationsToDismiss.includes(call.notificationId)) call.notificationId = null;
    if (!validateCallsState(prepared, ctx.profile).ok) return reject('invalid_arguments', 'The prepared Calls block transaction is inconsistent.');
    let committed = null;
    const acknowledged = ctx.setBlockedAddresses(addresses, { guard: lease.guard, windowId: target.windowId, notificationsToDismiss,
      reserveTextUnits: canonicalStringUnits(prepared) - canonicalStringUnits(state),
      onCommit: () => { committed = commitCallsCandidate(state, candidate => { Object.assign(candidate, copyCanonicalData(prepared)); return result; }, ctx.canCommit, lease.guard); return committed.status === 'applied'; } });
    if (acknowledged?.then) return reject('unavailable', 'Blocked caller mutation requires the actual synchronous atomic communications bridge.');
    if (acknowledged?.status === 'applied' && committed?.status === 'applied') return settle(committed, lease, target);
    return acknowledged?.status === 'rejected' ? acknowledged : committed?.status === 'rejected' ? committed : reject('unavailable', 'The shared blocked-address bridge did not acknowledge the actual canonical mutation.');
  }
  const stale = () => reject('stale_target', 'The original native Calls window, session, view, account or canonical graph changed.');
  function owner(windowId) {
    if (!alive()) return null;
    const window = ctx.getWindow(windowId), view = ctx.getView(windowId), session = callsWindow(state, windowId), account = getAccount();
    if (!nativeWindow(window) || !view || !session || !account || ctx.available(window) !== true || view.available() !== true) return null;
    const token = ++generation, signature = JSON.stringify(state), accountSignature = JSON.stringify(account);
    const guard = () => alive() && generation === token && ctx.getWindow(windowId) === window && ctx.getView(windowId) === view && callsWindow(state, windowId) === session && ctx.available(window) === true && view.available() === true && nativeWindow(window) && getAccount() === account && JSON.stringify(account) === accountSignature && JSON.stringify(state) === signature;
    return { window, view, session, account, guard };
  }
  async function settle(result, lease, target) {
    if (result.status !== 'applied') return result;
    ++generation;
    const call = result.callId ? callById(state, result.callId) : null;
    if (typeof ctx.tick === 'function') await ctx.tick();
    // The canonical mutation already succeeded. Retirement during presentation
    // must not turn its acknowledged actual identity into a fabricated rejection.
    return { ...result, target, presentationAvailable: alive() && ctx.getWindow(lease.window.id) === lease.window && ctx.getView(lease.window.id) === lease.view && ctx.available(lease.window) === true && lease.view.available() === true && (!call || callById(state, call.id) === call) };
  }
  const transactionalCommit = (mutate, guard = alive, windowId) => commitCallsWithNotificationCleanup(state, mutate, { canCommit: ctx.canCommit, guard, updateNotification: ctx.updateNotification, updateNotifications: ctx.updateNotifications, windowId });
  async function commit(lease, target, mutate) { return settle(transactionalCommit(mutate, lease.guard, target.windowId), lease, target); }
  async function resolveRecipient(spec, lease) {
    if (!lease.account.signedIn) return reject('signed_out', 'Sign in to the shared fictional communications identity first.');
    if (!spec.contactId) {
      if (!spec.name?.trim() || !spec.address?.trim()) return reject('invalid_arguments', 'Choose a real Contacts recipient or enter a nonblank fictional name and address.');
      return { status: 'applied', spec: { name: spec.name, address: spec.address, kind: spec.kind } };
    }
    if (typeof ctx.resolveContacts !== 'function') return reject('unavailable', 'The actual canonical Contacts resolver is unavailable.');
    if (!lease.guard()) return stale();
    const result = await ctx.resolveContacts('', { guard: lease.guard, windowId: lease.window.id, ...(spec.address ? { selectedEndpoint: { contactId: spec.contactId, address: spec.address } } : {}) });
    if (!lease.guard()) return stale();
    if (result?.status !== 'applied' || !validRecipients(result.contacts)) return result?.status === 'rejected' ? result : reject('unavailable', 'The canonical Contacts resolver did not return actual bounded rows.');
    const contact = result.contacts.find(row => row.id === spec.contactId);
    if (!contact || !(contact.email || contact.phone).trim()) return reject('stale_target', 'The original contact is missing or has no call address.');
    const address = spec.address?.trim() || contact.email || contact.phone;
    if (![contact.phone, contact.email].some(value => recipientIdentity(value) === recipientIdentity(address)))
      return reject('stale_target', 'The selected address no longer belongs to the original contact.');
    if (typeof result.isCurrent !== 'function') return reject('unavailable', 'The canonical Contacts resolver must retain an actual original contact revision lease.');
    const originalGuard = lease.guard;
    lease.guard = () => originalGuard() && result.isCurrent() === true;
    if (!lease.guard()) return stale();
    return { status: 'applied', spec: { contactId: contact.id, name: contact.name, address, kind: spec.kind } };
  }
  const validRecipients = rows => callsSchemaValid(rows, { type: 'array', items: callsRecipientSchema, maxItems: CALLS_LIMITS.recipients }) && new Set(rows.map(row => row.id)).size === rows.length;
  async function initiate(lease, spec, direction, target) {
    const resolved = await resolveRecipient(spec, lease); if (resolved.status !== 'applied') return resolved;
    if (!lease.guard()) return stale();
    const blocked = blockedOwner(); if (!blocked) return reject('unavailable', 'The actual shared communications blocked-address authority is unavailable.');
    retainBlockedSource(lease, blocked);
    const identity = recipientIdentity(resolved.spec.address);
    if (!identity) return reject('invalid_arguments', 'Use a valid bounded communications endpoint.');
    if ((direction === 'incoming' || callsCapabilities(ctx.profile).windows) && blocked.rows.some(address => recipientIdentity(address) === identity)) return reject('blocked_caller', 'This actual shared communications endpoint is blocked for receiving calls or the Windows fictional local-call equivalent.');
    const time = now(); if (time === null) return reject('unavailable', 'The actual authored shared scene clock is unavailable.');
    if (direction === 'incoming' && state.preferences.notificationsEnabled && (typeof ctx.notify !== 'function' || typeof ctx.planNotification !== 'function')) return reject('unavailable', 'The actual shared incoming call notification planner and delivery bridges are unavailable.');
    // Prepare a complete candidate with the actual call and the original session
    // selection in one budgeted transaction; no orphan call/presentation ledger.
    const result = transactionalCommit(candidate => {
      const started = (direction === 'incoming' ? receiveLocalCall : startLocalCall)(candidate, resolved.spec, time, () => true);
      if (started.status !== 'applied') return started;
      const session = callsWindow(candidate, target.windowId); session.callId = started.callId; session.pickerOpen = false; session.sheet = 'none';
      return { callId: started.callId, windowId: target.windowId };
    }, lease.guard, target.windowId);
    if (result.status !== 'applied') return result;
    if (direction === 'incoming' && state.preferences.notificationsEnabled) {
      const deliveryLease = owner(target.windowId);
      const delivery = deliveryLease ? deliverIncomingCallNotification(state, result.callId, ctx, deliveryLease.guard, target.windowId) : stale();
      result.notificationDelivery = delivery;
    }
    return settle(result, lease, target);
  }
  async function actOnNotification(lease, callId, action, target) {
    const call = callById(state, callId);
    if (!call || !call.notificationId || call.direction !== 'incoming' || call.status !== 'ringing' || !lease.guard()) return stale();
    const time = now(); if (time === null) return reject('unavailable', 'The authored shared clock is unavailable.');
    return commit(lease, target, candidate => {
      const record = callById(candidate, callId), session = callsWindow(candidate, target.windowId);
      session.callId = callId;
      if (action === 'show') return { callId, windowId: target.windowId, notificationId: record.notificationId };
      if (action === 'dismiss') { record.notificationId = null; record.revision++; return { callId, windowId: target.windowId }; }
      return transitionLocalCall(candidate, callId, action === 'accept' ? 'accept' : 'end', {}, time, () => true);
    });
  }
  const handlers = Object.fromEntries(Object.entries(callsCommandPayloads).map(([name, schema]) => [name, async (target, payload = {}, sourceCurrent = null) => {
    if (!callsSchemaValid(target, callsWindowTarget) || !callsSchemaValid(payload, schema)) return reject('invalid_arguments', 'Use the closed bounded Calls target and payload.');
    const lease = owner(target.windowId); if (!lease || !lease.guard()) return reject('unavailable', 'The exact original native Calls window, shared account and mounted view must be available.');
    if (sourceCurrent !== null) {
      if (typeof sourceCurrent !== 'function') return reject('invalid_arguments', 'A forwarded Calls operation requires its actual original caller lease.');
      const originalGuard = lease.guard; lease.guard = () => originalGuard() && sourceCurrent() === true;
      if (!lease.guard()) return stale();
    }
    if (name === 'calls.group.start') {
      const capability = callsCapabilities(ctx.profile);
      if (!capability.groupSupported) return reject('unsupported_profile', capability.groupUnavailableReason);
      if (payload.contactIds.length > capability.maxRemoteParticipants || new Set(payload.contactIds).size !== payload.contactIds.length) return reject('invalid_arguments', 'Use distinct canonical recipients within the researched native group limit.');
      if (!lease.account.signedIn) return reject('signed_out', 'Sign in to the actual shared communications identity first.');
      if (typeof ctx.resolveContacts !== 'function') return reject('unavailable', 'The actual canonical Contacts resolver is unavailable.');
      const resolved = await ctx.resolveContacts('', { guard: lease.guard, windowId: target.windowId });
      if (!lease.guard()) return stale();
      if (resolved?.status !== 'applied' || !validRecipients(resolved.contacts) || typeof resolved.isCurrent !== 'function') return resolved?.status === 'rejected' ? resolved : reject('unavailable', 'Group calls require actual canonical Contacts rows and original source revision lease.');
      const originalGuard = lease.guard; lease.guard = () => originalGuard() && resolved.isCurrent() === true;
      const recipients = [];
      for (const contactId of payload.contactIds) {
        const row = resolved.contacts.find(contact => contact.id === contactId);
        if (!row || !(row.email || row.phone).trim()) return reject('stale_target', 'An original selected canonical group contact is unavailable or has no call address.');
        recipients.push({ contactId: row.id, name: row.name, address: row.email || row.phone });
      }
      const blocked = blockedOwner(); if (!blocked) return reject('unavailable', 'The actual shared communications blocked-address authority is unavailable.');
      retainBlockedSource(lease, blocked);
      if (capability.windows && recipients.some(row => blocked.rows.some(address => recipientIdentity(address) === recipientIdentity(row.address)))) return reject('blocked_caller', 'A selected group endpoint is blocked in the Windows fictional shared communications equivalent.');
      const time = now(); if (time === null || !lease.guard()) return stale();
      return commit(lease, target, candidate => { const result = startLocalGroupCall(candidate, { kind: payload.kind, recipients }, time, () => true); if (result.status !== 'applied') return result; callsWindow(candidate, target.windowId).callId = result.callId; callsWindow(candidate, target.windowId).pickerOpen = false; return { ...result, windowId: target.windowId }; });
    }
    if (name === 'calls.preferences.set') return commit(lease, target, candidate => { Object.assign(candidate.preferences, payload.values); if (!payload.values.notificationsEnabled) for (const call of candidate.calls) if (call.notificationId) { call.notificationId = null; call.revision++; } });
    if (name === 'calls.block' || name === 'calls.unblock') {
      const address = recipientIdentity(payload.address);
      if (!address) return reject('invalid_arguments', 'Use an actual bounded communications endpoint.');
      const blocked = blockedOwner(); if (!blocked) return reject('unavailable', 'The actual shared communications blocked-address authority is unavailable.');
      retainBlockedSource(lease, blocked);
      if (name === 'calls.unblock') {
        if (!blocked.rows.some(row => recipientIdentity(row) === address)) return reject('stale_target', 'The exact original shared blocked endpoint is unavailable.');
        return commitBlockedAddresses(lease, target, blocked.rows.filter(row => recipientIdentity(row) !== address), () => ({ unblockedAddress: address }));
      }
      let participant = callById(state, lease.session.callId)?.participants.find(row => recipientIdentity(row.address) === address && (!payload.contactId || row.contactId === payload.contactId));
      if (!participant && payload.contactId) { const resolved = await resolveRecipient({ contactId: payload.contactId, address: payload.address, kind: 'audio' }, lease); if (resolved.status !== 'applied') return resolved; participant = resolved.spec; }
      if (!participant || !lease.guard()) return reject('stale_target', 'Block only an original displayed call participant or resolved canonical contact endpoint.');
      if (blocked.rows.some(row => recipientIdentity(row) === address)) return reject('already_blocked', 'The exact shared communications endpoint is already blocked.');
      if (blocked.rows.length >= 128) return reject('limit_exceeded', 'The shared communications blocked-address limit is reached.');
      const time = now(); if (time === null) return stale();
      return commitBlockedAddresses(lease, target, [...blocked.rows, address], candidate => {
        if (time < candidate.runtime.lastTime) return stale();
        candidate.runtime.lastTime = time;
        for (const call of candidate.calls) if (call.direction === 'incoming' && call.status === 'ringing' && call.participants.some(row => recipientIdentity(row.address) === address)) {
          const ended = transitionLocalCall(candidate, call.id, 'end', {}, time, () => true); if (ended.status !== 'applied') return ended;
        }
        return { blockedAddress: address };
      });
    }
    if (name === 'calls.notification.action') return actOnNotification(lease, payload.callId, payload.action, target);
    if (name === 'calls.search') return commit(lease, target, candidate => { callsWindow(candidate, target.windowId).query = payload.query; });
    if (name === 'calls.contacts.resolve') {
      if (typeof ctx.resolveContacts !== 'function') return reject('unavailable', 'The actual canonical Contacts resolver is unavailable.');
      const result = await ctx.resolveContacts(payload.query, { guard: lease.guard, windowId: target.windowId });
      if (!lease.guard()) return stale();
      if (result?.status !== 'applied' || !validRecipients(result.contacts)) return result?.status === 'rejected' ? result : reject('unavailable', 'The Contacts resolver did not return actual bounded rows.');
      return commit(lease, target, candidate => { const session = callsWindow(candidate, target.windowId); session.recipients = copyCanonicalData(result.contacts); session.selectedContactId = null; session.pickerOpen = true; });
    }
    if (name === 'calls.recents.filter') return commit(lease, target, candidate => { callsWindow(candidate, target.windowId).recentFilter = payload.filter; });
    if (name === 'calls.recipient.select') {
      if (!lease.session.pickerOpen || !lease.session.recipients.some(row => row.id === payload.contactId)) return reject('stale_target', 'Choose only an actual row in the current Contacts picker.');
      return commit(lease, target, candidate => { callsWindow(candidate, target.windowId).selectedContactId = payload.contactId; });
    }
    if (name === 'calls.picker.close') return commit(lease, target, candidate => { callsWindow(candidate, target.windowId).pickerOpen = false; });
    if (name === 'calls.start' || name === 'calls.incoming') return initiate(lease, { ...payload, ...(payload.contactId || !lease.session.selectedContactId ? {} : { contactId: lease.session.selectedContactId }) }, name === 'calls.incoming' ? 'incoming' : 'outgoing', target);
    if (['calls.accept', 'calls.end', 'calls.fail', 'calls.media.set'].includes(name)) {
      if (!lease.session.callId) return reject('unavailable', 'Select the original active local call first.');
      const action = { 'calls.accept': 'accept', 'calls.end': 'end', 'calls.fail': 'fail', 'calls.media.set': 'media' }[name], time = now();
      if (time === null) return reject('unavailable', 'The authored shared scene clock is unavailable.');
      return commit(lease, target, candidate => transitionLocalCall(candidate, lease.session.callId, action, payload, time, () => true));
    }
    if (name === 'calls.recent.select') {
      if (!callById(state, payload.callId)) return stale();
      return commit(lease, target, candidate => { callsWindow(candidate, target.windowId).callId = payload.callId; });
    }
    if (name === 'calls.sheet.open' || name === 'calls.sheet.close') return commit(lease, target, candidate => { const session = callsWindow(candidate, target.windowId); session.sheet = payload.sheet ?? 'none'; session.pickerOpen = false; });
    if (name === 'calls.account.set') {
      if (typeof ctx.setAccount !== 'function') return reject('unavailable', 'The shared Messages communications identity setter is unavailable.');
      if (payload.signedIn === false && state.calls.some(call => !['ended', 'failed'].includes(call.status))) return reject('busy', 'End the active local call before signing out.');
      const result = await ctx.setAccount(payload, { guard: lease.guard, windowId: target.windowId });
      if (result?.status !== 'applied') return result?.status === 'rejected' ? result : reject('unavailable', 'The shared account authority did not acknowledge a real mutation.');
      if (!getAccount()) return reject('unavailable', 'The canonical shared account is unavailable after acknowledgement.');
      return settle({ ...result, status: 'applied' }, lease, target);
    }
    if (name === 'calls.window.expand') {
      if (typeof lease.view.expand !== 'function' || !lease.guard()) return reject('unavailable', 'The actual original shell full-window control is unavailable.');
      const result = await lease.view.expand(lease.guard);
      return result === true ? { status: 'applied', target, windowId: target.windowId } : reject('unavailable', 'The actual shell full-window action was not applied.');
    }
    if (name === 'calls.window.close') {
      if (typeof ctx.closeWindow !== 'function') return reject('unavailable', 'The guarded parent close-window bridge is unavailable.');
      const result = await ctx.closeWindow(target.windowId, { isCurrent: lease.guard });
      return result?.status === 'applied' || result === true ? { status: 'applied', target, windowId: target.windowId } : reject('unavailable', 'The parent did not retire the original call window.');
    }
    let observed;
    if (name === 'calls.native.focus') observed = await lease.view.focus?.(payload.controlId, lease.guard);
    if (name === 'calls.native.scroll') observed = await lease.view.scroll?.(payload.areaId, { top: payload.top, left: payload.left }, lease.guard);
    if (name === 'calls.native.selection') observed = await lease.view.setSelection?.(payload.controlId, { start: payload.start, end: payload.end }, lease.guard);
    if (name === 'calls.menu.open') observed = await lease.view.openMenu?.(payload.menuId, lease.guard);
    if (name === 'calls.menu.close') observed = await lease.view.closeMenu?.(payload.restoreFocus, lease.guard);
    return observed && lease.guard() ? { status: 'applied', target, ...(name === 'calls.native.scroll' ? { offsets: observed } : {}) } : stale();
  }]));
  function windowOpened(window, options = {}) {
    if (!alive() || !nativeWindow(window)) return false;
    if (callsWindow(state, window.id)) return true;
    const result = commitCallsCandidate(state, candidate => createCallsWindow(candidate, window.id, options.callId ?? null), ctx.canCommit);
    if (result.status === 'applied') { generation++; return true; } return false;
  }
  function windowClosed(window) {
    if (!alive() || !nativeWindow(window)) return false;
    const session = callsWindow(state, window.id); if (!session) return true;
    const time = now(); if (time === null) return false;
    const result = transactionalCommit(candidate => {
      const current = callById(candidate, session.callId);
      if (current && !['ended', 'failed'].includes(current.status)) {
        const ended = transitionLocalCall(candidate, current.id, 'end', {}, time, () => true); if (ended.status !== 'applied') return ended;
      }
      candidate.windows = candidate.windows.filter(row => row.windowId !== window.id);
    }, alive, window.id);
    if (result.status === 'applied') { generation++; return true; } return false;
  }
  function appQuit() {
    if (!alive()) return false; const time = now(); if (time === null) return false;
    const result = transactionalCommit(candidate => { for (const call of candidate.calls) if (!['ended', 'failed'].includes(call.status)) { const ended = transitionLocalCall(candidate, call.id, 'end', {}, time, () => true); if (ended.status !== 'applied') return ended; } candidate.windows = []; });
    if (result.status === 'applied') { generation++; return true; } return false;
  }
  function advance(time = now()) {
    if (!alive()) return stale(); const result = transactionalCommit(candidate => advanceLocalCalls(candidate, time, () => true)); if (result.status === 'applied') generation++; return result;
  }
  async function startCall(spec, ownership) {
    if (!ownership || typeof ownership.guard !== 'function' || !ownership.guard() || !alive()) return stale();
    if (!callsSchemaValid(spec, callsCommandPayloads['calls.start'])) return reject('invalid_arguments', 'Use the closed Calls recipient specification.');
    if (typeof ctx.createWindow !== 'function') return reject('unavailable', 'The actual native Calls window creation bridge is unavailable.');
    const authority = getAccount(), signature = authority ? JSON.stringify(authority) : '';
    if (!authority?.signedIn) return reject('signed_out', 'The actual shared communications identity is signed out or unavailable.');
    const sourceGuard = () => alive() && ownership.guard() === true && getAccount() === authority && JSON.stringify(authority) === signature;
    const capability = callsCapabilities(ctx.profile);
    const result = await ctx.createWindow(capability.appId, { utilityKind: capability.utilityKind, isCurrent: sourceGuard });
    if (!sourceGuard()) return stale();
    const windowId = typeof result === 'string' ? result : result?.windowId;
    if (!windowId) return reject('unavailable', 'The parent did not create an actual native Calls window.');
    if (typeof ctx.tick === 'function') await ctx.tick();
    if (!sourceGuard()) return stale();
    const lease = owner(windowId); if (!lease) return reject('unavailable', 'The created Calls window has no actual mounted native view/session.');
    const originalGuard = lease.guard; lease.guard = () => originalGuard() && sourceGuard();
    return initiate(lease, spec, 'outgoing', { windowId });
  }
  function prepareNotificationDismissals(actualNotificationIds, ownership) {
    if (!callsSchemaValid(actualNotificationIds, { type: 'array', items: callsWindowTarget.properties.windowId, maxItems: 256 }) || new Set(actualNotificationIds).size !== actualNotificationIds.length || typeof ownership?.guard !== 'function' || !alive() || ownership.guard() !== true) return null;
    const signature = JSON.stringify(state), calls = state.calls, windows = state.windows, ids = new Set(actualNotificationIds);
    const current = () => alive() && ownership.guard() === true && state.calls === calls && state.windows === windows && JSON.stringify(state) === signature;
    const candidate = copyCanonicalData(state);
    for (const call of candidate.calls) if (call.notificationId && ids.has(call.notificationId)) { call.notificationId = null; call.revision++; }
    if (!validateCallsState(candidate, ctx.profile).ok) return null;
    return { current, delta: canonicalStringUnits(candidate) - canonicalStringUnits(state), commit() {
      return commitCallsCandidate(state, graph => { Object.assign(graph, copyCanonicalData(candidate)); }, () => true, current).status === 'applied';
    } };
  }
  function prepareBlockedAddressEffects(addresses, ownership) {
    if (!callsSchemaValid(addresses, { type: 'array', items: { type: 'string', minLength: 1, maxLength: 320 }, maxItems: 128 }) || addresses.some(address => !recipientIdentity(address)) || new Set(addresses.map(recipientIdentity)).size !== addresses.length || typeof ownership?.guard !== 'function' || !alive() || ownership.guard() !== true) return null;
    const blocked = blockedOwner(), account = getAccount(); if (!blocked || !account) return null;
    const signature = JSON.stringify(state), accountSignature = JSON.stringify(account), calls = state.calls, windows = state.windows, time = now();
    const current = () => alive() && ownership.guard() === true && state.calls === calls && state.windows === windows && JSON.stringify(state) === signature && getAccount() === account && JSON.stringify(account) === accountSignature && blocked.current() && now() === time;
    const identities = new Set(addresses.map(recipientIdentity));
    const ringing = state.calls.filter(call => call.direction === 'incoming' && call.status === 'ringing' && call.participants.some(row => identities.has(recipientIdentity(row.address))));
    if (!ringing.length) return { current, delta: 0, notificationsToDismiss: [], commit: () => current() };
    if (time === null || time < state.runtime.lastTime) return null;
    const candidate = copyCanonicalData(state), notificationsToDismiss = [];
    for (const original of ringing) {
      const ended = transitionLocalCall(candidate, original.id, 'end', {}, time, () => true);
      if (ended.status !== 'applied') return null;
      if (original.notificationId) notificationsToDismiss.push(original.notificationId);
      callById(candidate, original.id).notificationId = null;
    }
    if (!validateCallsState(candidate, ctx.profile).ok) return null;
    return { current, delta: canonicalStringUnits(candidate) - canonicalStringUnits(state), notificationsToDismiss, commit: () => commitCallsCandidate(state, graph => { Object.assign(graph, copyCanonicalData(candidate)); }, ctx.canCommit, current).status === 'applied' };
  }
  async function notificationAction(callId, action, ownership) {
    if (!['accept', 'decline', 'show', 'dismiss'].includes(action) || typeof ownership?.guard !== 'function' || !ownership.guard() || !alive()) return stale();
    const call = callById(state, callId), session = state.windows.find(row => row.callId === callId);
    if (!call?.notificationId || call.status !== 'ringing' || call.direction !== 'incoming' || !session) return stale();
    const window = ctx.getWindow(session.windowId), account = getAccount(), signature = JSON.stringify(call), accountSignature = JSON.stringify(account);
    const originalCurrent = () => alive() && ownership.guard() === true && callById(state, callId) === call && callsWindow(state, session.windowId) === session && ctx.getWindow(session.windowId) === window && nativeWindow(window) && getAccount() === account && JSON.stringify(account) === accountSignature && JSON.stringify(call) === signature;
    if (!originalCurrent()) return stale();
    if (typeof ctx.focusWindow !== 'function') return reject('unavailable', 'The real original call-window presentation bridge is unavailable.');
    ctx.focusWindow(session.windowId);
    if (typeof ctx.tick === 'function') await ctx.tick();
    if (!originalCurrent()) return stale();
    const lease = owner(session.windowId); if (!lease) return reject('unavailable', 'The actual original call window cannot be presented.');
    const guard = lease.guard; lease.guard = () => guard() && originalCurrent();
    return actOnNotification(lease, callId, action, { windowId: session.windowId });
  }
  async function forwardCommand(name, target, payload, ownership) {
    if (!forwardedCommands.has(name) || !callsSchemaValid(target, forwardedTargetSchema) || typeof ownership?.guard !== 'function') return reject('invalid_arguments', 'Forward only native Calls controls/preferences/blocking to an exact actual call window and identity.');
    const session = callsWindow(state, target.windowId), call = target.callId === null ? null : callById(state, target.callId);
    if (!session || session.callId !== target.callId || (target.callId !== null && !call)) return stale();
    const signature = call ? JSON.stringify(call) : null;
    const current = () => alive() && ownership.guard() === true && callsWindow(state, target.windowId) === session && session.callId === target.callId && (call ? callById(state, target.callId) === call && JSON.stringify(call) === signature : session.callId === null);
    if (!current()) return stale();
    const result = await handlers[name]({ windowId: target.windowId }, payload, current);
    return result.status === 'applied' ? { ...result, windowId: target.windowId, callId: target.callId } : result;
  }
  const targets = (name = '') => state.windows.flatMap(session => { const window = ctx.getWindow(session.windowId), view = ctx.getView(session.windowId); if (!alive() || !nativeWindow(window) || !view || ctx.available(window) !== true || view.available() !== true) return []; const target = { windowId: session.windowId }; if (name === 'calls.native.focus' || name === 'calls.native.selection') return view.describe().controlIds.map(controlId => ({ ...target, controlId })); if (name === 'calls.native.scroll') return Object.keys(view.describe().scrolls).map(areaId => ({ ...target, areaId })); return [target]; });
  return { handlers, targets, windowOpened, windowClosed, appQuit, advance, startCall, forwardCommand, notificationAction, prepareNotificationDismissals, prepareBlockedAddressEffects };
}

import { canonicalStringUnits, copyCanonicalData } from './canonical-data.js';
import { callById, callsCapabilities, callsSchemaValid, callsIdSchema, commitCallsCandidate } from './calls-state.js';
const reject = (code, message) => ({ status: 'rejected', error: { code, message }, code, message });
export function commitCallsWithNotificationCleanup(state, mutate, { canCommit, guard, updateNotification, updateNotifications, windowId }) {
  if (guard() !== true) return reject('stale_target', 'The original Calls notification transaction is unavailable.');
  const prepared = copyCanonicalData(state), result = commitCallsCandidate(prepared, mutate, () => true);
  if (result.status !== 'applied') return result;
  const retire = state.calls.filter(call => call.notificationId && (callById(prepared, call.id)?.status !== 'ringing' || callById(prepared, call.id)?.notificationId !== call.notificationId));
  if (!retire.length) return commitCallsCandidate(state, candidate => { Object.assign(candidate, copyCanonicalData(prepared)); return result; }, canCommit, guard);
  const ids = retire.map(call => call.notificationId);
  for (const call of retire) { const candidate = callById(prepared, call.id); if (candidate) candidate.notificationId = null; }
  const bridge = ids.length === 1 ? updateNotification : updateNotifications;
  if (typeof bridge !== 'function') return reject('unavailable', 'The real synchronous shared notification dismissal bridge is unavailable.');
  let committed = null;
  const snapshot = JSON.stringify(state), transactionGuard = () => guard() === true && JSON.stringify(state) === snapshot;
  const patch = { dismissed: true, reserveTextUnits: canonicalStringUnits(prepared) - canonicalStringUnits(state), onCommit: actualIds => {
    const actual = Array.isArray(actualIds) ? actualIds : [actualIds];
    if (actual.length !== ids.length || actual.some((id, index) => id !== ids[index]) || !transactionGuard()) return false;
    committed = commitCallsCandidate(state, candidate => { Object.assign(candidate, copyCanonicalData(prepared)); return result; }, () => true, transactionGuard);
    return committed.status === 'applied';
  } };
  const acknowledged = bridge(ids.length === 1 ? ids[0] : ids, patch, { guard: transactionGuard, ...(windowId ? { windowId } : {}) });
  if (acknowledged?.then) return reject('unavailable', 'Calls lifecycle requires a synchronous atomic shared alert dismissal bridge.');
  if (acknowledged?.status !== 'applied' || committed?.status !== 'applied') return acknowledged?.status === 'rejected' ? acknowledged : reject('unavailable', 'The shared alert did not acknowledge the exact canonical Calls mutation.');
  return committed;
}
export function deliverIncomingCallNotification(state, callId, ctx, guard, windowId) {
  const call = callById(state, callId);
  if (!call || call.status !== 'ringing' || call.direction !== 'incoming' || call.notificationId || !state.preferences.notificationsEnabled || guard() !== true) return reject('unavailable', 'No original undelivered ringing incoming call is available.');
  if (typeof ctx.notify !== 'function' || typeof ctx.planNotification !== 'function' || typeof ctx.canCommit !== 'function') return reject('unavailable', 'The actual notification planner, delivery and complete-scene budget bridges are unavailable.');
  const revision = call.revision, account = ctx.getAccount(), accountSignature = JSON.stringify(account), graphSignature = JSON.stringify(state);
  const originalCurrent = () => guard() === true && callById(state, callId) === call && call.revision === revision && ctx.getAccount() === account && JSON.stringify(account) === accountSignature && JSON.stringify(state) === graphSignature;
  const plan = ctx.planNotification({ guard: originalCurrent, windowId });
  if (plan?.status === 'rejected') return plan;
  if (!callsSchemaValid(plan?.notificationId, callsIdSchema) || typeof plan?.current !== 'function') return reject('unavailable', 'The real shared notification planner did not return an original allocation lease.');
  const current = () => originalCurrent() && plan.current() === true;
  if (!current()) return reject('stale_target', 'The original prospective notification allocation retired.');
  let committed = null;
  // Planning consumes no identity. Preflight the exact prospective ledger delta,
  // then require the actually allocated shared ID to match that original lease.
  const result = ctx.notify({ id: `calls-${callId}-ringing`, appId: callsCapabilities(state.profileId).appId, title: call.participants[0].name.slice(0, 256), body: `Incoming ${call.kind} call · fictional local scene`, source: { kind: 'call', recordId: callId, windowId }, actions: ['accept', 'decline', 'open'], reserveTextUnits: plan.notificationId.length, onCommit: notificationId => {
    if (notificationId !== plan.notificationId || !current()) return false;
    committed = commitCallsCandidate(state, candidate => { const record = callById(candidate, callId); record.notificationId = notificationId; record.revision++; return { callId, notificationId }; }, ctx.canCommit, current);
    return committed.status === 'applied';
  } }, { guard: current, windowId });
  if (result?.then) return reject('unavailable', 'Calls incoming delivery requires the synchronous atomic shared notification bridge.');
  return result?.status === 'applied' && committed?.status === 'applied' ? committed : committed?.status === 'rejected' ? committed : result?.status === 'rejected' ? result : reject('unavailable', 'The actual call alert did not commit its original canonical delivery acknowledgement.');
}

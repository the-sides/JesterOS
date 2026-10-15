import { object } from './command-schema.js';
import { applyCanonicalData, copyCanonicalData } from './canonical-data.js';
import { reminderCommandPayloads, remindersCatalog } from './reminders-catalog.js';
import { REMINDERS_PROFILES, reminderIdSchema, reminderValueConforms, validateRemindersState, remindersMutable, remindersTextUnits, reminderWindow, reminderEpoch, reminderDate, reminderDateValid, reminderAllocateId, emptyReminderSpec, reminderSpec, nextReminderDue, reminderAlertDue } from './reminders-state.js';
export { remindersCatalog };
const rejected = (code, message) => ({ status: 'rejected', error: { code, message } });
const stale = () => rejected('stale_target', 'The original reminder, native view, window, or authored scene changed.');
const applied = (windowId, extra = {}) => ({ status: 'applied', target: { windowId }, ...extra });
const targetSchema = object({ windowId: reminderIdSchema });
const commit = (state, candidate) => applyCanonicalData(state, candidate);
// Capture the original graph, including nested arrays, descriptor flags and row
// identities. A changed accessor is rejected without ever invoking it.
function retainRemindersGraph(root) {
  const snapshots = [], seen = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('Reminders source requires data descriptors.');
      // Materialize validated reactive children before taking their descriptors.
      if (key !== 'length') visit(value[key]);
    }
    snapshots.push({ value, prototype: Object.getPrototypeOf(value), descriptors: Object.getOwnPropertyDescriptors(value) });
  };
  visit(root);
  return () => snapshots.every(({ value, prototype, descriptors }) => {
    if (Object.getPrototypeOf(value) !== prototype || Reflect.ownKeys(value).length !== Reflect.ownKeys(descriptors).length) return false;
    return Reflect.ownKeys(descriptors).every(key => {
      const before = descriptors[key], after = Object.getOwnPropertyDescriptor(value, key);
      return after && before.enumerable === after.enumerable && before.configurable === after.configurable
        && before.writable === after.writable && before.value === after.value && before.get === after.get && before.set === after.set;
    });
  });
}
const ownershipCurrent = ownership => typeof ownership === 'function' ? ownership() === true : !ownership || ownership.guard?.() === true;
export function createRemindersCommands(ctx) {
  const state = ctx.getState(), histories = new Map();
  let clockRequest = 0, lastClock = reminderEpoch(typeof ctx.getSceneTime === 'function' ? ctx.getSceneTime() : NaN);
  if (!Number.isSafeInteger(lastClock)) lastClock = Date.parse(ctx.profile.defaults.sceneTime);
  const editorBases = new Map(state.windows.filter(win=>win.editorId !== null && win.editor !== null).map(win => { const task=state.tasks.find(row=>row.id===win.editorId); return [win.windowId,{task,spec:task?JSON.stringify(reminderSpec(task)):null}]; }));
  const now = () => reminderEpoch(ctx.getSceneTime());
  const alive = () => ctx.getState() === state && (typeof ctx.alive !== 'function' || ctx.alive()) && REMINDERS_PROFILES.includes(ctx.profile.id);
  const leaseFor = windowId => {
    const window = ctx.getWindow(windowId), view = ctx.getView(windowId), session = reminderWindow(state, windowId);
    if (!alive() || !window || !session || !view || !ctx.available(window) || view.available() !== true) return null;
    const profile = ctx.profile, unchanged = retainRemindersGraph(state), windowUnchanged = retainRemindersGraph(window), authoredTime = ctx.getSceneTime();
    const snapshot = JSON.stringify(state), time = now(), arrays = [state.accounts, state.lists, state.tasks, state.alerts, state.windows];
    const records = arrays.map(array => array.slice());
    const present = () => alive() && ctx.profile === profile && ctx.getWindow(windowId) === window && ctx.getView(windowId) === view && reminderWindow(state, windowId) === session && ctx.available(window) && view.available() === true;
    const guard = () => present() && unchanged() && windowUnchanged() && Object.is(ctx.getSceneTime(), authoredTime) && arrays.every((array, i) => array === [state.accounts, state.lists, state.tasks, state.alerts, state.windows][i] && array.length === records[i].length && array.every((row, index) => row === records[i][index])) && remindersMutable(state) && JSON.stringify(state) === snapshot && now() === time;
    return { windowId, window, view, session, guard, present };
  };
  const candidateCheck = (candidate, guard) => {
    if (!guard()) return stale();
    if (!validateRemindersState(state, ctx.profile).ok || !remindersMutable(state)) return rejected('stale_target', 'The canonical graph must retain mutable descriptor-safe ownership.');
    const checked = validateRemindersState(candidate, ctx.profile); if (!checked.ok) return rejected('invalid_arguments', checked.message);
    try { if (typeof ctx.canCommit !== 'function' || ctx.canCommit(remindersTextUnits(candidate) - remindersTextUnits(state)) !== true) return rejected('limit_exceeded', 'The complete-scene reminder text budget rejects this transaction.'); } catch { return rejected('limit_exceeded', 'The complete-scene text budget is unavailable.'); }
    return guard() ? null : stale();
  };
  const dataSnapshot = source => copyCanonicalData({ accounts: source.accounts, lists: source.lists, tasks: source.tasks, preferences: source.preferences });
  async function mutation(lease, change, undoable = false) {
    if (!lease.guard()) return stale();
    const candidate = copyCanonicalData(state), session = reminderWindow(candidate, lease.windowId), result = change(candidate, session);
    if (result?.status === 'rejected') return result;
    // Source mutations retire live deliveries atomically and cancel snoozes.
    // Snoozed notification IDs are audit history: only delivered IDs are live.
    const notificationIds = [];
    for (const alert of state.alerts) {
      if (!['delivered', 'snoozed'].includes(alert.status)) continue;
      const beforeTask = state.tasks.find(row => row.id === alert.reminderId), task = candidate.tasks.find(row => row.id === alert.reminderId);
      const beforeList = state.lists.find(row => row.id === beforeTask?.listId), list = candidate.lists.find(row => row.id === task?.listId);
      const beforeAccount = state.accounts.find(row => row.id === beforeList?.accountId), account = candidate.accounts.find(row => row.id === list?.accountId);
      const row = candidate.alerts.find(item => item.id === alert.id);
      if (JSON.stringify(beforeTask) === JSON.stringify(task) && JSON.stringify(beforeList) === JSON.stringify(list)
        && JSON.stringify(beforeAccount) === JSON.stringify(account) && row && row.status === alert.status) continue;
      if (alert.status === 'delivered' && alert.notificationId) notificationIds.push(alert.notificationId);
      if (row && ['delivered', 'snoozed'].includes(row.status)) { row.status = 'dismissed'; row.snoozeAt = null; }
    }
    const error = candidateCheck(candidate, lease.guard); if (error) return error;
    if (!lease.guard()) return stale();
    const delta = remindersTextUnits(candidate) - remindersTextUnits(state);
    const before = undoable ? dataSnapshot(state) : null, after = undoable ? dataSnapshot(candidate) : null;
    const recordHistory = () => { const history = histories.get(lease.windowId) ?? { undo: [], redo: [] }; history.undo.push({ before, after }); if (history.undo.length > 32) history.undo.shift(); history.redo = []; histories.set(lease.windowId, history); };
    if (!notificationIds.length) { commit(state, candidate); if (undoable) recordHistory(); return applied(lease.windowId, result ?? {}); }
    if (typeof ctx.updateNotifications !== 'function') return rejected('unavailable', 'The actual atomic notification batch bridge is required.');
    const ids = [...new Set(notificationIds)];
    let committed = false, bridge;
    try {
      bridge = await ctx.updateNotifications(ids, { dismissed: true, reserveTextUnits: delta, onCommit: actualIds => {
        if (committed || !Array.isArray(actualIds) || actualIds.length !== ids.length || ids.some((id, index) => id !== actualIds[index]) || !lease.guard()
          || typeof ctx.canCommit === 'function' && ctx.canCommit(delta) !== true || !lease.guard()) return false;
        if (!validateRemindersState(candidate, ctx.profile).ok) return false;
        commit(state, candidate); committed = true; return true;
      } }, { guard: lease.guard, windowId: lease.windowId });
    } catch (error) { if (!committed) return rejected('unavailable', error?.message ?? 'The atomic notification batch failed.'); }
    if (!committed) return bridge?.status === 'rejected' ? bridge : rejected('unavailable', 'The original notification batch did not acknowledge the atomic Reminders mutation.');
    if (undoable) recordHistory();
    return applied(lease.windowId, result ?? {});
  }
  function writable(data, id) { const task = data.tasks.find(row => row.id === id), list = data.lists.find(row => row.id === task?.listId); return task && data.accounts.find(row => row.id === list?.accountId)?.enabled ? task : null; }
  function invalidate(data, task) { task.revision++; }
  function complete(data, task, completed) {
    if (task.completed === completed) return { reminderId: task.id, completed, nextDue: null };
    const due = completed ? nextReminderDue(task) : null;
    for (const alert of data.alerts.filter(row => row.reminderId === task.id && row.revision === task.revision)) { alert.status = completed ? 'completed' : 'dismissed'; alert.snoozeAt = null; }
    if (due !== null) { task.dueAt = due; task.revision++; task.completed = false; task.completedAt = null; }
    else { task.completed = completed; task.completedAt = completed ? now() : null; if (!completed) invalidate(data, task); }
    return { reminderId: task.id, completed: task.completed, nextDue: due };
  }
  const cleanup = data => {
    const taskIds = new Set(data.tasks.map(row => row.id)), listIds = new Set(data.lists.map(row => row.id));
    data.alerts = data.alerts.filter(row => taskIds.has(row.reminderId));
    if (!listIds.has(data.preferences.defaultListId)) data.preferences.defaultListId = data.lists[0]?.id ?? null;
    for (const win of data.windows) { if (!listIds.has(win.listId)) win.listId = data.preferences.defaultListId; if (!taskIds.has(win.selectedId)) win.selectedId = null; if (win.editor && (!listIds.has(win.editor.listId) || win.editorId !== null && !taskIds.has(win.editorId))) { win.editor = null; win.editorId = null; win.editorRevision = null; win.sheet = 'none'; } if (!listIds.has(win.editingListId)) win.editingListId = null; }
  };
  async function deliver(lease, reminderId, trigger = 'time') {
    if (!lease.guard()) return stale();
    const task = writable(state, reminderId), due = task && reminderAlertDue(state, task);
    if (!task || task.completed || !state.preferences.notifications || !Number.isSafeInteger(now())) return rejected('unavailable', 'No enabled incomplete reminder is eligible.');
    let originalAlert = state.alerts.find(row => row.reminderId === task.id && row.revision === task.revision);
    if (trigger === 'time' && (due === null || due > now()) && !(originalAlert?.status === 'snoozed' && originalAlert.snoozeAt <= now())) return rejected('unavailable', 'The authored reminder time has not arrived.');
    if (originalAlert && !(originalAlert.status === 'snoozed' && originalAlert.snoozeAt <= now()) && !(trigger === 'location' && originalAlert.status === 'dismissed')) return rejected('unavailable', 'This revision already has a delivery acknowledgement.');
    if (typeof ctx.notify !== 'function' || typeof ctx.planNotification !== 'function') return rejected('unavailable', 'The actual notification insertion and allocation-planning bridges are required.');
    const planned = ctx.planNotification({ guard: lease.guard, windowId: lease.windowId });
    if (planned?.status === 'rejected') return planned;
    if (!planned || !reminderValueConforms(planned.notificationId, reminderIdSchema) || typeof planned.current !== 'function') return rejected('unavailable', 'The actual notification allocation plan is required.');
    const current = () => lease.guard() && planned.current() === true;
    const candidate = copyCanonicalData(state), copy = candidate.tasks.find(row => row.id === task.id), alertId = originalAlert?.id ?? reminderAllocateId(candidate, 'reminder-alert');
    const row = { id: alertId, reminderId: copy.id, revision: copy.revision, due: due ?? now(), trigger, notificationId: planned.notificationId, status: 'delivered', deliveredAt: now(), snoozeAt: null };
    candidate.alerts = candidate.alerts.filter(item => item.id !== alertId); candidate.alerts.push(row);
    const requestId = reminderAllocateId(candidate, 'reminder-notify');
    const error = candidateCheck(candidate, current); if (error) return error;
    if (!current()) return stale();
    const reserveTextUnits = remindersTextUnits(candidate) - remindersTextUnits(state); let committedId = null;
    let result;
    try { result = await ctx.notify({ id: requestId, title: copy.title, body: copy.notes || (trigger === 'location' ? `Fictional location: ${copy.location?.label ?? ''}` : 'Reminder due'), source: { appId: 'reminders', reminderId: copy.id, listId: copy.listId, windowId: lease.windowId, alertId }, actions: ['complete', 'snooze', 'dismiss'], reserveTextUnits, onCommit: notificationId => {
      if (committedId !== null || notificationId !== planned.notificationId || !current()
        || typeof ctx.canCommit === 'function' && ctx.canCommit(reserveTextUnits) !== true || !validateRemindersState(candidate, ctx.profile).ok || !current()) return false;
      commit(state, candidate); lease.rebase?.(); committedId = notificationId; return true;
    } }, { guard: current, windowId: lease.windowId }); } catch (error) { result = rejected('unavailable', error?.message ?? 'Notification transaction failed.'); }
    // An acknowledged transaction remains applied if its owner retires afterwards.
    if (committedId !== null) return applied(lease.windowId, { notificationId: committedId, alertId, reminderId: copy.id });
    return result?.status === 'rejected' ? result : rejected('unavailable', 'The notification bridge did not atomically acknowledge the actual reminder ledger.');
  }
  async function transition(lease, alertId, action, minutes = 0) {
    const alert = state.alerts.find(row => row.id === alertId), task = alert && state.tasks.find(row => row.id === alert.reminderId);
    if (!lease.guard() || !alert || !task || alert.revision !== task.revision || task.completed || !['delivered', 'snoozed'].includes(alert.status)) return stale();
    const candidate = copyCanonicalData(state), row = candidate.alerts.find(item => item.id === alertId), copy = candidate.tasks.find(item => item.id === task.id);
    if (action === 'complete') complete(candidate, copy, true);
    else { row.status = action === 'snooze' ? 'snoozed' : 'dismissed'; row.snoozeAt = action === 'snooze' ? now() + minutes * 60000 : null; }
    const error = candidateCheck(candidate, lease.guard); if (error) return error;
    if (!lease.guard()) return stale();
    // Snooze already retired the actual notification. Its retained ID is audit
    // history, not a live notification target for later ledger transitions.
    if (alert.status === 'snoozed') {
      commit(state, candidate);
      return applied(lease.windowId, { alertId, notificationId: alert.notificationId, reminderId: task.id, action });
    }
    if (typeof ctx.updateNotification !== 'function') return rejected('unavailable', 'The real notification dismissal transaction is unavailable.');
    const delta = remindersTextUnits(candidate) - remindersTextUnits(state);
    let acknowledged = false;
    let result;
    try { result = await ctx.updateNotification(alert.notificationId, { dismissed: true, reserveTextUnits: delta, onCommit: notificationId => { if (!lease.guard() || acknowledged || notificationId !== alert.notificationId || typeof ctx.canCommit === 'function' && ctx.canCommit(delta) !== true || !lease.guard() || !validateRemindersState(candidate, ctx.profile).ok) return false; commit(state, candidate); acknowledged = true; return true; } }, { guard: lease.guard, windowId: lease.windowId }); } catch (error) { result = rejected('unavailable', error?.message ?? 'Notification transition failed.'); }
    if (acknowledged) return applied(lease.windowId, { alertId, notificationId: alert.notificationId, reminderId: task.id, action });
    return result?.status === 'rejected' ? result : rejected('unavailable', 'The original notification and ledger were not atomically updated.');
  }
  // Shared authored-time pump for both mounted-window leases and the closed,
  // domain-only lease; no synthetic window is ever created.
  async function pump(lease) {
    const deliveries = [];
    for (let i = 0; i < 4096; i++) {
      if (!lease.present()) return deliveries.length ? { status: 'applied', deliveries } : stale();
      const current = lease.refresh ? lease.refresh() : leaseFor(lease.windowId); if (!current) return deliveries.length ? { status: 'applied', deliveries } : stale();
      const eligible = state.tasks.find(task => { const list = state.lists.find(row => row.id === task.listId), alert = state.alerts.find(row => row.reminderId === task.id && row.revision === task.revision); return state.accounts.find(row => row.id === list?.accountId)?.enabled && !task.completed && state.preferences.notifications && (alert ? alert.status === 'snoozed' && alert.snoozeAt <= now() : reminderAlertDue(state, task) !== null && reminderAlertDue(state, task) <= now()); });
      if (!eligible) return { status: 'applied', deliveries };
      const result = await deliver(current, eligible.id); if (result.status !== 'applied') return { ...result, deliveries };
      deliveries.push({ reminderId: result.reminderId, notificationId: result.notificationId, alertId: result.alertId });
    }
    return { status: 'applied', deliveries };
  }
  const implementations = {
    'view.set': (lease, payload) => mutation(lease, (data, win) => { if (payload.listId !== undefined && payload.listId !== null && !data.lists.some(row => row.id === payload.listId)) return stale(); if (payload.calendarDate && !reminderDateValid(payload.calendarDate)) return rejected('invalid_arguments', 'Use an actual Gregorian calendar date.'); Object.assign(win, payload); win.selectedId = null; }),
    'task.select': (lease, p) => mutation(lease, (data, win) => { if (!writable(data, p.reminderId)) return stale(); win.selectedId = p.reminderId; }),
    'task.new': lease => mutation(lease, (data, win) => { if (win.editor) return rejected('unavailable', 'Save or cancel the original inspector first.'); const listId = win.listId ?? data.preferences.defaultListId; if (!data.lists.some(row => row.id === listId && data.accounts.find(a => a.id === row.accountId)?.enabled)) return rejected('unavailable', 'Create or enable a list first.'); win.editor = { ...emptyReminderSpec(listId), title: 'New reminder' }; win.editorId = null; win.editorRevision = null; win.sheet = 'inspector'; }),
    'task.edit': (lease, p) => mutation(lease, (data, win) => { if (win.editor) return rejected('unavailable', 'Save or cancel the original inspector first.'); const task = writable(data, p.reminderId); if (!task) return stale(); win.selectedId = task.id; win.editorId = task.id; win.editorRevision = task.revision; win.editor = reminderSpec(task); win.sheet = 'inspector'; }),
    'editor.set': (lease, p) => mutation(lease, (_, win) => { if (!win.editor || win.sheet !== 'inspector') return stale(); win.editor = p.spec; }),
    'editor.save': lease => mutation(lease, (data, win) => { if (!win.editor || win.sheet !== 'inspector') return stale(); let task = win.editorId && writable(data, win.editorId); if (win.editorId && (!task || task.revision !== win.editorRevision)) return rejected('stale_target','The original reminder changed in another session. Cancel and reopen its inspector; your draft is retained.'); if (task) { Object.assign(task, win.editor); invalidate(data, task); } else { task = { id: reminderAllocateId(data, 'reminder'), ...win.editor, completed: false, completedAt: null, revision: 1 }; data.tasks.push(task); } win.selectedId = task.id; win.listId = task.listId; win.editor = null; win.editorId = null; win.editorRevision = null; win.sheet = 'none'; return { reminderId: task.id }; }, true),
    'editor.cancel': lease => mutation(lease, (_, win) => { win.editor = null; win.editorId = null; win.editorRevision = null; win.sheet = 'none'; }),
    'task.setCompleted': async (lease, p) => { const alert = state.alerts.find(row => row.reminderId === p.reminderId && row.revision === state.tasks.find(task => task.id === p.reminderId)?.revision && ['delivered', 'snoozed'].includes(row.status)); if (p.completed && alert) return transition(lease, alert.id, 'complete'); return mutation(lease, data => { const task = writable(data, p.reminderId); if (!task) return stale(); return complete(data, task, p.completed); }, true); },
    'task.delete': (lease, p) => mutation(lease, (data, win) => { if (!writable(data, p.reminderId)) return stale(); if (data.preferences.confirmDelete && p.confirmed !== true) { win.selectedId = p.reminderId; win.sheet = 'delete-task'; return { confirmationRequired: true }; } data.tasks = data.tasks.filter(row => row.id !== p.reminderId); cleanup(data); win.sheet = 'none'; }, true),
    'task.move': (lease, p) => mutation(lease, data => { const task = writable(data, p.reminderId), list = data.lists.find(row => row.id === p.listId); if (!task || !list || !data.accounts.find(row => row.id === list.accountId)?.enabled) return stale(); task.listId = list.id; if (p.index !== undefined) { data.tasks = data.tasks.filter(row => row !== task); const siblings = data.tasks.filter(row => row.listId === list.id), before = siblings[p.index]; data.tasks.splice(before ? data.tasks.indexOf(before) : data.tasks.length, 0, task); } return { reminderId: task.id }; }, true),
    'task.reorder': (lease, p) => mutation(lease, data => { const task = writable(data, p.reminderId); if (!task || data.preferences.sort !== 'manual') return rejected('unavailable', 'Manual sorting is required to reorder reminders.'); data.tasks = data.tasks.filter(row => row !== task); const before = data.tasks.filter(row => row.listId === task.listId)[p.index]; data.tasks.splice(before ? data.tasks.indexOf(before) : data.tasks.length, 0, task); }, true),
    'task.flag': (lease, p) => mutation(lease, data => { const task = writable(data, p.reminderId); if (!task) return stale(); task.flagged = p.flagged; }, true),
    'task.myDay': (lease, p) => mutation(lease, data => { const task = writable(data, p.reminderId); if (!task) return stale(); task.myDay = p.enabled ? reminderDate(now()) : null; }, true),
    'list.save': (lease, p) => mutation(lease, (data, win) => { if (!data.accounts.some(row => row.id === p.accountId && row.enabled)) return stale(); let list = p.listId && data.lists.find(row => row.id === p.listId); if (p.listId && !list) return stale(); if (list) Object.assign(list, { accountId: p.accountId, name: p.name, color: p.color }); else { list = { id: reminderAllocateId(data, 'reminder-list'), accountId: p.accountId, name: p.name, color: p.color, sharedWith: [] }; data.lists.push(list); } win.listId = list.id; win.view = 'list'; win.sheet = 'none'; if (data.preferences.defaultListId === null) data.preferences.defaultListId = list.id; return { listId: list.id }; }, true),
    'list.delete': (lease, p) => mutation(lease, (data, win) => { if (!data.lists.some(row => row.id === p.listId)) return stale(); if (p.confirmed !== true) { win.editingListId = p.listId; win.sheet = 'delete-list'; return { confirmationRequired: true }; } data.lists = data.lists.filter(row => row.id !== p.listId); data.tasks = data.tasks.filter(row => row.listId !== p.listId); cleanup(data); win.sheet = 'none'; }, true),
    'list.reorder': (lease, p) => mutation(lease, data => { const row = data.lists.find(row => row.id === p.listId); if (!row) return stale(); data.lists = data.lists.filter(item => item !== row); data.lists.splice(Math.min(p.index, data.lists.length), 0, row); }, true),
    'list.share': (lease, p) => mutation(lease, (data, win) => { const list = data.lists.find(row => row.id === p.listId); if (!list) return stale(); list.sharedWith = p.members; win.sheet = 'none'; return { listId: list.id, fictional: true }; }, true),
    'account.save': (lease, p) => mutation(lease, data => { let row = p.accountId && data.accounts.find(row => row.id === p.accountId); if (p.accountId && !row) return stale(); if (row) Object.assign(row, { name: p.name, provider: p.provider, enabled: p.enabled }); else { row = { id: reminderAllocateId(data, 'reminder-account'), name: p.name, provider: p.provider, enabled: p.enabled }; data.accounts.push(row); } return { accountId: row.id, fictional: true }; }, true),
    'account.delete': (lease, p) => mutation(lease, data => { const row = data.accounts.find(row => row.id === p.accountId); if (!row) return stale(); if (!p.confirmed) return rejected('invalid_arguments', 'Confirm that the account and its local lists will be deleted.'); const ids = new Set(data.lists.filter(list => list.accountId === row.id).map(list => list.id)); data.accounts = data.accounts.filter(item => item !== row); data.lists = data.lists.filter(list => !ids.has(list.id)); data.tasks = data.tasks.filter(task => !ids.has(task.listId)); cleanup(data); }, true),
    'preferences.set': (lease, p) => mutation(lease, data => { Object.assign(data.preferences, p.preferences); }),
    'sheet.open': (lease, p) => mutation(lease, (data, win) => { if (win.editor) return rejected('unavailable', 'Save or cancel the original inspector first.'); if (p.listId && !data.lists.some(row => row.id === p.listId)) return stale(); win.sheet = p.sheet; win.editingListId = p.listId ?? null; }),
    'sheet.close': lease => mutation(lease, (_, win) => { if (win.editor) return rejected('unavailable', 'Use Save or Cancel for the original inspector.'); win.sheet = 'none'; win.editingListId = null; }),
    'calendar.open': async (lease, p) => { const task = writable(state, p.reminderId); if (!task || task.dueAt === null || !lease.guard()) return stale(); if (typeof ctx.openCalendar !== 'function') return rejected('unavailable', 'The mounted canonical Calendar destination bridge is required.'); const result = await ctx.openCalendar({ reminderId: task.id, due: task.hasTime ? task.dueAt : reminderDate(task.dueAt) }, { guard: lease.guard, windowId: lease.windowId }); return result?.status === 'applied' ? applied(lease.windowId, { destination: result.target ?? result, reminderId: task.id }) : result?.status === 'rejected' ? result : rejected('unavailable', 'Calendar did not select the actual due date.'); },
    'calendar.assign': (lease, p) => mutation(lease, data => { const task = writable(data, p.reminderId); if (!task || !reminderDateValid(p.date)) return stale(); task.dueAt = Date.parse(`${p.date}T09:00:00Z`); task.hasTime = true; if (task.recurrence?.until !== null && task.recurrence?.until < task.dueAt) task.recurrence.until = null; invalidate(data, task); }, true),
    'alerts.process': async lease => {
      const result = await pump(lease);
      return result.status === 'applied' ? applied(lease.windowId, { deliveries: result.deliveries }) : result;
    },
    'location.trigger': (lease, p) => { const task = writable(state, p.reminderId); if (!task?.location || task.location.transition !== p.transition) return rejected('invalid_arguments', 'Choose the configured explicit fictional location transition.'); return deliver(lease, task.id, 'location'); },
    'alert.snooze': (lease, p) => transition(lease, p.alertId, 'snooze', p.minutes),
    'alert.complete': (lease, p) => transition(lease, p.alertId, 'complete'),
    'alert.dismiss': (lease, p) => transition(lease, p.alertId, 'dismiss'),
    'focus': async (lease, p) => { if (!lease.guard() || typeof lease.view.focus !== 'function' || await lease.view.focus(p.controlId, lease.guard) !== true || !lease.guard()) return stale(); return applied(lease.windowId, { controlId: p.controlId }); },
    'scroll': async (lease, p) => { if (!lease.guard() || typeof lease.view.scroll !== 'function') return stale(); const value = await lease.view.scroll(p, lease.guard); return lease.guard() && value ? applied(lease.windowId, value) : stale(); },
    'window.close': async lease => { if (lease.session.editor) return rejected('unavailable', 'Save or cancel the inspector before closing.'); if (typeof ctx.closeWindow !== 'function') return rejected('unavailable', 'The real managed-window close bridge is required.'); const result = await ctx.closeWindow(lease.windowId, { isCurrent: lease.guard }); return result?.status === 'applied' || result === true ? applied(lease.windowId) : result?.status === 'rejected' ? result : stale(); },
    'window.new': async lease => { if (typeof ctx.createWindow !== 'function') return rejected('unavailable', 'The real managed-window creation bridge is required.'); const id = await ctx.createWindow('reminders', { isCurrent: lease.guard }); if (typeof id !== 'string') return stale(); await ctx.tick(); const destination = ctx.getView(id); return destination?.available() === true ? applied(lease.windowId, { newWindowId: id }) : rejected('unavailable', 'The created Reminders window has no mounted native view.'); },
    'app.quit': async lease => { if (state.windows.some(win => win.editor)) return rejected('unavailable', 'Save or cancel every inspector before quitting.'); if (typeof ctx.quitApp !== 'function') return rejected('unavailable', 'The actual managed application quit bridge is required.'); const result = await ctx.quitApp('reminders', { guard: lease.guard, windowId: lease.windowId }); return result?.status === 'applied' ? applied(lease.windowId) : result?.status === 'rejected' ? result : rejected('unavailable', 'The application did not retire its actual windows.'); },
  };
  for (const action of ['undo', 'redo']) implementations[`edit.${action}`] = async lease => {
    const history = histories.get(lease.windowId), from = history?.[action], entry = from?.at(-1); if (!entry || state.alerts.length) return rejected('unavailable', 'There is no safe local history entry; delivered reminders cannot be undone.');
    const expected = action === 'undo' ? entry.after : entry.before;
    if (JSON.stringify(dataSnapshot(state)) !== JSON.stringify(expected)) return stale();
    const result = await mutation(lease, data => { Object.assign(data, copyCanonicalData(action === 'undo' ? entry.before : entry.after)); cleanup(data); });
    if (result.status === 'applied') { from.pop(); history[action === 'undo' ? 'redo' : 'undo'].push(entry); } return result;
  };
  for (const action of ['copy', 'cut', 'paste', 'selectAll']) implementations[`edit.${action}`] = async lease => {
    if (typeof lease.view.selection !== 'function' || !lease.guard()) return stale();
    const selection = lease.view.selection(); if (!selection || !['title', 'notes', 'search'].includes(selection.controlId)) return rejected('unavailable', 'Focus the actual search, title or notes field first.');
    if (action === 'selectAll') return await lease.view.selectAll(lease.guard) === true && lease.guard() ? applied(lease.windowId) : stale();
    const canonical = selection.controlId === 'search' ? lease.session.query : lease.session.editor?.[selection.controlId];
    if (typeof canonical !== 'string' || selection.value !== canonical) return stale();
    let replacement = '';
    if (action === 'copy' || action === 'cut') { if (typeof ctx.setClipboard !== 'function') return rejected('unavailable', 'The actual single fictional clipboard bridge is required.'); const copied = await ctx.setClipboard({ kind: 'text', text: canonical.slice(selection.start, selection.end), fileIds: [] }, { guard: lease.guard, windowId: lease.windowId }); if (!lease.guard()) return stale(); if (copied?.status !== 'applied') return copied?.status === 'rejected' ? copied : rejected('unavailable', 'The clipboard did not commit.'); if (action === 'copy') return applied(lease.windowId); }
    else { if (typeof ctx.getClipboard !== 'function') return rejected('unavailable', 'The actual fictional clipboard is required.'); const clipboard = await ctx.getClipboard(); if (!lease.guard()) return stale(); if (clipboard?.kind !== 'text' || typeof clipboard.text !== 'string') return rejected('unavailable', 'The clipboard contains no text.'); replacement = clipboard.text; }
    const next = canonical.slice(0, selection.start) + replacement + canonical.slice(selection.end);
    const candidate = copyCanonicalData(state), win = reminderWindow(candidate, lease.windowId); if (selection.controlId === 'search') win.query = next; else win.editor[selection.controlId] = next;
    const error = candidateCheck(candidate, lease.guard); if (error) return error;
    if (typeof lease.view.replaceSelection !== 'function' || lease.view.replaceSelection(selection, replacement, lease.guard) !== true || !lease.guard()) return stale();
    commit(state, candidate); return applied(lease.windowId);
  };
  const handlers = Object.fromEntries(Object.keys(reminderCommandPayloads).map(short => [`reminders.${short}`, async (target, payload = {}) => {
    if (!reminderValueConforms(target, targetSchema) || !reminderValueConforms(payload, reminderCommandPayloads[short])) return rejected('invalid_arguments', 'Use the closed Reminders target and payload.');
    const windowId = target.windowId, lease = leaseFor(windowId); if (!lease) return stale();
    const ownedPayload = copyCanonicalData(payload);
    if (short === 'editor.save' && lease.session.editorId !== null) {
      const base = editorBases.get(windowId), task = state.tasks.find(row=>row.id===lease.session.editorId);
      if (!base || !task || base.task !== task || base.spec !== JSON.stringify(reminderSpec(task))) return rejected('stale_target','The original reminder content changed in another session. Cancel and reopen its inspector; your draft is retained.');
    }
    let result;
    try { result = await implementations[short](lease, ownedPayload); } catch (error) { return rejected('unavailable', error?.message ?? 'The real reminder operation is unavailable.'); }
    if (result?.status === 'applied') {
      if (short === 'task.edit' && lease.present()) { const task=state.tasks.find(row=>row.id===lease.session.editorId); if(task)editorBases.set(windowId,{task,spec:JSON.stringify(reminderSpec(task))}); }
      for (const id of editorBases.keys()) if (!reminderWindow(state,id)?.editorId) editorBases.delete(id);
      if (lease.present()) { try { await ctx.tick(); if (lease.present()) ctx.focusWindow(windowId); } catch { return {...result,presentationAvailable:false}; } }
    }
    return result;
  }]));
  // Domain-only lease for the authored pump: closed Reminders applications
  // keep delivering due alerts without any window, view or fabricated session.
  const domainLease = (sourceCurrent, rebase) => {
    if (!sourceCurrent() || !validateRemindersState(state, ctx.profile).ok || !remindersMutable(state)) return null;
    const time = now();
    let snapshot = JSON.stringify(state);
    const present = () => sourceCurrent();
    const current = () => present() && remindersMutable(state) && JSON.stringify(state) === snapshot && now() === time;
    const lease = { windowId: null, window: null, view: null, session: null, guard: current, present, refresh: () => lease, rebase: () => { rebase(); snapshot = JSON.stringify(state); } };
    return lease;
  };
  // Parent invokes this only from its shared authored clock, never host timers.
  async function clockChanged(now) {
    if (!alive() || !Number.isSafeInteger(now) || now < 0 || now > 4102444800000
      || !validateRemindersState(state, ctx.profile).ok) return { ok: false, message: 'Invalid shared scene clock or Reminders source.', delivered: [] };
    const request = ++clockRequest, profile = ctx.profile, authoredTime = ctx.getSceneTime();
    if (reminderEpoch(authoredTime) !== now) return { ok: false, message: 'The pump time must match the actual authored scene clock.', delivered: [] };
    let unchanged = retainRemindersGraph(state);
    const rebase = () => { unchanged = retainRemindersGraph(state); lastClock = now; };
    const sourceCurrent = () => alive() && ctx.profile === profile && unchanged() && clockRequest === request
      && Object.is(ctx.getSceneTime(), authoredTime);
    const previous = lastClock;
    if (now < previous || !state.preferences.notifications) {
      if (!sourceCurrent()) return { ok: false, message: 'Original scene clock ownership changed.', delivered: [] };
      lastClock = now; return { ok: true, delivered: [] };
    }
    const lease = domainLease(sourceCurrent, rebase);
    if (!lease) return { ok: false, message: 'Original Reminders ledger is unavailable.', delivered: [] };
    const result = await pump(lease);
    const delivered = (result.deliveries ?? []).map(row => row.notificationId);
    if (result.status !== 'applied') return { ok: false, message: result.error?.message ?? 'The authored reminder pump stopped.', delivered };
    // Real acknowledgments are final. Only an empty pump needs a final source
    // check; the clock/source lease already advanced inside each own onCommit.
    if (!delivered.length) {
      if (!sourceCurrent()) return { ok: false, message: 'Original scene clock ownership changed.', delivered };
      lastClock = now;
    }
    return { ok: true, delivered };
  }
  // Staged atomic dismissal for the Root-owned notification center batch
  // clear: the parent reserves the signed text delta and invokes commit
  // synchronously only after all preparations and guards/quota succeed.
  function prepareNotificationDismissals(actualIDs, ownership) {
    if (!alive() || !Array.isArray(actualIDs) || actualIDs.some(id => typeof id !== 'string')
      || !validateRemindersState(state, ctx.profile).ok) return rejected('stale_target', 'The original Reminders dismissal source is unavailable.');
    const unchanged = retainRemindersGraph(state), ids = new Set(actualIDs), candidate = copyCanonicalData(state);
    const profile = ctx.profile, authoredTime = ctx.getSceneTime();
    for (const row of candidate.alerts) if (ids.has(row.notificationId) && ['delivered', 'snoozed'].includes(row.status)) { row.status = 'dismissed'; row.snoozeAt = null; }
    const checked = validateRemindersState(candidate, ctx.profile);
    if (!checked.ok) return rejected('invalid_arguments', checked.message);
    const delta = remindersTextUnits(candidate) - remindersTextUnits(state);
    let committed = false;
    const current = () => !committed && alive() && ctx.profile === profile && Object.is(ctx.getSceneTime(), authoredTime)
      && unchanged() && remindersMutable(state) && ownershipCurrent(ownership);
    const commitStaged = () => {
      if (!current() || typeof ctx.canCommit === 'function' && ctx.canCommit(delta) !== true || !current()) return false;
      commit(state, candidate); committed = true; return true;
    };
    return { current, delta, commit: commitStaged };
  }
  return { handlers, clockChanged, prepareNotificationDismissals, targets: () => alive() ? state.windows.filter(row => leaseFor(row.windowId)).map(row => ({ windowId: row.windowId })) : [], windowOpened(window, options = {}) {
    const windowId = typeof window === 'string' ? window : window.id; if (!alive() || reminderWindow(state, windowId)) return false;
    const listId = state.lists.some(row => row.id === options.listId) ? options.listId : state.preferences.defaultListId;
    const candidate = copyCanonicalData(state); candidate.windows.push({ windowId, listId, view: 'list', query: '', selectedId: null, showCompleted: state.preferences.showCompleted, sidebar: true, calendar: false, calendarDate: reminderDate(now()), sheet: 'none', editorId: null, editorRevision: null, editor: null, editingListId: null });
    const error = candidateCheck(candidate, alive); if (error) return false; commit(state, candidate); return true;
  }, windowClosed(window) { const id = typeof window === 'string' ? window : window.id, session = reminderWindow(state, id); if (!alive() || session?.editor) return false; state.windows.splice(0, state.windows.length, ...state.windows.filter(row => row.windowId !== id)); histories.delete(id); editorBases.delete(id); return true; }, appQuit() { if (!alive() || state.windows.some(row => row.editor)) return false; state.windows.splice(0); histories.clear(); editorBases.clear(); return true; } };
}
export function remindersMenuProvider(state, windowId, profile) {
  const win = reminderWindow(state, windowId), task = state.tasks.find(row => row.id === win?.selectedId), list = state.lists.find(row => row.id === win?.listId), windows = profile.id.includes('windows');
  const item = (label, name, payload = {}, enabled = true, shortcut = '') => ({ label, command: `reminders.${name}`, target: { windowId }, payload, enabled, shortcut });
  return [
    { id: 'app', label: windows ? 'To Do' : 'Reminders', items: [item('About ' + (windows ? 'Microsoft To Do' : 'Reminders'), 'sheet.open', { sheet: 'about' }), item(windows ? 'Settings' : profile.id.includes('sonoma') || profile.id.includes('golden') ? 'Settings…' : 'Preferences…', 'sheet.open', { sheet: 'preferences' }, true, '⌘,'), item('Accounts…', 'sheet.open', { sheet: 'accounts' }), item('Quit', 'app.quit', {}, true, '⌘Q')] },
    { id: 'file', label: 'File', items: [item('New Reminder', 'task.new', {}, true, '⌘N'), item('New List…', 'sheet.open', { sheet: 'list' }, true, '⇧⌘N'), item('New Window', 'window.new'), item('Rename List…', 'sheet.open', { sheet: 'list', ...(list ? { listId: list.id } : {}) }, !!list), item('Share List…', 'sheet.open', { sheet: 'share', ...(list ? { listId: list.id } : {}) }, !!list), item('Delete List…', 'list.delete', list ? { listId: list.id } : {}, !!list), item('Close Window', 'window.close', {}, true, '⌘W')] },
    { id: 'edit', label: 'Edit', items: [item('Undo', 'edit.undo', {}, true, '⌘Z'), item('Redo', 'edit.redo', {}, true, '⇧⌘Z'), item('Cut', 'edit.cut', {}, true, '⌘X'), item('Copy', 'edit.copy', {}, true, '⌘C'), item('Paste', 'edit.paste', {}, true, '⌘V'), item('Select All', 'edit.selectAll', {}, true, '⌘A'), item('Delete Reminder…', 'task.delete', task ? { reminderId: task.id } : {}, !!task), item('Show Info', 'task.edit', task ? { reminderId: task.id } : {}, !!task)] },
    { id: 'view', label: 'View', items: [item(win?.showCompleted ? 'Hide Completed' : 'Show Completed', 'view.set', { showCompleted: !win?.showCompleted }), item(win?.sidebar ? 'Hide Sidebar' : 'Show Sidebar', 'view.set', { sidebar: !win?.sidebar }), item(win?.calendar ? 'Hide Calendar' : 'Show Calendar', 'view.set', { calendar: !win?.calendar }), ...['scheduled', 'today', 'all', 'flagged', 'completed', ...(windows ? ['my-day'] : [])].map(view => item(view === 'my-day' ? 'My Day' : view.charAt(0).toUpperCase() + view.slice(1), 'view.set', { view })), item('Find', 'focus', { controlId: 'search' }, true, '⌘F'), ...['manual', 'due', 'priority', 'title'].map(sort => item(`Sort by ${sort}`, 'preferences.set', { preferences: { ...state.preferences, sort } }))] },
    { id: 'reminder', label: windows ? 'Task' : 'Reminder', items: [item(task?.completed ? 'Mark Incomplete' : 'Mark Completed', 'task.setCompleted', task ? { reminderId: task.id, completed: !task.completed } : {}, !!task), item(task?.flagged ? 'Remove Flag' : 'Flag', 'task.flag', task ? { reminderId: task.id, flagged: !task.flagged } : {}, !!task), item('Open Due Date in Calendar', 'calendar.open', task ? { reminderId: task.id } : {}, task?.dueAt !== null && !!task), ...state.lists.filter(row => row !== list).map(row => item(`Move to ${row.name}`, 'task.move', task ? { reminderId: task.id, listId: row.id } : {}, !!task)), item('Process Authored-Time Alerts', 'alerts.process')] },
    { id: 'window', label: 'Window', items: [item('New Window', 'window.new'), ...state.windows.map(row => ({ ...item(row.windowId, 'focus', { controlId: 'search' }), target: { windowId: row.windowId } }))] },
    { id: 'help', label: 'Help', items: [item(windows ? 'To Do Help' : 'Reminders Help', 'sheet.open', { sheet: 'help' })] },
  ];
}

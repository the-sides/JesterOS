import { rejected } from './feature-commands.js';
import { object } from './command-schema.js';
import { calendarCommandPayloads, calendarCatalog } from './calendar-catalog.js';
import { CALENDAR_PROFILES, calendarStateSchema, calendarValueConforms, calendarWindow, calendarAllocateId, calendarDateParts, calendarDateString, calendarLocalString, calendarDateAdd, calendarTimestamp, calendarOccurrences, calendarOccurrenceExists, calendarOccurrenceCountBefore, createCalendarEvent, acceptCalendarInvitation, validateCalendarState } from './calendar-state.js';
import { importCalendarICS, exportCalendarICS } from './calendar-ics.js';
import { applyCanonicalData, copyCanonicalData, canonicalStringUnits } from './canonical-data.js';
export { calendarCatalog };
const failure = (code, message) => rejected(code, message);
const targetSchema = object({ windowId: { type: 'string', minLength: 1, maxLength: 128 } });
const stale = () => failure('stale_target', 'The original Calendar state, window, native view or event changed.');
const invalid = message => failure('invalid_arguments', message ?? 'Use the closed Calendar target and payload.');
const success = (target, extra = {}) => ({ status: 'applied', target, ...extra });
const sceneTimestamp = value => typeof value === 'number' ? value : Date.parse(value);
function shiftWallTime(base, original, moved, zone) {
  const wall = value => { const parts = calendarDateParts(value, zone); return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) + value % 1000; };
  const shifted = wall(base) + wall(moved) - wall(original);
  return calendarTimestamp(new Date(shifted).toISOString().slice(0, 19), zone) + ((shifted % 1000) + 1000) % 1000;
}
// Capture the original graph, including nested arrays, descriptor flags and row
// identities. A changed accessor is rejected without ever invoking it.
function retainCalendarGraph(root) {
  const snapshots = [], seen = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('Calendar source requires data descriptors.');
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
const commitState = (state, candidate) => applyCanonicalData(state, candidate);
export function createCalendarCommands(ctx) {
  const state = ctx.getState(); let sequence = 0, clockRequest = 0, lastClock = sceneTimestamp(ctx.getSceneTime());
  if (!Number.isFinite(lastClock)) lastClock = Date.parse(ctx.profile.defaults.sceneTime);
  const alive = () => ctx.getState() === state && (typeof ctx.alive !== 'function' || ctx.alive()) && CALENDAR_PROFILES.includes(ctx.profile.id);
  const owner = windowId => {
    const window = ctx.getWindow(windowId), view = ctx.getView(windowId), win = calendarWindow(state, windowId);
    if (!alive() || !window || !win || !view || !ctx.available(window) || view.available() !== true) return null;
    const version = ++sequence, arrays = [state.windows, state.events, state.calendars, state.invitations, state.accounts, state.alertDeliveries], unchanged = retainCalendarGraph(state);
    const current = () => alive() && sequence === version && unchanged() && ctx.getWindow(windowId) === window && ctx.getView(windowId) === view && calendarWindow(state, windowId) === win && ctx.available(window) && view.available() === true;
    const queryIndependentSnapshot = () => JSON.stringify({ ...state, windows: state.windows.map(row => row === win ? { ...row, query: null } : row) });
    const expectedPresentation = queryIndependentSnapshot();
    const nativeCurrent = () => alive() && ctx.getWindow(windowId) === window && ctx.getView(windowId) === view && calendarWindow(state, windowId) === win && ctx.available(window) && view.available() === true && arrays.every((array, index) => array === [state.windows, state.events, state.calendars, state.invitations, state.accounts, state.alertDeliveries][index]) && queryIndependentSnapshot() === expectedPresentation;
    return { window, win, view, current, nativeCurrent };
  };
  const origin = (lease, eventId) => ({ appId: 'calendar', windowId: lease.win.windowId, ...(eventId ? { eventId } : {}) });
  function mutate(lease, change) {
    if (!lease.current()) return stale();
    const candidate = copyCanonicalData(state), candidateWin = calendarWindow(candidate, lease.win.windowId);
    const extra = change(candidate, candidateWin);
    if (extra?.status === 'rejected') return extra;
    for (const event of candidate.events) {
      const before = state.events.find(row => row.id === event.id);
      const originalIds = new Set(before ? [...before.attachments, ...before.exceptions.flatMap(row => row.fields?.attachments ?? [])].map(row => row.fileId) : []);
      const incoming = [...event.attachments, ...event.exceptions.flatMap(row => row.fields?.attachments ?? [])];
      for (const attachment of incoming) if (!originalIds.has(attachment.fileId)) {
        if (typeof ctx.getFile !== 'function') return failure('unavailable', 'The canonical file lookup bridge is required for imported attachments.');
        const file = ctx.getFile(attachment.fileId);
        if (!file || file.id !== attachment.fileId) return failure('stale_target', 'An imported attachment does not reference an existing canonical file.');
        attachment.name = file.name;
      }
    }
    const notificationIds = [];
    for (const delivery of state.alertDeliveries) {
      if (!['delivered', 'snoozed'].includes(delivery.status)) continue;
      const row = candidate.alertDeliveries.find(row => row.id === delivery.id);
      const beforeEvent = state.events.find(event => event.id === delivery.eventId), afterEvent = candidate.events.find(event => event.id === delivery.eventId);
      const exception = beforeEvent?.exceptions.find(row => row.originalStart === delivery.occurrenceStart);
      const calendarId = exception?.fields?.calendarId ?? beforeEvent?.calendarId;
      const beforeCalendar = state.calendars.find(row => row.id === calendarId), afterCalendar = candidate.calendars.find(row => row.id === calendarId);
      const beforeAccount = state.accounts.find(row => row.id === beforeCalendar?.accountId), afterAccount = candidate.accounts.find(row => row.id === afterCalendar?.accountId);
      const changed = !row || JSON.stringify(beforeEvent) !== JSON.stringify(afterEvent)
        || JSON.stringify(beforeCalendar) !== JSON.stringify(afterCalendar) || JSON.stringify(beforeAccount) !== JSON.stringify(afterAccount)
        || ['alertsEnabled', 'timeZone', 'defaultAlert'].some(key => state.preferences[key] !== candidate.preferences[key]);
      if (!changed) continue;
      if (delivery.status === 'delivered' && delivery.notificationId) notificationIds.push(delivery.notificationId);
      if (row) {
        const afterException = afterEvent?.exceptions.find(item => item.originalStart === row.occurrenceStart);
        if (!afterEvent || afterException?.cancelled || !(afterException?.fields?.alerts ?? afterEvent.alerts).includes(row.minutes) || !calendarOccurrenceExists(afterEvent, row.occurrenceStart))
          candidate.alertDeliveries.splice(candidate.alertDeliveries.indexOf(row), 1);
        else { row.status = 'dismissed'; row.snoozeUntil = null; }
      }
    }
    const checked = validateCalendarState(candidate, ctx.profile); if (!checked.ok) return invalid(checked.message);
    const delta = canonicalStringUnits(candidate) - canonicalStringUnits(state);
    if (!notificationIds.length && typeof ctx.canCommit === 'function' && !ctx.canCommit(delta)) return failure('limit_exceeded', 'Complete-scene Calendar text budget exceeded.');
    if (!lease.current()) return stale();
    const applied = success({ windowId: lease.win.windowId }, extra ?? {});
    if (!notificationIds.length) { commitState(state, candidate); return applied; }
    if (typeof ctx.updateNotifications !== 'function') return failure('unavailable', 'The actual atomic notification batch bridge is unavailable.');
    return commitNotificationMutation(lease.current, candidate, [...new Set(notificationIds)], delta, applied);
  }
  async function commitNotificationMutation(current, candidate, notificationIds, delta, applied) {
    let acknowledged = false, result;
    const onCommit = actualIds => {
      if (acknowledged || !Array.isArray(actualIds) || actualIds.length !== notificationIds.length
        || actualIds.some((id, index) => id !== notificationIds[index]) || !current()
        || ctx.canCommit?.(delta) === false || !current()) return false;
      commitState(state, candidate); acknowledged = true; return true;
    };
    try { result = await ctx.updateNotifications(notificationIds, { dismissed: true, reserveTextUnits: delta, onCommit }, current); }
    catch (error) { if (!acknowledged) return current() ? failure('unavailable', error?.message ?? 'Notification batch failed.') : stale(); }
    if (acknowledged) return applied;
    return result?.status === 'rejected' ? result : failure('unavailable', 'Notification batch did not acknowledge the exact atomic Calendar mutation.');
  }
  function prepareNotificationDismissals(actualIDs, ownership) {
    if (!alive() || !Array.isArray(actualIDs) || actualIDs.some(id => typeof id !== 'string')
      || !calendarValueConforms(state, calendarStateSchema)) return failure('stale_target', 'Original Calendar dismissal source is unavailable.');
    const unchanged = retainCalendarGraph(state), ids = new Set(actualIDs), candidate = copyCanonicalData(state);
    for (const row of candidate.alertDeliveries) if (ids.has(row.notificationId) && ['delivered', 'snoozed'].includes(row.status)) {
      row.status = 'dismissed'; row.snoozeUntil = null;
    }
    const checked = validateCalendarState(candidate, ctx.profile);
    if (!checked.ok) return invalid(checked.message);
    const delta = canonicalStringUnits(candidate) - canonicalStringUnits(state);
    let committed = false;
    const current = () => !committed && alive() && unchanged() && ownershipCurrent(ownership);
    const commit = () => {
      if (!current() || ctx.canCommit?.(delta) === false || !current()) return false;
      commitState(state, candidate); committed = true; return true;
    };
    return { current, delta, commit };
  }
  async function bridge(lease, name, args) {
    if (typeof ctx[name] !== 'function') return { error: failure('unavailable', `The real parent ${name} bridge is unavailable.`) };
    if (!lease.current()) return { error: stale() };
    const result = await ctx[name](...args, lease.current);
    if (!result || result.ok === false) return { error: failure('unavailable', result?.message ?? `The ${name} bridge did not apply.`) };
    if (result.status === 'rejected') return { error: result };
    if (result.status !== 'applied') return { error: failure('unavailable', `The ${name} bridge did not apply.`) };
    return { result, applied: { ...result, ...(result.target ? { destination: result.target } : {}), target: { windowId: lease.win.windowId } } };
  }
  function writable(data, eventId) {
    const event = data.events.find(row => row.id === eventId), cal = data.calendars.find(row => row.id === event?.calendarId), account = data.accounts.find(row => row.id === cal?.accountId);
    return event && cal && !cal.readOnly && account?.enabled ? event : null;
  }
  function retireEventDependents(data, eventId) {
    data.alertDeliveries = data.alertDeliveries.filter(row => row.eventId !== eventId);
    data.invitations = data.invitations.filter(row => row.eventId !== eventId);
    for (const win of data.windows) if (win.selectedEventId === eventId) { win.selectedOccurrence = null; if (!data.events.some(row => row.id === eventId)) { win.selectedEventId = null; if (win.sheet === 'event') win.sheet = null; } }
  }
  function editEvent(data, payload, deleting = false) {
    const event = writable(data, payload.eventId); if (!event) return failure('stale_target', 'The original writable event is unavailable.');
    const scope = event.recurrence ? payload.scope : 'series';
    if (event.recurrence && !scope) return invalid('Choose occurrence, future, or series for a recurring event.');
    const originalStart = payload.occurrenceStart ?? event.start;
    if (!calendarOccurrenceExists(event, originalStart)) return failure('stale_target', 'The original recurring occurrence no longer exists.');
    for (const win of data.windows) if (win.selectedEventId === event.id) win.selectedOccurrence = null;
    let editedEventId = event.id;
    if (scope === 'occurrence') {
      if (payload.event && Object.keys(payload.event).some(key => !['start', 'end', 'title', 'calendarId', 'allDay', 'location', 'notes', 'url', 'timeZone', 'travelMinutes', 'alerts', 'invitees', 'organizer', 'recurrence'].includes(key))) return invalid();
      const existingException = event.exceptions.find(row => row.originalStart === originalStart);
      if (existingException?.cancelled) return failure('stale_target', 'The selected occurrence is cancelled.');
      const occurrence = calendarOccurrences({ ...data, events: [event], preferences: { ...data.preferences, timeZone: event.timeZone === 'floating' ? 'UTC' : data.preferences.timeZone, showDeclined: true } }, (existingException?.start ?? originalStart) - 172800000, (existingException?.end ?? originalStart + event.end - event.start) + 172800000, { visibleOnly: false }).find(row => row.originalStart === originalStart);
      if (!occurrence) return failure('stale_target', 'The selected occurrence is cancelled.');
      if (deleting) { event.exceptions = event.exceptions.filter(row => row.originalStart !== originalStart); event.exceptions.push({ originalStart, cancelled: true, start: occurrence.start, end: occurrence.end }); }
      else {
        const fields = Object.fromEntries(Object.entries(payload.event).filter(([key]) => !['start', 'end', 'recurrence'].includes(key)));
        event.exceptions = event.exceptions.filter(row => row.originalStart !== originalStart);
        event.exceptions.push({ originalStart, cancelled: false, start: payload.event.start ?? occurrence.start, end: payload.event.end ?? occurrence.end, fields: { ...(existingException?.fields ?? {}), ...fields } });
      }
    } else if (scope === 'future' && originalStart !== event.start) {
      const future = { ...event, ...(payload.event ?? {}), start: payload.event?.start ?? originalStart, end: payload.event?.end ?? originalStart + event.end - event.start };
      const previousRule = event.recurrence;
      const priorCount = calendarOccurrenceCountBefore(event, originalStart);
      const futureExceptions = event.exceptions.filter(row => row.originalStart >= originalStart);
      event.recurrence = { ...previousRule, count: previousRule.count === null ? null : Math.max(1, priorCount), until: originalStart - 1 };
      event.exceptions = event.exceptions.filter(row => row.originalStart < originalStart);
      retireEventDependents(data, event.id);
      if (!deleting) {
        if (future.recurrence && future.recurrence.count !== null && future.recurrence.count === previousRule.count) future.recurrence = { ...future.recurrence, count: Math.max(1, future.recurrence.count - priorCount) };
        const spec = Object.fromEntries(Object.keys(calendarCommandPayloads['calendar.event.save'].properties.event.properties).map(key => [key, future[key]]));
        const created = createCalendarEvent(data, spec); if (!created.ok) return invalid(created.message); created.event.attachments = copyCanonicalData(event.attachments);
        if (created.event.recurrence) created.event.exceptions = futureExceptions.map(row => ({
          ...row,
          originalStart: shiftWallTime(row.originalStart, originalStart, future.start, event.timeZone),
          start: shiftWallTime(row.start, originalStart, future.start, event.timeZone),
          end: shiftWallTime(row.end, originalStart, future.start, event.timeZone),
        })).filter(row => calendarOccurrenceExists(created.event, row.originalStart));
        editedEventId = created.eventId;
      }
    } else if (deleting) data.events = data.events.filter(row => row.id !== event.id);
    else {
      const details = { ...payload.event }, oldStart = event.start, oldRule = JSON.stringify(event.recurrence);
      if (event.recurrence && originalStart !== oldStart) {
        const requestedStart = details.start ?? originalStart;
        const requestedEnd = details.end ?? originalStart + event.end - event.start;
        details.start = shiftWallTime(oldStart, originalStart, requestedStart, event.timeZone);
        details.end = details.start + requestedEnd - requestedStart;
      }
      Object.assign(event, details);
      if (!event.recurrence || event.start !== oldStart || JSON.stringify(event.recurrence) !== oldRule) event.exceptions = [];
    }
    if (data.events.includes(event)) { event.revision++; event.sequence++; }
    retireEventDependents(data, event.id); return { eventId: editedEventId };
  }
  const implementations = {
    'calendar.view.set': (lease, payload) => mutate(lease, (_, win) => { Object.assign(win, payload); }),
    'calendar.today': lease => mutate(lease, (_, win) => { const now = sceneTimestamp(ctx.getSceneTime()); win.date = calendarDateString(Number.isFinite(now) ? now : Date.parse(ctx.profile.defaults.sceneTime), state.preferences.timeZone); }),
    'calendar.navigate': (lease, payload) => mutate(lease, (_, win) => { win.date = calendarDateAdd(win.date, win.view === 'day' ? 'day' : win.view === 'week' ? 'week' : win.view === 'year' ? 'year' : 'month', payload.direction); }),
    'calendar.sceneDate': async (lease, payload) => {
      if (typeof ctx.setSceneDate !== 'function') return failure('unavailable', 'The shared scene-date bridge is unavailable.');
      const localGuard = () => alive() && ctx.getWindow(lease.window.id) === lease.window && ctx.getView(lease.window.id) === lease.view && calendarWindow(state, lease.win.windowId) === lease.win && ctx.available(lease.window) && lease.view.available() === true;
      if (!lease.current() || await ctx.setSceneDate(payload.date, lease.current) !== true) return stale();
      // The authored clock is already committed. Only update the original,
      // still-mounted presentation; retiring it cannot undo a genuine clock edit.
      if (localGuard()) { const currentLease = owner(lease.win.windowId); if (currentLease) mutate(currentLease, (_, win) => { win.date = payload.date; }); }
      return success({ windowId: lease.win.windowId }, { date: payload.date });
    },
    'calendar.event.select': (lease, payload) => mutate(lease, (data, win) => { const event = data.events.find(row => row.id === payload.eventId); if (!event || !calendarOccurrenceExists(event, payload.occurrenceStart ?? event.start)) return failure('stale_target', 'The original occurrence is unavailable.'); win.selectedEventId = event.id; win.selectedOccurrence = payload.occurrenceStart ?? event.start; win.sheet = null; }),
    'calendar.editor.open': (lease, payload) => mutate(lease, (data, win) => { const event = payload.eventId ? data.events.find(row => row.id === payload.eventId) : null; if (payload.eventId && (!event || !calendarOccurrenceExists(event, payload.occurrenceStart ?? event.start))) return failure('stale_target', 'The original occurrence is unavailable.'); win.selectedEventId = event?.id ?? null; win.selectedOccurrence = event ? payload.occurrenceStart ?? event.start : null; win.sheet = 'event'; }),
    'calendar.editor.close': lease => mutate(lease, (_, win) => { win.sheet = null; win.selectedEventId = null; win.selectedOccurrence = null; }),
    'calendar.event.save': (lease, payload) => mutate(lease, (data, win) => {
      const cal = data.calendars.find(row => row.id === payload.event.calendarId);
      if (!cal || cal.readOnly || !data.accounts.some(row => row.id === cal.accountId && row.enabled)) return invalid('Choose an enabled writable calendar.');
      let attachments = null;
      if (payload.attachmentIds !== undefined) {
        if (typeof ctx.getFile !== 'function') return failure('unavailable', 'The canonical file lookup bridge is unavailable.');
        if (new Set(payload.attachmentIds).size !== payload.attachmentIds.length) return invalid('Attachment file IDs must be unique.');
        attachments = [];
        for (const fileId of payload.attachmentIds) {
          const file = ctx.getFile(fileId);
          if (!file || file.id !== fileId || typeof file.name !== 'string') return failure('stale_target', 'An original canonical attachment file is unavailable.');
          attachments.push({ fileId, name: file.name });
        }
      }
      let result;
      if (payload.eventId) result = editEvent(data, payload);
      else { const created = createCalendarEvent(data, payload.event); result = created.ok ? { eventId: created.eventId } : invalid(created.message); }
      if (result.status === 'rejected') return result;
      if (attachments !== null) {
        const event = data.events.find(row => row.id === result.eventId);
        if (payload.scope === 'occurrence' && event.recurrence) {
          const exception = event.exceptions.find(row => row.originalStart === (payload.occurrenceStart ?? event.start));
          if (!exception) return invalid('The edited occurrence attachment owner is unavailable.');
          exception.fields = { ...(exception.fields ?? {}), attachments };
        } else event.attachments = attachments;
      }
      win.sheet = null; win.selectedEventId = result.eventId; win.selectedOccurrence = null;
      return result;
    }),
    'calendar.event.delete': (lease, payload) => mutate(lease, data => editEvent(data, payload, true)),
    'calendar.event.move': (lease, payload) => mutate(lease, data => editEvent(data, { ...payload, event: { start: payload.start, end: payload.end } })),
    'calendar.quickEntry': (lease, payload) => {
      const match = /^(.+?)\s+on\s+(\d{4}-\d{2}-\d{2})(?:\s+at\s+(\d{2}:\d{2})(?:\s*-\s*(\d{2}:\d{2}))?|\s+(all day))$/i.exec(payload.text.trim());
      if (!match) return invalid('Use “Title on YYYY-MM-DD at HH:mm-HH:mm” or “Title on YYYY-MM-DD all day”.');
      const allDay = Boolean(match[5]), zone = state.preferences.timeZone, start = calendarTimestamp(`${match[2]}T${allDay ? '00:00' : match[3]}`, zone), end = allDay ? calendarTimestamp(`${calendarDateAdd(match[2], 'day', 1)}T00:00`, zone) : match[4] ? calendarTimestamp(`${match[2]}T${match[4]}`, zone) : start + state.preferences.defaultDuration * 60000;
      return mutate(lease, data => { const result = createCalendarEvent(data, { title: match[1], start, end, allDay, timeZone: zone }); return result.ok ? { eventId: result.eventId } : invalid(result.message); });
    },
    'calendar.attachment.resolve': (lease, payload) => {
      if (typeof ctx.getFile !== 'function') return failure('unavailable', 'The canonical file lookup bridge is unavailable.');
      const file = ctx.getFile(payload.fileId);
      if (!file || file.id !== payload.fileId || typeof file.name !== 'string') return failure('stale_target', 'The canonical attachment file does not exist.');
      return lease.current() ? success({ windowId: lease.win.windowId }, { fileId: file.id, fileName: file.name }) : stale();
    },
    'calendar.attachment.add': (lease, payload) => {
      if (typeof ctx.getFile !== 'function') return failure('unavailable', 'The canonical file lookup bridge is unavailable.');
      const file = ctx.getFile(payload.fileId); if (!file || file.id !== payload.fileId || typeof file.name !== 'string') return failure('stale_target', 'The canonical attachment file does not exist.');
      return mutate(lease, data => { const event = writable(data, payload.eventId); if (!event) return failure('stale_target', 'The original writable event is unavailable.'); if (event.attachments.some(row => row.fileId === file.id)) return invalid('That file is already attached.'); event.attachments.push({ fileId: file.id, name: file.name }); event.revision++; });
    },
    'calendar.attachment.remove': (lease, payload) => mutate(lease, data => { const event = writable(data, payload.eventId); if (!event?.attachments.some(row => row.fileId === payload.fileId)) return failure('stale_target', 'The original attachment is unavailable.'); event.attachments = event.attachments.filter(row => row.fileId !== payload.fileId); event.revision++; }),
    'calendar.attachment.open': async (lease, payload) => {
      const event = state.events.find(row => row.id === payload.eventId);
      if (!event?.attachments.some(row => row.fileId === payload.fileId) && !event?.exceptions.some(row => row.fields?.attachments?.some(file => file.fileId === payload.fileId))) return failure('stale_target', 'The original attachment is unavailable.');
      if (typeof ctx.getFile !== 'function') return failure('unavailable', 'The canonical file lookup bridge is unavailable.');
      const file = ctx.getFile(payload.fileId);
      if (!file) return failure('stale_target', 'The original canonical file retired.');
      const current = () => lease.current() && ctx.getFile(payload.fileId) === file;
      const result = await bridge({ ...lease, current }, 'openFile', [payload.fileId, null]);
      return result.error ?? result.applied;
    },
    'calendar.calendar.save': (lease, payload) => mutate(lease, data => { const cal = payload.id ? data.calendars.find(row => row.id === payload.id) : null; if (payload.id && (!cal || cal.readOnly)) return failure('stale_target', 'The original writable calendar is unavailable.'); if (cal) Object.assign(cal, payload); else data.calendars.push({ id: calendarAllocateId(data, 'calendar'), name: payload.name, color: payload.color, accountId: payload.accountId ?? data.accounts[0]?.id, visible: payload.visible ?? true, sharedWith: payload.sharedWith ?? [], readOnly: false, subscription: '' }); }),
    'calendar.calendar.visibility': (lease, payload) => mutate(lease, data => { const cal = data.calendars.find(row => row.id === payload.calendarId); if (!cal) return failure('stale_target', 'Calendar retired.'); cal.visible = payload.visible; }),
    'calendar.calendar.color': (lease, payload) => mutate(lease, data => { const cal = data.calendars.find(row => row.id === payload.calendarId); if (!cal) return failure('stale_target', 'Calendar retired.'); cal.color = payload.color; }),
    'calendar.calendar.delete': (lease, payload) => mutate(lease, data => {
      if (data.calendars.length <= 1) return invalid('At least one calendar must remain.');
      const cal = data.calendars.find(row => row.id === payload.calendarId); if (!cal) return failure('stale_target', 'Calendar retired.');
      const removed = data.events.filter(row => row.calendarId === cal.id).map(row => row.id);
      data.events = data.events.filter(row => row.calendarId !== cal.id); data.calendars = data.calendars.filter(row => row.id !== cal.id);
      for (const id of removed) retireEventDependents(data, id);
      for (const event of data.events) if (event.exceptions.some(row => row.fields?.calendarId === cal.id)) {
        event.exceptions = event.exceptions.map(row => {
          if (row.fields?.calendarId !== cal.id) return row;
          const { fields, ...exception } = row; return { ...exception, cancelled: true };
        });
        event.revision++; event.sequence++; retireEventDependents(data, event.id);
      }
      if (data.preferences.defaultCalendarId === cal.id) data.preferences.defaultCalendarId = data.calendars.find(row => !row.readOnly)?.id ?? data.calendars[0].id;
    }),
    'calendar.subscription.add': (lease, payload) => mutate(lease, data => { let url; try { url = new URL(payload.url); } catch { return invalid('Supply a valid subscription URL.'); } if (!['http:', 'https:', 'webcal:'].includes(url.protocol)) return invalid('Unsupported subscription URL.'); const cal = { id: calendarAllocateId(data, 'calendar'), name: payload.name, color: payload.color, visible: true, accountId: data.accounts[0].id, readOnly: true, subscription: payload.url, sharedWith: [] }; data.calendars.push(cal); const result = importCalendarICS(data, payload.ics, cal.id); return result.ok ? { calendarId: cal.id, eventIds: result.eventIds } : invalid(result.message); }),
    'calendar.subscription.refresh': (lease, payload) => mutate(lease, data => { const cal = data.calendars.find(row => row.id === payload.calendarId); if (!cal?.subscription) return invalid('Choose an existing local subscription.'); const result = importCalendarICS(data, payload.ics, cal.id, true); return result.ok ? { eventIds: result.eventIds } : invalid(result.message); }),
    'calendar.import': (lease, payload) => mutate(lease, data => { const cal = data.calendars.find(row => row.id === payload.calendarId); if (!cal || cal.readOnly) return invalid('Choose a writable calendar for import.'); const result = importCalendarICS(data, payload.ics, cal.id); return result.ok ? { eventIds: result.eventIds } : invalid(result.message); }),
    'calendar.import.file': async (lease, payload) => {
      if (typeof ctx.getFile !== 'function' || typeof ctx.readFile !== 'function') return failure('unavailable', 'The actual canonical Files read bridge is unavailable.');
      const file = ctx.getFile(payload.fileId);
      if (!file) return failure('stale_target', 'The original iCalendar file retired.');
      const original = { content: file.content, revision: file.revision, mime: file.mime, encoding: file.encoding };
      const current = () => lease.current() && ctx.getFile(payload.fileId) === file
        && Object.entries(original).every(([key, value]) => Object.is(file[key], value));
      const read = await ctx.readFile(payload.fileId, { guard: current, windowId: lease.win.windowId });
      if (!current()) return stale();
      if (read?.status === 'rejected') return read;
      if (read?.status !== 'applied' || read.file !== file || typeof read.text !== 'string') return failure('unavailable', 'Files did not read the original canonical iCalendar document.');
      if ((read.mime ?? '').split(';', 1)[0].trim().toLowerCase() !== 'text/calendar' && !/\.ics$/i.test(read.name ?? file.name)) return invalid('Choose an iCalendar (.ics) document.');
      return mutate({ ...lease, current }, data => {
        const calendar = data.calendars.find(row => row.id === payload.calendarId);
        if (!calendar || calendar.readOnly) return invalid('Choose a writable calendar for import.');
        const imported = importCalendarICS(data, read.text, calendar.id);
        return imported.ok ? { eventIds: imported.eventIds, fileId: file.id } : invalid(imported.message);
      });
    },
    'calendar.export': async (lease, payload) => { const cal = payload.calendarId ? state.calendars.find(row => row.id === payload.calendarId) : null; if (payload.calendarId && !cal) return failure('stale_target', 'Calendar retired.'); const result = await bridge(lease, 'createFile', [{ name: `${(cal?.name ?? 'Calendar').replace(/[\\/:]/g, '-')}.ics`, mimeType: 'text/calendar', content: exportCalendarICS(state, payload.calendarId ?? null), origin: origin(lease) }]); return result.error ?? (typeof result.result.fileId === 'string' ? success({ windowId: lease.win.windowId }, { fileId: result.result.fileId }) : failure('unavailable', 'File bridge did not create a canonical file.')); },
    'calendar.calendar.share': async (lease, payload) => { const cal = state.calendars.find(row => row.id === payload.calendarId); if (!cal) return failure('stale_target', 'Calendar retired.'); const result = await bridge(lease, 'share', [{ title: cal.name, text: `Local calendar: ${cal.name}`, mimeType: 'text/calendar', content: exportCalendarICS(state, cal.id), recipients: cal.sharedWith, origin: origin(lease) }]); return result.error ?? result.applied; },
    'calendar.account.save': (lease, payload) => mutate(lease, data => { const account = payload.id ? data.accounts.find(row => row.id === payload.id) : null; if (payload.id && !account) return failure('stale_target', 'Account retired.'); if (account) Object.assign(account, payload); else data.accounts.push({ ...payload, id: calendarAllocateId(data, 'account') }); }),
    'calendar.account.delete': (lease, payload) => mutate(lease, data => { if (data.calendars.some(row => row.accountId === payload.accountId)) return invalid('Reassign or remove account calendars before removing an account.'); if (!data.accounts.some(row => row.id === payload.accountId)) return failure('stale_target', 'Account retired.'); data.accounts = data.accounts.filter(row => row.id !== payload.accountId); }),
    'calendar.preferences.set': (lease, payload) => mutate(lease, data => { Object.assign(data.preferences, payload.values); }),
    'calendar.sheet.open': (lease, payload) => mutate(lease, (_, win) => { win.sheet = payload.sheet; if (payload.pane) win.preferencePane = payload.pane; }),
    'calendar.native.focus': async (lease, payload) => { if (!await lease.view.prepare(payload.controlId, lease.current) || !lease.current() || await lease.view.focus(payload.controlId, lease.current) !== true || !lease.current() || lease.view.describe().focusedControl !== payload.controlId) return stale(); ctx.focusWindow(lease.window.id); return success({ windowId: lease.win.windowId }); },
    'calendar.native.scroll': async (lease, payload) => { const offsets = await lease.view.scroll(payload.areaId, { top: payload.top, left: payload.left }, lease.current); return offsets && lease.current() ? success({ windowId: lease.win.windowId }, { offsets }) : stale(); },
    'calendar.window.close': lease => { if (!lease.current()) return stale(); ctx.closeWindow(lease.window.id); windowClosed(lease.window.id); return success({ windowId: lease.win.windowId }); },
    'calendar.print': async lease => {
      const win = lease.win, zone = state.preferences.timeZone;
      let first = win.date, last;
      if (win.view === 'year') { first = `${win.date.slice(0, 4)}-01-01`; last = calendarDateAdd(first, 'year', 1); }
      else if (win.view === 'month') { first = `${win.date.slice(0, 7)}-01`; last = calendarDateAdd(first, 'month', 1); }
      else if (win.view === 'week') { const weekday = new Date(`${first}T00:00:00Z`).getUTCDay(); first = calendarDateAdd(first, 'day', -((weekday - (state.preferences.daysPerWeek === 5 ? 1 : state.preferences.weekStart) + 7) % 7)); last = calendarDateAdd(first, 'day', state.preferences.daysPerWeek); }
      else last = calendarDateAdd(first, 'day', 1);
      const from = calendarTimestamp(`${first}T00:00`, zone), until = calendarTimestamp(`${last}T00:00`, zone);
      const text = calendarOccurrences(state, from, until, { query: win.query }).map(row => `${row.title}\n${calendarLocalString(row.start, zone)} — ${calendarLocalString(row.end, zone)} ${zone}\n${row.location}\n${row.notes}`).join('\n\n');
      const result = await bridge(lease, 'printDocument', [{ title: `Calendar — ${first}`, text, origin: origin(lease) }]); return result.error ?? result.applied;
    },
    'calendar.native.edit': async (lease, payload) => {
      if (typeof lease.view.clipboard !== 'function') return failure('unavailable', 'The original native text editing facade is unavailable.');
      if (!['selectAll', 'undo', 'redo'].includes(payload.operation) && (typeof ctx.clipboard?.read !== 'function' || typeof ctx.clipboard?.write !== 'function')) return failure('unavailable', 'The canonical fictional clipboard bridge is unavailable.');
      const result = await lease.view.clipboard(payload.operation, {
        read: () => ctx.clipboard.read(), write: text => ctx.clipboard.write(text),
      }, lease.nativeCurrent);
      if (!lease.nativeCurrent()) return stale();
      return result === true ? success({ windowId: lease.win.windowId }) : failure('unavailable', 'The original native selection or clipboard operation did not apply.');
    },
    'calendar.event.invite': async (lease, payload) => { const event = state.events.find(row => row.id === payload.eventId); if (!event?.invitees.length) return invalid('Add at least one event invitee.'); const result = await bridge(lease, 'createMailDraft', [{ to: event.invitees.map(row => row.email), subject: `${event.sequence ? 'Updated: ' : 'Invitation: '}${event.title}`, body: `${event.title}\n${new Date(event.start).toISOString()} — ${new Date(event.end).toISOString()}\n${event.location}\n${event.notes}\nLocal invitation; no external delivery.`, attachments: [{ name: 'Invitation.ics', mimeType: 'text/calendar', content: exportCalendarICS({ ...state, events: [event] }, event.calendarId).replace('CALSCALE:GREGORIAN', 'CALSCALE:GREGORIAN\r\nMETHOD:REQUEST') }], origin: origin(lease, event.id) }]); return result.error ?? (typeof result.result.draftId === 'string' ? success({ windowId: lease.win.windowId }, { draftId: result.result.draftId }) : failure('unavailable', 'Mail bridge did not create a real draft.')); },
    'calendar.invitation.respond': async (lease, payload) => {
      const invitation = state.invitations.find(row => row.id === payload.invitationId), event = state.events.find(row => row.id === invitation?.eventId);
      if (!invitation || !event || invitation.sequence !== event.sequence) return failure('stale_target', 'Original invitation update retired.');
      if (typeof ctx.createMailDraft !== 'function') return failure('unavailable', 'The actual Mail draft bridge is unavailable.');
      let acknowledgedId = null, committed = null;
      const reserveTextUnits = Math.max(0, payload.response.length - invitation.status.length);
      const onCommit = draftId => {
        if (acknowledgedId !== null || typeof draftId !== 'string' || !draftId || !lease.current()) return false;
        const result = mutate(lease, data => {
          const response = acceptCalendarInvitation(data, payload);
          return response.ok ? { invitationId: response.invitationId, draftId } : invalid(response.message);
        });
        if (result.status !== 'applied') return false;
        committed = result; acknowledgedId = draftId; return true;
      };
      if (!lease.current()) return stale();
      const result = await ctx.createMailDraft({ to: [invitation.sender], subject: `${payload.response}: ${event.title}`,
        body: `Local response: ${payload.response}\n${event.title}\n${new Date(event.start).toISOString()}`,
        attachments: [], origin: origin(lease, event.id), reserveTextUnits, onCommit }, lease.current);
      // The parent Mail transaction consumes the exact original invitation in
      // onCommit; completed commits are not rechecked after their own mutation.
      if (acknowledgedId !== null && result?.status === 'applied' && result.draftId === acknowledgedId) return committed;
      return result?.status === 'rejected' ? result : failure('unavailable', 'Mail did not acknowledge the exact atomic response draft.');
    },
    'calendar.alert.action': async (lease, payload) => {
      const delivery = state.alertDeliveries.find(row => row.id === payload.deliveryId), event = state.events.find(row => row.id === delivery?.eventId);
      if (!delivery || !event) return failure('stale_target', 'Original alert occurrence retired.');
      if (payload.action === 'show') return mutate(lease, (_, win) => {
        win.selectedEventId = event.id; win.selectedOccurrence = delivery.occurrenceStart;
        const exception = event.exceptions.find(row => row.originalStart === delivery.occurrenceStart), start = exception?.start ?? delivery.occurrenceStart, zone = exception?.fields?.timeZone ?? event.timeZone;
        win.date = calendarDateString(start, zone === 'floating' ? 'UTC' : state.preferences.timeZone); win.sheet = null;
      });
      const authoredTime = ctx.getSceneTime(), now = sceneTimestamp(authoredTime);
      const current = () => lease.current() && Object.is(ctx.getSceneTime(), authoredTime);
      const change = data => {
        const row = data.alertDeliveries.find(row => row.id === delivery.id);
        row.status = payload.action === 'snooze' ? 'snoozed' : 'dismissed';
        row.snoozeUntil = payload.action === 'snooze' ? (Number.isFinite(now) ? now : lastClock) + (payload.minutes ?? 5) * 60000 : null;
      };
      if (delivery.status !== 'delivered' || !delivery.notificationId) return mutate({ ...lease, current }, change);
      if (typeof ctx.updateNotification !== 'function') return failure('unavailable', 'The actual notification dismissal bridge is unavailable.');
      if (!current()) return stale();
      const notificationId = delivery.notificationId, candidate = copyCanonicalData(state);
      change(candidate);
      const checked = validateCalendarState(candidate, ctx.profile);
      if (!checked.ok) return invalid(checked.message);
      const reserveTextUnits = canonicalStringUnits(candidate) - canonicalStringUnits(state);
      const committed = success({ windowId: lease.win.windowId });
      let acknowledgedId = null, result;
      const onCommit = actualId => {
        if (actualId !== notificationId || acknowledgedId !== null || !current()
          || ctx.canCommit?.(reserveTextUnits) === false || !current()) return false;
        commitState(state, candidate); acknowledgedId = actualId; return true;
      };
      try { result = await ctx.updateNotification(notificationId, { dismissed: true, reserveTextUnits, onCommit }, current); }
      catch (error) { if (acknowledgedId === null) return current() ? failure('unavailable', error?.message ?? 'Notification dismissal failed.') : stale(); }
      if (acknowledgedId === notificationId) return committed;
      return result?.status === 'rejected' ? result : failure('unavailable', 'Notification dismissal did not acknowledge its exact atomic Calendar action.');
    },
  };
  const handlers = Object.fromEntries(Object.entries(implementations).map(([name, handler]) => [name, async (target, payload = {}) => {
    if (!CALENDAR_PROFILES.includes(ctx.profile.id)) return failure('unsupported_profile', 'Calendar is not available on this OS profile.');
    if (!calendarValueConforms(target, targetSchema) || !calendarValueConforms(payload, calendarCommandPayloads[name])) return invalid();
    const lease = owner(target.windowId); if (!lease) return failure('unavailable', 'Original mounted Calendar window is not available.');
    try { return await handler(lease, copyCanonicalData(payload)); } catch (error) { return lease.current() ? failure('unavailable', error?.message ?? 'Calendar operation failed.') : stale(); }
  }]));
  function windowOpened(value) {
    const windowId = typeof value === 'string' ? value : value.id;
    if (!alive()) return false;
    if (calendarWindow(state, windowId)) return true;
    const now = sceneTimestamp(ctx.getSceneTime());
    const row = { windowId, date: calendarDateString(Number.isFinite(now) ? now : lastClock, state.preferences.timeZone), view: state.preferences.defaultView, sidebarVisible: true, query: '', selectedEventId: null, selectedOccurrence: null, sheet: null, preferencePane: 'General' };
    const candidate = { ...state, windows: [...state.windows, row] };
    if (!validateCalendarState(candidate, ctx.profile).ok
      || ctx.canCommit?.(canonicalStringUnits(candidate) - canonicalStringUnits(state)) === false) return false;
    state.windows.push(row);
    return true;
  }
  function windowClosed(value) { const windowId = typeof value === 'string' ? value : value.id; sequence++; const index = state.windows.findIndex(row => row.windowId === windowId); if (index >= 0) state.windows.splice(index, 1); }
  function appQuit() { sequence++; state.windows.splice(0); }
  // Parent invokes this only from its shared authored clock, never host timers.
  async function clockChanged(now) {
    if (!alive() || !Number.isSafeInteger(now) || now < 0 || now > 4102444800000
      || !calendarValueConforms(state, calendarStateSchema)) return { ok: false, message: 'Invalid shared scene clock or Calendar source.' };
    const previous = lastClock, request = ++clockRequest, profile = ctx.profile, authoredTime = ctx.getSceneTime();
    let unchanged = retainCalendarGraph(state);
    const window = ctx.getWindows?.().find(window => window.appId === 'calendar' || window.appID === 'calendar');
    const windowUnchanged = window ? retainCalendarGraph(window) : () => true;
    const sourceCurrent = () => alive() && ctx.profile === profile && unchanged() && clockRequest === request
      && Object.is(ctx.getSceneTime(), authoredTime) && windowUnchanged() && (!window || ctx.getWindow(window.id) === window);
    if (!state.preferences.alertsEnabled || now < previous) {
      if (!sourceCurrent()) return { ok: false, message: 'Original scene clock ownership changed.', delivered: [] };
      lastClock = now; return { ok: true, delivered: [] };
    }
    if (typeof ctx.notify !== 'function') return { ok: false, message: 'Real notification bridge is unavailable.' };
    const expectedZone = state.preferences.timeZone, delivered = [], pending = [];
    for (const event of state.events) {
      for (const minutes of new Set([...event.alerts, ...event.exceptions.flatMap(row => row.fields?.alerts ?? [])])) {
        const range = calendarOccurrences({ ...state, events: [event], preferences: { ...state.preferences, showDeclined: true } }, previous + minutes * 60000, now + minutes * 60000 + 1, { visibleOnly: false });
        if (range.length >= 8192) return { ok: false, message: 'The clock jump exceeds the bounded local alert history.', delivered };
        for (const occurrence of range) {
          const due = occurrence.start - minutes * 60000; if (!occurrence.alerts.includes(minutes) || due < previous || due > now) continue;
          const cal = state.calendars.find(row => row.id === occurrence.calendarId), account = state.accounts.find(row => row.id === cal?.accountId && row.enabled);
          if (!account) continue;
          if (!state.alertDeliveries.some(row => row.eventId === event.id && row.occurrenceStart === occurrence.originalStart && row.minutes === minutes))
            pending.push({ event, calendar: cal, account, occurrenceStart: occurrence.originalStart, minutes, title: occurrence.title, location: occurrence.location, timeZone: occurrence.timeZone, start: occurrence.start });
        }
      }
    }
    for (const row of state.alertDeliveries.filter(row => row.status === 'snoozed' && row.snoozeUntil <= now)) {
      const event = state.events.find(event => event.id === row.eventId); if (!event) continue;
      const exception = event.exceptions.find(item => item.originalStart === row.occurrenceStart), effective = { ...event, ...(exception?.fields ?? {}) };
      const cal = state.calendars.find(item => item.id === effective.calendarId), account = state.accounts.find(item => item.id === cal?.accountId && item.enabled);
      if (!account || exception?.cancelled || !effective.alerts.includes(row.minutes) || !calendarOccurrenceExists(event, row.occurrenceStart)) continue;
      let start = exception?.start ?? row.occurrenceStart;
      if (effective.timeZone === 'floating') start = calendarTimestamp(calendarLocalString(start, 'UTC'), expectedZone);
      if (!Number.isFinite(start)) continue;
      pending.push({ event, calendar: cal, account, occurrenceStart: row.occurrenceStart, minutes: row.minutes, title: effective.title, location: effective.location, timeZone: effective.timeZone, start, existing: row });
    }
    if (state.alertDeliveries.length + pending.filter(row => !row.existing).length > 8192) return { ok: false, message: 'The bounded local alert history is full.', delivered };
    for (let index = 0; index < pending.length; index++) {
      if (!sourceCurrent()) return { ok: false, message: 'Original alert source ownership changed.', delivered };
      const item = pending[index], expectedCounter = state.nextId, id = item.existing?.id ?? `calendar-alert-${expectedCounter}`;
      if (typeof ctx.planNotification !== 'function') return { ok: false, message: 'The exact notification allocation planner is unavailable.', delivered };
      const allocation = ctx.planNotification(sourceCurrent);
      if (allocation?.status === 'rejected' || typeof allocation?.current !== 'function'
        || !calendarValueConforms(allocation.notificationId, calendarStateSchema.properties.alertDeliveries.items.properties.notificationId)
        || typeof allocation.notificationId !== 'string' || !allocation.current())
        return { ok: false, message: allocation?.error?.message ?? 'The original notification allocation is unavailable.', delivered };
      const candidate = copyCanonicalData(state);
      const row = item.existing ? candidate.alertDeliveries.find(row => row.id === id)
        : { id, eventId: item.event.id, occurrenceStart: item.occurrenceStart, minutes: item.minutes, status: 'delivered', snoozeUntil: null, notificationId: null };
      row.status = 'delivered'; row.snoozeUntil = null; row.notificationId = allocation.notificationId;
      if (!item.existing) { candidate.nextId++; candidate.alertDeliveries.push(row); }
      const reserveTextUnits = canonicalStringUnits(candidate) - canonicalStringUnits(state);
      if (!validateCalendarState(candidate, profile).ok || ctx.canCommit?.(reserveTextUnits) === false)
        return { ok: false, message: 'The local alert ledger exceeds the canonical or complete-scene text budget.', delivered };
      const current = () => sourceCurrent() && allocation.current() && state.nextId === expectedCounter;
      if (!current()) return { ok: false, message: 'Original alert source ownership changed.', delivered };
      let acknowledgedId = null, result, error;
      const onCommit = notificationId => {
        if (acknowledgedId !== null || notificationId !== allocation.notificationId || !current()
          || ctx.canCommit?.(reserveTextUnits) === false || !current()) return false;
        commitState(state, candidate);
        if (index === pending.length - 1) lastClock = now;
        acknowledgedId = notificationId;
        // Only our own synchronous commit advances the source lease. Mutations
        // after acknowledgment cannot silently rebase the remaining due alerts.
        unchanged = retainCalendarGraph(state);
        return true;
      };
      try {
        result = await ctx.notify({ id, title: item.title, body: `${calendarDateString(item.start, item.timeZone === 'floating' ? expectedZone : item.timeZone)} · ${item.location || 'Calendar'}`,
          eventId: item.event.id, occurrenceStart: item.occurrenceStart, windowId: window?.id ?? null, reserveTextUnits, onCommit,
          actions: [{ id: 'show', label: 'Show' }, { id: 'snooze', label: 'Snooze' }, { id: 'dismiss', label: 'Dismiss' }] }, current);
      } catch (caught) { error = caught; }
      // The strict synchronous acknowledgment is final, even when the bridge
      // retires presentation or throws after the actual notification transaction.
      if (acknowledgedId === null) return { ok: false, message: result?.error?.message ?? error?.message ?? 'Notification bridge did not acknowledge the exact atomic local alert commit.', delivered };
      delivered.push(id);
    }
    if (!pending.length) {
      if (!sourceCurrent()) return { ok: false, message: 'Original scene clock ownership changed.', delivered };
      lastClock = now;
    }
    return { ok: true, delivered };
  }
  function targets() { return { calendars: state.calendars.map(row => ({ calendarId: row.id, name: row.name, visible: row.visible, readOnly: row.readOnly })), events: state.events.map(row => ({ eventId: row.id, title: row.title, calendarId: row.calendarId, start: row.start, end: row.end, revision: row.revision })), invitations: state.invitations.map(row => ({ invitationId: row.id, eventId: row.eventId, status: row.status })), alerts: state.alertDeliveries.map(row => ({ deliveryId: row.id, eventId: row.eventId, status: row.status })), windows: state.windows.map(win => ({ ...win, available: Boolean(ctx.getWindow(win.windowId) && ctx.available(ctx.getWindow(win.windowId)) && ctx.getView(win.windowId)?.available() === true), presentation: ctx.getView(win.windowId)?.describe() ?? null })) }; }
  return { handlers, targets, windowOpened, windowClosed, appQuit, clockChanged, prepareNotificationDismissals };
}

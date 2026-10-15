import { object, choice, flag } from './command-schema.js';
import { copyCanonicalData } from './canonical-data.js';

export const CALENDAR_PROFILES = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
export const CALENDAR_LIMITS = Object.freeze({ events: 2048, calendars: 64, accounts: 32, invitations: 2048, windows: 64, occurrences: 8192, text: 4 * 1024 * 1024 });
const text = (maxLength = 4096, minLength = 0) => ({ type: 'string', minLength, maxLength });
const id = { ...text(128, 1), pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const timestamp = integer(0, 4102444800000);
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const array = (items, maxItems) => ({ type: 'array', items, maxItems });
export const calendarDateSchema = { ...text(10, 10), pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
export const calendarRecurrenceSchema = nullable(object({
  frequency: choice('daily', 'weekly', 'monthly', 'yearly'), interval: integer(1, 99),
  count: nullable(integer(1, 4096)), until: nullable(timestamp), weekdays: array(integer(0, 6), 7),
  monthDays: array({ anyOf: [integer(-31, -1), integer(1, 31)] }, 31), months: array(integer(1, 12), 12),
  ordinalWeekdays: array(object({ weekday: integer(0, 6), ordinal: { anyOf: [integer(-5, -1), integer(1, 5)] } }), 10),
  weekStart: integer(0, 6),
}, ['frequency', 'interval', 'count', 'until', 'weekdays']));
export const calendarInviteeSchema = object({ email: text(320, 1), name: text(256), status: choice('pending', 'accepted', 'declined', 'tentative') });
export const calendarEventFields = { calendarId: id, title: text(512, 1), start: timestamp, end: timestamp, allDay: flag, location: text(2048), notes: text(65536), url: text(2048), timeZone: text(128, 1), travelMinutes: integer(0, 10080), recurrence: calendarRecurrenceSchema, alerts: array(integer(0, 525600), 8), invitees: array(calendarInviteeSchema, 128), organizer: text(320) };
export const calendarExceptionFields = { ...Object.fromEntries(Object.entries(calendarEventFields).filter(([key]) => !['start', 'end', 'recurrence'].includes(key))), attachments: array(object({ fileId: id, name: text(256, 1) }), 32) };
export const calendarEventSchema = object({ id, icalUid: text(512, 1), ...calendarEventFields, attachments: array(object({ fileId: id, name: text(256, 1) }), 32), exceptions: array(object({ originalStart: timestamp, cancelled: flag, start: timestamp, end: timestamp, fields: object(calendarExceptionFields, []) }, ['originalStart', 'cancelled', 'start', 'end']), 512), revision: integer(1, Number.MAX_SAFE_INTEGER), sequence: integer(0, Number.MAX_SAFE_INTEGER) });
export const calendarPreferencesFields = { weekStart: integer(0, 6), defaultView: choice('day', 'week', 'month', 'year'), defaultCalendarId: id, defaultDuration: integer(1, 10080), defaultAlert: integer(0, 525600), timeZone: text(128, 1), showWeekNumbers: flag, showDeclined: flag, birthdays: flag, alternateCalendar: choice('none', 'chinese', 'hebrew', 'islamic'), dayStart: integer(0, 23), dayEnd: integer(1, 24), daysPerWeek: choice(5, 7), confirmDelete: flag, alertsEnabled: flag };
export const calendarWindowSchema = object({ windowId: id, date: calendarDateSchema, view: choice('day', 'week', 'month', 'year'), sidebarVisible: flag, query: text(4096), selectedEventId: nullable(id), selectedOccurrence: nullable(timestamp), sheet: nullable(choice('event', 'calendar', 'subscription', 'import', 'accounts', 'preferences', 'invitations', 'help')), preferencePane: choice('General', 'Accounts', 'Alerts', 'Advanced') });
export const calendarStateSchema = object({ calendars: array(object({ id, name: text(256, 1), color: { ...text(7, 7), pattern: '^#[0-9a-fA-F]{6}$' }, visible: flag, accountId: id, readOnly: flag, subscription: text(2048), sharedWith: array(text(320, 1), 128) }), 64), events: array(calendarEventSchema, 2048), invitations: array(object({ id, eventId: id, sender: text(320, 1), status: choice('pending', 'accepted', 'declined', 'tentative'), sequence: integer(0, Number.MAX_SAFE_INTEGER) }), 2048), accounts: array(object({ id, name: text(256, 1), type: choice('local', 'icloud', 'exchange', 'google'), email: text(320), enabled: flag }), 32), preferences: object(calendarPreferencesFields), windows: array(calendarWindowSchema, 64), alertDeliveries: array(object({ id, eventId: id, occurrenceStart: timestamp, minutes: integer(0, 525600), status: choice('pending', 'delivered', 'dismissed', 'snoozed'), snoozeUntil: nullable(timestamp), notificationId: nullable(id) }), 8192), nextId: integer(1, Number.MAX_SAFE_INTEGER) });

// Validate data descriptors before accessing values: imported state never executes getters.
export function calendarValueConforms(value, schema, seen = new Set()) {
  if (schema.anyOf) return schema.anyOf.some(candidate => calendarValueConforms(value, candidate, seen));
  if (schema.enum && !schema.enum.includes(value) || Object.hasOwn(schema, 'const') && value !== schema.const || schema.not?.enum?.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity) && (!schema.pattern || new RegExp(schema.pattern).test(value));
  if (schema.type === 'integer' || schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)) && value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > schema.maxItems || seen.has(value)) return false;
    seen.add(value);
    const keys = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
    const valid = keys.length === value.length + 1 && Array.from({ length: value.length }, (_, index) => String(index)).every(key => descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], 'value') && calendarValueConforms(descriptors[key].value, schema.items, seen));
    seen.delete(value); return valid;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || seen.has(value)) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if ((schema.required ?? []).some(key => !Object.hasOwn(descriptors, key)) || keys.some(key => typeof key !== 'string' || !Object.hasOwn(schema.properties, key) || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) return false;
    seen.add(value); const valid = keys.every(key => calendarValueConforms(descriptors[key].value, schema.properties[key], seen)); seen.delete(value); return valid;
  }
  return true;
}
export function calendarTimeZoneValid(zone) { if (zone === 'floating') return true; try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0); return true; } catch { return false; } }
const formatters = new Map();
export function calendarDateParts(timestampValue, zone = 'UTC') {
  if (zone === 'floating') zone = 'UTC';
  if (!formatters.has(zone)) { if (formatters.size >= 64) formatters.clear(); formatters.set(zone, new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })); }
  return Object.fromEntries(formatters.get(zone).formatToParts(timestampValue).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}
const pad = value => String(value).padStart(2, '0');
export function calendarDateString(value, zone = 'UTC') { const parts = calendarDateParts(value, zone); return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`; }
export function calendarLocalString(value, zone = 'UTC') { const parts = calendarDateParts(value, zone); return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`; }
// Nonexistent DST wall times are rejected. Ambiguous times choose the earlier instant.
export function calendarTimestamp(local, zone = 'UTC') {
  if (!calendarTimeZoneValid(zone) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(local)) return NaN;
  if (zone === 'floating') zone = 'UTC';
  const [year, month, day, hour, minute, second = 0] = local.match(/\d+/g).map(Number), wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return NaN;
  const offsets = new Set();
  for (const delta of [-86400000, 0, 86400000]) { const probe = wall + delta, p = calendarDateParts(probe, zone); offsets.add(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - probe); }
  const matches = [...offsets].map(offset => wall - offset).filter(candidate => { const p = calendarDateParts(candidate, zone); return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute && p.second === second; });
  return matches.length ? Math.min(...matches) : NaN;
}
export function calendarDateAdd(date, unit, amount) {
  const [year, month, day] = date.split('-').map(Number), value = new Date(Date.UTC(year, month - 1, day));
  if (unit === 'month' || unit === 'year') { value.setUTCDate(1); unit === 'month' ? value.setUTCMonth(value.getUTCMonth() + amount) : value.setUTCFullYear(value.getUTCFullYear() + amount); const last = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate(); value.setUTCDate(Math.min(day, last)); }
  else value.setUTCDate(value.getUTCDate() + amount * (unit === 'week' ? 7 : 1));
  return value.toISOString().slice(0, 10);
}
const emailValid = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const urlValid = value => { if (!value) return true; try { return ['http:', 'https:', 'webcal:'].includes(new URL(value).protocol); } catch { return false; } };
export function validateCalendarState(state, profile) {
  const bad = message => ({ ok: false, message });
  if (profile?.id && !CALENDAR_PROFILES.includes(profile.id) || !calendarValueConforms(state, calendarStateSchema)) return bad('Expected closed bounded Calendar data.');
  if (JSON.stringify(state).length > CALENDAR_LIMITS.text) return bad('Calendar text budget exceeded.');
  const ids = new Set();
  for (const rows of [state.calendars, state.events, state.invitations, state.accounts, state.alertDeliveries]) for (const row of rows) { if (ids.has(row.id)) return bad('Calendar IDs must be unique.'); ids.add(row.id); const generated = /^calendar-(?:event|calendar|account|invitation|alert)-(\d+)$/.exec(row.id); if (generated && Number(generated[1]) >= state.nextId) return bad('Calendar counter must exceed allocated IDs.'); }
  if (new Set(state.windows.map(row => row.windowId)).size !== state.windows.length) return bad('Calendar window IDs must be unique.');
  if (state.preferences.timeZone === 'floating' || !calendarTimeZoneValid(state.preferences.timeZone) || state.preferences.dayEnd <= state.preferences.dayStart || !state.calendars.some(row => row.id === state.preferences.defaultCalendarId)) return bad('Invalid Calendar preferences.');
  for (const account of state.accounts) if (account.email && !emailValid(account.email)) return bad('Invalid local account email.');
  for (const cal of state.calendars) if (!state.accounts.some(account => account.id === cal.accountId) || !urlValid(cal.subscription) || new Set(cal.sharedWith).size !== cal.sharedWith.length || cal.sharedWith.some(email => !emailValid(email))) return bad('Invalid calendar account, subscription, or sharing.');
  if (new Set(state.events.map(event => JSON.stringify([event.calendarId, event.icalUid]))).size !== state.events.length || state.events.some(event => /[\r\n]/.test(event.icalUid))) return bad('iCalendar UIDs must be unique within a calendar and remain a single content line.');
  const eventVariants = state.events.flatMap(event => [event, ...event.exceptions.filter(row => !row.cancelled).map(row => ({ ...event, ...(row.fields ?? {}), start: row.start, end: row.end, recurrence: null, exceptions: [] }))]);
  for (const event of eventVariants) {
    if (!state.calendars.some(cal => cal.id === event.calendarId) || event.end <= event.start || !calendarTimeZoneValid(event.timeZone) || !urlValid(event.url) || event.organizer && !emailValid(event.organizer)) return bad('Invalid event calendar, interval, zone, URL, or organizer.');
    if (new Set(event.attachments.map(row => row.fileId)).size !== event.attachments.length || new Set(event.invitees.map(row => row.email.toLowerCase())).size !== event.invitees.length || event.invitees.some(row => !emailValid(row.email)) || new Set(event.alerts).size !== event.alerts.length) return bad('Duplicate or invalid attachments, invitees, or alerts.');
    const ownerCalendar = state.calendars.find(cal => cal.id === event.calendarId), ownerAccount = state.accounts.find(account => account.id === ownerCalendar?.accountId);
    if (ownerAccount?.type === 'exchange' && event.alerts.length > 1) return bad('Exchange events support one local event alert.');
    if (event.allDay && [event.start, event.end].some(time => { const p = calendarDateParts(time, event.timeZone); return p.hour || p.minute || p.second || time % 1000; })) return bad('All-day boundaries must be local midnight, with exclusive end.');
    const recurrence = event.recurrence;
    if (recurrence && (recurrence.until !== null && recurrence.until < event.start || new Set(recurrence.weekdays).size !== recurrence.weekdays.length || recurrence.frequency !== 'weekly' && recurrence.weekdays.length)) return bad('Invalid recurrence boundary or weekdays.');
    if (recurrence && (['monthDays', 'months', 'ordinalWeekdays'].some(key => new Set((recurrence[key] ?? []).map(value => JSON.stringify(value))).size !== (recurrence[key] ?? []).length)
      || recurrence.monthDays?.length && !['monthly', 'yearly'].includes(recurrence.frequency)
      || recurrence.ordinalWeekdays?.length && !['monthly', 'yearly'].includes(recurrence.frequency)
      || recurrence.months?.length && recurrence.frequency !== 'yearly')) return bad('Invalid custom recurrence pattern.');
    if (!recurrence && event.exceptions.length || new Set(event.exceptions.map(row => row.originalStart)).size !== event.exceptions.length || event.exceptions.some(row => row.end <= row.start || !calendarOccurrenceExists(event, row.originalStart))) return bad('Invalid recurrence exceptions.');
  }
  for (const invitation of state.invitations) { const event = state.events.find(row => row.id === invitation.eventId); if (!event || !emailValid(invitation.sender) || invitation.sequence !== event.sequence) return bad('Invitation must reference the current event update.'); }
  if (new Set(state.invitations.map(row => `${row.eventId}:${row.sequence}`)).size !== state.invitations.length) return bad('An event update may have only one local invitation.');
  for (const win of state.windows) { if (calendarDateAdd(win.date, 'day', 0) !== win.date || win.date < '1970-01-01' || win.date > '2099-12-31' || win.selectedEventId !== null && !state.events.some(row => row.id === win.selectedEventId) || win.selectedOccurrence !== null && !calendarOccurrenceExists(state.events.find(row => row.id === win.selectedEventId), win.selectedOccurrence)) return bad('Invalid calendar window date or selection.'); }
  for (const delivery of state.alertDeliveries) { const event = state.events.find(row => row.id === delivery.eventId), exception = event?.exceptions.find(row => row.originalStart === delivery.occurrenceStart); if (!event || !(exception?.fields?.alerts ?? event.alerts).includes(delivery.minutes) || exception?.cancelled || !calendarOccurrenceExists(event, delivery.occurrenceStart) || delivery.status === 'snoozed' && delivery.snoozeUntil === null) return bad('Invalid alert event ownership.'); }
  if (new Set(state.alertDeliveries.map(row => `${row.eventId}:${row.occurrenceStart}:${row.minutes}`)).size !== state.alertDeliveries.length) return bad('An event occurrence alert may have only one delivery record.');
  return { ok: true };
}
export const calendarWindow = (state, windowId) => state.windows.find(row => row.windowId === windowId) ?? null;
export function createCalendarState(profile) {
  const time = Date.parse(profile.defaults.sceneTime), zone = 'UTC';
  const calendars = [{ id: 'trail-crew', name: 'Trail Crew', color: '#c47f17', visible: true, accountId: 'calendar-local', readOnly: false, subscription: '', sharedWith: [] }, { id: 'volunteers', name: 'Volunteers', color: '#3b7bbf', visible: true, accountId: 'calendar-local', readOnly: false, subscription: '', sharedWith: [] }];
  const base = { allDay: false, notes: '', url: '', timeZone: zone, travelMinutes: 0, attachments: [], recurrence: null, exceptions: [], invitees: [], organizer: '', revision: 1, alerts: [15], sequence: 0 };
  const event = (id, calendarId, title, start, end, location) => ({ ...copyCanonicalData(base), id, icalUid: `${id}@jester.local`, calendarId, title, start: time + start * 60000, end: time + end * 60000, location });
  return { calendars, events: [event('event-1', 'trail-crew', 'Trail map review', 1140, 1230, 'Ranger station'), event('event-2', 'volunteers', 'Bridge inspection', 1789, 1834, 'Cedar Creek'), event('event-3', 'trail-crew', 'Volunteer signup closes', 3319, 3739, 'Trailhead kiosk')], invitations: [], accounts: [{ id: 'calendar-local', name: profile.family === 'windows' ? 'Local calendars' : 'On My Mac', type: 'local', email: '', enabled: true }], preferences: { weekStart: 0, defaultView: 'month', defaultCalendarId: 'trail-crew', defaultDuration: 60, defaultAlert: 15, timeZone: zone, showWeekNumbers: false, showDeclined: true, birthdays: false, alternateCalendar: 'none', dayStart: 8, dayEnd: 18, daysPerWeek: 7, confirmDelete: true, alertsEnabled: true }, windows: [], alertDeliveries: [], nextId: 1 };
}
export function calendarAllocateId(state, kind) { return `calendar-${kind}-${state.nextId++}`; }
function recurrenceMonthDates(year, month, rule, initialDay) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate(), days = new Set(), patternDays = new Set();
  for (const day of rule.monthDays ?? []) days.add(day > 0 ? day : last + day + 1);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const lastWeekday = new Date(Date.UTC(year, month - 1, last)).getUTCDay();
  for (const pattern of rule.ordinalWeekdays ?? []) {
    const day = pattern.ordinal > 0
      ? 1 + (pattern.weekday - firstWeekday + 7) % 7 + (pattern.ordinal - 1) * 7
      : last - (lastWeekday - pattern.weekday + 7) % 7 + (pattern.ordinal + 1) * 7;
    patternDays.add(day);
  }
  if (rule.ordinalWeekdays?.length) {
    if (rule.monthDays?.length) { for (const day of days) if (!patternDays.has(day)) days.delete(day); }
    else for (const day of patternDays) days.add(day);
  }
  if (!days.size && !rule.monthDays?.length && !rule.ordinalWeekdays?.length) days.add(initialDay);
  return [...days].filter(day => day > 0 && day <= last).sort((a, b) => a - b).map(day => `${year}-${pad(month)}-${pad(day)}`);
}
function* recurrenceStarts(event, from = 0) {
  if (!event) return;
  yield event.start;
  if (!event.recurrence) return;
  const rule = event.recurrence, initial = calendarDateParts(event.start, event.timeZone), date = calendarDateString(event.start, event.timeZone);
  const initialDay = new Date(`${date}T00:00:00Z`).getUTCDay(), weekStart = rule.weekStart ?? 0;
  let produced = 1, firstIndex = 0;
  if (rule.count === null && !event.exceptions.length && from > event.start) {
    const near = calendarDateParts(Math.max(event.start, from - event.end + event.start - 172800000), event.timeZone);
    const days = Math.floor((Date.UTC(near.year, near.month - 1, near.day) - Date.parse(date)) / 86400000);
    const periods = rule.frequency === 'daily' ? days : rule.frequency === 'weekly' ? Math.floor(days / 7) : rule.frequency === 'monthly' ? (near.year - initial.year) * 12 + near.month - initial.month : near.year - initial.year;
    firstIndex = Math.max(0, Math.floor(periods / rule.interval) - 1);
  }
  const untilDate = rule.until === null ? '2099-12-31' : calendarDateString(rule.until, event.timeZone);
  for (let index = firstIndex; index < 50000 && produced < (rule.count ?? 50000); index++) {
    let dates;
    if (rule.frequency === 'daily') dates = [calendarDateAdd(date, 'day', index * rule.interval)];
    else if (rule.frequency === 'weekly') {
      const start = calendarDateAdd(date, 'day', -((initialDay - weekStart + 7) % 7) + index * rule.interval * 7);
      dates = (rule.weekdays.length ? rule.weekdays : [initialDay]).map(day => calendarDateAdd(start, 'day', (day - weekStart + 7) % 7)).sort();
    } else if (rule.frequency === 'monthly') {
      const monthDate = calendarDateAdd(`${initial.year}-${pad(initial.month)}-01`, 'month', index * rule.interval);
      const [year, month] = monthDate.split('-').map(Number);
      if (year > 2099 || monthDate > untilDate) break;
      dates = recurrenceMonthDates(year, month, rule, initial.day);
    } else {
      const year = initial.year + index * rule.interval;
      if (year > 2099 || `${year}-01-01` > untilDate) break;
      dates = (rule.months?.length ? rule.months : [initial.month]).flatMap(month => recurrenceMonthDates(year, month, rule, initial.day)).sort();
    }
    if (dates[0] > untilDate || dates[0] > '2099-12-31') break;
    for (const candidateDate of dates) {
      if (candidateDate < date || candidateDate > untilDate || candidateDate > '2099-12-31') continue;
      const candidate = calendarTimestamp(`${candidateDate}T${pad(initial.hour)}:${pad(initial.minute)}:${pad(initial.second)}`, event.timeZone) + event.start % 1000;
      if (!Number.isFinite(candidate) || candidate <= event.start) continue;
      if (rule.until !== null && candidate > rule.until) return;
      if (produced >= (rule.count ?? 50000)) return;
      produced++; yield candidate;
    }
  }
}
export function calendarOccurrenceExists(event, originalStart) { if (!event) return false; for (const start of recurrenceStarts(event)) { if (start === originalStart) return true; if (start > originalStart) break; } return false; }
export function calendarOccurrenceCountBefore(event, before) { let count = 0; for (const start of recurrenceStarts(event)) { if (start >= before) break; count++; } return count; }
export function calendarOccurrences(state, from, until, { visibleOnly = true, query = '' } = {}) {
  const rows = [], needle = query.normalize('NFKD').toLocaleLowerCase('en-US');
  for (const event of state.events) {
    if (!state.preferences.showDeclined && state.invitations.some(row => row.eventId === event.id && row.status === 'declined')) continue;
    for (const originalStart of recurrenceStarts(event, from)) {
      if (originalStart >= until + 172800000 && !event.exceptions.some(row => row.originalStart >= originalStart && row.start < until + 172800000 && row.end > from - 172800000)) break;
      const exception = event.exceptions.find(row => row.originalStart === originalStart);
      if (exception?.cancelled) continue;
      const occurrence = { ...event, ...(exception?.fields ?? {}) };
      const cal = state.calendars.find(row => row.id === occurrence.calendarId), account = state.accounts.find(row => row.id === cal?.accountId);
      if (!cal || visibleOnly && (!cal.visible || !account?.enabled) || needle && ![occurrence.title, occurrence.location, occurrence.notes, ...occurrence.invitees.map(row => row.name + ' ' + row.email)].join(' ').normalize('NFKD').toLocaleLowerCase('en-US').includes(needle)) continue;
      let start = exception?.start ?? originalStart, end = exception?.end ?? originalStart + event.end - event.start;
      if (event.allDay && !exception) { const days = Math.round((Date.parse(calendarDateString(event.end, event.timeZone)) - Date.parse(calendarDateString(event.start, event.timeZone))) / 86400000); end = calendarTimestamp(`${calendarDateAdd(calendarDateString(start, event.timeZone), 'day', days)}T00:00`, event.timeZone); }
      if (occurrence.timeZone === 'floating') {
        start = calendarTimestamp(calendarLocalString(start, 'UTC'), state.preferences.timeZone);
        end = calendarTimestamp(calendarLocalString(end, 'UTC'), state.preferences.timeZone);
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      }
      if (start < until && end > from) rows.push({ ...occurrence, eventId: event.id, originalStart, start, end, color: cal.color, calendarName: cal.name });
      if (rows.length >= CALENDAR_LIMITS.occurrences) return rows.sort((a, b) => a.start - b.start);
    }
  }
  return rows.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}
export function calendarWidgetProjection(state) {
  return Object.freeze({ calendars: Object.freeze(state.calendars.map(({ id, name, color }) => Object.freeze({ id, name, color }))), events: Object.freeze(state.events.map(({ id, calendarId, title, start, end, allDay, location }) => Object.freeze({ id, calendarId, title, start, end, allDay, location }))) });
}
export function createCalendarEvent(state, spec) {
  if (!calendarValueConforms(spec, object({ ...calendarEventFields, icalUid: text(512, 1) }, ['title', 'start', 'end']))) return { ok: false, message: 'Invalid closed event specification.' };
  let nextId = state.nextId;
  while (!spec.icalUid && state.events.some(event => event.icalUid === `calendar-event-${nextId}@jester.local`)) nextId++;
  const event = { calendarId: state.preferences.defaultCalendarId, allDay: false, location: '', notes: '', url: '', timeZone: state.preferences.timeZone, travelMinutes: 0, recurrence: null, alerts: [state.preferences.defaultAlert], invitees: [], organizer: '', attachments: [], exceptions: [], revision: 1, sequence: 0, id: `calendar-event-${nextId}`, icalUid: `calendar-event-${nextId}@jester.local`, ...copyCanonicalData(spec) };
  const candidate = { ...state, nextId: nextId + 1, events: [...state.events, event] }, checked = validateCalendarState(candidate);
  if (!checked.ok) return checked;
  state.nextId = nextId + 1; state.events.push(event); return { ok: true, eventId: event.id, event };
}
export function acceptCalendarInvitation(state, spec) {
  if (!calendarValueConforms(spec, object({ invitationId: id, response: choice('accepted', 'declined', 'tentative') }))) return { ok: false, message: 'Invalid invitation response.' };
  const invitation = state.invitations.find(row => row.id === spec.invitationId), event = state.events.find(row => row.id === invitation?.eventId);
  if (!invitation || !event || event.sequence !== invitation.sequence) return { ok: false, message: 'Invitation update is stale.' };
  invitation.status = spec.response; return { ok: true, invitationId: invitation.id, eventId: event.id };
}
export function createCalendarInvitation(state, spec) {
  if (!calendarValueConforms(spec, object({ sender: text(320, 1), event: object(calendarEventFields, ['title', 'start', 'end']), eventId: id, icalUid: text(512, 1), sequence: integer(0, Number.MAX_SAFE_INTEGER) }, ['sender', 'event']))) return { ok: false, message: 'Invalid invitation specification.' };
  if (!emailValid(spec.sender)) return { ok: false, message: 'Invalid organizer email.' };
  const matches = spec.icalUid ? state.events.filter(row => row.icalUid === spec.icalUid && (!spec.event.calendarId || row.calendarId === spec.event.calendarId)) : [];
  if (!spec.eventId && matches.length > 1) return { ok: false, message: 'Choose the original calendar for a UID appearing in several calendars.' };
  const originalId = spec.eventId ?? matches[0]?.id;
  const candidate = copyCanonicalData(state); let event;
  if (originalId) {
    event = candidate.events.find(row => row.id === originalId);
    if (!event || spec.sequence === undefined || spec.sequence <= event.sequence) return { ok: false, message: 'Organizer update must advance the original event sequence.' };
    if (event.organizer.toLowerCase() !== spec.sender.toLowerCase()) return { ok: false, message: 'An organizer update must retain the original event organizer.' };
    if (spec.icalUid && event.icalUid !== spec.icalUid) return { ok: false, message: 'An organizer update must retain the original iCalendar UID.' };
    const oldStart = event.start, oldRule = JSON.stringify(event.recurrence);
    Object.assign(event, spec.event, { organizer: spec.sender, sequence: spec.sequence, revision: event.revision + 1 });
    if (event.start !== oldStart || JSON.stringify(event.recurrence) !== oldRule) event.exceptions = [];
    for (const win of candidate.windows) if (win.selectedEventId === event.id) win.selectedOccurrence = null;
    candidate.invitations = candidate.invitations.filter(row => row.eventId !== event.id);
    candidate.alertDeliveries = candidate.alertDeliveries.filter(row => row.eventId !== event.id);
  } else { const created = createCalendarEvent(candidate, { ...spec.event, organizer: spec.sender, ...(spec.icalUid ? { icalUid: spec.icalUid } : {}) }); if (!created.ok) return created; event = created.event; event.sequence = spec.sequence ?? 0; }
  const invitation = { id: calendarAllocateId(candidate, 'invitation'), eventId: event.id, sender: spec.sender, status: 'pending', sequence: event.sequence }; candidate.invitations.push(invitation);
  const checked = validateCalendarState(candidate); if (!checked.ok) return checked;
  if (originalId) { const original = state.events.find(row => row.id === originalId); Object.assign(original, event); } else state.events.push(event);
  for (const win of state.windows) if (win.selectedEventId === event.id) win.selectedOccurrence = null;
  state.invitations = candidate.invitations; state.alertDeliveries = candidate.alertDeliveries; state.nextId = candidate.nextId;
  return { ok: true, invitationId: invitation.id, eventId: event.id };
}

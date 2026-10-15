import { calendarDateString, calendarDateParts, calendarTimestamp, calendarValueConforms, calendarEventFields, createCalendarEvent, calendarAllocateId, validateCalendarState } from './calendar-state.js';
import { object } from './command-schema.js';
import { copyCanonicalData } from './canonical-data.js';
const MAX_ICS = 2 * 1024 * 1024;
const escapeText = value => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const unescapeText = value => value.replace(/\\([nN,;\\])/g, (_, escaped) => /n/i.test(escaped) ? '\n' : escaped);
const compact = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const compactLocal = (value, zone) => { const p = calendarDateParts(value, zone); return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}${String(p.minute).padStart(2, '0')}${String(p.second).padStart(2, '0')}`; };
const weekdays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function foldLine(line) { const lines = []; let current = '', bytes = 0; for (const character of line) { const point = character.codePointAt(0), width = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4; if (bytes + width > 75) { lines.push(current); current = ' '; bytes = 1; } current += character; bytes += width; } lines.push(current); return lines.join('\r\n'); }
export function exportCalendarICS(state, calendarId = null) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//JesterOS//Local Calendar//EN', 'CALSCALE:GREGORIAN'];
  for (const event of state.events.filter(row => calendarId === null || row.calendarId === calendarId)) {
    const dates = (start, end) => event.allDay ? [`DTSTART;VALUE=DATE:${calendarDateString(start, event.timeZone).replace(/-/g, '')}`, `DTEND;VALUE=DATE:${calendarDateString(end, event.timeZone).replace(/-/g, '')}`]
      : event.timeZone === 'floating' ? [`DTSTART:${compactLocal(start, 'UTC')}`, `DTEND:${compactLocal(end, 'UTC')}`]
      : event.timeZone === 'UTC' ? [`DTSTART:${compact(start)}`, `DTEND:${compact(end)}`]
      : [`DTSTART;TZID=${event.timeZone}:${compactLocal(start, event.timeZone)}`, `DTEND;TZID=${event.timeZone}:${compactLocal(end, event.timeZone)}`];
    const recurrenceDate = (name, value) => event.allDay ? `${name};VALUE=DATE:${calendarDateString(value, event.timeZone).replace(/-/g, '')}`
      : event.timeZone === 'floating' ? `${name}:${compactLocal(value, 'UTC')}`
      : event.timeZone === 'UTC' ? `${name}:${compact(value)}` : `${name};TZID=${event.timeZone}:${compactLocal(value, event.timeZone)}`;
    lines.push('BEGIN:VEVENT', `UID:${event.icalUid}`, `DTSTAMP:${compact(event.start)}`, `SEQUENCE:${event.sequence}`, ...dates(event.start, event.end), `SUMMARY:${escapeText(event.title)}`, `LOCATION:${escapeText(event.location)}`, `DESCRIPTION:${escapeText(event.notes)}`, `URL:${event.url}`, `X-JESTER-TIMEZONE:${event.timeZone}`, `X-JESTER-TRAVEL-MINUTES:${event.travelMinutes}`);
    if (event.organizer) lines.push(`ORGANIZER:mailto:${event.organizer}`);
    for (const invitee of event.invitees) lines.push(`ATTENDEE;CN="${escapeText(invitee.name).replace(/"/g, '')}";PARTSTAT=${invitee.status === 'pending' ? 'NEEDS-ACTION' : invitee.status.toUpperCase()}:mailto:${invitee.email}`);
    for (const attachment of event.attachments) lines.push(`ATTACH;X-JESTER-NAME="${escapeText(attachment.name).replace(/"/g, '')}":jester-file:${attachment.fileId}`);
    if (event.recurrence) {
      const rule = event.recurrence, days = [...rule.weekdays.map(day => weekdays[day]), ...(rule.ordinalWeekdays ?? []).map(pattern => `${pattern.ordinal}${weekdays[pattern.weekday]}`)];
      const months = rule.months?.length ? rule.months : rule.frequency === 'yearly' && (rule.ordinalWeekdays?.length || rule.monthDays?.length) ? [calendarDateParts(event.start, event.timeZone).month] : [];
      lines.push(`RRULE:FREQ=${rule.frequency.toUpperCase()};INTERVAL=${rule.interval}${rule.count !== null ? `;COUNT=${rule.count}` : ''}${rule.until !== null ? `;UNTIL=${event.timeZone === 'floating' ? compactLocal(rule.until, 'UTC') : compact(rule.until)}` : ''}${days.length ? `;BYDAY=${days.join(',')}` : ''}${rule.monthDays?.length ? `;BYMONTHDAY=${rule.monthDays.join(',')}` : ''}${months.length ? `;BYMONTH=${months.join(',')}` : ''}${rule.weekStart !== undefined ? `;WKST=${weekdays[rule.weekStart]}` : ''}`);
    }
    for (const exception of event.exceptions.filter(row => row.cancelled)) lines.push(recurrenceDate('EXDATE', exception.originalStart));
    for (const minutes of event.alerts) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(event.title)}`, `TRIGGER:-PT${minutes}M`, 'END:VALARM');
    lines.push('END:VEVENT');
    for (const exception of event.exceptions.filter(row => !row.cancelled)) {
      const detached = { ...event, ...(exception.fields ?? {}), start: exception.start, end: exception.end, recurrence: null, exceptions: [] };
      const serialized = exportCalendarICS({ ...state, events: [detached] }).replace(/\r\n[ \t]/g, '').split('\r\n');
      const body = serialized.slice(serialized.indexOf('BEGIN:VEVENT'), serialized.lastIndexOf('END:VEVENT') + 1);
      body.splice(2, 0, recurrenceDate('RECURRENCE-ID', exception.originalStart)); lines.push(...body);
    }
  }
  lines.push('END:VCALENDAR'); return lines.map(foldLine).join('\r\n') + '\r\n';
}
function parseLine(line) {
  let quoted = false, colon = -1;
  for (let index = 0; index < line.length; index++) { if (line[index] === '"') quoted = !quoted; if (line[index] === ':' && !quoted) { colon = index; break; } }
  if (colon < 1) throw new Error('Invalid iCalendar content line.');
  const head = line.slice(0, colon).match(/(?:[^;"\s]|"[^"]*")+/g) ?? [], name = head.shift()?.toUpperCase(), params = {};
  for (const part of head) { const equals = part.indexOf('='); if (equals < 1) throw new Error('Invalid iCalendar parameter.'); const key = part.slice(0, equals).toUpperCase(); if (Object.hasOwn(params, key)) throw new Error('Duplicate iCalendar parameter.'); params[key] = part.slice(equals + 1).replace(/^"|"$/g, ''); }
  return { name, params, value: line.slice(colon + 1) };
}
function parseTime(property, fallbackZone) {
  const value = property.value, dateOnly = property.params.VALUE === 'DATE' || /^\d{8}$/.test(value), match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!match || dateOnly && match[4]) throw new Error('Invalid iCalendar date.');
  const zone = match[7] ? 'UTC' : property.params.TZID ?? (dateOnly ? fallbackZone : 'floating');
  const timestamp = calendarTimestamp(`${match[1]}-${match[2]}-${match[3]}T${match[4] ?? '00'}:${match[5] ?? '00'}:${match[6] ?? '00'}`, zone);
  if (!Number.isFinite(timestamp)) throw new Error('Invalid or nonexistent timezone-local date.');
  return { timestamp, allDay: dateOnly, zone };
}
export function parseCalendarICS(ics, defaultZone = 'UTC') {
  if (typeof ics !== 'string' || ics.length > MAX_ICS || ics.includes('\0')) throw new Error('iCalendar input exceeds the local bound.');
  const lines = ics.replace(/\r\n[ \t]|\n[ \t]/g, '').split(/\r?\n/).filter(Boolean);
  if (lines[0]?.toUpperCase() !== 'BEGIN:VCALENDAR' || lines.at(-1)?.toUpperCase() !== 'END:VCALENDAR' || lines.length > 50000) throw new Error('Expected a bounded VCALENDAR.');
  const records = [], stack = []; let current = null, method = '';
  for (const line of lines) {
    const property = parseLine(line);
    if (property.name === 'BEGIN') { const kind = property.value.toUpperCase(); if (!['VCALENDAR', 'VEVENT', 'VALARM', 'VTIMEZONE', 'STANDARD', 'DAYLIGHT'].includes(kind)) throw new Error(`Unsupported iCalendar component ${kind}.`); stack.push(kind); if (kind === 'VEVENT') { if (current || records.length >= 2048) throw new Error('Too many or nested events.'); current = []; } continue; }
    if (property.name === 'END') { const kind = property.value.toUpperCase(); if (stack.pop() !== kind) throw new Error('Unbalanced iCalendar component.'); if (kind === 'VEVENT') { records.push(current); current = null; } continue; }
    if (current && stack.includes('VEVENT')) current.push({ ...property, alarm: stack.at(-1) === 'VALARM' });
    else if (property.name === 'METHOD' && stack.at(-1) === 'VCALENDAR') method = property.value.toUpperCase();
  }
  if (stack.length) throw new Error('Unclosed iCalendar component.');
  const parsed = records.map(properties => {
    const one = name => { const matches = properties.filter(row => !row.alarm && row.name === name); if (matches.length > 1) throw new Error(`Duplicate ${name}.`); return matches[0]; };
    const uid = one('UID')?.value; if (!uid || uid.length > 512) throw new Error('Every iCalendar event needs a bounded UID.');
    const zone = one('X-JESTER-TIMEZONE')?.value ?? defaultZone, begin = one('DTSTART'), finish = one('DTEND'); if (!begin || !finish) throw new Error('Every local imported event requires DTSTART and exclusive DTEND.');
    const start = parseTime(begin, zone), end = parseTime(finish, start.zone); if (start.allDay !== end.allDay) throw new Error('Event dates must use matching value types.');
    let recurrence = null;
    if (one('RDATE') || one('EXRULE')) throw new Error('RDATE and EXRULE are not representable in the native local repeat editor.');
    if (one('STATUS')?.value === 'CANCELLED') throw new Error('Cancelled invitation updates must use the local event delete/response controls.');
    if (one('RRULE')) {
      const pairs = one('RRULE').value.split(';').map(part => part.split('=')), rule = Object.fromEntries(pairs);
      if (new Set(pairs.map(pair => pair[0])).size !== pairs.length || pairs.some(pair => pair.length !== 2 || !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'WKST'].includes(pair[0]))) throw new Error('Unsupported iCalendar recurrence property.');
      const dayPatterns = rule.BYDAY ? rule.BYDAY.split(',').map(value => { const match = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(value); if (!match) throw new Error('Invalid BYDAY.'); return { weekday: weekdays.indexOf(match[2]), ordinal: match[1] ? Number(match[1]) : null }; }) : [];
      if (rule.FREQ === 'YEARLY' && dayPatterns.some(row => row.ordinal !== null) && !rule.BYMONTH) throw new Error('Year-wide ordinal recurrence needs selected months in the native local editor.');
      recurrence = { frequency: rule.FREQ?.toLowerCase(), interval: Number(rule.INTERVAL ?? 1), count: rule.COUNT ? Number(rule.COUNT) : null, until: rule.UNTIL ? parseTime({ value: rule.UNTIL, params: {} }, start.zone).timestamp : null, weekdays: dayPatterns.filter(row => row.ordinal === null).map(row => row.weekday) };
      if (dayPatterns.some(row => row.ordinal !== null)) recurrence.ordinalWeekdays = dayPatterns.filter(row => row.ordinal !== null);
      if (rule.BYMONTHDAY) recurrence.monthDays = rule.BYMONTHDAY.split(',').map(Number);
      if (rule.BYMONTH) recurrence.months = rule.BYMONTH.split(',').map(Number);
      if (rule.WKST) { if (!weekdays.includes(rule.WKST)) throw new Error('Invalid WKST.'); recurrence.weekStart = weekdays.indexOf(rule.WKST); }
    }
    if (properties.some(row => row.alarm && row.name === 'ACTION' && row.value !== 'DISPLAY')) throw new Error('Only local notification display alarms are imported; email/audio/open-file alarms require an explicit supported bridge.');
    const event = { title: unescapeText(one('SUMMARY')?.value ?? 'Untitled Event'), start: start.timestamp, end: end.timestamp, allDay: start.allDay, timeZone: start.zone, location: unescapeText(one('LOCATION')?.value ?? ''), notes: unescapeText(one('DESCRIPTION')?.value ?? ''), url: one('URL')?.value ?? '', travelMinutes: Number(one('X-JESTER-TRAVEL-MINUTES')?.value ?? 0), recurrence, alerts: properties.filter(row => row.alarm && row.name === 'TRIGGER').map(row => { const match = /^-PT(?:(\d+)H)?(?:(\d+)M)?$/.exec(row.value); if (!match || !match[1] && !match[2]) throw new Error('Only relative minute/hour display alarms are supported locally.'); return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0); }), invitees: properties.filter(row => !row.alarm && row.name === 'ATTENDEE').map(row => ({ email: row.value.replace(/^mailto:/i, ''), name: unescapeText(row.params.CN ?? ''), status: ({ ACCEPTED: 'accepted', DECLINED: 'declined', TENTATIVE: 'tentative', 'NEEDS-ACTION': 'pending' })[row.params.PARTSTAT ?? 'NEEDS-ACTION'] ?? 'pending' })), organizer: one('ORGANIZER')?.value.replace(/^mailto:/i, '') ?? '' };
    const exdates = properties.filter(row => row.name === 'EXDATE').flatMap(row => row.value.split(',').map(value => parseTime({ value, params: row.params }, start.zone).timestamp));
    const attachments = properties.filter(row => row.name === 'ATTACH').map(row => { if (!row.value.startsWith('jester-file:')) throw new Error('External attachments are not fetched; attach an existing local canonical file instead.'); return { fileId: row.value.slice(12), name: unescapeText(row.params['X-JESTER-NAME'] ?? row.value.slice(12)) }; });
    const recurrenceId = one('RECURRENCE-ID');
    return { uid, event, sequence: Number(one('SEQUENCE')?.value ?? 0), originalStart: recurrenceId ? parseTime(recurrenceId, start.zone).timestamp : null, exdates, attachments };
  });
  return { method, records: parsed };
}
export function importCalendarICS(state, ics, calendarId, replace = false) {
  const cal = state.calendars.find(row => row.id === calendarId); if (!cal || cal.readOnly && !cal.subscription) return { ok: false, message: 'Import needs an existing writable calendar.' };
  try {
    const { records, method } = parseCalendarICS(ics, state.preferences.timeZone), candidate = copyCanonicalData(state), imported = [], uidMap = new Map();
    if (!['', 'PUBLISH', 'REQUEST'].includes(method)) throw new Error('Use the invitation response controls for local responses; this importer accepts PUBLISH and REQUEST only.');
    if (replace) {
      const sourceUids = new Set(records.filter(row => row.originalStart === null).map(row => row.uid));
      const removed = new Set(candidate.events.filter(event => event.calendarId === calendarId && !sourceUids.has(event.icalUid)).map(event => event.id));
      candidate.events = candidate.events.filter(event => !removed.has(event.id));
      candidate.invitations = candidate.invitations.filter(row => !removed.has(row.eventId));
      candidate.alertDeliveries = candidate.alertDeliveries.filter(row => !removed.has(row.eventId));
      for (const win of candidate.windows) if (removed.has(win.selectedEventId)) { win.selectedEventId = null; win.selectedOccurrence = null; win.sheet = null; }
    }
    for (const row of records.filter(row => row.originalStart === null)) {
      if (uidMap.has(row.uid)) throw new Error('Duplicate master UID.');
      if (!calendarValueConforms({ ...row.event, calendarId }, object(calendarEventFields))) throw new Error('Unsupported or invalid event values.');
      let event = candidate.events.find(event => event.icalUid === row.uid && event.calendarId === calendarId);
      if (event) {
        if (method === 'REQUEST' && row.sequence <= event.sequence) throw new Error('Organizer update must advance the original event sequence.');
        if (method === 'REQUEST' && event.organizer.toLowerCase() !== row.event.organizer.toLowerCase()) throw new Error('An organizer update must retain the original organizer.');
        Object.assign(event, row.event, { sequence: row.sequence, revision: event.revision + 1, attachments: row.attachments, exceptions: [] });
        for (const win of candidate.windows) if (win.selectedEventId === event.id) win.selectedOccurrence = null;
        candidate.invitations = candidate.invitations.filter(inv => inv.eventId !== event.id);
        candidate.alertDeliveries = candidate.alertDeliveries.filter(delivery => delivery.eventId !== event.id);
      }
      else { const created = createCalendarEvent(candidate, { ...row.event, calendarId, icalUid: row.uid }); if (!created.ok) throw new Error(created.message); event = created.event; Object.assign(event, { attachments: row.attachments, sequence: row.sequence }); }
      event.exceptions = row.exdates.map(originalStart => ({ originalStart, cancelled: true, start: originalStart, end: originalStart + event.end - event.start }));
      if (method === 'REQUEST' && event.organizer) candidate.invitations.push({ id: calendarAllocateId(candidate, 'invitation'), eventId: event.id, sender: event.organizer, status: 'pending', sequence: event.sequence });
      uidMap.set(row.uid, event); imported.push(event.id);
    }
    for (const row of records.filter(row => row.originalStart !== null)) {
      const event = uidMap.get(row.uid); if (!event || !event.recurrence) throw new Error('Detached recurrence requires its imported master.');
      const fields = Object.fromEntries(Object.entries(row.event).filter(([key]) => !['start', 'end', 'recurrence'].includes(key)));
      fields.attachments = row.attachments;
      event.exceptions.push({ originalStart: row.originalStart, cancelled: false, start: row.event.start, end: row.event.end, fields });
    }
    const valid = validateCalendarState(candidate); if (!valid.ok) throw new Error(valid.message);
    // Keep existing canonical record objects: async owners cannot borrow replacements.
    const retained = new Set(candidate.events.map(event => event.id));
    for (let index = state.events.length - 1; index >= 0; index--) if (!retained.has(state.events[index].id)) state.events.splice(index, 1);
    for (const incoming of candidate.events) { const original = state.events.find(event => event.id === incoming.id); if (original) Object.assign(original, incoming); else state.events.push(incoming); }
    for (const win of state.windows) { const incoming = candidate.windows.find(row => row.windowId === win.windowId); if (incoming) Object.assign(win, { selectedEventId: incoming.selectedEventId, selectedOccurrence: incoming.selectedOccurrence, sheet: incoming.sheet }); }
    state.invitations = candidate.invitations; state.alertDeliveries = candidate.alertDeliveries; state.nextId = candidate.nextId;
    return { ok: true, eventIds: imported };
  } catch (error) { return { ok: false, message: error.message }; }
}

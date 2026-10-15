import { object, choice, flag } from './command-schema.js';
import { copyCanonicalData, canonicalStringUnits } from './canonical-data.js';

export const REMINDERS_PROFILES = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
export const reminderColors = ['#c47f17', '#3b7bbf', '#ca68d7', '#e64c4c', '#62a948', '#6558ce', '#808080'];
export const reminderViews = ['list', 'scheduled', 'today', 'all', 'flagged', 'completed', 'my-day'];
const text = maxLength => ({ type: 'string', maxLength });
export const reminderIdSchema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
export const reminderTimeSchema = integer(0, 8640000000000000 - 1);
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', maxLength: 10 };
export const reminderRecurrenceSchema = nullable(object({ frequency: choice('daily', 'weekly', 'monthly', 'yearly'), interval: integer(1, 365), until: nullable(reminderTimeSchema) }));
export const reminderLocationSchema = nullable(object({ label: { ...text(1024), minLength: 1 }, transition: choice('arriving', 'leaving'), radius: integer(50, 10000) }));
export const reminderSpecSchema = object({ listId: reminderIdSchema, title: { ...text(1024), minLength: 1 }, notes: text(65536), dueAt: nullable(reminderTimeSchema), hasTime: flag, priority: integer(0, 3), recurrence: reminderRecurrenceSchema, location: reminderLocationSchema, flagged: flag, myDay: nullable(date) });
export const reminderTaskSchema = object({ id: reminderIdSchema, ...reminderSpecSchema.properties, completed: flag, completedAt: nullable(reminderTimeSchema), revision: integer(1, Number.MAX_SAFE_INTEGER - 1) });
export const reminderDraftSchema = object({ ...reminderSpecSchema.properties, title: text(1024), location: nullable(object({ ...reminderLocationSchema.anyOf[0].properties, label: text(1024) })) });
export const reminderListSchema = object({ id: reminderIdSchema, accountId: reminderIdSchema, name: { ...text(1024), minLength: 1 }, color: { ...text(64), minLength: 1 }, sharedWith: { type: 'array', maxItems: 64, items: { ...text(1024), minLength: 1 }, uniqueItems: true } });
export const reminderAccountSchema = object({ id: reminderIdSchema, name: { ...text(1024), minLength: 1 }, provider: choice('local', 'iCloud', 'Exchange', 'Microsoft', 'Yahoo', 'AOL'), enabled: flag });
export const reminderPreferencesSchema = object({ defaultListId: nullable(reminderIdSchema), showCompleted: flag, sort: choice('manual', 'due', 'priority', 'title'), ascending: flag, notifications: flag, allDayHour: integer(0, 23), theme: choice('system', 'light', 'dark'), confirmDelete: flag });
export const reminderWindowSchema = object({ windowId: reminderIdSchema, listId: nullable(reminderIdSchema), view: choice(...reminderViews), query: text(1024), selectedId: nullable(reminderIdSchema), showCompleted: flag, sidebar: flag, calendar: flag, calendarDate: date, sheet: choice('none', 'inspector', 'list', 'delete-list', 'delete-task', 'preferences', 'accounts', 'share', 'about', 'help'), editorId: nullable(reminderIdSchema), editorRevision: nullable(integer(1, Number.MAX_SAFE_INTEGER - 1)), editor: nullable(reminderDraftSchema), editingListId: nullable(reminderIdSchema) });
export const reminderAlertSchema = object({ id: reminderIdSchema, reminderId: reminderIdSchema, revision: integer(1, Number.MAX_SAFE_INTEGER - 1), due: reminderTimeSchema, trigger: choice('time', 'location'), notificationId: nullable(reminderIdSchema), status: choice('delivered', 'snoozed', 'dismissed', 'completed'), deliveredAt: reminderTimeSchema, snoozeAt: nullable(reminderTimeSchema) });
const rows = (schema, maxItems) => ({ type: 'array', maxItems, items: schema });
export const remindersStateSchema = object({ nextId: integer(1, Number.MAX_SAFE_INTEGER - 1), accounts: rows(reminderAccountSchema, 64), lists: rows(reminderListSchema, 256), tasks: rows(reminderTaskSchema, 4096), alerts: rows(reminderAlertSchema, 8192), windows: rows(reminderWindowSchema, 64), preferences: reminderPreferencesSchema });

// Check descriptors before traversing: getters, sparse arrays, proxies changing their
// descriptor set, cycles and foreign prototypes are not trusted saved-state input.
export function reminderValueConforms(value, schema) {
  const seen = new Set(), captures = [];
  function check(v, s) {
    if (s.anyOf) return s.anyOf.some(option => check(v, option));
    if (s.enum) return s.enum.includes(v);
    if (s.const !== undefined) return v === s.const;
    if (s.type === 'null') return v === null;
    if (s.type === 'string') return typeof v === 'string' && v.length >= (s.minLength ?? 0) && v.length <= (s.maxLength ?? Infinity) && (!s.pattern || new RegExp(s.pattern).test(v)) && !s.not?.enum?.includes(v);
    if (s.type === 'boolean') return typeof v === 'boolean';
    if (s.type === 'integer') return Number.isSafeInteger(v) && v >= s.minimum && v <= s.maximum;
    if (!v || typeof v !== 'object' || seen.has(v)) return false;
    const proto = Object.getPrototypeOf(v), descriptors = Object.getOwnPropertyDescriptors(v);
    if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !Object.hasOwn(descriptors[key], 'value'))) return false;
    seen.add(v); captures.push({ value: v, proto, descriptors });
    let ok;
    if (s.type === 'array') {
      const n = descriptors.length?.value;
      ok = Array.isArray(v) && proto === Array.prototype && Number.isSafeInteger(n) && n <= s.maxItems && Reflect.ownKeys(descriptors).length === n + 1;
      if (ok) for (let i = 0; i < n; i++) if (!descriptors[i]?.enumerable || !check(descriptors[i].value, s.items)) { ok = false; break; }
      if (ok && s.uniqueItems) ok = new Set(Array.from({ length: n }, (_, i) => descriptors[i].value)).size === n;
    } else {
      const keys = Object.keys(descriptors);
      ok = (proto === Object.prototype || proto === null) && keys.every(key => Object.hasOwn(s.properties, key) && descriptors[key].enumerable) && s.required.every(key => Object.hasOwn(descriptors, key));
      if (ok) for (const key of keys) if (!check(descriptors[key].value, s.properties[key])) { ok = false; break; }
    }
    seen.delete(v); return ok;
  }
  try {
    if (!check(value, schema)) return false;
    return captures.every(c => Object.getPrototypeOf(c.value) === c.proto && (() => { const now = Object.getOwnPropertyDescriptors(c.value); return Reflect.ownKeys(now).length === Reflect.ownKeys(c.descriptors).length && Reflect.ownKeys(c.descriptors).every(k => now[k] && ['value', 'writable', 'enumerable', 'configurable', 'get', 'set'].every(f => now[k][f] === c.descriptors[k][f])); })());
  } catch { return false; }
}
export function validateRemindersState(state, profile) {
  const bad = message => ({ ok: false, message });
  if (!REMINDERS_PROFILES.includes(profile?.id) || !reminderValueConforms(state, remindersStateSchema)) return bad('Reminders requires a closed, bounded, descriptor-safe canonical graph.');
  const ids = new Set();
  for (const group of [state.accounts, state.lists, state.tasks, state.alerts]) for (const row of group) { if (ids.has(row.id)) return bad('Canonical IDs must be unique.'); ids.add(row.id); }
  const account = id => state.accounts.some(row => row.id === id), list = id => state.lists.some(row => row.id === id), task = id => state.tasks.some(row => row.id === id);
  if (state.lists.some(row => !account(row.accountId)) || state.tasks.some(row => !list(row.listId))) return bad('Lists and reminders must retain their original canonical owner.');
  if (state.preferences.defaultListId !== null && !list(state.preferences.defaultListId)) return bad('The default list must exist.');
  const validSpec = row => list(row.listId) && (!row.recurrence || row.dueAt !== null && (row.recurrence.until === null || row.recurrence.until >= row.dueAt)) && (row.dueAt !== null || !row.hasTime) && (row.myDay === null || reminderDateValid(row.myDay));
  if (state.tasks.some(row => !validSpec(row) || row.completed !== (row.completedAt !== null))) return bad('Completion, due date and recurrence must be consistent.');
  if (new Set(state.windows.map(row => row.windowId)).size !== state.windows.length || state.windows.some(row => row.listId !== null && !list(row.listId) || row.selectedId !== null && !task(row.selectedId) || row.editorId !== null && !task(row.editorId) || row.editingListId !== null && !list(row.editingListId) || row.editor && !validSpec(row.editor) || !reminderDateValid(row.calendarDate))) return bad('Every native session must reference actual canonical records.');
  if (state.windows.some(row => (row.editor === null && (row.editorId !== null || row.editorRevision !== null || row.sheet === 'inspector')) || (row.editor !== null && row.sheet !== 'inspector') || ((row.editorId === null) !== (row.editorRevision === null)))) return bad('The inspector draft, source revision and actual native sheet must agree.');
  const cycles = new Set();
  const notifications = new Set();
  for (const alert of state.alerts) { const key = `${alert.reminderId}:${alert.revision}`, source = state.tasks.find(row => row.id === alert.reminderId); if (!source || alert.revision > source.revision || ['delivered','snoozed'].includes(alert.status) && alert.revision !== source.revision || cycles.has(key) || (alert.status === 'snoozed') !== (alert.snoozeAt !== null) || alert.notificationId === null || notifications.has(alert.notificationId)) return bad('Delivery ledger must have one actual notification per original reminder revision.'); cycles.add(key); notifications.add(alert.notificationId); }
  if (remindersTextUnits(state) > 4 * 1024 * 1024) return bad('Reminder text exceeds the scene text limit.');
  return { ok: true };
}
export const remindersTextUnits = canonicalStringUnits;
export function remindersMutable(value) {
  if (value === null || typeof value !== 'object') return true;
  try { const descriptors = Object.getOwnPropertyDescriptors(value); return Object.isExtensible(value) && Reflect.ownKeys(descriptors).every(key => { const d = descriptors[key]; return Object.hasOwn(d, 'value') && d.writable === true && (key === 'length' && Array.isArray(value) || d.configurable === true) && remindersMutable(d.value); }); } catch { return false; }
}
export const reminderEpoch = value => typeof value === 'number' ? value : Date.parse(value);
export const reminderDate = time => new Date(time).toISOString().slice(0, 10);
export const reminderDateValid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && reminderDate(Date.parse(`${value}T00:00:00Z`)) === value;
export const reminderWindow = (state, id) => state.windows.find(row => row.windowId === id);
export function reminderAllocateId(state, prefix) { let id; do { id = `${prefix}-${state.nextId++}`; } while ([...state.accounts, ...state.lists, ...state.tasks, ...state.alerts].some(row => row.id === id)); return id; }
export function emptyReminderSpec(listId) { return { listId, title: '', notes: '', dueAt: null, hasTime: false, priority: 0, recurrence: null, location: null, flagged: false, myDay: null }; }
export function reminderSpec(task) { return Object.fromEntries(Object.keys(reminderSpecSchema.properties).map(key => [key, copyCanonicalData(task[key])])); }
export function createRemindersState(profile) {
  const time = reminderEpoch(profile.defaults.sceneTime);
  return { nextId: 1, accounts: [{ id: 'reminders-local', name: profile.id.includes('windows') ? 'Local Microsoft account' : 'On My Mac', provider: profile.id.includes('windows') ? 'Microsoft' : 'local', enabled: true }, { id: 'reminders-cloud', name: 'iCloud (fictional)', provider: 'iCloud', enabled: true }], lists: [{ id: 'packing', accountId: 'reminders-local', name: 'Packing', color: '#c47f17', sharedWith: [] }, { id: 'maintenance', accountId: 'reminders-cloud', name: 'Maintenance', color: '#3b7bbf', sharedWith: [] }], tasks: [
    { ...emptyReminderSpec('packing'), id: 'reminder-1', title: 'Bring map pouch', dueAt: time + 31 * 3600000 + 19 * 60000, hasTime: true, completed: false, completedAt: null, revision: 1 },
    { ...emptyReminderSpec('packing'), id: 'reminder-2', title: 'Fill water bottles', completed: false, completedAt: null, revision: 1 },
    { ...emptyReminderSpec('packing'), id: 'reminder-3', title: 'Return borrowed trekking poles', dueAt: time + 7 * 3600000 + 19 * 60000, hasTime: true, completed: true, completedAt: time, revision: 1 },
    { ...emptyReminderSpec('maintenance'), id: 'reminder-4', title: 'Check bridge planks', dueAt: time + 23 * 3600000 + 19 * 60000, hasTime: true, completed: false, completedAt: null, revision: 1 },
    { ...emptyReminderSpec('maintenance'), id: 'reminder-5', title: 'Restock first-aid kit', completed: false, completedAt: null, revision: 1 }], alerts: [], windows: [], preferences: { defaultListId: 'packing', showCompleted: false, sort: 'manual', ascending: true, notifications: true, allDayHour: 9, theme: 'system', confirmDelete: true } };
}
export function importReminderWidgetSources(state, sources, profile) {
  const original = validateRemindersState(state,profile); if (!original.ok) return original;
  const schema = object({ reminderLists: { type: 'array', maxItems: 256, items: object({ id: reminderIdSchema, name: { ...text(1024), minLength: 1 }, color: text(64) }) }, reminders: { type: 'array', maxItems: 4096, items: object({ id: reminderIdSchema, listId: reminderIdSchema, title: { ...text(1024), minLength: 1 }, completed: flag, dueAt: nullable(reminderTimeSchema) }) } });
  if (!reminderValueConforms(sources, schema)) return { ok: false, message: 'Provide only the old reminderLists and reminders source rows.' };
  const candidate = copyCanonicalData(state), now = reminderEpoch(profile.defaults.sceneTime);
  candidate.lists = sources.reminderLists.map(row => ({ ...row, accountId: 'reminders-local', sharedWith: [] }));
  candidate.tasks = sources.reminders.map(row => ({ ...emptyReminderSpec(row.listId), ...row, hasTime: row.dueAt !== null, completedAt: row.completed ? now : null, revision: 1 }));
  candidate.alerts = []; candidate.windows = []; candidate.preferences.defaultListId = candidate.lists[0]?.id ?? null;
  const checked = validateRemindersState(candidate, profile); return checked.ok ? { ok: true, state: candidate } : checked;
}
export function reminderWidgetProjection(state) {
  return Object.freeze({ reminderLists: Object.freeze(state.lists.filter(list => state.accounts.find(row => row.id === list.accountId)?.enabled).map(({ id, name, color }) => Object.freeze({ id, name, color }))), reminders: Object.freeze(state.tasks.filter(task => state.accounts.find(row => row.id === state.lists.find(list => list.id === task.listId)?.accountId)?.enabled).map(({ id, listId, title, completed, dueAt }) => Object.freeze({ id, listId, title, completed, dueAt }))) });
}
export const reminderCalendarProjection = state => Object.freeze(state.tasks.filter(row => row.dueAt !== null).map(row => Object.freeze({ id: row.id, reminderId: row.id, title: row.title, due: row.dueAt, allDay: !row.hasTime, completed: row.completed, listId: row.listId })));
export function visibleReminders(state, windowId, sceneTime) {
  const win = reminderWindow(state, windowId); if (!win) return [];
  const today = reminderDate(reminderEpoch(sceneTime)), enabled = new Set(state.lists.filter(row => state.accounts.find(a => a.id === row.accountId)?.enabled).map(row => row.id));
  let tasks = state.tasks.filter(row => enabled.has(row.listId) && (win.view !== 'list' || row.listId === win.listId) && (win.view !== 'scheduled' || row.dueAt !== null) && (win.view !== 'today' || row.dueAt !== null && reminderDate(row.dueAt) <= today) && (win.view !== 'my-day' || row.myDay === today) && (win.view !== 'flagged' || row.flagged) && (win.view !== 'completed' || row.completed) && (win.view === 'completed' || win.showCompleted || !row.completed) && (!win.query || `${row.title}\n${row.notes}`.toLocaleLowerCase().includes(win.query.toLocaleLowerCase())));
  const sort = state.preferences.sort;
  if (sort !== 'manual') tasks = tasks.slice().sort((a, b) => (sort === 'due' ? (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) : sort === 'priority' ? b.priority - a.priority : a.title.localeCompare(b.title)) * (state.preferences.ascending ? 1 : -1));
  return tasks;
}
export function nextReminderDue(task) {
  if (!task.recurrence || task.dueAt === null) return null;
  const { frequency, interval, until } = task.recurrence, current = new Date(task.dueAt), d = new Date(task.dueAt);
  if (frequency === 'daily' || frequency === 'weekly') d.setUTCDate(d.getUTCDate() + interval * (frequency === 'weekly' ? 7 : 1));
  else { const day = d.getUTCDate(); d.setUTCDate(1); if (frequency === 'monthly') d.setUTCMonth(d.getUTCMonth() + interval); else d.setUTCFullYear(d.getUTCFullYear() + interval); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); }
  const value = d.getTime(); return Number.isSafeInteger(value) && value > current.getTime() && value < 8640000000000000 && (until === null || value <= until) ? value : null;
}
export function reminderAlertDue(state, task) { if (task.dueAt === null) return null; if (task.hasTime) return task.dueAt; const date = new Date(task.dueAt); date.setUTCHours(state.preferences.allDayHour, 0, 0, 0); return date.getTime(); }

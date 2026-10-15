<script>
  import { onMount, tick } from 'svelte';
  // Classic macOS versions draw their own chrome; Windows 11 keeps the caption
  // in the shared window frame outside this surface.
  import WindowControls from './WindowControls.svelte';
  import {
    calendarWindow, calendarOccurrences, calendarDateParts, calendarTimestamp,
    calendarDateAdd, calendarDateString, calendarLocalString, calendarTimeZoneValid
  } from './calendar-state.js';
  import { calendarMenuProvider } from './calendar-menus.js';
  import { createCalendarNativeView } from './calendar-native-view.js';
  import './calendar.css';

  let { state: calendarData, profile, windowId, execute, registerView, available = true, active = true, controls = {}, sceneTime = null, reminders = [], showLocalMenus = true } = $props();

  const canonicRenderer = candidate => {
    const source = typeof candidate === 'string' ? candidate : candidate?.renderer ?? candidate?.id ?? '';
    for (const key of ['high-sierra', 'mojave', 'sonoma', 'golden-gate', 'windows11']) if (source.startsWith(key)) return key;
    return source.includes('windows11') ? 'windows11' : 'sonoma';
  };

  let root;
  let mounted = false;
  let originalData, originalRoot;
  let error = $state('');
  let openMenu = $state('');
  const sheet = $derived(view?.sheet === 'event' ? '' : view?.sheet ?? '');
  let form = $state({ __kind: '' });
  let editor = $state(null);
  let popover = $state(null);
  let contextMenu = $state(null);
  let queryDraft = $state('');
  let editFocusVersion = $state(0);
  let drag = $state(null);

  const profileId = $derived(profile?.id && ['high-sierra', 'mojave', 'sonoma', 'golden-gate', 'windows11'].includes(profile.id) ? profile.id : canonicRenderer(profile));
  const windows = $derived(profileId === 'windows11' || typeof profile?.family === 'string' && profile.family.startsWith('windows'));
  const classic = $derived(profileId === 'high-sierra' || profileId === 'mojave');
  const view = $derived(calendarWindow(calendarData, windowId));
  const prefs = $derived(calendarData.preferences);
  const zone = $derived(prefs.timeZone);
  // Shared clock: parent-supplied sceneTime through controls/props, profile
  // fixture as the only fallback. Host wall-clock is never read.
  const stamp = $derived.by(() => {
    const supplied = controls?.sceneTime ?? sceneTime;
    if (supplied != null) {
      const value = typeof supplied === 'number' ? supplied : Date.parse(supplied);
      if (Number.isFinite(value)) return value;
    }
    const fixture = typeof profile === 'object' ? profile?.defaults?.sceneTime : null;
    return Date.parse(fixture) || 0;
  });
  const TODAY = $derived(calendarDateString(stamp, zone));
  // Display matches derive only from the authoritative canonical query; the
  // input stays a local draft that reconciles toward view.query at the edges.
  const query = $derived.by(() => (view?.query ?? '').trim().toLocaleLowerCase('en-US'));
  $effect(() => {
    if (typeof view?.query === 'string') queryDraft = view.query;
  });

  function owns() {
    return mounted && available && root === originalRoot && calendarData === originalData && root?.isConnected && !root.closest('[hidden], [inert]');
  }
  async function command(name, target = {}, payload = {}) {
    if (!owns()) return null;
    const owner = root, ownerData = calendarData;
    try {
      const result = await execute(name, { windowId, ...target }, payload);
      if (owner === root && ownerData === calendarData && owns()) {
        error = result?.status === 'rejected' || result?.status === 'unavailable'
          ? result.error?.message ?? result.message ?? 'This operation is unavailable.' : '';
      }
      return result;
    } catch (cause) {
      if (owner === root && ownerData === calendarData && owns()) error = cause?.message ?? 'The operation could not be completed.';
      return null;
    }
  }
  const applied = result => result?.status === 'applied';

  // Search submits through the canonical query command; the input draft stays
  // truthful: success reads back the canonical wording, failure reconciles the
  // actual DOM field onto the controller's current query.
  async function submitSearch(node) {
    const target = node ?? root?.querySelector('[data-calendar-control="search"]');
    const submitted = typeof target?.value === 'string' ? target.value : queryDraft;
    const origin = target ? { value: target.value, start: target.selectionStart, end: target.selectionEnd } : null;
    const canonicalBefore = view?.query ?? '';
    const result = await command('calendar.view.set', {}, { query: submitted });
    const canonicalAfter = view?.query ?? '';
    if (target && origin && target.isConnected && target.value === origin.value && target.selectionStart === origin.start && target.selectionEnd === origin.end) {
      if (applied(result)) {
        queryDraft = canonicalAfter;
        if (target.value !== canonicalAfter) { target.value = canonicalAfter; target.dispatchEvent(new Event('input', { bubbles: true })); target.setSelectionRange(canonicalAfter.length, canonicalAfter.length); }
        return true;
      }
      reconcileSearchInput(canonicalBefore, target);
    }
    return false;
  }
  function reconcileSearchInput(canonical = view?.query ?? '', node = root?.querySelector('[data-calendar-control="search"]')) {
    if (!node) return;
    queryDraft = canonical;
    if (node.value !== canonical) {
      node.value = canonical;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.setSelectionRange(canonical.length, canonical.length);
    }
  }
  // Real DOM observation drives the native Edit menu: probe the focused
  // editable and its local history rather than pretending clipboard success.
  const editAvailability = $derived.by(() => {
    void editFocusVersion;
    if (!owns()) return { cut: false, copy: false, paste: false, selectAll: false, undo: false, redo: false, focus: null };
    const active = root?.ownerDocument.activeElement;
    const target = active && root?.contains(active) && typeof active.selectionStart === 'number' && typeof active.value === 'string' ? active : null;
    if (!target) return { cut: false, copy: false, paste: false, selectAll: false, undo: false, redo: false, focus: null };
    const history = target.__calendarHistory;
    return { cut: target.selectionStart < target.selectionEnd, copy: target.selectionStart < target.selectionEnd,
      paste: true, selectAll: true, undo: Boolean(history?.undo?.length), redo: Boolean(history?.redo?.length),
      focus: target.dataset.calendarControl ?? null };
  });

  // ---------------------------------------------------------------- views
  const weekdayLabels = (() => {
    const names = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });
    // Jan 2023 starts on Sunday, so index 0 = Sunday…index 6 = Saturday, aligned
    // with getUTCDay(). No further rotation below.
    return Array.from({ length: 7 }, (_, index) => names.format(new Date(Date.UTC(2023, 0, index + 1))));
  })();
  function weekdayIndex(date) { return new Date(`${date}T00:00:00Z`).getUTCDay(); }
  const visibleRange = $derived.by(() => {
    if (!view) return null;
    const date = view.date;
    if (view.view === 'day') return { first: date, last: date, until: calendarDateAdd(date, 'day', 1) };
    if (view.view === 'week') {
      const first = calendarDateAdd(date, 'day', -(((weekdayIndex(date) - (prefs.daysPerWeek === 5 ? 1 : prefs.weekStart)) + 7) % 7));
      return { first, last: calendarDateAdd(first, 'day', prefs.daysPerWeek - 1), until: calendarDateAdd(first, 'day', prefs.daysPerWeek) };
    }
    if (view.view === 'month') {
      const first = `${date.slice(0, 7)}-01`;
      const lead = ((weekdayIndex(first) - prefs.weekStart) + 7) % 7;
      const end = calendarDateAdd(calendarDateAdd(first, 'month', 1), 'day', -1);
      const rows = Math.ceil((lead + Number(end.slice(-2))) / 7);
      const start = calendarDateAdd(first, 'day', -lead);
      return { first: start, last: calendarDateAdd(start, 'day', rows * 7 - 1), until: calendarDateAdd(start, 'day', rows * 7) };
    }
    return { first: `${date.slice(0, 4)}-01-01`, last: `${date.slice(0, 4)}-12-31`, until: `${Number(date.slice(0, 4)) + 1}-01-01` };
  });
  // Upper bound is exclusive; only the day view adds one day, never extra
  // weeks/months/years.
  const occurrences = $derived.by(() => {
    if (!visibleRange) return [];
    return calendarOccurrences(calendarData,
      calendarTimestamp(`${visibleRange.first}T00:00`, zone),
      calendarTimestamp(`${visibleRange.until}T00:00`, zone), { query });
  });
  function frameTitle() {
    const parts = calendarDateParts(calendarTimestamp(`${view.date}T12:00`, zone), zone);
    if (view.view === 'year') return `${view.date.slice(0, 4)}`;
    if (view.view === 'month') return `${monthAlone(parts.month)} ${parts.year}`;
    if (view.view === 'week' && visibleRange) {
      const first = calendarDateParts(calendarTimestamp(`${visibleRange.first}T12:00`, zone), zone);
      const last = calendarDateParts(calendarTimestamp(`${visibleRange.last}T12:00`, zone), zone);
      return first.month === last.month ? `${monthAlone(first.month)} ${first.day} – ${last.day}, ${last.year}`
        : `${monthAlone(first.month)} ${first.day} – ${monthAlone(last.month)} ${last.day}, ${last.year}`;
    }
    return `${weekdayName(view.date)} ${monthAlone(parts.month)} ${parts.day}, ${parts.year}`;
  }
  function weekdayName(date) { return weekdayLabels[weekdayIndex(date)]; }
  function weekLabel(date) {
    const parts = calendarDateParts(calendarTimestamp(`${date}T12:00`, zone), zone);
    return `${weekdayName(date)} ${parts.day}`;
  }
  function monthAlone(month) {
    return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month - 1];
  }
  // Sidebar mini month always renders exactly one month, independent from the
  // big day/week/month/year ranges.
  function miniGrid() {
    if (!view) return [];
    const key = view.date.slice(0, 7), first = `${key}-01`;
    const lead = ((weekdayIndex(first) - prefs.weekStart) + 7) % 7;
    const length = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate();
    const cells = [];
    for (let back = lead; back >= 1; back--) {
      const date = calendarDateAdd(first, 'day', -back);
      cells.push({ date, inMonth: false, today: date === TODAY, day: Number(date.slice(-2)) });
    }
    for (let day = 1; day <= length; day++) {
      const date = `${key}-${String(day).padStart(2, '0')}`;
      cells.push({ date, inMonth: true, today: date === TODAY, day });
    }
    return cells;
  }
  function monthGrid() {
    if (!view || !visibleRange) return [];
    const cells = [];
    for (let date = visibleRange.first; date < visibleRange.until; date = calendarDateAdd(date, 'day', 1)) {
      cells.push({ date, inMonth: date.slice(0, 7) === view.date.slice(0, 7), today: date === TODAY, day: Number(date.slice(-2)) });
    }
    return cells;
  }
  // Year view: 42-cell months aligned on weekStart; out-month days are dimmed
  // and inert so clicking only selects real dates of the authored year.
  function monthYearCells(year) {
    return Array.from({ length: 12 }, (_, index) => {
      const month = index + 1, key = `${year}-${String(month).padStart(2, '0')}`;
      const first = `${key}-01`;
      const lead = ((weekdayIndex(first) - prefs.weekStart) + 7) % 7;
      const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const days = [];
      for (let back = lead; back >= 1; back--) {
        const date = calendarDateAdd(first, 'day', -back);
        days.push({ date, inMonth: false, today: false, day: Number(date.slice(-2)) });
      }
      for (let day = 1; day <= length; day++) {
        const date = `${key}-${String(day).padStart(2, '0')}`;
        days.push({ date, inMonth: true, today: date === TODAY, day });
      }
      return { month, days };
    });
  }
  function dayCell(day) {
    const start = calendarTimestamp(`${day}T00:00`, zone), end = calendarTimestamp(`${calendarDateAdd(day, 'day', 1)}T00:00`, zone);
    const rows = occurrences.filter(row => row.start < end && row.end > start);
    const timed = rows.filter(row => !row.allDay), allDay = rows.filter(row => row.allDay);
    const clusters = [];
    for (const row of timed.slice().sort((left, right) => left.start - right.start)) {
      const cluster = clusters.at(-1);
      if (cluster?.some(cell => cell.end > row.start)) cluster.push(row);
      else clusters.push([row]);
    }
    const layout = new Map();
    for (const cluster of clusters) {
      cluster.sort((left, right) => left.start - right.start || left.end - right.end);
      const columns = [];
      for (const row of cluster) {
        const free = columns.findIndex(column => column.every(cell => cell.end <= row.start || cell.start >= row.end));
        free === -1 ? columns.push([row]) : columns[free].push(row);
      }
      columns.forEach((column, index) => column.forEach(cell => layout.set(`${cell.eventId}@${cell.originalStart}`, { column: index, columns: columns.length })));
    }
    return { day, timed: timed.map(row => { const shape = layout.get(`${row.eventId}@${row.originalStart}`) ?? { column: 0, columns: 1 }; return { ...row, ...shape }; }), allDay };
  }
  function hourRows() { return Array.from({ length: Math.max(1, prefs.dayEnd - prefs.dayStart) }, (_, index) => prefs.dayStart + index); }
  function clockLabel(hour) {
    const display = hour % 12 === 0 ? 12 : hour % 12;
    return `${display} ${hour >= 12 ? 'PM' : 'AM'}`;
  }
  function hourOffset(timestamp, eventZone) {
    const parts = calendarDateParts(timestamp, eventZone);
    return parts.hour - prefs.dayStart + parts.minute / 60;
  }
  function timeLabel(timestamp, eventZone) {
    const parts = calendarDateParts(timestamp, eventZone ?? zone);
    const display = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
    return `${display}:${String(parts.minute).padStart(2, '0')} ${parts.hour >= 12 ? 'PM' : 'AM'}`;
  }
  function weekNumber(date) {
    const value = new Date(`${date}T00:00Z`);
    value.setUTCDate(value.getUTCDate() + 4 - (value.getUTCDay() || 7));
    return Math.ceil((((value - Date.UTC(value.getUTCFullYear(), 0, 1)) / 86400000) + 1) / 7);
  }
  function durationLabel(row) {
    const minutes = Math.max(0, Math.round((row.end - row.start) / 60000));
    return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hr` : `${minutes} min`;
  }
  const alternateFormatter = $derived.by(() => {
    if (prefs.alternateCalendar === 'none') return null;
    try { return new Intl.DateTimeFormat(`en-u-ca-${prefs.alternateCalendar}`, { month: 'short', day: 'numeric', timeZone: zone }); }
    catch { return null; }
  });
  function alternateLabel(seconds) {
    return alternateFormatter ? alternateFormatter.format(seconds) : '';
  }
  function occurringOn(date) {
    const start = calendarTimestamp(`${date}T00:00`, zone), end = calendarTimestamp(`${calendarDateAdd(date, 'day', 1)}T00:00`, zone);
    return occurrences.filter(row => row.start < end && row.end > start);
  }
  // Recurring masters repeat the same eventId across days/columns; unique keys
  // and control ids pair the id with its stable originalStart.
  function scheduleKey(row, day) { return `${row.eventId}:${row.originalStart}@${day}`; }
  // Read-only reminder projection (parent-owned rows): all-day dues are
  // authored UTC-midnight date markers; timed dues project in the display
  // zone. Purely presentational — no commands, no duplicate calendar events.
  function remindersOn(day) {
    if (!Array.isArray(reminders) || !reminders.length) return [];
    return reminders.filter(reminder => Number.isFinite(reminder.due)
      && (reminder.allDay ? calendarDateString(reminder.due, 'UTC') === day : calendarDateString(reminder.due, zone) === day));
  }
  function reminderLaneTop(reminder) {
    const parts = calendarDateParts(reminder.due, reminder.allDay ? 'UTC' : zone);
    return Math.max(0, Math.min(prefs.dayEnd - prefs.dayStart, parts.hour - prefs.dayStart + parts.minute / 60) * 56);
  }
  function setPreference(key, value) {
    command('calendar.preferences.set', {}, { values: { [key]: value } });
  }
  let editingAccount = $state(null);
  async function editAccountSave(account) {
    const result = await command('calendar.account.save', {}, { id: account.id, name: form.name, email: form.email, type: form.type, enabled: account.enabled });
    if (applied(result)) editingAccount = null;
  }
  async function addAccount() {
    const result = await command('calendar.account.save', {}, { name: form.name, email: form.email, type: form.type, enabled: true });
    if (applied(result)) form = freshForm('accounts');
  }
  function paneSelected(pane) { return (view?.preferencePane ?? form.pane ?? 'General') === pane; }
  function setPreferencePane(pane) {
    form = { ...form, pane };
    command('calendar.sheet.open', {}, { sheet: 'preferences', pane });
  }

  // ------------------------------------------------------------ selection
  function select(row, occurrenceStart = row.originalStart ?? row.start) {
    command('calendar.event.select', {}, { eventId: row.eventId, ...(occurrenceStart != null ? { occurrenceStart } : {}) });
  }
  function openEditor(target = {}) { pendingEditorScope = null; command('calendar.editor.open', {}, target); }
  async function openEditorOn(date) {
    if (applied(await command('calendar.view.set', {}, { date })) && owns()) openEditor({});
  }
  function navigate(direction) { command('calendar.navigate', {}, { direction }); }
  function setView(kind) { command('calendar.view.set', {}, { view: kind }); }
  function today() { command('calendar.today'); }
  function setSheet(kind, payload = {}) {
    form = freshForm(kind, payload);
    openMenu = ''; popover = null;
    command('calendar.sheet.open', {}, { sheet: kind, ...(payload.pane ? { pane: payload.pane } : {}) });
  }
  function freshForm(kind, payload = {}) {
    return { __kind: kind, id: '', name: '', color: '#3b7bbf', accountId: calendarData.accounts[0]?.id ?? '', url: '', ics: '',
      calendarId: prefs.defaultCalendarId, email: '', type: 'local', pane: view?.preferencePane ?? 'General', fileId: '', eventId: '', sharedWith: [], sharedDraft: '', ...payload };
  }
  function sharedAdd() {
    const email = String(form.sharedDraft ?? '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { error = 'Enter a full email address to share with.'; return; }
    const list = form.sharedWith ?? [];
    if (list.includes(email)) { error = 'That person is already on this calendar.'; return; }
    form = { ...form, sharedWith: [...list, email], sharedDraft: '' };
  }
  function sharedRemove(index) { form = { ...form, sharedWith: (form.sharedWith ?? []).filter((_, at) => at !== index) }; }
  function closeSheet() {
    popover = null;
    command('calendar.editor.close', {}, {});
  }
  $effect(() => {
    if (!sheet) return;
    if (form.__kind !== sheet) form = freshForm(sheet);
    if (sheet === 'preferences' && form.pane !== view.preferencePane) form = { ...form, pane: view.preferencePane };
  });
  async function submitSheet(event) {
    event.preventDefault();
    const f = form;
    let result;
    if (f.__kind === 'calendar') result = await command('calendar.calendar.save', {}, { ...(f.id ? { id: f.id } : {}), name: f.name, color: f.color, accountId: f.accountId, sharedWith: f.sharedWith });
    else if (f.__kind === 'subscription') result = await command(f.id ? 'calendar.subscription.refresh' : 'calendar.subscription.add', {}, f.id ? { calendarId: f.id, ics: f.ics } : { name: f.name, url: f.url, color: f.color, ics: f.ics });
    else if (f.__kind === 'import') result = await command('calendar.import', {}, { ics: f.ics, calendarId: f.calendarId });
    else if (f.__kind === 'accounts') result = await command('calendar.account.save', {}, { ...(f.id ? { id: f.id } : {}), name: f.name, email: f.email, type: f.type, enabled: true });
    if (!applied(result)) error = result?.error?.message ?? 'That request could not be applied.';
    if (applied(result) && owns()) closeSheet();
  }
  // Subscriptions refresh is paste-driven: open the subscription sheet bound to
  // the existing calendar, refresh only once new ICS is supplied.
  function subscriptionSheet(targetCalendar) {
    if (targetCalendar) {
      form = freshForm('subscription', { id: targetCalendar.id, name: targetCalendar.name, color: targetCalendar.color, url: targetCalendar.subscription });
      openMenu = ''; popover = null;
      command('calendar.sheet.open', {}, { sheet: 'subscription' });
    } else setSheet('subscription');
  }
  async function subscriptionRefresh(targetCalendar, ics) {
    const source = typeof ics === 'string' && ics.trim() ? ics : form.ics;
    if (!targetCalendar?.subscription || !source.trim()) {
      subscriptionSheet(targetCalendar);
      error = 'Paste the refreshed iCalendar content to apply this subscription update.';
      return null;
    }
    const result = await command('calendar.subscription.refresh', {}, { calendarId: targetCalendar.id, ics: source.trim() });
    if (applied(result) && owns()) { closeSheet(); return result; }
    return result;
  }
  function shareCalendar(targetCalendar) { command('calendar.calendar.share', {}, { calendarId: targetCalendar.id }); }
  async function exportCalendar(targetCalendar) {
    const result = await command('calendar.export', {}, targetCalendar?.id ? { calendarId: targetCalendar.id } : {});
    if (applied(result) && owns() && result?.fileId) error = `Exported local file: ${result.fileId}`;
  }
  function invitationRespond(invitation, response) {
    command('calendar.invitation.respond', {}, { invitationId: invitation.id, response });
  }
  function alertAction(delivery, action) {
    command('calendar.alert.action', {}, { deliveryId: delivery.id, action, ...(action === 'snooze' ? { minutes: 5 } : {}) });
  }
  // Delivered rows stay actionable until dismissed/snoozed; snooze waits for
  // its own unlock time.
  const outstandingAlerts = $derived(calendarData.alertDeliveries.filter(favular));
  function favular(delivery) {
    return delivery.status === 'pending' || delivery.status === 'delivered' || delivery.status === 'snoozed' && delivery.snoozeUntil <= stamp;
  }

  // --------------------------------------------------------------- editor
  // Drafts capture their origin: canonical master event, its revision, the
  // selected occurrence and the mounted root. Tail commands re-check it.
  let capture = { eventId: '', revision: 0, occurrenceStart: null, root: null, savedOrder: 0, applied: 0 };
  function refreshCapture(eventId) {
    const master = eventId ? calendarData.events.find(row => row.id === eventId) : null;
    capture = { eventId, revision: master?.revision ?? 0, occurrenceStart: view?.selectedOccurrence ?? null, root, savedOrder: capture.savedOrder, applied: capture.applied };
  }
  function draftOrigin() { return `${capture.eventId}:${capture.revision}:${capture.occurrenceStart ?? ''}:${capture.savedOrder}:${capture.applied}:${capture.root?.dataset?.calendarWindowId ?? ''}`; }
  function staleCaptain(message) { error = message ?? 'The original event changed elsewhere; reopen the editor to load its current details.'; }
  function localDraft(event, occurrence) {
    // Edited occurrences project: hydrate occurrence overrides first, then the
    // base event; occurrenceStart stays the stable master identity, so saving
    // with scope='occurrence' writes a canonical series exception.
    const source = occurrence ?? event;
    const projected = occurrence != null;
    const eventZone = source.timeZone === 'floating' ? 'floating' : source.timeZone;
    // A moved exception already projects into the display zone; only a
    // non-projected floating master reads UTC-encoded wall clock.
    const hydrationZone = projected && eventZone === 'floating' ? zone : zoneZone(eventZone);
    const parts = calendarDateParts(source.start, hydrationZone), end = calendarDateParts(source.end, hydrationZone);
    const pad = value => String(value).padStart(2, '0');
    return {
      eventId: event.id, title: source.title, calendarId: source.calendarId,
      startDate: calendarDateString(source.start, hydrationZone), startTime: `${pad(parts.hour)}:${pad(parts.minute)}`,
      endDate: calendarDateString(source.end, hydrationZone), endTime: `${pad(end.hour)}:${pad(end.minute)}`,
      allDay: source.allDay, location: source.location, notes: source.notes, url: source.url, timeZone: source.timeZone,
      travelMinutes: source.travelMinutes, alerts: [...source.alerts], invitees: source.invitees.map(row => ({ ...row })),
      organizer: source.organizer, attachments: source.attachments.map(row => ({ ...row })),
      fileId: '', inviteeEmail: '', inviteeName: '', duration: Math.round((source.end - source.start) / 60000),
      recurrence: event.recurrence ? { ...event.recurrence, weekdays: [...event.recurrence.weekdays] } : { frequency: 'daily', interval: 1, count: null, until: null, weekdays: [] },
      repeats: event.recurrence ? event.recurrence.frequency : 'none'
    };
  }
  function setEditor(field, value) { editor = { ...editor, [field]: value }; }
  // Toggling All-day only proposes the native single-day exclusive end when the
  // draft still carried the timed defaults; authored multi-day end dates stay.
  function toggleAllDay(value) {
    const singleDay = editor.endDate <= editor.startDate;
    setEditor('allDay', value);
    if (value && singleDay) setEditor('endDate', calendarDateAdd(editor.startDate, 'day', 1));
    if (value) { setEditor('startTime', '00:00'); setEditor('endTime', '00:00'); }
  }
  // Floating events are stored with UTC-encoded wall times; the editor reads
  // projected floating occurrences in the display zone and re-encodes them
  // through `calendarTimestamp(local, 'floating')` on save.
  const zoneZone = eventZone => eventZone === 'floating' ? 'UTC' : eventZone;
  function zoneList() {
    return [...new Set(['floating', ...commonZones()])];
  }
  function zoneLabel(value) { return value === 'floating' ? (windows ? 'Floating · local extension' : 'Floating') : value; }
  function updateRecurrence() {
    const rule = editor.recurrence ?? {};
    // Frequency changes reset the custom fields that belong to other rules so
    // saves never carry irrelevant arrays (closed schema rejects them).
    setEditor('recurrence', { frequency: editor.repeats, interval: rule.interval ?? 1, count: rule.count ?? null, until: rule.until ?? null,
      weekdays: editor.repeats === 'weekly' ? (rule.weekdays ?? []) : [],
      monthDays: editor.repeats === 'monthly' ? (rule.monthDays ?? []) : [],
      ordinalWeekdays: editor.repeats === 'monthly' ? (rule.ordinalWeekdays ?? []) : [],
      months: editor.repeats === 'yearly' ? (rule.months ?? [Number(editor.startDate.slice(5, 7))]) : [] });
  }
  function commonZones() {
    const list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    return [...new Set(['UTC', zone, editor?.timeZone, 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', ...list].filter(Boolean))];
  }
  function lightness(hex) {
    const value = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
    if (!value) return 0.6;
    const channel = [1, 2, 3].map(index => parseInt(value[index], 16) / 255).map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channel[0] + 0.7152 * channel[1] + 0.0722 * channel[2];
  }
  // Exceptions project around their actual start; a wide window catches
  // already-moved occurrences instead of a ±1 ms band.
  function projectedOccurrence(event, occurrenceStart) {
    const exception = event.exceptions.find(item => item.originalStart === occurrenceStart);
    const first = Math.min(occurrenceStart, event.start, exception?.start ?? occurrenceStart) - 86400000;
    const last = Math.max(occurrenceStart, event.end, exception?.end ?? occurrenceStart + event.end - event.start) + 86400000;
    return calendarOccurrences(calendarData, first, last, { visibleOnly: false, query: '' })
      .find(item => item.eventId === event.id && item.originalStart === occurrenceStart) ?? null;
  }
  $effect(() => {
    if (!view || view.sheet !== 'event') { if (editor) editor = null; return; }
    if (editor) return;
    const event = view.selectedEventId ? calendarData.events.find(row => row.id === view.selectedEventId) : null;
    if (event && (event.timeZone === 'floating' || calendarTimeZoneValid(event.timeZone))) {
      const occurrence = view.selectedOccurrence != null
        ? projectedOccurrence(event, view.selectedOccurrence)
        : null;
      editor = localDraft(event, occurrence);
    }
    else if (!event) {
      const begin = calendarTimestamp(`${view.date}T09:00`, zone);
      const finish = begin + prefs.defaultDuration * 60000;
      const finishParts = calendarDateParts(finish, zone), pad = value => String(value).padStart(2, '0');
      editor = {
        eventId: null, title: '', calendarId: prefs.defaultCalendarId,
        startDate: view.date, startTime: '09:00',
        endDate: view.date, endTime: `${pad(finishParts.hour)}:${pad(finishParts.minute)}`,
        allDay: false, location: '', notes: '', url: '', timeZone: zone, travelMinutes: 0,
        alerts: prefs.defaultAlert != null ? [prefs.defaultAlert] : [], invitees: [], organizer: '', attachments: [],
        fileId: '', inviteeEmail: '', inviteeName: '', duration: prefs.defaultDuration,
        recurrence: { frequency: 'daily', interval: 1, count: null, until: null, weekdays: [], monthDays: [], ordinalWeekdays: [], months: [] },
        repeats: 'none'
      };
    }
    refreshCapture(event?.id ?? null);
  });
  function closeEditor() {
    editor = null; popover = null;
    if (view?.sheet === 'event') command('calendar.editor.close');
  }
  async function saveEditor(scope = null) {
    const draft = editor;
    if (!draft) return;
    const master = draft.eventId ? calendarData.events.find(row => row.id === draft.eventId) : null;
    if (draft.eventId && (!master || master.revision !== capture.revision || capture.root !== root)) {
      staleCaptain(capture.applied ? 'Your last attachment change applied, but this draft is out of date. Reload the event to save current edits.' : null);
      return;
    }
    if (draft.eventId && (view?.selectedOccurrence ?? null) !== capture.occurrenceStart) {
      staleCaptain('The edited occurrence changed; reopen the event to save the occurrence you loaded.');
      return;
    }
    const masterRule = master?.recurrence;
    const autoScope = masterRule ? (pendingEditorScope ?? (view?.selectedOccurrence != null ? 'occurrence' : 'series')) : null;
    const editorZone = zoneZone(draft.timeZone);
    const start = draft.allDay ? calendarTimestamp(`${draft.startDate}T00:00`, editorZone)
      : calendarTimestamp(`${draft.startDate}T${draft.startTime}`, editorZone);
    // All-day spans keep the authored exclusive end date instead of forcing
    // start+1; a single day still carries its authored end date.
    const end = draft.allDay ? calendarTimestamp(`${draft.endDate}T00:00`, editorZone)
      : calendarTimestamp(`${draft.endDate}T${draft.endTime}`, editorZone);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      error = draft.allDay ? 'All-day events need an end date after the start date.' : 'The event must end after it starts (invalid wall time).';
      return;
    }
    const recurrence = draft.repeats === 'none' ? null : Object.fromEntries([
      ['frequency', draft.repeats], ['interval', draft.recurrence.interval], ['count', draft.recurrence.count], ['until', draft.recurrence.until],
      ['weekdays', draft.repeats === 'weekly' ? [...(draft.recurrence.weekdays ?? [])] : []],
      ...(draft.repeats === 'monthly' ? [['monthDays', (draft.recurrence.monthDays ?? []).slice()]] : []),
      ...(draft.repeats === 'monthly' ? [['ordinalWeekdays', (draft.recurrence.ordinalWeekdays ?? []).map(row => ({ ...row }))]] : []),
      ...(draft.repeats === 'yearly' ? [['months', (draft.recurrence.months ?? [Number(draft.startDate.slice(5, 7))]).slice()]] : [])
    ]);
    const payload = {
      event: { title: draft.title, calendarId: draft.calendarId, start, end, allDay: draft.allDay, location: draft.location,
        notes: draft.notes, url: draft.url, timeZone: draft.timeZone, travelMinutes: draft.travelMinutes, recurrence,
        alerts: draft.alerts, invitees: draft.invitees, organizer: draft.organizer }
    };
    if (draft.eventId) payload.eventId = draft.eventId;
    if (view?.selectedOccurrence != null) payload.occurrenceStart = view.selectedOccurrence;
    if (draft.eventId) payload.scope = scope ?? autoScope ?? rowScope(master ?? {});
    payload.attachmentIds = draft.attachments.map(file => file.fileId);
    const result = await command('calendar.event.save', {}, payload);
    if (applied(result) && owns()) {
      capture.applied++; refreshCapture(draft.eventId);
      closeEditor();
    }
  }
  async function deleteEditor(scope = null) {
    const draft = editor;
    if (!draft?.eventId) return;
    const master = calendarData.events.find(row => row.id === draft.eventId);
    if (!master || master.revision !== capture.revision || capture.root !== root) {
      staleCaptain(capture.applied ? 'Attachments changed this draft already; reload the event before deleting.' : null);
      return;
    }
    if (prefs.confirmDelete && !window.confirm(`Delete “${draft.title || 'event'}”?`)) return;
    const payload = { eventId: draft.eventId };
    if (master.recurrence) payload.scope = scope ?? (view?.selectedOccurrence != null ? 'occurrence' : 'series');
    if (master.recurrence && view?.selectedOccurrence != null) payload.occurrenceStart = view.selectedOccurrence;
    const result = await command('calendar.event.delete', {}, payload);
    if (applied(result) && owns()) { refreshCapture(null); closeEditor(); }
  }
  function addInvitee() {
    const email = editor.inviteeEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { error = 'Invitee needs a full email address.'; return; }
    setEditor('invitees', [...editor.invitees.filter(row => row.email.toLowerCase() !== email.toLowerCase()),
      { email, name: editor.inviteeName.trim(), status: 'pending' }]);
    setEditor('inviteeEmail', ''); setEditor('inviteeName', '');
  }
  function inviteeStatus(email, status) {
    setEditor('invitees', editor.invitees.map(row => row.email.toLowerCase() === email.toLowerCase() ? { ...row, status } : row));
  }
  function removeInvitee(email) { setEditor('invitees', editor.invitees.filter(row => row.email.toLowerCase() !== email.toLowerCase())); }
  function alertAdd(minutes) {
    const value = Math.max(0, Math.round(minutes));
    if (editor.alerts.includes(value)) { error = 'That alert level is already present.'; return; }
    setEditor('alerts', [...editor.alerts, value].sort((left, right) => left - right));
  }
  function alertRemove(minutes) { setEditor('alerts', editor.alerts.filter(value => value !== minutes)); }
  function alertLabel(minutes) {
    if (minutes === 0) return 'At time of event';
    if (minutes === 1440) return '1 day before';
    if (minutes === 60) return '1 hour before';
    if (minutes % 60 === 0) return `${minutes / 60} hours before`;
    return `${minutes} minutes before`;
  }
  function attachmentEditable() {
    const calendar = calendarData.calendars.find(row => row.id === editor?.calendarId);
    const account = calendarData.accounts.find(row => row.id === calendar?.accountId);
    return { calendar, account, exchange: account?.type === 'exchange' };
  }
  function alertCapacity() {
    // Exchange events support one alert; other accounts support up to eight.
    return attachmentEditable().exchange ? 1 : 8;
  }
  function alertsFull() { return editor.alerts.length >= alertCapacity(); }
  async function attachmentAdd() {
    const draft = editor, originCheck = draftOrigin();
    const fileId = draft.fileId.trim();
    if (!fileId) { error = 'Enter an existing local file identifier.'; return; }
    if (draft.attachments.some(row => row.fileId === fileId)) { setEditor('fileId', ''); return; }
    const resolve = await command('calendar.attachment.resolve', {}, { fileId });
    if (!owns() || editor !== draft || originCheck !== draftOrigin()) return;
    if (!applied(resolve)) { error = resolve?.error?.message ?? 'That file does not exist in the local file store.'; return; }
    setEditor('attachments', [...draft.attachments, { fileId: resolve.fileId, name: resolve.fileName }]);
    setEditor('fileId', '');
  }
  function attachmentRemove(fileId) {
    setEditor('attachments', editor.attachments.filter(row => row.fileId !== fileId));
  }
  function attachmentOpen(file) { command('calendar.attachment.open', {}, { eventId: editor.eventId, fileId: file.fileId }); }
  function toggleWeekday(day) {
    const set = new Set(editor.recurrence.weekdays);
    set.has(day) ? set.delete(day) : set.add(day);
    setEditor('recurrence', { ...editor.recurrence, weekdays: [...set].sort() });
  }
  function monthToggle(day) {
    const list = editor.recurrence.monthDays ?? [];
    setEditor('recurrence', { ...editor.recurrence, monthDays: list.includes(day) ? list.filter(item => item !== day) : [...list, day].sort((left, right) => left - right) });
  }
  function yearToggle(month) {
    const list = editor.recurrence.months ?? [Number(editor.startDate.slice(5, 7))];
    setEditor('recurrence', { ...editor.recurrence, months: list.includes(month) ? list.filter(item => item !== month) : [...list, month].sort((left, right) => left - right) });
  }
  function setDuration(minutes) {
    const value = Math.max(5, Math.round(minutes));
    const stampStart = calendarTimestamp(`${editor.startDate}T${editor.startTime}`, editor.timeZone);
    const parts = calendarDateParts(stampStart + value * 60000, editor.timeZone), pad = value => String(value).padStart(2, '0');
    setEditor('endDate', `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`);
    setEditor('endTime', `${pad(parts.hour)}:${pad(parts.minute)}`);
    setEditor('duration', value);
  }

  // ---------------------------------------------------------------- pop over
  function eventPop(row) {
    const calendar = calendarData.calendars.find(item => item.id === row.calendarId);
    // Cached rows refresh from the canonical model through the watcher below;
    // a master revision change closes the popover instead of stale display.
    popover = { eventId: row.eventId, originalStart: row.originalStart ?? row.start, revision: row.revision, row, calendar, timeZone: row.timeZone };
  }
  $effect(() => {
    if (!popover?.eventId) return;
    const master = calendarData.events.find(row => row.id === popover.eventId);
    if (!master || master.revision !== popover.revision) { popover = null; return; }
    const fresh = projectedOccurrence(master, popover.originalStart);
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(popover.row)) popover = { ...popover, row: fresh };
  });
  function closePopover() { popover = null; }
  // Single delete entry point guards id/scope/occurrence and the confirmDelete
  // preference so context menus and popovers cannot bypass the confirmation.
  function deleteRow(row, scope = null) {
    const master = calendarData.events.find(item => item.id === row.eventId);
    if (!master) { staleCaptain('The original event is no longer available.'); return; }
    if (row.revision != null && master.revision !== row.revision) { staleCaptain(); return; }
    const occurrenceStart = row.originalStart ?? null;
    if (prefs.confirmDelete && !window.confirm(`Delete “${master.title ?? 'event'}”?`)) return;
    const payload = { eventId: master.id };
    if (master.recurrence) payload.scope = scope ?? rowScope(row);
    if (master.recurrence && occurrenceStart != null) payload.occurrenceStart = occurrenceStart;
    command('calendar.event.delete', {}, payload);
  }
  function openContext(event, value, point) {
    event.preventDefault(); event.stopPropagation();
    // Root scale inverse: the window adapter may scale the surface, so menu
    // offsets are computed in root-local coordinates.
    const frame = root.getBoundingClientRect();
    const scaleX = frame.width / Math.max(1, root.offsetWidth), scaleY = frame.height / Math.max(1, root.offsetHeight);
    const x = ((point.clientX ?? frame.left + 8) - frame.left) / scaleX;
    const y = ((point.clientY ?? frame.top + 8) - frame.top) / scaleY;
    contextMenu = { ...value, eventId: value.eventId, originalStart: value.originalStart, revision: value.revision,
      x: Math.max(0, Math.min(x, root.offsetWidth - 200)), y: Math.max(0, Math.min(y, root.offsetHeight - 230)) };
  }
  $effect(() => {
    // Cached context rows refresh from canonical data; a master revision
    // change closes the menu instead of displaying a stale inspector.
    if (!contextMenu?.eventId) return;
    const master = calendarData.events.find(row => row.id === contextMenu.eventId);
    if (!master || master.revision !== (contextMenu.revision ?? master.revision)) { contextMenu = null; return; }
    const fresh = projectedOccurrence(master, contextMenu.originalStart ?? master.start);
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(contextMenu.row)) contextMenu = { ...contextMenu, row: fresh };
  });
  function contextAction(name, scope = null) {
    const value = contextMenu; contextMenu = null;
    const occurrenceStart = value.originalStart ?? null;
    if (name === 'edit') { openEditor({ eventId: value.eventId, ...(occurrenceStart != null ? { occurrenceStart } : {}) }); pendingEditorScope = scope; }
    else if (name === 'delete') deleteRow(value, scope);
    else if (name === 'select') select(value, value.originalStart);
  }

  // --------------------------------------------------- drag and phases
  // Occurrence projection identity: recurring rows carry the master's rule, so
  // any per-occurrence action is scope 'occurrence' keyed by stable originalStart.
  const rowScope = row => row?.recurrence ? 'occurrence' : 'series';
  let monthDrag = null;
  let moveChoice = $state(null);
  let pendingEditorScope = null;
  function dragCurrent(running) {
    return owns() && active && root === running.root && calendarData === running.data
      && calendarData.events.find(row => row.id === running.row.eventId) === running.master
      && running.master.revision === running.row.revision && running.view === view
      && view.date === running.date && view.view === running.viewKind && zone === running.zone;
  }
  function commitMove(running, start, end) {
    if (!dragCurrent(running)) return staleCaptain('The original drag target changed; nothing was moved.');
    const payload = { eventId: running.row.eventId, occurrenceStart: running.row.originalStart ?? running.row.start, start, end };
    if (running.master.recurrence) moveChoice = { running, payload };
    else command('calendar.event.move', {}, { ...payload, scope: 'series' });
  }
  function chooseMove(scope) {
    const choice = moveChoice;
    if (!choice || !dragCurrent(choice.running)) { moveChoice = null; return staleCaptain('The original recurring drag target changed.'); }
    moveChoice = null;
    command('calendar.event.move', {}, { ...choice.payload, scope });
  }
  function captureDrag(row) {
    return { row, root, data: calendarData, master: calendarData.events.find(item => item.id === row.eventId), view, date: view.date, viewKind: view.view, zone };
  }
  function cancelDrag() { drag = null; monthDrag = null; moveChoice = null; }
  function dragStart(event, row, mode) {
    if (event.button !== 0 || !owns() || !active) return;
    event.preventDefault(); event.stopPropagation();
    // Measure the real column so scaled layouts convert pixels to minutes
    // against the authored hour grid.
    const lane = event.currentTarget.closest('[data-calendar-lane]');
    const height = lane?.getBoundingClientRect()?.height ?? 0;
    const hours = Math.max(1, prefs.dayEnd - prefs.dayStart);
    drag = { ...captureDrag(row), mode, pointerId: event.pointerId, y: event.clientY, delta: 0, minutesPerPixel: hours * 60 / Math.max(1, height) };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function dragMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const minutesPerDot = 5;
    const delta = (event.clientY - drag.y) * drag.minutesPerPixel;
    const scaled = Math.max(-prefs.dayEnd * 60, Math.min(prefs.dayEnd * 60, Math.round(delta / minutesPerDot) * minutesPerDot));
    drag = { ...drag, delta: scaled };
  }
  function dragEnd(event) {
    const running = drag;
    if (!running || event.pointerId !== running.pointerId) return;
    drag = null;
    if (!running.delta) return;
    // A drag target captured at start must survive revisions; the commit
    // rejects locally instead of silently overwriting a newer model.
    if (!dragCurrent(running)) return staleCaptain('The dragged event changed while you were dragging; the move was not applied.');
    const shift = running.delta * 60000;
    const start = running.mode === 'resize' ? running.row.start : running.row.start + shift;
    const end = running.row.end + shift;
    const occurrenceStart = running.row.originalStart ?? running.row.start;
    if (running.row.timeZone === 'floating') {
      // Floating rows project into the display zone inside the grid; convert
      // the drag result back to display wall time, then encode as floating.
      commitMove(running, calendarTimestamp(calendarLocalString(start, zone), 'floating'),
        calendarTimestamp(calendarLocalString(end, zone), 'floating'));
      return;
    }
    commitMove(running, start, end);
  }
  function dragMonthStart(event, row) {
    if (!owns() || !active) { event.preventDefault(); return; }
    monthDrag = captureDrag(row);
    event.dataTransfer.effectAllowed = 'move';
    // The exact occurrence identity travels with the drag so the drop replays
    // that identity, never the first row match.
    event.dataTransfer.setData('text/calendar', JSON.stringify({ eventId: row.eventId, originalStart: row.originalStart, revision: row.revision }));
  }
  function dragMonthEnd(event, date) {
    event.preventDefault();
    let identity;
    try { identity = JSON.parse(event.dataTransfer.getData('text/calendar') || '{}'); } catch { identity = {}; }
    const running = monthDrag; monthDrag = null;
    if (!identity.eventId || !running || identity.eventId !== running.row.eventId || identity.originalStart !== running.row.originalStart
      || identity.revision !== running.row.revision || !dragCurrent(running)) return staleCaptain('The original dragged event changed; nothing was moved.');
    const row = running.row;
    const isFloating = row.timeZone === 'floating';
    const wallZone = row.allDay && !isFloating ? zoneZone(row.timeZone) : zone;
    const startDay = calendarDateString(row.start, wallZone);
    const endDay = calendarDateString(row.end, wallZone);
    const daysAhead = Math.round((Date.parse(`${date}T00:00Z`) - Date.parse(`${startDay}T00:00Z`)) / 86400000);
    const movedStart = calendarDateAdd(startDay, 'day', daysAhead);
    const movedEnd = calendarDateAdd(endDay, 'day', daysAhead);
    const at = calendarLocalString(row.start, wallZone).slice(11, 16);
    const until = calendarLocalString(row.end, wallZone).slice(11, 16);
    commitMove(running, calendarTimestamp(`${movedStart}T${at}`, isFloating ? 'floating' : wallZone),
      calendarTimestamp(`${movedEnd}T${until}`, isFloating ? 'floating' : wallZone));
  }

  // ------------------------------------------------------- frame & keys
  // Menu leaves carry the canonical request themselves; execution stays one
  // path so every command lands with its real target/payload.
  function trigger(item) {
    if (!owns() || !item?.request) return;
    void command(item.request.command, item.request.target ?? {}, item.request.payload ?? {});
  }
  function keyboard(event) {
    if (!active || !owns() || event.defaultPrevented) return;
    if (event.key === 'Escape' && (drag || monthDrag || moveChoice)) { event.preventDefault(); cancelDrag(); return; }
    if (event.key === 'Escape') { openMenu = ''; closeSheet(); closePopover(); contextMenu = null; return; }
    if (event.target.closest('input, select, textarea')) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (prefs.confirmDelete) return; // keyboard delete is guarded by confirmDelete
      const row = view?.selectedEventId && occurrences.find(item => item.eventId === view.selectedEventId
        && (view.selectedOccurrence == null || item.originalStart === view.selectedOccurrence));
      if (row) { event.preventDefault(); deleteRow(row); }
      return;
    }
    if (!(windows ? event.ctrlKey : event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'n') { event.preventDefault(); openEditor({}); }
    else if (key === 't' && !windows) { event.preventDefault(); today(); }
    else if (!windows && ['1', '2', '3', '4'].includes(key)) { event.preventDefault(); setView(['day', 'week', 'month', 'year'][Number(key) - 1]); }
    else if (windows && key === 'f') { event.preventDefault(); command('calendar.native.focus', {}, { controlId: 'search' }); }
  }

  let facade = null;
  onMount(() => {
    mounted = true; originalData = calendarData; originalRoot = root;
    facade = createCalendarNativeView({ getRoot: () => owns() ? root : null, getState: () => calendarData, windowId: String(windowId), available: () => owns(), tick });
    registerView?.(facade);
    const originalFacade = facade;
    return () => { mounted = false; registerView?.(null,originalFacade); facade = null; };
  });
</script>

<svelte:document onpointerdown={event => { if (openMenu && !event.target.closest?.('[data-calendar-menu]')) openMenu = ''; if (contextMenu && !event.target.closest?.('[data-calendar-context]')) contextMenu = null; }} />
<svelte:window onkeydown={keyboard} onblur={cancelDrag} />

<section bind:this={root} class="calendar-root" class:inactive={!active} class:windows class:classic
  data-calendar-window-id={String(windowId)} data-calendar-app="calendar" data-calendar-profile={profileId}
  data-calendar-counterpart={windows ? 'Windows 11 Calendar (windowscommunicationsapps 23H2)' : 'Apple Calendar'}
  aria-label={windows ? 'Calendar' : 'Calendar'}
  onfocusin={() => editFocusVersion++} onfocusout={() => editFocusVersion++}>
  {#if !windows}
    <header class="calendar-titlebar" data-window-drag>
      <WindowControls onclose={controls?.onclose ?? (() => command('calendar.window.close'))} onminimize={controls?.onminimize}
        onzoom={controls?.onzoom} onfullscreen={controls?.onfullscreen} ongreenmenu={controls?.ongreenmenu} {active} />
      <strong>{view ? frameTitle() : 'Calendar'}</strong>
    </header>
  {/if}

  {#if showLocalMenus}
    <!-- Root disables this fallback when its actual macOS global menu owns the provider. -->
    <nav class="calendar-menubar" data-calendar-menubar aria-label="Calendar command bar">
      {#each calendarMenuProvider({ state: calendarData, profile: profileId, windowId, edits: editAvailability, history: editAvailability }) as menu (menu.id)}
        <div class="calendar-menu" data-calendar-menu={menu.id}>
          <button type="button" data-calendar-control={`menutop:${menu.id}`} aria-haspopup="menu" aria-expanded={openMenu === menu.id}
            onclick={() => { editFocusVersion++; openMenu = openMenu === menu.id ? '' : menu.id; }}>{menu.label}</button>
          {#if openMenu === menu.id}
            <div class="calendar-menu-popup" role="menu" aria-label={menu.label}>
              {#each menu.items as item (item.id)}
                <hr class={item.separator ? 'shown' : 'hidden'} />
                {#if !item.separator}
                  {#if item.children}
                    <details class="calendar-menu-subgroup">
                      <summary aria-disabled={!item.enabled}>{item.label}</summary>
                      {#each item.children as child (child.id)}
                        <button type="button" role="menuitem" disabled={!item.enabled || !child.enabled}
                          onclick={() => { openMenu = ''; trigger(child); }}>{child.label}</button>
                      {/each}
                    </details>
                  {:else}
                    <button type="button" role="menuitem" disabled={!item.enabled} data-calendar-control={`menu:${item.id}`}
                      onpointerdown={event => { if (item.request?.command === 'calendar.native.edit') event.preventDefault(); }}
                      onclick={() => { openMenu = ''; trigger(item); }}>{item.label}</button>
                  {/if}
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </nav>
  {/if}

  {#if !view}
    <div class="calendar-empty">This window is no longer part of the current Calendar state.</div>
  {:else}
    <div class="calendar-toolbar">
      <div class="calendar-tabgroup" role="tablist" aria-label="Calendar view">
        {#each ['day', 'week', 'month', 'year'] as kind (kind)}
          <button type="button" class="calendar-tab" role="tab" aria-selected={view.view === kind}
            data-calendar-control={`view-${kind}`} onclick={() => setView(kind)}>{kind[0].toUpperCase() + kind.slice(1)}</button>
        {/each}
      </div>
      <div class="calendar-nav">
        <button type="button" class="calendar-button ghost" data-calendar-control="previous" aria-label="Previous" onclick={() => navigate(-1)}>&#10094;</button>
        <button type="button" class="calendar-button" data-calendar-control="today" onclick={today}>Today</button>
        <button type="button" class="calendar-button ghost" data-calendar-control="next" aria-label="Next" onclick={() => navigate(1)}>&#10095;</button>
      </div>
      <strong class="calendar-main-title">{frameTitle()}</strong>
      <form class="calendar-quick" onsubmit={async event => { event.preventDefault(); const node = event.currentTarget.elements.quick, text = node.value; const result = await command('calendar.quickEntry', {}, { text: text.trim() }); if (applied(result) && owns() && node.isConnected && node.value === text) node.value = ''; }} title="Title on YYYY-MM-DD at HH:mm-HH:mm, or Title on YYYY-MM-DD all day">
        <input name="quick" placeholder={windows ? 'Quick add: Title on 2026-01-02 at 09:00-10:00 · local extension' : 'Quick entry: Title on 2026-01-02 at 09:00-10:00'} data-calendar-control="quick-entry" aria-label="Quick entry" required pattern=".+" />
      </form>
      {#if windows}<button type="button" class="tiny" data-calendar-control="toolbar-add-calendar" onclick={() => subscriptionSheet(null)}>Add calendar</button>{/if}
      <button type="button" class="calendar-button accent" data-calendar-control="new-event" onclick={() => openEditor({})}>{windows ? 'New event' : '+'}</button>
    </div>

    <div class="calendar-main">
      {#if view.sidebarVisible}
        <aside class="calendar-list" data-calendar-area="sidebar" data-calendar-control="sidebar-list">
          <div class="calendar-mini" data-calendar-area="mini-month" data-calendar-control="mini-month">
            <div class="calendar-mini-head">
              <button type="button" class="calendar-button ghost" aria-label="Previous month" onclick={() => command('calendar.view.set', {}, { date: calendarDateAdd(view.date, 'month', -1), view: view.view })}>{'<'}</button>
              <b>{`${monthAlone(Number(view.date.slice(5, 7)))} ${view.date.slice(0, 4)}`}</b>
              <button type="button" class="calendar-button ghost" aria-label="Next month" onclick={() => command('calendar.view.set', {}, { date: calendarDateAdd(view.date, 'month', 1), view: view.view })}>{'>'}</button>
            </div>
            <div class="calendar-mini-week">
              {#each Array.from({ length: 7 }, (_, index) => weekdayLabels[(prefs.weekStart + index) % 7]) as label, index (index)}<span aria-hidden="true">{label[0]}</span>{/each}
            </div>
            <div class="calendar-mini-grid">
              {#each miniGrid() as cell (cell.date)}
                <button type="button" class:other={!cell.inMonth} class:today={cell.today}
                  data-calendar-control={`mini:${cell.date}`} aria-pressed={cell.date === view.date}
                  onclick={() => command('calendar.view.set', {}, { date: cell.date, view: view.view })}>{cell.day}</button>
              {/each}
            </div>
          </div>
          <form class="calendar-search" onsubmit={event => { event.preventDefault(); submitSearch(event.currentTarget.elements.search); }}>
            <input data-calendar-control="search" data-calendar-area="search" name="search" placeholder="Search" bind:value={queryDraft} onkeydown={event => { if (event.key === 'Escape') { event.preventDefault(); if (drag || monthDrag || moveChoice) cancelDrag(); else reconcileSearchInput(); } }} />
          </form>
          <div class="calendar-groups" data-calendar-area="calendars">
            <h4>{windows ? 'Calendars' : 'My Calendars'}</h4>
            {#each calendarData.calendars as calendar (calendar.id)}
              <div class="calendar-row" data-calendar-control={`calendar:${calendar.id}`}>
                <button type="button" class="calendar-dot" style={`background:${calendar.visible ? calendar.color : 'transparent'}`}
                  aria-pressed={calendar.visible} data-calendar-control={`calendar-toggle:${calendar.id}`}
                  aria-label={`${calendar.visible ? 'Hide' : 'Show'} ${calendar.name}`}
                  onclick={() => command('calendar.calendar.visibility', {}, { calendarId: calendar.id, visible: !calendar.visible })}
                ></button>
                <button type="button" class="calendar-name" data-calendar-control={`calendar-name:${calendar.id}`}
                  onclick={() => setSheet('calendar', { id: calendar.id, name: calendar.name, color: calendar.color, accountId: calendar.accountId, sharedWith: [...calendar.sharedWith] })}
                  oncontextmenu={event => openContext(event, { kind: 'calendar', calendarId: calendar.id }, event)}
                >{calendar.name}{calendar.readOnly ? ' (read only)' : ''}</button>
                {#if calendar.subscription}<span class="tag">sub</span>
                  <button type="button" class="tiny" data-calendar-control={`sub-refresh:${calendar.id}`} onclick={() => subscriptionSheet(calendar)} title="Paste a refreshed subscription · local extension">↻</button>
                {/if}
                <button type="button" class="tiny" data-calendar-control={`share:${calendar.id}`}
                  title={`Sharing · ${calendar.sharedWith.length ? `${calendar.sharedWith.length} local recipients` : 'local extension'}`}
                  onclick={() => setSheet('calendar', { id: calendar.id, name: calendar.name, color: calendar.color, accountId: calendar.accountId, sharedWith: [...calendar.sharedWith] })}>⇄{calendar.sharedWith.length || ''}</button>
              </div>
            {/each}
            <div class="calendar-actions">
              <button type="button" data-calendar-control="new-calendar" onclick={() => setSheet('calendar')}>{windows ? 'New calendar' : 'New Calendar'}</button>
              <button type="button" data-calendar-control="subscribe" onclick={() => subscriptionSheet(null)}>{windows ? 'Subscribe' : 'New Calendar Subscription'}</button>
              <button type="button" data-calendar-control="import" onclick={() => setSheet('import')}>{windows ? 'Import' : 'Import…'}</button>
              <button type="button" data-calendar-control="export" onclick={() => exportCalendar(null)}>Export…</button>
              <button type="button" data-calendar-control="preferences" onclick={() => setSheet('preferences', { pane: 'General' })}>{windows ? 'Calendar settings' : 'Settings…'}</button>
              <button type="button" data-calendar-control="accounts" onclick={() => setSheet('accounts')}>Accounts…</button>
              <button type="button" data-calendar-control="alerts" onclick={() => setSheet('preferences', { pane: 'Alerts' })}>Alerts…</button>
              <button type="button" data-calendar-control="help" onclick={() => setSheet('help')}>{windows ? 'Help' : 'Calendar Help'}</button>
              <button type="button" class="local-note" data-calendar-control="scene-date-set"
                title="Local authored scene clock extension: writes the shared scene date"
                onclick={() => command('calendar.sceneDate', {}, { date: view.date })}>Use {view.date} as scene date · local extension</button>
            </div>
          </div>
          {#if outstandingAlerts.length}
            <div class="calendar-alerts" data-calendar-area="alerts" data-calendar-control="alert-notices">
              <h4>Alerts</h4>
              {#each outstandingAlerts as delivery (delivery.id)}
                {@const row = calendarData.events.find(item => item.id === delivery.eventId)}
                <div class="calendar-alert-row" data-calendar-control={`alert:${delivery.id}`}>
                  <span>{row?.title ?? 'Event'}{#if delivery.status === 'snoozed'} · snoozed until {calendarLocalString(delivery.snoozeUntil, zone)}{/if}</span>
                  <span class="alert-actions">
                    <button type="button" class="tiny" data-calendar-control={`alert-show:${delivery.id}`} onclick={() => alertAction(delivery, 'show')}>Show</button>
                    <button type="button" class="tiny" data-calendar-control={`alert-snooze:${delivery.id}`} onclick={() => alertAction(delivery, 'snooze')}>Snooze</button>
                    <button type="button" class="tiny" data-calendar-control={`alert-dismiss:${delivery.id}`} onclick={() => alertAction(delivery, 'dismiss')}>Dismiss</button>
                  </span>
                </div>
              {/each}
            </div>
          {/if}
          {#if Array.isArray(reminders) && reminders.length}
            <!-- Parent-owned cross-integration projection: read-only Reminders
                 rows; the canonical reminder model and its commands stay with
                 the Reminders domain, never duplicated here. -->
            <div class="calendar-reminders" data-calendar-area="reminders" data-calendar-control="reminders">
              <h4>Reminders <span class="tag">read-only projection</span></h4>
              {#each reminders as reminder (reminder.id ?? reminder.reminderId)}
                <div class="calendar-reminder" class:completed={reminder.completed}
                  data-calendar-control={`reminder:${reminder.reminderId ?? reminder.id}`}>
                  <span class="reminder-title">{reminder.title ?? 'Reminder'}{#if reminder.completed} · done{/if}</span>
                  {#if reminder.due != null && Number.isFinite(reminder.due)}
                    <span class="when">{#if reminder.allDay}{calendarDateString(reminder.due, zone)}{:else}{calendarDateString(reminder.due, zone)} {timeLabel(reminder.due, zone)}{/if}</span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
          {#if calendarData.invitations.length}
            <div class="calendar-invitations" data-calendar-area="invitations" data-calendar-control="invitations">
              <h4>Invitations {#if calendarData.invitations.some(row => row.status === 'pending')}<span class="count">{calendarData.invitations.filter(row => row.status === 'pending').length}</span>{/if}</h4>
              {#each calendarData.invitations as invitation (invitation.id)}
                {@const row = calendarData.events.find(item => item.id === invitation.eventId)}
                <div class="calendar-invitation" class:pending={invitation.status === 'pending'}>
                  <div class="title">{row?.title ?? 'Event'}{#if invitation.sequence > 0}<span class="tag">updated</span>{/if}</div>
                  <div class="from">from {invitation.sender}</div>
                  <div class="when">{row ? `${calendarDateString(row.start, row.timeZone)} ${timeLabel(row.start, row.timeZone === 'floating' ? zone : row.timeZone)}` : ''}</div>
                  {#if invitation.status === 'pending'}
                    <div class="inv-reply">
                      <button type="button" data-calendar-control={`invitation-${invitation.id}-accepted`} onclick={() => invitationRespond(invitation, 'accepted')}>Accept</button>
                      <button type="button" data-calendar-control={`invitation-${invitation.id}-tentative`} onclick={() => invitationRespond(invitation, 'tentative')}>Maybe</button>
                      <button type="button" data-calendar-control={`invitation-${invitation.id}-declined`} onclick={() => invitationRespond(invitation, 'declined')}>Decline</button>
                    </div>
                  {:else}
                    <div class="inv-status">You {invitation.status === 'accepted' ? 'accepted' : invitation.status}</div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </aside>
      {/if}

      <div class="calendar-content" data-calendar-area="calendar">
        {#if view.view === 'day' || view.view === 'week'}
          {@const span = view.view === 'day' ? [view.date] : Array.from({ length: prefs.daysPerWeek }, (_, index) => calendarDateAdd(visibleRange.first, 'day', index))}
          <header class="calendar-day-header">
            {#each span as day (day)}
              <span class:today={day === TODAY}>{weekLabel(day)}{#if prefs.showWeekNumbers && day === span[0]}<small class="calendar-week-number"> · W{weekNumber(day)}</small>{/if}</span>
            {/each}
          </header>
          <div class="calendar-schedule" data-calendar-area="schedule" data-calendar-control="schedule">
            <div class="calendar-allday-strip">
              <div class="time-gutter"><span>all-day</span></div>
              {#each span as day (day)}
                {@const cell = dayCell(day)}
                <div class="allday-cell" data-calendar-day={day} data-calendar-lane role="listitem"
                  ondragover={event => { event.preventDefault(); }}
                  ondrop={event => dragMonthEnd(event, day)}
                >
                  {#each cell.allDay as row, index (scheduleKey(row, day))}
                    <div class="event-bubble allday" data-calendar-control={`allday:${scheduleKey(row, day)}`}
                      style={`background: color-mix(in srgb, ${row.color} 30%, white); color: color-mix(in srgb, ${row.color} 68%, black); top:${index * 22}px; left:2px; right:2px;`}
                      draggable="true" ondragstart={event => dragMonthStart(event, row)} ondragend={() => monthDrag = null}
                      onpointerdown={event => select(row)} ondblclick={() => eventPop(row)}
                      oncontextmenu={event => openContext(event, row, event)} role="button" tabindex="0"
                      onkeydown={event => event.key === 'Enter' && select(row)}
                      class:selected={view.selectedEventId === row.eventId && (view.selectedOccurrence == null || view.selectedOccurrence === row.originalStart)}
                    >{row.title}</div>
                  {/each}
                  {#each remindersOn(day) as reminder, index (reminder.reminderId ?? reminder.id)}
                    <div class="reminder-bubble allday" data-calendar-control={`reminder-bubble:${reminder.reminderId ?? reminder.id}`}
                      style={`top:${(cell.allDay.length + index) * 22}px; left:2px; right:2px; pointer-events:none;`}>
                      {reminder.completed ? '✓ ' : '◦ '}{reminder.title ?? 'Reminder'}
                    </div>
                  {/each}
                </div>
              {/each}
            </div>
            <div class="calendar-timegrid">
              <div class="time-gutter">
                {#each hourRows() as hour, index (index)}<span>{clockLabel(hour)}</span>{/each}
              </div>
              {#each span as day (day)}
                {@const cell = dayCell(day)}
                <div class="day-column" data-calendar-day={day} data-calendar-lane data-calendar-drop={day} role="listitem"
                  ondragover={event => event.preventDefault()} ondrop={event => dragMonthEnd(event, day)}>
                  {#each cell.timed as row (scheduleKey(row, day))}
                    {@const eventZone = zone}
                    {@const startDay = calendarDateString(row.start, eventZone)}
                    {@const endDay = calendarDateString(row.end, eventZone)}
                    {@const before = startDay < day}
                    {@const after = endDay > day}
                    {@const projectedStart = calendarDateParts(row.start, eventZone).hour + calendarDateParts(row.start, eventZone).minute / 60}
                    {@const projectedEnd = calendarDateParts(row.end, eventZone).hour + calendarDateParts(row.end, eventZone).minute / 60}
                    {@const laneStart = before ? prefs.dayStart : Math.max(projectedStart, prefs.dayStart)}
                    {@const laneEnd = after || projectedEnd <= projectedStart ? prefs.dayEnd : Math.max(laneStart + 0.15, Math.min(projectedEnd, prefs.dayEnd))}
                    {@const topOffset = Math.max(0, (laneStart - prefs.dayStart) * 56)}
                    {@const height = Math.max(14, (laneEnd - laneStart) * 56)}
                    {@const preview = drag && drag.row.originalStart === row.originalStart && drag.row.eventId === row.eventId ? drag.delta / 60 * 56 : 0}
                    <div class="event-bubble drag-preview" data-calendar-control={`event:${scheduleKey(row, day)}`}
                      style={`background: color-mix(in srgb, ${row.color} 34%, white); color: color-mix(in srgb, ${row.color} 82%, black); top:${Math.max(0, topOffset + (drag?.mode === 'move' ? preview : 0))}px; height:${Math.max(14, height + (drag?.mode === 'resize' ? preview : 0))}px; left:${(row.column / row.columns) * 92}%; width:${(92 / row.columns) - 1}%`}
                      onpointerdown={event => { if (event.button === 0) { select(row); dragStart(event, row, 'move'); } }}
                      onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={cancelDrag}
                      ondblclick={() => eventPop(row)}
                      oncontextmenu={event => openContext(event, row, event)}
                      role="button" tabindex="0" onkeydown={event => event.key === 'Enter' && eventPop(row)}
                      class:selected={view.selectedEventId === row.eventId && (view.selectedOccurrence == null || view.selectedOccurrence === row.originalStart)}
                      class:moving={Boolean(drag && drag.row.eventId === row.eventId && drag.row.originalStart === row.originalStart)}
                    >
                      <span class="clock">{timeLabel(drag && drag.row.eventId === row.eventId && drag.row.originalStart === row.originalStart ? row.start + drag.delta * 60000 : row.start, eventZone)}{#if row.timeZone !== zone} · {zoneLabel(row.timeZone)}{#if row.timeZone === 'floating'} · local extension{/if}{/if} · {durationLabel(drag && drag.row.eventId === row.eventId && drag.row.originalStart === row.originalStart ? { end: row.end + drag.delta * 60000, start: row.start } : row)}</span>
                      <span class="event-title">{row.title}{#if row.travelMinutes > 0}<em class="travel"> · +{row.travelMinutes} min travel</em>{/if}</span>
                      <div class="resize" data-mode="resize" role="slider" aria-label="Resize event duration" aria-valuemin={5} aria-valuemax={600} aria-valuenow={Math.max(5, Math.round((row.end - row.start) / 60000))} tabindex="0"
                        onpointerdown={event => dragStart(event, row, 'resize')} onpointermove={dragMove} onpointerup={dragEnd} onpointercancel={cancelDrag}></div>
                    </div>
                  {/each}
                  {#each remindersOn(day) as reminder (reminder.reminderId ?? reminder.id)}
                    {#if !reminder.allDay}
                      <div class="reminder-bubble timed" data-calendar-control={`reminder-lane:${reminder.reminderId ?? reminder.id}`}
                        style={`top:${reminderLaneTop(reminder)}px; left:2px; right:2px; pointer-events:none;`}>
                        {reminder.completed ? '✓ ' : '· '}{timeLabel(reminder.due, zone)} {reminder.title ?? 'Reminder'}
                      </div>
                    {/if}
                  {/each}
                  {#if Number.isFinite(stamp) && day === TODAY && hourOffset(stamp, zone) >= 0 && hourOffset(stamp, zone) <= prefs.dayEnd - prefs.dayStart}
                    <div class="now-line" style={`top:${hourOffset(stamp, zone) * 56}px`}></div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {:else if view.view === 'month'}
          <div class="calendar-month" data-calendar-area="month" data-calendar-control="month">
            <div class="month-weekdays">
              {#each Array.from({ length: 7 }, (_, index) => weekdayLabels[(prefs.weekStart + index) % 7]) as label (label)}<span>{label}</span>{/each}
            </div>
            <div class="month-cells">
              {#each monthGrid() as cell (cell.date)}
                <div class="month-cell" class:other={!cell.inMonth} class:today={cell.today} role="listitem"
                  data-calendar-day={cell.date} data-calendar-drop={cell.date}
                  ondragover={event => event.preventDefault()} ondrop={event => dragMonthEnd(event, cell.date)}
                  ondblclick={() => openEditorOn(cell.date)}>
                  <header>
                    <b class:selected={cell.date === view.date}>{cell.day}</b>
                    {#if prefs.showWeekNumbers && weekdayIndex(cell.date) === prefs.weekStart}<small class="calendar-week-number">W{weekNumber(cell.date)}</small>{/if}
                    {#if alternateLabel(calendarTimestamp(`${cell.date}T00:00`, zone))}
                      <em class="alt">{alternateLabel(calendarTimestamp(`${cell.date}T00:00`, zone))}</em>
                    {/if}
                  </header>
                  {#if remindersOn(cell.date).length}
                    <div class="reminder-chips" data-calendar-control={`reminders:${cell.date}`}>
                      {#each remindersOn(cell.date) as reminder (reminder.reminderId ?? reminder.id)}
                        <span class="reminder-chip" class:completed={reminder.completed}>
                          {reminder.allDay ? '◦' : '·'} {reminder.title ?? 'Reminder'}
                        </span>
                      {/each}
                    </div>
                  {/if}
                  <div class="events">
                    {#each occurringOn(cell.date) as row (scheduleKey(row, cell.date))}
                      <button type="button" class="day-block" draggable="true"
                        ondragstart={event => dragMonthStart(event, row)} ondragend={() => monthDrag = null}
                        style={`background:${row.color}; color:${lightness(row.color) > 0.6 ? '#222' : '#fff'}`}
                        data-calendar-control={`block:${scheduleKey(row, cell.date)}`}
                        onpointerdown={event => select(row, row.originalStart)} ondblclick={event => { event.stopPropagation(); eventPop(row); }}
                        oncontextmenu={event => openContext(event, row, event)}
                        class:selected={view.selectedEventId === row.eventId}
                      >{row.allDay ? row.title : `${timeLabel(row.start, zone)} ${row.title}`}{#if row.travelMinutes > 0}<em class="travel"> · +{row.travelMinutes}m</em>{/if}</button>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {:else if view.view === 'year'}
          <div class="calendar-year" data-calendar-area="year" data-calendar-control="year">
            {#each monthYearCells(Number(view.date.slice(0, 4))) as monthCells (monthCells.month)}
              <div class="year-month">
                <header class="year-month-title">{monthAlone(monthCells.month)}</header>
                <div class="year-grid">
                  {#each Array.from({ length: 7 }, (_, index) => weekdayLabels[(prefs.weekStart + index) % 7][0]) as label, index (index)}<span>{label}</span>{/each}
                </div>
                <div class="year-grid">
                  {#each monthCells.days as cell (cell.date)}
                    <button type="button" class:blank={!cell.date}
                      class:other={!cell.inMonth} disabled={!cell.inMonth}
                      class:today={cell.today}
                      class:reminder-day={remindersOn(cell.date).length > 0}
                      data-calendar-control={`year:${cell.date}`}
                      onclick={() => command('calendar.view.set', {}, { date: cell.date, view: 'day' })}
                    >{cell.day ?? ''}{#if remindersOn(cell.date).length}<i class="reminder-marker" aria-label={`${remindersOn(cell.date).length} reminders`}></i>{/if}</button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}

  {#if sheet}
    <div class="calendar-sheet-backdrop" role="presentation" data-calendar-area="sheet" onclick={event => { if (event.target === event.currentTarget) closeSheet(); }}>
      <form class="calendar-sheet" data-calendar-sheet={sheet} onsubmit={submitSheet}>
        {#if sheet === 'calendar'}
          <h3>{form.id ? 'Edit Calendar' : (windows ? 'New calendar' : 'New Calendar')}</h3>
          <label><span>Name</span><input bind:value={form.name} data-calendar-control="calendar-name" required /></label>
          <label><span>Colour</span><select bind:value={form.color} data-calendar-control="calendar-color">{#each ['#c47f17', '#3b7bbf', '#34c759', '#ff3b30', '#af52de', '#5856d6', '#ff9500', '#00c7be'] as swatch (swatch)}<option value={swatch}>{swatch}</option>{/each}</select></label>
          <label><span>Account</span><select bind:value={form.accountId} data-calendar-control="calendar-account">{#each calendarData.accounts as account (account.id)}<option value={account.id}>{account.name}</option>{/each}</select></label>
          {#if form.id}
            <fieldset class="share-group" data-calendar-control="calendar-shares">
              <legend>Sharing · local extension</legend>
              <label><span>Shared with</span><input bind:value={form.sharedDraft} data-calendar-control="calendar-shared-draft" placeholder="person@example.test" /></label>
              <button type="button" data-calendar-control="calendar-shared-add" onclick={sharedAdd}>Add</button>
              <ul>
                {#each form.sharedWith ?? [] as email, index (index)}
                  <li>{email}
                    <button type="button" class="tiny" data-calendar-control={`calendar-shared-remove:${index}`}
                      onclick={() => sharedRemove(index)}>×</button></li>
                {/each}
              </ul>
              <button type="button" data-calendar-control="calendar-share-publish" onclick={() => command('calendar.calendar.share', {}, { calendarId: form.id })}>Share…</button>
            </fieldset>
          {/if}
          <div class="actions">
            <button type="button" onclick={closeSheet}>Cancel</button>
            <button type="submit" data-calendar-control="calendar-save" disabled={!form.name}>Save</button>
          </div>
        {:else if sheet === 'subscription'}
          <h3>{windows ? 'Subscribe to calendar' : 'New Calendar Subscription'}</h3>
          <p class="hint">Local model: paste ICS data for the calendar; no network request is made.</p>
          <label><span>Name</span><input bind:value={form.name} data-calendar-control="subscription-name" required /></label>
          <label><span>Source URL</span><input bind:value={form.url} data-calendar-control="subscription-url" placeholder="webcal://…" /></label>
          <label><span>Colour</span><select bind:value={form.color} data-calendar-control="subscription-color">{#each ['#c47f17', '#3b7bbf', '#34c759', '#af52de', '#ff3b30'] as swatch (swatch)}<option value={swatch}>{swatch}</option>{/each}</select></label>
          <label><span>ICS content</span><textarea bind:value={form.ics} data-calendar-control="subscription-ics" placeholder="BEGIN:VCALENDAR…"></textarea></label>
          <div class="actions">
            <button type="button" onclick={closeSheet}>Cancel</button>
            <button type="submit" data-calendar-control="subscription-save" disabled={!form.name || !form.ics.trim()}>{form.id ? 'Refresh' : 'Subscribe'}</button>
          </div>
        {:else if sheet === 'import'}
          <h3>Import iCalendar</h3>
          <p class="hint">Paste iCalendar text; it is parsed into the chosen writable calendar.</p>
          <label><span>Calendar</span><select bind:value={form.calendarId} data-calendar-control="import-calendar">{#each calendarData.calendars.filter(target => !target.readOnly) as target (target.id)}<option value={target.id}>{target.name}</option>{/each}</select></label>
          <label><span>Local Files document</span><input bind:value={form.fileId} data-calendar-control="import-file-id" placeholder="Canonical .ics file ID" /></label>
          <button type="button" data-calendar-control="import-file" disabled={!form.fileId.trim()} onclick={async () => { const result = await command('calendar.import.file', {}, { fileId: form.fileId.trim(), calendarId: form.calendarId }); if (applied(result) && owns()) closeSheet(); }}>Import from Files</button>
          <label><span>ICS content</span><textarea bind:value={form.ics} data-calendar-control="import-ics" required placeholder="BEGIN:VCALENDAR…"></textarea></label>
          <div class="actions">
            <button type="button" onclick={closeSheet}>Cancel</button>
            <button type="submit" data-calendar-control="import-save">Import</button>
          </div>
        {:else if sheet === 'accounts'}
          <h3>{windows ? 'Manage accounts' : 'Accounts'}</h3>
          <div class="accounts-list">
            {#each calendarData.accounts as account (account.id)}
              <div class="account-row" data-calendar-control={`account:${account.id}`}>
                <span>{account.name} <em class="accent-text">{account.type}</em></span>
                <span class="account-controls">
                  {#if form.__kind === 'accounts' && form.id === account.id && editingAccount}
                    <input bind:value={form.name} size="12" data-calendar-control="account-name" />
                    <select bind:value={form.type} data-calendar-control="account-type">{#each ['local', 'icloud', 'exchange', 'google'] as kind (kind)}<option value={kind}>{kind}</option>{/each}</select>
                    <input bind:value={form.email} placeholder="email" data-calendar-control="account-email" />
                    <button type="button" data-calendar-control={`account-save:${account.id}`} onclick={() => editAccountSave(account)}>Save</button>
                    <button type="button" onclick={() => editingAccount = null}>Cancel</button>
                  {:else}
                    <button type="button" data-calendar-control={`account-edit:${account.id}`} onclick={() => { form = freshForm('accounts', { id: account.id, name: account.name, email: account.email, type: account.type }); editingAccount = true; }}>Edit</button>
                  {/if}
                  <button type="button" class="tiny" data-calendar-control={`account-delete:${account.id}`} onclick={() => command('calendar.account.delete', {}, { accountId: account.id })} title="Delete account">×</button>
                </span>
              </div>
            {/each}
          </div>
          <details>
            <summary>Add account</summary>
            <label><span>Name</span><input bind:value={form.name} data-calendar-control="account-new-name" /></label>
            <label><span>Type</span><select bind:value={form.type} data-calendar-control="account-new-type">{#each ['local', 'icloud', 'exchange', 'google'] as kind (kind)}<option value={kind}>{kind}</option>{/each}</select></label>
            <label><span>Email</span><input bind:value={form.email} data-calendar-control="account-new-email" placeholder="person@vale.example" /></label>
            <button type="button" data-calendar-control="account-create" onclick={addAccount}>Add</button>
          </details>
          <div class="actions">
            <button type="button" onclick={closeSheet}>Close</button>
          </div>
        {:else if sheet === 'preferences'}
          <h3>{windows ? 'Calendar settings' : (classic ? 'Preferences' : 'Settings')}{#if form.pane} · {form.pane}{/if}</h3>
          <nav class="calendar-preference-tabs">
            {#each ['General', 'Accounts', 'Alerts', 'Advanced'] as pane (pane)}
              <button type="button" class:selected={paneSelected(pane)} data-calendar-control={`preference-${pane}`}
                onclick={() => setPreferencePane(pane)}>{pane}</button>
            {/each}
          </nav>
          <div class="calendar-preference-content">
            {#if form.pane === 'General'}
              <label><span>Default view</span>
                <select value={prefs.defaultView} data-calendar-control="preference-defaultView" onchange={event => setPreference('defaultView', event.currentTarget.value)}>
                  {#each ['day', 'week', 'month', 'year'] as kind (kind)}<option value={kind} selected={prefs.defaultView === kind}>{kind[0].toUpperCase() + kind.slice(1)}</option>{/each}
                </select></label>
              <label><span>Week start</span>
                <select value={String(prefs.weekStart)} data-calendar-control="preference-weekStart" onchange={event => setPreference('weekStart', Number(event.currentTarget.value))}>
                  {#each ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as label, index (index)}
                    <option value={index} selected={prefs.weekStart === index}>{label}</option>{/each}
                </select></label>
              <label><span>Days per week</span>
                <select value={prefs.daysPerWeek} data-calendar-control="preference-daysPerWeek" onchange={event => setPreference('daysPerWeek', Number(event.currentTarget.value))}>
                  <option value={7} selected={prefs.daysPerWeek === 7}>7 (full week)</option>
                  <option value={5} selected={prefs.daysPerWeek === 5}>{windows ? '5 (work week)' : '5 (Mon–Fri)'}</option>
                </select></label>
              <label><span>Day starts</span>
                <select value={prefs.dayStart} data-calendar-control="preference-dayStart" onchange={event => setPreference('dayStart', Number(event.currentTarget.value))}>
                  {#each Array.from({ length: 13 }, (_, index) => index) as hour (hour)}<option value={hour} selected={prefs.dayStart === hour}>{clockLabel(hour)}</option>{/each}
                </select></label>
              <label><span>Day ends</span>
                <select value={prefs.dayEnd} data-calendar-control="preference-dayEnd" onchange={event => setPreference('dayEnd', Number(event.currentTarget.value))}>
                  {#each Array.from({ length: 24 }, (_, index) => index + 1) as hour (hour)}<option value={hour} selected={prefs.dayEnd === hour}>{clockLabel(hour === 24 ? 12 : hour)}</option>{/each}
                </select></label>
              <label><span>Time zone</span><input value={prefs.timeZone} data-calendar-control="preference-timeZone" onchange={event => setPreference('timeZone', event.currentTarget.value)}></label>
              <label><span>weekNumbers</span>
                <input type="checkbox" checked={prefs.showWeekNumbers} data-calendar-control="preference-showWeekNumbers" onchange={event => setPreference('showWeekNumbers', event.currentTarget.checked)}>
              </label>
              <label><span>Alternate calendar</span>
                <select value={prefs.alternateCalendar} data-calendar-control="preference-alternateCalendar" onchange={event => setPreference('alternateCalendar', event.currentTarget.value)}>
                  {#each ['none', 'chinese', 'hebrew', 'islamic'] as style (style)}
                    <option value={style} selected={prefs.alternateCalendar === style}>{style}</option>{/each}
                </select></label>
              <label><span>Show declined</span>
                <input type="checkbox" checked={prefs.showDeclined} data-calendar-control="preference-showDeclined" onchange={event => setPreference('showDeclined', event.currentTarget.checked)}></label>
            {:else if form.pane === 'Accounts'}
              <div class="accounts-context">
                {#each calendarData.accounts as account (account.id)}
                  <div class="account-row" data-calendar-control={`pane-account:${account.id}`}>
                    <span>{account.name} <em class="accent-text">{account.type}</em>{#if !account.enabled} · disabled{/if}</span>
                    <button type="button" data-calendar-control={`pane-account-enable:${account.id}`} onclick={() => command('calendar.account.save', {}, { id: account.id, name: account.name, email: account.email, type: account.type, enabled: !account.enabled })}>{account.enabled ? 'Disable' : 'Enable'}</button>
                  </div>
                {/each}
              </div>
              <button type="button" class="ghost" onclick={() => setSheet('accounts')}>Manage accounts…</button>
            {:else if form.pane === 'Alerts'}
              <label><span>Alerts enabled</span>
                <input type="checkbox" checked={prefs.alertsEnabled} data-calendar-control="preference-alertsEnabled" onchange={event => setPreference('alertsEnabled', event.currentTarget.checked)}></label>
              <label><span>Default alert</span>
                <select value={prefs.defaultAlert} data-calendar-control="preference-defaultAlert" onchange={event => setPreference('defaultAlert', Number(event.currentTarget.value))}>
                  {#each [[0, 'At time of event'], [5, '5 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [1440, '1 day before']] as [value, label] (value)}
                    <option value={value} selected={prefs.defaultAlert === value}>{label}</option>{/each}
                </select></label>
            {:else}
              <label><span>Default calendar</span>
                <select value={prefs.defaultCalendarId} data-calendar-control="preference-defaultCalendar" onchange={event => setPreference('defaultCalendarId', event.currentTarget.value)}>
                  {#each calendarData.calendars as calendar (calendar.id)}<option value={calendar.id} selected={prefs.defaultCalendarId === calendar.id}>{calendar.name}</option>{/each}
                </select></label>
              <label><span>Default duration</span>
                <select value={prefs.defaultDuration} data-calendar-control="preference-defaultDuration" onchange={event => setPreference('defaultDuration', Number(event.currentTarget.value))}>
                  {#each [15, 30, 45, 60, 90, 120] as value (value)}<option value={value} selected={prefs.defaultDuration === value}>{`${value} minutes`}</option>{/each}
                </select></label>
              <label><span>Confirm delete</span>
                <input type="checkbox" checked={prefs.confirmDelete} data-calendar-control="preference-confirmDelete" onchange={event => setPreference('confirmDelete', event.currentTarget.checked)}></label>
              <label><span class="disclaimer">Birthdays calendar</span>
                <span class="birthdays-inert" data-calendar-control="preference-birthdays-disabled">
                  <input type="checkbox" disabled aria-disabled="true" aria-label="Birthdays calendar (unavailable)">
                  <em>no connected birthday source</em>
                </span></label>
              <p class="hint">Birthdays require a Contacts read-only projection from the parent scene; no local birthday data is stored or generated.</p>
            {/if}
          </div>
          <div class="actions">
            <button type="button" onclick={closeSheet}>Close</button>
          </div>
        {:else if sheet === 'invitations'}
          <h3>Invitation Inbox</h3>
          {#each calendarData.invitations as invitation (invitation.id)}
            {@const row = calendarData.events.find(item => item.id === invitation.eventId)}
            <div class="calendar-invitation" class:pending={invitation.status === 'pending'}>
              <div class="title">{row?.title ?? 'Event'} · from {invitation.sender}</div>
              {#if invitation.status === 'pending'}
                <div class="inv-reply">
                  <button type="button" onclick={() => invitationRespond(invitation, 'accepted')}>Accept</button>
                  <button type="button" onclick={() => invitationRespond(invitation, 'tentative')}>Maybe</button>
                  <button type="button" onclick={() => invitationRespond(invitation, 'declined')}>Decline</button>
                </div>
              {:else}
                <div class="inv-status">status: {invitation.status}</div>
              {/if}
            </div>
          {/each}
        {:else if sheet === 'help'}
          <h3>{windows ? 'Calendar help and local limitations' : 'Calendar Help'}</h3>
          <p>Use Day, Week, Month, or Year view to see your collections. Changing the view, today's date, and search are actual actions on the local canonical Calendar model.</p>
          <p>{windows ? 'Local extension: quick add, importing, exporting, invitation inbox, and alert delivery surface. This surface does not contact any server or network.' : 'Local extension: quick entry, subscriptions, sharing, invitations, alternate calendars and the authored scene clock. This surface does not contact a server.'}</p>
        {/if}
      </form>
    </div>
  {/if}

  {#if editor}
    <div class="calendar-editor-backdrop" role="presentation" data-calendar-area="sheet" onclick={event => { if (event.target === event.currentTarget) closeEditor(); }}>
      <form class="calendar-editor" data-calendar-sheet="event" onsubmit={event => { event.preventDefault(); saveEditor(); }}>
        <div class="editor-body">
          <div class="editor-title-row">
            <input class="event-title" placeholder="New Event" bind:value={editor.title} data-calendar-control="editor-title" required aria-label="Title" />
            <input type="checkbox" checked={editor.allDay} onchange={event => toggleAllDay(event.currentTarget.checked)} data-calendar-control="editor-allday" id="editor-allday" />
            <label for="editor-allday">All-day</label>
            <button type="button" class="tiny" data-calendar-control="editor-cancel" onclick={closeEditor}>Cancel</button>
          </div>
          <div class="editor-row">
            <label>Calendar <select bind:value={editor.calendarId} data-calendar-control="editor-calendar">{#each calendarData.calendars as calendar (calendar.id)}<option value={calendar.id}>{calendar.name}</option>{/each}</select></label>
            <label>From <input type="date" bind:value={editor.startDate} data-calendar-control="editor-start-date" /></label>
            {#if !editor.allDay}
              <label><input type="time" bind:value={editor.startTime} data-calendar-control="editor-start-time" step="300" /></label>
            {/if}
            <label>to <input type="date" bind:value={editor.endDate} data-calendar-control="editor-end-date" /></label>
            {#if !editor.allDay}
              <label><input type="time" bind:value={editor.endTime} data-calendar-control="editor-end-time" step="300" /></label>
            {/if}
            {#if editor.allDay}<small class="hint">All-day end is the authored first night after; author multi-day spans by editing the end date.</small>{/if}
          </div>
          {#if !editor.allDay}
            <div class="editor-row">
              <label>Time zone <select bind:value={editor.timeZone} data-calendar-control="editor-timeZone">
                {#each zoneList() as zoneName (zoneName)}<option value={zoneName}>{zoneLabel(zoneName)}</option>{/each}
              </select></label>
              <label>Travel time <input type="number" min="0" max="10080" value={editor.travelMinutes} data-calendar-control="editor-travel" oninput={event => setEditor('travelMinutes', Number(event.currentTarget.value) || 0)}></label>
              <label>Duration <input type="number" min="5" step="5" value={editor.duration} data-calendar-control="editor-duration" oninput={event => setDuration(Number(event.currentTarget.value))}></label>
            </div>
          {/if}
          <div class="editor-row">
            <label>Repeats <select bind:value={editor.repeats} data-calendar-control="editor-repeats" onchange={() => updateRecurrence()}>
              <option value="none">Never</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select></label>
            {#if editor.repeats !== 'none'}
              <label>Every <input type="number" min="1" max="99" value={editor.recurrence.interval} onchange={event => setEditor('recurrence', { ...editor.recurrence, interval: Math.max(1, Number(event.currentTarget.value)) })} data-calendar-control="editor-interval"></label>
              {#if editor.repeats === 'weekly'}
                <label>Weekdays
                  <div class="weekdays-target" role="group">
                    {#each [0, 1, 2, 3, 4, 5, 6] as day (day)}
                      <button type="button" class:active={editor.recurrence.weekdays.includes(day)}
                        data-calendar-control={`editor-weekday-${day}`}
                        aria-pressed={editor.recurrence.weekdays.includes(day)}
                        onclick={() => toggleWeekday(day)}>{weekdayLabels[day][0]}</button>
                    {/each}
                  </div>
                </label>
              {/if}
              {#if editor.repeats === 'yearly'}
                <label>Months
                  <div class="weekdays-target" role="group">
                    {#each [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as month (month)}
                      <button type="button" class:active={(editor.recurrence.months ?? [Number(editor.startDate.slice(5, 7))]).includes(month)}
                        data-calendar-control={`editor-month-${month}`}
                        aria-pressed={(editor.recurrence.months ?? [Number(editor.startDate.slice(5, 7))]).includes(month)}
                        onclick={() => yearToggle(month)}>{monthAlone(month).slice(0, 3)}</button>
                    {/each}
                  </div>
                </label>
              {/if}
              <label>Ends
                <select value={editor.recurrence.count != null ? 'count' : editor.recurrence.until != null ? 'until' : 'never'} onchange={event => {
                  const eventMode = event.currentTarget.value;
                  if (eventMode === 'count') setEditor('recurrence', { ...editor.recurrence, count: editor.recurrence.count ?? 10, until: null });
                  else if (eventMode === 'until') setEditor('recurrence', { ...editor.recurrence, count: null, until: calendarTimestamp(`${view.date}T23:59`, zone) });
                  else setEditor('recurrence', { ...editor.recurrence, count: null, until: null });
                }} data-calendar-control="editor-ends">
                  <option value="never">Never</option>
                  <option value="count">After</option>
                  <option value="until">On date</option>
                </select>
              </label>
              {#if editor.repeats === 'monthly'}
                <div class="monthly-rules" data-calendar-control="editor-monthly-rules" role="group" aria-label="Monthly rule">
                  <label><input name="editor-monthly-mode" type="radio" checked={(editor.recurrence.monthDays?.length ?? 0) > 0} onchange={() => setEditor('recurrence', { ...editor.recurrence, monthDays: [Number(editor.startDate.slice(-2))], ordinalWeekdays: [] })} data-calendar-control="editor-monthly-date">By day of month</label>
                  <label><input name="editor-monthly-mode" type="radio" checked={(editor.recurrence.ordinalWeekdays?.length ?? 0) > 0} onchange={() => setEditor('recurrence', { ...editor.recurrence, monthDays: [], ordinalWeekdays: [{ weekday: weekdayIndex(editor.startDate), ordinal: 1 }] })} data-calendar-control="editor-monthly-ord">By weekday pattern</label>
                  {#if (editor.recurrence.monthDays?.length ?? 0) > 0}
                    {#each editor.recurrence.monthDays as day (day)}
                      <button type="button" class="tiny" onclick={() => monthToggle(day)} data-calendar-control={`editor-monthday-${day}`}>{day}<span aria-hidden="true"> ×</span></button>
                    {/each}
                    <input type="number" min="1" max="31" value="" placeholder="Add day" data-calendar-control="editor-monthday-add" oninput={event => { const day = Number(event.currentTarget.value); event.currentTarget.value = ''; if (day >= 1 && day <= 31) monthToggle(day); }} />
                  {:else}
                    {#each editor.recurrence.ordinalWeekdays ?? [] as rule (rule.weekday + '_' + rule.ordinal)}
                      <button type="button" class="tiny" onclick={() => setEditor('recurrence', { ...editor.recurrence, ordinalWeekdays: editor.recurrence.ordinalWeekdays.filter(item => item !== rule) })}
                        data-calendar-control={`editor-ordinal-${rule.weekday}-${rule.ordinal}`}>{rule.ordinal}{rule.ordinal > 1 ? 'th' : rule.ordinal === 1 ? 'st' : 'th'} {weekdayLabels[rule.weekday]}<span aria-hidden="true"> ×</span></button>
                    {/each}
                    <select value="" onchange={event => { const [weekday, ordinal] = event.currentTarget.value.split('-').map(Number); event.currentTarget.value = ''; if (Number.isInteger(weekday) && Number.isInteger(ordinal)) setEditor('recurrence', { ...editor.recurrence, ordinalWeekdays: [...editor.recurrence.ordinalWeekdays, { weekday, ordinal }] }); }} data-calendar-control="editor-ordinal-add">
                      <option value="">Add pattern…</option>
                      {#each [1, 2, 3, 4, -1, -2] as ordinal (ordinal)}
                        {#each [0, 1, 2, 3, 4, 5, 6] as day (day)}
                          <option value={`${day}-${ordinal}`}>{`${ordinal}${ordinal === 1 ? 'st' : ordinal === 2 ? 'nd' : ordinal === 3 ? 'rd' : 'th'} ${weekdayLabels[day]}`}</option>
                        {/each}
                      {/each}
                    </select>
                  {/if}
                  <small class="hint">The canonical generator intersects monthDays with ordinalWeekdays per RFC 5545 semantics; this editor authors one pattern at a time.</small>
                </div>
              {/if}
              {#if editor.recurrence.count != null}
                <input type="number" min="1" max="4096" value={editor.recurrence.count} onchange={event => setEditor('recurrence', { ...editor.recurrence, count: Number(event.currentTarget.value) })} data-calendar-control="editor-count">
              {:else if editor.recurrence.until != null}
                <input type="date" value={calendarDateString(editor.recurrence.until, zone)} onchange={event => setEditor('recurrence', { ...editor.recurrence, until: calendarTimestamp(`${event.currentTarget.value}T23:59`, zone) })} data-calendar-control="editor-until">
              {/if}
            {/if}
          </div>
          <div class="editor-container">
            <label>Location <input bind:value={editor.location} data-calendar-control="editor-location" /></label>
            <label>URL <input bind:value={editor.url} data-calendar-control="editor-url" placeholder="https://" /></label>
            <label>Notes <textarea bind:value={editor.notes} data-calendar-control="editor-notes"></textarea></label>
          </div>
          <div class="editor-container">
            <label>Alerts
              <div class="alerts-list" data-calendar-control="editor-alerts">
                {#each editor.alerts as minutes (minutes)}
                  <span class="alert-item">{alertLabel(minutes)} <button type="button" class="tiny" aria-label="Remove alert" onclick={() => alertRemove(minutes)}>×</button></span>
                {/each}
                {#if alertsFull()}
                  <em class="hint">{attachmentEditable().exchange ? 'Exchange supports one alert' : `Maximum ${alertCapacity()} alerts reached`}</em>
                {:else}
                  <select onchange={event => { alertAdd(Number(event.currentTarget.value)); event.currentTarget.value = ''; }} data-calendar-control="editor-alerts-add">
                    <option value="">Add alert…</option>
                    {#each [[0, 'At time'], [5, '5 minutes before'], [15, '15 minutes before'], [30, '30 minutes before'], [60, '1 hour before'], [1440, '1 day before']] as [value, label] (value)}
                      <option value={value}>{label}</option>{/each}
                  </select>
                {/if}
              </div>
            </label>
          </div>
          <div class="editor-container">
            <label>Invitees
              <div class="invitees-list" data-calendar-control="editor-invitees">
                {#each editor.invitees as person, index (index)}
                  <span class="invitee">{person.name ?? ''} {person.email}<em class="tag">{person.status}</em>
                    {#each ['accepted', 'declined', 'tentative'] as status (status)}
                      <button type="button" class="tiny" data-calendar-control={`invitee-${index}-${status}`} aria-pressed={person.status === status}
                        onclick={() => inviteeStatus(person.email, status)}>{status[0].toUpperCase() + status.slice(1)}</button>
                    {/each}
                    <button type="button" class="tiny" aria-label="Remove invitee" onclick={() => removeInvitee(person.email)}>×</button>
                  </span>
                {/each}
              </div>
              <div class="editor-row">
                <input bind:value={editor.inviteeName} placeholder="Name (optional)" data-calendar-control="editor-invitee-name" size="10" />
                <input bind:value={editor.inviteeEmail} placeholder="email@example.test" data-calendar-control="editor-invitee-email" />
                <button type="button" data-calendar-control="editor-invitee-add" onclick={addInvitee}>Add</button>
              </div>
            </label>
            {#if editor.eventId}
              <button type="button" data-calendar-control="editor-invite-saved" disabled={!calendarData.events.find(row => row.id === editor.eventId)?.invitees.length}
                onclick={() => command('calendar.event.invite', {}, { eventId: editor.eventId })}>Create Mail invitation from saved event…</button>
            {/if}
          </div>
          <div class="editor-container">
            <label>Attachments
              <div class="editor-row">
                <input bind:value={editor.fileId} placeholder="local file id (e.g. trail-map.pdf)" data-calendar-control="editor-attachment-id" size="22" />
                <button type="button" data-calendar-control="editor-attachment-add" onclick={attachmentAdd}>Attach</button>
              </div>
              <div class="attachments-list" data-calendar-control="editor-attachment-list">
                {#each editor.attachments as file (file.fileId)}
                  <span class="attachment-item">{file.name}
                    {#if editor.eventId}
                      <button type="button" class="tiny" data-calendar-control={`editor-attachment-open:${file.fileId}`} onclick={() => attachmentOpen(file)} title="Open attachment">⇱</button>
                    {/if}
                    <button type="button" class="tiny" data-calendar-control={`editor-attachment-remove:${file.fileId}`} onclick={() => attachmentRemove(file.fileId)} title="Remove attachment">×</button>
                  </span>
                {/each}
              </div>
            </label>
          </div>
          <div class="editor-row">
            <label>Organizer <input bind:value={editor.organizer} placeholder="organizer email" data-calendar-control="editor-organizer" /></label>
          </div>
          <div class="editor-actions">
            {#if editor.eventId}
              <div class="scope-choice" role="group" aria-label="Save scope">
                {#if calendarData.events.find(row => row.id === editor.eventId)?.recurrence}
                  <button type="button" data-calendar-control="save-occurrence" onclick={() => saveEditor('occurrence')}>{windows ? 'Save this occurrence' : 'Save This Event'}</button>
                  <button type="button" data-calendar-control="save-future" onclick={() => saveEditor('future')}>{windows ? 'Save future' : 'Save Following'}</button>
                {/if}
                <button type="button" data-calendar-control="save-series" onclick={() => saveEditor('series')}>{windows ? 'Save series' : 'Save All'}</button>
              </div>
              <div class="scope-choice" role="group" aria-label="Delete scope">
                {#if calendarData.events.find(row => row.id === editor.eventId)?.recurrence}
                  <button type="button" data-calendar-control="delete-occurrence" onclick={() => deleteEditor('occurrence')}>Delete This Event</button>
                  <button type="button" data-calendar-control="delete-future" onclick={() => deleteEditor('future')}>Delete Future</button>
                {/if}
                <button type="button" data-calendar-control="delete-series" onclick={() => deleteEditor('series')}>Delete All</button>
              </div>
            {:else}
              <button type="submit" data-calendar-control="editor-save">Save Event</button>
            {/if}
          </div>
        </div>
      </form>
    </div>
  {/if}

  {#if popover}
    <div class="calendar-pop" role="dialog" aria-label="Event details" data-calendar-popover>
      {#if popover.row}
        {@const row = popover.row}
      <div class="popover-row"><span class="chip" style={`background:${row.color}`}></span><strong>{row.title}</strong>
        {#if popover.calendar?.readOnly}<span class="tag">read only</span>{/if}</div>
      <div class="popover-row">{row.allDay ? 'All day' : `${timeLabel(row.start, zone)} – ${timeLabel(row.end, zone)}`} · {row.calendarName ?? popover.calendar?.name ?? ''}</div>
      {#if !row.allDay}<div class="popover-row">Time zone: {row.timeZone === 'floating' ? `${zoneLabel(row.timeZone)} (projected to ${zone})` : row.timeZone}</div>{/if}
      <div class="popover-row">{row.location ? `📍 ${row.location}` : ''}</div>
      {#if row.url}<div class="popover-row">🔗 {row.url}</div>{/if}
      {#if row.travelMinutes > 0}<div class="popover-row">✈️ {row.travelMinutes} min travel</div>{/if}
      {#if popover.calendar && !popover.calendar.readOnly}
        <div class="popover-actions">
          <button type="button" data-calendar-control="popover-edit" onclick={() => { const target = row; popover = null; openEditor({ eventId: target.eventId, ...(target.originalStart != null ? { occurrenceStart: target.originalStart } : {}) }); }}>Edit</button>
          <button type="button" data-calendar-control="popover-delete" onclick={() => { const target = row; popover = null; deleteRow(target, rowScope(target)); }}>Delete this event…</button>
          <button type="button" data-calendar-control="popover-delete-series" onclick={() => { const target = row; popover = null; deleteRow(target, 'series'); }}>Delete all…</button>
          {#if row.invitees.length}<button type="button" data-calendar-control="popover-invite" onclick={() => command('calendar.event.invite', {}, { eventId: row.eventId })}>Invite with Mail…</button>{/if}
          <button type="button" data-calendar-control="popover-close" onclick={closePopover}>Close</button>
        </div>
      {/if}
      {#if row.notes}<div class="popover-row">{row.notes}</div>{/if}
      {#each row.attachments as file (file.fileId)}
        <button type="button" data-calendar-control={`popover-attachment:${file.fileId}`} onclick={() => command('calendar.attachment.open', {}, { eventId: row.eventId, fileId: file.fileId })}>{file.name}</button>
      {/each}
      {#if popover.calendar?.readOnly}<button type="button" data-calendar-control="popover-close" onclick={closePopover}>Close</button>{/if}
      {/if}
    </div>
  {/if}

  {#if moveChoice}
    <div class="calendar-sheet-backdrop" role="presentation">
      <div class="calendar-sheet" role="dialog" aria-label="Move repeating event" data-calendar-sheet="move-scope">
        <h3>Change repeating event</h3>
        <p>Apply this move or resize to this event, this and following events, or every event in the series.</p>
        <div class="actions">
          <button type="button" data-calendar-control="move-cancel" onclick={() => moveChoice = null}>Cancel</button>
          <button type="button" data-calendar-control="move-occurrence" onclick={() => chooseMove('occurrence')}>This Event</button>
          <button type="button" data-calendar-control="move-future" onclick={() => chooseMove('future')}>Following Events</button>
          <button type="button" data-calendar-control="move-series" onclick={() => chooseMove('series')}>All Events</button>
        </div>
      </div>
    </div>
  {/if}

  {#if contextMenu}
    <div class="calendar-pop context" role="menu" data-calendar-context
      style={`left:${contextMenu.x}px; top:${contextMenu.y}px`}>
      {#if contextMenu.eventId}
        <button type="button" role="menuitem" onclick={() => contextAction('edit', 'occurrence')}>Edit this event…</button>
        <button type="button" role="menuitem" onclick={() => contextAction('edit', 'future')}>Edit this and following…</button>
        <button type="button" role="menuitem" onclick={() => contextAction('edit', 'series')}>Edit all…</button>
        <hr />
        <button type="button" role="menuitem" onclick={() => contextAction('delete', 'occurrence')}>Delete this event…</button>
        <button type="button" role="menuitem" onclick={() => contextAction('delete', 'future')}>Delete this and following…</button>
        <button type="button" role="menuitem" onclick={() => contextAction('delete', 'series')}>Delete all…</button>
      {:else if contextMenu.kind === 'calendar'}
        <button type="button" role="menuitem" data-calendar-control="context-edit-calendar" onclick={() => { const cal = calendarData.calendars.find(row => row.id === contextMenu.calendarId); contextMenu = null; setSheet('calendar', { id: cal.id, name: cal.name, color: cal.color, accountId: cal.accountId, sharedWith: [...cal.sharedWith] }); }}>Edit…</button>
        <button type="button" role="menuitem" data-calendar-control="context-delete-calendar" onclick={() => { const id = contextMenu.calendarId; contextMenu = null; command('calendar.calendar.delete', {}, { calendarId: id }); }}>{windows ? 'Delete calendar' : 'Delete…'}</button>
      {:else}
        <button type="button" role="menuitem" onclick={() => { contextMenu = null; openEditor({}); }}>{windows ? 'New event' : 'New Event'}</button>
      {/if}
    </div>
  {/if}

  {#if error}<div class="error-banner" role="alert">{error}<button type="button" aria-label="Dismiss" onclick={() => error = ''}>×</button></div>{/if}
</section>

<style>
  :global(.calendar-root) { display: flex; flex-direction: column; height: 100%; }
  :global(.calendar-toolbar) { display: flex; align-items: center; gap: 10px; }
  :global(.calendar-tab) { cursor: pointer; }
  :global(.calendar-tab[aria-selected='true']) { cursor: default; }
  :global(.calendar-main) { display: flex; flex: 1; min-height: 0; }
  :global(.calendar-content) { flex: 1; min-width: 0; overflow: hidden; }
  :global(.calendar-empty) { display: grid; place-content: center; color: #8d9299; font-size: 13px; height: 100%; }
  :global(.calendar-list) { width: 200px; background: #f6f7fb; border-right: 1px solid #e0e2ec; padding: 8px 8px; overflow: auto; }
  :global(.calendar-list h4) { font-size: 11px; margin: 8px 0 4px; text-transform: uppercase; color: #8a8f97; }
  :global(.calendar-row) { display: flex; align-items: center; gap: 6px; padding: 2px 4px; border-radius: 5px; }
  :global(.calendar-row:hover) { background: #e9ecf5; }
  :global(.calendar-dot) { width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgb(0 0 0 / 20%); cursor: pointer; padding: 0; flex: none; }
  :global(.calendar-name) { border: 0; background: none; font: inherit; text-align: left; cursor: pointer; padding: 0; flex: 1; }
  :global(.calendar-actions) { display: grid; gap: 4px; margin-top: 8px; }
  :global(.calendar-actions > button) { font: inherit; font-size: 12px; text-align: left; border: 0; background: none; color: #3a5fa8; cursor: pointer; padding: 1px 4px; }
  :global(.calendar-actions > button:hover) { text-decoration: underline; }
  :global(.calendar-mini-week) { display: grid; grid-template-columns: repeat(7, 1fr); font-size: 9.5px; color: #a5aab2; text-align: center; margin: 4px 0; }
  :global(.calendar-mini-grid) { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; }
  :global(.calendar-mini-grid > button) { font: inherit; font-size: 10px; border: 0; background: transparent; padding: 2px 0; cursor: pointer; }
  :global(.calendar-mini-grid > button.other) { color: #b7bcc4; }
  :global(.calendar-mini-grid > button.today) { background: var(--today-accent, #ff6a3d); color: #fff; border-radius: 50%; }
  :global(.calendar-tabgroup) { position: relative; display: inline-flex; background: #e0e2ed; border-radius: 6px; padding: 2px; }
  :global(.calendar-tab) { border: 0; background: transparent; font: inherit; font-size: 12px; padding: 4px 14px; border-radius: 5px; color: #3a4048; }
  :global(.calendar-tab[aria-selected='true']) { background: #fff; color: #111; box-shadow: 0 1px 2px rgb(0 0 0 / 20%); }
  :global(.calendar-nav) { display: inline-flex; gap: 4px; }
  :global(.calendar-button) { border: 1px solid #c8ccd8; background: #fff; color: #242a31; font: inherit; font-size: 12px; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
  :global(.calendar-button.ghost) { border-color: transparent; background: transparent; }
  :global(.calendar-button.accent) { background: #3b7bbf; border-color: #2f6da5; color: #fff; }
  :global(.calendar-main-title) { flex: 1; font-size: 18px; font-weight: 650; text-align: center; }
  :global(.calendar-quick input) { width: 200px; font: inherit; font-size: 12.5px; padding: 3px 8px; }
  :global(.tiny) { font: inherit; font-size: 10.5px; border: 0; background: none; cursor: pointer; color: #3a5fa8; }
  :global(.tag) { font-size: 9.5px; border: 1px solid #c3c9d4; padding: 0 3px; border-radius: 3px; color: #6c7280; }
  :global(.error-banner) { position: fixed; z-index: 90; left: 50%; bottom: 40px; transform: translateX(-50%); background: #fdecea; color: #8f2222; padding: 6px 12px; border-radius: 6px; box-shadow: 0 4px 14px rgb(0 0 0 / 18%); }
  :global(.error-banner > button) { margin-left: 8px; border: 0; background: none; cursor: pointer; }
  :global(.calendar-day-header) { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); border-bottom: 1px solid #e0e2ec; background: #fafbfe; }
  :global(.calendar-day-header > span) { text-align: right; padding: 5px 3px; font-size: 12.5px; color: #5d626a; }
  :global(.calendar-day-header > span.today) { color: #c0392b; font-weight: 600; }
  :global(.calendar-schedule) { display: flex; flex: 1; min-height: 0; }
  :global(.calendar-allday-strip) { display: grid; grid-template-columns: 72px repeat(auto-fit, minmax(0, 1fr)); border-bottom: 1px solid #e0e2ec; }
  :global(.allday-cell) { position: relative; min-height: 26px; border-right: 1px solid #eceef5; }
  :global(.calendar-timegrid) { display: grid; flex: 1; grid-template-columns: 72px repeat(auto-fit, minmax(0, 1fr)); min-height: 0; }
  :global(.time-gutter) { display: flex; flex-direction: column; justify-content: space-between; align-items: flex-end; padding-right: 6px; color: #8d9299; font-size: 11px; font-variant-numeric: tabular-nums; }
  :global(.day-column) { position: relative; border-right: 1px solid #eceef5; background-image: linear-gradient(to bottom, #eceef5 1px, transparent 1px); background-size: 100% 56px; }
  :global(.event-bubble) { position: absolute; left: 2px; border-radius: 4px; padding: 2px 6px; font-size: 12px; cursor: pointer; overflow: hidden; }
  :global(.event-bubble .clock) { display: block; font-variant-numeric: tabular-nums; font-size: 11px; }
  :global(.event-bubble .resize) { position: absolute; bottom: 0; left: 0; right: 0; height: 7px; cursor: ns-resize; }
  :global(.event-bubble.moving) { opacity: 0.86; box-shadow: 0 2px 8px rgb(0 0 0 / 28%); z-index: 3; }
  :global(.now-line) { position: absolute; left: 0; right: 0; border-top: 1px solid #d6453d; }
  :global(.calendar-month) { display: flex; flex-direction: column; height: 100%; }
  :global(.month-weekdays) { display: grid; grid-template-columns: repeat(7, 1fr); color: #8d9299; }
  :global(.month-cells) { display: grid; grid-template-columns: repeat(7, 1fr); flex: 1; }
  :global(.month-cell) { border: 1px solid #eceef5; min-height: 74px; overflow: hidden; }
  :global(.month-cell.other) { background: #fafbfd; color: #a6a9b0; }
  :global(.month-cell.today) { background: #fff7ea; }
  :global(.events) { display: block; }
  :global(.day-block) { display: block; width: calc(100% - 8px); margin: 2px 4px; text-align: left; border: 0; border-radius: 4px; font: inherit; font-size: 11px; padding: 1px 5px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  :global(.month-cell > header) { display: flex; align-items: baseline; gap: 5px; padding: 3px 6px; font-size: 11.5px; }
  :global(.month-cell > header .alt) { color: #969ca6; font-size: 9.5px; font-style: normal; }
  :global(.calendar-year) { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 18px; padding: 12px; }
  :global(.year-month-title) { font-size: 15px; padding: 0 4px 4px; }
  :global(.year-grid) { grid-template-columns: repeat(7, 1fr); display: grid; gap: 2px; padding: 0 4px 8px; }
  :global(.year-grid > span, .year-grid > button) { font-size: 10px; text-align: center; padding: 1px 0; color: #6f757e; border: 0; background: none; cursor: pointer; }
  :global(.year-grid > button.blank) { cursor: default; color: transparent; }
  :global(.calendar-invitation) { border: 1px solid #e0e2ec; border-radius: 6px; padding: 6px; margin: 3px 0; font-size: 11.5px; background: #fff; }
  :global(.calendar-invitation .inv-reply) { display: flex; gap: 4px; margin-top: 4px; }
  :global(.calendar-invitation .inv-status) { color: #6c7280; }
  :global(.calendar-alert-row) { font-size: 11.5px; display: flex; align-items: center; justify-content: space-between; gap: 4px; border: 1px solid #e8d9c8; border-radius: 6px; padding: 4px; background: #fff8ec; margin: 3px 0; }
  :global(.calendar-alert-row .alert-actions) { display: inline-flex; gap: 3px; }
  :global(.local-note) { color: #7a6a4e; font-size: 11px; }
  :global(.share-group) { border: 1px solid #dfe3ec; border-radius: 8px; margin: 8px 0; padding: 8px; }
  :global(.share-group legend) { font-size: 11.5px; padding: 0 4px; }
  :global(.share-group ul) { margin: 6px 0; padding: 0 0 0 14px; }
  :global(.calendar-sheet-backdrop) { position: absolute; inset: 0; background: rgb(15 20 32 / 34%); z-index: 70; display: grid; place-items: center; }
  :global(.calendar-sheet) { width: min(560px, calc(100% - 40px)); max-height: min(560px, calc(100% - 40px)); overflow: auto; background: #fff; border-radius: 10px; box-shadow: 0 18px 48px rgb(0 0 0 / 30%); padding: 14px 16px; }
  :global(.calendar-sheet h3) { font-size: 14px; margin: 0 0 8px; }
  :global(.calendar-sheet label) { display: grid; grid-template-columns: 110px 1fr; gap: 8px; align-items: center; margin-bottom: 8px; font-size: 12px; }
  :global(.calendar-sheet input, .calendar-sheet select, .calendar-sheet textarea) { font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid #c8ccd8; border-radius: 5px; width: 100%; box-sizing: border-box; }
  :global(.calendar-sheet .actions) { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
  :global(.calendar-sheet .hint, .calendar-editor .hint) { font-size: 11.5px; color: #8a8f97; margin: 0 0 6px; }
  :global(.calendar-accounts) { font-size: 12px; }
  :global(.calendar-accounts > h4) { margin: 6px 0 4px; font-size: 11px; text-transform: uppercase; color: #8a8f97; }
  :global(.calendar-accounts .account-row) { display: flex; align-items: center; gap: 6px; justify-content: space-between; border: 1px solid #e0e2ec; border-radius: 6px; padding: 5px 8px; margin: 3px 0; background: #fff; }
  :global(.calendar-accounts > button) { font: inherit; font-size: 12px; }
  :global(.calendar-editor-backdrop) { position: absolute; inset: 0; background: rgb(15 20 32 / 40%); z-index: 70; display: grid; place-items: center; }
  :global(.calendar-editor) { width: min(620px, calc(100% - 40px)); max-height: min(600px, calc(100% - 40px)); overflow: auto; background: #fff; border-radius: 10px; box-shadow: 0 18px 48px rgb(0 0 0 / 30%); padding: 14px 16px; }
  :global(.calendar-editor label) { font-size: 12px; }
  :global(.calendar-editor .editor-row) { display: flex; gap: 8px; align-items: center; margin: 6px 0; flex-wrap: wrap; }
  :global(.calendar-editor .editor-container) { display: grid; gap: 6px; margin: 8px 0; }
  :global(.calendar-editor input, .calendar-editor select, .calendar-editor textarea) { font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid #c8ccd8; border-radius: 5px; }
  :global(.calendar-editor .event-title) { font-size: 14px; font-weight: 600; flex: 1; }
  :global(.calendar-editor .editor-actions) { display: flex; gap: 12px; justify-content: space-between; margin-top: 10px; }
  :global(.calendar-editor .scope-choice) { display: flex; gap: 6px; }
  :global(.calendar-pop) { position: absolute; z-index: 80; background: #fff; border-radius: 8px; box-shadow: 0 10px 30px rgb(0 0 0 / 18%), 0 0 0 1px rgb(0 0 0 / 14%); padding: 10px; min-width: 240px; font-size: 12.5px; }
  :global(.calendar-pop .popover-row) { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  :global(.calendar-pop .chip) { width: 10px; height: 10px; border-radius: 50%; }
  :global(.calendar-pop .popover-actions) { display: flex; gap: 8px; margin-top: 6px; }
  :global(.calendar-pop.context) { position: absolute; min-width: 180px; z-index: 80; }
  :global(.calendar-pop.context > button) { display: block; width: 100%; text-align: left; border: 0; background: none; font: inherit; padding: 4px 10px; cursor: pointer; }
  :global(.calendar-pop.context > button:hover) { background: #eaf0fb; }
  :global(.calendar-menu-popup) { position: absolute; top: 100%; left: 0; z-index: 70; min-width: 210px; background: #fff; box-shadow: 0 6px 22px rgb(0 0 0 / 16%); padding: 4px 0; }
  :global(.calendar-menu-popup > button) { display: block; width: 100%; text-align: left; border: 0; background: transparent; font: inherit; font-size: 12.5px; padding: 4px 14px; cursor: pointer; }
  :global(.calendar-menu-popup > button:hover:not(:disabled)) { background: #eaf0fb; }
  :global(.calendar-menu-popup > button:disabled) { color: #a0a6b2; cursor: default; }
  :global(.calendar-menubar) { display: flex; gap: 2px; background: #f6f7fb; border-bottom: 1px solid #e0e2ec; padding: 0 8px; position: relative; }
  :global(.calendar-menubar > .calendar-menu) { position: relative; }
  :global(.calendar-menubar > .calendar-menu > button) { border: 0; background: transparent; font: inherit; font-size: 12.5px; padding: 4px 10px; cursor: pointer; color: #4a4f56; }
  :global(.calendar-menubar > .calendar-menu > button:hover) { background: #e5e8f2; }
  :global(.calendar-titlebar) { height: 32px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border-bottom: 1px solid #ddd; }
  :global(.calendar-editor .monthly-rules) { display: flex; flex-direction: row; gap: 6px; align-items: center; border: 1px solid #e0e2ec; border-radius: 8px; padding: 8px; margin: 8px 0; flex-wrap: wrap; }
  :global(.monthly-rules small) { flex-basis: 100%; }
  :global(.weekdays-target) { display: inline-flex; gap: 3px; }
  :global(.weekdays-target > button) { font: inherit; font-size: 10.5px; padding: 2px 6px; border: 1px solid #c8ccd8; background: #fff; border-radius: 4px; cursor: pointer; }
  :global(.weekdays-target > button.active) { background: #3b7bbf; border-color: #2f6da5; color: #fff; }
  :global(.birthdays-inert) { display: inline-flex; gap: 6px; align-items: center; color: #8a8f97; font-size: 12px; }
  :global(.birthdays-inert em) { font-size: 11.5px; }
  :global(.calendar-reminders) { margin-top: 8px; }
  :global(.calendar-reminders h4) { display: flex; align-items: center; gap: 4px; }
  :global(.calendar-reminder) { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 11.5px; border: 1px dashed #d7dce6; border-radius: 6px; padding: 4px 6px; margin: 3px 0; color: #5d626a; background: #fbfcfe; }
  :global(.calendar-reminder.completed) { opacity: 0.62; text-decoration: line-through; }
  :global(.reminder-chips) { display: flex; flex-wrap: wrap; gap: 2px; margin: 2px 4px; }
  :global(.reminder-chip) { font-size: 10px; color: #5b4a6b; background: color-mix(in srgb, #af52de 14%, white); border: 1px dashed #c9a6e0; border-radius: 4px; padding: 0 4px; pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  :global(.reminder-chip.completed) { text-decoration: line-through; opacity: 0.65; }
  :global(.reminder-bubble) { position: absolute; border-radius: 4px; font-size: 11px; padding: 1px 6px; pointer-events: none; }
  :global(.reminder-bubble.allday) { background: color-mix(in srgb, #af52de 12%, white); border: 1px dashed #c9a6e0; color: #5b4a6b; }
  :global(.reminder-bubble.timed) { background: color-mix(in srgb, #af52de 10%, white); border-left: 2px solid #af52de; color: #5b4a6b; }
  :global(.reminder-bubble.completed) { opacity: 0.6; text-decoration: line-through; }
  :global(.reminder-marker) { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: #af52de; pointer-events: none; margin-left: 1px; }
  :global(.year-grid > button .reminder-marker) { vertical-align: super; }
  :global(.windows .accent) { background: #0067c0; border-color: #0067c0; }
</style>

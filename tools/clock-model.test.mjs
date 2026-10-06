import { expect, test } from 'bun:test';
import { clockDefaults, validateClockState, configureClockMenu, setClockZone, setClockFormat,
  clockSummary, clockParts, clockRecordLabel, resolveClockLocalDateTime } from '../frontend/src/clock-model.js';
import { createNotesState, createNote, updateNote, trashNote, restoreNote, groupNotes, nextNoteTimestamp } from '../frontend/src/notes-state.js';
import { notesPreferencesDefaults } from '../frontend/src/notes-preferences.js';
import { createNotesCommands } from '../frontend/src/notes-commands.js';
import { communicationDefaults, draftPreview, createCommunicationDraft, changeCommunicationDraft, submitCommunicationDraft } from '../frontend/src/communication-state.js';
import { createDefaultSceneSeed, validateSceneSeed } from '../frontend/src/scene-seed.js';
import { getOSProfile } from '../frontend/src/os-profiles.js';

const instant = text => Date.parse(text), MAX_TIME = 8_640_000_000_000_000 - 1;
const profile = getOSProfile('macos-golden-gate-27.0.1');
const clone = value => structuredClone(value);
const fields = { to: 'local@example.test', body: 'Authored bytes' };
function unchanged(state, call, code = 'invalid_arguments') {
  const before = clone(state);
  expect(call().error.code).toBe(code);
  expect(state).toEqual(before);
}

test('clock preference transitions inspect descriptors before values and reject nonliteral or incomplete data', () => {
  const state = clockDefaults();
  for (const payload of [{}, { style: 'round' }, { showDate: 'sometimes' }, { showDayOfWeek: 1 }, { showAMPM: 'true' }, { use24Hour: true }, { timeZone: 'UTC' }, { extra: false }])
    unchanged(state, () => configureClockMenu(state, payload));
  for (const zone of ['GMT', 'Europe/Paris', null, { toString: () => 'UTC' }]) unchanged(state, () => setClockZone(state, zone));
  for (const value of [0, 'false', null]) unchanged(state, () => setClockFormat(state, value));
  let reads = 0;
  const payload = {};
  Object.defineProperty(payload, 'style', { enumerable: true, get() { reads++; return 'analog'; } });
  unchanged(state, () => configureClockMenu(state, payload));
  const actor = clone(state);
  Object.defineProperty(actor, 'timeZone', { enumerable: true, get() { reads++; return 'UTC'; } });
  expect(validateClockState(actor).ok).toBe(false);
  expect(setClockFormat(actor, true).error.code).toBe('invalid_arguments');
  expect(reads).toBe(0);
  const missing = clone(state); delete missing.showSeconds;
  expect(validateClockState(missing).ok).toBe(false);
  expect(validateClockState({ ...state, currentInstant: 0 }).ok).toBe(false);
});

test('clock menu and zone budgets use exact UTF-16 deltas and cannot partially mutate readonly or denied changes', () => {
  const state = clockDefaults(), before = clone(state);
  unchanged(state, () => configureClockMenu(state, { style: 'analog', showDate: 'when-space-allows', showSeconds: true }, delta => {
    expect(delta).toBe('analog'.length - before.style.length + 'when-space-allows'.length - before.showDate.length);
    expect(state).toEqual(before); return false;
  }), 'limit_exceeded');
  unchanged(state, () => setClockZone(state, 'America/Los_Angeles', () => { throw Error('no budget'); }), 'limit_exceeded');
  unchanged(state, () => setClockFormat(state, true, null));
  Object.defineProperty(state, 'showDate', { writable: false });
  let calls = 0;
  unchanged(state, () => configureClockMenu(state, { style: 'analog', showDate: 'always' }, () => { calls++; return true; }));
  expect(calls).toBe(0);
  expect(setClockZone(state, 'Asia/Tokyo', delta => { expect(delta).toBe('Asia/Tokyo'.length - 'UTC'.length); return true; }).status).toBe('applied');
  expect(setClockFormat(state, true, delta => { expect(delta).toBe(0); return true; }).status).toBe('applied');
});

test('a budget decision cannot swap the validated preference payload or commit against changed state descriptors', () => {
  const state = clockDefaults(), payload = { style: 'analog', showSeconds: true };
  expect(configureClockMenu(state, payload, () => { payload.style = 'invalid'; payload.showSeconds = false; return true; }).status).toBe('applied');
  expect(state.style).toBe('analog'); expect(state.showSeconds).toBe(true);
  let reads = 0;
  const stale = clockDefaults();
  expect(setClockZone(stale, 'Asia/Tokyo', () => {
    Object.defineProperty(stale, 'showAMPM', { enumerable: true, get() { reads++; return true; } });
    return true;
  }).error.code).toBe('stale_target');
  expect(stale.timeZone).toBe('UTC'); expect(reads).toBe(0);
});

test('selected-zone summary obeys noon, midnight, leap day, seconds and 24-hour policy without losing analog preferences', () => {
  const state = clockDefaults();
  configureClockMenu(state, { showDayOfWeek: false, showSeconds: true });
  expect(clockSummary(state, instant('2024-02-29T00:00:01Z')).menuWithoutDate).toBe('12:00:01 AM');
  expect(clockSummary(state, instant('2024-02-29T12:00:00Z')).menuWithoutDate).toBe('12:00:00 PM');
  configureClockMenu(state, { showAMPM: false });
  expect(clockSummary(state, instant('2024-02-29T12:00:00Z')).menuWithoutDate).toBe('12:00:00');
  setClockFormat(state, true); setClockZone(state, 'Asia/Tokyo');
  const selected = clockSummary(state, instant('2024-02-28T15:00:01Z'));
  expect(selected.localDateTime).toBe('2024-02-29T00:00:01');
  expect(selected.menuWithoutDate).toBe('00:00:01'); expect(selected.fullTime).toBe('00:00:01');
  expect(selected.iso).toBe('2024-02-28T15:00:01.000Z');
  expect(selected.fullDate).toContain('February 29, 2024');
  configureClockMenu(state, { style: 'analog' });
  expect(clockSummary(state, selected.sceneTime).menuWithoutDate).toBe('');
  expect(state.showSeconds).toBe(true); expect(state.showAMPM).toBe(false);
  configureClockMenu(state, { style: 'digital' });
  expect(clockSummary(state, selected.sceneTime).menuWithoutDate).toBe('00:00:01');
});

test('analog hands include fractional seconds in the selected zone and remain finite at representable edges', () => {
  const state = clockDefaults(), time = instant('2026-09-28T09:41:30.500Z');
  const summary = clockSummary(state, time);
  expect(summary.secondAngle).toBeCloseTo(183, 8);
  expect(summary.minuteAngle).toBeCloseTo((41 + 30.5 / 60) * 6, 8);
  expect(summary.hourAngle).toBeCloseTo((9 + (41 + 30.5 / 60) / 60) * 30, 8);
  setClockZone(state, 'America/Los_Angeles');
  expect(clockSummary(state, time).hourAngle).toBeCloseTo((2 + (41 + 30.5 / 60) / 60) * 30, 8);
  for (const edge of [0, MAX_TIME]) {
    const result = clockSummary(state, edge);
    expect(Number.isFinite(result.hourAngle)).toBe(true);
    expect(Number.isInteger(clockParts(edge, state.timeZone).dayNumber)).toBe(true);
  }
  expect(clockSummary(state, MAX_TIME).localDateTime).toBeNull();
  expect(() => clockSummary(state, MAX_TIME + 1)).toThrow();
});

test('strict local resolution rejects invalid calendars, DST gaps and folds rather than normalizing or choosing an offset', () => {
  for (const value of ['', '2026-3-08T02:30', '2026-03-08 02:30', '2026-02-30T12:00', '2025-02-29T00:00', '1969-12-31T23:59', '2026-01-01T24:00', '2026-01-01T12:60', '2026-01-01T12:00:60', '2026-01-01T12:00Z'])
    expect(resolveClockLocalDateTime(value, 'UTC').ok).toBe(false);
  for (const [zone, gap, fold] of [
    ['America/New_York', '2026-03-08T02:30', '2026-11-01T01:30'],
    ['America/Los_Angeles', '2026-03-08T02:30', '2026-11-01T01:30'],
    ['Europe/London', '2026-03-29T01:30', '2026-10-25T01:30'],
  ]) {
    expect(resolveClockLocalDateTime(gap, zone).ok).toBe(false);
    expect(resolveClockLocalDateTime(fold, zone).ok).toBe(false);
  }
  expect(resolveClockLocalDateTime('2024-02-29T23:59:59', 'UTC')).toEqual({ ok: true, sceneTime: instant('2024-02-29T23:59:59Z') });
  expect(resolveClockLocalDateTime('2026-03-08T03:00', 'America/New_York')).toEqual({ ok: true, sceneTime: instant('2026-03-08T07:00:00Z') });
  expect(resolveClockLocalDateTime('2026-03-08T03:00', 'Asia/Tokyo')).toEqual({ ok: true, sceneTime: instant('2026-03-07T18:00:00Z') });
  expect(resolveClockLocalDateTime('9999-12-31T23:59:59', 'UTC').ok).toBe(true);
  expect(resolveClockLocalDateTime('1970-01-01T00:00', 'Asia/Tokyo').ok).toBe(false);
});

test('record labels and Notes groups compare selected-zone civil days across DST and midnight, not elapsed days', () => {
  const zone = 'America/New_York', now = instant('2026-03-09T04:30:00Z'), previous = instant('2026-03-08T05:30:00Z');
  expect(now - previous).toBe(23 * 3_600_000);
  expect(clockParts(now, zone).dayNumber - clockParts(previous, zone).dayNumber).toBe(1);
  expect(clockRecordLabel(previous, now, zone, true)).toBe('Yesterday');
  expect(clockRecordLabel(previous, now, zone, true, true)).toBe('Yesterday 00:30');
  expect(clockRecordLabel(now, now, zone, false, true)).toBe('Today 12:30 AM');
  const model = { ...createNotesState(previous - 42 * 60_000), preferences: notesPreferencesDefaults() };
  model.notes.forEach(note => { note.pinned = false; note.deleted = false; note.createdAt = previous; note.updatedAt = previous; });
  const before = clone(model), context = { sceneTime: now, timeZone: zone, use24Hour: true };
  expect(groupNotes(model, context).map(group => group.id)).toEqual(['yesterday']);
  expect(groupNotes(model, { ...context, sceneTime: now + 86_400_000 }).map(group => group.id)).toEqual(['previous-7-days']);
  expect(model).toEqual(before);
  const tokyoNow = instant('2026-12-31T15:10:00Z'), tokyoRecord = instant('2026-12-31T14:59:00Z');
  expect(clockRecordLabel(tokyoRecord, tokyoNow, 'Asia/Tokyo', false)).toBe('Yesterday');
  expect(clockRecordLabel(tokyoRecord, tokyoNow, 'UTC', true)).toBe('14:59');
  expect(clockRecordLabel(tokyoNow + 86_400_000, tokyoNow, 'Asia/Tokyo', true)).not.toBe('Yesterday');
});

test('Notes creation, editing, trash and restoration allocate above the shared scene clock and preserve immutable creation times', () => {
  const base = instant('2026-09-28T09:41:00Z'), notes = createNotesState(base - 42 * 60_000), sceneTime = base + 3 * 86_400_000;
  const id = createNote(notes, 'New record', sceneTime), note = notes.notes.find(note => note.id === id);
  expect(note.createdAt).toBe(sceneTime + 1);
  updateNote(notes, id, 'Edited record', sceneTime - 10);
  expect(note.updatedAt).toBe(sceneTime + 2); expect(note.createdAt).toBe(sceneTime + 1);
  trashNote(notes, id, sceneTime + 100);
  expect(note.updatedAt).toBe(sceneTime + 101);
  notes.folder = 'deleted'; notes.selectedId = id;
  restoreNote(notes, id, sceneTime + 200);
  expect(note.updatedAt).toBe(sceneTime + 201); expect(note.deleted).toBe(false);
  const exhausted = clone(notes); exhausted.timeBase = MAX_TIME;
  expect(nextNoteTimestamp(exhausted, sceneTime)).toBeNull();
  const before = clone(exhausted);
  expect(() => createNote(exhausted, 'No room', sceneTime)).toThrow();
  expect(exhausted).toEqual(before);
  const historical = createNotesState(), natural = nextNoteTimestamp(historical);
  const historicalId = createNote(historical);
  expect(historical.notes.find(entry => entry.id === historicalId).createdAt).toBe(natural);
});

test('communications previews, updates and submission use the same supplied clock with stale and budget atomicity', () => {
  const base = instant('2026-09-28T09:41:00Z'), state = communicationDefaults(base), shared = base + 86_400_000;
  const preview = draftPreview(state, 'message', fields, [], shared);
  expect(preview.createdAt).toBe(shared + 1); expect(state.timeBase).toBe(base);
  unchanged(state, () => createCommunicationDraft(state, preview, () => true, shared + 1), 'stale_target');
  unchanged(state, () => createCommunicationDraft(state, preview, candidate => {
    expect(candidate.timeBase).toBe(shared + 1); expect(state.timeBase).toBe(base); return false;
  }, shared), 'limit_exceeded');
  expect(createCommunicationDraft(state, preview, () => true, shared).status).toBe('applied');
  unchanged(state, () => changeCommunicationDraft(state, preview.id, 'body', 'Denied', candidate => {
    expect(candidate.timeBase).toBe(shared + 101); return false;
  }, shared + 100), 'limit_exceeded');
  expect(changeCommunicationDraft(state, preview.id, 'body', 'Changed', () => true, shared + 100).status).toBe('applied');
  expect(state.timeBase).toBe(shared + 101);
  expect(submitCommunicationDraft(state, preview.id, candidate => {
    expect(candidate.outbox[0].createdAt).toBe(shared + 102); return true;
  }, shared - 1).status).toBe('applied');
  expect(state.outbox[0].createdAt).toBe(shared + 102);
  expect(draftPreview(state, 'message', fields, [], MAX_TIME)).toBeNull();
});

test('required closed Clock roots and numeric Messages records remain isolated through account seed round trips', () => {
  const alex = createDefaultSceneSeed(profile), casey = createDefaultSceneSeed(profile), before = clone(casey);
  configureClockMenu(alex.system.clock, { style: 'analog', showDate: 'always' });
  setClockZone(alex.system.clock, 'America/New_York'); setClockFormat(alex.system.clock, true);
  alex.files.sceneTime += 86_400_000;
  const saved = JSON.parse(JSON.stringify(alex));
  expect(validateSceneSeed(saved, profile)).toEqual({ ok: true });
  expect(clockSummary(saved.system.clock, saved.files.sceneTime).timeZone).toBe('America/New_York');
  expect(casey).toEqual(before);
  expect(saved.messages.conversations.every(row => Number.isSafeInteger(row.timestamp))).toBe(true);
  for (const mutate of [
    value => { delete value.system.clock; }, value => { delete value.system.clock.use24Hour; },
    value => { value.system.clock.currentInstant = value.files.sceneTime; },
    value => { value.messages.conversations[0].time = '9:32 AM'; },
    value => { value.messages.conversations[0].timestamp = -1; },
    value => { value.messages.thread.timestampLabel = 'Today'; },
  ]) {
    const candidate = clone(saved); mutate(candidate);
    const invalid = clone(candidate);
    expect(validateSceneSeed(candidate, profile).ok).toBe(false); expect(candidate).toEqual(invalid);
  }
});

test('transport Notes writers advance only their committed root and refuse an exhausted shared clock before presentation mutation', async () => {
  const base = instant('2026-09-28T09:41:00Z'), notes = createNotesState(base - 42 * 60_000);
  const root = { sceneTime: base + 86_400_000 }, other = { sceneTime: base }, view = { context: null, contextItem: null, focusedControl: null };
  let commits = 0;
  const commands = createNotesCommands(notes, view, {
    getView: () => null, isVisible: () => false, focusWindow: () => {},
    getSceneTime: () => root.sceneTime,
    onTimeChanged: time => {
      expect(notes.notes.some(note => note.updatedAt === time)).toBe(true);
      root.sceneTime = Math.max(root.sceneTime, time); commits++;
    },
  });
  const initial = root.sceneTime;
  const result = await commands['notes.create']({}, {});
  expect(result.status).toBe('applied'); expect(root.sceneTime).toBe(initial + 1);
  expect(commands['notes.edit']({ noteId: result.target.noteId }, { text: 'Edited' }).status).toBe('applied');
  expect(root.sceneTime).toBe(initial + 2);
  expect(commands['notes.edit']({ noteId: result.target.noteId }, { text: 'Edited' }).status).toBe('applied');
  expect(commits).toBe(2);
  expect((await commands['notes.trash']({ noteId: result.target.noteId }, {})).status).toBe('applied');
  notes.folder = 'deleted'; notes.selectedId = result.target.noteId;
  expect((await commands['notes.restore']({ noteId: result.target.noteId }, {})).status).toBe('applied');
  expect(root.sceneTime).toBe(initial + 4); expect(other.sceneTime).toBe(base);
  root.sceneTime = MAX_TIME;
  view.context = { noteId: 'retained-context' };
  const before = clone({ notes, view, root }), count = commits;
  expect((await commands['notes.create']({}, {})).error.code).toBe('limit_exceeded');
  expect({ notes, view, root }).toEqual(before); expect(commits).toBe(count);
});

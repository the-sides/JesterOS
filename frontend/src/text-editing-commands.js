import { isRecord, rejected } from './feature-commands.js';
import { visibleNotes, setSearch } from './notes-state.js';
import { defineCommand, identity, object, empty, choice } from './command-schema.js';

const MAX_TEXT = 1024 * 1024, MAX_TOTAL = 4 * MAX_TEXT, MAX_SEARCH = 4096;
const MAX_TIME = 8_640_000_000_000_000 - 1, MAX_REVISION = Number.MAX_SAFE_INTEGER - 1;
const labels = ['typing', 'cut', 'paste', 'replace', 'substitution', 'spelling'];
const controls = ['title', 'body', 'search'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  && required.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const invalid = () => rejected('invalid_arguments', 'Use the documented closed text owner, UTF-16 range and payload.');
const stale = () => rejected('stale_target', 'The original text owner, revision, content or selection changed.');
const unavailable = () => rejected('unavailable', 'The original text presentation is unavailable.');
const limited = () => rejected('limit_exceeded', 'The edit exceeds a text, history revision or fictional date budget.');
const readOnly = () => rejected('read_only', 'Deleted notes and read-only controls cannot be edited.');
const applied = target => ({ status: 'applied', target });
const singleLine = text => text.replace(/[\r\n]/g, '');
const split = text => { const at = text.indexOf('\n'); return at < 0 ? [text, ''] : [text.slice(0, at), text.slice(at + 1)]; };
const selection = (range, length) => fields(range, ['start', 'end', 'direction'])
  && integer(range.start) && integer(range.end) && range.start <= range.end && range.end <= length
  && ['forward', 'backward', 'none'].includes(range.direction);
const sameSelection = (a, b) => a.start === b.start && a.end === b.end && a.direction === b.direction;
const stringSize = value => typeof value === 'string' ? value.length : value && typeof value === 'object'
  ? Object.values(value).reduce((sum, item) => sum + stringSize(item), 0) : 0;

/** Canonical input/textarea values, without trimming or title-display fallbacks. */
export function noteTextControlValue(note, control) {
  const [title, body] = split(note.text);
  return control === 'title' ? title.replace(/\r/g, '') : control === 'body' ? body.replace(/\r\n?/g, '\n') : undefined;
}

/** Private, bounded logical history. Every genuine input is one deterministic
 * transaction: no timing-dependent coalescing, including whitespace/mode changes.
 * Notes title/body share history; search and every other note remain independent. */
export function createTextEditingCommands(notes, clipboard, ctx) {
  const histories = new Map(), searchHistory = { entries: [], cursor: 0 };
  let searchRevision = 0, sequence = 0;
  const historyFor = noteId => {
    if (!histories.has(noteId)) histories.set(noteId, { entries: [], cursor: 0 });
    return histories.get(noteId);
  };
  const allHistories = () => [...histories.values(), searchHistory];
  const summarize = history => ({ undoCount: history.cursor, redoCount: history.entries.length - history.cursor,
    undoLabel: history.entries[history.cursor - 1]?.label ?? null, redoLabel: history.entries[history.cursor]?.label ?? null,
    canUndo: history.cursor > 0, canRedo: history.cursor < history.entries.length });
  function record(history, entry) {
    history.entries.splice(history.cursor);
    history.entries.push({ ...entry, sequence: ++sequence });
    history.cursor = history.entries.length;
    for (;;) {
      const retained = allHistories().flatMap(item => item.entries);
      if (retained.length <= 64 && retained.reduce((sum, item) => sum + item.before.length + item.after.length, 0) <= MAX_TOTAL) break;
      let oldestHistory, oldestIndex, oldest = Infinity;
      for (const item of allHistories()) item.entries.forEach((entry, index) => {
        if (entry.sequence < oldest) { oldest = entry.sequence; oldestHistory = item; oldestIndex = index; }
      });
      oldestHistory.entries.splice(oldestIndex, 1);
      if (oldestIndex < oldestHistory.cursor) oldestHistory.cursor--;
    }
  }
  const dataAvailable = () => ctx.dataAvailable();
  const canonical = target => target.control === 'search' ? singleLine(notes.search)
    : noteTextControlValue(notes.notes.find(note => note.id === target.noteId), target.control);
  function validTarget(target, range = true) {
    const required = ['windowId', 'control', 'revision', ...(range ? ['start', 'end'] : [])];
    if (!fields(target, [...required, 'noteId'], required) || !id(target.windowId) || !controls.includes(target.control)
      || !integer(target.revision) || target.revision > MAX_REVISION) return false;
    if (target.control === 'search' ? Object.hasOwn(target, 'noteId') : !id(target.noteId)) return false;
    return !range || (integer(target.start) && integer(target.end) && target.start <= target.end);
  }
  function capture(target, writable = false) {
    if (!dataAvailable() || !ctx.available()) return { error: unavailable() };
    const note = target.control === 'search' ? undefined : notes.notes.find(item => item.id === target.noteId);
    if (target.control !== 'search' && (!note || notes.selectedId !== note.id || !visibleNotes(notes).includes(note))) return { error: stale() };
    if (target.revision !== (note ? note.updatedAt : searchRevision)) return { error: stale() };
    const source = ctx.getSource(target), value = canonical(target);
    if (!source || typeof source.readOnly !== 'boolean' || (note && source.note !== note) || source.value !== value || !selection(source.selection, value.length)
      || (target.end !== undefined && target.end > value.length)) return { error: stale() };
    if (writable && (source.readOnly || note?.deleted)) return { error: readOnly() };
    const snapshot = { note, value, text: note?.text, revision: target.revision, readOnly: source.readOnly,
      selection: { ...source.selection }, selectedId: notes.selectedId, folder: notes.folder, search: notes.search };
    return snapshot;
  }
  function unchanged(target, snapshot, writable) {
    const current = capture(target, writable);
    return !current.error && current.note === snapshot.note && current.text === snapshot.text && current.value === snapshot.value
      && current.readOnly === snapshot.readOnly && current.selectedId === snapshot.selectedId && current.folder === snapshot.folder
      && current.search === snapshot.search && sameSelection(current.selection, snapshot.selection);
  }
  async function prepare(target, snapshot, writable) {
    let prepared;
    try { prepared = await ctx.prepare(target); } catch { return unavailable(); }
    if (!unchanged(target, snapshot, writable)) return stale();
    return prepared ? null : unavailable();
  }
  async function finish(target, range, revision) {
    // A committed edit remains successful if its temporary DOM owner disappears.
    try { await ctx.finishSelection({ ...target }, { ...range }, revision); } catch { /* Presentation only. */ }
  }
  function timestamp() {
    let latest = notes.timeBase;
    if (!integer(latest) || latest > MAX_TIME) return null;
    for (const note of notes.notes) {
      if (!integer(note.createdAt) || !integer(note.updatedAt) || note.createdAt > note.updatedAt || note.updatedAt > MAX_TIME) return null;
      latest = Math.max(latest, note.createdAt, note.updatedAt);
    }
    return latest < MAX_TIME ? latest + 1 : null;
  }
  function searchAllowed(query) {
    return query.length <= MAX_SEARCH && searchRevision < MAX_REVISION
      && stringSize(notes) - notes.search.length + query.length <= MAX_TOTAL
      && (ctx.canCommitSearch?.(query) ?? true);
  }
  function noteAllowed(note, text) {
    return text.length <= MAX_TEXT && timestamp() !== null
      && stringSize(notes) - note.text.length + text.length - notes.search.length <= MAX_TOTAL
      && (ctx.canCommitNote?.(note, text) ?? true)
      && (!notes.search || searchAllowed(''));
  }
  function changeSearch(query, entry) {
    if (notes.search === query) return;
    const before = notes.search;
    if (ctx.commitSearch) ctx.commitSearch(query); else setSearch(notes, query);
    searchRevision++;
    if (entry) record(searchHistory, { ...entry, before, after: query });
  }
  function changeNote(note, text) {
    if (note.text === text) return;
    const time = timestamp();
    if (notes.search) changeSearch('', { control: 'search', label: 'replace',
      beforeSelection: { start: 0, end: 0, direction: 'none' }, afterSelection: { start: 0, end: 0, direction: 'none' } });
    note.text = text;
    note.updatedAt = time;
  }
  function replaceField(target, value) {
    if (target.control === 'search') return value;
    const note = notes.notes.find(item => item.id === target.noteId), [title, body] = split(note.text);
    return target.control === 'title' ? value + (note.text.includes('\n') ? `\n${body}` : '') : `${title}\n${value}`;
  }
  function output(target, range, revision) {
    return { windowId: target.windowId, control: target.control, revision, start: range.start, end: range.end,
      ...(target.control === 'search' ? {} : { noteId: target.noteId }) };
  }
  function putClipboard(text) { clipboard.kind = 'text'; clipboard.text = text; clipboard.fileIds = []; }
  async function edit(target, inserted, label, cut = false, cursor) {
    const snapshot = capture(target, true);
    if (snapshot.error) return snapshot.error;
    inserted = target.control === 'body' ? inserted.replace(/\r\n?/g, '\n') : singleLine(inserted);
    const value = snapshot.value.slice(0, target.start) + inserted + snapshot.value.slice(target.end);
    if (cursor !== undefined && (!integer(cursor) || cursor > value.length)) return invalid();
    const before = snapshot.note ? snapshot.text : snapshot.search;
    const text = value === snapshot.value ? before : replaceField(target, value);
    const changed = before !== text;
    const copied = snapshot.value.slice(target.start, target.end);
    if ((cut && copied.length > MAX_TEXT) || (changed && !(snapshot.note ? noteAllowed(snapshot.note, text) : searchAllowed(text)))) return limited();
    const prepared = await prepare(target, snapshot, true);
    if (prepared) return prepared;
    // Preparation can change aggregate quotas or the global fictional clock.
    if (changed && !(snapshot.note ? noteAllowed(snapshot.note, text) : searchAllowed(text))) return limited();
    const caret = cursor ?? target.start + inserted.length;
    const range = { start: caret, end: caret, direction: 'none' };
    if (changed) {
      const entry = { before, after: text, control: target.control, label, beforeSelection: snapshot.selection, afterSelection: range };
      if (snapshot.note) { changeNote(snapshot.note, text); record(historyFor(snapshot.note.id), entry); }
      else changeSearch(text, entry);
    }
    if (cut) putClipboard(copied);
    if (changed || cut) ctx.onChanged();
    const revision = snapshot.note ? snapshot.note.updatedAt : searchRevision;
    await finish(target, range, revision);
    return applied(output(target, range, revision));
  }
  async function travel(target, redo) {
    const history = target.control === 'search' ? searchHistory : histories.get(target.noteId);
    const entry = history?.entries[redo ? history.cursor : history.cursor - 1];
    if (!entry) {
      const snapshot = capture(target, true);
      return snapshot.error ?? rejected('disabled', redo ? 'Nothing to redo.' : 'Nothing to undo.');
    }
    target = { ...target, control: entry.control };
    const snapshot = capture(target, true);
    if (snapshot.error) return snapshot.error;
    const expected = redo ? entry.before : entry.after, text = redo ? entry.after : entry.before;
    if ((snapshot.note ? snapshot.text : snapshot.search) !== expected) return stale();
    if (!(snapshot.note ? noteAllowed(snapshot.note, text) : searchAllowed(text))) return limited();
    const cursor = history.cursor;
    const prepared = await prepare(target, snapshot, true);
    if (prepared) return prepared;
    if (history.cursor !== cursor || history.entries[redo ? cursor : cursor - 1] !== entry) return stale();
    if (!(snapshot.note ? noteAllowed(snapshot.note, text) : searchAllowed(text))) return limited();
    history.cursor += redo ? 1 : -1;
    if (snapshot.note) changeNote(snapshot.note, text); else changeSearch(text);
    ctx.onChanged();
    const range = redo ? entry.afterSelection : entry.beforeSelection;
    const revision = snapshot.note ? snapshot.note.updatedAt : searchRevision;
    await finish(target, range, revision);
    return applied(output(target, range, revision));
  }
  const handlers = {
    'text.selection.set': async (target, payload) => {
      if (!validTarget(target) || !fields(payload, ['direction'], []) || (payload.direction !== undefined && !['forward', 'backward', 'none'].includes(payload.direction))) return invalid();
      target = { ...target };
      const snapshot = capture(target);
      if (snapshot.error) return snapshot.error;
      const range = { start: target.start, end: target.end, direction: payload.direction ?? 'none' };
      const prepared = await prepare(target, snapshot, false);
      if (prepared) return prepared;
      await finish(target, range, target.revision);
      const current = capture(target);
      if (current.error || current.note !== snapshot.note || current.text !== snapshot.text || current.value !== snapshot.value
        || current.readOnly !== snapshot.readOnly || current.selection.start !== range.start || current.selection.end !== range.end
        || (range.start !== range.end && range.direction !== 'none' && current.selection.direction !== range.direction)) return stale();
      return applied(output(target, range, target.revision));
    },
    'text.replace': (target, payload) => {
      if (!validTarget(target) || !fields(payload, ['text', 'label', 'cursor'], ['text']) || typeof payload.text !== 'string'
        || (payload.label !== undefined && !labels.includes(payload.label)) || (payload.cursor !== undefined && !integer(payload.cursor))) return invalid();
      if (payload.text.length > MAX_TEXT) return limited();
      return edit({ ...target }, payload.text, payload.label ?? 'replace', false, payload.cursor);
    },
    'text.clipboard.copy': async (target, payload) => {
      if (!validTarget(target) || !fields(payload, [])) return invalid();
      target = { ...target };
      const snapshot = capture(target);
      if (snapshot.error) return snapshot.error;
      if (target.start === target.end) return rejected('disabled', 'Select real text before copying.');
      const text = snapshot.value.slice(target.start, target.end);
      if (text.length > MAX_TEXT) return limited();
      const prepared = await prepare(target, snapshot, false);
      if (prepared) return prepared;
      putClipboard(text); ctx.onChanged();
      const range = { start: target.start, end: target.end, direction: snapshot.selection.direction };
      await finish(target, range, target.revision);
      return applied(output(target, range, target.revision));
    },
    'text.clipboard.cut': (target, payload) => !validTarget(target) || !fields(payload, []) ? invalid()
      : target.start === target.end ? rejected('disabled', 'Select real text before cutting.') : edit({ ...target }, '', 'cut', true),
    'text.clipboard.paste': async (target, payload) => {
      if (!validTarget(target) || !fields(payload, [])) return invalid();
      const snapshot = capture(target, true);
      if (snapshot.error) return snapshot.error;
      if (clipboard.kind !== 'text' || !clipboard.text) return rejected('disabled', 'The page-local clipboard does not contain text.');
      if (typeof clipboard.text !== 'string' || clipboard.text.length > MAX_TEXT) return limited();
      return edit({ ...target }, clipboard.text, 'paste');
    },
    'text.undo': (target, payload) => !validTarget(target, false) || !fields(payload, []) ? invalid() : travel({ ...target }, false),
    'text.redo': (target, payload) => !validTarget(target, false) || !fields(payload, []) ? invalid() : travel({ ...target }, true),
    'notes.edit': (target, payload, label = 'typing', native = null) => {
      if (!fields(target, ['noteId']) || !id(target.noteId) || !fields(payload, ['text']) || typeof payload.text !== 'string' || !labels.includes(label)) return invalid();
      if (!dataAvailable()) return unavailable();
      const note = visibleNotes(notes).find(item => item.id === target.noteId);
      if (!note || note.id !== notes.selectedId) return stale();
      if (note.deleted) return readOnly();
      if (payload.text === note.text) return applied({ noteId: note.id });
      if (!noteAllowed(note, payload.text)) return limited();
      const control = native?.control ?? (split(note.text)[0] !== split(payload.text)[0] ? 'title' : 'body');
      if (!['title', 'body'].includes(control) || native && (!selection(native.before, noteTextControlValue(note, control).length)
        || !selection(native.after, noteTextControlValue({ text: payload.text }, control).length))) return invalid();
      const before = note.text, range = native?.before ?? { start: 0, end: 0, direction: 'none' };
      changeNote(note, payload.text);
      record(historyFor(note.id), { before, after: payload.text, control, label, beforeSelection: range,
        afterSelection: native?.after ?? { start: noteTextControlValue(note, control).length, end: noteTextControlValue(note, control).length, direction: 'none' } });
      ctx.onChanged();
      return applied({ noteId: note.id });
    },
    'notes.search': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['query']) || typeof payload.query !== 'string') return invalid();
      if (!dataAvailable()) return unavailable();
      if (payload.query === notes.search) return applied({});
      if (!searchAllowed(payload.query)) return limited();
      changeSearch(payload.query, { control: 'search', label: 'typing', beforeSelection: { start: 0, end: 0, direction: 'none' },
        afterSelection: { start: singleLine(payload.query).length, end: singleLine(payload.query).length, direction: 'none' } });
      ctx.onChanged();
      return applied({});
    },
  };
  return { handlers, editDocument: (noteId, text, label = 'typing', native = null) => handlers['notes.edit']({ noteId }, { text }, label, native),
    targets: () => ({ searchRevision, clipboard: { kind: clipboard.kind, text: clipboard.text, fileIds: [...clipboard.fileIds] },
    history: { notes: [...histories].map(([noteId, history]) => ({ noteId, ...summarize(history) })), search: summarize(searchHistory) } }) };
}

const profiles = ['macos-golden-gate-27.0.1'];
const safeInteger = { type: 'integer', minimum: 0, maximum: MAX_REVISION };
const utf16Offset = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const ownerSchema = range => ({ oneOf: [
  object({ windowId: { ...identity, maxLength: 128 }, control: choice('title', 'body'), revision: safeInteger, noteId: { ...identity, maxLength: 128 },
    ...(range ? { start: utf16Offset, end: utf16Offset } : {}) }),
  object({ windowId: { ...identity, maxLength: 128 }, control: { const: 'search' }, revision: safeInteger,
    ...(range ? { start: utf16Offset, end: utf16Offset } : {}) }),
] });
const descriptors = [
  ['text.selection.set', object({ direction: choice('forward', 'backward', 'none') }, []), false, ['native owned selection']],
  ['text.replace', object({ text: { type: 'string', maxLength: MAX_TEXT }, label: choice(...labels), cursor: utf16Offset }, ['text']), false, ['owned text replacement', 'logical history']],
  ['text.clipboard.copy', empty, false, ['page-local text clipboard']],
  ['text.clipboard.cut', empty, false, ['owned text deletion', 'page-local text clipboard', 'logical history']],
  ['text.clipboard.paste', empty, false, ['owned text insertion', 'logical history']],
  ['text.undo', empty, true, ['logical text undo']],
  ['text.redo', empty, true, ['logical text redo']],
];
export const textEditingCatalog = Object.fromEntries(descriptors.map(([name, payload, history, data]) => {
  const [command, descriptor] = defineCommand(profiles, name, 'shell.edit-workflows', ownerSchema(!history), payload,
    ['awake live root', 'exact mounted owner and revision', 'valid UTF-16 range', 'editable source for mutation'],
    ['physically focus original control', 'guarded native selection; never retarget'], data,
    [], ownerSchema(true));
  descriptor.resultSchema.additionalProperties = false;
  descriptor.completion.settles = 'Prepared original native owner, atomic page-local data and logical history, guarded post-render selection. Presentation disappearance after commit cannot reject committed data.';
  return [command, descriptor];
}));

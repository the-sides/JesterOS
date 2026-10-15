import { isRecord, rejected } from './feature-commands.js';
import { defineCommand, identity, object, empty, choice } from './command-schema.js';
import { NOTES_WORKSPACE_PROFILES, notesWorkspaceWindow, noteWorkspaceLocked } from './notes-workspace-state.js';
import { notesWorkspaceTextSource, notesPlaintextNativeSelection } from './notes-workspace-projections.js';
import { replaceSelection } from './notes-workspace-document.js';
import { copyCanonicalData } from './canonical-data.js';

const MAX_TEXT = 1048576, MAX_REVISION = Number.MAX_SAFE_INTEGER - 1;
const labels = ['typing', 'cut', 'paste', 'replace', 'substitution', 'spelling'];
const fields = (value, allowed, required = allowed) => isRecord(value)
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && allowed.includes(key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))
  && required.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_REVISION;
const invalid = () => rejected('invalid_arguments', 'Use the original rich editor owner, revision and supported paragraph/cell UTF-16 range.');
const stale = () => rejected('stale_target', 'The original rich note, session, revision, native view or selection changed.');
const unavailable = () => rejected('unavailable', 'The original mounted rich editor or canonical Notes command bridge is unavailable.');
const sameRange = (a, b) => a && b && a.start === b.start && a.end === b.end && a.direction === b.direction;

/** Plaintext command ranges are derived offsets into the original rich document.
 * The Notes controller alone owns document/history/clipboard transactions. */
export function createTextEditingCommands(notes, clipboard, ctx) {
  const validTarget = (target, range = true) => fields(target,
    ['windowId', 'noteId', 'control', 'revision', ...(range ? ['start', 'end'] : [])])
    && id(target.windowId) && id(target.noteId) && target.control === 'editor' && integer(target.revision)
    && (!range || integer(target.start) && integer(target.end) && target.start <= target.end);
  function capture(target, writable = false) {
    if (ctx.dataAvailable() !== true || ctx.available() !== true) return { error: unavailable() };
    const view = ctx.getView(target.windowId), session = notesWorkspaceWindow(notes, target.windowId);
    const source = notesWorkspaceTextSource(notes, target.windowId, view);
    if (!source || source.note.id !== target.noteId || source.revision !== target.revision
      || target.end !== undefined && target.end > source.value.length) return { error: stale() };
    if (writable && source.readOnly) return { error: rejected('read_only', 'The original rich note is not editable.') };
    return { ...source, view, session, document: source.note.document, query: session.query, folderId: session.folderId };
  }
  function current(target, original, writable = false, selection = true) {
    const source = capture(target, writable);
    return !source.error && source.note === original.note && source.document === original.document
      && source.view === original.view && source.session === original.session && source.value === original.value
      && source.readOnly === original.readOnly && source.query === original.query && source.folderId === original.folderId
      && (!selection || sameRange(source.selection, original.selection));
  }
  async function prepare(target, original, writable) {
    if (typeof ctx.prepare !== 'function') return unavailable();
    let prepared = false;
    try { prepared = await ctx.prepare(target); } catch { return unavailable(); }
    return !current(target, original, writable) ? stale() : prepared === true ? null : unavailable();
  }
  const invoke = (command, target, payload) => typeof ctx.invoke === 'function'
    ? ctx.invoke(command, { windowId: target.windowId }, payload) : unavailable();
  async function select(target, original, direction = 'forward') {
    const native = notesPlaintextNativeSelection(original.document, target.start, target.end);
    if (!native) return rejected('invalid_arguments', 'Cross-paragraph and cross-cell ranges are not supported.');
    native.direction = direction;
    if (original.view.restoreSelection(native) !== true || !current(target, original, false, false)) return stale();
    const source = capture(target);
    if (source.error || source.selection.start !== target.start || source.selection.end !== target.end
      || target.start !== target.end && direction !== 'none' && source.selection.direction !== direction) return stale();
    return invoke('notes.selection.set', target, { noteId: target.noteId, revision: target.revision, selection: native });
  }
  async function replace(target, payload) {
    const original = capture(target, true); if (original.error) return original.error;
    const native = notesPlaintextNativeSelection(original.document, target.start, target.end);
    if (!native) return rejected('invalid_arguments', 'Cross-paragraph and cross-cell replacement is not supported.');
    const document = copyCanonicalData(original.document), selection = replaceSelection(document, native, payload.text);
    if (!selection) return invalid();
    if (payload.cursor !== undefined) {
      const caret = notesPlaintextNativeSelection(document, payload.cursor, payload.cursor);
      if (!caret) return invalid(); Object.assign(selection, caret);
    }
    const error = await prepare(target, original, true); if (error) return error;
    return invoke('notes.document.set', target, { noteId: target.noteId, revision: target.revision, document, selection });
  }
  const handlers = {
    'text.selection.set': async (target, payload) => {
      if (!validTarget(target) || !fields(payload, ['direction'], [])
        || payload.direction !== undefined && !['forward', 'backward', 'none'].includes(payload.direction)) return invalid();
      const original = capture(target); if (original.error) return original.error;
      const error = await prepare(target, original, false); if (error) return error;
      return select(target, original, payload.direction ?? 'forward');
    },
    'text.replace': (target, payload) => {
      if (!validTarget(target) || !fields(payload, ['text', 'label', 'cursor'], ['text']) || typeof payload.text !== 'string'
        || payload.text.length > MAX_TEXT || payload.label !== undefined && !labels.includes(payload.label)
        || payload.cursor !== undefined && !integer(payload.cursor)) return invalid();
      return replace(target, payload);
    },
  };
  for (const operation of ['copy', 'cut', 'paste']) handlers[`text.clipboard.${operation}`] = async (target, payload) => {
    if (!validTarget(target) || !fields(payload, [])) return invalid();
    const original = capture(target, operation !== 'copy'); if (original.error) return original.error;
    if ((operation === 'copy' || operation === 'cut') && target.start === target.end) return rejected('disabled', 'Select actual rich text first.');
    const error = await prepare(target, original, operation !== 'copy'); if (error) return error;
    const selected = await select(target, original, original.selection.direction);
    if (selected.status !== 'applied') return selected;
    // Selection is an acknowledged canonical transition. Reacquire only the same
    // original note/view/revision, never borrow a newly selected document.
    const after = capture(target, operation !== 'copy');
    if (after.error || !current(target, original, operation !== 'copy', false)
      || after.selection.start !== target.start || after.selection.end !== target.end) return stale();
    return invoke('notes.clipboard', target, { operation });
  };
  for (const operation of ['undo', 'redo']) handlers[`text.${operation}`] = async (target, payload) => {
    if (!validTarget(target, false) || !fields(payload, [])) return invalid();
    const original = capture(target, true); if (original.error) return original.error;
    const error = await prepare(target, original, true); if (error) return error;
    return invoke(`notes.${operation}`, target, {});
  };
  return { handlers, targets: () => ({ clipboard: { kind: clipboard.kind, text: clipboard.text, fileIds: [...clipboard.fileIds] },
    history: { notes: notes.notes.filter(note => !noteWorkspaceLocked(note)).map(note => ({ noteId: note.id,
      canUndo: note.undo.length > 0, canRedo: note.redo.length > 0, undoCount: note.undo.length, redoCount: note.redo.length })) } }) };
}

const revision = { type: 'integer', minimum: 0, maximum: MAX_REVISION };
const owner = range => object({ windowId: identity, noteId: identity, control: { const: 'editor' }, revision,
  ...(range ? { start: revision, end: revision } : {}) });
const descriptors = [
  ['text.selection.set', object({ direction: choice('forward', 'backward', 'none') }, []), true],
  ['text.replace', object({ text: { type: 'string', maxLength: MAX_TEXT }, label: choice(...labels), cursor: revision }, ['text']), true],
  ...['copy', 'cut', 'paste'].map(operation => [`text.clipboard.${operation}`, empty, true]),
  ...['undo', 'redo'].map(operation => [`text.${operation}`, empty, false]),
];
export const textEditingCatalog = Object.fromEntries(descriptors.map(([name, payload, range]) => defineCommand(
  NOTES_WORKSPACE_PROFILES, name, 'notes.workspace', owner(range), payload,
  ['Original available rich Notes editor, exact canonical revision and paragraph/table-cell range.'],
  ['Use the original native facade; reject cross-block/cell ranges.'],
  ['Canonical Notes controller owns rich document/history and atomic scene clipboard writes.'], [], object({ windowId: identity }))));

import { isRecord, rejected } from './feature-commands.js';
import { defineCommand, object, identity, choice } from './command-schema.js';

const MAX_TEXT = 1024 * 1024;
const fields = (value, keys) => isRecord(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const offset = value => Number.isSafeInteger(value) && value >= 0;
const invalid = () => rejected('invalid_arguments', 'Use an exact connected draft control, its current value and UTF-16 selection.');
const stale = () => rejected('stale_target', 'The original draft, control, value or selection changed.');

/** Existing Save-name/tags and Desktop-rename drafts use their own canonical
 * setters. This bridge never dispatches synthetic input or touches host clipboard. */
export function createNativeClipboardCommands(clipboard, ctx) {
  const histories = new Map();
  let sequence = 0;
  const key = target => `${target.surface}:${target.ownerId}:${target.control}`;
  function recordInput(target, before, after, beforeRange, afterRange) {
    if (before === after || before.length > MAX_TEXT || after.length > MAX_TEXT) return;
    const id = key(target), history = histories.get(id) ?? { undo: [], redo: [] };
    if (history.undo.length && history.undo.at(-1).after !== before) history.undo.length = 0;
    history.redo.length = 0; history.undo.push({ before, after, beforeRange, afterRange, sequence: ++sequence });
    histories.set(id, history);
    for (;;) {
      let count = 0, units = 0, oldest = null;
      for (const [id, history] of histories) for (const list of [history.undo, history.redo]) for (const entry of list) {
        count++; units += entry.before.length + entry.after.length;
        if (!oldest || entry.sequence < oldest.entry.sequence) oldest = { id, history, list, entry };
      }
      if (count <= 64 && units <= 4 * MAX_TEXT) break;
      oldest.list.splice(oldest.list.indexOf(oldest.entry), 1);
      if (!oldest.history.undo.length && !oldest.history.redo.length) histories.delete(oldest.id);
    }
    ctx.onChanged();
  }
  function targets(target) {
    const history = target && histories.get(key(target)), source = target && ctx.getControl(target);
    return { undo: Boolean(source && history?.undo.at(-1)?.after === source.value),
      redo: Boolean(source && history?.redo.at(-1)?.before === source.value) };
  }
  const handlers = { 'clipboard.control': async (target, payload) => {
    if (!fields(target, ['surface', 'ownerId', 'control', 'value', 'start', 'end'])
      || !['file-dialog', 'desktop-rename'].includes(target.surface) || typeof target.ownerId !== 'string' || !target.ownerId
      || !['name', 'tags'].includes(target.control) || typeof target.value !== 'string' || target.value.length > MAX_TEXT || !offset(target.start) || !offset(target.end)
      || target.start > target.end || target.end > target.value.length || !fields(payload, ['operation'])
      || !['copy', 'cut', 'paste', 'undo', 'redo', 'selectAll'].includes(payload.operation)) return invalid();
    const source = ctx.getControl(target);
    if (!source || source.value !== target.value || source.start !== target.start || source.end !== target.end) return stale();
    const op = payload.operation, undo = op === 'undo', redo = op === 'redo', select = op === 'selectAll';
    const history = histories.get(key(target)), entry = (undo ? history?.undo : redo ? history?.redo : null)?.at(-1);
    if ((op === 'copy' || op === 'cut') && target.start === target.end) return rejected('disabled', 'Select real draft text first.');
    if ((undo || redo) && (!entry || target.value !== (undo ? entry.after : entry.before))) return rejected('disabled', 'No current draft transaction can be restored.');
    if (op === 'paste' && (clipboard.kind !== 'text' || !clipboard.text)) return rejected('disabled', 'The scene clipboard does not contain text.');
    const selected = target.value.slice(target.start, target.end), insertion = op === 'paste' ? clipboard.text.replace(/[\r\n]/g, '') : '';
    const value = op === 'copy' || select ? target.value : undo || redo ? undo ? entry.before : entry.after
      : target.value.slice(0, target.start) + insertion + target.value.slice(target.end);
    if (selected.length > MAX_TEXT || (op !== 'copy' && !select && value.length > source.maxLength)) return rejected('limit_exceeded', 'The draft field or scene clipboard text limit would be exceeded.');
    if (!await ctx.prepare(target)) return rejected('unavailable', 'The original native draft control could not be focused.');
    const current = ctx.getControl(target);
    if (!current || current.value !== target.value || current.start !== target.start || current.end !== target.end) return stale();
    if (op !== 'copy' && !select) {
      const result = await current.commit(value);
      if (result.status !== 'applied') return result;
    }
    if (op === 'copy' || op === 'cut') Object.assign(clipboard, { kind: 'text', text: selected, fileIds: [] });
    const range = select ? { start: 0, end: value.length } : op === 'copy' ? { start: target.start, end: target.end }
      : undo || redo ? undo ? entry.beforeRange : entry.afterRange
      : { start: target.start + insertion.length, end: target.start + insertion.length };
    if (undo || redo) { (undo ? history.undo : history.redo).pop(); (undo ? history.redo : history.undo).push(entry); }
    else if (op !== 'copy' && !select) recordInput(target, target.value, value, { start: target.start, end: target.end }, range);
    ctx.onChanged();
    try { await ctx.finish(target, range, value); } catch { if (select) return stale(); }
    if (select) {
      const actual = ctx.getControl(target);
      if (!actual || actual.value !== value || actual.start !== range.start || actual.end !== range.end) return stale();
    }
    return { status: 'applied', target: { surface: target.surface, ownerId: target.ownerId, control: target.control, start: range.start, end: range.end } };
  } };
  return { handlers, recordInput, targets };
}

const target = object({ surface: choice('file-dialog', 'desktop-rename'), ownerId: identity, control: choice('name', 'tags'),
  value: { type: 'string', maxLength: MAX_TEXT }, start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 } });
export const nativeClipboardCatalog = Object.fromEntries([defineCommand(['macos-golden-gate-27.0.1'], 'clipboard.control', 'shell.edit-workflows', target,
  object({ operation: choice('copy', 'cut', 'paste', 'undo', 'redo', 'selectAll') }), ['Original foreground connected editable registered Save-name/tags or Desktop-rename draft, exact value/selection; no hidden or replaced owner.'],
  ['Prepare the actual control and retain guarded native selection.'], ['Only the scene clipboard and existing canonical draft setter; never host clipboard or synthetic input.'], [],
  object({ surface: choice('file-dialog', 'desktop-rename'), ownerId: identity, control: choice('name', 'tags'), start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 0 } }))]);
nativeClipboardCatalog['clipboard.control'].resultSchema.additionalProperties = false;

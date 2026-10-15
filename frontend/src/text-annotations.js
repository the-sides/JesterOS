import { noteWorkspaceLocked } from './notes-workspace-state.js';
import { notesDocumentTextRanges } from './notes-workspace-projections.js';
import { selectionRuns, runsText } from './notes-workspace-document.js';

/** Decorations are projections for one original paragraph/table cell. They do
 * not replace or serialize the native rich contenteditable owner. */
export function noteRichAnnotations(note, selection, find, spelling) {
  if (!note || noteWorkspaceLocked(note)) return { value: '', segments: [] };
  const range = notesDocumentTextRanges(note.document).find(range => range.blockId === selection?.blockId
    && range.row === selection.row && range.column === selection.column);
  const runs = selectionRuns(note.document, selection);
  if (!range || !runs) return { value: '', segments: [] };
  const value = runsText(runs), events = [];
  function add(annotation, kind) {
    const start = Math.max(range.start, annotation.start), end = Math.min(range.end, annotation.end);
    if (end <= start) return;
    events.push({ at: start - range.start, kind, change: 1 }, { at: end - range.start, kind, change: -1 });
  }
  for (const annotation of find?.highlights ?? []) add(annotation, 'find');
  if (find?.selected) add(find.selected, 'selected');
  for (const annotation of spelling?.issues ?? []) add(annotation, 'spelling');
  if (!events.length) return { value, segments: [] };
  events.sort((a, b) => a.at - b.at);
  const active = { find: 0, selected: 0, spelling: 0 }, segments = [];
  let at = 0, index = 0;
  const append = end => {
    if (end > at) segments.push({ text: value.slice(at, end), find: active.find > 0,
      selected: active.selected > 0, spelling: active.spelling > 0 });
    at = end;
  };
  while (index < events.length) {
    const end = events[index].at; append(end);
    while (index < events.length && events[index].at === end) { const event = events[index++]; active[event.kind] += event.change; }
  }
  append(value.length);
  return { value, segments };
}

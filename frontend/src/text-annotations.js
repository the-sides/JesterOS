import { noteTextControlValue } from './text-editing-commands.js';

/** Decorative ranges never replace the actual native title/body controls. */
export function noteControlAnnotations(note, control, find, spelling) {
  const value = noteTextControlValue(note, control), newline = note.text.indexOf('\n');
  const base = control === 'title' ? 0 : newline < 0 ? note.text.length : newline + 1;
  const limit = control === 'title' ? newline < 0 ? note.text.length : newline : note.text.length;
  const events = [];
  function add(range, kind) {
    const from = Math.max(base, range.start), to = Math.min(limit, range.end);
    if (to <= from) return;
    events.push({ at: from - base, kind, change: 1 }, { at: to - base, kind, change: -1 });
  }
  for (const range of find?.highlights ?? []) add(range, 'find');
  if (find?.selected) add(find.selected, 'selected');
  for (const range of spelling?.issues ?? []) add(range, 'spelling');
  if (!events.length) return { value, segments: [] };
  events.sort((a, b) => a.at - b.at);
  const active = { find: 0, selected: 0, spelling: 0 }, segments = [];
  let at = 0, index = 0, rawOffset = 0, nativeOffset = 0;
  while (index < events.length) {
    const rawEnd = events[index].at;
    while (rawOffset < rawEnd) {
      const code = note.text.charCodeAt(base + rawOffset);
      if (control === 'title' ? code !== 13 : code !== 10 || rawOffset === 0 || note.text.charCodeAt(base + rawOffset - 1) !== 13) nativeOffset++;
      rawOffset++;
    }
    const end = nativeOffset;
    if (end > at) segments.push({ text: value.slice(at, end), find: active.find > 0, selected: active.selected > 0, spelling: active.spelling > 0 });
    while (index < events.length && events[index].at === rawEnd) { const event = events[index++]; active[event.kind] += event.change; }
    at = end;
  }
  if (at < value.length) segments.push({ text: value.slice(at), find: false, selected: false, spelling: false });
  return { value, segments };
}

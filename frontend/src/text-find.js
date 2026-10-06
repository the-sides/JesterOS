const MAX_HIGHLIGHTS = 500;
const literal = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function noteFindExpression(query, { caseSensitive = false, wholeWord = false } = {}) {
  if (typeof query !== 'string' || !query.length || query.length > 4096) return null;
  const term = literal(query);
  return new RegExp(wholeWord ? `(?<![\\p{L}\\p{M}\\p{N}_])${term}(?![\\p{L}\\p{M}\\p{N}_])` : term, caseSensitive ? 'gu' : 'giu');
}

/** Literal Unicode matching retains original UTF-16 offsets. Count is exact;
 * only decorative highlights are capped, never the navigable result set. */
export function findTextMatches(text, query, options = {}, index = 0) {
  const expression = noteFindExpression(query, options);
  if (!expression) return { count: 0, selected: null, highlights: [], truncated: false };
  let count = 0, selected = null, first = null, last = null;
  const highlights = [];
  for (const match of text.matchAll(expression)) {
    const range = { start: match.index, end: match.index + match[0].length, index: count };
    first ??= range; last = range;
    if (count === index) selected = range;
    if (highlights.length < MAX_HIGHLIGHTS) highlights.push({ start: range.start, end: range.end });
    count++;
  }
  if (count && !selected) {
    const wrapped = ((index % count) + count) % count;
    if (wrapped === 0) selected = first;
    else if (wrapped === count - 1) selected = last;
    else {
      let current = 0;
      for (const match of text.matchAll(expression)) {
        if (current++ === wrapped) { selected = { start: match.index, end: match.index + match[0].length, index: wrapped }; break; }
      }
    }
  }
  return { count, selected, highlights, truncated: count > MAX_HIGHLIGHTS };
}

export function replaceAllNoteMatches(text, query, replacement, options = {}) {
  const expression = noteFindExpression(query, options);
  if (!expression) return { text, count: 0 };
  let count = 0;
  return { text: text.replace(expression, () => { count++; return replacement; }), count };
}

import { copyCanonicalData } from './canonical-data.js';
export const TEXTEDIT_MARK_DEFAULTS = Object.freeze({ bold: false, italic: false, underline: false, strike: false, font: 'Liberation Sans', size: 12, color: '#000000', link: '' });
export const TEXTEDIT_CONTENT_LIMITS = Object.freeze({ text: 1024 * 1024, blocks: 16384, runs: 65536, tableRows: 1024, tableColumns: 64 });
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const object = (value, keys) => {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length && keys.every(key => descriptors[key] && 'value' in descriptors[key]);
};
const array = value => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > TEXTEDIT_CONTENT_LIMITS.runs) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === value.length + 1 && Array.from({ length: value.length }, (_, i) => descriptors[i] && 'value' in descriptors[i]).every(Boolean);
};
const scalarText = text => typeof text === 'string' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
const bounded = (text, max) => scalarText(text) && text.length <= max;
const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const defaultMarks = marks => Object.keys(TEXTEDIT_MARK_DEFAULTS).every(key => marks[key] === TEXTEDIT_MARK_DEFAULTS[key]);
const marksValid = marks => object(marks, Object.keys(TEXTEDIT_MARK_DEFAULTS))
  && ['bold', 'italic', 'underline', 'strike'].every(key => typeof marks[key] === 'boolean')
  && bounded(marks.font, 1024) && marks.font.length > 0 && !/[\x00-\x1f;]/.test(marks.font)
  && number(marks.size, 1, 144) && typeof marks.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(marks.color)
  && bounded(marks.link, 4096) && !/[\x00-\x1f\x7f]/.test(marks.link);

/** Closed, descriptor-safe schema; accessors are never evaluated. */
export function validateTextEditContent(content) {
  try {
    if (!object(content, ['kind', 'blocks']) || !['plain', 'rich'].includes(content.kind) || !array(content.blocks)
      || !content.blocks.length || content.blocks.length > TEXTEDIT_CONTENT_LIMITS.blocks) return false;
    let textUnits = 0, runCount = 0;
    const ids = new Set();
    const runsValid = runs => {
      if (!array(runs) || !runs.length || runs.length > TEXTEDIT_CONTENT_LIMITS.runs) return false;
      for (const run of runs) {
        if (!object(run, ['text', 'marks']) || !bounded(run.text, TEXTEDIT_CONTENT_LIMITS.text) || !marksValid(run.marks)
          || (content.kind === 'plain' && !defaultMarks(run.marks))) return false;
        textUnits += run.text.length; runCount++;
      }
      return textUnits <= TEXTEDIT_CONTENT_LIMITS.text && runCount <= TEXTEDIT_CONTENT_LIMITS.runs;
    };
    for (const block of content.blocks) {
      // Read type only after checking its data descriptor.
      if (!block || typeof block !== 'object' || !Object.getOwnPropertyDescriptor(block, 'type')?.hasOwnProperty('value')) return false;
      if (block.type === 'paragraph') {
        if (!object(block, ['id', 'type', 'runs', 'align', 'spacing', 'indent', 'list', 'tabs']) || !runsValid(block.runs)
          || !['left', 'center', 'right', 'justify'].includes(block.align) || !number(block.spacing, 0.1, 10)
          || !number(block.indent, 0, 720) || !['none', 'bullet', 'number'].includes(block.list)
          || !array(block.tabs) || block.tabs.length > 64 || !block.tabs.every((tab, i) => number(tab, 0.05, 1440) && (!i || tab > block.tabs[i - 1]))) return false;
        if (content.kind === 'plain' && (block.align !== 'left' || block.spacing !== 1 || block.indent !== 0 || block.list !== 'none' || block.tabs.length)) return false;
      } else if (block.type === 'table') {
        if (content.kind !== 'rich' || !object(block, ['id', 'type', 'rows']) || !array(block.rows) || !block.rows.length || block.rows.length > TEXTEDIT_CONTENT_LIMITS.tableRows) return false;
        let columns;
        for (const row of block.rows) {
          if (!array(row) || !row.length || row.length > TEXTEDIT_CONTENT_LIMITS.tableColumns || (columns !== undefined && columns !== row.length)) return false;
          columns = row.length;
          if (!row.every(cell => object(cell, ['runs']) && runsValid(cell.runs))) return false;
          textUnits += row.length - 1;
        }
        textUnits += block.rows.length - 1;
      } else if (block.type === 'attachment') {
        if (content.kind !== 'rich' || !object(block, ['id', 'type', 'fileId', 'name', 'mime']) || !bounded(block.fileId, 256) || !block.fileId
          || !bounded(block.name, 1024) || !block.name || !bounded(block.mime, 256) || !block.mime || /[\x00-\x1f]/.test(block.fileId + block.mime)) return false;
        textUnits++;
      } else return false;
      if (!bounded(block.id, 256) || !block.id || ids.has(block.id)) return false;
      ids.add(block.id);
    }
    return textUnits + content.blocks.length - 1 <= TEXTEDIT_CONTENT_LIMITS.text;
  } catch { return false; }
}
const assertContent = content => { if (!validateTextEditContent(content)) fail('invalid_content', 'Expected a canonical TextEdit document.'); };
const run = (text, marks = TEXTEDIT_MARK_DEFAULTS) => ({ text, marks: { ...marks } });
const paragraph = (id, text) => ({ id, type: 'paragraph', runs: [run(text)], align: 'left', spacing: 1, indent: 0, list: 'none', tabs: [] });
export function createTextEditContent(text = '', kind = 'rich') {
  if (!bounded(text, TEXTEDIT_CONTENT_LIMITS.text) || !['plain', 'rich'].includes(kind)) fail('invalid_arguments', 'Expected bounded Unicode text and plain or rich kind.');
  const content = { kind, blocks: text.replace(/\r\n?|\n/g, '\n').split('\n').map((line, i) => paragraph(`paragraph-${i + 1}`, line)) };
  assertContent(content); return content;
}
const runsText = runs => runs.map(item => item.text).join('');
const blockText = block => block.type === 'paragraph' ? runsText(block.runs) : block.type === 'table' ? block.rows.map(row => row.map(cell => runsText(cell.runs)).join('\t')).join('\n') : '\uFFFC';
export function textEditPlainText(content) { assertContent(content); return content.blocks.map(blockText).join('\n'); }
const escape = text => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const runsHtml = runs => runs.map(({ text, marks }) => {
  const decorations = [marks.underline && 'underline', marks.strike && 'line-through'].filter(Boolean).join(' ');
  // Link metadata is inert: no href, navigation, event attributes or host access.
  return `<span${marks.link ? ` data-textedit-link="${escape(marks.link)}"` : ''} style="font-family:${escape(JSON.stringify(marks.font))};font-size:${marks.size}pt;color:${marks.color};font-weight:${marks.bold ? '700' : '400'};font-style:${marks.italic ? 'italic' : 'normal'};text-decoration:${decorations || 'none'}">${escape(text).replaceAll('\n', '<br>')}</span>`;
}).join('');
export function textEditHtml(content) {
  assertContent(content);
  let result = '', list = null;
  const closeList = () => { if (list) result += `</${list}>`; list = null; };
  for (const block of content.blocks) {
    if (block.type === 'paragraph') {
      const tag = block.list === 'bullet' ? 'ul' : block.list === 'number' ? 'ol' : null;
      if (tag !== list) { closeList(); if (tag) { result += `<${tag}>`; list = tag; } }
      const element = tag ? 'li' : 'p';
      result += `<${element} style="white-space:pre-wrap;text-align:${block.align};line-height:${block.spacing};margin-left:${block.indent}pt">${runsHtml(block.runs) || '<br>'}</${element}>`;
    } else {
      closeList();
      result += block.type === 'table' ? `<table><tbody>${block.rows.map(row => `<tr>${row.map(cell => `<td style="white-space:pre-wrap">${runsHtml(cell.runs)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        : `<p data-file-id="${escape(block.fileId)}">[Attachment: ${escape(block.name)} (${escape(block.mime)})]</p>`;
    }
  }
  closeList(); return result;
}
const clone = content => copyCanonicalData(content);
const mergeRuns = runs => {
  const result = [];
  for (const item of runs) {
    if (!item.text) continue;
    const previous = result.at(-1);
    if (previous && Object.keys(TEXTEDIT_MARK_DEFAULTS).every(key => previous.marks[key] === item.marks[key])) previous.text += item.text;
    else result.push(run(item.text, item.marks));
  }
  return result.length ? result : [run('')];
};
const sliceRuns = (runs, start, end) => {
  let offset = 0; const result = [];
  for (const item of runs) {
    const from = Math.max(start - offset, 0), to = Math.min(end - offset, item.text.length);
    if (to > from) result.push(run(item.text.slice(from, to), item.marks));
    offset += item.text.length;
  }
  return result;
};
function segments(content) {
  let offset = 0; const result = [];
  content.blocks.forEach((block, index) => {
    if (index) offset++;
    if (block.type === 'paragraph') { const length = runsText(block.runs).length; result.push({ block, runs: block.runs, start: offset, end: offset + length }); offset += length; }
    else if (block.type === 'table') block.rows.forEach((row, r) => { if (r) offset++; row.forEach((cell, c) => { if (c) offset++; const length = runsText(cell.runs).length; result.push({ block, cell, runs: cell.runs, start: offset, end: offset + length }); offset += length; }); });
    else { result.push({ block, start: offset, end: offset + 1 }); offset++; }
  });
  return result;
}
function checkRange(content, start, end) {
  assertContent(content); const text = textEditPlainText(content);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > text.length
    || !scalarText(text.slice(0, start)) || !scalarText(text.slice(end))) fail('invalid_range', 'The selection must use Unicode-safe UTF-16 offsets in the plain projection.');
}
export function replaceTextEditRange(content, start, end, text) {
  checkRange(content, start, end);
  if (!bounded(text, TEXTEDIT_CONTENT_LIMITS.text)) fail('invalid_arguments', 'Replacement must be bounded Unicode text.');
  text = text.replace(/\r\n?/g, '\n');
  const output = clone(content), entries = segments(output);
  const first = entries.find(entry => start >= entry.start && start <= entry.end), last = entries.find(entry => end >= entry.start && end <= entry.end);
  if (!first?.runs || !last?.runs) fail('unsupported_content', 'Attachment objects must be changed with attachment commands.');
  const before = sliceRuns(first.runs, 0, start - first.start), after = sliceRuns(last.runs, end - last.start, last.end - last.start);
  const marks = before.at(-1)?.marks ?? first.runs[0].marks;
  if (first.cell || last.cell) {
    if (first !== last) fail('unsupported_content', 'A text replacement cannot delete table boundaries; use row/cell commands.');
    first.cell.runs = mergeRuns([...before, run(text, marks), ...after]);
  } else {
    const from = output.blocks.indexOf(first.block), to = output.blocks.indexOf(last.block);
    if (output.blocks.slice(from, to + 1).some(block => block.type !== 'paragraph')) fail('unsupported_content', 'Replacement cannot cross tables or attachment objects.');
    const lines = text.split('\n'), used = new Set(output.blocks.map(block => block.id)); let next = 1;
    const id = () => { while (used.has(`paragraph-${next}`)) next++; const value = `paragraph-${next++}`; used.add(value); return value; };
    const inserted = lines.map((line, i) => ({ ...first.block, id: i ? id() : first.block.id, tabs: [...first.block.tabs], runs: mergeRuns([...(i ? [] : before), run(line, marks), ...(i === lines.length - 1 ? after : [])]) }));
    output.blocks.splice(from, to - from + 1, ...inserted);
  }
  assertContent(output); return output;
}
export function formatTextEditRange(content, start, end, patch) {
  checkRange(content, start, end);
  if (content.kind !== 'rich') fail('unsupported_content', 'Convert to rich text before formatting.');
  if (!patch || typeof patch !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(patch))) fail('invalid_arguments', 'Expected a formatting patch.');
  const descriptors = Object.getOwnPropertyDescriptors(patch), allowed = [...Object.keys(TEXTEDIT_MARK_DEFAULTS), 'align', 'spacing', 'indent', 'list', 'tabs', 'marks'];
  if (Reflect.ownKeys(descriptors).some(key => !allowed.includes(key) || !('value' in descriptors[key]))) fail('invalid_arguments', 'Unknown or accessor formatting property.');
  const markPatch = {};
  if (patch.marks !== undefined) {
    if (!patch.marks || typeof patch.marks !== 'object') fail('invalid_arguments', 'Invalid marks patch.');
    const fields = Object.getOwnPropertyDescriptors(patch.marks);
    if (Reflect.ownKeys(fields).some(key => !Object.keys(TEXTEDIT_MARK_DEFAULTS).includes(key) || !('value' in fields[key]))) fail('invalid_arguments', 'Unknown or accessor mark.');
    Object.assign(markPatch, patch.marks);
  }
  for (const key of Object.keys(TEXTEDIT_MARK_DEFAULTS)) if (key in descriptors) markPatch[key] = patch[key];
  if (!marksValid({ ...TEXTEDIT_MARK_DEFAULTS, ...markPatch })) fail('invalid_arguments', 'Invalid formatting marks.');
  if ('tabs' in descriptors && !array(patch.tabs)) fail('invalid_arguments', 'Expected descriptor-safe tab stops.');
  const output = clone(content);
  for (const entry of segments(output)) {
    const selected = start === end ? start >= entry.start && start <= entry.end : start < entry.end && end > entry.start;
    if (!selected || !entry.runs) continue;
    if (entry.block.type === 'paragraph') for (const key of ['align', 'spacing', 'indent', 'list', 'tabs']) if (key in descriptors) entry.block[key] = key === 'tabs' ? [...patch.tabs] : patch[key];
    if (start !== end) {
      const from = Math.max(0, start - entry.start), to = Math.min(entry.end - entry.start, end - entry.start);
      const changed = sliceRuns(entry.runs, from, to).map(item => run(item.text, { ...item.marks, ...markPatch }));
      const runs = mergeRuns([...sliceRuns(entry.runs, 0, from), ...changed, ...sliceRuns(entry.runs, to, entry.end - entry.start)]);
      if (entry.cell) entry.cell.runs = runs; else entry.block.runs = runs;
    }
  }
  assertContent(output); return output;
}

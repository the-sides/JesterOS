import { object, choice, flag } from './command-schema.js';
export const NOTES_STYLES = ['title', 'heading', 'subheading', 'body', 'monospaced'];
export const NOTES_MARKS = ['bold', 'italic', 'underline', 'strike'];
const text = { type: 'string', maxLength: 1048576 };
export const notesRunSchema = object({ text, marks: { type: 'array', items: choice(...NOTES_MARKS), maxItems: 4, uniqueItems: true }, font: { type: 'string', minLength: 1, maxLength: 1024 } }, ['text', 'marks']);
export const notesRunsSchema = { type: 'array', items: notesRunSchema, minItems: 1, maxItems: 4096 };
export const notesParagraphSchema = object({ id: { type: 'string', minLength: 1, maxLength: 128 }, type: { const: 'paragraph' }, style: choice(...NOTES_STYLES), list: choice('none', 'bullet', 'number', 'check'), indent: { type: 'integer', minimum: 0, maximum: 8 }, checked: flag, runs: notesRunsSchema });
export const notesTableSchema = object({ id: { type: 'string', minLength: 1, maxLength: 128 }, type: { const: 'table' }, rows: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'array', minItems: 1, maxItems: 16, items: notesRunsSchema } } });
export const notesDocumentSchema = object({ blocks: { type: 'array', minItems: 1, maxItems: 2048, items: { oneOf: [notesParagraphSchema, notesTableSchema] } } });
export const notesSelectionSchema = object({ blockId: { type: 'string', minLength: 1, maxLength: 128 }, row: { type: 'integer', minimum: -1, maximum: 63 }, column: { type: 'integer', minimum: -1, maximum: 15 }, start: { type: 'integer', minimum: 0, maximum: 1048576 }, end: { type: 'integer', minimum: 0, maximum: 1048576 }, direction: choice('forward', 'backward', 'none') });
export const runsText = runs => runs.map(run => run.text).join('');
export function paragraph(id, text = '', style = 'body') { return { id, type: 'paragraph', style, list: 'none', indent: 0, checked: false, runs: [{ text, marks: [] }] }; }
export function documentFromText(text, prefix = 'block') { return { blocks: text.replace(/\r\n?/g, '\n').split('\n').map((line, index) => paragraph(`${prefix}-${index + 1}`, line, index ? 'body' : 'title')) }; }
export const documentText = document => document.blocks.map(block => block.type === 'table' ? block.rows.map(row => row.map(runsText).join('\t')).join('\n') : runsText(block.runs)).join('\n');
export function selectionRuns(document, selection) {
  const block = document.blocks.find(row => row.id === selection?.blockId);
  if (!block) return null;
  if (block.type === 'paragraph') return selection.row === -1 && selection.column === -1 ? block.runs : null;
  return block.rows[selection.row]?.[selection.column] ?? null;
}
export function validDocumentSelection(document, selection) {
  const runs = selectionRuns(document, selection);
  return !!runs && selection.start <= selection.end && selection.end <= runsText(runs).length;
}
export function firstDocumentSelection(document) {
  const block = document.blocks[0]; return { blockId: block.id, row: block.type === 'table' ? 0 : -1, column: block.type === 'table' ? 0 : -1, start: 0, end: 0, direction: 'none' };
}
export function normalizeRuns(runs) {
  const result = [];
  for (const run of runs) {
    const marks = NOTES_MARKS.filter(mark => run.marks.includes(mark)), last = result.at(-1);
    if (!run.text) continue;
    if (last && last.marks.join() === marks.join() && last.font === run.font) last.text += run.text;
    else result.push({ text: run.text, marks, ...(run.font ? { font: run.font } : {}) });
  }
  return result.length ? result : [{ text: '', marks: [...(runs[0]?.marks ?? [])], ...(runs[0]?.font ? { font: runs[0].font } : {}) }];
}
function sliceRuns(runs, start, end) {
  let offset = 0; const result = [];
  for (const run of runs) { const a = Math.max(0, start - offset), b = Math.min(run.text.length, end - offset); if (a < b) result.push({ ...run, text: run.text.slice(a, b), marks: [...run.marks] }); offset += run.text.length; }
  return result;
}
export function replaceSelection(document, selection, text) {
  const runs = selectionRuns(document, selection); if (!runs || !validDocumentSelection(document, selection)) return null;
  const block = document.blocks.find(row => row.id === selection.blockId);
  const markOffset = selection.end > selection.start || selection.start === 0 ? selection.start : selection.start - 1;
  const sample = sliceRuns(runs, markOffset, markOffset + 1)[0] ?? runs[0], marks = sample?.marks ?? [], font = sample?.font;
  const before = sliceRuns(runs, 0, selection.start), after = sliceRuns(runs, selection.end, runsText(runs).length);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && block.type === 'paragraph') {
    const used = new Set(document.blocks.map(row => row.id)); let serial = 1;
    const freshId = () => { while (used.has(`block-${serial}`)) serial++; const id = `block-${serial++}`; used.add(id); return id; };
    const inserted = lines.map((line, index) => ({ ...paragraph(index ? freshId() : block.id, '', index ? 'body' : block.style), list: block.list, indent: block.indent, runs: normalizeRuns([...(index ? [] : before), { text: line, marks, ...(font ? { font } : {}) }, ...(index === lines.length - 1 ? after : [])]) }));
    document.blocks.splice(document.blocks.indexOf(block), 1, ...inserted);
    return { ...selection, blockId: inserted.at(-1).id, start: lines.at(-1).length, end: lines.at(-1).length, direction: 'none' };
  }
  const next = normalizeRuns([...before, { text, marks, ...(font ? { font } : {}) }, ...after]);
  if (block.type === 'paragraph') block.runs = next; else block.rows[selection.row][selection.column] = next;
  return { ...selection, start: selection.start + text.length, end: selection.start + text.length, direction: 'none' };
}
export function markSelection(document, selection, mark) {
  if (!NOTES_MARKS.includes(mark) || !validDocumentSelection(document, selection) || selection.start === selection.end) return false;
  const block = document.blocks.find(row => row.id === selection.blockId), runs = selectionRuns(document, selection), middle = sliceRuns(runs, selection.start, selection.end), remove = middle.every(run => run.marks.includes(mark));
  const next = normalizeRuns([...sliceRuns(runs, 0, selection.start), ...middle.map(run => ({ ...run, marks: remove ? run.marks.filter(value => value !== mark) : [...new Set([...run.marks, mark])] })), ...sliceRuns(runs, selection.end, runsText(runs).length)]);
  if (block.type === 'paragraph') block.runs = next; else block.rows[selection.row][selection.column] = next;
  return true;
}
export function fontSelection(document, selection, font) {
  if (!validDocumentSelection(document, selection)) return false;
  const block = document.blocks.find(row => row.id === selection.blockId), runs = selectionRuns(document, selection);
  const start = selection.start === selection.end ? 0 : selection.start, end = selection.start === selection.end ? runsText(runs).length : selection.end;
  const middle = sliceRuns(runs, start, end).map(run => ({ ...run, font }));
  const next = normalizeRuns([...sliceRuns(runs, 0, start), ...(middle.length ? middle : [{ text: '', marks: runs[0]?.marks ?? [], font }]), ...sliceRuns(runs, end, runsText(runs).length)]);
  if (block.type === 'paragraph') block.runs = next; else block.rows[selection.row][selection.column] = next;
  return true;
}
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function runsHTML(runs) { return runs.map(run => { let html = escape(run.text); for (const mark of run.marks) { const tag = { bold: 'strong', italic: 'em', underline: 'u', strike: 's' }[mark]; html = `<${tag}>${html}</${tag}>`; } return run.font ? `<span style="font-family:${escape(JSON.stringify(run.font))}">${html}</span>` : html; }).join(''); }
export function documentHTML(document) {
  return document.blocks.map(block => block.type === 'table' ? `<table>${block.rows.map(row => `<tr>${row.map(cell => `<td>${runsHTML(cell)}</td>`).join('')}</tr>`).join('')}</table>` : `<${block.style === 'title' ? 'h1' : block.style === 'heading' ? 'h2' : block.style === 'subheading' ? 'h3' : 'p'} style="margin-left:${block.indent * 24}px;${block.style === 'monospaced' ? 'font-family:monospace;' : ''}">${block.list === 'check' ? (block.checked ? '☑ ' : '☐ ') : block.list === 'bullet' ? '• ' : block.list === 'number' ? '1. ' : ''}${runsHTML(block.runs)}</${block.style === 'title' ? 'h1' : block.style === 'heading' ? 'h2' : block.style === 'subheading' ? 'h3' : 'p'}>`).join('\n');
}

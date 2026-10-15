import { object, choice, flag, empty, defineCommand } from './command-schema.js';
import { copyCanonicalData, canonicalStringUnits } from './canonical-data.js';
import { previewSchemaValid } from './preview-state.js';

export const PAGES_PROFILES = Object.freeze(['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428']);
export const PAGES_DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const PAGES_LIMITS = Object.freeze({ documents: 32, windows: 32, blocks: 256, runs: 256, history: 40, units: 2 * 1024 * 1024 });
export const pagesIdSchema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
const str = maxLength => ({ type: 'string', maxLength }), num = (minimum, maximum) => ({ type: 'number', minimum, maximum }), int = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] }), array = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
export const pagesRunSchema = object({ text: str(65536), font: str(1024), size: num(6, 144), color, bold: flag, italic: flag, underline: flag });
export const pagesStyleSchema = object({ font: str(1024), size: num(6, 144), color, bold: flag, italic: flag, underline: flag }, []);
export const pagesPageSchema = object({ width: num(144, 1440), height: num(144, 1440), margin: { anyOf: [num(0, 360), object({ top: num(0, 360), right: num(0, 360), bottom: num(0, 360), left: num(0, 360) })] } });
export const pagesBlockSchema = { anyOf: [
  object({ id: pagesIdSchema, type: { const: 'paragraph' }, align: choice('left', 'center', 'right', 'justify'), style: choice('Body', 'Title', 'Subtitle', 'Heading', 'Caption'), runs: array(pagesRunSchema, 256, 1), pageBreakBefore: flag }, ['id', 'type', 'align', 'style', 'runs']),
  object({ id: pagesIdSchema, type: { const: 'table' }, rows: array(array(object({ text: str(4096) }), 12, 1), 100, 1) }),
  object({ id: pagesIdSchema, type: { const: 'image' }, content: { type: 'string', maxLength: 1048576, pattern: '^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$' }, width: num(1, 1200), height: num(1, 1200), alt: str(256) }),
  object({ id: pagesIdSchema, type: { const: 'chart' }, kind: choice('bar', 'line', 'pie'), title: str(256), labels: array(str(128), 64, 1), values: array(num(-1000000000, 1000000000), 64, 1) }),
] };
export const pagesContentSchema = object({ title: str(128), page: pagesPageSchema, blocks: array(pagesBlockSchema, PAGES_LIMITS.blocks, 1) });
const revision = int(0, Number.MAX_SAFE_INTEGER - 1);
export const pagesDocumentSchema = object({ id: pagesIdSchema, content: pagesContentSchema, fileId: nullable(pagesIdSchema), fileRevision: nullable({ anyOf: [revision, { type: 'string', minLength: 1, maxLength: 256 }] }), savedSignature: nullable(str(1048576)), revision, undo: array(pagesContentSchema, PAGES_LIMITS.history), redo: array(pagesContentSchema, PAGES_LIMITS.history) });
export const pagesSelectionSchema = object({ blockId: nullable(pagesIdSchema), start: int(0, 65536), end: int(0, 65536), endBlockId: pagesIdSchema }, ['blockId', 'start', 'end']);
export const PAGES_TOOLBAR_ITEMS = Object.freeze([{ id: 'view', label: 'View', icon: '▤⌄' }, { id: 'zoom', label: 'Zoom', icon: '125%' }, { id: 'page', label: 'Add Page', icon: '+' }, { id: 'insert', label: 'Insert', icon: '¶⌄' }, { id: 'table', label: 'Table', icon: '▦' }, { id: 'chart', label: 'Chart', icon: '▥' }, { id: 'text', label: 'Text', icon: 'Τ' }, { id: 'media', label: 'Media', icon: '▧' }, { id: 'share', label: 'Share', icon: '⇧' }, { id: 'inspector', label: 'Format and Document', icon: '◩ ▤' }]);
export const pagesToolbarSchema = object({ visible: flag, iconsOnly: flag, items: array(choice(...PAGES_TOOLBAR_ITEMS.map(row => row.id)), PAGES_TOOLBAR_ITEMS.length) });
export function pagesDefaultToolbar(profile) { const id = typeof profile === 'string' ? profile : profile.id, classic = /high-sierra|mojave/.test(id), golden = id.includes('golden-gate'); return { visible: true, iconsOnly: golden, items: ['view', ...(golden ? [] : ['zoom']), ...(id.includes('high-sierra') ? [] : ['page']), 'insert', 'table', 'chart', 'text', 'media', ...(classic ? [] : ['share']), 'inspector'] }; }
export const pagesWindowSchema = object({ windowId: pagesIdSchema, appId: choice('pages', 'pages-local'), documentId: nullable(pagesIdSchema), mode: choice('templates', 'browser', 'editor'), inspector: choice('none', 'format', 'document'), menu: nullable(choice('pages', 'file', 'edit', 'insert', 'format', 'arrange', 'view', 'share', 'window', 'help')), popup: nullable(choice('table', 'chart', 'insert', 'view')), dialog: nullable(choice('save', 'export', 'close', 'chart', 'help', 'toolbar')), toolbar: pagesToolbarSchema, closing: flag, selection: pagesSelectionSchema, selectedId: nullable(pagesIdSchema), pageAnchor: nullable(pagesIdSchema), template: str(64), category: choice('All Templates', 'Basic', 'Reports', 'Letters', 'Resumes', 'Posters'), browserQuery: str(256), zoom: num(.25, 4), thumbnails: flag, status: str(512), revision });
export const pagesStateSchema = object({ version: { const: 1 }, profileId: choice(...PAGES_PROFILES), nextId: int(1, Number.MAX_SAFE_INTEGER - 1), documents: array(pagesDocumentSchema, 32), windows: array(pagesWindowSchema, 32) });
export const pagesSchemaValid = previewSchemaValid;
export const pagesWindow = (state, id) => state.windows.find(row => row.windowId === id) ?? null;
export const pagesDocument = (state, id) => state.documents.find(row => row.id === id) ?? null;
export const pagesDirty = document => !!document && JSON.stringify(document.content) !== document.savedSignature;
export const pagesText = block => block.runs.map(run => run.text).join('');
export const pagesDefaultRun = text => ({ text, font: 'Helvetica Neue', size: 11, color: '#222222', bold: false, italic: false, underline: false });
export const PAGES_TEMPLATES = Object.freeze([
  { id: 'blank', name: 'Blank', category: 'Basic', title: 'Untitled', paragraphs: [['Body', '']] },
  { id: 'landscape', name: 'Blank Landscape', category: 'Basic', title: 'Untitled', landscape: true, paragraphs: [['Body', '']] },
  { id: 'report', name: 'Modern Report', category: 'Reports', title: 'Project Report', paragraphs: [['Title', 'Project Report'], ['Subtitle', 'A clear view of the work ahead'], ['Heading', 'Overview'], ['Body', 'Replace this text with your introduction. Describe the purpose of your report and the key findings.'], ['Heading', 'Results'], ['Body', 'Use tables, charts, and images to support your story.']] },
  { id: 'letter', name: 'Classic Letter', category: 'Letters', title: 'Letter', paragraphs: [['Heading', 'YOUR NAME'], ['Body', 'Month Day, Year\nRecipient name\nRecipient address'], ['Body', 'Dear recipient,'], ['Body', 'Write your message here.'], ['Body', 'Sincerely,\nYour name']] },
  { id: 'resume', name: 'Contemporary Resume', category: 'Resumes', title: 'Resume', paragraphs: [['Title', 'YOUR NAME'], ['Subtitle', 'Your profession · email@example.com'], ['Heading', 'Experience'], ['Body', 'Position · Organization\nDescribe your responsibilities and accomplishments.'], ['Heading', 'Education'], ['Body', 'Qualification · Institution']] },
  { id: 'poster', name: 'Event Poster', category: 'Posters', title: 'Event', paragraphs: [['Title', 'MAKE SOMETHING GREAT'], ['Subtitle', 'An evening of ideas and inspiration'], ['Heading', 'FRIDAY · 7 PM'], ['Body', 'Your venue\nYour address\nEveryone is welcome.']] },
]);
export function createPagesState(profile) { return { version: 1, profileId: typeof profile === 'string' ? profile : profile.id, nextId: 1, documents: [], windows: [] }; }
export function pagesCapabilities(profile) {
  const id = typeof profile === 'string' ? profile : profile.id;
  return { windows: id.startsWith('windows11'), classic: /high-sierra|mojave/.test(id), golden: id.includes('golden-gate'), appId: id.startsWith('windows11') ? 'pages-local' : 'pages', label: id.startsWith('windows11') ? 'Pages Local Equivalent' : 'Pages', era: id.includes('high-sierra') ? 'Pages 6.3-era' : id.includes('mojave') ? 'Pages 7.2-era' : id.includes('sonoma') ? 'Pages 13.2-era' : id.includes('golden-gate') ? 'Nearest macOS 26 visual proxy; macOS 27 pixels not certified' : 'Local document editor, not Apple Pages for Windows' };
}
export function pagesWindowMetadata(profile) { const cap = pagesCapabilities(profile); return { appId: cap.appId, title: cap.label, component: 'PagesApp.svelte', utilityKind: 'pages', width: 1040, height: 740, minWidth: 700, minHeight: 460 }; }
export function pagesNewWindow(windowId, profile, options = {}) {
  return { windowId, appId: pagesCapabilities(profile).appId, documentId: options.documentId ?? null, mode: options.documentId ? 'editor' : 'templates', inspector: 'format', menu: null, popup: null, dialog: null, toolbar: pagesDefaultToolbar(profile), closing: false, selection: { blockId: null, start: 0, end: 0 }, selectedId: null, pageAnchor: null, template: options.template ?? 'blank', category: 'All Templates', browserQuery: '', zoom: .85, thumbnails: false, status: '', revision: 0 };
}
export function pagesAllocate(state, prefix) { if (state.nextId >= Number.MAX_SAFE_INTEGER - 1) throw Object.assign(new Error('Document identities exhausted.'), { code: 'limit_exceeded' }); return `${prefix}-${state.nextId++}`; }
export function pagesCreateDocument(state, templateId = 'blank') {
  const template = PAGES_TEMPLATES.find(row => row.id === templateId);
  if (!template) throw new Error('Unknown template.');
  const blocks = template.paragraphs.map(([style, text]) => ({ id: pagesAllocate(state, 'pages-block'), type: 'paragraph', align: templateId === 'poster' ? 'center' : 'left', style, runs: [{ ...pagesDefaultRun(text), ...pagesPreset(style) }] }));
  return { id: pagesAllocate(state, 'pages-document'), content: { title: template.title, page: { width: template.landscape ? 792 : 612, height: template.landscape ? 612 : 792, margin: 54 }, blocks }, fileId: null, fileRevision: null, savedSignature: null, revision: 0, undo: [], redo: [] };
}
export function pagesPreset(style) { return { Body: { size: 11, bold: false, color: '#222222' }, Title: { size: 34, bold: true, color: '#222222' }, Subtitle: { size: 17, bold: false, color: '#777777' }, Heading: { size: 18, bold: true, color: '#222222' }, Caption: { size: 9, bold: false, italic: true, color: '#666666' } }[style]; }
export function pagesMargins(page) { return typeof page.margin === 'number' ? { top: page.margin, right: page.margin, bottom: page.margin, left: page.margin } : page.margin; }
function validContent(content) {
  if (!previewSchemaValid(content, pagesContentSchema)) return false;
  const margins = pagesMargins(content.page);
  if (margins.left + margins.right >= content.page.width || margins.top + margins.bottom >= content.page.height) return false;
  if (new Set(content.blocks.map(block => block.id)).size !== content.blocks.length) return false;
  return content.blocks.every(block => block.type === 'paragraph' ? pagesText(block).length <= 65536 && block.runs.every(run => run.font.trim() && Number.isInteger(run.size * 2)) : block.type === 'table' ? block.rows.every(row => row.length === block.rows[0].length) : block.type === 'chart' ? block.labels.length === block.values.length && (block.kind !== 'pie' || block.values.every(value => value >= 0) && block.values.some(value => value > 0)) : true);
}
export function validatePagesState(state, profile) {
  const bad = message => ({ ok: false, message });
  if (!previewSchemaValid(state, pagesStateSchema) || profile && state.profileId !== (typeof profile === 'string' ? profile : profile.id)) return bad('Invalid closed Pages state or profile.');
  if (canonicalStringUnits(state) > PAGES_LIMITS.units) return bad('Pages document/history retention limit exceeded.');
  if (new Set(state.documents.map(doc => doc.id)).size !== state.documents.length || new Set(state.windows.map(win => win.windowId)).size !== state.windows.length) return bad('Duplicate Pages identity.');
  for (const doc of state.documents) if (!validContent(doc.content) || [...doc.undo, ...doc.redo].some(content => !validContent(content)) || (doc.fileId === null) !== (doc.fileRevision === null)) return bad('Invalid rich document, history, page margins, table, chart or original file revision.');
  for (const win of state.windows) {
    const doc = win.documentId && pagesDocument(state, win.documentId);
    if (new Set(win.toolbar.items).size !== win.toolbar.items.length) return bad('Toolbar items must retain a single canonical order without duplicates.');
    if (win.appId !== pagesCapabilities(state.profileId).appId || win.documentId && !doc || win.mode === 'editor' && !doc || win.selectedId && !doc?.content.blocks.some(row => row.id === win.selectedId) || !PAGES_TEMPLATES.some(row => row.id === win.template)) return bad('Dangling Pages window, document or template.');
    if (win.pageAnchor && !doc?.content.blocks.some(row => row.id === win.pageAnchor)) return bad('Dangling original page anchor.');
    if (win.selection.blockId) { try { pagesRange(doc.content, win.selection); } catch { return bad('Dangling original text range.'); } }
    else if (win.selection.start || win.selection.end || win.selection.endBlockId) return bad('A detached selection must be empty.');
  }
  return { ok: true };
}
export function pagesNormalizeRuns(runs) {
  const result = [];
  for (const run of runs) { if (!run.text) continue; const last = result.at(-1); if (last && Object.keys(pagesDefaultRun('')).every(key => key === 'text' || last[key] === run[key])) last.text += run.text; else result.push(copyCanonicalData(run)); }
  return result.length ? result : [{ ...(runs[0] ?? pagesDefaultRun('')), text: '' }];
}
export function pagesReplaceText(block, start, end, text, marks = null) {
  const length = pagesText(block).length;
  if (start < 0 || end < start || end > length) throw Object.assign(new Error('The original text range is unavailable.'), { code: 'stale_target' });
  const before = [], after = []; let offset = 0, typing = block.runs[0];
  for (const run of block.runs) { const next = offset + run.text.length; if (offset <= start && start <= next) typing = run; if (offset < start) before.push({ ...run, text: run.text.slice(0, Math.min(run.text.length, start - offset)) }); if (next > end) after.push({ ...run, text: run.text.slice(Math.max(0, end - offset)) }); offset = next; }
  block.runs = pagesNormalizeRuns([...before, { ...typing, ...marks, text }, ...after]);
}
export function pagesFormatText(block, start, end, style) {
  if (start < 0 || start > end || end > pagesText(block).length) throw Object.assign(new Error('The original formatting range is unavailable.'), { code: 'stale_target' });
  if (start === end) { block.runs = block.runs.map(run => ({ ...run, ...style })); return; }
  const result = []; let offset = 0;
  for (const run of block.runs) { const a = Math.max(0, start - offset), b = Math.min(run.text.length, end - offset); if (b > a) { if (a) result.push({ ...run, text: run.text.slice(0, a) }); result.push({ ...run, ...style, text: run.text.slice(a, b) }); if (b < run.text.length) result.push({ ...run, text: run.text.slice(b) }); } else result.push(run); offset += run.text.length; }
  block.runs = pagesNormalizeRuns(result);
}
export function pagesRange(content, selection) {
  const first = content.blocks.findIndex(row => row.id === selection.blockId), last = content.blocks.findIndex(row => row.id === (selection.endBlockId ?? selection.blockId));
  if (first < 0 || last < first || content.blocks[first].type !== 'paragraph' || content.blocks[last].type !== 'paragraph' || selection.start > pagesText(content.blocks[first]).length || selection.end > pagesText(content.blocks[last]).length || first === last && selection.start > selection.end) throw Object.assign(new Error('The original text range is unavailable.'), { code: 'stale_target' });
  return { first, last, leading: content.blocks[first], trailing: content.blocks[last] };
}
export function pagesReplaceRange(content, selection, text) {
  const { first, last, leading, trailing } = pagesRange(content, selection);
  if (first === last) { pagesReplaceText(leading, selection.start, selection.end, text); return; }
  const after = copyCanonicalData(trailing); pagesReplaceText(after, 0, selection.end, '');
  pagesReplaceText(leading, selection.start, pagesText(leading).length, text);
  leading.runs = pagesNormalizeRuns([...leading.runs, ...after.runs]);
  content.blocks.splice(first + 1, last - first);
}
export function pagesFormatRange(content, selection, style) {
  const { first, last } = pagesRange(content, selection);
  for (let index = first; index <= last; index++) { const row = content.blocks[index]; if (row.type === 'paragraph') { const start = index === first ? selection.start : 0, end = index === last ? selection.end : pagesText(row).length; if (first === last || end > start) pagesFormatText(row, start, end, style); } }
}
export function pagesSelectedText(content, selection) {
  const { first, last } = pagesRange(content, selection);
  return content.blocks.slice(first, last + 1).map((row, index) => row.type === 'paragraph' ? pagesText(row).slice(index === 0 ? selection.start : 0, first + index === last ? selection.end : undefined) : row.type === 'table' ? row.rows.map(cells => cells.map(cell => cell.text).join('\t')).join('\n') : row.type === 'chart' ? row.title : row.alt).join('\n');
}

export function pagesHistory(document, change) {
  const before = copyCanonicalData(document.content); change(document.content);
  if (JSON.stringify(before) !== JSON.stringify(document.content)) { document.undo.push(before); if (document.undo.length > PAGES_LIMITS.history) document.undo.shift(); document.redo.splice(0); document.revision++; }
}

export const pagesTargetSchema = object({ windowId: pagesIdSchema });
const range = { blockId: pagesIdSchema, start: int(0, 65536), end: int(0, 65536), endBlockId: pagesIdSchema };
export const pagesCommandSpecs = {
  'window.new': [object({ documentId: pagesIdSchema }, []), 'Open another genuine document window or template chooser.'],
  'window.close': [object({ discard: flag }, []), 'Close after explicit dirty-document confirmation.'],
  create: [object({ template: choice(...PAGES_TEMPLATES.map(row => row.id)) }), 'Create an editable rich document from the selected template.'],
  'document.switch': [object({ documentId: pagesIdSchema }), 'Select a retained canonical document without losing another document.'],
  'document.rename': [object({ title: str(128) }), 'Rename the actual document.'],
  browser: [object({ query: str(256) }, []), 'Show the real virtual Files document browser.'],
  templates: [object({ template: choice(...PAGES_TEMPLATES.map(row => row.id)), category: choice('All Templates', 'Basic', 'Reports', 'Letters', 'Resumes', 'Posters') }, []), 'Choose a real editable template.'],
  open: [object({ fileId: pagesIdSchema }, []), 'Decode actual DOCX bytes; proprietary .pages files are explicitly unsupported.'],
  save: [object({ name: str(128), saveAs: flag }, []), 'Atomically save genuine DOCX bytes and actual planned file revision.'],
  export: [object({ format: choice('docx', 'pdf'), name: str(128) }, ['format']), 'Export a genuine DOCX or paginated PDF.'],
  print: [empty, 'Open Root print destination with genuine PDF bytes.'],
  share: [object({ format: choice('docx', 'pdf') }, []), 'Open Root share destination; never claim external delivery.'],
  selection: [pagesSelectionSchema, 'Retain the actual text range without dirtying the document.'],
  'text.replace': [object({ ...range, text: str(65536) }, ['blockId', 'start', 'end', 'text']), 'Replace an actual single- or multi-paragraph range, retaining rich runs.'],
  'text.split': [object(range, ['blockId', 'start', 'end']), 'Split the paragraph at the actual insertion point.'],
  'text.merge': [object({ blockId: pagesIdSchema }), 'Merge with the preceding paragraph.'],
  'text.format': [object({ ...range, style: pagesStyleSchema }, ['blockId', 'start', 'end', 'style']), 'Format actual single- or multi-paragraph rich runs, or the paragraph when selection is collapsed.'],
  'paragraph.style': [object({ blockId: pagesIdSchema, style: choice('Body', 'Title', 'Subtitle', 'Heading', 'Caption') }), 'Apply a native paragraph style.'],
  'paragraph.align': [object({ blockId: pagesIdSchema, align: choice('left', 'center', 'right', 'justify') }), 'Change real paragraph alignment.'],
  'paragraph.add': [empty, 'Insert an editable paragraph after the selected object.'],
  'page.add': [empty, 'Insert a genuine blank page using a persisted paragraph page break.'],
  'page.select': [object({ blockId: pagesIdSchema, focus: flag }, ['blockId']), 'Select the original clicked page anchor, optionally focusing its real mounted page surface.'],
  toolbar: [object(pagesToolbarSchema.properties, []), 'Show, hide, configure or reorder actual native toolbar controls; Format and Document remain one item.'],
  'object.select': [object({ blockId: pagesIdSchema }), 'Select a genuine document object.'],
  'object.delete': [object({ blockId: pagesIdSchema }), 'Delete an actual document object with undo.'],
  'object.move': [object({ blockId: pagesIdSchema, direction: choice('up', 'down') }), 'Reorder actual inline document objects.'],
  'table.insert': [object({ rows: int(1, 100), columns: int(1, 12) }, []), 'Insert a genuine editable table.'],
  'table.cell': [object({ blockId: pagesIdSchema, row: int(0, 99), column: int(0, 11), text: str(4096) }), 'Edit the actual retained table cell.'],
  'table.resize': [object({ blockId: pagesIdSchema, rows: int(1, 100), columns: int(1, 12) }), 'Resize a genuine retained table.'],
  'image.insert': [object({ fileId: pagesIdSchema }, []), 'Embed real PNG/JPEG bytes from the virtual Files browser.'],
  'image.size': [object({ blockId: pagesIdSchema, width: num(1, 1200), height: num(1, 1200), alt: str(256) }, ['blockId']), 'Resize an actual embedded image and edit its accessibility description.'],
  'chart.insert': [object({ kind: choice('bar', 'line', 'pie') }, []), 'Insert a genuine data-backed chart.'],
  'chart.edit': [object({ blockId: pagesIdSchema, kind: choice('bar', 'line', 'pie'), title: str(256), labels: array(str(128), 64, 1), values: array(num(-1000000000, 1000000000), 64, 1) }), 'Edit actual chart series; DOCX embeds DrawingML and PDF renders the plotted data.'],
  page: [pagesPageSchema, 'Change real paper dimensions and margins.'],
  undo: [empty, 'Restore canonical rich content from its actual undo history.'], redo: [empty, 'Restore canonical rich content from its actual redo history.'],
  copy: [empty, 'Copy the actual text range through Root clipboard.'], cut: [empty, 'Cut actual text through Root clipboard.'], paste: [empty, 'Paste Root clipboard text or actual embedded image bytes.'],
  inspector: [object({ panel: choice('none', 'format', 'document') }), 'Show native contextual Format or Document sidebar.'],
  view: [object({ zoom: num(.25, 4), thumbnails: flag }, []), 'Change page zoom or the native page thumbnails sidebar.'],
  menu: [object({ menu: pagesWindowSchema.properties.menu }), 'Show an actual application menu.'], popup: [object({ popup: pagesWindowSchema.properties.popup }), 'Show an actual toolbar popover.'], dialog: [object({ dialog: pagesWindowSchema.properties.dialog }), 'Show a native local document sheet.'],
  focus: [object({ controlId: str(128) }), 'Focus only an original mounted enabled native control.'],
  scroll: [object({ top: num(0, 1000000), left: num(0, 1000000) }, ['top']), 'Scroll the original mounted document canvas.'],
};
export const pagesCatalog = Object.fromEntries(Object.entries(pagesCommandSpecs).map(([suffix, [payload, description]]) => defineCommand(PAGES_PROFILES, `pages.${suffix}`, 'pages.documents', pagesTargetSchema, payload, ['One canonical Pages actor and original Root window/File/native editor identities.', 'Genuine DOCX/PDF interchange; no proprietary Pages IWA codec or remote collaboration.'], [description], ['pages'], [], pagesTargetSchema)));
export function pagesMenus({ state, profile, windowId }) {
  const win = pagesWindow(state, windowId), doc = win && pagesDocument(state, win.documentId), cap = pagesCapabilities(profile), target = { windowId }, has = !!doc && win?.mode === 'editor';
  const leaf = (id, label, suffix, payload = {}, enabled = true, extra = {}) => ({ id, label, enabled: !!win && enabled, ...extra, ...(win && enabled ? { request: { command: `pages.${suffix}`, target, payload } } : {}) });
  const shortcut = key => cap.windows ? `Ctrl+${key}` : `⌘${key}`;
  const paragraph = doc?.content.blocks.find(row => row.id === win?.selection.blockId && row.type === 'paragraph');
  const textRange = { ...win?.selection, blockId: paragraph?.id ?? 'none' };
  return [
    { id: 'pages', label: cap.label, children: [{ id: 'about', label: `About ${cap.label}`, enabled: !!win, ...(win ? { request: { command: 'app.about.open', target: { appId: cap.appId }, payload: {} } } : {}) }, { id: 'quit', label: `Quit ${cap.label}`, enabled: !!win, ...(win ? { request: { command: 'app.quit', target: { appId: cap.appId }, payload: {} } } : {}) }] },
    { id: 'file', label: 'File', children: [leaf('new', 'New…', 'window.new', {}, true, { shortcut: shortcut('N') }), leaf('open', 'Open…', 'open', {}, true, { shortcut: shortcut('O') }), leaf('browse', 'Open Recent Documents…', 'browser'), leaf('save', 'Save…', 'save', {}, has, { shortcut: shortcut('S') }), leaf('save-as', 'Save As…', 'save', { saveAs: true }, has), leaf('export-docx', 'Export To Word…', 'dialog', { dialog: 'export' }, has), leaf('export-pdf', 'Export To PDF…', 'export', { format: 'pdf' }, has), leaf('share', 'Send a Copy…', 'share', {}, has), leaf('print', 'Print…', 'print', {}, has, { shortcut: shortcut('P') }), leaf('close', 'Close', 'window.close', {}, true, { shortcut: shortcut('W') })] },
    { id: 'edit', label: 'Edit', children: [leaf('undo', 'Undo', 'undo', {}, !!doc?.undo.length, { shortcut: shortcut('Z') }), leaf('redo', 'Redo', 'redo', {}, !!doc?.redo.length, { shortcut: cap.windows ? 'Ctrl+Y' : '⇧⌘Z' }), leaf('cut', 'Cut', 'cut', {}, has, { shortcut: shortcut('X') }), leaf('copy', 'Copy', 'copy', {}, has, { shortcut: shortcut('C') }), leaf('paste', 'Paste', 'paste', {}, has, { shortcut: shortcut('V') })] },
    { id: 'insert', label: 'Insert', children: [leaf('page-add', 'Page Break', 'page.add', {}, has), leaf('text', 'Text', 'paragraph.add', {}, has), leaf('table', 'Table', 'popup', { popup: 'table' }, has), leaf('chart', 'Chart', 'popup', { popup: 'chart' }, has), leaf('image', 'Choose Image…', 'image.insert', {}, has)] },
    { id: 'format', label: 'Format', children: [leaf('format-sidebar', 'Show Format', 'inspector', { panel: 'format' }, has, { checked: win?.inspector === 'format' }), ...[['bold', 'Bold', 'B'], ['italic', 'Italic', 'I'], ['underline', 'Underline', 'U']].map(([property, label, key]) => leaf(`font-${property}`, label, 'text.format', { ...textRange, style: { [property]: !paragraph?.runs[0]?.[property] } }, !!paragraph, { checked: !!paragraph?.runs[0]?.[property], shortcut: shortcut(key) })), ...['left', 'center', 'right', 'justify'].map(align => leaf(`align-${align}`, `Align ${align}`, 'paragraph.align', { blockId: paragraph?.id ?? 'none', align }, !!paragraph, { checked: paragraph?.align === align }))] },
    { id: 'arrange', label: 'Arrange', children: [leaf('move-up', 'Move Object Earlier', 'object.move', { blockId: win?.selectedId ?? 'none', direction: 'up' }, !!win?.selectedId), leaf('move-down', 'Move Object Later', 'object.move', { blockId: win?.selectedId ?? 'none', direction: 'down' }, !!win?.selectedId), leaf('delete-object', 'Delete Object', 'object.delete', { blockId: win?.selectedId ?? 'none' }, !!win?.selectedId), leaf('document-sidebar', 'Document Layout', 'inspector', { panel: 'document' }, has)] },
    { id: 'view', label: 'View', children: [leaf('toolbar-visible', win?.toolbar.visible ? 'Hide Toolbar' : 'Show Toolbar', 'toolbar', { visible: !win?.toolbar.visible }, has), leaf('toolbar-customize', 'Customize Toolbar…', 'dialog', { dialog: 'toolbar' }, has), leaf('thumbnails', 'Page Thumbnails', 'view', { thumbnails: !win?.thumbnails }, has, { checked: !!win?.thumbnails }), leaf('zoom-in', 'Zoom In', 'view', { zoom: Math.min(4, (win?.zoom ?? 1) * 1.2) }, has), leaf('zoom-out', 'Zoom Out', 'view', { zoom: Math.max(.25, (win?.zoom ?? 1) / 1.2) }, has), leaf('actual-size', 'Actual Size', 'view', { zoom: 1 }, has)] },
    ...(cap.classic ? [{ id: 'share', label: 'Share', children: [leaf('send-word', 'Send a Copy — Word…', 'share', { format: 'docx' }, has), leaf('send-pdf', 'Send a Copy — PDF…', 'share', { format: 'pdf' }, has)] }] : []),
    { id: 'window', label: 'Window', children: state.documents.map(row => leaf(row.id, `${row.content.title}${pagesDirty(row) ? ' — Edited' : ''}`, 'document.switch', { documentId: row.id }, true, { checked: row.id === doc?.id })) },
    { id: 'help', label: 'Help', children: [leaf('pages-help', `${cap.label} Help`, 'dialog', { dialog: 'help' })] },
  ];
}

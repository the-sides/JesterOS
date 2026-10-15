import { object, choice, flag } from './command-schema.js';
import { canonicalStringUnits } from './canonical-data.js';
import { previewSchemaValid } from './preview-state.js';
import { previewImageGeometry } from './preview-codec.js';

export const POWERPOINT_PROFILES = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
export const POWERPOINT_TABS = ['Home', 'Insert', 'Design', 'Transitions', 'Animations', 'SlideShow', 'Review', 'View'];
export const POWERPOINT_TEMPLATES = { blank: 'Blank Presentation', pitch: 'Project Pitch', lesson: 'Classroom Lesson' };
export const POWERPOINT_THEMES = { office: { name: 'Office', background: '#ffffff', color: '#242424', accent: '#d24726' }, ion: { name: 'Ion', background: '#173a40', color: '#ffffff', accent: '#41b3a3' }, facet: { name: 'Facet', background: '#fff5e8', color: '#39312a', accent: '#dc6b35' } };
export const powerpointIdSchema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
export const powerpointColorSchema = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
const str = maxLength => ({ type: 'string', maxLength });
const num = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const array = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
export const powerpointObjectSchema = object({ id: powerpointIdSchema, type: choice('text', 'shape', 'image'), x: num(0, 4096), y: num(0, 4096), width: num(1, 4096), height: num(1, 4096), text: str(32768), shape: choice('rectangle', 'ellipse', 'line'), fill: powerpointColorSchema, color: powerpointColorSchema, fontSize: num(6, 200), font: { type: 'string', minLength: 1, maxLength: 1024 }, bold: flag, content: str(768 * 1024), mime: choice('', 'image/png', 'image/jpeg') }, ['id', 'type', 'x', 'y', 'width', 'height', 'text', 'shape', 'fill', 'color', 'fontSize', 'bold', 'content', 'mime']);
export const powerpointSlideSchema = object({ id: powerpointIdSchema, background: powerpointColorSchema, transition: choice('none', 'fade', 'push', 'wipe'), transitionDuration: num(0, 60), objects: array(powerpointObjectSchema, 256) }, ['id', 'background', 'transition', 'objects']);
export const powerpointDocumentSchema = object({ title: str(128), width: num(160, 4096), height: num(90, 4096), slides: array(powerpointSlideSchema, 128, 1) });
export const powerpointSelectionSchema = object({ slideId: powerpointIdSchema, objectIds: array(powerpointIdSchema, 256) });
export const powerpointPresentationSchema = object({ active: flag, playing: flag, slideId: powerpointIdSchema, startedAt: num(-8640000000000000, 8640000000000000), intervalMs: integer(250, 600000), loop: flag, elapsedMs: num(0, 8640000000000000) });
export const powerpointSchema = object({ version: { const: 1 }, profileId: choice(...POWERPOINT_PROFILES), nextId: integer(1, Number.MAX_SAFE_INTEGER - 1), windows: array(object({ windowId: powerpointIdSchema, appId: { const: 'powerpoint' }, document: powerpointDocumentSchema, selection: powerpointSelectionSchema, tab: choice(...POWERPOINT_TABS, 'ShapeFormat', 'PictureFormat'), dialog: nullable(choice('templates', 'open', 'save', 'save-as', 'find', 'format', 'close', 'about', 'export', 'image', 'help')), menu: nullable(choice('powerpoint', 'file', 'edit', 'insert', 'format', 'slide', 'show', 'view', 'help')), fileId: nullable(powerpointIdSchema), fileRevision: nullable({ anyOf: [integer(0, Number.MAX_SAFE_INTEGER), { type: 'string', minLength: 1, maxLength: 256 }] }), dirty: flag, status: str(1024), revision: integer(0, Number.MAX_SAFE_INTEGER - 1), history: object({ undo: array(powerpointDocumentSchema, 32), redo: array(powerpointDocumentSchema, 32) }), presentation: powerpointPresentationSchema, view: object({ mode: choice('normal', 'sorter'), zoom: num(.25, 2), grid: flag }) }), 32) });

export function powerpointImageValid(content, mime) {
  if (typeof content !== 'string' || content.length > 768 * 1024 || !['image/png', 'image/jpeg'].includes(mime)) return false;
  try {
    const geometry = previewImageGeometry(content);
    return geometry.mime === mime;
  } catch { return false; }
}
export function validatePowerPointDocument(document) {
  const bad = message => ({ ok: false, message });
  if (!previewSchemaValid(document, powerpointDocumentSchema)) return bad('Invalid closed PowerPoint presentation.');
  if (canonicalStringUnits(document) > 2 * 1024 * 1024) return bad('Presentation exceeds the 2 Mi string-unit limit.');
  const ids = new Set();
  for (const slide of document.slides) {
    if (ids.has(slide.id)) return bad('Duplicate slide or object identity.');
    ids.add(slide.id);
    for (const item of slide.objects) {
      if (ids.has(item.id)) return bad('Duplicate slide or object identity.');
      ids.add(item.id);
      if (item.x + item.width > document.width + .000001 || item.y + item.height > document.height + .000001) return bad('Objects must fit inside the authored slide.');
      if (item.type === 'image' ? !powerpointImageValid(item.content, item.mime) || item.text !== '' : item.content !== '' || item.mime !== '') return bad('Images require genuine bounded PNG/JPEG bytes; other objects cannot retain media.');
    }
  }
  return { ok: true };
}
export function validatePowerPointState(state, profile) {
  const bad = message => ({ ok: false, message });
  if (!previewSchemaValid(state, powerpointSchema) || profile && state.profileId !== (typeof profile === 'string' ? profile : profile.id)) return bad('Invalid PowerPoint state or profile.');
  if (canonicalStringUnits(state) > 2 * 1024 * 1024 || new Set(state.windows.map(row => row.windowId)).size !== state.windows.length) return bad('PowerPoint identity or retention limit exceeded.');
  for (const row of state.windows) {
    for (const doc of [row.document, ...row.history.undo, ...row.history.redo]) { const result = validatePowerPointDocument(doc); if (!result.ok) return result; }
    const slide = row.document.slides.find(item => item.id === row.selection.slideId);
    if (!slide || row.selection.objectIds.some(id => !slide.objects.some(item => item.id === id)) || new Set(row.selection.objectIds).size !== row.selection.objectIds.length) return bad('Dangling or duplicate selected object.');
    if (!powerpointAvailableTabs(row).includes(row.tab)) return bad('A contextual ribbon tab requires its actual supported object selection.');
    if (!row.document.slides.some(item => item.id === row.presentation.slideId) || row.presentation.playing && !row.presentation.active) return bad('Invalid presentation slide or playback.');
    if ((row.fileId === null) !== (row.fileRevision === null)) return bad('Incomplete original File lease.');
  }
  return { ok: true };
}
export const powerpointWindow = (state, id) => state.windows.find(row => row.windowId === id) ?? null;
export function powerpointAvailableTabs(row) {
  const slide = row.document.slides.find(item => item.id === row.selection.slideId);
  const selected = slide?.objects.filter(item => row.selection.objectIds.includes(item.id)) ?? [];
  return [...POWERPOINT_TABS, ...(selected.length && selected.every(item => item.type === 'shape') ? ['ShapeFormat'] : []), ...(selected.length && selected.every(item => item.type === 'image') ? ['PictureFormat'] : [])];
}
export function createPowerPointState(profile) { return { version: 1, profileId: typeof profile === 'string' ? profile : profile.id, nextId: 1, windows: [] }; }
export function createPowerPointObject(id, type = 'text', values = {}) { return { id, type, x: 72, y: 72, width: 480, height: 96, text: type === 'text' ? 'New text box' : '', shape: 'rectangle', fill: '#d24726', color: '#242424', fontSize: 32, font: 'Calibri', bold: false, content: '', mime: '', ...values }; }
export function createPowerPointDocument(template = 'blank') {
  if (!Object.hasOwn(POWERPOINT_TEMPLATES, template)) throw new Error('Unknown PowerPoint template.');
  const document = { title: 'Presentation1', width: 960, height: 540, slides: [{ id: 'slide-1', background: '#ffffff', transition: 'none', objects: [createPowerPointObject('title-1', 'text', { x: 72, y: 150, width: 816, height: 100, text: 'Click to add title', fontSize: 48 }), createPowerPointObject('subtitle-1', 'text', { x: 72, y: 280, width: 816, height: 90, text: 'Click to add subtitle', fontSize: 26 })] }] };
  if (template === 'blank') return document;
  document.title = template === 'pitch' ? 'Project Pitch' : 'Classroom Lesson';
  document.slides[0].objects[0].text = document.title;
  document.slides[0].objects[1].text = template === 'pitch' ? 'A clear idea. A practical next step.' : 'Explore • Discuss • Create';
  const texts = template === 'pitch' ? [['The opportunity', 'Describe the problem your audience needs to solve.'], ['Our approach', 'Explain the solution and the next step.']] : [['Learning goals', 'What will we learn today?'], ['Your turn', 'Try the activity and share what you discovered.']];
  for (const [index, [title, body]] of texts.entries()) document.slides.push({ id: `slide-${index + 2}`, background: '#ffffff', transition: 'fade', objects: [createPowerPointObject(`title-${index + 2}`, 'text', { x: 72, y: 54, width: 816, height: 90, text: title, fontSize: 42, bold: true }), createPowerPointObject(`body-${index + 2}`, 'text', { x: 72, y: 190, width: 816, height: 250, text: body, fontSize: 30 })] });
  return document;
}
const createPresentation = slideId => ({ active: false, playing: false, slideId, startedAt: 0, intervalMs: 5000, loop: false, elapsedMs: 0 });
export function resetPowerPointSelection(row) {
  row.selection = { slideId: row.document.slides[0].id, objectIds: [] };
  if (row.tab === 'ShapeFormat' || row.tab === 'PictureFormat') row.tab = 'Home';
  row.presentation = createPresentation(row.document.slides[0].id);
}
export function createPowerPointWindow(windowId, { template = 'blank' } = {}) {
  const document = createPowerPointDocument(template);
  return { windowId, appId: 'powerpoint', document, selection: { slideId: document.slides[0].id, objectIds: [] }, tab: 'Home', dialog: null, menu: null, fileId: null, fileRevision: null, dirty: false, status: '', revision: 0, history: { undo: [], redo: [] }, presentation: createPresentation(document.slides[0].id), view: { mode: 'normal', zoom: 1, grid: false } };
}
export function powerpointCapabilities(profile) {
  const id = typeof profile === 'string' ? profile : profile.id;
  return { windows: id.startsWith('windows11'), classic: /high-sierra|mojave/u.test(id), golden: id.includes('golden-gate'), label: 'Microsoft PowerPoint', version: id.includes('high-sierra') ? 'Office 2016 · 16.16' : id.includes('mojave') ? 'Office 2019 · 16.17' : id.includes('golden-gate') ? 'PowerPoint 2024 · nearest macOS 26 proxy' : id.startsWith('windows11') ? 'PowerPoint LTSC 2021 · classic Windows ribbon' : 'Office 2021 · 16.77', disclosure: `Local browser Office equivalent; supported OOXML subset and era-native visual proxy, not a Microsoft runtime. ${id.includes('golden-gate') ? 'Nearest macOS 26/Office 2024 visual proxy; unseen macOS 27 pixels are not certified. ' : ''}Positioned text, shapes and PNG/JPEG; genuine PPTX/PDF and authored-scene slideshow. Advanced object animations and cloud collaboration are unsupported.` };
}
export function powerpointWindowMetadata(profile, options = {}) { return { appId: 'powerpoint', title: 'Microsoft PowerPoint', component: 'PowerPointApp.svelte', utilityKind: 'powerpoint', width: 1100, height: 740, minWidth: 760, minHeight: 480, ...options }; }

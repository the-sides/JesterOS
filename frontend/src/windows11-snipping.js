import { text, identity, choice, object, empty } from './command-schema.js';
import { applied, invalid, stale, unavailable, uiState, liveFile, createFile, validName, uniqueName, drawingSvg } from './windows11-app-helpers.js';

export const createState = () => ({ ui: uiState(), phase: 'empty', source: null, sourceWindowId: null, selection: null, selectionAnchor: null, pointerId: null, annotations: [], activeStrokeId: null, nextStrokeId: 1, color: '#e53935', saveName: 'Snip.svg', savedFileId: null });
// Same authored-SVG producer contract as Paint: canonical Files association.
const svgAssociation = { appId: 'photos', icon: 'image', mime: 'image/svg+xml', encoding: 'utf8' };
export const menus = ['snip'];
const pointerId = { type: 'integer', minimum: 0 };
const x = { type: 'number', minimum: 0, maximum: 640 };
const y = { type: 'number', minimum: 0, maximum: 400 };
const point = object({ x, y, pointerId });
export const specs = {
  'win11.snipping.new': [object({ sourceWindowId: identity }, []), empty],
  'win11.snipping.source': [object({ sourceWindowId: { anyOf: [identity, { const: null }] } }), empty],
  'win11.snipping.selection.set': [empty, object({ x, y, width: { type: 'number', exclusiveMinimum: 0, maximum: 640 }, height: { type: 'number', exclusiveMinimum: 0, maximum: 400 } })],
  'win11.snipping.selection.begin': [empty, point],
  'win11.snipping.selection.extend': [empty, point],
  'win11.snipping.selection.end': [empty, object({ pointerId })],
  'win11.snipping.capture': [empty, empty],
  'win11.snipping.color': [empty, object({ color: choice('#e53935', '#1976d2', '#111111') })],
  'win11.snipping.stroke.begin': [empty, point],
  'win11.snipping.stroke.extend': [object({ strokeId: identity }), point],
  'win11.snipping.stroke.end': [object({ strokeId: identity }), object({ pointerId })],
  'win11.snipping.undo': [empty, empty],
  'win11.snipping.dialog.open': [empty, object({ dialog: choice('save', 'about') })],
  'win11.snipping.dialog.close': [empty, empty],
  'win11.snipping.save.name': [empty, object({ value: text })],
  'win11.snipping.save': [empty, empty],
};
for (const [name, spec] of Object.entries(specs)) {
  spec[2] = [`Render the validated ${name} transition in the Paint-only selection, crop, annotation surface, or native dialog.`];
  spec[3] = ['Retain the actual Paint SVG snapshot, bounded selection, pointer-owned annotation strokes, and snip dialog state in native.apps.snipping.'];
}
specs['win11.snipping.new'][2].push('Read captureSurface from the actually mounted Paint view; reject unavailable sources without mutation. Never request host screen capture.');
specs['win11.snipping.save'][3].push('Create the cropped SVG plus annotations as a shared Pictures virtual image.');
export function croppedSvg(s) {
  const r = s.selection;
  if (!s.source || !r || r.width <= 0 || r.height <= 0) return '';
  const annotations = drawingSvg({ width: r.width, height: r.height, background: 'transparent', strokes: s.annotations });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r.width}" height="${r.height}" viewBox="0 0 ${r.width} ${r.height}"><svg width="${r.width}" height="${r.height}" viewBox="${r.x} ${r.y} ${r.width} ${r.height}">${s.source.svg}</svg>${annotations}</svg>`;
}
export function createCommands(apps, context) {
  const s = apps.snipping;
  const inside = (p, width, height) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height && Number.isInteger(p.pointerId);
  const selecting = () => s.phase === 'selecting' && s.source && !s.ui.dialog;
  const annotating = () => s.phase === 'captured' && s.selection && !s.ui.dialog;
  return {
    'win11.snipping.source': ({ sourceWindowId }) => {
      if (s.ui.dialog || s.pointerId !== null) return invalid('Finish the active gesture or dialog first.');
      if (sourceWindowId !== null && !context.getWindows().some(window => window.id === sourceWindowId && window.appId === 'paint')) return stale('This Paint window no longer exists.');
      s.sourceWindowId = sourceWindowId; return applied({ sourceWindowId });
    },
    'win11.snipping.new': async ({ sourceWindowId = s.sourceWindowId }) => {
      if (s.ui.dialog || s.pointerId !== null) return invalid('Finish the active gesture or dialog first.');
      const paints = context.getWindows().filter(window => window.appId === 'paint');
      if (!sourceWindowId && paints.length > 1) return invalid('Specify sourceWindowId: multiple Paint windows are open.');
      const window = sourceWindowId ? paints.find(window => window.id === sourceWindowId) : paints[0];
      if (sourceWindowId && !window) return stale('This Paint capture source no longer exists.');
      if (!window || window.minimized) return unavailable('Open or restore the requested Paint window first. Only its visible mounted canvas can be captured.');
      const view = context.getApplicationView(window.id);
      if (!view?.captureSurface) return unavailable('Open Paint first. This tool captures only its mounted canvas, never the desktop or host screen.');
      const source = await view.captureSurface();
      if (!source || typeof source.svg !== 'string' || !/^\s*<svg[\s>]/.test(source.svg) || !Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width <= 0 || source.height <= 0) return unavailable('The mounted Paint canvas is unavailable.');
      if (s.ui.dialog || s.pointerId !== null) return stale('The capture state changed.');
      if (!context.getWindows().some(item => item.id === window.id && item.appId === 'paint' && !item.minimized)) return unavailable('Paint is no longer available for capture.');
      s.source = { svg: source.svg, width: source.width, height: source.height, label: 'Paint canvas', windowId: window.id };
      s.selection = { x: 0, y: 0, width: source.width, height: source.height };
      s.selectionAnchor = null;
      s.annotations = [];
      s.activeStrokeId = null;
      s.phase = 'selecting';
      s.savedFileId = null;
      s.ui.menu = null;
      return applied({ sourceWindowId: window.id });
    },
    'win11.snipping.selection.set': (_, p) => { if (!selecting() || s.pointerId !== null) return stale('No idle Paint selection is active.'); if (![p.x,p.y,p.width,p.height].every(Number.isFinite) || p.x < 0 || p.y < 0 || p.width <= 0 || p.height <= 0 || p.x + p.width > s.source.width || p.y + p.height > s.source.height) return invalid('The rectangle must fit inside the captured Paint canvas.'); s.selection = { ...p }; return applied(); },
    'win11.snipping.selection.begin': (_, p) => { if (!selecting() || s.pointerId !== null) return stale('No idle Paint selection is active.'); if (!inside(p, s.source.width, s.source.height)) return invalid('The point is outside the Paint snapshot.'); s.selectionAnchor = { x: p.x, y: p.y }; s.pointerId = p.pointerId; s.selection = { x: p.x, y: p.y, width: 0, height: 0 }; return applied(); },
    'win11.snipping.selection.extend': (_, p) => { if (!selecting() || !s.selectionAnchor || s.pointerId !== p.pointerId) return stale('This is not the active selection pointer.'); if (!inside(p, s.source.width, s.source.height)) return invalid('The point is outside the Paint snapshot.'); const a = s.selectionAnchor; s.selection = { x: Math.min(a.x,p.x), y: Math.min(a.y,p.y), width: Math.abs(a.x-p.x), height: Math.abs(a.y-p.y) }; return applied(); },
    'win11.snipping.selection.end': (_, p) => { if (!selecting() || !s.selectionAnchor || s.pointerId !== p.pointerId) return stale('This is not the active selection pointer.'); s.pointerId = null; s.selectionAnchor = null; return applied(); },
    'win11.snipping.capture': () => { if (!selecting() || s.pointerId !== null || !s.selection || s.selection.width <= 0 || s.selection.height <= 0) return invalid('Select a nonempty rectangle first.'); s.phase = 'captured'; s.ui.menu = null; return applied(); },
    'win11.snipping.color': (_, p) => { if (!annotating() || s.pointerId !== null) return stale('No idle captured image is available.'); s.color = p.color; return applied(); },
    'win11.snipping.stroke.begin': (_, p) => { if (!annotating() || s.pointerId !== null) return stale('No idle captured image is available.'); if (!inside(p, s.selection.width, s.selection.height)) return invalid('The point is outside the crop.'); const stroke = { id: `annotation-${s.nextStrokeId++}`, tool: 'pen', color: s.color, size: 3, points: [{ x: p.x,y: p.y },{ x: p.x,y: p.y }] }; s.annotations.push(stroke); s.activeStrokeId = stroke.id; s.pointerId = p.pointerId; s.savedFileId = null; return applied({ strokeId: stroke.id }); },
    'win11.snipping.stroke.extend': (t, p) => { if (!annotating() || s.activeStrokeId !== t.strokeId || s.pointerId !== p.pointerId) return stale('This is not the active annotation pointer.'); if (!inside(p, s.selection.width, s.selection.height)) return invalid('The point is outside the crop.'); const stroke = s.annotations.find(item => item.id === t.strokeId); if (!stroke) return stale(); stroke.points.push({ x: p.x,y: p.y }); return applied(t); },
    'win11.snipping.stroke.end': (t, p) => { if (!annotating() || s.activeStrokeId !== t.strokeId || s.pointerId !== p.pointerId) return stale('This is not the active annotation pointer.'); s.activeStrokeId = null; s.pointerId = null; return applied(t); },
    'win11.snipping.undo': () => { if (!annotating() || s.pointerId !== null || !s.annotations.length) return invalid('There is no completed annotation to undo.'); s.annotations.pop(); s.savedFileId = null; return applied(); },
    'win11.snipping.dialog.open': (_, p) => { if (s.ui.dialog || s.pointerId !== null) return invalid('Finish the active gesture or dialog first.'); if (p.dialog === 'save' && !annotating()) return invalid('Capture a Paint region first.'); s.ui.dialog = p.dialog; s.ui.menu = null; return applied(); },
    'win11.snipping.dialog.close': () => { if (!s.ui.dialog) return stale(); s.ui.dialog = null; return applied(); },
    'win11.snipping.save.name': (_, p) => { if (s.ui.dialog !== 'save') return stale('Save dialog is not open.'); s.saveName = p.value; return applied(); },
    'win11.snipping.save': () => { if (s.ui.dialog !== 'save' || s.phase !== 'captured') return stale('No captured image is awaiting save.'); if (!validName(s.saveName) || !/\.svg$/i.test(s.saveName)) return invalid('Enter a valid image name ending in .svg.'); if (liveFile(apps,'pictures')?.kind !== 'folder') return stale('Pictures is unavailable.'); if (!uniqueName(apps,'pictures',s.saveName)) return invalid('An image with that name already exists.'); const file = createFile(apps,'pictures',s.saveName,'image',croppedSvg(s),svgAssociation); s.savedFileId = file.id; s.ui.dialog = null; return applied({ fileId: file.id }); },
  };
}
export const readTargets = apps => ({ scope: 'Mounted Paint canvas only; no desktop or host screen capture', phase: apps.snipping.phase, sourceWindowId: apps.snipping.sourceWindowId, source: apps.snipping.source ? { windowId: apps.snipping.source.windowId, width: apps.snipping.source.width, height: apps.snipping.source.height, label: apps.snipping.source.label } : null, selection: apps.snipping.selection ? { ...apps.snipping.selection } : null, pointerId: apps.snipping.pointerId, activeStrokeId: apps.snipping.activeStrokeId, annotations: apps.snipping.annotations.map(item => ({ id: item.id })), savedFileId: apps.snipping.savedFileId, ui: { menu: apps.snipping.ui.menu, dialog: apps.snipping.ui.dialog } });

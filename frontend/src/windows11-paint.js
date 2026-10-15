import { text, identity, choice, object, empty } from './command-schema.js';
import { applied, invalid, stale, uiState, liveFile, createFile, writeFile, validName, uniqueName, drawingSvg } from './windows11-app-helpers.js';

export const colors = ['#111111', '#ffffff', '#808080', '#e53935', '#ff9800', '#ffca28', '#43a047', '#00acc1', '#1976d2', '#8e24aa'];
// Windows association for authored SVG images, matching
// filesystemFileAssociation('image/svg+xml', windows11 profile): Paint owns the
// real producer contract, so every saved file carries this canonical metadata.
const svgAssociation = { appId: 'photos', icon: 'image', mime: 'image/svg+xml', encoding: 'utf8' };
export const createState = () => ({ ui: uiState(), width: 640, height: 400, background: '#ffffff', strokes: [], redo: [], tool: 'pen', color: '#1976d2', size: 4, activeStrokeId: null, pointerId: null, nextStrokeId: 1, savedFileId: null, saveName: 'Untitled.svg', dirty: false });
export const menus = ['file', 'edit'];
const pointerId = { type: 'integer', minimum: 0 };
const point = object({ x: { type: 'number', minimum: 0, maximum: 640 }, y: { type: 'number', minimum: 0, maximum: 400 }, pointerId });
const strokeTarget = object({ strokeId: identity });
export const specs = {
  'win11.paint.tool': [empty, object({ tool: choice('pen', 'rectangle', 'eraser') })],
  'win11.paint.color': [empty, object({ color: choice(...colors) })],
  'win11.paint.size': [empty, object({ size: choice(2, 4, 8, 16) })],
  'win11.paint.stroke.begin': [empty, point],
  'win11.paint.stroke.extend': [strokeTarget, point],
  'win11.paint.stroke.end': [strokeTarget, object({ pointerId })],
  'win11.paint.undo': [empty, empty],
  'win11.paint.redo': [empty, empty],
  'win11.paint.dialog.open': [empty, object({ dialog: choice('save', 'clear', 'about') })],
  'win11.paint.dialog.close': [empty, empty],
  'win11.paint.clear': [empty, empty],
  'win11.paint.save.name': [empty, object({ value: text })],
  'win11.paint.save': [empty, empty],
};
for (const [name, spec] of Object.entries(specs)) {
  spec[2] = [`Render the validated ${name} transition on the actual local SVG drawing surface or native dialog.`];
  spec[3] = ['Retain Paint tools, pointer-owned strokes, undo/redo, dirty state, and save-dialog values in native.apps.paint.'];
}
specs['win11.paint.save'][3].push('Create or revise the named SVG virtual image in shared Pictures; Photos and File Explorer read that same file.');
export function createCommands(apps) {
  const s = apps.paint;
  const inCanvas = p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= s.width && p.y <= s.height && Number.isInteger(p.pointerId);
  const drawingBlocked = () => s.ui.dialog || s.activeStrokeId;
  return {
    'win11.paint.tool': (_, p) => { if (drawingBlocked()) return invalid('Finish the stroke or dialog first.'); s.tool = p.tool; s.ui.menu = null; return applied(); },
    'win11.paint.color': (_, p) => { if (drawingBlocked()) return invalid('Finish the stroke or dialog first.'); s.color = p.color; return applied(); },
    'win11.paint.size': (_, p) => { if (drawingBlocked()) return invalid('Finish the stroke or dialog first.'); s.size = p.size; return applied(); },
    'win11.paint.stroke.begin': (_, p) => { if (drawingBlocked()) return invalid('A stroke or dialog is already active.'); if (!inCanvas(p)) return invalid('Stroke coordinates must be inside the Paint canvas.'); const stroke = { id: `stroke-${s.nextStrokeId++}`, tool: s.tool, color: s.tool === 'eraser' ? s.background : s.color, size: s.size, points: [{ x: p.x, y: p.y }, { x: p.x, y: p.y }] }; s.strokes.push(stroke); s.activeStrokeId = stroke.id; s.pointerId = p.pointerId; s.redo = []; s.dirty = true; s.ui.menu = null; return applied({ strokeId: stroke.id }); },
    'win11.paint.stroke.extend': (t, p) => { if (s.activeStrokeId !== t.strokeId || s.pointerId !== p.pointerId) return stale('This is not the active pointer stroke.'); if (!inCanvas(p)) return invalid('Stroke coordinates must be inside the Paint canvas.'); const stroke = s.strokes.find(item => item.id === t.strokeId); if (!stroke) return stale(); if (stroke.tool === 'rectangle') stroke.points[1] = { x: p.x, y: p.y }; else stroke.points.push({ x: p.x, y: p.y }); return applied(t); },
    'win11.paint.stroke.end': (t, p) => { if (s.activeStrokeId !== t.strokeId || s.pointerId !== p.pointerId) return stale('This is not the active pointer stroke.'); s.activeStrokeId = null; s.pointerId = null; return applied(t); },
    'win11.paint.undo': () => { if (drawingBlocked() || !s.strokes.length) return invalid('There is no completed stroke to undo.'); s.redo.push(s.strokes.pop()); s.dirty = true; s.ui.menu = null; return applied(); },
    'win11.paint.redo': () => { if (drawingBlocked() || !s.redo.length) return invalid('There is no stroke to redo.'); s.strokes.push(s.redo.pop()); s.dirty = true; s.ui.menu = null; return applied(); },
    'win11.paint.dialog.open': (_, p) => { if (drawingBlocked()) return invalid('Finish the stroke or dialog first.'); s.ui.dialog = p.dialog; s.ui.menu = null; return applied(); },
    'win11.paint.dialog.close': () => { if (!s.ui.dialog) return stale(); s.ui.dialog = null; return applied(); },
    'win11.paint.clear': () => { if (s.ui.dialog !== 'clear') return stale('Clear confirmation is not open.'); s.strokes = []; s.redo = []; s.dirty = true; s.ui.dialog = null; return applied(); },
    'win11.paint.save.name': (_, p) => { if (s.ui.dialog !== 'save') return stale('Save dialog is not open.'); s.saveName = p.value; return applied(); },
    'win11.paint.save': () => { if (s.ui.dialog !== 'save') return stale('Save dialog is not open.'); if (!validName(s.saveName) || !/\.svg$/i.test(s.saveName)) return invalid('Enter a valid image name ending in .svg.'); const folder = liveFile(apps, 'pictures'); if (folder?.kind !== 'folder') return stale('Pictures is unavailable.'); const existing = liveFile(apps, s.savedFileId); const overwrite = existing?.kind === 'image' && existing.parentId === 'pictures' && existing.name === s.saveName; if (!uniqueName(apps, 'pictures', s.saveName, overwrite ? existing.id : undefined)) return invalid('An image with that name already exists.'); const content = drawingSvg(s); const file = overwrite ? existing : createFile(apps, 'pictures', s.saveName, 'image', content, svgAssociation); if (overwrite) writeFile(apps, file, content, svgAssociation); s.savedFileId = file.id; s.dirty = false; s.ui.dialog = null; return applied({ fileId: file.id }); },
  };
}
export const readTargets = apps => ({ canvas: { width: apps.paint.width, height: apps.paint.height, activeStrokeId: apps.paint.activeStrokeId, pointerId: apps.paint.pointerId }, strokes: apps.paint.strokes.map(s => ({ id: s.id, tool: s.tool })), tool: apps.paint.tool, colors: [...colors], sizes: [2, 4, 8, 16], canUndo: !!apps.paint.strokes.length && !apps.paint.activeStrokeId && !apps.paint.ui.dialog, canRedo: !!apps.paint.redo.length && !apps.paint.activeStrokeId && !apps.paint.ui.dialog, savedFileId: apps.paint.savedFileId, ui: { menu: apps.paint.ui.menu, dialog: apps.paint.ui.dialog } });

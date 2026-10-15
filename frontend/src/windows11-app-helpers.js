import { rejected } from './feature-commands.js';
export const appIds = ['explorer','notepad','calculator','settings','edge','paint','photos','clock','snipping','terminal','teams'];
export const applied = (target = {}, extra = {}) => ({ status: 'applied', target, ...extra });
export const invalid = (message = 'Invalid application arguments.') => rejected('invalid_arguments', message);
export const stale = (message = 'This target is no longer available.') => rejected('stale_target', message);
export const unavailable = (message = 'This application surface is not mounted.') => rejected('unavailable', message);
export const uiState = () => ({ menu: null, dialog: null, focused: null, scroll: {} });
export const liveFile = (apps, id) => apps.files.find(file => file.id === id && !isTrashed(apps, file));
export function isTrashed(apps, file) { if (file.deleted) return true; const seen = new Set(); let parent = file.parentId; while (parent && !seen.has(parent)) { seen.add(parent); const folder = apps.files.find(item => item.id === parent); if (!folder) return false; if (folder.deleted) return true; parent = folder.parentId; } return false; }
export const children = (apps, folderId) => folderId === 'trash' ? apps.files.filter(file => file.deleted) : apps.files.filter(file => file.parentId === folderId && !isTrashed(apps, file));
export const validName = name => typeof name === 'string' && name.trim() === name && name.length > 0 && name.length <= 100 && !/[\\/:*?"<>|\u0000-\u001f]/.test(name) && !name.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name);
export function uniqueName(apps, parentId, name, exceptId) { return !apps.files.some(file => file.parentId === parentId && file.id !== exceptId && !isTrashed(apps,file) && file.name.toLowerCase() === name.toLowerCase()); }
// Producers owning a concrete document contract (Paint/Snipping SVG) pass their
// canonical Files association metadata explicitly; the generic helper itself
// never infers MIME, appId or icon from a file name.
export function createFile(apps, parentId, name, kind = 'text', content = '', metadata = null) {
  const file = { id: `file-${apps.nextFileId++}`, parentId, name, kind, content, deleted: false, revision: 1, ...(metadata ?? {}) };
  apps.files.push(file); return file;
}
export function writeFile(apps, file, content, metadata = null) {
  file.content = content; file.revision++;
  if (metadata) Object.assign(file, metadata);
}
export function pathOf(apps, id) { const names = []; let file = apps.files.find(item => item.id === id); const seen = new Set(); while(file && !seen.has(file.id)) { seen.add(file.id); names.unshift(file.name); file = apps.files.find(item => item.id === file.parentId); } return names.join('\\'); }
export function resolvePath(apps, path, cwd = 'root') { const parts = path.replace(/\\/g,'/').split('/').filter(Boolean); let id = /^(C:|\/)/i.test(path) ? 'root' : cwd; if (parts[0]?.toLowerCase() === 'c:') parts.shift(); for (const part of parts) { if (part === '.') continue; if(part === '..') { id = liveFile(apps,id)?.parentId || 'root'; continue; } const next = children(apps,id).find(file => file.name.toLowerCase() === part.toLowerCase()); if (!next) return null; id = next.id; } return liveFile(apps,id); }
export const svgData = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
export function drawingSvg(drawing) { const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char])); return `<svg xmlns="http://www.w3.org/2000/svg" width="${drawing.width}" height="${drawing.height}" viewBox="0 0 ${drawing.width} ${drawing.height}"><rect width="100%" height="100%" fill="${esc(drawing.background || '#ffffff')}"/>${drawing.strokes.map(stroke => stroke.tool === 'rectangle' ? `<rect x="${Math.min(stroke.points[0].x,stroke.points.at(-1).x)}" y="${Math.min(stroke.points[0].y,stroke.points.at(-1).y)}" width="${Math.abs(stroke.points.at(-1).x-stroke.points[0].x)}" height="${Math.abs(stroke.points.at(-1).y-stroke.points[0].y)}" fill="none" stroke="${esc(stroke.color)}" stroke-width="${stroke.size}"/>` : `<polyline points="${stroke.points.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${esc(stroke.color)}" stroke-width="${stroke.size}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`; }
// Schema validation is shared by every application handler and its public descriptor.
export function conforms(value, schema) {
  if(schema.allOf && !schema.allOf.every(item => conforms(value,item))) return false;
  if(schema.anyOf && !schema.anyOf.some(item => conforms(value,item))) return false;
  if(schema.if) {
    const branch = conforms(value,schema.if) ? schema.then : schema.else;
    if(branch && !conforms(value,branch)) return false;
  }
  if(schema.enum && !schema.enum.includes(value)) return false;
  if(schema.const !== undefined && value !== schema.const) return false;
  if(schema.type === 'object') {
    if(!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if(schema.required?.some(key => !(key in value))) return false;
    if(schema.additionalProperties === false && Object.keys(value).some(key => !(key in (schema.properties || {})))) return false;
    return Object.entries(schema.properties || {}).every(([key,item]) => !(key in value) || conforms(value[key],item));
  }
  if(schema.type === 'array') return Array.isArray(value) && (schema.minItems === undefined || value.length >= schema.minItems) && (schema.maxItems === undefined || value.length <= schema.maxItems) && value.every(item => conforms(item,schema.items));
  if(schema.type === 'number' || schema.type === 'integer') return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isInteger(value)) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum) && (schema.exclusiveMinimum === undefined || value > schema.exclusiveMinimum) && (schema.exclusiveMaximum === undefined || value < schema.exclusiveMaximum);
  if(schema.type === 'string') return typeof value === 'string' && (schema.minLength === undefined || value.length >= schema.minLength) && (schema.maxLength === undefined || value.length <= schema.maxLength) && (!schema.pattern || new RegExp(schema.pattern).test(value));
  if(schema.type === 'boolean') return typeof value === 'boolean';
  return true;
}

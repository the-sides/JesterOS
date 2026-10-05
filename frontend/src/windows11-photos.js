import { identity, choice, object, empty } from './command-schema.js';
import { applied, invalid, stale, uiState, liveFile, isTrashed } from './windows11-app-helpers.js';

export const images = apps => apps.files.filter(file => file.kind === 'image' && !isTrashed(apps, file));
export const createState = () => ({ ui: uiState(), selectedId: 'studio-photo', transforms: {}, mode: 'viewer' });
export const menus = ['photo'];
export const specs = {
  'win11.photos.open': [object({ fileId: identity }), empty],
  'win11.photos.select': [object({ fileId: identity }), empty],
  'win11.photos.browse': [empty, object({ direction: choice('previous', 'next') })],
  'win11.photos.mode': [empty, object({ mode: choice('gallery', 'viewer') })],
  'win11.photos.zoom': [empty, object({ zoom: { type: 'number', minimum: 0.25, maximum: 4 } })],
  'win11.photos.rotate': [empty, empty],
  'win11.photos.delete.request': [object({ fileId: identity }), empty],
  'win11.photos.delete.confirm': [object({ fileId: identity }), empty],
  'win11.photos.dialog.close': [empty, empty],
};
for (const [name, spec] of Object.entries(specs)) {
  spec[2] = [`Render the validated ${name} transition in the local gallery, viewer, or confirmation dialog.`];
  spec[3] = ['Retain selected image, gallery mode, per-image zoom and rotation, and deletion dialog state in native.apps.photos.'];
}
specs['win11.photos.open'][2].push('Invoke app.open for Photos and display the live shared SVG virtual image.');
specs['win11.photos.delete.confirm'][3].push('Move the confirmed live image to the shared virtual Recycle Bin and increment its revision.');
export function createCommands(apps, context) {
  const s = apps.photos;
  const image = id => { const file = liveFile(apps, id); return file?.kind === 'image' && typeof file.content === 'string' && /^\s*<svg[\s>]/.test(file.content) ? file : null; };
  const select = id => { s.selectedId = id; s.transforms[id] ||= { zoom: 1, rotation: 0 }; s.mode = 'viewer'; s.ui.menu = null; };
  return {
    'win11.photos.open': async t => { if (!image(t.fileId)) return stale('This SVG image is unavailable.'); const result = await context.invoke('app.open', { appId: 'photos' }, {}); if (result.status !== 'applied') return result; select(t.fileId); s.ui.dialog = null; return applied(t); },
    'win11.photos.select': t => { if (s.ui.dialog) return invalid('Close the dialog first.'); if (!image(t.fileId)) return stale('This SVG image is unavailable.'); select(t.fileId); return applied(t); },
    'win11.photos.browse': (_, p) => { if (s.ui.dialog) return invalid('Close the dialog first.'); const files = images(apps); const index = files.findIndex(file => file.id === s.selectedId); const next = index + (p.direction === 'next' ? 1 : -1); if (index < 0 || next < 0 || next >= files.length || !image(files[next].id)) return stale('There is no image in that direction.'); select(files[next].id); return applied({ fileId: s.selectedId }); },
    'win11.photos.mode': (_, p) => { if (s.ui.dialog) return invalid('Close the dialog first.'); s.mode = p.mode; s.ui.menu = null; return applied(); },
    'win11.photos.zoom': (_, p) => { if (s.ui.dialog) return invalid('Close the dialog first.'); if (!image(s.selectedId)) return stale(); if (!Number.isFinite(p.zoom) || p.zoom < 0.25 || p.zoom > 4) return invalid('Zoom must be between 25% and 400%.'); s.transforms[s.selectedId] ||= { zoom: 1, rotation: 0 }; s.transforms[s.selectedId].zoom = p.zoom; return applied({ fileId: s.selectedId }); },
    'win11.photos.rotate': () => { if (s.ui.dialog) return invalid('Close the dialog first.'); if (!image(s.selectedId)) return stale(); s.transforms[s.selectedId] ||= { zoom: 1, rotation: 0 }; s.transforms[s.selectedId].rotation = (s.transforms[s.selectedId].rotation + 90) % 360; s.ui.menu = null; return applied({ fileId: s.selectedId }); },
    'win11.photos.delete.request': t => { if (s.ui.dialog) return invalid('Close the dialog first.'); if (!image(t.fileId)) return stale(); s.ui.dialog = { type: 'delete', fileId: t.fileId }; s.ui.menu = null; return applied(t); },
    'win11.photos.delete.confirm': t => { if (s.ui.dialog?.type !== 'delete' || s.ui.dialog.fileId !== t.fileId) return stale('This image is not awaiting deletion.'); const file = image(t.fileId); if (!file) return stale(); const files = images(apps); const index = files.findIndex(item => item.id === file.id); file.deleted = true; file.revision++; if (s.selectedId === file.id) s.selectedId = files[index + 1]?.id || files[index - 1]?.id || null; s.ui.dialog = null; return applied(t); },
    'win11.photos.dialog.close': () => { if (!s.ui.dialog) return stale(); s.ui.dialog = null; return applied(); },
  };
}
export const readTargets = apps => ({ images: images(apps).map(file => ({ id: file.id, name: file.name, revision: file.revision })), selectedId: apps.photos.selectedId, mode: apps.photos.mode, transform: { ...(apps.photos.transforms[apps.photos.selectedId] || { zoom: 1, rotation: 0 }) }, ui: { menu: apps.photos.ui.menu, dialog: apps.photos.ui.dialog ? { ...apps.photos.ui.dialog } : null } });

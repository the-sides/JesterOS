import { isTrashed } from './windows11-app-helpers.js';

// Desktop interactions need real parent/name records before the wider filesystem
// slice. They use the existing virtual-file convention, not a parallel move log.
export function createMacDesktopFileStore(profile) {
  const files = profile.desktopFiles.map(entry => ({
    ...entry, parentId: entry.id === 'disk' ? null : 'desktop',
    kind: entry.appId === 'finder' ? 'folder' : 'document',
    content: '', deleted: false, revision: 1,
  }));
  for (const [id, name] of [['desktop', 'Desktop'], ['downloads', 'Downloads'], ['trash', 'Trash']]) {
    if (!files.some(file => file.id === id)) files.push({ id, parentId: 'disk', name, kind: 'folder', icon: 'folder', appId: 'finder', content: '', deleted: false, revision: 1 });
  }
  return { files, nextFileId: 1 };
}

export const validMacDesktopName = name => typeof name === 'string' && name.length > 0 && name.length <= 255
  && name.trim() === name && !name.startsWith('.') && !/[:/\u0000-\u001f]/.test(name);

export function macDesktopItems(store) {
  return store.files.filter(file => (file.id === 'disk' || file.parentId === 'desktop') && !isTrashed(store, file))
    .map(file => ({ id: file.id, name: file.name, icon: file.icon ?? (file.kind === 'folder' ? 'folder' : 'pdf'),
      appId: file.appId ?? (file.kind === 'folder' ? 'finder' : 'preview'), renameable: true,
      movable: file.id !== 'disk', ...(file.kind === 'folder' ? { folderId: file.id } : {}) }));
}

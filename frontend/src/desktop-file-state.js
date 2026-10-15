import { isTrashed } from './windows11-app-helpers.js';

// Desktop interactions need real parent/name records before the wider filesystem
// slice. They use the existing virtual-file convention, not a parallel move log.
export function createMacDesktopFileStore(profile, sceneTime = 0) {
  const files = profile.desktopFiles.map(entry => ({
    ...entry, parentId: entry.id === 'disk' ? null : 'desktop',
    kind: entry.appId === 'finder' ? 'folder' : 'document',
    content: entry.content ?? '', deleted: false, revision: 1,
    createdAt: entry.createdAt ?? sceneTime, modifiedAt: entry.modifiedAt ?? sceneTime,
    addedAt: entry.addedAt ?? sceneTime, lastOpenedAt: entry.lastOpenedAt ?? null,
    tags: [...(entry.tags ?? [])],
  }));
  for (const [id, name] of [['desktop', 'Desktop'], ['documents', 'Documents'], ['downloads', 'Downloads'], ['trash', 'Trash']]) {
    if (!files.some(file => file.id === id)) files.push({ id, parentId: 'disk', name, kind: 'folder', icon: 'folder', appId: 'finder', content: '', deleted: false, revision: 1 });
  }
  if (profile.id === 'macos-golden-gate-27.0.1') for (const [id, name] of [
    ['icloud-drive', 'iCloud Drive'], ['mail-cache', 'Mail'],
  ]) files.push({ id, parentId: 'disk', name, kind: 'folder', icon: 'folder', appId: 'finder', content: '',
    deleted: false, revision: 1, createdAt: sceneTime, modifiedAt: sceneTime, addedAt: sceneTime, lastOpenedAt: null, tags: [] });
  return { files, nextFileId: 1, sceneTime };
}

// Bulk discovery resolves each ancestor once. A fresh pass follows moves/deletion;
// no retained index can become stale when the mutable scene file array changes.
export function liveMacFileRecords(store) {
  const byId = new Map(store.files.map(file => [file.id, file]));
  const removed = new Map();
  function trashed(file) {
    if (removed.has(file.id)) return removed.get(file.id);
    const path = [], seen = new Set();
    let current = file, value = false;
    while (current) {
      if (removed.has(current.id)) { value = removed.get(current.id); break; }
      if (current.deleted) { removed.set(current.id, true); value = true; break; }
      if (seen.has(current.id)) break;
      seen.add(current.id); path.push(current.id);
      current = byId.get(current.parentId);
    }
    for (const id of path) removed.set(id, value);
    return value;
  }
  return store.files.filter(file => !trashed(file));
}

export function nextMacFileTimestamp(store) {
  return ++store.sceneTime;
}

export const validMacDesktopName = name => typeof name === 'string' && name.length > 0 && name.length <= 255
  && name.trim() === name && !name.startsWith('.') && !/[:/\u0000-\u001f]/.test(name);

export function macDesktopItems(store) {
  return store.files.filter(file => (file.id === 'disk' || file.parentId === 'desktop') && !isTrashed(store, file))
    .map(file => ({ id: file.id, name: file.name, icon: file.icon ?? (file.kind === 'folder' ? 'folder' : 'pdf'),
      appId: file.appId ?? (file.kind === 'folder' ? 'finder' : 'preview'), renameable: true,
      movable: file.id !== 'disk', createdAt: file.createdAt, modifiedAt: file.modifiedAt,
      addedAt: file.addedAt, lastOpenedAt: file.lastOpenedAt, tags: file.tags ?? [],
      ...(file.kind === 'folder' ? { folderId: file.id } : {}) }));
}

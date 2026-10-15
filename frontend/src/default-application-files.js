import { createMacDesktopFileStore } from './desktop-file-state.js';
import { createWindows11FileStore } from './windows11-files.js';
import { filesystemFileAssociation } from './filesystem-transactions.js';
import { PREVIEW_ITINERARY_CONTENT, PREVIEW_ITINERARY_MIME } from './preview-itinerary.js';
import { PREVIEW_IMAGE_CONTENT, PREVIEW_IMAGE_MIME } from './preview-image-fixture.js';
import { createBooksSeedFiles } from './books-epub.js';
import { createAppleOfficeFileFixtures } from './apple-office-fixtures.js';
import { createMicrosoftOfficeFileFixtures } from './microsoft-office-files.js';
import { KEYCHAIN_CERTIFICATE_FILE } from './keychain-fixtures.js';

// All runtime/default-seed consumers receive the same genuine Files source.
// Nothing here allocates application sessions or reads the host filesystem.
export function createDefaultApplicationFiles(profile, { sceneTime = Date.parse(profile.defaults.sceneTime) } = {}) {
  if (!Number.isSafeInteger(sceneTime) || Math.abs(sceneTime) > 8_640_000_000_000_000)
    throw new Error('Use a bounded authored scene instant for default Files.');
  const mac = profile.family === 'macos', rootId = mac ? 'disk' : 'root';
  const store = mac ? createMacDesktopFileStore(profile, sceneTime) : { ...createWindows11FileStore(), sceneTime };
  const root = store.files.find(file => file.id === rootId);
  if (!root) throw new Error('The native default Files source is missing its startup volume.');
  Object.assign(root, { volumeId: 'startup-volume', mounted: true, driveLetter: mac ? null : 'C' });
  for (const [id, name] of [['documents', 'Documents'], ['downloads', 'Downloads'], ['trash', 'Trash']]) {
    if (!store.files.some(file => file.id === id)) store.files.push({ id, parentId: rootId, name,
      kind: 'folder', content: '', deleted: false, revision: 1, appId: profile.defaults.desktopAppId, icon: 'folder' });
  }
  for (const file of store.files) {
    if (file.kind !== 'folder') {
      if (file.name.toLowerCase().endsWith('.pdf') && !file.content) {
        file.content = PREVIEW_ITINERARY_CONTENT; file.mime = PREVIEW_ITINERARY_MIME;
      } else if (file.kind === 'image' && file.content.trimStart().startsWith('<svg')) file.mime = 'image/svg+xml';
      else file.mime ??= 'text/plain';
      Object.assign(file, filesystemFileAssociation(file.mime, profile));
    } else Object.assign(file, { appId: profile.defaults.desktopAppId, icon: file.icon ?? 'folder' });
    if (mac) Object.assign(file, { createdAt: file.createdAt ?? sceneTime,
      modifiedAt: file.modifiedAt ?? sceneTime, addedAt: file.addedAt ?? sceneTime,
      lastOpenedAt: file.lastOpenedAt ?? null, tags: [...(file.tags ?? [])] });
  }
  function add(spec, fallbackId) {
    const id = spec.id ?? fallbackId;
    if (store.files.some(file => file.id === id)) throw new Error(`Duplicate default File identity: ${id}`);
    const content = spec.content ?? spec.text;
    if (typeof content !== 'string' || content.length > 1024 * 1024)
      throw new Error(`The default ${spec.name} is missing bounded genuine bytes.`);
    const association = filesystemFileAssociation(spec.mime, profile);
    store.files.push({ id, parentId: spec.parentId ?? 'documents', name: spec.name,
      ...association, ...(spec.appId ? { appId: mac ? spec.appId : ['pages', 'numbers', 'keynote'].includes(spec.appId) ? `${spec.appId}-local` : spec.appId } : {}),
      kind: spec.mime.startsWith('image/') ? 'image' : mac ? 'document' : 'text',
      content, mime: spec.mime, deleted: false, revision: spec.revision ?? 1,
      ...(mac ? { createdAt: sceneTime, modifiedAt: sceneTime, addedAt: sceneTime,
        lastOpenedAt: null, tags: [] } : {}) });
  }
  if (!store.files.some(file => file.mime === PREVIEW_ITINERARY_MIME))
    add({ name: 'Scene Itinerary.pdf', mime: PREVIEW_ITINERARY_MIME, content: PREVIEW_ITINERARY_CONTENT }, 'preview-itinerary');
  add({ name: 'Harbor Scene.png', mime: PREVIEW_IMAGE_MIME, content: PREVIEW_IMAGE_CONTENT,
    parentId: mac ? 'documents' : 'pictures' }, 'preview-harbor-image');
  for (const book of createBooksSeedFiles()) add({ ...book, appId: mac ? 'books' : 'fictional-books' });
  for (const fixture of createAppleOfficeFileFixtures()) add(fixture, `apple-office-${fixture.appId}-fixture`);
  for (const fixture of createMicrosoftOfficeFileFixtures()) add(fixture, `microsoft-office-${fixture.appId}-fixture`);
  add(KEYCHAIN_CERTIFICATE_FILE, 'invented-trail-certificate');
  return store;
}

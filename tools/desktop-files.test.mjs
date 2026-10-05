import { test, expect } from 'bun:test';
import { createMacDesktopFileStore, macDesktopItems, validMacDesktopName } from '../frontend/src/desktop-file-state.js';
import { highSierraProfile } from '../frontend/src/high-sierra-profile.js';
import { createFile, liveFile } from '../frontend/src/windows11-app-helpers.js';
import { createFileCommands, moveVirtualFiles } from '../frontend/src/windows11-explorer.js';

const scene = () => createMacDesktopFileStore(highSierraProfile);
const move = (apps, ids, folderId) => moveVirtualFiles(apps, ids.map(fileId => ({ fileId, name: liveFile(apps, fileId).name })), folderId, validMacDesktopName);

test('desktop batch collision preserves every source before a successful real location move', () => {
  const apps = scene();
  const map = createFile(apps, 'desktop', 'Map.pdf', 'document', 'map contents');
  const conflict = createFile(apps, 'personal', 'MAP.PDF', 'document', 'existing destination');
  const before = structuredClone(apps);
  expect(move(apps, ['itinerary', map.id], 'personal').status).toBe('rejected');
  expect(apps).toEqual(before);
  createFileCommands(apps)['win11.files.trash']({ fileId: conflict.id }, {});
  expect(move(apps, ['itinerary', map.id], 'personal')).toMatchObject({ status: 'applied', target: { fileIds: ['itinerary', map.id], folderId: 'personal' } });
  expect(liveFile(apps, 'itinerary').parentId).toBe('personal');
  expect(liveFile(apps, map.id)).toMatchObject({ parentId: 'personal', name: 'Map.pdf', content: 'map contents', revision: 2 });
  expect(macDesktopItems(apps).map(file => file.id)).toEqual(['disk', 'personal']);
});

test('a later cyclic or protected source rejects the entire desktop batch', () => {
  const apps = scene();
  const child = createFile(apps, 'personal', 'Child', 'folder');
  const before = structuredClone(apps);
  expect(move(apps, ['itinerary', 'personal'], child.id).status).toBe('rejected');
  expect(apps).toEqual(before);
  expect(move(apps, ['itinerary', 'desktop'], 'personal').status).toBe('rejected');
  expect(apps).toEqual(before);
});

test('native rename policies apply to actual records rather than imposing Windows names on Mac', () => {
  const mac = scene(), win = scene();
  const nativeRename = createFileCommands(mac, { validateName: validMacDesktopName })['win11.files.rename'];
  expect(nativeRename({ fileId: 'itinerary' }, { name: 'Trip?final.pdf' }).status).toBe('applied');
  expect(liveFile(mac, 'itinerary')).toMatchObject({ name: 'Trip?final.pdf', revision: 2 });
  const before = structuredClone(mac);
  for (const name of ['Bad:name.pdf', '.hidden.pdf', 'a/b.pdf']) {
    expect(nativeRename({ fileId: 'itinerary' }, { name }).status).toBe('rejected');
    expect(mac).toEqual(before);
  }
  expect(createFileCommands(win)['win11.files.rename']({ fileId: 'itinerary' }, { name: 'Trip?final.pdf' }).status).toBe('rejected');
  expect(liveFile(win, 'itinerary')).toMatchObject({ name: 'Itinerary.pdf', revision: 1 });
});

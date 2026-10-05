import { test, expect } from 'bun:test';
import { createMacDesktopFileStore } from '../frontend/src/desktop-file-state.js';
import { highSierraProfile } from '../frontend/src/high-sierra-profile.js';
import { createFile, liveFile } from '../frontend/src/windows11-app-helpers.js';
import { trashVirtualFiles } from '../frontend/src/windows11-explorer.js';
import { desktopGridPositions, readDesktopFileInfo } from '../frontend/src/desktop-context-model.js';

const scene = () => createMacDesktopFileStore(highSierraProfile);

test('later protected Trash source cannot delete an earlier real folder or its children', () => {
  const store = scene();
  const child = createFile(store, 'personal', 'Résumé.txt', 'text', '📄 résumé');
  const before = structuredClone(store);
  expect(trashVirtualFiles(store, ['personal', 'disk'], ['disk']).status).toBe('rejected');
  expect(store).toEqual(before);
  expect(trashVirtualFiles(store, ['personal'], ['disk']).status).toBe('applied');
  expect(liveFile(store, child.id)).toBeUndefined();
  expect(store.files.find(file => file.id === child.id)).toMatchObject({ parentId: 'personal', content: '📄 résumé', deleted: false });
  expect(readDesktopFileInfo(store, 'personal')).toMatchObject({ deleted: true, itemCount: 1 });
});

test('Get Info reports UTF-8 stored bytes while ancestor Trash visibility retains actual contents', () => {
  const store = scene();
  const child = createFile(store, 'personal', 'Résumé.txt', 'text', '📄 résumé');
  expect(readDesktopFileInfo(store, child.id)).toMatchObject({ size: 13, deleted: false });
  trashVirtualFiles(store, ['personal'], ['disk']);
  expect(readDesktopFileInfo(store, child.id)).toMatchObject({ size: 13, deleted: true });
  expect(readDesktopFileInfo(store, 'personal').itemCount).toBe(1);
});

test('selected cleanup reserves unselected occupied slots and rejects an incomplete cramped plan', () => {
  const items = [{ id: 'fixed', name: 'Fixed' }, { id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const rects = [{ fileId: 'fixed', x: 0, y: 0, width: 80, height: 80 },
    { fileId: 'a', x: 20, y: 20, width: 80, height: 80 },
    { fileId: 'b', x: 210, y: 110, width: 80, height: 80 }];
  const metrics = { startX: 0, startY: 0, stepX: 100, stepY: 100, itemWidth: 80, itemHeight: 80, reverseX: false };
  expect(desktopGridPositions(items, rects, metrics, { width: 300, height: 200 }, ['a', 'b'])).toEqual([
    { fileId: 'a', x: 0, y: 100 }, { fileId: 'b', x: 200, y: 100 },
  ]);
  expect(desktopGridPositions(items, rects, metrics, { width: 80, height: 80 }, ['a', 'b'])).toBeNull();
});

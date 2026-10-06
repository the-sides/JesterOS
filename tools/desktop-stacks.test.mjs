import { test, expect } from 'bun:test';
import { MOJAVE_PROFILE_ID, getOSProfile } from '../frontend/src/os-profiles.js';
import { createMacDesktopFileStore, macDesktopItems, nextMacFileTimestamp } from '../frontend/src/desktop-file-state.js';
import { createFile, liveFile } from '../frontend/src/windows11-app-helpers.js';
import { trashVirtualFiles } from '../frontend/src/windows11-explorer.js';
import { desktopStacks, desktopStacksDefaults, desktopStackLayout, reconcileDesktopStacks } from '../frontend/src/desktop-stacks-model.js';

const base = Date.UTC(2018, 8, 24, 17, 42);
const scene = () => createMacDesktopFileStore(getOSProfile(MOJAVE_PROFILE_ID), base);
const enabled = () => ({ ...desktopStacksDefaults(), enabled: true });

test('Trash removal replaces a browsed cover without resurrecting it or grouping real folders', () => {
  const store = scene(), state = enabled();
  const report = createFile(store, 'desktop', 'Report2.pdf', 'document', 'A report');
  const later = createFile(store, 'desktop', 'Report10.pdf', 'document', 'A later report');
  let groups = desktopStacks(macDesktopItems(store), state, store.sceneTime);
  const pdf = groups.find(group => group.name === 'PDF Documents');
  state.topFileIds[pdf.id] = later.id;
  state.expandedStackIds = [pdf.id];
  expect(desktopStacks(macDesktopItems(store), state, store.sceneTime)[0].fileIds).toEqual(['itinerary', report.id, later.id]);
  trashVirtualFiles(store, [later.id]);
  groups = desktopStacks(macDesktopItems(store), state, store.sceneTime);
  reconcileDesktopStacks(state, groups);
  expect(state.topFileIds).toEqual({});
  expect(groups[0]).toMatchObject({ id: pdf.id, topFileId: 'itinerary', expanded: true, fileIds: ['itinerary', report.id] });
  expect(desktopStackLayout(macDesktopItems(store), groups, true).map(item => item.id)).toEqual(['disk', pdf.id, 'itinerary', report.id, 'personal']);
  trashVirtualFiles(store, ['itinerary', report.id]);
  reconcileDesktopStacks(state, desktopStacks(macDesktopItems(store), state, store.sceneTime));
  expect(state.expandedStackIds).toEqual([]);
});

test('a real tag named untagged never collides with files having no tag', () => {
  const store = scene(), state = { ...enabled(), groupBy: 'tags' };
  liveFile(store, 'itinerary').tags = ['untagged'];
  const untagged = createFile(store, 'desktop', 'Plain.txt', 'document', 'No tag');
  const groups = desktopStacks(macDesktopItems(store), state, store.sceneTime);
  expect(groups.map(group => ({ name: group.name, ids: group.fileIds }))).toEqual([
    { name: 'untagged', ids: ['itinerary'] }, { name: 'No Tags', ids: [untagged.id] },
  ]);
  expect(groups[0].id).not.toBe(groups[1].id);
});

test('unknown opening dates stay separate from epoch-zero dates and a real opening regroups the file', () => {
  const store = scene(), state = { ...enabled(), groupBy: 'date-last-opened' };
  const epoch = createFile(store, 'desktop', 'Archive.pdf', 'document', 'Archived');
  epoch.lastOpenedAt = 0;
  let groups = desktopStacks(macDesktopItems(store), state, store.sceneTime);
  expect(groups.map(group => ({ name: group.name, ids: group.fileIds }))).toEqual([
    { name: '1970', ids: [epoch.id] }, { name: 'No Date', ids: ['itinerary'] },
  ]);
  liveFile(store, 'itinerary').lastOpenedAt = nextMacFileTimestamp(store);
  groups = desktopStacks(macDesktopItems(store), state, store.sceneTime);
  expect(groups.map(group => ({ name: group.name, ids: group.fileIds }))).toEqual([
    { name: 'Today', ids: ['itinerary'] }, { name: '1970', ids: [epoch.id] },
  ]);
  expect(new Date(liveFile(store, 'itinerary').lastOpenedAt).getUTCFullYear()).toBe(2018);
});

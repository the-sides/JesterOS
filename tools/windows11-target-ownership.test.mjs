import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createDefaultSceneSeed } from '../frontend/src/scene-seed.js';
import { createDefaultApplicationFiles } from '../frontend/src/default-application-files.js';
import { createWindows11AppState, createWindows11AppWindow, releaseWindows11AppWindow, windows11AppsForWindow } from '../frontend/src/windows11-app-state.js';
import { createWindows11AppCommands, readWindows11AppTargets, windows11AppCatalog } from '../frontend/src/windows11-app-commands.js';
import { createApplicationFileBridges } from '../frontend/src/application-file-bridges.js';
import { createPreviewCommands } from '../frontend/src/preview-commands.js';
import { createPreviewState } from '../frontend/src/preview-state.js';
import { decodePreviewData } from '../frontend/src/preview-codec.js';
import { conforms } from '../frontend/src/windows11-app-helpers.js';

test('SDK targets describe only their original owned windows alongside native-domain editors', () => {
  const profile = getOSProfile('windows11-23h2-22631.2428');
  const apps = createWindows11AppState(profile, createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles }));
  createWindows11AppWindow(apps, 'sdk-notepad', 'notepad', { fresh: true });
  const original = windows11AppsForWindow(apps, 'sdk-notepad').notepad;
  original.wordWrap = false;
  original.tabs[0].content = 'Actual unsaved SDK document.';
  const windows = [
    { id: 'sdk-notepad', appId: 'notepad' },
    { id: 'native-notepad', appId: 'notepad' },
    { id: 'native-calculator', appId: 'calculator' },
  ];
  const context = { getWindows: () => windows, getApplicationView: () => null };
  const targets = readWindows11AppTargets(apps, context);
  expect(targets.applications.notepad.windows.map(row => row.windowId)).toEqual(['sdk-notepad']);
  expect(targets.applications.notepad.windows[0].wordWrap).toBe(false);
  expect(targets.applications.notepad.windows[0].tabs[0].dirty).toBe(true);
  expect(targets.applications.calculator.windows).toEqual([]);
  expect(windows11AppsForWindow(apps, 'sdk-notepad').notepad).toBe(original);

  expect(releaseWindows11AppWindow(apps, 'sdk-notepad', 'notepad')).toBe(true);
  windows.splice(0, 1);
  const retired = readWindows11AppTargets(apps, context);
  expect(retired.applications.notepad.windows).toEqual([]);
  expect(retired.applications.notepad.retained.wordWrap).toBe(false);
  expect(retired.applications.notepad.retained.tabs[0].dirty).toBe(true);
  expect(original.tabs[0].content).toBe('Actual unsaved SDK document.');
});

test('native Explorer PDF association decodes the complete original legacy text-kind file in real Edge PDF state', async () => {
  const profile = getOSProfile('windows11-23h2-22631.2428');
  const apps = createWindows11AppState(profile, createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles }));
  const source = { id: 'source-explorer', appId: 'explorer' }, windows = [source];
  createWindows11AppWindow(apps, source.id, source.appId, { fresh: true });
  const original = apps.files.find(file => file.id === 'preview-itinerary'), before = structuredClone(apps.files);
  expect(original.kind).toBe('text');
  const files = createApplicationFileBridges({ profile, getStore: () => apps, alive: () => true });
  const state = createPreviewState(profile);
  let sourceGuard = () => true;
  const preview = createPreviewCommands({
    profile, getState: () => state, alive: () => true, canCommit: () => true,
    getWindow: id => windows.find(window => window.id === id), getView: () => null, available: () => true,
    getFile: files.getFile,
    readFile: (id, ownership) => files.readFile(id, { guard: () => sourceGuard() && ownership.guard() }),
  });
  const commands = createWindows11AppCommands(apps, {
    getWindows: () => windows,
    invoke: () => { throw new Error('A PDF must never be pre-opened by the legacy text-kind Notepad route.'); },
    openAssociatedFile: async (fileId, ownership) => {
      sourceGuard = ownership.guard;
      const window = { id: 'actual-edge-pdf', appId: 'edge', utilityKind: 'edge-pdf' };
      windows.push(window);
      expect(preview.windowOpened(window)).toBe(true);
      return preview.handlers['preview.open']({ windowId: window.id }, { fileId });
    },
  });
  const opened = await commands['win11.files.open']({ fileId: original.id, windowId: source.id }, {});
  expect(opened.status).toBe('applied');
  expect(conforms(opened, windows11AppCatalog['win11.files.open'].resultSchema)).toBe(true);
  const document = state.documents.find(row => row.id === opened.documentId);
  expect(document.fileId).toBe(original.id);
  expect(document.fileRevision).toBe(original.revision);
  expect(document.content).toBe(original.content);
  expect(document.mime).toBe('application/pdf');
  expect(document.pages).toHaveLength(3);
  expect(decodePreviewData(document.content).bytes).toEqual(decodePreviewData(original.content).bytes);
  expect(files.getFile(original.id)).toBe(original);
  expect(apps.files).toEqual(before);
  expect(windows.map(window => window.appId)).toEqual(['explorer', 'edge']);
});

test('file association launch cannot borrow equal IDs and revisions after original Explorer or File replacement', async () => {
  for (const replace of ['window', 'file']) {
    const profile = getOSProfile('windows11-23h2-22631.2428');
    const apps = createWindows11AppState(profile, createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles }));
    const source = { id: 'source-explorer', appId: 'explorer' }, windows = [source];
    const original = apps.files.find(file => file.id === 'preview-itinerary');
    const files = createApplicationFileBridges({ profile, getStore: () => apps, alive: () => true });
    const commands = createWindows11AppCommands(apps, {
      getWindows: () => windows, invoke: () => { throw new Error('The source must use its genuine associated bridge.'); },
      openAssociatedFile: async (fileId, ownership) => {
        if (replace === 'window') windows[0] = { ...source };
        else apps.files[apps.files.indexOf(original)] = { ...original };
        return files.readFile(fileId, ownership);
      },
    });
    const result = await commands['win11.files.open']({ fileId: original.id, windowId: source.id }, {});
    expect(result.status).toBe('rejected');
    expect(result.error.code).toBe('stale_target');
    expect(original.content).toBe(apps.files.find(file => file.id === original.id).content);
    expect(original.revision).toBe(apps.files.find(file => file.id === original.id).revision);
  }
});

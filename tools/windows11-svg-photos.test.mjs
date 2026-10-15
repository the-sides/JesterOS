import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createDefaultSceneSeed } from '../frontend/src/scene-seed.js';
import { createDefaultApplicationFiles } from '../frontend/src/default-application-files.js';
import { createWindows11AppState, createWindows11AppWindow, windows11AppsForWindow, snapshotWindows11SdkWindows, restoreWindows11SdkWindows } from '../frontend/src/windows11-app-state.js';
import { createWindows11AppCommands, readWindows11AppTargets } from '../frontend/src/windows11-app-commands.js';
import { createWindowCommands } from '../frontend/src/window-commands.js';
import { nativeDomainForWindow } from '../frontend/src/native-domain-registry.js';
import { validateSavedSession, projectSavedSession, rehydrateSavedSession } from '../frontend/src/saved-session.js';
import { spacesDefaults } from '../frontend/src/spaces.js';
import { desktopViewDefaults } from '../frontend/src/desktop-context-model.js';
import { JSDOM } from 'jsdom';
import { createWindows11AppView } from '../frontend/src/windows11-app-view.js';
import { drawingSvg, conforms } from '../frontend/src/windows11-app-helpers.js';
import { createApplicationFileBridges } from '../frontend/src/application-file-bridges.js';
import { validateFilesystemStore } from '../frontend/src/filesystem-transactions.js';
import { createMessagesState } from '../frontend/src/messages-state.js';
import { createMessagesCommands } from '../frontend/src/messages-commands.js';
import { validMessageAttachment, sendMessageDraft } from '../frontend/src/messages-composition.js';
import { attachmentContent } from '../frontend/src/messages-rich-commands.js';
import { sceneSeedSchema } from '../frontend/src/scene-seed.js';

const profile = getOSProfile('windows11-23h2-22631.2428');
function fixture() {
  const seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles });
  const apps = createWindows11AppState(profile, seed);
  const source = { id: 'explorer', appId: 'explorer' };
  const destination = { id: 'photos-window-2', appId: 'photos', utilityKind: 'photos-svg' };
  const windows = [source, destination];
  createWindows11AppWindow(apps, source.id, source.appId, { fresh: true });
  createWindows11AppWindow(apps, destination.id, destination.appId, { fresh: true });
  const handlers = {}, context = { getWindows: () => windows, getApplicationView: () => null,
    invoke: (command, target, payload) => handlers[command](target, payload) };
  let focusBarrier = async () => {};
  Object.assign(handlers, createWindowCommands(() => windows, {
    available: () => true, focus: id => { context.activeId = id; }, focusKeyboard: () => focusBarrier(),
  }, 'maximized'), createWindows11AppCommands(apps, context));
  return { seed, apps, source, destination, windows, context, handlers,
    scoped: windows11AppsForWindow(apps, destination.id), barrier: value => { focusBarrier = value; } };
}

test('real SVG handler focuses its original SDK utility, never ordinary raster Photos, and publishes viewer state', async () => {
  const f = fixture();
  f.windows.push({ id: 'photos-window-3', appId: 'photos', utilityKind: 'photos-image' });
  expect(nativeDomainForWindow(profile, f.destination)).toBeNull();
  const result = await f.handlers['win11.photos.open']({ windowId: f.destination.id, fileId: 'coast-photo' }, {}, { guard: () => true });
  expect(result.status).toBe('applied');
  expect(result.target.windowId).toBe(f.destination.id);
  expect(f.context.activeId).toBe(f.destination.id);
  expect(f.scoped.photos.selectedId).toBe('coast-photo');
  expect(f.scoped.photos.mode).toBe('viewer');
  expect(f.scoped.photos.transforms['coast-photo']).toEqual({ zoom: 1, rotation: 0 });
  expect(readWindows11AppTargets(f.apps, f.context).applications.photos.windows.map(window => window.windowId)).toEqual([f.destination.id]);
});

test('SVG Photos roster and native selection omit raster documents handled by ordinary Photos', async () => {
  const f = fixture();
  const raster = f.apps.files.find(file => file.id === 'preview-harbor-image');
  expect(raster.mime).toBe('image/png');
  const roster = readWindows11AppTargets(f.apps, f.context).applications.photos.windows[0];
  expect(roster.images.map(file => file.id)).not.toContain(raster.id);
  expect((await f.handlers['win11.photos.open']({ windowId: f.destination.id, fileId: 'coast-photo' }, {})).status).toBe('applied');
  const before = structuredClone(f.scoped.photos);
  expect((await f.handlers['win11.photos.select']({ windowId: f.destination.id, fileId: raster.id }, {})).error.code).toBe('stale_target');
  expect(f.scoped.photos).toEqual(before);
});

for (const replacement of ['source', 'file', 'bytes', 'destination', 'session']) test(`SVG true commit rejects ${replacement} replacement across original focus await`, async () => {
  const f = fixture(), file = f.apps.files.find(row => row.id === 'coast-photo'), signature = JSON.stringify(file);
  const before = structuredClone(f.scoped.photos);
  f.barrier(async () => {
    if (replacement === 'source') f.windows[0] = { ...f.source };
    if (replacement === 'file') f.apps.files[f.apps.files.indexOf(file)] = { ...file };
    if (replacement === 'bytes') file.content += '\n<!-- original source changed -->';
    if (replacement === 'destination') f.windows[1] = { ...f.destination };
    if (replacement === 'session') f.apps.windowSessions[f.destination.id] = { ...f.scoped.photos };
  });
  const guard = () => f.windows[0] === f.source && f.apps.files.find(row => row.id === file.id) === file
    && JSON.stringify(file) === signature && f.apps.windowSessions[f.destination.id] === f.scoped.photos;
  const result = await f.handlers['win11.photos.open']({ windowId: f.destination.id, fileId: file.id }, {}, { guard });
  expect(result.status).toBe('rejected');
  expect(result.error.code).toBe('stale_target');
  expect(f.scoped.photos).toEqual(before);
});

function savedFixture(f) {
  const { overview, ...spaces } = spacesDefaults();
  const window = { ...f.destination, title: 'Photos', minimized: false, fullScreen: false, maximized: false,
    bounds: { x: 80, y: 56, width: 900, height: 620, scale: 1 }, restoreBounds: null };
  const source = { ...f.source, title: 'File Explorer', minimized: false, fullScreen: false, maximized: false,
    bounds: { x: 100, y: 80, width: 1000, height: 650, scale: 1 }, restoreBounds: null };
  const scene = { seed: f.seed, windows: [window, source], closedWindows: {}, catalogTimes: {},
    fileOrder: f.seed.files.files.map(file => file.id),
    views: Object.fromEntries([window, source].map(row => [row.id, { scroll: [], selections: [], focusKey: null }])), nextWindowId: 3,
    activeAppId: 'photos', activeWindowId: window.id, runningAppIds: ['explorer', 'photos'],
    switching: { activationAppIds: ['photos'], activationWindowIds: [window.id], creationWindowIds: [source.id, window.id], hiddenAppIds: [] },
    spaces, splitViews: [], desktop: { selectedFileIds: [], selectionAnchorId: null, positions: {}, sortBy: 'none',
      viewOptions: desktopViewDefaults('windows', 'windows11') },
    dockOrder: { mainOrderAppIds: [], secondaryOrderItemIds: [] },
    ...snapshotWindows11SdkWindows(f.apps, [window, source]) };
  return { version: 1, profileId: profile.id, baseline: { source: 'default', seed: structuredClone(f.seed) },
    locals: [{ userId: 'local-alex', scene }] };
}

test('saved genuine SVG model roundtrip and cold restore preserve original selection, transforms and scoped ownership', async () => {
  const f = fixture();
  await f.handlers['win11.explorer.navigate']({ windowId: f.source.id, folderId: 'pictures' }, {});
  await f.handlers['win11.explorer.select']({ windowId: f.source.id, fileId: 'studio-photo' }, {});
  await f.handlers['win11.photos.open']({ windowId: f.destination.id, fileId: 'coast-photo' }, {});
  await f.handlers['win11.photos.zoom']({ windowId: f.destination.id }, { zoom: 2 });
  await f.handlers['win11.photos.rotate']({ windowId: f.destination.id }, {});
  f.scoped.photos.ui.scroll['photos-viewer'] = { top: 75, left: 20 };
  const saved = savedFixture(f);
  expect(validateSavedSession(saved, profile)).toEqual({ ok: true });
  const roundtrip = rehydrateSavedSession(JSON.parse(JSON.stringify(projectSavedSession(saved, profile))), profile);
  expect(validateSavedSession(roundtrip, profile)).toEqual({ ok: true });
  expect(roundtrip.locals[0].scene.desktop.viewOptions).toEqual(desktopViewDefaults('windows', 'windows11'));
  const scene = roundtrip.locals[0].scene, restored = createWindows11AppState(profile, scene.seed);
  restoreWindows11SdkWindows(restored, scene.windows, scene);
  const scoped = windows11AppsForWindow(restored, scene.windows[0].id);
  expect(scoped.photos).toEqual(f.scoped.photos);
  expect(scoped.files).toBe(restored.files);
  expect(scoped.photos).not.toBe(restored.photos);
  expect(snapshotWindows11SdkWindows(restored, scene.windows).windows11SvgPhotos[scene.windows[0].id]).toBe(scoped.photos);
  expect(restored.files.find(file => file.id === 'coast-photo').content).toBe(f.apps.files.find(file => file.id === 'coast-photo').content);
  const sourceScope = windows11AppsForWindow(restored, f.source.id);
  expect(sourceScope.explorer).toEqual(windows11AppsForWindow(f.apps, f.source.id).explorer);
  expect(sourceScope.explorer.folderId).toBe('pictures');
  expect(sourceScope.explorer.selectedId).toBe('studio-photo');
  expect(sourceScope.files).toBe(restored.files);
});

for (const mutation of ['missing', 'extra', 'wrong-owner', 'non-svg-selection', 'unregistered-utility']) test(`saved SVG utility rejects ${mutation} rather than inventing model ownership`, () => {
  const f = fixture(), saved = savedFixture(f), scene = saved.locals[0].scene;
  expect(validateSavedSession(saved, profile)).toEqual({ ok: true });
  if (mutation === 'missing') delete scene.windows11SvgPhotos;
  if (mutation === 'extra') scene.windows11SvgPhotos['photos-window-9'] = structuredClone(f.scoped.photos);
  if (mutation === 'wrong-owner') scene.windows[0].appId = 'paint';
  if (mutation === 'non-svg-selection') scene.windows11SvgPhotos[f.destination.id].selectedId = 'call-sheet';
  if (mutation === 'unregistered-utility') scene.windows[0].utilityKind = 'photos-anything';
  expect(validateSavedSession(saved, profile).ok).toBe(false);
  if (mutation === 'missing') expect(() => restoreWindows11SdkWindows(createWindows11AppState(profile, f.seed), scene.windows, scene)).toThrow('no original model');
});

for (const mutation of ['mac-fields', 'mixed-fields', 'unknown-field']) test(`saved SVG Windows envelope rejects ${mutation} desktop options without weakening model ownership`, () => {
  const f = fixture(), saved = savedFixture(f), scene = saved.locals[0].scene;
  expect(validateSavedSession(saved, profile)).toEqual({ ok: true });
  if (mutation === 'mac-fields') scene.desktop.viewOptions = desktopViewDefaults('macos', 'golden-gate');
  if (mutation === 'mixed-fields') Object.assign(scene.desktop.viewOptions, desktopViewDefaults('macos', 'golden-gate'));
  if (mutation === 'unknown-field') scene.desktop.viewOptions.authorizedFallback = true;
  expect(validateSavedSession(saved, profile).ok).toBe(false);
});

test('saved SVG utility retains actual Windows maximized bounds, not fabricated Mac Space or zoom fields', () => {
  const f = fixture(), saved = savedFixture(f), scene = saved.locals[0].scene, window = scene.windows[0];
  window.maximized = true;
  window.restoreBounds = { ...window.bounds };
  window.bounds = { x: 0, y: 0, width: 1280, height: 720, scale: 1 };
  expect(validateSavedSession(saved, profile)).toEqual({ ok: true });
  const roundtrip = rehydrateSavedSession(JSON.parse(JSON.stringify(projectSavedSession(saved, profile))), profile);
  expect(roundtrip.locals[0].scene.windows[0]).toEqual(window);
  expect(Object.hasOwn(roundtrip.locals[0].scene.windows[0], 'zoomed')).toBe(false);
  expect(Object.hasOwn(roundtrip.locals[0].scene.windows[0], 'spaceId')).toBe(false);
  window.restoreBounds = null;
  expect(validateSavedSession(saved, profile).ok).toBe(false);
});

for (const mutation of ['mac-window', 'mixed-window', 'missing-maximized', 'Space', 'Dock', 'Stacks', 'notesScroll', 'old-notes-selection']) test(`saved genuine Windows SVG envelope rejects ${mutation} fabrication`, () => {
  const f = fixture(), saved = savedFixture(f), scene = saved.locals[0].scene, window = scene.windows[0];
  expect(validateSavedSession(saved, profile)).toEqual({ ok: true });
  if (mutation === 'mac-window') { delete window.maximized; window.zoomed = false; window.spaceId = 'desktop-1'; }
  if (mutation === 'mixed-window') window.zoomed = false;
  if (mutation === 'missing-maximized') delete window.maximized;
  if (mutation === 'Space') { scene.spaces.desktops.push({ id: 'desktop-2' }); scene.spaces.order.push('desktop-2'); scene.spaces.nextDesktopId = 3; }
  if (mutation === 'Dock') scene.dockOrder.mainOrderAppIds.push('explorer');
  if (mutation === 'Stacks') scene.desktop.stacks = { enabled: false, groupBy: 'kind', sortBy: 'name', expandedStackIds: [], topFileIds: {} };
  if (mutation === 'notesScroll') scene.notesScroll = { list: { top: 0, left: 0 }, editor: { top: 0, left: 0 } };
  if (mutation === 'old-notes-selection') scene.views[window.id].selections.push({ key: 'notes-body', noteId: 'note-1', start: 0, end: 1, direction: 'none' });
  expect(validateSavedSession(saved, profile).ok).toBe(false);
});

test('saved Windows desktop lease refers to its genuine declared shortcuts, not guessed File records', () => {
  const f = fixture(), saved = savedFixture(f), scene = saved.locals[0].scene;
  scene.desktop.selectedFileIds = ['pc'];
  scene.desktop.selectionAnchorId = 'pc';
  scene.desktop.positions.pc = { x: 12, y: 40 };
  expect(validateSavedSession(saved, profile)).toEqual({ ok: true });
  scene.desktop.selectedFileIds.push('fabricated-shortcut');
  expect(validateSavedSession(saved, profile).ok).toBe(false);
});

for (const mutation of ['missing', 'extra', 'app-loan', 'canonical-app-loan', 'unknown-state', 'selection-loan']) test(`saved original Explorer SDK state rejects ${mutation} ownership`, () => {
  const f = fixture(), saved = savedFixture(f), scene = saved.locals[0].scene;
  expect(validateSavedSession(saved, profile)).toEqual({ ok: true });
  if (mutation === 'missing') delete scene.windows11SdkWindows;
  if (mutation === 'extra') scene.windows11SdkWindows['explorer-window-9'] = structuredClone(scene.windows11SdkWindows[f.source.id]);
  if (mutation === 'app-loan') scene.windows11SdkWindows[f.source.id].appId = 'photos';
  if (mutation === 'canonical-app-loan') scene.windows11SdkWindows[f.source.id].appId = 'snipping';
  if (mutation === 'unknown-state') scene.windows11SdkWindows[f.source.id].state.sourceRecord = { name: 'not actual Explorer state' };
  if (mutation === 'selection-loan') scene.windows11SdkWindows[f.source.id].state.ui.selection = { appId: 'explorer', windowId: f.destination.id, control: 'explorer-search', start: 0, end: 0 };
  expect(validateSavedSession(saved, profile).ok).toBe(false);
});

test('every original non-native SDK model cold restores its real command state and captured mounted SVG without defaults', async () => {
  const f = fixture(), dom = new JSDOM('<!doctype html><section id=\"paint\"></section><section id=\"teams\"><input data-control=\"teams-search\"/></section>');
  const paintRoot = dom.window.document.querySelector('#paint');
  const paintView = createWindows11AppView(() => paintRoot, () => () => ({
    svg: new dom.window.XMLSerializer().serializeToString(paintRoot.querySelector('svg')), width: 640, height: 400,
  }));
  const teamsView = createWindows11AppView(() => dom.window.document.querySelector('#teams'));
  const added = ['paint', 'teams'].map((appId, index) => ({ id: `${appId}-window-${index + 3}`, appId }));
  for (const window of added) { f.windows.push(window); createWindows11AppWindow(f.apps, window.id, window.appId, { fresh: true }); }
  f.context.getApplicationView = id => id === added[0].id ? paintView : id === added[1].id ? teamsView : null;
  Object.assign(f.handlers, createWindows11AppCommands(f.apps, f.context));
  await f.handlers['win11.explorer.navigate']({ windowId: f.source.id, folderId: 'pictures' }, {});
  await f.handlers['win11.explorer.search']({ windowId: f.source.id }, { query: 'Studio' });
  const stroke = await f.handlers['win11.paint.stroke.begin']({ windowId: added[0].id }, { x: 12, y: 18, pointerId: 1 });
  expect(stroke.status).toBe('applied');
  await f.handlers['win11.paint.stroke.extend']({ windowId: added[0].id, strokeId: stroke.target.strokeId }, { x: 172, y: 108, pointerId: 1 });
  await f.handlers['win11.paint.stroke.end']({ windowId: added[0].id, strokeId: stroke.target.strokeId }, { pointerId: 1 });
  paintRoot.innerHTML = drawingSvg(windows11AppsForWindow(f.apps, added[0].id).paint);
  const paintSvg = paintRoot.querySelector('svg');
  const originalCapture = await paintView.captureSurface();
  expect(originalCapture.svg).toBe(new dom.window.XMLSerializer().serializeToString(paintSvg));
  expect((await f.handlers['win11.teams.page.set']({ windowId: added[1].id }, { page: 'people' })).status).toBe('applied');
  const saved = savedFixture(f), scene = saved.locals[0].scene;
  for (const window of added) {
    scene.windows.push({ ...window, title: window.appId, minimized: false, fullScreen: false, maximized: false,
      bounds: { x: 80, y: 56, width: 900, height: 620, scale: 1 }, restoreBounds: null });
    scene.views[window.id] = { scroll: [], selections: [], focusKey: null };
    scene.runningAppIds.push(window.appId); scene.switching.creationWindowIds.push(window.id);
  }
  scene.nextWindowId = 5;
  Object.assign(scene, snapshotWindows11SdkWindows(f.apps, scene.windows));
  expect(validateSavedSession(saved, profile)).toEqual({ ok: true });
  const roundtrip = rehydrateSavedSession(JSON.parse(JSON.stringify(projectSavedSession(saved, profile))), profile).locals[0].scene;
  const restored = createWindows11AppState(profile, roundtrip.seed);
  restoreWindows11SdkWindows(restored, roundtrip.windows, roundtrip);
  for (const window of roundtrip.windows) {
    const actual = windows11AppsForWindow(restored, window.id), original = windows11AppsForWindow(f.apps, window.id);
    expect(actual[window.appId]).toEqual(original[window.appId]);
    expect(actual.files).toBe(restored.files);
  }
  expect(windows11AppsForWindow(restored, f.source.id).explorer.search).toBe('Studio');
  expect(windows11AppsForWindow(restored, added[0].id).paint.strokes).toHaveLength(1);
  const restoredPaint = windows11AppsForWindow(restored, added[0].id).paint;
  const restoredPaintRoot = dom.window.document.createElement('section');
  dom.window.document.body.append(restoredPaintRoot);
  restoredPaintRoot.innerHTML = drawingSvg(restoredPaint);
  const restoredPaintView = createWindows11AppView(() => restoredPaintRoot, () => () => ({
    svg: new dom.window.XMLSerializer().serializeToString(restoredPaintRoot.querySelector('svg')),
    width: restoredPaint.width, height: restoredPaint.height,
  }));
  expect(await restoredPaintView.captureSurface()).toEqual(originalCapture);
  expect(windows11AppsForWindow(restored, added[1].id).teams.ui.page).toBe('people');
});

function paintSaveFixture(f, windowId) {
  return async (name, strokes) => {
    for (const [x, y] of strokes) {
      const stroke = await f.handlers['win11.paint.stroke.begin']({ windowId }, { x, y, pointerId: 1 });
      expect(stroke.status).toBe('applied');
      await f.handlers['win11.paint.stroke.end']({ windowId, strokeId: stroke.target.strokeId }, { pointerId: 1 });
    }
    expect((await f.handlers['win11.paint.dialog.open']({ windowId }, { dialog: 'save' })).status).toBe('applied');
    expect((await f.handlers['win11.paint.save.name']({ windowId }, { value: name })).status).toBe('applied');
    const saved = await f.handlers['win11.paint.save']({ windowId }, {});
    expect(saved.status).toBe('applied');
    return f.apps.files.find(row => row.id === saved.target.fileId);
  };
}

test('real Paint save publishes canonical Files metadata the shared bridge, seed contract and Messages attach consume byte-for-byte', async () => {
  const f = fixture(), paintWindow = { id: 'paint-window-3', appId: 'paint' };
  f.windows.push(paintWindow);
  createWindows11AppWindow(f.apps, paintWindow.id, 'paint', { fresh: true });
  const paint = windows11AppsForWindow(f.apps, paintWindow.id).paint;
  const save = paintSaveFixture(f, paintWindow.id);
  const file = await save('Studio sketch.svg', [[12, 18], [172, 108]]);
  expect([file.parentId, file.name, file.kind, file.deleted, file.revision])
    .toEqual(['pictures', 'Studio sketch.svg', 'image', false, 1]);
  expect([file.appId, file.icon, file.mime, file.encoding]).toEqual(['photos', 'image', 'image/svg+xml', 'utf8']);
  expect(file.content).toBe(drawingSvg(paint));
  // The actual raw Files store the SDK and Root share accepts the real producer
  // record, and the record conforms to the SceneSeed File required fields.
  expect(validateFilesystemStore(f.apps, profile)).toEqual({ ok: true });
  const fileSchema = sceneSeedSchema.properties.files.properties.files.items;
  expect(conforms(file, fileSchema)).toBe(true);
  // The real shared Files bridge resolves it for the Root chooser and Messages.
  const bridge = createApplicationFileBridges({ profile, getStore: () => f.apps, alive: () => true,
    getSceneTime: () => Date.parse(profile.defaults.sceneTime), canCommit: () => true });
  const read = bridge.readFile(file.id);
  expect(read.status).toBe('applied');
  expect([read.name, read.mime, read.text]).toEqual(['Studio sketch.svg', 'image/svg+xml', file.content]);
  expect(bridge.listFiles().files.some(row => row.id === file.id && row.mime === 'image/svg+xml')).toBe(true);
  const state = createMessagesState(profile);
  const messageWindow = { id: 'teams-window', appId: 'teams' };
  const view = { available: () => true, describe: () => ({ controlIds: [], focusedControl: null }),
    setPanel: async (_panel, _open, guard) => guard(), quickLookAttachment: async (_attachment, guard) => guard(),
    draftSelection: () => ({ start: 0, end: 0, direction: 'none', value: '' }), restoreDraftSelection: () => true };
  const controller = createMessagesCommands({ profile, getState: () => state, alive: () => true,
    getWindow: id => id === messageWindow.id ? messageWindow : null, getWindows: () => [messageWindow],
    getView: () => view, available: candidate => candidate === messageWindow, focusWindow: () => {}, settle: async () => {},
    getSceneTime: () => state.timeBase, onTimeChanged: () => {}, canCommit: () => true, getFile: bridge.getFile });
  const draftTarget = { windowId: messageWindow.id, draftId: state.selectedDraftId };
  expect((await controller.handlers['messages.draft.attach'](draftTarget, { fileId: file.id })).status).toBe('applied');
  const attachment = state.drafts.find(row => row.id === draftTarget.draftId).attachments[0];
  expect(validMessageAttachment(attachment)).toBe(true);
  expect([attachment.originalFileId, attachment.originalRevision, attachment.mime]).toEqual([file.id, 1, 'image/svg+xml']);
  expect(attachment.byteLength).toBe(new TextEncoder().encode(file.content).length);
  expect(attachmentContent(attachment)).toBe(file.content);
  expect(sendMessageDraft(state, draftTarget.draftId).status).toBe('applied');
  const message = state.conversations.find(row => row.id === state.selectedConversationId).items.at(-1);
  expect(message.attachments[0]).toEqual(attachment);
  // Overwrite keeps the identity and metadata, increments the revision, and
  // leaves the already-sent attachment's original bytes immutable.
  const original = structuredClone(file), attachmentSnapshot = structuredClone(attachment);
  const overwritten = await save('Studio sketch.svg', [[300, 250]]);
  expect(overwritten).toBe(file);
  expect(file.revision).toBe(2);
  expect([file.appId, file.icon, file.mime, file.encoding]).toEqual(['photos', 'image', 'image/svg+xml', 'utf8']);
  expect(file.content).toBe(drawingSvg(paint));
  expect(file.content).not.toBe(original.content);
  expect(attachment).toEqual(attachmentSnapshot);
  expect(attachment.originalRevision).toBe(1);
  expect(attachmentContent(attachment)).toBe(original.content);
  expect(bridge.readFile(file.id).text).toBe(file.content);
});


import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { createDefaultSceneSeed } from '../frontend/src/scene-seed.js';
import { createSavedSessionCommands, validateSavedSession, savedSessionStorageKey, clearSavedSession } from '../frontend/src/saved-session.js';
import { savedSessionCatalog } from '../frontend/src/saved-session-catalog.js';
import { createFeatureCommands } from '../frontend/src/feature-commands.js';
import { desktopViewDefaults } from '../frontend/src/desktop-context-model.js';
import { desktopStacksDefaults, desktopStacks } from '../frontend/src/desktop-stacks-model.js';
import { macDesktopItems } from '../frontend/src/desktop-file-state.js';
import { spacesDefaults, spacesItems } from '../frontend/src/spaces.js';
import { applicationBundleId, createMacApplicationFiles } from '../frontend/src/mac-application-files.js';
import { finderPresentationDefaults, notesPresentationDefaults } from '../frontend/src/viewing-state.js';
import { draftPreview, createCommunicationDraft, submitCommunicationDraft, communicationEntry } from '../frontend/src/communication-state.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');
const bounds = () => ({ x: 140, y: 80, width: 848, height: 592, scale: 0.8 });
const emptyView = () => ({ scroll: [], selections: [], focusKey: null });
function root(userId = 'local-alex') {
  const seed = createDefaultSceneSeed(profile);
  const id = userId === 'local-casey' ? 'local-casey--messages' : 'messages';
  const { overview, ...spaces } = spacesDefaults();
  const { focusedStackId, ...stacks } = desktopStacksDefaults();
  const catalogTimes = Object.fromEntries(createMacApplicationFiles(profile, seed.files.sceneTime)
    .map(({ id, createdAt, modifiedAt, addedAt, lastOpenedAt }) => [id, { createdAt, modifiedAt, addedAt, lastOpenedAt }]));
  return { seed, catalogTimes, windows: [{ id, appId: 'messages', title: 'Messages', minimized: false, fullScreen: false, zoomed: false,
    bounds: bounds(), restoreBounds: null, spaceId: 'desktop-1' }], closedWindows: {}, views: { [id]: {
    scroll: [{ key: 'messages-conversations', top: 32, left: 0 }, { key: 'messages-thread', top: 90, left: 0 }], selections: [], focusKey: null } },
  nextWindowId: 2, activeWindowId: id, activeAppId: 'messages', runningAppIds: ['finder', 'messages'],
  switching: { activationAppIds: ['messages'], activationWindowIds: [id], creationWindowIds: [id], hiddenAppIds: [] },
  spaces, splitViews: [], desktop: { selectedFileIds: ['itinerary'], selectionAnchorId: 'itinerary', positions: { itinerary: { x: 640, y: 24 } },
    sortBy: 'none', viewOptions: desktopViewDefaults('macos', 'golden-gate'), stacks },
  dockOrder: { mainOrderAppIds: [...seed.dock.mainOrderAppIds], secondaryOrderItemIds: [...seed.dock.secondaryOrderItemIds] },
  notesScroll: { list: { top: 10, left: 0 }, editor: { top: 80, left: 0 } } };
}
function fixture(twoUsers = false) {
  return { version: 1, profileId: profile.id, baseline: { source: 'default', seed: createDefaultSceneSeed(profile) },
    locals: [{ userId: 'local-alex', scene: root() }, ...(twoUsers ? [{ userId: 'local-casey', scene: root('local-casey') }] : [])] };
}
function addWindow(scene, appId, fields = {}, userId = 'local-alex') {
  const allocation = scene.nextWindowId++;
  const id = fields.id ?? `${userId === 'local-casey' ? 'local-casey--' : ''}${appId}-window-${allocation}`;
  const window = { id, appId, title: profile.applications[appId].name, minimized: false, fullScreen: false, zoomed: false,
    bounds: bounds(), restoreBounds: null, spaceId: scene.spaces.lastDesktopId,
    ...(appId === 'finder' ? { folderId: 'desktop' } : {}), ...(appId === 'settings' ? { settingsPane: 'dock' } : {}),
    ...(!fields.utilityKind && appId === 'finder' ? { finderPresentation: finderPresentationDefaults(),
      finderBrowseMode: scene.seed.viewing.finder.folderViews.desktop?.mode ?? 'icons' } : {}),
    ...(!fields.utilityKind && appId === 'notes' ? { notesPresentation: notesPresentationDefaults(scene.seed.viewing.notes.mode) } : {}), ...fields };
  scene.windows.push(window);
  scene.views[id] = emptyView();
  if (!scene.runningAppIds.includes(appId)) scene.runningAppIds.push(appId);
  const recent = scene.seed.dock.preferences.showRecent
    ? scene.seed.dock.recentHistory.filter(entry => !scene.seed.dock.pinnedAppIds.includes(entry.appId)).slice(0, 3).map(entry => entry.appId) : [];
  if (!scene.dockOrder.mainOrderAppIds.includes(appId) && !recent.includes(appId)) scene.dockOrder.mainOrderAppIds.push(appId);
  if (window.minimized) scene.dockOrder.secondaryOrderItemIds.push(`window:${id}`);
  scene.switching.creationWindowIds.push(id);
  return window;
}
function remember(scene, appId, fields = {}, view = emptyView()) {
  const window = addWindow(scene, appId, fields);
  scene.windows.pop();
  scene.switching.creationWindowIds.pop();
  delete scene.views[window.id];
  scene.closedWindows[appId] = { window, view };
  return window;
}
function refreshSpaces(scene) {
  scene.spaces.order = spacesItems(scene.spaces, { splitViews: scene.splitViews }, scene.windows, profile, scene.switching.hiddenAppIds).map(item => item.spaceId);
}
function renameWindow(scene, window, id) {
  const previous = window.id;
  window.id = id;
  scene.views[id] = scene.views[previous]; delete scene.views[previous];
  if (scene.activeWindowId === previous) scene.activeWindowId = id;
  for (const key of ['activationWindowIds', 'creationWindowIds']) scene.switching[key] = scene.switching[key].map(value => value === previous ? id : value);
}
const validate = snapshot => validateSavedSession(snapshot, profile);
function rejects(change) {
  const snapshot = fixture();
  change(snapshot, snapshot.locals[0].scene);
  const before = structuredClone(snapshot);
  expect(validate(snapshot).ok).toBe(false);
  expect(snapshot).toEqual(before);
}
function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[savedSessionStorageKey(profile), initial]]);
  const calls = [];
  return { values, calls,
    getItem(key) { calls.push(['get', key]); return values.get(key) ?? null; },
    setItem(key, value) { calls.push(['set', key]); values.set(key, value); },
    removeItem(key) { calls.push(['remove', key]); values.delete(key); },
  };
}
function commands({ storage = memoryStorage(), beforeCapture, capture = async () => fixture(), replace = async () => {}, available = () => true, selectedProfile = profile } = {}) {
  return createSavedSessionCommands({ profile: selectedProfile, available, storage: () => storage, beforeCapture, capture, replace });
}
const execute = (handlers, action, target = {}, payload = {}) => handlers[`scene.session.${action}`](target, payload);

function localDraft(scene, kind, fields, attachments = []) {
  const preview = draftPreview(scene.seed.communications, kind, fields, attachments);
  expect(preview).not.toBeNull();
  expect(createCommunicationDraft(scene.seed.communications, preview).status).toBe('applied');
  return preview.id;
}
function serviceView(entry, field, end = entry.fields[field].length) {
  return { scroll: [{ key: 'service-panel', recordId: entry.id, top: 245, left: 7 }],
    selections: [{ key: `service-${field}`, noteId: null, recordId: entry.id, start: 0, end, direction: 'backward' }],
    focusKey: `service-${field}` };
}

test('service caret, focus and scroll tokens retain exact selected contact/mail/message field ownership', () => {
  const snapshot = fixture(), scene = snapshot.locals[0].scene;
  localDraft(scene, 'contact', { name: 'Casey \u{1D11E}', email: 'local@example.test', phone: '', notes: ' contact\r\nbytes ' });
  const contacts = addWindow(scene, 'contacts');
  scene.views[contacts.id] = serviceView(communicationEntry(scene.seed.communications, 'contacts'), 'name');
  localDraft(scene, 'mail', { to: 'local@example.test', subject: 'Local', body: ' body\r\n\u{1D11E} bytes ' });
  const mail = addWindow(scene, 'mail');
  scene.views[mail.id] = serviceView(communicationEntry(scene.seed.communications, 'mail'), 'body');
  localDraft(scene, 'message', { to: 'fictional endpoint', body: 'local \u{1D11E} message' });
  scene.views.messages = serviceView(communicationEntry(scene.seed.communications, 'messages'), 'body');
  expect(validate(snapshot)).toEqual({ ok: true });
  const restored = JSON.parse(JSON.stringify(snapshot));
  expect(restored.locals[0].scene.views).toEqual(scene.views);
  expect(restored.locals[0].scene.seed.communications).toEqual(scene.seed.communications);
  expect(validate(restored)).toEqual({ ok: true });
  const empty = fixture(), emptyScene = empty.locals[0].scene;
  const emptyMail = addWindow(emptyScene, 'mail');
  emptyScene.views[emptyMail.id].scroll = [{ key: 'service-panel', recordId: null, top: 0, left: 0 }];
  expect(validate(empty)).toEqual({ ok: true });
});

test('service retained views reject mismatched entities, fields, channels, UTF-16 bounds and missing scroll identity', () => {
  for (const mutate of [
    view => { delete view.selections[0].recordId; },
    view => { view.selections[0].recordId = 'service-draft-missing'; },
    view => { view.selections[0].noteId = 'note-1'; },
    view => { view.selections[0].key = 'service-email'; },
    view => { view.selections[0].key = 'notes-body'; },
    view => { view.selections[0].end++; },
    view => { view.selections[0].start = view.selections[0].end + 1; },
    view => { view.focusKey = 'service-subject'; },
    view => { view.scroll[0].recordId = 'service-draft-missing'; },
    view => { delete view.scroll[0].recordId; },
    view => { view.scroll[0].key = 'messages-thread'; },
  ]) {
    const snapshot = fixture(), scene = snapshot.locals[0].scene;
    localDraft(scene, 'mail', { to: 'fictional', subject: '', body: '\u{1D11E} local' });
    const window = addWindow(scene, 'mail');
    scene.views[window.id] = serviceView(communicationEntry(scene.seed.communications, 'mail'), 'body');
    mutate(scene.views[window.id]);
    const before = structuredClone(snapshot);
    expect(validate(snapshot).ok).toBe(false); expect(snapshot).toEqual(before);
  }
  for (const change of [
    (_, scene) => { localDraft(scene, 'message', { to: 'fictional', body: 'real' }); },
    (_, scene) => { scene.views.messages.scroll = [{ key: 'service-panel', recordId: null, top: 0, left: 0 }]; },
    (_, scene) => { const window = addWindow(scene, 'contacts'); scene.views[window.id].selections = [
      { key: 'service-name', noteId: null, recordId: 'missing', start: 0, end: 0, direction: 'none' }]; },
    (_, scene) => { const window = addWindow(scene, 'notes'); scene.views[window.id].selections = [
      { key: 'notes-title', noteId: 'note-1', recordId: 'service-draft-1', start: 0, end: 1, direction: 'none' }]; },
    (_, scene) => { scene.views.messages.scroll[0].recordId = null; },
  ]) rejects(change);
});

test('closed service windows keep the exact saved entity caret and reject an old token for a new selection', () => {
  const snapshot = fixture(), scene = snapshot.locals[0].scene;
  const first = localDraft(scene, 'contact', { name: 'First', email: '', phone: '', notes: 'native bytes' });
  const recordId = submitCommunicationDraft(scene.seed.communications, first).target.recordId;
  const contact = communicationEntry(scene.seed.communications, 'contacts');
  remember(scene, 'contacts', {}, serviceView(contact, 'notes'));
  expect(contact.id).toBe(recordId); expect(validate(snapshot)).toEqual({ ok: true });
  localDraft(scene, 'contact', { name: 'Second', email: '', phone: '', notes: 'other bytes' });
  const before = structuredClone(snapshot);
  expect(validate(snapshot).ok).toBe(false); expect(snapshot).toEqual(before);
  scene.closedWindows.contacts.view = serviceView(communicationEntry(scene.seed.communications, 'contacts'), 'name');
  expect(validate(snapshot)).toEqual({ ok: true });
});

test('saved communication records and snapshot bytes round-trip independently across baseline and both local users', async () => {
  const snapshot = fixture(true);
  for (const [index, local] of snapshot.locals.entries()) {
    const scene = local.scene, source = scene.seed.files.files.find(file => file.kind === 'document');
    const attachment = { fileId: source.id, name: source.name, revision: source.revision, content: `\ufeff user ${index}\r\n\u{1D11E} exact bytes ` };
    const draftId = localDraft(scene, 'mail', { to: `local-${index}@example.test`, subject: '', body: ` body ${index}\r\n ` }, [attachment]);
    expect(submitCommunicationDraft(scene.seed.communications, draftId).status).toBe('applied');
    source.content = 'Changed after composition'; source.revision++; source.deleted = true;
    scene.desktop.selectedFileIds = scene.desktop.selectedFileIds.filter(id => id !== source.id);
    if (scene.desktop.selectionAnchorId === source.id) scene.desktop.selectionAnchorId = null;
    delete scene.desktop.positions[source.id];
    const mail = addWindow(scene, 'mail', {}, local.userId);
    scene.views[mail.id] = serviceView(communicationEntry(scene.seed.communications, 'mail'), 'body');
  }
  expect(snapshot.baseline.seed.communications.outbox).toEqual([]);
  const expected = structuredClone(snapshot), storage = memoryStorage(); let restored;
  const handlers = commands({ storage, capture: async () => snapshot, replace: async value => { restored = value; } });
  expect((await execute(handlers, 'save')).status).toBe('applied');
  const persisted = JSON.parse(storage.values.get(savedSessionStorageKey(profile)));
  expect(persisted).toEqual(expected); expect(validate(persisted)).toEqual({ ok: true });
  snapshot.locals[0].scene.seed.communications.outbox[0].attachments[0].content = 'Later current edit';
  expect((await execute(handlers, 'restore')).status).toBe('applied');
  expect(restored).toEqual(expected);
  expect(restored.locals[0].scene.seed.communications.outbox[0].attachments[0].content).toBe('\ufeff user 0\r\n\u{1D11E} exact bytes ');
  expect(restored.locals[1].scene.seed.communications.outbox[0].attachments[0].content).toBe('\ufeff user 1\r\n\u{1D11E} exact bytes ');
  const incomplete = structuredClone(expected); delete incomplete.baseline.seed.communications;
  expect(validate(incomplete).ok).toBe(false);
  expect(validate(new Proxy(expected, {})).ok).toBe(false);
});

// Fixtures use the same exported defaults and original App window records as
// consumers, not schema/source snapshots or private validator helpers.
test('live and remembered printer queue viewports belong only to actual Print Center windows', () => {
  const snapshot = fixture(), scene = snapshot.locals[0].scene;
  const printer = addWindow(scene, 'printcenter');
  scene.views[printer.id].scroll = [{ key: 'printing-queue', top: 245, left: 0 }];
  expect(validate(snapshot).ok).toBe(true);
  scene.views.messages.scroll.push({ key: 'printing-queue', top: 245, left: 0 });
  const before = structuredClone(snapshot);
  expect(validate(snapshot).ok).toBe(false);
  expect(snapshot).toEqual(before);
  scene.views.messages.scroll.pop();
  const remembered = fixture();
  remember(remembered.locals[0].scene, 'printcenter', {},
    { scroll: [{ key: 'printing-queue', top: 310, left: 0 }], selections: [], focusKey: null });
  expect(validate(remembered).ok).toBe(true);
});

test('complete one- and two-local snapshots preserve distinct baseline/current data and accept empty live scenes', () => {
  const snapshot = fixture(true);
  snapshot.baseline.source = 'replacement';
  snapshot.baseline.seed.messages.thread.name = 'Original baseline';
  snapshot.locals[0].scene.seed.notes.notes[0].text = 'Alex retained edit';
  snapshot.locals[1].scene.seed.notes.notes[0].text = 'Casey retained edit';
  expect(validate(snapshot)).toEqual({ ok: true });
  const scene = snapshot.locals[1].scene;
  scene.windows = []; scene.views = {}; scene.activeWindowId = null; scene.activeAppId = 'finder'; scene.runningAppIds = ['finder'];
  scene.switching = { activationAppIds: [], activationWindowIds: [], creationWindowIds: [], hiddenAppIds: [] };
  scene.seed.notes.notes = []; scene.seed.notes.selectedId = null;
  scene.seed.messages.pinned = []; scene.seed.messages.conversations = []; scene.seed.messages.thread.items = [];
  expect(validate(snapshot)).toEqual({ ok: true });
});

test('generated readonly directories/bundles, utility metadata and closed zoom geometry remain legitimate', () => {
  const snapshot = fixture(), scene = snapshot.locals[0].scene;
  const bundle = createMacApplicationFiles(profile).find(file => file.id === applicationBundleId('notes'));
  const finder = addWindow(scene, 'finder', { folderId: bundle.parentId, finderSelectedFileIds: [bundle.id] });
  scene.views[finder.id].scroll = [{ key: 'finder-contents', top: 200, left: 16 }, { key: 'window-content', top: 0, left: 0 }];
  const info = addWindow(scene, 'finder', { utilityKind: 'desktop-info', fileId: bundle.id, infoSections: { general: true, name: false } });
  delete info.folderId;
  scene.views[info.id].scroll = [{ key: 'desktop-info', top: 20, left: 0 }, { key: 'window-content', top: 0, left: 0 }];
  const options = addWindow(scene, 'finder', { utilityKind: 'desktop-view-options' }); delete options.folderId;
  scene.views[options.id].scroll = [{ key: 'desktop-view-options', top: 40, left: 0 }, { key: 'window-content', top: 0, left: 0 }];
  const settings = addWindow(scene, 'settings', { settingsPane: 'appearance' });
  scene.views[settings.id].scroll = [{ key: 'settings-appearance', top: 120, left: 0 }, { key: 'window-content', top: 0, left: 0 }];
  const closed = remember(scene, 'preview', { fileId: 'itinerary', zoomed: true, restoreBounds: bounds() }, {
    scroll: [{ key: 'window-content', top: 30, left: 0 }], selections: [], focusKey: null });
  scene.spaces.nextDesktopId = 4; closed.spaceId = 'desktop-3';
  expect(validate(snapshot)).toEqual({ ok: true });
  finder.folderId = 'file-removed-folder'; finder.finderSelectedFileIds = ['file-removed-child'];
  expect(validate(snapshot)).toEqual({ ok: true });
  finder.folderId = 'personal'; finder.finderSelectedFileIds = [];
  scene.seed.files.files.find(file => file.id === 'personal').deleted = true;
  expect(validate(snapshot)).toEqual({ ok: true });
});

test('retained readonly Notes selections allow existing prior notes and bounded offsets for native clamping', () => {
  const snapshot = fixture(), scene = snapshot.locals[0].scene, window = addWindow(scene, 'notes');
  scene.views[window.id] = { scroll: [{ key: 'notes-list', top: 90000, left: 0 }, { key: 'notes-body', top: 80000, left: 40 }],
    selections: [{ key: 'notes-title', noteId: 'note-4', start: 0, end: 10000, direction: 'backward' },
      { key: 'notes-body', noteId: 'note-1', start: 4, end: 100000, direction: 'forward' },
      { key: 'notes-search', noteId: null, start: 0, end: 10, direction: 'none' }], focusKey: 'notes-body' };
  expect(validate(snapshot)).toEqual({ ok: true });
});

test('actual full-screen/Split View spaces preserve home desktops and visible eligible membership', () => {
  const snapshot = fixture(), scene = snapshot.locals[0].scene, messages = scene.windows[0], notes = addWindow(scene, 'notes');
  scene.spaces.desktops.push({ id: 'desktop-2' }); scene.spaces.nextDesktopId = 3;
  notes.spaceId = 'desktop-2'; notes.fullScreen = true; messages.fullScreen = true;
  scene.splitViews = [{ leftWindowId: messages.id, rightWindowId: notes.id, ratio: 0.65 }];
  refreshSpaces(scene);
  scene.spaces.activeSpaceId = scene.spaces.order.find(id => id.startsWith('split:'));
  expect(validate(snapshot)).toEqual({ ok: true });
  scene.splitViews = []; scene.activeWindowId = null; scene.spaces.activeSpaceId = 'desktop-1';
  notes.minimized = true; scene.switching.hiddenAppIds = ['messages'];
  scene.dockOrder.secondaryOrderItemIds.push(`window:${notes.id}`);
  refreshSpaces(scene);
  expect(validate(snapshot)).toEqual({ ok: true });
});

test('closed envelopes reject partial/cross-profile/auth/power/Guest state without touching input', () => {
  for (const change of [
    snapshot => { snapshot.version = 2; }, snapshot => { snapshot.profileId = 'macos-sonoma-14.0'; },
    snapshot => { delete snapshot.baseline; }, snapshot => { snapshot.baseline.source = 'restore'; },
    snapshot => { snapshot.auth = { signedIn: true }; }, snapshot => { snapshot.session = { passcode: '12345' }; },
    snapshot => { snapshot.locals[0].passcode = '12345'; }, snapshot => { snapshot.locals[0].userId = 'guest'; },
    snapshot => { snapshot.locals = [{ userId: 'local-casey', scene: root('local-casey') }]; },
    snapshot => { snapshot.locals.push(structuredClone(snapshot.locals[0])); },
    (_, scene) => { scene.power = { phase: 'desktop' }; }, (_, scene) => { scene.desktop.context = null; },
    (_, scene) => { delete scene.notesScroll.editor; }, (_, scene) => { scene.windows[0].passwordDraft = ''; },
    (_, scene) => { scene.views.messages.focusKey = 'password'; },
  ]) rejects(change);
});

test('every baseline and current seed uses existing graph/Notes/Dock invariants atomically', () => {
  for (const change of [
    snapshot => { snapshot.baseline.seed.files.files.find(file => file.id === 'personal').parentId = 'missing'; },
    snapshot => { snapshot.baseline.seed.notes.selectedId = 'missing'; },
    (_, scene) => { scene.seed.dock.mainOrderAppIds.reverse(); },
    (_, scene) => { scene.seed.notes.selectedId = 'note-4'; },
    (_, scene) => { scene.seed.files.nextFileId = 0; },
    (_, scene) => { scene.seed.files.files.find(file => file.id === 'personal').id = 'mac-application-folder:Applications'; },
  ]) rejects(change);
  const snapshot = fixture(true);
  snapshot.locals[1].scene.seed.dock.pinnedAppIds.push('unregistered');
  expect(validate(snapshot).ok).toBe(false);
});

test('readonly catalog timestamps preserve original/opened times without permitting catalog replacement', () => {
  const snapshot = fixture(), scene = snapshot.locals[0].scene, id = applicationBundleId('notes');
  const initial = scene.catalogTimes[id].createdAt;
  scene.seed.files.sceneTime += 60000;
  scene.catalogTimes[id].lastOpenedAt = initial + 30000;
  expect(validate(snapshot)).toEqual({ ok: true });
  expect(scene.catalogTimes[id].createdAt).toBe(initial);
  scene.catalogTimes[id].createdAt = 8_640_000_000_000_000 - 1;
  expect(validate(snapshot)).toEqual({ ok: true });
  for (const change of [
    (_, root) => { delete root.catalogTimes[id]; },
    (_, root) => { root.catalogTimes['mac-application:unknown'] = structuredClone(root.catalogTimes[id]); },
    (_, root) => { root.catalogTimes[id].name = 'Overridden.app'; },
    (_, root) => { root.catalogTimes[id].appId = 'safari'; },
    (_, root) => { root.catalogTimes[id].lastOpenedAt = -1; },
    (_, root) => { root.catalogTimes[id].modifiedAt = 8_640_000_000_000_000; },
    (_, root) => { root.catalogTimes[id].addedAt = 0.5; },
  ]) rejects(change);
});

test('bounded maximum live windows and safe next-allocation counters accept real retained snapshots', () => {
  const snapshot = fixture(), scene = snapshot.locals[0].scene;
  for (let index = 0; index < 1023; index++) addWindow(scene, 'finder');
  expect(validate(snapshot)).toEqual({ ok: true });
  scene.nextWindowId = Number.MAX_SAFE_INTEGER - 1;
  scene.spaces.nextDesktopId = Number.MAX_SAFE_INTEGER - 1;
  expect(validate(snapshot)).toEqual({ ok: true });
});

test('namespace, app identity, monotonic allocation, live membership and window geometry corruptions reject', () => {
  for (const change of [
    (_, scene) => { renameWindow(scene, scene.windows[0], 'local-casey--messages'); },
    (_, scene) => { renameWindow(scene, scene.windows[0], 'notes'); },
    (_, scene) => { scene.windows[0].appId = 'unregistered'; },
    (_, scene) => { scene.windows[0].appId = 'notes'; },
    (_, scene) => { scene.nextWindowId = 1; }, (_, scene) => { scene.nextWindowId = Number.MAX_SAFE_INTEGER; },
    (_, scene) => { addWindow(scene, 'finder', { id: 'finder-window-01' }); },
    (_, scene) => { addWindow(scene, 'finder', { id: 'finder-window-1' }); },
    (_, scene) => { addWindow(scene, 'messages'); },
    (_, scene) => { scene.windows.push(structuredClone(scene.windows[0])); },
    (_, scene) => { scene.runningAppIds = ['finder']; },
    (_, scene) => { scene.runningAppIds.push('unregistered'); },
    (_, scene) => { scene.runningAppIds.push('messages'); },
    (_, scene) => { scene.windows[0].bounds.scale = 0; },
    (_, scene) => { scene.windows[0].bounds.width = -1; },
    (_, scene) => { scene.windows[0].zoomed = true; },
    (_, scene) => { scene.windows[0].restoreBounds = bounds(); },
    (_, scene) => { scene.windows[0].settingsPane = 'dock'; },
    (_, scene) => { addWindow(scene, 'settings', { settingsPane: 'mission-control' }); },
    (_, scene) => { scene.windows[0].utilityKind = 'desktop-view-options'; },
    (_, scene) => { addWindow(scene, 'finder', { folderId: 'itinerary' }); },
    (_, scene) => { addWindow(scene, 'finder', { folderId: '../../unsafe' }); },
    (_, scene) => { addWindow(scene, 'finder', { finderSelectedFileIds: ['missing'] }); },
    (_, scene) => { addWindow(scene, 'finder', { utilityKind: 'desktop-info', folderId: 'desktop', fileId: 'itinerary', infoSections: { general: true, name: true } }); },
    (_, scene) => { addWindow(scene, 'preview', { fileId: 'missing' }); },
  ]) rejects(change);
  const snapshot = fixture(true);
  snapshot.locals[1].scene.windows[0].id = 'messages';
  expect(validate(snapshot).ok).toBe(false);
});

test('closed ordinary-app records reject live duplicates, utilities, stale metadata and wrong remembered apps', () => {
  for (const change of [
    (_, scene) => { remember(scene, 'messages'); },
    (_, scene) => { remember(scene, 'preview', { minimized: true }); },
    (_, scene) => { remember(scene, 'preview', { fullScreen: true }); },
    (_, scene) => { remember(scene, 'preview'); scene.closedWindows.notes = scene.closedWindows.preview; delete scene.closedWindows.preview; },
    (_, scene) => { remember(scene, 'finder', { utilityKind: 'desktop-view-options' }); },
    (_, scene) => { const info = addWindow(scene, 'finder', { utilityKind: 'desktop-info', fileId: 'missing', infoSections: { general: true, name: true } }); delete info.folderId; },
    (_, scene) => { const info = addWindow(scene, 'finder', { utilityKind: 'desktop-info', fileId: 'itinerary', infoSections: { general: true, name: true, sharing: true } }); delete info.folderId; },
  ]) rejects(change);
});

test('views and switching histories reject stale IDs, foreign semantic controls and invalid note selections', () => {
  for (const change of [
    (_, scene) => { scene.views.missing = emptyView(); }, (_, scene) => { delete scene.views.messages; },
    (_, scene) => { scene.activeWindowId = 'missing'; }, (_, scene) => { scene.activeAppId = 'finder'; },
    (_, scene) => { scene.windows[0].minimized = true; }, (_, scene) => { scene.switching.hiddenAppIds = ['messages']; },
    (_, scene) => { scene.switching.creationWindowIds = []; },
    (_, scene) => { scene.switching.creationWindowIds.push('missing'); },
    (_, scene) => { scene.switching.activationWindowIds.push('missing'); },
    (_, scene) => { scene.switching.activationAppIds.push('notes'); },
    (_, scene) => { scene.switching.hiddenAppIds.push('notes'); },
    (_, scene) => { scene.views.messages.scroll.push({ key: 'messages-thread', top: 0, left: 0 }); },
    (_, scene) => { scene.views.messages.scroll[0].key = '[type=password]'; },
    (_, scene) => { scene.views.messages.scroll[0].key = 'notes-list'; },
    (_, scene) => { scene.views.messages.scroll[0].top = -1; },
    (_, scene) => { scene.views.messages.scroll[0].left = Infinity; },
    (_, scene) => { const notes = addWindow(scene, 'notes'); scene.views[notes.id].selections = [{ key: 'notes-title', noteId: 'missing', start: 0, end: 1, direction: 'none' }]; },
    (_, scene) => { const notes = addWindow(scene, 'notes'); scene.views[notes.id].selections = [{ key: 'notes-search', noteId: 'note-1', start: 0, end: 1, direction: 'none' }]; },
    (_, scene) => { const notes = addWindow(scene, 'notes'); scene.views[notes.id].selections = [{ key: 'notes-body', noteId: 'note-1', start: 2, end: 1, direction: 'none' }]; },
  ]) rejects(change);
});

test('Space counters/membership/order and exclusive eligible Split View pairs reject corruption', () => {
  for (const change of [
    (_, scene) => { scene.spaces.desktops.push({ id: 'desktop-1' }); },
    (_, scene) => { scene.spaces.desktops = []; },
    (_, scene) => { scene.spaces.nextDesktopId = 1; },
    (_, scene) => { scene.spaces.nextDesktopId = Number.MAX_SAFE_INTEGER; },
    (_, scene) => { scene.spaces.desktops[0].id = 'desktop-02'; },
    (_, scene) => { scene.spaces.lastDesktopId = 'desktop-2'; },
    (_, scene) => { scene.windows[0].spaceId = 'desktop-2'; },
    (_, scene) => { scene.spaces.order.push('full:missing'); },
    (_, scene) => { scene.spaces.activeSpaceId = 'desktop-2'; },
    (_, scene) => { scene.windows[0].fullScreen = true; },
    (_, scene) => { scene.splitViews = [{ leftWindowId: 'messages', rightWindowId: 'missing', ratio: 0.5 }]; },
    (_, scene) => { scene.splitViews = [{ leftWindowId: 'messages', rightWindowId: 'messages', ratio: 0.5 }]; },
    (_, scene) => { scene.splitViews = [{ leftWindowId: 'messages', rightWindowId: addWindow(scene, 'notes').id, ratio: 0.5 }]; },
  ]) rejects(change);
  const snapshot = fixture(), scene = snapshot.locals[0].scene;
  const notes = addWindow(scene, 'notes'), safari = addWindow(scene, 'safari');
  for (const window of scene.windows) window.fullScreen = true;
  scene.activeWindowId = null;
  scene.splitViews = [{ leftWindowId: 'messages', rightWindowId: notes.id, ratio: 0.5 }];
  refreshSpaces(scene);
  expect(validate(snapshot).ok).toBe(true);
  scene.splitViews.push({ leftWindowId: notes.id, rightWindowId: safari.id, ratio: 0.5 });
  expect(validate(snapshot).ok).toBe(false);
  scene.splitViews.pop(); scene.splitViews[0].ratio = 0.9;
  expect(validate(snapshot).ok).toBe(false);
  scene.splitViews[0].ratio = 0.5; scene.switching.hiddenAppIds = ['notes']; refreshSpaces(scene);
  expect(validate(snapshot).ok).toBe(false);
});

test('desktop selection/positions/Stack membership and bounded complete arrays reject stale data', () => {
  for (const change of [
    (_, scene) => { scene.desktop.selectedFileIds.push('missing'); },
    (_, scene) => { scene.desktop.selectionAnchorId = 'missing'; },
    (_, scene) => { scene.desktop.positions.missing = { x: 1, y: 1 }; },
    (_, scene) => { scene.desktop.positions.itinerary.x = -1; },
    (_, scene) => { scene.desktop.viewOptions.gridSpacing = 65; },
    (_, scene) => { scene.desktop.stacks.expandedStackIds = ['stack:kind:missing']; },
    (_, scene) => { scene.desktop.stacks.topFileIds['stack:kind:missing'] = 'itinerary'; },
    (_, scene) => { scene.notesScroll.editor.top = -1; },
    (_, scene) => { scene.windows = Array.from({ length: 1025 }, () => structuredClone(scene.windows[0])); },
    (_, scene) => { scene.spaces.desktops = Array.from({ length: 17 }, (_, index) => ({ id: `desktop-${index + 1}` })); },
  ]) rejects(change);
  const snapshot = fixture(), scene = snapshot.locals[0].scene;
  scene.desktop.stacks.enabled = true;
  const groups = desktopStacks(macDesktopItems(scene.seed.files), scene.desktop.stacks, scene.seed.files.sceneTime);
  scene.desktop.stacks.expandedStackIds = [groups[0].id];
  scene.desktop.stacks.topFileIds = { [groups[0].id]: groups[0].topFileId };
  expect(validate(snapshot)).toEqual({ ok: true });
});

test('live Dock order preserves unpinned running aliases and minimized tiles separately from the seed', () => {
  const snapshot = fixture(), scene = snapshot.locals[0].scene;
  const preview = addWindow(scene, 'preview', { minimized: true, fileId: 'itinerary' });
  expect(scene.seed.dock.mainOrderAppIds).not.toContain('preview');
  expect(validate(snapshot)).toEqual({ ok: true });
  for (const mutate of [
    order => { order.mainOrderAppIds = order.mainOrderAppIds.filter(id => id !== 'preview'); },
    order => { order.mainOrderAppIds.push('missing'); },
    order => { order.mainOrderAppIds.push('preview'); },
    order => { [order.mainOrderAppIds[0], order.mainOrderAppIds[1]] = [order.mainOrderAppIds[1], order.mainOrderAppIds[0]]; },
    order => { order.secondaryOrderItemIds = ['downloads']; },
    order => { order.secondaryOrderItemIds.push('window:missing'); },
  ]) {
    const corrupt = structuredClone(snapshot);
    mutate(corrupt.locals[0].scene.dockOrder);
    expect(validate(corrupt).ok).toBe(false);
  }
  scene.windows.find(window => window.id === preview.id).minimized = false;
  scene.dockOrder.secondaryOrderItemIds = ['downloads'];
  expect(validate(snapshot)).toEqual({ ok: true });
});


test('non-JSON input rejects without invoking getters or mutating sparse/cyclic/exotic values', () => {
  let invoked = 0;
  const accessor = fixture();
  Object.defineProperty(accessor.locals[0].scene, 'seed', { enumerable: true, get() { invoked++; throw new Error('Never execute this'); } });
  expect(validate(accessor).ok).toBe(false); expect(invoked).toBe(0);
  const symbol = fixture(); symbol.locals[0].scene[Symbol('auth')] = 'secret'; expect(validate(symbol).ok).toBe(false);
  const sparse = fixture(); sparse.locals.length = 2; expect(validate(sparse).ok).toBe(false);
  const cyclic = fixture(); cyclic.locals[0].scene.extra = cyclic; expect(validate(cyclic).ok).toBe(false);
  const exotic = fixture(); exotic.locals[0].scene.notesScroll = new Date(); expect(validate(exotic).ok).toBe(false);
  const hidden = fixture(); Object.defineProperty(hidden, 'auth', { value: true }); expect(validate(hidden).ok).toBe(false);
});

test('save/restore are explicit on-demand writes and resolve only after the validated replacement finishes', async () => {
  const snapshot = fixture(true), storage = memoryStorage();
  let captureCalls = 0, replaced = null, release;
  const mounted = new Promise(resolve => { release = resolve; });
  const handlers = commands({ storage, capture: async () => { captureCalls++; return snapshot; }, replace: async value => { replaced = value; await mounted; } });
  expect(storage.calls).toEqual([]); expect(captureCalls).toBe(0); expect(replaced).toBeNull();
  expect(await execute(handlers, 'save')).toEqual({ status: 'applied', target: { profileId: profile.id, version: 1, saved: true } });
  expect(captureCalls).toBe(1);
  expect(JSON.parse(storage.values.get(savedSessionStorageKey(profile)))).toEqual(snapshot);
  let settled = false;
  const restoring = execute(handlers, 'restore').then(result => { settled = true; return result; });
  await Promise.resolve();
  expect(replaced).toEqual(snapshot); expect(replaced).not.toBe(snapshot); expect(settled).toBe(false);
  release();
  expect(await restoring).toEqual({ status: 'applied', target: { profileId: profile.id, version: 1, saved: true } });
});

test('invalid captures/restores never overwrite storage or dispose/remount any current scene', async () => {
  for (const corrupt of [
    snapshot => { snapshot.profileId = 'macos-mojave-10.14'; },
    snapshot => { snapshot.locals[0].scene.nextWindowId = 1; },
    snapshot => { snapshot.locals[0].scene.views.missing = emptyView(); },
    snapshot => { snapshot.locals[0].scene.auth = { signedIn: true }; },
    snapshot => { snapshot.locals[0].scene.seed.files.files[0].parentId = 'missing'; },
  ]) {
    const value = fixture(); corrupt(value);
    const storage = memoryStorage('keep the original stored slot');
    let replaced = 0;
    const handlers = commands({ storage, capture: async () => value, replace: async () => { replaced++; } });
    expect((await execute(handlers, 'save')).error.code).toBe('invalid_arguments');
    expect(storage.values.get(savedSessionStorageKey(profile))).toBe('keep the original stored slot');
    expect(storage.calls).toEqual([]);
    storage.values.set(savedSessionStorageKey(profile), JSON.stringify(value));
    expect((await execute(handlers, 'restore')).error.code).toBe('invalid_arguments');
    expect(replaced).toBe(0); expect(JSON.parse(storage.values.get(savedSessionStorageKey(profile)))).toEqual(value);
  }
});

test('missing, malformed and oversized slots distinguish honest restore failures before replacement', async () => {
  let replaced = 0;
  const storage = memoryStorage(), handlers = commands({ storage, replace: async () => { replaced++; } });
  expect((await execute(handlers, 'restore')).error.code).toBe('not_found');
  storage.values.set(savedSessionStorageKey(profile), '{broken JSON');
  const malformed = await execute(handlers, 'restore');
  expect(malformed.error.code).toBe('invalid_arguments'); expect(malformed.error.message).toContain('malformed JSON');
  storage.values.set(savedSessionStorageKey(profile), '{'.repeat(2 * 1024 * 1024 + 1));
  const oversized = await execute(handlers, 'restore');
  expect(oversized.error.code).toBe('invalid_arguments'); expect(oversized.error.message).toContain('2 Mi');
  expect(replaced).toBe(0);
  const snapshot = fixture();
  snapshot.baseline.seed.notes.notes[0].text = 'x'.repeat(1024 * 1024);
  snapshot.locals[0].scene.seed.notes.notes[0].text = 'x'.repeat(1024 * 1024);
  const saving = commands({ storage, capture: async () => snapshot });
  const failure = await execute(saving, 'save');
  expect(failure.error.code).toBe('invalid_arguments'); expect(failure.error.message).toContain('2 Mi');
  expect(storage.values.get(savedSessionStorageKey(profile))).toHaveLength(2 * 1024 * 1024 + 1);
});

test('denied access, quota and removal failures remain distinguishable and never acknowledge success', async () => {
  function failure(name) { return Object.assign(new Error(name), { name }); }
  const inaccessible = createSavedSessionCommands({ profile, available: () => true, storage: () => { throw failure('SecurityError'); },
    capture: async () => fixture(), replace: async () => { throw new Error('Must not mount'); } });
  for (const action of ['save', 'restore', 'clear']) {
    const result = await execute(inaccessible, action);
    expect(result.error.code).toBe('unavailable'); expect(result.error.message).toContain('SecurityError');
  }
  const quota = memoryStorage('original'); quota.setItem = () => { throw failure('QuotaExceededError'); };
  const saving = await execute(commands({ storage: quota }), 'save');
  expect(saving.error.code).toBe('unavailable'); expect(saving.error.message).toContain('QuotaExceededError');
  expect(quota.values.get(savedSessionStorageKey(profile))).toBe('original');
  quota.removeItem = () => { throw failure('SecurityError'); };
  expect(clearSavedSession(quota, profile).ok).toBe(false);
  expect((await execute(commands({ storage: quota }), 'clear')).error.code).toBe('unavailable');
  expect(quota.values.get(savedSessionStorageKey(profile))).toBe('original');
});

test('pending capture readiness rejects save before capture while restore/clear stay available', async () => {
  const storage = memoryStorage(JSON.stringify(fixture()));
  let captures = 0, guards = 0, replacements = 0;
  const handlers = commands({ storage,
    beforeCapture: async () => { guards++; return { status: 'rejected', error: { code: 'unavailable', message: 'Pending native transition.' } }; },
    capture: async () => { captures++; return fixture(); }, replace: async () => { replacements++; } });
  expect((await execute(handlers, 'save')).error.code).toBe('unavailable');
  expect(guards).toBe(1); expect(captures).toBe(0); expect(storage.calls).toEqual([]);
  expect((await execute(handlers, 'restore')).status).toBe('applied');
  expect((await execute(handlers, 'clear')).status).toBe('applied');
  expect(guards).toBe(1); expect(replacements).toBe(1);
  const allowed = commands({ storage, beforeCapture: async () => ({ status: 'applied', target: {} }) });
  expect((await execute(allowed, 'save')).status).toBe('applied');
});

test('capture/readiness/remount programming failures propagate rather than masquerading as storage errors', async () => {
  await expect(execute(commands({ capture: async () => { throw new Error('capture failed'); } }), 'save')).rejects.toThrow('capture failed');
  await expect(execute(commands({ beforeCapture: async () => { throw new Error('guard failed'); } }), 'save')).rejects.toThrow('guard failed');
  await expect(execute(commands({ storage: memoryStorage(JSON.stringify(fixture())),
    replace: async () => { throw new Error('mount failed'); } }), 'restore')).rejects.toThrow('mount failed');
});

test('clear helper and command remove only the profile storage slot without capturing or mutating scene data', async () => {
  const scene = fixture(), before = structuredClone(scene), storage = memoryStorage('{malformed and clearable');
  storage.values.set('another-profile-key', 'untouched');
  const handlers = commands({ storage, capture: async () => { throw new Error('Must not capture on clear'); }, replace: async () => { throw new Error('Must not replace on clear'); } });
  expect(await execute(handlers, 'clear')).toEqual({ status: 'applied', target: { profileId: profile.id, version: 1, saved: false } });
  expect(storage.values.has(savedSessionStorageKey(profile))).toBe(false); expect(storage.values.get('another-profile-key')).toBe('untouched');
  expect(scene).toEqual(before); expect(clearSavedSession(storage, profile)).toEqual({ ok: true });
  storage.values.set(savedSessionStorageKey(profile), 'x'.repeat(2 * 1024 * 1024 + 1));
  expect(clearSavedSession(storage, profile)).toEqual({ ok: true });
  expect(scene).toEqual(before);
});

test('historical/capability-less profiles and disposed hosts reject before storage or malformed input', async () => {
  const historical = getOSProfile('macos-sonoma-14.0');
  for (const selectedProfile of [historical, { ...profile, capabilities: profile.capabilities.filter(capability => capability !== 'scene.saved-session') }]) {
    expect(validateSavedSession(fixture(), selectedProfile).ok).toBe(false);
    let accessed = 0;
    const handlers = createSavedSessionCommands({ profile: selectedProfile, storage: () => { accessed++; } });
    for (const action of ['save', 'restore', 'clear']) expect((await execute(handlers, action, null, null)).error.code).toBe('unsupported_profile');
    expect(accessed).toBe(0);
    expect(clearSavedSession({ removeItem() { accessed++; } }, selectedProfile).ok).toBe(false); expect(accessed).toBe(0);
  }
  expect(savedSessionStorageKey(profile)).toBe('jesteros:macos-golden-gate-27.0.1:saved-session:v1');
  expect(savedSessionStorageKey(historical)).toBeNull();
  const storage = memoryStorage(), handlers = commands({ storage, available: () => false });
  for (const action of ['save', 'restore', 'clear']) expect((await execute(handlers, action, null, null)).error.code).toBe('unavailable');
  expect(storage.calls).toEqual([]);
});

test('closed empty command arguments reject arbitrary payloads without accessing storage', async () => {
  const storage = memoryStorage(), handlers = commands({ storage });
  for (const action of ['save', 'restore', 'clear']) {
    expect((await execute(handlers, action, { userId: 'local-alex' })).error.code).toBe('invalid_arguments');
    expect((await execute(handlers, action, {}, { passcode: '12345' })).error.code).toBe('invalid_arguments');
  }
  expect(storage.calls).toEqual([]);
});

test('historical discovery and dispatch reject known saved-session names as unsupported profiles', async () => {
  const historical = getOSProfile('macos-mojave-10.14');
  const registry = createFeatureCommands({}, () => ({}), async () => {}, {}, () => ({}), () => historical, savedSessionCatalog);
  for (const action of ['save', 'restore', 'clear']) {
    const command = `scene.session.${action}`;
    expect(registry.describe(command).error.code).toBe('unsupported_profile');
    expect((await registry.execute({ command })).error.code).toBe('unsupported_profile');
  }
});

test('app-owned About utilities coexist with closed ordinary windows, and Notes Settings preserves its own view and seeded preferences', () => {
  const snapshot = fixture(), scene = snapshot.locals[0].scene;
  remember(scene, 'notes', { title: 'Retained Notes document' }, {
    scroll: [{ key: 'notes-body', top: 80, left: 0 }],
    selections: [{ key: 'notes-body', noteId: 'note-1', start: 3, end: 17, direction: 'backward' }], focusKey: 'notes-body',
  });
  for (const appId of Object.keys(profile.applications)) {
    const utility = addWindow(scene, appId, { utilityKind: 'application-about', title: `About ${profile.applications[appId].name}` });
    delete utility.folderId; delete utility.settingsPane;
    scene.views[utility.id].scroll = [{ key: 'application-about', top: 60, left: 0 }, { key: 'window-content', top: 0, left: 0 }];
  }
  const settings = addWindow(scene, 'notes', { utilityKind: 'application-settings', title: 'Notes Settings' });
  scene.views[settings.id].scroll = [{ key: 'application-settings', top: 90, left: 0 }, { key: 'window-content', top: 0, left: 0 }];
  scene.seed.notes.preferences = { sortBy: 'title', groupByDate: false, textSize: 24 };
  expect(validate(snapshot)).toEqual({ ok: true });
});

test('restored app utilities reject duplicate owners, unsupported Settings owners and ordinary/document-only fields or view keys', () => {
  for (const change of [
    (_, scene) => { addWindow(scene, 'notes', { utilityKind: 'application-about' }); addWindow(scene, 'notes', { utilityKind: 'application-about' }); },
    (_, scene) => { addWindow(scene, 'safari', { utilityKind: 'application-settings' }); },
    (_, scene) => { addWindow(scene, 'finder', { utilityKind: 'application-about' }); },
    (_, scene) => { addWindow(scene, 'notes', { utilityKind: 'application-about', fileId: 'itinerary' }); },
    (_, scene) => { const window = addWindow(scene, 'notes', { utilityKind: 'application-about' });
      scene.views[window.id].scroll = [{ key: 'notes-list', top: 20, left: 0 }]; },
    (_, scene) => { const window = addWindow(scene, 'notes', { utilityKind: 'application-settings' });
      scene.views[window.id].selections = [{ key: 'notes-body', noteId: 'note-1', start: 0, end: 10, direction: 'none' }]; },
    (_, scene) => { const window = addWindow(scene, 'notes', { utilityKind: 'application-about' }); scene.views[window.id].focusKey = 'notes-body'; },
  ]) rejects(change);
});

test('Saved View state rejects impossible chrome, hidden List documents, invalid browsing modes and utility contamination atomically', () => {
  rejects((snapshot, scene) => {
    addWindow(scene, 'finder', { finderPresentation: { ...finderPresentationDefaults(), toolbarVisible: false } });
  });
  rejects((snapshot, scene) => {
    addWindow(scene, 'notes', { notesPresentation: { mode: 'list', documentVisible: false } });
  });
  rejects((snapshot, scene) => {
    addWindow(scene, 'finder', { finderBrowseMode: 'tiles' });
  });
  rejects((snapshot, scene) => {
    addWindow(scene, 'notes', { utilityKind: 'application-about', finderBrowseMode: 'icons' });
  });
});

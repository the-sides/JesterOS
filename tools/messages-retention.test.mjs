import { expect, test, afterEach } from 'bun:test';
import { captureRetainedView, restoreRetainedView } from '../frontend/src/retained-native-view.js';
import { createMessagesNativeView } from '../frontend/src/messages-native-view.js';
import { JSDOM } from 'jsdom';
import { getOSProfile, listOSProfiles } from '../frontend/src/os-profiles.js';
import { createMessagesState, validateMessagesState } from '../frontend/src/messages-state.js';
import { createMessagesCommands } from '../frontend/src/messages-commands.js';
import { changeMessageDraft, sendMessageDraft } from '../frontend/src/messages-composition.js';
import { createMacDesktopFileStore } from '../frontend/src/desktop-file-state.js';
import { createWindows11AppState } from '../frontend/src/windows11-app-state.js';
import { createApplicationFileBridges } from '../frontend/src/application-file-bridges.js';
import { createDocumentDestinationPresentation, createDocumentDestinationCommands } from '../frontend/src/document-destination-commands.js';
import { printingDefaults } from '../frontend/src/printing-state.js';
import { createMenuBarCommands, menuBarDefaults } from '../frontend/src/menu-bar.js';
import { messagesAppMenuProviders } from '../frontend/src/messages-app-menus.js';
import { createTextEditController } from '../frontend/src/textedit-commands.js';
import { createTextEditState } from '../frontend/src/textedit-state.js';
import { textEditPlainText } from '../frontend/src/textedit-content.js';
import { validateSavedSession } from '../frontend/src/saved-session.js';
import { createDefaultSceneSeed } from '../frontend/src/scene-seed.js';
import { createDefaultApplicationFiles } from '../frontend/src/default-application-files.js';
import { createMacApplicationFiles } from '../frontend/src/mac-application-files.js';
import { spacesDefaults } from '../frontend/src/spaces.js';
import { desktopStacksDefaults } from '../frontend/src/desktop-stacks-model.js';
import { desktopViewDefaults } from '../frontend/src/desktop-context-model.js';

const draftFacadeDoms = new Set();
afterEach(() => { for (const dom of draftFacadeDoms) dom.window.close(); draftFacadeDoms.clear(); });

function nativeView(query = 'trailhead', conversationId = 'trail-crew') {
  const dom = new JSDOM('<!doctype html><body><section><input data-messages-control="search"><div class="golden-gate-messages-history"></div></section></body>');
  draftFacadeDoms.add(dom);
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 200, height: 24 }];
  const document = dom.window.document, root = document.querySelector('section');
  const input = root.querySelector('input'), history = root.querySelector('div');
  input.value = query; input.setSelectionRange(2, 6, 'backward');
  history.dataset.messagesConversationId = conversationId; history.scrollTop = 123;
  input.focus();
  return { root, input, history, document, options: { messageQuery: query, messageConversationId: conversationId } };
}

test('retained Messages caret and focus never borrow a different canonical search query', () => {
  const view = nativeView(), token = captureRetainedView(view.root, view.options);
  view.input.value = 'updated'; view.input.setSelectionRange(0, 0); view.input.blur(); view.history.scrollTop = 0;
  restoreRetainedView(view.root, token, { ...view.options, messageQuery: 'updated', focus: true });
  expect([view.input.selectionStart, view.input.selectionEnd]).toEqual([0, 0]);
  expect(view.document.activeElement).toBe(view.document.body);
  expect(view.history.scrollTop).toBe(123);
  view.input.value = 'trailhead';
  restoreRetainedView(view.root, token, { ...view.options, focus: true });
  expect([view.input.selectionStart, view.input.selectionEnd, view.input.selectionDirection]).toEqual([2, 6, 'backward']);
  expect(view.document.activeElement).toBe(view.input);
});

test('retained thread scrolling is scoped to its original conversation independently of search caret', () => {
  const view = nativeView(), token = captureRetainedView(view.root, view.options);
  view.history.dataset.messagesConversationId = 'casey'; view.history.scrollTop = 0; view.input.setSelectionRange(0, 0); view.input.blur();
  restoreRetainedView(view.root, token, { ...view.options, messageConversationId: 'casey', focus: true });
  expect(view.history.scrollTop).toBe(0);
  expect([view.input.selectionStart, view.input.selectionEnd]).toEqual([2, 6]);
  expect(view.document.activeElement).toBe(view.input);
});

test('uncommitted native search text cannot become a retained canonical caret owner', () => {
  const view = nativeView(); view.input.value = 'uncommitted';
  const token = captureRetainedView(view.root, view.options);
  expect(token.selections).toEqual([]);
  expect(token.focusKey).toBeNull();
});

function retainedDraftConsumer(profileId) {
  const profile = getOSProfile(profileId), state = createMessagesState(profile);
  const draft = state.drafts.find(row => row.id === state.selectedDraftId);
  expect(changeMessageDraft(state, draft.id, 'body', 'Original Ω🌊 composer caret').status).toBe('applied');
  const dom = new JSDOM('<!doctype html><body><section><textarea data-messages-control="draft-body"></textarea><input data-messages-control="search"><button>Close</button></section><section data-third-window><input value="Third window original field"></section></body>');
  draftFacadeDoms.add(dom);
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 320, height: 240 }];
  const document = dom.window.document;
  let root = document.querySelector('section'), body = root.querySelector('textarea'), search = root.querySelector('input');
  body.dataset.messagesDraftId = draft.id; body.value = draft.fields.body;
  search.value = state.query;
  const options = () => ({ messageDraft: state.drafts.find(row => row.id === state.selectedDraftId),
    messageQuery: state.query, messageConversationId: state.selectedConversationId });
  return { state, draft, document, options, get root() { return root; }, get body() { return body; }, get search() { return search; },
    third: document.querySelector('[data-third-window] input'),
    close() { root.querySelector('button').focus(); },
    reopen() {
      const replacement = root.cloneNode(true);
      root.remove(); document.body.prepend(replacement); root = replacement;
      body = root.querySelector('textarea'); search = root.querySelector('input');
      body.value = options().messageDraft.fields.body; body.setSelectionRange(body.value.length, body.value.length);
    } };
}

for (const profile of listOSProfiles()) test(`${profile.id}: original canonical composer survives Close and a newly mounted textarea with meaningful backward selection`, () => {
  const view = retainedDraftConsumer(profile.id);
  view.body.focus(); view.body.setSelectionRange(0, 8, 'backward'); view.close();
  const token = JSON.parse(JSON.stringify(captureRetainedView(view.root, view.options()))), original = view.body;
  expect(token.selections.find(selection => selection.key === 'messages-draft-body')).toEqual({
    key: 'messages-draft-body', noteId: null, draftId: view.draft.id, revision: view.draft.revision,
    start: 0, end: 8, direction: 'backward',
  });
  view.reopen();
  expect(original.isConnected).toBe(false);
  expect(view.body).not.toBe(original);
  restoreRetainedView(view.root, token, { ...view.options(), focus: true });
  expect([view.body.selectionStart, view.body.selectionEnd, view.body.selectionDirection]).toEqual([0, 8, 'backward']);
  expect(view.document.activeElement).toBe(view.body);
});

for (const drift of ['revision', 'id', 'value', 'dataset', 'out-of-bounds', 'negative-start', 'reversed', 'direction', 'recordId', 'query'])
  test(`reopened canonical composer rejects ${drift} drift without borrowing or clamping a selection`, () => {
    const view = retainedDraftConsumer('macos-mojave-10.14');
    view.body.focus(); view.body.setSelectionRange(0, 8, 'backward'); view.close();
    const token = captureRetainedView(view.root, view.options());
    view.reopen(); view.third.focus();
    const selection = token.selections.find(row => row.key === 'messages-draft-body');
    if (drift === 'revision') view.draft.revision++;
    if (drift === 'id') {
      const other = view.state.drafts.find(row => row !== view.draft);
      expect(changeMessageDraft(view.state, other.id, 'body', view.draft.fields.body).status).toBe('applied');
      view.state.selectedDraftId = other.id; view.state.selectedConversationId = other.conversationId;
      view.body.dataset.messagesDraftId = other.id;
    }
    if (drift === 'value') view.body.value = 'uncommitted original composer';
    if (drift === 'dataset') view.body.dataset.messagesDraftId = 'borrowed-draft';
    if (drift === 'out-of-bounds') selection.end = view.body.value.length + 1;
    if (drift === 'negative-start') selection.start = -1;
    if (drift === 'reversed') selection.start = selection.end + 1;
    if (drift === 'direction') selection.direction = 'sideways';
    if (drift === 'recordId') selection.recordId = view.draft.id;
    if (drift === 'query') selection.query = view.state.query;
    const before = [view.body.selectionStart, view.body.selectionEnd, view.body.selectionDirection];
    restoreRetainedView(view.root, token, { ...view.options(), focus: true });
    expect([view.body.selectionStart, view.body.selectionEnd, view.body.selectionDirection]).toEqual(before);
    expect(view.document.activeElement).toBe(view.third);
  });

for (const invalid of ['revision', 'fractional-revision', 'missing-revision', 'id', 'missing-draft', 'value', 'dataset', 'not-textarea', 'disconnected'])
  test(`capture cannot retain a ${invalid} composer as the selected canonical draft`, () => {
    const view = retainedDraftConsumer('macos-mojave-10.14');
    view.body.focus(); view.body.setSelectionRange(0, 8, 'backward');
    if (invalid === 'revision') view.draft.revision = -1;
    if (invalid === 'fractional-revision') view.draft.revision = 1.5;
    if (invalid === 'missing-revision') delete view.draft.revision;
    if (invalid === 'missing-draft') view.state.selectedDraftId = null;
    if (invalid === 'id') view.state.selectedDraftId = view.state.drafts.find(row => row !== view.draft).id;
    if (invalid === 'value') view.body.value = 'uncommitted';
    if (invalid === 'dataset') view.body.dataset.messagesDraftId = 'borrowed-draft';
    if (invalid === 'not-textarea') {
      const input = view.document.createElement('input'); input.dataset.messagesControl = 'draft-body';
      input.dataset.messagesDraftId = view.draft.id; input.value = view.draft.fields.body; view.body.replaceWith(input); input.focus();
    }
    if (invalid === 'disconnected') view.root.remove();
    const token = captureRetainedView(view.root, view.options());
    expect(token.selections.some(selection => selection.key === 'messages-draft-body')).toBe(false);
    expect(token.focusKey).not.toBe('messages-draft-body');
  });

test('background composer restoration retains the range without stealing third-window focus', () => {
  const view = retainedDraftConsumer('macos-mojave-10.14');
  view.body.focus(); view.body.setSelectionRange(0, 8, 'backward'); view.close();
  const token = captureRetainedView(view.root, view.options()); view.reopen(); view.third.focus();
  restoreRetainedView(view.root, token, { ...view.options(), focus: false });
  expect([view.body.selectionStart, view.body.selectionEnd, view.body.selectionDirection]).toEqual([0, 8, 'backward']);
  expect(view.document.activeElement).toBe(view.third);
});

test('actual canonical search focus wins over the retained composer reopen default', () => {
  const view = retainedDraftConsumer('macos-mojave-10.14');
  view.state.query = 'Original'; view.search.value = view.state.query;
  view.body.focus(); view.body.setSelectionRange(0, 8, 'backward');
  view.search.focus(); view.search.setSelectionRange(1, 6, 'backward');
  const token = captureRetainedView(view.root, view.options());
  view.reopen(); restoreRetainedView(view.root, token, { ...view.options(), focus: true });
  expect([view.body.selectionStart, view.body.selectionEnd, view.body.selectionDirection]).toEqual([0, 8, 'backward']);
  expect([view.search.selectionStart, view.search.selectionEnd, view.search.selectionDirection]).toEqual([1, 6, 'backward']);
  expect(view.document.activeElement).toBe(view.search);
});

function rememberedComposerSnapshot(view, token) {
  const profile = getOSProfile('macos-golden-gate-27.0.1');
  const seed = createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles });
  seed.messages = structuredClone(view.state);
  const { overview, ...spaces } = spacesDefaults(), { focusedStackId, ...stacks } = desktopStacksDefaults();
  const window = { id: 'messages', appId: 'messages', title: 'Messages', minimized: false, fullScreen: false, zoomed: false,
    bounds: { x: 140, y: 80, width: 848, height: 592, scale: 0.8 }, restoreBounds: null, spaceId: 'desktop-1' };
  const scene = { seed, catalogTimes: Object.fromEntries(createMacApplicationFiles(profile, seed.files.sceneTime)
    .map(({ id, createdAt, modifiedAt, addedAt, lastOpenedAt }) => [id, { createdAt, modifiedAt, addedAt, lastOpenedAt }])),
    fileOrder: [...seed.files.files.map(file => file.id), ...createMacApplicationFiles(profile, seed.files.sceneTime).map(file => file.id)],
    windows: [], closedWindows: { messages: { window, view: token } }, views: {}, nextWindowId: 2,
    activeWindowId: null, activeAppId: 'finder', runningAppIds: ['finder'],
    switching: { activationAppIds: [], activationWindowIds: [], creationWindowIds: [], hiddenAppIds: [] },
    spaces, splitViews: [], desktop: { selectedFileIds: ['itinerary'], selectionAnchorId: 'itinerary', positions: { itinerary: { x: 640, y: 24 } },
      sortBy: 'none', viewOptions: desktopViewDefaults('macos', 'golden-gate'), stacks },
    dockOrder: { mainOrderAppIds: [...seed.dock.mainOrderAppIds], secondaryOrderItemIds: [...seed.dock.secondaryOrderItemIds] } };
  return { version: 1, profileId: profile.id,
    baseline: { source: 'default', seed: createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles }) },
    locals: [{ userId: 'local-alex', scene }] };
}

test('saved remembered Messages composer restores the original canonical selection through serialized session validation', () => {
  const profile = getOSProfile('macos-golden-gate-27.0.1'), view = retainedDraftConsumer(profile.id);
  view.body.focus(); view.body.setSelectionRange(0, 8, 'backward'); view.close();
  const snapshot = JSON.parse(JSON.stringify(rememberedComposerSnapshot(view, captureRetainedView(view.root, view.options()))));
  expect(validateSavedSession(snapshot, profile)).toEqual({ ok: true });
  view.reopen();
  const scene = snapshot.locals[0].scene;
  restoreRetainedView(view.root, scene.closedWindows.messages.view, {
    messageDraft: scene.seed.messages.drafts.find(row => row.id === scene.seed.messages.selectedDraftId),
    messageQuery: scene.seed.messages.query, messageConversationId: scene.seed.messages.selectedConversationId, focus: true,
  });
  expect([view.body.selectionStart, view.body.selectionEnd, view.body.selectionDirection]).toEqual([0, 8, 'backward']);
  expect(view.document.activeElement).toBe(view.body);
});

for (const drift of ['selected-draft', 'revision', 'bounds', 'recordId', 'query', 'body-copy', 'missing-revision', 'negative-revision', 'borrowed-search', 'wrong-owner'])
  test(`saved remembered composer rejects ${drift} ownership drift at the session boundary`, () => {
    const profile = getOSProfile('macos-golden-gate-27.0.1'), view = retainedDraftConsumer(profile.id);
    view.body.focus(); view.body.setSelectionRange(0, 8, 'backward'); view.close();
    const snapshot = rememberedComposerSnapshot(view, captureRetainedView(view.root, view.options()));
    expect(validateSavedSession(snapshot, profile).ok).toBe(true);
    const scene = snapshot.locals[0].scene, remembered = scene.closedWindows.messages;
    const selection = remembered.view.selections.find(row => row.key === 'messages-draft-body');
    if (drift === 'selected-draft') scene.seed.messages.selectedDraftId = null;
    if (drift === 'revision') scene.seed.messages.drafts.find(row => row.id === scene.seed.messages.selectedDraftId).revision++;
    if (drift === 'bounds') selection.end = view.draft.fields.body.length + 1;
    if (drift === 'recordId') selection.recordId = view.draft.id;
    if (drift === 'query') selection.query = scene.seed.messages.query;
    if (drift === 'body-copy') selection.body = view.draft.fields.body;
    if (drift === 'missing-revision') delete selection.revision;
    if (drift === 'negative-revision') selection.revision = -1;
    if (drift === 'borrowed-search') remembered.view.selections.find(row => row.key === 'messages-search').draftId = view.draft.id;
    if (drift === 'wrong-owner') {
      remembered.window.appId = 'contacts'; remembered.window.id = 'contacts-window-1';
      scene.closedWindows = { contacts: remembered }; remembered.view.scroll = [];
    }
    const before = structuredClone(snapshot);
    expect(validateSavedSession(snapshot, profile).ok).toBe(false);
    expect(snapshot).toEqual(before);
  });

function draftFacade(callbacks = {}) {
  const dom = new JSDOM('<!doctype html><body></body>'), document = dom.window.document;
  draftFacadeDoms.add(dom);
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 200, height: 24 }];
  const state = { query: 'route', selectedDraftId: 'draft-local', drafts: [{ id: 'draft-local', fields: { to: 'Casey', body: 'A🌊B' } }], conversations: [] };
  const root = document.createElement('section'); root.dataset.messagesWindowId = 'messages-local'; document.body.append(root);
  function addField(controlId, value, draftId = null) {
    const node = document.createElement(controlId === 'draft-body' ? 'textarea' : 'input');
    node.dataset.messagesControl = controlId;
    if (draftId !== null) node.dataset.messagesDraftId = draftId;
    node.value = value; root.append(node); return node;
  }
  const body = addField('draft-body', 'A🌊B', 'draft-local'); body.setSelectionRange(1, 3, 'backward');
  const menu = document.createElement('button'); menu.textContent = 'Original native File menu'; document.body.append(menu);
  let available = true, liveRoot = root;
  const facade = createMessagesNativeView({ getRoot: () => liveRoot, getState: () => state, windowId: 'messages-local',
    available: () => available, tick: async () => {}, ...callbacks });
  facade.available();
  return { facade, state, body, root, document, addField, focusMenu: () => menu.focus(),
    retire() { available = false; }, replace() { liveRoot = root.cloneNode(true); } };
}

test('native emoji caret uses exact UTF16 textarea selection and refuses a different draft or uncommitted text', () => {
  const view = draftFacade();
  expect(view.facade.draftSelection('draft-local')).toEqual({ start: 1, end: 3, direction: 'backward', value: 'A🌊B' });
  expect(view.facade.draftSelection('another-draft')).toBeNull();
  expect(view.facade.restoreDraftSelection('draft-local', { start: 1, end: 3, direction: 'backward' }, () => true)).toBe(true);
  expect(view.document.activeElement).toBe(view.body);
  view.body.value = 'uncommitted';
  expect(view.facade.restoreDraftSelection('draft-local', { start: 0, end: 0, direction: 'none' }, () => true)).toBe(false);
  view.body.value = view.state.drafts[0].fields.body;
  view.retire();
  expect(view.facade.draftSelection('draft-local')).toBeNull();
});

test('native Details and Quick Look callbacks cannot acknowledge a replaced original facade after await', async () => {
  let continuePanel;
  const view = draftFacade({ setPanel: async (_panel, _open, current) => {
    await new Promise(resolve => { continuePanel = resolve; });
    return current();
  } });
  const pending = view.facade.setPanel('details', true, () => true);
  view.replace(); continuePanel();
  expect(await pending).toBe(false);
  const missing = draftFacade();
  expect(await missing.facade.quickLookAttachment({ id: 'actual-source' }, () => true)).toBe(false);
});

test('native Edit retains the actual previous body/search/recipient field when a menu takes focus, not a body substitute', () => {
  const view = draftFacade();
  view.facade.available();
  view.body.focus();
  view.focusMenu();
  const bodyCapture = view.facade.editSelection();
  expect(bodyCapture.node).toBe(view.body);
  expect(bodyCapture.field).toBe('body');
  const search = view.addField('search', 'route'); search.setSelectionRange(1, 4); search.focus(); search.blur();
  const searchCapture = view.facade.editSelection();
  expect([searchCapture.field, searchCapture.draftId, searchCapture.start, searchCapture.end]).toEqual(['search', null, 1, 4]);
  expect(view.facade.restoreEditSelection(searchCapture, { start: 0, end: 5, direction: 'forward' }, () => true)).toBe(true);
  expect(view.document.activeElement).toBe(search);
  const to = view.addField('draft-to', 'Casey', 'draft-local'); to.setSelectionRange(0, 5); to.readOnly = true; to.focus();
  const toCapture = view.facade.editSelection();
  expect(toCapture.field).toBe('to');
  expect(toCapture.readOnly).toBe(true);
  view.state.selectedDraftId = 'another-draft';
  expect(view.facade.editSelection()).toBeNull();
  expect(view.facade.restoreEditSelection(toCapture, { start: 0, end: 0, direction: 'none' }, () => true)).toBe(false);
});

test('native Edit never borrows an equal-valued replacement textarea or noncanonical search text', () => {
  const view = draftFacade(); view.body.focus();
  const capture = view.facade.editSelection();
  const replacement = view.body.cloneNode(true);
  view.body.replaceWith(replacement);
  expect(view.facade.restoreEditSelection(capture, { start: 1, end: 3, direction: 'none' }, () => true)).toBe(false);
  expect(view.facade.editSelection()).toBeNull();
});

test('native Edit cannot restore a search caret over unsaved field text', () => {
  const view = draftFacade();
  const search = view.addField('search', 'route'); search.setSelectionRange(1, 4); search.focus();
  const capture = view.facade.editSelection();
  search.value = 'uncommitted route';
  expect(view.facade.restoreEditSelection(capture, { start: 0, end: 0, direction: 'none' }, () => true)).toBe(false);
  search.value = view.state.query;
  expect(view.facade.restoreEditSelection(capture, { start: 0, end: 5, direction: 'none' }, () => false)).toBe(false);
});


// Real DOM focus/value/selection, the complete canonical Messages state, and the
// actual Messages -> destination controllers. jsdom has no layout; only geometry
// is supplied, never focus, selections, source-return hooks or command results.
async function nativeDestinationConsumer(profileId = 'macos-mojave-10.14') {
  const profile = getOSProfile(profileId), state = createMessagesState(profile);
  const files = profile.family === 'windows' ? createWindows11AppState() : createMacDesktopFileStore(profile, state.timeBase);
  const printing = printingDefaults(), presentation = createDocumentDestinationPresentation();
  const dom = new JSDOM('<!doctype html><body><section data-messages-window-id="messages-original"><textarea data-messages-control="draft-body"></textarea></section><section data-third-window><input value="Third window original field"></section></body>');
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 320, height: 240 }];
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const document = dom.window.document, root = document.querySelector('[data-messages-window-id]'), body = root.querySelector('textarea');
  const sourceWindow = { id: 'messages-original', appId: profile.family === 'windows' ? 'teams' : 'messages' };
  const windows = new Map([[sourceWindow.id, sourceWindow]]), views = new Map();
  let activeWindowId = sourceWindow.id, liveRoot = root, liveState = state, destination, windowCounter = 0;
  const native = createMessagesNativeView({ getRoot: () => liveRoot, getState: () => liveState, windowId: sourceWindow.id,
    available: () => windows.get(sourceWindow.id) === sourceWindow, tick: async () => {} });
  views.set(sourceWindow.id, native);
  const available = window => windows.get(window.id) === window && views.get(window.id)?.available() === true;
  const bridges = createApplicationFileBridges({ profile, getStore: () => files, getSceneTime: () => state.timeBase,
    alive: () => true, canCommit: () => true });
  destination = createDocumentDestinationCommands({ profile, getPrinting: () => printing, getPresentation: () => presentation,
    getFilesStore: () => files, alive: () => true, canCommit: () => true, getSceneTime: () => state.timeBase,
    getWindow: id => windows.get(id), getView: id => views.get(id), available, getActiveWindowId: () => activeWindowId, tick: async () => {},
    createFile: bridges.createFile,
    createWindow(appId, options) {
      if (!options.isCurrent()) return null;
      const window = { id: `native-destination-${++windowCounter}`, appId, utilityKind: options.utilityKind };
      const panelRoot = document.createElement('section'), cancel = document.createElement('button');
      panelRoot.dataset.destinationWindowId = window.id; cancel.textContent = 'Cancel'; panelRoot.append(cancel); document.body.append(panelRoot);
      windows.set(window.id, window);
      views.set(window.id, { available: () => panelRoot.isConnected,
        describe: () => ({ focusedControl: document.activeElement === cancel ? 'cancel' : null }) });
      if (!destination.windowOpened(window, options)) throw new Error('Original destination registration was declined.');
      activeWindowId = window.id; cancel.focus();
      return window.id;
    },
    closeWindow(id, ownership) {
      if (!ownership.guard()) return { status: 'rejected', error: { code: 'stale_target', message: 'Original destination retired.' } };
      destination.windowClosed(id); windows.delete(id); views.delete(id);
      document.querySelector(`[data-destination-window-id="${id}"]`)?.remove();
      if (activeWindowId === id) {
        const target = ownership.returnFocus;
        activeWindowId = target?.guard() === true && windows.get(target.window.id) === target.window ? target.window.id : null;
      }
      return { status: 'applied', windowId: id };
    },
  });
  const textState = createTextEditState(profile);
  const textController = createTextEditController({ profile, getState: () => textState, alive: () => true,
    getWindow: id => windows.get(id), getWindows: () => [...windows.values()], getView: id => views.get(id), available,
    canCommit: () => true, tick: async () => {}, getSceneTime: () => state.timeBase,
    getFile: bridges.getFile, readFile: bridges.readFile,
    createWindow(appId, options) {
      if (!options.isCurrent()) return null;
      const window = { id: `native-reader-${++windowCounter}`, appId };
      const node = document.createElement('section'); node.dataset.readerWindowId = window.id; document.body.append(node);
      windows.set(window.id, window); views.set(window.id, { available: () => node.isConnected });
      if (!textController.windowOpened(window, options)) throw new Error('Original reader registration was declined.');
      activeWindowId = window.id; node.tabIndex = -1; node.focus();
      return window.id;
    },
  });
  const controller = createMessagesCommands({ profile, getState: () => liveState, alive: () => true,
    getWindow: id => windows.get(id), getWindows: () => [...windows.values()], getView: id => views.get(id), available,
    focusWindow: id => { activeWindowId = id; }, settle: async () => {}, getSceneTime: () => state.timeBase, canCommit: () => true,
    getActiveWindowId: () => activeWindowId,
    getFile: bridges.getFile, saveAttachmentFile: destination.saveFile, chooseFile: destination.chooseFile,
    openFile: (fileId, _options, ownership) => textController.openFile(fileId, ownership) });
  function renderBody() {
    const draft = state.drafts.find(row => row.id === state.selectedDraftId);
    body.dataset.messagesDraftId = draft.id; body.value = draft.fields.body;
  }
  renderBody();
  const sourceOwnership = { windowId: sourceWindow.id, guard: () => windows.get(sourceWindow.id) === sourceWindow };
  const created = await bridges.createFile({ name: 'Original Unicode Note.txt', mime: 'text/plain; charset=utf-8', text: 'Retained Ω🌊 source bytes\nSecond line' }, sourceOwnership);
  expect(created.status).toBe('applied');
  const attached = await controller.handlers['messages.draft.attach']({ windowId: sourceWindow.id, draftId: state.selectedDraftId }, { fileId: created.fileId });
  expect(attached.status).toBe('applied');
  expect(sendMessageDraft(state, state.selectedDraftId).status).toBe('applied');
  expect(changeMessageDraft(state, state.selectedDraftId, 'body', 'Original Ω🌊 composer caret').status).toBe('applied');
  renderBody();
  const conversation = state.conversations.find(row => row.id === state.selectedConversationId), message = conversation.items.at(-1), attachment = message.attachments[0];
  expect(validateMessagesState(state, profile).ok).toBe(true);
  function panel(kind = 'details') {
    const node = document.createElement('section'); node.className = 'messages-rich-panel';
    if (kind === 'details') node.dataset.messagesDetailsConversationId = conversation.id;
    const close = document.createElement('button'); close.dataset.messagesControl = `${kind}-close`; close.textContent = 'Close panel';
    const field = document.createElement('input'); field.dataset.messagesControl = kind === 'details' ? 'conversation-name' : 'account-name';
    field.value = kind === 'details' ? conversation.name : state.account.name;
    const photo = document.createElement('button'); photo.dataset.messagesControl = 'account-photo'; photo.textContent = 'Choose Photo from Files';
    const figure = document.createElement('figure'); figure.dataset.messagesAttachmentId = attachment.id;
    figure.dataset.messagesSourceFileId = attachment.originalFileId; figure.dataset.messagesSourceRevision = String(attachment.originalRevision);
    const anchor = document.createElement('button'); anchor.dataset.messagesControl = `attachment-actions:${attachment.id}`; anchor.textContent = 'Attachment actions';
    figure.append(anchor); node.append(close, field, photo, figure); root.append(node); close.focus();
    return { node, close, field, photo, figure, anchor };
  }
  const saveTarget = { windowId: sourceWindow.id, conversationId: conversation.id, messageId: message.id, attachmentId: attachment.id };
  async function open(name = 'messages.attachment.save', target = name === 'messages.attachment.save' ? saveTarget : { windowId: sourceWindow.id }) {
    const pending = controller.handlers[name](target, {});
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const sheet = presentation.panels.at(-1);
    expect(sheet?.windowId).toBeTruthy();
    return { sheet, pending };
  }
  async function cancel(opened) {
    expect((await destination.handlers['documentDestination.cancel']({ panelId: opened.sheet.id }, {})).status).toBe('applied');
    expect((await opened.pending).error.code).toBe('cancelled');
    expect(presentation.panels).toEqual([]);
  }
  const snapshot = () => structuredClone({ state, files, printing });
  return { dom, document, root, body, native, state, files, sourceWindow, windows, views, conversation, message, attachment, controller, destination, presentation, panel, open, cancel, snapshot,
    get activeWindowId() { return activeWindowId; }, setActive(id) { activeWindowId = id; },
    bridges, textState,
    replaceRoot(node) { liveRoot = node; }, replaceState(next) { liveState = next; } };
}

test('a real native Files chooser cancellation does not resurrect its launching File menu or steal the original composer caret', async () => {
  const f = await nativeDestinationConsumer(), profile = getOSProfile('macos-mojave-10.14'), state = menuBarDefaults();
  try {
    const invoker = f.document.createElement('button');
    invoker.textContent = 'File'; f.document.body.append(invoker);
    let popup = null;
    const menus = () => messagesAppMenuProviders({ state: f.state, profile, windowId: f.sourceWindow.id, available: true });
    const file = () => menus().find(menu => menu.menuId === 'file');
    const selected = id => popup?.querySelector(`[data-menu-item-id="${id}"]`);
    const view = {
      available: id => id === 'file' && invoker.isConnected,
      itemIds: () => popup ? file().items.filter(item => item.enabled && !item.separator).map(item => item.id) : [],
      focusedItem: () => f.document.activeElement?.dataset.menuItemId ?? null,
      focus: async (_id, _level, itemId) => {
        const node = selected(itemId);
        if (!node) return false;
        node.focus(); return f.document.activeElement === node;
      },
      focusInvoker: async () => { invoker.focus(); return f.document.activeElement === invoker; },
      bounds: () => ({ invoker: {}, popups: popup ? [{ level: 0, popup: {} }] : [] }),
      scrollTop: () => popup ? 0 : null,
      scroll: async () => 0,
    };
    const operations = createMenuBarCommands({ profile, state, getMenus: menus, getView: () => view,
      available: () => f.windows.get(f.sourceWindow.id) === f.sourceWindow,
      captureFocus: () => f.native.captureSourceReturn(),
      restoreFocus: capture => f.native.restoreSourceReturn(capture, () => f.windows.get(f.sourceWindow.id) === f.sourceWindow),
      captureAction: () => () => f.windows.get(f.sourceWindow.id) === f.sourceWindow && f.views.get(f.sourceWindow.id) === f.native,
      preparePresentation: () => null, restorePresentation: async () => {},
      settle: async () => {
        if (state.menuId !== 'file') { popup?.remove(); popup = null; return; }
        if (popup) return;
        popup = f.document.createElement('div'); popup.setAttribute('role', 'menu');
        for (const item of file().items.filter(item => item.enabled && !item.separator)) {
          const node = f.document.createElement('button'); node.dataset.menuItemId = item.id; node.textContent = item.label; popup.append(node);
        }
        f.document.body.append(popup);
      },
      invoke: request => f.controller.handlers[request.command](request.target, request.payload),
    });
    f.body.focus(); f.body.setSelectionRange(6, 11, 'backward');
    const before = f.snapshot();
    expect((await operations['app.commandMenu.open']({ appId: 'messages', menuId: 'file' }, {})).status).toBe('applied');
    const pending = operations['app.commandMenu.execute']({ appId: 'messages', menuId: 'file', itemId: 'attach-file' }, {});
    await new Promise(resolve => setImmediate(resolve));
    const sheet = f.presentation.panels.at(-1);
    expect(sheet?.windowId).toBeTruthy();
    await f.cancel({ sheet, pending });
    expect(state.menuId).toBeNull();
    expect(popup).toBeNull();
    expect(f.document.activeElement).toBe(f.body);
    expect([f.body.selectionStart, f.body.selectionEnd, f.body.selectionDirection]).toEqual([6, 11, 'backward']);
    expect(f.activeWindowId).toBe(f.sourceWindow.id);
    expect(f.snapshot()).toEqual(before);
  } finally { f.dom.window.close(); }
});

for (const profile of listOSProfiles()) test(`${profile.id}: attachment Save As/Cancel returns the original Details anchor, not the retained composer`, async () => {
  const f = await nativeDestinationConsumer(profile.id);
  try {
    f.body.focus(); f.body.setSelectionRange(2, 6, 'backward');
    const details = f.panel(), menu = f.document.createElement('div'), save = f.document.createElement('button');
    menu.className = 'messages-attachment-menu'; save.dataset.messagesControl = `attachment-save:${f.attachment.id}`;
    save.textContent = 'Save As'; menu.append(save); details.figure.append(menu); save.focus();
    // The native attachment route dismisses the ephemeral menu and focuses its
    // actual surviving invoker before the destination captures its source.
    menu.remove(); details.anchor.focus();
    expect(f.native.editSelection()).toBeNull();
    const before = f.snapshot(), opened = await f.open();
    expect(f.document.activeElement).not.toBe(details.anchor);
    await f.cancel(opened);
    expect(f.activeWindowId).toBe(f.sourceWindow.id);
    expect(f.document.activeElement).toBe(details.anchor);
    expect(details.node.isConnected).toBe(true);
    expect([f.body.value, f.body.selectionStart, f.body.selectionEnd, f.body.selectionDirection]).toEqual(['Original Ω🌊 composer caret', 2, 6, 'backward']);
    expect(f.snapshot()).toEqual(before);
  } finally { f.dom.window.close(); }
});

for (const profile of listOSProfiles()) test(`${profile.id}: native attachment toolbar chooser cancellation returns the original nonempty composer caret`, async () => {
  const f = await nativeDestinationConsumer(profile.id);
  try {
    f.body.focus(); f.body.setSelectionRange(9, 13, 'backward');
    const attach = f.document.createElement('button');
    attach.dataset.messagesControl = 'attach-file';
    f.root.append(attach); attach.focus();
    const before = f.snapshot(), opened = await f.open('messages.draft.attach', { windowId: f.sourceWindow.id, draftId: f.state.selectedDraftId });
    await f.cancel(opened);
    expect(f.document.activeElement).toBe(f.body);
    expect([f.body.value, f.body.selectionStart, f.body.selectionEnd, f.body.selectionDirection]).toEqual(['Original Ω🌊 composer caret', 9, 13, 'backward']);
    expect(f.snapshot()).toEqual(before);
  } finally { f.dom.window.close(); }
});

test('Preferences photo chooser returns its original button without stealing the underlying composer', async () => {
  const f = await nativeDestinationConsumer('macos-sonoma-14.0');
  try {
    f.body.focus(); f.body.setSelectionRange(2, 6, 'forward');
    const preferences = f.panel('preferences'); preferences.photo.focus();
    const before = f.snapshot(), opened = await f.open('messages.account.photo.set');
    await f.cancel(opened);
    expect(f.document.activeElement).toBe(preferences.photo);
    expect(preferences.node.isConnected).toBe(true);
    expect([f.body.selectionStart, f.body.selectionEnd, f.body.selectionDirection]).toEqual([2, 6, 'forward']);
    expect(f.snapshot()).toEqual(before);
  } finally { f.dom.window.close(); }
});

test('a foreground native panel never borrows a remembered background composer after its control loses focus', async () => {
  const f = await nativeDestinationConsumer();
  try {
    f.body.focus(); f.body.setSelectionRange(2, 6, 'backward');
    const composerReturn = f.native.captureSourceReturn(), before = f.snapshot();
    const details = f.panel();
    details.close.blur();
    expect(f.document.activeElement).toBe(f.document.body);
    expect(f.native.editSelection()).toBeNull();
    expect(f.native.captureSourceReturn()).toBeNull();
    expect(f.native.restoreSourceReturn(composerReturn, () => true)).toBe(false);
    expect(f.document.activeElement).toBe(f.document.body);
    details.anchor.focus();
    const detailsReturn = f.native.captureSourceReturn();
    const preview = f.document.createElement('section'), close = f.document.createElement('button');
    preview.className = 'messages-quick-look'; close.dataset.messagesControl = 'quick-look-close';
    preview.append(close); f.root.append(preview); close.focus();
    expect(f.native.restoreSourceReturn(detailsReturn, () => true)).toBe(false);
    const previewReturn = f.native.captureSourceReturn();
    const confirmation = f.document.createElement('section'), cancel = f.document.createElement('button');
    confirmation.className = 'messages-rich-confirmation'; cancel.dataset.messagesControl = 'confirmation-cancel';
    confirmation.append(cancel); f.root.append(confirmation); cancel.focus();
    expect(f.native.restoreSourceReturn(previewReturn, () => true)).toBe(false);
    expect(f.document.activeElement).toBe(cancel);
    expect(f.snapshot()).toEqual(before);
  } finally { f.dom.window.close(); }
});

test('a genuine panel input returns its exact unsaved native value and UTF-16 caret without changing canonical records', async () => {
  const f = await nativeDestinationConsumer();
  try {
    const details = f.panel(); delete details.field.dataset.messagesControl;
    details.field.value = 'Unsubmitted Ω🌊 panel name'; details.field.focus(); details.field.setSelectionRange(12, 16, 'backward');
    const before = f.snapshot(), opened = await f.open();
    await f.cancel(opened);
    expect(f.document.activeElement).toBe(details.field);
    expect([details.field.value, details.field.selectionStart, details.field.selectionEnd, details.field.selectionDirection]).toEqual(['Unsubmitted Ω🌊 panel name', 12, 16, 'backward']);
    expect(f.snapshot()).toEqual(before);
  } finally { f.dom.window.close(); }
});

test('destination cancellation leaves a user-focused third native window untouched', async () => {
  const f = await nativeDestinationConsumer();
  try {
    const details = f.panel(); details.anchor.focus();
    const before = f.snapshot(), opened = await f.open(), third = f.document.querySelector('[data-third-window] input');
    third.focus(); third.setSelectionRange(3, 9, 'backward'); f.setActive('third-original');
    await f.cancel(opened);
    expect(f.activeWindowId).toBe('third-original');
    expect(f.document.activeElement).toBe(third);
    expect([third.value, third.selectionStart, third.selectionEnd, third.selectionDirection]).toEqual(['Third window original field', 3, 9, 'backward']);
    expect(f.snapshot()).toEqual(before);
  } finally { f.dom.window.close(); }
});

for (const thirdSelected of [false, true]) test(`retained attachment materialization ${thirdSelected ? 'preserves a user-selected third window' : 'opens the retained text when the source regains focus'}`, async () => {
  const f = await nativeDestinationConsumer();
  try {
    const original = f.files.files.find(file => file.id === f.attachment.originalFileId);
    const changed = await f.bridges.createFile({ name: original.name, mime: original.mime, text: 'New source revision, not retained bytes',
      existingFileId: original.id, expectedRevision: original.revision }, { windowId: f.sourceWindow.id, guard: () => true });
    expect(changed.status).toBe('applied');
    const sourceAfterEdit = structuredClone(original), messagesBefore = structuredClone(f.state), readersBefore = structuredClone(f.textState);
    const details = f.panel(); details.anchor.focus();
    const opened = await f.open('messages.attachment.open', { windowId: f.sourceWindow.id, conversationId: f.conversation.id,
      messageId: f.message.id, attachmentId: f.attachment.id });
    await f.destination.handlers['documentDestination.save.name']({ panelId: opened.sheet.id }, { name: 'Retained old Unicode copy.txt' });
    const third = f.document.querySelector('[data-third-window] input');
    if (thirdSelected) { third.focus(); third.setSelectionRange(3, 9, 'backward'); f.setActive('third-original'); }
    expect((await f.destination.handlers['documentDestination.save.confirm']({ panelId: opened.sheet.id }, {})).status).toBe('applied');
    const result = await opened.pending;
    const copy = f.files.files.find(file => file.id === result.fileId);
    expect([copy.content, copy.mime]).toEqual(['Retained Ω🌊 source bytes\nSecond line', f.attachment.mime]);
    expect(original).toEqual(sourceAfterEdit);
    expect(f.state).toEqual(messagesBefore);
    expect(f.presentation.panels).toEqual([]);
    if (thirdSelected) {
      expect(f.activeWindowId).toBe('third-original');
      expect(f.document.activeElement).toBe(third);
      expect([third.value, third.selectionStart, third.selectionEnd, third.selectionDirection]).toEqual(['Third window original field', 3, 9, 'backward']);
      expect(f.textState).toEqual(readersBefore);
    } else {
      const session = f.textState.windows.find(row => row.windowId === f.activeWindowId);
      const document = f.textState.documents.find(row => row.id === session.documentId);
      expect(textEditPlainText(document.content)).toBe('Retained Ω🌊 source bytes\nSecond line');
      expect([document.fileId, document.fileRevision]).toEqual([copy.id, copy.revision]);
    }
  } finally { f.dom.window.close(); }
});

for (const replacement of ['node', 'panel', 'closed', 'hidden', 'draft', 'fields', 'revision', 'drafts', 'conversation', 'items', 'message', 'attachments', 'attachment', 'conversations', 'root', 'state', 'window', 'view', 'value'])
  test(`native source control never inherits an original return token after ${replacement} replacement/change`, async () => {
    const f = await nativeDestinationConsumer();
    try {
      const details = f.panel(); details.field.focus(); details.field.setSelectionRange(1, 4, 'forward');
      const capture = f.native.captureSourceReturn();
      expect(capture.node).toBe(details.field);
      const draft = f.state.drafts.find(row => row.id === f.state.selectedDraftId);
      if (replacement === 'node') details.field.replaceWith(details.field.cloneNode(true));
      if (replacement === 'closed') details.node.remove();
      if (replacement === 'panel') details.node.replaceWith(details.node.cloneNode(true));
      if (replacement === 'hidden') details.node.hidden = true;
      if (replacement === 'draft') f.state.drafts[f.state.drafts.indexOf(draft)] = structuredClone(draft);
      if (replacement === 'fields') draft.fields = { ...draft.fields };
      if (replacement === 'revision') draft.revision++;
      if (replacement === 'drafts') f.state.drafts = [...f.state.drafts];
      if (replacement === 'conversation') f.state.conversations[f.state.conversations.indexOf(f.conversation)] = structuredClone(f.conversation);
      if (replacement === 'items') f.conversation.items = [...f.conversation.items];
      if (replacement === 'message') f.conversation.items[f.conversation.items.indexOf(f.message)] = structuredClone(f.message);
      if (replacement === 'attachments') f.message.attachments = [...f.message.attachments];
      if (replacement === 'attachment') f.message.attachments[0] = structuredClone(f.attachment);
      if (replacement === 'conversations') f.state.conversations = [...f.state.conversations];
      if (replacement === 'root') { const next = f.root.cloneNode(true); f.root.replaceWith(next); f.replaceRoot(next); }
      if (replacement === 'state') f.replaceState(structuredClone(f.state));
      if (replacement === 'window') f.windows.set(f.sourceWindow.id, { ...f.sourceWindow });
      if (replacement === 'view') f.views.set(f.sourceWindow.id, { ...f.native });
      if (replacement === 'value') details.field.value = 'New actual panel field input';
      const third = f.document.querySelector('[data-third-window] input'); third.focus(); third.setSelectionRange(2, 8, 'backward');
      const before = f.snapshot();
      expect(f.native.restoreSourceReturn(capture, () => f.views.get(f.sourceWindow.id) === f.native)).toBe(false);
      expect(f.document.activeElement).toBe(third);
      expect([third.selectionStart, third.selectionEnd, third.selectionDirection]).toEqual([2, 8, 'backward']);
      expect(f.snapshot()).toEqual(before);
    } finally { f.dom.window.close(); }
  });

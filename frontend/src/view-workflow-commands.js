import { rejected } from './feature-commands.js';
import { defineCommand, object, match, empty, choice, NONE } from './command-schema.js';
import { liveMacFileRecords } from './desktop-file-state.js';
import { visibleNotes } from './notes-state.js';
import { NOTE_ZOOM_STEPS, VIEWING_LIMIT, closedViewingFields as fields, validViewingIdentity as id,
  isInstalledViewingFolderId, viewingIdentitySchema as identity, viewingFolderIdentitySchema as folderIdentity,
  finderViewSchema, finderPresentationSchema, notesPresentationSchema, notesViewProperties,
  finderViewDefaults, finderPresentationDefaults, notesPresentationDefaults, validFinderView,
  validFinderPresentation, validNotesPresentation, validNotesViewPatch } from './viewing-state.js';

export const VIEW_OPTIONS_CONTROLS = Object.freeze(['panel', 'mode', 'sortBy', 'descending', 'groupBy', 'iconSize', 'gridSpacing', 'textSize', 'close']);
const invalid = () => rejected('invalid_arguments', 'Use the closed documented view target and payload.');
const stale = () => rejected('stale_target', 'The original window, folder, note, preference or owned pane changed.');
const unavailable = () => rejected('unavailable', 'The original view surface is not available.');
const limited = () => rejected('limit_exceeded', 'The complete view mutation exceeds the persistent scene budget.');
const applied = target => ({ status: 'applied', target });
const windowTarget = target => fields(target, ['windowId']) && id(target.windowId);
const noteTarget = target => fields(target, ['windowId', 'noteId']) && id(target.windowId) && id(target.noteId);
const folderTarget = target => fields(target, ['windowId', 'folderId']) && id(target.windowId)
  && (id(target.folderId) || isInstalledViewingFolderId(target.folderId));
const optionsId = value => typeof value === 'string' && /^view-options-[1-9][0-9]*$/.test(value)
  && Number.isSafeInteger(Number(value.slice(13)));
const optionsTarget = (target, focus = false) => fields(target, focus ? ['windowId', 'optionsId', 'control'] : ['windowId', 'optionsId'])
  && id(target.windowId) && optionsId(target.optionsId) && (!focus || VIEW_OPTIONS_CONTROLS.includes(target.control));
const sameValues = (current, captured) => current && Object.keys(captured).every(key => current[key] === captured[key]);
const scrollOffset = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const readNotesView = (viewing, mode, folder) => ({ mode, showNoteCount: viewing.notes.showNoteCount,
  sortBy: folder === 'deleted' ? 'default' : viewing.notes.sortBy,
  sortDirection: folder === 'deleted' ? 'default' : viewing.notes.sortDirection });

export function createViewWorkflowCommands(viewing, presentation, ctx) {
  // Focus tokens remain private: neither projection nor transport can inspect them.
  const focusReturns = new Map();
  let optionsEpoch = 0;
  function ordinary(windowId, appId, active = true) {
    const window = ctx.getWindow(windowId);
    return window && window.id === windowId && window.appId === appId && !window.utilityKind
      && (!active || ctx.available() && ctx.windowAvailable(windowId) && !window.minimized
        && !window.hidden && window.visible !== false) ? window : null;
  }
  function notesOwner(windowId) {
    const window = ordinary(windowId, 'notes');
    const notes = ctx.getNotes();
    return window && ['notes', 'deleted'].includes(notes.folder) ? { window, notes } : null;
  }
  function finderOwner(windowId, folderId) {
    const window = ordinary(windowId, 'finder');
    if (!window || folderId !== undefined && window.folderId !== folderId) return null;
    const store = ctx.getFiles();
    const folder = liveMacFileRecords(store).find(file => file.id === window.folderId && file.kind === 'folder');
    if (!folder || !(id(folder.id) || isInstalledViewingFolderId(folder.id) && folder.readOnly === true)) return null;
    return { window, folder, store };
  }
  function noteLease(source, note = null) {
    const { window, notes } = source;
    const model = window.notesPresentation;
    const modelValues = { ...(model ?? notesPresentationDefaults(viewing.notes.mode)) };
    const view = { ...viewing.notes }, preferences = { ...notes.preferences };
    const noteValues = note ? { ...note } : null;
    const zoom = note ? viewing.notes.zooms[note.id] : undefined;
    const folder = notes.folder, search = notes.search, selectedId = notes.selectedId;
    return (allowSelection = false) => {
      const current = notesOwner(window.id);
      return current && current.window === window && current.notes === notes && notes.folder === folder
        && notes.search === search && (allowSelection || notes.selectedId === selectedId)
        && window.notesPresentation === model && sameValues(window.notesPresentation ?? notesPresentationDefaults(viewing.notes.mode), modelValues)
        && sameValues(viewing.notes, view) && sameValues(notes.preferences ?? {}, preferences)
        && (!note || visibleNotes(notes).includes(note) && sameValues(note, noteValues) && viewing.notes.zooms[note.id] === zoom);
    };
  }
  function finderLease(source) {
    const { window, folder, store } = source;
    const folderValues = { ...folder }, model = window.finderPresentation;
    const modelValues = { ...(model ?? finderPresentationDefaults()) };
    const browseMode = window.finderBrowseMode;
    const view = viewing.finder.folderViews[folder.id], viewValues = view ? { ...view } : null;
    return () => {
      const current = finderOwner(window.id, folder.id);
      return current && current.window === window && current.folder === folder && current.store === store
        && sameValues(folder, folderValues) && window.finderPresentation === model
        && sameValues(window.finderPresentation ?? finderPresentationDefaults(), modelValues)
        && window.finderBrowseMode === browseMode
        && viewing.finder.folderViews[folder.id] === view && (!view || sameValues(view, viewValues));
    };
  }
  async function prepare(windowId, lease) {
    try { return Boolean(await ctx.prepare(windowId)) && Boolean(lease()); } catch { return false; }
  }
  function canCommit(candidate, windowCandidate) {
    return ctx.validateCandidate(candidate, windowCandidate) === true;
  }
  async function finishNotes(windowId, kind, noteId, focus) {
    try { await ctx.finishNotes(windowId, kind, noteId, focus); } catch { /* Committed data does not depend on rendering. */ }
  }
  async function finishFinder(windowId, focus) {
    try { await ctx.finishFinder(windowId, focus); } catch { /* Committed data does not depend on rendering. */ }
  }
  const optionsOwner = target => {
    const pane = presentation.options;
    if (!pane || pane.id !== target.optionsId || pane.windowId !== target.windowId) return null;
    const source = finderOwner(pane.windowId, pane.folderId);
    return source ? { ...source, pane } : null;
  };
  function ownedPane(source) {
    const pane = presentation.options;
    return pane?.windowId === source.window.id && pane.folderId === source.folder.id ? pane : null;
  }
  function dismissOptions() {
    // Native lifecycle dismissal never returns focus into a background root.
    // Cancel pending setups as well as discarding any retained native token.
    const hadPane = presentation.options !== null;
    optionsEpoch++;
    focusReturns.clear();
    presentation.options = null;
    if (hadPane) ctx.changed();
  }
  function notesForWindow(windowId) {
    const window = ordinary(windowId, 'notes', false);
    if (!window) return null;
    const notes = ctx.getNotes(), model = window.notesPresentation ?? notesPresentationDefaults(viewing.notes.mode);
    return { windowId, folder: notes.folder, view: readNotesView(viewing, model.mode, notes.folder), presentation: { ...model },
      noteId: notes.selectedId ?? null, zoom: viewing.notes.zooms[notes.selectedId] ?? 1 };
  }
  function finderForWindow(windowId) {
    const window = ordinary(windowId, 'finder', false);
    if (!window) return null;
    const folder = liveMacFileRecords(ctx.getFiles()).find(file => file.id === window.folderId && file.kind === 'folder');
    const pane = folder ? ownedPane({ window, folder }) : null;
    const view = viewing.finder.folderViews[window.folderId]
      ?? { ...finderViewDefaults(), mode: window.finderBrowseMode ?? 'icons' };
    return { windowId, folderId: window.folderId, folderAvailable: Boolean(folder), view: { ...view },
      chrome: { ...(window.finderPresentation ?? finderPresentationDefaults()) }, options: pane ? { ...pane } : null,
      ...(pane ? { nativeControls: ctx.getOptionsControls(windowId, pane.id) } : {}) };
  }
  const handlers = {
    'notes.view.set': async (target, payload) => {
      if (!fields(target, ['windowId', 'folder']) || !id(target.windowId) || !['notes', 'deleted'].includes(target.folder)
        || !validNotesViewPatch(payload)) return invalid();
      const source = notesOwner(target.windowId);
      if (!source || source.notes.folder !== target.folder) return stale();
      if (target.folder === 'deleted' && (Object.hasOwn(payload, 'sortBy') || Object.hasOwn(payload, 'sortDirection')))
        return rejected('disabled', 'Recently Deleted always uses the global default Notes sort.');
      const lease = noteLease(source);
      let focus;
      try { focus = ctx.captureFocus(); } catch { return unavailable(); }
      if (!await prepare(target.windowId, lease)) return stale();
      const nextNotes = { ...viewing.notes, ...payload };
      const beforePresentation = source.window.notesPresentation ?? notesPresentationDefaults(viewing.notes.mode);
      const nextPresentation = payload.mode === undefined
        ? { ...beforePresentation } : notesPresentationDefaults(payload.mode);
      if (!validNotesPresentation(nextPresentation)) return stale();
      const candidate = { ...viewing, notes: nextNotes };
      if (!canCommit(candidate, { windowId: target.windowId, notesPresentation: nextPresentation })) return limited();
      viewing.notes = nextNotes;
      source.window.notesPresentation = nextPresentation;
      ctx.changed();
      const result = { ...target, view: readNotesView(viewing, nextPresentation.mode, target.folder), presentation: { ...nextPresentation } };
      const presentationChanged = beforePresentation.mode !== nextPresentation.mode || beforePresentation.documentVisible !== nextPresentation.documentVisible;
      await finishNotes(target.windowId, presentationChanged ? 'row' : 'preserve', source.notes.selectedId, focus);
      return applied(result);
    },
    'notes.view.openNote': async (target, payload) => {
      if (!noteTarget(target) || !fields(payload, [])) return invalid();
      const source = notesOwner(target.windowId), note = source && visibleNotes(source.notes).find(note => note.id === target.noteId);
      const model = source && (source.window.notesPresentation ?? notesPresentationDefaults(viewing.notes.mode));
      if (!note || !validNotesPresentation(model)) return stale();
      const lease = noteLease(source, note);
      if (!await prepare(target.windowId, lease)) return stale();
      const nextPresentation = { mode: model.mode, documentVisible: true };
      if (!canCommit(viewing, { windowId: target.windowId, notesPresentation: nextPresentation })) return limited();
      const selected = await ctx.selectNote(target.windowId, target.noteId);
      if (selected?.status !== 'applied') return selected ?? stale();
      // Selection is canonical and already committed. Never reject it merely
      // because a later render disappeared; also never modify a replacement owner.
      if (lease(true) && source.notes.selectedId === target.noteId) {
        source.window.notesPresentation = nextPresentation;
        ctx.changed();
        await finishNotes(target.windowId, 'body', target.noteId);
      }
      return applied({ ...target, presentation: { ...(source.window.notesPresentation ?? model) } });
    },
    'notes.view.return': async (target, payload) => {
      if (!windowTarget(target) || !fields(payload, [])) return invalid();
      const source = notesOwner(target.windowId), model = source && (source.window.notesPresentation ?? notesPresentationDefaults(viewing.notes.mode));
      if (!source || model.mode !== 'gallery' || !model.documentVisible) return stale();
      const lease = noteLease(source);
      if (!await prepare(target.windowId, lease)) return stale();
      const nextPresentation = notesPresentationDefaults('gallery');
      if (!canCommit(viewing, { windowId: target.windowId, notesPresentation: nextPresentation })) return limited();
      source.window.notesPresentation = nextPresentation; ctx.changed();
      await finishNotes(target.windowId, 'row', source.notes.selectedId);
      return applied({ ...target, presentation: { ...nextPresentation } });
    },
    'notes.view.zoom': async (target, payload) => {
      if (!noteTarget(target) || !fields(payload, ['action']) || !['in', 'out', 'reset'].includes(payload.action)) return invalid();
      const source = notesOwner(target.windowId), note = source && visibleNotes(source.notes).find(note => note.id === target.noteId && note.id === source.notes.selectedId);
      const model = source && (source.window.notesPresentation ?? notesPresentationDefaults(viewing.notes.mode));
      if (!note || !model.documentVisible) return stale();
      const lease = noteLease(source, note), before = viewing.notes.zooms[target.noteId] ?? 1;
      if (!NOTE_ZOOM_STEPS.includes(before)) return stale();
      if (!await prepare(target.windowId, lease)) return stale();
      const index = NOTE_ZOOM_STEPS.indexOf(before);
      const zoom = payload.action === 'reset' ? 1 : NOTE_ZOOM_STEPS[Math.max(0, Math.min(NOTE_ZOOM_STEPS.length - 1, index + (payload.action === 'in' ? 1 : -1)))];
      const zooms = { ...viewing.notes.zooms };
      if (zoom === 1) delete zooms[target.noteId]; else zooms[target.noteId] = zoom;
      const nextNotes = { ...viewing.notes, zooms }, candidate = { ...viewing, notes: nextNotes };
      if (Object.keys(zooms).length > VIEWING_LIMIT || !canCommit(candidate)) return limited();
      viewing.notes = nextNotes; ctx.changed();
      await finishNotes(target.windowId, 'preserve', target.noteId);
      return applied({ ...target, zoom });
    },
    'finder.view.set': async (target, payload) => {
      if (!folderTarget(target) || !validFinderView(payload, true)) return invalid();
      const source = finderOwner(target.windowId, target.folderId); if (!source) return stale();
      const lease = finderLease(source);
      let focus;
      try { focus = ctx.captureFocus(); } catch { return unavailable(); }
      if (!await prepare(target.windowId, lease)) return stale();
      const view = { ...(viewing.finder.folderViews[target.folderId]
        ?? { ...finderViewDefaults(), mode: source.window.finderBrowseMode ?? 'icons' }), ...payload };
      const folderViews = { ...viewing.finder.folderViews, [target.folderId]: view };
      const candidate = { ...viewing, finder: { ...viewing.finder, folderViews } };
      if (Object.keys(folderViews).length > VIEWING_LIMIT || !canCommit(candidate)) return limited();
      viewing.finder = candidate.finder; source.window.finderBrowseMode = view.mode; ctx.changed();
      await finishFinder(target.windowId, focus);
      return applied({ ...target, view: { ...view } });
    },
    'finder.chrome.set': async (target, payload) => {
      if (!windowTarget(target) || !validFinderPresentation(payload, true)) return invalid();
      const window = ordinary(target.windowId, 'finder'); if (!window) return stale();
      const model = window.finderPresentation, before = { ...(model ?? finderPresentationDefaults()) };
      const lease = () => ordinary(window.id, 'finder') === window && window.finderPresentation === model
        && sameValues(window.finderPresentation ?? finderPresentationDefaults(), before);
      if (!await prepare(target.windowId, lease)) return stale();
      const chrome = { ...before, ...payload };
      if (payload.toolbarVisible === false) chrome.sidebarVisible = false;
      if (!validFinderPresentation(chrome)) return rejected('disabled', 'Show Sidebar requires the toolbar to be visible.');
      if (!canCommit(viewing, { windowId: target.windowId, finderPresentation: chrome })) return limited();
      window.finderPresentation = chrome; ctx.changed();
      await finishFinder(target.windowId);
      return applied({ ...target, chrome: { ...chrome } });
    },
    'finder.view.options.open': async (target, payload) => {
      if (!folderTarget(target) || !fields(payload, [])) return invalid();
      const source = finderOwner(target.windowId, target.folderId); if (!source) return stale();
      const lease = finderLease(source), epoch = ++optionsEpoch, previous = presentation.options;
      const previousValues = previous ? { ...previous } : null;
      let token;
      try { token = previous?.windowId === target.windowId && previous.folderId === target.folderId && focusReturns.has(previous.id)
        ? focusReturns.get(previous.id) : ctx.captureFocus(); } catch { return unavailable(); }
      if (!await prepare(target.windowId, lease) || epoch !== optionsEpoch || presentation.options !== previous
        || previous && !sameValues(previous, previousValues)) return stale();
      const number = presentation.nextOptionsId;
      if (!Number.isSafeInteger(number) || number < 1 || number >= Number.MAX_SAFE_INTEGER - 1) return limited();
      const paneValues = { id: `view-options-${number}`, windowId: target.windowId, folderId: target.folderId };
      presentation.nextOptionsId = number + 1;
      presentation.options = paneValues; presentation.error = null;
      // Svelte may proxy newly assigned records. Lease its actual retained value.
      const pane = presentation.options;
      focusReturns.clear(); focusReturns.set(pane.id, token); ctx.changed();
      let focused = false;
      try { focused = await ctx.focusOptions(target.windowId, pane.id, 'panel'); } catch { /* Roll back only the exact pane we installed. */ }
      if (!focused || !lease() || presentation.options !== pane || !sameValues(pane, paneValues) || epoch !== optionsEpoch) {
        if (presentation.options === pane && sameValues(pane, paneValues) && epoch === optionsEpoch) {
          presentation.options = null; focusReturns.delete(pane.id); ctx.changed();
          try { await ctx.restoreFocus(token, () => epoch === optionsEpoch && presentation.options === null && Boolean(lease())); } catch { /* The source may have disappeared. */ }
        }
        return stale();
      }
      return applied({ ...target, optionsId: pane.id });
    },
    'finder.view.options.close': async (target, payload) => {
      if (!optionsTarget(target) || !fields(payload, [])) return invalid();
      const source = optionsOwner(target); if (!source) return stale();
      const lease = finderLease(source), token = focusReturns.get(source.pane.id), epoch = ++optionsEpoch;
      presentation.options = null; focusReturns.delete(source.pane.id); ctx.changed();
      try { await ctx.restoreFocus(token, () => epoch === optionsEpoch && presentation.options === null && Boolean(lease())); } catch { /* Closing is committed even if restoration fails. */ }
      return applied({ ...target });
    },
    'finder.view.options.focus': async (target, payload) => {
      if (!optionsTarget(target, true) || !fields(payload, [])) return invalid();
      const source = optionsOwner(target); if (!source) return stale();
      const lease = finderLease(source);
      const paneValues = { ...source.pane };
      let focused = false;
      try { focused = await ctx.focusOptions(target.windowId, target.optionsId, target.control); } catch { return unavailable(); }
      if (!focused || !lease() || presentation.options !== source.pane || !sameValues(source.pane, paneValues)) return stale();
      return applied({ ...target });
    },
    'finder.view.options.scroll': async (target, payload) => {
      if (!optionsTarget(target) || !fields(payload, ['top', 'left'], ['top']) || !scrollOffset(payload.top)
        || Object.hasOwn(payload, 'left') && !scrollOffset(payload.left)) return invalid();
      const source = optionsOwner(target); if (!source) return stale();
      const lease = finderLease(source);
      const paneValues = { ...source.pane };
      let actual;
      try { actual = await ctx.scrollOptions(target.windowId, target.optionsId, { top: payload.top, left: payload.left ?? 0 }); } catch { return unavailable(); }
      if (!actual || !lease() || presentation.options !== source.pane || !sameValues(source.pane, paneValues) || !fields(actual, ['top', 'left'])
        || !scrollOffset(actual.top) || !scrollOffset(actual.left)) return stale();
      return applied({ ...target, top: actual.top, left: actual.left });
    },
  };
  return { handlers, notesForWindow, finderForWindow, dismissOptions,
    targets: () => ({ options: presentation.options ? { ...presentation.options } : null,
      optionsControls: [...VIEW_OPTIONS_CONTROLS], zoomSteps: [...NOTE_ZOOM_STEPS] }) };
}

const profiles = ['macos-golden-gate-27.0.1'], capability = 'shell.view-workflows';
const win = object({ windowId: identity }), note = object({ windowId: identity, noteId: identity });
const folder = object({ windowId: identity, folderId: folderIdentity });
const paneIdSchema = { type: 'string', pattern: '^view-options-[1-9][0-9]*$' };
const pane = object({ windowId: identity, optionsId: paneIdSchema });
const focus = object({ ...pane.properties, control: choice(...VIEW_OPTIONS_CONTROLS) });
const viewTarget = object({ windowId: identity, folder: choice('notes', 'deleted') });
const partial = properties => ({ ...object(properties, []), minProperties: 1,
  anyOf: Object.entries(properties).map(([key, schema]) => match({ [key]: schema })) });
const finiteOffset = { type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const define = (name, target, payload, result, data, presentation, requires = []) => {
  const entry = defineCommand(profiles, name, capability, target, payload,
    ['A current Golden Gate root permits view workflows; exact original ordinary window is foreground, visible, nonminimized and not hidden/quitting.', ...requires],
    presentation, data, NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  entry[1].completion = { mode: 'promise', success: 'applied',
    settles: 'Atomic validated model commitment and attempted exact-owner DOM/focus settlement; committed mutations cannot fail solely because a later render disappears. Native pane focus/scroll requires the original owned pane and reports actual offsets.' };
  return entry;
};
const catalog = Object.fromEntries([
  define('notes.view.set', viewTarget, partial(notesViewProperties), object({ ...viewTarget.properties,
    view: object(notesViewProperties), presentation: notesPresentationSchema }),
  ['Persist last-used Notes mode, shared note-count visibility and Notes folder sort overrides after complete quota validation; preserve all other windows’ own presentation.'],
  ['Switch the exact window to list/detail or gallery/cards. Recently Deleted rejects folder sort overrides and always uses global Notes defaults.']),
  define('notes.view.openNote', note, empty, object({ ...note.properties, presentation: notesPresentationSchema }), [],
    ['Use canonical Notes selection and open real same-window detail, preserving list/gallery mode; focus contents at the end.'], ['The note is visible in the exact current Notes collection.']),
  define('notes.view.return', win, empty, object({ ...win.properties, presentation: notesPresentationSchema }), [],
    ['Return this gallery detail window to its cards without changing other windows or note data.'], ['The exact gallery window currently shows document detail.']),
  define('notes.view.zoom', note, object({ action: choice('in', 'out', 'reset') }), object({ ...note.properties, zoom: choice(...NOTE_ZOOM_STEPS) }),
    ['Persist only the targeted selected note zoom; reset removes its override; preserve text, timestamps and default text size.'],
    ['Render real note detail at bounded zoom steps.'], ['The exact window shows the selected visible note detail.']),
  define('finder.view.set', folder, partial(finderViewSchema.properties), object({ ...folder.properties, view: finderViewSchema }),
    ['Persist one complete current-folder preference; no inherited defaults or Always Open In policy. Readonly installation folders permit local view preferences.'],
    ['Present real icons/list/columns/gallery, deterministic metadata sorting/grouping and bounded native view options.']),
  define('finder.chrome.set', win, { ...partial(finderPresentationSchema.properties), allOf: finderPresentationSchema.allOf }, object({ ...win.properties, chrome: finderPresentationSchema }),
    ['Persist only this window’s toolbar/sidebar/path/status/preview chrome.'],
    ['Hiding the toolbar also hides the sidebar and moves any shown status bar to the top. Showing the toolbar never forces the sidebar back.'], ['Sidebar cannot be shown without the toolbar; explicitly impossible toolbar=false/sidebar=true payloads reject.']),
  define('finder.view.options.open', folder, empty, object({ ...folder.properties, optionsId: paneIdSchema }), [],
    ['Open one exact-owned nonmodal pane with a fresh monotonic identity and private original focus token; late setups cannot replace a newer pane.']),
  define('finder.view.options.close', pane, empty, pane, [],
    ['Close only the exact pane; restore original focus only while its original window/folder remains current and no newer pane owns focus.']),
  define('finder.view.options.focus', focus, empty, focus, [], ['Focus the actual named native control of this exact pane; never borrow replacement controls.']),
  define('finder.view.options.scroll', pane, object({ top: finiteOffset, left: finiteOffset }, ['top']), object({ ...pane.properties, top: finiteOffset, left: finiteOffset }), [],
    ['Scroll the actual exact-owned pane and report its real clamped offsets.']),
]);
catalog['notes.view.set'].requestSchema.allOf = [{
  if: match({ target: match({ folder: { const: 'deleted' } }) }),
  then: match({ payload: match({ sortBy: false, sortDirection: false }, []) }, []),
}];
export function viewWorkflowCatalog(profile) {
  return profile?.id === profiles[0] && profile.capabilities?.includes(capability) ? catalog : {};
}

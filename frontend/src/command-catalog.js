export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
const MOJAVE = 'macos-mojave-10.14';
const NONE = [];
const EMPTY_PROPERTIES = {};
const text = { type: 'string' };
const identity = { type: 'string', minLength: 1 };
const flag = { type: 'boolean' };
const number = { type: 'number' };
const offset = { type: 'number', minimum: 0 };
const choice = (...values) => ({ enum: values });
const object = (properties = EMPTY_PROPERTIES, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
// Partial matching is for conditionals, not closed request/target objects.
const match = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required,
});
const empty = object();
const windowTarget = object({ windowId: identity });
const noteTarget = object({ noteId: identity });
const menuTarget = object({ menuId: { const: 'window' } });
const menuItemTarget = object({ menuId: { const: 'window' }, itemId: identity });
const optionalFocus = object({ focus: flag }, NONE);
const folder = choice('notes', 'deleted');
const contextItem = choice('pin', 'delete', 'restore');
const visibleView = 'An existing, non-minimized Notes view; never opened implicitly.';
const currentNote = 'noteId belongs to the current folder/search collection (describe().targets.notes.eligibleIds).';
const requestedFocus = 'focus:true additionally requires the visible Notes view before any data mutation.';
const completion = {
  mode: 'promise', success: 'applied',
  settles: 'Handler state, Svelte DOM flush, requested native focus, and actual retained scroll offsets. Not asynchronous font/media/animation completion.',
};

const anyObject = { type: 'object' };
function define(name, capability, target, payload, requires, presentation, data = NONE, rules = NONE, resultTarget = anyObject) {
  const required = ['command'];
  if (target !== empty) required.push('target');
  if (payload.required?.length || payload.anyOf) required.push('payload');
  const requestSchema = {
    $schema: JSON_SCHEMA_DIALECT,
    ...object({ command: { const: name }, requestId: identity, target, payload }, required),
  };
  if (rules.length) requestSchema.allOf = rules;
  return [name, {
    profiles: [MOJAVE], capability, requestSchema, requires,
    effects: { data, presentation }, completion,
    resultSchema: {
      ...object({ status: { const: 'applied' }, requestId: identity, target: resultTarget }, ['status', 'target']),
      additionalProperties: true,
    },
  }];
}

export const commandCatalog = Object.fromEntries([
  define('app.open', 'shell.apps', object({ appId: identity }), object({ title: text }, NONE),
    ['appId is in targets.applications; workspace dimensions are available.'],
    ['Open/restore, activate and stack the window; optional contextual title; focus its root.'], NONE, NONE,
    object({ appId: identity, windowId: identity })),
  define('window.focus', 'shell.windows', windowTarget, object({ keyboard: flag }, NONE),
    ['windowId is in targets.windows, including minimized windows.'],
    ['Restore, activate, stack; root keyboard focus defaults true, false preserves native child focus.']),
  define('window.close', 'shell.windows', windowTarget, empty,
    ['windowId is in targets.windows.'],
    ['Remove the window; select the last remaining visible window as active; application data survives.']),
  define('window.setMinimized', 'shell.windows', windowTarget, object({ minimized: flag }),
    ['windowId is in targets.windows.'],
    ['Set minimized state; false restores/activates/focuses the root; retain app data and scroll.']),
  define('window.setZoomed', 'shell.windows', windowTarget, object({ zoomed: flag }),
    ['Existing non-minimized window.'],
    ['Set workspace zoom or restore normal bounds; activate and focus the root.']),
  define('window.move', 'shell.windows', windowTarget, object({ x: number, y: number }),
    ['Existing, non-minimized, non-zoomed window; coordinates are finite physical workspace pixels.'],
    ['Clamp window position to workspace; no activation.']),
  define('desktop.refreshLayout', 'shell.desktop', empty, empty,
    ['Mounted desktop view; actual workspace/Dock dimensions are positive.'],
    ['Measure real browser workspace; refit normal/zoomed windows, including minimized restore geometry.']),
  define('desktop.select', 'shell.desktop', object({ fileId: { type: ['string', 'null'] } }), empty,
    ['Non-null fileId is in targets.desktopFiles.'],
    ['Select file and activate desktop; null deselects without changing active app.']),
  define('desktop.open', 'shell.apps', object({ fileId: identity }), empty,
    ['fileId is in targets.desktopFiles; app.open requirements also apply.'],
    ['Open the registered app with the file contextual title through app.open.'], NONE, NONE,
    object({ appId: identity, windowId: identity })),
  define('desktop.focus', 'shell.desktop', empty, empty, NONE,
    ['Clear selection and active window, dismiss menus, blur managed-window controls.']),
  define('desktop.focusControl', 'shell.desktop', { oneOf: [
    object({ control: { const: 'file' }, fileId: identity }),
    object({ control: { const: 'dock' }, appId: identity }),
    object({ control: { const: 'dock' }, itemId: choice('downloads', 'trash') }),
    object({ control: { const: 'window-menu' } }),
    object({ control: { const: null } }),
  ] }, empty,
    ['Mounted desktop control; file/app identity must be in the actual desktop/Dock registry.'],
    ['Focus semantic control; null only records focus outside desktop controls without moving it.']),
  define('desktop.scroll', 'shell.window-menu', object({ region: { const: 'window-menu' } }), object({ top: offset }),
    ['Window popup is open; mounted desktop view.'],
    ['Set popup scroll; retain its actual clamped pixel offset.']),
  define('menu.open', 'shell.window-menu', menuTarget, {
    ...object({ position: choice('first', 'last'), itemId: identity }, NONE),
    not: match({ position: true, itemId: true }),
  }, ['Mounted Window menu; an explicit item must currently be enabled.'],
    ['Open at menu-bar anchor; select/focus first (default), last, or specified enabled item; empty menu selects null.']),
  define('menu.close', 'shell.window-menu', menuTarget, object({ restoreFocus: flag }, NONE), NONE,
    ['Dismiss popup and reset its scroll; restore button focus defaults true.']),
  define('menu.select', 'shell.window-menu', object({ menuId: { const: 'window' }, itemId: { type: ['string', 'null'] } }), empty,
    ['Open popup; item is enabled and current; null only when there are no enabled items.'],
    ['Select and focus semantic menu item.']),
  define('menu.execute', 'shell.window-menu', menuItemTarget, empty,
    ['Item is currently enabled; menu need not be open; shared window-operation requirements apply.'],
    ['Run shared close/minimize/zoom/focus operation; dismiss popup; focus Window button.']),
  define('notes.create', 'notes.plain-text', empty, optionalFocus, [requestedFocus],
    ['Switch to Notes folder, clear search, select new record; optional title focus.'],
    ['Create session-local active plain-text record.'], NONE, object({ noteId: identity })),
  define('notes.edit', 'notes.plain-text', noteTarget, object({ text }),
    [currentNote, 'Target must be selected and non-deleted; no window required.'],
    ['Clear search before text mutation to retain the editor.'], ['Replace text; update simulated modification time and derived title/preview.']),
  define('notes.setPinned', 'notes.plain-text', noteTarget, object({ pinned: flag, focus: flag }, ['pinned']),
    [currentNote, 'Record is non-deleted.', requestedFocus],
    ['Reorder pinned collection, dismiss context, reconcile selection/focus; optional row focus.'],
    ['Set explicit pin value, without changing timestamps.']),
  define('notes.trash', 'notes.plain-text', noteTarget, optionalFocus,
    [currentNote, 'Record is non-deleted.', requestedFocus],
    ['Reconcile selection/focus, dismiss context; optional remaining-row/New note focus.'], ['Move record to Recently Deleted.']),
  define('notes.restore', 'notes.plain-text', noteTarget, optionalFocus,
    [currentNote, 'Record is deleted.', requestedFocus],
    ['Remain in Recently Deleted, reconcile selection/focus, dismiss context; optional remaining-row/New note focus.'],
    ['Restore record to active Notes.']),
  define('notes.select', 'notes.presentation', noteTarget, optionalFocus, [currentNote, requestedFocus],
    ['Select record, dismiss context; optional row focus; no implicit window open.']),
  define('notes.selectFolder', 'notes.presentation', object({ folder }), empty, NONE,
    ['Set collection, preserve search, reconcile selection/focus, dismiss context.']),
  define('notes.search', 'notes.presentation', empty, object({ query: text }), NONE,
    ['Set normalized case-insensitive title/body search; reconcile selection/focus and dismiss context.']),
  define('notes.setSidebarVisible', 'notes.presentation', empty, object({ visible: flag }), NONE,
    ['Set folder-sidebar visibility, dismiss context, clear hidden-folder focus; preserve other native toolbar focus.']),
  define('notes.context.open', 'notes.presentation', noteTarget, {
    ...object({ x: number, y: number, focus: flag }, NONE), dependentRequired: { x: ['y'], y: ['x'] },
  }, [currentNote, visibleView, 'Explicit paired x/y are finite logical-window pixels.'],
    ['Select target and open clamped context menu; default row anchoring reveals offscreen row; optional first-item focus.']),
  define('notes.context.close', 'notes.presentation', empty, optionalFocus,
    [visibleView, 'A live context menu exists.'], ['Dismiss context; optional row/New note focus return.']),
  define('notes.context.select', 'notes.presentation', object({ item: contextItem }), optionalFocus,
    [visibleView, 'Live context record belongs to current collection; item is offered for its deleted state.'],
    ['Set context item and optionally focus/highlight it.']),
  define('notes.context.execute', 'notes.plain-text', object({ noteId: identity, item: contextItem }), object({ focus: flag, pinned: flag }, NONE),
    [visibleView, currentNote, 'Live context targets this noteId and offers this item.'],
    ['Dismiss context and reconcile selection/focus through the same data handlers.'],
    ['Set explicit pin value, trash, or restore the record.'], [{
      if: match({ target: match({ item: { const: 'pin' } }) }),
      then: match({ payload: match({ pinned: flag }) }),
      else: match({ payload: { type: 'object', not: match({ pinned: true }) } }, NONE),
    }]),
  define('notes.focus', 'notes.presentation', { oneOf: [
    object({ control: choice('title', 'body', 'search', 'new-note', 'sidebar', 'delete', 'restore', 'none') }),
    object({ control: { const: 'row' }, noteId: identity }),
    object({ control: { const: 'folder' }, folder }),
    object({ control: { const: 'context' }, item: contextItem }),
  ] }, {
    ...object({ observe: flag, select: flag }, NONE),
    not: match({ observe: { const: true }, select: { const: true } }),
  }, [visibleView, 'Control must exist for current selection/folder/sidebar/context; row belongs to current collection.'],
    ['Focus semantic control and activate Notes; select:true selects text when supported. Observe:true records native focus without activation/caret changes; none clears it.'], NONE, [{
      if: match({ target: match({ control: { const: 'none' } }) }),
      then: match({ payload: match({ observe: { const: true } }) }),
    }]),
  define('notes.scroll', 'notes.presentation', object({ area: choice('list', 'editor') }), {
    ...object({ top: offset, left: offset, observe: flag }, NONE), anyOf: [match({ top: true }), match({ left: true })],
  }, [visibleView, 'Editor additionally requires a selected current record; coordinates are finite nonnegative pixels.'],
    ['Apply offsets, or observe native scrolling without moving it; retain actual clamped offsets; editor means body textarea.']),
]);

import { defineCommand, NONE, identity, flag, offset, choice, object, empty, match } from './command-schema.js';

const define = defineCommand.bind(null, ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1']);
const app = object({ appId: identity }), window = object({ windowId: identity }), item = object({ itemId: identity });
const available = 'The native macOS Dock is mounted and the scene is not disposed or blocked by a global modal.';
const menu = 'A current native Dock context menu is open; use its enabled live item IDs.';
const overview = 'App Expose is open; windowId belongs to that actual application and remains live.';
const capability = 'shell.dock-context';
const pairedPoints = ['x', 'y'].map((key, index) => ({
  if: match({ payload: match({ [key]: offset }, [key]) }, ['payload']),
  then: match({ payload: match({ [index ? 'x' : 'y']: offset }, [index ? 'x' : 'y']) }, ['payload']),
}));
const nullableIdentity = { oneOf: [identity, { type: 'null' }] };
const itemTarget = object({ itemId: identity }), optionalItem = object({ itemId: nullableIdentity });
const coordinate = { type: 'number' };
const preferenceProperties = { size: { type: 'number', minimum: 16, maximum: 128 }, magnification: flag,
  magnificationSize: { type: 'number', minimum: 32, maximum: 192 }, autoHide: flag, minimizeIntoApp: flag, showRecent: flag };
const preferences = object(preferenceProperties);
const management = 'shell.dock-management';

export const macDockCatalog = Object.fromEntries([
  define('dock.place', management, itemTarget, object({ beforeItemId: nullableIdentity }), [available, 'Use installed app, actual folder or live minimized-window keys; own-section beforeItemId or null for its end. Finder remains first and Trash last.'],
    ['Add/pin/place an app or real folder alias atomically, or reorder a live file-side item; never move source records, cross native sections or change window/app lifetime.'],
    ['Change canonical pin/main/secondary order only.'], NONE, object({ itemId: identity, beforeItemId: nullableIdentity, index: { type: 'integer', minimum: 0 } })),
  define('dock.drag.begin', management, itemTarget, object({ x: coordinate, y: coordinate, source: choice('dock', 'bundle', 'folder') }, ['x', 'y']),
    [available, 'No active Dock gesture. Actual movable alias, installed application bundle or live directory source; fixed Finder/Trash reject.'],
    ['Begin observable native drag with real source identity and physical pointer origin; dismiss competing presentations and reveal Dock.'], NONE, NONE,
    object({ itemId: identity, source: choice('dock', 'bundle', 'folder') })),
  define('dock.drag.update', management, empty, object({ x: coordinate, y: coordinate }), [available, 'Canonical Dock drag is active.'],
    ['Record raw pointer and actual DOM drop plan, including section/protected/removal validity; do not apply order or pin changes before end.'], NONE, NONE,
    object({ itemId: identity, beforeItemId: nullableIdentity, remove: flag, valid: flag })),
  define('dock.drag.end', management, empty, object({ cancel: flag }, []), [available, 'Canonical Dock drag is active.'],
    ['Apply the current valid real place/unpin plan, or end cancellation without moving aliases/bundles; release canonical drag and unused auto-hide reveal.'], NONE, NONE,
    object({ itemId: identity, cancelled: flag, removed: flag })),
  define('dock.focus', management, optionalItem, object({ observe: flag }, []), [available, 'Non-null itemId is a current actual Dock control.'],
    ['Reveal and focus semantic app/window/folder/separator control, or observe native focus without moving it; null clears Dock focus.'], NONE, NONE, optionalItem),
  define('dock.hover', management, optionalItem, object({ x: offset }, []), [available, 'Non-null itemId is a current actual Dock control; null clears with an empty payload.'],
    ['Record physical magnification point, defaulting to actual icon anchor, and reveal native Dock; adjacent icons/layout reflect canonical preference/hover.'], NONE, [{
      if: match({ target: match({ itemId: { const: null } }) }), then: match({ payload: empty }),
    }], optionalItem),
  define('dock.visibility', management, empty, object({ visible: flag }), [available, 'Hiding requires auto-hide enabled and no active context, folder stack, drag, hover or focused Dock control.'],
    ['Reveal or dismiss actual native Dock; pointer edge/keyboard/focus and direct cues share this state. Auto-hide reserves no workspace even during temporary reveal.'], NONE, NONE, object({ visible: flag })),
  define('dock.preferences.open', management, empty, empty, [available, 'The actual Settings application is not quitting.'],
    ['Open/restore its single real managed Dock preference pane, not an operator overlay or copied Settings window.'], NONE, NONE, object({ appId: { const: 'settings' }, windowId: identity })),
  define('dock.preferences.set', management, empty, { ...object(preferenceProperties, []), minProperties: 1 },
    [available, 'Closed partial actual preferences; showRecent additionally requires shell.dock-recents and rejects in High Sierra.'],
    ['Update real size/magnification/auto-hide/minimize-into-app/recent presentation and native controls; refit only base workspace changes, not magnification hover.'],
    ['Retain canonical session preferences independently of window/app lifetime and immutable profiles.'], [match({ payload: true })], object({ preferences })),
  define('dock.activate', capability, app, empty, [available, 'appId is an installed application.'],
    ['Leave app overview and desktop/Dock menus, then use real app.open to launch/restore/focus the application.'], NONE, NONE,
    object({ appId: identity, windowId: nullableIdentity })),
  define('dock.pin', capability, app, object({ pinned: flag }), [available, 'Finder remains pinned.'],
    ['Set native Keep in Dock idempotently; a running unpinned application retains its live alias until quit. Pin a recent/other installed application into the app side.'],
    ['Change only scene-local Dock aliases/order, never install, move or delete an application bundle.'], NONE, object({ appId: identity, pinned: flag })),
  define('dock.reveal', capability, app, empty, [available, 'The application has a real readonly simulated bundle record.'],
    ['Open/focus an ordinary Finder destination for the actual containing directory, select/reveal the exact application bundle and retain independent other Finder locations.'],
    NONE, NONE, object({ appId: identity, fileId: identity, folderId: identity, windowId: identity })),
  define('dock.context.open', capability, { oneOf: [app, object({ itemId: { ...identity, pattern: '^(separator|downloads|folder:.+)$' } })] }, object({ x: offset, y: offset }, []),
    [available, 'Application has a rendered Dock alias, or itemId identifies the actual separator/current real folder alias.'],
    ['Reveal/open the canonical app/window/Options, folder appearance/actions or native Dock-options tree above its real anchor; close competing presentation and focus first enabled entry.'],
    NONE, pairedPoints, object({ menuId: { const: 'dock-context' }, appId: nullableIdentity })),
  define('dock.context.close', capability, empty, object({ restoreFocus: flag }, []), [available],
    ['Dismiss the native Dock tree, returning to its real alias by default; false preserves outside/native focus.'], NONE, NONE,
    object({ menuId: { const: 'dock-context' } })),
  define('dock.context.select', capability, item, object({ openSubmenu: flag }, []), [available, menu],
    ['Select/reveal/focus an enabled current entry and publish its branch. False collapses a parent; child entries require the branch open. Scroll only the menu pane.'],
    NONE, NONE, object({ menuId: { const: 'dock-context' }, itemId: identity })),
  define('dock.context.execute', capability, item, empty, [available, menu],
    ['Execute the exact current enabled leaf via real application/window/alias/Finder/App Expose commands, including whole-app Hide/Show without reopening or unminimizing. Disabled or parent entries reject before mutation; successful actions close the originating tree.'],
    NONE, NONE, object({ menuId: { const: 'dock-context' }, itemId: identity, appId: nullableIdentity })),
  define('dock.context.scroll', capability, object({ region: choice('main', 'submenu') }), object({ top: offset, observe: flag }, ['top']), [available, menu, 'The requested menu pane is rendered.'],
    ['Set a clamped real menu-pane scroll offset, or observe actual DOM scrolling with observe:true. Retain the actual value through highlight/refit.'],
    NONE, NONE, object({ region: choice('main', 'submenu'), top: offset })),
  define('dock.windows.open', capability, app, empty, [available, 'appId is installed; zero windows is an honest empty overview.'],
    ['Show native App Expose using the same live managed application surfaces, including minimized windows. Retain all normal/minimized/restore geometry, data and activation; block ordinary window interaction until exit.'],
    NONE, NONE, object({ appId: identity, windowIds: { type: 'array', items: identity, uniqueItems: true } })),
  define('dock.windows.close', capability, empty, empty, [available],
    ['Exit app overview without changing real window geometry/minimized state; restore prior live window/Dock/workspace keyboard focus.'], NONE, NONE, empty),
  define('dock.windows.select', capability, window, empty, [available, overview],
    ['Select/focus the real app-window hit target without activating, restoring or moving its managed window.'], NONE, NONE,
    object({ appId: identity, windowId: identity })),
  define('dock.windows.activate', capability, window, empty, [available, overview],
    ['Exit app overview and restore/focus the exact managed window through window.focus, retaining its data and saved normal geometry.'], NONE, NONE,
    object({ appId: identity, windowId: identity })),
]);

import { defineCommand, NONE, identity, flag, offset, choice, object, empty, match } from './command-schema.js';

const define = defineCommand.bind(null, ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0']);
const app = object({ appId: identity }), window = object({ windowId: identity }), item = object({ itemId: identity });
const available = 'The native macOS Dock is mounted and the scene is not disposed or blocked by a global modal.';
const menu = 'A current native Dock context menu is open; use its enabled live item IDs.';
const overview = 'App Expose is open; windowId belongs to that actual application and remains live.';
const capability = 'shell.dock-context';
const pairedPoints = ['x', 'y'].map((key, index) => ({
  if: match({ payload: match({ [key]: offset }, [key]) }, ['payload']),
  then: match({ payload: match({ [index ? 'x' : 'y']: offset }, [index ? 'x' : 'y']) }, ['payload']),
}));

export const macDockCatalog = Object.fromEntries([
  define('dock.activate', capability, app, empty, [available, 'appId is an installed application.'],
    ['Leave app overview and desktop/Dock menus, then use real app.open to launch/restore/focus the application.'], NONE, NONE,
    object({ appId: identity, windowId: identity })),
  define('dock.pin', capability, app, object({ pinned: flag }), [available, 'Finder remains pinned.'],
    ['Set native Keep in Dock idempotently; a running unpinned application retains its live alias until quit. Pin a recent/other installed application into the app side.'],
    ['Change only scene-local Dock aliases/order, never install, move or delete an application bundle.'], NONE, object({ appId: identity, pinned: flag })),
  define('dock.reveal', capability, app, empty, [available, 'The application has a real readonly simulated bundle record.'],
    ['Open/focus an ordinary Finder destination for the actual containing directory, select/reveal the exact application bundle and retain independent other Finder locations.'],
    NONE, NONE, object({ appId: identity, fileId: identity, folderId: identity, windowId: identity })),
  define('dock.context.open', capability, app, object({ x: offset, y: offset }, []), [available, 'The application has a currently rendered Dock alias.'],
    ['Open the canonical native app/window/Options tree above its real icon by default, or at the paired viewport anchor. Close other desktop menus/overview; focus the first enabled entry.'],
    NONE, pairedPoints, object({ menuId: { const: 'dock-context' }, appId: identity })),
  define('dock.context.close', capability, empty, object({ restoreFocus: flag }, []), [available],
    ['Dismiss the native Dock tree, returning to its real alias by default; false preserves outside/native focus.'], NONE, NONE,
    object({ menuId: { const: 'dock-context' } })),
  define('dock.context.select', capability, item, object({ openSubmenu: flag }, []), [available, menu],
    ['Select/reveal/focus an enabled current entry and publish its branch. False collapses a parent; child entries require the branch open. Scroll only the menu pane.'],
    NONE, NONE, object({ menuId: { const: 'dock-context' }, itemId: identity })),
  define('dock.context.execute', capability, item, empty, [available, menu],
    ['Execute the exact current enabled leaf via real application/window/alias/Finder/App Expose commands. Disabled or parent entries reject before mutation; successful actions close the originating tree.'],
    NONE, NONE, object({ menuId: { const: 'dock-context' }, itemId: identity, appId: identity })),
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

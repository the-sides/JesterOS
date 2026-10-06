import { defineCommand, NONE, identity, text, flag, offset, choice, object, empty } from './command-schema.js';

const macProfiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0'];
const nullableIdentity = { oneOf: [identity, { type: 'null' }] };
const page = { type: 'integer', minimum: 0 };
const ids = { type: 'array', items: identity };
const region = choice('main', 'folder');
const item = object({ itemId: identity });
const folder = object({ folderId: identity });
const name = object({ folderId: identity, name: text });
const scene = 'The original scene is mounted and laid out, with no global native modal.';
const launcher = 'Launchpad owns actual connected, enabled, laid-out native controls and measured physical scroll.';
const arrangement = 'Launchpad is open with an empty search query and no active rename draft; normal drag does not require editing mode.';
const membership = ['launchpad.pages', 'launchpad.folders', 'launchpad.nextFolderId'];
const transient = ['launchpad.view', 'nativeFocus'];
const define = (command, target, payload, requires, effects, data, result) => {
  const entry = defineCommand(macProfiles, command, 'shell.launchpad', target, payload, requires, effects, data, NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};

export const launchpadCatalog = Object.fromEntries([
  define('shell.launchpad.open', empty, empty, [scene],
    ['Dismiss competing native presentations, retain exact original return focus/caret, and focus actual Search. An already owned launcher is idempotent and keeps its original return token.',
      'Launchpad is a shell presentation, never a managed window or an application-running marker.'],
    transient, object({ page, folderId: nullableIdentity, itemId: identity })),
  define('shell.launchpad.close', empty, object({ restoreFocus: flag }, []), [scene],
    ['Idempotently close Launchpad. Default restores exact original connected focus/caret; false leaves outside focus untouched. Failed physical restoration rolls the presentation back.'],
    transient, object({ closed: flag })),
  define('shell.launchpad.select', item, empty, [scene, launcher, 'itemId is an actual visible enabled control.'],
    ['Reveal and focus the actual control, retain DOM-clamped scroll, and select without activating an application.'],
    transient, item),
  define('shell.launchpad.search', empty, object({ query: text }), [scene, launcher],
    ['Case-insensitive application-name substring search flattens persistent root/folder traversal into one scrollable result region, without launching anything.',
      'Close an open folder and discard only its transient rename draft. Preserve actual Search caret and restore the pre-search main page when clearing; view.searchReturnPage records that page.'],
    transient, object({ query: text, itemIds: ids })),
  define('shell.launchpad.setPage', object({ region }), object({ page }), [scene, launcher, 'The requested region is active and its page exists. Main search results are not paged.'],
    ['Change the actual main/folder page and native focus without application activation, preserving Search or rename-input typing.',
      'While editing with an empty query, main page equal to launchpad.pages.length is a transient virtual blank preview; it writes no persistent page.'],
    transient, object({ region, page })),
  define('shell.launchpad.setEditing', empty, object({ editing: flag }), [scene, launcher],
    ['Set native jiggle mode without fake uninstall controls. Ending editing clamps a virtual blank page to the last persistent page.'],
    transient, object({ editing: flag })),
  define('shell.launchpad.scroll', object({ region }), object({ top: offset, left: offset }), [scene, launcher, 'The requested actual scroll region is active.'],
    ['Scroll only the actual connected region and retain and return its measured DOM-clamped finite nonnegative offsets. A late request after dismissal is rejected without re-creating a view.'],
    ['launchpad.view.scroll'], object({ region, top: offset, left: offset })),
  define('shell.launchpad.activate', object({ appId: identity }), empty, [scene, launcher, 'The exact installed eligible app is visible in the current page, folder page or search results, and editing/rename is inactive. Classic Dashboard is eligible; Launchpad itself and unrelated shell presentations are not.'],
    ['Clear Launchpad and settle before invoking the existing typed app.open. Never duplicate app data/window/lifecycle logic.',
      'Verify the real returned original owner, active app/window and actual native original focus, or the actual windowless Dashboard focus with a null window identity. Any downstream rejection or physical failure restores arrangement, view, competing trees, originals, scroll and focus/caret.'],
    [...transient, 'windows', 'activeWindowId', 'activeAppId', 'applications.running', 'applications.mru'], object({ appId: identity, windowId: nullableIdentity })),
  define('shell.launchpad.folder.open', folder, empty, [scene, launcher, 'The folder is a visible root control with an empty query and no other open folder.'],
    ['Open the existing Launchpad folder at its first actual 21-app page and focus its first application control; do not activate any application.'],
    transient, object({ folderId: identity, page, itemId: identity })),
  define('shell.launchpad.folder.close', empty, empty, [scene, launcher],
    ['Idempotently close only the folder, discard only its rename draft, and restore actual parent folder-tile focus in Launchpad.'],
    transient, object({ closed: flag })),
  define('launchpad.move', item, object({ folderId: nullableIdentity, page, beforeItemId: nullableIdentity }), [scene, launcher, arrangement,
    'Destination is an existing main/folder page or the editing-only virtual next main page. A before control belongs to that destination page and is not the moved item. Only applications may enter folders.'],
    ['Remove the source then locate the surviving before item by stable identity; null appends to the destination page. Root insertion cascades overflow forward at 35 controls; folders retain flat app order in 21-app chunks.',
      'Compact empty root pages, dissolve emptied source folders, retain single-app folders, show/focus the actual final destination, and return its post-compaction location. No nesting, application/file mutation, copies or lifetime changes.'],
    [...membership, ...transient], object({ itemId: identity, folderId: nullableIdentity, page, index: page })),
  define('launchpad.folder.create', object({ appId: identity, overAppId: identity }), object({ name: text }, []), [scene, launcher, arrangement,
    'The distinct source is an installed arranged app anywhere; the target app is at root. Optional name trims nonempty and contains no NUL or line break.'],
    ['Replace the root target slot with a monotonic Launchpad folder containing [overAppId, appId], remove the source old location, dissolve its emptied folder and compact empty pages.',
      'Default name is Folder, a declared browser policy. Focus the actual new folder tile; never create a filesystem folder or app copy.'],
    [...membership, ...transient], object({ folderId: identity, appIds: ids })),
  define('launchpad.folder.rename', folder, object({ name: text }), [scene, launcher,
    'The existing folder is a current visible root tile or the open folder. Name trims nonempty and contains no NUL or line break; duplicate names are allowed.'],
    ['Change only the existing Launchpad folder label, close its matching rename draft, and restore actual label/tile focus. Invalid input preserves its record and matching draft with explicit validation.'],
    ['launchpad.folders[].name', ...transient], name),
  define('launchpad.folder.rename.begin', folder, empty, [scene, launcher, 'The exact existing folder is open.'],
    ['Create canonical draft {folderId,name,error:null}; focus the actual inline name input and select its initial name.'],
    transient, folder),
  define('launchpad.folder.rename.change', empty, object({ name: text }), [scene, launcher, 'A matching open-folder rename draft exists.'],
    ['Update only draft text, clear explicit validation error, and preserve native input caret. Do not rename the record yet.'],
    transient, name),
  define('launchpad.folder.rename.commit', empty, empty, [scene, launcher, 'A matching open-folder rename draft exists.'],
    ['Commit trimmed nonempty draft text without NUL or line break, close the draft and focus the actual folder name.',
      'Invalid input rejects while retaining the unchanged folder record and draft, presenting canonical rename.error in the native folder panel.'],
    ['launchpad.folders[].name', ...transient], name),
  define('launchpad.folder.rename.cancel', empty, empty, [scene, launcher, 'A matching open-folder rename draft exists.'],
    ['Discard only the draft, leave the folder name/arrangement unchanged, and restore actual folder-name control focus.'],
    transient, folder),
]);

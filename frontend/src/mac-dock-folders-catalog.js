import { defineCommand, NONE, identity, flag, offset, choice, object, empty, match } from './command-schema.js';

const profiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0'];
const capability = 'shell.dock-stacks';
const define = (...args) => {
  const [name, descriptor] = defineCommand(profiles, args[0], capability, ...args.slice(1));
  return [name, { ...descriptor, resultSchema: { ...descriptor.resultSchema, additionalProperties: false } }];
};
const file = object({ fileId: identity }), item = object({ itemId: identity }), folder = object({ folderId: identity });
const preferenceFields = { view: choice('fan', 'grid', 'list', 'automatic'), display: choice('folder', 'stack'),
  sortBy: choice('name', 'date-added', 'date-created', 'date-modified', 'kind') };
const preferences = object(preferenceFields);
const available = 'The native macOS Dock is mounted; the scene is alive and not blocked by a global modal.';
const current = 'A live pinned-root stack is open; its current folder remains within the actual root ancestry after moves or deletion.';
const aliases = 'Use an actual live folder record, excluding Trash and the volume; readonly directories are supported.';
const fileOpening = 'Use desktop.open on the exact real file; retain actual application/window authority and independent other Finder destinations.';

export const macDockFoldersCatalog = Object.fromEntries([
  define('dock.folder.pin', file, object({ pinned: flag }), [available, aliases],
    ['Set a scene-local folder alias idempotently. Append/remove its secondary order key; removal deletes its settings, closes its open root and prunes alias focus/hover.'],
    ['Never move, copy, modify or delete a filesystem record.'], NONE, object({ fileId: identity, itemId: identity, pinned: flag })),
  define('dock.folder.preferences.set', file, { ...object(preferenceFields, []), minProperties: 1 },
    [available, aliases, 'The folder has a current pinned alias. Supply at least one own preference; validate the entire closed partial batch before writes.'],
    ['Update actual sorted contents and Folder/Stack/Fan/Grid/List/Automatic presentation. Explicit view updates reset the temporary More override; retain and settle actual native focus/scroll.'],
    ['Change only folder alias settings, never file metadata or records.'], [match({ payload: true })], object({ fileId: identity, preferences })),
  define('dock.stack.open', item, empty, [available, 'itemId is a canonical current live pinned folder alias; the actual Dock control has a physical anchor.'],
    ['Reveal the Dock and open one real folder popup at its actual alias. Dismiss competing menus/overview, initialize root/path and settle first-file or Open in Finder focus. Roll back reveal when the anchor is unavailable.'],
    NONE, NONE, object({ itemId: identity, folderId: identity })),
  define('dock.stack.close', empty, object({ restoreFocus: flag }, []), [available],
    ['Close the stack idempotently. By default restore actual root-alias focus via dock.focus; false preserves native outside focus and releases an otherwise unused auto-hide reveal.'],
    NONE, NONE, empty),
  define('dock.stack.select', item, object({ observe: flag }, []), [available, current, 'itemId is a rendered enabled current file, back, more or open-finder control.'],
    ['Reveal/physically focus the real stack control and retain actual scroll; observe:true records native focus without moving it. Selection never opens a file.'],
    NONE, NONE, item),
  define('dock.stack.activate', file, empty, [available, current, 'fileId is an actual live immediate child of the current folder, not a stale/wrong-parent record.'],
    ['Navigate directories within the real stack; other records open through desktop.open and close the stack only on applied. Return only actual application/window identities when supplied by that open.'],
    [fileOpening], NONE, object({ fileId: identity, folderId: identity, appId: identity, windowId: identity }, ['fileId', 'folderId'])),
  define('dock.stack.navigate', folder, empty, [available, current, 'folderId is a live direct child directory or a current actual path ancestor within the pinned root.'],
    ['Navigate only within actual root ancestry; reset scroll/temporary view override, rebuild the real parent path and settle native first-control focus/actual scroll. Never open a Finder window for stack navigation.'],
    NONE, NONE, folder),
  define('dock.stack.openInFinder', empty, empty, [available, current],
    ['Open the current real folder record, not always the root or Downloads; close the stack on applied and focus its actual managed Finder destination.'],
    [fileOpening], NONE, object({ fileId: identity, appId: identity, windowId: identity })),
  define('dock.stack.scroll', empty, object({ top: offset, left: offset, observe: flag }, ['top']),
    [available, current, 'The real stack pane is rendered. Offsets are finite and nonnegative.'],
    ['Set actual clamped vertical/horizontal pane offsets and retain the values read from DOM; observe:true reads native pane scrolling without moving it.'],
    NONE, NONE, object({ top: offset, left: offset })),
  define('dock.stack.showMore', empty, empty, [available, current, 'The current rendered fan has its enabled overflow More control.'],
    ['Temporarily show the real complete grid, reset pane offsets and settle first-file focus. Never change the configured root folder view preference.'],
    NONE, NONE, object({ view: { const: 'grid' } })),
]);

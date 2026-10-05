import { defineCommand, NONE, identity, flag, choice, object, empty } from './command-schema.js';
import { STACK_GROUPS, STACK_SORTS } from './desktop-stacks-model.js';

const define = defineCommand.bind(null, ['macos-mojave-10.14', 'macos-sonoma-14.0']);
const stackTarget = object({ stackId: identity });
const surface = 'The native desktop item pane is mounted, visible, and not blocked by a global modal.';
const enabled = 'Use Stacks is enabled; stackId is a current groups[].stackId in targets.desktop.stacks.';
const point = { type: 'number', minimum: 0 };

export const desktopStacksCatalog = Object.fromEntries([
  define('desktop.stacks.set', 'shell.desktop-stacks', empty, object({ enabled: flag }), [surface],
    ['Set Use Stacks idempotently. A transition closes context/rename/selection and collapses covers; restores desktop focus. Disabling restores retained free icon placement.'],
    ['Retain real files, saved positions, grouping and member-sort preferences. Never moves a file or creates synthetic filesystem records.'], NONE, object({ enabled: flag })),
  define('desktop.stacks.group', 'shell.desktop-stacks', empty, object({ by: choice(...STACK_GROUPS) }), [surface, 'Use Stacks is enabled.'],
    ['Regroup real desktop documents by kind, retained timestamp, or primary Finder tag. Folders/volumes remain individual. A change collapses old groups and closes their focus/cover/selection; preserve an active view inspector. Refocus the desktop when replacing its context menu or a focused stack header.'],
    NONE, NONE, object({ by: choice(...STACK_GROUPS) })),
  define('desktop.stacks.sort', 'shell.desktop-stacks', empty, object({ by: choice(...STACK_SORTS) }), [surface, 'Use Stacks is enabled.'],
    ['Sort members within each stack; stable name tie-breaks. Retain expanded groups and any still-live explicitly browsed cover. Global desktop sorting and saved free positions are unchanged.'],
    NONE, NONE, object({ by: choice(...STACK_SORTS) })),
  define('desktop.stacks.expand', 'shell.desktop-stacks', stackTarget, object({ expanded: flag }), [surface, enabled],
    ['Expand/collapse this stack and focus its actual native header. Expanded members render below the header; other stack expansion is retained. Close context/rename and real-file selection.'],
    NONE, NONE, object({ stackId: identity, expanded: flag })),
  define('desktop.stacks.browse', 'shell.desktop-stacks', stackTarget, object({ direction: choice('previous', 'next') }), [surface, enabled, 'The stack is collapsed.'],
    ['Cycle the visible cover through actual sorted member IDs with wraparound; publish its actual filename and focus the native header. No file mutation or implicit expansion.'],
    NONE, NONE, object({ stackId: identity, fileId: identity, index: { type: 'integer', minimum: 0 } })),
  define('desktop.stacks.open', 'shell.desktop-stacks', stackTarget, empty, [surface, enabled],
    ['Open the actual current cover file through the existing native application lifecycle; return its real file/app/window IDs.'],
    ['Record a successful virtual-file opening in its simulated lastOpenedAt timestamp.'], NONE,
    object({ stackId: identity, fileId: identity, appId: identity, windowId: identity })),
  define('desktop.stacks.focus', 'shell.desktop-stacks', stackTarget, empty, [surface, enabled],
    ['Activate the desktop, publish focusedStackId and reveal/focus the actual header in the icon pane only.'], NONE, NONE, object({ stackId: identity })),
  define('desktop.stacks.context', 'shell.desktop-stacks', stackTarget, object({ x: point, y: point }), [surface, enabled],
    ['Select this stack’s real member file IDs atomically and open the canonical native file context at viewport x/y. Existing group actions affect actual records only; context return focuses the header when the cover is hidden.'],
    NONE, NONE, object({ stackId: identity, fileId: identity, menuId: { const: 'desktop-context' } })),
]);

import { defineCommand, NONE, identity, flag, offset, choice, object, empty } from './command-schema.js';

const macProfiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0'];
const space = object({ spaceId: identity }), window = object({ windowId: identity });
const item = object({ itemId: identity }), region = choice('windows', 'spaces');
const ids = { type: 'array', items: identity };
const nullableIdentity = { oneOf: [identity, { type: 'null' }] };
const scene = 'The original managed scene is mounted and laid out, with no global native modal.';
const overview = 'Mission Control owns an actual mounted available overview and the requested live enabled native control.';
const eligible = 'The installed original window is live, visible, nonminimized and not pending application quit.';
const membership = ['spaces.desktops', 'spaces.order', 'spaces.activeSpaceId', 'spaces.lastDesktopId', 'windows[].spaceId'];
const transient = ['spaces.overview', 'activeWindowId', 'activeAppId', 'nativeFocus'];
const define = (name, target, payload, requires, effects, data, result) => {
  const entry = defineCommand(macProfiles, name, 'shell.mission-control', target, payload, requires, effects, data, NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};

export const spacesCatalog = Object.fromEntries([
  define('shell.missionControl.open', empty, empty, [scene],
    ['Dismiss competing native presentations, retain exact return focus/caret, and focus an actual original-window or current Space control.',
      'Freeze eligible ordinary preview-desktop originals in creation order. Full-screen and Split View Spaces remain derived from existing original membership.'],
    transient, object({ spaceId: identity, itemId: identity })),
  define('shell.missionControl.close', empty, object({ restoreFocus: flag }, []), [scene],
    ['Idempotently close the native overview. By default restore exact connected original focus/caret, or activate the current eligible Space/workspace; false leaves outside focus untouched.'],
    transient, object({ closed: flag })),
  define('shell.missionControl.select', item, empty, [scene, overview],
    ['Focus the actual enabled mounted control, retain DOM-clamped scroll in both regions, and select without activating a Space or application.'],
    ['spaces.overview.selectedItemId', 'spaces.overview.scroll', 'nativeFocus'], item),
  define('shell.missionControl.setExpanded', empty, object({ expanded: flag }), [scene, overview],
    ['Expand or collapse the native top strip. Repair selection/focus to the nearest enabled survivor when a delete/exit control becomes hidden.'],
    ['spaces.overview.expanded', 'spaces.overview.selectedItemId', 'spaces.overview.scroll', 'nativeFocus'], object({ expanded: flag })),
  define('shell.missionControl.scroll', object({ region }), object({ top: offset, left: offset }), [scene, overview],
    ['Scroll the requested actual native region and retain and return its measured DOM-clamped nonnegative offsets.'],
    ['spaces.overview.scroll'], object({ region, top: offset, left: offset })),
  define('shell.missionControl.activate', window, empty, [scene, overview, eligible, 'The exact original is a current ordinary preview-desktop overview member.'],
    ['Close Mission Control and activate/focus that exact original on its HOME desktop without changing geometry, data, draft or caret.'],
    transient, object({ windowId: identity, spaceId: identity })),
  define('space.create', empty, empty, [scene, 'Fewer than 16 ordinary desktops exist.'],
    ['Append a monotonic ordinary desktop without switching the current active Space. An open overview focuses its actual new Space control.'],
    [...membership, 'spaces.nextDesktopId', ...transient], space),
  define('space.remove', space, empty, [scene, 'The live target is an ordinary desktop and at least one other ordinary desktop exists.'],
    ['Migrate every HOME owner, including hidden, minimized, quitting and full-screen originals, to the nearest preceding ordinary desktop, or following when first.',
      'Retain all originals, data and geometry. Settle foreground only when its desktop disappears; keep Mission Control open with nearest enabled selection.'],
    [...membership, ...transient], object({ spaceId: identity, destinationSpaceId: identity, windowIds: ids })),
  define('space.activate', space, empty, [scene, 'The target is a live ordinary desktop, solo full-screen, Split View or supported enabled Dashboard Space.'],
    ['Close the overview and focus a root-selected MRU eligible original, actual empty workspace or real windowless Dashboard widget board. Never open an ordinary app or restore a minimized original.'],
    [...membership, ...transient], object({ spaceId: identity, windowId: nullableIdentity })),
  define('window.moveToSpace', object({ windowId: identity, spaceId: identity }), empty, [scene, eligible, 'The original is normal, and the live destination is an ordinary desktop.'],
    ['Change only the original HOME membership; never change geometry or activate the destination. Settle a moved foreground on its remaining current desktop/workspace.',
      'Keep an open Mission Control overview and repair its nearest surviving enabled selection.'],
    [...membership, ...transient], object({ windowId: identity, spaceId: identity })),
  define('space.exitFullScreen', space, empty, [scene, 'The target is a live solo full-screen or Split View Space.'],
    ['Exit all group originals through the existing typed full-screen commands, preserving their individual HOME memberships.',
      'Keep the overview open with repaired focus; outside it activate the first original’s HOME. This browser policy does not close or quit either original.'],
    [...membership, ...transient, 'windows[].fullScreen', 'presentation.splitViews', 'presentation.pairing', 'presentation.greenMenu', 'presentation.revealed'],
    object({ spaceId: identity, windowIds: ids })),
  define('space.pair', object({ windowId: identity, spaceId: identity }), empty, [scene, eligible, 'The source is normal or solo full-screen; the target is another live eligible solo full-screen Space.'],
    ['Use typed Split View begin on the target at left and accept the exact source at right. Dismiss the intermediate chooser and preserve/reopen the overview selecting the derived stable pair Space.',
      'Any downstream rejection or actual preparation/focus failure restores prior HOME/full-screen memberships, pair order, owners, focus, scroll and competing presentations.'],
    [...membership, ...transient, 'windows[].fullScreen', 'presentation.splitViews', 'presentation.pairing', 'presentation.greenMenu', 'presentation.revealed'],
    object({ spaceId: identity, leftWindowId: identity, rightWindowId: identity })),
]);

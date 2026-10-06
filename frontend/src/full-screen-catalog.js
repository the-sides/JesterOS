import { defineCommand, NONE, identity, flag, offset, choice, object, empty } from './command-schema.js';

const macProfiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1'];
const allProfiles = [...macProfiles, 'windows11-23h2-22631.2428'];
const modernMacProfiles = ['macos-sonoma-14.0', 'macos-golden-gate-27.0.1'];
const window = object({ windowId: identity }), item = object({ itemId: identity });
const side = choice('left', 'right'), ratio = { type: 'number', minimum: 0.2, maximum: 0.8 };
const nullableIdentity = { oneOf: [identity, { type: 'null' }] };
const pair = object({ leftWindowId: identity, rightWindowId: identity, ratio });
const picking = object({ windowId: identity, side, selectedWindowId: nullableIdentity });
const visible = 'The original managed stage is mounted and laid out, with no native global modal.';
const eligible = 'An installed original managed window is live, visible, nonminimized, and not pending application quit.';
const picker = 'The foreground initiator owns a mounted picker; the target is an exact live eligible original candidate rendered there.';
const menu = 'The visible active modern macOS window owns a mounted native green-button menu and the exact requested enabled rendered item.';
const membership = ['windows[].fullScreen', 'presentation.splitViews'];
const presentation = ['presentation.pairing', 'presentation.greenMenu', 'presentation.revealed'];
const focus = ['activeWindowId', 'activeAppId'];
const define = (name, capability, target, payload, requires, effects, data, result) => defineCommand(
  capability === 'shell.window-green-menu' ? modernMacProfiles : capability === 'shell.split-view' ? macProfiles : allProfiles,
  name, capability, target, payload, requires, effects, data, NONE, result);
const full = (...args) => define(args[0], 'shell.full-screen', ...args.slice(1));
const split = (...args) => define(args[0], 'shell.split-view', ...args.slice(1));
const green = (...args) => define(args[0], 'shell.window-green-menu', ...args.slice(1));

export const fullScreenCatalog = Object.fromEntries([
  full('window.setFullScreen', window, object({ fullScreen: flag }), [visible, 'Entering requires an eligible original window; exiting also permits existing hidden/minimized membership.'],
    ['Enter or exit the browser-contained stage on the original window. Enter focuses that exact original; exit one member leaves its partner solo.',
      'Retain all normal and restore bounds, zoom/maximize/minimized flags, application DOM, data and drafts. No host fullscreen or display API.',
      'Cancel temporary pairing with captured prior membership. Restore competing presentations, membership and physical focus if native preparation fails.'],
    [...membership, ...presentation, ...focus], object({ windowId: identity, appId: identity, fullScreen: flag })),
  full('shell.fullScreen.reveal', object({ edge: choice('top', 'launcher') }), object({ visible: flag }), [visible, 'A foreground full-screen, split or pairing stage; hiding cannot strand an owned native popup or focused launcher control.'],
    ['Reveal or conceal the actual native menu/caption or Dock/taskbar over the managed stage; never alter launcher preferences or normal workspace reservation.'],
    ['presentation.revealed'], object({ edge: choice('top', 'launcher'), visible: flag })),
  split('window.splitView.begin', window, object({ side }), [visible, eligible, 'The initiator is not paired and no picker is already open. Background pairs are retained.'],
    ['Temporarily enter the original initiator full screen on the requested side; freeze eligible original candidate IDs, focus/reveal the first real control, or the actual empty-picker Cancel surface.',
      'An existing solo-fullscreen initiator is supported. Roll back failed view preparation, membership, presentations and actual focus.'],
    [...membership, ...presentation, ...focus], picking),
  split('window.splitView.setSide', window, object({ side }), [visible, 'The target is the exact foreground mounted picker initiator.'],
    ['Change only the projected half; settle the actual focused candidate and retained clamped scroll. Never change normal geometry.'],
    ['presentation.pairing'], picking),
  split('window.splitView.select', window, empty, [visible, picker],
    ['Focus/reveal the exact mounted original candidate and retain actual scroll without accepting or activating another app.'],
    ['presentation.pairing.selectedWindowId', 'presentation.pairing.scroll'], window),
  split('window.splitView.accept', window, empty, [visible, picker],
    ['Select the exact actual candidate; pair the two original windows and focus the accepted candidate. Preserve all background groups.',
      'Replacement preserves the old ratio and returns the replaced member to the ordinary desktop. Roll back membership, picker, native focus and scroll on failure.'],
    [...membership, ...presentation, ...focus], pair),
  split('window.splitView.cancel', empty, object({ restoreFocus: flag }, []), [visible],
    ['Idempotently dismiss the picker, restore the captured initiator fullScreen flag or replaced pair, and restore actual original focus unless restoreFocus is false.'],
    [...membership, ...presentation], object({ cancelled: flag })),
  split('window.splitView.resize', empty, object({ ratio }), [visible, 'The foreground stage is a live split pair.'],
    ['Change only that pair’s projection ratio within 0.2..0.8; retain original window geometry and background groups.'],
    ['presentation.splitViews[].ratio'], object({ ratio })),
  split('window.splitView.swap', empty, empty, [visible, 'The foreground stage is a live split pair.'],
    ['Swap only that pair’s original member positions; retain active original focus, ratio, geometry, data and other pairs.'],
    ['presentation.splitViews'], object({ leftWindowId: identity, rightWindowId: identity })),
  split('window.splitView.scroll', empty, object({ top: offset, left: offset }), [visible, 'The foreground initiator owns an actual mounted picker, including its empty state.'],
    ['Scroll the actual mounted picker pane and return and retain its DOM-clamped top/left offsets.'],
    ['presentation.pairing.scroll'], object({ top: offset, left: offset })),
  green('window.splitView.replace', window, empty, [visible, eligible, 'The target is a live paired member and no picker is open.'],
    ['Keep the partner on its original side as picker initiator. Capture the prior pair and replaced identity; cancel restores the pair, accept returns the replaced member to desktop.',
      'Prepare, focus and scroll real candidate controls; roll back actual membership, competing presentations and physical focus on failure.'],
    [...membership, ...presentation, ...focus], picking),
  green('window.splitView.makeFullScreen', window, empty, [visible, eligible, 'The target is a live paired member and no picker is open.'],
    ['Detach only its group, retaining both members as separate original solo fullscreen windows; focus the selected original.'],
    [...membership, ...presentation, ...focus], object({ windowId: identity, fullScreen: { const: true } })),
  green('window.greenMenu.open', window, empty, [visible, eligible],
    ['Open the actual Sonoma hover menu: normal Enter Full Screen/Tile Left/Tile Right; solo Exit Full Screen; paired Replace Tiled Window/Move Window to Desktop/Make Window Full Screen.',
      'Keep the actual green-button anchor top reveal visible in a fullscreen stage. Focus the first enabled native item and retain measured scroll.',
      'Restore prior presentation and actual focus on failed preparation.'],
    [...membership, ...presentation, ...focus], object({ windowId: identity, itemId: identity })),
  green('window.greenMenu.close', empty, object({ restoreFocus: flag }, []), [visible],
    ['Idempotently close and restore the actual original control/window focus by default; false preserves outside focus.'],
    ['presentation.greenMenu'], object({ closed: flag })),
  green('window.greenMenu.select', item, empty, [visible, menu],
    ['Focus/reveal the exact enabled mounted native item and retain its actual clamped scroll.'],
    ['presentation.greenMenu.itemId', 'presentation.greenMenu.scrollTop'], item),
  green('window.greenMenu.execute', item, empty, [visible, menu],
    ['Invoke the same actual full-screen, pairing, replacement, desktop exit or separate-fullscreen transition; preserve real downstream rejection and rollback, never acknowledge a mock action.'],
    [...membership, ...presentation, ...focus], object({ windowId: identity, action: choice('full-screen', 'tile-left', 'tile-right', 'replace-tiled', 'move-to-desktop', 'make-full-screen') })),
  green('window.greenMenu.scroll', empty, object({ top: offset }), [visible, menu],
    ['Scroll the actual mounted native menu pane; return and retain its measured DOM-clamped offset.'],
    ['presentation.greenMenu.scrollTop'], object({ top: offset })),
]);

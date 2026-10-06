import { defineCommand, NONE, identity, flag, offset, choice, object, empty, match } from './command-schema.js';

const macProfiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1'];
const allProfiles = [...macProfiles, 'windows11-23h2-22631.2428'];
const item = object({ itemId: identity }), app = object({ appId: identity });
const direction = choice('next', 'previous');
const nullableIdentity = { oneOf: [identity, { type: 'null' }] };
const appIds = { type: 'array', uniqueItems: true, items: identity };
const actualActivation = object({ appId: identity, windowId: identity }, ['appId']);
const visibleScene = 'The scene is alive and laid out, with no native global modal.';
const switcher = 'A current mounted switcher and its actual rendered, live, nonquitting item identities.';
const menu = 'The visible active application owns a mounted native header-anchored application menu.';
const presentation = ['switching.switcher', 'switching.appMenu'];
const activation = ['activeAppId', 'activeWindowId', 'switching.activationAppIds', 'switching.activationWindowIds'];
const hidden = ['switching.hiddenAppIds'];
const define = (name, capability, target, payload, requires, effects, data, result, rules = NONE) => defineCommand(
  capability === 'app.visibility' ? macProfiles : allProfiles, name, capability, target, payload,
  requires, effects, data, rules, result);
const switchCommand = (name, target, payload, requires, effects, data, result) => define(
  name, 'shell.switcher', target, payload, requires, effects, data, result);
const visibilityCommand = (name, target, payload, requires, effects, data, result, rules) => define(
  name, 'app.visibility', target, payload, requires, effects, data, result, rules);

export const applicationSwitchingCatalog = Object.fromEntries([
  switchCommand('shell.switcher.open', empty, object({ direction, commitOnRelease: choice('Meta', 'Alt', null) }, []),
    [visibleScene, 'At least one eligible entry. commitOnRelease is Meta or null on macOS; Alt or null on Windows.'],
    ['Capture actual return focus before dismissing competing presentations. Freeze live MRU order and select the adjacent active item; default next.',
      'Mount, focus and reveal the actual selected control. Roll back presentation and physical focus if preparation fails.',
      'macOS lists running applications, including hidden, all-minimized and zero-window apps. Windows lists actual managed windows, including minimized windows.'],
    presentation, object({ kind: choice('applications', 'windows'), itemId: identity })),
  switchCommand('shell.switcher.close', empty, object({ restoreFocus: flag }, []), [visibleScene],
    ['Idempotently cancel without activation, lifetime, geometry or MRU changes. Restore actual captured connected focus or native foreground fallback unless restoreFocus is false.'],
    presentation, empty),
  switchCommand('shell.switcher.select', item, object({ observe: flag }, []), [visibleScene, switcher],
    ['Select, focus and reveal an exact rendered live item without activation. observe:true records only actual mounted control focus. Retain actual scroll offsets.'],
    ['switching.switcher.selectedItemId', 'switching.switcher.scroll'], item),
  switchCommand('shell.switcher.step', empty, object({ direction }), [visibleScene, switcher],
    ['Move and focus selection in wrapped frozen order without activating or changing MRU; order does not oscillate when activation history changes.'],
    ['switching.switcher.selectedItemId', 'switching.switcher.scroll'], item),
  switchCommand('shell.switcher.activate', object({ itemId: identity }, []), empty, [visibleScene, switcher],
    ['Validate the selected default or exact current live item before dismissing the switcher and restoring physical foreground.',
      'macOS activates and unhides the real application without reopening or unminimizing windows. Windows restores/focuses the exact represented window through window.focus.'],
    [...presentation, ...activation, ...hidden, 'windows[].minimized'], actualActivation),
  switchCommand('shell.switcher.scroll', empty, object({ top: offset, left: offset, observe: flag }, ['top']), [visibleScene, switcher],
    ['Scroll the real switcher pane, preserving its actual DOM-clamped top/left offsets; omitted left retains current left. observe:true records actual DOM scrolling rather than trusting requested offsets.'],
    ['switching.switcher.scroll'], object({ top: offset, left: offset })),
  switchCommand('window.cycle', empty, object({ direction }, []), [visibleScene, 'At least one visible, nonminimized, nonquitting eligible managed window.'],
    ['Cycle exact windows in stable creation order, default next, independently of later MRU/stacking updates.',
      'macOS cycles the active application only and skips hidden/minimized windows. Windows cycles all visible nonminimized windows.',
      'Use window.focus for actual foreground and keyboard settlement; no eligible window rejects disabled without clearing presentations.'],
    [...presentation, ...activation], object({ appId: identity, windowId: identity })),
  visibilityCommand('app.setHidden', app, object({ hidden: flag }), [visibleScene, 'Installed, running, nonquitting macOS application. Hiding requires another nonquitting running app for the conservative browser foreground fallback.'],
    ['Set actual application-group visibility, including Finder. Parent settles nonhidden foreground and physical focus; explicit showing activates the app without reopening or unminimizing.',
      'Preserve every window/data/file record, normal/restore bounds, minimized/zoom state and independent Dock history; never minimize, close or reopen as a substitute.'],
    [...hidden, 'switching.appMenu', 'activeAppId', 'activeWindowId'], object({ appId: identity, hidden: flag })),
  visibilityCommand('app.hideOthers', app, empty, [visibleScene, 'The kept app and complete running application batch are installed, live and nonquitting.'],
    ['Atomically unhide the kept app and hide every other running group after whole-batch validation. Parent owns actual nonhidden foreground/focus; preserve retained windows/data/geometry.'],
    [...hidden, 'switching.appMenu', 'activeAppId', 'activeWindowId'], object({ appId: identity, hiddenAppIds: appIds })),
  visibilityCommand('app.showAll', empty, empty, [visibleScene, 'The complete hidden application batch remains installed, running and nonquitting.'],
    ['Clear hidden groups without minimizing, restoring, reopening or stealing the active owner; retain all application and window state.'],
    hidden, object({ hiddenAppIds: { ...appIds, maxItems: 0 } })),
  visibilityCommand('app.menu.open', object({ appId: identity }, []), object({ position: choice('first', 'last'), itemId: identity }, []),
    [visibleScene, 'Only the actual active, visible, running, nonquitting macOS application and its real native header anchor.', 'position and itemId are mutually exclusive.'],
    ['Open the native application tree at its first enabled item or exact requested enabled item. Golden Gate provides app-owned About utilities, real Notes Settings, and task-relevant Services; other Settings interiors remain disabled. Historical profiles retain disabled About/Preferences/Settings/Services rows. Browser policy disables visibility leaves that would change no group, and last-running-app Hide; this is not measured native enablement parity.',
      'Capture focus and competing presentations before mounting; settle actual menu focus/scroll and roll back failed preparation. Nullable itemId is only for a menu with no enabled leaves.'],
    presentation, object({ appId: identity, itemId: nullableIdentity }), [
      { not: match({ payload: match({ position: choice('first', 'last'), itemId: identity }) }) },
    ]),
  visibilityCommand('app.menu.close', empty, object({ restoreFocus: flag }, []), [visibleScene],
    ['Dismiss idempotently and physically restore its actual owner header by default; false preserves outside/native focus.'],
    ['switching.appMenu'], empty),
  visibilityCommand('app.menu.select', item, object({ observe: flag }, []), [visibleScene, menu, 'Exact enabled rendered native item, including a Golden Gate submenu parent.'],
    ['Select, focus and reveal the actual enabled item; observe:true records only actual mounted menu-control focus. Retain actual clamped menu scroll.'],
    ['switching.appMenu.itemId', 'switching.appMenu.scrollTop'], item),
  visibilityCommand('app.menu.execute', item, empty, [visibleScene, menu, 'Exact enabled rendered action leaf; submenu parents cannot execute. Golden Gate also routes About, Notes Settings and a relevant local selection service. Historical profiles retain visibility/lifetime leaves only. Finder cannot quit.'],
    ['Invoke the shared canonical action; preserve its real downstream rejection unchanged and close only on applied.',
      'Golden Gate restores the captured native source focus before dispatch and retains the action-owned result focus; historical profiles restore the header unless foreground/lifetime changes. Do not enable unavailable app interiors or simulate pixel clicks.'],
    [...presentation, ...hidden, ...activation, 'runningAppIds', 'pendingQuitAppIds', 'windows'], empty),
  visibilityCommand('app.menu.scroll', empty, object({ top: offset, observe: flag }, ['top']), [visibleScene, menu],
    ['Scroll the real native menu pane and retain its DOM-clamped offset. observe:true reads actual DOM scrolling rather than requested values.'],
    ['switching.appMenu.scrollTop'], object({ top: offset })),
]);

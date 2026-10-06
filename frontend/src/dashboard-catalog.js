import { defineCommand, NONE, identity, flag, number, offset, choice, object, empty } from './command-schema.js';
import { dashboardWidgetTypes, dashboardWidgetCommandSpecs } from './dashboard-widgets.js';

const classic = ['macos-high-sierra-10.13', 'macos-mojave-10.14'];
const nullableId = { oneOf: [identity, { type: 'null' }] };
const widget = object({ widgetId: identity });
const mode = choice('off', 'overlay', 'space');
const scene = 'A connected laid-out classic macOS scene with no global modal.';
const board = 'Dashboard owns the connected actual widget board and enabled native controls; closed/hidden presentations are unavailable.';
const define = (name, target, payload, requires, effects, data, result) => {
  const entry = defineCommand(classic, name, 'shell.dashboard', target, payload, requires, effects, data, NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};
const transient = ['dashboard.view', 'nativeFocus', 'spaces.activeSpaceId', 'activeWindowId'];
export const dashboardCatalog = Object.fromEntries([
  define('shell.dashboard.open', empty, empty, [scene, 'Mode is As Overlay or As Space, not Off.'],
    ['Open a windowless classic Dashboard, dismiss competing trees, retain exact invoker focus/caret and original window/data/lifetime. As Space activates the stable dashboard entry without assigning any original HOME.'],
    transient, object({ mode: choice('overlay', 'space') })),
  define('shell.dashboard.close', empty, object({ restoreFocus: flag }, []), [scene],
    ['Idempotently dismiss, return to a surviving prior Space/original and restore captured invoker focus by default. Retain all widget data/placement.'], transient, object({ closed: flag })),
  define('shell.dashboard.select', object({ itemId: identity }), empty, [scene, board],
    ['Reveal/focus an enabled actual control and retain canonical selected ID and measured pane scroll without executing it.'], transient, object({ itemId: identity })),
  define('shell.dashboard.scroll', empty, object({ top: offset, left: offset }), [scene, board],
    ['Scroll only the actual board and report DOM-clamped offsets. Chrome does not scroll; late requests after dismissal reject.'], ['dashboard.view.scroll'], object({ top: offset, left: offset })),
  define('shell.dashboard.setEditing', empty, object({ editing: flag }), [scene, board],
    ['Show/hide actual widget close controls and dismiss library/configuration; no uninstall or host widget execution.'], transient, object({ editing: flag })),
  define('shell.dashboard.setLibrary', empty, object({ open: flag }), [scene, board],
    ['Open/close the five-type local widget chooser; dismiss editing/configuration. No external More Widgets download.'], transient, object({ open: flag })),
  define('shell.dashboard.configure', object({ widgetId: nullableId }), empty, [scene, board, 'Widget is a live clock/weather instance, or null to finish configuration.'],
    ['Flip the actual supported widget to its controls or return to its front; city/unit changes use the domain commands.'], transient, object({ widgetId: nullableId })),
  define('dashboard.widget.add', object({ type: choice(...dashboardWidgetTypes) }), empty, [scene, board, 'The chooser is open and fewer than16 local instances exist.'],
    ['Allocate a monotonic independent widget instance and focus its actual surface; never duplicate another instance data object.'], ['dashboard.widgets', 'dashboard.nextWidgetId', ...transient], object({ widgetId: identity, type: choice(...dashboardWidgetTypes) })),
  define('dashboard.widget.remove', widget, empty, [scene, board, 'Removal editing is active and widgetId is live.'],
    ['Remove the exact widget instance only. Removing the last leaves an honest empty board with working Add.'], ['dashboard.widgets', ...transient], widget),
  define('dashboard.widget.move', widget, object({ x: offset, y: offset }), [scene, board, 'No library/configuration owns input.'],
    ['Clamp physical board coordinates using the actual widget/content geometry, retain placement and focus the original widget. Pointer cancellation makes no placement write.'], ['dashboard.widgets[].x', 'dashboard.widgets[].y', ...transient], object({ widgetId: identity, x: offset, y: offset })),
  define('dashboard.preferences.set', empty, object({ mode }), [scene],
    ['Set native Off/As Space/As Overlay. Dismiss any open Dashboard with real focus/Space return before mode changes; keep collection/data. Only As Space contributes a nondeletable non-HOME entry to Mission Control.'], ['dashboard.mode', ...transient], object({ mode })),
  define('dashboard.preferences.open', empty, empty, [scene],
    ['Open the real existing System Preferences window at its bounded Mission Control pane with a working Dashboard mode selector. Other preferences/host bindings remain unavailable.'], ['windows[].settingsPane', 'activeWindowId', 'activeAppId', ...transient], object({ appId: identity, windowId: identity })),
  define('dashboard.clock.advance', empty, object({ seconds: { type: 'integer', minimum: 0, maximum: 86400 } }), [scene],
    ['Advance the fictional UTC scene reference by the supplied seconds, never read host time. Visible Dashboard supplies one-second ticks; closed/hidden Dashboard pauses its scheduler.'], ['dashboard.sceneTime'], object({ sceneTime: number })),
  ...Object.entries(dashboardWidgetCommandSpecs).map(([command, spec]) => define(command, widget, spec.payload,
    [scene, board, `widgetId is a live ${spec.type} instance; editing/library is inactive.`],
    ['Apply the real widget calculation/date/configuration/local-fixture transition. Unknown IDs/options reject before mutation; valid arithmetic/numeric errors apply with explicit visible widget error and clear recovery. Clock Region filters local City options; weather/rates remain fictional offline fixtures.'],
    ['dashboard.widgets[].data'], widget)),
]);

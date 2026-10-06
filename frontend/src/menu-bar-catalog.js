import { defineCommand, NONE, identity, flag, offset, choice, object, empty } from './command-schema.js';

const profiles = ['macos-golden-gate-27.0.1'];
const menuId = choice('apple', 'application', 'window', 'users');
const nullable = schema => ({ oneOf: [schema, { type: 'null' }] });
const level = { type: 'integer', minimum: 0, maximum: 7 };
const target = object({ menuId });
const selection = object({ menuId: nullable(menuId), itemId: nullable(identity), level: nullable(level) });
const mounted = 'Matching current provider/owner and available native popup; hidden, inert, stale, disabled or wrong-provider targets reject before mutation.';
const define = (name, requestTarget, payload, requires, effects, result) => {
  const entry = defineCommand(profiles, name, 'shell.menu-bar', requestTarget, payload, requires, effects,
    ['Only transient host-owned menuBar selection/path/actual scroll; no authentication, retained document, application or window changes except a selected existing canonical leaf action.'], NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};

/** Golden Gate navigation only; opening/execution retain provider API names. */
export const menuBarCatalog = Object.fromEntries([
  define('menu.navigate', target, object({ key: choice('ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', 'Space', 'Escape', 'Tab') }),
    [mounted, 'Left/Right on a visible enabled closed invoker instead opens the adjacent available provider. All other keys require the matching open menu.'],
    ['Up/Down wrap enabled rendered rows; Home/End choose endpoints. Right/Enter/Space opens a selected child; Enter/Space executes a selected enabled leaf through its real canonical operation.',
      'Left or Escape pops a child and focuses its parent row. Root Left/Right switches providers under one original-focus token. Root Escape and unmodified Tab dismiss to the invoker; Tab is consumed.',
      'Leaf execution dismisses and restores original captured focus before dispatch, so lock/power capture the original editor. Failed native preparation/focus or dispatch restores the previous popup path, scroll and native focus. Empty enabled sets focus the actual panel, never a fake leaf.'], selection),
  define('menu.submenu.open', object({ menuId, itemId: identity }), object({ position: choice('first', 'last') }, []),
    [mounted, 'Exact enabled rendered parent with a real child array; at most eight open levels.'],
    ['Reveal/focus the exact owning parent before mounting its child; select/focus first enabled child row by default or last. A genuinely empty enabled set selects null and focuses its panel.',
      'Opening a different ancestor parent truncates its deeper path. Reopening the same parent without a position preserves its current child path and retains the actual post-reveal scroll. Disabled or unrendered parents and an eighth-level child reject without mutation.'], selection),
  define('menu.submenu.close', target, empty, [mounted, 'At least one open child level.'],
    ['Pop only the deepest child and reveal/focus its parent row. Retain that pane’s actual post-reveal offset rather than hiding newly focused rows with an older scroll position. Root-only requests reject without mutation.'], selection),
  define('menu.scroll', target, object({ top: offset, observe: flag, level }, ['top']),
    [mounted, 'level defaults to the deepest open level; explicit 0..7 must exist and be physically available, never a covered/inert ancestor.'],
    ['Scroll only the owned native popup and retain its actual DOM-clamped offset. observe:true records actual native scrolling rather than trusting top. Ancestor scrolling does not change selection or child path.'],
    object({ menuId, level, top: offset })),
]);

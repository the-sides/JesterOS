import { defineCommand, NONE, identity, flag, offset, choice, object, empty, match } from './command-schema.js';
import { APP_COMMAND_MENU_IDS } from './app-command-menus.js';

const profiles = ['macos-golden-gate-27.0.1'];
const menuId = choice('apple', 'application', 'window', 'users', 'wifi', 'battery', ...APP_COMMAND_MENU_IDS);
const commandMenuId = choice(...APP_COMMAND_MENU_IDS);
const statusMenuId = choice('wifi', 'battery');
const commandOwner = object({ menuId: commandMenuId, appId: identity });
const nullable = schema => ({ oneOf: [schema, { type: 'null' }] });
const level = { type: 'integer', minimum: 0, maximum: 7 };
const target = object({ menuId });
const selection = object({ menuId: nullable(menuId), itemId: nullable(identity), level: nullable(level) });
const mounted = 'Matching current provider/owner and available native presentation: live invoker for opening/idempotent close, owned popup for selection/execution/scroll. Hidden, inert, stale, disabled or wrong-provider targets reject before mutation.';
const define = (name, requestTarget, payload, requires, effects, result) => {
  const entry = defineCommand(profiles, name, 'shell.menu-bar', requestTarget, payload, requires, effects,
    ['Only transient host-owned menuBar selection/path/actual scroll/Help query and location; no authentication, retained document, application or window changes except a selected existing canonical leaf action.'], NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};

/** Golden Gate navigation and explicitly owned represented app command trees. */
const commandSelection = object({ menuId: commandMenuId, appId: identity, itemId: nullable(identity) });
export const menuBarCatalog = Object.fromEntries([
  define('status.menu.open', object({ menuId: statusMenuId }), {
    ...object({ position: choice('first', 'last'), itemId: identity }, []),
    not: match({ position: true, itemId: true }),
  }, [mounted], ['Open the real Wi-Fi/Battery status invoker under the existing single shared menu owner; select first/last/exact enabled native row.'], object({ menuId: statusMenuId })),
  define('status.menu.close', object({ menuId: statusMenuId }), object({ restoreFocus: flag }, []),
    [mounted], ['Dismiss only the owned Wi-Fi/Battery popup; restore its actual status invoker by default.'], object({ menuId: statusMenuId })),
  define('status.menu.select', object({ menuId: statusMenuId, itemId: identity }), object({ observe: flag }, []),
    [mounted, 'Exact current enabled rendered row; observe requires its actual native focus.'],
    ['Reveal/select/focus the actual Wi-Fi/Battery row; preserve retained system and document data.'], object({ menuId: statusMenuId, itemId: identity })),
  define('status.menu.execute', object({ menuId: statusMenuId, itemId: identity }), empty,
    [mounted, 'Exact current enabled rendered row has a canonical fictional Wi-Fi/Battery/Settings action.'],
    ['Wi-Fi power/inline disclosure and Battery Low Power mode retain the same actual popup and original editor-return token. Other real leaves dismiss/restore the original editor before canonical dispatch. Failed preparation/dispatch restores the owned popup.'], object({ menuId: statusMenuId, itemId: identity })),
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
  define('app.commandMenu.open', commandOwner, {
    ...object({ position: choice('first', 'last'), itemId: identity }, []),
    not: match({ position: true, itemId: true }),
  }, [mounted, 'appId must be the actual active app that supplies this represented command heading; position and itemId are mutually exclusive.'],
  ['Open the real app-owned File/Edit/Format/View/Go/Conversation/History/Bookmarks/Help provider at its native heading; select first/last/exact enabled root row, or null for an empty enabled set. Help without explicit position/itemId instead focuses its actual search input while retaining app-help as semantic selection.'],
  commandSelection),
  define('app.commandMenu.close', commandOwner, object({ restoreFocus: flag }, []),
    [mounted, 'The requested app still owns this provider; a different open provider rejects.'],
    ['Dismiss the matching provider and restore its own invoker by default; false preserves outside/native focus. Already closed is idempotent for the current owner.'], commandSelection),
  define('app.commandMenu.select', object({ menuId: commandMenuId, appId: identity, itemId: identity }), object({ observe: flag }, []),
    [mounted, 'Exact enabled mounted row belongs to this current active app; observe:true additionally requires its actual native focus.'],
    ['Select/reveal/focus the row under the single shared host path; ancestor selection truncates children. No app, document or window mutation.'], commandSelection),
  define('app.commandMenu.execute', object({ menuId: commandMenuId, appId: identity, itemId: identity }), empty,
    [mounted, 'Exact enabled leaf has a real existing canonical request, not a queued workflow; app owner must remain current after original focus is restored.'],
    ['Dismiss and restore original focus before invoking the selected current request. Re-read selected record, document/window availability and owner after settling; disabled/stale rows reject without dispatch. Canonical failure restores the popup/native focus. Keep the real action’s focus on applied.'], commandSelection),
  define('menu.help.search', object({ appId: identity }), object({ query: { type: 'string', maxLength: 256 } }),
    [mounted, 'Matching active-app Help popup with its actual search field.'],
    ['Set the bounded literal query; derive current-app nested and disabled menu matches from the live canonical provider trees plus matching original offline articles. Preserve reader/document data and native input focus; clear old location.'],
    object({ appId: identity, query: { type: 'string', maxLength: 256 },
      menuResultIds: { type: 'array', items: identity }, articleIds: { type: 'array', items: identity } })),
  define('menu.help.focus', object({ appId: identity }), object({ observe: flag }, []),
    [mounted, 'Matching active-app Help popup; observe additionally requires actual native search focus.'],
    ['Focus the actual Help search field, or observe its owned native focus; clear location without changing query or documents.'], object({ appId: identity })),
  define('menu.help.locate', object({ appId: identity, resultId: nullable(identity) }), object({ observe: flag }, []),
    [mounted, 'Current query result ID belongs to this active app; disabled underlying commands may still be located.'],
    ['Reveal/select the actual search result and show its live menu/provider/path with a command-location pointer, without executing. Null clears location and returns search focus.'],
    object({ appId: identity, resultId: nullable(identity), menuId: nullable(menuId), itemId: nullable(identity),
      pathIds: { type: 'array', items: identity } })),
]);

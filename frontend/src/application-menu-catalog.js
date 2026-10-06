import { defineCommand, NONE, identity, flag, offset, choice, object, empty } from './command-schema.js';
import { notesPreferencesSchema } from './notes-preferences.js';

const profiles = ['macos-golden-gate-27.0.1'];
const app = object({ appId: identity });
const window = object({ windowId: identity });
const panel = object({ windowId: identity, control: choice('panel', 'sort-by', 'group-by-date', 'text-size') });
const range = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const available = 'Alive interactive Golden scene; no lock/login/power/global modal or competing window-blocking presentation.';
const owner = 'The registered, running, visible, nonquitting active application owns the requested utility; closed ordinary documents remain closed.';
const mounted = 'Exact visible, nonminimized, nonhidden, nonquitting app-owned About/Settings utility and its actual connected, noninert native panel.';
const define = (name, target, payload, requires, presentation, data, result) => {
  const entry = defineCommand(profiles, name, 'shell.application-menu', target, payload,
    requires, presentation, data, NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  if (payload.minProperties && !entry[1].requestSchema.required.includes('payload')) entry[1].requestSchema.required.push('payload');
  return entry;
};

export const applicationMenuCatalog = Object.fromEntries([
  define('app.about.open', app, empty, [available, owner],
    ['Open/focus one app-owned About utility per application without creating an ordinary document. Repeated opening retains the existing utility identity/bounds.',
      'Display real registered app identity/coverage and exact OS profile, explicitly identified as JesterOS simulation; do not invent native bundle version/build.',
      'Restore/minimize/close/hide/quit behavior uses the shared managed window/application lifecycle. Opening or closing a utility never consumes remembered ordinary-window geometry, document state or native view.'],
    ['windows', 'activeWindowId', 'activeAppId', 'runningAppIds', 'switching'], object({ appId: identity, windowId: identity })),
  define('app.settings.open', app, empty, [available, owner, 'Notes has the represented working app Settings panel; other unimplemented app preference interiors reject disabled.'],
    ['Open/focus one app-owned Notes Settings utility, including while its last ordinary window is closed. Never reopen an ordinary Notes window as a substitute.',
      'Native-named sort/date-group/default-text-size controls use the same app.settings.set operation as direct callers. Focus the actual Sort notes by control.'],
    ['windows', 'activeWindowId', 'activeAppId', 'switching'], object({ appId: identity, windowId: identity })),
  define('app.settings.set', object({ appId: { const: 'notes' } }),
    { ...object(notesPreferencesSchema.properties, []), minProperties: 1 }, [available],
    ['Validate the entire nonempty partial preference update before mutation; apply immediately without opening/activating a window or changing record selection, text, timestamps or lifetime.',
      'Pinned notes stay first in all nondeleted sort modes. Date grouping is presented only outside title sorting; choosing title preserves the retained group flag. Text size is bounded simulation pixels, not factory points.'],
    ['notes.preferences', 'seed.notes.preferences', 'saved-session local-user Notes preferences'], object({ appId: { const: 'notes' } })),
  define('app.panel.focus', panel, empty, [available, mounted, 'About supports panel only; Notes Settings supports panel and its currently rendered controls. Hidden Group notes by date cannot be focused.'],
    ['Activate the exact owned utility and focus the actual requested native panel/control; settle DOM and observe physical focus.'],
    ['activeWindowId', 'activeAppId', 'native app-panel focus'], panel),
  define('app.panel.scroll', window, object({ top: offset, left: offset, observe: flag }, ['top']), [available, mounted],
    ['Scroll the single real native panel; preserve omitted left. Return actual DOM-clamped top/left, not requested values.',
      'observe:true records native scrolling without moving the panel or trusting requested offsets. Static About/Settings native view keys participate in saved-session capture.'],
    ['native app-panel scroll offsets'], object({ windowId: identity, top: offset, left: offset })),
  define('app.service.perform', object({ appId: { const: 'notes' }, serviceId: { const: 'create-note' },
    windowId: identity, noteId: identity, control: choice('title', 'body') }), object({ start: range, end: range }),
    [available, owner, 'Exact active ordinary Notes window and currently selected visible source record/control. Read-only Recently Deleted text may be read.',
      'Explicit UTF-16 range: 0 <= start < end <= actual source field length; at most one Mi UTF-16 units. The source is revalidated after native body focus preparation.'],
    ['Registered local simulation service Create Note from Selection is not asserted to be a stock Apple service.',
      'Create one new editable unpinned Notes record containing the exact selected substring, select Notes folder, clear search, retain the source record untouched and focus the retained native body.',
      'All fallible focus and stale-source checks precede record creation. Wrong/stale source, invalid/empty range or failed focus creates no note. No host clipboard, network, cloud account or filesystem effect.'],
    ['notes.notes', 'notes.folder', 'notes.search', 'notes.selectedId', 'notesView'],
    object({ appId: { const: 'notes' }, serviceId: { const: 'create-note' }, windowId: identity, sourceNoteId: identity, noteId: identity })),
]);

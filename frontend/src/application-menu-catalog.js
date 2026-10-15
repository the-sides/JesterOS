import { defineCommand, NONE, identity, flag, offset, object, empty } from './command-schema.js';

const profiles = ['macos-golden-gate-27.0.1'];
const aboutProfiles = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', ...profiles];
const app = object({ appId: identity });
const window = object({ windowId: identity });
const panel = object({ windowId: identity, control: { const: 'panel' } });
const available = 'Alive interactive Mac scene; no lock/login/power/global modal or competing window-blocking presentation. Historical/modern Messages About is supported; other app panels retain their declared profile boundary.';
const owner = 'The registered, running, visible, nonquitting active application owns the requested utility; closed ordinary documents remain closed.';
const mounted = 'Exact visible, nonminimized, nonhidden, nonquitting app-owned About utility and its actual connected, noninert native panel.';
const define = (name, target, payload, requires, presentation, data, result) => {
  const settings = name === 'app.settings.open';
  const entry = defineCommand(settings ? profiles : aboutProfiles, name,
    settings ? 'shell.application-menu' : 'messages.conversations', target, payload,
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
  define('app.settings.open', app, empty, [available, owner, 'Notes owns its canonical managed preferences sheet; other unimplemented app preferences reject disabled.'],
    ['Route through the real Notes preferences bridge to an original available managed Notes session and mounted view.',
      'The canonical notes.sheet.open command opens preferences; notes.preferences.set applies the complete canonical preferences object. No mirrored utility or partial app settings mutation exists.'],
    ['notes.windows.sheet', 'activeWindowId', 'activeAppId'], object({ appId: identity, windowId: identity })),
  define('app.panel.focus', panel, empty, [available, mounted, 'About supports its actual panel only. Notes preferences use canonical Notes focus commands.'],
    ['Activate the exact owned utility and focus the actual requested native panel/control; settle DOM and observe physical focus.'],
    ['activeWindowId', 'activeAppId', 'native app-panel focus'], panel),
  define('app.panel.scroll', window, object({ top: offset, left: offset, observe: flag }, ['top']), [available, mounted],
    ['Scroll the single real native panel; preserve omitted left. Return actual DOM-clamped top/left, not requested values.',
      'observe:true records native scrolling without moving the panel or trusting requested offsets. Static About/Settings native view keys participate in saved-session capture.'],
    ['native app-panel scroll offsets'], object({ windowId: identity, top: offset, left: offset })),
]);

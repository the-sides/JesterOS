import { defineCommand, NONE, identity, choice, object, empty } from './command-schema.js';
import { appearancePresets } from './appearance.js';

const profiles = ['macos-mojave-10.14', 'macos-high-sierra-10.13', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1'];
const colors = choice(...appearancePresets.map(value => value.id));
const rgb = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
const scene = 'A connected native macOS scene with no blocking global modal; appearance setters need no Preferences window.';
const define = (name, payload, effects, data, result) => {
  const entry = defineCommand(profiles, name, 'shell.appearance', empty, payload, [scene], effects, data, NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};
export const appearanceCatalog = Object.fromEntries([
  define('appearance.setMode', object({ mode: choice('light', 'dark') }),
    ['Apply the shared native appearance without remounting windows, editing documents, changing geometry, focus/caret/scroll, or touching host settings. High Sierra Dark affects menu bar and Dock only; Mojave/Sonoma Dark includes all implemented themeable surfaces. Manual Light/Dark only; no automatic schedule.'],
    ['appearance.mode'], object({ mode: choice('light', 'dark'), scope: choice('menu-dock', 'full') })),
  define('appearance.setAccent', object({ color: colors }),
    ['Apply the supported native control accent and focus/selection contrast. High Sierra accepts only Blue/Graphite; Mojave/Sonoma use the bounded eight-color palette. A changed accent resets Highlight to the matching preset; setting the unchanged accent preserves a subsequently independent Highlight. Native/app media and semantic branding are not recolored.'],
    ['appearance.accent', 'appearance.highlight'], object({ color: colors })),
  define('appearance.setHighlight', object({ color: { anyOf: [colors, rgb] } }),
    ['Change real selected-text highlighting independently of the control accent. Accept a bounded named preset or six-digit RGB; normalize custom hex lowercase. Other uses an honest in-page RGB chooser, not a host picker or full factory Colors panel.'],
    ['appearance.highlight'], object({ color: { anyOf: [colors, rgb] } })),
  define('appearance.preferences.open', empty,
    ['Activate the existing real System Preferences/Settings window at General (High Sierra/Mojave) or Appearance (Sonoma). Native controls invoke the same typed setters; no duplicate preference state. Windows keeps its existing win11.settings.preference theme/accent authority and native Colors page, rather than these Mac commands.'],
    ['windows[].settingsPane', 'activeAppId', 'activeWindowId'], object({ appId: identity, windowId: identity })),
]);

import { isRecord, rejected } from './feature-commands.js';

// Authored, native-informed RGB approximations, not measured factory values.
export const appearancePresets = Object.freeze([
  { id: 'blue', name: 'Blue', accent: '#007aff', highlight: '#b3d7ff' },
  { id: 'purple', name: 'Purple', accent: '#8057c5', highlight: '#d8c5ef' },
  { id: 'pink', name: 'Pink', accent: '#d85c9b', highlight: '#f5c5df' },
  { id: 'red', name: 'Red', accent: '#d94943', highlight: '#f5c4c1' },
  { id: 'orange', name: 'Orange', accent: '#db801b', highlight: '#f6d4ae' },
  { id: 'yellow', name: 'Yellow', accent: '#d0aa00', highlight: '#f6e8a7' },
  { id: 'green', name: 'Green', accent: '#348952', highlight: '#bee3ca' },
  { id: 'graphite', name: 'Graphite', accent: '#707070', highlight: '#d0d0d0' },
].map(Object.freeze));
const presets = new Map(appearancePresets.map(value => [value.id, value]));
const presetIds = Object.freeze(appearancePresets.map(value => value.id));
const rgb = /^#[0-9a-f]{6}$/i;
const fields = (value, names) => isRecord(value) && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name));

export function appearanceOptions(profile) {
  const classic = profile.renderer === 'high-sierra';
  return { scope: classic ? 'menu-dock' : 'full', accents: classic ? ['blue', 'graphite'] : [...presetIds],
    highlights: [...presetIds], modes: ['light', 'dark'], paneName: profile.capabilities.includes('shell.window-green-menu') ? 'Appearance' : 'General' };
}
export function appearanceDefaults() { return { mode: 'light', accent: 'blue', highlight: 'blue' }; }
export function appearanceColor(value, kind = 'highlight') {
  return presets.get(value)?.[kind] ?? (typeof value === 'string' && rgb.test(value) ? value.toLowerCase() : null);
}
export function appearanceTargets(profile, state) {
  return { ...state, ...appearanceOptions(profile), accentColor: appearanceColor(state.accent, 'accent'),
    highlightColor: appearanceColor(state.highlight), customHighlight: rgb.test(state.highlight),
    commands: { mode: 'appearance.setMode', accent: 'appearance.setAccent', highlight: 'appearance.setHighlight', preferences: 'appearance.preferences.open' },
    boundaries: { hostAppearance: false, automaticScheduling: false, multicolor: false,
      customAccent: false, colorPicker: 'bounded inline RGB; not the full native Colors panel',
      highSierraHighlightInventory: 'bounded shared palette; exact factory list not established' } };
}

export function createAppearanceCommands(ctx) {
  const { state, profile } = ctx, options = appearanceOptions(profile);
  const invalid = () => rejected('invalid_arguments', 'Expected an era-supported appearance choice or six-digit RGB highlight.');
  const unavailable = () => rejected('view_unavailable', 'The native appearance scene is not available.');
  async function change(mutate, target) {
    if (!ctx.available()) return unavailable();
    const before = { ...state };
    mutate(); await ctx.settle();
    if (!ctx.available()) { Object.assign(state, before); await ctx.settle(); return unavailable(); }
    return { status: 'applied', target };
  }
  return {
    'appearance.setMode': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['mode']) || !options.modes.includes(payload.mode)) return invalid();
      return change(() => { state.mode = payload.mode; }, { mode: payload.mode, scope: options.scope });
    },
    'appearance.setAccent': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['color']) || !options.accents.includes(payload.color)) return invalid();
      return change(() => {
        // A repeated setter is idempotent: only a real accent change resets a
        // subsequently independent highlight, including an explicit custom RGB.
        if (state.accent !== payload.color) { state.accent = payload.color; state.highlight = payload.color; }
      }, { color: payload.color });
    },
    'appearance.setHighlight': (target, payload) => {
      if (!fields(target, []) || !fields(payload, ['color']) || typeof payload.color !== 'string'
        || (!options.highlights.includes(payload.color) && !rgb.test(payload.color))) return invalid();
      const color = rgb.test(payload.color) ? payload.color.toLowerCase() : payload.color;
      return change(() => { state.highlight = color; }, { color });
    },
    'appearance.preferences.open': (target, payload) => {
      if (!fields(target, []) || !fields(payload, [])) return invalid();
      return ctx.available() ? ctx.openPreferences() : unavailable();
    },
  };
}

const contentDark = Object.freeze({
  '--appearance-ink': '#ededf0', '--appearance-muted': '#b0b0b7', '--appearance-disabled': '#85858b',
  '--appearance-inactive-ink': '#98989e', '--appearance-surface': '#202023', '--appearance-panel': '#29292d',
  '--appearance-card': '#303035', '--appearance-input': '#252529',
  '--appearance-toolbar': 'linear-gradient(#3b3b40, #303034)', '--appearance-toolbar-inactive': 'linear-gradient(#343438, #2c2c30)',
  '--appearance-border': '#505056', '--appearance-soft-border': '#414146', '--appearance-light-edge': 'rgb(255 255 255 / 9%)',
  '--appearance-hover': '#3b3b41', '--appearance-context-bg': 'rgb(40 40 44 / 97%)',
  '--appearance-context-ink': '#ededf0', '--appearance-context-border': 'rgb(255 255 255 / 18%)',
  '--appearance-incoming-bubble': '#444448', '--appearance-note-paper': '#242424', '--appearance-note-row': '#665125',
  '--appearance-note-row-ink': '#f4ead4', '--appearance-note-row-muted': '#ddd1b9',
  '--appearance-inactive-selection': '#414146', '--appearance-note-notice-bg': '#3e3420', '--appearance-note-notice-ink': '#e6c473',
});
const shellDark = Object.freeze({
  '--menu-ink': '#f5f5f7', '--menu-glass': 'rgb(35 35 39 / 82%)', '--dock-glass': 'rgb(35 35 39 / 68%)',
  '--appearance-menu-bg': 'rgb(38 38 42 / 97%)', '--appearance-menu-ink': '#ededf0', '--appearance-menu-border': 'rgb(255 255 255 / 18%)',
  '--appearance-menu-disabled': '#a8a8ad', '--appearance-menu-separator': 'rgb(255 255 255 / 15%)', '--appearance-menu-hover': 'rgb(255 255 255 / 20%)',
  '--appearance-dock-bg': 'rgb(35 35 39 / 68%)', '--appearance-dock-ink': '#f5f5f7', '--appearance-dock-muted': '#b4b4ba',
  '--appearance-dock-border': 'rgb(255 255 255 / 21%)', '--appearance-dock-dot': '#e0e0e5',
  '--appearance-dock-hover': 'rgb(255 255 255 / 12%)', '--appearance-dock-separator': 'rgb(255 255 255 / 17%)',
});
const controlProperties = ['--appearance-accent', '--appearance-accent-ink', '--appearance-focus', '--appearance-focus-shadow',
  '--appearance-selection', '--appearance-selection-ink', '--appearance-highlight', '--appearance-highlight-ink', '--appearance-caret',
  '--appearance-traffic-light-bg', '--appearance-traffic-light-ink'];
const ownedProperties = [...new Set([...Object.keys(contentDark), ...Object.keys(shellDark), ...controlProperties, 'color-scheme'])];
function contrastInk(color) {
  const channels = [1, 3, 5].map(at => Number.parseInt(color.slice(at, at + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? '#000' : '#fff';
}
export function appearancePalette(profile, state) {
  const palette = state.mode === 'dark'
    ? { ...shellDark, ...(appearanceOptions(profile).scope === 'full' ? contentDark : {}) } : {};
  // Keep each historical role's exact Blue default instead of normalizing all
  // native/app-default blues and golds to one new color.
  if (state.accent !== 'blue') {
    const color = appearanceColor(state.accent, 'accent'), ink = contrastInk(color);
    Object.assign(palette, { '--appearance-accent': color, '--appearance-accent-ink': ink, '--appearance-focus': color,
      '--appearance-focus-shadow': `${color}66`, '--appearance-selection': color, '--appearance-selection-ink': ink,
      '--appearance-caret': color, '--appearance-menu-hover': `${color}47` });
  }
  if (state.accent === 'graphite') {
    palette['--appearance-traffic-light-bg'] = state.mode === 'dark' ? '#98989b' : '#9c9ca0';
    palette['--appearance-traffic-light-ink'] = '#222';
  }
  const highlight = appearanceColor(state.highlight);
  palette['--appearance-highlight'] = highlight; palette['--appearance-highlight-ink'] = contrastInk(highlight);
  return palette;
}
const appearanceOwners = new WeakMap();
export function applyAppearance(root, profile, state) {
  const owner = {};
  appearanceOwners.set(root, owner);
  const mac = profile.family === 'macos', scope = mac ? appearanceOptions(profile).scope : 'full';
  const palette = mac ? appearancePalette(profile, state) : {};
  for (const name of ownedProperties) {
    if (Object.hasOwn(palette, name)) root.style.setProperty(name, palette[name]);
    else root.style.removeProperty(name);
  }
  const content = state.mode === 'dark' && scope === 'full' ? 'dark' : 'light';
  root.dataset.appearanceContent = content; root.dataset.appearanceShell = state.mode;
  root.dataset.appearanceAccent = state.accent; root.style.colorScheme = content;
  return () => {
    if (appearanceOwners.get(root) !== owner) return;
    appearanceOwners.delete(root);
    for (const name of ownedProperties) root.style.removeProperty(name);
    delete root.dataset.appearanceContent; delete root.dataset.appearanceShell; delete root.dataset.appearanceAccent;
  };
}

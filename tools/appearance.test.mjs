import { expect, test } from 'bun:test';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { appearanceDefaults, appearanceColor, appearancePalette, createAppearanceCommands } from '../frontend/src/appearance.js';

function scene(id = 'macos-mojave-10.14') {
  const profile = getOSProfile(id), state = appearanceDefaults(profile);
  let available = true, afterSettle = null;
  const commands = createAppearanceCommands({ profile, state, available: () => available,
    settle: async () => { afterSettle?.(); }, openPreferences: async () => ({ status: 'applied', target: { appId: 'settings', windowId: 'settings-window' } }) });
  return { profile, state, commands, run: (name, payload = {}, target = {}) => commands[`appearance.${name}`](target, payload),
    setAvailable: value => { available = value; }, afterSettle: callback => { afterSettle = callback; } };
}

test('accent changes reset highlight, but unchanged accent preserves an independent custom highlight', async () => {
  const s = scene();
  await s.run('setHighlight', { color: '#A1b2C3' });
  expect(s.state.highlight).toBe('#a1b2c3');
  await s.run('setAccent', { color: 'blue' });
  expect(s.state.highlight).toBe('#a1b2c3');
  await s.run('setAccent', { color: 'pink' });
  expect(s.state.accent).toBe('pink'); expect(s.state.highlight).toBe('pink');
  await s.run('setHighlight', { color: 'green' });
  expect(s.state.accent).toBe('pink'); expect(s.state.highlight).toBe('green');
  await s.run('setAccent', { color: 'graphite' });
  expect(s.state.highlight).toBe('graphite');
});

test('custom highlight accepts RGB endpoints and rejects CSS injection and partial colors atomically', async () => {
  const s = scene();
  for (const color of ['#000000', '#ffffff']) {
    expect((await s.run('setHighlight', { color })).status).toBe('applied');
    expect(appearanceColor(s.state.highlight)).toBe(color);
  }
  for (const color of ['#fff', '#11223344', '#12gg00', 'red; background:url(https://example.com)', 'rgb(1,2,3)', 'other', '', null]) {
    const before = structuredClone(s.state);
    expect((await s.run('setHighlight', { color })).error.code).toBe('invalid_arguments');
    expect(s.state).toEqual(before);
  }
});

test('High Sierra graphite changes controls while native dark mode never darkens document content', async () => {
  const s = scene('macos-high-sierra-10.13');
  expect((await s.run('setAccent', { color: 'graphite' })).status).toBe('applied');
  expect((await s.run('setMode', { mode: 'dark' })).target.scope).toBe('menu-dock');
  const palette = appearancePalette(s.profile, s.state);
  expect(palette['--appearance-menu-bg']).toBeDefined();
  expect(palette['--appearance-dock-bg']).toBeDefined();
  expect(palette['--appearance-surface']).toBeUndefined();
  expect(palette['--appearance-ink']).toBeUndefined();
  expect(palette['--appearance-accent']).toBe(appearanceColor('graphite', 'accent'));
  const before = structuredClone(s.state);
  expect((await s.run('setAccent', { color: 'orange' })).error.code).toBe('invalid_arguments');
  expect(s.state).toEqual(before);
});

test('Mojave and Sonoma dark surfaces return to their original light fallbacks without retaining a dark palette', async () => {
  for (const id of ['macos-mojave-10.14', 'macos-sonoma-14.0']) {
    const s = scene(id);
    await s.run('setMode', { mode: 'dark' });
    expect(appearancePalette(s.profile, s.state)['--appearance-surface']).toBeDefined();
    await s.run('setMode', { mode: 'light' });
    const palette = appearancePalette(s.profile, s.state);
    expect(palette['--appearance-surface']).toBeUndefined();
    expect(palette['--appearance-menu-bg']).toBeUndefined();
    expect(palette['--appearance-accent']).toBeUndefined();
  }
});

test('manual mode choices do not accept unsupported automatic scheduling or incomplete payloads', async () => {
  const s = scene();
  for (const [name, payload, target] of [['setMode', { mode: 'auto' }, {}], ['setMode', {}, {}],
    ['setAccent', { color: '#abcdef' }, {}], ['setHighlight', { color: 'blue', extra: true }, {}],
    ['setMode', { mode: 'dark' }, { windowId: 'notes' }]]) {
    const before = structuredClone(s.state);
    expect((await s.run(name, payload, target)).error.code).toBe('invalid_arguments');
    expect(s.state).toEqual(before);
  }
});

test('unavailable scenes and loss of availability during settlement never partially change preferences', async () => {
  const s = scene();
  s.setAvailable(false); const before = structuredClone(s.state);
  expect((await s.run('setAccent', { color: 'red' })).status).toBe('rejected'); expect(s.state).toEqual(before);
  s.setAvailable(true); s.afterSettle(() => s.setAvailable(false));
  expect((await s.run('setAccent', { color: 'purple' })).status).toBe('rejected'); expect(s.state).toEqual(before);
});

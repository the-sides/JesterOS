import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { getOSProfile } from '../frontend/src/os-profiles.js';
import { dashboardDefaults, createDashboardCommands } from '../frontend/src/dashboard.js';
import { createDashboardWidget, dashboardWidgetTargets, applyDashboardWidgetCommand } from '../frontend/src/dashboard-widgets.js';
import { spacesDefaults, spacesItems, missionControlItems, reconcileSpaces } from '../frontend/src/spaces.js';
import { fullScreenDefaults } from '../frontend/src/full-screen-windowing.js';
const frontendRequire = createRequire(new URL('../frontend/package.json', import.meta.url));
const { proxy } = await import(frontendRequire.resolve('svelte/internal/client'));
const profile = getOSProfile('macos-mojave-10.14');
const time = Date.UTC(2018, 8, 24, 17, 42);
const make = type => createDashboardWidget(type, 'dashboard-widget-1', time);
const run = (widget, command, payload = {}, at = time) => applyDashboardWidgetCommand(widget, `dashboard.${command}`, payload, at);
const keys = (widget, ...values) => values.forEach(key => expect(run(widget, 'calculator.key', { key }).status).toBe('applied'));

test('calculator chaining, operator replacement and repeat equals preserve a real memory value', () => {
  const w = make('calculator');
  keys(w, '7', 'add', 'multiply', '3', 'equals', 'equals', 'm+', 'C', '2', 'm-', 'C', 'mr');
  expect(w.data.display).toBe('61'); expect(w.data.memory).toBe(61);
  keys(w, 'mc'); expect(run(w, 'calculator.key', { key: 'mr' }).error.code).toBe('disabled');
});
test('calculator zero division displays an error, disabled operators do not mutate it and digits recover', () => {
  const w = make('calculator'); keys(w, '8', 'divide', '0', 'equals');
  expect(w.data.display).toBe('Error'); expect(w.data.error).toBe('Cannot divide by zero.');
  const before = structuredClone(w);
  expect(run(w, 'calculator.key', { key: 'add' }).error.code).toBe('disabled'); expect(w).toEqual(before);
  keys(w, '4', 'multiply', '5', 'equals'); expect(w.data.display).toBe('20'); expect(w.data.error).toBeNull();
});
test('calculator decimal and CE preserve a pending operation without manufacturing NaN', () => {
  const w = make('calculator'); keys(w, '.', '5', 'add', '9', 'CE', '.', '2', '5', 'equals');
  expect(w.data.display).toBe('0.75');
});
test('calendar clamps Jan31 across leap months and rejects impossible century leap dates atomically', () => {
  const w = make('calendar'); expect(run(w, 'calendar.select', { date: '2020-01-31' }).status).toBe('applied');
  run(w, 'calendar.navigate', { months: 1 }); expect(w.data.selectedDate).toBe('2020-02-29');
  run(w, 'calendar.select', { date: '1900-01-31' }); run(w, 'calendar.navigate', { months: 1 });
  expect(w.data.selectedDate).toBe('1900-02-28'); const before = structuredClone(w);
  expect(run(w, 'calendar.select', { date: '1900-02-29' }).status).toBe('rejected'); expect(w).toEqual(before);
});
test('calendar year1 is not remapped to1901, endpoints reject and Today follows the explicit scene', () => {
  const w = make('calendar'); run(w, 'calendar.select', { date: '0001-01-01' });
  expect(dashboardWidgetTargets(w, time).selectedWeekday).toBe('Mon');
  const before = structuredClone(w); expect(run(w, 'calendar.navigate', { months: -1 }).status).toBe('rejected'); expect(w).toEqual(before);
  run(w, 'calendar.today', {}, Date.UTC(2024, 1, 29, 23)); expect(w.data.selectedDate).toBe('2024-02-29');
});
test('clock cities observe explicit timezone/DST transitions and do not change the underlying reference', () => {
  const w = make('clock'); run(w, 'clock.configure', { cityId: 'new-york' });
  expect(dashboardWidgetTargets(w, Date.UTC(2024, 2, 10, 6, 59, 59)).digital).toBe('01:59:59');
  expect(dashboardWidgetTargets(w, Date.UTC(2024, 2, 10, 7)).digital).toBe('03:00:00');
  run(w, 'clock.configure', { cityId: 'tokyo' });
  expect(dashboardWidgetTargets(w, time).date).toBe('2018-09-25');
});
test('weather Fahrenheit changes real high/low/current values and explicit refresh retains fixture provenance', () => {
  const w = make('weather'); const c = dashboardWidgetTargets(w, time);
  run(w, 'weather.configure', { cityId: 'san-francisco', unit: 'fahrenheit' }); const f = dashboardWidgetTargets(w, time);
  expect(f.temperature).toBe(64.4); expect(f.high).toBe(c.high * 9 / 5 + 32);
  expect(f.forecast.map(day => day.date)).toEqual(c.forecast.map(day => day.date));
  run(w, 'weather.refresh', {}, time + 1000); expect(w.data.updatedAt).toBe(time + 1000); expect(w.data.refreshCount).toBe(1);
  expect(dashboardWidgetTargets(w, time).source).toBe('Fictional offline forecast');
});
test('converter performs affine Fahrenheit and absolute-zero errors recover without discarding the input', () => {
  const w = make('converter'); run(w, 'converter.change', { category: 'temp', fromUnit: 'fahrenheit', toUnit: 'celsius', value: '32' });
  expect(Number(w.data.result)).toBeCloseTo(0, 10);
  run(w, 'converter.change', { category: 'temp', fromUnit: 'kelvin', toUnit: 'celsius', value: '-1' });
  expect(w.data.value).toBe('-1'); expect(w.data.result).toBeNull(); expect(w.data.error).toBe('Temperature cannot be below absolute zero.');
  run(w, 'converter.change', { category: 'temp', fromUnit: 'kelvin', toUnit: 'celsius', value: '0' }); expect(w.data.result).toBe('-273.15');
});
test('converter fixed currency, mass and length outputs reject foreign units without mutation', () => {
  const w = make('converter');
  run(w, 'converter.change', { category: 'currency', fromUnit: 'usd', toUnit: 'jpy', value: '2.5' }); expect(w.data.result).toBe('280');
  run(w, 'converter.change', { category: 'mass', fromUnit: 'pounds', toUnit: 'kilograms', value: '1' }); expect(w.data.result).toBe('0.45359237');
  run(w, 'converter.change', { category: 'length', fromUnit: 'miles', toUnit: 'meters', value: '1' }); expect(w.data.result).toBe('1609.344');
  const before = structuredClone(w);
  expect(run(w, 'converter.change', { category: 'length', fromUnit: 'usd', toUnit: 'meters', value: '1' }).status).toBe('rejected'); expect(w).toEqual(before);
});
test('converter numeric text errors apply visibly, do not execute expressions and detached options cannot corrupt units', () => {
  const w = make('converter');
  run(w, 'converter.change', { category: 'length', fromUnit: 'meters', toUnit: 'feet', value: '2+2' });
  expect(w.data.value).toBe('2+2'); expect(w.data.error).toBe('Enter a valid decimal number.');
  const target = dashboardWidgetTargets(w, time); target.categories[0].units[0].id = 'corrupt';
  expect(dashboardWidgetTargets(w, time).categories[0].units[0].id).toBe('millimeters');
});
test('wrong widget ownership and extra payload fields reject before data mutation', () => {
  const w = make('clock'), before = structuredClone(w);
  expect(run(w, 'calendar.today').error.code).toBe('invalid_arguments');
  expect(run(w, 'clock.configure', { cityId: 'tokyo', injected: true }).error.code).toBe('invalid_arguments'); expect(w).toEqual(before);
});

function consumer() {
  const state = proxy(dashboardDefaults(profile)); let physical = 'original-notes', failFocus = false, obscured = false;
  const original = { id: 'notes-original', appId: 'notes', bounds: { x: 30, y: 40, width: 700, height: 500 }, spaceId: 'desktop-1', minimized: false };
  const scene = { activeSpaceId: 'desktop-1', activeWindowId: original.id, appId: 'notes' };
  const ids = () => state.view ? ['close', 'add', 'remove', ...state.widgets.map(w => `widget:${w.id}`),
    ...state.widgets.filter(w => w.type === 'calculator').flatMap(w => [`control:${w.id}:key:C`, ...(!w.data.error ? [`control:${w.id}:key:equals`] : [])]),
    ...(state.view.library ? ['library:clock'] : [])] : [];
  const facade = {
    available: () => Boolean(state.view) && !obscured, bounds: () => ({ x: 0, y: 0, width: 560, height: 420 }),
    itemIds: ids, focusedItemId: () => physical, prepare: async () => {},
    focus: async id => { if (failFocus || !ids().includes(id)) return false; physical = id; return true; },
    scrollPosition: () => ({ top: 0, left: 0 }), scroll: async () => ({ top: 0, left: 0 }),
    widgetPosition: (_, x, y) => ({ x: Math.min(x, 300), y: Math.min(y, 300) }),
  };
  const commands = createDashboardCommands({ profile, state, getView: () => facade, available: () => true, settle: async () => {
    if (physical.startsWith('control:') && !ids().includes(physical)) physical = 'body';
  },
    captureScene: () => ({ scene: { ...scene }, obscured }), restoreScene: async prior => { Object.assign(scene, prior.scene); obscured = prior.obscured; },
    captureFocus: () => physical, restoreFocus: async value => { physical = value; return true; }, captureReturn: () => ({ ...scene }),
    dismissPresentations: async () => {
      if (obscured) { obscured = false; state.view = null; scene.activeSpaceId = 'desktop-1'; scene.activeWindowId = original.id; }
    }, enterSpace: async () => { scene.activeSpaceId = 'dashboard'; scene.activeWindowId = null; return true; },
    leaveSpace: async prior => { if (scene.activeSpaceId === 'dashboard') Object.assign(scene, prior); return true; },
    focusReturn: async () => false, modeChanged: () => {}, openPreferences: async () => ({ status: 'applied', target: { appId: 'settings', windowId: 'settings-original' } }),
  });
  return { state, original, scene, invoke: (name, target = {}, payload = {}) => commands[name](target, payload), fail: () => { failFocus = true; }, physical: () => physical,
    obscure: () => { obscured = true; physical = 'mission-control'; } };
}
test('mode cutover retains original data/geometry and widget arithmetic through close and independent add/remove', async () => {
  const c = consumer(), original = structuredClone(c.original);
  expect((await c.invoke('shell.dashboard.open')).error.code).toBe('disabled');
  await c.invoke('dashboard.preferences.set', {}, { mode: 'space' }); await c.invoke('shell.dashboard.open');
  expect(c.scene.activeWindowId).toBeNull(); expect(c.scene.activeSpaceId).toBe('dashboard');
  await c.invoke('dashboard.calculator.key', { widgetId: 'dashboard-widget-2' }, { key: '7' });
  await c.invoke('shell.dashboard.close'); expect(c.physical()).toBe('original-notes'); expect(c.scene.activeWindowId).toBe('notes-original');
  await c.invoke('dashboard.preferences.set', {}, { mode: 'overlay' }); await c.invoke('shell.dashboard.open');
  expect(c.state.widgets[1].data.display).toBe('7');
  await c.invoke('shell.dashboard.setLibrary', {}, { open: true }); const added = await c.invoke('dashboard.widget.add', { type: 'clock' });
  expect(added.target.widgetId).toBe('dashboard-widget-6');
  await c.invoke('shell.dashboard.setEditing', {}, { editing: true }); await c.invoke('dashboard.widget.remove', { widgetId: added.target.widgetId });
  expect(c.state.widgets.some(w => w.id === added.target.widgetId)).toBe(false); expect(c.original).toEqual(original);
});
test('failed physical preparation rolls back scene ownership, monotonic allocation and assigned reactive view identity', async () => {
  const c = consumer(); await c.invoke('dashboard.preferences.set', {}, { mode: 'overlay' }); await c.invoke('shell.dashboard.open');
  await c.invoke('shell.dashboard.setLibrary', {}, { open: true }); const view = c.state.view, before = JSON.stringify(c.state), focus = c.physical();
  c.fail(); expect((await c.invoke('dashboard.widget.add', { type: 'clock' })).error.code).toBe('unavailable');
  expect(JSON.stringify(c.state)).toBe(before); expect(c.state.view).toBe(view); expect(c.physical()).toBe(focus);
});
test('resuming an obscured Dashboard Space preserves its widgets and original editor return owner', async () => {
  const c = consumer();
  await c.invoke('dashboard.preferences.set', {}, { mode: 'space' }); await c.invoke('shell.dashboard.open');
  await c.invoke('dashboard.calculator.key', { widgetId: 'dashboard-widget-2' }, { key: '7' });
  c.obscure();
  expect((await c.invoke('shell.dashboard.open')).status).toBe('applied');
  expect(c.scene.activeSpaceId).toBe('dashboard'); expect(c.scene.activeWindowId).toBeNull();
  expect(c.state.widgets[1].data.display).toBe('7');
  await c.invoke('shell.dashboard.close');
  expect(c.physical()).toBe('original-notes'); expect(c.scene.activeSpaceId).toBe('desktop-1');
  expect(c.scene.activeWindowId).toBe('notes-original');
});
test('arithmetic error keeps native keyboard ownership when its focused Equals button becomes disabled', async () => {
  const c = consumer();
  await c.invoke('dashboard.preferences.set', {}, { mode: 'overlay' }); await c.invoke('shell.dashboard.open');
  for (const key of ['8', 'divide', '0']) await c.invoke('dashboard.calculator.key', { widgetId: 'dashboard-widget-2' }, { key });
  await c.invoke('shell.dashboard.select', { itemId: 'control:dashboard-widget-2:key:equals' });
  expect((await c.invoke('dashboard.calculator.key', { widgetId: 'dashboard-widget-2' }, { key: 'equals' })).status).toBe('applied');
  expect(c.state.widgets[1].data.error).toBe('Cannot divide by zero.');
  expect(c.physical()).toBe('widget:dashboard-widget-2');
  await c.invoke('shell.dashboard.close'); expect(c.physical()).toBe('original-notes');
});
test('Dashboard Space is not an ordinary HOME, counted desktop, removable group or inherited modern capability', () => {
  const state = spacesDefaults(), presentation = fullScreenDefaults(), dashboard = dashboardDefaults(profile); dashboard.mode = 'space';
  reconcileSpaces(state, presentation, [], profile, [], [], [], dashboard);
  const items = spacesItems(state, presentation, [], profile, [], [], dashboard);
  expect(items.map(item => item.spaceId)).toEqual(['dashboard', 'desktop-1']);
  state.overview = { expanded: true }; const controls = missionControlItems(state, items, []);
  expect(controls).toContain('space:dashboard'); expect(controls).not.toContain('exit:dashboard'); expect(controls).not.toContain('remove:dashboard');
  expect(spacesItems(state, presentation, [], getOSProfile('macos-sonoma-14.0'), [], [], dashboard).some(item => item.type === 'dashboard')).toBe(false);
});

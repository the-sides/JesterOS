import test from 'node:test';
import assert from 'node:assert/strict';
import { listOSProfiles } from '../frontend/src/os-profiles.js';
import { applyCanonicalData, canonicalStringUnits, copyCanonicalData } from '../frontend/src/canonical-data.js';
import { widgetsDefaults, validateWidgetsState } from '../frontend/src/notification-widget-model.js';
import { createPreferencesState, validatePreferencesState } from '../frontend/src/preferences-state.js';
import { WEATHER_APP_PROFILES, weatherAppSchema, weatherAppDefaults, validateWeatherAppState, weatherAppMeta, seedWeatherSources, weatherAppWindow, weatherCityCatalogue, weatherCatalogueRow, weatherDisplayedRow, weatherSearch, weatherSource, weatherTemperatureUnit, weatherTemperature, weatherLocationPermission, weatherMapPoints, weatherMetrics, weatherForecastChart } from '../frontend/src/weather-app-state.js';
import { createWeatherAppCommands, weatherAppCatalog, weatherAppMenus } from '../frontend/src/weather-app-commands.js';

// Deliberately authored, not executed by the Weather worker. Root integration must
// also exercise its real mutateShared reservation bridge and retained DOM facade.
const rejected = message => ({ status: 'rejected', error: { code: 'test_bridge_rejected', message } });
function fixture(profile = listOSProfiles()[0]) {
  const state = weatherAppDefaults(profile), widgets = seedWeatherSources(widgetsDefaults(profile)), preferences = createPreferencesState(profile);
  const originalWindow = { id: 'weather-window', appId: 'weather' }, originalView = { available: () => true, focus: async () => true, scroll: async (_id, payload) => ({ top: payload.top, left: payload.left }) };
  const windows = new Map([[originalWindow.id, originalWindow]]), views = new Map([[originalWindow.id, originalView]]);
  let time = Date.parse(profile.defaults.sceneTime), quota = Infinity, pendingSharedDelta = 0, reenter = null, callbackVeto = false, tickHook = null, lastReservation = null, createdOptions = null;
  const total = () => canonicalStringUnits(state) + canonicalStringUnits(widgets) + canonicalStringUnits(preferences);
  function canCommit(delta) {
    assert.equal(typeof delta, 'number');
    if (reenter) { const operation = reenter; reenter = null; operation(); }
    return total() + pendingSharedDelta + delta <= quota;
  }
  const shared = { widgets, preferences };
  const ctx = {
    profile, getState: () => state, getWindow: id => windows.get(id) ?? null, getWindows: () => [...windows.values()], getView: id => views.get(id) ?? null,
    alive: () => true, available: window => windows.get(window.id) === window, getSceneTime: () => time, canCommit,
    tick: async () => { if (tickHook) { const operation = tickHook; tickHook = null; operation(); } }, getShared: name => shared[name],
    mutateShared(name, mutate, options) {
      const original = shared[name], next = copyCanonicalData(original), before = JSON.stringify(original);
      if (!original || options.guard() !== true) return rejected('Original shared participant is stale.');
      mutate(next);
      if (!(name === 'widgets' ? validateWidgetsState(next, profile).ok : validatePreferencesState(next, profile).ok)) return rejected('Invalid detached shared candidate.');
      const delta = canonicalStringUnits(next) - canonicalStringUnits(original);
      lastReservation = { name, delta, actorDelta: options.reserveTextUnits };
      if (!canCommit(delta + options.reserveTextUnits) || options.guard() !== true || JSON.stringify(original) !== before || shared[name] !== original) return rejected('Budget or source guard rejected shared mutation.');
      pendingSharedDelta += delta;
      try {
        if (callbackVeto || options.onCommit() !== true) return rejected('Actor participant vetoed shared publication.');
        // No stale actor-lease recheck after the acknowledged intentional publication.
        applyCanonicalData(original, next);
        return { status: 'applied' };
      } finally { pendingSharedDelta -= delta; }
    },
  };
  const controller = createWeatherAppCommands(state, ctx);
  assert.equal(controller.windowOpened(originalWindow).status, 'applied');
  ctx.createWindow = async (appId, options) => {
    assert.equal(appId, 'weather'); assert.equal(options.ownership.windowId, originalWindow.id);
    createdOptions = options;
    const window = { id: 'weather-second', appId };
    windows.set(window.id, window); views.set(window.id, { ...originalView });
    const result = controller.windowOpened(window, options);
    if (result.status !== 'applied') { windows.delete(window.id); views.delete(window.id); return null; }
    return window;
  };
  ctx.closeWindow = async (id, ownership) => {
    const actual = windows.get(id);
    if (!actual || ownership.guard() !== true) return rejected('Cannot close stale window.');
    const result = controller.windowClosed(actual, ownership);
    if (result.status === 'applied') { windows.delete(id); views.delete(id); }
    return { ...result, target: { windowId: id } };
  };
  ctx.appQuit = async (appId, ownership) => {
    const result = controller.appQuit(appId, ownership);
    if (result.status === 'applied') { windows.clear(); views.clear(); }
    return { ...result, target: { windowId: ownership.windowId } };
  };
  return { state, widgets, preferences, controller, ctx, profile, window: originalWindow, view: originalView, windows, views, shared, total,
    run: (name, payload = {}, id = originalWindow.id) => controller.handlers[`weather.${name}`]({ windowId: id }, payload),
    setQuota: value => { quota = value; }, reenter: operation => { reenter = operation; }, veto: () => { callbackVeto = true; }, afterTick: operation => { tickHook = operation; },
    setTime: value => { time = value; }, time: () => time, reservation: () => lastReservation, options: () => createdOptions,
  };
}
for (const profile of listOSProfiles()) {
  test(`${profile.id}: state is windows-only and every authored city fits the original widgets vocabulary`, () => {
    const f = fixture(profile);
    assert.deepEqual(Object.keys(weatherAppSchema.properties), ['version', 'profileId', 'windows']);
    assert.equal(validateWeatherAppState(f.state, profile).ok, true);
    assert.deepEqual(Object.keys(f.state), ['version', 'profileId', 'windows']);
    for (const city of weatherCityCatalogue) {
      const graph = copyCanonicalData(f.widgets);
      if (!weatherSource(graph, city.id)) graph.sources.weather.push(weatherCatalogueRow(city.id));
      assert.equal(validateWidgetsState(graph).ok, true, city.id);
    }
    for (const definition of Object.values(weatherAppCatalog(profile))) assert.deepEqual(definition.profiles, WEATHER_APP_PROFILES);
    const meta = weatherAppMeta(profile);
    assert.equal(meta.appId, 'weather'); assert.ok(meta.window.width > 700); assert.ok(meta.disclosure);
    assert.equal(meta.localEquivalent, !/sonoma|golden-gate/u.test(profile.id));
  });
  test(`${profile.id}: authored search/preview never mutate forecasts; Add/select/reorder preserve original records`, async () => {
    const f = fixture(profile), originalRow = f.widgets.sources.weather[0], originalHours = originalRow.hourly, originalDaily = originalRow.daily, originalRows = f.widgets.sources.weather;
    const before = JSON.stringify(f.widgets);
    assert.equal((await f.run('search', { query: 'Harbor' })).status, 'applied');
    assert.deepEqual(weatherSearch(f.widgets, weatherAppWindow(f.state, f.window.id).query).map(row => row.id), ['harbor-point']);
    assert.equal((await f.run('preview', { locationId: 'harbor-point' })).status, 'applied');
    assert.equal(weatherDisplayedRow(f.widgets, weatherAppWindow(f.state, f.window.id)).name, 'Harbor Point');
    assert.equal(JSON.stringify(f.widgets), before);
    assert.equal((await f.run('favorite.add', { locationId: 'harbor-point' })).status, 'applied');
    assert.equal(f.widgets.selected.weatherLocationId, 'harbor-point');
    assert.equal(weatherAppWindow(f.state, f.window.id).previewId, null);
    assert.equal((await f.run('favorite.add', { locationId: 'harbor-point' })).status, 'rejected');
    const order = [...f.widgets.sources.weather.map(row => row.id)].reverse();
    assert.equal((await f.run('favorite.reorder', { locationIds: order })).status, 'applied');
    assert.deepEqual(f.widgets.sources.weather.map(row => row.id), order);
    assert.equal(f.widgets.sources.weather, originalRows);
    assert.equal(weatherSource(f.widgets, originalRow.id), originalRow); assert.equal(originalRow.hourly, originalHours); assert.equal(originalRow.daily, originalDaily);
    assert.equal((await f.run('select', { locationId: originalRow.id })).status, 'applied');
    assert.equal(weatherDisplayedRow(f.widgets, weatherAppWindow(f.state, f.window.id)), originalRow);
    assert.equal(validateWidgetsState(f.widgets).ok, true);
  });
  test(`${profile.id}: removing shared favorites retargets every widget and clears references on the last removal`, async () => {
    const f = fixture(profile);
    if (profile.id === 'macos-golden-gate-27.0.1') f.widgets.instances.push({ id: `widget-${f.widgets.nextId++}`, kind: 'weather', size: 'small', configuration: { locationId: 'pine-valley', unit: 'celsius' } });
    const originalConfiguration = f.widgets.instances.find(row => row.kind === 'weather')?.configuration;
    assert.equal((await f.run('favorite.remove', { locationId: 'pine-valley' })).status, 'applied');
    assert.equal(f.widgets.selected.weatherLocationId, 'cedar-creek');
    if (originalConfiguration) assert.equal(originalConfiguration.locationId, 'cedar-creek');
    assert.equal((await f.run('favorite.remove', { locationId: 'cedar-creek' })).status, 'applied');
    assert.equal(f.widgets.selected.weatherLocationId, null);
    if (originalConfiguration) assert.equal(originalConfiguration.locationId, null);
    assert.equal(validateWidgetsState(f.widgets, profile).ok, true);
    assert.equal((await f.run('detail', { detail: 'temperature' })).status, 'rejected');
  });
  test(`${profile.id}: widget units are authoritative; without widgets the original locale temperature preference is authoritative`, async () => {
    const f = fixture(profile);
    f.widgets.instances.splice(0); f.widgets.nextId = 1;
    const preference = f.preferences.configuration.locale;
    assert.equal((await f.run('unit', { unit: 'celsius' })).status, 'applied'); assert.equal(preference.temperature, 'celsius'); assert.equal(f.reservation().name, 'preferences');
    assert.equal(weatherTemperatureUnit(f.widgets, f.preferences), 'celsius');
    if (profile.id !== 'macos-golden-gate-27.0.1') {
      assert.equal((await f.run('unit', { unit: 'fahrenheit' })).status, 'applied');
      assert.equal(preference.temperature, 'fahrenheit'); assert.equal(f.reservation().name, 'preferences');
      return;
    }
    f.widgets.instances.push({ id: 'widget-1', kind: 'weather', size: 'small', configuration: { locationId: 'pine-valley', unit: 'celsius' } }, { id: 'widget-2', kind: 'weather', size: 'medium', configuration: { locationId: 'cedar-creek', unit: 'fahrenheit' } }); f.widgets.nextId = 3;
    const configs = f.widgets.instances.map(row => row.configuration);
    assert.equal((await f.run('unit', { unit: 'fahrenheit' })).status, 'applied');
    assert.equal(f.reservation().name, 'widgets'); assert.equal(preference.temperature, 'celsius');
    assert.deepEqual(f.widgets.instances.map(row => row.configuration.unit), ['fahrenheit', 'fahrenheit']);
    assert.equal(f.widgets.instances[0].configuration, configs[0]); assert.equal(f.widgets.instances[1].configuration, configs[1]);
    assert.equal(weatherTemperatureUnit(f.widgets, f.preferences), 'fahrenheit'); assert.equal(weatherTemperature(0, 'fahrenheit'), 32);
  });
}
test('initializer preserves all existing authored forecasts/selection; empty profiles seed the same compatible shared source', () => {
  const f = fixture(), original = f.widgets.sources.weather[0], hourly = original.hourly;
  f.widgets.selected.weatherLocationId = null;
  assert.equal(seedWeatherSources(f.widgets), f.widgets); assert.equal(f.widgets.sources.weather[0], original); assert.equal(original.hourly, hourly); assert.equal(f.widgets.selected.weatherLocationId, null);
  for (const profile of listOSProfiles()) {
    const graph = widgetsDefaults(profile); graph.sources.weather.splice(0); graph.selected.weatherLocationId = null;
    for (const widget of graph.instances) if (widget.kind === 'weather') widget.configuration.locationId = null;
    seedWeatherSources(graph);
    assert.deepEqual(graph.sources.weather.map(row => row.id), ['pine-valley', 'cedar-creek']); assert.equal(validateWidgetsState(graph).ok, true);
  }
});
test('My Location requires the actual allowed Weather location permission and never requests host geolocation', async () => {
  const f = fixture();
  assert.equal(weatherLocationPermission(f.preferences), false);
  assert.equal((await f.run('currentLocation')).error.code, 'permission_denied');
  f.preferences.configuration.security.permissions.push({ id: 'weather-location', appId: 'weather', category: 'location', allowed: false });
  assert.equal((await f.run('currentLocation')).status, 'rejected');
  f.preferences.configuration.security.permissions[0].allowed = true;
  assert.equal((await f.run('select', { locationId: 'cedar-creek' })).status, 'applied');
  assert.equal((await f.run('currentLocation')).status, 'applied'); assert.equal(f.widgets.selected.weatherLocationId, 'pine-valley');
  f.preferences.configuration.security.permissions[0].allowed = false;
  assert.equal((await f.run('currentLocation')).status, 'rejected');
});
test('computed maps and detail charts retain actual source rows, show original forecasts and disclose synthetic metrics', async () => {
  const f = fixture(), session = weatherAppWindow(f.state, f.window.id), row = f.widgets.sources.weather[0];
  await f.run('section', { section: 'map' }); await f.run('map.time', { index: 7 }); await f.run('map.layer', { layer: 'precipitation' }); await f.run('map.zoom', { zoom: 3 }); await f.run('map.pan', { x: 18, y: -22 });
  const point = weatherMapPoints(f.widgets, session, f.time())[0];
  assert.equal(point.row, row); assert.equal(point.temperature, row.hourly[7].temperature); assert.equal(point.at, f.time() + row.hourly[7].offsetHours * 3600000);
  const chart = weatherForecastChart(row, 'fahrenheit'); assert.equal(chart.points[7].label, `${weatherTemperature(row.hourly[7].temperature, 'fahrenheit')}°`); assert.ok(chart.path.startsWith('M'));
  assert.match(weatherMetrics(row).disclosure, /not measurements/); assert.equal(session.mapZoom, 3); assert.equal(session.mapX, 18);
  await f.run('map.play', { playing: true }); assert.equal(session.mapPlaying, true); await f.run('map.time', { index: 0 }); assert.equal(session.mapPlaying, false);
});
test('complete-scene exact signed shared + actor growth succeeds; one unit below publishes neither participant', async () => {
  const probe = fixture(), before = probe.total();
  await probe.run('search', { query: 'Harbor' }); await probe.run('preview', { locationId: 'harbor-point' });
  const beforeAdd = probe.total(); assert.equal((await probe.run('favorite.add', { locationId: 'harbor-point' })).status, 'applied'); const growth = probe.total() - beforeAdd;
  assert.ok(growth > 0); assert.ok(probe.reservation().actorDelta < 0); assert.ok(probe.total() > before);
  for (const offset of [0, -1]) {
    const f = fixture(); await f.run('search', { query: 'Harbor' }); await f.run('preview', { locationId: 'harbor-point' });
    f.setQuota(f.total() + growth + offset); const snapshot = JSON.stringify([f.state, f.widgets, f.preferences]);
    const result = await f.run('favorite.add', { locationId: 'harbor-point' }); assert.equal(result.status, offset === 0 ? 'applied' : 'rejected');
    if (offset === -1) assert.equal(JSON.stringify([f.state, f.widgets, f.preferences]), snapshot);
  }
});
test('actor veto/false shared acknowledgement publishes no source row, selection or native participant', async () => {
  const f = fixture(); await f.run('search', { query: 'Harbor' }); await f.run('preview', { locationId: 'harbor-point' });
  const snapshot = JSON.stringify([f.state, f.widgets, f.preferences]); f.veto();
  assert.equal((await f.run('favorite.add', { locationId: 'harbor-point' })).status, 'rejected'); assert.equal(JSON.stringify([f.state, f.widgets, f.preferences]), snapshot);
});
test('strict false actor onCommit veto retains both original canonical participants', async () => {
  const f = fixture(); await f.run('search', { query: 'Harbor' }); await f.run('preview', { locationId: 'harbor-point' });
  const snapshot = JSON.stringify([f.state, f.widgets, f.preferences]);
  f.ctx.canCommit = () => false;
  assert.equal((await f.run('favorite.add', { locationId: 'harbor-point' })).status, 'rejected');
  assert.equal(JSON.stringify([f.state, f.widgets, f.preferences]), snapshot);
});
test('every nested source/view/window/clock substitution vetoes publication at shared preflight', async () => {
  for (const substitute of [
    f => { f.widgets.sources.weather[0].hourly[0] = { ...f.widgets.sources.weather[0].hourly[0] }; },
    f => { f.widgets.sources.weather[0].daily = copyCanonicalData(f.widgets.sources.weather[0].daily); },
    f => { f.widgets.instances = copyCanonicalData(f.widgets.instances); },
    f => { f.preferences.configuration.locale = { ...f.preferences.configuration.locale }; },
    f => { f.state.windows[0] = { ...f.state.windows[0] }; },
    f => { f.windows.set(f.window.id, { ...f.window }); },
    f => { f.window.bounds = { x: 10, y: 10 }; },
    f => { f.views.set(f.window.id, { ...f.view }); },
    f => { f.setTime(f.time() + 1); },
    f => { f.shared.widgets = copyCanonicalData(f.widgets); },
  ]) {
    const f = fixture(); f.reenter(() => substitute(f));
    assert.equal((await f.run('favorite.add', { locationId: 'harbor-point' })).status, 'rejected'); assert.equal(weatherSource(f.widgets, 'harbor-point'), null); assert.equal(f.widgets.selected.weatherLocationId, 'pine-valley');
  }
});
test('original-native unavailable facade and stale asynchronous focus/scroll cannot claim applied', async () => {
  const f = fixture();
  f.view.focus = async () => { f.views.set(f.window.id, { ...f.view }); return true; };
  assert.equal((await f.run('native.focus', { controlId: 'search' })).status, 'rejected');
  const unavailable = fixture(); unavailable.view.available = () => false;
  assert.deepEqual(unavailable.controller.targets(), []); assert.equal((await unavailable.run('search', { query: 'Pine' })).status, 'rejected');
  const scroll = fixture(); scroll.view.scroll = async () => { scroll.setTime(scroll.time() + 1); return { top: 30, left: 0 }; };
  assert.equal((await scroll.run('native.scroll', { areaId: 'forecast', top: 30, left: 0 })).status, 'rejected');
});
test('post-publication tick retires presentation without undoing an already acknowledged canonical favorite', async () => {
  const f = fixture(); f.afterTick(() => { f.views.set(f.window.id, { ...f.view }); });
  const result = await f.run('favorite.add', { locationId: 'harbor-point' });
  assert.equal(result.status, 'applied'); assert.equal(result.presentationAvailable, false); assert.equal(f.widgets.selected.weatherLocationId, 'harbor-point');
});
test('closed argument schemas reject accessor payloads, duplicate reorder IDs, unsupported and unbounded values', async () => {
  const f = fixture(); let reads = 0;
  const payload = {}; Object.defineProperty(payload, 'query', { enumerable: true, get() { reads++; return 'Pine'; } });
  assert.equal((await f.run('search', payload)).status, 'rejected'); assert.equal(reads, 0);
  for (const [name, payload] of [['search', { query: 'x'.repeat(513) }], ['unit', { unit: 'kelvin' }], ['map.time', { index: 24 }], ['map.zoom', { zoom: 0 }], ['map.pan', { x: 301, y: 0 }], ['favorite.reorder', { locationIds: ['pine-valley', 'pine-valley'] }], ['favorite.add', { locationId: 'unknown' }]]) assert.equal((await f.run(name, payload)).status, 'rejected', name);
  Object.freeze(f.state.windows);
  assert.equal((await f.run('search', { query: 'Pine' })).status, 'rejected');
});
test('real two-argument createWindow passes the SAME guarded options to registration; lifecycle retires original sessions only', async () => {
  const f = fixture(), firstSession = f.state.windows[0];
  const created = await f.run('window.new'); assert.equal(created.status, 'applied'); assert.equal(created.createdWindowId, 'weather-second'); assert.equal(f.state.windows[0], firstSession); assert.equal(f.state.windows.length, 2); assert.equal(typeof f.options().isCurrent, 'function');
  assert.equal(f.controller.windowClosed({ ...f.window }).status, 'rejected');
  assert.equal((await f.run('search', { query: 'Misty' }, 'weather-second')).status, 'applied'); assert.equal(firstSession.query, '');
  assert.equal((await f.run('window.close', {}, 'weather-second')).status, 'applied'); assert.equal(f.state.windows.length, 1);
  const snapshot = JSON.stringify(f.widgets); assert.equal((await f.run('app.quit')).status, 'applied'); assert.equal(f.state.windows.length, 0); assert.equal(JSON.stringify(f.widgets), snapshot);
  f.controller.dispose(); assert.deepEqual(f.controller.targets(), []);
});
test('last shared favorite removal clears all open detail sessions and does not strand another native window inert', async () => {
  const f = fixture(); await f.run('window.new');
  await f.run('detail', { detail: 'temperature' }); await f.run('detail', { detail: 'wind' }, 'weather-second');
  assert.equal(f.state.windows[1].detail, 'wind');
  await f.run('favorite.remove', { locationId: 'pine-valley' });
  await f.run('favorite.remove', { locationId: 'cedar-creek' });
  assert.equal(f.widgets.selected.weatherLocationId, null);
  assert.ok(f.state.windows.every(window => window.detail === null));
});
test('saved windows enforce unique original IDs, authored preview links, era disclosure and real menu commands', () => {
  const f = fixture(), saved = copyCanonicalData(f.state);
  assert.equal(validateWeatherAppState(saved, f.profile).ok, true);
  saved.windows.push({ ...saved.windows[0] }); assert.equal(validateWeatherAppState(saved, f.profile).ok, false);
  saved.windows.pop(); saved.windows[0].previewId = 'unknown'; assert.equal(validateWeatherAppState(saved, f.profile).ok, false);
  const menus = weatherAppMenus(f.profile, f.state, f.window.id, f.widgets, f.preferences), catalog = weatherAppCatalog();
  for (const menu of menus) for (const item of menu.items) assert.ok(catalog[item.request.command], item.request.command);
  assert.match(weatherAppMeta('macos-golden-gate-27.0.1').disclosure, /26.*27/);
  assert.match(weatherAppMeta('windows11-23h2-22631.2428').disclosure, /functional equivalent/);
});

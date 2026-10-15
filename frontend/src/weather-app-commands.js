import { defineCommand, object, choice, flag, empty } from './command-schema.js';
import { copyCanonicalData, applyCanonicalData, canonicalStringUnits } from './canonical-data.js';
import { validateWidgetsState } from './notification-widget-model.js';
import { WEATHER_APP_PROFILES, WEATHER_APP_DETAILS, WEATHER_APP_MENUS, weatherAppIdSchema, weatherAppSchemaValid, validateWeatherAppState, weatherAppWindow, createWeatherAppWindow, weatherCatalogueRow, weatherSource, weatherDisplayedRow, weatherLocationPermission, weatherCurrentLocationId, weatherSceneEpoch, weatherTemperatureUnit, weatherAppMeta } from './weather-app-state.js';
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
export const weatherAppTargetSchema = object({ windowId: weatherAppIdSchema });
export const weatherAppCommandSpecs = {
  'search': object({ query: { type: 'string', maxLength: 512 } }),
  'preview': object({ locationId: weatherAppIdSchema }),
  'select': object({ locationId: weatherAppIdSchema }),
  'favorite.add': object({ locationId: weatherAppIdSchema }),
  'favorite.remove': object({ locationId: weatherAppIdSchema }),
  'favorite.reorder': object({ locationIds: { type: 'array', maxItems: 64, items: weatherAppIdSchema, uniqueItems: true } }),
  'favorite.edit': object({ editing: flag }),
  'currentLocation': empty,
  'unit': object({ unit: choice('celsius', 'fahrenheit') }),
  'section': object({ section: choice('forecast', 'map', 'settings', 'help') }),
  'detail': object({ detail: nullable(choice(...WEATHER_APP_DETAILS)) }),
  'sidebar': object({ visible: flag }),
  'map.layer': object({ layer: choice('temperature', 'precipitation', 'wind') }),
  'map.time': object({ index: integer(0, 23) }),
  'map.play': object({ playing: flag }),
  'map.zoom': object({ zoom: integer(1, 4) }),
  'map.pan': object({ x: integer(-300, 300), y: integer(-200, 200) }),
  'menu': object({ menu: nullable(choice(...WEATHER_APP_MENUS)) }),
  'native.focus': object({ controlId: { type: 'string', minLength: 1, maxLength: 128 } }),
  'native.scroll': object({ areaId: choice('favorites', 'forecast', 'hourly', 'help'), top: { type: 'number', minimum: 0, maximum: 1000000 }, left: { type: 'number', minimum: 0, maximum: 1000000 } }),
  'window.new': empty, 'window.close': empty, 'app.quit': empty,
};
export function weatherAppCatalog() {
  const profiles = WEATHER_APP_PROFILES;
  return Object.fromEntries(Object.entries(weatherAppCommandSpecs).map(([name, payload]) => defineCommand(profiles, `weather.${name}`, 'weather.workspace', weatherAppTargetSchema, payload,
    ['Original Weather actor/window/native facade and shared widgets/preferences; authored scene time; complete-scene signed text quota.'],
    ['Native forecast, searchable authored catalogue, favorites, details and SVG map settle on the actual registered view.'],
    ['Presentation state uses weatherApp.windows only. Shared sources.weather, selected.weatherLocationId and weather configuration.unit remain the original authority. No physical geolocation or live forecast is used.'])));
}
const reject = (code, message) => ({ status: 'rejected', error: { code, message } });
function retainGraph(root) {
  const entries = [], seen = new Set();
  function visit(node) {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    const descriptors = Object.getOwnPropertyDescriptors(node), keys = Reflect.ownKeys(descriptors);
    entries.push({ node, descriptors, keys, prototype: Object.getPrototypeOf(node) });
    for (const key of keys) if (Object.hasOwn(descriptors[key], 'value')) visit(descriptors[key].value);
  }
  visit(root);
  return () => entries.every(({ node, descriptors, keys, prototype }) => Object.getPrototypeOf(node) === prototype && Reflect.ownKeys(node).length === keys.length && keys.every(key => {
    const before = descriptors[key], after = Object.getOwnPropertyDescriptor(node, key);
    return after && before.value === after.value && before.get === after.get && before.set === after.set && before.enumerable === after.enumerable && before.writable === after.writable && before.configurable === after.configurable;
  }));
}
function writableGraph(root) {
  if (!root || typeof root !== 'object') return true;
  const descriptors = Object.getOwnPropertyDescriptors(root);
  return Object.isExtensible(root) && Reflect.ownKeys(descriptors).every(key => Object.hasOwn(descriptors[key], 'value') && descriptors[key].writable === true && (key === 'length' || descriptors[key].configurable === true) && writableGraph(descriptors[key].value));
}
export function createWeatherAppCommands(state, ctx) {
  let disposed = false;
  const originals = new Map();
  const alive = () => !disposed && ctx.getState() === state && (!ctx.alive || ctx.alive() === true) && validateWeatherAppState(state, ctx.profile).ok;
  const epoch = () => weatherSceneEpoch(ctx.getSceneTime());
  function owner(windowId) {
    if (!alive()) return null;
    const window = ctx.getWindow(windowId), view = ctx.getView(windowId), session = weatherAppWindow(state, windowId);
    const widgets = ctx.getShared('widgets'), preferences = ctx.getShared('preferences'), time = epoch();
    if (!window || window.appId !== 'weather' || originals.get(windowId) !== window || !session || !view || ctx.available(window) !== true || view.available() !== true || time === null || !validateWidgetsState(widgets).ok || !preferences?.configuration?.locale || !preferences?.configuration?.security) return null;
    const actorCurrent = retainGraph(state), widgetsCurrent = retainGraph(widgets), preferencesCurrent = retainGraph(preferences), windowCurrent = retainGraph(window), viewCurrent = retainGraph(view);
    const guard = () => alive() && actorCurrent() && widgetsCurrent() && preferencesCurrent() && windowCurrent() && viewCurrent() && originals.get(windowId) === window && ctx.getShared('widgets') === widgets && ctx.getShared('preferences') === preferences && epoch() === time && ctx.getWindow(windowId) === window && ctx.getView(windowId) === view && weatherAppWindow(state, windowId) === session && ctx.available(window) === true && view.available() === true;
    return { window, view, session, widgets, preferences, time, guard };
  }
  function plan(mutate, guard) {
    if (!alive() || guard() !== true || !writableGraph(state)) return null;
    const current = retainGraph(state), next = copyCanonicalData(state);
    const result = mutate(next);
    if (result?.status === 'rejected') return { error: result };
    const valid = validateWeatherAppState(next, ctx.profile);
    if (!valid.ok) return { error: reject('invalid_arguments', valid.message) };
    const delta = canonicalStringUnits(next) - canonicalStringUnits(state);
    let used = false;
    return { next, delta, publish() {
      if (used || !alive() || !current() || guard() !== true) return false;
      let allowed = false;
      try { allowed = ctx.canCommit(delta) === true; } catch { return false; }
      if (!allowed || !alive() || !current() || guard() !== true || !writableGraph(state)) return false;
      applyCanonicalData(state, next); used = true; return true;
    } };
  }
  function commit(mutate, guard) {
    const prepared = plan(mutate, guard);
    if (prepared?.error) return prepared.error;
    return prepared?.publish() === true ? { status: 'applied' } : reject('stale_or_quota', 'The original Weather actor or complete-scene quota changed before publication.');
  }
  async function settle(result, lease, target) {
    if (result?.status !== 'applied') return result;
    await ctx.tick();
    return { ...result, target, presentationAvailable: alive() && ctx.getWindow(target.windowId) === lease.window && ctx.getView(target.windowId) === lease.view && ctx.available(lease.window) === true && lease.view.available() === true };
  }
  function paired(lease, target, sharedName, mutate, actorMutate = next => {
    const window = weatherAppWindow(next, target.windowId);
    window.query = ''; window.previewId = null; window.detail = null; window.menu = null; window.section = 'forecast';
  }) {
    if (typeof ctx.mutateShared !== 'function') return reject('unavailable', 'Actual shared canonical mutation bridge is unavailable.');
    const prepared = plan(actorMutate, lease.guard);
    if (prepared?.error) return prepared.error;
    if (!prepared || !lease.guard()) return reject('stale_target', 'Original Weather participant changed.');
    let published = false;
    const result = ctx.mutateShared(sharedName, mutate, { guard: lease.guard, windowId: target.windowId, reserveTextUnits: prepared.delta,
      onCommit: () => { published = prepared.publish(); return published === true; } });
    return published && result?.status === 'applied' ? { status: 'applied' } : result?.status === 'rejected' ? result : reject('unavailable', 'The actual shared participant did not atomically acknowledge Weather publication.');
  }
  const handlers = Object.fromEntries(Object.entries(weatherAppCommandSpecs).map(([name, schema]) => [`weather.${name}`, async (target, payload = {}) => {
    if (!weatherAppSchemaValid(target, weatherAppTargetSchema) || !weatherAppSchemaValid(payload, schema)) return reject('invalid_arguments', 'Use the exact bounded Weather target and payload.');
    const lease = owner(target.windowId);
    if (!lease || !lease.guard()) return reject('unavailable', 'The original Weather window, view, shared sources, preferences and scene clock must be available.');
    if (name === 'native.focus') {
      const focused = await lease.view.focus(payload.controlId, lease.guard);
      return focused === true && lease.guard() ? { status: 'applied', target } : reject('unavailable', 'The original visible native control could not be focused.');
    }
    if (name === 'native.scroll') {
      const offsets = await lease.view.scroll(payload.areaId, payload, lease.guard);
      return offsets && lease.guard() ? { status: 'applied', target, offsets } : reject('unavailable', 'The original visible scroll area is unavailable.');
    }
    if (name === 'window.close') {
      const result = await ctx.closeWindow(target.windowId, { guard: lease.guard, windowId: target.windowId });
      return !ctx.getWindow(target.windowId) && !weatherAppWindow(state, target.windowId) ? { status: 'applied', target } : result?.status === 'rejected' ? result : reject('unavailable', 'The actual original Weather window/session was not closed.');
    }
    if (name === 'app.quit') {
      const result = await ctx.appQuit('weather', { guard: lease.guard, windowId: target.windowId });
      return !state.windows.length && !ctx.getWindows().some(window => window.appId === 'weather') ? { status: 'applied', target } : result?.status === 'rejected' ? result : reject('unavailable', 'The actual original Weather windows/sessions were not retired.');
    }
    if (name === 'window.new') {
      const options = { ...weatherAppMeta(ctx.profile).window, title: weatherAppMeta(ctx.profile).name, isCurrent: lease.guard, ownership: { guard: lease.guard, windowId: target.windowId } };
      const actual = await ctx.createWindow('weather', options);
      return alive() && actual?.appId === 'weather' && ctx.getWindow(actual.id) === actual && originals.get(actual.id) === actual && weatherAppWindow(state, actual.id) ? { status: 'applied', target, createdWindowId: actual.id } : reject('unavailable', 'No actual original new Weather window/session was published.');
    }
    if (name === 'select' || name === 'currentLocation' || name === 'favorite.add') {
      const locationId = name === 'currentLocation' ? weatherCurrentLocationId : payload.locationId;
      if (name === 'currentLocation' && !weatherLocationPermission(lease.preferences)) return reject('permission_denied', 'Weather location access is not enabled in the actual Privacy & Security permissions. Enable it there; My Location is the disclosed authored Pine Valley scene location, not host geolocation.');
      const row = weatherSource(lease.widgets, locationId), authored = row ? null : weatherCatalogueRow(locationId);
      if (name === 'select' && !row || !row && !authored) return reject('not_found', 'Choose an existing favorite or authored catalogue location.');
      if (name === 'favorite.add' && row) return reject('already_exists', 'This original shared favorite already exists.');
      if (!row && lease.widgets.sources.weather.length >= 64) return reject('limit_exceeded', 'The original shared location list is full.');
      return settle(paired(lease, target, 'widgets', shared => {
        if (!shared.sources.weather.some(row => row.id === locationId)) shared.sources.weather.push(copyCanonicalData(authored));
        shared.selected.weatherLocationId = locationId;
      }), lease, target);
    }
    if (name === 'favorite.remove') {
      if (!weatherSource(lease.widgets, payload.locationId)) return reject('not_found', 'The original shared favorite no longer exists.');
      return settle(paired(lease, target, 'widgets', shared => {
        const rows = shared.sources.weather;
        rows.splice(rows.findIndex(row => row.id === payload.locationId), 1);
        const replacement = rows[0]?.id ?? null;
        if (shared.selected.weatherLocationId === payload.locationId) shared.selected.weatherLocationId = replacement;
        for (const widget of shared.instances) if (widget.kind === 'weather' && widget.configuration.locationId === payload.locationId) widget.configuration.locationId = replacement;
      }, next => {
        for (const window of next.windows) {
          if (window.previewId === payload.locationId) window.previewId = null;
          if (lease.widgets.sources.weather.length === 1) window.detail = null;
        }
        weatherAppWindow(next, target.windowId).detail = null;
      }), lease, target);
    }
    if (name === 'favorite.reorder') {
      const ids = lease.widgets.sources.weather.map(row => row.id);
      if (payload.locationIds.length !== ids.length || new Set(payload.locationIds).size !== ids.length || payload.locationIds.some(id => !ids.includes(id))) return reject('invalid_arguments', 'Reorder exactly every original shared favorite once.');
      return settle(paired(lease, target, 'widgets', shared => {
        const rows = new Map(shared.sources.weather.map(row => [row.id, row]));
        shared.sources.weather.splice(0, shared.sources.weather.length, ...payload.locationIds.map(id => rows.get(id)));
      }, () => {}), lease, target);
    }
    if (name === 'unit') {
      const hasWidgets = lease.widgets.instances.some(row => row.kind === 'weather');
      return settle(paired(lease, target, hasWidgets ? 'widgets' : 'preferences', shared => {
        if (hasWidgets) {
          for (const widget of shared.instances) if (widget.kind === 'weather') widget.configuration.unit = payload.unit;
        } else shared.configuration.locale.temperature = payload.unit;
      }, () => {}), lease, target);
    }
    return settle(commit(next => {
      const window = weatherAppWindow(next, target.windowId);
      if (name === 'search') { window.query = payload.query; window.previewId = null; window.detail = null; window.menu = null; window.sidebar = true; }
      else if (name === 'preview') {
        if (!weatherCatalogueRow(payload.locationId)) return reject('not_found', 'Choose an authored catalogue result; original favorites use select.');
        window.previewId = payload.locationId; window.section = 'forecast'; window.detail = null;
      }
      else if (name === 'favorite.edit') { window.editing = payload.editing; window.menu = null; }
      else if (name === 'section') { window.section = payload.section; window.detail = null; window.menu = null; }
      else if (name === 'detail') {
        if (payload.detail !== null && !weatherDisplayedRow(lease.widgets, lease.session)) return reject('unavailable', 'Choose an original forecast or authored preview before opening details.');
        window.detail = payload.detail; window.menu = null;
      }
      else if (name === 'sidebar') window.sidebar = payload.visible;
      else if (name === 'map.layer') window.mapLayer = payload.layer;
      else if (name === 'map.time') { window.mapIndex = payload.index; window.mapPlaying = false; }
      else if (name === 'map.play') window.mapPlaying = payload.playing;
      else if (name === 'map.zoom') window.mapZoom = payload.zoom;
      else if (name === 'map.pan') { window.mapX = payload.x; window.mapY = payload.y; }
      else if (name === 'menu') window.menu = payload.menu;
    }, lease.guard), lease, target);
  }]));
  function windowOpened(window, options = {}) {
    const external = () => (!options.isCurrent || options.isCurrent() === true) && (!options.ownership?.guard || options.ownership.guard() === true);
    if (!alive() || !window || window.appId !== 'weather' || !weatherAppSchemaValid(window.id, weatherAppIdSchema) || ctx.getWindow(window.id) !== window || originals.has(window.id) && originals.get(window.id) !== window || !external()) return reject('unavailable', 'Register only the actual original Weather window.');
    if (weatherAppWindow(state, window.id)) { originals.set(window.id, window); return { status: 'applied' }; }
    const at = epoch(), windowCurrent = retainGraph(window);
    const result = commit(next => { next.windows.push(createWeatherAppWindow(window.id)); }, () => alive() && windowCurrent() && ctx.getWindow(window.id) === window && epoch() === at && external());
    if (result.status === 'applied') originals.set(window.id, window);
    return result;
  }
  function windowClosed(window, ownership = {}) {
    if (!window || typeof window !== 'object' || window.appId !== 'weather' || originals.get(window.id) !== window) return reject('invalid_arguments', 'Weather close requires its registered actual original window.');
    if (!weatherAppWindow(state, window.id)) return { status: 'applied' };
    const actual = ctx.getWindow(window.id), session = weatherAppWindow(state, window.id);
    if (actual && actual !== window) return reject('stale_target', 'A replacement window cannot retire the original Weather session.');
    const windowCurrent = retainGraph(window);
    const result = commit(next => { next.windows.splice(next.windows.findIndex(row => row.windowId === window.id), 1); }, () => alive() && windowCurrent() && originals.get(window.id) === window && weatherAppWindow(state, window.id) === session && ctx.getWindow(window.id) === actual && (!ownership.guard || ownership.guard() === true));
    if (result.status === 'applied') originals.delete(window.id);
    return result;
  }
  function appQuit(appId, ownership = {}) {
    if (appId !== 'weather') return { status: 'applied' };
    const windows = state.windows.map(row => [row.windowId, originals.get(row.windowId), ctx.getWindow(row.windowId)]);
    const guard = () => alive() && (!ownership.guard || ownership.guard() === true) && windows.every(([id, original, actual]) => original && originals.get(id) === original && ctx.getWindow(id) === actual && (!actual || actual === original));
    const result = commit(next => { next.windows.splice(0); }, guard);
    if (result.status === 'applied') originals.clear();
    return result;
  }
  return { handlers, targets: () => alive() ? state.windows.filter(session => {
    const window = ctx.getWindow(session.windowId), view = ctx.getView(session.windowId);
    return window?.appId === 'weather' && originals.get(session.windowId) === window && view && ctx.available(window) === true && view.available() === true;
  }).map(session => ({ windowId: session.windowId })) : [], windowOpened, windowClosed, appQuit, dispose: () => { disposed = true; originals.clear(); } };
}
export function weatherAppMenus(profile, state, windowId, widgets, preferences) {
  const session = weatherAppWindow(state, windowId), target = { windowId }, unit = weatherTemperatureUnit(widgets, preferences);
  const item = (id, label, suffix, payload = {}, enabled = !!session, checked = false) => ({ id, label, enabled, checked, request: { command: `weather.${suffix}`, target, payload } });
  return [
    { id: 'weather', label: weatherAppMeta(profile).name, items: [item('settings', 'Settings…', 'section', { section: 'settings' }), item('quit', `Quit ${weatherAppMeta(profile).name}`, 'app.quit')] },
    { id: 'file', label: 'File', items: [item('new', 'New Window', 'window.new'), item('close', 'Close Window', 'window.close')] },
    { id: 'edit', label: 'Edit', items: [item('search', 'Find Location…', 'native.focus', { controlId: 'search' }), item('favorites', session?.editing ? 'Done Editing Locations' : 'Edit Locations', 'favorite.edit', { editing: !session?.editing })] },
    { id: 'view', label: 'View', items: [item('forecast', 'Forecast', 'section', { section: 'forecast' }, !!session, session?.section === 'forecast'), item('map', 'Weather Map', 'section', { section: 'map' }, !!session, session?.section === 'map'), item('sidebar', session?.sidebar ? 'Hide Sidebar' : 'Show Sidebar', 'sidebar', { visible: !session?.sidebar }), item('celsius', 'Celsius', 'unit', { unit: 'celsius' }, !!session, unit === 'celsius'), item('fahrenheit', 'Fahrenheit', 'unit', { unit: 'fahrenheit' }, !!session, unit === 'fahrenheit'), item('current', 'My Location — authored Pine Valley', 'currentLocation', {}, !!session && weatherLocationPermission(preferences))] },
    { id: 'window', label: 'Window', items: [item('new-window', 'New Window', 'window.new'), item('close-window', 'Close Window', 'window.close')] },
    { id: 'help', label: 'Help', items: [item('help', 'Weather Help & Data Sources', 'section', { section: 'help' })] },
  ];
}

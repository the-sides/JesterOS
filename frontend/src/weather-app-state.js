import { object, choice, flag } from './command-schema.js';
import { previewSchemaValid } from './preview-state.js';
import { canonicalStringUnits } from './canonical-data.js';
import { validateWidgetsState } from './notification-widget-model.js';

export const WEATHER_APP_PROFILES = ['macos-high-sierra-10.13', 'macos-mojave-10.14', 'macos-sonoma-14.0', 'macos-golden-gate-27.0.1', 'windows11-23h2-22631.2428'];
export const weatherAppIdSchema = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', not: { enum: [...Object.getOwnPropertyNames(Object.prototype), 'prototype'] } };
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
export const WEATHER_APP_DETAILS = ['temperature', 'precipitation', 'uv', 'humidity', 'wind', 'visibility', 'pressure'];
export const WEATHER_APP_MENUS = ['weather', 'file', 'edit', 'view', 'window', 'help'];
export const weatherAppWindowSchema = object({
  windowId: weatherAppIdSchema, appId: choice('weather'), query: { type: 'string', maxLength: 512 },
  previewId: nullable(weatherAppIdSchema), section: choice('forecast', 'map', 'settings', 'help'),
  detail: nullable(choice(...WEATHER_APP_DETAILS)), menu: nullable(choice(...WEATHER_APP_MENUS)),
  editing: flag, sidebar: flag, mapLayer: choice('temperature', 'precipitation', 'wind'),
  mapIndex: integer(0, 23), mapPlaying: flag, mapZoom: integer(1, 4), mapX: integer(-300, 300), mapY: integer(-200, 200),
});
// Weather stores presentation sessions only. Forecasts, favorites and selection are the actual widgets leaf.
export const weatherAppSchema = object({ version: choice(1), profileId: choice(...WEATHER_APP_PROFILES), windows: { type: 'array', maxItems: 32, items: weatherAppWindowSchema } });
export const weatherAppSchemaValid = previewSchemaValid;
export function weatherAppDefaults(profile) {
  const profileId = typeof profile === 'string' ? profile : profile.id;
  if (!WEATHER_APP_PROFILES.includes(profileId)) throw new TypeError('Unsupported Weather profile.');
  return { version: 1, profileId, windows: [] };
}
export const weatherAppWindow = (state, windowId) => state.windows.find(row => row.windowId === windowId) ?? null;
export function createWeatherAppWindow(windowId) {
  return { windowId, appId: 'weather', query: '', previewId: null, section: 'forecast', detail: null, menu: null, editing: false, sidebar: true, mapLayer: 'temperature', mapIndex: 0, mapPlaying: false, mapZoom: 1, mapX: 0, mapY: 0 };
}
export function validateWeatherAppState(state, profile) {
  if (!weatherAppSchemaValid(state, weatherAppSchema) || profile && state.profileId !== (typeof profile === 'string' ? profile : profile.id)) return { ok: false, message: 'Weather requires its closed bounded profile-specific window graph.' };
  if (new Set(state.windows.map(row => row.windowId)).size !== state.windows.length || state.windows.some(row => row.previewId !== null && !weatherCityCatalogue.some(city => city.id === row.previewId))) return { ok: false, message: 'Weather sessions require unique window identities and existing authored previews.' };
  return canonicalStringUnits(state) <= 4 * 1024 * 1024 ? { ok: true } : { ok: false, message: 'Weather sessions exceed canonical text retention.' };
}
export function weatherAppMeta(profile) {
  const id = typeof profile === 'string' ? profile : profile.id;
  const localEquivalent = !/sonoma|golden-gate/u.test(id), windows = id.startsWith('windows11'), golden = id.includes('golden-gate');
  return { appId: 'weather', name: localEquivalent ? 'Local Weather' : 'Weather', window: { width: 1020, height: 740 }, localEquivalent,
    disclosure: windows ? 'Local Weather — Windows 11 functional equivalent, not Apple Weather or an MSN service.' : localEquivalent ? 'Local Weather — functional companion for this era; the standalone Apple Weather app arrived with macOS Ventura.' : golden ? 'Golden Gate uses the nearest researched macOS Tahoe 26 Weather reference; unseen 27 pixel parity is not certified.' : 'Sonoma Weather recreation with authored offline forecasts.',
  };
}
const conditionCycle = ['sunny', 'partly-cloudy', 'cloudy', 'rain', 'snow', 'storm', 'fog'];
const city = (id, name, timeZone, temperature, condition, high, low, x, y) => Object.freeze({ id, name, timeZone, temperature, condition, high, low, x, y });
// Readonly authored catalogue, not a second writable forecast/favorites graph.
export const weatherCityCatalogue = Object.freeze([
  city('pine-valley', 'Pine Valley', 'America/Los_Angeles', 22, 'sunny', 26, 14, 112, 194),
  city('cedar-creek', 'Cedar Creek', 'America/New_York', 18, 'partly-cloudy', 21, 12, 200, 175),
  city('harbor-point', 'Harbor Point', 'Europe/London', 15, 'rain', 17, 10, 285, 116),
  city('maple-ridge', 'Maple Ridge', 'America/New_York', 12, 'cloudy', 16, 6, 159, 153),
  city('snowfield', 'Snowfield', 'Europe/London', -2, 'snow', 1, -7, 300, 135),
  city('misty-bay', 'Misty Bay', 'Asia/Tokyo', 19, 'fog', 23, 15, 479, 182),
  city('stormhaven', 'Stormhaven', 'Asia/Tokyo', 24, 'storm', 28, 18, 497, 300),
]);
export function weatherCatalogueRow(locationId) {
  const source = weatherCityCatalogue.find(row => row.id === locationId);
  if (!source) return null;
  const { id, name, timeZone, temperature, condition, high, low } = source;
  return { id, name, timeZone, temperature, condition, high, low,
    hourly: Array.from({ length: 24 }, (_, offsetHours) => ({ offsetHours, temperature: Math.round((temperature + Math.sin(offsetHours * Math.PI / 12) * (high - low) / 3) * 10) / 10, condition: offsetHours < 6 ? condition : conditionCycle[(conditionCycle.indexOf(condition) + Math.floor(offsetHours / 6)) % conditionCycle.length] })),
    daily: Array.from({ length: 7 }, (_, offsetDays) => ({ offsetDays, high: high - offsetDays % 3, low: low - offsetDays % 2, condition: conditionCycle[(conditionCycle.indexOf(condition) + offsetDays) % conditionCycle.length] })),
  };
}
// Called by the shared-widget initializer before publication, never by a view.
// Preserve every supplied row/forecast/instance/selection when the source list is nonempty.
export function seedWeatherSources(widgets) {
  if (!validateWidgetsState(widgets).ok) throw new TypeError('Seed Weather into an actual compatible widgets graph.');
  if (widgets.sources.weather.length) return widgets;
  widgets.sources.weather.push(weatherCatalogueRow('pine-valley'), weatherCatalogueRow('cedar-creek'));
  if (widgets.selected.weatherLocationId === null) widgets.selected.weatherLocationId = widgets.sources.weather[0].id;
  return widgets;
}
export const weatherSource = (widgets, id) => widgets?.sources.weather.find(row => row.id === id) ?? null;
export function weatherSearch(widgets, query) {
  const needle = query.trim().toLocaleLowerCase('en-US');
  const rows = [...(widgets?.sources.weather ?? []), ...weatherCityCatalogue.filter(row => !weatherSource(widgets, row.id))];
  return rows.filter(row => !needle || `${row.name} ${row.id} ${row.timeZone}`.toLocaleLowerCase('en-US').includes(needle));
}
export function weatherDisplayedRow(widgets, session) {
  return session?.previewId ? weatherSource(widgets, session.previewId) ?? weatherCatalogueRow(session.previewId) : weatherSource(widgets, widgets?.selected.weatherLocationId);
}
export function weatherTemperatureUnit(widgets, preferences) {
  // If widgets disagree, their first original weather instance is the native read authority;
  // a unit change normalizes every instance rather than maintaining a shadow app setting.
  return widgets?.instances.find(row => row.kind === 'weather')?.configuration.unit ?? preferences?.configuration.locale.temperature ?? 'celsius';
}
export const weatherTemperature = (value, unit) => Math.round(unit === 'fahrenheit' ? value * 9 / 5 + 32 : value);
export const weatherConditionLabel = condition => ({ sunny: 'Sunny', 'partly-cloudy': 'Partly Cloudy', cloudy: 'Cloudy', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorms', fog: 'Fog' })[condition] ?? condition;
export const weatherConditionSymbol = condition => ({ sunny: '☀', 'partly-cloudy': '⛅', cloudy: '☁', rain: '☂', snow: '❄', storm: 'ϟ', fog: '≋' })[condition] ?? '☁';
export function weatherSceneEpoch(value) {
  const time = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isSafeInteger(time) && Math.abs(time) <= 8639999999999999 ? time : null;
}
export function weatherLocationPermission(preferences) {
  return preferences?.configuration.security.permissions.some(row => row.category === 'location' && row.appId === 'weather' && row.allowed === true) === true;
}
export const weatherCurrentLocationId = 'pine-valley';
export function weatherMetrics(row) {
  if (!row) return null;
  const wet = ['rain', 'storm', 'snow'].includes(row.condition), sun = row.condition === 'sunny', spread = Math.abs(row.high - row.low);
  return { precipitation: wet ? row.condition === 'storm' ? 8.4 : 3.2 : 0, humidity: row.condition === 'fog' ? 94 : wet ? 84 : sun ? 42 : 65,
    uv: sun ? 6 : row.condition === 'partly-cloudy' ? 4 : 1, wind: Math.round(6 + spread + (row.condition === 'storm' ? 15 : 0)),
    visibility: row.condition === 'fog' ? 1.2 : wet ? 6 : 16, pressure: Math.round(1015 - spread / 2 - (wet ? 12 : 0)),
    disclosure: 'Illustrative derived fixture metrics, not measurements: precipitation and humidity follow the original condition; UV follows cloud cover; wind and pressure follow the original high/low spread; visibility follows condition. Forecast temperatures are original shared Celsius rows.' };
}
export function weatherMapPoints(widgets, session, sceneTime) {
  const rows = widgets?.sources.weather ?? [], epoch = weatherSceneEpoch(sceneTime) ?? 0;
  return rows.map((row, index) => {
    const city = weatherCityCatalogue.find(city => city.id === row.id), sample = row.hourly[Math.min(session?.mapIndex ?? 0, Math.max(0, row.hourly.length - 1))] ?? row;
    const metrics = weatherMetrics({ ...row, condition: sample.condition });
    return { row, x: city?.x ?? 80 + index % 7 * 65, y: city?.y ?? 100 + Math.floor(index / 7) * 24,
      temperature: sample.temperature, condition: sample.condition, metrics, at: epoch + (sample.offsetHours ?? 0) * 3600000 };
  });
}
export function weatherForecastChart(row, unit = 'celsius') {
  const values = row?.hourly ?? [];
  if (!values.length) return { path: '', points: [] };
  const low = Math.min(...values.map(item => item.temperature)), high = Math.max(...values.map(item => item.temperature));
  const points = values.map((item, index) => ({ ...item, x: 12 + index / Math.max(1, values.length - 1) * 476, y: 118 - (item.temperature - low) / Math.max(1, high - low) * 90, label: `${weatherTemperature(item.temperature, unit)}°` }));
  return { path: points.map((item, index) => `${index ? 'L' : 'M'}${item.x},${item.y}`).join(' '), points };
}

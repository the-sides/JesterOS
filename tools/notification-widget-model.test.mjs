import { expect, test } from 'bun:test';
import { getOSProfile, listOSProfiles } from '../frontend/src/os-profiles.js';
import {
  widgetsDefaults, validateWidgetsState, widgetPresentation,
  addWidget, removeWidget, resizeWidget, reorderWidget, configureWidget,
  selectWidgetData,
} from '../frontend/src/notification-widget-model.js';
import { systemDefaults, validateSystemState } from '../frontend/src/system-state.js';
import { clockDefaults, clockSchema } from '../frontend/src/clock-model.js';
import { createRemindersState, reminderWidgetProjection } from '../frontend/src/reminders-state.js';
import { createCalendarState, calendarWidgetProjection } from '../frontend/src/calendar-state.js';
import { seedWeatherSources } from '../frontend/src/weather-app-state.js';

const profile = getOSProfile('macos-golden-gate-27.0.1');
const sceneTime = Date.parse(profile.defaults.sceneTime);
const clock = () => ({ ...clockDefaults(), sceneTime });
const leaf = () => structuredClone(widgetsDefaults(profile));
const reminders = () => createRemindersState(profile);
const calendar = () => createCalendarState(profile);
const projections = () => ({ ...reminderWidgetProjection(reminders()), ...calendarWidgetProjection(calendar()) });
const dateAt = (instant, timeZone) => widgetPresentation(leaf(), {
  id: 'widget-9', kind: 'date', size: 'small', configuration: {},
}, { ...clockDefaults(), timeZone, sceneTime: instant }).date;


test('empty Golden sources and unconfigured widgets stay valid while foreign ids reject', () => {
  const state = leaf();
  state.instances = []; state.sources = { weather: [], stocks: [], clockCities: [] };
  state.selected = { weatherLocationId: null, stockSymbolId: null, clockCityIds: [] };
  expect(validateWidgetsState(state, profile)).toEqual({ ok: true });
  const base = leaf();
  for (const change of [
    value => { value.instances[1].configuration.calendarIds.push('trail-crew'); },
    value => { value.instances[4].configuration.symbolId = 'missing-symbol'; },
    value => { value.instances[5].configuration.cityIds.push('missing-city'); },
    value => { value.instances[5].configuration.cityIds = ['los-angeles', 'los-angeles', 'london', 'tokyo']; },
    value => { value.instances[2].configuration.locationId = 'missing-location'; },
    value => { value.instances[1].size = 'medium-plus'; },
    value => { value.instances[1].kind = 'reminders'; },
    value => { value.selected.stockSymbolId = 'missing-symbol'; },
    value => { value.selected.clockCityIds = ['london', 'london']; },
    value => { value.selected.clockCityIds = ['london', 'tokyo', 'los-angeles', 'new-york', 'london']; },
    value => { value.sources.weather[0].condition = 'sunny-ish'; },
    value => { value.sources.weather[0].timeZone = 'Europe/Berlin'; },
    value => { value.sources.weather[0].hourly.length = 25; },
    value => { value.sources.stocks[0].previousClose = 0; },
    value => { value.sources.stocks[0].previousClose = 0.001; },
    value => { value.sources.stocks[0].currency = 'dollars'; },
    value => { value.nextId = 6; },
    value => { value.instances[0].id = 'widget-6'; },
  ]) {
    const candidate = structuredClone(base); change(candidate);
    const before = structuredClone(candidate);
    expect(validateWidgetsState(candidate, profile).ok).toBe(false);
    expect(candidate).toEqual(before);
  }
});

test('mutations reject closed foreign ids and preserve surviving instances atomically', () => {
  const state = leaf(), before = structuredClone(state);
  const bad = [
    () => configureWidget(state, 'widget-2', { calendarIds: ['missing-calendar'] }, () => true, projections()),
    () => configureWidget(state, 'widget-3', { locationId: 'cedar-creek', unit: 'kelvin' }, () => true),
    () => configureWidget(state, 'widget-6', { cityIds: ['london', 'london', 'tokyo', 'los-angeles', 'new-york'] }, () => true),
    () => configureWidget(state, 'widget-3', { locationId: 'cedar-creek' }, () => true),
    () => resizeWidget(state, 'widget-5', 'large', () => true),
    () => resizeWidget(state, 'widget-1', 'medium', () => true),
    () => reorderWidget(state, 'widget-1', 6, () => true),
    () => selectWidgetData(state, 'widget-2', 'missing-event', () => true, projections()),
    () => selectWidgetData(state, 'widget-3', 'cedar-creek', () => true),
    () => selectWidgetData(state, 'widget-6', 'missing-city', () => true),
    () => selectWidgetData(state, 'widget-1', 'event-1', () => true),
    () => removeWidget(state, 'widget-9', () => true),
    () => addWidget(state, 'stock-watchlist', 'small', () => true),
  ];
  for (const mutate of bad) {
    const result = mutate();
    expect(result.status).toBe('rejected');
    expect(['invalid_arguments', 'not_found']).toContain(result.error.code);
  }
  expect(state).toEqual(before);
});

test('add allocates monotonic ids, removal never reuses them, and sources survive removal', () => {
  const state = leaf();
  const first = addWidget(state, 'clock-city', 'small', () => true);
  expect(first).toEqual({ status: 'applied', target: { widgetId: 'widget-7', kind: 'clock-city', size: 'small', index: 6 } });
  expect(state.nextId).toBe(8);
  const sources = state.sources, selected = state.selected;
  expect(removeWidget(state, 'widget-7', () => true)).toEqual({ status: 'applied', target: { widgetId: 'widget-7', removed: true } });
  expect(state.instances.some(row => row.id === 'widget-7')).toBe(false);
  expect(state.nextId).toBe(8);
  expect(state.sources).toEqual(sources);
  expect(state.selected).toEqual(selected);
  const again = addWidget(state, 'stock-watchlist', 'medium', () => true);
  expect(again.target.widgetId).toBe('widget-8');
  expect(state.instances.map(row => row.id)).toEqual(['widget-1', 'widget-2', 'widget-3', 'widget-4', 'widget-5', 'widget-6', 'widget-8']);
});

test('resize and reorder keep original instance identity and literal configuration data', () => {
  const state = leaf(), original = state.instances[2];
  const calendarConfiguration = structuredClone(state.instances.find(row => row.kind === 'calendar').configuration);
  expect(resizeWidget(state, 'widget-3', 'large', () => true)).toEqual({ status: 'applied', target: { widgetId: 'widget-3', size: 'large' } });
  expect(state.instances[2]).toBe(original);
  expect(original.size).toBe('large');
  expect(resizeWidget(state, 'widget-3', 'large', () => true)).toEqual({ status: 'applied', target: { widgetId: 'widget-3', size: 'large' } });
  expect(state.instances[2]).toBe(original);
  expect(reorderWidget(state, 'widget-3', 0, () => true)).toEqual({ status: 'applied', target: { widgetId: 'widget-3', index: 0 } });
  expect(state.instances[0]).toBe(original);
  expect(state.instances.map(row => row.id)).toEqual(['widget-3', 'widget-1', 'widget-2', 'widget-4', 'widget-5', 'widget-6']);
  expect(reorderWidget(state, 'widget-3', 0, () => true)).toEqual({ status: 'applied', target: { widgetId: 'widget-3', index: 0 } });
  expect(state.instances.map(row => row.id)).toEqual(['widget-3', 'widget-1', 'widget-2', 'widget-4', 'widget-5', 'widget-6']);
  const calendar = state.instances.find(row => row.kind === 'calendar');
  const sourcesBefore = structuredClone(state.sources);
  expect(configureWidget(state, 'widget-2', { calendarIds: ['volunteers'] }, () => true, projections()).target.configuration)
    .toEqual({ calendarIds: ['volunteers'] });
  expect(calendar.configuration).toEqual({ calendarIds: ['volunteers'] });
  expect(state.sources).toEqual(sourcesBefore);
  expect(calendarConfiguration).toEqual({ calendarIds: ['trail-crew', 'volunteers'] });
  expect(selectWidgetData(state, 'widget-2', 'event-2', () => true, projections())).toEqual({ status: 'applied', target: { widgetId: 'widget-2', appId: 'calendar', recordId: 'event-2' } });
  expect(Object.hasOwn(state.selected, 'calendarEventId')).toBe(false);
});

test('canonical projections remain live without writable widget domain shadows', () => {
  const state = leaf(), domain = reminders(), events = calendar(), before = structuredClone(state);
  const read = () => ({ ...reminderWidgetProjection(domain), ...calendarWidgetProjection(events) });
  expect(Object.keys(state.sources).sort()).toEqual(['clockCities', 'stocks', 'weather']);
  const task = domain.tasks.find(row => row.listId === 'packing');
  expect(widgetPresentation(state, state.instances[3], clock(), read()).reminders.find(row => row.id === task.id).title).toBe(task.title);
  task.title = 'Canonical edited task'; task.completed = true; task.revision++;
  expect(widgetPresentation(state, state.instances[3], clock(), read()).reminders.find(row => row.id === task.id)).toMatchObject({ title: task.title, completed: true });
  expect(selectWidgetData(state, 'widget-4', task.id, () => true, read()).target).toEqual({ widgetId: 'widget-4', appId: 'reminders', recordId: task.id, listId: 'packing' });
  expect(selectWidgetData(state, 'widget-2', 'event-2', () => true, read()).target.recordId).toBe('event-2');
  expect(state).toEqual(before);
  domain.lists = domain.lists.filter(row => row.id !== 'packing');
  domain.tasks = domain.tasks.filter(row => row.listId !== 'packing');
  expect(widgetPresentation(state, state.instances[3], clock(), read()).reminders).toEqual([]);
  expect(configureWidget(state, 'widget-4', { listId: 'packing' }, () => true, read()).status).toBe('rejected');
  for (const key of ['reminders', 'reminderLists', 'calendars', 'events']) {
    const invalid = leaf(); invalid.sources[key] = [];
    expect(validateWidgetsState(invalid, profile).ok).toBe(false);
  }
});

test('quota refusals and reentrant mutations stay atomic without corrupting the lease', () => {
  const state = leaf(), before = structuredClone(state);
  expect(addWidget(state, 'reminders', 'small', () => false).error.code).toBe('limit_exceeded');
  expect(state).toEqual(before);
  expect(addWidget(state, 'reminders', 'small', () => { throw new Error('quota'); }).error.code).toBe('limit_exceeded');
  expect(state).toEqual(before);
  expect(configureWidget(state, 'widget-3', { locationId: 'cedar-creek', unit: 'fahrenheit' }, () => false).error.code).toBe('limit_exceeded');
  expect(state.instances[2].configuration.unit).toBe('celsius');
  const reentrant = addWidget(state, 'date', 'small', () => addWidget(state, 'date', 'small', () => true).status === 'applied');
  expect(reentrant.status).toBe('rejected');
  expect(state.instances.filter(row => row.kind === 'date')).toHaveLength(2);
  expect(state.nextId).toBe(before.nextId + 1);
  expect(validateWidgetsState(state, profile).ok).toBe(true);
});

test('accessor leaves reject validation and mutations without a single getter read', () => {
  let reads = 0;
  const base = leaf();
  for (const level of ['leaf', 'array', 'instance', 'row', 'config', 'selection']) {
    const candidate = structuredClone(base);
    const [owner, key] = level === 'leaf' ? [candidate, 'instances']
      : level === 'array' ? [candidate.instances, '0']
        : level === 'instance' ? [candidate.instances[0], 'kind']
          : level === 'row' ? [candidate.sources.weather[0], 'name']
            : level === 'config' ? [candidate.instances[2].configuration, 'locationId']
              : [candidate.selected, 'clockCityIds'];
    Object.defineProperty(owner, key, { enumerable: true, get() { reads++; throw new Error('Getter must not run'); } });
    expect(validateWidgetsState(candidate, profile).ok).toBe(false);
    expect(addWidget(candidate, 'date', 'small', () => true).status).toBe('rejected');
    expect(removeWidget(candidate, 'widget-1', () => true).status).toBe('rejected');
    expect(configureWidget(candidate, 'widget-2', { calendarIds: ['trail-crew'] }, () => true).status).toBe('rejected');
    expect(selectWidgetData(candidate, 'widget-2', 'event-1', () => true).status).toBe('rejected');
  }
  expect(reads).toBe(0);
  const sparse = leaf(); sparse.instances.length = 8;
  expect(validateWidgetsState(sparse, profile).ok).toBe(false);
  const sparseForecast = leaf(); sparseForecast.sources.weather[0].hourly.length = 13;
  expect(validateWidgetsState(sparseForecast, profile).ok).toBe(false);
  const frozen = leaf();
  Object.defineProperty(frozen, 'nextId', { value: 7, enumerable: true, writable: false });
  expect(validateWidgetsState(frozen, profile).ok).toBe(true);
});

test('historical profiles share original Weather and Clock sources without inventing editable widget instances', () => {
  for (const historical of listOSProfiles().filter(entry => entry.id !== profile.id)) {
    const empty = widgetsDefaults(historical);
    expect(validateWidgetsState(empty, historical)).toEqual({ ok: true });
    const shared = seedWeatherSources(empty), first = shared.sources.weather[0], hourly = first.hourly;
    expect(validateWidgetsState(shared, historical)).toEqual({ ok: true });
    expect(shared.selected.weatherLocationId).toBe(first.id);
    expect(seedWeatherSources(shared)).toBe(shared);
    expect(shared.sources.weather[0]).toBe(first);
    expect(first.hourly).toBe(hourly);
    expect(shared.instances).toHaveLength(0);
    const cities = shared.sources.clockCities;
    cities.push(...leaf().sources.clockCities);
    shared.selected.clockCityIds.push(...cities.map(city => city.id));
    const originalCity = cities[0];
    expect(validateWidgetsState(shared, historical)).toEqual({ ok: true });
    expect(seedWeatherSources(shared).sources.clockCities).toBe(cities);
    expect(cities[0]).toBe(originalCity);
    const invalidClockSelection = structuredClone(shared);
    invalidClockSelection.selected.clockCityIds[0] = 'missing-clock-city';
    expect(validateWidgetsState(invalidClockSelection, historical).ok).toBe(false);
    const unsupportedCounter = structuredClone(shared);
    unsupportedCounter.nextId = 2;
    expect(validateWidgetsState(unsupportedCounter, historical).ok).toBe(false);
    const invalidSelection = structuredClone(shared);
    invalidSelection.selected.weatherLocationId = 'missing-weather-row';
    expect(validateWidgetsState(invalidSelection, historical).ok).toBe(false);
    const unsupportedStocks = structuredClone(shared);
    unsupportedStocks.sources.stocks.push(leaf().sources.stocks[0]);
    expect(validateWidgetsState(unsupportedStocks, historical).ok).toBe(false);
    const corrupted = structuredClone(empty);
    corrupted.instances.push({ id: 'widget-1', kind: 'date', size: 'small', configuration: {} });
    expect(validateWidgetsState(corrupted, historical).ok).toBe(false);
    expect(corrupted.instances).toHaveLength(1);
  }
  const golden = systemDefaults(profile);
  expect(golden.widgets).toEqual(leaf());
  expect(validateSystemState(structuredClone(golden), profile)).toEqual({ ok: true });
});

test('date presentation follows the scene zone across DST and month bounds', () => {
  const before = dateAt(Date.UTC(2026, 9, 31, 12), 'America/Los_Angeles');
  const after = dateAt(Date.UTC(2026, 10, 1, 12), 'America/Los_Angeles');
  expect(before.weekday).not.toBe(after.weekday);
  expect(before.monthDays).toHaveLength(31);
  expect(after.monthDays).toHaveLength(30);
  expect(dateAt(Date.UTC(2026, 2, 8, 12), 'America/Los_Angeles').label).toContain('March 8, 2026');
  const february = dateAt(Date.UTC(2026, 1, 15), 'UTC');
  expect(february.monthDays).toHaveLength(28);
  expect(february.monthDays.at(-1).day).toBe(28);
  expect(february.monthDays.filter(row => row.today)).toHaveLength(1);
  const leap = dateAt(Date.UTC(2028, 1, 29), 'UTC');
  expect(leap.monthDays).toHaveLength(29);
  const edge = dateAt(8_640_000_000_000_000 - 1, 'UTC');
  expect(typeof edge.label).toBe('string');
  expect(edge.monthDays.every(row => row.day >= 1)).toBe(true);
  const december = dateAt(Date.UTC(2026, 11, 31), 'UTC');
  expect(december.monthDays).toHaveLength(31);
  expect(december.monthDays.at(-1).day).toBe(31);
  expect(widgetPresentation(leaf(), { id: 'widget-9', kind: 'date', size: 'medium', configuration: {} }, clock())).toBe(null);
});

test('month cells derive from civil arithmetic for zero and pre-epoch scenes', () => {
  // Scene instant 0 is 1969-12-31 19:00 in New York: the December 1969 civil month.
  const newYear = dateAt(0, 'America/New_York');
  expect(newYear.year).toBe(1969);
  expect(newYear.month).toBe(12);
  expect(newYear.day).toBe(31);
  expect(newYear.monthDays).toHaveLength(31);
  expect(newYear.monthDays[30]).toEqual({ day: 31, weekday: 3, today: true });
  expect(newYear.monthDays[0]).toEqual({ day: 1, weekday: 1, today: false });
  const epoch = dateAt(0, 'UTC');
  expect(epoch.year).toBe(1970);
  expect(epoch.monthDays).toHaveLength(31);
  expect(epoch.monthDays[0]).toEqual({ day: 1, weekday: 4, today: true });
});

test('temperature conversion and flat stock history stay correct for authored boundary data', () => {
  const state = leaf(), widget = state.instances.find(row => row.kind === 'weather');
  const source = state.sources.weather.find(row => row.id === widget.configuration.locationId);
  source.temperature = 0; source.high = 10; source.low = -10;
  widget.configuration.unit = 'fahrenheit';
  const weather = widgetPresentation(state, widget, clock()).weather;
  expect([weather.temperatureText, weather.highText, weather.lowText]).toEqual(['32°', '50°', '14°']);
  const stockWidget = state.instances.find(row => row.kind === 'stock-symbol');
  const quote = state.sources.stocks.find(row => row.id === stockWidget.configuration.symbolId);
  quote.price = 90; quote.previousClose = 100; quote.history = [5, 5, 5];
  const stock = widgetPresentation(state, stockWidget, clock()).stocks[0];
  expect(stock.change).toBe(-10); expect(stock.percent).toBe(-10);
  const points = stock.points.split(' ').map(pair => pair.split(',').map(Number));
  expect(points.every(([x, y]) => Number.isFinite(x) && x >= 0 && x <= 100 && Number.isFinite(y) && y >= 0 && y <= 40)).toBe(true);
  expect(new Set(points.map(([, y]) => y)).size).toBe(1);
});

test('forecast values remain usable at scene zero and the upper Date boundary in every authored zone', () => {
  const state = leaf(), widget = state.instances.find(row => row.kind === 'weather');
  const source = state.sources.weather.find(row => row.id === widget.configuration.locationId);
  const before = structuredClone(state), maximum = 8_640_000_000_000_000 - 1;
  for (const timeZone of clockSchema.properties.timeZone.enum) {
    source.timeZone = timeZone;
    for (const sceneTime of [0, maximum]) {
      const view = widgetPresentation(state, widget, { ...clockDefaults(), timeZone, sceneTime });
      expect(view).not.toBe(null);
      expect(view.weather.temperature).toBe(source.temperature);
      expect(view.weather.condition).toBe(source.condition);
      expect(view.weather.conditionText.length).toBeGreaterThan(0);
      expect(view.weather.hourly).toHaveLength(source.hourly.length);
      expect(view.weather.daily).toHaveLength(source.daily.length);
      for (const [index, hour] of view.weather.hourly.entries()) {
        expect(hour.temperature).toBe(source.hourly[index].temperature);
        expect(hour.condition).toBe(source.hourly[index].condition);
        expect(hour.temperatureText.length).toBeGreaterThan(0);
        expect(hour.time.length).toBeGreaterThan(0);
        if (sceneTime === maximum && hour.offsetHours > 0) expect(hour.time).toBe(`+${hour.offsetHours} h`);
      }
      for (const [index, day] of view.weather.daily.entries()) {
        expect(day.high).toBe(source.daily[index].high);
        expect(day.low).toBe(source.daily[index].low);
        expect(day.condition).toBe(source.daily[index].condition);
        expect(day.day.length).toBeGreaterThan(0);
        if (sceneTime === maximum && day.offsetDays > 0) expect(day.day).toBe(`+${day.offsetDays} days`);
      }
    }
  }
  source.timeZone = before.sources.weather.find(row => row.id === source.id).timeZone;
  expect(state).toEqual(before);
});


test('configuration owns submitted and returned arrays even across quota callbacks', () => {
  const state = leaf(), widget = state.instances.find(row => row.kind === 'calendar');
  const [first, second] = projections().calendars, submitted = { calendarIds: [first.id] };
  const result = configureWidget(state, widget.id, submitted, () => { submitted.calendarIds[0] = second.id; return true; }, projections());
  expect(result.status).toBe('applied');
  expect(widget.configuration.calendarIds).toEqual([first.id]);
  result.target.configuration.calendarIds.length = 0;
  submitted.calendarIds.push(second.id);
  expect(widget.configuration.calendarIds).toEqual([first.id]);
  expect(validateWidgetsState(state, profile).ok).toBe(true);
});

test('configuration rejects indexed accessors without invoking actor getters', () => {
  const state = leaf(), widget = state.instances.find(row => row.kind === 'calendar'), before = structuredClone(state);
  let reads = 0;
  const ids = [];
  Object.defineProperty(ids, '0', { enumerable: true, get() { reads++; return projections().calendars[0].id; } });
  expect(configureWidget(state, widget.id, { calendarIds: ids }).status).toBe('rejected');
  expect(reads).toBe(0);
  expect(state).toEqual(before);
});

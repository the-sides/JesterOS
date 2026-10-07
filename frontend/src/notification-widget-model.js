import { object, choice, flag } from './command-schema.js';
import { isRecord, rejected } from './feature-commands.js';
import { clockParts, clockSchema } from './clock-model.js';

const MAX_TEXT = 1024 * 1024, MAX_TOTAL_TEXT = 4 * MAX_TEXT;
const MAX_INSTANCES = 64, MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1;
const MAX_TIME = 8_640_000_000_000_000 - 1;

const zones = clockSchema.properties.timeZone.enum;
const conditions = ['sunny', 'partly-cloudy', 'cloudy', 'rain', 'snow', 'storm', 'fog'];
const units = ['celsius', 'fahrenheit'];
const sizes = ['small', 'medium', 'large'];
export const widgetCategories = ['all', 'Calendar', 'Weather', 'Reminders', 'Stocks', 'Clock'];
export const widgetKinds = ['date', 'calendar', 'weather', 'reminders',
  'stock-symbol', 'stock-watchlist', 'clock-city', 'clock-world'];

const forbiddenIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const stringSchema = (maxLength, minLength = 0) => ({ type: 'string', minLength, maxLength });
const idSchema = { ...stringSchema(128, 1), pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
  not: { enum: [...forbiddenIds] } };
const nullableId = { anyOf: [idSchema, { type: 'null' }] };
const idArray = maxItems => ({ type: 'array', maxItems, items: idSchema, uniqueItems: true });
const timeZoneSchema = clockSchema.properties.timeZone;
const conditionSchema = choice(...conditions);
const temperatureSchema = { type: 'number', minimum: -273.15, maximum: 200 };
const priceSchema = { type: 'number', minimum: 0, maximum: 1_000_000_000 };
const amountSchema = { type: 'number', minimum: -1_000_000_000, maximum: 1_000_000_000 };
const timestampSchema = { type: 'integer', minimum: 0, maximum: MAX_TIME };
const offsetHoursSchema = { type: 'integer', minimum: 0, maximum: 24 * 30 };
const offsetDaysSchema = { type: 'integer', minimum: 0, maximum: 365 };

const configurationSchemas = {
  date: object({}),
  calendar: object({ calendarIds: idArray(64) }),
  weather: object({ locationId: nullableId, unit: choice(...units) }),
  reminders: object({ listId: nullableId }),
  'stock-symbol': object({ symbolId: nullableId }),
  'stock-watchlist': object({ symbolIds: idArray(64) }),
  'clock-city': object({ cityId: nullableId }),
  'clock-world': object({ cityIds: idArray(4) }),
};
export const widgetConfigurationSchema = { anyOf: Object.values(configurationSchemas) };

const calendarRow = object({ id: idSchema, name: stringSchema(1024, 1), color: stringSchema(64, 1) });
const eventRow = object({ id: idSchema, calendarId: idSchema, title: stringSchema(1024, 1),
  start: timestampSchema, end: timestampSchema, allDay: flag, location: stringSchema(1024) });
const reminderListRow = object({ id: idSchema, name: stringSchema(1024, 1), color: stringSchema(64, 1) });
const reminderRow = object({ id: idSchema, listId: idSchema, title: stringSchema(1024, 1),
  completed: flag, dueAt: { anyOf: [{ type: 'null' }, timestampSchema] } });
const weatherRow = object({ id: idSchema, name: stringSchema(1024, 1), timeZone: timeZoneSchema,
  temperature: temperatureSchema, condition: conditionSchema, high: temperatureSchema,
  low: temperatureSchema, hourly: { type: 'array', maxItems: 24, items: object({
    offsetHours: offsetHoursSchema, temperature: temperatureSchema, condition: conditionSchema }) },
  daily: { type: 'array', maxItems: 7, items: object({
    offsetDays: offsetDaysSchema, high: temperatureSchema, low: temperatureSchema, condition: conditionSchema }) } });
const stockRow = object({ id: idSchema, symbol: stringSchema(16, 1), name: stringSchema(1024, 1),
  currency: { type: 'string', minLength: 3, maxLength: 3, pattern: '^[A-Za-z]{3}$' }, price: priceSchema,
  previousClose: { type: 'number', minimum: 0.01, maximum: 1_000_000_000 },
  history: { type: 'array', maxItems: 64, items: amountSchema } });
const clockCityRow = object({ id: idSchema, name: stringSchema(1024, 1), timeZone: timeZoneSchema });

export const widgetsSchema = object({
  nextId: { type: 'integer', minimum: 1, maximum: MAX_COUNTER },
  instances: { type: 'array', maxItems: MAX_INSTANCES, items: object({
    id: { type: 'string', pattern: '^widget-[1-9][0-9]*$' },
    kind: choice(...widgetKinds), size: choice(...sizes),
    configuration: widgetConfigurationSchema,
  }) },
  sources: object({
    calendars: { type: 'array', maxItems: 64, items: calendarRow },
    events: { type: 'array', maxItems: 256, items: eventRow },
    reminderLists: { type: 'array', maxItems: 64, items: reminderListRow },
    reminders: { type: 'array', maxItems: 256, items: reminderRow },
    weather: { type: 'array', maxItems: 64, items: weatherRow },
    stocks: { type: 'array', maxItems: 64, items: stockRow },
    clockCities: { type: 'array', maxItems: 64, items: clockCityRow },
  }),
  selected: object({ calendarEventId: nullableId, reminderListId: nullableId,
    weatherLocationId: nullableId, stockSymbolId: nullableId, clockCityIds: idArray(4) }),
});

const hour = 3_600_000, minute = 60_000, day = 24 * hour;

const catalogRow = (kind, category, label, appId, sizes, description) =>
  ({ kind, category, label, appId, sizes, description });
export const widgetCatalog = [
  catalogRow('date', 'Calendar', 'Date', 'calendar', ['small'], 'Shows the scene date in its zone with the literal month overview.'),
  catalogRow('calendar', 'Calendar', 'Calendar', 'calendar', ['small', 'medium', 'large'], 'Lists upcoming events from selected fictional Trail Crew calendars.'),
  catalogRow('weather', 'Weather', 'Weather', 'weather', ['small', 'medium', 'large'], 'Shows current conditions plus a fictional hourly or daily forecast.'),
  catalogRow('reminders', 'Reminders', 'Reminders', 'reminders', ['small', 'medium', 'large'], 'Shows one shared reminder list with real completed toggles.'),
  catalogRow('stock-symbol', 'Stocks', 'Stock Symbol', 'stocks', ['small', 'medium'], 'Shows one fictional symbol with a small price history sparkline.'),
  catalogRow('stock-watchlist', 'Stocks', 'Stock Watchlist', 'stocks', ['medium', 'large'], 'Shows several fictional symbols with sparklines in one widget.'),
  catalogRow('clock-city', 'Clock', 'Clock', 'clock', ['small'], 'Shows one fictional city clock as an analogue dial.'),
  catalogRow('clock-world', 'Clock', 'World Clock', 'clock', ['medium'], 'Shows up to four fictional city clocks side by side.'),
];

const invalid = () => ({ ok: false, message: 'Widgets require a closed plain leaf with at most 64 linked canonical instances, closed source records and linked bounded selection, literal bounded strings, scene timestamps and supported sizes, configurations and zones.' });
const fail = (code, message) => rejected(code, message);
const bounded = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const boundedText = (value, maximum) => typeof value === 'string' && value.length <= maximum;
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !forbiddenIds.has(value);
const zone = value => zones.includes(value);
const conditionValue = value => conditions.includes(value);
const unitValue = value => units.includes(value);
const sizeValue = value => sizes.includes(value);
const descriptorSame = (a, b) => a && b && a.enumerable === b.enumerable && a.configurable === b.configurable
  && a.writable === b.writable && a.value === b.value && a.get === b.get && a.set === b.set;

// Inspect the complete descriptor set before reading any actor-supplied value.
function record(value, required, optional = []) {
  if (!isRecord(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string' || !required.includes(key) && !optional.includes(key)
    || descriptors[key].enumerable !== true || !Object.hasOwn(descriptors[key], 'value'))
    || required.some(key => !Object.hasOwn(descriptors, key))) return null;
  return descriptors;
}
function dense(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), length = descriptors.length;
  if (!length || !Object.hasOwn(length, 'value') || !bounded(length.value, 0, maximum)
    || Reflect.ownKeys(descriptors).length !== length.value + 1) return null;
  for (let index = 0; index < length.value; index++) {
    const field = descriptors[String(index)];
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) return null;
  }
  return descriptors;
}
function capture(value, descriptors) {
  return { value, prototype: Object.getPrototypeOf(value), descriptors };
}
function current(snapshots) {
  try {
    return snapshots.every(({ value, prototype, descriptors }) => Object.getPrototypeOf(value) === prototype
      && Reflect.ownKeys(value).length === Reflect.ownKeys(descriptors).length
      && Reflect.ownKeys(descriptors).every(key => descriptorSame(Object.getOwnPropertyDescriptor(value, key), descriptors[key])));
  } catch { return false; }
}

function inspect(state) {
  const fields = record(state, ['nextId', 'instances', 'sources', 'selected']);
  if (!fields || !bounded(fields.nextId.value, 1, MAX_COUNTER)) return null;
  const instances = fields.instances.value, list = dense(instances, MAX_INSTANCES);
  const sourceFields = record(fields.sources.value,
    ['calendars', 'events', 'reminderLists', 'reminders', 'weather', 'stocks', 'clockCities']);
  const selection = record(fields.selected.value,
    ['calendarEventId', 'reminderListId', 'weatherLocationId', 'stockSymbolId', 'clockCityIds']);
  if (!list || !sourceFields || !selection) return null;
  const definitions = [
    ['calendars', sourceFields.calendars.value, 64, calendarRow],
    ['events', sourceFields.events.value, 256, eventRow],
    ['reminderLists', sourceFields.reminderLists.value, 64, reminderListRow],
    ['reminders', sourceFields.reminders.value, 256, reminderRow],
    ['weather', sourceFields.weather.value, 64, weatherRow],
    ['stocks', sourceFields.stocks.value, 64, stockRow],
    ['clockCities', sourceFields.clockCities.value, 64, clockCityRow],
  ].map(([key, rows, limit, row]) => {
    const descriptors = dense(rows, limit);
    return descriptors === null ? null : { key, rows, descriptors, row, values: [] };
  });
  if (definitions.some(entry => entry === null)) return null;
  const snapshots = [capture(state, fields), capture(instances, list),
    capture(fields.sources.value, sourceFields), capture(fields.selected.value, selection),
    capture(selection.clockCityIds.value, dense(selection.clockCityIds.value, 4))];
  if (snapshots[4].descriptors === null) return null;
  const sweeps = [];
  for (let index = 0; index < list.length.value; index++) {
    const instance = list[String(index)].value, data = record(instance, ['id', 'kind', 'size', 'configuration']);
    if (!data) return null;
    const ordinal = /^widget-([1-9][0-9]*)$/.exec(data.id.value);
    if (!ordinal || !bounded(Number(ordinal[1]), 1, MAX_COUNTER) || Number(ordinal[1]) >= fields.nextId.value
      || !widgetKinds.includes(data.kind.value) || !kindSizes(data.kind.value).includes(data.size.value))
      return null;
    const kind = data.kind.value, configuration = record(data.configuration.value,
      Object.keys(configurationSchemas[kind].properties));
    if (!configuration) return null;
    const groups = {};
    for (const [key, schema] of Object.entries(configurationSchemas[kind].properties))
      if (Array.isArray(schema.items) || schema.items?.type === 'string') {
        const group = dense(configuration[key].value, key === 'cityIds' ? 4 : 64);
        if (!group) return null;
        groups[key] = group;
        snapshots.push(capture(configuration[key].value, group));
      }
    sweeps.push({ data, kind, size: data.size.value, configuration, groups });
    snapshots.push(capture(instance, data), capture(data.configuration.value, configuration));
  }
  for (const entry of definitions) {
    snapshots.push(capture(entry.rows, entry.descriptors));
    for (let index = 0; index < entry.descriptors.length.value; index++) {
      const row = entry.descriptors[String(index)].value;
      const data = record(row, Object.keys(entry.row.properties));
      if (!data) return null;
      entry.values.push(data);
      snapshots.push(capture(row, data));
      if (entry.key === 'weather') for (const key of ['hourly', 'daily']) {
        const group = dense(data[key].value, key === 'hourly' ? 24 : 7);
        if (!group) return null;
        snapshots.push(capture(data[key].value, group));
        for (let item = 0; item < group.length.value; item++) {
          const inner = group[String(item)].value, innerKeys = key === 'hourly'
            ? ['offsetHours', 'temperature', 'condition'] : ['offsetDays', 'high', 'low', 'condition'];
          const innerData = record(inner, innerKeys);
          if (!innerData) return null;
          snapshots.push(capture(inner, innerData));
        }
      }
      if (entry.key === 'stocks') {
        const history = dense(data.history.value, 64);
        if (!history) return null;
        snapshots.push(capture(data.history.value, history));
      }
    }
  }
  // Every array, record and nested row is now a validated dense data property;
  // ordinary reads below can no longer reach an actor accessor or sparse slot.
  let units = 'nextId'.length + 'instances'.length + 'sources'.length + 'selected'.length
    + 'calendars'.length + 'events'.length + 'reminderLists'.length + 'reminders'.length
    + 'weather'.length + 'stocks'.length + 'clockCities'.length
    + 'calendarEventId'.length + 'reminderListId'.length + 'weatherLocationId'.length
    + 'stockSymbolId'.length + 'clockCityIds'.length;
  for (const value of Object.values(selection)) {
    if (typeof value.value === 'string') units += value.value.length;
    else if (Array.isArray(value.value)) {
      for (let index = 0; index < value.value.length; index++) units += String(index).length + value.value[index].length;
    }
  }
  const allocations = new Set();
  for (let index = 0; index < sweeps.length; index++) {
    const sweep = sweeps[index], instance = list[String(index)].value;
    if (allocations.has(instance.id)) return null;
    allocations.add(instance.id);
    units += String(index).length + ['id', 'kind', 'size', 'configuration'].reduce((total, key) => total + key.length, 0);
    for (const key of ['id', 'kind', 'size']) units += sweep.data[key].value.length;
    for (const [key, group] of Object.entries(sweep.groups)) {
      units += key.length;
      for (let item = 0; item < group.length.value; item++) units += String(item).length + group[String(item)].value.length;
    }
    if (units > MAX_TOTAL_TEXT || !Number.isFinite(units)) return null;
  }
  for (const entry of definitions) {
    const keys = Object.keys(entry.row.properties), ids = new Set();
    for (let index = 0; index < entry.values.length; index++) {
      const data = entry.values[index], id = data.id.value;
      if (!validId(id) || ids.has(id)) return null;
      ids.add(id);
      units += String(index).length + 'id'.length + id.length;
      for (const key of keys) {
        const value = data[key].value;
        if (key === 'id') continue;
        if (typeof value === 'string') units += key.length + value.length;
        else if (key === 'hourly' || key === 'daily') {
          units += key.length;
          for (let item = 0; item < value.length; item++) {
            units += String(item).length;
            for (const inner of key === 'hourly'
              ? ['offsetHours', 'temperature', 'condition'] : ['offsetDays', 'high', 'low', 'condition'])
              units += inner.length;
          }
        } else if (key === 'history') units += key.length;
        if (!(units <= MAX_TOTAL_TEXT)) return null;
      }
    }
    entry.ids = ids;
  }
  return { state, fields, list, selection, definitions, snapshots, sweeps, units, nextId: fields.nextId.value,
    instances, sourceRows: Object.fromEntries(definitions.map(entry => [entry.key, entry.rows])),
    sourceIds: Object.fromEntries(definitions.map(entry => [entry.key, entry.ids])) };
}

function validRowValues(entry, data, sourceIds) {
  for (const [field, descriptor] of Object.entries(data)) {
    const raw = descriptor.value;
    switch (field) {
      case 'id': break;
      case 'name': case 'title':
        if (!(typeof raw === 'string' && raw.length > 0 && raw.length <= 1024 && /\S/u.test(raw))) return false;
        break;
      case 'color':
        if (!boundedText(raw, 64)) return false;
        break;
      case 'location':
        if (!boundedText(raw, 1024)) return false;
        break;
      case 'symbol':
        if (!(typeof raw === 'string' && raw.length > 0 && raw.length <= 16 && /\S/u.test(raw))) return false;
        break;
      case 'calendarId':
        if (!sourceIds.calendars.has(raw)) return false;
        break;
      case 'listId':
        if (!sourceIds.reminderLists.has(raw)) return false;
        break;
      case 'start': case 'end': case 'dueAt':
        if (field === 'dueAt' && raw === null) break;
        if (!bounded(raw, 0, MAX_TIME)) return false;
        if (field === 'end' && raw < data.start.value) return false;
        break;
      case 'allDay': case 'completed':
        if (typeof raw !== 'boolean') return false;
        break;
      case 'timeZone':
        if (!zone(raw)) return false;
        break;
      case 'temperature': case 'high': case 'low':
        if (!(typeof raw === 'number' && Number.isFinite(raw) && raw >= -273.15 && raw <= 200)) return false;
        break;
      case 'condition':
        if (!conditionValue(raw)) return false;
        break;
      case 'hourly': case 'daily': {
        const keys = field === 'hourly' ? ['offsetHours', 'temperature', 'condition'] : ['offsetDays', 'high', 'low', 'condition'];
        if (raw.length > (field === 'hourly' ? 24 : 7)) return false;
        for (const cell of raw) {
          if (!isRecord(cell) || Reflect.ownKeys(cell).length !== keys.length) return false;
          for (const inner of keys) {
            const descriptor = Object.getOwnPropertyDescriptor(cell, inner);
            if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return false;
            const value = descriptor.value;
            if (inner === 'condition') { if (!conditionValue(value)) return false; }
            else if (inner === 'offsetHours') { if (!bounded(value, 0, 24 * 30)) return false; }
            else if (inner === 'offsetDays') { if (!bounded(value, 0, 365)) return false; }
            else if (!(typeof value === 'number' && Number.isFinite(value)
              && value >= -273.15 && value <= 200)) return false;
          }
        }
        break;
      }
      case 'currency':
        if (!(typeof raw === 'string' && /^[A-Za-z]{3}$/.test(raw))) return false;
        break;
      case 'price':
        if (!(typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1_000_000_000)) return false;
        break;
      case 'previousClose':
        if (!(typeof raw === 'number' && Number.isFinite(raw) && raw >= 0.01 && raw <= 1_000_000_000)) return false;
        break;
      case 'history':
        if (raw.length > 64) return false;
        for (const amount of raw) if (!(typeof amount === 'number' && Number.isFinite(amount)
          && amount >= -1_000_000_000 && amount <= 1_000_000_000)) return false;
        break;
      default: return false;
    }
  }
  return entry.key === 'events' ? data.end.value >= data.start.value : true;
}

function validConfiguration(kind, configuration, sourceIds) {
  for (const [key, value] of Object.entries(configuration)) {
    if (key === 'calendarIds' || key === 'symbolIds' || key === 'cityIds') {
      if (!Array.isArray(value) || new Set(value).size !== value.length
        || value.length > (key === 'cityIds' ? 4 : 64)) return false;
      const table = key === 'calendarIds' ? 'calendars' : key === 'symbolIds' ? 'stocks' : 'clockCities';
      for (const id of value) if (!sourceIds[table].has(id)) return false;
    } else if (key === 'unit') {
      if (!unitValue(value)) return false;
    } else if (value !== null) {
      const table = key === 'locationId' ? 'weather' : key === 'listId' ? 'reminderLists'
        : key === 'symbolId' ? 'stocks' : 'clockCities';
      if (!sourceIds[table].has(value)) return false;
    }
  }
  return true;
}

export function validateWidgetsState(state, profile) {
  try {
    const original = inspect(state);
    if (!original) return invalid();
    const isGolden = profile === undefined || profile?.id === 'macos-golden-gate-27.0.1'
      && profile?.capabilities?.includes('shell.notification-widgets') === true;
    if (!isGolden && (original.instances.length || original.nextId !== 1
      || original.definitions.some(entry => entry.values.length))) return invalid();
    for (const sweep of original.sweeps) {
      const configuration = Object.fromEntries(Object.entries(sweep.configuration)
        .map(([key, value]) => [key, value.value]));
      if (!validConfiguration(sweep.kind, configuration, original.sourceIds)) return invalid();
    }
    for (const entry of original.definitions) {
      for (let index = 0; index < entry.values.length; index++)
        if (!validRowValues(entry, entry.values[index], original.sourceIds)) return invalid();
    }
    const selected = original.selection;
    if (selected.calendarEventId.value !== null && !original.sourceIds.events.has(selected.calendarEventId.value)) return invalid();
    if (selected.reminderListId.value !== null && !original.sourceIds.reminderLists.has(selected.reminderListId.value)) return invalid();
    if (selected.weatherLocationId.value !== null && !original.sourceIds.weather.has(selected.weatherLocationId.value)) return invalid();
    if (selected.stockSymbolId.value !== null && !original.sourceIds.stocks.has(selected.stockSymbolId.value)) return invalid();
    if (selected.clockCityIds.value.length > 4
      || new Set(selected.clockCityIds.value).size !== selected.clockCityIds.value.length) return invalid();
    for (const id of selected.clockCityIds.value)
      if (!original.sourceIds.clockCities.has(id)) return invalid();
    if (!(original.units <= MAX_TOTAL_TEXT)) return invalid();
    return { ok: true };
  } catch { return invalid(); }
}

const emptyLeaf = () => ({ nextId: 1, instances: [],
  sources: { calendars: [], events: [], reminderLists: [], reminders: [], weather: [], stocks: [], clockCities: [] },
  selected: { calendarEventId: null, reminderListId: null, weatherLocationId: null, stockSymbolId: null, clockCityIds: [] } });
export function widgetsDefaults(profile) {
  if (profile?.id !== 'macos-golden-gate-27.0.1' || !profile.capabilities?.includes('shell.notification-widgets'))
    return emptyLeaf();
  const raw = profile.defaults.sceneTime, sceneTime = typeof raw === 'number' ? raw : Date.parse(raw);
  if (!Number.isSafeInteger(sceneTime) || sceneTime < 0 || sceneTime > MAX_TIME) return emptyLeaf();
  const calendars = [
    { id: 'trail-crew', name: 'Trail Crew', color: '#c47f17' },
    { id: 'volunteers', name: 'Volunteers', color: '#3b7bbf' },
  ];
  const events = [
    { id: 'event-1', calendarId: 'trail-crew', title: 'Trail map review',
      start: sceneTime + 19 * hour, end: sceneTime + 20 * hour + 30 * minute, allDay: false, location: 'Ranger station' },
    { id: 'event-2', calendarId: 'volunteers', title: 'Bridge inspection',
      start: sceneTime + 29 * hour + 49 * minute, end: sceneTime + 30 * hour + 34 * minute, allDay: false, location: 'Cedar Creek' },
    { id: 'event-3', calendarId: 'trail-crew', title: 'Volunteer signup closes',
      start: sceneTime + 55 * hour + 19 * minute, end: sceneTime + 62 * hour + 19 * minute, allDay: false, location: 'Trailhead kiosk' },
  ];
  const reminderLists = [
    { id: 'packing', name: 'Packing', color: '#c47f17' },
    { id: 'maintenance', name: 'Maintenance', color: '#3b7bbf' },
  ];
  const reminders = [
    { id: 'reminder-1', listId: 'packing', title: 'Bring map pouch', completed: false, dueAt: sceneTime + 31 * hour + 19 * minute },
    { id: 'reminder-2', listId: 'packing', title: 'Fill water bottles', completed: false, dueAt: null },
    { id: 'reminder-3', listId: 'packing', title: 'Return borrowed trekking poles', completed: true, dueAt: sceneTime + 7 * hour + 19 * minute },
    { id: 'reminder-4', listId: 'maintenance', title: 'Check bridge planks', completed: false, dueAt: sceneTime + 23 * hour + 19 * minute },
    { id: 'reminder-5', listId: 'maintenance', title: 'Restock first-aid kit', completed: false, dueAt: null },
  ];
  const weather = [
    { id: 'pine-valley', name: 'Pine Valley', timeZone: 'America/Los_Angeles', temperature: 22, condition: 'sunny', high: 26, low: 14,
      hourly: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(offset => ({
        offsetHours: offset, temperature: 22 - offset, condition: offset < 6 ? 'sunny' : 'cloudy' })),
      daily: [0, 1, 2, 3, 4, 5, 6].map(offset => ({
        offsetDays: offset, high: 26 - offset, low: 14 - offset, condition: ['sunny', 'partly-cloudy', 'cloudy', 'rain', 'snow', 'storm', 'fog'][offset] })) },
    { id: 'cedar-creek', name: 'Cedar Creek', timeZone: 'America/New_York', temperature: 18, condition: 'partly-cloudy', high: 21, low: 12,
      hourly: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(offset => ({
        offsetHours: offset, temperature: 18 - offset, condition: offset < 4 ? 'partly-cloudy' : 'fog' })),
      daily: [0, 1, 2, 3, 4, 5, 6].map(offset => ({
        offsetDays: offset, high: 21 - offset, low: 12 - offset, condition: ['partly-cloudy', 'sunny', 'rain', 'cloudy', 'fog', 'snow', 'storm'][offset] })) },
  ];
  const stocks = [
    { id: 'acme', symbol: 'ACME', name: 'Acme Trail Supply', currency: 'USD', price: 142.75, previousClose: 140.20,
      history: [138.4, 139.2, 137.8, 138.9, 140.1, 139.6, 141.2, 140.8, 142.0, 141.5, 142.75] },
    { id: 'trailhead', symbol: 'TRAIL', name: 'Trailhead Outfitters', currency: 'USD', price: 87.5, previousClose: 89.1,
      history: [90.1, 89.8, 90.3, 89.9, 89.4, 89.0, 88.7, 88.2, 88.0, 87.8, 87.5] },
  ];
  const clockCities = [
    { id: 'los-angeles', name: 'Los Angeles', timeZone: 'America/Los_Angeles' },
    { id: 'new-york', name: 'New York', timeZone: 'America/New_York' },
    { id: 'london', name: 'London', timeZone: 'Europe/London' },
    { id: 'tokyo', name: 'Tokyo', timeZone: 'Asia/Tokyo' },
  ];
  const instances = [
    { id: 'widget-1', kind: 'date', size: 'small', configuration: {} },
    { id: 'widget-2', kind: 'calendar', size: 'medium', configuration: { calendarIds: ['trail-crew', 'volunteers'] } },
    { id: 'widget-3', kind: 'weather', size: 'medium', configuration: { locationId: 'pine-valley', unit: 'celsius' } },
    { id: 'widget-4', kind: 'reminders', size: 'medium', configuration: { listId: 'packing' } },
    { id: 'widget-5', kind: 'stock-symbol', size: 'small', configuration: { symbolId: 'acme' } },
    { id: 'widget-6', kind: 'clock-world', size: 'medium', configuration: { cityIds: ['los-angeles', 'new-york', 'london', 'tokyo'] } },
  ];
  return { nextId: 7, instances,
    sources: { calendars, events, reminderLists, reminders, weather, stocks, clockCities },
    selected: { calendarEventId: 'event-1', reminderListId: 'packing', weatherLocationId: 'pine-valley',
      stockSymbolId: 'acme', clockCityIds: ['los-angeles', 'new-york', 'london', 'tokyo'] } };
}

function kindSizes(kind) {
  return widgetCatalog.find(entry => entry.kind === kind).sizes;
}
function configurationFor(kind, sourceRows) {
  switch (kind) {
    case 'calendar': return { calendarIds: sourceRows.calendars.map(row => row.id) };
    case 'weather': return { locationId: sourceRows.weather[0]?.id ?? null, unit: 'celsius' };
    case 'reminders': return { listId: sourceRows.reminderLists[0]?.id ?? null };
    case 'stock-symbol': return { symbolId: sourceRows.stocks[0]?.id ?? null };
    case 'stock-watchlist': return { symbolIds: sourceRows.stocks.map(row => row.id) };
    case 'clock-city': return { cityId: sourceRows.clockCities[0]?.id ?? null };
    case 'clock-world': return { cityIds: sourceRows.clockCities.slice(0, 4).map(row => row.id) };
    default: return {};
  }
}
function configurationUnits(configuration) {
  let units = 0;
  for (const [key, value] of Object.entries(configuration)) {
    units += key.length;
    if (typeof value === 'string') units += value.length;
    else if (Array.isArray(value)) for (let index = 0; index < value.length; index++) units += String(index).length + value[index].length;
  }
  return units;
}
function instanceUnits(instance) {
  return 'id'.length + instance.id.length + 'kind'.length + instance.kind.length
    + 'size'.length + instance.size.length + 'configuration'.length + configurationUnits(instance.configuration);
}
function selectedUnits(selected) {
  return configurationUnits(selected);
}

function mutationState(state) {
  try {
    if (!validateWidgetsState(state).ok) return null;
    // Read only validated data properties before taking the mutation lease.
    // Reactive containers lazily wrap their array and row identities.
    const instances = state.instances;
    for (let index = 0; index < instances.length; index++) void instances[index];
    for (const key of Object.keys(state.sources)) for (const row of state.sources[key]) void row;
    return inspect(state);
  } catch { return null; }
}
function writable(original, keys) {
  return keys.every(key => original.fields[key]?.writable === true);
}
function quotaDecision(canCommit, delta) {
  try { return canCommit(delta) === true; } catch { return false; }
}
function guardSnapshot(original) {
  if (!current(original.snapshots)) return fail('stale_target', 'The original widget state changed during its quota decision.');
  return null;
}

export function addWidget(state, kind, size, canCommit = () => true) {
  try {
    if (!widgetKinds.includes(kind) || !kindSizes(kind).includes(size) || typeof canCommit !== 'function')
      return fail('invalid_arguments', 'Add a supported canonical widget kind and size.');
    const original = mutationState(state);
    if (!original || !writable(original, ['instances', 'nextId']))
      return fail('invalid_arguments', invalid().message);
    if (!current(original.snapshots)) return fail('stale_target', 'The original widget descriptors changed before the quota decision.');
    if (original.instances.length >= MAX_INSTANCES || original.nextId >= MAX_COUNTER)
      return fail('limit_exceeded', 'Widget capacity or the nonreusable allocation counter is exhausted.');
    const instance = { id: `widget-${original.nextId}`, kind, size, configuration: configurationFor(kind, original.sourceRows) };
    const delta = instanceUnits(instance) + String(original.instances.length).length;
    if (!(original.units + delta <= MAX_TOTAL_TEXT))
      return fail('limit_exceeded', 'The complete-scene widget text budget rejected this widget.');
    if (!quotaDecision(canCommit, delta)) return fail('limit_exceeded', 'The widget quota rejected this addition.');
    if (guardSnapshot(original)) return guardSnapshot(original);
    state.instances = [...original.instances, instance]; state.nextId = original.nextId + 1;
    return { status: 'applied', target: { widgetId: instance.id, kind, size, index: original.instances.length } };
  } catch { return fail('invalid_arguments', invalid().message); }
}

export function removeWidget(state, widgetId, canCommit = () => true) {
  try {
    if (typeof widgetId !== 'string' || !/^widget-[1-9][0-9]*$/.test(widgetId) || typeof canCommit !== 'function')
      return fail('invalid_arguments', invalid().message);
    const original = mutationState(state);
    if (!original || !writable(original, ['instances']))
      return fail('invalid_arguments', invalid().message);
    if (!current(original.snapshots)) return fail('stale_target', 'The original widget descriptors changed before the quota decision.');
    const index = original.instances.findIndex(entry => entry.id === widgetId);
    if (index < 0) return fail('not_found', 'The original widget no longer exists.');
    if (!quotaDecision(canCommit, -instanceUnits(original.instances[index])))
      return fail('limit_exceeded', 'The widget quota rejected this removal.');
    if (guardSnapshot(original)) return guardSnapshot(original);
    state.instances = original.instances.filter(entry => entry.id !== widgetId);
    return { status: 'applied', target: { widgetId, removed: true } };
  } catch { return fail('invalid_arguments', invalid().message); }
}

export function resizeWidget(state, widgetId, size, canCommit = () => true) {
  try {
    if (typeof widgetId !== 'string' || !sizeValue(size) || typeof canCommit !== 'function')
      return fail('invalid_arguments', invalid().message);
    const original = mutationState(state);
    if (!original || !writable(original, ['instances']))
      return fail('invalid_arguments', invalid().message);
    if (!current(original.snapshots)) return fail('stale_target', 'The original widget descriptors changed before the quota decision.');
    const index = original.instances.findIndex(entry => entry.id === widgetId);
    if (index < 0) return fail('not_found', 'The original widget no longer exists.');
    const instance = original.instances[index];
    if (!kindSizes(instance.kind).includes(size)) return fail('invalid_arguments', 'Use a supported widget size.');
    if (instance.size === size) return { status: 'applied', target: { widgetId, size } };
    if (!quotaDecision(canCommit, 0)) return fail('limit_exceeded', 'The widget quota rejected this resize.');
    if (guardSnapshot(original)) return guardSnapshot(original);
    instance.size = size;
    return { status: 'applied', target: { widgetId, size } };
  } catch { return fail('invalid_arguments', invalid().message); }
}

export function reorderWidget(state, widgetId, index, canCommit = () => true) {
  try {
    if (typeof widgetId !== 'string' || !/^widget-[1-9][0-9]*$/.test(widgetId)
      || !bounded(index, 0, MAX_INSTANCES - 1) || typeof canCommit !== 'function')
      return fail('invalid_arguments', invalid().message);
    const original = mutationState(state);
    if (!original || !writable(original, ['instances']))
      return fail('invalid_arguments', invalid().message);
    if (!current(original.snapshots)) return fail('stale_target', 'The original widget descriptors changed before the quota decision.');
    const at = original.instances.findIndex(entry => entry.id === widgetId);
    if (at < 0) return fail('not_found', 'The original widget no longer exists.');
    if (index >= original.instances.length) return fail('invalid_arguments', 'Reorder inside the existing widget list.');
    if (!quotaDecision(canCommit, 0)) return fail('limit_exceeded', 'The widget quota rejected this reorder.');
    if (guardSnapshot(original)) return guardSnapshot(original);
    if (at === index) return { status: 'applied', target: { widgetId, index } };
    const remaining = original.instances.filter(entry => entry.id !== widgetId);
    state.instances = [...remaining.slice(0, index), original.instances[at], ...remaining.slice(index)];
    return { status: 'applied', target: { widgetId, index } };
  } catch { return fail('invalid_arguments', invalid().message); }
}

export function configureWidget(state, widgetId, configuration, canCommit = () => true) {
  try {
    if (typeof widgetId !== 'string' || !isRecord(configuration) || typeof canCommit !== 'function')
      return fail('invalid_arguments', invalid().message);
    const original = mutationState(state);
    if (!original || !writable(original, ['instances']))
      return fail('invalid_arguments', invalid().message);
    if (!current(original.snapshots)) return fail('stale_target', 'The original widget descriptors changed before the quota decision.');
    const index = original.instances.findIndex(entry => entry.id === widgetId);
    if (index < 0) return fail('not_found', 'The original widget no longer exists.');
    const instance = original.instances[index], kind = instance.kind;
    const properties = Object.keys(configurationSchemas[kind].properties);
    const descriptors = record(configuration, properties);
    if (!descriptors) return fail('invalid_arguments', invalid().message);
    const literal = {};
    for (const key of properties) {
      const value = descriptors[key].value;
      if (['calendarIds', 'symbolIds', 'cityIds'].includes(key)) {
        const items = dense(value, key === 'cityIds' ? 4 : 64);
        if (!items) return fail('invalid_arguments', invalid().message);
        const ids = Array.from({ length: items.length.value }, (_, index) => items[String(index)].value);
        if (!ids.every(validId)) return fail('invalid_arguments', invalid().message);
        literal[key] = ids;
      } else literal[key] = value;
    }
    if (!validConfiguration(kind, literal, original.sourceIds))
      return fail('invalid_arguments', 'Configure only real canonical source rows.');
    const delta = configurationUnits(literal) - configurationUnits(instance.configuration);
    if (!(original.units + delta <= MAX_TOTAL_TEXT))
      return fail('limit_exceeded', 'The complete-scene widget text budget rejected this configuration.');
    if (!quotaDecision(canCommit, delta)) return fail('limit_exceeded', 'The widget quota rejected this configuration.');
    if (guardSnapshot(original)) return guardSnapshot(original);
    instance.configuration = literal;
    return { status: 'applied', target: { widgetId, configuration: Object.fromEntries(Object.entries(literal)
      .map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])) } };
  } catch { return fail('invalid_arguments', invalid().message); }
}

export function setWidgetReminderCompleted(state, reminderId, completed, canCommit = () => true) {
  try {
    if (typeof reminderId !== 'string' || !validId(reminderId) || typeof completed !== 'boolean'
      || typeof canCommit !== 'function') return fail('invalid_arguments', invalid().message);
    const original = mutationState(state);
    if (!original || !writable(original, ['sources']))
      return fail('invalid_arguments', invalid().message);
    if (!current(original.snapshots)) return fail('stale_target', 'The original widget descriptors changed before the quota decision.');
    const rows = original.sourceRows.reminders, at = rows.findIndex(row => row.id === reminderId);
    if (at < 0) return fail('not_found', 'The original reminder no longer exists.');
    if (!quotaDecision(canCommit, 0)) return fail('limit_exceeded', 'The widget quota rejected this completion.');
    if (guardSnapshot(original)) return guardSnapshot(original);
    rows[at].completed = completed;
    return { status: 'applied', target: { reminderId, completed } };
  } catch { return fail('invalid_arguments', invalid().message); }
}

export function selectWidgetData(state, widgetId, recordId, canCommit = () => true) {
  try {
    if (typeof widgetId !== 'string' || !/^widget-[1-9][0-9]*$/.test(widgetId)
      || recordId !== null && (typeof recordId !== 'string' || recordId.length === 0)
      || typeof canCommit !== 'function') return fail('invalid_arguments', invalid().message);
    const original = mutationState(state);
    if (!original || !writable(original, ['selected']))
      return fail('invalid_arguments', invalid().message);
    if (!current(original.snapshots)) return fail('stale_target', 'The original widget descriptors changed before the quota decision.');
    const index = original.instances.findIndex(entry => entry.id === widgetId);
    if (index < 0) return fail('not_found', 'The original widget no longer exists.');
    const instance = original.instances[index], { kind } = instance, configuration = instance.configuration;
    const appId = { date: 'calendar', calendar: 'calendar', weather: 'weather', reminders: 'reminders',
      'stock-symbol': 'stocks', 'stock-watchlist': 'stocks', 'clock-city': 'clock', 'clock-world': 'clock' }[kind];
    const { sourceRows } = original;
    if (recordId !== null) {
      if (kind === 'date') return fail('invalid_arguments', 'The date widget overview has no source record.');
      if (kind === 'calendar') {
        if (!configuration.calendarIds.includes(sourceRows.events.find(row => row.id === recordId)?.calendarId))
          return fail('invalid_arguments', 'Select an event from the configured calendar rows.');
      } else if (kind === 'reminders') {
        if (sourceRows.reminders.find(row => row.id === recordId)?.listId !== configuration.listId)
          return fail('invalid_arguments', 'Select a reminder from the configured list.');
      } else if (kind === 'weather') {
        if (configuration.locationId !== recordId) return fail('invalid_arguments', 'Select the configured weather location.');
      } else if (kind === 'stock-symbol') {
        if (configuration.symbolId !== recordId) return fail('invalid_arguments', 'Select the configured stock symbol.');
      } else if (kind === 'stock-watchlist') {
        if (!configuration.symbolIds.includes(recordId)) return fail('invalid_arguments', 'Select a configured watchlist symbol.');
      } else if (kind === 'clock-city') {
        if (configuration.cityId !== recordId) return fail('invalid_arguments', 'Select the configured clock city.');
      } else if (kind === 'clock-world') {
        if (!configuration.cityIds.includes(recordId)) return fail('invalid_arguments', 'Select a configured world clock city.');
      }
    }
    const target = { ...original.state.selected, clockCityIds: [...original.state.selected.clockCityIds] };
    if (kind === 'date') target.calendarEventId = null;
    else if (recordId === null) {
      if (kind === 'calendar') target.calendarEventId = null;
      else if (kind === 'reminders') target.reminderListId = configuration.listId;
      else if (kind === 'weather') target.weatherLocationId = configuration.locationId;
      else if (kind === 'stock-symbol') target.stockSymbolId = configuration.symbolId;
      else if (kind === 'stock-watchlist') target.stockSymbolId = configuration.symbolIds[0] ?? null;
      else if (kind === 'clock-city') target.clockCityIds = configuration.cityId === null ? [] : [configuration.cityId];
      else target.clockCityIds = configuration.cityIds;
    } else if (kind === 'calendar') target.calendarEventId = recordId;
    else if (kind === 'reminders') target.reminderListId = configuration.listId;
    else if (kind === 'weather') target.weatherLocationId = configuration.locationId;
    else if (kind === 'stock-symbol' || kind === 'stock-watchlist') target.stockSymbolId = recordId;
    else if (kind === 'clock-city') target.clockCityIds = [configuration.cityId];
    else target.clockCityIds = configuration.cityIds;
    const delta = selectedUnits(target) - selectedUnits(original.state.selected);
    if (!quotaDecision(canCommit, delta)) return fail('limit_exceeded', 'The widget quota rejected this selection.');
    if (guardSnapshot(original)) return guardSnapshot(original);
    state.selected = target;
    return { status: 'applied', target: { widgetId, appId, recordId } };
  } catch { return fail('invalid_arguments', invalid().message); }
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const formatters = new Map();
function zoneFormatters(timeZone, hour12) {
  const cacheKey = `${timeZone}|${hour12 ? '12' : '24'}`;
  let result = formatters.get(cacheKey);
  if (!result) {
    const make = options => new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { timeZone, ...options });
    result = { time: make({ hour: 'numeric', minute: 'numeric', hour12 }),
      fullDate: make({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      monthLabel: make({ month: 'long' }),
      dayLabel: make({ weekday: 'long' }) };
    formatters.set(cacheKey, result);
  }
  return result;
}

const pad = value => String(value).padStart(2, '0');

/** Ordinary-app detail owners share one canonical data selection scope. */
export const widgetDataApps = ['calendar', 'weather', 'reminders', 'stocks', 'clock'];
export function widgetDataScope(appId, selected) {
  if (!widgetDataApps.includes(appId) || !isRecord(selected)) return null;
  const target = appId === 'calendar' ? selected.calendarEventId : appId === 'reminders' ? selected.reminderListId
    : appId === 'weather' ? selected.weatherLocationId : appId === 'stocks' ? selected.stockSymbolId
      : selected.clockCityIds;
  return JSON.stringify([appId, target]);
}

// Gregorian month lengths with leap-year arithmetic; civil cells never rebuild a
// Date, so year remapping and zone-midnight shifts cannot move a weekday cell.
function monthLength(year, month) {
  return [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function weekdayOf(dayNumber) {
  return weekdays[((dayNumber + 4) % 7 + 7) % 7];
}

function temperatureText(value, unit) {
  const degrees = unit === 'fahrenheit' ? value * 9 / 5 + 32 : value;
  return `${Math.round(degrees)}°`;
}
const conditionLabels = { sunny: 'Sunny', 'partly-cloudy': 'Partly Cloudy', cloudy: 'Cloudy',
  rain: 'Rain', snow: 'Snow', storm: 'Storm', fog: 'Fog' };
const priceText = (value, currency) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
const changeText = value => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(2)}`;

function stockPresentation(row) {
  const change = row.price - row.previousClose, percent = change / row.previousClose * 100;
  const values = row.history, length = values.length;
  const points = (() => {
    if (length === 0) return '';
    const lowest = Math.min(...values), highest = Math.max(...values), range = highest - lowest;
    return values.map((value, index) => `${length === 1 ? 0 : Math.round(index / (length - 1) * 100)},${
      range === 0 ? 20 : 39 - Math.round((value - lowest) / range * 38)}`).join(' ');
  })();
  return { ...row, change, percent, priceText: priceText(row.price, row.currency), changeText: changeText(change), points };
}

function eventPresentation(row, calendars, timeZone, use24Hour) {
  return { ...row, time: row.allDay ? 'All day' : zoneFormatters(timeZone, !use24Hour).time.format(row.start),
    color: calendars.find(entry => entry.id === row.calendarId)?.color ?? null };
}

function reminderPresentation(row, timeZone) {
  return { ...row, dueText: row.dueAt === null ? null : zoneFormatters(timeZone, true).fullDate.format(row.dueAt) };
}

function weatherPresentation(row, unit, sceneTime) {
  const formats = zoneFormatters(row.timeZone, true);
  return { ...row, temperatureText: temperatureText(row.temperature, unit),
    highText: temperatureText(row.high, unit), lowText: temperatureText(row.low, unit),
    conditionText: conditionLabels[row.condition],
    hourly: row.hourly.map(entry => {
      const instant = sceneTime + entry.offsetHours * hour;
      return { ...entry, time: bounded(instant, 0, MAX_TIME)
        ? formats.time.format(instant) : `+${entry.offsetHours} h`,
        temperatureText: temperatureText(entry.temperature, unit) };
    }),
    daily: row.daily.map(entry => {
      const instant = sceneTime + entry.offsetDays * day;
      return { ...entry, day: bounded(instant, 0, MAX_TIME)
        ? formats.dayLabel.format(instant) : `+${entry.offsetDays} days`,
        highText: temperatureText(entry.high, unit), lowText: temperatureText(entry.low, unit) };
    }) };
}

function clockPresentation(row, sceneTime, use24Hour) {
  const parts = clockParts(sceneTime, row.timeZone);
  const display = use24Hour ? `${pad(parts.hour)}:${pad(parts.minute)}`
    : `${parts.hour % 12 || 12}:${pad(parts.minute)} ${parts.hour < 12 ? 'AM' : 'PM'}`;
  return { id: row.id, name: row.name, timeZone: row.timeZone, hour: parts.hour % 12 || 12,
    minute: parts.minute, dayNight: parts.hour >= 6 && parts.hour < 18 ? 'day' : 'night',
    time: display, dateLabel: zoneFormatters(row.timeZone, true).fullDate.format(sceneTime) };
}

export function widgetPresentation(state, instance, clock) {
  try {
    if (!isRecord(state) || !isRecord(instance) || !isRecord(clock) || !widgetKinds.includes(instance.kind)
      || !sizeValue(instance.size) || !kindSizes(instance.kind).includes(instance.size)) return null;
    const timeZone = clock.timeZone, sceneTime = clock.sceneTime, use24Hour = clock.use24Hour === true;
    if (!zone(timeZone) || !bounded(sceneTime, 0, MAX_TIME)) return null;
    const catalog = widgetCatalog.find(entry => entry.kind === instance.kind);
    const presentation = { widgetId: instance.id, kind: instance.kind, size: instance.size,
      appId: catalog.appId, title: catalog.label };
    const configuration = instance.configuration, { sources } = state;
    if (instance.kind === 'date' || instance.kind === 'calendar') {
      const parts = clockParts(sceneTime, timeZone), formats = zoneFormatters(timeZone, !use24Hour);
      const monthDays = [], days = monthLength(parts.year, parts.month);
      for (let civil = 1; civil <= days; civil++) {
        const dayNumber = parts.dayNumber + civil - parts.day;
        monthDays.push({ day: civil, weekday: weekdays.indexOf(weekdayOf(dayNumber)), today: civil === parts.day });
      }
      presentation.date = { year: parts.year, month: parts.month, day: parts.day, weekday: parts.weekday,
        label: formats.fullDate.format(sceneTime), monthLabel: formats.monthLabel.format(sceneTime), monthDays };
    }
    if (instance.kind === 'calendar') {
      presentation.events = sources.events
        .filter(row => configuration.calendarIds.includes(row.calendarId) && row.end >= sceneTime)
        .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1))
        .map(row => eventPresentation(row, sources.calendars, timeZone, use24Hour));
    }
    if (instance.kind === 'reminders') {
      const list = configuration.listId === null ? null
        : sources.reminderLists.find(row => row.id === configuration.listId) ?? null;
      presentation.list = list;
      presentation.reminders = sources.reminders.filter(row => row.listId === configuration.listId)
        .sort((a, b) => Number(a.completed) - Number(b.completed)
          || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || (a.id < b.id ? -1 : 1))
        .map(row => reminderPresentation(row, timeZone));
    }
    if (instance.kind === 'weather') {
      const row = configuration.locationId === null ? null
        : sources.weather.find(entry => entry.id === configuration.locationId) ?? null;
      presentation.weather = row === null ? null : weatherPresentation(row, configuration.unit, sceneTime);
    }
    if (instance.kind === 'stock-symbol') {
      const row = configuration.symbolId === null ? null
        : sources.stocks.find(entry => entry.id === configuration.symbolId) ?? null;
      presentation.stocks = row === null ? [] : [stockPresentation(row)];
    }
    if (instance.kind === 'stock-watchlist') {
      presentation.stocks = configuration.symbolIds
        .map(id => sources.stocks.find(entry => entry.id === id)).filter(Boolean)
        .sort((a, b) => configuration.symbolIds.indexOf(a.id) - configuration.symbolIds.indexOf(b.id))
        .map(row => stockPresentation(row));
    }
    if (instance.kind === 'clock-city' || instance.kind === 'clock-world') {
      const ids = instance.kind === 'clock-city'
        ? (configuration.cityId === null ? [] : [configuration.cityId]) : configuration.cityIds;
      presentation.clocks = ids.map(id => sources.clockCities.find(entry => entry.id === id))
        .filter(Boolean).map(row => clockPresentation(row, sceneTime, use24Hour));
    }
    return presentation;
  } catch { return null; }
}

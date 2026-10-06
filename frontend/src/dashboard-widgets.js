import { choice, empty, object, text } from './command-schema.js';
import { isRecord, rejected } from './feature-commands.js';

// Browser policy: deterministic scene data, basic calculator, and four bounded
// conversion categories. Native full category coverage is not established.
// Forecasts and currency rates are fictional fixtures, never live information.
export const dashboardWidgetTypes = Object.freeze(['clock', 'calculator', 'calendar', 'weather', 'converter']);
export const dashboardCalculatorKeys = Object.freeze([
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.',
  'sign', '%', 'C', 'CE', 'backspace', 'add', 'subtract', 'multiply', 'divide', 'equals',
  'mc', 'mr', 'm+', 'm-',
]);
const clockCities = Object.freeze([
  { id: 'greenwich', label: 'Greenwich', regionId: 'europe', timeZone: 'Etc/UTC' },
  { id: 'san-francisco', label: 'San Francisco', regionId: 'north-america', timeZone: 'America/Los_Angeles' },
  { id: 'new-york', label: 'New York', regionId: 'north-america', timeZone: 'America/New_York' },
  { id: 'london', label: 'London', regionId: 'europe', timeZone: 'Europe/London' },
  { id: 'tokyo', label: 'Tokyo', regionId: 'asia', timeZone: 'Asia/Tokyo' },
  { id: 'sydney', label: 'Sydney', regionId: 'oceania', timeZone: 'Australia/Sydney' },
].map(Object.freeze));
const clockRegions = Object.freeze([
  { id: 'europe', label: 'Europe' },
  { id: 'north-america', label: 'North America' },
  { id: 'asia', label: 'Asia' },
  { id: 'oceania', label: 'Oceania' },
].map(Object.freeze));
const weatherCities = Object.freeze(clockCities.filter(city => ['san-francisco', 'london', 'tokyo'].includes(city.id)));
const weatherUnits = Object.freeze(['celsius', 'fahrenheit']);
const conversionCategories = Object.freeze([
  { id: 'length', label: 'Length', units: [
    { id: 'millimeters', label: 'Millimeters', scale: 0.001 },
    { id: 'centimeters', label: 'Centimeters', scale: 0.01 },
    { id: 'meters', label: 'Meters', scale: 1 },
    { id: 'kilometers', label: 'Kilometers', scale: 1000 },
    { id: 'inches', label: 'Inches', scale: 0.0254 },
    { id: 'feet', label: 'Feet', scale: 0.3048 },
    { id: 'yards', label: 'Yards', scale: 0.9144 },
    { id: 'miles', label: 'Miles', scale: 1609.344 },
  ] },
  { id: 'mass', label: 'Mass', units: [
    { id: 'grams', label: 'Grams', scale: 0.001 },
    { id: 'kilograms', label: 'Kilograms', scale: 1 },
    { id: 'tonnes', label: 'Metric tonnes', scale: 1000 },
    { id: 'ounces', label: 'Ounces', scale: 0.028349523125 },
    { id: 'pounds', label: 'Pounds', scale: 0.45359237 },
  ] },
  { id: 'temp', label: 'Temperature', units: [
    { id: 'celsius', label: 'Celsius', scale: 1, offset: 273.15 },
    { id: 'fahrenheit', label: 'Fahrenheit', scale: 5 / 9, offset: 459.67 * 5 / 9 },
    { id: 'kelvin', label: 'Kelvin', scale: 1, offset: 0 },
  ] },
  // Fixed fictional scene rates: USD 1 = EUR .85 = GBP .76 = JPY 112.
  { id: 'currency', label: 'Currency (fictional rates)', units: [
    { id: 'usd', label: 'US dollar (USD)', scale: 1 },
    { id: 'eur', label: 'Euro (EUR)', scale: 1 / 0.85 },
    { id: 'gbp', label: 'Pound sterling (GBP)', scale: 1 / 0.76 },
    { id: 'jpy', label: 'Japanese yen (JPY)', scale: 1 / 112 },
  ] },
].map(category => Object.freeze({ ...category, units: Object.freeze(category.units.map(Object.freeze)) })));

export const dashboardWidgetCommandSpecs = Object.freeze({
  'dashboard.clock.configure': { type: 'clock', payload: object({ cityId: choice(...clockCities.map(city => city.id)) }) },
  'dashboard.calculator.key': { type: 'calculator', payload: object({ key: choice(...dashboardCalculatorKeys) }) },
  'dashboard.calendar.navigate': { type: 'calendar', payload: object({ months: { type: 'integer', minimum: -1200, maximum: 1200 } }) },
  'dashboard.calendar.select': { type: 'calendar', payload: object({ date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }) },
  'dashboard.calendar.today': { type: 'calendar', payload: empty },
  'dashboard.weather.configure': { type: 'weather', payload: object({ cityId: choice(...weatherCities.map(city => city.id)), unit: choice(...weatherUnits) }) },
  'dashboard.weather.refresh': { type: 'weather', payload: empty },
  'dashboard.converter.change': { type: 'converter', payload: object({
    category: choice(...conversionCategories.map(category => category.id)),
    fromUnit: text, toUnit: text, value: { type: 'string', maxLength: 128 },
  }) },
  'dashboard.converter.swap': { type: 'converter', payload: empty },
});

const DAY = 86400000;
const weekdays = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const monthNames = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
const positions = [[36, 36], [280, 36], [36, 290], [550, 36], [350, 300]];
const operatorSymbols = Object.freeze({ add: '+', subtract: '−', multiply: '×', divide: '÷' });
const formatNumber = value => Number(value.toPrecision(15)).toString();
const pad = (value, length = 2) => String(value).padStart(length, '0');
const dateString = (year, month, day) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
const leapYear = year => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
const monthDays = (year, month) => month === 2 ? (leapYear(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;

// Explicit epochs only: no host clock, and no Date.UTC year-0..99 remapping.
function civilTime(year, month, day) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}
const MIN_TIME = civilTime(1, 1, 1);
const MAX_TIME = civilTime(9999, 12, 31) + DAY - 1;
const validScene = time => Number.isFinite(time) && time >= MIN_TIME && time <= MAX_TIME;
function sceneDate(sceneTime) {
  const date = new Date(sceneTime);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= monthDays(year, month)
    ? { year, month, day } : null;
}
const validId = id => typeof id === 'string' && /^dashboard-widget-[1-9]\d*$/.test(id)
  && Number.isSafeInteger(Number(id.slice('dashboard-widget-'.length)));
const invalid = message => rejected('invalid_arguments', message);

export function dashboardWidgetDefaults(profile) {
  const sceneTime = profile?.renderer === 'high-sierra'
    ? civilTime(2017, 9, 25) + (9 * 60 + 41) * 60000
    : civilTime(2018, 9, 24) + (17 * 60 + 42) * 60000;
  return dashboardWidgetTypes.map((type, index) => createDashboardWidget(type, `dashboard-widget-${index + 1}`, sceneTime, ...positions[index]));
}

export function createDashboardWidget(type, id, sceneTime, x = 0, y = 0) {
  if (!dashboardWidgetTypes.includes(type) || !validId(id) || !validScene(sceneTime)
    || !Number.isFinite(x) || x < 0 || !Number.isFinite(y) || y < 0) {
    throw new TypeError('Invalid Dashboard widget type, identity, scene time, or position.');
  }
  const { year, month, day } = sceneDate(sceneTime);
  let data;
  if (type === 'clock') data = { cityId: 'greenwich' };
  if (type === 'calculator') data = calculatorDefaults();
  if (type === 'calendar') data = { year, month, selectedDate: dateString(year, month, day) };
  if (type === 'weather') data = { cityId: 'san-francisco', unit: 'celsius', updatedAt: sceneTime, refreshCount: 0 };
  if (type === 'converter') data = { category: 'length', fromUnit: 'meters', toUnit: 'feet', value: '1', ...convert('length', 'meters', 'feet', '1') };
  return { id, type, x, y, data };
}

function calculatorDefaults() {
  return { display: '0', accumulator: null, operator: null, fresh: true, entered: false, repeat: null, expression: '', error: null, memory: null };
}
function calculate(a, b, operator) {
  if (operator === 'add') return a + b;
  if (operator === 'subtract') return a - b;
  if (operator === 'multiply') return a * b;
  return a / b;
}
function calculatorValue(data, value, message = 'Arithmetic overflow or invalid result.') {
  if (!Number.isFinite(value)) {
    data.display = 'Error';
    data.error = message;
    data.accumulator = null;
    data.operator = null;
    data.repeat = null;
    data.entered = false;
  } else {
    data.display = formatNumber(value);
    data.error = null;
  }
  data.fresh = true;
}
function calculatorKey(data, key) {
  if (key === 'C') {
    const memory = data.memory;
    Object.assign(data, calculatorDefaults(), { memory });
    return;
  }
  if (key === 'CE') {
    // Error recovery starts a fresh calculation; ordinary CE preserves its operator.
    if (data.error) {
      const memory = data.memory;
      Object.assign(data, calculatorDefaults(), { memory });
    } else {
      data.display = '0';
      data.fresh = true;
      data.entered = false;
    }
    return;
  }
  if (key === 'mc') { data.memory = null; return; }
  if (key === 'mr') {
    calculatorValue(data, data.memory);
    data.entered = true;
    return;
  }
  if (/^\d$/.test(key) || key === '.') {
    if (data.error) {
      const memory = data.memory;
      Object.assign(data, calculatorDefaults(), { memory });
    }
    if (data.fresh) {
      data.display = key === '.' ? '0.' : key;
      data.fresh = false;
      if (!data.operator) { data.repeat = null; data.expression = ''; }
    } else if (key === '.' && !data.display.includes('.')) data.display += '.';
    else if (key !== '.' && data.display.replace(/[-.]/g, '').length < 16) {
      data.display = data.display === '0' ? key : data.display === '-0' ? `-${key}` : data.display + key;
    }
    data.entered = true;
    return;
  }
  const value = Number(data.display);
  if (key === 'backspace') {
    if (!data.fresh) {
      data.display = data.display.slice(0, -1);
      if (!data.display || data.display === '-') data.display = '0';
      data.entered = true;
    }
    return;
  }
  if (key === 'm+' || key === 'm-') {
    const next = (data.memory ?? 0) + (key === 'm+' ? value : -value);
    if (!Number.isFinite(next)) calculatorValue(data, next, 'Memory arithmetic overflow.');
    else { data.memory = next; data.fresh = true; }
    return;
  }
  if (key === 'sign') {
    data.display = data.display.startsWith('-') ? data.display.slice(1) : `-${data.display}`;
    data.entered = true;
    return;
  }
  if (key === '%') {
    const next = data.operator === 'add' || data.operator === 'subtract'
      ? data.accumulator * (value / 100) : value / 100;
    calculatorValue(data, next);
    data.entered = !data.error;
    return;
  }
  if (Object.hasOwn(operatorSymbols, key)) {
    if (data.operator && data.entered) {
      const result = calculate(data.accumulator, value, data.operator);
      calculatorValue(data, result, data.operator === 'divide' && value === 0 ? 'Cannot divide by zero.' : undefined);
      if (data.error) return;
    }
    data.accumulator = Number(data.display);
    data.operator = key;
    data.expression = `${data.display} ${operatorSymbols[key]}`;
    data.fresh = true;
    data.entered = false;
    data.repeat = null;
    return;
  }
  if (key === 'equals') {
    const operator = data.operator ?? data.repeat?.operator;
    if (!operator) { data.fresh = true; return; }
    const a = data.operator ? data.accumulator : value;
    const b = data.operator ? value : data.repeat.value;
    const result = calculate(a, b, operator);
    data.expression = `${formatNumber(a)} ${operatorSymbols[operator]} ${formatNumber(b)} =`;
    calculatorValue(data, result, operator === 'divide' && b === 0 ? 'Cannot divide by zero.' : undefined);
    if (!data.error) {
      data.repeat = { operator, value: b };
      data.accumulator = null;
      data.operator = null;
      data.entered = false;
    }
  }
}

function convert(categoryId, fromId, toId, value) {
  const category = conversionCategories.find(item => item.id === categoryId);
  const from = category.units.find(unit => unit.id === fromId);
  const to = category.units.find(unit => unit.id === toId);
  const input = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(input)) {
    return { result: null, error: 'Enter a valid decimal number.' };
  }
  const number = Number(input);
  if (!Number.isFinite(number)) return { result: null, error: 'Input must be finite.' };
  const base = number * from.scale + (from.offset ?? 0);
  if (categoryId === 'temp' && base < -1e-10) return { result: null, error: 'Temperature cannot be below absolute zero.' };
  const result = categoryId === 'temp'
    ? (Math.max(0, base) - (to.offset ?? 0)) / to.scale
    : fromId === toId ? number : number * (from.scale / to.scale);
  if (!Number.isFinite(result)) return { result: null, error: 'Conversion overflow.' };
  return { result: formatNumber(result), error: null };
}

export function applyDashboardWidgetCommand(widget, command, payload, sceneTime) {
  if (!isRecord(widget) || !validId(widget.id) || !dashboardWidgetTypes.includes(widget.type) || !isRecord(widget.data)) {
    return rejected('not_found', 'The Dashboard widget does not exist.');
  }
  const spec = Object.hasOwn(dashboardWidgetCommandSpecs, command) ? dashboardWidgetCommandSpecs[command] : null;
  if (!spec || spec.type !== widget.type) return invalid('This command does not belong to the widget.');
  if (!validScene(sceneTime)) return invalid('Scene time must be within calendar years 1–9999.');
  const properties = spec.payload.properties;
  if (!isRecord(payload) || Object.keys(payload).some(key => !Object.hasOwn(properties, key))
    || spec.payload.required.some(key => !Object.hasOwn(payload, key))) return invalid('Invalid Dashboard widget payload fields.');
  const data = widget.data;
  if (command === 'dashboard.clock.configure') {
    if (!clockCities.some(city => city.id === payload.cityId)) return invalid('Unknown clock city.');
    data.cityId = payload.cityId;
  } else if (command === 'dashboard.calculator.key') {
    if (!dashboardCalculatorKeys.includes(payload.key)) return invalid('Unknown calculator key.');
    if ((payload.key === 'mr' || payload.key === 'mc') && data.memory === null) return rejected('disabled', 'Calculator memory is empty.');
    if (data.error && !['C', 'CE', 'mc', 'mr', '.', ...'0123456789'].includes(payload.key)) {
      return rejected('disabled', 'Clear the arithmetic error or enter a new number.');
    }
    calculatorKey(data, payload.key);
  } else if (command === 'dashboard.calendar.navigate') {
    if (!Number.isInteger(payload.months) || payload.months < -1200 || payload.months > 1200) return invalid('Calendar month offset must be an integer from −1200 to 1200.');
    const index = (data.year - 1) * 12 + data.month - 1 + payload.months;
    if (index < 0 || index >= 9999 * 12) return invalid('Calendar years must remain within 1–9999.');
    const year = Math.floor(index / 12) + 1;
    const month = index % 12 + 1;
    const selected = parseDate(data.selectedDate);
    data.year = year;
    data.month = month;
    data.selectedDate = dateString(year, month, Math.min(selected.day, monthDays(year, month)));
  } else if (command === 'dashboard.calendar.select') {
    const selected = parseDate(payload.date);
    if (!selected) return invalid('Select a real date within calendar years 1–9999.');
    data.year = selected.year;
    data.month = selected.month;
    data.selectedDate = payload.date;
  } else if (command === 'dashboard.calendar.today') {
    const { year, month, day } = sceneDate(sceneTime);
    data.year = year;
    data.month = month;
    data.selectedDate = dateString(year, month, day);
  } else if (command === 'dashboard.weather.configure') {
    if (!weatherCities.some(city => city.id === payload.cityId) || !weatherUnits.includes(payload.unit)) return invalid('Unknown forecast city or temperature unit.');
    data.cityId = payload.cityId;
    data.unit = payload.unit;
  } else if (command === 'dashboard.weather.refresh') {
    if (!Number.isSafeInteger(data.refreshCount) || data.refreshCount >= Number.MAX_SAFE_INTEGER) return invalid('Forecast refresh counter limit reached.');
    data.updatedAt = sceneTime;
    data.refreshCount += 1;
  } else if (command === 'dashboard.converter.change') {
    const category = conversionCategories.find(item => item.id === payload.category);
    if (!category || !category.units.some(unit => unit.id === payload.fromUnit) || !category.units.some(unit => unit.id === payload.toUnit)) return invalid('Unknown conversion category or unit.');
    if (typeof payload.value !== 'string' || payload.value.length > 128) return invalid('Conversion input must be a string of at most 128 characters.');
    Object.assign(data, payload, convert(payload.category, payload.fromUnit, payload.toUnit, payload.value));
  } else if (command === 'dashboard.converter.swap') {
    const fromUnit = data.toUnit;
    const toUnit = data.fromUnit;
    Object.assign(data, { fromUnit, toUnit }, convert(data.category, fromUnit, toUnit, data.value));
  }
  return { status: 'applied', target: { widgetId: widget.id } };
}

const clockFormatters = new Map();
function cityTime(city, sceneTime) {
  let formatter = clockFormatters.get(city.timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: city.timeZone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    clockFormatters.set(city.timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(sceneTime).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  return {
    ...parts, digital: `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`,
    date: dateString(parts.year, parts.month, parts.day),
    dayNight: parts.hour >= 6 && parts.hour < 18 ? 'day' : 'night',
  };
}
const detachedCities = cities => cities.map(city => ({ ...city }));
const unitOptions = category => category.units.map(({ id, label }) => ({ id, label }));

// Six fixed daily observations per city, reused when the explicit scene date moves.
const forecasts = Object.freeze({
  'san-francisco': { temperature: 18, periods: [[20, 13, 'partly-cloudy'], [21, 14, 'sunny'], [19, 13, 'cloudy'], [18, 12, 'rain'], [20, 13, 'partly-cloudy'], [22, 14, 'sunny']] },
  london: { temperature: 15, periods: [[17, 10, 'cloudy'], [16, 11, 'rain'], [18, 12, 'partly-cloudy'], [19, 11, 'sunny'], [17, 10, 'cloudy'], [16, 9, 'rain']] },
  tokyo: { temperature: 24, periods: [[26, 20, 'partly-cloudy'], [25, 20, 'rain'], [24, 19, 'cloudy'], [27, 21, 'sunny'], [28, 22, 'sunny'], [26, 20, 'partly-cloudy']] },
});
function weatherTargets(data, sceneTime) {
  const city = weatherCities.find(item => item.id === data.cityId);
  const time = cityTime(city, sceneTime);
  const fixture = forecasts[city.id];
  const local = parseDate(time.date);
  // At civil range endpoints a timezone can cross the supported calendar range;
  // forecast labels stay inside it instead of producing year 0 or 10000 dates.
  const start = local ? civilTime(local.year, local.month, local.day) : Math.max(MIN_TIME, Math.min(MAX_TIME, Math.floor(sceneTime / DAY) * DAY));
  const temperature = value => data.unit === 'fahrenheit' ? Number((value * 9 / 5 + 32).toFixed(1)) : value;
  const forecast = fixture.periods.map(([high, low, condition], index) => {
    const epoch = Math.min(civilTime(9999, 12, 31), start + index * DAY);
    const date = sceneDate(epoch);
    return { date: dateString(date.year, date.month, date.day), day: weekdays[new Date(epoch).getUTCDay()], condition, high: temperature(high), low: temperature(low) };
  });
  return {
    cityId: city.id, city: city.label, timeZone: city.timeZone, cities: detachedCities(weatherCities),
    unit: data.unit, units: [...weatherUnits], temperature: temperature(fixture.temperature),
    high: forecast[0].high, low: forecast[0].low, condition: forecast[0].condition,
    dayNight: time.dayNight, forecast, updatedAt: data.updatedAt, refreshCount: data.refreshCount,
    source: 'Fictional offline forecast',
  };
}

export function dashboardWidgetTargets(widget, sceneTime) {
  if (!widget || !validId(widget.id) || !dashboardWidgetTypes.includes(widget.type) || !validScene(sceneTime)) return null;
  const data = widget.data;
  const target = { widgetId: widget.id, type: widget.type };
  if (widget.type === 'clock') {
    const city = clockCities.find(item => item.id === data.cityId);
    const time = cityTime(city, sceneTime);
    return {
      ...target, cityId: city.id, city: city.label, timeZone: city.timeZone, cities: detachedCities(clockCities),
      regionId: city.regionId, regions: clockRegions.map(region => ({ ...region })),
      hour: time.hour, minute: time.minute, second: time.second, digital: time.digital, date: time.date, dayNight: time.dayNight,
      angles: { hour: (time.hour % 12) * 30 + time.minute / 2 + time.second / 120, minute: time.minute * 6 + time.second / 10, second: time.second * 6 },
    };
  }
  if (widget.type === 'calculator') return {
    ...target, display: data.display, expression: data.expression, error: data.error,
    memory: data.memory, memoryAvailable: data.memory !== null, keys: [...dashboardCalculatorKeys],
  };
  if (widget.type === 'calendar') {
    const now = sceneDate(sceneTime);
    const today = dateString(now.year, now.month, now.day);
    const offset = new Date(civilTime(data.year, data.month, 1)).getUTCDay();
    const count = monthDays(data.year, data.month);
    const selected = parseDate(data.selectedDate);
    const days = Array.from({ length: 42 }, (_, index) => {
      const day = index - offset + 1;
      const inMonth = day >= 1 && day <= count;
      const date = inMonth ? dateString(data.year, data.month, day) : null;
      return { date, day: inMonth ? day : null, inMonth, selected: date !== null && date === data.selectedDate, today: date !== null && date === today };
    });
    return {
      ...target, year: data.year, month: data.month, monthLabel: monthNames[data.month - 1], selectedDate: data.selectedDate,
      selectedDay: selected.day, selectedWeekday: weekdays[new Date(civilTime(selected.year, selected.month, selected.day)).getUTCDay()],
      today, weekdays: [...weekdays], days, canPrevious: data.year > 1 || data.month > 1, canNext: data.year < 9999 || data.month < 12,
    };
  }
  if (widget.type === 'weather') return { ...target, ...weatherTargets(data, sceneTime) };
  const category = conversionCategories.find(item => item.id === data.category);
  return {
    ...target, category: data.category, fromUnit: data.fromUnit, toUnit: data.toUnit, value: data.value, result: data.result, error: data.error,
    categories: conversionCategories.map(item => ({ id: item.id, label: item.label, units: unitOptions(item) })), units: unitOptions(category),
    source: data.category === 'currency' ? 'Fixed fictional scene rates: USD 1 = EUR 0.85 = GBP 0.76 = JPY 112.' : 'Browser policy: length, mass, temperature, and fictional currency conversions.',
  };
}

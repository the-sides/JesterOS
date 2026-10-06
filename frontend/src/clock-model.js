import { object, flag, choice } from './command-schema.js';
import { isRecord, rejected } from './feature-commands.js';

const MAX_TIME = 8_640_000_000_000_000 - 1;
const zones = ['UTC', 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];
const menuKeys = ['style', 'showDate', 'showDayOfWeek', 'showAMPM', 'showSeconds'];
export const clockSchema = object({ style: choice('digital', 'analog'), showDate: choice('when-space-allows', 'always', 'never'),
  showDayOfWeek: flag, showAMPM: flag, showSeconds: flag, use24Hour: flag, timeZone: choice(...zones) });
const stateKeys = Object.keys(clockSchema.properties);
export const clockDefaults = () => ({ style: 'digital', showDate: 'never', showDayOfWeek: true,
  showAMPM: true, showSeconds: false, use24Hour: false, timeZone: 'UTC' });
const closedData = (value, keys) => isRecord(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
  });
const invalid = message => rejected('invalid_arguments', message);
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME;
export function validateClockState(state) {
  try {
    if (closedData(state, stateKeys) && ['digital', 'analog'].includes(state.style)
      && ['when-space-allows', 'always', 'never'].includes(state.showDate)
      && ['showDayOfWeek', 'showAMPM', 'showSeconds', 'use24Hour'].every(key => typeof state[key] === 'boolean')
      && zones.includes(state.timeZone)) return { ok: true };
  } catch { /* Unreadable descriptors cannot authorize a transition. */ }
  return { ok: false, message: 'Clock requires complete closed literal display preferences and one authored time zone.' };
}
function transition(state, changes, targetKeys, canCommit) {
  const candidate = { ...state, ...changes }, validation = validateClockState(candidate);
  if (!validation.ok) return invalid(validation.message);
  const keys = Object.keys(changes);
  const descriptors = stateKeys.map(key => Object.getOwnPropertyDescriptor(state, key));
  if (keys.some(key => state[key] !== changes[key] && Object.getOwnPropertyDescriptor(state, key).writable !== true))
    return invalid('Clock changes require writable data properties.');
  if (typeof canCommit !== 'function') return invalid('Expected a synchronous clock text-budget callback.');
  const delta = keys.reduce((total, key) => total + (typeof changes[key] === 'string' ? changes[key].length - state[key].length : 0), 0);
  try {
    if (canCommit(delta) !== true) return rejected('limit_exceeded', 'The Clock change exceeds the scene text budget.');
  } catch { return rejected('limit_exceeded', 'The Clock text-budget decision could not be accepted.'); }
  if (!closedData(state, stateKeys) || stateKeys.some((key, index) => {
    const current = Object.getOwnPropertyDescriptor(state, key), original = descriptors[index];
    return current.value !== original.value || current.writable !== original.writable || current.configurable !== original.configurable;
  })) return rejected('stale_target', 'The Clock state changed during its budget decision.');
  for (const key of keys) if (state[key] !== changes[key]) state[key] = changes[key];
  return { status: 'applied', target: Object.fromEntries(targetKeys.map(key => [key, state[key]])) };
}
export function configureClockMenu(state, payload, canCommit = () => true) {
  const validation = validateClockState(state); if (!validation.ok) return invalid(validation.message);
  try {
    if (!isRecord(payload)) return invalid('Use a nonempty closed subset of Clock menu preferences.');
    const keys = Reflect.ownKeys(payload);
    if (!keys.length || keys.some(key => !menuKeys.includes(key)) || !closedData(payload, keys))
      return invalid('Use a nonempty closed subset of Clock menu preferences.');
    return transition(state, { ...payload }, menuKeys, canCommit);
  } catch { return invalid('Clock menu preferences must be plain data.'); }
}
export function setClockZone(state, timeZone, canCommit = () => true) {
  const validation = validateClockState(state); if (!validation.ok) return invalid(validation.message);
  if (!zones.includes(timeZone)) return invalid('Use one exact authored Clock time zone.');
  return transition(state, { timeZone }, ['timeZone'], canCommit);
}
export function setClockFormat(state, use24Hour, canCommit = () => true) {
  const validation = validateClockState(state); if (!validation.ok) return invalid(validation.message);
  if (typeof use24Hour !== 'boolean') return invalid('Use a literal boolean 24-hour preference.');
  return transition(state, { use24Hour }, ['use24Hour'], canCommit);
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const formatters = new Map();
function zoneFormatters(timeZone) {
  if (!zones.includes(timeZone)) throw new RangeError('Unknown authored Clock time zone.');
  let result = formatters.get(timeZone);
  if (!result) {
    const make = options => new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { timeZone, ...options });
    result = { parts: make({ year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }),
      fullDate: make({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      shortDate: make({ year: 'numeric', month: 'numeric', day: 'numeric' }),
      longDate: make({ year: 'numeric', month: 'long', day: 'numeric' }),
      menuDate: make({ month: 'short', day: 'numeric' }) };
    formatters.set(timeZone, result);
  }
  return result;
}
// Gregorian civil-day ordinal: unlike elapsed 24-hour buckets this works across
// DST and at Date's upper edge, where a selected-zone civil midnight may exceed it.
function civilDay(year, month, day) {
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400), yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return era * 146097 + yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear - 719468;
}
export function clockParts(sceneTime, timeZone) {
  if (!validTime(sceneTime)) throw new RangeError('Clock requires a bounded explicit scene instant.');
  const values = {};
  for (const { type, value } of zoneFormatters(timeZone).parts.formatToParts(sceneTime))
    if (['year', 'month', 'day', 'hour', 'minute', 'second'].includes(type)) values[type] = Number(value);
  const dayNumber = civilDay(values.year, values.month, values.day);
  return { ...values, dayNumber, weekday: weekdays[((dayNumber + 4) % 7 + 7) % 7] };
}
const pad = value => String(value).padStart(2, '0');
function timeText(parts, use24Hour, seconds = false, ampm = true) {
  const time = `${use24Hour ? pad(parts.hour) : parts.hour % 12 || 12}:${pad(parts.minute)}${seconds ? `:${pad(parts.second)}` : ''}`;
  return time + (!use24Hour && ampm ? parts.hour < 12 ? ' AM' : ' PM' : '');
}
export function clockSummary(state, sceneTime) {
  const validation = validateClockState(state);
  if (!validation.ok) throw new TypeError(validation.message);
  const parts = clockParts(sceneTime, state.timeZone), formats = zoneFormatters(state.timeZone);
  const digitalTime = timeText(parts, state.use24Hour, state.showSeconds, state.showAMPM);
  const dateText = formats.menuDate.format(sceneTime), dayLabel = parts.weekday;
  const menuWithoutDate = [state.showDayOfWeek ? dayLabel : '', state.style === 'digital' ? digitalTime : ''].filter(Boolean).join(' ');
  const menuWithDate = [state.showDayOfWeek ? dayLabel : '', dateText, state.style === 'digital' ? digitalTime : ''].filter(Boolean).join(' ');
  const second = parts.second + sceneTime % 1000 / 1000, minute = parts.minute + second / 60, hour = parts.hour % 12 + minute / 60;
  return { sceneTime, iso: new Date(sceneTime).toISOString(), fullDate: formats.fullDate.format(sceneTime),
    fullTime: timeText(parts, state.use24Hour, true), time24: timeText(parts, true, true), dayLabel,
    menuWithoutDate, menuWithDate, dateText,
    localDateTime: parts.year >= 1970 && parts.year <= 9999 ? `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}` : null,
    hourAngle: hour * 30, minuteAngle: minute * 6, secondAngle: second * 6,
    timeZone: state.timeZone, use24Hour: state.use24Hour };
}
export function clockRecordLabel(timestamp, sceneTime, timeZone, use24Hour, withTime = false) {
  const record = clockParts(timestamp, timeZone), today = clockParts(sceneTime, timeZone);
  const age = today.dayNumber - record.dayNumber, time = timeText(record, use24Hour);
  if (age === 0) return withTime ? `Today ${time}` : time;
  if (age === 1) return withTime ? `Yesterday ${time}` : 'Yesterday';
  const formats = zoneFormatters(timeZone);
  return withTime ? `${formats.longDate.format(timestamp)} ${time}` : formats.shortDate.format(timestamp);
}
export function resolveClockLocalDateTime(localDateTime, timeZone) {
  const failure = message => ({ ok: false, message });
  if (typeof localDateTime !== 'string' || !zones.includes(timeZone)) return failure('Use an exact local date/time and authored time zone.');
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localDateTime);
  if (!match) return failure('Enter a complete local date and time.');
  const [year, month, day, hour, minute, second] = match.slice(1).map(value => value === undefined ? 0 : Number(value));
  if (year < 1970 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59)
    return failure('The local date or time is outside its supported range.');
  const naive = Date.UTC(year, month - 1, day, hour, minute, second), date = new Date(naive);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day)
    return failure('Enter a real calendar date.');
  // Probe both sides of all nearby transitions, then verify every possible UTC
  // candidate against the complete requested civil second. Folds retain both.
  const offsets = new Set(), candidates = new Set();
  for (let step = -8; step <= 8; step++) {
    const sample = naive + step * 6 * 3_600_000;
    if (!validTime(sample)) continue;
    const parts = clockParts(sample, timeZone);
    offsets.add(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - sample);
  }
  for (const offset of offsets) {
    const candidate = naive - offset;
    if (!validTime(candidate)) continue;
    const parts = clockParts(candidate, timeZone);
    if (parts.year === year && parts.month === month && parts.day === day && parts.hour === hour && parts.minute === minute && parts.second === second)
      candidates.add(candidate);
  }
  if (candidates.size === 0) return failure('This local time does not exist in the selected zone or precedes the scene time range.');
  if (candidates.size > 1) return failure('This local time is ambiguous in the selected zone; choose a time outside the repeated interval.');
  return { ok: true, sceneTime: candidates.values().next().value };
}

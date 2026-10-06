import { defineCommand, identity, flag, offset, choice, object, empty, match } from './command-schema.js';
import { clockSchema } from './clock-model.js';

const properties = clockSchema.properties;
const menu = Object.fromEntries(['style', 'showDate', 'showDayOfWeek', 'showAMPM', 'showSeconds'].map(key => [key, properties[key]]));
const partial = properties => ({ ...object(properties, []), anyOf: Object.keys(properties).map(key => match({ [key]: true })) });
const optionsOwner = { windowId: identity, optionsId: identity };
const timeOwner = { windowId: identity, editId: identity };
const optionsControl = choice('show-date', 'show-day-of-week', 'style-digital', 'style-analog', 'show-ampm', 'show-seconds', 'done');
const timeControl = choice('local-datetime', 'cancel', 'set');
const sceneTime = { type: 'integer', minimum: 0, maximum: 8_640_000_000_000_000 - 1 };
const localDateTime = { type: 'string', maxLength: 19, pattern: '^(?:|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2})?)$' };
const changedIds = { type: 'array', items: identity, uniqueItems: true, maxItems: 1024 };
const timeResult = { sceneTime, changedFileIds: changedIds, removedFileIds: changedIds };
const live = 'Alive foreground retained Golden desktop, no competing file/session/power presentation, native preparation, pairing, switcher or other private status sheet.';
const ownedOptions = 'Exact Root-unique optionsId and original ordinary Menu Bar Settings windowId; actual connected, noninert foreground Clock Options controls.';
const ownedTime = 'Exact Root-unique editId and original ordinary Date & Time Settings windowId; actual connected, noninert foreground date/time editor.';
const policy = 'One explicit virtual instant: existing files.sceneTime, never host time, timers or a duplicate clock. Per-retained-desktop display/zone/24-hour preferences; Guest starts from the authored baseline and is discarded. No NTP, geolocation, calendar flyout or fabricated Notification Center.';
const define = (name, target, payload, requires, presentation, data, result) => {
  const entry = defineCommand(['macos-golden-gate-27.0.1'], name, 'status.clock', target, payload,
    [live, ...requires], presentation, [policy, ...data], [], result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};

export const clockCatalog = Object.fromEntries([
  define('clock.menu.configure', empty, partial(menu), ['Nonempty literal closed menu preference subset; no pending Clock sheet.'],
    ['Update the actual analog/digital clock, date/day, AM/PM and seconds. When Space Allows uses actual menu-bar space; Analog retains unavailable digital preferences.'],
    ['Validate complete-root text budget before committing only supplied preferences.'], object(menu)),
  define('clock.zone.set', empty, object({ timeZone: properties.timeZone }), ['One documented authored named time zone; no pending Clock sheet.'],
    ['Reformat the existing instant and timestamped app/status surfaces in this zone; do not move or rewrite historical records.'],
    ['Commit only the per-root time zone within the complete4 Mi budget.'], object({ timeZone: properties.timeZone })),
  define('clock.format.set', empty, object({ use24Hour: flag }), ['No pending Clock sheet.'],
    ['Synchronize the real Date & Time switch and shared timestamp/time formatting; digital AM/PM is not shown in24-hour mode.'],
    ['Commit only the shared24-hour display preference.'], object({ use24Hour: flag })),
  define('clock.time.set', empty, object({ sceneTime }), ['Externally authored explicit instant at or after the current scene clock; own Clock Options may remain open, not a pending time editor.'],
    ['Update all shared-clock consumers and run enabled virtual storage maintenance atomically. No automatic progression.'],
    ['Commit the forward-only existing files.sceneTime and resulting eligible virtual records within all record/timestamp/text limits.'], object(timeResult)),
  define('clock.options.open', object({ windowId: identity }), empty, ['Exact active ordinary Settings Menu Bar owner with a real available Clock Options button.'],
    ['Capture native source control, mount actual bounded Clock Options outside the inert desktop, focus Show date.'],
    ['Create only a private Root lease; no preferences or saved draft change.'], object(optionsOwner)),
  define('clock.options.configure', object(optionsOwner), partial(menu), [ownedOptions, 'Nonempty menu preferences; analog digital-only controls cannot be configured unless the same atomic operation selects digital.'],
    ['Prepare actual enabled native controls synchronously; apply/reconcile immediate preferences. Fast select/radio→Tab→Done cannot outrun the commit.'],
    ['Commit supplied preferences atomically against the complete4 Mi budget; Done/Escape keep committed choices.'], object({ ...optionsOwner, ...menu })),
  define('clock.options.close', object(optionsOwner), empty, [ownedOptions],
    ['Dismiss Done/Escape and restore the original real connected Settings control.'],
    ['Retire private lease without rollback or serialized sheet state.'], object(optionsOwner)),
  define('clock.options.focus', object({ ...optionsOwner, control: optionsControl }), object({ observe: flag }, []), [ownedOptions],
    ['Reveal/focus or observe the actual owned native control; disabled/clipped/stale fields cannot become fictitious focus.'],
    ['No persistent mutation.'], object({ ...optionsOwner, control: optionsControl })),
  define('clock.options.scroll', object(optionsOwner), object({ top: offset, observe: flag }, ['top']), [ownedOptions],
    ['Apply/observe the real body-clamped scroll with Done pinned.'], ['No persistent mutation.'], object({ ...optionsOwner, top: offset })),
  define('clock.time.open', object({ windowId: identity }), empty, ['Exact active ordinary Date & Time Settings owner and real Set button; current selected-zone date is editable as1970–9999.'],
    ['Capture source control, mount actual date/time Set sheet with the selected-zone value, focus/reveal the real input.'],
    ['Create only a private Root lease/draft; no instant mutation.'], object(timeOwner)),
  define('clock.time.configure', object(timeOwner), object({ localDateTime }), [ownedTime, 'Literal native local date/time echo, including an empty incomplete input.'],
    ['Prepare/reconcile the actual input, retain a private draft; calendar/DST validation occurs on Set.'],
    ['No persistent mutation, no private draft serialization.'], object({ ...timeOwner, localDateTime })),
  define('clock.time.submit', object(timeOwner), empty, [ownedTime, 'Complete real local calendar date in the current authored zone; no ambiguous/nonexistent DST time, rewind or exhausted scene budget.'],
    ['Set the actual shared instant and maintenance atomically, dismiss only on success and restore native source. Failure retains draft/lease with a live error.'],
    ['Commit the existing files.sceneTime/eligible records, not a second current timestamp; private editor never saves.'], object({ ...timeOwner, ...timeResult })),
  define('clock.time.cancel', object(timeOwner), empty, [ownedTime],
    ['Cancel/Escape dismiss only this owned Set sheet and restore real native source.'], ['Discard private draft without changing the instant.'], object(timeOwner)),
  define('clock.time.focus', object({ ...timeOwner, control: timeControl }), object({ observe: flag }, []), [ownedTime],
    ['Reveal/focus or observe the actual native input/Cancel/Set control.'], ['No persistent mutation.'], object({ ...timeOwner, control: timeControl })),
  define('clock.time.scroll', object(timeOwner), object({ top: offset, observe: flag }, ['top']), [ownedTime],
    ['Apply/observe actual clamped editor body scrolling while actions stay pinned.'], ['No persistent mutation.'], object({ ...timeOwner, top: offset })),
]);

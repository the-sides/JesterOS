import { defineCommand, flag, choice, object, empty, match } from './command-schema.js';
import { soundSchema } from './sound-model.js';

const properties = soundSchema.properties;
const deviceId = properties.outputDeviceId, percent = properties.appVolumes.properties.music;
const appId = choice('music', 'quicktime'), tab = choice('output', 'input');
const windowId = { type: 'string', minLength: 1, maxLength: 256 };
const effectiveVolume = { type: 'number', minimum: 0, maximum: 100 };
const menu = { showInMenuBar: flag, showWhen: properties.showWhen };
const partial = properties => ({ ...object(properties, []), anyOf: Object.keys(properties).map(key => match({ [key]: true })) });
const live = 'Alive foreground Golden Gate retained desktop, with no competing modal, private status sheet, pairing, switcher or native preparation.';
const policy = 'Closed fictional per-retained-desktop routes and per-device controls; independent local users and discarded Guest. No host enumeration, microphone capture, privacy indicator, sink selection or hardware reconfiguration. Original local browser audio uses multiplicative master-times-app gain.';
const budget = 'Validate a complete detached Sound plan, writable data properties, unchanged original root/descriptors and complete-scene4 Mi UTF-16 text budget before any canonical mutation. Only accepted canonical mutations synchronize retained real media gains.';
const define = (name, target, payload, requires, presentation, data, result) => {
  const entry = defineCommand(['macos-golden-gate-27.0.1'], name, 'status.sound', target, payload,
    [live, ...requires], presentation, [policy, ...data], [], result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};

export const soundCatalog = Object.fromEntries([
  define('sound.output.set', object({ deviceId }), empty, ['An existing available authored output device.'],
    ['Select the actual shared fictional Output row and immediately apply its retained gain/mute to every real local player; keep an open Sound popup and its original editor return.'],
    [budget, 'Change only outputDeviceId; preserve each device volume/mute for later selection.'], object({ outputDeviceId: deviceId })),
  define('sound.input.set', object({ deviceId }), empty, ['An existing available authored input device.'],
    ['Select the actual shared fictional Input row and authored meter; an expanded Option Sound popup remains owned by its original editor.'],
    [budget, 'Change only inputDeviceId; retain each authored device gain and level. No microphone permission or recording.'], object({ inputDeviceId: deviceId })),
  define('sound.volume.set', empty, object({ volume: percent }), ['Selected fictional output is adjustable; literal integer volume0..100.'],
    ['Synchronize native Sound slider, Settings range and all original retained audio elements without recreating or restarting them.'],
    [budget, 'Change only selected output volume; explicit mute remains retained. Effective volume is zero if muted.'],
    object({ outputDeviceId: deviceId, volume: percent, muted: flag, effectiveVolume })),
  define('sound.mute.set', empty, object({ muted: flag }), ['Selected fictional output is adjustable; literal boolean.'],
    ['Synchronize actual Mute controls and all retained browser audio gains; volume0 is effectively silent even without explicit mute.'],
    [budget, 'Change only selected output muted flag; preserve its volume and every app gain.'], object({ outputDeviceId: deviceId, muted: flag, effectiveVolume })),
  define('sound.inputGain.set', empty, object({ gain: percent }), ['Selected fictional input is adjustable; literal integer gain0..100.'],
    ['Synchronize the native input gain range and authored meter, rounded from fixture level times gain.'],
    [budget, 'Change only selected input gain. No capture, permissions, recording or inferred host meter.'], object({ inputDeviceId: deviceId, gain: percent, inputLevel: percent })),
  define('sound.inputLevel.set', object({ deviceId }), object({ level: percent }), ['Existing authored input fixture and literal integer level0..100; availability does not turn this fixture event into recording.'],
    ['Refresh the authored meter if this device is selected; other device levels remain retained.'],
    [budget, 'Change only this authored device level, including a currently unselected or unavailable fixture.'], object({ deviceId, level: percent })),
  define('sound.appVolume.set', object({ appId }), object({ volume: percent }), ['Music or QuickTime, including an app with no current player; literal integer volume0..100.'],
    ['Apply shared app volume to each retained actual player; rejected playback or disappearing presentation cannot reject an already committed canonical volume.'],
    [budget, 'Change only this app gain. Effective volume is selected master output times app volume, or zero when muted; it never exceeds computer output.'], object({ appId, volume: percent, effectiveVolume })),
  define('sound.menu.configure', empty, partial(menu), ['Nonempty closed subset of showInMenuBar and showWhen:always|when-active.'],
    ['Reconcile actual Menu Bar Settings controls. Only When Active uses actual player paused=false, never input meter or nonzero gain. Disappearing Sound retires its original menu owner and editor return token.'],
    [budget, 'Persist only supplied preferences. Numeric/flag changes have zero text growth; selected IDs and showWhen use exact changed-string length deltas.'], object(menu)),
  define('sound.menu.inputs.set', empty, object({ expanded: flag }), ['Literal boolean input expansion; parent invokes true only through the explicitly inferred native Option Sound access.'],
    ['Expand/collapse actual Input rows in the existing Sound menu; normal Sound invocation resets this flag.'],
    ['Presentation-only flag; no canonical Sound change, text budget, hardware work or media synchronization. Clear and cold restoration reset false; never saved.'], object({ expanded: flag })),
  define('sound.settings.tab.set', object({ windowId }), object({ tab }), ['Exact current ordinary native Sound Settings owner and actual Output/Input tab; root callback validates the original window/pane lease.'],
    ['Select the real Output/Input tab in this Sound Settings window; reject missing, foreign or unavailable owners.'],
    ['No canonical sound mutation or text-budget consumption. Per-window native tab is owned by the existing saved-window model.'], object({ windowId, tab })),
]);

import { defineCommand, identity, flag, offset, choice, object, empty } from './command-schema.js';
import { bluetoothSchema } from './bluetooth-model.js';

const deviceId = bluetoothSchema.properties.devices.items.properties.id;
const pairId = identity;
const nullable = schema => ({ oneOf: [schema, { type: 'null' }] });
const percent = { type: 'integer', minimum: 0, maximum: 100 };
const pin = { type: 'string', maxLength: 6 };
const range = { type: 'integer', minimum: 0, maximum: 256 };
const pairControl = choice('pin', 'cancel', 'pair');
const direction = choice('none', 'forward', 'backward');
const available = 'Alive foreground Golden Gate retained desktop with the actual current native surface; no competing file/global modal, pairing, switcher or native preparation.';
const ownedPair = 'Exact opaque current Root-owned pairId and actual connected, visible, noninert native pair controls. PIN drafts are private, never inspected or persisted.';
const local = 'Fictional retained-desktop Bluetooth only. No host adapter, scan, discovery, WebBluetooth, hardware access, network traffic or real credentials. Local users retain separate complete-seed Bluetooth preferences; Guest discards them. No automatic reconnect on power-on; pairing codes are authored fictional cues.';
const define = (name, target, payload, requires, effects, result) => {
  const entry = defineCommand(['macos-golden-gate-27.0.1'], name, 'status.bluetooth', target, payload,
    [available, ...requires], effects, [local], [], result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};

export const bluetoothCatalog = Object.fromEntries([
  define('bluetooth.power.set', empty, object({ powered: flag }), ['No owned pending pair sheet.'],
    ['Set actual fictional Bluetooth power. Off atomically disconnects every connected device, retains pairing and marks linked Sound routes unavailable with selected-route fallback; on does not auto-connect or auto-select anything. The open status menu stays open.'],
    object({ powered: flag })),
  define('bluetooth.device.connect', object({ deviceId }), empty, ['Exact paired available fictional device; Bluetooth is on and no pending pair sheet.'],
    ['Atomically connect this paired device and expose its linked Sound routes without selecting them; per-route levels, mute and gain and app volumes stay unchanged.'],
    object({ deviceId, connected: flag })),
  define('bluetooth.device.disconnect', object({ deviceId }), empty, ['Exact present fictional device; a stale ID rejects without mutation.'],
    ['Atomically disconnect this device, keep its pairing, and mark its linked Sound routes unavailable; a selected route falls back to the first available unlinked Sound output/input, otherwise the whole transition rejects before any write.'],
    object({ deviceId, connected: flag })),
  define('bluetooth.device.configure', object({ deviceId }),
    { anyOf: [object({ available: flag }), object({ batteryPercent: nullable(percent) }), object({ available: flag, batteryPercent: nullable(percent) })] },
    ['Exact present fictional device with at least one fictional cue.'],
    ['Update only fictional availability and battery cues. Making a connected device unavailable disconnects it atomically with the same Sound route fallback as disconnect.'],
    object({ deviceId, available: flag, batteryPercent: nullable(percent) })),
  define('bluetooth.menu.configure', empty, object({ showInMenuBar: flag }), ['No owned pending pair sheet.'],
    ['Set the canonical Bluetooth menu-bar checkbox immediately. Disappearance retires the original Bluetooth menu and returns the original editor; the open Settings pane stays open.'],
    object({ showInMenuBar: flag })),
  define('bluetooth.pair.begin', object({ deviceId }), empty, ['Exact available unpaired fictional device; Bluetooth is on and no pending pair sheet.'],
    ['Mount and focus the actual private pair sheet before Applied: Connect for none, Accept plus the displayed fictional code for confirm, PIN plus the real six-character field for pin. Captures the original editor focus/caret/scroll for return.'],
    object({ pairId: identity, deviceId })),
  define('bluetooth.pair.draft', object({ pairId }), object({ pin }), [ownedPair, 'PIN mode only; the bounded literal draft stays private.'],
    ['Write the actual six-character PIN field without publishing any canonical credential or draft; visible validation happens only on submit.'],
    object({ pairId: identity })),
  define('bluetooth.pair.submit', object({ pairId }), { oneOf: [empty, object({ pin })] },
    [ownedPair, 'PIN mode requires the submitted pin; other modes submit without payload.'],
    ['Synchronize the owned real PIN field compare-before-write, then recheck the device, mode, fictional code and complete-scene text budget. Wrong code/budget retains this sheet with a live error and connected:false while canonical devices and Sound stay unchanged; success pairs and connects atomically, closes the sheet and returns the original editor focus/caret.'],
    object({ pairId: identity, deviceId, connected: flag })),
  define('bluetooth.pair.cancel', object({ pairId }), empty, [ownedPair],
    ['Dismiss only this actual pair sheet and return the original owned editor focus/caret/scroll; canonical devices and Sound stay unchanged. Private PIN drafts are discarded.'],
    object({ pairId: identity, cancelled: { const: true } })),
  define('bluetooth.pair.focus', object({ pairId, control: pairControl }), object({ observe: flag }, []),
    [ownedPair, 'Requested native control exists, is enabled and belongs to this mode; observe requires its actual focus.'],
    ['Focus or observe only this real pair control; no retained data or private draft publication.'],
    object({ pairId: identity, control: pairControl })),
  define('bluetooth.pair.select', object({ pairId }),
    object({ start: range, end: range, direction }, ['start', 'end']),
    [ownedPair, 'PIN mode only; the ordered range lies inside the actual current PIN draft after focus/reveal.'],
    ['Focus, reveal and set the actual native caret/selection on the real PIN field and return it without publishing or persisting the private draft.'],
    object({ pairId: identity, start: range, end: range, direction })),
  define('bluetooth.pair.scroll', object({ pairId }), object({ top: offset, observe: flag }, ['top']), [ownedPair],
    ['Apply or observe the real bounded pair body scroll and return the actual DOM-clamped offset; pinned action buttons remain reachable.'],
    object({ pairId: identity, top: offset })),
]);

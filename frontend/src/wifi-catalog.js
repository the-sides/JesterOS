import { defineCommand, identity, flag, offset, choice, object, empty } from './command-schema.js';
import { wifiSchema } from './wifi-model.js';

const networkId = wifiSchema.properties.networks.items.properties.id;
const networkName = wifiSchema.properties.networks.items.properties.name;
const nullable = schema => ({ oneOf: [schema, { type: 'null' }] });
const join = object({ joinId: identity });
const password = { type: 'string', maxLength: 63 };
const available = 'Alive foreground Golden Gate retained desktop with the actual current native surface; no competing file/global modal, pairing, switcher or native preparation.';
const ownedJoin = 'Exact opaque current Root-owned joinId and actual connected, visible, noninert native Join/Cancel controls. Native password drafts are private, never inspected or persisted.';
const local = 'Fictional retained-desktop Wi-Fi only. No host adapter, scan, traffic, network connection or real credentials. Local users retain separate complete-seed Wi-Fi preferences; Guest discards them. No automatic reconnect on power-on.';
const define = (name, target, payload, requires, effects, result) => {
  const entry = defineCommand(['macos-golden-gate-27.0.1'], name, 'status.wifi', target, payload,
    [available, ...requires], effects, [local], [], result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};
const connection = object({ powered: flag, connectedNetworkId: nullable(networkId) });
const requested = object({ networkId: nullable(networkId), connected: flag, confirmationRequired: flag, joinId: nullable(identity) });
const range = { type: 'integer', minimum: 0, maximum: 256 };

export const wifiCatalog = Object.fromEntries([
  define('wifi.power.set', empty, object({ powered: flag }), ['No owned pending Join sheet.'],
    ['Set actual fictional Wi-Fi power. Off disconnects immediately without forgetting known networks; on stays disconnected until an explicit join. The open status popover stays open.'], connection),
  define('wifi.connect', object({ networkId }), empty, ['Exact currently available fictional network; Wi-Fi is on and no pending Join sheet.'],
    ['Open/known networks join immediately and become known. Unknown protected networks prepare/focus the actual private password Join sheet without changing the existing connection.'], requested),
  define('wifi.disconnect', object({ networkId }), empty, ['Exact actual connected fictional network; a stale/foreign/disconnected ID rejects without mutation.'],
    ['Disconnect only the current fictional connection, preserving power, fixture network records and known-network state.'], connection),
  define('wifi.menu.otherNetworks.set', empty, object({ expanded: flag }), ['Owned open Wi-Fi status popup with Wi-Fi on.'],
    ['Expand/collapse actual inline Other Networks rows under the single shared menu owner. No retained Wi-Fi or document mutation.'], object({ expanded: flag })),
  define('wifi.join.hidden', empty, empty, ['Wi-Fi on; no pending Join sheet.'],
    ['Prepare/focus the actual Other Network sheet with private Network Name, Security and Password controls. Only authored fictional network records can be joined.'], requested),
  define('wifi.join.submit', join, { oneOf: [
    object({ password }),
    object({ networkName, security: choice('open', 'password'), password }),
  ] }, [ownedJoin, 'Network sheet accepts only password. Hidden sheet requires networkName/security/password; open security requires empty password.'],
    ['Synchronize owned real native fields for actor/native parity, then recheck the current fictional network, power and existing4Mi UTF-16 complete-scene budget. Correct password joins and remembers that network; incorrect password/unavailable hidden name or commit limit retains the sheet and prior connection with an actual live error and connected:false. Success dismisses and returns original native editor focus/caret.'],
    object({ joinId: identity, networkId: nullable(networkId), connected: flag })),
  define('wifi.join.cancel', join, empty, [ownedJoin],
    ['Dismiss only this actual Join sheet and return original owned editor focus/caret; preserve the existing connection, known networks and all document data. Private native drafts are discarded.'], object({ joinId: identity, cancelled: { const: true } })),
  define('wifi.join.focus', object({ joinId: identity, control: choice('network-name', 'security', 'password', 'cancel', 'join') }), object({ observe: flag }, []), [ownedJoin, 'Requested native control exists and is available; observe requires its actual focus.'],
    ['Focus/observe only this real Join control; no retained data or private draft publication.'], object({ joinId: identity, control: choice('network-name', 'security', 'password', 'cancel', 'join') })),
  define('wifi.join.select', object({ joinId: identity, control: choice('network-name', 'password') }), object({ start: range, end: range, direction: choice('none', 'forward', 'backward') }, ['start', 'end']),
    [ownedJoin, 'Actual requested native text field; ordered UTF-16 range lies inside its current literal value.'],
    ['Focus and set/read actual native caret/selection without publishing or persisting the private password.'], object({ joinId: identity, control: choice('network-name', 'password'), start: range, end: range, direction: choice('none', 'forward', 'backward') })),
  define('wifi.join.scroll', join, object({ top: offset, observe: flag }, ['top']), [ownedJoin],
    ['Apply or observe the real bounded Join body scroll and return the actual DOM-clamped offset; pinned action buttons remain reachable.'], object({ joinId: identity, top: offset })),
]);

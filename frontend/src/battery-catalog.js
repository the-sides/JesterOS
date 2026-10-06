import { defineCommand, identity, flag, offset, choice, object, empty, match } from './command-schema.js';
import { batterySchema } from './battery-model.js';

const properties = batterySchema.properties;
const status = object({ percent: properties.percent, powerSource: properties.powerSource,
  charging: flag, minutesToFull: properties.minutesToFull });
const mode = properties.lowPowerMode;
const menuProperties = { showInMenuBar: flag, showPercentage: flag, showEnergyMode: properties.showEnergyMode };
const optionsProperties = { showPercentage: flag, showEnergyMode: properties.showEnergyMode };
const partial = properties => ({ ...object(properties, []), anyOf: Object.keys(properties).map(key => match({ [key]: true })) });
const owner = { windowId: identity, optionsId: identity };
const control = choice('show-percentage', 'show-energy-mode', 'done');
const live = 'Alive foreground Golden Gate retained desktop. No competing file/session/power modal, Wi-Fi Join, pairing, switcher or native preparation.';
const owned = 'Exact current Root-unique optionsId and original ordinary Menu Bar Settings windowId; actual visible, connected, noninert foreground Options controls. Immediate committed preferences, not private transactional drafts.';
const policy = 'Fictional retained-desktop Battery state and authored energy fixtures only, independent per local user and discarded with Guest. No host Battery API, hardware measurements, automatic drain, host power or network.';
const define = (name, target, payload, requires, presentation, data, result) => {
  const entry = defineCommand(['macos-golden-gate-27.0.1'], name, 'status.battery', target, payload,
    [live, ...requires], presentation, [policy, ...data], [], result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};

export const batteryCatalog = Object.fromEntries([
  define('battery.status.set', empty, status, ['Closed consistent externally authored fictional level/source/charging/estimate event.'],
    ['Update the actual indicator, open status popup and linked Battery pane. Low/critical presentation follows the authored level, never a host event.'],
    ['Commit only fictional status fields; unplug/full clears an active charge-to-full override. Validate charge-limit consistency and whole-root4 Mi text budget before mutation.'], status),
  define('battery.energy.set', object({ appId: properties.energyApps.items.properties.appId }), object({ impact: properties.energyApps.items.properties.impact }),
    ['Registered app ID and bounded integer fictional impact; at most128 distinct authored entries.'],
    ['Refresh significant-energy rows derived from currently running apps, including hidden/minimized apps. Nonrunning entries never advertise a fake process.'],
    ['Set/insert only this authored fixture impact, within the whole-root4 Mi text budget. Numerical impact is simulation units, not measured watts.'],
    object({ appId: properties.energyApps.items.properties.appId, impact: properties.energyApps.items.properties.impact })),
  define('battery.lowPower.set', empty, object({ mode }), ['No pending Options sheet; source-specific policy is never/always/battery/adapter.'],
    ['Synchronize the native Low Power Mode control and current effective mode. An open status popup retains its original editor token and actual popup.'],
    ['Commit only this fictional preference within the whole-root4 Mi budget; no fabricated host performance or battery drain.'], object({ mode, active: flag })),
  define('battery.menu.configure', empty, partial(menuProperties), ['Nonempty closed preference subset and no pending Options sheet.'],
    ['Show/hide the actual Battery invoker and percentage, and conditionally show its Low Power Mode row. Hiding retires the open Battery menu through the existing owner.'],
    ['Commit only supplied per-root menu preferences; preserve other preferences, authored charge and all app records.'], object(menuProperties)),
  define('battery.chargeToFull', empty, empty, ['Power adapter connected, charge limit below100, level below100 and no existing override or pending Options sheet.'],
    ['Start actual fictional charging to100 and remove the conditional Charge to Full Now row. Charging estimate stays honestly unavailable until authored.'],
    ['Set charge-to-full override and charging; future authored full/unplug status clears it. No timed/host completion.'], object({ charging: { const: true }, chargeToFull: { const: true } })),
  define('battery.options.open', object({ windowId: identity }), empty, ['Exact foreground ordinary Settings owner on its real Menu Bar pane and available Battery Options control.'],
    ['Capture original native control and prepare/focus the actual Options sheet outside the inert background desktop.'],
    ['Create only a private Root-owned lease; do not change preferences or serialize pending Options.'], object(owner)),
  define('battery.options.configure', object(owner), partial(optionsProperties), [owned, 'Nonempty closed preference subset; actual native field ownership is rechecked before commit.'],
    ['Update/reconcile the real Show Percentage switch and/or Show Energy Mode select. Rejected attempts retain canonical choices; native fields reconcile to those choices.'],
    ['Commit preferences immediately within the complete-scene4 Mi budget. Done/Escape do not roll them back.'], object({ ...owner, ...optionsProperties })),
  define('battery.options.close', object(owner), empty, [owned],
    ['Done/Escape dismiss only this actual sheet and restore the original connected native source control.'],
    ['Keep already committed preferences; retire the private lease without a fake Cancel transaction.'], object(owner)),
  define('battery.options.focus', object({ ...owner, control }), object({ observe: flag }, []), [owned, 'Exact real control; observe additionally requires its actual focus.'],
    ['Reveal/focus or observe the actual owned field/Done button; clipped or stale ownership cannot be represented by a fake focus cache.'],
    ['No persistent preference/status/application change.'], object({ ...owner, control })),
  define('battery.options.scroll', object(owner), object({ top: offset, observe: flag }, ['top']), [owned],
    ['Apply/observe actual clamped Options body scrolling; Done remains pinned and reachable.'],
    ['No persistent preference/status/application change.'], object({ ...owner, top: offset })),
]);

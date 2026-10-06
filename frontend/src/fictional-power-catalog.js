import { defineCommand, NONE, identity, flag, choice, object, empty } from './command-schema.js';

const profiles = ['macos-golden-gate-27.0.1'];
const define = (name, target, payload, requires, presentation, result) => {
  const entry = defineCommand(profiles, `power.${name}`, 'session.power', target, payload, requires,
    presentation, ['Only fictional page-local power/session state; no host power, authentication, filesystem, settings or network API.'], NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};
const awake = 'Awake desktop, login or lock presentation; no power or logout confirmation; finish or cancel pending export/settings work and commit native input first.';
const locked = 'Awake interactive signed-in desktop, already locked signed-in user or login presentation; no power or logout confirmation.';
const retained = 'Retain original page-local local-user desktops and autosaved Notes/Services records. Accepted reopen choice retains or closes windows, never records.';
const confirmation = 'Unless confirm:false, present real Cancel, confirmation and Reopen windows controls and initially focus Cancel. Guest deletion occurs only after accepted confirmation or explicit bypass. The page simulation applies the choice to all retained local roots, not native multi-user behavior.';
export const fictionalPowerCatalog = Object.fromEntries([
  define('screenSaver.start', empty, empty, [locked],
    [retained, 'Lock a desktop session immediately, then show original wallpaper with deterministic elapsed-time drift; no scene-clock change or native aerial assets.'],
    object({ phase: { const: 'saver' } })),
  define('sleep', empty, empty, [locked],
    [retained, 'Lock a desktop session immediately, then show full black fictional sleep; wake still requires fictional sign-in.'],
    object({ phase: { const: 'sleeping' } })),
  define('wake', empty, empty, ['Only screen saver or sleeping; no pending confirmation.'],
    ['Return to the unchanged locked/login session without authenticating, unlocking, or starting an off scene.'],
    object({ phase: { const: 'awake' } })),
  define('restart', empty, object({ confirm: flag, reopenWindows: flag }, NONE), [awake], [retained, confirmation,
    'Default to the local reopen preference. confirm:false bypasses only the action confirmation using the same safe sign-out/startup transition. Persist the choice only on acceptance.'],
    object({ confirmationRequired: flag, action: { const: 'restart' }, reopenWindows: flag })),
  define('shutdown', empty, object({ confirm: flag, reopenWindows: flag }, NONE), [awake], [retained, confirmation,
    'Default to the local reopen preference. confirm:false bypasses only the action confirmation using the same safe sign-out/off transition. Persist the choice only on acceptance.'],
    object({ confirmationRequired: flag, action: { const: 'shutdown' }, reopenWindows: flag })),
  define('configure', empty, object({ reopenWindows: flag }), ['Owned visible restart or shutdown confirmation and real reopen-windows checkbox.'],
    ['Change only the transient pending checkbox choice; Cancel leaves windows, documents and preferences intact.'], object({ reopenWindows: flag })),
  define('respond', empty, object({ accept: flag }), ['An open restart or shutdown confirmation with visible matching action control; acceptance must still be safe.'],
    [retained, 'Cancel restores the original active root/focus without sign-out or preference writes. Acceptance clears signed-in/locked flags, always discards Guest, applies the reopen choice to local windows and presents restart startup or shutdown black. Blocked commits preserve the confirmation. No fabricated Save/Don’t Save editor dialog.'],
    object({ accepted: flag, phase: choice('awake', 'booting', 'off'), reopenWindows: flag })),
  define('start', empty, empty, ['Only an off scene; no pending confirmation.'],
    ['Start the fictional five-second boot with zero elapsed/progress, then return to login choices, never automatically authenticate.'],
    object({ phase: { const: 'booting' } })),
  define('advance', empty, object({ seconds: { type: 'integer', minimum: 1, maximum: 300 } }),
    ['Only screen saver or booting; no pending confirmation.'],
    ['Advance canonical elapsed seconds only. Startup clamps at five fictional seconds/progress one, then shows login choices. Screen saver drift never changes scene time. Prepare/focus the actual power surface when needed.'],
    object({ phase: choice('saver', 'booting', 'awake'), elapsedSeconds: { type: 'integer', minimum: 0 },
      startupProgress: { type: 'number', minimum: 0, maximum: 1 } })),
  define('focus', object({ controlId: identity }), empty,
    ['Actual mounted, connected, visible and enabled control in the current power surface.'],
    ['Focus that actual control; never a hidden retained desktop, credential surface or stale power target.'],
    object({ controlId: identity })),
]);

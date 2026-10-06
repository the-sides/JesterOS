import { defineCommand, NONE, identity, flag, choice, object, empty } from './command-schema.js';

const profiles = ['macos-golden-gate-27.0.1'];
const define = (name, target, payload, requires, presentation, result) => {
  const entry = defineCommand(profiles, `power.${name}`, 'session.power', target, payload, requires,
    presentation, ['Only fictional page-local power/session state; no host power, authentication, filesystem, settings or network API.'], NONE, result);
  entry[1].resultSchema.additionalProperties = false;
  return entry;
};
const awake = 'Awake desktop, login or lock presentation; no power or Guest-end confirmation.';
const locked = 'Awake interactive signed-in desktop, already locked signed-in user or login presentation; no power or Guest-end confirmation.';
const retained = 'Retain original page-local local-user documents, editor/model/DOM identity and windows; never recreate local desktops.';
const confirmation = 'Present actual Cancel and confirmation controls, initially focus Cancel; Guest deletion occurs only after acceptance.';
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
  define('restart', empty, empty, [awake], [retained, confirmation],
    object({ confirmationRequired: { const: true }, action: { const: 'restart' } })),
  define('shutdown', empty, empty, [awake], [retained, confirmation],
    object({ confirmationRequired: { const: true }, action: { const: 'shutdown' } })),
  define('respond', empty, object({ accept: flag }), ['An open restart or shutdown confirmation.'],
    [retained, 'Cancel restores the original active root/focus without sign-out. Acceptance clears signed-in/locked flags, discards Guest only, and presents restart startup or shutdown black. No save-changes/reopen controls.'],
    object({ accepted: flag, phase: choice('awake', 'booting', 'off') })),
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

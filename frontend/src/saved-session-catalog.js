import { defineCommand, NONE, object, empty, choice } from './command-schema.js';
import { savedSessionSchema } from './saved-session.js';

const profiles = ['macos-golden-gate-27.0.1'];
const define = (action, saved, presentation, data) => {
  const entry = defineCommand(profiles, `scene.session.${action}`, 'scene.saved-session', empty, empty,
    ['A live Golden Gate scene host in any fictional session or power phase; browser-local storage must be accessible.',
      ...(action === 'save' ? ['No retained local root has an uncommitted Split View chooser or pending application quit.'] : [])],
    [...presentation, 'Explicit commands only: no automatic save or load on reload, no actor operator controls, host service or credentials.',
      'Save and restore validate the complete bounded closed snapshot and all seed/window/view/application/Space references before storing or disposing anything.',
      'Storage access/quota failures reject unavailable; a missing restore rejects not_found; malformed, oversized, cross-profile or invalid saved data rejects invalid_arguments.',
      savedSessionSchema.description], data, NONE,
    object({ profileId: choice(...profiles), version: { const: 1 }, saved: { const: saved } }));
  entry[1].resultSchema.additionalProperties = false;
  entry[1].completion = { mode: 'promise', success: 'applied', settles: action === 'restore'
    ? 'Validated local roots have remounted and are ready in the same Golden Gate profile, signed out at fictional login; every local user must explicitly sign in.'
    : `The synchronous browser-local saved-session ${action === 'save' ? 'write' : 'removal'} succeeded; the current scene remains mounted and unchanged.` };
  return entry;
};

export const savedSessionCatalog = Object.fromEntries([
  define('save', true, ['Capture the complete current baseline and retained local-user scenes into the versioned profile-specific browser-local storage slot.',
    'Exclude Guest, all authentication/credentials/session/power state and transient popups; preserve retained app data, generated readonly catalog timestamps, ordinary closed-window geometry, live windows/Spaces and semantic view state.'],
  ['The browser-local Golden Gate V1 saved-session slot only; no current scene mutation.']),
  define('restore', true, ['Read and validate the existing browser-local snapshot before disposing any current scene.',
    'Replace the whole host with the saved baseline and local-user scenes, signed out at fictional login. Never restore Guest, a signed-in user, credentials or a power phase.'],
  ['Complete Golden Gate baseline and retained local-user scenes; authentication and transient presentation state start fresh.']),
  define('clear', false, ['Remove only the browser-local saved-session slot, including malformed or oversized data; missing storage is already clear.',
    'Do not reset, dispose or mutate the mounted scene.'], NONE),
]);

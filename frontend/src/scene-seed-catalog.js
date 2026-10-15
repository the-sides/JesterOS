import { defineCommand, NONE, object, empty, choice } from './command-schema.js';
import { sceneSeedSchema } from './scene-seed.js';
import { NATIVE_PROFILE_IDS } from './native-domain-registry.js';

const profiles = NATIVE_PROFILE_IDS;
const define = (name, payload, source, presentation) => {
  const entry = defineCommand(profiles, name, 'scene.seed', empty, payload,
    ['A live installed-profile scene host in any session or power phase, including login, sleep, startup, off and confirmation.'],
    [presentation, 'Dispose the entire previous host and all user roots, windows, menus, power/session state and mutable models; await the fresh default startup presentation.',
      'Browser-local setup only: no actor control, host services, automatic persistence or second command queue.'],
    ['Replace the complete original scene fixture; never merge fields or prune invalid references.',
      'Structural and cross-reference validation rejects invalid input before any scene disposal.', sceneSeedSchema.description,
      ...(source === 'default' ? ['Clear this profile’s browser-local saved-session slot before disposal; storage failure rejects unavailable without resetting.'] : [])],
    NONE, object({ profileId: choice(...profiles), version: { const: 1 }, source: { const: source } }));
  entry[1].resultSchema.additionalProperties = false;
  entry[1].completion = { mode: 'promise', success: 'applied',
    settles: source === 'default'
      ? 'Browser-local saved-session slot cleared before disposal; fresh host in the original installed profile and startup application ready. No host/network work.'
      : 'Fresh host in the original installed profile and startup application ready after disposing all old user roots; no host/network/storage work.' };
  return entry;
};

export const sceneSeedCatalog = Object.fromEntries([
  define('scene.reset', empty, 'default', 'Restore the complete original installed-profile canonical application graphs, genuine user Files, Messages sample, appearance and persistent Dock defaults; restart the original startup application.'),
  define('scene.replaceSeed', object({ seed: sceneSeedSchema }), 'replacement', 'Start a fresh scene in the installed profile from the supplied complete V1 seed, with original startup behavior and no retained edits; empty supported arrays remain empty.'),
]);

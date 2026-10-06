import { defineCommand, NONE, object, empty, choice } from './command-schema.js';
import { sceneSeedSchema } from './scene-seed.js';

const profiles = ['macos-golden-gate-27.0.1'];
const define = (name, payload, source, presentation) => {
  const entry = defineCommand(profiles, name, 'scene.seed', empty, payload,
    ['A live Golden Gate scene host in any session or power phase, including login, sleep, startup, off and confirmation.'],
    [presentation, 'Dispose the entire previous host and all user roots, windows, menus, power/session state and mutable models; await the fresh default startup presentation.',
      'Browser-local setup only: no actor control, host services, persistence or second command queue.'],
    ['Replace the complete original scene fixture; never merge fields or prune invalid references.',
      'Structural and cross-reference validation rejects invalid input before any scene disposal.', sceneSeedSchema.description],
    NONE, object({ profileId: choice(...profiles), version: { const: 1 }, source: { const: source } }));
  entry[1].resultSchema.additionalProperties = false;
  entry[1].completion = { mode: 'promise', success: 'applied',
    settles: 'Fresh Golden Gate host and startup application ready after disposing all old user roots; no host/network/storage work.' };
  return entry;
};

export const sceneSeedCatalog = Object.fromEntries([
  define('scene.reset', empty, 'default', 'Restore the complete original Golden Gate Notes, user files, Messages sample, appearance and persistent Dock defaults; restart the original startup application.'),
  define('scene.replaceSeed', object({ seed: sceneSeedSchema }), 'replacement', 'Start a fresh Golden Gate scene from the supplied complete V1 seed, with original startup behavior and no retained edits; empty supported arrays remain empty.'),
]);

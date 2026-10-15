import { mount, unmount, tick } from 'svelte';
import App from './App.svelte';
import SessionHost from './SessionHost.svelte';
import UnsupportedProfile from './UnsupportedProfile.svelte';
import { DEFAULT_PROFILE_ID, getOSProfile, listOSProfiles } from './os-profiles.js';
import { getProfileAdapter } from './profile-adapters.js';
import { createFeatureCommands, rejected } from './feature-commands.js';
import { commandCatalog } from './command-catalog.js';
import { createDefaultSceneSeed, createSceneSeedCommands } from './scene-seed.js';
import { createSavedSessionCommands, clearSavedSession, savedSessionStorageKey } from './saved-session.js';
import { createDefaultApplicationFiles } from './default-application-files.js';
import './fonts.css';
import './styles.css';

const requestedId = new URLSearchParams(location.search).get('profile') ?? DEFAULT_PROFILE_ID;
const profile = getOSProfile(requestedId);
const target = document.getElementById('app');
let scene = null;
let activeCommands = null;
let disposeHost = null;

// Single-desktop profiles retain their own Root renderer and persistence facade.
// Only Golden Gate mounts the fictional multi-user session/power surfaces.
function createDesktopHost(profile, baseline, replaceScene, restoreScene) {
  let disposed = false, controller = null, facade = null;
  let queue = Promise.resolve();
  const settle = async () => { await tick(); await tick(); };
  function clearStoredSession() {
    try {
      const result = clearSavedSession(globalThis.localStorage, profile);
      return result.ok ? { status: 'applied' } : rejected('unavailable', result.message);
    } catch {
      return rejected('unavailable', 'Browser-local saved-session storage is unavailable.');
    }
  }
  const seedOperations = createSceneSeedCommands({ profile, available: () => !disposed,
    defaultSeedOptions: { createFiles: createDefaultApplicationFiles },
    beforeReset: clearStoredSession, replaceScene });
  const savedOperations = createSavedSessionCommands({ profile, available: () => !disposed,
    storage: () => globalThis.localStorage,
    beforeCapture: () => facade?.canSave() === true
      ? { status: 'applied' } : rejected('unavailable', 'Finish local window pairing or application quit before saving.'),
    capture: async () => {
      const current = facade;
      if (!current || await current.ready() !== true || disposed || facade !== current) {
        throw new Error('The original local desktop did not finish startup.');
      }
      const local = await current.persist();
      return { version: 1, profileId: profile.id, baseline,
        locals: [{ userId: 'local-alex', scene: local }] };
    },
    replace: restoreScene });
  return {
    dispose() { disposed = true; },
    registerScene(value) {
      facade = value;
      return () => { if (facade === value) facade = null; };
    },
    registerDesktop(value) {
      controller = value;
      const catalog = { ...value.describe().commands, ...Object.fromEntries(Object.entries(commandCatalog)
        .filter(([, descriptor]) => descriptor.profiles.includes(profile.id)
          && profile.capabilities.includes(descriptor.capability)
          && ['scene.seed', 'scene.saved-session'].includes(descriptor.capability))) };
      const handlers = Object.fromEntries(Object.keys(catalog).map(name => [name,
        seedOperations[name] ?? savedOperations[name]
          ?? ((target, payload) => controller === value && !disposed
            ? value.execute({ command: name, target, payload })
            : rejected('unavailable', 'The original desktop has been replaced.'))]));
      const commands = createFeatureCommands(handlers,
        () => ({ ...value.inspect().state, sceneSeed: structuredClone(baseline) }), settle, catalog,
        () => ({ ...value.describe().targets,
          sceneSeed: { ...baseline, completeReplacement: true,
            boundaries: { operatorDesktopControls: false, persistence: false, hostServices: false, profileIdentityChange: false } },
          savedSession: { version: 1, storageKey: savedSessionStorageKey(profile),
            automaticSave: false, automaticRestore: false, localUsersOnly: true,
            guestSaved: false, credentialsSaved: false, restorePhase: 'desktop', reset: 'scene.reset',
            commands: ['scene.session.save', 'scene.session.restore', 'scene.session.clear'] } }),
        () => disposed ? null : profile, commandCatalog);
      const unregister = registerCommands(Object.freeze({
        execute(request) {
          const result = queue.then(() => disposed
            ? { ...rejected('unavailable', 'The original desktop has been replaced.'),
              ...(typeof request?.requestId === 'string' ? { requestId: request.requestId } : {}) }
            : commands.execute(request));
          queue = result.catch(() => {});
          return result;
        },
        inspect: commands.inspect, describe: commands.describe,
        ready: async () => {
          const current = facade;
          const ready = await current?.ready();
          return !disposed && facade === current && ready === true;
        },
      }));
      return () => { if (controller === value) controller = null; unregister(); };
    },
  };
}

function registerCommands(commands) {
  activeCommands = commands;
  return () => { if (activeCommands === commands) activeCommands = null; };
}

// Controllers may retain this object across profile changes. Never retain an
// outgoing scene's handlers or let commands write into a disposed scene.
const publicCommands = Object.freeze({
  execute(request) {
    if (activeCommands) return activeCommands.execute(request);
    const result = rejected('unavailable', 'The scene is changing profiles.');
    if (typeof request?.requestId === 'string') result.requestId = request.requestId;
    return Promise.resolve(result);
  },
  inspect() {
    return activeCommands?.inspect() ?? { commands: [], state: { profile: null, transitioning: true } };
  },
  describe(command) {
    return activeCommands?.describe(command) ?? rejected('unavailable', 'The scene is changing profiles.');
  },
});

async function mountScene(profile, seedState, savedSession) {
  const adapter = getProfileAdapter(profile.renderer);
  const currentSeed = profile.capabilities.includes('scene.seed')
    ? seedState ?? { source: 'default', seed: createDefaultSceneSeed(profile, { createFiles: createDefaultApplicationFiles }) } : null;
  activeCommands = null;
  disposeHost?.();
  disposeHost = null;
  if (scene) await unmount(scene);
  document.documentElement.dataset.osProfile = profile.id;
  document.documentElement.dataset.osFamily = profile.family;
  document.documentElement.dataset.osRenderer = profile.renderer;
  adapter.prepareDocument();
  const resetScene = (seed, source) => mountScene(profile, { seed, source });
  const restoreScene = value => mountScene(profile, value.baseline, value);
  const fictional = profile.capabilities.includes('session.fictional');
  const desktopHost = !fictional && currentSeed
    ? createDesktopHost(profile, currentSeed, resetScene, restoreScene) : null;
  disposeHost = desktopHost ? () => desktopHost.dispose() : null;
  scene = mount(fictional ? SessionHost : App,
    { target, props: { profile, adapter, selectProfile,
      registerCommands: desktopHost ? desktopHost.registerDesktop : registerCommands,
      ...(desktopHost ? { registerSessionScene: desktopHost.registerScene,
        savedScene: savedSession?.locals.find(local => local.userId === 'local-alex')?.scene } : {}),
      ...(currentSeed ? { seed: currentSeed.seed, seedSource: currentSeed.source, savedSession,
        resetScene, restoreScene } : {}) } });
  await tick();
  if (currentSeed && await activeCommands?.ready() !== true) throw new Error('The fresh original scene did not finish startup.');
}

async function selectProfile(profile) {
  await mountScene(profile);
  const url = new URL(location.href);
  url.searchParams.set('profile', profile.id);
  history.replaceState(history.state, '', url);
}

if (profile) {
  globalThis.jesteros = publicCommands;
  void mountScene(profile);
} else {
  mount(UnsupportedProfile, { target, props: { requestedId, profiles: listOSProfiles() } });
}

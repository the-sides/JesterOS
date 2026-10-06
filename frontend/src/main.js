import { mount, unmount, tick } from 'svelte';
import App from './App.svelte';
import SessionHost from './SessionHost.svelte';
import UnsupportedProfile from './UnsupportedProfile.svelte';
import { DEFAULT_PROFILE_ID, getOSProfile, listOSProfiles } from './os-profiles.js';
import { getProfileAdapter } from './profile-adapters.js';
import { rejected } from './feature-commands.js';
import './fonts.css';
import './styles.css';

const requestedId = new URLSearchParams(location.search).get('profile') ?? DEFAULT_PROFILE_ID;
const profile = getOSProfile(requestedId);
const target = document.getElementById('app');
let scene = null;
let activeCommands = null;

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

async function mountScene(profile) {
  const adapter = getProfileAdapter(profile.renderer);
  activeCommands = null;
  if (scene) await unmount(scene);
  document.documentElement.dataset.osProfile = profile.id;
  document.documentElement.dataset.osFamily = profile.family;
  document.documentElement.dataset.osRenderer = profile.renderer;
  adapter.prepareDocument();
  scene = mount(profile.capabilities.includes('session.fictional') ? SessionHost : App,
    { target, props: { profile, adapter, registerCommands, selectProfile } });
  await tick();
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

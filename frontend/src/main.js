import { mount } from 'svelte';
import App from './App.svelte';
import UnsupportedProfile from './UnsupportedProfile.svelte';
import { DEFAULT_PROFILE_ID, getOSProfile, listOSProfiles } from './os-profiles.js';
import { getProfileAdapter } from './profile-adapters.js';
import './fonts.css';
import './styles.css';

const requestedId = new URLSearchParams(location.search).get('profile') ?? DEFAULT_PROFILE_ID;
const profile = getOSProfile(requestedId);
const target = document.getElementById('app');
if (profile) {
  const adapter = getProfileAdapter(profile.renderer);
  document.documentElement.dataset.osProfile = profile.id;
  document.documentElement.dataset.osFamily = profile.family;
  document.documentElement.dataset.osRenderer = profile.renderer;
  adapter.prepareDocument();
  mount(App, { target, props: { profile, adapter } });
} else {
  mount(UnsupportedProfile, { target, props: { requestedId, profiles: listOSProfiles() } });
}

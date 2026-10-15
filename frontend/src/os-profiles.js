import { mojaveProfile } from './mojave-applications.js';
import { highSierraProfile } from './high-sierra-profile.js';
import { sonomaProfile } from './sonoma-profile.js';
import { windows11Profile } from './windows11-profile.js';
import { goldenGateProfile } from './golden-gate-profile.js';

export const MOJAVE_PROFILE_ID = 'macos-mojave-10.14';
export const DEFAULT_PROFILE_ID = goldenGateProfile.id;

function freezeTree(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

const profiles = freezeTree({
  [MOJAVE_PROFILE_ID]: mojaveProfile,
  [highSierraProfile.id]: highSierraProfile,
  [sonomaProfile.id]: sonomaProfile,
  [windows11Profile.id]: windows11Profile,
  [goldenGateProfile.id]: goldenGateProfile,
});

export function getOSProfile(id) {
  return typeof id === 'string' && Object.hasOwn(profiles, id) ? profiles[id] : null;
}

export function listOSProfiles() {
  return Object.values(profiles);
}

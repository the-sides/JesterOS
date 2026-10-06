import { applications, desktopFiles } from './mojave-applications.js';
import { highSierraProfile } from './high-sierra-profile.js';
import { sonomaProfile } from './sonoma-profile.js';
import { windows11Profile } from './windows11-profile.js';

export const DEFAULT_PROFILE_ID = 'macos-mojave-10.14';

function freezeTree(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

const profiles = freezeTree({
  [DEFAULT_PROFILE_ID]: {
    id: DEFAULT_PROFILE_ID,
    name: 'macOS Mojave',
    family: 'macos',
    version: '10.14',
    releaseYear: 2018,
    renderer: 'mojave',
    capabilities: [
      'shell.apps', 'shell.windows', 'shell.macos-window-zoom', 'shell.window-resize',
      'shell.window-create', 'app.lifecycle', 'shell.switcher', 'app.visibility',
      'shell.full-screen', 'shell.split-view', 'shell.mission-control', 'shell.launchpad',
      'shell.desktop', 'shell.desktop-stacks', 'shell.dock-context', 'shell.dock-management', 'shell.dock-recents', 'shell.dock-stacks', 'shell.window-menu',
      'scene.profile-selection',
      'notes.plain-text', 'notes.presentation', 'messages.sample',
    ],
    applications,
    desktopFiles,
    assets: {
      wallpaper: '/wallpapers/mojave-day.webp',
      icons: '/icons',
      messages: '/messages',
      fonts: ['/fonts/InterVariable.woff2', '/fonts/LiberationSans-Regular.ttf'],
    },
    defaults: { startupAppId: 'messages', desktopAppId: 'finder', clockLabel: 'Mon 5:42 PM', batteryPercent: 87 },
  },
  [highSierraProfile.id]: highSierraProfile,
  [sonomaProfile.id]: sonomaProfile,
  [windows11Profile.id]: windows11Profile,
});

export function getOSProfile(id) {
  return typeof id === 'string' && Object.hasOwn(profiles, id) ? profiles[id] : null;
}

export function listOSProfiles() {
  return Object.values(profiles);
}

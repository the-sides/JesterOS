import { composeNativeProfile } from './native-profile-composition.js';

// Simulation layout policy, not measured factory macOS minima. Launch-only
// shells and the fixed-position Messages sample retain their represented size.
const installedApplications = {
  finder: { id: 'finder', name: 'Finder', icon: 'finder', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: true, quitAllowed: false, dock: 'main', coverage: 'desktop-locations' },
  launchpad: { id: 'launchpad', name: 'Launchpad', icon: 'launchpad', presentation: 'launchpad', multipleWindows: false, quitAllowed: false, dock: 'main', coverage: 'shell-launcher' },
  safari: { id: 'safari', name: 'Safari', icon: 'safari', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: true, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
  mail: { id: 'mail', name: 'Mail', icon: 'mail', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
  contacts: { id: 'contacts', name: 'Contacts', icon: 'contacts', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
  calendar: { id: 'calendar', name: 'Calendar', icon: 'calendar', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
  notes: { id: 'notes', name: 'Notes', icon: 'notes', width: 1024, height: 660, minimumSize: { width: 960, height: 420 }, multipleWindows: true, quitAllowed: true, dock: 'main', coverage: 'plain-text' },
  messages: { id: 'messages', name: 'Messages', icon: 'messages', width: 928, height: 710, minimumSize: { width: 928, height: 710 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'conversations' },
  settings: { id: 'settings', name: 'System Preferences', icon: 'settings', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'dock-preferences' },
  photos: { id: 'photos', name: 'Photos', icon: 'photos', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'recent', coverage: 'launch-only' },
  preview: { id: 'preview', name: 'Preview', icon: 'preview', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: true, quitAllowed: true, coverage: 'launch-only' },
  dashboard: { id: 'dashboard', name: 'Dashboard', icon: 'dashboard', presentation: 'dashboard', multipleWindows: false, quitAllowed: false, coverage: 'shell-widgets' },
};

export const desktopFiles = [
  { id: 'disk', name: 'Macintosh HD', icon: 'drive', appId: 'finder' },
  { id: 'personal', name: 'Personal', icon: 'folder', appId: 'finder' },
  { id: 'itinerary', name: 'Itinerary.pdf', icon: 'pdf', appId: 'preview' },
];

export const mojaveProfile = composeNativeProfile({
    id: 'macos-mojave-10.14',
    name: 'macOS Mojave',
    family: 'macos',
    version: '10.14',
    releaseYear: 2018,
    renderer: 'mojave',
    capabilities: [
      'shell.apps', 'shell.windows', 'shell.macos-window-zoom', 'shell.window-resize',
      'shell.window-create', 'app.lifecycle', 'shell.switcher', 'app.visibility',
      'shell.full-screen', 'shell.split-view', 'shell.mission-control', 'shell.launchpad', 'shell.dashboard',
      'shell.desktop', 'shell.desktop-stacks', 'shell.dock-context', 'shell.dock-management', 'shell.dock-recents', 'shell.dock-stacks', 'shell.window-menu',
      'shell.help-workflows', 'shell.appearance', 'scene.profile-selection',
      'notes.workspace', 'messages.sample', 'messages.conversations',
      'browser.local', 'mail.local', 'contacts.cards', 'calendar.events',
      'calls.local', 'apps.reminders',
    ],
    applications: installedApplications,
    desktopFiles,
    assets: {
      wallpaper: '/wallpapers/mojave-day.webp',
      icons: '/icons',
      messages: '/messages',
      fonts: ['/fonts/InterVariable.woff2', '/fonts/LiberationSans-Regular.ttf'],
    },
    defaults: { startupAppId: 'messages', desktopAppId: 'finder', sceneTime: '2018-09-24T17:42:00Z', clockLabel: 'Mon 5:42 PM', batteryPercent: 87 },
});

export const applications = mojaveProfile.applications;

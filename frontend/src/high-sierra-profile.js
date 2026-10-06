// macOS 10.13 inventory and implemented coverage are researched separately in
// docs/high-sierra-profile.md. Native stock membership is not interior coverage.
// Minimum sizes protect the represented layouts, not factory macOS measurements.
export const highSierraProfile = {
  id: 'macos-high-sierra-10.13',
  name: 'macOS High Sierra',
  family: 'macos',
  version: '10.13',
  releaseYear: 2017,
  renderer: 'high-sierra',
  capabilities: [
    'shell.apps', 'shell.windows', 'shell.macos-window-zoom', 'shell.window-resize',
    'shell.window-create', 'app.lifecycle', 'shell.switcher', 'app.visibility',
    'shell.full-screen', 'shell.split-view', 'shell.mission-control',
    'shell.desktop', 'shell.dock-context', 'shell.dock-management', 'shell.dock-stacks', 'shell.window-menu',
    'scene.profile-selection',
    'notes.plain-text', 'notes.presentation', 'messages.sample',
  ],
  applications: {
    finder: { id: 'finder', name: 'Finder', icon: 'finder', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: true, quitAllowed: false, dock: 'main', coverage: 'desktop-locations' },
    launchpad: { id: 'launchpad', name: 'Launchpad', icon: 'launchpad', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
    safari: { id: 'safari', name: 'Safari', icon: 'safari', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: true, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
    mail: { id: 'mail', name: 'Mail', icon: 'mail', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
    contacts: { id: 'contacts', name: 'Contacts', icon: 'contacts', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
    calendar: { id: 'calendar', name: 'Calendar', icon: 'calendar', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
    notes: { id: 'notes', name: 'Notes', icon: 'notes', width: 1120, height: 660, minimumSize: { width: 1060, height: 420 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'plain-text' },
    photos: { id: 'photos', name: 'Photos', icon: 'photos', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
    messages: { id: 'messages', name: 'Messages', icon: 'messages', width: 928, height: 710, minimumSize: { width: 928, height: 710 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'sample' },
    settings: { id: 'settings', name: 'System Preferences', icon: 'settings', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'dock-preferences' },
    preview: { id: 'preview', name: 'Preview', icon: 'pdf', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: true, quitAllowed: true, coverage: 'launch-only' },
  },
  desktopFiles: [
    { id: 'disk', name: 'Macintosh HD', icon: 'drive', appId: 'finder' },
    { id: 'personal', name: 'Personal', icon: 'folder', appId: 'finder' },
    { id: 'itinerary', name: 'Itinerary.pdf', icon: 'pdf', appId: 'preview' },
  ],
  assets: {
    wallpaper: '/high-sierra/wallpaper.webp',
    icons: '/high-sierra/icons',
    messages: '/high-sierra/messages',
    fonts: ['/fonts/InterVariable.woff2', '/fonts/LiberationSans-Regular.ttf'],
  },
  defaults: { startupAppId: 'messages', desktopAppId: 'finder', clockLabel: 'Mon 9:41 AM', batteryPercent: 87 },
};

// Simulation layout policy, not measured factory macOS minima. Launch-only
// shells and the fixed-position Messages sample retain their represented size.
export const applications = {
  finder: { id: 'finder', name: 'Finder', icon: 'finder', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: true, quitAllowed: false, dock: 'main', coverage: 'desktop-locations' },
  launchpad: { id: 'launchpad', name: 'Launchpad', icon: 'launchpad', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
  safari: { id: 'safari', name: 'Safari', icon: 'safari', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: true, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
  mail: { id: 'mail', name: 'Mail', icon: 'mail', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
  contacts: { id: 'contacts', name: 'Contacts', icon: 'contacts', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
  calendar: { id: 'calendar', name: 'Calendar', icon: 'calendar', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'launch-only' },
  notes: { id: 'notes', name: 'Notes', icon: 'notes', width: 1024, height: 660, minimumSize: { width: 960, height: 420 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'plain-text' },
  messages: { id: 'messages', name: 'Messages', icon: 'messages', width: 928, height: 710, minimumSize: { width: 928, height: 710 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'sample' },
  settings: { id: 'settings', name: 'System Preferences', icon: 'settings', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'main', coverage: 'dock-preferences' },
  photos: { id: 'photos', name: 'Photos', icon: 'photos', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: false, quitAllowed: true, dock: 'recent', coverage: 'launch-only' },
  preview: { id: 'preview', name: 'Preview', icon: 'pdf', width: 720, height: 480, minimumSize: { width: 720, height: 480 }, multipleWindows: true, quitAllowed: true, coverage: 'launch-only' },
};

export const desktopFiles = [
  { id: 'disk', name: 'Macintosh HD', icon: 'drive', appId: 'finder' },
  { id: 'personal', name: 'Personal', icon: 'folder', appId: 'finder' },
  { id: 'itinerary', name: 'Itinerary.pdf', icon: 'pdf', appId: 'preview' },
];

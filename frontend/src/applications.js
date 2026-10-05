export const applications = {
  finder: { id: 'finder', name: 'Finder', icon: 'finder', width: 720, height: 480, dock: 'main' },
  launchpad: { id: 'launchpad', name: 'Launchpad', icon: 'launchpad', width: 720, height: 480, dock: 'main' },
  safari: { id: 'safari', name: 'Safari', icon: 'safari', width: 720, height: 480, dock: 'main' },
  mail: { id: 'mail', name: 'Mail', icon: 'mail', width: 720, height: 480, dock: 'main' },
  contacts: { id: 'contacts', name: 'Contacts', icon: 'contacts', width: 720, height: 480, dock: 'main' },
  calendar: { id: 'calendar', name: 'Calendar', icon: 'calendar', width: 720, height: 480, dock: 'main' },
  notes: { id: 'notes', name: 'Notes', icon: 'notes', width: 1024, height: 660, dock: 'main' },
  messages: { id: 'messages', name: 'Messages', icon: 'messages', width: 928, height: 710, dock: 'main' },
  settings: { id: 'settings', name: 'System Preferences', icon: 'settings', width: 720, height: 480, dock: 'main' },
  photos: { id: 'photos', name: 'Photos', icon: 'photos', width: 720, height: 480, dock: 'recent' },
  preview: { id: 'preview', name: 'Preview', icon: 'pdf', width: 720, height: 480 },
};

export const desktopFiles = [
  { id: 'disk', name: 'Macintosh HD', icon: 'drive', appId: 'finder' },
  { id: 'personal', name: 'Personal', icon: 'folder', appId: 'finder' },
  { id: 'itinerary', name: 'Itinerary.pdf', icon: 'pdf', appId: 'preview' },
];
